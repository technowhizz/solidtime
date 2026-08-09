<script setup lang="ts">
import FormSection from '@/Components/FormSection.vue';
import PrimaryButton from '@/packages/ui/src/Buttons/PrimaryButton.vue';
import TextInput from '@/packages/ui/src/Input/TextInput.vue';
import InputLabel from '@/packages/ui/src/Input/InputLabel.vue';
import { onMounted, ref } from 'vue';
import type { UpdateOrganizationBody } from '@/packages/api/src';
import { useOrganizationStore } from '@/utils/useOrganization';
import { storeToRefs } from 'pinia';
import { useMutation, useQueryClient } from '@tanstack/vue-query';

const store = useOrganizationStore();
const { updateOrganization } = store;
const { organization } = storeToRefs(store);
const queryClient = useQueryClient();

const form = ref<{
    jira_site_url: string;
    jira_project_keys: string;
}>({
    jira_site_url: '',
    jira_project_keys: '',
});

onMounted(() => {
    form.value.jira_site_url = organization.value?.jira_site_url ?? '';
    form.value.jira_project_keys = organization.value?.jira_project_keys ?? '';
});

const mutation = useMutation({
    mutationFn: (values: Partial<UpdateOrganizationBody>) => updateOrganization(values),
    onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['organization'] });
    },
});

async function submit() {
    await mutation.mutateAsync({
        // Empty clears the setting, which turns the integration off for everyone
        jira_site_url: form.value.jira_site_url.trim() === '' ? null : form.value.jira_site_url,
        jira_project_keys:
            form.value.jira_project_keys.trim() === '' ? null : form.value.jira_project_keys,
    });
}
</script>

<template>
    <FormSection>
        <template #title>Jira</template>
        <template #description>
            Point the organization at your Jira site so members can log their time to issues. Each
            member connects their own Atlassian account, so worklogs are attributed to them rather
            than to a shared login.
        </template>

        <template #form>
            <div class="col-span-6 sm:col-span-4 space-y-6">
                <div>
                    <InputLabel for="jira_site_url" value="Jira site URL" />
                    <TextInput
                        id="jira_site_url"
                        v-model="form.jira_site_url"
                        type="text"
                        placeholder="https://your-org.atlassian.net"
                        class="mt-1 block w-full"
                        data-testid="organization_jira_site_url" />
                    <p class="mt-1.5 text-sm text-text-secondary">
                        Leave empty to turn the Jira integration off for this organization.
                    </p>
                </div>

                <div>
                    <InputLabel for="jira_project_keys" value="Project keys (optional)" />
                    <TextInput
                        id="jira_project_keys"
                        v-model="form.jira_project_keys"
                        type="text"
                        placeholder="PROJ, OPS"
                        class="mt-1 block w-full"
                        data-testid="organization_jira_project_keys" />
                    <p class="mt-1.5 text-sm text-text-secondary">
                        Restricts ticket detection to these projects. Without it anything shaped
                        like an issue key is picked up, which also matches things like UTF-8 and
                        COVID-19.
                    </p>
                </div>
            </div>
        </template>

        <template #actions>
            <PrimaryButton
                :class="{ 'opacity-25': mutation.isPending.value }"
                :disabled="mutation.isPending.value"
                data-testid="organization_jira_submit"
                @click="submit">
                Save
            </PrimaryButton>
        </template>
    </FormSection>
</template>
