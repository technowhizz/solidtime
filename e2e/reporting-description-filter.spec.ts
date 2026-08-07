import { expect } from '@playwright/test';
import { test } from '../playwright/fixtures';
import {
    goToReporting,
    goToReportingDetailed,
    saveAsSharedReport,
    waitForDetailedReportingUpdate,
    waitForReportingUpdate,
} from './utils/reporting';
import { createBareTimeEntryViaApi, createProjectViaApi, createTimeEntryViaApi } from './utils/api';

// Each test registers a new user and creates test data via the API
test.describe.configure({ timeout: 30000 });

// The filter input is debounced by 300ms, so every interaction that changes the term is wrapped in
// a Promise.all with the corresponding reporting request.
const DESCRIPTION_BADGE = { name: 'Description' };
const DESCRIPTION_INPUT = { name: 'Filter by description' };

test('detailed reporting: description filter narrows results to matching entries', async ({
    page,
    ctx,
}) => {
    const suffix = Math.floor(Math.random() * 10000);
    const matching = `Daily standup ${suffix}`;
    const nonMatching = `Invoice review ${suffix}`;
    await createBareTimeEntryViaApi(ctx, matching, '1h');
    await createBareTimeEntryViaApi(ctx, nonMatching, '2h');

    await goToReportingDetailed(page);
    await expect(page.getByText(matching).first()).toBeVisible();
    await expect(page.getByText(nonMatching).first()).toBeVisible();

    await page.getByRole('button', DESCRIPTION_BADGE).first().click();
    await Promise.all([
        waitForDetailedReportingUpdate(page),
        page.getByRole('textbox', DESCRIPTION_INPUT).fill('standup'),
    ]);
    await page.keyboard.press('Escape');

    await expect(page.getByText(matching).first()).toBeVisible();
    await expect(page.getByText(nonMatching)).toHaveCount(0);
});

test('detailed reporting: description filter is case-insensitive and matches mid-word', async ({
    page,
    ctx,
}) => {
    const suffix = Math.floor(Math.random() * 10000);
    const upperCase = `Daily STANDUP ${suffix}`;
    const midWord = `Understand the spec ${suffix}`;
    const nonMatching = `Invoice review ${suffix}`;
    await createBareTimeEntryViaApi(ctx, upperCase, '1h');
    await createBareTimeEntryViaApi(ctx, midWord, '2h');
    await createBareTimeEntryViaApi(ctx, nonMatching, '3h');

    await goToReportingDetailed(page);
    await expect(page.getByText(upperCase).first()).toBeVisible();

    await page.getByRole('button', DESCRIPTION_BADGE).first().click();
    await Promise.all([
        waitForDetailedReportingUpdate(page),
        page.getByRole('textbox', DESCRIPTION_INPUT).fill('stand'),
    ]);
    await page.keyboard.press('Escape');

    // "stand" matches "STANDUP" (different case) and "Understand" (mid-word)
    await expect(page.getByText(upperCase).first()).toBeVisible();
    await expect(page.getByText(midWord).first()).toBeVisible();
    await expect(page.getByText(nonMatching)).toHaveCount(0);
});

test('detailed reporting: description filter treats % as a literal character', async ({
    page,
    ctx,
}) => {
    const suffix = Math.floor(Math.random() * 10000);
    const withPercent = `Discount 50% off ${suffix}`;
    const withoutPercent = `Discount 5000 off ${suffix}`;
    await createBareTimeEntryViaApi(ctx, withPercent, '1h');
    await createBareTimeEntryViaApi(ctx, withoutPercent, '2h');

    await goToReportingDetailed(page);
    await expect(page.getByText(withPercent).first()).toBeVisible();
    await expect(page.getByText(withoutPercent).first()).toBeVisible();

    await page.getByRole('button', DESCRIPTION_BADGE).first().click();
    await Promise.all([
        waitForDetailedReportingUpdate(page),
        page.getByRole('textbox', DESCRIPTION_INPUT).fill('50%'),
    ]);
    await page.keyboard.press('Escape');

    // If the "%" were passed through as a LIKE wildcard, both entries would still be listed
    await expect(page.getByText(withPercent).first()).toBeVisible();
    await expect(page.getByText(withoutPercent)).toHaveCount(0);
});

test('detailed reporting: clearing the description filter restores all entries', async ({
    page,
    ctx,
}) => {
    const suffix = Math.floor(Math.random() * 10000);
    const matching = `Daily standup ${suffix}`;
    const nonMatching = `Invoice review ${suffix}`;
    await createBareTimeEntryViaApi(ctx, matching, '1h');
    await createBareTimeEntryViaApi(ctx, nonMatching, '2h');

    await goToReportingDetailed(page);
    await page.getByRole('button', DESCRIPTION_BADGE).first().click();
    await Promise.all([
        waitForDetailedReportingUpdate(page),
        page.getByRole('textbox', DESCRIPTION_INPUT).fill('standup'),
    ]);
    await expect(page.getByText(nonMatching)).toHaveCount(0);

    await Promise.all([
        waitForDetailedReportingUpdate(page),
        page.getByRole('button', { name: 'Clear' }).click(),
    ]);
    await page.keyboard.press('Escape');

    await expect(page.getByText(matching).first()).toBeVisible();
    await expect(page.getByText(nonMatching).first()).toBeVisible();
});

test('overview reporting: description filter is persisted in a saved shared report', async ({
    page,
    ctx,
}) => {
    const suffix = Math.floor(Math.random() * 10000);
    const matchingProjectName = `DescMatch ${suffix}`;
    const otherProjectName = `DescOther ${suffix}`;
    const reportName = `DescReport ${suffix}`;

    const matchingProject = await createProjectViaApi(ctx, { name: matchingProjectName });
    const otherProject = await createProjectViaApi(ctx, { name: otherProjectName });
    await createTimeEntryViaApi(ctx, {
        description: `Daily standup ${suffix}`,
        duration: '1h',
        projectId: matchingProject.id,
    });
    await createTimeEntryViaApi(ctx, {
        description: `Invoice review ${suffix}`,
        duration: '2h',
        projectId: otherProject.id,
    });

    await goToReporting(page);
    await expect(page.getByTestId('reporting_view').getByText(matchingProjectName)).toBeVisible();
    await expect(page.getByTestId('reporting_view').getByText(otherProjectName)).toBeVisible();

    await page.getByRole('button', DESCRIPTION_BADGE).first().click();
    await Promise.all([
        waitForReportingUpdate(page),
        page.getByRole('textbox', DESCRIPTION_INPUT).fill('standup'),
    ]);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('reporting_view').getByText(otherProjectName)).toHaveCount(0);

    const { shareableLink } = await saveAsSharedReport(page, reportName);

    // The shared link must reproduce the filtered view for a viewer
    await page.goto(shareableLink);
    await expect(page.getByText('Total')).toBeVisible();
    await expect(page.getByText(matchingProjectName).first()).toBeVisible();
    await expect(page.getByText(otherProjectName)).toHaveCount(0);
});
