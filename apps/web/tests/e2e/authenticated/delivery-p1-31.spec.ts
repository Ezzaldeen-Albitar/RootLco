import { expect, test, type Page } from '@playwright/test';
import {
  NO_HANDOFF_REASON,
  localeOf,
  missingReason,
  readHandoff,
  say,
  type P131Handoff,
} from './p1-31-handoff';

/**
 * P1-31 acceptance, browser half: the vehicle-handover screens.
 *
 * The HTTP harness (`scripts/dev/owner-acceptance/p1-31-journey.mjs`) has already walked a
 * fresh organisation from provisioning to a `delivered` handover. These cases open the
 * screens over THOSE records and assert what an operator sees — the queue's readiness
 * verdict, the handover's own facts, and the printable copy's contract.
 *
 * ## What only a browser can establish here
 *
 * Three things the DOM tier cannot, because its read adapters are mocked:
 *
 *   1. the queue renders a verdict for every row rather than a blank cell;
 *   2. the printable copy really is produced inside the production bundle, and carries the
 *      disclaimer that says it is an operational printout and not an archived document;
 *   3. the Print control's contract — a headless browser raises no print dialog, so
 *      `window.print` is replaced with a counter and the control must call it EXACTLY
 *      ONCE. What that proves is the button's behaviour in the real bundle.
 *
 * ## Locale
 *
 * `authenticated-en` drives `/en` and `authenticated-ar` drives `/ar`, and the direction of
 * the document is asserted in both — `rtl` for Arabic, `ltr` for English — so a regression
 * that flattened the Arabic layout would fail here rather than be noticed by eye.
 */

const handoff = readHandoff();

/** Replaces `window.print` with a counter, before any script on the page runs. */
async function countPrintCalls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const scope = window as unknown as { __p131PrintCalls?: number };
    scope.__p131PrintCalls = 0;
    window.print = () => {
      scope.__p131PrintCalls = (scope.__p131PrintCalls ?? 0) + 1;
    };
  });
}

async function printCalls(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __p131PrintCalls?: number }).__p131PrintCalls ?? -1
  );
}

/** Chooses the branch the harness worked in, on the readiness queue's own form. */
async function chooseBranch(page: Page, locale: 'en' | 'ar', h: P131Handoff): Promise<void> {
  await page.getByLabel(say(locale, 'delivery.queue.company')).selectOption(h.companyId);
  await page.getByLabel(say(locale, 'delivery.queue.branch')).selectOption(h.branchId);
  await page.getByRole('button', { name: say(locale, 'delivery.queue.show') }).click();
}

