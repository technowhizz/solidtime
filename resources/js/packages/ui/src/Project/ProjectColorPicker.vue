<script setup lang="ts">
import { ref, watch } from 'vue';
import {
    ColorAreaArea,
    ColorAreaRoot,
    ColorAreaThumb,
    ColorSliderRoot,
    ColorSliderThumb,
    ColorSliderTrack,
    type Color,
} from 'reka-ui';
import TextInput from '@/packages/ui/src/Input/TextInput.vue';
import {
    colors,
    hexToHsb,
    hsbToHex,
    normalizeHexColor,
    opaqueColor,
    withAlpha,
    type HsbColor,
} from '@/packages/ui/src/utils/color';

const model = defineModel<string>({ default: '' });

/**
 * A fully transparent project would render as an invisible dot everywhere outside the
 * calendar, which reads as a bug rather than a choice.
 */
const MIN_ALPHA = 0.1;

const FALLBACK: HsbColor = { space: 'hsb', h: 0, s: 0, b: 0, alpha: 1 };

/**
 * State lives as an HSB color object rather than a hex string, and is handed to the reka
 * roots as an object so nothing round trips through hex while the user drags. That is what
 * keeps the hue when saturation or brightness reaches zero — hex has no hue to remember at
 * the black and grey edges.
 */
const hsb = ref<HsbColor>(hexToHsb(model.value) ?? FALLBACK);

const hexInput = ref(model.value);
const isEditingHex = ref(false);

function applyHsb(next: HsbColor) {
    hsb.value = next;
    model.value = hsbToHex(next);
}

function onColorUpdate(next: Color) {
    if (next.space === 'hsb') {
        // The saturation/brightness area and the alpha slider both emit hsb.
        const achromatic = next.s === 0 || next.b === 0;
        applyHsb({
            ...next,
            h: achromatic ? hsb.value.h : next.h,
            alpha: Math.max(MIN_ALPHA, next.alpha),
        });
    } else if (next.space === 'hsl') {
        // The hue slider converts to hsl internally, so take the hue and keep everything else.
        applyHsb({ ...hsb.value, h: next.h });
    }
}

function selectPreset(preset: string) {
    const next = hexToHsb(preset);
    if (next === null) return;
    // Presets are opaque, but keep whatever alpha the user already dialled in so picking a
    // new hue doesn't silently undo it.
    applyHsb({ ...next, alpha: hsb.value.alpha });
}

function commitHexInput() {
    isEditingHex.value = false;
    const normalized = normalizeHexColor(hexInput.value);

    if (normalized === null) {
        hexInput.value = model.value;
        return;
    }

    const next = hexToHsb(normalized)!;
    const achromatic = next.s === 0 || next.b === 0;
    applyHsb({
        ...next,
        h: achromatic ? hsb.value.h : next.h,
        alpha: Math.max(MIN_ALPHA, next.alpha),
    });
    hexInput.value = model.value;
}

function revertHexInput() {
    hexInput.value = model.value;
}

watch(model, (value) => {
    if (!isEditingHex.value) {
        hexInput.value = value;
    }
    // Ignore the echo of our own write; only adopt genuinely external changes.
    if (value === hsbToHex(hsb.value)) return;

    const next = hexToHsb(value);
    if (next === null) return;

    const achromatic = next.s === 0 || next.b === 0;
    hsb.value = { ...next, h: achromatic ? hsb.value.h : next.h };
});
</script>

<template>
    <div class="w-64 space-y-3 px-3 py-3 text-text-primary">
        <div class="grid grid-cols-6 gap-3" role="group" aria-label="Preset colors">
            <button
                v-for="preset in colors"
                :key="preset"
                type="button"
                :aria-label="preset"
                :aria-pressed="opaqueColor(model) === preset"
                :style="{
                    backgroundColor: preset,
                    boxShadow: `var(--tw-ring-inset) 0 0 0 calc(3px + var(--tw-ring-offset-width)) ${withAlpha(preset, 0.19)}`,
                }"
                class="w-4 h-4 rounded-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-secondary"
                @click="selectPreset(preset)"></button>
        </div>

        <ColorAreaRoot
            v-slot="{ style }"
            :model-value="hsb"
            color-space="hsb"
            x-channel="saturation"
            y-channel="brightness"
            @update:color="onColorUpdate">
            <ColorAreaArea
                :style="style"
                class="relative h-32 w-full rounded-md border border-input-border">
                <ColorAreaThumb
                    class="block h-4 w-4 rounded-full border-2 border-white shadow ring-1 ring-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </ColorAreaArea>
        </ColorAreaRoot>

        <ColorSliderRoot
            :model-value="hsb"
            channel="hue"
            color-space="hsb"
            aria-label="Hue"
            class="relative flex h-4 w-full touch-none select-none items-center"
            @update:color="onColorUpdate">
            <ColorSliderTrack
                class="relative h-3 w-full grow rounded-full border border-input-border" />
            <ColorSliderThumb
                class="block h-4 w-4 rounded-full border-2 border-white shadow ring-1 ring-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </ColorSliderRoot>

        <!-- The alpha track renders its own checkerboard, so transparency stays legible. -->
        <ColorSliderRoot
            :model-value="hsb"
            channel="alpha"
            color-space="hsb"
            aria-label="Transparency"
            class="relative flex h-4 w-full touch-none select-none items-center"
            @update:color="onColorUpdate">
            <ColorSliderTrack
                class="relative h-3 w-full grow rounded-full border border-input-border" />
            <ColorSliderThumb
                class="block h-4 w-4 rounded-full border-2 border-white shadow ring-1 ring-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </ColorSliderRoot>

        <div class="flex items-center gap-2">
            <div
                class="bg-checkerboard h-7 w-7 shrink-0 overflow-hidden rounded-md border border-input-border">
                <div class="h-full w-full" :style="{ backgroundColor: model }"></div>
            </div>
            <TextInput
                v-model="hexInput"
                size="sm"
                class="w-full font-mono"
                aria-label="Hex color"
                spellcheck="false"
                autocomplete="off"
                maxlength="9"
                @focus="isEditingHex = true"
                @blur="commitHexInput"
                @keydown.enter.prevent="commitHexInput"
                @keydown.esc="revertHexInput" />
        </div>
    </div>
</template>

<style scoped></style>
