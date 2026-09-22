import { expect, test, type Page } from '@playwright/test';
import { holds, readAccountKind } from './account-manifest';
import {
  NO_HANDOFF_REASON,
  WRONG_ACCOUNT_REASON,
  fixtureKeyOf,
  localeOf,
  missingReason,
  readHandoff,
  receiverFixture,
  say,
  signedInAsJourneyAdministrator,
  type P131Handoff,
  type P131ReceiverCase,
  type P131ReceiverFixture,
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
 * The branch is chosen ONCE, in the header, and every screen reads that choice.
 *
 * It used to be chosen on the queue itself, from two selects over a directory
 * the screen read for itself, behind a Show button. All three are gone: the
 * working context publishes the named branches this caller is authorized for,
 * and the queue reads its branch on arrival. An operator with exactly one
 * authorized branch has it selected for them and meets no control at all, so
 * the chooser is set only when it exists.
 */
async function chooseBranch(page: Page, locale: 'en' | 'ar', h: P131Handoff): Promise<void> {
  void locale;
  const chooser = page.getByTestId('working-context-select');
  if ((await chooser.count()) > 0) {
    await chooser.selectOption(h.branchId);
  }
}

/* ------------------------------------------------------------------ *
 * FE-003 — a receiver verified through the screen, with identity evidence
 * ------------------------------------------------------------------ */

/**
 * The codes the receiver cases need the signed-in account to hold.
 *
 * `sal.delivery.manage` draws the verification form; the two document codes draw
 * the optional file control and authorize the capture. The journey's
 * administrator holds all three (`account-manifest.json`), so an account that
 * does not is a fixture defect and is failed as one rather than skipped.
 */
const RECEIVER_CASE_CODES = [
  'sal.delivery.manage',
  'shared.document.read',
  'shared.document.manage',
] as const;

/**
 * The unverified-receiver handover this project consumes, or a hard failure.
 *
 * ## Where the handover comes from
 *
 * The harness publishes TWO per fixture key in `browserFixtures.receiver` — `refusal`
 * and `success`, one per case, so neither case depends on declaration order or on the
 * other having run — made before its final observation point (`P131ReceiverFixture`).
 * The spec writes
 * nothing: a handover opened here would land in the journey branch after the
 * report and overview figures were read, and the cases pinned to those figures
 * would fail beside these.
 *
 * ## Why absence fails rather than skips
 *
 * The same rule the write cases in `delivery-writes-p1-31.spec.ts` follow: once a
 * handoff exists and the journey's administrator is signed in, a handoff with no
 * receiver fixture is a harness that did not publish one, and a skip would report
 * that as a run that proved something.
 *
 * ## Where these cases execute, stated so nobody reads them as covered
 *
 * Only in a run that sets `ROOTLCO_P131_HANDOFF`. The hosted authenticated-browser
 * job sets no handoff, so on every hosted run both cases take the absent-handoff
 * skip; the FE-003 browser proof exists only as an executed local run against a
 * handoff whose harness publishes this fixture.
 */
function unverifiedHandover(
  projectName: string,
  which: P131ReceiverCase
): {
  readonly handover: P131ReceiverFixture;
  readonly pngBase64: string;
} {
  const key = fixtureKeyOf(projectName);
  const fixture = receiverFixture(handoff, key, which);
  expect(
    fixture,
    `the handoff names no unverified-receiver ${which} handover for ${key}; the harness ` +
      'section that publishes browserFixtures.receiver did not run, or did not finish'
  ).not.toBeNull();
  return fixture as NonNullable<typeof fixture>;
}

/** The receiver panel, addressed by the id its own heading carries. */
function receiverPanel(page: Page) {
  return page.locator('section[aria-labelledby="delivery-receiver-heading"]');
}

/**
 * Chooses the receiver on the screen's own selector, by the name the server's customer
 * search answers for them.
 *
 * The selector matches the START of a customer's name, the way an operator types it, so
 * the case types the whole name and not a family name. The harness searched with this
 * same name and published the handover only when exactly this customer came back.
 */
async function chooseReceiver(page: Page, locale: 'en' | 'ar', displayName: string): Promise<void> {
  const panel = receiverPanel(page);
  await panel
    .getByRole('textbox', { name: say(locale, 'crm.customers.column.name'), exact: true })
    .fill(displayName);
  await panel
    .getByRole('button', { name: say(locale, 'customerSelector.search'), exact: true })
    .click();
  await panel.getByRole('button', { name: new RegExp(escapeForRegExp(displayName)) }).click();
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
   * screen then answered about a branch rather than with a blank region.
   *
   * ## The branch is no longer a question this screen asks
   *
   * It used to carry two selects over a directory it read for itself, behind a Show button,
   * with two honest idle states depending on whether that directory could be read at all.
   * The branch is the working context's own named selection now, so what is pinned is that
   * the queue either NAMES its branch or says why it cannot — and that it offers no control
   * of its own that would set one, which is the defect the change was for.
   */
  test('the readiness queue answers exactly what the signed-in account is entitled to', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo.project.name);
    const kind = readAccountKind();
    const mayView = READINESS_CODES.every((code) => holds(kind, code));

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
      await expect(page.getByTestId('delivery-queue-branch')).toHaveCount(0);
      return;
    }

    // All three codes are held, so the conjunction must pass. This fails if the page starts
    // demanding a fourth code it does not declare.
    await expect(
      denied,
      `${kind} holds all of ${READINESS_CODES.join(', ')}, so the queue must let it through`
    ).toHaveCount(0);

    /*
     * The queue reads on arrival now, so what proves it was reached is the
     * branch it states rather than an idle sentence it no longer has. The branch
     * is STATED: there is no control on this page that could set it, which is
     * the property the two directory codes used to decide between.
     */
    const named = page.getByTestId('delivery-queue-branch');
    const blocked = page.getByTestId('delivery-queue-blocked');
    await expect(
      named.or(blocked).first(),
      'the queue neither named a branch nor said why it could not'
    ).toBeVisible();
    await expect(
      named.getByRole('combobox'),
      'the queue offered a second place to choose a branch'
    ).toHaveCount(0);
    await expect(
      named.getByRole('textbox'),
      'the queue asked the operator to type a branch'
    ).toHaveCount(0);
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

  /**
   * FE-003 REFUSAL — an identity document the server refuses, leaving nothing behind.
   *
   * It acts on its OWN handover (`browserFixtures.receiver.<key>.refusal`), so it
   * depends neither on declaration order nor on the success case; the "nobody is
   * confirmed" assertion below fails loudly if that handover was already spent.
   *
   * The attached file is plain text, which the identity category's own row does
   * not admit. The file control's `accept` list comes from that row, but it is a
   * hint to the browser's picker that `setInputFiles` does not consult, and neither
   * the panel nor the adapter filters by type — so the request reaches the server,
   * whose upload authorization refuses the content type with a violation on the
   * content type. The panel must state that refusal: the upload sentence AND the
   * field reason, which only a validation refusal carries — a store outage, a
   * permission refusal or an expired session reach the same upload sentence with no
   * field reason. The chosen document must still be chosen afterwards, and a reload
   * must still show nobody confirmed and no evidence.
   */
  test('an identity document the server refuses leaves the receiver unverified', async ({
    page,
  }, testInfo) => {
    // test-honesty-allow: TH-002 -- no acceptance handoff on this checkout; see NO_HANDOFF_REASON
    test.skip(handoff === null, NO_HANDOFF_REASON);
    // test-honesty-allow: TH-002 -- signed in as somebody other than the journey's own administrator; see WRONG_ACCOUNT_REASON
    test.skip(!signedInAsJourneyAdministrator(), WRONG_ACCOUNT_REASON);
    const locale = localeOf(testInfo.project.name);
    const kind = readAccountKind();
    for (const code of RECEIVER_CASE_CODES) {
      expect(holds(kind, code), `${kind} must hold ${code} for this case`).toBe(true);
    }
    const { handover } = unverifiedHandover(testInfo.project.name, 'refusal');

    await page.goto(`/${locale}/delivery/${handover.deliveryId}`);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    const panel = receiverPanel(page);
    await expect(panel.getByText(say(locale, 'delivery.receiver.noneTitle'))).toBeVisible();

    await chooseReceiver(page, locale, handover.receiverDisplayName);
    const file = panel.getByLabel(say(locale, 'delivery.receiver.evidenceLabel'), { exact: true });
    await file.setInputFiles({
      name: 'not-an-identity-image.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('this is not an identity document', 'utf8'),
    });
    await panel
      .getByRole('button', { name: say(locale, 'delivery.receiver.verifySubmit'), exact: true })
      .click();

    const refusal = panel
      .getByRole('alert')
      .filter({ hasText: say(locale, 'delivery.receiver.refused') });
    await expect(refusal, 'the refusal must be stated on the panel it came from').toBeVisible();
    await expect(refusal).toContainText(say(locale, 'delivery.receiver.evidenceUploadFailed'));
    // The field reason: present only when the server answered with a violation.
    await expect(
      panel.getByRole('alert').filter({ hasText: say(locale, 'form.violation.invalid') }),
      'the server refused the content type, so the reason it gave must be stated'
    ).toBeVisible();
    await expect(panel.getByText(say(locale, 'delivery.receiver.noneTitle'))).toBeVisible();
    // The document the operator chose is still chosen: a further Confirm would send it
    // again, and verifying without it would take the explicit Remove.
    await expect(file).not.toHaveValue('');
    await expect(panel.getByText(say(locale, 'delivery.receiver.evidenceChosen'))).toBeVisible();
    await expect(refusal).toContainText(say(locale, 'delivery.receiver.evidenceStillChosen'));
    // The control declares what the identity category's row admits, and that did not
    // stop the request: the refusal above is the server's.
    await expect(file).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');

    await page.reload();
    const reread = receiverPanel(page);
    await expect(
      reread.getByText(say(locale, 'delivery.receiver.noneTitle')),
      'a refused document must leave nobody confirmed'
    ).toBeVisible();
    await expect(reread.getByText(say(locale, 'delivery.receiver.evidenceOnFile'))).toHaveCount(0);
    await expect(
      reread.getByRole('heading', {
        name: say(locale, 'delivery.receiver.verifyHeading'),
        exact: true,
      })
    ).toBeVisible();
  });

  /**
   * FE-003 SUCCESS — an unverified receiver, verified through the screen with an
   * identity document attached.
   *
   * Asserted in order: the screen first says nobody is confirmed; the receiver is
   * chosen by name on the selector and a real image is attached; the panel then
   * states the receiver and that proof of identity is on file; and a reload still
   * says so, which is the server's fact rather than the panel's.
   */
  test('an unverified receiver is verified through the screen with an identity document attached', async ({
    page,
  }, testInfo) => {
    // test-honesty-allow: TH-002 -- no acceptance handoff on this checkout; see NO_HANDOFF_REASON
    test.skip(handoff === null, NO_HANDOFF_REASON);
    // test-honesty-allow: TH-002 -- signed in as somebody other than the journey's own administrator; see WRONG_ACCOUNT_REASON
    test.skip(!signedInAsJourneyAdministrator(), WRONG_ACCOUNT_REASON);
    const locale = localeOf(testInfo.project.name);
    const kind = readAccountKind();
    for (const code of RECEIVER_CASE_CODES) {
      expect(holds(kind, code), `${kind} must hold ${code} for this case`).toBe(true);
    }
    const { handover, pngBase64 } = unverifiedHandover(testInfo.project.name, 'success');

    await page.goto(`/${locale}/delivery/${handover.deliveryId}`);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    const panel = receiverPanel(page);
    // BEFORE: nobody is confirmed, and the form to confirm somebody is offered.
    await expect(panel.getByText(say(locale, 'delivery.receiver.noneTitle'))).toBeVisible();
    await expect(panel.getByText(say(locale, 'delivery.receiver.evidenceOnFile'))).toHaveCount(0);

    await chooseReceiver(page, locale, handover.receiverDisplayName);
    await panel
      .getByLabel(say(locale, 'delivery.receiver.evidenceLabel'), { exact: true })
      .setInputFiles({
        name: 'receiver-identity.png',
        mimeType: 'image/png',
        // The decodable image the harness itself puts on file.
        buffer: Buffer.from(pngBase64, 'base64'),
      });
    await expect(panel.getByText(say(locale, 'delivery.receiver.evidenceChosen'))).toBeVisible();
    await panel
      .getByRole('button', { name: say(locale, 'delivery.receiver.verifySubmit'), exact: true })
      .click();

    // AFTER: the panel re-reads and states the confirmed receiver and the evidence.
    await expect(
      panel.getByText(say(locale, 'delivery.receiver.evidenceOnFile')),
      'the receiver was verified with a document, so proof of identity must be on file'
    ).toBeVisible();
    await expect(panel.getByText(say(locale, 'delivery.receiver.noneTitle'))).toHaveCount(0);
    await expect(panel).toContainText(handover.customerId);
    await expect(panel.getByText(say(locale, 'delivery.receiver.refused'))).toHaveCount(0);

    // RE-READ: a fresh page composed from the server.
    await page.reload();
    const reread = receiverPanel(page);
    await expect(reread.getByText(say(locale, 'delivery.receiver.evidenceOnFile'))).toBeVisible();
    await expect(reread.getByText(say(locale, 'delivery.receiver.noneTitle'))).toHaveCount(0);
    await expect(reread).toContainText(handover.customerId);
  });
});
