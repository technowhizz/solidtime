import { ref, type Ref } from 'vue';
import { tryOnScopeDispose, useEventListener } from '@vueuse/core';

const STORAGE_KEY = 'solidtime:calendar-scroll-minutes';
const MINUTES_PER_DAY = 24 * 60;

/**
 * ES modules are evaluated once per document: an Inertia SPA visit reuses this module
 * instance, a browser reload creates a fresh one. So this flag answers "has the calendar
 * already claimed the persisted scroll position in this document?".
 */
let hasClaimedRestore = false;

function readPersistedMinutes(): number | null {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (raw === null) return null;

        const minutes = Number.parseFloat(raw);
        if (!Number.isFinite(minutes) || minutes < 0 || minutes > MINUTES_PER_DAY) return null;

        return minutes;
    } catch {
        // Storage can be unavailable in private mode or a sandboxed iframe
        return null;
    }
}

function writePersistedMinutes(minutes: number): void {
    try {
        sessionStorage.setItem(STORAGE_KEY, String(Math.round(minutes)));
    } catch {
        // Persisting the scroll position is best effort
    }
}

/**
 * True only when the calendar renders as the *document's* initial page — a refresh or a
 * direct load of /calendar. An Inertia visit swaps the page component after pushState, so
 * location.pathname already points at the calendar while the navigation entry still holds
 * the URL the document was fetched with.
 *
 * The entry's `type` is deliberately not used: it keeps reporting 'reload' for the whole
 * document lifetime, including after later in-app visits.
 */
function isInitialDocumentPage(): boolean {
    const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    if (!entry) return false;

    try {
        return new URL(entry.name, window.location.href).pathname === window.location.pathname;
    } catch {
        return false;
    }
}

/**
 * Remembers where the calendar viewport is scrolled to and restores it after a page refresh.
 *
 * The position is kept in minutes from midnight rather than pixels so it survives changes to
 * the slot scale and start hour, and lives in sessionStorage so it is scoped to the tab.
 */
export function useCalendarScrollRestore(options: {
    scrollerRef: Ref<HTMLElement | null>;
    pixelsToMinutesFromMidnight: (px: number) => number;
}) {
    const { scrollerRef, pixelsToMinutesFromMidnight } = options;

    const shouldRestore = !hasClaimedRestore && isInitialDocumentPage();
    hasClaimedRestore = true;

    /**
     * Where the viewport should sit, in minutes from midnight. Null means "no opinion", and
     * the caller falls back to scrolling to the current time.
     */
    const desiredScrollMinutes = ref<number | null>(shouldRestore ? readPersistedMinutes() : null);

    let rafId: number | null = null;

    // A ref target makes useEventListener re-bind whenever `.fc-scroller` is re-created (it
    // lives behind `v-if="!loading"`) and detach automatically on unmount.
    useEventListener(
        scrollerRef,
        'scroll',
        () => {
            if (rafId !== null) return;
            rafId = requestAnimationFrame(() => {
                rafId = null;
                if (!scrollerRef.value) return;

                const minutes = pixelsToMinutesFromMidnight(scrollerRef.value.scrollTop);
                desiredScrollMinutes.value = minutes;
                writePersistedMinutes(minutes);
            });
        },
        { passive: true }
    );

    tryOnScopeDispose(() => {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    });

    return { desiredScrollMinutes };
}
