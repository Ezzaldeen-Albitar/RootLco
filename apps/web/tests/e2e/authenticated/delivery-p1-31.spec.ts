import { expect, test, type Page } from '@playwright/test';
import { holds, readAccountKind } from './account-manifest';
import {
  NO_HANDOFF_REASON,
  WRONG_ACCOUNT_REASON,
  localeOf,
  missingReason,
  readHandoff,
  say,
  signedInAsJourneyAdministrator,
  type P131Handoff,
} from './p1-31-handoff';

/**
 * P1-31 acceptance, browser half: the vehicle-handover screens.
 *
 * The HTTP harness (`orchestration/acceptance/p1-31-journey.mjs`, held outside the repository) has already walked a
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

/**
 * `DELIVERY_READINESS_PERMISSIONS`, as
 * `apps/web/src/features/delivery/readiness-contract.ts` declares it: a CONJUNCTION,
 * all three or nothing.
 *
 * Repeated here because a spec may not import product source; every one of the three
 * is asserted into the manifest by `tests/ci/p1-31-account-manifest.test.ts`.
 */
const READINESS_CODES = ['sal.delivery.view', 'wo.work_order.read', 'sal.finance.view'] as const;

/**
 * The directory codes the queue's company and branch selectors are built from.
 *
 * They decide between the screen's two idle answers: with the directory readable and a
 * branch in it, the queue renders its form and its "nothing has been asked for yet"
 * state; without, it renders "no branch is available to you". That is the difference
 * the case below pins, instead of accepting either.
 */
const DIRECTORY_CODES = ['org.company.read', 'org.branch.read'] as const;

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

/** A catalogue string used inside a pattern, with its own characters kept literal. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function printCalls(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __p131PrintCalls?: number }).__p131PrintCalls ?? -1
  );
}

/**
 * Chooses the branch the harness worked in, on the readiness queue's own form.
 *
 * Addressed by ROLE, inside the form, with an exact name — not by label text.
 * `getByLabel(…'Branch')` matched TWO nodes and strict mode refused to guess
 * between them: a label is matched as a SUBSTRING of an accessible name, and the
 * form's own `aria-label` ("Choose a branch to review delivery readiness")
 * contains the word. The form is a `form` and the control is a `combobox`, and
 * the asterisk beside a required label is `aria-hidden`, so the control's
 * accessible name is the field's name exactly. Naming the role and the whole name
 * is the same fix `auth.setup.ts` records for "Password" against "Show password".
 */
async function chooseBranch(page: Page, locale: 'en' | 'ar', h: P131Handoff): Promise<void> {
  const form = page.getByRole('form', { name: say(locale, 'delivery.queue.formLabel') });
  await form
    .getByRole('combobox', { name: say(locale, 'delivery.queue.company'), exact: true })
    .selectOption(h.companyId);
  await form
    .getByRole('combobox', { name: say(locale, 'delivery.queue.branch'), exact: true })
    .selectOption(h.branchId);
  await form.getByRole('button', { name: say(locale, 'delivery.queue.show'), exact: true }).click();
}

