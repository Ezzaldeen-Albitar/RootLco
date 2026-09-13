import { expect, test } from '@playwright/test';
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
 * P1-31 acceptance, browser half: the warranty screens.
 *
 * The HTTP harness generated a warranty from a delivered handover under a policy it had
 * created, with two coverage windows. These cases open the list, the record and the plans
 * screen over those rows.
 *
 * ## Why the plans screen is conditional and the other two are not
 *
 * The warranty list and record ship on `develop`. The plans screen arrives with the
 * warranty-policy-administration slice, and a checkout without that merge has the routes
 * absent. Rather than assert a 404 — which would pass on a broken build too — the case
 * asks the message catalogue whether the screen's own strings exist, and skips with the
 * reason stated when they do not. The acceptance plan's merge list is what makes the case
 * run; nothing here silently lowers the bar.
 */

const handoff = readHandoff();

/** The one key the plans screen cannot render without. */
const PLANS_TITLE_KEY = 'warranty.policies.title';

test.describe('P1-31 warranty screens, over the acceptance journey records', () => {
  /**
   * Both warranty screens, for whichever caller the browser tier signed in as.
   *
   * ## Why this case carries no handoff gate, and must not
   *
   * It was handoff-gated, and that is what took this file to ZERO executed tests in the
   * governed job. Nothing in `.github/workflows/_reusable-authenticated-browser.yml` sets
   * `ROOTLCO_P131_HANDOFF`, so every case in the file skipped and the tier's own guard — "a run
   * that collected nothing is a failure, not a pass" — failed the job for a file that had gone
   * silent. This case needs no journey record: both screens answer for a caller alone.
   *
   * ## The problem it actually has to solve
   *
   * Two different callers reach these screens, and `acceptance-record.md` §3.1 records the
   * collision as its cause B:
   *
   *   - the governed job signs in through `auth.setup.ts`, which reads the credentials
   *     `acceptance:create-owner` wrote into `.local/owner-acceptance-account.json`. That
   *     account holds `OWNER_PERMISSIONS` (`scripts/dev/owner-acceptance/context.mjs`) — it
   *     carries `wty.warranty.read`, the code BOTH warranty pages gate on, and it does not
   *     carry `wty.policy.manage`, the code that decides whether the plans screen offers its
   *     create panel.
   *   - a local acceptance overrides those credentials with the first administrator of the
   *     organisation the journey provisioned, who holds the whole tenant-administrator bundle
   *     and therefore holds both.
   *
   * A case that pins the panel as withheld is false for the second caller; a case that pins it
   * as offered is false for the first. Both were written, in that order, and each failed on a
   * truth about the other environment.
   *
   * ## What it asserts instead
   *
   * The part of the contract that holds for both, and then the outcome in front of it, in
   * full. Nothing here is weaker than the version it replaces:
   *
   *   - each screen either lets the session through or refuses it COMPLETELY — title and
   *     explanation, with nothing behind the gate left on the page. A refusal is decided by
   *     whether the page's own surface is there, not by whether the denial WORDS are: the
   *     plans screen's results region renders the same shared refusal when the list read is
   *     turned down, and reading the outcome off the words would confuse a page that was
   *     refused with a page whose list was.
   *   - the branch has to be named before anything is read, and the list says so before it
   *     says anything else.
   *   - the plan-creation panel is WHOLE or ABSENT: a heading with no control, or a control
   *     with no heading, fails whichever caller is looking. That is the same assertion the
   *     previous version made about the holder, stated so that it also binds the caller who
   *     does not hold the code — and in the governed job it is the half that runs, because
   *     `wty.policy.manage` is genuinely absent there while `wty.warranty.read` is genuinely
   *     present. A withheld write must not withhold the read beside it, and that pairing is
   *     asserted here rather than assumed.
   */
  test('both warranty screens answer for the caller in front of them', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo.project.name);
    const direction = locale === 'ar' ? 'rtl' : 'ltr';
    /*
     * Read inside `main`. The sidebar renders its own group headings and its own warranty
     * entries, so a page-wide heading query matches the rail as well as the page's `h1` —
     * the strict-mode ambiguity every sibling spec in this directory hit once. The `h1` is
     * inside `main`; the rail is not.
     */
    const main = page.getByRole('main');

    // --- the warranty list -------------------------------------------------------------
    await page.goto(`/${locale}/warranty`);
    await expect(
      main.getByRole('heading', { name: say(locale, 'warranty.list.title'), exact: true })
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', direction);

    // The form that names the branch is this screen's own surface, and the page-level gate
    // replaces the whole body — so its presence is what separates "reached" from "refused".
    const targetForm = main.getByRole('form', { name: say(locale, 'warranty.target.formLabel') });
    if ((await targetForm.count()) === 0) {
      await expect(main).toContainText(say(locale, 'state.denied.title'));
      await expect(main).toContainText(say(locale, 'state.denied.description'));
      await expect(
        main,
        'a permission denial was rendered as "nothing here yet", which tells an operator to ' +
          'go and create something instead of asking for the code they are missing'
      ).not.toContainText(say(locale, 'state.empty.title'));
    } else {
      await expect(targetForm).toBeVisible();
      // Nothing is read until a branch is named, and the screen says so. Asserted before any
      // choice is made, because "the list is empty" and "no branch has been chosen" are two
      // different states and only one of them would be a finding.
      await expect(main.getByText(say(locale, 'warranty.list.chooseBranchFirst'))).toBeVisible();
      await expect(
        main.getByRole('table', { name: say(locale, 'warranty.list.tableCaption') }),
        'the list read warranties before a branch was named'
      ).toHaveCount(0);
      await expect(main.getByText(say(locale, 'state.denied.title'))).toHaveCount(0);
    }

    /*
     * --- the warranty plans screen ------------------------------------------------------
     *
     * Conditional on the catalogue, and conditionally ASSERTED rather than skipped. The plans
     * screen arrives with the warranty-policy-administration slice; a checkout without that
     * merge has the route absent, and asking `say()` for a string that is not there throws.
     * Turning the whole case off for it would put this file back where it started — silent,
     * and failing the tier's own guard — while the list half above needs no slice at all. So
     * the list is always asserted and the plans screen is asserted whenever it exists.
     */
    if (!hasMessage(locale, PLANS_TITLE_KEY)) return;

    await page.goto(`/${locale}/warranty/policies`);
    await expect(
      main.getByRole('heading', { name: say(locale, PLANS_TITLE_KEY), exact: true })
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', direction);

    const createHeading = main.getByRole('heading', {
      name: say(locale, 'warranty.policies.createHeading'),
      exact: true,
    });
    const createSubmit = main.getByRole('button', {
      name: say(locale, 'warranty.policies.createSubmit'),
      exact: true,
    });
    const filterForm = main.getByRole('form', {
      name: say(locale, 'warranty.policies.filterFormLabel'),
    });

    if ((await filterForm.count()) === 0) {
      // Refused by the page's own gate, which withholds everything: no read surface, and no
      // write affordance sitting above a body that was never rendered.
      await expect(main).toContainText(say(locale, 'state.denied.title'));
      await expect(main).toContainText(say(locale, 'state.denied.description'));
      await expect(createHeading).toHaveCount(0);
      await expect(createSubmit).toHaveCount(0);
      return;
    }

    // `wty.warranty.read` let the session through, so the READ surface is whole.
    await expect(filterForm).toBeVisible();

    // And the write affordance is whole or absent, never half of itself.
    const panels = await createHeading.count();
    const controls = await createSubmit.count();
    expect(
      controls,
      'the plan-creation panel and its control must appear together: a heading over no ' +
        'control offers something that cannot be done, and a control under no heading is a ' +
        'write with nothing saying what it writes'
    ).toBe(panels);
    if (panels > 0) {
      await expect(createHeading).toBeVisible();
      await expect(createSubmit).toBeVisible();
    }
  });

  test("the branch's warranty list carries the generated warranty", async ({ page }, testInfo) => {
    // test-honesty-allow: TH-002 -- no acceptance handoff on this checkout; see NO_HANDOFF_REASON
    test.skip(handoff === null, NO_HANDOFF_REASON);
    const h = handoff as P131Handoff;
    const locale = localeOf(testInfo.project.name);

    await page.goto(`/${locale}/warranty`);
    await expect(
      page.getByRole('heading', { name: say(locale, 'warranty.list.title') })
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');

    // Nothing is read until a branch is named — the screen says so, and that sentence is
    // asserted before the choice is made, because "the list is empty" and "no branch has
    // been chosen" are two different states and only one of them is a finding.
    await expect(page.getByText(say(locale, 'warranty.list.chooseBranchFirst'))).toBeVisible();

    /*
     * The branch control by ROLE, with its whole name — and the role is what makes this
     * case wait for the right node instead of racing it.
     *
     * `getByLabel(…'Branch')` matched THREE: the section, whose `aria-labelledby` heading is
     * the word itself; the form, whose `aria-label` is "Choose the branch"; and the control.
     * Strict mode refused, and it refused INSTANTLY — which hid a second thing. This screen
     * reads the branch directory after mounting, and until that read answers it renders
     * identifier text fields instead of a picker, so the third node strict mode named was the
     * "Branch identifier" textbox and not a select at all. A `combobox` named exactly the
     * field's name resolves to nothing until the picker arrives, and `selectOption` waits for
     * it — which is the honest way to wait for a directory rather than for a timeout.
     */
    await page
      .getByRole('combobox', { name: say(locale, 'warranty.common.branchField'), exact: true })
      .selectOption(h.branchId);
    await page
      .getByRole('button', { name: say(locale, 'warranty.target.choose'), exact: true })
      .click();

    await expect(
      page.getByRole('heading', { name: say(locale, 'warranty.list.heading') })
    ).toBeVisible();
    // The harness issued a warranty in this branch, so the empty state must NOT be shown.
    await expect(page.getByText(say(locale, 'warranty.list.noneTitle'))).toHaveCount(0);

    const table = page.getByRole('table', { name: say(locale, 'warranty.list.tableCaption') });
    await expect(table).toBeVisible();
    // Each header by its WHOLE name. A header name is otherwise matched as a substring, and
    // this table's own names nest: "Cover ends" is inside "Odometer reading at which cover
    // ends", so the loose query matched two headers and strict mode refused.
    for (const key of [
      'warranty.list.columnPolicy',
      'warranty.list.columnStatus',
      'warranty.list.columnStart',
      'warranty.list.columnExpiry',
      'warranty.list.columnOdometerLimit',
      'warranty.list.columnVehicle',
    ]) {
      await expect(
        table.getByRole('columnheader', { name: say(locale, key), exact: true })
      ).toBeVisible();
    }
    await expect(table.locator('tbody tr')).not.toHaveCount(0);
  });

  test('the warranty record shows its terms and what it covers', async ({ page }, testInfo) => {
    // test-honesty-allow: TH-002 -- no acceptance handoff on this checkout; see NO_HANDOFF_REASON
    test.skip(handoff === null, NO_HANDOFF_REASON);
    const h = handoff as P131Handoff;
    // test-honesty-allow: TH-002 -- the journey generated no warranty; nothing to open
    test.skip(h.warrantyId === null, missingReason('warranty'));
    const locale = localeOf(testInfo.project.name);

    await page.goto(`/${locale}/warranty/${String(h.warrantyId)}`);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');

    const summary = page.locator('section[aria-labelledby="warranty-summary-heading"]');
    await expect(summary).toBeVisible();
    // The four facts a warranty is: its state, when cover starts, when it ends, and the
    // odometer reading at which it ends. Each asserted WHERE IT SITS, so a record showing
    // one of them and omitting the rest cannot pass.
    await expect(summary).toContainText(say(locale, 'warranty.summary.status'));
    await expect(summary).toContainText(say(locale, 'warranty.summary.startDate'));
    await expect(summary).toContainText(say(locale, 'warranty.summary.expiryDate'));
    await expect(summary).toContainText(say(locale, 'warranty.summary.odometerLimit'));

    // The plan it was issued under, which the record reads and never chooses.
    const policy = page.locator('section[aria-labelledby="warranty-policy-heading"]');
    await expect(policy).toBeVisible();
    await expect(policy).toContainText(say(locale, 'warranty.policy.name'));
    await expect(policy).toContainText(say(locale, 'warranty.policy.code'));

    // The handover this warranty came from is reachable from the record, which is the only
    // link between the two surfaces P1-31 delivers.
    if (h.deliveryId !== null) {
      await expect(
        page.getByRole('link', { name: say(locale, 'warranty.summary.deliveryLink') })
      ).toBeVisible();
    }
  });

  test('the warranty plans screen lists the plan the journey created', async ({
    page,
  }, testInfo) => {
    // test-honesty-allow: TH-002 -- no acceptance handoff on this checkout; see NO_HANDOFF_REASON
    test.skip(handoff === null, NO_HANDOFF_REASON);
    const h = handoff as P131Handoff;
    const locale = localeOf(testInfo.project.name);
    // test-honesty-allow: TH-002 -- the warranty-plans slice is not on this checkout, so the screen does not exist; the acceptance plan's merge list is what makes this case run
    test.skip(
      !hasMessage(locale, PLANS_TITLE_KEY),
      `${locale}.json has no "${PLANS_TITLE_KEY}", so the warranty plans screen is not on ` +
        'this checkout. Asserting a 404 instead would pass on a broken build too.'
    );
    // test-honesty-allow: TH-002 -- the journey created no policy; nothing to find in the list
    test.skip(h.warrantyPolicyId === null, missingReason('warranty plan'));

    await page.goto(`/${locale}/warranty/policies`);
    await expect(
      page.getByRole('heading', { name: say(locale, 'warranty.policies.title') })
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');

    // The harness created a plan in this organisation, so the empty state must be absent.
    await expect(page.getByText(say(locale, 'warranty.policies.noneTitle'))).toHaveCount(0);

    const table = page.getByRole('table', {
      name: say(locale, 'warranty.policies.tableCaption'),
    });
    await expect(table).toBeVisible();
    // By the WHOLE name, for the reason the list above states: "Plan" is inside "Plan
    // reference", so the loose query matched both headers and strict mode refused. The
    // duplication is in the query, not on the screen — a plan has a name and a reference,
    // and both columns belong there.
    for (const key of [
      'warranty.policies.columnName',
      'warranty.policies.columnCode',
      'warranty.policies.columnState',
    ]) {
      await expect(
        table.getByRole('columnheader', { name: say(locale, key), exact: true })
      ).toBeVisible();
    }
    await expect(table.locator('tbody tr')).not.toHaveCount(0);
  });
});
