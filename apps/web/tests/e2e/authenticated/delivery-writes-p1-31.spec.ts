import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { holds, readAccountKind } from './account-manifest';
import {
  NO_HANDOFF_REASON,
  WRONG_ACCOUNT_REASON,
  browserFixtures,
  localeOf,
  missingReason,
  readHandoff,
  say,
  signedInAsJourneyAdministrator,
} from './p1-31-handoff';

/**
 * P1-31 acceptance, browser half: the three handover acts that WRITE.
 *
 * FE-004 records a checklist result, FE-005 enters the final odometer and FE-006
 * adds a signature. Until this file, no committed browser case performed any of
 * them in either locale: `delivery-p1-31.spec.ts` opens the handover the journey
 * already finished and READS it — the summary, the release checks and the
 * receiver. The closure re-measure lowered all three rows to `merged (write
 * path)` for exactly that reason and recorded the three owed cases as CC-52 (c);
 * this file is those cases.
 *
 * ## What only a browser can establish here
 *
 * The DOM suites for this screen mock every adapter, so they prove how the screen
 * behaves when an adapter reports a result. Three things they cannot reach:
 *
 *   1. the write really crosses the wire in the production bundle — a Server
 *      Action for the signature, an authenticated fetch for the other two — and
 *      the record afterwards holds what the operator entered;
 *   2. the refusal each case asserts is the SERVER's. The blocked release is
 *      `ERR-TRN-001` composed by `sal.complete_delivery` against the live record,
 *      not a state a test set;
 *   3. the persisted state, re-read. Every case reloads the page after its write
 *      and asserts the screen composed from a fresh server read — including the
 *      eligibility operation's own verdict, which is a different reader than the
 *      panel that performed the write.
 *
 * ## Each case owns its own handover
 *
 * `apps/web/playwright.config.ts` pins `workers: 1` and runs `authenticated-en`
 * before `authenticated-ar` against one database, and these cases CONSUME what
 * they act on — an answered checklist item cannot be answered again, a released
 * vehicle cannot be released again. So the harness leaves a pair of handovers per
 * locale (`browserFixtures`): a `prepare` one missing a signature and one
 * mandatory checklist result, which the checklist case and the signature case
 * take a different gap of each, and a `release` one whose only remaining reason
 * is the financial one. No case depends on another having run.
 *
 * ## What is NOT claimed
 *
 * Nothing here asserts that a signature image is any particular person's mark, or
 * that a released vehicle was paid for: the release case deliberately exercises
 * the documented financial override, which is the product's own path for a
 * handover that is not settled, and it asserts that the override was REQUIRED.
 */

const handoff = readHandoff();

/**
 * A delivery identifier that belongs to nobody, minted per run.
 *
 * The unconditional case below opens the handover screen in the governed job,
 * whose tenant has no handover at all. A random v4 is the honest way to ask for
 * one: it is absent for every account, so what the screen answers is decided by
 * the permission the caller holds and by nothing else.
 */
const ABSENT_DELIVERY_ID = randomUUID();

/** The code the record read is gated on, before the read is issued. */
const VIEW_CODE = 'sal.delivery.view';

/** The code every preparation act on this screen declares. */
const MANAGE_CODE = 'sal.delivery.manage';

/** Any identifier-shaped string. Used to prove one is NOT on the page. */
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** One of the delivery screen's panels, addressed by the id its heading carries. */
function panel(page: Page, headingId: string): Locator {
  return page.locator(`section[aria-labelledby="${headingId}"]`);
}

/**
 * The eligibility panel's row for one reason, addressed by that reason's label.
 *
 * The FACTS list is what these cases assert on rather than the blockers list, and
 * the difference matters: the blockers list holds only what is blocking, so an
 * assertion that a reason has gone could be satisfied by a panel that stopped
 * rendering the list at all. Every fact is drawn on every read, each saying
 * whether it is blocking, satisfied or unreadable — so the same locator carries a
 * before and an after, and a screen that lost the row fails both.
 */
function factRow(page: Page, blockerLabel: string): Locator {
  return panel(page, 'delivery-eligibility-heading')
    .locator('li[data-established]')
    .filter({ hasText: blockerLabel });
}

/** One checklist item's row, addressed by the item code the server published. */
function checklistRow(page: Page, itemCode: string): Locator {
  return panel(page, 'delivery-checklist-heading').locator(`li[data-item-code="${itemCode}"]`);
}

