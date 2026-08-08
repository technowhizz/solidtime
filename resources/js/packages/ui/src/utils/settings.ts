export function getWeekStart() {
    const weekStart = window?.getWeekStartSetting() as string;

    if (!weekStart) {
        throw new Error(
            'Please make sure to provide the current user week start setting as a vue inject (week_start)'
        );
    }
    return weekStart;
}

const weekStartMap: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
};

export function getWeekStartDayNumber(): number {
    return weekStartMap[getWeekStart()] ?? 1;
}

export const DEFAULT_CALENDAR_WEEK_DAYS = 7;

/**
 * Number of day columns the calendar week view renders (1-7).
 *
 * Unlike getWeekStart this falls back instead of throwing: a session whose shared
 * Inertia props predate the deploy should degrade to a normal week, not white-screen
 * the calendar.
 */
export function getCalendarWeekDays(): number {
    const value = Number(window?.getCalendarWeekDaysSetting?.());

    if (!Number.isInteger(value) || value < 1 || value > 7) {
        return DEFAULT_CALENDAR_WEEK_DAYS;
    }
    return value;
}
/**
 * Color used to stand in for "no project". Matches the grey the calendar hardcoded before this
 * became a user setting.
 */
export const DEFAULT_NO_PROJECT_COLOR = '#6b7280';

const HEX_COLOR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;

/**
 * Like getCalendarWeekDays this falls back instead of throwing, and for the same reason: a
 * session whose shared Inertia props predate the deploy should degrade to the old grey rather
 * than white-screen the calendar. The value is validated because it is handed to chroma, which
 * throws on anything it cannot parse.
 *
 * Note this reads the Inertia shared props, which Inertia restores from `history.state` on
 * back/forward without asking the server. A page that was already open when the color changed
 * therefore keeps the old one until it is reloaded — the same as `week_start`, `timezone` and
 * `calendar_week_days`, which all come through this mechanism. The settings form says so.
 */
export function getNoProjectColor(): string {
    const value = window?.getNoProjectColorSetting?.();

    if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
        return DEFAULT_NO_PROJECT_COLOR;
    }
    return value.toLowerCase();
}

export function getUserTimezone() {
    const timezone = window?.getTimezoneSetting() as string;
    if (!timezone) {
        throw new Error(
            'Please make sure to provide the current user timezone as a vue inject (timezone)'
        );
    }
    return timezone;
}
