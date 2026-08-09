<script setup lang="ts">
import AppLayout from '@/Layouts/AppLayout.vue';
import { useTimeEntriesCalendarQuery } from '@/utils/useTimeEntriesCalendarQuery';
import { useTimeEntriesMutations } from '@/utils/useTimeEntriesMutations';
import { computed, ref, onMounted } from 'vue';
import type { Dayjs } from 'dayjs';
import { useQueryClient } from '@tanstack/vue-query';
import {
    type Client,
    type CreateClientBody,
    type CreateProjectBody,
    type Project,
} from '@/packages/api/src';
import { TimeEntryCalendar, Checkbox } from '@/packages/ui/src';
import type { ActivityPeriod } from '@/packages/ui/src/FullCalendar/activityTypes';
import type { ExternalCalendarEvent } from '@/packages/ui/src/FullCalendar/externalCalendarTypes';
import { isGoogleCalendarEnabled } from '@/utils/googleCalendar';
import { showMissingTicketHintsSetting } from '@/utils/jira';
import { useJiraIndicators } from '@/utils/useJiraQuery';
import JiraSyncButton from '@/Components/Jira/JiraSyncButton.vue';
import {
    useGoogleCalendarConnectionQuery,
    useGoogleCalendarEventsQuery,
} from '@/utils/useGoogleCalendarQuery';
import { isAllowedToPerformPremiumAction } from '@/utils/billing';
import { useTagsStore } from '@/utils/useTags';
import { useProjectsQuery } from '@/utils/useProjectsQuery';
import { useClientsQuery } from '@/utils/useClientsQuery';
import { useTasksQuery } from '@/utils/useTasksQuery';
import { useTagsQuery } from '@/utils/useTagsQuery';
import { useProjectsStore } from '@/utils/useProjects';
import { useClientsStore } from '@/utils/useClients';
import { getOrganizationCurrencyString } from '@/utils/money';
import { canCreateProjects } from '@/utils/permissions';
import { useCurrentTimeEntryStore } from '@/utils/useCurrentTimeEntry';
import { useOrganizationQuery } from '@/utils/useOrganizationQuery';
import { getCurrentOrganizationId } from '@/utils/useUser';

const { organization } = useOrganizationQuery(getCurrentOrganizationId()!);
const calendarStart = ref<Dayjs | undefined>(undefined);
const calendarEnd = ref<Dayjs | undefined>(undefined);

// Optional deep link (e.g. "Fix in calendar") that opens the calendar on a specific day
const initialDate = new URLSearchParams(window.location.search).get('date');

// Test-injectable activity periods (for E2E testing).
// These hooks are no-ops in production — they only take effect when test code
// explicitly sets window globals, so they are safe to ship.
const testActivityPeriods = ref<ActivityPeriod[]>([]);

onMounted(() => {
    (window as unknown as Record<string, unknown>).__TEST_SET_ACTIVITY_PERIODS__ = (
        data: ActivityPeriod[]
    ) => {
        testActivityPeriods.value = data;
    };

    const windowData = (window as unknown as Record<string, unknown>).__TEST_ACTIVITY_PERIODS__;
    if (Array.isArray(windowData)) {
        setTimeout(() => {
            testActivityPeriods.value = windowData;
        }, 2000);
    }
});

const { data: timeEntryResponse, isLoading: timeEntriesLoading } = useTimeEntriesCalendarQuery(
    calendarStart,
    calendarEnd
);

const currentTimeEntries = computed(() => {
    return timeEntryResponse?.value?.data || [];
});

const {
    createTimeEntry: createTimeEntryMutation,
    updateTimeEntry: updateTimeEntryMutation,
    deleteTimeEntry: deleteTimeEntryMutation,
} = useTimeEntriesMutations();

// Wrap mutations to match expected Promise<void> return type
async function createTimeEntry(
    entry: Omit<import('@/packages/api/src').TimeEntry, 'id' | 'organization_id' | 'user_id'>
): Promise<void> {
    await createTimeEntryMutation(entry);
}

async function updateTimeEntry(entry: import('@/packages/api/src').TimeEntry): Promise<void> {
    await updateTimeEntryMutation(entry);
}

