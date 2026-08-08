import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_NO_PROJECT_COLOR, getNoProjectColor } from './settings';

function setNoProjectColor(value: unknown) {
    window.getNoProjectColorSetting = vi.fn(() => value) as unknown as () => string;
}

describe('getNoProjectColor', () => {
    afterEach(() => {
        setNoProjectColor(DEFAULT_NO_PROJECT_COLOR);
    });

    it('returns the configured color', () => {
        setNoProjectColor('#ff7043');

        expect(getNoProjectColor()).toBe('#ff7043');
    });

    it('accepts a color with an alpha channel', () => {
        setNoProjectColor('#ff704380');

        expect(getNoProjectColor()).toBe('#ff704380');
    });

    it('lowercases the value, because chroma output and stored values are compared as strings', () => {
        setNoProjectColor('#FF7043');

        expect(getNoProjectColor()).toBe('#ff7043');
    });

    it.each([
        ['an empty string', ''],
        ['a named color', 'red'],
        ['a css variable', 'var(--theme-color-icon-default)'],
        ['shorthand hex', '#f70'],
        ['a non string', 42],
    ])('falls back for %s', (_label, value) => {
        setNoProjectColor(value);

        expect(getNoProjectColor()).toBe(DEFAULT_NO_PROJECT_COLOR);
    });

    it('falls back when the global is missing, as on a session predating the deploy', () => {
        // @ts-expect-error deliberately removing the global the app installs at boot
        delete window.getNoProjectColorSetting;

        expect(getNoProjectColor()).toBe(DEFAULT_NO_PROJECT_COLOR);
    });
});
