import { expect, test, type Locator, type Page } from '@playwright/test';
import { holds, readAccountKind } from './account-manifest';
import {
  NO_HANDOFF_REASON,
  WRONG_ACCOUNT_REASON,
  hasMessage,
  localeOf,
  missingReason,
  readHandoff,
  say,
  signedInAsJourneyAdministrator,
  type P131Handoff,
  type P131OverviewFigures,
} from './p1-31-handoff';

/**
 * P1-31 acceptance, browser half: the operational overview — FE-010 and FE-016.
 *
 * ## Why this file exists
 *
 * `acceptance-record.md` records both requirements as REACHED BUT NOT VERIFIED. There was
 * no HTTP step for either and no browser case for either, so the only thing the record
 * could say was that the route answered. "Reached is not verified" is that sentence.
 *
 * Both halves are now covered. The harness makes the reads the screen makes — the
 * authorized company and branch directory, and one `rpt.report-run` per approved domain at
 * the overview's own page size of one row — and records the figures. These cases open the
 * screen over the same branch and the same period and require what it renders to be those
 * figures.
 *
 * ## FE-010 and FE-016 are ONE screen, and that is the point
 *
 * FE-010 is an operator naming a company and a branch on the overview's own form. FE-016 is
 * the same screen with `?branchId=` naming the branch in the address, resolved against the
 * caller's own directory and shown as a fixed selection they can see. There is no second
 * screen and no branch written into any source — which is what "no hard-coded pilot" means
 * in a place a test can check it.
 *
 * ## One pinned outcome per credential
 *
 * `rpt.report.read` is the code this page gates on, tested before anything is read. The
 * suite asks which account signed in and what that account holds, and pins the one outcome
 * it is entitled to: the whole refusal, or the whole surface. Nothing here accepts either.
 * The acceptance owner does not hold the code, so the refusal is the half that executes in
 * the governed job — which is what keeps this file from being one that can only run where
 * an acceptance has already been run.
 *
 * ## Why the figures are group COUNTS and the sections are addressed by code
 *
 * Each section is one report's own summary, grouped by the engine over the whole selection.
 * The number of groups is the figure the server owns and the screen may not invent; a
 * section panel carries `aria-labelledby="overview-section-<reportCode>"`, so it is
 * addressed by the report's identity rather than by a translated name that differs between
 * the two locale projects.
 */

const handoff = readHandoff();

/** The four approved domains, in the order the overview shows them. */
const REPORT_CODES = [
  'work_orders_by_status',
  'technician_labor_time',
  'inventory_movements',
  'invoice_payment_summary',
] as const;

/**
 * `REPORT_PERMISSIONS.read`, as
 * `apps/web/src/features/reports/reports-contract.ts` declares it.
 *
 * Repeated here because a spec may not import product source;
 * `tests/ci/p1-31-account-manifest.test.ts` asserts the manifest's membership of it in
 * both directions, so the string cannot go stale unnoticed.
 */
const REPORT_READ = 'rpt.report.read';

/** The one key the overview cannot render without. */
const OVERVIEW_TITLE_KEY = 'reports.overview.title';

function overviewAbsentReason(locale: 'en' | 'ar'): string {
  return (
    `${locale}.json has no "${OVERVIEW_TITLE_KEY}", so the operational overview is not on ` +
    "this checkout. The acceptance plan's merge list is what makes these cases run; " +
    'asserting a 404 instead would pass on a broken build too.'
  );
}

/** The page's own body, never the rail: the sidebar carries the same words. */
function body(page: Page): Locator {
  return page.getByRole('main');
}

/** One section panel, addressed by the report it summarises. */
function sectionPanel(page: Page, reportCode: string): Locator {
  return page.locator(`section[aria-labelledby="overview-section-${reportCode}"]`);
}

/** Fills the period and asks for the overview. The branch may already be fixed. */
async function showOverview(
  page: Page,
  locale: 'en' | 'ar',
  period: { readonly from: string; readonly to: string }
): Promise<void> {
  await page.getByLabel(say(locale, 'reports.run.from')).fill(period.from);
  await page.getByLabel(say(locale, 'reports.run.to')).fill(period.to);
  await page.getByRole('button', { name: say(locale, 'reports.overview.show') }).click();
}

/**
 * Requires one section to render exactly the summary the server published for it.
 *
 * A section with no groups says so in words — a measurement, and never an empty table,
 * because a blank region reads as a failure to load. A section with groups renders one
 * row per group and not one more: a screen that dropped a currency or added a total of
 * its own fails here, and that is the whole reason the figure comes from the harness
 * rather than from this file.
 */
