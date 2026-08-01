/**
 * P1-22 endpoint inventory and catalog reconciliation (P1-22-QA-004, P1-22-DO-001,
 * P1-22-DOC-001).
 *
 * Derives this phase's public surface from the operation registry rather than from a
 * hand-kept list, and reconciles every declared permission, audit action and event
 * against the committed catalogs. A hand-written inventory documents what its author
 * remembered; this one cannot disagree with the code, because the code is its only
 * input.
 *
 * Run with `--check` in CI. It exits non-zero when:
 *
 *   1. a declared permission code is not in the IAM permission seed;
 *   2. a declared audit action is not in the controlled audit-action catalog, or is
 *      filed under a different class there;
 *   3. an operation declares `scope: 'branch'` but its handler enforces no scope;
 *   4. a `sal.`/`wty.` operation is served by a module this phase does not own;
 *   5. a published event type is not in `EVENT_CATALOG`, is published by a module that
 *      does not own it, or is published while the catalog still says
 *      `implementedIn: null`;
 *   6. `EVENT_CATALOG` attributes an event to P1-22 but nothing in this phase's modules
 *      publishes it;
 *   7. a route cites a quotation revision without installing the reader port;
 *   8. a P1-22 task names an ARTIFACT — operation, permission, audit action, event,
 *      symbol, test, or document identifier — that does not exist, or names none at all;
 *   9. the generated documents are stale.
 *
 * The reconciliation direction is code → catalog, deliberately, with ONE documented
 * exception (check 6, see below). Catalog → code would be wrong in general: the seeds
 * carry codes for phases not yet implemented, and a phase is not obliged to consume all
 * of them. "Every code this phase DECLARES must exist" is the honest direction.
 *
 * ### Why the scope guard strips comments first
 *
 * P1-19 learned this the hard way: the first version of the equivalent guard was
 * satisfied by the COMMENT explaining the fix rather than by the fix. Comments are
 * removed before the handler is searched, so a claim in prose cannot satisfy a
 * structural check.
 *
 * ### What P1-22 changed from the P1-21 original, and why
 *
 * P1-21 delivered ONE id prefix (`inv.`) served by ONE module (`inventory`). P1-22
 * delivers TWO prefixes (`sal.`, `wty.`) across FOUR modules (`billing`, `payments`,
 * `delivery`, `warranty`). A check written against a set of one cannot be assumed to
 * still discriminate when the set grows, so every place that reads those constants was
 * re-derived rather than copied on faith:
 *
 *   - Prefix matching stays `PHASE_PREFIXES.some((p) => op.id.startsWith(p))`. P1-21
 *     already used the plural array form (it inherited it from P1-20, which had two
 *     prefixes), so nothing here regressed to a single `startsWith` — but with two live
 *     prefixes the `some` is now load-bearing rather than decorative: a single-prefix
 *     match would have silently dropped every `wty.` operation from the inventory, from
 *     the permission reconciliation, and from the scope guard, while still reporting
 *     success.
 *   - A `PHASE_MODULES` entry naming a directory that does not exist now FAILS instead
 *     of being skipped (see the loop that builds `moduleSources`). With one module a
 *     typo was self-announcing; with four it hides.
 *   - Check 4 is new: an operation's declared `module` must be one this phase owns.
 *     With one module that field could only hold one value; with four it carries
 *     information and a wrong value routes an endpoint out of every scan below.
 *   - Check 6 is new, and is the one catalog → code check. P1-21's `implementedIn`
 *     assertion is structurally unable to fire for P1-22 — see its commentary.
 *   - The inventory table prints a Module column. With four modules the table is not
 *     readable without it, and it makes the parsed `module` field observable instead of
 *     dead.
 *   - A `doc` proof is now `['doc', path, identifier]` rather than P1-21's
 *     `['doc', path]`. P1-21 checked that the named document mentions the TASK ID; none
 *     of this phase's three documents names a task id, because all three were written
 *     during contract archaeology before the task register existed. Naming a
 *     subject identifier instead is also strictly more informative: a task label in
 *     prose measures typing, while `next_display_number` or `sal.invoice-issue` at least
 *     pins what the document is about.
 *   - A task that declares NO proof is refused in its own words (see the end of check
 *     8). It already failed under P1-21's zero-resolved rule; the distinction is worth
 *     reading in the failure list, because ten P1-22 tasks are in exactly that state
 *     today.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { escapeRegExp } from './ci/check-workflow-security.mjs';
import { API_SRC_ROOT, API_SRC_PATH } from './lib/repository-paths.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_ROOT = join(API_SRC_ROOT, 'app', 'api', 'v1');
const EVIDENCE = join(ROOT, 'docs', 'phase-1', 'phase-1-22', 'evidence');
const OUTPUT = join(EVIDENCE, 'endpoint-inventory.md');
const TRACEABILITY = join(EVIDENCE, 'task-traceability.md');

/** The TWO id namespaces this phase delivers. */
const PHASE_PREFIXES = ['sal.', 'wty.'];

/** Modules this phase owns, for the producer/owner reconciliation. */
const PHASE_MODULES = ['billing', 'payments', 'delivery', 'warranty'];

/**
 * The phase label as `EVENT_CATALOG` spells it, for check 6 only.
 *
 * The catalog records which phase implements each event; check 6 reads this phase's own
 * entries back out. Written once here so the label and the file name cannot drift apart.
 */
const PHASE_LABEL = 'P1-22';

/**
 * The canonical 31 task identifiers, each with the ARTIFACTS that prove it was done.
 *
 * ## PROOF SETS ARE INCOMPLETE ON PURPOSE, AND INCOMPLETE MEANS FAILING
 *
 * Only `operation`, `permission`, `audit`, `event` and `doc` proofs appear below,
 * because those are the artifacts that exist (or provably do not) before a line of
 * P1-22 service code is written. `symbol` and `test` proofs are added PER TASK as the
 * evidence lands — when a service exports the function, when a test asserts the
 * behaviour — and not before, because a proof naming a file nobody has written yet is
 * indistinguishable from a proof naming a file nobody ever will.
 *
 * Ten tasks therefore carry NO proof at all right now. That is not a pass: a task with
 * an empty proof array is reported as declaring nothing and the gate exits non-zero
 * (check 8, final clause). The gate is SUPPOSED to be red until the phase is built;
 * softening it to go green early would make the traceability document a claim that
 * thirty-one tasks were done when none were.
 *
 * ## Why this is not an identifier search
 *
 * This gate reuses the P1-20/P1-21 machinery unchanged, including the reason it works
 * that way. An identifier search is unsatisfiable by construction: `P1-22-BE-002` is a
 * project-management label, not a code symbol, so it can only ever appear in a comment
 * or a string. "The identifier appears in code" therefore reduces to "somebody wrote
 * the identifier in a comment", and the gate measures typing rather than work.
 *
 * P1-20 shipped three versions of that mistake before abandoning it — one counting the
 * gate's own generated output, one resolving five identifiers to a register that prints
 * all of them, and one whose remaining hole was that comments were never stripped from
 * the haystack. The artifact-proof design below is what replaced it.
 *
 * ## What this checks instead
 *
 * Each task names the artifacts it produced, and the gate asserts those artifacts EXIST:
 *
 *   - `operation`  a registered operation id, read from the route tree
 *   - `permission` a permission code that is seeded AND declared by some operation
 *   - `audit`      an audit action in the controlled catalog that has a real producer
 *   - `event`      an event type published by this phase's modules
 *   - `symbol`     an exported symbol in a named source file (added later)
 *   - `test`       a test title substring in a named test file, comments stripped
 *                  (added later)
 *   - `doc`        a named identifier in one named document, for a task whose
 *                  deliverable IS that document
 *
 * A comment cannot register an operation, seed a permission, produce an audit action, or
 * export a symbol, and `test` strips comments before searching so a JSDoc quoting a test
 * title does not count either.
 *
 * ## What `doc` can and cannot prove — stated honestly
 *
 * `doc` IS satisfiable by prose: the check is that an identifier appears in one named
 * file. P1-21 corrected an earlier header that claimed otherwise, and the correction is
 * inherited rather than quietly dropped. Three tasks below (`QA-004`, `DOC-001`,
 * `DOC-002`) currently rest on a `doc` proof ALONE, which means today they are
 * satisfied by documents that exist. P1-21 required a structural proof alongside every
 * document — that is what stopped deleting the gate's own CI step from going unnoticed —
 * and P1-22 owes the same for these three once the routes and the CI step exist. Until
 * then this paragraph, not silence, is the record of the gap.
 */
