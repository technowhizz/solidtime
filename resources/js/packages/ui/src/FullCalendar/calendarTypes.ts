import type { TimeEntry, Project, Client, Task } from '@/packages/api/src';
import type { Dayjs } from 'dayjs';
import type { ActivityPeriod } from './activityTypes';
import type { LaidOutEvent } from './eventLayout';

export const DRAG_THRESHOLD = 5;
export const TIME_AXIS_WIDTH = 48;

export interface CalendarEvent {
    id: string;
    timeEntry: TimeEntry;
    project?: Project;
    client?: Client;
    task?: Task;
    isRunning: boolean;
    isBreak: boolean;
    isMisplacedBreak: boolean;
    durationMinutes: number;
    title: string;
    backgroundColor: string;
    borderColor: string;
    dayStart: Dayjs;
    dayEnd: Dayjs;
}

export type DayEvent = LaidOutEvent<CalendarEvent>;

export interface ActivityBox {
    dateStr: string;
    top: number;
    height: number;
    isIdle: boolean;
    period: ActivityPeriod;
}
