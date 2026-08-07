import { describe, expect, it } from 'vitest';
import type { Dayjs } from 'dayjs';
import { getLocalizedDayJs } from '../utils/time';
import { layoutDayEvents, type LayoutableEvent } from './eventLayout';

interface TestEvent extends LayoutableEvent {
    id: string;
}

const SLOT_MINUTES = 15;
const SLOT_HEIGHT = 25;

/** Mirrors the real grid: 15 minute slots that are 25px tall. */
function minutesToPixels(minutes: number): number {
    return (minutes / SLOT_MINUTES) * SLOT_HEIGHT;
}

function timeToMinutesFromMidnight(time: Dayjs): number {
    return time.hour() * 60 + time.minute() + time.second() / 60;
}

function event(id: string, start: string, end: string): TestEvent {
    return { id, dayStart: getLocalizedDayJs(start), dayEnd: getLocalizedDayJs(end) };
}

function layout(events: TestEvent[], visibleStartMin = 0, visibleEndMin = 24 * 60) {
    const day = getLocalizedDayJs('2026-08-04T00:00:00Z');
    return layoutDayEvents(
        events,
        day.startOf('day'),
        day.endOf('day'),
        visibleStartMin,
        visibleEndMin,
        timeToMinutesFromMidnight,
        minutesToPixels
    );
}

describe('layoutDayEvents', () => {
    it('positions a single event by its start and duration', () => {
        const result = layout([event('a', '2026-08-04T10:00:00Z', '2026-08-04T11:00:00Z')]);

        expect(result).toHaveLength(1);
        expect(result[0]!.top).toBe(minutesToPixels(10 * 60));
        expect(result[0]!.height).toBe(minutesToPixels(60));
        expect(result[0]!.left).toBe('0%');
        expect(result[0]!.width).toBe('100%');
        expect(result[0]!.isClippedStart).toBe(false);
        expect(result[0]!.isClippedEnd).toBe(false);
    });

    it('gives overlapping events their own column', () => {
        const result = layout([
            event('a', '2026-08-04T10:00:00Z', '2026-08-04T11:00:00Z'),
            event('b', '2026-08-04T10:30:00Z', '2026-08-04T11:30:00Z'),
        ]);

        expect(result).toHaveLength(2);
        expect(result.map((r) => r.width)).toEqual(['50%', '50%']);
        expect(new Set(result.map((r) => r.left))).toEqual(new Set(['0%', '50%']));
    });

    it('reuses a column for events that do not overlap', () => {
        const result = layout([
            event('a', '2026-08-04T10:00:00Z', '2026-08-04T11:00:00Z'),
            event('b', '2026-08-04T11:00:00Z', '2026-08-04T12:00:00Z'),
        ]);

        expect(result.map((r) => r.left)).toEqual(['0%', '0%']);
        expect(result.map((r) => r.width)).toEqual(['100%', '100%']);
    });

    it('shares the column count across a transitively overlapping group', () => {
        const result = layout([
            event('a', '2026-08-04T10:00:00Z', '2026-08-04T12:00:00Z'),
            event('b', '2026-08-04T11:00:00Z', '2026-08-04T13:00:00Z'),
            event('c', '2026-08-04T12:30:00Z', '2026-08-04T14:00:00Z'),
        ]);

        // b overlaps both a and c, so all three end up in one group and get the same
        // width - c reuses a's column because it starts after a ends
        expect(result).toHaveLength(3);
        expect(result.every((r) => r.width === '50%')).toBe(true);
        expect(result.map((r) => r.left)).toEqual(['0%', '50%', '0%']);
    });

    it('puts three genuinely simultaneous events in three columns', () => {
        const result = layout([
            event('a', '2026-08-04T10:00:00Z', '2026-08-04T11:00:00Z'),
            event('b', '2026-08-04T10:15:00Z', '2026-08-04T11:15:00Z'),
            event('c', '2026-08-04T10:30:00Z', '2026-08-04T11:30:00Z'),
        ]);

        expect(result.every((r) => r.width === `${(1 / 3) * 100}%`)).toBe(true);
        expect(new Set(result.map((r) => r.left))).toEqual(
            new Set(['0%', `${(1 / 3) * 100}%`, `${(2 / 3) * 100}%`])
        );
    });

    it('clips an event that started on the previous day', () => {
        const result = layout([event('a', '2026-08-03T22:00:00Z', '2026-08-04T02:00:00Z')]);

        expect(result).toHaveLength(1);
        expect(result[0]!.isClippedStart).toBe(true);
        expect(result[0]!.isClippedEnd).toBe(false);
        expect(result[0]!.top).toBe(0);
        expect(result[0]!.height).toBe(minutesToPixels(2 * 60));
    });

    it('clips an event that runs into the next day', () => {
        const result = layout([event('a', '2026-08-04T22:00:00Z', '2026-08-05T02:00:00Z')]);

        expect(result).toHaveLength(1);
        expect(result[0]!.isClippedStart).toBe(false);
        expect(result[0]!.isClippedEnd).toBe(true);
        expect(result[0]!.top).toBe(minutesToPixels(22 * 60));
        expect(result[0]!.height).toBe(minutesToPixels(2 * 60));
    });

    it('clips events to the visible hour range', () => {
        const result = layout(
            [event('a', '2026-08-04T06:00:00Z', '2026-08-04T12:00:00Z')],
            8 * 60,
            18 * 60
        );

        expect(result[0]!.top).toBe(0);
        expect(result[0]!.height).toBe(minutesToPixels(4 * 60));
    });

    it('keeps a zero length event visible with a minimum height', () => {
        const result = layout([event('a', '2026-08-04T10:00:00Z', '2026-08-04T10:00:00Z')]);

        expect(result[0]!.height).toBeGreaterThan(0);
    });

    it('returns nothing for an empty day', () => {
        expect(layout([])).toEqual([]);
    });
});