const TASKS = Object.freeze([
  [
    'P1-22-BE-001',
    'Billing module foundation',
    [
      ['symbol', `${API_SRC_PATH}/modules/billing/index.ts`, 'billingModule'],
      ['symbol', `${API_SRC_PATH}/modules/billing/domain/billing.ts`, 'parseInvoiceAmount'],
      ['symbol', `${API_SRC_PATH}/modules/billing/domain/billing.ts`, 'parseInstrumentAmount'],
      ['symbol', `${API_SRC_PATH}/modules/billing/data/billing-repository.ts`, 'BillingRepository'],
    ],
  ],
  [
    'P1-22-BE-002',
    'Invoice preview',
    [
      ['operation', 'sal.invoice-preview'],
      ['permission', 'sal.invoice.manage'],
      ['permission', 'sal.finance.view'],
      [
        'symbol',
        `${API_SRC_PATH}/modules/billing/application/billing-read-service.ts`,
        'previewInvoice',
      ],
    ],
  ],
  [
    'P1-22-BE-003',
    'Invoice creation',
    [
      ['operation', 'sal.invoice-create'],
      ['audit', 'sal.invoice.created'],
      ['event', 'invoice.created'],
      ['symbol', `${API_SRC_PATH}/modules/billing/application/invoice-service.ts`, 'createInvoice'],
    ],
  ],
  [
    'P1-22-BE-004',
    'Invoice issuance and numbering',
    [
      ['operation', 'sal.invoice-issue'],
      ['permission', 'sal.invoice.issue'],
      ['audit', 'sal.invoice.issued'],
      ['event', 'invoice.issued'],
      ['symbol', `${API_SRC_PATH}/modules/billing/application/invoice-service.ts`, 'issueInvoice'],
      ['symbol', `${API_SRC_PATH}/modules/billing/data/billing-repository.ts`, 'issueInvoice'],
      [
        'symbol',
        `${API_SRC_PATH}/modules/billing/application/billing-read-service.ts`,
        'readNumberingConfig',
      ],
    ],
  ],
  [
    'P1-22-BE-005',
    'Invoice read and money visibility',
    [
      ['operation', 'sal.invoice-detail'],
      [
        'symbol',
        `${API_SRC_PATH}/modules/billing/application/billing-read-service.ts`,
        'readInvoice',
      ],
    ],
  ],
  [
    'P1-22-BE-006',
    'Outstanding-balance projection',
    [
      ['operation', 'sal.invoice-outstanding-read'],
      ['permission', 'sal.finance.view'],
      [
        'symbol',
        `${API_SRC_PATH}/modules/billing/application/billing-read-service.ts`,
        'readOutstanding',
      ],
      [
        'symbol',
        `${API_SRC_PATH}/modules/billing/application/billing-read-service.ts`,
        'openReceivableForWorkOrder',
      ],
    ],
  ],
  [
    'P1-22-BE-007',
    'Invoice cancellation',
    [
      ['operation', 'sal.invoice-cancel'],
      ['audit', 'sal.invoice.voided'],
      ['event', 'invoice.voided'],
      ['symbol', `${API_SRC_PATH}/modules/billing/application/invoice-service.ts`, 'cancelInvoice'],
      ['symbol', `${API_SRC_PATH}/modules/billing/data/billing-repository.ts`, 'voidInvoice'],
    ],
  ],
  [
    'P1-22-BE-008',
    'Credit-note foundation',
    [
      ['operation', 'sal.credit-note-create'],
      ['operation', 'sal.credit-note-approve'],
      ['permission', 'sal.credit.manage'],
      ['audit', 'sal.credit_note.requested'],
      ['audit', 'sal.credit_note.approved'],
      ['event', 'credit-note.issued'],
      [
        'symbol',
        `${API_SRC_PATH}/modules/billing/application/invoice-service.ts`,
        'requestCreditNote',
      ],
      [
        'symbol',
        `${API_SRC_PATH}/modules/billing/application/invoice-service.ts`,
        'approveCreditNote',
      ],
      ['symbol', `${API_SRC_PATH}/modules/billing/domain/billing.ts`, 'assertCurrencyMatches'],
    ],
  ],
  [
    'P1-22-BE-009',
    'Payments module foundation',
    [
      ['operation', 'sal.payment-method-list'],
      ['symbol', `${API_SRC_PATH}/modules/payments/index.ts`, 'paymentsModule'],
      [
        'symbol',
        `${API_SRC_PATH}/modules/payments/application/payment-read-service.ts`,
        'listPaymentMethods',
      ],
      [
        'symbol',
        `${API_SRC_PATH}/modules/payments/domain/payments.ts`,
        'assertPaymentMethodIsTenantScoped',
      ],
    ],
  ],
  [
    'P1-22-BE-010',
    'Payment recording',
    [
      ['operation', 'sal.payment-record'],
      ['permission', 'sal.payment.record'],
      ['audit', 'sal.receipt.recorded'],
      ['event', 'receipt.recorded'],
      [
        'symbol',
        `${API_SRC_PATH}/modules/payments/application/payment-service.ts`,
        'recordPayment',
      ],
      ['symbol', `${API_SRC_PATH}/modules/payments/domain/payments.ts`, 'parsePaymentAmount'],
    ],
  ],
  [
    'P1-22-BE-011',
    'Payment allocation',
    [
      ['operation', 'sal.payment-allocate'],
      ['permission', 'sal.payment.allocate'],
      ['audit', 'sal.payment.allocated'],
      ['event', 'payment.allocated'],
      [
        'symbol',
        `${API_SRC_PATH}/modules/payments/application/payment-service.ts`,
        'allocatePayment',
      ],
      [
        'symbol',
        `${API_SRC_PATH}/modules/payments/domain/payments.ts`,
        'assertAllocationUsesPrimitive',
      ],
      [
        'symbol',
        `${API_SRC_PATH}/modules/payments/domain/payments.ts`,
        'assertAllocationCurrencyCoherent',
      ],
      [
        'symbol',
        `${API_SRC_PATH}/modules/payments/domain/payments.ts`,
        'assertAllocationWithinBounds',
      ],
    ],
  ],
  [
    'P1-22-BE-012',
    'Receipt read',
    [
      ['operation', 'sal.receipt-detail'],
      [
        'symbol',
        `${API_SRC_PATH}/modules/payments/application/payment-read-service.ts`,
        'readReceipt',
      ],
    ],
  ],
  [
    'P1-22-BE-013',
    'Delivery module foundation',
    [
      ['operation', 'sal.delivery-create'],
      ['permission', 'sal.delivery.manage'],
      ['audit', 'sal.delivery.created'],
      ['symbol', `${API_SRC_PATH}/modules/delivery/index.ts`, 'deliveryModule'],
      [
        'symbol',
        `${API_SRC_PATH}/modules/delivery/application/delivery-service.ts`,
        'createDelivery',
      ],
    ],
  ],
  [
    'P1-22-BE-014',
    'Delivery eligibility composition',
    [
      ['operation', 'sal.delivery-eligibility-read'],
      [
        'symbol',
        `${API_SRC_PATH}/modules/delivery/application/delivery-read-service.ts`,
        'readEligibility',
      ],
      ['symbol', `${API_SRC_PATH}/modules/delivery/domain/delivery.ts`, 'composeEligibility'],
      ['symbol', `${API_SRC_PATH}/modules/delivery/domain/delivery.ts`, 'BLOCKER_CODES'],
    ],
  ],
  [
    'P1-22-BE-015',
    'Authorized receiver validation',
    [
      ['operation', 'sal.delivery-receiver-verify'],
      ['audit', 'sal.delivery.receiver_verified'],
      [
        'symbol',
        `${API_SRC_PATH}/modules/delivery/application/delivery-service.ts`,
        'verifyReceiver',
      ],
    ],
  ],
  [
    'P1-22-BE-016',
    'Delivery checklist and signature evidence',
    [
      ['operation', 'sal.delivery-checklist-record'],
      ['operation', 'sal.delivery-signature-attach'],
      ['audit', 'sal.delivery.checklist_recorded'],
      ['audit', 'sal.delivery.signature_recorded'],
      [
        'symbol',
        `${API_SRC_PATH}/modules/delivery/application/delivery-service.ts`,
        'recordChecklistResult',
      ],
      [
        'symbol',
        `${API_SRC_PATH}/modules/delivery/application/delivery-service.ts`,
        'attachSignature',
      ],
      [
        'symbol',
        `${API_SRC_PATH}/modules/delivery/domain/delivery.ts`,
        'assertChecklistResultShape',
      ],
      ['symbol', `${API_SRC_PATH}/modules/delivery/domain/delivery.ts`, 'assertSignerRole'],
    ],
  ],
  [
    'P1-22-BE-017',
    'Vehicle delivery completion',
    [
      ['operation', 'sal.delivery-complete'],
      ['permission', 'sal.delivery.complete'],
      ['audit', 'sal.delivery.completed'],
      ['event', 'vehicle.delivered'],
      [
        'symbol',
        `${API_SRC_PATH}/modules/delivery/application/delivery-service.ts`,
        'completeDelivery',
      ],
      ['symbol', `${API_SRC_PATH}/modules/delivery/domain/delivery.ts`, 'withOverrides'],
      ['symbol', `${API_SRC_PATH}/modules/delivery/domain/delivery.ts`, 'assertEligible'],
    ],
  ],
  [
    'P1-22-BE-018',
    'Warranty generation',
    [
      ['operation', 'wty.warranty-generate'],
      ['operation', 'wty.warranty-detail'],
      ['permission', 'wty.warranty.issue'],
      ['audit', 'wty.warranty.issued'],
      ['event', 'warranty.issued'],
      ['symbol', `${API_SRC_PATH}/modules/warranty/index.ts`, 'warrantyModule'],
      [
        'symbol',
        `${API_SRC_PATH}/modules/warranty/application/warranty-service.ts`,
        'generateWarranty',
      ],
      [
        'symbol',
        `${API_SRC_PATH}/modules/warranty/application/warranty-service.ts`,
        'readWarranty',
      ],
      ['symbol', `${API_SRC_PATH}/modules/warranty/domain/warranty.ts`, 'assertPolicyActive'],
      ['symbol', `${API_SRC_PATH}/modules/warranty/domain/warranty.ts`, 'assertWritableStatus'],
    ],
  ],
  [
    'P1-22-SEC-001',
    'Authorization and isolation matrix',
    [
      [
        'test',
        'tests/backend/p1-22-isolation.test.ts',
        'refuses sal.payment-record for company A1 with a branch of company A9',
      ],
      [
        'test',
        'tests/backend/p1-22-isolation.test.ts',
        'answers 200 while the grant is active and 403 once it is revoked',
      ],
      [
        'test',
        'tests/backend/p1-22-isolation.test.ts',
        'refuses a body carrying a company, a branch or an amount',
      ],
      [
        'test',
        'tests/backend/p1-22-isolation.test.ts',
        'refuses sal.payment-record and sal.receipt-detail on a VISIBLE receipt',
      ],
    ],
  ],
  [
    'P1-22-SEC-002',
    'Currency coherence and exact money',
    [
      ['symbol', 'scripts/ci/check-exact-money.mjs', 'MONEY_TREES'],
      ['symbol', `${API_SRC_PATH}/modules/pricing/domain/decimal.ts`, 'parseNonNegative'],
      ['symbol', `${API_SRC_PATH}/modules/pricing/domain/decimal.ts`, 'parsePositive'],
      ['symbol', `${API_SRC_PATH}/modules/pricing/domain/money.ts`, 'assertSameCurrency'],
    ],
  ],
  [
    'P1-22-SEC-003',
    'Receiver and signature privacy',
    [
      ['permission', 'sal.delivery.view'],
      ['symbol', `${API_SRC_PATH}/modules/delivery/domain/delivery.ts`, 'SIGNER_ROLES'],
      [
        'symbol',
        `${API_SRC_PATH}/modules/delivery/application/delivery-service.ts`,
        'attachSignature',
      ],
    ],
  ],
  [
    'P1-22-SEC-004',
    'Numbering safety',
    [
      [
        'symbol',
        `${API_SRC_PATH}/modules/shared-services/domain/sequence-registry.ts`,
        'SEQUENCE_DEFINITIONS',
      ],
      [
        'symbol',
        `${API_SRC_PATH}/modules/shared-services/application/number-allocation-service.ts`,
        'isProvisioned',
      ],
    ],
  ],
  [
    'P1-22-QA-001',
    'Phase test cases TC-P1-22-001 to 008',
    [
      ['test', 'tests/backend/p1-22-invoice-lifecycle.test.ts', 'TC-P1-22-001'],
      ['test', 'tests/backend/p1-22-invoice-lifecycle.test.ts', 'TC-P1-22-002'],
      ['test', 'tests/backend/p1-22-invoice-lifecycle.test.ts', 'TC-P1-22-003'],
      ['test', 'tests/backend/p1-22-payments.test.ts', 'TC-P1-22-004'],
      ['test', 'tests/backend/p1-22-currency-coherence.test.ts', 'TC-P1-22-005'],
      ['test', 'tests/backend/p1-22-delivery.test.ts', 'TC-P1-22-006'],
      ['test', 'tests/backend/p1-22-warranty.test.ts', 'TC-P1-22-007'],
      ['test', 'tests/backend/p1-22-credit-note.test.ts', 'TC-P1-22-008'],
    ],
  ],
  [
    'P1-22-QA-002',
    'Idempotency replay evidence',
    [
      ['symbol', 'scripts/ci/check-idempotency-evidence.mjs', 'EVIDENCE_KEY'],
      [
        'test',
        'tests/backend/p1-22-payments.test.ts',
        'replays an idempotency key without recording a second receipt',
      ],
      [
        'test',
        'tests/backend/p1-22-payments.test.ts',
        'replays an idempotency key without allocating twice',
      ],
      [
        'test',
        'tests/backend/p1-22-warranty.test.ts',
        'replays an idempotency key without issuing a second warranty',
      ],
      [
        'test',
        'tests/backend/p1-22-payments.test.ts',
        'refuses the same idempotency key with a different payload',
      ],
    ],
  ],
  [
    'P1-22-QA-003',
    'Real concurrency races',
    [
      ['symbol', 'tests/backend/p1-22-concurrency.test.ts', 'waitForBlockedBackends'],
      [
        'test',
        'tests/backend/p1-22-concurrency.test.ts',
        'sal.delivery-complete: two concurrent completions release custody exactly once',
      ],
      [
        'test',
        'tests/backend/p1-22-concurrency.test.ts',
        'sal.payment-allocate: a concurrent cancel and allocate never both take effect',
      ],
      [
        'test',
        'tests/backend/p1-22-concurrency.test.ts',
        'two concurrent warranty generations from one delivery issue exactly one record',
      ],
    ],
  ],
  [
    'P1-22-QA-004',
    'Endpoint inventory and operation depth',
    [['doc', 'docs/phase-1/phase-1-22/operation-inventory.md', 'sal.invoice-issue']],
  ],
  [
    'P1-22-QA-005',
    'Hostile mutation matrix',
    [
      ['symbol', 'scripts/ci/hostile-mutations.mjs', 'M-22-01'],
      ['symbol', 'scripts/ci/hostile-mutations.mjs', 'M-22-09'],
      ['symbol', 'scripts/ci/hostile-mutations.mjs', 'ALLOCATE_RECEIPT_SQL'],
      [
        'test',
        'tests/foundation/exact-money-gate.test.ts',
        'MONEY-01 catches Number() on an amount',
      ],
    ],
  ],
  [
    'P1-22-DO-001',
    'CI gate integration',
    [
      ['symbol', '.github/workflows/ci.yml', 'npm run validate:p1-22-inventory'],
      ['symbol', '.github/workflows/_reusable-clean-room.yml', 'npm run validate:p1-22-inventory'],
      ['symbol', '.github/workflows/_reusable-node-quality.yml', 'npm run validate:exact-money'],
      ['symbol', 'package.json', 'validate:p1-22-inventory'],
    ],
  ],
  [
    'P1-22-DO-002',
    'Coverage non-regression and evidence artifacts',
    [
      ['symbol', 'scripts/ci/coverage-gate.mjs', 'tolerancePercentagePoints'],
      ['symbol', '.github/ci-baselines/coverage-baseline.backend.json', 'touchedFileMinimum'],
      ['symbol', 'scripts/check-operation-test-coverage.mjs', 'P1_22_PREFIXES'],
      [
        'symbol',
        'tests/foundation/operation-coverage-gate.test.ts',
        'P1-22 hook 1: the derived floor',
      ],
    ],
  ],
  [
    'P1-22-DOC-001',
    'Operation inventory, blocker treatment and limitations',
    [['doc', 'docs/phase-1/phase-1-22/blocker-treatment.md', 'P1-22-L-02']],
  ],
  [
    'P1-22-DOC-002',
    'Operator provisioning runbook',
    [['doc', 'docs/phase-1/phase-1-22/number-sequence-runbook.md', 'next_display_number']],
  ],
]);

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name === 'route.ts') out.push(full);
  }
  return out;
}

