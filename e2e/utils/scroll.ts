import type { Locator } from '@playwright/test';

/**
 * Scrolls an element to the middle of its scroll container.
 *
 * Playwright's scrollIntoViewIfNeeded stops as soon as the element is visible, which routinely
 * parks it flush against the bottom edge. Any test that then clicks at a fixed offset below the
 * element - to hit an empty calendar slot, say - clicks outside the viewport, hits nothing, and
 * fails as an unexplained timeout on whatever it expected to open. Centring guarantees room on
 * both sides.
 */
export async function scrollIntoViewCentred(locator: Locator): Promise<void> {
    await locator.evaluate((element) =>
        element.scrollIntoView({ block: 'center', inline: 'nearest' })
    );
}
