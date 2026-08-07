import { computed, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dayjs } from 'dayjs';
import { useSlotSelection } from './useSlotSelection';
import { getDayJsInstance } from '../utils/time';
import {
    TEST_DAY,
    dispatchPointer,
    pixelsToMinutesFromMidnight,
    pointerDownEvent,
    pressKey,
    testCalendarSettings,
    testViewDays,
    totalGridPixels,
    withSetup,
} from './testUtils';

describe('useSlotSelection escape-to-cancel', () => {
    const onSelectionComplete = vi.fn();
    let teardown: (() => void) | null = null;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        teardown?.();
        teardown = null;
    });

    function selection() {
        const { result, unmount } = withSetup(() =>
            useSlotSelection({
                calendarSettings: ref({ ...testCalendarSettings }),
                viewDays: computed(testViewDays),
                totalGridHeight: computed(() => totalGridPixels),
                pixelsToMinutesFromMidnight,
                getDayFromClientX: () => TEST_DAY,
                clientYToGridPixels: (clientY: number) => clientY,
                onSelectionComplete,
            })
        );
        teardown = unmount;
        return result;
    }

    /** Drag from 10:00 (1000px) down to 11:00 (1100px) without releasing. */
    function startDrag(s: ReturnType<typeof selection>) {
        s.onSlotPointerDown(pointerDownEvent(10, 1000));
        dispatchPointer('pointermove', 10, 1100);
    }

    it('creates the entry on pointer-up when escape is not pressed', () => {
        const s = selection();
        startDrag(s);

        dispatchPointer('pointerup', 10, 1100);

        expect(onSelectionComplete).toHaveBeenCalledTimes(1);
    });

    it('does not open the create modal when escape is pressed mid-drag', () => {
        const s = selection();
        startDrag(s);
        expect(s.isSelecting.value).toBe(true);

        pressKey('Escape');

        expect(onSelectionComplete).not.toHaveBeenCalled();
        expect(s.isSelecting.value).toBe(false);
        expect(s.selectionDay.value).toBeNull();
        expect(s.selectionEndDay.value).toBeNull();
        expect(s.selectionHeight.value).toBe(0);
    });

    it('stays cancelled — releasing the button after escape creates nothing', () => {
        const s = selection();
        startDrag(s);

        pressKey('Escape');
        dispatchPointer('pointermove', 10, 1400);
        dispatchPointer('pointerup', 10, 1400);

        expect(onSelectionComplete).not.toHaveBeenCalled();
        expect(s.isSelecting.value).toBe(false);
    });

    it('starts a fresh selection on the next pointer-down after a cancel', () => {
        const s = selection();
        startDrag(s);
        pressKey('Escape');

        s.onSlotPointerDown(pointerDownEvent(10, 500));
        dispatchPointer('pointermove', 10, 600);

        expect(s.isSelecting.value).toBe(true);
        expect(s.selectionDay.value).toBe(TEST_DAY);

        dispatchPointer('pointerup', 10, 600);
        expect(onSelectionComplete).toHaveBeenCalledTimes(1);
    });

    it('ignores keys other than escape', () => {
        const s = selection();
        startDrag(s);

        pressKey('a');

        expect(s.isSelecting.value).toBe(true);
    });
});

/**
 * The ghost shows the range and duration while you drag, so those values are read off the
 * pixel state mid-drag. They must agree with what pointer-up eventually commits.
 *
 * At the default zoom (100px/hour) 1000px is 10:00 and one 15-minute snap is 25px.
 */
