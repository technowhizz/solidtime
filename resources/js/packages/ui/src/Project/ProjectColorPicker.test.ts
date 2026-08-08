import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ProjectColorPicker from './ProjectColorPicker.vue';
import { colors } from '../utils/color';

function picker(modelValue = '#ef5350') {
    return mount(ProjectColorPicker, { props: { modelValue } });
}

function hexField(wrapper: ReturnType<typeof picker>) {
    return wrapper.get('input[aria-label="Hex color"]');
}

function lastModelValue(wrapper: ReturnType<typeof picker>): string | undefined {
    const emitted = wrapper.emitted('update:modelValue') as string[][] | undefined;
    return emitted?.at(-1)?.[0];
}

describe('ProjectColorPicker', () => {
    it('renders every preset as a focusable button', () => {
        const buttons = picker().findAll('[role="group"][aria-label="Preset colors"] button');

        expect(buttons).toHaveLength(colors.length);
        expect(buttons.every((button) => button.attributes('type') === 'button')).toBe(true);
    });

    it('marks the selected preset as pressed, ignoring alpha', () => {
        const wrapper = picker('#ef535080');
        const selected = wrapper.get(`button[aria-label="${colors[0]}"]`);

        expect(colors[0]).toBe('#ef5350');
        expect(selected.attributes('aria-pressed')).toBe('true');
    });

    it('emits the preset hex when one is clicked', async () => {
        const wrapper = picker('#26a69a');

        await wrapper.get('button[aria-label="#42a5f5"]').trigger('click');

        expect(lastModelValue(wrapper)).toBe('#42a5f5');
    });

    it('keeps the current alpha when switching to a preset', async () => {
        const wrapper = picker('#26a69a80');

        await wrapper.get('button[aria-label="#42a5f5"]').trigger('click');

        expect(lastModelValue(wrapper)).toBe('#42a5f580');
    });

    it('commits a typed shorthand hex in canonical form', async () => {
        const wrapper = picker('#26a69a');
        const field = hexField(wrapper);

        await field.trigger('focus');
        await field.setValue('#f00');
        await field.trigger('blur');

        expect(lastModelValue(wrapper)).toBe('#ff0000');
    });

    it('commits a typed hex carrying an alpha channel', async () => {
        const wrapper = picker('#26a69a');
        const field = hexField(wrapper);

        await field.trigger('focus');
        await field.setValue('#3b82f680');
        await field.trigger('blur');

        expect(lastModelValue(wrapper)).toBe('#3b82f680');
    });

    it('reverts an unparseable hex instead of emitting it', async () => {
        const wrapper = picker('#26a69a');
        const field = hexField(wrapper);

        await field.trigger('focus');
        await field.setValue('nonsense');
        await field.trigger('blur');

        expect(lastModelValue(wrapper)).toBeUndefined();
        expect((field.element as HTMLInputElement).value).toBe('#26a69a');
    });

    it('clamps a fully transparent choice off zero, so the dot stays visible elsewhere', async () => {
        const wrapper = picker('#26a69a');
        const field = hexField(wrapper);

        await field.trigger('focus');
        await field.setValue('#26a69a00');
        await field.trigger('blur');

        expect(lastModelValue(wrapper)).toBe('#26a69a1a');
    });
});
