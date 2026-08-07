import { computed, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimeEntry } from '@/packages/api/src';
import type { CalendarEvent } from './calendarTypes';
import type { ExternalCalendarEvent } from './externalCalendarTypes';
import { getDayJsInstance } from '../utils/time';
import { useContextMenu } from './useContextMenu';

function breakEntry(): TimeEntry {
    return {
        id: 'break-1',
        start: '2026-07-14T10:00:00Z',
        end: '2026-07-14T11:00:00Z',
        duration: 3600,
        description: 'Lunch',
        project_id: null,
        task_id: null,
        organization_id: 'organization-1',
        user_id: 'user-1',
        tags: [],
        billable: false,
        type: 'break',
    } as TimeEntry;
}

describe('useContextMenu break actions', () => {
    const createTimeEntry = vi.fn().mockResolvedValue(undefined);
    const updateTimeEntry = vi.fn().mockResolvedValue(undefined);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    function contextMenu() {
        const entry = breakEntry();
        const calendarEvents = computed(() => [
            {
                id: entry.id,
                timeEntry: entry,
            } as CalendarEvent,
        ]);
        const menu = useContextMenu({
            calendarSettings: ref({
                snapMinutes: 15,
                startHour: 0,
                endHour: 24,
                slotMinutes: 15,
            }),
            calendarEvents,
            externalCalendarEvents: () => [],
            pixelsToMinutesFromMidnight: () => 0,
            getDayFromClientX: () => null,
            clientYToGridPixels: () => 0,
            createTimeEntry,
            updateTimeEntry,
            deleteTimeEntry: vi.fn().mockResolvedValue(undefined),
            onEditEvent: vi.fn(),
            onCreateEvent: vi.fn(),
            onCreateBreak: vi.fn(),
            emitRefresh: vi.fn(),
        });

        menu.handleCalendarContextMenu({
            target: {
                // The handler probes for an external calendar event first, so the stub has
                // to answer per selector rather than matching everything
                closest: (selector: string) =>
                    selector === '[data-event-id]' ? { getAttribute: () => entry.id } : null,
            },
        } as unknown as MouseEvent);

        return menu;
    }

    it('preserves the type when duplicating a break', async () => {
        await contextMenu().handleContextDuplicate();

        expect(createTimeEntry).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'break',
            })
        );
    });

    it('preserves the type when creating the second half of a split break', async () => {
        await contextMenu().handleContextSplit();

        expect(updateTimeEntry).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'break',
            })
        );
        expect(createTimeEntry).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'break',
            })
        );
    });
});

describe('useContextMenu external calendar events', () => {
    const createTimeEntry = vi.fn().mockResolvedValue(undefined);
    const onCreateEvent = vi.fn();

    const externalEvent: ExternalCalendarEvent = {
        id: 'google-event-1',
        title: 'Sprint planning',
        start: '2026-08-04T10:00:00Z',
        end: '2026-08-04T11:30:00Z',
        isAllDay: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    function contextMenu(matchedId: string | null = externalEvent.id) {
        const menu = useContextMenu({
            calendarSettings: ref({
                snapMinutes: 15,
                startHour: 0,
                endHour: 24,
                slotMinutes: 15,
            }),
            calendarEvents: computed(() => []),
            externalCalendarEvents: () => [externalEvent],
            pixelsToMinutesFromMidnight: () => 0,
            getDayFromClientX: () => null,
            clientYToGridPixels: () => 0,
            createTimeEntry,
            updateTimeEntry: vi.fn().mockResolvedValue(undefined),
            deleteTimeEntry: vi.fn().mockResolvedValue(undefined),
            onEditEvent: vi.fn(),
            onCreateEvent,
            onCreateBreak: vi.fn(),
            emitRefresh: vi.fn(),
        });

        menu.handleCalendarContextMenu({
            target: {
                closest: (selector: string) =>
                    selector === '[data-external-event-id]' && matchedId !== null
                        ? { getAttribute: () => matchedId }
                        : null,
            },
        } as unknown as MouseEvent);

        return menu;
    }

    it('selects the external event that was right clicked', () => {
        expect(contextMenu().contextMenuExternalEvent.value).toEqual(externalEvent);
    });

    it('copies an external event into a work time entry titled with the event', async () => {
        await contextMenu().handleContextCopyExternalEvent();

        expect(createTimeEntry).toHaveBeenCalledWith(
            expect.objectContaining({
                description: 'Sprint planning',
                type: 'work',
                billable: false,
                project_id: null,
                task_id: null,
                tags: [],
            })
        );
        const entry = createTimeEntry.mock.calls[0]![0];
        expect(getDayJsInstance().utc(entry.start).toISOString()).toBe('2026-08-04T10:00:00.000Z');
        expect(getDayJsInstance().utc(entry.end).toISOString()).toBe('2026-08-04T11:30:00.000Z');
    });

    it('opens the prefilled create modal for copy and edit', () => {
        contextMenu().handleContextCopyExternalEventAndEdit();

        expect(onCreateEvent).toHaveBeenCalledTimes(1);
        const [start, end, description] = onCreateEvent.mock.calls[0]!;
        expect(start.toISOString()).toBe('2026-08-04T10:00:00.000Z');
        expect(end.toISOString()).toBe('2026-08-04T11:30:00.000Z');
        expect(description).toBe('Sprint planning');
    });

    it('ignores a right click on an unknown external event', () => {
        const menu = contextMenu('unknown-id');

        expect(menu.contextMenuExternalEvent.value).toBeNull();
    });
});
