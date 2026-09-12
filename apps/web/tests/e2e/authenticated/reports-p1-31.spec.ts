import { expect, test, type Page } from '@playwright/test';
import {
  NO_HANDOFF_REASON,
  hasMessage,
  localeOf,
  missingReason,
  readHandoff,
  say,
  type P131Handoff,
} from './p1-31-handoff';

/**
 * P1-31 acceptance, browser half: the report catalogue and the report screens.
 *
 * ## What is being established, and why a count is the strongest assertion available
 *
 * The HTTP harness ran all four datasets over the same branch and the same half-open day
 * period, and recorded how many rows and how many group totals the server answered. These
 * cases run the SAME four reports through the screen and require the screen's row count to
 * equal the harness's. That is the one assertion that can distinguish "the screen renders
 * the server's answer" from "the screen renders something": a hard-coded expectation would
 * be a second statement of a figure the server owns, and a mere "the table is not empty"
 * would pass on a screen that dropped every row but one.
 *
 * The timezone label is asserted separately, because the period is expressed in the
 * BRANCH's zone and a report that silently rendered instants in the browser's zone would
 * move rows between days while looking correct.
 *
 * ## Why every case is conditional on the catalogue's own strings
 *
 * The report screens arrive with the operational-overview slice. A checkout without that
 * merge has no `/reports` route at all, so the cases skip with the reason stated rather
 * than asserting a 404 — which would also pass on a build that was simply broken.
 */

const handoff = readHandoff();

/** The four datasets `REPORT_DATASETS` declares, in the order the catalogue lists them. */
const REPORT_CODES = [
  'work_orders_by_status',
  'technician_labor_time',
  'inventory_movements',
  'invoice_payment_summary',
] as const;

/** The one key no report screen can render without. */
const CATALOGUE_TITLE_KEY = 'reports.catalogue.title';

function reportsAbsentReason(locale: 'en' | 'ar'): string {
  return (
    `${locale}.json has no "${CATALOGUE_TITLE_KEY}", so the reporting screens are not on ` +
    "this checkout. The acceptance plan's merge list is what makes these cases run; " +
    'asserting a 404 instead would pass on a broken build too.'
  );
}

/** Runs one report through its own form, for the branch and period the harness used. */
async function runReport(
  page: Page,
  locale: 'en' | 'ar',
  h: P131Handoff,
  period: { readonly from: string; readonly to: string }
): Promise<void> {
  await page.getByLabel(say(locale, 'reports.run.company')).selectOption(h.companyId);
  await page.getByLabel(say(locale, 'reports.run.branch')).selectOption(h.branchId);
  await page.getByLabel(say(locale, 'reports.run.from')).fill(period.from);
  await page.getByLabel(say(locale, 'reports.run.to')).fill(period.to);
  await page.getByRole('button', { name: say(locale, 'reports.run.show') }).click();
}

