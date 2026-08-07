import { nextTick } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dayjs } from 'dayjs';
import { useCalendarNavigation } from './useCalendarNavigation';
import { getLocalizedDayJsFromMinutes } from '../utils/time';

// A Wednesday, so "today" sits inside a Mon-Fri window but the current date is not
// itself the start of the week.
const WEDNESDAY = '2026-08-05';

function setWeekDays(days: number) {
    window.getCalendarWeekDaysSetting = vi.fn(() => days);
}

function setWeekStart(day: string) {
    window.getWeekStartSetting = vi.fn(() => day);
}

/** Parses a bare date as local midnight, the way the calendar handles ?date= links. */
function localDate(date: string): Dayjs {
    return getLocalizedDayJsFromMinutes(date, 0);
}

function navigation(initialDate?: string) {
    const onDatesChange = vi.fn();
    const nav = useCalendarNavigation({
        onDatesChange,
        scrollToCurrentTime: () => {},
        initialDate: initialDate ? localDate(initialDate) : null,
    });
    return { ...nav, onDatesChange };
}

function labels(days: Dayjs[]): string[] {
    return days.map((day) => day.format('ddd'));
}

describe('useCalendarNavigation day count', () => {
    beforeEach(() => {
        setWeekStart('monday');
        setWeekDays(7);
    });

    it('renders a full week by default', () => {
        const { viewDays } = navigation(WEDNESDAY);

        expect(labels(viewDays.value)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    });

    it('renders only the configured number of days', () => {
        setWeekDays(5);
        const { viewDays } = navigation(WEDNESDAY);

        expect(labels(viewDays.value)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    });

    it('anchors the shortened window at the configured week start', () => {
        setWeekStart('sunday');
        setWeekDays(3);
        // Monday, which a Sunday-anchored 3-day window still shows.
        const { viewDays } = navigation('2026-08-03');

        expect(labels(viewDays.value)).toEqual(['Sun', 'Mon', 'Tue']);
    });

    it('falls back to a full week when the setting is out of range', () => {
        setWeekDays(9);
        const { viewDays } = navigation(WEDNESDAY);

        expect(viewDays.value).toHaveLength(7);
    });

    it('still shows a single day in the day view', () => {
        setWeekDays(5);
        const { viewDays, handleChangeView } = navigation(WEDNESDAY);
        handleChangeView('timeGridDay');

        expect(labels(viewDays.value)).toEqual(['Wed']);
    });
});

describe('useCalendarNavigation stride', () => {
    beforeEach(() => {
        setWeekStart('monday');
        setWeekDays(5);
    });

    it('moves a full week, keeping the same weekdays visible', () => {
        const { viewDays, handleNext } = navigation(WEDNESDAY);
        const firstBefore = viewDays.value[0]!;

        handleNext();

        expect(labels(viewDays.value)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
        expect(viewDays.value[0]!.diff(firstBefore, 'day')).toBe(7);
    });

    it('returns to the original window after next then prev', () => {
        const { viewDays, handleNext, handlePrev } = navigation(WEDNESDAY);
        const before = viewDays.value[0]!.format('YYYY-MM-DD');

        handleNext();
        handlePrev();

        expect(viewDays.value[0]!.format('YYYY-MM-DD')).toBe(before);
    });
});

describe('useCalendarNavigation deep links', () => {
    beforeEach(() => {
        setWeekStart('monday');
    });

    it('keeps the week view when the linked day is visible', () => {
        setWeekDays(5);
        const { activeView, viewDays } = navigation('2026-08-07'); // Friday

        expect(activeView.value).toBe('timeGridWeek');
        expect(viewDays.value).toHaveLength(5);
    });

    it('opens the day view when the linked day is hidden by the day count', () => {
        setWeekDays(5);
        const { activeView, viewDays } = navigation('2026-08-08'); // Saturday

        expect(activeView.value).toBe('timeGridDay');
        expect(labels(viewDays.value)).toEqual(['Sat']);
        expect(viewDays.value[0]!.format('YYYY-MM-DD')).toBe('2026-08-08');
    });

    it('keeps the week view for a Saturday when all seven days are shown', () => {
        setWeekDays(7);
        const { activeView } = navigation('2026-08-08');

        expect(activeView.value).toBe('timeGridWeek');
    });
});

describe('useCalendarNavigation emitted range', () => {
    beforeEach(() => {
        setWeekStart('monday');
    });

    it('emits a range that ends the day after the last visible column', () => {
        setWeekDays(5);
        const { emitDatesChange, onDatesChange } = navigation(WEDNESDAY);

        emitDatesChange();

        const { start, end } = onDatesChange.mock.calls[0]![0];
        expect(start.format('YYYY-MM-DD')).toBe('2026-08-03'); // Monday
        expect(end.format('YYYY-MM-DD')).toBe('2026-08-08'); // day after Friday
    });

    it('re-emits when the rendered window changes without a navigation click', async () => {
        setWeekDays(7);
        const { handleChangeView, onDatesChange } = navigation(WEDNESDAY);
        onDatesChange.mockClear();

        // Switching the view resizes viewDays; the fetched range must follow it,
        // otherwise the loaded entries stop matching the visible columns.
        handleChangeView('timeGridDay');
        await nextTick();

        const last = onDatesChange.mock.calls.at(-1)![0];
        expect(last.end.diff(last.start, 'day')).toBe(1);
    });
});
