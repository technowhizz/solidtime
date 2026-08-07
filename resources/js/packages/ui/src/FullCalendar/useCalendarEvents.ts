import { computed, ref, type Ref, type ComputedRef } from 'vue';
import chroma from 'chroma-js';
import type { Dayjs } from 'dayjs';
import type { TimeEntry, Project, Client, Task } from '@/packages/api/src';
import { getBreakPlacementHint } from '../utils/breakPlacement';
import { getDayJsInstance, getLocalizedDayJs } from '../utils/time';
import type { CalendarSettings } from './calendarSettings';
import type { CalendarEvent, DayEvent } from './calendarTypes';
import { layoutDayEvents } from './eventLayout';

export function useCalendarEvents(params: {
    timeEntries: () => TimeEntry[];
    projects: () => Project[];
    clients: () => Client[];
    tasks: () => Task[];
    calendarSettings: Ref<CalendarSettings>;
    viewDays: ComputedRef<Dayjs[]>;
    currentTime: Ref<Dayjs>;
    cssBackground: Ref<string>;
    minutesToPixels: (minutes: number) => number;
    timeToMinutesFromMidnight: (time: Dayjs) => number;
}) {
    const optimisticOverrides = ref<Map<string, TimeEntry>>(new Map());

    const calendarEvents = computed<CalendarEvent[]>(() => {
        const themeBackground = params.cssBackground.value?.trim();
        const allEntries = params.timeEntries();
        return allEntries.map((rawEntry) => {
            const timeEntry = optimisticOverrides.value.get(rawEntry.id) || rawEntry;
            const isRunning = timeEntry.end === null;
            const project = params.projects().find((p) => p.id === timeEntry.project_id);
            const client = params.clients().find((c) => c.id === project?.client_id);
            const task = params.tasks().find((t) => t.id === timeEntry.task_id);

            const effectiveEnd = isRunning
                ? params.currentTime.value
                : getDayJsInstance()(timeEntry.end!);
            const durationMinutes = effectiveEnd.diff(
                getDayJsInstance()(timeEntry.start),
                'minutes'
            );

            const isBreak = timeEntry.type === 'break';
            const isMisplacedBreak = isBreak
                ? (getBreakPlacementHint(timeEntry, allEntries)?.misplaced ?? false)
                : false;
            let title: string;
            if (isBreak) {
                title = timeEntry.description ? `Break · ${timeEntry.description}` : 'Break';
            } else {
                title = timeEntry.description || 'No description';
            }
            const baseColor = isBreak ? '#F59E0B' : project?.color || '#6B7280';
            const backgroundColor = chroma
                .mix(baseColor, themeBackground, isBreak ? 0.75 : 0.65, 'lab')
                .hex();
            const borderColor = chroma.mix(baseColor, themeBackground, 0.5, 'lab').hex();

            const startTime = getLocalizedDayJs(timeEntry.start);
            const endTime = isRunning
                ? getLocalizedDayJs(params.currentTime.value.toISOString())
                : durationMinutes === 0
                  ? startTime.add(1, 'second')
                  : getLocalizedDayJs(timeEntry.end!);

            return {
                id: timeEntry.id,
                timeEntry,
                project,
                client,
                task,
                isRunning,
                isBreak,
                isMisplacedBreak,
                durationMinutes,
                title,
                backgroundColor,
                borderColor,
                dayStart: startTime,
                dayEnd: endTime,
            };
        });
    });

    const eventsByDay = computed(() => {
        const s = params.calendarSettings.value;
        const visibleStartMin = s.startHour * 60;
        const visibleEndMin = s.endHour * 60;
        const result: Record<string, DayEvent[]> = {};

        for (const day of params.viewDays.value) {
            const dayStart = day.startOf('day');
            const dayEnd = day.endOf('day');

            const dayEvents = calendarEvents.value.filter(
                (ev) => ev.dayStart.isBefore(dayEnd) && ev.dayEnd.isAfter(dayStart)
            );

            result[day.format('YYYY-MM-DD')] = layoutDayEvents(
                dayEvents,
                dayStart,
                dayEnd,
                visibleStartMin,
                visibleEndMin,
                params.timeToMinutesFromMidnight,
                params.minutesToPixels
            );
        }

        return result;
    });

    function computeDailyTotals(filter: (entry: TimeEntry) => boolean): Record<string, number> {
        const totals: Record<string, number> = {};
        params
            .timeEntries()
            .filter(filter)
            .forEach((entry) => {
                const date = getLocalizedDayJs(entry.start).format('YYYY-MM-DD');
                let durationSeconds: number;

                if (entry.end !== null) {
                    durationSeconds = getDayJsInstance()(entry.end).diff(
                        getDayJsInstance()(entry.start),
                        'seconds'
                    );
                } else {
                    durationSeconds = Math.max(
                        0,
                        params.currentTime.value.diff(getDayJsInstance()(entry.start), 'seconds')
                    );
                }

                totals[date] = (totals[date] || 0) + durationSeconds;
            });
        return totals;
    }

    // Breaks are not working time: the day total only sums work entries,
    // the break portion is exposed separately
    const dailyTotals = computed(() => computeDailyTotals((entry) => entry.type !== 'break'));

    const dailyBreakTotals = computed(() => computeDailyTotals((entry) => entry.type === 'break'));

    function isToday(day: Dayjs): boolean {
        return day.isSame(getLocalizedDayJs(), 'day');
    }

    const nowIndicatorTop = computed(() => {
        const s = params.calendarSettings.value;
        const now = getLocalizedDayJs(params.currentTime.value.toISOString());
        const minutesFromMidnight = now.hour() * 60 + now.minute();
        const startMin = s.startHour * 60;
        if (minutesFromMidnight < startMin || minutesFromMidnight >= s.endHour * 60) return -1;
        return params.minutesToPixels(minutesFromMidnight - startMin);
    });

    return {
        optimisticOverrides,
        calendarEvents,
        eventsByDay,
        dailyTotals,
        dailyBreakTotals,
        isToday,
        nowIndicatorTop,
    };
}