test.describe('P1-31 reporting screens, over the acceptance journey records', () => {
  test('the catalogue offers all four datasets', async ({ page }, testInfo) => {
    // test-honesty-allow: TH-002 -- no acceptance handoff on this checkout; see NO_HANDOFF_REASON
    test.skip(handoff === null, NO_HANDOFF_REASON);
    const locale = localeOf(testInfo.project.name);
    // test-honesty-allow: TH-002 -- the reporting slice is not on this checkout; see reportsAbsentReason
    test.skip(!hasMessage(locale, CATALOGUE_TITLE_KEY), reportsAbsentReason(locale));

    await page.goto(`/${locale}/reports`);
    await expect(
      page.getByRole('heading', { name: say(locale, 'reports.catalogue.title') })
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');

    // The statement that there is no download here. It is the whole of this screen's
    // export story, and an export control appearing later would contradict it silently.
    await expect(page.getByText(say(locale, 'reports.catalogue.noDownload'))).toBeVisible();

    const table = page.getByRole('table', { name: say(locale, 'reports.catalogue.caption') });
    await expect(table).toBeVisible();

    // Each dataset by its own TRANSLATED title, so a catalogue that listed four raw codes
    // instead of four names would fail here.
    for (const code of REPORT_CODES) {
      await expect(
        table.getByRole('link', { name: say(locale, `reports.${code}.title`) })
      ).toBeVisible();
    }
  });

  for (const code of REPORT_CODES) {
    test(`${code} renders exactly the rows the server answered`, async ({ page }, testInfo) => {
      // test-honesty-allow: TH-002 -- no acceptance handoff on this checkout; see NO_HANDOFF_REASON
      test.skip(handoff === null, NO_HANDOFF_REASON);
      const h = handoff as P131Handoff;
      const locale = localeOf(testInfo.project.name);
      // test-honesty-allow: TH-002 -- the reporting slice is not on this checkout; see reportsAbsentReason
      test.skip(!hasMessage(locale, CATALOGUE_TITLE_KEY), reportsAbsentReason(locale));
      // test-honesty-allow: TH-002 -- the journey recorded no period or no run for this code, so there is no figure to compare against
      test.skip(
        h.reportPeriod === null || h.reportRuns === null || h.reportRuns[code] === undefined,
        missingReason(`recorded run of ${code}`)
      );

      const period = h.reportPeriod as { readonly from: string; readonly to: string };
      // The `test.skip` above has already established that this entry exists. The
      // assertion restates it for the compiler rather than reaching for a non-null
      // assertion operator, so a future edit that removed the skip would fail loudly here
      // instead of dereferencing nothing.
      const echoed = (
        h.reportRuns as Record<
          string,
          { readonly rows: number; readonly groups: number; readonly timezone: string | null }
        >
      )[code];
      expect(echoed, `the handoff must carry the recorded run of ${code}`).toBeDefined();
      if (echoed === undefined) return;

      await page.goto(`/${locale}/reports/${code}`);
      await expect(
        page.getByRole('heading', { name: say(locale, `reports.${code}.title`) })
      ).toBeVisible();

      // Nothing has been run yet, and the screen says so. Asserted BEFORE the run, so a
      // screen that rendered rows without being asked would fail here.
      await expect(page.getByText(say(locale, 'reports.run.idleTitle'))).toBeVisible();

      await runReport(page, locale, h, period);

      // The period travels with the result, in the branch's own zone.
      await expect(page.getByText(say(locale, 'reports.context.timezone'))).toBeVisible();
      await expect(page.getByText(say(locale, 'reports.context.from'))).toBeVisible();
      await expect(page.getByText(say(locale, 'reports.context.to'))).toBeVisible();
      if (echoed.timezone !== null) {
        await expect(page.getByText(echoed.timezone, { exact: false })).toBeVisible();
      }
      // "Read from the live records the moment you asked" — the freshness the dataset
      // registry declares, and the only claim the screen makes about how current it is.
      await expect(page.getByText(say(locale, 'reports.context.freshness.live'))).toBeVisible();

      if (echoed.rows === 0) {
        // The honest zero: a sentence, not an empty table. A report with nothing to show
        // must say so, because a blank region reads as a failure to load.
        await expect(page.getByText(say(locale, 'reports.run.noRows'))).toBeVisible();
      } else {
        const rows = page
          .getByRole('table', { name: say(locale, 'reports.run.rowsCaption') })
          .locator('tbody tr');
        await expect(
          rows,
          `the screen must render the ${String(echoed.rows)} row(s) the server answered for ${code}`
        ).toHaveCount(echoed.rows);
      }

      if (echoed.groups > 0) {
        // The totals are computed by the server over the WHOLE period, not by the screen
        // over the page it is showing. The note that says so is part of the assertion.
        const totals = page.getByRole('table', { name: say(locale, 'reports.groups.caption') });
        await expect(totals).toBeVisible();
        await expect(totals.locator('tbody tr')).toHaveCount(echoed.groups);
        await expect(page.getByText(say(locale, 'reports.groups.heading'))).toBeVisible();
      }
    });
  }
});
