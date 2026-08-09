<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
    Dialog,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogScrollContent,
    DialogTitle,
} from '@/packages/ui/src';
import PrimaryButton from '@/packages/ui/src/Buttons/PrimaryButton.vue';
import SecondaryButton from '@/packages/ui/src/Buttons/SecondaryButton.vue';
import { formatHumanReadableDuration } from '@/packages/ui/src/utils/time';
import { ExclamationTriangleIcon } from '@heroicons/vue/20/solid';
import type { JiraSyncItem } from '@/packages/api/src';
import { describeInvalidRange, describeSkipReason } from '@/utils/jira';
import { useAppName } from '@/utils/appName';
import DateRangePicker from '@/packages/ui/src/Input/DateRangePicker.vue';
import { getLocalizedDayJs } from '@/packages/ui/src/utils/time';
import { useJiraSync } from '@/utils/useJiraQuery';

const props = defineProps<{
    show: boolean;
    /** Local dates (YYYY-MM-DD) of the range currently on screen. */
    startDate: string;
    endDate: string;
}>();

const emit = defineEmits<{ close: [] }>();

const appName = useAppName();
const { plan, run, isLoadingPlan, isSyncing, error, loadPlan, start, reset } = useJiraSync();

/*
 * The range starts as whatever the view is showing but is editable here, so a week you are not
 * looking at can be synced without navigating to it first. Held in the picker's datetime format
 * and narrowed to local dates for the API, which works in whole days.
 */
const rangeStart = ref('');
const rangeEnd = ref('');
const selectedStartDate = computed(() =>
    rangeStart.value ? getLocalizedDayJs(rangeStart.value).format('YYYY-MM-DD') : ''
);
const selectedEndDate = computed(() =>
    rangeEnd.value ? getLocalizedDayJs(rangeEnd.value).format('YYYY-MM-DD') : ''
);
const rangeError = computed(() =>
    describeInvalidRange(selectedStartDate.value, selectedEndDate.value)
);

// Opening loads a fresh plan; closing throws it away so the next open never shows a stale one
watch(
    () => props.show,
    (show) => {
        reset();
        if (show) {
            rangeStart.value = getLocalizedDayJs(props.startDate).startOf('day').format();
            rangeEnd.value = getLocalizedDayJs(props.endDate).startOf('day').format();
        }
    }
);

/*
 * Reloads the preview whenever the range settles. Picking a new start clears the end, so the
 * guard keeps it from firing against a half-chosen range - and Vue batches the picker's two
 * emits into one run.
 */
watch(
    [selectedStartDate, selectedEndDate],
    ([newStart, newEnd]) => {
        if (!props.show || run.value !== null) {
            return;
        }
        if (newStart === '' || newEnd === '' || rangeError.value !== null) {
            return;
        }
        loadPlan(newStart, newEnd);
    },
    { immediate: true }
);

const ACTION_LABELS: Record<string, string> = {
    create: 'Log',
    update: 'Update',
    delete: 'Remove',
    unchanged: 'Already logged',
};

const ACTION_CLASSES: Record<string, string> = {
    create: 'text-green-600 dark:text-green-400',
    update: 'text-amber-600 dark:text-amber-400',
    delete: 'text-red-600 dark:text-red-400',
    unchanged: 'text-text-tertiary',
};

const items = computed<JiraSyncItem[]>(() => plan.value?.items ?? []);
const changes = computed(() => items.value.filter((item) => item.action !== 'unchanged'));
const unchanged = computed(() => items.value.filter((item) => item.action === 'unchanged'));
/*
 * Deleting is the only thing here that destroys work in Jira rather than adding to it, so it is
 * called out separately above the table rather than being just another red row.
 */
const deletions = computed(() => items.value.filter((item) => item.action === 'delete'));
const deletedSeconds = computed(() =>
    deletions.value.reduce((total, item) => total + item.duration, 0)
);
const skipped = computed(() => plan.value?.skipped ?? []);

/** Only entries that could have been synced but were not - breaks and pre-cutoff work are noise here. */
const missingTicket = computed(() =>
    skipped.value.filter((entry) => entry.reason === 'no_issue_key')
);
const otherSkipped = computed(() =>
    skipped.value.filter((entry) => entry.reason !== 'no_issue_key')
);

const hasFinished = computed(
    () => run.value?.status === 'completed' || run.value?.status === 'failed'
);
const results = computed<JiraSyncItem[]>(() => run.value?.results ?? []);
const failures = computed(() => results.value.filter((result) => result.status === 'failed'));

