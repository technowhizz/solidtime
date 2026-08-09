import { test, expect } from '../playwright/fixtures';
import { PLAYWRIGHT_BASE_URL } from '../playwright/config';
import {
    setupTestContext,
    createTimeEntryWithTimestampsViaApi,
    type TestContext,
} from './utils/api';
import { scrollIntoViewCentred } from './utils/scroll';
import type { Page } from '@playwright/test';

/*
 * These cover everything that does not need a live Jira: the not-configured state, the
 * organization setting, credential validation and the indicators. Anything that would write a
 * worklog is covered by the PHP suite against a faked Jira instead.
 */

const SITE_URL = 'https://acme.atlassian.net';

async function setJiraSiteUrl(ctx: TestContext, siteUrl: string | null) {
    const response = await ctx.request.put(
        `${PLAYWRIGHT_BASE_URL}/api/v1/organizations/${ctx.orgId}`,
        { data: { jira_site_url: siteUrl } }
    );
    expect(response.status()).toBe(200);
}

function jiraSection(page: Page) {
    return page
        .getByRole('heading', { name: 'Jira', exact: true })
        .locator('xpath=ancestor::*[descendant::*[@data-testid]][1]');
}

test('test that the jira card is hidden until an admin configures a site', async ({ page }) => {
    // Arrange
    await setupTestContext(page);

    // Act
    await page.goto(PLAYWRIGHT_BASE_URL + '/user/profile');

    // Assert
    await expect(page.getByRole('heading', { name: 'Jira', exact: true })).toHaveCount(0);
});

test('test that an admin can set and clear the organization jira site', async ({ page }) => {
    // Arrange
    const ctx = await setupTestContext(page);
    await page.goto(PLAYWRIGHT_BASE_URL + '/teams/' + ctx.orgId);

    // Act
    const siteUrlInput = page.getByTestId('organization_jira_site_url');
    await expect(siteUrlInput).toBeEditable();
    await siteUrlInput.fill(SITE_URL);
    await page.getByTestId('organization_jira_submit').click();

    // Assert
    await page.reload();
    await expect(page.getByTestId('organization_jira_site_url')).toHaveValue(SITE_URL);

    // Act: clearing it turns the integration off again
    await page.getByTestId('organization_jira_site_url').fill('');
    await page.getByTestId('organization_jira_submit').click();
    await page.reload();

    // Assert
    await expect(page.getByTestId('organization_jira_site_url')).toHaveValue('');
});

test('test that a plain http jira site is rejected', async ({ page }) => {
    // Arrange
    const ctx = await setupTestContext(page);

    // Act
    // The API token travels on every request, so plaintext must not be accepted
    const response = await ctx.request.put(
        `${PLAYWRIGHT_BASE_URL}/api/v1/organizations/${ctx.orgId}`,
        { data: { jira_site_url: 'http://acme.atlassian.net' } }
    );

    // Assert
    expect(response.status()).toBe(422);
});

test('test that the jira card asks for credentials once a site is configured', async ({ page }) => {
    // Arrange
    const ctx = await setupTestContext(page);
    await setJiraSiteUrl(ctx, SITE_URL);

    // Act
    await page.goto(PLAYWRIGHT_BASE_URL + '/user/profile');

    // Assert
    await expect(page.getByTestId('jira_email')).toBeVisible();
    await expect(page.getByTestId('jira_api_token')).toBeVisible();
    // Nothing to disconnect, and no sync cutoff, until an account is actually linked
    await expect(page.getByTestId('jira_disconnect')).toHaveCount(0);
    await expect(page.getByTestId('jira_sync_from_date')).toHaveCount(0);
    // The missing-ticket toggle is not gated on a connection - it needs no Jira account
    await expect(page.getByTestId('jira_missing_ticket_toggle')).toBeVisible();
});

