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
   * What runs WITHOUT a handoff, and why it is worth running.
   *
   * The governed job signs in as the acceptance owner, whose permission set
   * (`OWNER_PERMISSIONS` in `scripts/dev/owner-acceptance/context.mjs`) holds
   * `wty.warranty.read` — the code BOTH warranty pages gate on — and does **not** hold
   * `wty.warranty.manage`, which is what `canManagePolicies` consults before offering the
   * create panel.
   *
   * That asymmetry is the case below, and it is the strongest thing these specs can assert
   * without journey data: the two reads are REACHABLE, and the write affordance beside them is
   * WITHHELD from the same session in the same render. A screen that offered the create panel
   * to a read-only holder would be an over-grant by omission — the exact failure
   * `warranty-contract.ts` records `wty.warranty.read` as having been minted to end — and no
   * static check can see it, because the affordance is correct in the source and wrong only in
   * what it is handed.
   */
  test('both warranty reads are reachable, and plan creation is withheld', async ({
    page,
  }, testInfo) => {
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
      await expect(page.getByText(say(locale, 'state.denied.title'))).toHaveCount(0);
    }

    // Still on the plans screen. The create panel is gated on `wty.warranty.manage`, which
    // this session does not hold, so the whole panel — heading, explanation and submit — is
    // absent rather than present-and-disabled.
    await expect(
      page.getByRole('heading', { name: say(locale, 'warranty.policies.createHeading') })
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: say(locale, 'warranty.policies.createSubmit') })
    ).toHaveCount(0);
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

    await page.getByLabel(say(locale, 'warranty.common.branchField')).selectOption(h.branchId);
    await page.getByRole('button', { name: say(locale, 'warranty.target.choose') }).click();

    await expect(
      page.getByRole('heading', { name: say(locale, 'warranty.list.heading') })
    ).toBeVisible();
    // The harness issued a warranty in this branch, so the empty state must NOT be shown.
    await expect(page.getByText(say(locale, 'warranty.list.noneTitle'))).toHaveCount(0);

    const table = page.getByRole('table', { name: say(locale, 'warranty.list.tableCaption') });
    await expect(table).toBeVisible();
    for (const key of [
      'warranty.list.columnPolicy',
      'warranty.list.columnStatus',
      'warranty.list.columnStart',
      'warranty.list.columnExpiry',
      'warranty.list.columnOdometerLimit',
      'warranty.list.columnVehicle',
    ]) {
      await expect(table.getByRole('columnheader', { name: say(locale, key) })).toBeVisible();
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
    for (const key of [
      'warranty.policies.columnName',
      'warranty.policies.columnCode',
      'warranty.policies.columnState',
    ]) {
      await expect(table.getByRole('columnheader', { name: say(locale, key) })).toBeVisible();
    }
    await expect(table.locator('tbody tr')).not.toHaveCount(0);
  });
});