async function expectSection(
  page: Page,
  locale: 'en' | 'ar',
  reportCode: string,
  figures: P131OverviewFigures
): Promise<void> {
  const panel = sectionPanel(page, reportCode);
  await expect(panel, `the overview must carry a section for ${reportCode}`).toHaveCount(1);
  await expect(
    panel.getByText(say(locale, 'reports.overview.notPublished')),
    `${reportCode} is published to this caller, so the overview must not say it is not`
  ).toHaveCount(0);

  if (figures.groups === 0) {
    await expect(
      panel.getByText(say(locale, 'reports.overview.noneInPeriod')),
      `the server published no summary rows for ${reportCode}, so the section must say so`
    ).toBeVisible();
    await expect(panel.locator('table')).toHaveCount(0);
    return;
  }

  await expect(
    panel.locator('tbody tr'),
    `the ${reportCode} section must show the ${String(figures.groups)} summary row(s) the ` +
      'server published, and no row of its own'
  ).toHaveCount(figures.groups);
}

test.describe('P1-31 operational overview, over the acceptance journey records', () => {
  /**
   * FE-010, for whichever account signed in — and the case that executes in the
   * governed job.
   *
   * No handoff is needed: the screen's gate and its idle state answer for a caller
   * alone. Under the acceptance owner this is a complete refusal; under the journey's
   * administrator it is the whole form, with the screen stating that nothing has been
   * shown yet rather than drawing an empty summary.
   */
  test('the overview answers exactly what the signed-in account is entitled to', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo.project.name);
    // test-honesty-allow: TH-002 -- the operational overview is not on this checkout; see overviewAbsentReason
    test.skip(!hasMessage(locale, OVERVIEW_TITLE_KEY), overviewAbsentReason(locale));

    const kind = readAccountKind();
    const mayRead = holds(kind, REPORT_READ);
    const main = body(page);

    await page.goto(`/${locale}/reports/overview`);
    await expect(
      main.getByRole('heading', { name: say(locale, OVERVIEW_TITLE_KEY), exact: true })
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');

    // No download, on either outcome. The export operation exists on this candidate, but no
    // export control is published on the overview: it lives on the single-report screen.
    await expect(page.locator('a[download]')).toHaveCount(0);

    const form = main.getByRole('form', { name: say(locale, 'reports.run.formLabel') });

    if (!mayRead) {
      // The gate runs before the directory and the catalogue are read, so a refusal here
      // withholds the whole body — not a form over an explanation.
      await expect(
        main.getByText(say(locale, 'state.denied.title')),
        `${kind} does not hold ${REPORT_READ}, so the overview must refuse it and say so`
      ).toBeVisible();
      await expect(main).toContainText(say(locale, 'state.denied.description'));
      await expect(
        main,
        'a permission denial was rendered as "nothing here yet", which tells an operator to ' +
          'go and create something instead of asking for the code they are missing'
      ).not.toContainText(say(locale, 'state.empty.title'));
      await expect(form).toHaveCount(0);
      for (const code of REPORT_CODES) {
        await expect(
          sectionPanel(page, code),
          'the overview drew a summary section for a caller it had just refused'
        ).toHaveCount(0);
      }
      return;
    }

    await expect(
      main.getByText(say(locale, 'state.denied.title')),
      `${kind} holds ${REPORT_READ}, so the overview must let it through`
    ).toHaveCount(0);
    await expect(form).toBeVisible();
    // Nothing has been asked for, and the screen says so rather than showing four empty
    // panels — which an operator reads as "there is nothing in this branch".
    await expect(main.getByText(say(locale, 'reports.overview.idleTitle'))).toBeVisible();
    for (const code of REPORT_CODES) {
      await expect(
        sectionPanel(page, code),
        'the overview summarised a selection nobody had made yet'
      ).toHaveCount(0);
    }
    // The branch is not fixed here — that sentence belongs to FE-016 and appearing without
    // an address that fixes anything would tell an operator they cannot change a branch
    // they can.
    await expect(main.getByText(say(locale, 'reports.overview.branchFixed'))).toHaveCount(0);
  });

  /**
   * FE-010's figures: the four sections carry what the server published, and nothing else.
   *
   * The figures come from the handoff, taken by the harness AFTER the last write of the
   * journey — see `recordReportRuns` there. A figure taken mid-journey describes a world
   * the journey then changed, which is how the first run produced a browser failure over a
   * product that was behaving correctly.
   */
  test('the four sections carry the figures the server published', async ({ page }, testInfo) => {
    // test-honesty-allow: TH-002 -- no acceptance handoff on this checkout; see NO_HANDOFF_REASON
    test.skip(handoff === null, NO_HANDOFF_REASON);
    // test-honesty-allow: TH-002 -- signed in as somebody other than the journey's own administrator; see WRONG_ACCOUNT_REASON
    test.skip(!signedInAsJourneyAdministrator(), WRONG_ACCOUNT_REASON);
    const h = handoff as P131Handoff;
    const locale = localeOf(testInfo.project.name);
    // test-honesty-allow: TH-002 -- the operational overview is not on this checkout; see overviewAbsentReason
    test.skip(!hasMessage(locale, OVERVIEW_TITLE_KEY), overviewAbsentReason(locale));
    // test-honesty-allow: TH-002 -- the journey recorded no overview reading, so there is no figure to compare against
    test.skip(h.overview === null, missingReason('recorded overview reading'));

    const overview = h.overview as NonNullable<P131Handoff['overview']>;
    const main = body(page);

    await page.goto(`/${locale}/reports/overview`);
    await expect(
      main.getByRole('heading', { name: say(locale, OVERVIEW_TITLE_KEY), exact: true })
    ).toBeVisible();

    await page.getByLabel(say(locale, 'reports.run.company')).selectOption(h.companyId);
    await page.getByLabel(say(locale, 'reports.run.branch')).selectOption(h.branchId);
    await showOverview(page, locale, overview.period);

    /*
     * The context the figures were read over, stated by the screen and asserted here.
     * A summary without its period and its zone is a number an operator cannot place,
     * and the zone is the branch's own rather than the browser's.
     */
    await expect(
      main.getByText(say(locale, 'reports.context.from'), { exact: true })
    ).toBeVisible();
    await expect(main.getByText(say(locale, 'reports.context.to'), { exact: true })).toBeVisible();
    await expect(
      main.getByText(say(locale, 'reports.context.timezone'), { exact: true })
    ).toBeVisible();

    for (const code of REPORT_CODES) {
      const figures = overview.generic[code];
      expect(figures, `the handoff must carry the overview reading of ${code}`).toBeDefined();
      if (figures === undefined) continue;
      await expectSection(page, locale, code, figures);
    }
  });

  /**
   * FE-016: the branch comes from the ADDRESS, is shown as fixed, and changes nothing else.
   *
   * Handoff-gated because the address has to name a branch the caller genuinely holds, and
   * the handoff is the only place this suite may get one from — inventing an identifier
   * would be asserting against a branch nobody provisioned. The figures compared against
   * are the harness's branch-fixed reading, which it takes separately from the chosen-branch
   * one precisely so that "the same overview for the selected branch" is a measured claim.
   */
  test('the overview fixed to a branch by the address shows that branch, and says so', async ({
    page,
  }, testInfo) => {
    // test-honesty-allow: TH-002 -- no acceptance handoff on this checkout; see NO_HANDOFF_REASON
    test.skip(handoff === null, NO_HANDOFF_REASON);
    // test-honesty-allow: TH-002 -- signed in as somebody other than the journey's own administrator; see WRONG_ACCOUNT_REASON
    test.skip(!signedInAsJourneyAdministrator(), WRONG_ACCOUNT_REASON);
    const h = handoff as P131Handoff;
    const locale = localeOf(testInfo.project.name);
    // test-honesty-allow: TH-002 -- the operational overview is not on this checkout; see overviewAbsentReason
    test.skip(!hasMessage(locale, OVERVIEW_TITLE_KEY), overviewAbsentReason(locale));
    // test-honesty-allow: TH-002 -- the journey recorded no overview reading, so there is no figure to compare against
    test.skip(h.overview === null, missingReason('recorded overview reading'));

    const overview = h.overview as NonNullable<P131Handoff['overview']>;
    const main = body(page);

    await page.goto(`/${locale}/reports/overview?branchId=${encodeURIComponent(h.branchId)}`);
    await expect(
      main.getByRole('heading', { name: say(locale, OVERVIEW_TITLE_KEY), exact: true })
    ).toBeVisible();

    // The branch in the address resolved in the caller's own directory: the screen renders
    // the no-branch body when it does not, so this distinguishes "fixed to my branch" from
    // "fixed to something I cannot see".
    await expect(
      main.getByText(say(locale, 'reports.run.noScopesTitle')),
      'the branch named in the address was not in the directory this caller can reach'
    ).toHaveCount(0);

    // Fixed, and SAID to be fixed. A filter an operator cannot see and cannot correct is
    // the defect this sentence exists to prevent, and it changes what every figure means.
    await expect(main.getByText(say(locale, 'reports.overview.branchFixed'))).toBeVisible();
    await expect(page.getByLabel(say(locale, 'reports.run.branch'))).toBeDisabled();
    await expect(page.getByLabel(say(locale, 'reports.run.company'))).toBeDisabled();
    await expect(page.getByLabel(say(locale, 'reports.run.branch'))).toHaveValue(h.branchId);

    await showOverview(page, locale, overview.period);

    for (const code of REPORT_CODES) {
      const figures = overview.branchFixed[code];
      expect(
        figures,
        `the handoff must carry the branch-fixed overview reading of ${code}`
      ).toBeDefined();
      if (figures === undefined) continue;
      await expectSection(page, locale, code, figures);
    }
  });
});
