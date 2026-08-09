import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, type Ref } from 'vue';
import type { Dayjs } from 'dayjs';
import { api, type GoogleCalendarConnection, type GoogleCalendarEvent } from '@/packages/api/src';
import { useNotificationsStore } from '@/utils/notification';
import { getExpandedCalendarDateRange } from '@/utils/useTimeEntriesCalendarQuery';

export const googleCalendarConnectionQueryKey = ['googleCalendar', 'connection'] as const;

export function createGoogleCalendarEventsQueryKey(
    start: string | null,
    end: string | null
): readonly ['googleCalendar', 'events', { start: string | null; end: string | null }] {
    return ['googleCalendar', 'events', { start, end }] as const;
}

export function useGoogleCalendarConnectionQuery(enabled: Ref<boolean> | boolean = true) {
    return useQuery<GoogleCalendarConnection>({
        queryKey: googleCalendarConnectionQueryKey,
        enabled,
        queryFn: async () => (await api.getGoogleCalendarConnection()).data,
    });
}

export function useGoogleCalendarEventsQuery(
    calendarStart: Ref<Dayjs | undefined>,
    calendarEnd: Ref<Dayjs | undefined>,
    isConnected: Ref<boolean>
) {
    // Uses the same expanded range as the time entries, so navigating to the previous or
    // next period does not flash an empty lane
    const expandedDateRange = computed(() => {
        if (!calendarStart.value || !calendarEnd.value) {
            return { start: null, end: null };
        }
        return getExpandedCalendarDateRange(calendarStart.value, calendarEnd.value);
    });

    const enabled = computed(
        () =>
            isConnected.value &&
            expandedDateRange.value.start !== null &&
            expandedDateRange.value.end !== null
    );

    return useQuery<GoogleCalendarEvent[]>({
        queryKey: computed(() =>
            createGoogleCalendarEventsQueryKey(
                expandedDateRange.value.start,
                expandedDateRange.value.end
            )
        ),
        enabled,
        // Deliberately no staleTime: revalidating on mount and focus costs a request to our
        // own server, which the per-day cache answers without touching Google. Holding the
        // browser copy back would only add its window to the server's, doubling how long a
        // change in Google can take to show up. placeholderData keeps the current events
        // rendered while a revalidation is in flight, so this does not flicker.
        placeholderData: (previousData) => previousData,
        queryFn: async () => {
            const response = await api.getGoogleCalendarEvents({
                queries: {
                    start: expandedDateRange.value.start!,
                    end: expandedDateRange.value.end!,
                },
            });
            return response.data;
        },
    });
}

export function useGoogleCalendarMutations() {
    const queryClient = useQueryClient();
    const { handleApiRequestNotifications } = useNotificationsStore();

    const { mutateAsync: disconnect } = useMutation({
        mutationFn: async () => {
            return await handleApiRequestNotifications(
                () => api.deleteGoogleCalendarConnection(undefined),
                'Google Calendar disconnected successfully',
                'Failed to disconnect Google Calendar'
            );
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['googleCalendar'] });
        },
    });

    return {
        disconnect,
    };
}
