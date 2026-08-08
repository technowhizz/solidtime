import { describe, expect, it } from 'vitest';
import {
    colors,
    flattenColor,
    formatHexColor,
    hexToHsb,
    hsbToHex,
    normalizeHexColor,
    opaqueColor,
    parseHexColor,
    withAlpha,
} from './color';

describe('parseHexColor', () => {
    it('parses a six digit hex as fully opaque', () => {
        expect(parseHexColor('#ef5350')).toEqual({ hex: '#ef5350', alpha: 1 });
    });

    it('lowercases the result', () => {
        expect(parseHexColor('#EF5350')).toEqual({ hex: '#ef5350', alpha: 1 });
    });

    it('accepts a missing leading hash', () => {
        expect(parseHexColor('ef5350')).toEqual({ hex: '#ef5350', alpha: 1 });
    });

    it('expands three digit shorthand', () => {
        expect(parseHexColor('#f00')).toEqual({ hex: '#ff0000', alpha: 1 });
    });

    it('expands four digit shorthand including alpha', () => {
        const parsed = parseHexColor('#f008');

        expect(parsed?.hex).toBe('#ff0000');
        expect(parsed?.alpha).toBeCloseTo(136 / 255, 5);
    });

    it('parses the alpha channel of an eight digit hex', () => {
        const parsed = parseHexColor('#ef535080');

        expect(parsed?.hex).toBe('#ef5350');
        expect(parsed?.alpha).toBeCloseTo(128 / 255, 5);
    });

    it('reads ff as exactly opaque', () => {
        expect(parseHexColor('#ef5350ff')?.alpha).toBe(1);
    });

    it('reads 00 as exactly transparent', () => {
        expect(parseHexColor('#ef535000')?.alpha).toBe(0);
    });

    it.each([
        ['an empty string', ''],
        ['seven digits', '#ef53508'],
        ['nine digits', '#ef5350800'],
        ['non hex digits', '#gggggg'],
        ['an rgb function', 'rgb(0,0,0)'],
        ['a named color', 'red'],
        ['a css variable', 'var(--theme-color-icon-default)'],
        ['an inner space', '#ef53 50'],
    ])('returns null for %s', (_label, value) => {
        expect(parseHexColor(value)).toBeNull();
    });
});

describe('formatHexColor', () => {
    it('emits six digits when fully opaque', () => {
        expect(formatHexColor('#ef5350', 1)).toBe('#ef5350');
    });

    it('emits eight digits when translucent', () => {
        expect(formatHexColor('#ef5350', 0.5)).toBe('#ef535080');
    });

    it('emits eight digits when fully transparent', () => {
        expect(formatHexColor('#ef5350', 0)).toBe('#ef535000');
    });
});

describe('normalizeHexColor', () => {
    it('expands and lowercases', () => {
        expect(normalizeHexColor('#F00')).toBe('#ff0000');
    });

    it('collapses a redundant ff alpha to six digits', () => {
        expect(normalizeHexColor('#EF5350FF')).toBe('#ef5350');
    });

    it('returns null for a non hex value', () => {
        expect(normalizeHexColor('nope')).toBeNull();
    });
});

describe('opaqueColor', () => {
    it('drops the alpha channel', () => {
        expect(opaqueColor('#ef535080')).toBe('#ef5350');
    });

    it('leaves an opaque color untouched', () => {
        expect(opaqueColor('#ef5350')).toBe('#ef5350');
    });

    it('passes through a css variable so it stays usable as a fallback', () => {
        expect(opaqueColor('var(--theme-color-icon-default)')).toBe(
            'var(--theme-color-icon-default)'
        );
    });
});

describe('withAlpha', () => {
    it('reproduces the legacy 30 halo suffix', () => {
        expect(withAlpha('#ef5350', 0.19)).toBe('#ef535030');
    });

    it('reproduces the legacy bb chart suffix', () => {
        expect(withAlpha('#ef5350', 0.733)).toBe('#ef5350bb');
    });

    it('replaces an existing alpha rather than appending to it', () => {
        const result = withAlpha('#ef535080', 0.19);

        expect(result).toBe('#ef535030');
        expect(result).toHaveLength(9);
    });

    it('collapses to six digits at full alpha', () => {
        expect(withAlpha('#ef5350', 1)).toBe('#ef5350');
    });

    it('returns an unparseable value unchanged', () => {
        expect(withAlpha('garbage', 0.5)).toBe('garbage');
    });

    it('clamps out of range alpha', () => {
        expect(withAlpha('#ef5350', 5)).toBe('#ef5350');
        expect(withAlpha('#ef5350', -1)).toBe('#ef535000');
    });
});

describe('flattenColor', () => {
    it('is the identity for an opaque color', () => {
        expect(flattenColor('#ef5350', '#000000')).toBe('#ef5350');
    });

    it('treats a redundant ff alpha as opaque', () => {
        expect(flattenColor('#ffffffff', '#000000')).toBe('#ffffff');
    });

    it('resolves a fully transparent color to the background', () => {
        expect(flattenColor('#ffffff00', '#000000')).toBe('#000000');
    });

    it('never returns an eight digit hex', () => {
        const result = flattenColor('#ffffff80', '#000000');

        expect(result).toHaveLength(7);
    });

    it('composites onto an oklch background, as the dark theme supplies', () => {
        const result = flattenColor('#ff000080', 'oklch(0.14 0 0)');

        expect(result).toHaveLength(7);
        expect(result).not.toBe('#ff0000');
    });

    it('falls back to the opaque color when the background is not yet resolved', () => {
        expect(flattenColor('#ff000080', '')).toBe('#ff0000');
    });

    it('returns an unparseable color unchanged', () => {
        expect(flattenColor('var(--x)', '#000000')).toBe('var(--x)');
    });
});

describe('hexToHsb / hsbToHex', () => {
    it.each(colors)('round trips the preset %s', (preset) => {
        expect(hsbToHex(hexToHsb(preset)!)).toBe(preset);
    });

    it('round trips an alpha channel', () => {
        expect(hsbToHex(hexToHsb('#ef535080')!)).toBe('#ef535080');
    });

    it('reports zero brightness for black, so the picker can preserve the hue', () => {
        expect(hexToHsb('#000000')?.b).toBe(0);
    });

    it('reports zero saturation for grey, so the picker can preserve the hue', () => {
        expect(hexToHsb('#808080')?.s).toBe(0);
    });

    it('returns null for a non hex value', () => {
        expect(hexToHsb('red')).toBeNull();
    });
});
