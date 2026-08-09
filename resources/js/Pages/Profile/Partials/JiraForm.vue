<script setup lang="ts">
import { computed, inject, ref, watch, type ComputedRef } from 'vue';
import ActionSection from '@/Components/ActionSection.vue';
import ConfirmationModal from '@/Components/ConfirmationModal.vue';
import DangerButton from '@/packages/ui/src/Buttons/DangerButton.vue';
import PrimaryButton from '@/packages/ui/src/Buttons/PrimaryButton.vue';
import SecondaryButton from '@/packages/ui/src/Buttons/SecondaryButton.vue';
import TextInput from '@/packages/ui/src/Input/TextInput.vue';
import InputLabel from '@/packages/ui/src/Input/InputLabel.vue';
import { Badge } from '@/packages/ui/src';
import { ExclamationTriangleIcon } from '@heroicons/vue/20/solid';
import type { Organization } from '@/packages/api/src';
import { showMissingTicketHintsSetting } from '@/utils/jira';
import { useJiraConnectionQuery, useJiraMutations } from '@/utils/useJiraQuery';
import { useAppName } from '@/utils/appName';
import { Checkbox } from '@/packages/ui/src';

const organization = inject<ComputedRef<Organization>>('organization');
const appName = useAppName();

const { data: connection, isLoading } = useJiraConnectionQuery();
const { connect, isConnecting, updateSettings, disconnect } = useJiraMutations();

const isConfigured = computed(() => connection.value?.is_configured === true);
const isConnected = computed(() => connection.value?.is_connected === true);
const requiresReauthentication = computed(
    () => connection.value?.requires_reauthentication === true
);

const email = ref('');
const apiToken = ref('');
const syncFromDate = ref('');

// The stored cutoff only arrives once the connection query resolves
watch(
    connection,
    (value) => {
        syncFromDate.value = value?.sync_from_date ?? '';
        if (!email.value) {
            email.value = value?.email ?? '';
        }
    },
    { immediate: true }
);

const canSubmit = computed(
    () => email.value.trim() !== '' && apiToken.value.trim() !== '' && !isConnecting.value
);

async function submit() {
    if (!canSubmit.value) {
        return;
    }
    await connect({ email: email.value.trim(), api_token: apiToken.value.trim() });
    // Never keep the token in memory once it has been stored
    apiToken.value = '';
}

const isSavingSettings = ref(false);

async function saveSyncFromDate() {
    isSavingSettings.value = true;
    try {
        await updateSettings({
            sync_from_date: syncFromDate.value === '' ? null : syncFromDate.value,
        });
    } finally {
        isSavingSettings.value = false;
    }
}

const confirmingDisconnect = ref(false);
const isDisconnecting = ref(false);

async function disconnectJira() {
    isDisconnecting.value = true;
    try {
        await disconnect();
        confirmingDisconnect.value = false;
        apiToken.value = '';
    } finally {
        isDisconnecting.value = false;
    }
}
</script>

