import { describe, expect, it } from 'vitest';
import {
    DEFAULT_PIXELS_PER_HOUR,
    MAX_PIXELS_PER_HOUR,
    MIN_PIXELS_PER_HOUR,
    minutesToPixelsFor,
    pixelsPerHourFor,
    pixelsToMinutesFor,
    slotHeightFor,
    type CalendarSettings,
} from './calendarSettings';

function settings(overrides: Partial<CalendarSettings> = {}): CalendarSettings {
    return {
        snapMinutes: 15,
        startHour: 0,
        endHour: 24,
        slotMinutes: 15,
        pixelsPerHour: DEFAULT_PIXELS_PER_HOUR,
        ...overrides,
    };
}

describe('pixelsPerHourFor', () => {
    it('clamps to the supported zoom range', () => {
        expect(pixelsPerHourFor(settings({ pixelsPerHour: 5000 }))).toBe(MAX_PIXELS_PER_HOUR);
        expect(pixelsPerHourFor(settings({ pixelsPerHour: 1 }))).toBe(MIN_PIXELS_PER_HOUR);
    });

    it('falls back to the default for missing or corrupt values', () => {
        for (const value of [0, -50, NaN, undefined as unknown as number]) {
            expect(pixelsPerHourFor(settings({ pixelsPerHour: value }))).toBe(
                DEFAULT_PIXELS_PER_HOUR
            );
        }
    });
});

describe('slotHeightFor', () => {
    it('matches the historic 25px height for a 15-minute slot at default zoom', () => {
        expect(slotHeightFor(settings())).toBe(25);
    });

    it('scales with the grid scale, leaving the zoom level untouched', () => {
        expect(slotHeightFor(settings({ slotMinutes: 30 }))).toBe(50);
        expect(slotHeightFor(settings({ slotMinutes: 60 }))).toBe(100);
    });

    it('scales with the zoom level', () => {
        expect(slotHeightFor(settings({ pixelsPerHour: 50 }))).toBe(12.5);
    });
});

describe('minute/pixel conversion', () => {
    it('round-trips', () => {
        const s = settings({ pixelsPerHour: 137 });
        expect(pixelsToMinutesFor(s, minutesToPixelsFor(s, 93))).toBeCloseTo(93, 6);
    });

    it('is independent of the grid scale', () => {
        const fine = settings({ slotMinutes: 5 });
        const coarse = settings({ slotMinutes: 60 });
        expect(minutesToPixelsFor(fine, 60)).toBe(minutesToPixelsFor(coarse, 60));
    });
});
