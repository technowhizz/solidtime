import { ref, type Ref, type ComputedRef } from 'vue';
import type { Dayjs } from 'dayjs';
import type { TimeEntry } from '@/packages/api/src';
import { getDayJsInstance, getLocalizedDayJs, getLocalizedDayJsFromMinutes } from '../utils/time';

import type { CalendarSettings } from './calendarSettings';
import type { CalendarEvent } from './calendarTypes';
import type { ExternalCalendarEvent } from './externalCalendarTypes';

export function useContextMenu(params: {
    calendarSettings: Ref<CalendarSettings>;
    calendarEvents: ComputedRef<CalendarEvent[]>;
    externalCalendarEvents: () => ExternalCalendarEvent[];
    pixelsToMinutesFromMidnight: (px: number) => number;
    getDayFromClientX: (clientX: number) => string | null;
    clientYToGridPixels: (clientY: number) => number;
    createTimeEntry: (
        entry: Omit<TimeEntry, 'id' | 'organization_id' | 'user_id'>
    ) => Promise<void>;
    updateTimeEntry: (entry: TimeEntry) => Promise<void>;
    deleteTimeEntry: (id: string) => Promise<void>;
    onEditEvent: (entry: TimeEntry) => void;
    onCreateEvent: (start: Dayjs, end: Dayjs, description?: string) => void;
    onCreateBreak: (start: Dayjs, end: Dayjs) => void;
    emitRefresh: () => void;
}) {
    const contextMenuTimeEntry = ref<TimeEntry | null>(null);
    const contextMenuExternalEvent = ref<ExternalCalendarEvent | null>(null);
    const contextMenuCreateTime = ref<{ start: Dayjs; end: Dayjs } | null>(null);

    function getTimeAtClickPosition(event: MouseEvent): { start: Dayjs; end: Dayjs } | null {
        const date = params.getDayFromClientX(event.clientX);
        if (!date) return null;

        const gridY = params.clientYToGridPixels(event.clientY);
        const minutesFromGridStart = params.pixelsToMinutesFromMidnight(gridY);

        const snap = params.calendarSettings.value.snapMinutes;
        const snappedMinutes = Math.floor(minutesFromGridStart / snap) * snap;

        const startLocal = getLocalizedDayJsFromMinutes(date, snappedMinutes);
        const snappedEnd = getLocalizedDayJsFromMinutes(date, snappedMinutes + snap);

        return { start: startLocal.utc(), end: snappedEnd.utc() };
    }

    function handleCalendarContextMenu(event: MouseEvent) {
        const target = event.target as HTMLElement;
        const externalEventEl = target.closest<HTMLElement>('[data-external-event-id]');

        if (externalEventEl) {
            const externalEventId = externalEventEl.getAttribute('data-external-event-id');
            if (!externalEventId) return;

            const externalEvent = params
                .externalCalendarEvents()
                .find((e) => e.id === externalEventId);
            if (!externalEvent) return;

            contextMenuExternalEvent.value = externalEvent;
            contextMenuTimeEntry.value = null;
            contextMenuCreateTime.value = null;
            return;
        }

        const eventEl = target.closest<HTMLElement>('[data-event-id]');

        if (!eventEl) {
            contextMenuTimeEntry.value = null;
            contextMenuExternalEvent.value = null;
            const timeInfo = getTimeAtClickPosition(event);
            contextMenuCreateTime.value = timeInfo;
            return;
        }

        const eventId = eventEl.getAttribute('data-event-id');
        if (!eventId) return;

        const ev = params.calendarEvents.value.find((e) => e.id === eventId);
        if (!ev) return;

        contextMenuTimeEntry.value = ev.timeEntry;
        contextMenuExternalEvent.value = null;
        contextMenuCreateTime.value = null;
    }

    async function handleContextCopyExternalEvent() {
        if (!contextMenuExternalEvent.value) return;
        await copyExternalEventToTimeEntry(contextMenuExternalEvent.value);
    }

    function handleContextCopyExternalEventAndEdit() {
        const externalEvent = contextMenuExternalEvent.value;
        if (!externalEvent) return;
        params.onCreateEvent(
            getDayJsInstance().utc(externalEvent.start),
            getDayJsInstance().utc(externalEvent.end),
            externalEvent.title
        );
    }

    /**
     * Copying is the only write path for external events - solidtime never stores their
     * content, it just seeds a normal time entry from the title and time range.
     */
    async function copyExternalEventToTimeEntry(externalEvent: ExternalCalendarEvent) {
        const dayjs = getDayJsInstance();
        await params.createTimeEntry({
            start: dayjs.utc(externalEvent.start).format(),
            end: dayjs.utc(externalEvent.end).format(),
            billable: false,
            type: 'work',
            description: externalEvent.title,
            project_id: null,
            task_id: null,
            tags: [],
        });
        params.emitRefresh();
    }

    function handleContextEdit() {
        if (!contextMenuTimeEntry.value || contextMenuTimeEntry.value.end === null) return;
        params.onEditEvent(contextMenuTimeEntry.value);
    }

    async function handleContextDuplicate() {
        if (!contextMenuTimeEntry.value || contextMenuTimeEntry.value.end === null) return;
        const entry = contextMenuTimeEntry.value;
        await params.createTimeEntry({
            start: entry.start,
            end: entry.end,
            billable: entry.billable,
            type: entry.type,
            description: entry.description,
            project_id: entry.project_id,
            task_id: entry.task_id,
            tags: entry.tags,
        });
        params.emitRefresh();
    }

    async function handleContextDelete() {
        if (!contextMenuTimeEntry.value || contextMenuTimeEntry.value.end === null) return;
        await params.deleteTimeEntry(contextMenuTimeEntry.value.id);
        params.emitRefresh();
    }

    async function handleContextSplit() {
        if (!contextMenuTimeEntry.value || contextMenuTimeEntry.value.end === null) return;
        const entry = contextMenuTimeEntry.value;
        if (!entry.end) return;
        const start = getDayJsInstance()(entry.start);
        const end = getDayJsInstance()(entry.end);
        const midpoint = start.add(end.diff(start) / 2, 'millisecond').startOf('minute');

        try {
            await params.updateTimeEntry({ ...entry, end: midpoint.utc().format() });
        } catch {
            // Update failed, don't proceed with create
            params.emitRefresh();
            return;
        }

        try {
            await params.createTimeEntry({
                start: midpoint.utc().format(),
                end: entry.end,
                billable: entry.billable,
                type: entry.type,
                description: entry.description,
                project_id: entry.project_id,
                task_id: entry.task_id,
                tags: entry.tags,
            });
        } catch {
            // Create failed after update succeeded — restore original entry
            try {
                await params.updateTimeEntry({ ...entry });
            } catch {
                // Restoration also failed; refresh will show server state
            }
        }
        params.emitRefresh();
    }

    async function handleContextStop() {
        if (!contextMenuTimeEntry.value || contextMenuTimeEntry.value.end !== null) return;
        const entry = contextMenuTimeEntry.value;
        await params.updateTimeEntry({
            ...entry,
            end: getDayJsInstance()().utc().format(),
        });
        params.emitRefresh();
    }

    async function handleContextDiscard() {
        if (!contextMenuTimeEntry.value || contextMenuTimeEntry.value.end !== null) return;
        await params.deleteTimeEntry(contextMenuTimeEntry.value.id);
        params.emitRefresh();
    }

    function handleContextCreate() {
        if (contextMenuCreateTime.value) {
            params.onCreateEvent(
                contextMenuCreateTime.value.start,
                contextMenuCreateTime.value.end
            );
        } else {
            params.onCreateEvent(
                getDayJsInstance()().utc(),
                getDayJsInstance()().utc().add(1, 'hour')
            );
        }
    }

    function handleContextCreateBreak() {
        const dayjs = getDayJsInstance();
        if (!contextMenuCreateTime.value) {
            params.onCreateBreak(dayjs().utc().subtract(30, 'minute'), dayjs().utc());
            return;
        }
        const clickTime = contextMenuCreateTime.value.start;
        // Day matching must use the user's configured timezone (the calendar renders
        // its day columns in that timezone), not the browser's local timezone
        const clickDate = getLocalizedDayJs(clickTime.format()).format('YYYY-MM-DD');

        // When the click lands in a gap between two entries of the same day,
        // the break is prefilled to exactly fill that gap
        let previousEnd: Dayjs | null = null;
        let nextStart: Dayjs | null = null;
        for (const calendarEvent of params.calendarEvents.value) {
            const entry = calendarEvent.timeEntry;
            const entryStart = dayjs.utc(entry.start);
            if (getLocalizedDayJs(entry.start).format('YYYY-MM-DD') !== clickDate) {
                continue;
            }
            const entryEnd = entry.end === null ? null : dayjs.utc(entry.end);
            if (entryEnd !== null && !entryEnd.isAfter(clickTime)) {
                if (previousEnd === null || entryEnd.isAfter(previousEnd)) {
                    previousEnd = entryEnd;
                }
            }
            if (!entryStart.isBefore(clickTime)) {
                if (nextStart === null || entryStart.isBefore(nextStart)) {
                    nextStart = entryStart;
                }
            }
        }

        if (previousEnd !== null && nextStart !== null && previousEnd.isBefore(nextStart)) {
            params.onCreateBreak(previousEnd, nextStart);
            return;
        }
        params.onCreateBreak(contextMenuCreateTime.value.start, contextMenuCreateTime.value.end);
    }

    return {
        contextMenuTimeEntry,
        contextMenuExternalEvent,
        contextMenuCreateTime,
        copyExternalEventToTimeEntry,
        handleContextCopyExternalEvent,
        handleContextCopyExternalEventAndEdit,
        handleCalendarContextMenu,
        handleContextEdit,
        handleContextDuplicate,
        handleContextDelete,
        handleContextSplit,
        handleContextStop,
        handleContextDiscard,
        handleContextCreate,
        handleContextCreateBreak,
    };
}