const progressLabel = computed(() => {
    if (!run.value) {
        return '';
    }
    return `${run.value.done} of ${run.value.total}`;
});

function duration(seconds: number): string {
    return formatHumanReadableDuration(seconds);
}

function confirm() {
    start(selectedStartDate.value, selectedEndDate.value);
}
</script>

<template>
    <Dialog :open="show" @update:open="(open: boolean) => !open && emit('close')">
        <DialogScrollContent class="sm:max-w-3xl">
            <!--
                The testid lives here rather than on DialogScrollContent: that component's root
                is a DialogPortal, whose own root is a Teleport, so fallthrough attributes have
                no element to land on and are dropped.
            -->
            <DialogHeader data-testid="jira_sync_dialog">
                <DialogTitle>Sync to Jira</DialogTitle>
                <DialogDescription>
                    Entries on the same ticket with the same description on the same day are logged
                    as one worklog.
                </DialogDescription>
                <div class="flex flex-wrap items-center gap-3 pt-1">
                    <div v-if="run" class="text-sm tabular-nums text-text-secondary">
                        {{ selectedStartDate }} to {{ selectedEndDate }}
                    </div>
                    <div v-else class="w-[290px]" data-testid="jira_sync_range">
                        <DateRangePicker v-model:start="rangeStart" v-model:end="rangeEnd" />
                    </div>
                    <p v-if="rangeError" class="text-sm text-destructive">{{ rangeError }}</p>
                </div>
            </DialogHeader>

            <div v-if="rangeError" class="py-6 text-sm text-text-tertiary">
                Choose a shorter range to see what would be synced.
            </div>

            <div v-else-if="isLoadingPlan" class="py-6 text-sm text-text-tertiary">
                Working out what needs syncing…
            </div>

            <div v-else-if="error && !run" class="py-6 text-sm text-destructive">
                {{ error }}
            </div>

            <div v-else class="space-y-6 py-2">
                <!-- Progress and results, once a run has started -->
                <div v-if="run" class="space-y-3">
                    <div class="flex items-center justify-between text-sm">
                        <span class="font-medium text-text-primary">
                            {{ hasFinished ? 'Finished' : 'Syncing…' }}
                        </span>
                        <span class="text-text-tertiary tabular-nums">{{ progressLabel }}</span>
                    </div>
                    <div class="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                        <div
                            class="h-full bg-accent-300/80 transition-all"
                            :style="{
                                width:
                                    run.total === 0
                                        ? '100%'
                                        : `${Math.round((run.done / run.total) * 100)}%`,
                            }"></div>
                    </div>
                    <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
                    <div v-if="failures.length > 0" class="space-y-1">
                        <p class="text-sm font-medium text-destructive">
                            {{ failures.length }} could not be logged
                        </p>
                        <ul class="space-y-1 text-sm text-text-secondary">
                            <li v-for="failure in failures" :key="failure.group_hash">
                                <span class="font-medium text-text-primary">{{
                                    failure.issue_key
                                }}</span>
                                — {{ failure.error }}
                            </li>
                        </ul>
                    </div>
                    <p
                        v-else-if="hasFinished && !error"
                        class="text-sm text-text-secondary"
                        data-testid="jira_sync_success">
                        Everything in this range is now up to date in Jira.
                    </p>
                </div>

                <!-- The plan, before confirming -->
                <template v-else>
                    <div v-if="changes.length === 0" class="text-sm text-text-secondary">
                        Nothing to send — everything with a ticket in this range is already up to
                        date in Jira.
                    </div>

                    <div v-else class="space-y-2">
                        <div
                            v-if="deletions.length > 0"
                            class="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
                            data-testid="jira_sync_delete_warning">
                            <ExclamationTriangleIcon
                                class="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                            <div class="text-text-secondary">
                                <span class="font-medium text-text-primary">
                                    {{ deletions.length }} worklog{{
                                        deletions.length === 1 ? '' : 's'
                                    }}
                                    ({{ duration(deletedSeconds) }}) will be deleted from Jira.
                                </span>
                                Their time entries were deleted here, or their description changed
                                so the time now belongs to a different ticket. Only worklogs
                                {{ appName }} created are ever touched.
                            </div>
                        </div>
                        <div class="text-sm font-medium text-text-primary">
                            {{ changes.length }} worklog{{ changes.length === 1 ? '' : 's' }} to
                            send
                        </div>
                        <table class="w-full text-sm" data-testid="jira_sync_plan">
                            <thead class="text-text-tertiary">
                                <tr class="text-left">
                                    <th class="py-1 pr-3 font-medium">Action</th>
                                    <th class="py-1 pr-3 font-medium">Ticket</th>
                                    <th class="py-1 pr-3 font-medium">Date</th>
                                    <th class="py-1 pr-3 font-medium">Description</th>
                                    <th class="py-1 text-right font-medium">Time</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="item in changes"
                                    :key="item.group_hash"
                                    class="border-t border-card-background-separator">
                                    <td
                                        class="py-1.5 pr-3 font-medium"
                                        :class="ACTION_CLASSES[item.action]">
                                        {{ ACTION_LABELS[item.action] }}
                                    </td>
                                    <td class="py-1.5 pr-3 font-medium text-text-primary">
                                        {{ item.issue_key }}
                                    </td>
                                    <td class="py-1.5 pr-3 text-text-secondary tabular-nums">
                                        {{ item.work_date }}
                                    </td>
                                    <td class="py-1.5 pr-3 text-text-secondary">
                                        {{ item.comment ?? '—' }}
                                    </td>
                                    <td class="py-1.5 text-right tabular-nums text-text-secondary">
                                        <!-- An update shows what it moves from, so a shrinking total is obvious -->
                                        <span
                                            v-if="
                                                item.action === 'update' &&
                                                item.previous_duration !== null
                                            "
                                            class="text-text-tertiary line-through mr-1">
                                            {{ duration(item.previous_duration) }}
                                        </span>
                                        {{
                                            item.action === 'delete' ? '' : duration(item.duration)
                                        }}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div v-if="unchanged.length > 0" class="text-sm text-text-tertiary">
                        {{ unchanged.length }} worklog{{ unchanged.length === 1 ? '' : 's' }}
                        already up to date.
                    </div>

                    <!-- The visual replacement for the script's "Invalid Entries" table -->
                    <div v-if="missingTicket.length > 0" class="space-y-2">
                        <div class="text-sm font-medium text-text-primary">
                            {{ missingTicket.length }} entr{{
                                missingTicket.length === 1 ? 'y has' : 'ies have'
                            }}
                            no ticket and will be skipped
                        </div>
                        <ul class="space-y-1 text-sm text-text-secondary">
                            <li
                                v-for="entry in missingTicket"
                                :key="entry.time_entry_id"
                                class="flex items-baseline justify-between gap-3">
                                <span class="truncate">{{
                                    entry.description || 'No description'
                                }}</span>
                                <span class="shrink-0 tabular-nums text-text-tertiary">
                                    {{ duration(entry.duration) }}
                                </span>
                            </li>
                        </ul>
                    </div>

                    <details v-if="otherSkipped.length > 0" class="text-sm">
                        <summary class="cursor-pointer text-text-tertiary">
                            {{ otherSkipped.length }} other entr{{
                                otherSkipped.length === 1 ? 'y' : 'ies'
                            }}
                            not eligible
                        </summary>
                        <ul class="mt-2 space-y-1 text-text-secondary">
                            <li
                                v-for="entry in otherSkipped"
                                :key="entry.time_entry_id"
                                class="flex items-baseline justify-between gap-3">
                                <span class="truncate">{{
                                    entry.description || 'No description'
                                }}</span>
                                <span class="shrink-0 text-text-tertiary">
                                    {{ describeSkipReason(entry.reason) }}
                                </span>
                            </li>
                        </ul>
                    </details>
                </template>
            </div>

            <DialogFooter>
                <SecondaryButton @click="emit('close')">
                    {{ hasFinished ? 'Close' : 'Cancel' }}
                </SecondaryButton>
                <PrimaryButton
                    v-if="!run"
                    :disabled="
                        isLoadingPlan || isSyncing || changes.length === 0 || rangeError !== null
                    "
                    :class="{
                        'opacity-25':
                            isLoadingPlan ||
                            isSyncing ||
                            changes.length === 0 ||
                            rangeError !== null,
                    }"
                    data-testid="jira_sync_confirm"
                    @click="confirm">
                    Sync {{ changes.length }} to Jira
                </PrimaryButton>
            </DialogFooter>
        </DialogScrollContent>
    </Dialog>
</template>
