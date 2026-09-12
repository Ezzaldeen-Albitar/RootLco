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

    // Widen the range past the default seven days in both directions, so a run made just
    // after midnight cannot fall outside it, then narrow to the journey's own branch.
    await page.getByLabel(say(locale, 'audit.from')).fill(dayOffset(-2));
    await page.getByLabel(say(locale, 'audit.to')).fill(dayOffset(1));
    await page.getByLabel(say(locale, 'audit.filter.company')).selectOption(h.companyId);
    await page.getByLabel(say(locale, 'audit.filter.branch')).selectOption(h.branchId);
    await page.getByRole('button', { name: say(locale, 'audit.filter.apply') }).click();

    const table = page.getByRole('table', { name: say(locale, 'audit.title') });
    await expect(table).toBeVisible();
    for (const key of [
      'audit.column.occurredAt',
      'audit.column.actor',
      'audit.column.action',
      'audit.column.entity',
      'audit.column.correlationId',
    ]) {
      await expect(table.getByRole('columnheader', { name: say(locale, key) })).toBeVisible();
    }

    // Each action filtered for on its own, rather than scanning one page for both. The log
    // is keyset-paged, so "both appear on page one" is a claim about paging and not about
    // whether the writes were recorded — the mistake the P1-28 record calls a paged read
    // answering for the whole set.
    for (const action of REQUIRED_ACTIONS) {
      await page.getByLabel(say(locale, 'audit.filter.action')).fill(action);
      await page.getByRole('button', { name: say(locale, 'audit.filter.apply') }).click();
      await expect(
        table.getByRole('cell').filter({ hasText: action }).first(),
        `the audit log must carry ${action}; the operation declares it as its auditAction`
      ).toBeVisible();
    }
  });

  test('the log offers no export, and says why', async ({ page }, testInfo) => {
    // test-honesty-allow: TH-002 -- no acceptance handoff on this checkout; see NO_HANDOFF_REASON
    test.skip(handoff === null, NO_HANDOFF_REASON);
    const locale = localeOf(testInfo.project.name);

    await page.goto(`/${locale}/administration/audit-log`);

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
