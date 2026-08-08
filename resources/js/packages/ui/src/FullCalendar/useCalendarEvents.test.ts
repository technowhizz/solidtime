import { computed, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import chroma from 'chroma-js';
import type { Client, Project, Task, TimeEntry } from '@/packages/api/src';
import { DEFAULT_PIXELS_PER_HOUR, type CalendarSettings } from './calendarSettings';
import { useCalendarEvents } from './useCalendarEvents';
import { getLocalizedDayJs } from '../utils/time';

const LIGHT_BACKGROUND = '#f5f5f5';
const DARK_BACKGROUND = 'oklch(0.14 0 0)';

const SETTINGS: CalendarSettings = {
    snapMinutes: 15,
    startHour: 0,
    endHour: 24,
    slotMinutes: 15,
    // Required, and easy to forget in a literal — every pixel conversion divides by it.
    pixelsPerHour: DEFAULT_PIXELS_PER_HOUR,
};

function timeEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
    return {
        id: 'entry-1',
        start: '2026-08-07T09:00:00Z',
        end: '2026-08-07T10:00:00Z',
        project_id: null,
        task_id: null,
        description: 'Some work',
        type: 'regular',
        ...overrides,
    } as TimeEntry;
}

function project(color: string): Project {
    return { id: 'project-1', name: 'Design', color, client_id: null } as Project;
}

function events(options: { entries: TimeEntry[]; projects?: Project[]; cssBackground?: string }) {
    const currentTime = ref(getLocalizedDayJs('2026-08-07T12:00:00Z'));
    const { calendarEvents } = useCalendarEvents({
        timeEntries: () => options.entries,
        projects: () => options.projects ?? [],
        clients: () => [] as Client[],
        tasks: () => [] as Task[],
        calendarSettings: ref(SETTINGS),
        viewDays: computed(() => [currentTime.value.startOf('day')]),
        currentTime,
        cssBackground: ref(options.cssBackground ?? LIGHT_BACKGROUND),
        minutesToPixels: (minutes: number) => minutes,
        timeToMinutesFromMidnight: (time) => time.hour() * 60 + time.minute(),
    });
    return calendarEvents.value;
}

/** The expression this composable used before colors could carry an alpha channel. */
function legacyColors(baseColor: string, background: string, isBreak: boolean) {
    return {
        backgroundColor: chroma.mix(baseColor, background, isBreak ? 0.75 : 0.65, 'lab').hex(),
        borderColor: chroma.mix(baseColor, background, 0.5, 'lab').hex(),
    };
}

describe('useCalendarEvents colors', () => {
    beforeEach(() => {
        window.getNoProjectColorSetting = vi.fn(() => '#6b7280');
    });

    it('uses the project color when the entry has a project', () => {
        const [event] = events({
            entries: [timeEntry({ project_id: 'project-1' })],
            projects: [project('#ef5350')],
        });

        expect(event).toMatchObject(legacyColors('#ef5350', LIGHT_BACKGROUND, false));
    });

    it('is byte identical to the pre-alpha expression for an opaque project color', () => {
        const [event] = events({
            entries: [timeEntry({ project_id: 'project-1' })],
            projects: [project('#26a69a')],
        });

        // Pinned rather than computed, so a future refactor of the mix cannot quietly agree
        // with itself and still change what users see. These are the values the expression
        // produced before flattenColor was introduced.
        expect(event?.backgroundColor).toBe('#b6dad4');
        expect(event?.borderColor).toBe('#9bcec6');
    });

    it('falls back to the no project color when the entry has no project', () => {
        const [event] = events({ entries: [timeEntry()] });

        expect(event).toMatchObject(legacyColors('#6b7280', LIGHT_BACKGROUND, false));
    });

    it('honours the user setting for the no project color', () => {
        window.getNoProjectColorSetting = vi.fn(() => '#ff7043');

        const [event] = events({ entries: [timeEntry()] });

        expect(event).toMatchObject(legacyColors('#ff7043', LIGHT_BACKGROUND, false));
    });

    it('keeps the break color regardless of the no project setting', () => {
        window.getNoProjectColorSetting = vi.fn(() => '#ff7043');

        const [event] = events({ entries: [timeEntry({ type: 'break' })] });

        expect(event?.isBreak).toBe(true);
        expect(event).toMatchObject(legacyColors('#f59e0b', LIGHT_BACKGROUND, true));
    });

    it('emits an opaque color for a project color with an alpha channel', () => {
        const [event] = events({
            entries: [timeEntry({ project_id: 'project-1' })],
            projects: [project('#ef535080')],
        });

        expect(event?.backgroundColor).toHaveLength(7);
        expect(event?.borderColor).toHaveLength(7);
    });

    it('renders a translucent project color fainter than an opaque one', () => {
        const opaque = events({
            entries: [timeEntry({ project_id: 'project-1' })],
            projects: [project('#ef5350')],
        })[0];
        const translucent = events({
            entries: [timeEntry({ project_id: 'project-1' })],
            projects: [project('#ef535033')],
        })[0];

        const distanceFromBackground = (color: string) =>
            chroma.distance(color, LIGHT_BACKGROUND, 'lab');

        expect(distanceFromBackground(translucent!.backgroundColor)).toBeLessThan(
            distanceFromBackground(opaque!.backgroundColor)
        );
    });

    it('mixes toward the live theme background, so one stored color suits both themes', () => {
        const onLight = events({
            entries: [timeEntry({ project_id: 'project-1' })],
            projects: [project('#ef5350')],
            cssBackground: LIGHT_BACKGROUND,
        })[0];
        const onDark = events({
            entries: [timeEntry({ project_id: 'project-1' })],
            projects: [project('#ef5350')],
            cssBackground: DARK_BACKGROUND,
        })[0];

        expect(onLight?.backgroundColor).not.toBe(onDark?.backgroundColor);
        expect(chroma(onLight!.backgroundColor).luminance()).toBeGreaterThan(
            chroma(onDark!.backgroundColor).luminance()
        );
    });
});
