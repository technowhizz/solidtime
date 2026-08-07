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
export function getUserTimezone() {
    const timezone = window?.getTimezoneSetting() as string;
    if (!timezone) {
        throw new Error(
            'Please make sure to provide the current user timezone as a vue inject (timezone)'
        );
    }
    return timezone;
}
