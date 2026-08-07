import type { Dayjs } from 'dayjs';

/**
 * The minimum shape the layout algorithm needs: a start and an end that are already
 * expressed in the timezone the calendar renders its day columns in.
 *
 * Keeping this generic is what lets time entries and read-only overlay lanes (Google
 * Calendar events, and whatever comes after) share one overlap implementation.
 */
export interface LayoutableEvent {
    dayStart: Dayjs;
    dayEnd: Dayjs;
}

export interface PositionedEvent<T extends LayoutableEvent> {
    event: T;
    startMin: number;
    endMin: number;
    isClippedStart: boolean;
    isClippedEnd: boolean;
}

export interface ColumnAssignment<T extends LayoutableEvent> extends PositionedEvent<T> {
    col: number;
}

export interface EventGroup<T extends LayoutableEvent> {
    items: ColumnAssignment<T>[];
    totalCols: number;
}

/** An event resolved to pixel offsets and percentage columns within one day column. */
export interface LaidOutEvent<T extends LayoutableEvent> {
    event: T;
    top: number;
    height: number;
    left: string;
    width: string;
    isClippedStart: boolean;
    isClippedEnd: boolean;
}

/** Clip an event's time range to a single day and the visible hour range. */
export function clipEventToDay<T extends LayoutableEvent>(
    ev: T,
    dayStart: Dayjs,
    dayEnd: Dayjs,
    visibleStartMin: number,
    visibleEndMin: number,
    timeToMinutesFromMidnight: (time: Dayjs) => number
): PositionedEvent<T> {
    const isClippedStart = ev.dayStart.isBefore(dayStart);
    const isClippedEnd = ev.dayEnd.isAfter(dayEnd);

    let evStartMin = isClippedStart ? 0 : timeToMinutesFromMidnight(ev.dayStart);
    let evEndMin = isClippedEnd ? 24 * 60 : timeToMinutesFromMidnight(ev.dayEnd);

    evStartMin = Math.max(evStartMin, visibleStartMin);
    evEndMin = Math.min(evEndMin, visibleEndMin);

    if (evEndMin <= evStartMin) {
        evEndMin = evStartMin + 1;
    }

    return { event: ev, startMin: evStartMin, endMin: evEndMin, isClippedStart, isClippedEnd };
}

/** Greedily assign each event to the first column where it fits without overlap. */
export function assignColumns<T extends LayoutableEvent>(
    positioned: PositionedEvent<T>[]
): ColumnAssignment<T>[] {
    const columns: PositionedEvent<T>[][] = [];
    const result: ColumnAssignment<T>[] = [];

    for (const item of positioned) {
        let placed = false;
        for (let c = 0; c < columns.length; c++) {
            const lastInCol = columns[c]![columns[c]!.length - 1]!;
            if (lastInCol.endMin <= item.startMin) {
                columns[c]!.push(item);
                result.push({ ...item, col: c });
                placed = true;
                break;
            }
        }
        if (!placed) {
            columns.push([item]);
            result.push({ ...item, col: columns.length - 1 });
        }
    }

    return result;
}

/** Group events that transitively overlap so each group shares column count. */
export function groupOverlappingEvents<T extends LayoutableEvent>(
    eventColumns: ColumnAssignment<T>[]
): EventGroup<T>[] {
    const groups: EventGroup<T>[] = [];
    const assigned = new Set<number>();

    for (let i = 0; i < eventColumns.length; i++) {
        if (assigned.has(i)) continue;

        const group = [eventColumns[i]!];
        assigned.add(i);

        let expanded = true;
        while (expanded) {
            expanded = false;
            for (let j = 0; j < eventColumns.length; j++) {
                if (assigned.has(j)) continue;
                const candidate = eventColumns[j]!;
                for (const member of group) {
                    if (candidate.startMin < member.endMin && candidate.endMin > member.startMin) {
                        group.push(candidate);
                        assigned.add(j);
                        expanded = true;
                        break;
                    }
                }
            }
        }

        let maxCol = 0;
        for (const item of group) {
            if (item.col > maxCol) maxCol = item.col;
        }
        groups.push({ items: group, totalCols: maxCol + 1 });
    }

    return groups;
}

/** Convert column-assigned groups into pixel-positioned events. */
export function groupsToLaidOutEvents<T extends LayoutableEvent>(
    groups: EventGroup<T>[],
    visibleStartMin: number,
    minutesToPixels: (minutes: number) => number
): LaidOutEvent<T>[] {
    const result: LaidOutEvent<T>[] = [];
    for (const group of groups) {
        for (const item of group.items) {
            const top = minutesToPixels(item.startMin - visibleStartMin);
            const height = minutesToPixels(item.endMin - item.startMin);
            result.push({
                event: item.event,
                top,
                height: Math.max(height, 1),
                left: `${(item.col / group.totalCols) * 100}%`,
                width: `${(1 / group.totalCols) * 100}%`,
                isClippedStart: item.isClippedStart,
                isClippedEnd: item.isClippedEnd,
            });
        }
    }
    return result;
}

/** Compute positioned events for a single day. */
export function layoutDayEvents<T extends LayoutableEvent>(
    dayEvents: T[],
    dayStart: Dayjs,
    dayEnd: Dayjs,
    visibleStartMin: number,
    visibleEndMin: number,
    timeToMinutesFromMidnight: (time: Dayjs) => number,
    minutesToPixels: (minutes: number) => number
): LaidOutEvent<T>[] {
    const positioned = dayEvents.map((ev) =>
        clipEventToDay(
            ev,
            dayStart,
            dayEnd,
            visibleStartMin,
            visibleEndMin,
            timeToMinutesFromMidnight
        )
    );

    // Sort: earliest start first, then longest duration first (for stable column assignment)
    positioned.sort((a, b) => {
        if (a.startMin !== b.startMin) return a.startMin - b.startMin;
        return b.endMin - b.startMin - (a.endMin - a.startMin);
    });

    const eventColumns = assignColumns(positioned);
    const groups = groupOverlappingEvents(eventColumns);
    return groupsToLaidOutEvents(groups, visibleStartMin, minutesToPixels);
}
