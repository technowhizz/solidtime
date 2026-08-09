import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, type Ref } from 'vue';
import { api, type JiraConnection, type JiraSyncPlan, type JiraSyncRun } from '@/packages/api/src';
import { useNotificationsStore } from '@/utils/notification';
import { getCurrentOrganizationId } from '@/utils/useUser';
import {
    isJiraEnabled,
    missingReferenceBadges,
    parseProjectKeys,
    showMissingTicketHintsSetting,
    toExternalSyncBadges,
    type MissingReferenceCandidate,
} from '@/utils/jira';
import { useOrganizationQuery } from '@/utils/useOrganizationQuery';

export const jiraConnectionQueryKey = ['jira', 'connection'] as const;

export function createJiraSyncStatusQueryKey(start: string | null, end: string | null) {
    return ['jira', 'syncStatus', { start, end }] as const;
}

function organizationId(): string {
    return getCurrentOrganizationId()!;
}

export function useJiraConnectionQuery(enabled: Ref<boolean> | boolean = true) {
    return useQuery<JiraConnection>({
        queryKey: jiraConnectionQueryKey,
        enabled,
        queryFn: async () =>
            (await api.getJiraConnection({ params: { organization: organizationId() } })).data,
    });
}

/**
 * Sync state for the indicators. Keyed by the same local date range the view is showing, so
 * navigating weeks refetches rather than showing last week's states.
 */
export function useJiraSyncStatusQuery(
    startDate: Ref<string | null>,
    endDate: Ref<string | null>,
    isConnected: Ref<boolean>
) {
    const enabled = computed(
        () => isConnected.value && startDate.value !== null && endDate.value !== null
    );

    return useQuery({
        queryKey: computed(() => createJiraSyncStatusQueryKey(startDate.value, endDate.value)),
        enabled,
        // Keeps the current dots on screen while a refetch is in flight, so they do not blink
        // out every time an entry is edited
        placeholderData: (previousData) => previousData,
        queryFn: async () => {
            const response = await api.getJiraSyncStatus({
                params: { organization: organizationId() },
                queries: { start: startDate.value!, end: endDate.value! },
            });
            return response.data;
        },
    });
}

/**
 * Everything the calendar, the time list and the timesheet need to show Jira indicators.
 *
 * Shared so the three views cannot drift apart. The two kinds of dot come from different
 * places on purpose:
 *
 * - "No ticket" is derived from `timeEntries` on the client. It needs nothing from the server,
 *   so it is correct the moment an entry is created, edited or deleted - no refetch, and no
 *   request at all for someone who has not connected an account.
 * - synced / pending / outdated come from the server, which alone knows what has been logged.
 *   Those are refreshed by the invalidation in useTimeEntriesMutations.
 */
export function useJiraIndicators(
    startDate: Ref<string | null>,
    endDate: Ref<string | null>,
    timeEntries: () => MissingReferenceCandidate[]
) {
    const enabledForOrganization = isJiraEnabled();

    const { data: connection } = useJiraConnectionQuery(enabledForOrganization);
    const isConnected = computed(() => connection.value?.is_connected === true);

    const { organization } = useOrganizationQuery(getCurrentOrganizationId()!);

    // Only the sync states need the server, and only once an account is linked
    const { data: status } = useJiraSyncStatusQuery(startDate, endDate, isConnected);

    const syncStateBadges = computed(() => toExternalSyncBadges(status.value));

    const missingBadges = computed(() => {
        if (!enabledForOrganization || showMissingTicketHintsSetting.value !== true) {
            return {};
        }
        return missingReferenceBadges(timeEntries(), {
            allowedProjectKeys: parseProjectKeys(organization.value?.jira_project_keys),
            syncFromDate: connection.value?.sync_from_date ?? null,
        });
    });

    // An entry either has a ticket or it does not, so the two sets never overlap
    const externalSyncBadges = computed(() => ({
        ...syncStateBadges.value,
        ...missingBadges.value,
    }));

    return { isJiraEnabled: enabledForOrganization, isConnected, externalSyncBadges };
}

