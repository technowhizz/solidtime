<script setup lang="ts">
import { computed, inject, ref, type ComputedRef } from 'vue';
import { useElementSize } from '@vueuse/core';
import { formatHumanReadableDuration, getDayJsInstance } from '../utils/time';
import type { Organization } from '@/packages/api/src';
import { Coffee } from '@lucide/vue';
import { ExclamationTriangleIcon } from '@heroicons/vue/20/solid';
import ExternalSyncIndicator from '../TimeEntry/ExternalSyncIndicator.vue';
import type { ExternalSyncBadge } from '../TimeEntry/externalSyncTypes';

const props = defineProps<{
    title: string;
    projectName?: string | null;
    taskName?: string | null;
    clientName?: string | null;
    durationSeconds?: number;
    start?: string | Date | null;
    end?: string | Date | null;
    isBreak?: boolean;
    isMisplacedBreak?: boolean;
    /** Sync state against an external issue tracker, if the page supplies one. */
    syncBadge?: ExternalSyncBadge | null;
}>();

const effectiveDurationSeconds = computed(() => {
    if (typeof props.durationSeconds === 'number') {
        return props.durationSeconds;
    }
    if (props.start && props.end) {
        const end = getDayJsInstance()(props.end as unknown as string | Date);
        const start = getDayJsInstance()(props.start as unknown as string | Date);
        const minutes = end.diff(start, 'minutes');
        return minutes * 60;
    }
    return 0;
});

const organization = inject('organization') as ComputedRef<Organization | undefined> | undefined;
const intervalFormat = computed(() => organization?.value?.interval_format);
const numberFormat = computed(() => organization?.value?.number_format);

const formattedDuration = computed(() =>
    formatHumanReadableDuration(
        effectiveDurationSeconds.value,
        intervalFormat.value,
        numberFormat.value
    )
);

/*
 * The description wraps over as many lines as the entry has room for, so it is only
 * truncated when it genuinely does not fit. Project, task and client keep their space —
 * they are measured rather than assumed, since a long name can wrap onto a second line.
 */
const contentBox = ref<HTMLElement | null>(null);
const metaBlock = ref<HTMLElement | null>(null);
const { height: contentBoxHeight } = useElementSize(contentBox);
const { height: metaBlockHeight } = useElementSize(metaBlock);

// Keep in sync with the compact layout's container query in the style block below.
const COMPACT_MAX_HEIGHT = 40;
// 11px text at leading-tight (1.25). Only a fallback — the real value is measured on mount.
const FALLBACK_LINE_HEIGHT = 13.75;
const VERTICAL_PADDING = 8;
const COMPACT_VERTICAL_PADDING = 4;

const isCompact = computed(
    () => contentBoxHeight.value > 0 && contentBoxHeight.value <= COMPACT_MAX_HEIGHT
);

const lineHeight = computed(() => {
    const element = metaBlock.value ?? contentBox.value;
    if (!element || typeof getComputedStyle !== 'function') {
        return FALLBACK_LINE_HEIGHT;
    }
    const measured = parseFloat(getComputedStyle(element).lineHeight);
    return Number.isFinite(measured) && measured > 0 ? measured : FALLBACK_LINE_HEIGHT;
});

const titleLineClamp = computed(() => {
    if (contentBoxHeight.value === 0 || isCompact.value) {
        return 1;
    }
    const padding = isCompact.value ? COMPACT_VERTICAL_PADDING : VERTICAL_PADDING;
    // The duration sits on its own line at the bottom, so it needs reserving too.
    const available = contentBoxHeight.value - padding - metaBlockHeight.value - lineHeight.value;
    return Math.max(1, Math.floor(available / lineHeight.value));
});
</script>

<template>
    <div ref="contentBox" class="fc-event-content-box h-full">
        <div class="fc-event-content text-[11px] leading-tight px-0.5 py-1 h-full flex flex-col">
            <div class="fc-event-text min-h-0 overflow-hidden">
                <div class="font-semibold flex items-start gap-1">
                    <Coffee v-if="isBreak" class="w-3 h-3 shrink-0" />
                    <ExternalSyncIndicator :badge="syncBadge ?? null" small class="mt-[3px]" />
                    <span class="fc-event-title" :style="{ WebkitLineClamp: titleLineClamp }">{{
                        title
                    }}</span>
                    <ExclamationTriangleIcon
                        v-if="isMisplacedBreak"
                        data-testid="calendar_break_placement_hint"
                        title="This break does not align with your work entries"
                        class="w-3 h-3 shrink-0 text-amber-600 dark:text-amber-400" />
                </div>
                <div ref="metaBlock">
                    <div v-if="projectName" class="font-medium opacity-90">
                        {{ projectName }}
                    </div>
                    <div v-if="taskName" class="font-medium">
                        {{ taskName }}
                    </div>
                    <div v-if="clientName" class="opacity-85">
                        {{ clientName }}
                    </div>
                </div>
            </div>
            <div
                class="fc-event-duration mt-auto self-end shrink-0 pl-1 font-medium tabular-nums"
                data-duration>
                {{ formattedDuration }}
            </div>
        </div>
    </div>
</template>

<style scoped>
/* Query target for the compact layout below — an element cannot query itself. */
.fc-event-content-box {
    container-type: size;
}

/*
 * Wraps over the number of lines the entry has room for (set inline as
 * -webkit-line-clamp), ellipsising only on the last one.
 */
.fc-event-title {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
    min-width: 0;
}

/*
 * Very short entries (roughly 25 minutes and under) have no room for a stacked
 * duration — the description would be squeezed out entirely. Put both on a single
 * row instead, keeping the duration on the right.
 */
@container (max-height: 40px) {
    .fc-event-content {
        flex-direction: row;
        align-items: baseline;
        padding-top: 2px;
        padding-bottom: 2px;
    }
    .fc-event-text {
        flex: 1 1 auto;
        min-width: 0;
    }
    .fc-event-duration {
        margin-top: 0;
        margin-left: auto;
        align-self: baseline;
        line-height: 1;
    }
}
</style>
