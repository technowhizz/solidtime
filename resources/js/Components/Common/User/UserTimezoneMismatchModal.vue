<script setup lang="ts">
import { usePage } from '@inertiajs/vue3';
import type { User } from '@/types/models';
import TimezoneMismatchModal from '@/packages/ui/src/TimezoneMismatchModal.vue';
import { useUpdateUserMutation } from '@/utils/useUserQuery';

const show = defineModel('show', { default: false });

const page = usePage<{
    auth: {
        user: User;
    };
}>();

const updateUser = useUpdateUserMutation();

async function handleUpdate(timezone: string) {
    if (updateUser.isPending.value) return;
    try {
        await updateUser.mutateAsync({
            userId: page.props.auth.user.id,
            body: { timezone },
        });
        show.value = false;
        // getUserTimezone() reads the Inertia-shared auth.user, not the me query, so a
        // full reload is what actually propagates the new timezone across the app.
        window.location.reload();
    } catch {
        // notification handled by the mutation
    }
}
</script>

<template>
    <TimezoneMismatchModal
        v-model:show="show"
        :saving="updateUser.isPending.value"
        @update="handleUpdate" />
</template>

<style scoped></style>
