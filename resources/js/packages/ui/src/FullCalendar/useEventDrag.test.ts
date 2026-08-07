import { computed, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import type { TimeEntry } from '@/packages/api/src';
import { useEventDrag } from './useEventDrag';
import type { CalendarEvent, DayEvent } from './calendarTypes';
import { getLocalizedDayJs } from '../utils/time';
import {
    TEST_DAY,
    dispatchPointer,
    minutesToPixels,
    pixelsToMinutesFromMidnight,
    pointerDownEvent,
    pressKey,
    testCalendarSettings,
    testViewDays,
    withSetup,
} from './testUtils';

function calendarEvent(): CalendarEvent {
    const timeEntry = {
        id: 'te-1',
        start: `${TEST_DAY}T10:00:00Z`,
        end: `${TEST_DAY}T11:00:00Z`,
        duration: 3600,
        description: 'Work',
        project_id: null,
        task_id: null,
        organization_id: 'org-1',
        user_id: 'user-1',
        tags: [],
        billable: false,
        type: 'work',
    } as unknown as TimeEntry;

    return {
        id: timeEntry.id,
        timeEntry,
        isRunning: false,
        isBreak: false,
        isMisplacedBreak: false,
        durationMinutes: 60,
        title: 'Work',
        backgroundColor: '#fff',
        borderColor: '#000',
        dayStart: getLocalizedDayJs(timeEntry.start),
        dayEnd: getLocalizedDayJs(timeEntry.end),
    } as CalendarEvent;
}

function dayEvent(event: CalendarEvent): DayEvent {
    return {
        event,
        top: minutesToPixels(10 * 60),
        height: minutesToPixels(60),
        left: '0',
        width: '100%',
        isClippedStart: false,
        isClippedEnd: false,
    };
}

describe('useEventDrag escape-to-cancel', () => {
    const updateTimeEntry = vi.fn().mockResolvedValue(undefined);
    const onClickEvent = vi.fn();
    const emitRefresh = vi.fn();
    let teardown: (() => void) | null = null;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        teardown?.();
        teardown = null;
    });

    function drag() {
        const { result, unmount } = withSetup(() =>
            useEventDrag({
                calendarSettings: ref({ ...testCalendarSettings }),
                viewDays: computed(testViewDays),
                optimisticOverrides: ref(new Map<string, TimeEntry>()),
                updateTimeEntry,
                emitRefresh,
                minutesToPixels,
                pixelsToMinutesFromMidnight,
                getDayFromClientX: () => TEST_DAY,
                clientYToGridPixels: (clientY: number) => clientY,
                onClickEvent,
            })
        );
        teardown = unmount;

        const event = calendarEvent();
        return {
            ...result,
            press: (clientY: number) =>
                result.onEventPointerDown(pointerDownEvent(10, clientY), event, dayEvent(event)),
        };
    }

    it('saves the move on pointer-up when escape is not pressed', async () => {
        const d = drag();
        d.press(1000);
        dispatchPointer('pointermove', 10, 1200);
        dispatchPointer('pointerup', 10, 1200);
        await flushPromises();

        expect(updateTimeEntry).toHaveBeenCalledTimes(1);
    });

    it('discards the move when escape is pressed mid-drag', async () => {
        const d = drag();
        d.press(1000);
        dispatchPointer('pointermove', 10, 1200);
        expect(d.isDragging.value).toBe(true);

        pressKey('Escape');

        expect(d.isDragging.value).toBe(false);
        expect(d.dragEventId.value).toBeNull();
        expect(d.dragCurrentDay.value).toBeNull();
        expect(updateTimeEntry).not.toHaveBeenCalled();
    });

    it('stays cancelled — releasing the button after escape saves nothing', async () => {
        const d = drag();
        d.press(1000);
        dispatchPointer('pointermove', 10, 1200);

        pressKey('Escape');
        dispatchPointer('pointermove', 10, 1400);
        dispatchPointer('pointerup', 10, 1400);
        await flushPromises();

        expect(updateTimeEntry).not.toHaveBeenCalled();
        expect(onClickEvent).not.toHaveBeenCalled();
    });

    it('suppresses click-to-edit when escape is pressed before the drag threshold', async () => {
        const d = drag();
        d.press(1000);
        dispatchPointer('pointermove', 10, 1002); // below DRAG_THRESHOLD

        pressKey('Escape');
        dispatchPointer('pointerup', 10, 1002);
        await flushPromises();

        expect(onClickEvent).not.toHaveBeenCalled();
        expect(updateTimeEntry).not.toHaveBeenCalled();
    });

    it('still opens the edit modal for a plain click without escape', async () => {
        const d = drag();
        d.press(1000);
        dispatchPointer('pointerup', 10, 1000);
        await flushPromises();

        expect(onClickEvent).toHaveBeenCalledTimes(1);
    });

    it('ignores keys other than escape', () => {
        const d = drag();
        d.press(1000);
        dispatchPointer('pointermove', 10, 1200);

        pressKey('a');

        expect(d.isDragging.value).toBe(true);
    });
});
