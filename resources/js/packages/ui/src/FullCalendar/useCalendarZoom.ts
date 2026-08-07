import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import {
    MAX_PIXELS_PER_HOUR,
    MIN_PIXELS_PER_HOUR,
    pixelsPerHourFor,
    type CalendarSettings,
} from './calendarSettings';

/** Guards against float noise when stepping whole hours in and out of view. */
const EPSILON = 1e-6;

/** Fallback step when the viewport height isn't known (e.g. grid not mounted yet). */
const BLIND_ZOOM_FACTOR = 1.25;

/**
 * Vertical zoom for the time grid, expressed as "how many hours fit in the
 * viewport". Each step adds or removes exactly one hour from the visible
 * range, and the time at the centre of the viewport stays put across the
 * change so the grid doesn't jump under the cursor.
 */
export function useCalendarZoom(params: {
    calendarSettings: Ref<CalendarSettings>;
    scrollerRef: Ref<HTMLElement | null>;
}) {
    const viewportHeight = ref(0);
    let resizeObserver: ResizeObserver | null = null;

    function measure() {
        viewportHeight.value = params.scrollerRef.value?.clientHeight ?? 0;
    }

    // The scroller only exists once the calendar has loaded, so (re)attach the
    // observer whenever the element itself appears or is swapped out.
    watch(
        () => params.scrollerRef.value,
        (el) => {
            resizeObserver?.disconnect();
            resizeObserver = null;

            if (!el) {
                viewportHeight.value = 0;
                return;
            }

            measure();

            if (typeof ResizeObserver !== 'undefined') {
                resizeObserver = new ResizeObserver(() => measure());
                resizeObserver.observe(el);
            }
        },
        { immediate: true, flush: 'post' }
    );

    onBeforeUnmount(() => {
        resizeObserver?.disconnect();
        resizeObserver = null;
    });

    /** Hours currently fitting in the viewport, or 0 when not measurable. */
    const visibleHours = computed(() => {
        if (viewportHeight.value <= 0) return 0;
        return viewportHeight.value / pixelsPerHourFor(params.calendarSettings.value);
    });

    /** Total hours the configured start/end range spans. */
    const rangeHours = computed(() => {
        const s = params.calendarSettings.value;
        return Math.max(1, s.endHour - s.startHour);
    });

    const canZoomIn = computed(() => {
        if (pixelsPerHourFor(params.calendarSettings.value) >= MAX_PIXELS_PER_HOUR - EPSILON) {
            return false;
        }
        if (visibleHours.value <= 0) return true;
        return visibleHours.value > 1 + EPSILON;
    });

    const canZoomOut = computed(() => {
        if (pixelsPerHourFor(params.calendarSettings.value) <= MIN_PIXELS_PER_HOUR + EPSILON) {
            return false;
        }
        if (visibleHours.value <= 0) return true;
        // Nothing to gain once the whole configured day already fits.
        return visibleHours.value < rangeHours.value - EPSILON;
    });

    /**
     * @param direction  1 = zoom in (one hour fewer on screen),
     *                  -1 = zoom out (one hour more on screen)
     */
    function applyZoom(direction: 1 | -1) {
        const settings = params.calendarSettings.value;
        const currentPixelsPerHour = pixelsPerHourFor(settings);
        const scroller = params.scrollerRef.value;
        const height = viewportHeight.value;

        let nextPixelsPerHour: number;

        if (height > 0) {
            const current = height / currentPixelsPerHour;
            // floor/ceil rather than round so a fractional viewport (e.g. 8.4
            // hours) steps to the next whole hour instead of skipping one.
            const targetHours =
                direction === 1
                    ? Math.ceil(current - EPSILON) - 1
                    : Math.floor(current + EPSILON) + 1;
            const clampedHours = Math.min(Math.max(targetHours, 1), rangeHours.value);
            nextPixelsPerHour = height / clampedHours;
        } else {
            nextPixelsPerHour =
                direction === 1
                    ? currentPixelsPerHour * BLIND_ZOOM_FACTOR
                    : currentPixelsPerHour / BLIND_ZOOM_FACTOR;
        }

        nextPixelsPerHour = Math.min(
            MAX_PIXELS_PER_HOUR,
            Math.max(MIN_PIXELS_PER_HOUR, nextPixelsPerHour)
        );

        if (Math.abs(nextPixelsPerHour - currentPixelsPerHour) < EPSILON) return;

        // Minutes from the top of the grid at the vertical centre of the viewport.
        const anchorMinutes = scroller
            ? ((scroller.scrollTop + scroller.clientHeight / 2) / currentPixelsPerHour) * 60
            : null;

        params.calendarSettings.value = { ...settings, pixelsPerHour: nextPixelsPerHour };

        if (anchorMinutes === null) return;

        nextTick(() => {
            const el = params.scrollerRef.value;
            if (!el) return;
            const desiredTop = (anchorMinutes / 60) * nextPixelsPerHour - el.clientHeight / 2;
            el.scrollTop = Math.max(0, Math.min(desiredTop, el.scrollHeight - el.clientHeight));
        });
    }

    function zoomIn() {
        if (!canZoomIn.value) return;
        applyZoom(1);
    }

    function zoomOut() {
        if (!canZoomOut.value) return;
        applyZoom(-1);
    }

    return {
        visibleHours,
        canZoomIn,
        canZoomOut,
        zoomIn,
        zoomOut,
    };
}
