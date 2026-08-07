import { computed, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSlotSelection } from './useSlotSelection';
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