test('test that the connect button stays disabled until both fields are filled', async ({
    page,
}) => {
    // Arrange
    const ctx = await setupTestContext(page);
    await setJiraSiteUrl(ctx, SITE_URL);
    await page.goto(PLAYWRIGHT_BASE_URL + '/user/profile');

    // Act & Assert
    const connect = page.getByTestId('jira_connect');
    await expect(connect).toBeDisabled();

    await page.getByTestId('jira_email').fill('sam@acme.test');
    await expect(connect).toBeDisabled();

    await page.getByTestId('jira_api_token').fill('a-token');
    await expect(connect).toBeEnabled();
});

test('test that the jira sync button is disabled until an account is connected', async ({
    page,
}) => {
    // Arrange
    const ctx = await setupTestContext(page);
    await setJiraSiteUrl(ctx, SITE_URL);

    // Act
    await page.goto(PLAYWRIGHT_BASE_URL + '/calendar');

    // Assert
    await expect(page.getByTestId('jira_sync_button')).toBeVisible();
    await expect(page.getByTestId('jira_sync_button')).toBeDisabled();
});

test('test that hovering the disabled jira button explains why', async ({ page }) => {
    // Arrange
    // The button's base class sets disabled:pointer-events-none, so this only works because the
    // trigger is a wrapping span rather than the button itself
    const ctx = await setupTestContext(page);
    await setJiraSiteUrl(ctx, SITE_URL);
    await page.goto(PLAYWRIGHT_BASE_URL + '/calendar');
    await expect(page.getByTestId('jira_sync_button')).toBeDisabled();

    // Act
    await page.getByTestId('jira_sync_button').hover({ force: true });

    // Assert
    await expect(page.getByTestId('jira_sync_button_tooltip').first()).toContainText(
        'Connect your Jira account'
    );
});

/*
 * Regression: the red dot used to be fetched from the server, so an entry created or edited in
 * the app kept its old dot until the status query happened to refetch - in practice until the
 * page was reloaded. Nothing here reloads, deliberately. If the dots ever go back to being
 * server-derived without invalidation, this fails.
 */