<template>
    <ActionSection>
        <template #title> Jira </template>

        <template #description>
            Log your time entries to Jira issues. Put a ticket key like PROJ-123 in a description
            and {{ appName }} will log that time against the issue.
        </template>

        <template #content>
            <div v-if="isLoading" class="text-sm text-text-tertiary">Loading…</div>

            <!--
                The site URL is an organization setting, so somebody without the rights to set it
                needs telling who can, rather than an empty form that cannot work.
            -->
            <div v-else-if="!isConfigured" class="text-sm text-text-secondary">
                No Jira site has been set up for
                <span class="font-medium text-text-primary">{{ organization?.name }}</span>
                yet. An organization administrator can add one under Organization Settings.
            </div>

            <div v-else class="space-y-5">
                <div v-if="isConnected" class="flex items-center justify-between gap-3">
                    <div class="break-all text-text-primary">
                        <div>{{ connection?.display_name ?? connection?.email }}</div>
                        <div class="text-sm text-text-tertiary mt-0.5">
                            {{ connection?.email }} on {{ connection?.site_url }}
                        </div>
                    </div>
                    <Badge v-if="requiresReauthentication" class="shrink-0 text-destructive">
                        <ExclamationTriangleIcon class="w-4 h-4" />
                        <span>Reconnect required</span>
                    </Badge>
                </div>

                <p v-if="requiresReauthentication" class="text-sm text-text-secondary">
                    Jira rejected the stored token. Enter a new one to start syncing again.
                </p>

                <form
                    v-if="!isConnected || requiresReauthentication"
                    class="space-y-4"
                    @submit.prevent="submit">
                    <p class="text-sm text-text-secondary">
                        Create an API token at
                        <span class="font-medium text-text-primary"
                            >id.atlassian.com → Security → API tokens</span
                        >. It is stored encrypted, and worklogs are logged as you rather than as a
                        shared account.
                    </p>
                    <div>
                        <InputLabel for="jira_email" value="Atlassian account email" />
                        <TextInput
                            id="jira_email"
                            v-model="email"
                            type="email"
                            autocomplete="off"
                            class="mt-1 block w-full"
                            data-testid="jira_email" />
                    </div>
                    <div>
                        <InputLabel for="jira_api_token" value="API token" />
                        <TextInput
                            id="jira_api_token"
                            v-model="apiToken"
                            type="password"
                            autocomplete="off"
                            class="mt-1 block w-full"
                            data-testid="jira_api_token" />
                    </div>
                    <PrimaryButton
                        type="submit"
                        :disabled="!canSubmit"
                        :class="{ 'opacity-25': !canSubmit }"
                        data-testid="jira_connect">
                        {{ isConnected ? 'Reconnect Jira' : 'Connect Jira' }}
                    </PrimaryButton>
                </form>

                <div class="space-y-2 border-t border-card-border pt-5">
                    <InputLabel value="Entries without a ticket" />
                    <p class="text-sm text-text-secondary">
                        Marks work entries whose description contains no ticket key with a red dot,
                        in the calendar, the time list and the timesheet, so they are easy to spot.
                        Applies to every entry, and works whether or not you have connected your
                        Jira account.
                    </p>
                    <label class="flex items-center gap-2 pt-1 text-sm text-text-primary">
                        <Checkbox
                            v-model:checked="showMissingTicketHintsSetting"
                            data-testid="jira_missing_ticket_toggle" />
                        Show a red dot on entries with no ticket
                    </label>
                </div>

                <div v-if="isConnected" class="space-y-2 border-t border-card-border pt-5">
                    <InputLabel for="jira_sync_from_date" value="Only sync work from" />
                    <p class="text-sm text-text-secondary">
                        Time before this date is treated as already logged in Jira and is left
                        alone. Set it if you imported history from another tracker that was already
                        logged. Leave it empty to consider everything.
                    </p>
                    <div class="flex items-center gap-3">
                        <TextInput
                            id="jira_sync_from_date"
                            v-model="syncFromDate"
                            type="date"
                            class="block"
                            data-testid="jira_sync_from_date" />
                        <SecondaryButton
                            :disabled="isSavingSettings"
                            data-testid="jira_save_sync_from_date"
                            @click="saveSyncFromDate">
                            Save
                        </SecondaryButton>
                    </div>
                </div>

                <div v-if="isConnected">
                    <DangerButton
                        data-testid="jira_disconnect"
                        @click="confirmingDisconnect = true">
                        Disconnect
                    </DangerButton>
                </div>
            </div>
        </template>
    </ActionSection>

    <ConfirmationModal :show="confirmingDisconnect" @close="confirmingDisconnect = false">
        <template #title> Disconnect Jira </template>

        <template #content>
            Your stored token is deleted and nothing more is logged to Jira. Worklogs already in
            Jira stay there, but {{ appName }} forgets that it created them, so syncing the same
            dates after reconnecting would log that work a second time.
        </template>

        <template #footer>
            <SecondaryButton @click="confirmingDisconnect = false"> Cancel </SecondaryButton>

            <DangerButton
                class="ms-3"
                :class="{ 'opacity-25': isDisconnecting }"
                :disabled="isDisconnecting"
                @click="disconnectJira">
                Disconnect
            </DangerButton>
        </template>
    </ConfirmationModal>
</template>
