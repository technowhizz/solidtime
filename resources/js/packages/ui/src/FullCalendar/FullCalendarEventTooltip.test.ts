import { describe, expect, it } from 'vitest';
import { computed } from 'vue';
import { mount } from '@vue/test-utils';
import FullCalendarEventTooltip from './FullCalendarEventTooltip.vue';
import type { Organization } from '@/packages/api/src';

const LONG_DESCRIPTION =
    'RT-2735 Test sanger ssh access + create ticketing account + create support ticket ' +
    'for no access + reply again + test again';

type OrganizationOverrides = Partial<
    Pick<Organization, 'time_format' | 'interval_format' | 'number_format'>
>;

function mountTooltip(
    props: Partial<InstanceType<typeof FullCalendarEventTooltip>['$props']> = {},
    organization: OrganizationOverrides = {}
) {
    return mount(FullCalendarEventTooltip, {
        props: {
            title: LONG_DESCRIPTION,
            start: '2026-07-14T10:00:00Z',
            end: '2026-07-14T11:30:00Z',
            durationSeconds: 90 * 60,
            ...props,
        },
        global: {
            provide: {
                organization: computed(() => ({
                    time_format: '24-hours',
                    interval_format: 'hours-minutes',
                    number_format: 'point',
                    ...organization,
                })),
            },
        },
    });
}

describe('FullCalendarEventTooltip', () => {
    it('renders the description in full, unclamped', () => {
        const wrapper = mountTooltip();
        const title = wrapper.get('.font-semibold');

        expect(title.text()).toBe(LONG_DESCRIPTION);
        // The event block clamps with -webkit-line-clamp / .fc-event-title; showing the whole
        // description is the entire point of this popup, so neither may leak in here.
        expect(wrapper.html()).not.toContain('fc-event-title');
        expect(title.attributes('style')).toBeUndefined();
    });

    it('renders the time range and the duration', () => {
        const text = mountTooltip().text();

        expect(text).toContain('10:00 - 11:30');
        expect(text).toContain('1h 30min');
    });

    it('renders an open-ended range for a running entry', () => {
        const text = mountTooltip({ end: null }).text();

        expect(text).toContain('10:00 - ...');
    });

    it('respects the organization time format', () => {
        const text = mountTooltip({}, { time_format: '12-hours' }).text();

        expect(text).toContain('10:00 AM - 11:30 AM');
    });

    it('respects the organization interval format', () => {
        const text = mountTooltip({}, { interval_format: 'decimal' }).text();

        expect(text).toContain('1.5 h');
    });

    it('renders the project, task and client when present', () => {
        const text = mountTooltip({
            projectName: 'Acme Redesign',
            taskName: 'Homepage',
            clientName: 'Acme Inc',
        }).text();

        expect(text).toContain('Acme Redesign');
        expect(text).toContain('Homepage');
        expect(text).toContain('Acme Inc');
    });

    it('omits the meta block when there is no project, task or client', () => {
        const wrapper = mountTooltip();

        // Title, then the time/duration row — no meta block in between.
        expect(wrapper.get('[data-testid="calendar_event_tooltip"]').element.children).toHaveLength(
            2
        );
    });
});
