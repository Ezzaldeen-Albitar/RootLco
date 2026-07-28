/**
 * P1-21 endpoint inventory and catalog reconciliation (P1-21-QA-001, P1-21-DO-001,
 * P1-21-DOC-001).
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
 *   3. a published event type is not in `EVENT_CATALOG`, or is published by a module
 *      that does not own it;
 *   4. a registered event this phase implements still says `implementedIn: null`;
 *   5. an operation declares `scope: 'branch'` but its handler enforces no scope;
 *   6. a P1-21 task names an ARTIFACT — operation, permission, audit action, event,
 *      symbol or test — that does not exist;
 *   7. the generated documents are stale.
 *
 * The reconciliation direction is code → catalog, deliberately. Catalog → code would
 * be wrong: the seeds carry codes for phases not yet implemented, and a phase is not
 * obliged to consume all of them. "Every code this phase DECLARES must exist" is the
 * honest direction and the one enforced here.
 *
 * ### Why the scope guard strips comments first
 *
 * P1-19 learned this the hard way: the first version of the equivalent guard was
 * satisfied by the COMMENT explaining the fix rather than by the fix. Comments are
 * removed before the handler is searched, so a claim in prose cannot satisfy a
 * structural check.
 */
import { readFileSync, readdirSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_ROOT = join(ROOT, 'src', 'app', 'api', 'v1');
const EVIDENCE = join(ROOT, 'docs', 'phase-1', 'phase-1-21', 'evidence');
const OUTPUT = join(EVIDENCE, 'endpoint-inventory.md');
const TRACEABILITY = join(EVIDENCE, 'task-traceability.md');

/** The one schema this phase delivers. Everything else belongs to a predecessor. */
const PHASE_PREFIXES = ['inv.'];

/** Modules this phase owns, for the producer/owner reconciliation. */
const PHASE_MODULES = ['inventory'];

/**
 * The canonical 28 task identifiers, each with the ARTIFACTS that prove it was done.
 *
 * ## Why this is not an identifier search
 *
 * This gate reuses the P1-20 machinery unchanged, including the reason it works that
 * way. An identifier search is unsatisfiable by construction: `P1-21-BE-002` is a
 * project-management label, not a code symbol, so it can only ever appear in a comment
 * or a string. "The identifier appears in code" therefore reduces to "somebody wrote
 * the identifier in a comment", and the gate measures typing rather than work.
 *
 * P1-20 shipped three versions of that mistake before abandoning it — one counting the
 * gate's own generated output, one resolving five identifiers to a register that prints
 * all of them, and one whose remaining hole was that comments were never stripped from
 * the haystack. The artifact-proof design below is what replaced it, and P1-21 inherits
 * it rather than rediscovering the same shape a fourth time.
 *
 * ## What this checks instead
 *
 * Each task names the artifacts it produced, and the gate asserts those artifacts EXIST:
 *
 *   - `operation`  a registered operation id, read from the route tree
 *   - `permission` a permission code that is seeded AND declared by some operation
 *   - `audit`      an audit action in the controlled catalog that has a real producer
 *   - `event`      an event type published by this phase's modules
 *   - `symbol`     an exported symbol in a named source file
 *   - `test`       a test title substring in a named test file, comments stripped
 *   - `doc`        an identifier in one named document, for a task whose deliverable IS
 *                  that document
 *
 * None of those can be satisfied by prose. A comment cannot register an operation, seed a
 * permission, produce an audit action, export a symbol or name a test. `test` strips
 * comments before searching, so a JSDoc quoting a test title does not count either. The
 * one `doc` proof is deliberately narrow: a single named file, for the single task whose
 * output is documentation, and naming the wrong file fails.
 */
const TASKS = Object.freeze([
  [
    'P1-21-BE-001',
    'Item search',
    [
      ['operation', 'inv.item-search'],
      ['permission', 'inv.item.read'],
      ['symbol', 'src/modules/inventory/index.ts', 'inventoryModule'],
      ['symbol', 'src/modules/inventory/application/inventory-read-service.ts', 'searchItems'],
      ['symbol', 'src/modules/inventory/data/inventory-repository.ts', 'listItems'],
      ['test', 'tests/backend/p1-21-inventory-reads.test.ts', 'escapes LIKE metacharacters'],
      ['test', 'tests/backend/p1-21-inventory-reads.test.ts', 'excludes archived items by default'],
    ],
  ],
  [
    'P1-21-BE-002',
    'Opening balances',
    [
      ['operation', 'inv.opening-batch-create'],
      ['operation', 'inv.opening-batch-line-create'],
      ['operation', 'inv.opening-batch-approve'],
      ['permission', 'inv.adjustment.approve'],
      ['audit', 'inv.opening_batch.created'],
      ['audit', 'inv.opening_batch.approved'],
      ['symbol', 'src/modules/inventory/application/inventory-intake-service.ts', 'approveBatch'],
      ['symbol', 'src/modules/inventory/data/inventory-repository.ts', 'approveOpeningBatch'],
      ['test', 'tests/backend/p1-21-inventory-intake.test.ts', 'mints stock only on approval'],
      ['test', 'tests/backend/p1-21-inventory-intake.test.ts', 'refuses approving an EMPTY batch'],
    ],
  ],
  [
    'P1-21-BE-003',
    'Stock availability',
    [
      ['operation', 'inv.stock-availability-read'],
      ['permission', 'inv.stock.read'],
      ['symbol', 'src/modules/inventory/application/inventory-read-service.ts', 'readAvailability'],
      ['symbol', 'src/modules/inventory/data/inventory-repository.ts', 'readAvailability'],
      [
        'test',
        'tests/backend/p1-21-inventory-reads.test.ts',
        'invents no field the schema does not store',
      ],
      ['test', 'tests/backend/p1-21-inventory-reads.test.ts', 'excludes quarantine by default'],
    ],
  ],
  [
    'P1-21-BE-004',
    'Stock reservation',
    [
      ['operation', 'inv.stock-reservation-create'],
      ['permission', 'inv.stock.operate'],
      ['audit', 'inv.stock.reserved'],
      ['event', 'stock.reserved'],
      ['symbol', 'src/modules/inventory/application/inventory-stock-service.ts', 'reserve'],
      ['symbol', 'src/modules/inventory/data/inventory-repository.ts', 'reserveStock'],
      ['test', 'tests/backend/p1-21-inventory-stock.test.ts', 'reserves stock, reduces available'],
      ['test', 'tests/backend/p1-21-inventory-stock.test.ts', 'reserves the exact final unit'],
    ],
  ],
  [
    'P1-21-BE-005',
    'Reservation release',
    [
      ['operation', 'inv.stock-reservation-release'],
      ['audit', 'inv.stock.reservation_released'],
      ['event', 'stock.reservation.released'],
      ['symbol', 'src/modules/inventory/application/inventory-stock-service.ts', 'release'],
      ['symbol', 'src/modules/inventory/data/inventory-repository.ts', 'releaseReservation'],
      [
        'test',
        'tests/backend/p1-21-inventory-stock.test.ts',
        'is a safe no-op on a duplicate release',
      ],
      [
        'test',
        'tests/backend/p1-21-inventory-stock.test.ts',
        'releases an active reservation and returns the quantity',
      ],
    ],
  ],
  [
    'P1-21-BE-006',
    'Issue to work order',
    [
      ['operation', 'inv.stock-issue-create'],
      ['audit', 'inv.part.issued'],
      ['event', 'stock.movement.posted'],
      ['symbol', 'src/modules/inventory/application/inventory-stock-service.ts', 'issue'],
      ['symbol', 'src/modules/inventory/data/inventory-repository.ts', 'issuePart'],
      ['symbol', 'src/modules/inventory/domain/inventory.ts', 'assertWorkOrderAcceptsParts'],
      ['symbol', 'src/modules/inventory/domain/inventory.ts', 'assertReservationMatchesIssue'],
      [
        'test',
        'tests/backend/p1-21-inventory-stock.test.ts',
        'issues against a reservation covering ALL available stock',
      ],
      [
        'test',
        'tests/backend/p1-21-inventory-stock.test.ts',
        'refuses an issue to a DRAFT work order',
      ],
      [
        'test',
        'tests/backend/p1-21-inventory-stock.test.ts',
        'refuses a reservation belonging to a different item',
      ],
    ],
  ],
  [
    'P1-21-BE-007',
    'Return from work order',
    [
      ['operation', 'inv.stock-return-create'],
      ['audit', 'inv.part.returned'],
      ['symbol', 'src/modules/inventory/application/inventory-stock-service.ts', 'returnPart'],
      ['symbol', 'src/modules/inventory/data/inventory-repository.ts', 'returnPart'],
      [
        'test',
        'tests/backend/p1-21-inventory-stock.test.ts',
        'bounds the total at the issued quantity',
      ],
      [
        'test',
        'tests/backend/p1-21-inventory-stock.test.ts',
        'cannot name a different work order, item, or location',
      ],
    ],
  ],
  [
    'P1-21-BE-008',
    'Damaged return',
    [
      ['operation', 'inv.damaged-stock-create'],
      ['audit', 'inv.stock.damaged'],
      ['symbol', 'src/modules/inventory/application/inventory-stock-service.ts', 'recordDamage'],
      ['symbol', 'src/modules/inventory/data/inventory-repository.ts', 'recordDamage'],
      ['symbol', 'src/modules/inventory/domain/inventory.ts', 'assertQuarantineDestination'],
      [
        'test',
        'tests/backend/p1-21-inventory-stock.test.ts',
        'moves damaged units into quarantine and out of sellable availability',
      ],
      [
        'test',
        'tests/backend/p1-21-inventory-stock.test.ts',
        'refuses a destination that is not a quarantine location',
      ],
    ],
  ],
  [
    'P1-21-BE-009',
    'Customer-supplied part',
    [
      ['operation', 'inv.customer-supplied-part-create'],
      ['permission', 'inv.custody.manage'],
      ['audit', 'inv.customer_supplied_part.recorded'],
      [
        'symbol',
        'src/modules/inventory/application/inventory-intake-service.ts',
        'recordCustomerSuppliedPart',
      ],
      [
        'symbol',
        'src/modules/inventory/data/inventory-repository.ts',
        'recordCustomerSuppliedPart',
      ],
      [
        'test',
        'tests/backend/p1-21-inventory-intake.test.ts',
        'records custody and changes NO balance and NO movement',
      ],
      [
        'test',
        'tests/db/p1-21-inventory-integrity.test.ts',
        'makes company ownership of a customer part unrepresentable',
      ],
    ],
  ],
  [
    'P1-21-BE-010',
    'External-purchase part entry',
    [
      ['operation', 'inv.external-purchase-part-create'],
      ['permission', 'inv.external_purchase.record'],
      ['audit', 'inv.external_purchase.recorded'],
      [
        'symbol',
        'src/modules/inventory/application/inventory-intake-service.ts',
        'recordExternalPurchasePart',
      ],
      [
        'symbol',
        'src/modules/inventory/data/inventory-repository.ts',
        'recordExternalPurchaseCost',
      ],
      [
        'test',
        'tests/backend/p1-21-inventory-intake.test.ts',
        'records the purchase, adds no stock, and never echoes the cost',
      ],
      [
        'test',
        'tests/backend/p1-21-inventory-intake.test.ts',
        'refuses the cost to a caller without inv.cost.view',
      ],
    ],
  ],
  [
    'P1-21-BE-011',
    'Movement history',
    [
      ['operation', 'inv.stock-movement-list'],
      ['audit', 'inv.movement_history.read'],
      ['symbol', 'src/modules/inventory/application/inventory-read-service.ts', 'listMovements'],
      ['symbol', 'src/modules/inventory/data/inventory-repository.ts', 'listMovements'],
      [
        'test',
        'tests/backend/p1-21-inventory-reads.test.ts',
        'returns the opening movements newest-first and audits the read',
      ],
      [
        'test',
        'tests/backend/p1-21-inventory-reads.test.ts',
        'records the filter and the row count in the audit trail',
      ],
    ],
  ],
  [
    'P1-21-BE-012',
    'Negative-stock protection',
    [
      [
        'test',
        'tests/db/p1-21-inventory-integrity.test.ts',
        'refuses a raw balance write that would go negative',
      ],
      [
        'test',
        'tests/db/p1-21-inventory-integrity.test.ts',
        'keeps stored balances coherent with the ledger',
      ],
      [
        'test',
        'tests/backend/p1-21-inventory-stock.test.ts',
        'refuses an issue that would drive stock negative',
      ],
    ],
  ],
  [
    'P1-21-BE-013',
    'Concurrent reservation protection',
    [
      [
        'test',
        'tests/db/p1-21-inventory-integrity.test.ts',
        'leaves exactly one winner when two sessions race for the last unit',
      ],
      [
        'test',
        'tests/backend/p1-21-inventory-stock.test.ts',
        'replays an idempotency key instead of reserving twice',
      ],
    ],
  ],
  [
    'P1-21-BE-014',
    'Inventory audit and reconciliation',
    [
      ['operation', 'inv.inventory-reconciliation-read'],
      ['permission', 'inv.audit.read'],
      ['audit', 'inv.reconciliation.performed'],
      ['symbol', 'src/modules/inventory/application/inventory-read-service.ts', 'reconcile'],
      ['symbol', 'src/modules/inventory/data/inventory-repository.ts', 'reconcileBalances'],
      [
        'test',
        'tests/backend/p1-21-inventory-reads.test.ts',
        're-derives balances from the ledger and reports zero incoherent cells',
      ],
      ['test', 'tests/backend/p1-21-inventory-reads.test.ts', 'leaves the ledger untouched'],
    ],
  ],
  [
    'P1-21-BE-015',
    'Every movement has a valid business reference',
    [
      ['symbol', 'src/modules/inventory/domain/inventory.ts', 'MOVEMENT_REFERENCE_MATRIX'],
      ['symbol', 'src/modules/inventory/domain/inventory.ts', 'assertLegalMovementReference'],
      [
        'test',
        'tests/unit/p1-21-inventory-domain.test.ts',
        'accepts exactly the seven legal triples and nothing else',
      ],
      [
        'test',
        'tests/db/p1-21-inventory-integrity.test.ts',
        'refuses every illegal (type, reference_kind, direction) triple',
      ],
      [
        'test',
        'tests/db/p1-21-inventory-integrity.test.ts',
        'refuses a legal triple whose source row does not exist',
      ],
    ],
  ],
  [
    'P1-21-SEC-001',
    'Permission and scope enforcement',
    [
      ['permission', 'inv.item.read'],
      ['permission', 'inv.stock.read'],
      ['permission', 'inv.stock.operate'],
      ['permission', 'inv.custody.manage'],
      ['permission', 'inv.external_purchase.record'],
      ['permission', 'inv.audit.read'],
      [
        'test',
        'tests/backend/p1-21-inventory-reads.test.ts',
        'refuses a scoped caller the branch it holds no inventory permission in',
      ],
      [
        'test',
        'tests/backend/p1-21-inventory-stock.test.ts',
        'refuses a location in a branch the caller holds no inventory permission in',
      ],
    ],
  ],
  [
    'P1-21-SEC-002',
    'Restricted cost and export controls',
    [
      ['test', 'tests/backend/p1-21-inventory-reads.test.ts', 'never returns a cost field'],
      [
        'test',
        'tests/backend/p1-21-inventory-intake.test.ts',
        'refuses the cost to a caller without inv.cost.view',
      ],
    ],
  ],
  [
    'P1-21-SEC-003',
    'Abuse and escalation controls',
    [
      [
        'test',
        'tests/backend/p1-21-inventory-stock.test.ts',
        'refuses a malformed, zero, and floating-point quantity',
      ],
      [
        'test',
        'tests/backend/p1-21-inventory-intake.test.ts',
        'refuses a caller-supplied countedBy',
      ],
      [
        'test',
        'tests/backend/p1-21-inventory-intake.test.ts',
        'refuses a caller-supplied ownership claim',
      ],
      [
        'test',
        'tests/backend/p1-21-inventory-intake.test.ts',
        'refuses a caller-supplied is_procurement claim',
      ],
    ],
  ],
  [
    'P1-21-SEC-004',
    'Security audit coverage',
    [
      ['audit', 'inv.movement_history.read'],
      ['audit', 'inv.reconciliation.performed'],
      ['audit', 'inv.external_purchase.recorded'],
      [
        'test',
        'tests/backend/p1-21-inventory-reads.test.ts',
        'records the filter and the row count in the audit trail',
      ],
    ],
  ],
  [
    'P1-21-QA-001',
    'Unit and component coverage',
    [
      [
        'test',
        'tests/unit/p1-21-inventory-domain.test.ts',
        'round-trips values IEEE-754 cannot represent',
      ],
      [
        'test',
        'tests/unit/p1-21-inventory-domain.test.ts',
        'refuses every malformed representation rather than coercing it',
      ],
      [
        'test',
        'tests/unit/p1-21-inventory-domain.test.ts',
        'fixes every vocabulary exactly, with no invented value',
      ],
    ],
  ],
  [
    'P1-21-QA-002',
    'API and error coverage',
    [
      [
        'test',
        'tests/backend/p1-21-inventory-intake.test.ts',
        'refuses a malformed batch code and date',
      ],
      [
        'test',
        'tests/backend/p1-21-inventory-reads.test.ts',
        'refuses an unknown query parameter and an undecodable cursor',
      ],
      [
        'test',
        'tests/backend/p1-21-inventory-intake.test.ts',
        'refuses a malformed unit cost and an unknown currency',
      ],
    ],
  ],
  [
    'P1-21-QA-003',
    'Tenant, company, and branch isolation',
    [
      ['test', 'tests/backend/p1-21-inventory-reads.test.ts', 'never returns another tenant'],
      [
        'test',
        'tests/backend/p1-21-inventory-intake.test.ts',
        'refuses a work order in a branch the caller is not scoped to',
      ],
      [
        'test',
        'tests/backend/p1-21-inventory-stock.test.ts',
        'refuses release from a branch the caller is not scoped to',
      ],
    ],
  ],
  [
    'P1-21-QA-004',
    'Concurrency and idempotency',
    [
      [
        'test',
        'tests/db/p1-21-inventory-integrity.test.ts',
        'leaves exactly one winner when two sessions race for the last unit',
      ],
      [
        'test',
        'tests/backend/p1-21-inventory-stock.test.ts',
        'replays an idempotency key without issuing twice',
      ],
      [
        'test',
        'tests/backend/p1-21-inventory-intake.test.ts',
        'replays an idempotency key instead of posting the movements twice',
      ],
      [
        'test',
        'tests/backend/p1-21-inventory-stock.test.ts',
        'refuses the same key with a different quantity',
      ],
    ],
  ],
  [
    'P1-21-QA-005',
    'Regression package',
    [['doc', 'docs/phase-1/phase-1-21/evidence/regression-package.md']],
  ],
  [
    'P1-21-DO-001',
    'Local CI command matrix and Temporary Local CI Primary Mode',
    [['doc', 'docs/phase-1/phase-1-21/evidence/local-ci-command-matrix.md']],
  ],
  [
    'P1-21-DO-002',
    'Clean-room runbook and structured logging',
    [['doc', 'docs/phase-1/phase-1-21/evidence/clean-room-runbook.md']],
  ],
  [
    'P1-21-DOC-001',
    'Contract, catalog, and traceability synchronization',
    [['doc', 'docs/phase-1/phase-1-21/wave-1-contract-archaeology.md']],
  ],
  [
    'P1-21-DOC-002',
    'Operator/developer guidance and change-log update',
    [['doc', 'docs/phase-1/phase-1-21/evidence/change-log.md']],
  ],
]);

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry === 'route.ts') out.push(full);
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
     * literal beats the real value. That is not hypothetical: the JSDoc on
     * `svc.service-list` explains why `scope: 'branch'` would fail closed, and the
     * generated inventory therefore reported that operation as `branch` while the route
     * declares `tenant` — contradicting the authorization map in the same commit and
     * falsifying the claim that these documents "cannot disagree with the code".
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

