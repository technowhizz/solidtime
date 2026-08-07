import { computed, ref } from 'vue';
import { describe, expect, it } from 'vitest';
import type { Dayjs } from 'dayjs';
import { getLocalizedDayJs } from '../utils/time';
import type { CalendarSettings } from './calendarSettings';
import { DEFAULT_PIXELS_PER_HOUR } from './calendarSettings';
import type { ExternalCalendarEvent } from './externalCalendarTypes';
import { useExternalEventBoxes } from './useExternalEventBoxes';

const SLOT_MINUTES = 15;
const SLOT_HEIGHT = 25;

function minutesToPixels(minutes: number): number {
    return (minutes / SLOT_MINUTES) * SLOT_HEIGHT;
}

function timeToMinutesFromMidnight(time: Dayjs): number {
    return time.hour() * 60 + time.minute() + time.second() / 60;
}

function externalEvent(
    id: string,
    start: string,
    end: string,
    isAllDay = false
): ExternalCalendarEvent {
    return { id, title: `Event ${id}`, start, end, isAllDay };
}

function boxes(
    events: ExternalCalendarEvent[],
    settings: Partial<CalendarSettings> = {},
    days = ['2026-08-04']
) {
    const calendarSettings = ref<CalendarSettings>({
        snapMinutes: 15,
        startHour: 0,
        endHour: 24,
        slotMinutes: SLOT_MINUTES,
        pixelsPerHour: DEFAULT_PIXELS_PER_HOUR,
        ...settings,
    });
    const viewDays = computed<Dayjs[]>(() =>
        days.map((day) => getLocalizedDayJs(`${day}T00:00:00Z`))
    );

    return useExternalEventBoxes({
        externalEvents: () => events,
        viewDays,
        calendarSettings,
        minutesToPixels,
        timeToMinutesFromMidnight,
    });
}

describe('useExternalEventBoxes', () => {
    it('returns no boxes without events', () => {
        const { externalEventBoxes, dayHasExternalEvents } = boxes([]);

        expect(externalEventBoxes.value).toEqual([]);
        expect(dayHasExternalEvents('2026-08-04')).toBe(false);
    });

    it('positions a timed event on its day', () => {
        const { externalEventBoxes, externalEventBoxesForDay, dayHasExternalEvents } = boxes([
            externalEvent('a', '2026-08-04T09:00:00Z', '2026-08-04T10:00:00Z'),
        ]);

        expect(externalEventBoxes.value).toHaveLength(1);
        expect(externalEventBoxesForDay('2026-08-04')).toHaveLength(1);
        expect(dayHasExternalEvents('2026-08-04')).toBe(true);

        const box = externalEventBoxes.value[0]!;
        expect(box.dateStr).toBe('2026-08-04');
        expect(box.top).toBe(minutesToPixels(9 * 60));
        expect(box.height).toBe(minutesToPixels(60));
        expect(box.event.id).toBe('a');
    });

    it('drops all-day events, they have no position on a time grid', () => {
        const { externalEventBoxes } = boxes([
            externalEvent('all-day', '2026-08-04T00:00:00Z', '2026-08-05T00:00:00Z', true),
            externalEvent('timed', '2026-08-04T09:00:00Z', '2026-08-04T10:00:00Z'),
        ]);

        expect(externalEventBoxes.value.map((box) => box.event.id)).toEqual(['timed']);
    });

    it('clips an event to the visible hour range', () => {
        const { externalEventBoxes } = boxes(
            [externalEvent('a', '2026-08-04T06:00:00Z', '2026-08-04T12:00:00Z')],
            { startHour: 8, endHour: 18 }
        );

        const box = externalEventBoxes.value[0]!;
        expect(box.top).toBe(0);
        expect(box.height).toBe(minutesToPixels(4 * 60));
    });

    it('skips events entirely outside the visible hour range', () => {
        const { externalEventBoxes } = boxes(
            [externalEvent('a', '2026-08-04T01:00:00Z', '2026-08-04T02:00:00Z')],
            { startHour: 8, endHour: 18 }
        );

        // The event is clamped to a sliver at the range edge rather than being drawn in the middle
        expect(externalEventBoxes.value[0]!.top).toBe(0);
        expect(externalEventBoxes.value[0]!.height).toBeLessThanOrEqual(minutesToPixels(1));
    });

    it('splits an event that spans two days into a box per day', () => {
        const { externalEventBoxesForDay } = boxes(
            [externalEvent('a', '2026-08-04T22:00:00Z', '2026-08-05T02:00:00Z')],
            {},
            ['2026-08-04', '2026-08-05']
        );

        const firstDay = externalEventBoxesForDay('2026-08-04');
        const secondDay = externalEventBoxesForDay('2026-08-05');

        expect(firstDay).toHaveLength(1);
        expect(secondDay).toHaveLength(1);
        expect(firstDay[0]!.top).toBe(minutesToPixels(22 * 60));
        expect(secondDay[0]!.top).toBe(0);
        expect(secondDay[0]!.height).toBe(minutesToPixels(2 * 60));
    });

    it('lays overlapping events out side by side within the lane', () => {
        const { externalEventBoxes } = boxes([
            externalEvent('a', '2026-08-04T09:00:00Z', '2026-08-04T10:00:00Z'),
            externalEvent('b', '2026-08-04T09:30:00Z', '2026-08-04T10:30:00Z'),
        ]);

        expect(externalEventBoxes.value.map((box) => box.width)).toEqual(['50%', '50%']);
        expect(new Set(externalEventBoxes.value.map((box) => box.left))).toEqual(
            new Set(['0%', '50%'])
        );
    });

    it('only reports days that actually have events', () => {
        const { dayHasExternalEvents } = boxes(
            [externalEvent('a', '2026-08-04T09:00:00Z', '2026-08-04T10:00:00Z')],
            {},
            ['2026-08-04', '2026-08-05']
        );

        expect(dayHasExternalEvents('2026-08-04')).toBe(true);
        expect(dayHasExternalEvents('2026-08-05')).toBe(false);
    });
});