async function deleteTimeEntry(timeEntryId: string): Promise<void> {
    await deleteTimeEntryMutation(timeEntryId);
}

async function createTag(name: string) {
    return await useTagsStore().createTag(name);
}

async function createProject(project: CreateProjectBody): Promise<Project | undefined> {
    return await useProjectsStore().createProject(project);
}

async function createClient(body: CreateClientBody): Promise<Client | undefined> {
    return await useClientsStore().createClient(body);
}

const googleCalendarEnabled = isGoogleCalendarEnabled();
const { data: googleCalendarConnection } = useGoogleCalendarConnectionQuery(googleCalendarEnabled);
const isGoogleCalendarConnected = computed(
    () => googleCalendarConnection.value?.is_connected === true
);
const { data: googleCalendarEvents } = useGoogleCalendarEventsQuery(
    calendarStart,
    calendarEnd,
    isGoogleCalendarConnected
);

// packages/ui stays provider agnostic, so the Google specific shape is mapped here
const externalCalendarEvents = computed<ExternalCalendarEvent[]>(() =>
    (googleCalendarEvents.value ?? []).map((event) => ({
        id: event.id,
        title: event.title,
        start: event.start,
        end: event.end,
        isAllDay: event.is_all_day,
    }))
);

// The Jira range is the visible one in local dates, since a worklog belongs to the day the
// work happened rather than to a UTC instant
const jiraStartDate = computed(() => calendarStart.value?.format('YYYY-MM-DD') ?? null);
const jiraEndDate = computed(() => calendarEnd.value?.format('YYYY-MM-DD') ?? null);
const {
    isJiraEnabled: jiraEnabled,
    isConnected: isJiraConnected,
    externalSyncBadges,
} = useJiraIndicators(jiraStartDate, jiraEndDate, () => currentTimeEntries.value);

const { projects } = useProjectsQuery();
const { tasks } = useTasksQuery();
const { clients } = useClientsQuery();
const { tags } = useTagsQuery();

const queryClient = useQueryClient();

function onDatesChange({ start, end }: { start: Dayjs; end: Dayjs }) {
    calendarStart.value = start;
    calendarEnd.value = end;
}

function onRefresh() {
    queryClient.invalidateQueries({
        queryKey: ['timeEntries'],
    });
    useCurrentTimeEntryStore().fetchCurrentTimeEntry();
}
</script>

<template>
    <AppLayout
        title="Calendar"
        data-testid="calendar_view"
        main-class="p-0 min-h-0 overflow-hidden">
        <TimeEntryCalendar
            :time-entries="currentTimeEntries"
            :projects="projects"
            :tasks="tasks"
            :clients="clients"
            :tags="tags"
            :loading="timeEntriesLoading"
            :enable-estimated-time="isAllowedToPerformPremiumAction()"
            :currency="getOrganizationCurrencyString()"
            :can-create-project="canCreateProjects()"
            :initial-date="initialDate"
            :organization-billable-rate="organization?.billable_rate ?? null"
            :create-time-entry="createTimeEntry"
            :update-time-entry="updateTimeEntry"
            :delete-time-entry="deleteTimeEntry"
            :create-client="createClient"
            :create-project="createProject"
            :create-tag="createTag"
            :activity-periods="testActivityPeriods"
            :external-calendar-events="externalCalendarEvents"
            :external-sync-badges="externalSyncBadges"
            @dates-change="onDatesChange"
            @refresh="onRefresh">
            <template v-if="jiraEnabled" #toolbar-actions>
                <JiraSyncButton
                    :is-connected="isJiraConnected"
                    :start-date="jiraStartDate"
                    :end-date="jiraEndDate" />
            </template>
            <template v-if="jiraEnabled" #calendar-settings>
                <label class="flex items-start gap-2 text-sm text-text-secondary">
                    <Checkbox
                        v-model:checked="showMissingTicketHintsSetting"
                        class="mt-0.5"
                        data-testid="calendar_jira_missing_ticket_toggle" />
                    <span>Mark entries with no Jira ticket</span>
                </label>
            </template>
        </TimeEntryCalendar>
    </AppLayout>
</template>
