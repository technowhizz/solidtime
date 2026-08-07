<script setup lang="ts">
import { ref, watch } from 'vue';
import { watchDebounced } from '@vueuse/core';
import { MagnifyingGlassIcon } from '@heroicons/vue/20/solid';
import Dropdown from '@/packages/ui/src/Input/Dropdown.vue';
import TextInput from '@/packages/ui/src/Input/TextInput.vue';
import ReportingFilterBadge from '@/Components/Common/Reporting/ReportingFilterBadge.vue';
import { Button } from '@/packages/ui/src';

const model = defineModel<string>({ required: true });

const emit = defineEmits<{
    submit: [];
}>();

const open = ref(false);

// Local, undebounced value bound to the input. The debounce lives here so that neither reporting
// page has to duplicate it, and so the query key only changes once the user pauses typing.
const inputValue = ref(model.value);

// Keep the input in sync when the term is changed from the outside.
watch(model, (value) => {
    if (value !== inputValue.value) {
        inputValue.value = value;
    }
});

watchDebounced(
    inputValue,
    (value) => {
        const trimmed = value.trim();
        if (trimmed === model.value) {
            return;
        }
        model.value = trimmed;
        emit('submit');
    },
    { debounce: 300, maxWait: 1000 }
);

function clear() {
    inputValue.value = '';
    if (model.value !== '') {
        model.value = '';
        emit('submit');
    }
}
</script>

<template>
    <Dropdown v-model="open" align="start" :close-on-content-click="false">
        <template #trigger>
            <ReportingFilterBadge
                title="Description"
                :active="model.length > 0"
                :label="model.length > 0 ? model : undefined"
                :icon="MagnifyingGlassIcon" />
        </template>
        <template #content>
            <div class="w-72 space-y-2 p-2">
                <TextInput
                    v-model="inputValue"
                    size="sm"
                    class="w-full"
                    name="description"
                    aria-label="Filter by description"
                    placeholder="Search descriptions..." />
                <div class="flex items-center justify-between gap-2">
                    <span class="text-xs text-text-tertiary">
                        Matches any part of the description
                    </span>
                    <Button v-if="inputValue.length > 0" variant="ghost" size="xs" @click="clear">
                        Clear
                    </Button>
                </div>
            </div>
        </template>
    </Dropdown>
</template>
