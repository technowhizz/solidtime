import { computed, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import type { TimeEntry } from '@/packages/api/src';
import { useEventResize } from './useEventResize';
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

const ORIGINAL_TOP = minutesToPixels(10 * 60);
const ORIGINAL_HEIGHT = minutesToPixels(60);

function dayEvent(event: CalendarEvent): DayEvent {
    return {
        event,
        top: ORIGINAL_TOP,
        height: ORIGINAL_HEIGHT,
        left: '0',
        width: '100%',
        isClippedStart: false,
        isClippedEnd: false,
    };
}

describe('useEventResize escape-to-cancel', () => {
    const updateTimeEntry = vi.fn().mockResolvedValue(undefined);
    const emitRefresh = vi.fn();
    let teardown: (() => void) | null = null;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        teardown?.();
        teardown = null;
        document.body.classList.remove('fc-resizing-active');
    });

    function resize() {
        const { result, unmount } = withSetup(() =>
            useEventResize({
                calendarSettings: ref({ ...testCalendarSettings }),
                viewDays: computed(testViewDays),
                eventsByDay: computed(() => ({}) as Record<string, DayEvent[]>),
                optimisticOverrides: ref(new Map<string, TimeEntry>()),
                updateTimeEntry,
                emitRefresh,
                minutesToPixels,
                pixelsToMinutesFromMidnight,
                getDayFromClientX: () => TEST_DAY,
                clientYToGridPixels: (clientY: number) => clientY,
            })
        );
        teardown = unmount;

        const event = calendarEvent();
        return {
            ...result,
            /** Grab the bottom edge and drag it down to 12:00. */
            grabBottomEdge: () =>
                result.onResizerPointerDown(
                    pointerDownEvent(10, ORIGINAL_TOP + ORIGINAL_HEIGHT),
                    event,
                    dayEvent(event),
                    'end',
                    TEST_DAY
                ),
        };
    }

    it('saves the resize on pointer-up when escape is not pressed', async () => {
        const r = resize();
        r.grabBottomEdge();
        dispatchPointer('pointermove', 10, minutesToPixels(12 * 60));
        dispatchPointer('pointerup', 10, minutesToPixels(12 * 60));
        await flushPromises();

        expect(updateTimeEntry).toHaveBeenCalledTimes(1);
    });

    it('discards the resize when escape is pressed mid-drag', () => {
        const r = resize();
        r.grabBottomEdge();
        dispatchPointer('pointermove', 10, minutesToPixels(12 * 60));
        expect(r.isResizing.value).toBe(true);

        pressKey('Escape');

        expect(r.isResizing.value).toBe(false);
        expect(r.resizeEventId.value).toBeNull();
        expect(r.resizeCurrentTop.value).toBe(ORIGINAL_TOP);
        expect(r.resizeCurrentHeight.value).toBe(ORIGINAL_HEIGHT);
        expect(r.resizeLiveDurationSeconds.value).toBeNull();
        expect(updateTimeEntry).not.toHaveBeenCalled();
    });

    it('drops the resizing cursor override on cancel', () => {
        const r = resize();
        r.grabBottomEdge();
        expect(document.body.classList.contains('fc-resizing-active')).toBe(true);

        pressKey('Escape');

        expect(document.body.classList.contains('fc-resizing-active')).toBe(false);
    });

    it('stays cancelled — releasing the button after escape saves nothing', async () => {
        const r = resize();
        r.grabBottomEdge();
        dispatchPointer('pointermove', 10, minutesToPixels(12 * 60));

        pressKey('Escape');
        dispatchPointer('pointermove', 10, minutesToPixels(14 * 60));
        dispatchPointer('pointerup', 10, minutesToPixels(14 * 60));
        await flushPromises();

        expect(updateTimeEntry).not.toHaveBeenCalled();
    });

    it('ignores keys other than escape', () => {
        const r = resize();
        r.grabBottomEdge();
        dispatchPointer('pointermove', 10, minutesToPixels(12 * 60));

        pressKey('a');

        expect(r.isResizing.value).toBe(true);
    });
});
