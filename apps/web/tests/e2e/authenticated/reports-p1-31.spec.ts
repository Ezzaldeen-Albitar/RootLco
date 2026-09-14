import { expect, test, type Page } from '@playwright/test';
import { holds, readAccountKind } from './account-manifest';
import {
  NO_EXPORT_HANDOFF_REASON,
  NO_HANDOFF_REASON,
  WRONG_ACCOUNT_REASON,
  hasMessage,
  localeOf,
  missingReason,
  readExportHandoff,
  readHandoff,
  say,
  signedInAsJourneyAdministrator,
  type P131ExportHandoff,
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
 * ## WHEN the figure was taken, which is half of what makes it an assertion
 *
 * The figure compared against is the one the harness read AFTER THE LAST WRITE OF THE
 * JOURNEY, and it has to be. The first acceptance run compared against a figure taken in
 * the middle of the chain: `work_orders_by_status` answered one row then, the refusal
 * section afterwards opened a second work order in the same branch, and the screen — asked
 * later still — correctly rendered two. The case failed and the product had done nothing
 * wrong. `recordReportRuns` in the harness now re-reads all four at the end of the journey
 * and only that reading reaches the handoff, so a screen and a handoff that disagree are
 * disagreeing about the same world.
 *
 * The timezone label is asserted separately, because the period is expressed in the
 * BRANCH's zone and a report that silently rendered instants in the browser's zone would
 * move rows between days while looking correct.
 *
 * ## One pinned outcome per credential, and no either/or
 *
 * Two accounts reach these screens and they hold different codes. The cases used to answer
 * that by accepting the surface OR a complete refusal, which passes whichever way the
 * screen answers and so cannot fail for the reason it exists. Instead the suite reads
 * WHICH account signed in (`account-kind.json`, written by `auth.setup.ts`) and what that
 * account holds (`account-manifest.json`, generated from the two permission authorities),
 * and pins the single outcome that account is entitled to. `rpt.report.read` is the code
 * all three reporting operations declare and the code the two pages gate on.
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

/**
 * The code all three reporting operations declare and both pages gate on.
 *
 * `REPORT_PERMISSIONS.read` in `apps/web/src/features/reports/reports-contract.ts` is
 * the authority; it is repeated here because a spec may not import product source,
 * and `tests/ci/p1-31-account-manifest.test.ts` asserts the manifest's own membership
 * of this code in both directions so the string cannot go stale unnoticed.
 */
const REPORT_READ = 'rpt.report.read';

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

/**
 * Runs one report through its own form, for the branch and period the harness used.
 *
 * `scope` is the two identifiers the form needs rather than the whole handoff: the export
 * companion's document names the same pair for a different principal, and a parameter
 * that insisted on the journey's handoff would have forced a second copy of these five
 * lines for the sake of a type.
 */
async function runReport(
  page: Page,
  locale: 'en' | 'ar',
  scope: { readonly companyId: string; readonly branchId: string },
  period: { readonly from: string; readonly to: string }
): Promise<void> {
  await page.getByLabel(say(locale, 'reports.run.company')).selectOption(scope.companyId);
  await page.getByLabel(say(locale, 'reports.run.branch')).selectOption(scope.branchId);
  await page.getByLabel(say(locale, 'reports.run.from')).fill(period.from);
  await page.getByLabel(say(locale, 'reports.run.to')).fill(period.to);
  await page.getByRole('button', { name: say(locale, 'reports.run.show') }).click();
}

test.describe('P1-31 reporting screens, over the acceptance journey records', () => {
  /**
   * The two reporting screens, pinned to what the signed-in account is entitled to.
   *
   * ## Why these two cases carry no handoff gate, and must not
   *
   * They were handoff-gated, and that is what took this file to ZERO executed tests in the
   * governed job. Nothing in `.github/workflows/_reusable-authenticated-browser.yml` sets
   * `ROOTLCO_P131_HANDOFF`, so every case in the file skipped, and the tier's own guard — "a
   * run that collected nothing is a failure, not a pass" — failed the job for a file that had
   * gone silent. A spec file that can only execute where an acceptance has already been run is
   * a spec file continuous integration can read nothing off at all.
   *
   * ## The problem these two cases actually have to solve
   *
   * Two different callers reach these screens, and `acceptance-record.md` §3.1 records the
   * collision as its cause B:
   *
   *   - the governed job signs in through `auth.setup.ts`, which reads the credentials
   *     `acceptance:create-owner` wrote into `.local/owner-acceptance-account.json`. That
   *     account holds `OWNER_PERMISSIONS` (`scripts/dev/owner-acceptance/context.mjs`), and
   *     `rpt.report.read` is NOT among them, because that set is Administration, CRM,
   *     Vehicles and whatever a P1-28 route page consults, and no P1-28 page consults a
   *     reporting code.
   *   - a local acceptance signs in with the first administrator of the organisation the
   *     journey provisioned, who holds the whole tenant-administrator bundle and therefore
   *     DOES hold `rpt.report.read`.
   *
   * ## What they assert, and why it is not "either"
   *
   * The intermediate version accepted the surface OR a complete refusal. That is a case that
   * cannot fail for the reason it exists: a screen that refused an entitled caller and a
   * screen that served an unentitled one would both pass it. This version asks the manifest
   * what the signed-in account holds and pins the one answer that account is owed — the
   * refusal, WHOLE, when the code is absent, and the surface, WHOLE, when it is present.
   *
   * The refusal branch still requires the refusal to be complete: its title, its explanation,
   * no trace of the surface behind the gate, and on the run screen nothing the report
   * definition carries, which is what makes it a refusal the page's own gate reached BEFORE
   * `readReport` was called rather than one it rendered after reading.
   */
  for (const [what, path, titleKey] of [
    ['catalogue', 'reports', CATALOGUE_TITLE_KEY],
    ['run screen', `reports/${REPORT_CODES[0]}`, 'reports.run.title'],
  ] as const) {
    test(`the ${what} answers exactly what the signed-in account is entitled to`, async ({
      page,
    }, testInfo) => {
      const locale = localeOf(testInfo.project.name);
      // test-honesty-allow: TH-002 -- the reporting slice is not on this checkout; see reportsAbsentReason
      test.skip(!hasMessage(locale, CATALOGUE_TITLE_KEY), reportsAbsentReason(locale));

      const kind = readAccountKind();
      const mayRead = holds(kind, REPORT_READ);

      await page.goto(`/${locale}/${path}`);

      /*
       * The chrome both outcomes share, read inside `main`.
       *
       * Scoped there deliberately: the sidebar renders its own group headings, and a
       * page-wide heading query for the catalogue's title matches the rail as well as the
       * page's `h1`, which is the strict-mode ambiguity every sibling spec in this directory
       * hit once. The `h1` is inside `main`; the rail is not.
       */
      const main = page.getByRole('main');
      await expect(
        main.getByRole('heading', { name: say(locale, titleKey), exact: true })
      ).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');

      // No download, on either outcome. No export operation is published for a report at all
      // and `rpt.export` is withheld by Owner decision (CC-04), so a download control on a
      // reporting screen would contradict the contract rather than merely a permission.
      await expect(page.locator('a[download]')).toHaveCount(0);

      // Wait for a terminal answer. The catalogue reads its rows in the browser, so "nothing
      // is there yet" and "nothing is there" are the same markup until that read returns.
      await expect(main.getByText(say(locale, 'state.loading'))).toHaveCount(0);

      const surface =
        what === 'catalogue'
          ? main.getByRole('table', { name: say(locale, 'reports.catalogue.caption') })
          : main.getByRole('button', { name: say(locale, 'reports.run.show'), exact: true });

      if (!mayRead) {
        // A refusal, and a whole one. The explanation belongs to it: a title alone is a
        // screen that stopped mid-sentence, and the operator's next step is in the second
        // line rather than the first.
        await expect(
          main.getByText(say(locale, 'state.denied.title')),
          `${kind} does not hold ${REPORT_READ}, so the ${what} must refuse it and say so`
        ).toBeVisible();
        await expect(main).toContainText(say(locale, 'state.denied.description'));
        await expect(
          main,
          'a permission denial was rendered as "nothing here yet", which tells an operator to ' +
            'go and create something instead of asking for the code they are missing'
        ).not.toContainText(say(locale, 'state.empty.title'));
        await expect(
          surface,
          `the ${what} rendered the surface behind the gate to a caller it had just refused`
        ).toHaveCount(0);
        if (what === 'run screen') {
          // Nothing the report definition carries is on the page, which is what "refused
          // before the read" looks like from a browser: the idle state is part of
          // `ReportScreen`, and `ReportScreen` is only reached once `readReport` has answered.
          await expect(
            main.getByText(say(locale, 'reports.run.idleTitle')),
            'the run screen refused the caller and still showed the definition it should ' +
              'never have read'
          ).toHaveCount(0);
        }
        return;
      }

      // The account holds the code, so the whole surface is owed — and a refusal here is
      // a failure rather than an alternative. An unexplained blank region fails too.
      await expect(
        main.getByText(say(locale, 'state.denied.title')),
        `${kind} holds ${REPORT_READ}, so the ${what} must not refuse it`
      ).toHaveCount(0);
      await expect(surface).toBeVisible();
      if (what === 'catalogue') {
        // The catalogue's standing statement about export, which is the whole of its export
        // story and would be contradicted silently by a control appearing later.
        await expect(main.getByText(say(locale, 'reports.catalogue.noDownload'))).toBeVisible();
      } else {
        // Nothing has been run yet, and the screen says so rather than showing an empty
        // table, which reads as a report that returned nothing.
        await expect(main.getByText(say(locale, 'reports.run.idleTitle'))).toBeVisible();
      }
    });
  }

  test('the catalogue offers all four datasets', async ({ page }, testInfo) => {
    // test-honesty-allow: TH-002 -- no acceptance handoff on this checkout; see NO_HANDOFF_REASON
    test.skip(handoff === null, NO_HANDOFF_REASON);
    // test-honesty-allow: TH-002 -- signed in as somebody other than the journey's own administrator; see WRONG_ACCOUNT_REASON
    test.skip(!signedInAsJourneyAdministrator(), WRONG_ACCOUNT_REASON);
    const h = handoff as P131Handoff;
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
     * locales — and its name is then required to be the exact name the CATALOGUE published
     * for whoever provides it.
     *
     * ## Why the provider is read from the handoff and not from the row
     *
     * This branch used to be taken by counting the origin cell on the page. That is the
     * screen answering a question about itself: a catalogue that had lost a workshop's row
     * and reported it as the platform's would simply have taken the other branch and passed,
     * and the weaker half of the branch only required the label to be non-empty and not equal
     * to the code — which a single character satisfies. The harness now records what the
     * `rpt.report-catalogue` operation itself said about each dataset, and both halves assert
     * the exact string: the platform's own translated title under the recorded key, or the
     * operator's own label as written. The origin cell is then asserted to AGREE with the
     * recorded provider, which is the assertion the old branch quietly replaced.
     */
    const byThePlatform = say(locale, 'reports.catalogue.origin.platform');
    const byTheWorkshop = say(locale, 'reports.catalogue.origin.workshop');
    const provenance = h.reportProvenance;
    expect(
      provenance,
      'the handoff carries no report provenance; re-run the acceptance harness, which ' +
        'records it from the catalogue operation itself'
    ).not.toBeNull();
    if (provenance === null) return;

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

      const offered = provenance[code];
      expect(offered, `the harness recorded no catalogue entry for ${code}`).toBeDefined();
      if (offered === undefined) continue;

      if (offered.source === 'platform') {
        // A code-registered baseline: shown under the platform's own title, in the reader's
        // language, by the key the operation published for it.
        const titleKey = offered.titleKey;
        expect(titleKey, `the platform's ${code} must be titled by a key`).not.toBeNull();
        if (titleKey === null) continue;
        await expect(row.getByText(byThePlatform, { exact: true })).toBeVisible();
        await expect(name).toHaveText(say(locale, titleKey));
      } else if (offered.source === 'tenant') {
        // A configuration this workshop published: its own label, shown as written and
        // never translated — so the SAME string is required in both locale projects.
        const own = offered.name;
        expect(own, `the workshop's ${code} must carry its own label`).not.toBeNull();
        if (own === null) continue;
        await expect(row.getByText(byTheWorkshop, { exact: true })).toBeVisible();
        await expect(name).toHaveText(own);
      } else {
        throw new Error(
          `the catalogue offered ${code} with an unknown provider ${String(offered.source)}; ` +
            'this case knows how a platform row and a workshop row must be named and refuses ' +
            'to guess at a third'
        );
      }
    }
  });

  for (const code of REPORT_CODES) {
    test(`${code} renders exactly the rows the server answered`, async ({ page }, testInfo) => {
      // test-honesty-allow: TH-002 -- no acceptance handoff on this checkout; see NO_HANDOFF_REASON
      test.skip(handoff === null, NO_HANDOFF_REASON);
      // test-honesty-allow: TH-002 -- signed in as somebody other than the journey's own administrator; see WRONG_ACCOUNT_REASON
      test.skip(!signedInAsJourneyAdministrator(), WRONG_ACCOUNT_REASON);
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

/* ================================================================== *
 * The export principal — a holder of rpt.export, from the companion
 * ================================================================== */

/**
 * The export control, addressed by the heading it labels itself with.
 *
 * A structural anchor rather than a test identifier, for the reason the result block above
 * is addressed the same way: the section names itself to assistive technology, so a locator
 * that uses that name asserts something the product owes a user rather than something added
 * for a test to hold on to.
 */
const EXPORT_SECTION = 'section[aria-labelledby="report-export-heading"]';

/**
 * The catalogue entries the export control cannot be rendered without.
 *
 * Named rather than read off the page: a control whose words are missing renders an
 * untranslated key, which `translate()` returns and a text query would happily match.
 */
const EXPORT_CONTROL_KEYS = [
  'reports.export.title',
  'reports.export.reason',
  'reports.export.download',
  'reports.export.ready',
] as const;

const exportHandoff = readExportHandoff();

test.describe('export principal (companion)', () => {
  /*
   * A fresh, signed-out context: the captured session belongs to the journey's
   * administrator, and this case is about a different principal entirely — one that holds
   * `rpt.export`, which no administrator in this product holds.
   */
  test.use({ storageState: { cookies: [], origins: [] } });

  /**
   * The export, exercised through the screen by the one principal entitled to it.
   *
   * ## What it establishes
   *
   * That the principal the export companion created can sign in through the real form, open
   * the reporting surface, run the report the companion exported over HTTP, and DOWNLOAD it
   * from the screen. The companion proves the operation and its audit record; this case
   * proves the browser half of the same disclosure, which is the evidence D-6 requires and
   * the one part no HTTP harness can stand in for.
   *
   * ## Why the control is asserted and never skipped over
   *
   * The export control is the frontend consumer of the contract in
   * `docs/phase-1/phase-1-31/report-export-seam.md`, and it may not be on the checkout under
   * test. When it is missing this case FAILS, deliberately: a skip would let a closing run
   * report a complete export story with no browser evidence of one, and that is the shape of
   * green tick this phase has already been burned by. The failure names the section, the
   * catalogue entries and the control it looked for, so it is actionable rather than
   * mysterious; if the shipped control names itself differently, this locator moves by
   * agreement.
   *
   * ## Two things it does NOT assert, and why
   *
   *   - It does not require the catalogue's standing export sentence to disappear for a
   *     holder. That sentence is the catalogue's own statement about where export lives, and
   *     the surface it points at is the run screen. Requiring its absence would be this
   *     suite deciding a product question it was not asked.
   *   - It does not compare the downloaded bytes against the companion's digest. The file is
   *     generated live from the same records on each request, and two disclosures taken
   *     seconds apart may legitimately differ in their `generatedAt`. What is asserted is
   *     that the browser really received a download, and what it was called.
   *
   * ## The one condition under which it may skip
   *
   * No companion handoff on this checkout — so no principal, and therefore no holder of
   * `rpt.export` to sign in as. Every other absence is a failure.
   */
  test('a holder of rpt.export downloads the report from the screen', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    // test-honesty-allow: TH-002 -- no export companion handoff on this checkout; see NO_EXPORT_HANDOFF_REASON
    test.skip(exportHandoff === null, NO_EXPORT_HANDOFF_REASON);
    const h = exportHandoff as P131ExportHandoff;
    const locale = localeOf(testInfo.project.name);
    // test-honesty-allow: TH-002 -- the reporting slice is not on this checkout; see reportsAbsentReason
    test.skip(!hasMessage(locale, CATALOGUE_TITLE_KEY), reportsAbsentReason(locale));

    /*
     * Signing in through the real form, once, for the reason
     * `appointments-and-receptions.spec.ts` gives: the session is an `httpOnly` cookie set by
     * a Server Action, so driving the form proves the form, the action, the API contract and
     * the cookie together. `POST /api/v1/auth/login` is rationed at ten per sixty seconds per
     * client address and this tier shares one bucket, so this block spends exactly one
     * sign-in per project.
     *
     * The form is opened in English regardless of the project's locale — the session is the
     * same cookie either way, and the screens under assertion are then opened in the
     * project's own language. The password is addressed by role because `getByLabel` matches
     * an accessible name as a SUBSTRING and the reveal control inside the field is named for
     * showing the password.
     */
    await page.goto('/en/login');
    await page.getByLabel(say('en', 'auth.login.email')).fill(h.exportPrincipal.email);
    await page
      .getByRole('textbox', { name: say('en', 'auth.login.password'), exact: true })
      .fill(h.exportPrincipal.password);
    await page.getByRole('button', { name: say('en', 'auth.login.submit') }).click();
    await page.waitForURL(/\/en(\?.*)?$/, { timeout: 20_000 });

    // The catalogue, for a principal that holds `rpt.report.read` in this branch and nothing
    // like an administrator's bundle. A refusal here is a failure: the fixture the companion
    // recorded grants that read, and the companion's own evidence says whether its setup
    // succeeded.
    await page.goto(`/${locale}/reports`);
    const main = page.getByRole('main');
    await expect(
      main.getByRole('heading', { name: say(locale, CATALOGUE_TITLE_KEY), exact: true })
    ).toBeVisible();
    await expect(main.getByText(say(locale, 'state.loading'))).toHaveCount(0);
    await expect(
      main.getByText(say(locale, 'state.denied.title')),
      'the export principal holds the report read code, so the catalogue must not refuse it — ' +
        'if it does, read the companion evidence for whether its fixture setup succeeded'
    ).toHaveCount(0);
    await expect(
      main.getByRole('table', { name: say(locale, 'reports.catalogue.caption') })
    ).toBeVisible();

    // The run screen for the very dataset the companion exported over HTTP, run over the same
    // branch and the same period, because the control mounts beneath a result.
    await page.goto(`/${locale}/reports/${h.reportCode}`);
    await expect(page.getByText(say(locale, 'reports.run.idleTitle'))).toBeVisible();
    await runReport(page, locale, h, h.reportPeriod);
    await expect(
      page.locator('section[aria-labelledby="report-result-heading"] > dl')
    ).toBeVisible();

    /*
     * THE DEPENDENCY. Everything above is satisfiable by the reporting slice alone; what
     * follows needs the export control, and fails until it ships.
     */
    const absent = EXPORT_CONTROL_KEYS.filter((key) => !hasMessage(locale, key));
    expect(
      absent,
      `${locale}.json carries no ${absent.join(', ')}, so the reports export control is not on ` +
        'this checkout. The positive export browser evidence D-6 requires cannot be collected ' +
        'until it lands; this case fails rather than skipping so the gap cannot be mistaken ' +
        'for evidence.'
    ).toEqual([]);

    const control = page.locator(EXPORT_SECTION);
    await expect(
      control,
      'the run screen offered no export control to a holder of rpt.export. The backend ' +
        'contract is published and the principal holds the code, so the missing half is the ' +
        'frontend consumer — unless the report carries no published configuration, which the ' +
        'companion establishes before this case runs.'
    ).toBeVisible();
    await expect(
      control.getByRole('heading', { name: say(locale, 'reports.export.title'), exact: true })
    ).toBeVisible();
    // The withheld sentence is what a caller WITHOUT the code is shown instead of the
    // control. Both at once would mean the screen cannot decide what this caller may do.
    await expect(
      main.getByText(say(locale, 'reports.export.withheld')),
      'the screen offered the export control and the withheld notice at the same time'
    ).toHaveCount(0);

    /*
     * The reason is REQUIRED by the contract — a nonblank string of at most 500 characters —
     * and the control asks for it before it will disclose anything. Filling it here is part
     * of the assertion: a control that downloaded without one would be sending a request the
     * route refuses.
     */
    await control.getByLabel(say(locale, 'reports.export.reason')).fill('P1-31 acceptance');

    const download = control.getByRole('button', {
      name: say(locale, 'reports.export.download'),
      exact: true,
    });
    await expect(download).toBeEnabled();

    // The DOWNLOAD ITSELF, as the browser saw it. This is the evidence a screenshot cannot
    // give and an HTTP harness cannot give either.
    const [received] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      download.click(),
    ]);
    expect(
      received.suggestedFilename(),
      'the downloaded file is not named for the report and period that produced it'
    ).toBe(`${h.reportCode}-${h.reportPeriod.from}-${h.reportPeriod.to}.csv`);

    // And the screen says so, in the product's own words, rather than leaving the operator
    // to guess whether anything happened.
    await expect(page.getByText(say(locale, 'reports.export.ready'))).toBeVisible();
  });
});