/** Removes block and line comments, so prose cannot satisfy a structural check. */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const field = (chunk, name) => {
  const match = new RegExp(`${name}:\\s*'([^']+)'`).exec(chunk);
  return match ? match[1] : undefined;
};

/**
 * Reads every `defineOperation({...})` literal plus the handler text after it.
 *
 * A regex rather than the TypeScript compiler because every field needed here is a
 * literal by construction — `check-authorization-coverage.mjs` forbids assembling an
 * operation from variables, so a literal read cannot be defeated by indirection the
 * repository does not permit.
 */
function parseOperations(source, file) {
  const parts = source.split(/export const [A-Z0-9_]+_OPERATION = defineOperation\(\{/).slice(1);
  return parts.map((part) => {
    /**
     * The DECLARATION is comment-stripped too, not just the handler.
     *
     * `field()` returns the FIRST `name: '…'` match, so a comment above or inside the
     * literal beats the real value. That is not hypothetical: in P1-20 the JSDoc on
     * `svc.service-list` explained why `scope: 'branch'` would fail closed, and the
     * generated inventory therefore reported that operation as `branch` while the route
     * declared `tenant` — contradicting the authorization map in the same commit.
     *
     * The dangerous direction is the other one: a genuinely branch-scoped operation whose
     * comment mentions `scope: 'tenant'` earlier would be read as tenant and skip the
     * `scopeEnforced` check altogether — a scope-blind operation passing the guard that
     * exists to catch exactly that.
     */
    const declaration = stripComments(part.slice(0, part.indexOf('});')));
    const handler = stripComments(part.slice(part.indexOf('});')));
    const permissions = [
      ...(/permissions:\s*\[([^\]]*)\]/.exec(declaration)?.[1] ?? '').matchAll(
        /'([a-z][a-z0-9_]*(\.[a-z][a-z0-9_]+)+)'/g
      ),
    ].map((m) => m[1]);
    return {
      id: field(declaration, 'id'),
      module: field(declaration, 'module'),
      method: field(declaration, 'method'),
      path: field(declaration, 'path'),
      summary: field(declaration, 'summary'),
      scope: field(declaration, 'scope') ?? 'tenant',
      auditClass: field(declaration, 'auditClass') ?? 'none',
      auditAction: field(declaration, 'auditAction'),
      permissions,
      idempotent: /idempotent:\s*true/.test(declaration),
      versionGuarded: /versionGuarded:\s*true/.test(declaration),
      file: relative(ROOT, file).split('\\').join('/'),
      /**
       * Whether a `scope: 'branch'` claim is actually enforced.
       *
       * Three legitimate shapes: the handler forwards `authorizeScope` to a service
       * that re-checks against the row, the declaration passes a concrete
       * `authorizationTarget`, or the handler authorizes a scope target it read from
       * the request. Comments are already stripped, so the phrase alone proves
       * nothing.
       */
      scopeEnforced:
        /authorizeScope/.test(handler) ||
        /authorizationTarget/.test(handler) ||
        /scopeTargetOption/.test(handler),
    };
  });
}

/** Event types published by this phase's modules, with their producer ids. */
function parsePublishedEvents(sources) {
  const found = [];
  for (const [file, source] of sources) {
    const clean = stripComments(source);
    // Scoped to `publishEvent(` because `recordSecurityEvent` also carries an
    // `eventType`, and counting those would report events this phase never publishes.
    for (const call of clean.split('publishEvent(').slice(1)) {
      const body = call.slice(0, 1500);
      // The whole line, because a ternary may choose between two event types.
      const typeLine = /eventType:\s*([^\n]+)/.exec(body)?.[1] ?? '';
      const producer = /producer:\s*'([^']+)'/.exec(body)?.[1];
      // A DOTTED name is required. The line may be a ternary choosing between two
      // event types, so every quoted string on it is a candidate — but a ternary's
      // CONDITION also quotes bare words (`outcome === 'accepted' ? …`), and matching
      // those reported "accepted" as an unregistered event. Every event type in
      // `EVENT_CATALOG` is `aggregate.verb`, so requiring the dot separates the two
      // without having to parse the expression.
      for (const match of typeLine.matchAll(/'([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+)'/g)) {
        found.push({ eventType: match[1], producer, file: relative(ROOT, file) });
      }
    }
  }
  return found;
}

