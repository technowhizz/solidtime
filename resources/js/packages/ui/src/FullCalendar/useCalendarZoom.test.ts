import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import { useCalendarZoom } from './useCalendarZoom';
import {
    DEFAULT_PIXELS_PER_HOUR,
    MAX_PIXELS_PER_HOUR,
    MIN_PIXELS_PER_HOUR,
    type CalendarSettings,
} from './calendarSettings';

type ZoomApi = ReturnType<typeof useCalendarZoom>;

function defaultSettings(overrides: Partial<CalendarSettings> = {}): CalendarSettings {
    return {
        snapMinutes: 15,
        startHour: 0,
        endHour: 24,
        slotMinutes: 15,
        pixelsPerHour: DEFAULT_PIXELS_PER_HOUR,
        ...overrides,
    };
}

/**
 * jsdom performs no layout, so the scroller's height and scroll offset are
 * faked. scrollHeight tracks the zoom level the way a real grid would.
 */
function setup(viewportHeight: number | null, overrides: Partial<CalendarSettings> = {}) {
    const calendarSettings = ref<CalendarSettings>(defaultSettings(overrides));

    let scroller: HTMLElement | null = null;

    if (viewportHeight !== null) {
        scroller = document.createElement('div');
        let scrollTop = 0;
        Object.defineProperty(scroller, 'clientHeight', {
            get: () => viewportHeight,
            configurable: true,
        });
        Object.defineProperty(scroller, 'scrollHeight', {
            get: () =>
                (calendarSettings.value.endHour - calendarSettings.value.startHour) *
                calendarSettings.value.pixelsPerHour,
            configurable: true,
        });
        Object.defineProperty(scroller, 'scrollTop', {
            get: () => scrollTop,
            set: (value: number) => {
                scrollTop = value;
            },
            configurable: true,
        });
    }

    const scrollerRef = ref<HTMLElement | null>(scroller);

    let api!: ZoomApi;
    const wrapper = mount({
        setup() {
            api = useCalendarZoom({ calendarSettings, scrollerRef });
            return () => null;
        },
    });

    return { calendarSettings, scrollerRef, scroller, wrapper, api };
}

describe('useCalendarZoom', () => {
    it('reports how many hours currently fit in the viewport', () => {
        const { api } = setup(850);
        expect(api.visibleHours.value).toBeCloseTo(8.5, 5);
    });

    it('zooming out shows exactly one more whole hour', () => {
        const { api } = setup(850);

        api.zoomOut();
        expect(api.visibleHours.value).toBeCloseTo(9, 5);

        api.zoomOut();
        expect(api.visibleHours.value).toBeCloseTo(10, 5);
    });

    it('zooming in shows exactly one fewer whole hour', () => {
        const { api } = setup(850);

        api.zoomIn();
        expect(api.visibleHours.value).toBeCloseTo(8, 5);

        api.zoomIn();
        expect(api.visibleHours.value).toBeCloseTo(7, 5);
    });

    it('steps to a whole hour first when the viewport shows a fraction', () => {
        // 840 / 100 = 8.4 hours visible
        const { api } = setup(840);

        api.zoomIn();
        expect(api.visibleHours.value).toBeCloseTo(8, 5);
    });

    it('alternating zoom out and in returns to the same scale', () => {
        // 800 / 100 = a whole 8 hours visible; a fractional start snaps to
        // whole hours on the first step and is deliberately not recovered.
        const { api, calendarSettings } = setup(800);

        api.zoomOut();
        api.zoomIn();

        expect(calendarSettings.value.pixelsPerHour).toBeCloseTo(DEFAULT_PIXELS_PER_HOUR, 5);
    });

    it('stops zooming out once the whole configured range fits', () => {
        // 08:00–18:00 is a 10 hour range
        const { api } = setup(850, { startHour: 8, endHour: 18 });

        for (let i = 0; i < 10; i++) {
            api.zoomOut();
        }

        expect(api.visibleHours.value).toBeCloseTo(10, 5);
        expect(api.canZoomOut.value).toBe(false);
    });

    it('never zooms in past the maximum scale', () => {
        const { api, calendarSettings } = setup(850);

        for (let i = 0; i < 20; i++) {
            api.zoomIn();
        }

        expect(calendarSettings.value.pixelsPerHour).toBeLessThanOrEqual(MAX_PIXELS_PER_HOUR);
        expect(api.canZoomIn.value).toBe(false);
    });

    it('never zooms out past the minimum scale', () => {
        // A tall range in a short viewport bottoms out on pixelsPerHour
        const { api, calendarSettings } = setup(200);

        for (let i = 0; i < 40; i++) {
            api.zoomOut();
        }

        expect(calendarSettings.value.pixelsPerHour).toBeGreaterThanOrEqual(MIN_PIXELS_PER_HOUR);
    });

    it('keeps the time at the centre of the viewport in place', async () => {
        const { api, scroller, calendarSettings } = setup(850);

        // Centre of the viewport sits at 07:00 (600px + 425px = 1025px @ 100px/h)
        scroller!.scrollTop = 600;
        const centreHour = (600 + 425) / DEFAULT_PIXELS_PER_HOUR;

        api.zoomOut();
        await nextTick();

        const newCentreHour = (scroller!.scrollTop + 425) / calendarSettings.value.pixelsPerHour;
        expect(newCentreHour).toBeCloseTo(centreHour, 5);
    });

    it('falls back to a proportional step when the viewport cannot be measured', () => {
        const { api, calendarSettings } = setup(null);

        expect(api.visibleHours.value).toBe(0);

        api.zoomOut();
        expect(calendarSettings.value.pixelsPerHour).toBeLessThan(DEFAULT_PIXELS_PER_HOUR);

        api.zoomIn();
        expect(calendarSettings.value.pixelsPerHour).toBeCloseTo(DEFAULT_PIXELS_PER_HOUR, 5);
    });

    it('recovers a corrupt persisted zoom level', () => {
        const { api } = setup(850, { pixelsPerHour: 0 });

        expect(api.visibleHours.value).toBeCloseTo(8.5, 5);
    });
});
