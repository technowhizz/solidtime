<script setup lang="ts">
import { computed, inject, ref, type ComputedRef } from 'vue';
import ActionSection from '@/Components/ActionSection.vue';
import ConfirmationModal from '@/Components/ConfirmationModal.vue';
import DangerButton from '@/packages/ui/src/Buttons/DangerButton.vue';
import SecondaryButton from '@/packages/ui/src/Buttons/SecondaryButton.vue';
import GoogleIcon from '@/packages/ui/src/Icons/GoogleIcon.vue';
import { Badge } from '@/packages/ui/src';
import { ExclamationTriangleIcon } from '@heroicons/vue/20/solid';
import type { Organization } from '@/packages/api/src';
import { formatDateTimeLocalized } from '@/packages/ui/src/utils/time';
import {
    useGoogleCalendarConnectionQuery,
    useGoogleCalendarMutations,
} from '@/utils/useGoogleCalendarQuery';

const organization = inject<ComputedRef<Organization>>('organization');

const { data: connection, isLoading } = useGoogleCalendarConnectionQuery();
const { disconnect } = useGoogleCalendarMutations();

const isConnected = computed(() => connection.value?.is_connected === true);
const requiresReauthentication = computed(
    () => connection.value?.requires_reauthentication === true
);

const confirmingDisconnect = ref(false);
const isDisconnecting = ref(false);

async function disconnectGoogleCalendar() {
    isDisconnecting.value = true;
    try {
        await disconnect();
        confirmingDisconnect.value = false;
    } finally {
        isDisconnecting.value = false;
    }
}
</script>

<template>
    <ActionSection>
        <template #title> Google Calendar </template>

        <template #description>
            Show your Google Calendar events next to your time entries and copy them into a time
            entry with one click.
        </template>

        <template #content>
            <div v-if="isLoading" class="text-sm text-text-tertiary">Loading…</div>

            <div v-else class="space-y-4">
                <div v-if="isConnected" class="flex items-center justify-between gap-3">
                    <div class="break-all text-text-primary">
                        <div class="flex items-center gap-2">
                            <GoogleIcon class="w-4 h-4 shrink-0" />
                            <span>{{ connection?.email ?? 'Google account' }}</span>
                        </div>
                        <div
                            v-if="connection?.connected_at"
                            class="text-sm text-text-tertiary mt-0.5">
                            Connected on
                            {{
                                formatDateTimeLocalized(
                                    connection.connected_at,
                                    organization?.date_format,
                                    organization?.time_format
                                )
                            }}
                        </div>
                    </div>
                    <Badge v-if="requiresReauthentication" class="shrink-0 text-destructive">
                        <ExclamationTriangleIcon class="w-4 h-4" />
                        <span>Reconnect required</span>
                    </Badge>
                </div>

                <p v-if="requiresReauthentication" class="text-sm text-text-secondary">
                    Google rejected the stored credentials. Connect your account again to keep
                    seeing your calendar events.
                </p>

                <p v-else-if="!isConnected" class="text-sm text-text-secondary">
                    solidtime only asks for read-only access to your calendar events and your email
                    address, and never stores the content of your events.
                </p>

                <div class="flex items-center gap-3">
                    <!-- A plain link, not an Inertia one: OAuth needs a real top level navigation -->
                    <a
                        v-if="!isConnected || requiresReauthentication"
                        :href="route('integrations.google-calendar.connect')"
                        data-testid="google_calendar_connect">
                        <SecondaryButton :icon="GoogleIcon">
                            {{
                                isConnected
                                    ? 'Reconnect Google Calendar'
                                    : 'Connect Google Calendar'
                            }}
                        </SecondaryButton>
                    </a>
                    <DangerButton
                        v-if="isConnected"
                        data-testid="google_calendar_disconnect"
                        @click="confirmingDisconnect = true">
                        Disconnect
                    </DangerButton>
                </div>
            </div>
        </template>
    </ActionSection>

    <ConfirmationModal :show="confirmingDisconnect" @close="confirmingDisconnect = false">
        <template #title> Disconnect Google Calendar </template>

        <template #content>
            Your calendar events will no longer be shown in solidtime and the access to your Google
            account will be revoked. Time entries you already created are not affected.
        </template>

        <template #footer>
            <SecondaryButton @click="confirmingDisconnect = false"> Cancel </SecondaryButton>

            <DangerButton
                class="ms-3"
                :class="{ 'opacity-25': isDisconnecting }"
                :disabled="isDisconnecting"
                @click="disconnectGoogleCalendar">
                Disconnect
            </DangerButton>
        </template>
    </ConfirmationModal>
</template>
