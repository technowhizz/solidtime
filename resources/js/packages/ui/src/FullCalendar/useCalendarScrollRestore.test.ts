import { effectScope, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'solidtime:calendar-scroll-minutes';

type Composable = typeof import('./useCalendarScrollRestore').useCalendarScrollRestore;

/**
 * The composable tracks "already restored in this document" in module scope, which is exactly
 * what makes a browser reload different from an Inertia visit. Re-importing gives each test a
 * fresh document.
 */
async function loadFreshDocument(): Promise<Composable> {
    vi.resetModules();
    return (await import('./useCalendarScrollRestore')).useCalendarScrollRestore;
}

function stubNavigationEntry(path: string) {
    const name = new URL(path, window.location.href).href;
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
        { name } as unknown as PerformanceEntry,
    ]);
}

function restoredMinutes(useCalendarScrollRestore: Composable): number | null {
    const scope = effectScope();
    const minutes = scope.run(
        () =>
            useCalendarScrollRestore({
                scrollerRef: ref(null),
                pixelsToMinutesFromMidnight: (px) => px,
            }).desiredScrollMinutes.value
    );
    scope.stop();
    return minutes ?? null;
}

describe('useCalendarScrollRestore', () => {
    beforeEach(() => {
        sessionStorage.clear();
        stubNavigationEntry(window.location.pathname);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('restores a persisted position when the calendar is the document’s initial page', async () => {
        sessionStorage.setItem(STORAGE_KEY, '480');

        expect(restoredMinutes(await loadFreshDocument())).toBe(480);
    });

    it('has no opinion when nothing was persisted', async () => {
        expect(restoredMinutes(await loadFreshDocument())).toBeNull();
    });

    it.each([
        ['not a number', 'lunchtime'],
        ['negative', '-10'],
        ['beyond a full day', '1441'],
        ['empty', ''],
    ])('ignores a %s persisted value', async (_label, stored) => {
        sessionStorage.setItem(STORAGE_KEY, stored);

        expect(restoredMinutes(await loadFreshDocument())).toBeNull();
    });

    it('accepts the exact bounds of a day', async () => {
        sessionStorage.setItem(STORAGE_KEY, '0');
        expect(restoredMinutes(await loadFreshDocument())).toBe(0);

        sessionStorage.setItem(STORAGE_KEY, '1440');
        expect(restoredMinutes(await loadFreshDocument())).toBe(1440);
    });

    it('does not restore when the document was loaded on another page', async () => {
        sessionStorage.setItem(STORAGE_KEY, '480');
        stubNavigationEntry('/dashboard');

        expect(restoredMinutes(await loadFreshDocument())).toBeNull();
    });

    it('does not restore when the navigation timing entry is unavailable', async () => {
        sessionStorage.setItem(STORAGE_KEY, '480');
        vi.spyOn(performance, 'getEntriesByType').mockReturnValue([]);

        expect(restoredMinutes(await loadFreshDocument())).toBeNull();
    });

    it('restores only once per document, so an in-app revisit starts at the current time', async () => {
        sessionStorage.setItem(STORAGE_KEY, '480');
        const useCalendarScrollRestore = await loadFreshDocument();

        expect(restoredMinutes(useCalendarScrollRestore)).toBe(480);
        expect(restoredMinutes(useCalendarScrollRestore)).toBeNull();
    });

    it('persists the position as minutes from midnight while scrolling', async () => {
        const useCalendarScrollRestore = await loadFreshDocument();
        const scroller = document.createElement('div');
        const scrollerRef = ref<HTMLElement | null>(scroller);

        const scope = effectScope();
        const { desiredScrollMinutes } = scope.run(() =>
            useCalendarScrollRestore({
                scrollerRef,
                // Mirrors useCalendarGrid at the default 15-minute scale: 25px per slot
                pixelsToMinutesFromMidnight: (px) => (px / 25) * 15,
            })
        )!;

        Object.defineProperty(scroller, 'scrollTop', { value: 800, writable: true });
        scroller.dispatchEvent(new Event('scroll'));
        await new Promise((resolve) => requestAnimationFrame(resolve));

        expect(desiredScrollMinutes.value).toBe(480);
        expect(sessionStorage.getItem(STORAGE_KEY)).toBe('480');

        scope.stop();
    });
});
