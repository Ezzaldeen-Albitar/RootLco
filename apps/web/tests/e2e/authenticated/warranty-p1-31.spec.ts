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
   * Both reads, and the write affordance beside them, for the caller the acceptance names.
   *
   * ## What this case used to assert, and why it was wrong about the environment
   *
   * It asserted that the plan-creation panel was WITHHELD, on the ground that the code
   * `canManagePolicies` consults is not held. That was a statement about a permission set no
   * acceptance caller has. A freshly provisioned organisation's first administrator holds the
   * whole tenant-administrator bundle, and `wty.policy.manage` is IN it — carried by P1-31
   * prerequisite P-10 the day five operations began declaring it, because
   * `resolvePolicy` refuses a company with no active warranty plan and an administrator who
   * could not create one could never issue a warranty at all
   * (`apps/api/src/modules/iam/domain/bootstrap-roles.ts`). So the screen offered the panel,
   * correctly, and the assertion failed on a truth about the product.
   *
   * ## What it asserts now
   *
   * The same render, read the other way round: both warranty reads are REACHABLE, and the
   * write affordance beside them is OFFERED — heading and submit together, so a panel that
   * lost its control or a control that lost its panel both fail. That an affordance appears
   * for the holder of its code is the half of the permission contract no static check can
   * see, and it is the half this caller can evidence.
   *
   * ## Why there is no negative here, and why none is invented
   *
   * A negative would need a code these two screens gate on that the bundle does NOT carry.
   * There is none: the warranty surface gates on `wty.warranty.read`, `wty.warranty.issue`
   * and `wty.policy.manage`, and the bundle holds all three. The one reporting-adjacent code
   * the bundle is denied by Owner decision — `rpt.export`, CC-04 — is not reachable from any
   * warranty screen. So this case states the positive and says plainly that the negative is
   * unavailable, rather than manufacturing one out of an affordance nobody publishes.
   *
   * ## Why it needs the handoff
   *
   * Because it is a case about a CALLER, and the caller is the one the handoff names: the
   * acceptance signs the browser in as the first administrator of the organisation the
   * journey provisioned. Without the handoff the session belongs to some other account whose
   * set nothing here has established, and a permission case asserted against an unknown
   * holder is the mistake this rewrite exists to correct.
   */
  test('both warranty reads are reachable, and plan creation is offered to its holder', async ({
    page,
  }, testInfo) => {
    // test-honesty-allow: TH-002 -- no acceptance handoff on this checkout; see NO_HANDOFF_REASON
    test.skip(handoff === null, NO_HANDOFF_REASON);
    const locale = localeOf(testInfo.project.name);

    for (const [path, titleKey] of [
      ['warranty', 'warranty.list.title'],
      ['warranty/policies', PLANS_TITLE_KEY],
    ] as const) {
      await page.goto(`/${locale}/${path}`);

      await expect(page.getByRole('heading', { name: say(locale, titleKey) })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');

      // The read code IS held, so the gate must let this session through. Asserting the
      // denial's absence is what makes this a permission case rather than a smoke test: it
      // fails if the page starts demanding a code it does not declare.
      await expect(
        page.getByText(say(locale, 'state.denied.title')),
        'the tenant-administrator bundle holds wty.warranty.read, so this screen must not ' +
          'refuse. A refusal here means the browser is signed in as some account other than ' +
          'the first administrator of the organisation the handoff names'
      ).toHaveCount(0);
    }

    // Still on the plans screen. The panel and its control, together: the whole affordance
    // is present for a holder of `wty.policy.manage`, not a heading over nothing.
    await expect(
      page.getByRole('heading', { name: say(locale, 'warranty.policies.createHeading') }),
      'the bundle holds wty.policy.manage, so the plan-creation panel must be offered'
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: say(locale, 'warranty.policies.createSubmit') })
    ).toBeVisible();
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