test.describe('P1-31 delivery screens, over the acceptance journey records', () => {
  /**
   * What runs WITHOUT a handoff, and why it is worth running.
   *
   * The governed job signs in as the acceptance owner, whose permission set
   * (`OWNER_PERMISSIONS` in `scripts/dev/owner-acceptance/context.mjs`) holds all THREE codes
   * this queue demands together — `sal.delivery.view`, `wo.work_order.read` and
   * `sal.finance.view`, the conjunction `DELIVERY_READINESS_PERMISSIONS` names. The screen is
   * therefore reachable in continuous integration, and what it shows there is one of its two
   * IDLE states, because the tenant the bootstrap makes carries no work order.
   *
   * That is the case below. It asserts the conjunction let this session through, and that the
   * screen answered with the ONE idle state that account is entitled to — rather than with a
   * blank region, which is the failure mode a queue has when it renders before it is asked and
   * reads to an operator as "nothing is ready" when the truth is "nothing has been requested".
   *
   * ## Which idle, and why it is pinned rather than accepted either way
   *
   * The screen has two honest idles. `noScopes` when the session can reach no
   * company-and-branch pair at all; `idle` when it can and has not asked yet. That is not a
   * fixture detail this case may decline to know: it is decided by whether the account holds
   * the two directory codes, and both credential kinds do, in an environment where an
   * organisation with a company and a branch was provisioned before the browser ran. So the
   * case pins `idle` and requires `noScopes` to be ABSENT. A directory that came back empty
   * for a caller entitled to read it would fail here, which is exactly the kind of silent
   * regression the previous "one of the two, either will do" version could not see.
   */
  test('the readiness queue answers exactly what the signed-in account is entitled to', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo.project.name);
    const kind = readAccountKind();
    const mayView = READINESS_CODES.every((code) => holds(kind, code));
    const mayReadDirectory = DIRECTORY_CODES.every((code) => holds(kind, code));

    await page.goto(`/${locale}/delivery`);

    await expect(
      page.getByRole('heading', { name: say(locale, 'delivery.queue.title') })
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');

    const denied = page.getByText(say(locale, 'state.denied.title'));
    if (!mayView) {
      // The conjunction is not satisfied, so the page refuses — wholly, and saying why.
      await expect(
        denied,
        `${kind} does not hold all of ${READINESS_CODES.join(', ')}, so the queue must refuse it`
      ).toBeVisible();
      await expect(page.getByText(say(locale, 'state.denied.description'))).toBeVisible();
      await expect(
        page.getByRole('form', { name: say(locale, 'delivery.queue.formLabel') })
      ).toHaveCount(0);
      return;
    }

    // All three codes are held, so the conjunction must pass. This fails if the page starts
    // demanding a fourth code it does not declare.
    await expect(
      denied,
      `${kind} holds all of ${READINESS_CODES.join(', ')}, so the queue must let it through`
    ).toHaveCount(0);

    const idling = page.getByText(say(locale, 'delivery.queue.idleTitle'));
    const noScopes = page.getByText(say(locale, 'delivery.queue.noScopesTitle'));
    if (mayReadDirectory) {
      await expect(
        page.getByRole('form', { name: say(locale, 'delivery.queue.formLabel') })
      ).toBeVisible();
      await expect(
        idling,
        'the queue reached its form and has been asked for nothing, so it must say so'
      ).toBeVisible();
      await expect(
        noScopes,
        `${kind} holds ${DIRECTORY_CODES.join(' and ')} in an organisation that has a branch, ` +
          'so "no branch is available to you" is the wrong answer'
      ).toHaveCount(0);
    } else {
      await expect(
        noScopes,
        `${kind} cannot read the company and branch directory, so the queue must say the ` +
          'selection cannot be made rather than showing an empty form'
      ).toBeVisible();
      await expect(idling).toHaveCount(0);
    }
  });

  test('the readiness queue answers for every row it shows', async ({ page }, testInfo) => {
    // test-honesty-allow: TH-002 -- no acceptance handoff on this checkout; see NO_HANDOFF_REASON
    test.skip(handoff === null, NO_HANDOFF_REASON);
    // test-honesty-allow: TH-002 -- signed in as somebody other than the journey's own administrator; see WRONG_ACCOUNT_REASON
    test.skip(!signedInAsJourneyAdministrator(), WRONG_ACCOUNT_REASON);
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
    // readiness column and kept its width would pass a count. The name is matched
    // WHOLE, because a header name is matched as a substring otherwise and this
    // table's names nest — the same ambiguity that made the audit log's "Action"
    // match "Row actions".
    for (const key of [
      'delivery.queue.column.workOrder',
      'delivery.queue.column.vehicle',
      'delivery.queue.column.customer',
      'delivery.queue.column.state',
      'delivery.queue.column.readiness',
      'delivery.queue.column.handover',
    ]) {
      await expect(
        table.getByRole('columnheader', { name: say(locale, key), exact: true })
      ).toBeVisible();
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
    /*
     * The same predicate, asserted with Playwright's own waiting rather than read once.
     *
     * `innerText()` takes ONE snapshot and never retries, and this table renders its rows
     * before the queue's answer has arrived — so the first read of row one was of a row that
     * existed and was still empty, and the case reported a blank verdict the screen goes on
     * to fill. `toContainText` polls until the timeout, which is the difference between
     * asserting what the screen shows and asserting what it happened to show first.
     */
    const verdict = new RegExp(`${escapeForRegExp(ready)}|${escapeForRegExp(notReady)}`);
    for (let index = 0; index < count; index += 1) {
      await expect(
        rows.nth(index),
        `row ${String(index + 1)} carries no readiness verdict`
      ).toContainText(verdict);
    }
  });

  test('the handover record shows its own facts', async ({ page }, testInfo) => {
    // test-honesty-allow: TH-002 -- no acceptance handoff on this checkout; see NO_HANDOFF_REASON
    test.skip(handoff === null, NO_HANDOFF_REASON);
    // test-honesty-allow: TH-002 -- signed in as somebody other than the journey's own administrator; see WRONG_ACCOUNT_REASON
    test.skip(!signedInAsJourneyAdministrator(), WRONG_ACCOUNT_REASON);
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
    // test-honesty-allow: TH-002 -- signed in as somebody other than the journey's own administrator; see WRONG_ACCOUNT_REASON
    test.skip(!signedInAsJourneyAdministrator(), WRONG_ACCOUNT_REASON);
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

    /*
     * The Print control, by its WHOLE name.
     *
     * An accessible name is matched as a substring unless the match is exact, and
     * the control that closes the sheet is named "Hide the printable document" —
     * which contains "Print". Two buttons matched, strict mode refused to guess,
     * and the print counter below was never reached. Neither node is a duplicate
     * of the other: they are two different controls, and the ambiguity was in the
     * query rather than on the screen.
     */
    const print = page.getByRole('button', {
      name: say(locale, 'delivery.document.print'),
      exact: true,
    });
    await expect(print).toBeVisible();
    expect(await printCalls(page), 'nothing may print before the control is used').toBe(0);
    await print.click();
    expect(await printCalls(page), 'the Print control must call window.print exactly once').toBe(1);
  });
});