export function useJiraMutations() {
    const queryClient = useQueryClient();
    const { handleApiRequestNotifications } = useNotificationsStore();

    function invalidate() {
        queryClient.invalidateQueries({ queryKey: ['jira'] });
    }

    const { mutateAsync: connect, isPending: isConnecting } = useMutation({
        mutationFn: async (body: { email: string; api_token: string }) =>
            await handleApiRequestNotifications(
                () =>
                    api.updateJiraConnection(body, { params: { organization: organizationId() } }),
                'Jira account connected successfully',
                'Failed to connect Jira account'
            ),
        onSuccess: invalidate,
    });

    const { mutateAsync: updateSettings } = useMutation({
        mutationFn: async (body: { sync_from_date: string | null }) =>
            await handleApiRequestNotifications(
                () => api.updateJiraSettings(body, { params: { organization: organizationId() } }),
                'Jira sync settings saved',
                'Failed to save Jira sync settings'
            ),
        onSuccess: invalidate,
    });

    const { mutateAsync: disconnect } = useMutation({
        mutationFn: async () =>
            await handleApiRequestNotifications(
                () =>
                    api.deleteJiraConnection(undefined, {
                        params: { organization: organizationId() },
                    }),
                'Jira account disconnected successfully',
                'Failed to disconnect Jira account'
            ),
        onSuccess: invalidate,
    });

    return { connect, isConnecting, updateSettings, disconnect };
}

/**
 * Drives the preview dialog: fetch a plan, start a run, then poll it to completion.
 *
 * Polling rather than a socket because a run is short lived and only interesting while the
 * dialog is open - there is nothing to keep in sync once it finishes.
 */
export function useJiraSync() {
    const queryClient = useQueryClient();
    const { addNotification } = useNotificationsStore();

    const plan = ref<JiraSyncPlan | null>(null);
    const run = ref<JiraSyncRun | null>(null);
    const isLoadingPlan = ref(false);
    const isSyncing = ref(false);
    const error = ref<string | null>(null);

    function reset() {
        plan.value = null;
        run.value = null;
        error.value = null;
        isLoadingPlan.value = false;
        isSyncing.value = false;
    }

    async function loadPlan(startDate: string, endDate: string) {
        isLoadingPlan.value = true;
        error.value = null;
        try {
            const response = await api.getJiraSyncPreview({
                params: { organization: organizationId() },
                queries: { start: startDate, end: endDate },
            });
            plan.value = response.data;
        } catch (e: unknown) {
            error.value = messageFor(e, 'Failed to work out what needs syncing');
        } finally {
            isLoadingPlan.value = false;
        }
    }

    async function start(startDate: string, endDate: string) {
        isSyncing.value = true;
        error.value = null;
        try {
            const response = await api.syncJira(
                { start: startDate, end: endDate },
                { params: { organization: organizationId() } }
            );
            run.value = response.data;
            await poll(response.data.id);
        } catch (e: unknown) {
            error.value = messageFor(e, 'Failed to start the Jira sync');
            isSyncing.value = false;
        }
    }

    async function poll(runId: string) {
        // Bounded so a job that dies without reporting cannot poll forever. At 1s a tick this
        // is five minutes, comfortably longer than a full range of worklogs takes.
        const MAX_TICKS = 300;

        for (let tick = 0; tick < MAX_TICKS; tick++) {
            await new Promise((resolve) => setTimeout(resolve, 1000));

            try {
                const response = await api.getJiraSyncRun({
                    params: { organization: organizationId(), runId },
                });
                run.value = response.data;

                if (response.data.status === 'completed' || response.data.status === 'failed') {
                    isSyncing.value = false;
                    if (response.data.status === 'failed') {
                        error.value = response.data.error ?? 'The Jira sync failed';
                    }
                    // Entries themselves are untouched, but every indicator is now stale
                    queryClient.invalidateQueries({ queryKey: ['jira', 'syncStatus'] });
                    return;
                }
            } catch {
                // A single missed poll is not fatal - the run keeps going server side
            }
        }

        isSyncing.value = false;
        error.value = 'The Jira sync is taking longer than expected, check Jira before retrying';
        addNotification('error', error.value);
    }

    return { plan, run, isLoadingPlan, isSyncing, error, loadPlan, start, reset };
}

function messageFor(e: unknown, fallback: string): string {
    const message = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
    return typeof message === 'string' && message !== '' ? message : fallback;
}
