<script setup lang="ts">
import { Button } from '..';
import { ChevronLeft, ChevronRight, Minus, Plus } from '@lucide/vue';
import { Tabs, TabsList } from '../tabs';
import TabBarItem from '../TabBar/TabBarItem.vue';
import CalendarSettingsPopover from './CalendarSettingsPopover.vue';
import type { CalendarSettings } from './calendarSettings';

defineProps<{
    viewTitle: string;
    activeView: string;
    settings: CalendarSettings;
    canZoomIn: boolean;
    canZoomOut: boolean;
}>();

const emit = defineEmits<{
    prev: [];
    next: [];
    today: [];
    'zoom-in': [];
    'zoom-out': [];
    'change-view': [view: string];
    'update:settings': [value: CalendarSettings];
}>();
</script>

<template>
    <div class="flex items-center justify-between bg-default-background px-2 py-1.5">
        <!-- Left: Navigation -->
        <div class="flex items-center gap-1">
            <Button
                variant="outline"
                size="sm"
                class="h-8 w-8 p-0"
                aria-label="Previous"
                @click="emit('prev')">
                <ChevronLeft class="h-4 w-4" />
            </Button>
            <Button
                variant="outline"
                size="sm"
                class="h-8 w-8 p-0"
                aria-label="Next"
                @click="emit('next')">
                <ChevronRight class="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" @click="emit('today')"> today </Button>

            <!-- Vertical zoom: each step shows one hour more or less -->
            <div class="flex items-center gap-1 ml-1">
                <Button
                    variant="outline"
                    size="sm"
                    class="h-8 w-8 p-0"
                    aria-label="Zoom out"
                    title="Zoom out (show one more hour)"
                    data-testid="calendar-zoom-out"
                    :disabled="!canZoomOut"
                    @click="emit('zoom-out')">
                    <Minus class="h-4 w-4" />
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    class="h-8 w-8 p-0"
                    aria-label="Zoom in"
                    title="Zoom in (show one hour less)"
                    data-testid="calendar-zoom-in"
                    :disabled="!canZoomIn"
                    @click="emit('zoom-in')">
                    <Plus class="h-4 w-4" />
                </Button>
            </div>
        </div>

        <!-- Center: Title -->
        <span data-testid="calendar-title" class="text-base font-semibold text-foreground">{{
            viewTitle
        }}</span>

        <!-- Right: Page supplied actions + View switcher + Settings -->
        <div class="flex items-center gap-1">
            <!--
                Anything provider specific lives here rather than in this package, which stays
                agnostic - the Jira sync button is passed in by Calendar.vue.
            -->
            <slot name="actions"></slot>
            <Tabs
                :model-value="activeView"
                @update:model-value="(v) => emit('change-view', String(v))">
                <TabsList class="flex items-center space-x-0.5 sm:space-x-1">
                    <TabBarItem value="timeGridWeek">week</TabBarItem>
                    <TabBarItem value="timeGridDay">day</TabBarItem>
                </TabsList>
            </Tabs>
            <CalendarSettingsPopover
                :settings="settings"
                @update:settings="(v) => emit('update:settings', v)">
                <template #extra-settings>
                    <slot name="extra-settings"></slot>
                </template>
            </CalendarSettingsPopover>
        </div>
    </div>
</template>
