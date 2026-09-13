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

/**
 * What the catalogue calls one report, read off the catalogue.
 *
 * The name of a report is DATA, not language: the platform names its baselines with a
 * translation key, and a workshop that has published a configuration names that report itself,
 * in whatever language it wrote the label. A name typed into this file would therefore be a
 * second statement of something the catalogue owns, and it is wrong for one of the four
 * datasets in both locales — which is exactly how the Arabic cases failed.
 *
 * Reading it here and requiring the run screen to be headed with the SAME name is the
 * assertion that survives both kinds of owner, and it is stronger than a typed title: it fails
 * if the two screens disagree about what a report is called.
 *
 * Addressed by the row's link TARGET, because that is the report's identity and it is the same
 * string in both locales.
 */
async function catalogueName(page: Page, locale: 'en' | 'ar', code: string): Promise<string> {
  await page.goto(`/${locale}/reports`);
  const row = page
    .getByRole('table', { name: say(locale, 'reports.catalogue.caption') })
    .locator('tbody tr')
    .filter({ has: page.locator(`a[href="/${locale}/reports/${code}"]`) });
  await expect(row, `the catalogue must offer ${code}`).toHaveCount(1);
  const named = (await row.getByRole('link').locator('bdi').innerText()).trim();
  expect(named.length, `the catalogue must NAME ${code} and not only identify it`).toBeGreaterThan(
    0
  );
  return named;
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
  /**
   * The two reporting screens, for the caller the acceptance actually has.
   *
   * ## What these two cases used to assert, and why it was wrong about the environment
   *
   * They asserted a REFUSAL, on the ground that `rpt.report.read` is withheld. That was a
   * statement about the governed job's `acceptance:create-owner` account
   * (`OWNER_PERMISSIONS` in `scripts/dev/owner-acceptance/context.mjs`) and about no other
   * caller. A freshly provisioned organisation's first administrator holds the whole
   * tenant-administrator bundle, and `rpt.report.read` is IN it — carried by P1-31
   * prerequisite P-1 because `rpt.report-catalogue` and `rpt.report-read` declare it
   * (`apps/api/src/modules/iam/domain/bootstrap-roles.ts`). So both screens rendered,
   * correctly, and both cases failed on a truth about the product. A case that is true for one
   * caller and false for another is a case about the environment, not about the screen.
   *
   * ## What they assert now
   *
   * The same two screens, read the other way round: each renders FOR A HOLDER — its own
   * heading, the document's direction, no denial, and the surface behind the gate actually
   * present. The catalogue must show its table; the run screen must offer the control that
   * runs the report. That is the half of the gate this caller can evidence, and it is the half
   * no static check sees: `check-p1-31-access.mjs` can prove the gate is CONSULTED before the
   * read, and nothing but a browser can show that a holder gets through it.
   *
   * ## The negative, and why there is not one to keep
   *
   * A negative needs a code these screens gate on that the bundle does NOT carry. The only
   * reporting code the bundle is denied is `rpt.export`, withheld by explicit Owner decision
   * on least-privilege grounds (P1-31 CC-04) — and it gates nothing on either screen, because
   * no export operation is published for a report at all. So there is NO permission negative
   * available here and none is invented. What is asserted instead is the screen's own
   * standing statement: no download is offered. That is a contract, not a permission, and it
   * is recorded here as the contract it is.
   *
   * ## Why they need the handoff
   *
   * Because each is a case about a CALLER, and the caller is the one the handoff names: the
   * acceptance signs the browser in as the first administrator of the organisation the journey
   * provisioned. Without the handoff the session belongs to an account whose permission set
   * nothing here has established.
   */
  for (const [what, path, titleKey] of [
    ['catalogue', 'reports', 'reports.catalogue.title'],
    ['run screen', `reports/${REPORT_CODES[0]}`, 'reports.run.title'],
  ] as const) {
    test(`the ${what} renders for a caller who holds the report read code`, async ({
      page,
    }, testInfo) => {
      // test-honesty-allow: TH-002 -- no acceptance handoff on this checkout; see NO_HANDOFF_REASON
      test.skip(handoff === null, NO_HANDOFF_REASON);
      const locale = localeOf(testInfo.project.name);
      // test-honesty-allow: TH-002 -- the reporting slice is not on this checkout; see reportsAbsentReason
      test.skip(!hasMessage(locale, CATALOGUE_TITLE_KEY), reportsAbsentReason(locale));

      await page.goto(`/${locale}/${path}`);

      // The page owns its heading either way. A render that swallowed the title would leave
      // an operator unable to tell a report from a broken route.
      await expect(page.getByRole('heading', { name: say(locale, titleKey) })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');

      await expect(
        page.getByText(say(locale, 'state.denied.title')),
        'the tenant-administrator bundle holds rpt.report.read, so this screen must not ' +
          'refuse. A refusal here means the browser is signed in as some account other than ' +
          'the first administrator of the organisation the handoff names'
      ).toHaveCount(0);

      // And the surface behind the gate is there. The catalogue's table and the run form's
      // control are the two things a refusal would have withheld.
      if (what === 'catalogue') {
        await expect(
          page.getByRole('table', { name: say(locale, 'reports.catalogue.caption') })
        ).toBeVisible();
        await expect(page.getByText(say(locale, 'reports.catalogue.noDownload'))).toBeVisible();
      } else {
        await expect(
          page.getByRole('button', { name: say(locale, 'reports.run.show'), exact: true })
        ).toBeVisible();
      }

      // Structural, and true of both screens: nothing here publishes a download. Stated as
      // the contract it is — no export operation exists for a report — and not as evidence
      // about the withheld `rpt.export`, which gates nothing an operator can see here.
      await expect(page.locator('a[download]')).toHaveCount(0);
    });
  }

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

    /*
     * Each dataset, found by the row that LINKS to it and then read for what it is called.
     *
     * Asserting each one by its own translated title was wrong about the product — visibly in
     * Arabic, and by accident in English. A published tenant report configuration carries no
     * translation key; it carries the operator's own `name`, and `reportTitle` shows that
     * label as written in BOTH languages, because translating somebody's own label is
     * inventing one. The acceptance journey publishes a configuration for one of these four
     * datasets, so one row is named by the workshop and three by the platform. The English
     * case passed only because the label the harness chose happened to equal the English
     * catalogue string, which is a coincidence and not evidence.
     *
     * So a row is addressed by its link TARGET — the report's identity, the same in both
     * locales — and its name is then required to be the right KIND of name for whoever
     * provides the row: the platform's translated title where the platform provides it, the
     * operator's own label where the workshop does. Either way the row must NAME the report.
     * This screen wraps a name in `bdi` and renders a report it can only identify as a machine
     * name, so a catalogue that had lost its names and listed four codes still fails here,
     * which is what this loop was always for.
     */
    const byThePlatform = say(locale, 'reports.catalogue.origin.platform');
    const byTheWorkshop = say(locale, 'reports.catalogue.origin.workshop');
    for (const code of REPORT_CODES) {
      const row = table
        .locator('tbody tr')
        .filter({ has: page.locator(`a[href="/${locale}/reports/${code}"]`) });
      await expect(row, `the catalogue must offer ${code}`).toHaveCount(1);

      // A name, rendered as a name — and the identifier shown BESIDE it rather than instead
      // of it, which is this screen's own way of keeping the two apart.
      const name = row.getByRole('link').locator('bdi');
      await expect(name, `the ${code} row must name the report`).toHaveCount(1);
      await expect(row.getByText(code, { exact: true })).toBeVisible();

      if ((await row.getByText(byThePlatform, { exact: true }).count()) > 0) {
        // The platform provides this row, so the platform's own translated title is its name.
        await expect(name).toHaveText(say(locale, `reports.${code}.title`));
      } else {
        // The workshop provides it: its own label, shown as written and never translated.
        await expect(row.getByText(byTheWorkshop, { exact: true })).toBeVisible();
        const own = (await name.innerText()).trim();
        expect(own.length, `the workshop's own label for ${code} must be shown`).toBeGreaterThan(0);
        expect(
          own,
          `the workshop's label for ${code} must be a name, not the identifier dressed as one`
        ).not.toBe(code);
      }
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

      // What this report is CALLED, read off the catalogue rather than typed here — see
      // `catalogueName`. One extra page load per case, and it buys an assertion that holds
      // whether the platform or the workshop provides the report.
      const named = await catalogueName(page, locale, code);

      await page.goto(`/${locale}/reports/${code}`);
      await expect(
        page.getByRole('heading', { name: named, exact: true }),
        `the run screen must head ${code} with the name the catalogue gave it`
      ).toBeVisible();

      // Nothing has been run yet, and the screen says so. Asserted BEFORE the run, so a
      // screen that rendered rows without being asked would fail here.
      await expect(page.getByText(say(locale, 'reports.run.idleTitle'))).toBeVisible();

      await runReport(page, locale, h, period);

      /*
       * The period travels with the result, in the branch's own zone — asserted INSIDE the
       * list of context facts, and on the whole label rather than on a substring of it.
       *
       * A page-wide text match for "Time zone" matched two nodes: the fact's own label, and
       * the sentence printed beneath the list, which explains that days and times are shown
       * in the zone named above. Both are the product's own words, neither is a duplicate of
       * the other, and strict mode was right to refuse. Naming the list the facts live in and
       * matching the label exactly asserts the same thing about the place it is actually
       * stated.
       */
      const context = page.locator('section[aria-labelledby="report-result-heading"] > dl');
      await expect(context).toBeVisible();
      await expect(
        context.getByText(say(locale, 'reports.context.timezone'), { exact: true })
      ).toBeVisible();
      await expect(
        context.getByText(say(locale, 'reports.context.from'), { exact: true })
      ).toBeVisible();
      await expect(
        context.getByText(say(locale, 'reports.context.to'), { exact: true })
      ).toBeVisible();
      if (echoed.timezone !== null) {
        await expect(context.getByText(echoed.timezone, { exact: true })).toBeVisible();
      }
      // "Read from the live records the moment you asked" — the freshness the dataset
      // registry declares, and the only claim the screen makes about how current it is.
      await expect(
        context.getByText(say(locale, 'reports.context.freshness.live'), { exact: true })
      ).toBeVisible();

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
