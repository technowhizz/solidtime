export interface CalendarSettings {
    snapMinutes: number;
    startHour: number;
    endHour: number;
    slotMinutes: number;
    /**
     * Vertical zoom of the time grid, in pixels per hour. Independent of
     * `slotMinutes` so that changing the grid scale doesn't change the zoom.
     */
    pixelsPerHour: number;
}

/** Matches the previous fixed 25px height of a 15-minute slot. */
export const DEFAULT_PIXELS_PER_HOUR = 100;
export const MIN_PIXELS_PER_HOUR = 16;
export const MAX_PIXELS_PER_HOUR = 400;

/**
 * The zoom level, guarded against missing or corrupt persisted values —
 * a zero or NaN would otherwise propagate into every pixel/minute conversion.
 */
export function pixelsPerHourFor(settings: CalendarSettings): number {
    const raw = settings.pixelsPerHour;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
        return DEFAULT_PIXELS_PER_HOUR;
    }
    return Math.min(MAX_PIXELS_PER_HOUR, Math.max(MIN_PIXELS_PER_HOUR, raw));
}

/** Height of a single grid slot in pixels at the current zoom level. */
export function slotHeightFor(settings: CalendarSettings): number {
    return (pixelsPerHourFor(settings) * settings.slotMinutes) / 60;
}

export function minutesToPixelsFor(settings: CalendarSettings, minutes: number): number {
    return (minutes / 60) * pixelsPerHourFor(settings);
}

export function pixelsToMinutesFor(settings: CalendarSettings, pixels: number): number {
    return (pixels / pixelsPerHourFor(settings)) * 60;
}
