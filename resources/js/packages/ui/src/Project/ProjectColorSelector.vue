<script setup lang="ts">
import Dropdown from '@/packages/ui/src/Input/Dropdown.vue';
import ProjectColorPicker from '@/packages/ui/src/Project/ProjectColorPicker.vue';

const model = defineModel<string>({ default: '' });
</script>

<template>
    <div>
        <!--
            close-on-content-click has to be off: the dropdown otherwise closes on any click
            inside it, and releasing a picker drag counts as one.
        -->
        <Dropdown align="center" :close-on-content-click="false">
            <template #trigger>
                <button
                    type="button"
                    aria-label="Select color"
                    class="h-9 w-9 flex items-center justify-center bg-input-background hover:bg-tertiary transition rounded-full border border-input-border">
                    <div class="bg-checkerboard w-5 h-5 rounded-full overflow-hidden">
                        <div
                            :style="{
                                backgroundColor: model,
                            }"
                            class="w-full h-full cursor-pointer"></div>
                    </div>
                </button>
            </template>
            <template #content>
                <ProjectColorPicker v-model="model" />
            </template>
        </Dropdown>
    </div>
</template>

<style scoped></style>
