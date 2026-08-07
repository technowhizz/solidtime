import { PLAYWRIGHT_BASE_URL } from '../playwright/config';
import { test } from '../playwright/fixtures';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createTimeEntryWithTimestampsViaApi } from './utils/api';

interface StubbedEvent {
    id: string;
    title: string;
    start: string;
    end: string;
    is_all_day: boolean;
    html_link: string | null;
}

function todayStr(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** An ISO timestamp for a wall-clock time today, in the format the API expects. */
function todayAt(hour: number, minute: number = 0): string {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
    return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * The day after today. Used to land a time entry on a day that has no external event,
 * which is where the lane has to be reserved anyway.
 */
function tomorrow(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
}

function tomorrowStr(): string {
    const d = tomorrow();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function tomorrowAt(hour: number, minute: number = 0): string {
    const d = tomorrow();
    d.setHours(hour, minute, 0, 0);
    return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function googleEvent(overrides: Partial<StubbedEvent> = {}): StubbedEvent {
    return {
        id: 'google-event-1',
        title: 'Sprint planning',
        start: todayAt(10),
        end: todayAt(11),
        is_all_day: false,
        html_link: 'https://calendar.google.com/event?eid=1',
        ...overrides,
    };
}

/**
 * Stubs solidtime's own Google Calendar endpoints. Google is never contacted from the
 * browser, so this exercises the real query and rendering path without a real account.
 */
async function stubGoogleCalendar(
    page: Page,
    options: { connected?: boolean; events?: StubbedEvent[] } = {}
) {
    const connected = options.connected ?? true;
    const events = options.events ?? [];

    await page.route('**/api/v1/users/me/google-calendar', async (route) => {
        if (route.request().method() === 'DELETE') {
            await route.fulfill({ status: 204, body: '' });
            return;
        }
        await route.fulfill({
            json: {
                data: {
                    is_connected: connected,
                    email: connected ? 'calendar-owner@example.com' : null,
                    requires_reauthentication: false,
                    connected_at: connected ? todayAt(0) : null,
                },
            },
        });
    });

    await page.route('**/api/v1/users/me/google-calendar/events*', async (route) => {
        await route.fulfill({ json: { data: events } });
    });
}

async function goToCalendar(page: Page) {
    await page.goto(PLAYWRIGHT_BASE_URL + '/calendar');
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });
}

async function scrollCalendarToTime(page: Page, time: string) {
    await page.evaluate((t) => {
        const slot = document.querySelector(`.fc-timegrid-slot-lane[data-time="${t}"]`);
        if (slot) slot.scrollIntoView({ block: 'start' });
    }, time);
    await page.waitForTimeout(300);
}

function externalEvents(page: Page) {
    return page.locator('[data-external-event-id]');
}

test.describe('Google Calendar events on the calendar', () => {
    test('renders external events in a lane on the right of the day column', async ({ page }) => {
        await stubGoogleCalendar(page, { events: [googleEvent()] });
        await goToCalendar(page);
        await scrollCalendarToTime(page, '09:00:00');

        const event = externalEvents(page).first();
        await expect(event).toBeVisible({ timeout: 10000 });
        await expect(event).toContainText('Sprint planning');

        const column = page.locator(`.fc-timegrid-col[data-date="${todayStr()}"]`);
        const columnBox = (await column.boundingBox())!;
        const eventBox = (await event.boundingBox())!;

        // The lane sits in the right hand part of the column
        expect(eventBox.x).toBeGreaterThan(columnBox.x + columnBox.width / 2);
        expect(eventBox.x + eventBox.width).toBeLessThanOrEqual(columnBox.x + columnBox.width + 1);

        // ...and takes roughly a quarter of it, leaving three quarters to the time entries
        expect(eventBox.width).toBeGreaterThan(columnBox.width * 0.2);
        expect(eventBox.width).toBeLessThan(columnBox.width * 0.3);

        // A dashed divider separates the lane from the time entries
        const divider = page.locator('.fc-external-lane-divider').first();
        const style = await divider.evaluate((el) => {
            const s = getComputedStyle(el);
            return { width: s.borderLeftWidth, style: s.borderLeftStyle };
        });
        expect(style.width).toBe('1px');
        expect(style.style).toBe('dashed');
    });

    test('draws the divider on every day column, not only days that have events', async ({
        page,
    }) => {
        // A single event, on today only
        await stubGoogleCalendar(page, { events: [googleEvent()] });
        await goToCalendar(page);
        await scrollCalendarToTime(page, '09:00:00');

        await expect(externalEvents(page)).toHaveCount(1, { timeout: 10000 });

        const dayColumns = await page.locator('.fc-timegrid-col[data-date]').count();
        expect(dayColumns).toBeGreaterThan(1);
        await expect(page.locator('.fc-external-lane-divider')).toHaveCount(dayColumns);
    });

    test('insets time entries on every day once the lane is in use', async ({ page, ctx }) => {
        // The entry is on a day with no external event of its own
        await createTimeEntryWithTimestampsViaApi(ctx, {
            description: 'Other day work',
            start: tomorrowAt(10),
            end: tomorrowAt(11),
        });
        await stubGoogleCalendar(page, { events: [googleEvent()] });
        await goToCalendar(page);
        await scrollCalendarToTime(page, '09:00:00');

        const timeEntry = page.locator('.fc-event').filter({ hasText: 'Other day work' }).first();
        await expect(timeEntry).toBeVisible({ timeout: 10000 });

        const columnBox = (await page
            .locator(`.fc-timegrid-col[data-date="${tomorrowStr()}"]`)
            .boundingBox())!;
        const entryBox = (await timeEntry.boundingBox())!;

        // Inset to three quarters even though this day has no external event
        expect(entryBox.width).toBeLessThan(columnBox.width * 0.8);
        expect(entryBox.width).toBeGreaterThan(columnBox.width * 0.7);
    });

    test('time entries are inset so they do not overlap the external event lane', async ({
        page,
        ctx,
    }) => {
        await createTimeEntryWithTimestampsViaApi(ctx, {
            description: 'Existing work',
            start: todayAt(10),
            end: todayAt(11),
        });
        await stubGoogleCalendar(page, { events: [googleEvent()] });
        await goToCalendar(page);
        await scrollCalendarToTime(page, '09:00:00');

        const timeEntry = page.locator('.fc-event').filter({ hasText: 'Existing work' }).first();
        await expect(timeEntry).toBeVisible({ timeout: 10000 });
        const externalEvent = externalEvents(page).first();
        await expect(externalEvent).toBeVisible();

        const entryBox = (await timeEntry.boundingBox())!;
        const externalBox = (await externalEvent.boundingBox())!;
        const columnBox = (await page
            .locator(`.fc-timegrid-col[data-date="${todayStr()}"]`)
            .boundingBox())!;

        // The time entry ends before the lane begins, so the two never overlap
        expect(entryBox.x + entryBox.width).toBeLessThanOrEqual(externalBox.x + 1);
        // It still keeps about three quarters of the column
        expect(entryBox.width).toBeGreaterThan(columnBox.width * 0.7);
    });

    test('time entries keep the full column when the lane is not in use', async ({ page, ctx }) => {
        await createTimeEntryWithTimestampsViaApi(ctx, {
            description: 'Unaffected work',
            start: todayAt(10),
            end: todayAt(11),
        });
        await stubGoogleCalendar(page, { events: [] });
        await goToCalendar(page);
        await scrollCalendarToTime(page, '09:00:00');

        const timeEntry = page.locator('.fc-event').filter({ hasText: 'Unaffected work' }).first();
        await expect(timeEntry).toBeVisible({ timeout: 10000 });

        const column = page.locator(`.fc-timegrid-col[data-date="${todayStr()}"]`);
        const columnBox = (await column.boundingBox())!;
        const entryBox = (await timeEntry.boundingBox())!;

        // Without a lane the entry uses nearly the whole column width
        expect(entryBox.width).toBeGreaterThan(columnBox.width * 0.9);
    });

    test('does not draw all-day events, they have no position on the grid', async ({ page }) => {
        await stubGoogleCalendar(page, {
            events: [
                googleEvent({
                    id: 'all-day-event',
                    title: 'Company offsite',
                    is_all_day: true,
                }),
                googleEvent({ id: 'timed-event', title: 'Sprint planning' }),
            ],
        });
        await goToCalendar(page);
        await scrollCalendarToTime(page, '09:00:00');

        await expect(externalEvents(page).first()).toBeVisible({ timeout: 10000 });
        await expect(externalEvents(page)).toHaveCount(1);
        await expect(page.locator('[data-external-event-id="all-day-event"]')).toHaveCount(0);
        await expect(page.locator('[data-external-event-id="timed-event"]')).toHaveCount(1);
    });

    test('shows no lane when no Google account is connected', async ({ page }) => {
        await stubGoogleCalendar(page, { connected: false, events: [googleEvent()] });
        await goToCalendar(page);
        await page.waitForTimeout(1000);

        await expect(externalEvents(page)).toHaveCount(0);
    });

    test('hovering an external event reveals the copy button', async ({ page }) => {
        await stubGoogleCalendar(page, { events: [googleEvent()] });
        await goToCalendar(page);
        await scrollCalendarToTime(page, '09:00:00');

        const event = externalEvents(page).first();
        await expect(event).toBeVisible({ timeout: 10000 });
        const copyButton = event.getByRole('button', { name: 'Copy as time entry' });

        expect(await copyButton.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');

        await event.hover();
        await expect
            .poll(async () => copyButton.evaluate((el) => getComputedStyle(el).opacity))
            .toBe('1');
    });

    test('clicking the copy button creates a time entry titled with the event', async ({
        page,
    }) => {
        await stubGoogleCalendar(page, { events: [googleEvent()] });
        await goToCalendar(page);
        await scrollCalendarToTime(page, '09:00:00');

        const event = externalEvents(page).first();
        await expect(event).toBeVisible({ timeout: 10000 });

        const createRequest = page.waitForRequest(
            (request) => request.url().includes('/time-entries') && request.method() === 'POST'
        );

        await event.hover();
        await event.getByRole('button', { name: 'Copy as time entry' }).click();

        const request = await createRequest;
        const body = request.postDataJSON();
        expect(body.description).toBe('Sprint planning');
        expect(body.type).toBe('work');
        expect(body.billable).toBe(false);
        expect(new Date(body.start).toISOString()).toBe(new Date(todayAt(10)).toISOString());
        expect(new Date(body.end).toISOString()).toBe(new Date(todayAt(11)).toISOString());

        await expect(
            page.locator('.fc-event').filter({ hasText: 'Sprint planning' }).first()
        ).toBeVisible({ timeout: 10000 });
    });

    test('right click offers copy as time entry', async ({ page }) => {
        await stubGoogleCalendar(page, { events: [googleEvent()] });
        await goToCalendar(page);
        await scrollCalendarToTime(page, '09:00:00');

        const event = externalEvents(page).first();
        await expect(event).toBeVisible({ timeout: 10000 });

        const createRequest = page.waitForRequest(
            (request) => request.url().includes('/time-entries') && request.method() === 'POST'
        );

        await event.click({ button: 'right' });
        await expect(page.getByRole('menu')).toBeVisible();
        await page.getByRole('menuitem', { name: 'Copy as time entry' }).click();

        const request = await createRequest;
        expect(request.postDataJSON().description).toBe('Sprint planning');
    });

    test('right click copy and edit opens the create modal prefilled with the event title', async ({
        page,
    }) => {
        await stubGoogleCalendar(page, { events: [googleEvent()] });
        await goToCalendar(page);
        await scrollCalendarToTime(page, '09:00:00');

        const event = externalEvents(page).first();
        await expect(event).toBeVisible({ timeout: 10000 });

        await event.click({ button: 'right' });
        await expect(page.getByRole('menu')).toBeVisible();
        await page.getByRole('menuitem', { name: 'Copy and edit…' }).click();

        const description = page.getByLabel('Description');
        await expect(description).toBeVisible();
        await expect(description).toHaveValue('Sprint planning');
    });

    test('lays overlapping external events out side by side', async ({ page }) => {
        await stubGoogleCalendar(page, {
            events: [
                googleEvent({
                    id: 'event-a',
                    title: 'Standup',
                    start: todayAt(10),
                    end: todayAt(11),
                }),
                googleEvent({
                    id: 'event-b',
                    title: 'Design review',
                    start: todayAt(10, 30),
                    end: todayAt(11, 30),
                }),
            ],
        });
        await goToCalendar(page);
        await scrollCalendarToTime(page, '09:00:00');

        await expect(externalEvents(page)).toHaveCount(2, { timeout: 10000 });

        const first = (await page.locator('[data-external-event-id="event-a"]').boundingBox())!;
        const second = (await page.locator('[data-external-event-id="event-b"]').boundingBox())!;

        expect(first.x + first.width).toBeLessThanOrEqual(second.x + 1);
    });
});