describe('useSlotSelection live duration', () => {
    const NEXT_DAY = '2026-07-15';
    const onSelectionComplete = vi.fn<(start: Dayjs, end: Dayjs) => void>();
    let teardown: (() => void) | null = null;

    /** Anything left of 100px is the first day, anything right of it the second. */
    const DAY_BOUNDARY_X = 100;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        teardown?.();
        teardown = null;
    });

    function selection(days: string[] = [TEST_DAY]) {
        const { result, unmount } = withSetup(() =>
            useSlotSelection({
                calendarSettings: ref({ ...testCalendarSettings }),
                viewDays: computed(() => days.map((d) => getDayJsInstance()(d))),
                totalGridHeight: computed(() => totalGridPixels),
                pixelsToMinutesFromMidnight,
                getDayFromClientX: (clientX: number) =>
                    clientX < DAY_BOUNDARY_X ? days[0]! : days[days.length - 1]!,
                clientYToGridPixels: (clientY: number) => clientY,
                onSelectionComplete,
            })
        );
        teardown = unmount;
        return result;
    }

    /** Local wall clock of the live selection, e.g. `['10:00', '11:00']`. */
    function liveRange(s: ReturnType<typeof selection>) {
        const times = s.selectionTimes.value;
        return times ? [times.start.format('HH:mm'), times.end.format('HH:mm')] : null;
    }

    it('exposes nothing before a drag starts', () => {
        const s = selection();

        expect(s.selectionTimes.value).toBeNull();
        expect(s.selectionDurationSeconds.value).toBeNull();
    });

    it('reports the duration of a downward same-day drag', () => {
        const s = selection();
        s.onSlotPointerDown(pointerDownEvent(10, 1000));
        dispatchPointer('pointermove', 10, 1100);

        expect(liveRange(s)).toEqual(['10:00', '11:00']);
        expect(s.selectionDurationSeconds.value).toBe(3600);
    });

    it('updates as the pointer keeps moving', () => {
        const s = selection();
        s.onSlotPointerDown(pointerDownEvent(10, 1000));

        dispatchPointer('pointermove', 10, 1100);
        expect(s.selectionDurationSeconds.value).toBe(3600);

        dispatchPointer('pointermove', 10, 1250);
        expect(liveRange(s)).toEqual(['10:00', '12:30']);
        expect(s.selectionDurationSeconds.value).toBe(9000);
    });

    it('reports the snapped duration rather than the raw cursor position', () => {
        const s = selection();
        s.onSlotPointerDown(pointerDownEvent(10, 1000));
        // 1105px is 11:03, which snaps up to the next 15-minute boundary.
        dispatchPointer('pointermove', 10, 1105);

        expect(liveRange(s)).toEqual(['10:00', '11:15']);
        expect(s.selectionDurationSeconds.value).toBe(75 * 60);
    });

    it('reports the duration of an upward drag', () => {
        const s = selection();
        s.onSlotPointerDown(pointerDownEvent(10, 1000));
        dispatchPointer('pointermove', 10, 900);

        expect(liveRange(s)).toEqual(['09:00', '10:15']);
        expect(s.selectionDurationSeconds.value).toBe(75 * 60);
    });

    it('spans both days on a left-to-right cross-day drag', () => {
        const s = selection([TEST_DAY, NEXT_DAY]);
        s.onSlotPointerDown(pointerDownEvent(10, 1000));
        dispatchPointer('pointermove', 200, 500);

        expect(liveRange(s)).toEqual(['10:00', '05:00']);
        // 10:00 on the first day through 05:00 on the second.
        expect(s.selectionDurationSeconds.value).toBe(19 * 3600);
    });

    it('spans both days on a right-to-left cross-day drag', () => {
        const s = selection([TEST_DAY, NEXT_DAY]);
        s.onSlotPointerDown(pointerDownEvent(200, 1000));
        dispatchPointer('pointermove', 10, 500);

        // The days are normalized, so the live value never reads as negative.
        expect(liveRange(s)).toEqual(['05:00', '10:00']);
        expect(s.selectionDurationSeconds.value).toBe(29 * 3600);
    });

    it('matches the times the selection commits on pointer-up', () => {
        const s = selection();
        s.onSlotPointerDown(pointerDownEvent(10, 1000));
        dispatchPointer('pointermove', 10, 1175);

        const live = s.selectionDurationSeconds.value;
        dispatchPointer('pointerup', 10, 1175);

        expect(onSelectionComplete).toHaveBeenCalledTimes(1);
        const [start, end] = onSelectionComplete.mock.calls[0]!;
        expect(end.diff(start, 'second')).toBe(live);
    });

    it('keeps reporting while the create modal is open, and stops once it closes', () => {
        const s = selection();
        s.onSlotPointerDown(pointerDownEvent(10, 1000));
        dispatchPointer('pointermove', 10, 1100);
        dispatchPointer('pointerup', 10, 1100);

        // The ghost persists behind the create modal, so the labels must too.
        expect(s.selectionDurationSeconds.value).toBe(3600);

        s.clearSelection();

        expect(s.selectionTimes.value).toBeNull();
        expect(s.selectionDurationSeconds.value).toBeNull();
    });

    it('reports nothing after an escape cancel', () => {
        const s = selection();
        s.onSlotPointerDown(pointerDownEvent(10, 1000));
        dispatchPointer('pointermove', 10, 1100);

        pressKey('Escape');

        expect(s.selectionTimes.value).toBeNull();
        expect(s.selectionDurationSeconds.value).toBeNull();
    });
});