test('test that the missing ticket dot updates without a reload when entries change', async ({
    page,
}) => {
    // Arrange
    const ctx = await setupTestContext(page);
    await setJiraSiteUrl(ctx, SITE_URL);
    await page.addInitScript(() =>
        window.localStorage.setItem('solidtime:jira-missing-ticket-hints', 'true')
    );
    const today = new Date().toISOString().slice(0, 10);
    await createTimeEntryWithTimestampsViaApi(ctx, {
        start: `${today}T09:00:00Z`,
        end: `${today}T10:00:00Z`,
        description: 'PROJ-1 anchor entry',
    });

    await page.goto(PLAYWRIGHT_BASE_URL + '/calendar');
    const anchor = page.locator('.fc-event').filter({ hasText: 'PROJ-1 anchor entry' }).first();
    await scrollIntoViewCentred(anchor);
    await expect(anchor).toBeVisible();

    const missingDots = page
        .getByTestId('sync_indicator_missing-reference')
        .locator('visible=true');
    // The anchor has a ticket, so nothing is marked yet
    await expect(missingDots).toHaveCount(0);

    // Act: create an entry with no ticket, from the calendar's own context menu
    const box = await anchor.boundingBox();
    expect(box).not.toBeNull();
    const clickY = box!.y + box!.height + 20;
    expect(clickY).toBeLessThan(page.viewportSize()!.height);
    await page.mouse.click(box!.x + box!.width / 2, clickY, { button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await page.getByRole('menuitem', { name: 'Create Time Entry' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.locator('#description').fill('brand new entry with no ticket');
    await page.getByRole('button', { name: 'Create Time Entry' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Assert: the dot is there straight away, with no navigation of any kind
    await expect(
        page.locator('.fc-event').filter({ hasText: 'brand new entry with no ticket' }).first()
    ).toBeVisible();
    await expect(missingDots).toHaveCount(1);

    // Act: give it a ticket by editing it
    await page
        .locator('.fc-event')
        .filter({ hasText: 'brand new entry with no ticket' })
        .first()
        .click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.locator('#description').fill('OPS-9 now it has a ticket');
    await page.getByRole('button', { name: 'Update Time Entry' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Assert: and the dot clears itself, again without a reload
    await expect(
        page.locator('.fc-event').filter({ hasText: 'OPS-9 now it has a ticket' }).first()
    ).toBeVisible();
    await expect(missingDots).toHaveCount(0);
});

test('test that the missing ticket dot updates without a reload in the time list', async ({
    page,
}) => {
    // Arrange
    const ctx = await setupTestContext(page);
    await setJiraSiteUrl(ctx, SITE_URL);
    await page.addInitScript(() =>
        window.localStorage.setItem('solidtime:jira-missing-ticket-hints', 'true')
    );
    const today = new Date().toISOString().slice(0, 10);
    await createTimeEntryWithTimestampsViaApi(ctx, {
        start: `${today}T09:00:00Z`,
        end: `${today}T10:00:00Z`,
        description: 'PROJ-1 has a ticket',
    });
    await page.goto(PLAYWRIGHT_BASE_URL + '/time');

    const missingDots = page
        .getByTestId('sync_indicator_missing-reference')
        .locator('visible=true');
    await expect(page.getByTestId('time_entry_row').first()).toBeVisible();
    await expect(missingDots).toHaveCount(0);

    // Act: take the ticket back out, in place
    await page.getByTestId('time_entry_row').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.locator('#description').fill('ticket removed');
    await page.getByRole('button', { name: 'Update Time Entry' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Assert
    await expect(missingDots).toHaveCount(1);
});

test('test that the edit dialog shows the detected ticket and follows the description', async ({
    page,
}) => {
    // Arrange
    const ctx = await setupTestContext(page);
    await setJiraSiteUrl(ctx, SITE_URL);
    // The box only appears for someone who has opted in - here, via the missing-ticket dots
    await page.addInitScript(() =>
        window.localStorage.setItem('solidtime:jira-missing-ticket-hints', 'true')
    );
    const today = new Date().toISOString().slice(0, 10);
    await createTimeEntryWithTimestampsViaApi(ctx, {
        start: `${today}T09:00:00Z`,
        end: `${today}T11:00:00Z`,
        description: 'PROJ-42 fix the login redirect',
    });
    await page.goto(PLAYWRIGHT_BASE_URL + '/time');

    // Act
    await page.getByTestId('time_entry_row').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Assert
    await expect(page.getByTestId('time_entry_external_reference')).toHaveText('PROJ-42');

    // Act: the badge tracks the description as it is typed, so a fix is confirmed immediately
    await page.locator('#description').fill('no ticket in here now');

    // Assert
    await expect(page.getByTestId('time_entry_external_reference')).toHaveCount(0);
    await expect(page.getByTestId('time_entry_external_reference_missing')).toBeVisible();

    // Act
    await page.locator('#description').fill('OPS-7 and back again');

    // Assert
    await expect(page.getByTestId('time_entry_external_reference')).toHaveText('OPS-7');
});

test('test that the edit dialog shows no ticket box until you opt in', async ({ page }) => {
    // Arrange
    // The organization uses Jira, but this member has neither connected an account nor turned on
    // the missing-ticket dots, so telling them about tickets would be unsolicited noise.
    const ctx = await setupTestContext(page);
    await setJiraSiteUrl(ctx, SITE_URL);
    const today = new Date().toISOString().slice(0, 10);
    await createTimeEntryWithTimestampsViaApi(ctx, {
        start: `${today}T09:00:00Z`,
        end: `${today}T11:00:00Z`,
        description: 'PROJ-42 fix the login redirect',
    });
    await page.goto(PLAYWRIGHT_BASE_URL + '/time');

    // Act
    await page.getByTestId('time_entry_row').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Assert: neither box, even though the description does contain a ticket
    await expect(page.getByTestId('time_entry_external_reference')).toHaveCount(0);
    await expect(page.getByTestId('time_entry_external_reference_missing')).toHaveCount(0);

    // Act: opting in from the profile card brings it back
    await page.keyboard.press('Escape');
    await page.goto(PLAYWRIGHT_BASE_URL + '/user/profile');
    await page.getByTestId('jira_missing_ticket_toggle').click();
    await page.goto(PLAYWRIGHT_BASE_URL + '/time');
    await page.getByTestId('time_entry_row').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Assert
    await expect(page.getByTestId('time_entry_external_reference')).toHaveText('PROJ-42');
});

test('test that the edit dialog shows no ticket box when the organization has no jira site', async ({
    page,
}) => {
    // Arrange
    const ctx = await setupTestContext(page);
    const today = new Date().toISOString().slice(0, 10);
    await createTimeEntryWithTimestampsViaApi(ctx, {
        start: `${today}T09:00:00Z`,
        end: `${today}T11:00:00Z`,
        description: 'PROJ-42 fix the login redirect',
    });
    await page.goto(PLAYWRIGHT_BASE_URL + '/time');

    // Act
    await page.getByTestId('time_entry_row').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Assert: an organization that does not use Jira sees neither box, not "No ticket"
    await expect(page.getByTestId('time_entry_external_reference')).toHaveCount(0);
    await expect(page.getByTestId('time_entry_external_reference_missing')).toHaveCount(0);
});

/*
 * Detecting a missing ticket is entirely local, so these dots need no Atlassian account - which
 * is exactly what makes them testable here. The synced/pending/outdated dots do need a
 * connection, and are covered by JiraSyncServiceTest and jira.test.ts instead.
 */
test('test that the profile toggle marks entries with no ticket everywhere', async ({ page }) => {
    // Arrange
    const ctx = await setupTestContext(page);
    await setJiraSiteUrl(ctx, SITE_URL);
    // Today, at explicit non-overlapping times. Not "yesterday": the week starts Monday, so on
    // a Monday yesterday belongs to the previous week and is not on screen at all. Overlapping
    // entries would share a column and clip their own titles.
    const today = new Date().toISOString().slice(0, 10);
    await createTimeEntryWithTimestampsViaApi(ctx, {
        start: `${today}T09:00:00Z`,
        end: `${today}T11:00:00Z`,
        description: 'no ticket here',
    });
    await createTimeEntryWithTimestampsViaApi(ctx, {
        start: `${today}T12:00:00Z`,
        end: `${today}T13:00:00Z`,
        description: 'PROJ-42 has a ticket',
    });

    // Scoped to the calendar block: a bare text match also hits the hover tooltip's copy,
    // which is in the DOM but hidden until you hover it
    const untaggedEvent = page.locator('.fc-event').filter({ hasText: 'no ticket here' }).first();
    // The time list renders a desktop and a mobile layout and hides one with a container query,
    // so both are in the DOM. Count what is actually on screen.
    const visibleMissingDots = page
        .getByTestId('sync_indicator_missing-reference')
        .locator('visible=true');

    // Assert: off by default, so nothing is marked
    await page.goto(PLAYWRIGHT_BASE_URL + '/calendar');
    await expect(untaggedEvent).toBeVisible();
    await expect(visibleMissingDots).toHaveCount(0);

    // Act: turn it on from the profile settings card, with no Jira account connected
    await page.goto(PLAYWRIGHT_BASE_URL + '/user/profile');
    await page.getByTestId('jira_missing_ticket_toggle').click();

    // Assert: the calendar marks the entry without a ticket, and only that one
    await page.goto(PLAYWRIGHT_BASE_URL + '/calendar');
    await expect(untaggedEvent).toBeVisible();
    await expect(visibleMissingDots).toHaveCount(1);
    // Nothing is logged to Jira, but a ticketed entry must not be marked as a problem either
    await expect(page.getByTestId('sync_indicator_pending').locator('visible=true')).toHaveCount(0);

    // Assert: and so does the time list, from the same setting
    await page.goto(PLAYWRIGHT_BASE_URL + '/time');
    await expect(page.getByTestId('time_entry_row').first()).toBeVisible();
    await expect(visibleMissingDots).toHaveCount(1);

    // Act: turning it off clears them again
    await page.goto(PLAYWRIGHT_BASE_URL + '/user/profile');
    await page.getByTestId('jira_missing_ticket_toggle').click();

    // Assert
    await page.goto(PLAYWRIGHT_BASE_URL + '/calendar');
    await expect(untaggedEvent).toBeVisible();
    await expect(visibleMissingDots).toHaveCount(0);
});
