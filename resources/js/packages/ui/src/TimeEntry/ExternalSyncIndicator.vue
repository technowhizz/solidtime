<script setup lang="ts">
import { computed } from 'vue';
import type { ExternalSyncBadge } from './externalSyncTypes';

const props = defineProps<{
    badge: ExternalSyncBadge | null;
    /**
     * Shrinks the dot for dense surfaces like a short calendar entry, where the standard size
     * competes with the description for room.
     */
    small?: boolean;
}>();

const classes = computed(() => {
    if (props.badge === null) {
        return '';
    }

    // Deliberately not colour alone: synced is a filled dot, pending is a hollow ring, and the
    // two that need attention are the only ones that are red or amber.
    return {
        synced: 'fc-sync-dot-synced',
        pending: 'fc-sync-dot-pending',
        outdated: 'fc-sync-dot-outdated',
        'missing-reference': 'fc-sync-dot-missing',
        error: 'fc-sync-dot-error',
    }[props.badge.state];
});
</script>

<template>
    <span
        v-if="badge"
        class="fc-sync-dot shrink-0"
        :class="[classes, small ? 'fc-sync-dot-small' : '']"
        :data-testid="'sync_indicator_' + badge.state"
        :data-sync-state="badge.state"
        :title="badge.label"
        :aria-label="badge.label"
        role="img"></span>
</template>

<style scoped>
.fc-sync-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 9999px;
    /* Nudged down so it sits on the text's optical centre rather than its box centre */
    vertical-align: 1px;
    border: 1.5px solid transparent;
}

.fc-sync-dot-small {
    width: 6px;
    height: 6px;
    border-width: 1px;
}

.fc-sync-dot-synced {
    background-color: rgb(34 197 94);
}

/* Hollow: sent nothing yet, so nothing is filled in */
.fc-sync-dot-pending {
    background-color: transparent;
    border-color: rgb(148 163 184);
}

.fc-sync-dot-outdated {
    background-color: rgb(245 158 11);
}

.fc-sync-dot-missing {
    background-color: rgb(239 68 68);
}

.fc-sync-dot-error {
    background-color: rgb(239 68 68);
    box-shadow: 0 0 0 2px rgb(239 68 68 / 0.25);
}

:root.dark .fc-sync-dot-synced {
    background-color: rgb(74 222 128);
}

:root.dark .fc-sync-dot-pending {
    border-color: rgb(100 116 139);
}

:root.dark .fc-sync-dot-outdated {
    background-color: rgb(251 191 36);
}

:root.dark .fc-sync-dot-missing,
:root.dark .fc-sync-dot-error {
    background-color: rgb(248 113 113);
}
</style>
