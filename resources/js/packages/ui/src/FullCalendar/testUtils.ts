import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import type { CalendarSettings } from './calendarSettings';
import { getDayJsInstance } from '../utils/time';
import { SLOT_HEIGHT } from './calendarTypes';

/**
 * Runs a composable inside a throwaway component so that the `onUnmounted`
 * hooks the calendar composables register have an owning instance.
 */
export function withSetup<T>(composable: () => T): { result: T; unmount: () => void } {
    let result!: T;
    const wrapper = mount(
        defineComponent({
            setup() {
                result = composable();
                return () => null;
            },
        })
    );
    return { result, unmount: () => wrapper.unmount() };
}

export const TEST_DAY = '2026-07-14';

export const testCalendarSettings: CalendarSettings = {
    snapMinutes: 15,
    startHour: 0,
    endHour: 24,
    slotMinutes: 15,
};

export const testViewDays = () => [getDayJsInstance()(TEST_DAY)];

/** Grid maths for a 24h grid of 15-minute slots — inverses of each other. */
export const minutesToPixels = (minutes: number) => (minutes / 15) * SLOT_HEIGHT;
export const pixelsToMinutesFromMidnight = (px: number) => (px / SLOT_HEIGHT) * 15;
export const totalGridPixels = minutesToPixels(24 * 60);

/**
 * A stub the drag composables accept as a `PointerEvent` — they only read
 * `button`, `clientX`/`clientY` and `target.closest`.
 */
export function pointerDownEvent(clientX: number, clientY: number): PointerEvent {
    return {
        button: 0,
        clientX,
        clientY,
        target: { closest: () => null },
        preventDefault: () => {},
        stopPropagation: () => {},
    } as unknown as PointerEvent;
}

/** happy-dom has no PointerEvent, and the handlers only read clientX/clientY. */
export function dispatchPointer(
    type: 'pointermove' | 'pointerup',
    clientX: number,
    clientY: number
) {
    document.dispatchEvent(new MouseEvent(type, { clientX, clientY, bubbles: true }));
}

export function pressKey(key: string) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}
