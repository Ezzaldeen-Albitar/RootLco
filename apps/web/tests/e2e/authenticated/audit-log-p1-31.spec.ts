import { expect, test } from '@playwright/test';
import { NO_HANDOFF_REASON, localeOf, readHandoff, say, type P131Handoff } from './p1-31-handoff';

/**
 * P1-31 acceptance, browser half: the audit log over the journey's own writes.
 *
 * The two operations P1-31's chain ends with each declare an `auditAction`:
 * `sal.delivery-complete` declares `sal.delivery.completed` and `wty.warranty-generate`
 * declares `wty.warranty.issued`. A declaration is not evidence that anything was written,
 * and the audit screen is where an operator would go to find out. So these cases filter the
 * log to the branch the journey worked in and require both actions to be there.
 *
 * ## Why the action codes are asserted raw
 *
 * The action column renders the code itself, in a `<code>` element — the audit log is a
 * record of what the system did, addressed by the identifier the system used, and
 * translating it would make two different actions indistinguishable when their prose
 * happened to match. So the assertion is on the code, and that is the screen's own choice
 * rather than this suite's.
 */

const handoff = readHandoff();

/** The two actions the journey's last two writes were obliged to record. */
const REQUIRED_ACTIONS = ['sal.delivery.completed', 'wty.warranty.issued'] as const;

/** A day either side of the run, so the range cannot exclude it. */
function dayOffset(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test.describe('P1-31 audit log, over the acceptance journey writes', () => {
  test('the log records the handover completion and the warranty issue', async ({
    page,
  }, testInfo) => {
    // test-honesty-allow: TH-002 -- no acceptance handoff on this checkout; see NO_HANDOFF_REASON
    test.skip(handoff === null, NO_HANDOFF_REASON);
    const h = handoff as P131Handoff;
    const locale = localeOf(testInfo.project.name);

    await page.goto(`/${locale}/administration/audit-log`);
    await expect(page.getByRole('heading', { name: say(locale, 'audit.title') })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');

    // Two statements that are the whole of this screen's contract, asserted before any
    // filter is applied: the records cannot be changed from here, and opening the screen is
    // itself recorded.
    await expect(page.getByText(say(locale, 'audit.readOnly'))).toBeVisible();
    await expect(page.getByText(say(locale, 'audit.viewedNotice'))).toBeVisible();

    /*
     * Every control by its ROLE and its WHOLE name.
     *
     * A label is matched as a SUBSTRING of an accessible name, and this filter form's names
     * nest in Arabic in a way they do not in English: `audit.from` is "من", which is inside
     * "المنفّذ" — the actor field — so the date this case widens matched two textboxes and
     * strict mode refused to guess. Role separates a date field from a text field and an
     * exact name separates either from a longer one, which is the convention the pre-existing
     * authenticated specs settled on for the same trap on "Password".
     */
    // Addressed on the PAGE rather than inside the filter form, deliberately: the date range
    // is a pair of controls BESIDE that form and not in it, so scoping them to it would be
    // asserting a structure this screen does not have.
    //
    // Widen the range past the default seven days in both directions, so a run made just
    // after midnight cannot fall outside it, then narrow to the journey's own branch.
    await page
      .getByRole('textbox', { name: say(locale, 'audit.from'), exact: true })
      .fill(dayOffset(-2));
    await page
      .getByRole('textbox', { name: say(locale, 'audit.to'), exact: true })
      .fill(dayOffset(1));
    await page
      .getByRole('combobox', { name: say(locale, 'audit.filter.company'), exact: true })
      .selectOption(h.companyId);
    await page
      .getByRole('combobox', { name: say(locale, 'audit.filter.branch'), exact: true })
      .selectOption(h.branchId);
    await page
      .getByRole('button', { name: say(locale, 'audit.filter.apply'), exact: true })
      .click();

    const table = page.getByRole('table', { name: say(locale, 'audit.title') });
    await expect(table).toBeVisible();
    // Each header by its WHOLE name: a header name is matched as a substring otherwise, and
    // "Action" is inside the row-actions column's own name, so the loose query matched two
    // headers and strict mode refused. Both headers belong on the table; the ambiguity was in
    // the query.
    for (const key of [
      'audit.column.occurredAt',
      'audit.column.actor',
      'audit.column.action',
      'audit.column.entity',
      'audit.column.correlationId',
    ]) {
      await expect(
        table.getByRole('columnheader', { name: say(locale, key), exact: true })
      ).toBeVisible();
    }

    // Each action filtered for on its own, rather than scanning one page for both. The log
    // is keyset-paged, so "both appear on page one" is a claim about paging and not about
    // whether the writes were recorded — the mistake the P1-28 record calls a paged read
    // answering for the whole set.
    for (const action of REQUIRED_ACTIONS) {
      await page
        .getByRole('textbox', { name: say(locale, 'audit.filter.action'), exact: true })
        .fill(action);
      await page
        .getByRole('button', { name: say(locale, 'audit.filter.apply'), exact: true })
        .click();
      await expect(
        table.getByRole('cell').filter({ hasText: action }).first(),
        `the audit log must carry ${action}; the operation declares it as its auditAction`
      ).toBeVisible();
    }
  });

  /**
   * This case carries NO skip, and that is deliberate.
   *
   * It asserts a property of the screen and not of the journey's records: that the audit log
   * publishes no export and says so. Nothing about it needs a delivery, a warranty or a report
   * run, so gating it on the handoff was a mistake — it made a case that can always run look
   * like one that never can.
   *
   * It executes in continuous integration because the governed job signs in as the acceptance
   * owner, whose permission set (`OWNER_PERMISSIONS` in
   * `scripts/dev/owner-acceptance/context.mjs`) holds `iam.audit.view`, the code this page
   * gates on. The heading and the denial's absence are asserted for that reason and not as
   * decoration: they are what proves the session reached the screen rather than a refusal that
   * happens to carry no download link either.
   */
  test('the log offers no export, and says why', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo.project.name);

    await page.goto(`/${locale}/administration/audit-log`);

    await expect(page.getByRole('heading', { name: say(locale, 'audit.title') })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(page.getByText(say(locale, 'state.denied.title'))).toHaveCount(0);

    // The absence is stated rather than left to be noticed: the service publishes no export
    // operation for audit records, so the screen offers none and says so. A download
    // control appearing later would contradict this sentence, which is the point of
    // asserting on the sentence and not only on the absence of a button.
    await expect(page.getByText(say(locale, 'audit.noExport'))).toBeVisible();
    // Structural, not textual: a name pattern written in English would assert nothing at
    // all in the Arabic project, and this case runs in both.
    await expect(page.locator('a[download]')).toHaveCount(0);
  });
});
