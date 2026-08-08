<script setup lang="ts">
import { computed, inject, type ComputedRef } from 'vue';
import { formatHumanReadableDuration, formatStartEnd } from '../utils/time';
import type { Organization } from '@/packages/api/src';

const props = defineProps<{
    title: string;
    /** Timestamps of the whole entry, not of the day segment it is rendered in. */
    start: string;
    end?: string | null;
    durationSeconds: number;
    projectName?: string | null;
    taskName?: string | null;
    clientName?: string | null;
}>();

const organization = inject('organization') as ComputedRef<Organization | undefined> | undefined;

const timeRange = computed(() =>
    formatStartEnd(props.start, props.end ?? null, organization?.value?.time_format)
);

const duration = computed(() =>
    formatHumanReadableDuration(
        props.durationSeconds,
        organization?.value?.interval_format,
        organization?.value?.number_format
    )
);

const hasMeta = computed(() => !!(props.projectName || props.taskName || props.clientName));
</script>

<template>
    <div class="max-w-xs" data-testid="calendar_event_tooltip">
        <!--
            The event block clamps the description to however many lines it has room for, so
            a short entry hides most of it. This is the one place it is shown in full — it
            wraps instead of truncating, and long unbroken tokens break rather than overflow.
        -->
        <div class="font-semibold whitespace-normal break-words">{{ title }}</div>
        <div v-if="hasMeta" class="mt-1 space-y-0.5 opacity-90">
            <div v-if="projectName" class="break-words">{{ projectName }}</div>
            <div v-if="taskName" class="break-words">{{ taskName }}</div>
            <div v-if="clientName" class="break-words opacity-85">{{ clientName }}</div>
        </div>
        <div class="mt-1.5 flex items-center gap-1.5 tabular-nums opacity-90">
            <span>{{ timeRange }}</span>
            <span aria-hidden="true">·</span>
            <span>{{ duration }}</span>
        </div>
    </div>
</template>
