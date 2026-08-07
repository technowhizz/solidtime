import { computed, type ComputedRef, type Ref } from 'vue';
import type { Dayjs } from 'dayjs';
import { getLocalizedDayJs } from '../utils/time';
import type { CalendarSettings } from './calendarSettings';
import { layoutDayEvents } from './eventLayout';
import type { ExternalCalendarEvent, ExternalEventBox } from './externalCalendarTypes';

interface DatedExternalEvent extends ExternalCalendarEvent {
    dayStart: Dayjs;
    dayEnd: Dayjs;
}

export function useExternalEventBoxes(params: {
    externalEvents: () => ExternalCalendarEvent[] | undefined;
    viewDays: ComputedRef<Dayjs[]>;
    calendarSettings: Ref<CalendarSettings>;
    minutesToPixels: (minutes: number) => number;
    timeToMinutesFromMidnight: (time: Dayjs) => number;
}) {
    const externalEventBoxes = computed<ExternalEventBox[]>(() => {
        const events = params.externalEvents();
        if (!events || events.length === 0) return [];

        const s = params.calendarSettings.value;
        const visibleStartMin = s.startHour * 60;
        const visibleEndMin = s.endHour * 60;

        // All-day events have no position on the time grid, so they are not drawn
        const timedEvents: DatedExternalEvent[] = events
            .filter((event) => !event.isAllDay)
            .map((event) => ({
                ...event,
                dayStart: getLocalizedDayJs(event.start),
                dayEnd: getLocalizedDayJs(event.end),
            }));

        const boxes: ExternalEventBox[] = [];

        for (const day of params.viewDays.value) {
            const dateStr = day.format('YYYY-MM-DD');
            const dayStart = day.startOf('day');
            const dayEnd = day.endOf('day');

            const eventsOfDay = timedEvents.filter(
                (event) => event.dayStart.isBefore(dayEnd) && event.dayEnd.isAfter(dayStart)
            );
            if (eventsOfDay.length === 0) continue;

            // Reuses the time entry layout, so overlapping events stack side by side in the lane
            const laidOut = layoutDayEvents(
                eventsOfDay,
                dayStart,
                dayEnd,
                visibleStartMin,
                visibleEndMin,
                params.timeToMinutesFromMidnight,
                params.minutesToPixels
            );

            for (const item of laidOut) {
                boxes.push({
                    dateStr,
                    top: item.top,
                    height: item.height,
                    left: item.left,
                    width: item.width,
                    event: item.event,
                });
            }
        }

        return boxes;
    });

    function externalEventBoxesForDay(dateStr: string): ExternalEventBox[] {
        return externalEventBoxes.value.filter((box) => box.dateStr === dateStr);
    }

    function dayHasExternalEvents(dateStr: string): boolean {
        return externalEventBoxes.value.some((box) => box.dateStr === dateStr);
    }

    /**
     * Whether the lane is in use anywhere in the current view. The lane is reserved on
     * every day column rather than per day, so the divider and the width of the time
     * entries stay put instead of jumping between days.
     */
    const hasAnyExternalEvents = computed<boolean>(() => externalEventBoxes.value.length > 0);

    return {
        externalEventBoxes,
        externalEventBoxesForDay,
        dayHasExternalEvents,
        hasAnyExternalEvents,
    };
}
