/**
 * A read-only event from a calendar outside solidtime, drawn in its own lane next to the
 * time entries. Deliberately provider agnostic so a second integration can reuse the lane.
 */
export interface ExternalCalendarEvent {
    id: string;
    title: string;
    /** ISO 8601 timestamp */
    start: string;
    /** ISO 8601 timestamp */
    end: string;
    /** All-day events have no position on a time grid and are not drawn */
    isAllDay: boolean;
}

export interface ExternalEventBox {
    dateStr: string;
    top: number;
    height: number;
    left: string;
    width: string;
    event: ExternalCalendarEvent;
}