/** The signature ledger's rows — the ordered list, never the capture form above it. */
function signatureRows(page: Page): Locator {
  return panel(page, 'delivery-signatures-heading').locator('ol > li');
}

test.describe('P1-31 delivery writes, over handovers the acceptance journey left open', () => {
  /**
   * What runs WITHOUT a handoff, and why it is worth running.
   *
   * The governed job's tenant has no work order, so it has no handover, so the
   * three write cases below have nothing to open — and the surface they write on
   * is reached through ONE gate that this environment can answer for completely.
   * `apps/web/src/app/[locale]/(dashboard)/delivery/[deliveryId]/page.tsx` tests
   * `sal.delivery.view` and returns BEFORE it issues the record read; only then
   * does absence become the answer. Both credential kinds hold that code, so the
   * outcome pinned here is the not-found state and the ABSENCE of the refusal —
   * and for a kind that did not hold it, the refusal and the absence of the
   * not-found state. Which one is asserted is decided by the manifest, never by
   * what the page turns out to show.
   *
   * The second half is the one this file exists for: a record the screen could
   * not read must draw NO write surface. A screen that rendered its checklist,
   * signature or release panels over a record it does not have would be offering
   * three writes with nothing behind them, and `sal.delivery.manage` — which both
   * kinds also hold — must not be enough to put them there.
   */
  test('the handover screen answers for a record that does not exist, and offers no write', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo.project.name);
    const kind = readAccountKind();
    const mayView = holds(kind, VIEW_CODE);
    const mayManage = holds(kind, MANAGE_CODE);

    await page.goto(`/${locale}/delivery/${ABSENT_DELIVERY_ID}`);

    await expect(
      page.getByRole('heading', { name: say(locale, 'delivery.detail.title') })
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');

    const denied = page.getByText(say(locale, 'state.denied.title'));
    const absent = page.getByText(say(locale, 'state.notFound.title'));
    if (mayView) {
      await expect(
        absent,
        `${kind} holds ${VIEW_CODE}, so the gate must let it through and the record itself must ` +
          'be reported as absent'
      ).toBeVisible();
      await expect(
        denied,
        `${kind} holds ${VIEW_CODE}, so a refusal here would be the screen gating on a code it ` +
          'does not declare'
      ).toHaveCount(0);
    } else {
      await expect(
        denied,
        `${kind} does not hold ${VIEW_CODE}, so the screen must refuse before it reads`
      ).toBeVisible();
      await expect(
        absent,
        'a caller who may not see handovers must not be told whether this one exists'
      ).toHaveCount(0);
    }

    // No record, therefore no write surface — asserted for a caller who DOES hold
    // the write code, which is what makes it an assertion about the record rather
    // than about the permission.
    expect(mayManage, `${kind} is expected to hold ${MANAGE_CODE} in this environment`).toBe(true);
    for (const headingId of [
      'delivery-checklist-heading',
      'delivery-signatures-heading',
      'delivery-completion-heading',
      'delivery-summary-heading',
    ]) {
      await expect(
        panel(page, headingId),
        `${headingId} is drawn over a handover the screen could not read`
      ).toHaveCount(0);
    }
  });

  /**
   * FE-004 — a mandatory checklist item, answered through the interface.
   *
   * The fixture leaves exactly one mandatory item unanswered and every other one
   * recorded, so `checklist_incomplete` names this item and no other. Three
   * things are asserted in order: the reason is stated before the act, a waiver
   * with no reason is refused where the operator can correct it, and the recorded
   * outcome survives a reload — with the SERVER's own eligibility verdict, not
   * the panel that wrote it, agreeing that the reason has gone.
   *
   * The negative is the waiver rule rather than a refused completion, and that is
   * a property of the screen rather than a choice: `CompletionPanel` disables the
   * release control while a reason that cannot be overridden is standing, so
   * there is no way to send a blocked completion from here. The release case
   * below asserts the server's refusal on the one path that CAN reach it.
   */
  test('a mandatory checklist item is recorded, and the reason it held clears', async ({
    page,
  }, testInfo) => {
    // test-honesty-allow: TH-002 -- no acceptance handoff on this checkout; see NO_HANDOFF_REASON
    test.skip(handoff === null, NO_HANDOFF_REASON);
    // test-honesty-allow: TH-002 -- signed in as somebody other than the journey's own administrator; see WRONG_ACCOUNT_REASON
    test.skip(!signedInAsJourneyAdministrator(), WRONG_ACCOUNT_REASON);
    const locale = localeOf(testInfo.project.name);
    const fixtures = browserFixtures(handoff, locale);
    // test-honesty-allow: TH-002 -- the harness that wrote this handoff left no browser fixtures
    test.skip(fixtures === null, missingReason('browser fixture handover'));
    const prepare = (fixtures as NonNullable<typeof fixtures>).prepare;
    // test-honesty-allow: TH-002 -- the fixture names no unanswered item, so there is nothing to answer
    test.skip(prepare.unansweredItem === null, missingReason('unanswered checklist item'));
    const item = prepare.unansweredItem as NonNullable<typeof prepare.unansweredItem>;

    await page.goto(`/${locale}/delivery/${prepare.deliveryId}`);
    await expect(
      page.getByRole('heading', { name: say(locale, 'delivery.summary.heading') })
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');

    // The reason, as the server composed it, before anything is done about it.
    const checklistFact = factRow(page, say(locale, 'delivery.blocker.checklistIncomplete'));
    await expect(checklistFact).toContainText(say(locale, 'delivery.eligibility.factBlocking'));
    // Named, not merely counted: the panel publishes the unsatisfied item so an
    // operator is not sent hunting through a company's templates for it.
    await expect(panel(page, 'delivery-eligibility-heading')).toContainText(item.itemCode);
    // The release control says the vehicle is held, and is not offering to release.
    await expect(panel(page, 'delivery-completion-heading')).toContainText(
      say(locale, 'delivery.completion.heldBack')
    );

    const row = checklistRow(page, item.itemCode);
    await expect(row).toBeVisible();
    await expect(row).toContainText(say(locale, 'delivery.checklist.mandatory'));

    const outcome = row.getByRole('combobox', {
      name: say(locale, 'delivery.checklist.outcome'),
      exact: true,
    });
    const record = row.getByRole('button', {
      name: say(locale, 'delivery.checklist.record'),
      exact: true,
    });

    // NEGATIVE. `ck_delivery_checklist_results_waiver` refuses a waiver with no
    // reason; the form refuses it first, beside the field, and spends no request.
    await outcome.selectOption('waived');
    await expect(
      row.getByRole('textbox', {
        name: say(locale, 'delivery.checklist.waiverReasonLabel'),
        exact: true,
      })
    ).toBeVisible();
    await record.click();
    await expect(
      row.getByRole('alert'),
      'a waiver with no reason must be refused where the operator can correct it'
    ).toHaveText(say(locale, 'form.required'));

    // And nothing was written: a reload asks the server, and the item still has no
    // result. Without this the case would only prove that a message appeared.
    await page.reload();
    const afterRefusal = checklistRow(page, item.itemCode);
    /*
     * The control's PRESENCE is the assertion, and it is exact rather than
     * approximate: `ItemRow` draws the outcome control only while the item has no
     * result and renders the result instead the moment it has one, so a control
     * still on the page after a reload is the server saying nothing was recorded.
     *
     * Asserted this way rather than as "the row does not say Waived", because the
     * outcome control is a `<select>` whose OPTIONS carry all three outcome labels
     * in the row's own text — an absence assertion over that text would have been
     * false while the control was there and true only once it had gone.
     */
    await expect(
      afterRefusal.getByRole('button', {
        name: say(locale, 'delivery.checklist.record'),
        exact: true,
      })
    ).toBeVisible();
    await expect(
      afterRefusal.getByRole('combobox', {
        name: say(locale, 'delivery.checklist.outcome'),
        exact: true,
      })
    ).toBeVisible();
    await expect(factRow(page, say(locale, 'delivery.blocker.checklistIncomplete'))).toContainText(
      say(locale, 'delivery.eligibility.factBlocking')
    );

    // SUCCESS.
    await afterRefusal
      .getByRole('combobox', { name: say(locale, 'delivery.checklist.outcome'), exact: true })
      .selectOption('passed');
    await afterRefusal
      .getByRole('button', { name: say(locale, 'delivery.checklist.record'), exact: true })
      .click();
    /*
     * The control goes FIRST, and the order is what makes the second assertion
     * mean anything: a recorded outcome is final, so `ItemRow` removes the control
     * rather than disabling it — and while the control is there its `<select>`
     * options put every outcome label in the row's text. Once it has gone, the
     * only outcome word left in the row is the one that was recorded.
     */
    await expect(
      checklistRow(page, item.itemCode).getByRole('combobox', {
        name: say(locale, 'delivery.checklist.outcome'),
        exact: true,
      })
    ).toHaveCount(0);
    await expect(
      checklistRow(page, item.itemCode).getByRole('button', {
        name: say(locale, 'delivery.checklist.record'),
        exact: true,
      })
    ).toHaveCount(0);
    await expect(checklistRow(page, item.itemCode)).toContainText(
      say(locale, 'delivery.outcome.passed')
    );
    await expect(factRow(page, say(locale, 'delivery.blocker.checklistIncomplete'))).toContainText(
      say(locale, 'delivery.eligibility.factSatisfied')
    );

    // RE-READ. Everything above was rendered by panels that had just written; this
    // is the same screen composed from a fresh read of the server.
    await page.reload();
    await expect(
      checklistRow(page, item.itemCode).getByRole('combobox', {
        name: say(locale, 'delivery.checklist.outcome'),
        exact: true,
      })
    ).toHaveCount(0);
    await expect(checklistRow(page, item.itemCode)).toContainText(
      say(locale, 'delivery.outcome.passed')
    );
    await expect(factRow(page, say(locale, 'delivery.blocker.checklistIncomplete'))).toContainText(
      say(locale, 'delivery.eligibility.factSatisfied')
    );
    await expect(
      panel(page, 'delivery-eligibility-heading'),
      'the unsatisfied-item list must not still name an item that now has a result'
    ).not.toContainText(item.itemCode);
  });

  /**
   * FE-006 — a signature image, captured and bound.
   *
   * The fixture has a verified receiver and no signature, so `signature_missing`
   * is standing when the case arrives. The image is the sixty-seven-byte PNG the
   * harness publishes: it has to be a decodable image because the platform scans
   * the stored object and refuses a version it cannot decode, so a placeholder
   * would have tested the scanner instead of the binding.
   *
   * ## The negative, and a product finding it rests on
   *
   * A file the category does not accept is refused by the API with `ERR-VAL-001`
   * (`attachment-service.ts:311-316`), which `fromFailure` maps to the `invalid`
   * state — and `notifyActionResult` raises nothing for `invalid`, while
   * `SignaturesPanel`'s capture form does not render `fieldErrors`. So the refusal
   * is real and SILENT: no message appears anywhere on the screen. This case
   * therefore asserts what is true — the file is refused, nothing is bound, and a
   * reload confirms it against the server — and the missing feedback is reported
   * as a product finding rather than papered over with a weaker assertion.
   *
   * ## The reference is never published
   *
   * The panel says a signature is on file and offers no way to fetch it; the
   * stored document version identifier must not appear in the document at all.
   * Asserted as the absence of ANY identifier-shaped string in the panel, because
   * this side never learns the version id — the same property
   * `delivery-document.dom.test.tsx` pins against a known id.
   */
  test('a signature is refused, then captured, and the reference stays off the page', async ({
    page,
  }, testInfo) => {
    // test-honesty-allow: TH-002 -- no acceptance handoff on this checkout; see NO_HANDOFF_REASON
    test.skip(handoff === null, NO_HANDOFF_REASON);
    // test-honesty-allow: TH-002 -- signed in as somebody other than the journey's own administrator; see WRONG_ACCOUNT_REASON
    test.skip(!signedInAsJourneyAdministrator(), WRONG_ACCOUNT_REASON);
    const locale = localeOf(testInfo.project.name);
    const fixtures = browserFixtures(handoff, locale);
    // test-honesty-allow: TH-002 -- the harness that wrote this handoff left no browser fixtures
    test.skip(fixtures === null, missingReason('browser fixture handover'));
    const { prepare, signaturePngBase64 } = fixtures as NonNullable<typeof fixtures>;

    await page.goto(`/${locale}/delivery/${prepare.deliveryId}`);
    const signatures = panel(page, 'delivery-signatures-heading');
    await expect(signatures).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');

    const missing = say(locale, 'delivery.blocker.signatureMissing');
    await expect(factRow(page, missing)).toContainText(
      say(locale, 'delivery.eligibility.factBlocking')
    );
    await expect(signatures).toContainText(say(locale, 'delivery.signatures.noneTitle'));
    /*
     * The ledger is the ordered list, and the rows are addressed as rows rather
     * than as text on the panel. The capture form above them carries a `<select>`
     * of signer roles, so every role label is already in the panel's text: an
     * assertion that the panel "contains the receiver role" would have been true
     * before anything was signed.
     */
    await expect(signatureRows(page), 'the fixture handover has no signature yet').toHaveCount(0);

    const file = signatures.getByLabel(say(locale, 'delivery.signatures.signatureFile'));
    const submit = signatures.getByRole('button', {
      name: say(locale, 'delivery.signatures.captureSubmit'),
      exact: true,
    });

    // NEGATIVE: a file of a type the signature category does not accept.
    await file.setInputFiles({
      name: 'not-a-signature.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('this is not an image', 'utf8'),
    });
    await submit.click();
    // React resets the form once the Server Action settles, which is how this side
    // knows the attempt is over rather than merely dispatched.
    await expect(file).toHaveValue('');
    await page.reload();
    await expect(
      panel(page, 'delivery-signatures-heading'),
      'a file the category refuses must leave the ledger empty'
    ).toContainText(say(locale, 'delivery.signatures.noneTitle'));
    await expect(
      signatureRows(page),
      'a file the category refuses must bind no signature to the handover'
    ).toHaveCount(0);
    await expect(
      factRow(page, missing),
      'nothing was bound, so the server must still report the signature as missing'
    ).toContainText(say(locale, 'delivery.eligibility.factBlocking'));

    // SUCCESS: the image the platform's own scanner accepts.
    await page.getByLabel(say(locale, 'delivery.signatures.signatureFile')).setInputFiles({
      name: 'handover-signature.png',
      mimeType: 'image/png',
      buffer: Buffer.from(signaturePngBase64, 'base64'),
    });
    await panel(page, 'delivery-signatures-heading')
      .getByRole('button', { name: say(locale, 'delivery.signatures.captureSubmit'), exact: true })
      .click();

    await expect(signatureRows(page)).toHaveCount(1);
    await expect(signatureRows(page).first()).toContainText(
      say(locale, 'delivery.signatures.onFile')
    );
    await expect(
      signatureRows(page).first(),
      'the role the signature was given is what the ledger is for'
    ).toContainText(say(locale, 'delivery.signerRole.receiver'));
    await expect(panel(page, 'delivery-signatures-heading')).not.toContainText(
      say(locale, 'delivery.signatures.noneTitle')
    );

    // RE-READ.
    await page.reload();
    const reread = panel(page, 'delivery-signatures-heading');
    await expect(signatureRows(page)).toHaveCount(1);
    await expect(signatureRows(page).first()).toContainText(
      say(locale, 'delivery.signatures.onFile')
    );
    await expect(signatureRows(page).first()).toContainText(
      say(locale, 'delivery.signerRole.receiver')
    );
    await expect(factRow(page, missing)).toContainText(
      say(locale, 'delivery.eligibility.factSatisfied')
    );
    expect(
      UUID_ANYWHERE.test((await reread.innerText()) ?? ''),
      'the stored signature document reference must never reach the page'
    ).toBe(false);
    await expect(reread.locator('a')).toHaveCount(0);
  });

  /**
   * FE-005 — the final odometer, and the release it is part of.
   *
   * The fixture is answered and signed, so the only reason left is the financial
   * one — the single blocker the delivery domain declares overridable, which is
   * what puts the release control within reach at all. That makes both halves of
   * the negative reachable from one screen: the form's own refusal of a reading
   * the column cannot hold, and the SERVER's refusal of a release taken without
   * the override.
   *
   * ## Two decimals, and why the form refuses them
   *
   * `veh.odometer_readings.value` is `numeric(12,1)` while the completion route's
   * schema admits two decimals, so a two-decimal reading passes the route and is
   * refused by the domain naming a field the operator has already left. The form
   * holds the narrower rule, which is what this asserts.
   *
   * ## What the re-read can and cannot show
   *
   * No delivery screen renders the READING. The record and the printable sheet
   * both carry the final odometer as a REFERENCE — `DeliveryDocument.tsx:180-181`
   * and the summary panel — because no delivery read resolves it, which is the
   * same shape the HTTP journey recorded (`sal.delivery-read` answers
   * `finalOdometerReadingId`). So the reload asserts what the product publishes: a
   * handed-over record, and a stored reading it now points at where it pointed at
   * nothing before. The SHAPE is asserted by the refusal above it.
   */
  test('the final odometer is refused, then accepted, and the vehicle is released', async ({
    page,
  }, testInfo) => {
    // test-honesty-allow: TH-002 -- no acceptance handoff on this checkout; see NO_HANDOFF_REASON
    test.skip(handoff === null, NO_HANDOFF_REASON);
    // test-honesty-allow: TH-002 -- signed in as somebody other than the journey's own administrator; see WRONG_ACCOUNT_REASON
    test.skip(!signedInAsJourneyAdministrator(), WRONG_ACCOUNT_REASON);
    const locale = localeOf(testInfo.project.name);
    const fixtures = browserFixtures(handoff, locale);
    // test-honesty-allow: TH-002 -- the harness that wrote this handoff left no browser fixtures
    test.skip(fixtures === null, missingReason('browser fixture handover'));
    const release = (fixtures as NonNullable<typeof fixtures>).release;
    /*
     * The harness composes a reading only when the vehicle has none on file:
     * `guard_odometer_reading` refuses a normal reading below the current one, so a
     * value chosen here over an unknown one would fail this case for a reason that
     * is not about the product.
     */
    // test-honesty-allow: TH-002 -- the fixture names no odometer reading this case may send
    test.skip(release.finalOdometerValue === null, missingReason('final odometer value'));
    const reading = release.finalOdometerValue as string;
    // The same reading with one digit too many: the shape the column cannot hold.
    const refusedReading = `${reading}5`;

    await page.goto(`/${locale}/delivery/${release.deliveryId}`);
    const summary = panel(page, 'delivery-summary-heading');
    await expect(summary).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(summary).toContainText(say(locale, 'delivery.summary.notDeliveredYet'));

    const readingBlock = summary
      .getByText(say(locale, 'delivery.summary.finalOdometerReading'), { exact: true })
      .locator('xpath=..');
    await expect(
      readingBlock.locator('code'),
      'nothing has been released, so no reading is referenced yet'
    ).toHaveCount(0);

    // The state the release control is drawn in: one reason, and the server says
    // this caller is the one who may set it aside.
    await expect(panel(page, 'delivery-eligibility-heading')).toContainText(
      say(locale, 'delivery.eligibility.overridableByYou')
    );
    const completion = panel(page, 'delivery-completion-heading');
    const submit = completion.getByRole('button', {
      name: say(locale, 'delivery.completion.submit'),
      exact: true,
    });
    await expect(submit).toBeEnabled();

    const odometer = completion.getByRole('textbox', {
      name: say(locale, 'delivery.completion.odometer'),
      exact: true,
    });

    // NEGATIVE, the form's rule: two digits after the point.
    await odometer.fill(refusedReading);
    await submit.click();
    await expect(
      completion.getByText(say(locale, 'delivery.completion.odometerInvalid')),
      'a reading the odometer column cannot hold must be refused in the form'
    ).toBeVisible();

    // NEGATIVE, the server's rule: a release taken while money is owed, without
    // the override. `sal.complete_delivery` recomposes the reasons inside its own
    // transaction and answers ERR-TRN-001; the panel renders that as the refusal
    // below, with the reasons read back from the eligibility operation.
    await odometer.fill(reading);
    await submit.click();
    const refusal = completion.getByRole('alert').filter({
      hasText: say(locale, 'delivery.completion.refusedBlocked'),
    });
    await expect(refusal).toBeVisible();
    await expect(refusal, 'the refusal must name the reason the server refused on').toContainText(
      say(locale, 'delivery.blocker.financialBalanceOutstanding')
    );
    await expect(summary).toContainText(say(locale, 'delivery.summary.notDeliveredYet'));

    // SUCCESS: the documented override, with the reason it requires in writing.
    await completion.getByRole('checkbox').check();
    await completion
      .getByRole('textbox', {
        name: say(locale, 'delivery.completion.overrideReason'),
        exact: true,
      })
      .fill('Released for the acceptance browser case; the balance is recorded as outstanding.');
    await odometer.fill(reading);
    await submit.click();
    // The panel clears the reading it sent once the release is accepted, which is
    // how this side knows the request settled rather than merely left.
    await expect(odometer).toHaveValue('');
    await expect(
      completion.getByText(say(locale, 'delivery.completion.refusedBlocked'))
    ).toHaveCount(0);

    // RE-READ.
    await page.reload();
    const reread = panel(page, 'delivery-summary-heading');
    await expect(reread.locator('[data-status]')).toHaveAttribute('data-status', 'delivered');
    await expect(reread).not.toContainText(say(locale, 'delivery.summary.notDeliveredYet'));
    await expect(
      reread
        .getByText(say(locale, 'delivery.summary.finalOdometerReading'), { exact: true })
        .locator('xpath=..')
        .locator('code'),
      'the released handover must point at the reading the completion stored'
    ).toHaveCount(1);
  });
});