/**
 * Every `EVENT_CATALOG` entry as `{ eventType, owner, implementedIn }`, for check 6.
 *
 * The 400-character window is the same span checks 5 uses to associate a field with an
 * entry, and it is read from the COMMENT-STRIPPED catalog for the same reason: the
 * header comment above the `sal` block discusses `credit-note.issued` and quotes phase
 * labels in prose, and prose must not be able to answer a structural question.
 *
 * `implementedIn` is returned as the parsed VALUE — a string, `null`, or `undefined`
 * when the entry has no such field — rather than as the raw source text, so a caller
 * cannot accidentally compare against the quotes.
 */
function parseEventCatalog(catalog) {
  return [...catalog.matchAll(/eventType:\s*'([^']+)'/g)].map((match) => {
    const window = catalog.slice(match.index, match.index + 400);
    const implemented = /implementedIn:\s*(null|'([^']+)')/.exec(window);
    return {
      eventType: match[1],
      owner: /owner:\s*'([^']+)'/.exec(window)?.[1],
      implementedIn: implemented === null ? undefined : (implemented[2] ?? null),
    };
  });
}

function main() {
  const check = process.argv.includes('--check');
  const failures = [];

  // ---- Inputs -------------------------------------------------------------
  const routeFiles = walk(API_ROOT);
  /**
   * `PHASE_PREFIXES.some(...)`, never a single `startsWith`.
   *
   * P1-22 is the first phase since P1-20 to ship two id namespaces, and this filter is
   * the funnel every check below draws from: an id that does not survive it has no
   * permission reconciliation, no audit-class check, no scope guard, and no row in the
   * inventory. Hard-coding `'sal.'` here would have dropped all of `wty.` out of the
   * gate while the summary line still said the phase reconciles.
   */
  const operations = routeFiles
    .flatMap((file) => parseOperations(readFileSync(file, 'utf8'), file))
    .filter((op) => op.id && PHASE_PREFIXES.some((p) => op.id.startsWith(p)))
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  // EVERY route in the API tree, not only this phase's: the port-pairing rule below
  // has to see the P1-19 approval route, which registers a `wo.` operation.
  const routeSources = routeFiles.map((file) => [file, readFileSync(file, 'utf8')]);

  /**
   * The parser must not silently MISS a declaration.
   *
   * `parseOperations` splits on `export const <NAME>_OPERATION = defineOperation({`,
   * which is the repository's convention but not something the compiler enforces. A
   * declaration assigned to a differently named constant would simply not be seen — and
   * an operation invisible to this gate has no permission reconciliation, no audit-action
   * check, no scope check and no place in the inventory, while the gate reports success.
   *
   * So the number of `defineOperation(` call sites is counted independently and
   * compared. A mismatch fails the gate rather than quietly undercounting: better to
   * fail on a naming convention than to certify a surface the gate never read.
   */
  const callSites = routeSources.reduce(
    (total, [, source]) => total + (stripComments(source).match(/defineOperation\(/g) ?? []).length,
    0
  );
  const parsedCount = routeFiles.reduce(
    (total, file) => total + parseOperations(readFileSync(file, 'utf8'), file).length,
    0
  );
  if (callSites !== parsedCount) {
    failures.push(
      `operation parser drift: ${callSites} defineOperation( call site(s) in the route tree but ` +
        `${parsedCount} parsed. A declaration not assigned to ` +
        `\`export const <NAME>_OPERATION\` is invisible to every check in this gate.`
    );
  }

  // EVERY module, for the audit-producer scan only: an action this phase declares may be
  // emitted from a module this phase does not own (a delivery completion can be appended
  // from the work-order side of a handover).
  const allModuleSources = [];
  {
    const stack = [join(API_SRC_ROOT, 'modules')];
    while (stack.length > 0) {
      const current = stack.pop();
      // `withFileTypes` answers "directory?" from the directory read itself,
      // so there is no second lookup that could disagree with the first.
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.name.endsWith('.ts'))
          allModuleSources.push([full, readFileSync(full, 'utf8')]);
      }
    }
  }

  const moduleSources = [];
  for (const name of PHASE_MODULES) {
    const dir = join(API_SRC_ROOT, 'modules', name);
    /**
     * A MISSING module directory FAILS the gate instead of being skipped.
     *
     * P1-21 wrote `if (!existsSync(dir)) continue;`, and with ONE module that was safe:
     * a typo produced zero sources, so every `event` proof in the phase failed at once
     * and the mistake was impossible to miss. With FOUR, three correct names cover for
     * the fourth — the unscanned module's `publishEvent` calls are never compared
     * against `EVENT_CATALOG` (check 5) and never counted as published (the `event`
     * proof), so an unregistered or misowned event ships while this gate reports
     * success. That silence is the failure mode this replaces; the four directories
     * exist today, so the check costs nothing and only speaks when a name rots.
     */
    if (!existsSync(dir)) {
      failures.push(
        `PHASE_MODULES names "${name}" but src/modules/${name} does not exist — its ` +
          'publishEvent calls would go unscanned, making checks 5 and 6 vacuous for it'
      );
      continue;
    }
    const stack = [dir];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.name.endsWith('.ts')) moduleSources.push([full, readFileSync(full, 'utf8')]);
      }
    }
  }

  const permissionSeed = readFileSync(
    join(ROOT, 'supabase', 'seeds', '04_iam_permission_catalog.sql'),
    'utf8'
  );
  const auditCatalog = readFileSync(
    join(API_SRC_ROOT, 'server', 'auth', 'audit-actions.ts'),
    'utf8'
  );
  /**
   * The event catalog is read with its COMMENTS STRIPPED.
   *
   * Check 5 below matches `implementedIn:` inside a 400-character window after an
   * `eventType:`, and that window covers the entry's explanatory comment. On the raw
   * source the first match wins, so prose is indistinguishable from a field: a comment
   * saying `implementedIn: 'P1-22'` above a field that still says `null` would satisfy
   * the check while the catalog kept documenting an unproduced event — which is exactly
   * the class of defect check 5 exists to catch. The `sal` block in `envelope.ts` is
   * preceded by a long comment that names event types and reserves none, so this is not
   * a theoretical concern for this phase.
   */
  const eventCatalog = stripComments(
    readFileSync(join(API_SRC_ROOT, 'server', 'events', 'envelope.ts'), 'utf8')
  );

  // ---- 1. Permissions exist in the seed -----------------------------------
  for (const op of operations) {
    for (const code of op.permissions) {
      if (!permissionSeed.includes(`'${code}'`)) {
        failures.push(`${op.id}: permission "${code}" is not in the IAM permission seed`);
      }
    }
    if (op.permissions.length === 0) {
      failures.push(`${op.id}: declares no permission code`);
    }
  }

  // ---- 2. Audit actions exist, with the declared class --------------------
  for (const op of operations) {
    if (op.auditClass === 'none') {
      if (op.auditAction !== undefined) {
        failures.push(`${op.id}: auditClass none but declares action "${op.auditAction}"`);
      }
      continue;
    }
    if (op.auditAction === undefined) {
      failures.push(`${op.id}: auditClass "${op.auditClass}" with no audit action`);
      continue;
    }
    const entry = new RegExp(
      `code:\\s*'${escapeRegExp(op.auditAction)}',\\s*\\n\\s*class:\\s*'([a-z]+)'`
    ).exec(auditCatalog);
    if (entry === null) {
      failures.push(`${op.id}: audit action "${op.auditAction}" is not in the audit catalog`);
    } else if (entry[1] !== op.auditClass) {
      failures.push(
        `${op.id}: declares class "${op.auditClass}" but the catalog files ` +
          `"${op.auditAction}" as "${entry[1]}"`
      );
    }
  }

  // ---- 3. Branch scope is actually enforced -------------------------------
  for (const op of operations) {
    if (op.scope === 'branch' && !op.scopeEnforced) {
      failures.push(
        `${op.id}: declares scope 'branch' but its handler enforces no scope — a declared ` +
          'branch scope with no target degrades to a scope-blind check (P1-18-A-01)'
      );
    }
  }

  /**
   * ---- 4. Every operation is served by a module this phase owns -------------
   *
   * New in P1-22, and new because of the plural. P1-21 parsed `module:` and never read
   * it: with one module in the phase the field could only hold one useful value, so a
   * check would have been a tautology. Across four it carries information, and a wrong
   * value is not cosmetic — `PHASE_MODULES` decides which trees are scanned for
   * `publishEvent`, so a `sal.` operation declared under, say, `work-order` would emit
   * events that checks 5 and 6 never read, and the inventory would file the endpoint
   * under a module that does not own it.
   *
   * If a later wave legitimately serves one of these ids from another module, the honest
   * fix is to ADD that module to `PHASE_MODULES` — which also brings its event
   * publications under check 5 — not to delete this check.
   */
  for (const op of operations) {
    if (!PHASE_MODULES.includes(op.module)) {
      failures.push(
        `${op.id}: declares module "${op.module ?? '(none)'}", which is not one of this ` +
          `phase's modules (${PHASE_MODULES.join(', ')})`
      );
    }
  }

  // ---- 5. Published events are registered, owned, and marked implemented --
  const published = parsePublishedEvents(moduleSources);
  for (const event of published) {
    const owner = new RegExp(
      `eventType:\\s*'${escapeRegExp(event.eventType)}',[\\s\\S]{0,400}?owner:\\s*'([^']+)'`
    ).exec(eventCatalog);
    if (owner === null) {
      failures.push(`${event.file}: publishes "${event.eventType}", which is not in EVENT_CATALOG`);
      continue;
    }
    /**
     * The producer's module segment must equal the catalog owner.
     *
     * With four modules this comparison finally discriminates. In P1-21 the only way it
     * could fail was for the catalog to disagree with the phase's single module; here
     * `billing`, `payments`, `delivery` and `warranty` all publish into the same `sal.`
     * aggregate family, so `delivery` emitting `invoice.issued` — an ownership leak that
     * would put receivable state in the hands of the module that hands over the vehicle —
     * is a live mistake rather than an impossible one.
     */
    const producerModule = (event.producer ?? '').split('.')[0];
    if (producerModule !== owner[1]) {
      failures.push(
        `${event.file}: producer "${event.producer}" publishes "${event.eventType}", which the ` +
          `catalog assigns to module "${owner[1]}"`
      );
    }
    const implemented = new RegExp(
      `eventType:\\s*'${escapeRegExp(event.eventType)}',[\\s\\S]{0,400}?implementedIn:\\s*(null|'[^']+')`
    ).exec(eventCatalog);
    if (implemented !== null && implemented[1] === 'null') {
      failures.push(
        `${event.eventType} is published but the catalog still says implementedIn: null`
      );
    }
  }

  /**
   * ---- 6. Every event the catalog attributes to P1-22 has a producer --------
   *
   * The one catalog → code check in this file, and it exists because the last clause of
   * check 5 CANNOT FIRE for this phase.
   *
   * That clause asserts "a published event whose entry still says `implementedIn: null`",
   * which guards a producer landing without the catalog being updated. But `envelope.ts`
   * already carries `implementedIn: 'P1-22'` on all eight entries it attributes to this
   * phase — written when the contract was, before a single P1-22 route existed. The
   * field can therefore never be `null` here no matter what the code does, so for P1-22
   * that clause is decoration. It is kept, because a future phase's producer appearing in
   * this tree would still trip it.
   *
   * The direction that still carries information is the reverse: the catalog CLAIMS
   * eight events are implemented in P1-22, and until something publishes each of them
   * that claim is documentation of work nobody did — the same defect check 5 guards
   * against, arriving from the other side. Deliberately narrow: it demands only what the
   * catalog already asserts about this phase's own modules, and it clears itself the
   * moment the producers land.
   */
  const publishedTypes = new Set(published.map((event) => event.eventType));
  for (const entry of parseEventCatalog(eventCatalog)) {
    if (entry.implementedIn !== PHASE_LABEL) continue;
    if (!PHASE_MODULES.includes(entry.owner)) continue;
    if (!publishedTypes.has(entry.eventType)) {
      failures.push(
        `EVENT_CATALOG says "${entry.eventType}" is implementedIn '${PHASE_LABEL}' and owned by ` +
          `"${entry.owner}", but nothing in this phase's modules publishes it`
      );
    }
  }

  /**
   * ---- 7. A route that cites a quotation revision installs the port --------
   *
   * `@/modules/quotation` installs `CommercialApprovalReader` at module scope, and
   * `@/modules/work-order` must not import it — that is the cycle the port exists to
   * break. So the installation can only happen in a ROUTE that loads both, and the one
   * route consuming the port did not load it: whether the port existed depended on which
   * endpoint a fresh process happened to serve first.
   *
   * Inherited from P1-20/P1-21 verbatim. It is a WHOLE-TREE rule, so
   * `validate:p1-21-inventory` enforces it today and this copy is redundant while that
   * step is wired. It is retained anyway for two reasons: P1-22 is the likeliest next
   * citer — an invoice is built from approved commercial data, which is a quotation
   * revision — and a phase gate whose correctness depends on another phase's gate still
   * being present in `ci.yml` has an off-site dependency it cannot assert. Duplicated
   * enforcement of a true rule costs one regex.
   */
  for (const [file, source] of routeSources) {
    const clean = stripComments(source);
    /**
     * Keyed on the PORT and on the field, because either alone has a false negative.
     *
     * `quotationRevisionRef` is the field the current route passes, but a route that
     * spread a parsed body into `recordApproval`, or that called
     * `commercialApprovalReader()` directly for a read, would reach the port with no such
     * literal and pass a field-name rule silently. Naming the reader as well catches the
     * direct case; keeping the field catches the indirect one.
     */
    if (!clean.includes('quotationRevisionRef') && !clean.includes('commercialApprovalReader'))
      continue;
    if (!clean.includes("'@/modules/quotation'")) {
      failures.push(
        `${relative(ROOT, file).split('\\').join('/')}: cites quotationRevisionRef but does not ` +
          `import '@/modules/quotation', so CommercialApprovalReader may be uninstalled in a ` +
          `process that serves this route first`
      );
    }
  }

  // ---- 8. Every task resolves to ARTIFACTS that exist ---------------------
  /**
   * Each proof is checked against the thing it names, never against the identifier.
   *
   * See the commentary above `TASKS` for why three identifier-search versions of this
   * check were all vacuous. The short form: a task id can only appear in a comment, so
   * searching for it measures typing. These proofs check registrations, seeds, catalogs,
   * exported symbols and test titles, none of which prose can satisfy.
   */
  const anchors = new Map();
  const registeredIds = new Set(operations.map((op) => op.id));
  const declaredPermissions = new Set(operations.flatMap((op) => op.permissions));
  /**
   * Which audit actions are actually EMITTED.
   *
   * Two false negatives had to be closed here in P1-20/P1-21, and both were found by
   * this check failing on actions that are genuinely produced:
   *
   *  - Scope. An action a phase declares may be appended from a module the phase does
   *    not own. Every module is scanned, because which module emits an action is not
   *    something the phase boundary decides — and with four modules in this phase the
   *    same action can legitimately be written from a fifth.
   *  - Ternaries. An action chosen by `action: outcome === 'accepted' ? … : …` is
   *    invisible to a single-capture regex. The whole line is read and every dotted
   *    literal on it is collected — the same correction the event scanner needed.
   */
  const producedAudit = new Set(
    [...allModuleSources, ...routeSources].flatMap(([, source]) =>
      [...stripComments(source).matchAll(/action:\s*([^\n]+)/g)].flatMap((line) =>
        [...line[1].matchAll(/'([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]+)+)'/g)].map((m) => m[1])
      )
    )
  );

  /**
   * The text a proof is matched against, with comments removed only where that is safe.
   *
   * `stripComments` understands `//` and block comments, which is TypeScript and
   * JavaScript. Applying it to JSON, YAML or Markdown would be actively wrong: the `//`
   * inside any `https://` URL would swallow the rest of that line and turn a present
   * artifact into a missing one. Those formats have no comment syntax this function
   * should be guessing at, and prose in them is not the hazard the stripping exists for.
   *
   * The `.` is escaped here, where P1-21 left it as a wildcard. `/.(ts|js)$/` also
   * matches a file whose name merely ENDS in those letters, so an extensionless
   * `notes` or `docs/apis` would have been comment-stripped as if it were source.
   * No current proof names such a path; the escape stops the next one from finding out.
   */
  const visibleText = (relativePath, source) =>
    /\.(ts|mjs|js|tsx)$/.test(relativePath) ? stripComments(source) : source;

  const readIfPresent = (relativePath) => {
    const abs = join(ROOT, relativePath);
    return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  };

  for (const [id, , proofs] of TASKS) {
    const resolved = [];
    for (const proof of proofs) {
      const [kind, first, second] = proof;
      if (kind === 'operation') {
        if (registeredIds.has(first)) resolved.push(`operation ${first}`);
        else failures.push(`${id}: names operation "${first}", which is not registered`);
        continue;
      }
      if (kind === 'permission') {
        // Both halves: seeded in the catalog AND actually declared by an operation. A
        // seeded code no operation asks for proves nothing about this phase — and every
        // `sal.`/`wty.` code was seeded back in P1-11, so "seeded" alone would resolve
        // all eleven permission proofs below before any endpoint existed.
        const seeded = permissionSeed.includes(`'${first}'`);
        if (seeded && declaredPermissions.has(first)) resolved.push(`permission ${first}`);
        else {
          failures.push(
            `${id}: permission "${first}" is ${seeded ? 'seeded but declared by no operation' : 'not in the permission seed'}`
          );
        }
        continue;
      }
      if (kind === 'audit') {
        // In the controlled catalog AND emitted somewhere. "Declared" is not
        // "produced": P1-20 found two of its own actions sitting in the catalog with
        // no producer at all, which is why this check exists. All thirteen actions
        // below are already in the catalog, so the emitted half is what this phase's
        // failures currently rest on.
        const inCatalog = auditCatalog.includes(`'${first}'`);
        if (inCatalog && producedAudit.has(first)) resolved.push(`audit ${first}`);
        else {
          failures.push(
            `${id}: audit action "${first}" is ${inCatalog ? 'in the catalog but emitted by nothing' : 'not in the controlled catalog'}`
          );
        }
        continue;
      }
      if (kind === 'event') {
        if (publishedTypes.has(first)) resolved.push(`event ${first}`);
        else failures.push(`${id}: event "${first}" is published by nothing in this phase`);
        continue;
      }
      if (kind === 'symbol') {
        const source = readIfPresent(first);
        if (source === null) {
          failures.push(`${id}: names ${first}, which does not exist`);
        } else if (visibleText(first, source).includes(second)) {
          resolved.push(`${first} -> ${second}`);
        } else {
          failures.push(`${id}: ${first} does not contain "${second}" outside its comments`);
        }
        continue;
      }
      if (kind === 'test') {
        const source = readIfPresent(first);
        if (source === null) {
          failures.push(`${id}: names test file ${first}, which does not exist`);
          continue;
        }
        // Comments stripped, so a JSDoc quoting a test title cannot stand in for the
        // test. What remains is executable code: an `it(...)`/`describe(...)` title.
        if (visibleText(first, source).includes(second)) resolved.push(`${first} -> "${second}"`);
        else failures.push(`${id}: no test matching "${second}" in ${first}`);
        continue;
      }
      if (kind === 'doc') {
        /**
         * `['doc', path, identifier]` — THREE elements, where P1-21 had two.
         *
         * P1-21 checked that the named document mentions the TASK ID. None of this
         * phase's three documents does: all were written during contract archaeology,
         * before the task register existed, and editing them to insert task labels
         * would be manufacturing the evidence this gate is supposed to read. The
         * identifier form is also the more informative of the two — a task label in
         * prose measures typing, while `next_display_number` or `P1-22-L-02` names the
         * mechanism the document is accountable for.
         *
         * Still prose, and still the weakest kind here: see the `doc` paragraph above
         * `TASKS`. The exact file is named, so a mention elsewhere in `docs/` cannot
         * satisfy it, and a missing identifier names which one is absent.
         */
        const source = readIfPresent(first);
        if (source === null) {
          failures.push(`${id}: names document ${first}, which does not exist`);
        } else if (second === undefined) {
          // A two-element `doc` proof would otherwise resolve on `includes(undefined)`
          // being false — i.e. fail with a confusing message — or, worse, pass if that
          // ever changed. Refused explicitly instead.
          failures.push(`${id}: doc proof for ${first} names no identifier to look for`);
        } else if (visibleText(first, source).includes(second)) {
          resolved.push(`${first} -> ${second}`);
        } else {
          failures.push(
            `${id}: ${first} does not name "${second}", the identifier this task delivers`
          );
        }
        continue;
      }
      failures.push(`${id}: unknown proof kind "${kind}"`);
    }
    anchors.set(id, resolved);
    /**
     * A task that declares NO proof is INCOMPLETE, and incomplete is a FAILURE.
     *
     * Ten P1-22 tasks are in that state today and the honest report for them is red:
     * the phase is not built. The `resolved.length === 0` clause already covered it —
     * a task with no proofs resolves nothing — but it says "no artifact proof resolved",
     * which reads as "the proofs were checked and all missed" and hides the distinction
     * that matters when triaging the list. So the declared-nothing case is reported in
     * its own words. Neither clause can be satisfied by adding proofs that do not
     * resolve, and neither ever reports a pass.
     */
    if (proofs.length === 0) {
      failures.push(
        `${id}: declares NO artifact proof at all — the task is incomplete, not satisfied`
      );
    } else if (resolved.length === 0) {
      failures.push(`${id}: no artifact proof resolved`);
    }
  }

  // ---- Documents ----------------------------------------------------------
  const inventory = [
    '# P1-22 endpoint inventory',
    '',
    '> GENERATED by `scripts/p1-22-endpoint-inventory.mjs`. Do not edit by hand —',
    '> `npm run validate:p1-22-inventory` regenerates it and CI fails on a stale copy.',
    '',
    `Operations: **${operations.length}**. Published events: **${publishedTypes.size}**.`,
    '',
    // The Module column is a P1-22 addition. Four modules serve two id prefixes here,
    // so `sal.` no longer identifies the owner and a reader cannot tell which module
    // answers an endpoint from the id alone. It also makes the parsed `module` field
    // observable, which is what check 4 relies on.
    '| Operation | Module | Method | Path | Permissions | Scope | Audit | Idempotent | If-Match |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...operations.map(
      (op) =>
        `| \`${op.id}\` | ${op.module ?? '—'} | ${op.method} | \`${op.path}\` | ${op.permissions
          .map((p) => `\`${p}\``)
          .join(', ')} | ${op.scope} | ${op.auditClass}${
          op.auditAction === undefined ? '' : ` (\`${op.auditAction}\`)`
        } | ${op.idempotent ? 'yes' : 'no'} | ${op.versionGuarded ? 'yes' : 'no'} |`
    ),
    '',
    '## Published events',
    '',
    '| Event | Producer | Source |',
    '| --- | --- | --- |',
    ...[...new Map(published.map((e) => [`${e.eventType}|${e.producer}`, e])).values()].map(
      (e) => `| \`${e.eventType}\` | \`${e.producer}\` | \`${e.file.split('\\').join('/')}\` |`
    ),
    '',
  ].join('\n');

  const traceability = [
    '# P1-22 task traceability',
    '',
    // Derived from TASKS.length rather than typed. In P1-21 a literal "27" survived the
    // adaptation from P1-20 and contradicted the "Tasks: 28" line printed four lines
    // below it, in the one document whose job is to be counted.
    `> GENERATED by \`scripts/p1-22-endpoint-inventory.mjs\`. Every one of the ${TASKS.length} task`,
    '> identifiers must resolve to at least one ARTIFACT in the repository, or the gate',
    '> fails. P1-19 shipped with 13 of 33 identifiers greppable nowhere; this check',
    '> exists so that cannot recur.',
    '',
    '> A task with an empty Anchors cell has declared no artifact yet. That is a FAILING',
    '> state, not a pass: the gate exits non-zero while any task is unresolved, and it is',
    '> expected to stay red until the phase is built.',
    '',
    `Tasks: **${TASKS.length}**. All resolved: **${[...anchors.values()].every((h) => h.length > 0) ? 'yes' : 'NO'}**.`,
    '',
    '| Task | Title | Anchors |',
    '| --- | --- | --- |',
    ...TASKS.map(([id, title]) => {
      const hits = anchors.get(id) ?? [];
      const shown = hits
        .slice(0, 6)
        .map((f) => `\`${f}\``)
        .join('<br>');
      const more = hits.length > 6 ? `<br>…and ${hits.length - 6} more` : '';
      return `| \`${id}\` | ${title} | ${shown}${more} |`;
    }),
    '',
  ].join('\n');

  return { failures, inventory, traceability, check, operations };
}

