import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { computed } from 'vue';
import CalendarDayColumn from './CalendarDayColumn.vue';
import { getLocalizedDayJs } from '../utils/time';
import type { DayEvent } from './calendarTypes';
import type { TimeEntry } from '@/packages/api/src';

const DAY = '2026-07-14';

/*
 * The event block is wrapped in a Reka `TooltipTrigger as-child`, which clones the vnode and
 * merges props onto it. These tests pin the two things that would silently break if that
 * merge ever stopped behaving: the drag/click handler must survive, and no wrapper element
 * may appear between the inset container and the absolutely-positioned block.
 */
function dayEvent(): DayEvent {
    const timeEntry = {
        id: 'entry-1',
        start: '2026-07-14T10:00:00Z',
        end: '2026-07-14T11:00:00Z',
        description: 'Render test entry',
    } as TimeEntry;

    return {
        event: {
            id: 'entry-1',
            timeEntry,
            isRunning: false,
            isBreak: false,
            isMisplacedBreak: false,
            durationMinutes: 60,
            title: 'Render test entry',
            backgroundColor: '#cccccc',
            borderColor: '#999999',
            dayStart: getLocalizedDayJs(timeEntry.start),
            dayEnd: getLocalizedDayJs(timeEntry.end),
        },
        top: 100,
        height: 50,
        left: '0%',
        width: '100%',
        isClippedStart: false,
        isClippedEnd: false,
    };
}

function mountColumn() {
    return mount(CalendarDayColumn, {
        props: {
            dayStr: DAY,
            totalGridHeight: 1200,
            hasActivityStatus: false,
            showExternalLane: false,
            dayEvents: [dayEvent()],
            getEventStyle: () => ({
                position: 'absolute',
                top: '100px',
                height: '50px',
                left: '0%',
                width: '100%',
            }),
            getEventOpacityClass: () => 'opacity-90',
            getEventDurationSeconds: () => 3600,
            suppressEventTooltips: false,
            isDragging: false,
            dragEventId: null,
            dragPreview: undefined,
            resizeEventId: null,
            resizeCrossDayPreview: undefined,
            showNowIndicator: false,
            nowIndicatorTop: 0,
            activityBoxes: [],
            getActivityBoxLabel: () => '',
            getActivityBoxActivities: () => [],
            getActivityPercentage: () => '0',
            getActivityText: () => '',
            getTopActivity: () => null,
            isDayView: false,
            externalEventBoxes: [],
            showSelection: false,
            isSelectionStart: false,
            isSelectionIntermediate: false,
            isSelectionEnd: false,
            selectionTop: 0,
            selectionHeight: 0,
            selectionEndTop: 0,
            selectionEndHeight: 0,
            showSelectionLabels: false,
            selectionRangeLabel: null,
            selectionDurationLabel: null,
        },
        global: {
            provide: {
                organization: computed(() => ({
                    time_format: '24-hours',
                    interval_format: 'hours-minutes',
                    number_format: 'point',
                })),
            },
        },
    });
}

describe('CalendarDayColumn event blocks', () => {
    it('still emits event-pointerdown from the block itself', async () => {
        const wrapper = mountColumn();

        await wrapper.get('.fc-event').trigger('pointerdown');

        expect(wrapper.emitted('event-pointerdown')).toHaveLength(1);
    });

    it('keeps the block a direct child of the inset container, absolutely positioned', () => {
        const wrapper = mountColumn();

        expect(wrapper.findAll('.fc-event')).toHaveLength(1);

        const event = wrapper.get('.fc-event');
        expect(event.attributes('data-event-id')).toBe('entry-1');
        expect(event.attributes('style')).toContain('position: absolute');
        expect(event.element.parentElement?.classList.contains('absolute')).toBe(true);
    });

    it('merges the tooltip trigger onto the block rather than a wrapper', () => {
        const wrapper = mountColumn();

        expect(wrapper.get('.fc-event').attributes('data-grace-area-trigger')).toBeDefined();
    });

    it('does not start a drag when the pointer lands on a resizer', async () => {
        const wrapper = mountColumn();

        await wrapper.get('.fc-event-resizer-end').trigger('pointerdown');

        expect(wrapper.emitted('resizer-pointerdown')).toHaveLength(1);
        expect(wrapper.emitted('event-pointerdown')).toBeUndefined();
    });
});
