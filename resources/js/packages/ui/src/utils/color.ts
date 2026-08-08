import Prando from '@/packages/ui/src/utils/random';
import chroma from 'chroma-js';

export const colors = [
    '#ef5350',
    '#ec407a',
    '#ab47bc',
    '#7e57c2',
    '#5c6bc0',
    '#42a5f5',
    '#29b6f6',
    '#26c6da',
    '#26a69a',
    '#66bb6a',
    '#9ccc65',
    '#d4e157',
    '#ffee58',
    '#ffca28',
    '#ffa726',
    '#ff7043',
    '#8d6e63',
    '#bdbdbd',
    '#78909c',
];

export function getRandomColor() {
    return colors[Math.floor(Math.random() * colors.length)]!;
}

export function getRandomColorWithSeed(seed: string) {
    const pseudoRandom = new Prando(seed);
    const index = pseudoRandom.nextInt(0, colors.length - 1);
    return colors[index]!;
}

/**
 * Colors are stored as `#rrggbb`, or `#rrggbbaa` when they carry an alpha channel.
 *
 * The alpha channel is only honoured in the calendar, where a block is composited onto the
 * live theme background (see `flattenColor` and `FullCalendar/useCalendarEvents.ts`). Every
 * other surface renders the color opaque via `opaqueColor`, so a faint project still reads as
 * a solid dot in lists, dropdowns and charts.
 *
 * Staying six digits while fully opaque keeps existing rows byte identical and keeps
 * `ColorService::isBuiltInColor()` — a literal comparison against `colors` — working.
 */

/** Lowercase `#rrggbb` plus the alpha as a 0..1 fraction. */
export type ParsedColor = {
    hex: string;
    alpha: number;
};

export type HsbColor = {
    space: 'hsb';
    h: number;
    s: number;
    b: number;
    alpha: number;
};

// Deliberately stricter than chroma, which also accepts 'red', 'rgb(…)' and friends. Parsing
// has to mirror what the backend stores so that a round trip never silently changes a value.
const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
}

function duplicateDigits(digits: string): string {
    return digits
        .split('')
        .map((digit) => digit + digit)
        .join('');
}

/**
 * Parse a hex color. Accepts `#rgb`, `#rgba`, `#rrggbb` and `#rrggbbaa`, with or without the
 * leading hash and in any case. Returns null rather than throwing, so callers stay one-liners.
 */
export function parseHexColor(value: string): ParsedColor | null {
    if (typeof value !== 'string') return null;

    const match = HEX_PATTERN.exec(value.trim());
    if (match === null) return null;

    const digits = match[1]!.toLowerCase();
    let rgb: string;
    let alpha: string;

    if (digits.length === 3) {
        rgb = duplicateDigits(digits);
        alpha = 'ff';
    } else if (digits.length === 4) {
        rgb = duplicateDigits(digits.slice(0, 3));
        alpha = duplicateDigits(digits.slice(3));
    } else if (digits.length === 6) {
        rgb = digits;
        alpha = 'ff';
    } else {
        rgb = digits.slice(0, 6);
        alpha = digits.slice(6);
    }

    return { hex: `#${rgb}`, alpha: parseInt(alpha, 16) / 255 };
}

/** Canonical form: six digits when fully opaque, eight otherwise. */
export function formatHexColor(hex: string, alpha: number): string {
    const parsed = parseHexColor(hex);
    const base = parsed !== null ? parsed.hex : '#000000';
    const clamped = clamp(alpha, 0, 1);

    if (clamped >= 1) return base;

    return `${base}${Math.round(clamped * 255)
        .toString(16)
        .padStart(2, '0')}`;
}

/** Canonicalise any accepted hex spelling, or null if it is not a hex color at all. */
export function normalizeHexColor(value: string): string | null {
    const parsed = parseHexColor(value);

    return parsed === null ? null : formatHexColor(parsed.hex, parsed.alpha);
}

/**
 * Drop the alpha channel. Values that are not hex — a `var(--…)` fallback, say — are returned
 * untouched, so this is safe to wrap around any color binding.
 */
export function opaqueColor(value: string): string {
    const parsed = parseHexColor(value);

    return parsed === null ? value : parsed.hex;
}

/** Replace the alpha channel with an absolute value. Never appends to an existing one. */
export function withAlpha(value: string, alpha: number): string {
    const parsed = parseHexColor(value);

    return parsed === null ? value : formatHexColor(parsed.hex, alpha);
}

/**
 * Composite a possibly translucent color onto an opaque background, returning an opaque
 * `#rrggbb`. Mixing in rgb space at ratio = alpha is exactly source-over compositing.
 *
 * The background may be any CSS color chroma understands, including the `oklch(…)` values the
 * dark theme uses, which is why this goes through chroma rather than the hex parser.
 */
export function flattenColor(value: string, background: string): string {
    const parsed = parseHexColor(value);
    if (parsed === null) return value;
    if (parsed.alpha >= 1) return parsed.hex;
    if (!background || !chroma.valid(background)) return parsed.hex;

    return chroma.mix(background, parsed.hex, parsed.alpha, 'rgb').hex('rgb');
}

/**
 * Hue 0..360, saturation and brightness 0..100, alpha 0..1 — the shape reka-ui's color
 * primitives use, so the picker can hold state as a Color object and never round trip through
 * hex while the user drags.
 */
export function hexToHsb(value: string): HsbColor | null {
    const parsed = parseHexColor(value);
    if (parsed === null) return null;

    const r = parseInt(parsed.hex.slice(1, 3), 16) / 255;
    const g = parseInt(parsed.hex.slice(3, 5), 16) / 255;
    const b = parseInt(parsed.hex.slice(5, 7), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    let h = 0;
    if (delta !== 0) {
        if (max === r) {
            h = ((g - b) / delta) % 6;
        } else if (max === g) {
            h = (b - r) / delta + 2;
        } else {
            h = (r - g) / delta + 4;
        }
        h *= 60;
        if (h < 0) h += 360;
    }

    return {
        space: 'hsb',
        h,
        s: max === 0 ? 0 : (delta / max) * 100,
        b: max * 100,
        alpha: parsed.alpha,
    };
}

export function hsbToHex(color: { h: number; s: number; b: number; alpha?: number }): string {
    const h = ((color.h % 360) + 360) % 360;
    const s = clamp(color.s, 0, 100) / 100;
    const v = clamp(color.b, 0, 100) / 100;

    const chromaValue = v * s;
    const x = chromaValue * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - chromaValue;

    let rgb: [number, number, number];
    if (h < 60) rgb = [chromaValue, x, 0];
    else if (h < 120) rgb = [x, chromaValue, 0];
    else if (h < 180) rgb = [0, chromaValue, x];
    else if (h < 240) rgb = [0, x, chromaValue];
    else if (h < 300) rgb = [x, 0, chromaValue];
    else rgb = [chromaValue, 0, x];

    const hex = `#${rgb
        .map((channel) =>
            Math.round((channel + m) * 255)
                .toString(16)
                .padStart(2, '0')
        )
        .join('')}`;

    return formatHexColor(hex, color.alpha ?? 1);
}