/**
 * Renders through Prettier before writing.
 *
 * Otherwise `--check` and `format:check` disagree about the same file and one of
 * them can never be satisfied — a trap P1-19 hit and fixed the same way.
 */
async function write(path, body) {
  let formatted = body;
  try {
    const config = (await prettier.resolveConfig(path)) ?? {};
    formatted = await prettier.format(body, { ...config, parser: 'markdown', filepath: path });
  } catch {
    /* prettier unavailable: write the raw shape rather than failing the gate */
  }
  // Read first and interpret the failure. Asking whether the file exists and
  // then reading it is a race, and it also conflated "absent" (legitimate on a
  // first generation) with "unreadable" (never legitimate).
  let existing = null;
  try {
    existing = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  writeFileSync(path, formatted);
  return existing !== formatted;
}

const result = main();
const inventoryChanged = await write(OUTPUT, result.inventory);
const traceabilityChanged = await write(TRACEABILITY, result.traceability);

if (result.check && (inventoryChanged || traceabilityChanged)) {
  result.failures.push(
    'the generated inventory or traceability document was stale; it has been rewritten — ' +
      'commit the change'
  );
}

if (result.failures.length > 0) {
  console.error(`✖ P1-22 inventory FAILED with ${result.failures.length} problem(s):`);
  for (const failure of result.failures) console.error(`    - ${failure}`);
  process.exit(1);
}

console.log(
  `OK P1-22 inventory: ${result.operations.length} operation(s); permissions, audit actions, ` +
    `events and all ${TASKS.length} task identifiers reconcile.`
);