function main() {
  const check = process.argv.includes('--check');
  const failures = [];

  // ---- Inputs -------------------------------------------------------------
  const routeFiles = walk(API_ROOT);
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
  // emitted from a module this phase does not own (BE-013 writes from `work-order`).
  const allModuleSources = [];
  {
    const stack = [join(ROOT, 'src', 'modules')];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of readdirSync(current)) {
        const full = join(current, entry);
        if (statSync(full).isDirectory()) stack.push(full);
        else if (entry.endsWith('.ts')) allModuleSources.push([full, readFileSync(full, 'utf8')]);
      }
    }
  }

  const moduleSources = [];
  for (const name of PHASE_MODULES) {
    const dir = join(ROOT, 'src', 'modules', name);
    if (!existsSync(dir)) continue;
    const stack = [dir];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of readdirSync(current)) {
        const full = join(current, entry);
        if (statSync(full).isDirectory()) stack.push(full);
        else if (entry.endsWith('.ts')) moduleSources.push([full, readFileSync(full, 'utf8')]);
      }
    }
  }

  const permissionSeed = readFileSync(
    join(ROOT, 'supabase', 'seeds', '04_iam_permission_catalog.sql'),
    'utf8'
  );
  const auditCatalog = readFileSync(
    join(ROOT, 'src', 'server', 'auth', 'audit-actions.ts'),
    'utf8'
  );
  /**
   * The event catalog is read with its COMMENTS STRIPPED.
   *
   * Check 4 below matches `implementedIn:` inside a 400-character window after an
   * `eventType:`, and that window covers the entry's explanatory comment. On the raw
   * source the first match wins, so prose is indistinguishable from a field: a comment
   * saying `implementedIn: 'P1-21'` above a field that still says `null` would satisfy
   * the check while the catalog kept documenting an unproduced event — which is exactly
   * the class of defect check 4 exists to catch. `service.published` found this
   * concretely: the comment recording why the entry USED to read `implementedIn: null`
   * failed the check on an entry that had already been corrected.
   *
   * Stripping is the same treatment `parseOperations` and the audit-action scan already
   * give their sources; only this one read was raw.
   */
  const eventCatalog = stripComments(
    readFileSync(join(ROOT, 'src', 'server', 'events', 'envelope.ts'), 'utf8')
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
      `code:\\s*'${op.auditAction.replace(/\./g, '\\.')}',\\s*\\n\\s*class:\\s*'([a-z]+)'`
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

  // ---- 4. Published events are registered, owned, and marked implemented --
  const published = parsePublishedEvents(moduleSources);
  for (const event of published) {
    const owner = new RegExp(
      `eventType:\\s*'${event.eventType.replace(/\./g, '\\.')}',[\\s\\S]{0,400}?owner:\\s*'([^']+)'`
    ).exec(eventCatalog);
    if (owner === null) {
      failures.push(`${event.file}: publishes "${event.eventType}", which is not in EVENT_CATALOG`);
      continue;
    }
    const producerModule = (event.producer ?? '').split('.')[0];
    if (producerModule !== owner[1]) {
      failures.push(
        `${event.file}: producer "${event.producer}" publishes "${event.eventType}", which the ` +
          `catalog assigns to module "${owner[1]}"`
      );
    }
    const implemented = new RegExp(
      `eventType:\\s*'${event.eventType.replace(/\./g, '\\.')}',[\\s\\S]{0,400}?implementedIn:\\s*(null|'[^']+')`
    ).exec(eventCatalog);
    if (implemented !== null && implemented[1] === 'null') {
      failures.push(
        `${event.eventType} is published but the catalog still says implementedIn: null`
      );
    }
  }

  /**
   * ---- 5. A route that cites a quotation revision installs the port ---------
   *
   * `@/modules/quotation` installs `CommercialApprovalReader` at module scope, and
   * `@/modules/work-order` must not import it — that is the cycle the port exists to
   * break. So the installation can only happen in a ROUTE that loads both, and the
   * one route consuming the port did not load it: nothing else in `src/` imports the
   * quotation module, so whether the port existed depended on which endpoint a fresh
   * process happened to serve first.
   *
   * A comment cannot enforce a pairing. This can: any route mentioning
   * `quotationRevisionRef` must also import `@/modules/quotation`, so the next route
   * that cites a revision fails the build rather than shipping order-dependent.
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

  // ---- 6. Every task resolves to ARTIFACTS that exist ---------------------
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
  const publishedTypes = new Set(published.map((event) => event.eventType));
  /**
   * Which audit actions are actually EMITTED.
   *
   * Two false negatives had to be closed here, and both were found by this check failing
   * on actions that are genuinely produced:
   *
   *  - Scope. `quo.additional_work.quotation_linked` is appended from
   *    `src/modules/work-order`, which is not one of this phase's three modules. Every
   *    module is scanned, because which module emits an action is not something the phase
   *    boundary decides.
   *  - Ternaries. `quo.quotation.accepted`/`.rejected` are chosen by
   *    `action: outcome === 'accepted' ? … : …`, so a single-capture regex sees neither.
   *    The whole line is read and every dotted literal on it is collected — the same
   *    correction the event scanner already needed for the same reason.
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
   * `stripComments` understands `//` and `/* … *` + `/`, which is TypeScript and
   * JavaScript. Applying it to JSON or YAML would be actively wrong: the `//` inside any
   * `https://` URL would swallow the rest of that line and turn a present artifact into a
   * missing one. Those formats have no comment syntax this function should be guessing at,
   * and prose in them is not the hazard the stripping exists for.
   */
  const visibleText = (relativePath, source) =>
    /.(ts|mjs|js|tsx)$/.test(relativePath) ? stripComments(source) : source;

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
        // seeded code no operation asks for proves nothing about this phase.
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
        // In the controlled catalog AND emitted somewhere. "Declared" is not "produced" —
        // two P1-21 actions sat in the catalog with no producer at all.
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
        // The ONE documentary proof kind, for a task whose deliverable IS the document.
        // The exact file is named, so a mention elsewhere in `docs/` cannot satisfy it.
        const source = readIfPresent(first);
        if (source !== null && source.includes(id)) resolved.push(`${first} names ${id}`);
        else failures.push(`${id}: not named in ${first}, the artifact this task delivers`);
        continue;
      }
      failures.push(`${id}: unknown proof kind "${kind}"`);
    }
    anchors.set(id, resolved);
    if (resolved.length === 0) {
      failures.push(`${id}: no artifact proof resolved`);
    }
  }

  // ---- Documents ----------------------------------------------------------
  const inventory = [
    '# P1-21 endpoint inventory',
    '',
    '> GENERATED by `scripts/p1-21-endpoint-inventory.mjs`. Do not edit by hand —',
    '> `npm run validate:p1-21-inventory` regenerates it and CI fails on a stale copy.',
    '',
    `Operations: **${operations.length}**. Published events: **${new Set(published.map((e) => e.eventType)).size}**.`,
    '',
    '| Operation | Method | Path | Permissions | Scope | Audit | Idempotent | If-Match |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...operations.map(
      (op) =>
        `| \`${op.id}\` | ${op.method} | \`${op.path}\` | ${op.permissions
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
    '# P1-21 task traceability',
    '',
    '> GENERATED by `scripts/p1-21-endpoint-inventory.mjs`. Every one of the 27 task',
    '> identifiers must resolve to at least one anchor in the repository, or the gate',
    '> fails. P1-19 shipped with 13 of 33 identifiers greppable nowhere; this check',
    '> exists so that cannot recur.',
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
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : null;
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
  console.error(`✖ P1-21 inventory FAILED with ${result.failures.length} problem(s):`);
  for (const failure of result.failures) console.error(`    - ${failure}`);
  process.exit(1);
}

console.log(
  `OK P1-21 inventory: ${result.operations.length} operation(s); permissions, audit actions, ` +
    `events and all ${TASKS.length} task identifiers reconcile.`
);