test.describe('P1-31 delivery screens, over the acceptance journey records', () => {
  test('the readiness queue answers for every row it shows', async ({ page }, testInfo) => {
    // test-honesty-allow: TH-002 -- no acceptance handoff on this checkout; see NO_HANDOFF_REASON
    test.skip(handoff === null, NO_HANDOFF_REASON);
    const h = handoff as P131Handoff;
    const locale = localeOf(testInfo.project.name);

    await page.goto(`/${locale}/delivery`);
    await expect(
      page.getByRole('heading', { name: say(locale, 'delivery.queue.title') })
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');

    await chooseBranch(page, locale, h);

    await expect(
      page.getByRole('heading', { name: say(locale, 'delivery.queue.resultsHeading') })
    ).toBeVisible();
    // The two sentences that make the queue honest: what the order means, and that a
    // check marked unavailable needs attention rather than being merely absent.
    await expect(page.getByText(say(locale, 'delivery.queue.orderingNote'))).toBeVisible();
    await expect(page.getByText(say(locale, 'delivery.queue.reasonsExplain'))).toBeVisible();

    const table = page.getByRole('table', { name: say(locale, 'delivery.queue.caption') });
    await expect(table).toBeVisible();

    // Every column the four facts are reported through is on the table, so a row can be
    // read at all. Asserted by NAME rather than by counting: a queue that lost its
    // readiness column and kept its width would pass a count.
    for (const key of [
      'delivery.queue.column.workOrder',
      'delivery.queue.column.vehicle',
      'delivery.queue.column.customer',
      'delivery.queue.column.state',
      'delivery.queue.column.readiness',
      'delivery.queue.column.handover',
    ]) {
      await expect(table.getByRole('columnheader', { name: say(locale, key) })).toBeVisible();
    }

    // The harness left a second handover open, so the queue is not empty. Every row must
    // carry a verdict: "Ready", or a sentence saying it is not and why. A BLANK verdict is
    // the defect this asserts against — the cell is the whole point of the screen.
    const rows = table.locator('tbody tr');
    const count = await rows.count();
    expect(
      count,
      'the acceptance journey leaves at least one work order in the queue'
    ).toBeGreaterThan(0);
    const ready = say(locale, 'delivery.queue.ready');
    const notReady = say(locale, 'delivery.queue.notReady');
    for (let index = 0; index < count; index += 1) {
      const text = (await rows.nth(index).innerText()).trim();
      expect(
        text.includes(ready) || text.includes(notReady),
        `row ${String(index + 1)} carries no readiness verdict`
      ).toBe(true);
    }
  });

  test('the handover record shows its own facts', async ({ page }, testInfo) => {
    // test-honesty-allow: TH-002 -- no acceptance handoff on this checkout; see NO_HANDOFF_REASON
    test.skip(handoff === null, NO_HANDOFF_REASON);
    const h = handoff as P131Handoff;
    // test-honesty-allow: TH-002 -- the journey recorded no delivery; nothing to open
    test.skip(h.deliveryId === null, missingReason('delivery'));
    const locale = localeOf(testInfo.project.name);

    await page.goto(`/${locale}/delivery/${String(h.deliveryId)}`);

    await expect(
      page.getByRole('heading', { name: say(locale, 'delivery.summary.heading') })
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');

    // Asserted INSIDE the summary panel, addressed by the id its own `aria-labelledby`
    // names. A page-wide text locator would match the same label wherever else it appears
    // and would pass on a page that had lost the panel entirely.
    const summary = page.locator('section[aria-labelledby="delivery-summary-heading"]');
    await expect(summary).toContainText(say(locale, 'delivery.summary.status'));
    await expect(summary).toContainText(say(locale, 'delivery.summary.deliveredAt'));
    await expect(summary).toContainText(say(locale, 'delivery.summary.vehicle'));
    await expect(summary).toContainText(say(locale, 'delivery.summary.deliveringEmployee'));
    // The harness completed this handover, so the "not handed over yet" statement must be
    // absent — the one assertion here that distinguishes a delivered record from an open one.
    await expect(summary).not.toContainText(say(locale, 'delivery.summary.notDeliveredYet'));

    // The release answer, and the receiver the harness verified — each addressed by its
    // own panel id for the same reason.
    const eligibility = page.locator('section[aria-labelledby="delivery-eligibility-heading"]');
    await expect(eligibility).toBeVisible();
    const receiver = page.locator('section[aria-labelledby="delivery-receiver-heading"]');
    await expect(receiver).toBeVisible();

    // The receiver the harness verified is on file, so the "no receiver recorded"
    // statement must not be in the panel that would otherwise carry it.
    await expect(receiver).not.toContainText(say(locale, 'delivery.receiver.noneDescription'));
  });

  test('the printable copy is produced and prints exactly once', async ({ page }, testInfo) => {
    // test-honesty-allow: TH-002 -- no acceptance handoff on this checkout; see NO_HANDOFF_REASON
    test.skip(handoff === null, NO_HANDOFF_REASON);
    const h = handoff as P131Handoff;
    // test-honesty-allow: TH-002 -- the journey recorded no delivery; nothing to print
    test.skip(h.deliveryId === null, missingReason('delivery'));
    const locale = localeOf(testInfo.project.name);

    await countPrintCalls(page);
    await page.goto(`/${locale}/delivery/${String(h.deliveryId)}`);

    await expect(
      page.getByRole('heading', { name: say(locale, 'delivery.document.heading') })
    ).toBeVisible();

    // Closed until asked for: the sheet is a deliberate action, not something the screen
    // renders at every load.
    const sheet = page.locator('[data-print="document"]');
    await expect(sheet).toHaveCount(0);

    await page.getByRole('button', { name: say(locale, 'delivery.document.open') }).click();
    await expect(sheet).toBeVisible();

    // The disclaimer is the sentence that makes the printout honest: it says the sheet
    // shows what the system published to the person printing it, not an archived copy.
    await expect(sheet).toContainText(say(locale, 'delivery.document.disclaimer'));
    await expect(sheet).toContainText(say(locale, 'delivery.document.handoverHeading'));
    await expect(sheet).toContainText(say(locale, 'delivery.document.releaseChecksHeading'));

    // Direction is asserted on the sheet itself, not only on the page, and as the COMPUTED
    // direction rather than an attribute: `PrintDocument` carries no `dir` of its own and
    // inherits from the locale layout, so an attribute assertion would be asserting the
    // absence of an attribute nobody writes. A printable copy that reverted to
    // left-to-right inside a right-to-left page is the regression worth catching.
    const direction = await sheet.evaluate((node) => getComputedStyle(node).direction);
    expect(direction).toBe(locale === 'ar' ? 'rtl' : 'ltr');

    const print = page.getByRole('button', { name: say(locale, 'delivery.document.print') });
    await expect(print).toBeVisible();
    expect(await printCalls(page), 'nothing may print before the control is used').toBe(0);
    await print.click();
    expect(await printCalls(page), 'the Print control must call window.print exactly once').toBe(1);
  });
});
