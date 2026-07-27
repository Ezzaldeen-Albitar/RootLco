/**
 * P1-20 endpoint inventory and catalog reconciliation (P1-20-QA-001, P1-20-DO-001,
 * P1-20-DOC-001).
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
 *   6. a P1-20 task names an ARTIFACT — operation, permission, audit action, event,
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
const EVIDENCE = join(ROOT, 'docs', 'phase-1', 'phase-1-20', 'evidence');
const OUTPUT = join(EVIDENCE, 'endpoint-inventory.md');
const TRACEABILITY = join(EVIDENCE, 'task-traceability.md');

/** The two schemas this phase delivers. Everything else belongs to a predecessor. */
const PHASE_PREFIXES = ['svc.', 'quo.'];

/** Modules this phase owns, for the producer/owner reconciliation. */
const PHASE_MODULES = ['service-catalog', 'pricing', 'quotation'];

/**
 * The canonical 27 task identifiers, each with the ARTIFACTS that prove it was done.
 *
 * ## Why this is not an identifier search
 *
 * Three versions of this gate searched the repository for the identifier itself, and all
 * three were vacuous, because the premise is unsatisfiable: `P1-20-BE-002` is a
 * project-management label, not a code symbol. It can only ever appear in a comment or a
 * string. So "the identifier appears in code" always reduced to "somebody wrote the
 * identifier in a comment", and the gate measured typing rather than work.
 *
 * The failures were instructive. v1 counted the gate's own generated documents, so all 27
 * resolved the moment the file was written. v2 excluded those two documents, and five
 * identifiers then resolved to `task-register.md`, which prints all 27 in its tables — so
 * deleting every P1-20 source file would still have reported 27/27. v3 stopped searching
 * `docs/` entirely, and an independent review found the remaining hole: comments were not
 * stripped from the haystack, `.md` files under `src/`/`tests/`/`scripts/` were searched,
 * and `P1-20-DO-001` and `P1-20-DOC-001` resolved solely to this script's own header
 * comment. Same shape, third time.
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
    'P1-20-BE-001',
    'Service management',
    [
      ['operation', 'svc.service-list'],
      // The MUTATION half. It is named here rather than left implicit because for most
      // of the phase this task's proofs were the read surface alone, and the gate said
      // 27/27 while the protected contract's "Manage a service catalog" and "Publish a
      // service version" rows had no implementation at all (P1-20-G-01). A proof set
      // that a missing deliverable can satisfy is not a proof set.
      ['operation', 'svc.service-create'],
      ['operation', 'svc.service-update'],
      ['operation', 'svc.service-version-publish'],
      ['permission', 'svc.service.read'],
      ['permission', 'svc.service.manage'],
      ['audit', 'svc.service.updated'],
      ['audit', 'svc.service_version.published'],
      ['event', 'service.published'],
      ['symbol', 'src/modules/service-catalog/index.ts', 'serviceCatalogModule'],
      [
        'symbol',
        'src/modules/service-catalog/application/service-catalog-write-service.ts',
        'ServiceCatalogWriteService',
      ],
      // `publishServiceVersion` is the CALL into the protected function. Naming the
      // repository method is what stops a future reimplementation of succession from
      // satisfying this task.
      [
        'symbol',
        'src/modules/service-catalog/data/service-catalog-repository.ts',
        'publishServiceVersion',
      ],
      ['test', 'tests/backend/p1-20-service-catalog.test.ts', 'svc.service-list'],
      ['test', 'tests/backend/p1-20-service-catalog.test.ts', 'archived as terminal'],
      [
        'test',
        'tests/backend/p1-20-service-catalog.test.ts',
        'refuses serviceCode with a 422 rather than silently discarding it',
      ],
      [
        'test',
        'tests/backend/p1-20-service-catalog.test.ts',
        'closes the prior version at the new boundary',
      ],
    ],
  ],
  [
    'P1-20-BE-002',
    'Branch service availability',
    [
      ['operation', 'svc.branch-availability-set'],
      ['audit', 'svc.branch_availability.changed'],
      [
        'symbol',
        'src/modules/service-catalog/data/service-catalog-repository.ts',
        'findAvailability',
      ],
      [
        'symbol',
        'src/modules/service-catalog/data/service-catalog-repository.ts',
        'branchBelongsToCompany',
      ],
      [
        'symbol',
        'src/modules/service-catalog/application/service-catalog-service.ts',
        'isSellableAt',
      ],
      ['test', 'tests/backend/p1-20-service-catalog.test.ts', 'branch filter'],
      // The isolation case, named explicitly: this is the one catalog write with real
      // scope columns, so it is the one place a scope-blind implementation is a live
      // risk rather than a theoretical one.
      [
        'test',
        'tests/backend/p1-20-service-catalog.test.ts',
        'isolation: refuses branch A1 for a principal holding svc.service.manage IN FULL in A2',
      ],
    ],
  ],
  [
    'P1-20-BE-003',
    'Standard labour time',
    [
      [
        'symbol',
        'src/modules/service-catalog/data/service-catalog-repository.ts',
        'listLaborTimes',
      ],
      ['symbol', 'src/modules/pricing/domain/decimal.ts', 'MINUTES'],
    ],
  ],
  [
    'P1-20-BE-004',
    'Price-list selection',
    [
      ['operation', 'svc.price-resolve'],
      ['operation', 'svc.price-list-version-publish'],
      ['permission', 'svc.price.publish'],
      ['symbol', 'src/modules/pricing/application/price-resolution-service.ts', 'resolve'],
      ['test', 'tests/backend/p1-20-pricing.test.ts', 'resolves a published price'],
    ],
  ],
  [
    'P1-20-BE-005',
    'Tax calculation',
    [
      ['symbol', 'src/modules/pricing/data/pricing-repository.ts', 'findTaxRate'],
      ['test', 'tests/backend/p1-20-pricing.test.ts', 'NO effective rate'],
    ],
  ],
  [
    'P1-20-BE-006',
    'Discount authorization',
    [
      ['symbol', 'src/modules/pricing/application/discount-authorization-service.ts', 'authorize'],
      ['audit', 'svc.discount.authorized'],
      ['test', 'tests/backend/p1-20-quotation.test.ts', 'splitting defeats neither'],
      ['test', 'tests/unit/p1-20-discount-authorization.test.ts', 'maker'],
    ],
  ],
  [
    'P1-20-BE-007',
    'Quotation creation/versioning/sending',
    [
      ['operation', 'quo.quotation-create'],
      ['operation', 'quo.quotation-issue'],
      ['event', 'quotation.revision-issued'],
      ['permission', 'quo.quotation.manage'],
      ['test', 'tests/backend/p1-20-quotation.test.ts', 'issues, freezes totals'],
    ],
  ],
  [
    'P1-20-BE-008',
    'Approval',
    [
      ['operation', 'quo.quotation-item-decide'],
      ['operation', 'quo.quotation-revision-decide'],
      ['audit', 'quo.quotation.accepted'],
      ['permission', 'quo.decision.record'],
      ['test', 'tests/backend/p1-20-quotation.test.ts', 'rolls the quotation up to accepted'],
    ],
  ],
  [
    'P1-20-BE-009',
    'Rejection',
    [
      ['audit', 'quo.quotation.rejected'],
      ['event', 'quotation.rejected'],
      ['test', 'tests/backend/p1-20-quotation.test.ts', 'one rejected line'],
    ],
  ],
  [
    'P1-20-BE-010',
    'Expiration',
    [
      ['symbol', 'src/modules/quotation/application/quotation-service.ts', 'expireLapsed'],
      ['symbol', 'src/modules/quotation/data/quotation-repository.ts', 'serverNow'],
      ['audit', 'quo.quotation.expired'],
      ['test', 'tests/backend/p1-20-quotation.test.ts', 'NEVER expires a quotation'],
    ],
  ],
  [
    'P1-20-BE-011',
    'Revision',
    [
      ['operation', 'quo.quotation-revision-create'],
      ['audit', 'quo.quotation_revision.created'],
      ['test', 'tests/backend/p1-20-quotation.test.ts', 'leaves an ISSUED revision unchanged'],
    ],
  ],
  [
    'P1-20-BE-012',
    'Approval evidence',
    [
      [
        'test',
        'tests/backend/p1-20-quotation.test.ts',
        'refuses a version linked to ANOTHER quotation and accepts the one linked to this',
      ],
      ['test', 'tests/backend/p1-20-quotation.test.ts', 'rejects a direct storage key'],
      // The link check itself and the write it gates. Anchored because both were the
      // gap: the refusal test used to die on a 404 before the link check ran, and
      // `insertEvidence` had no execution anywhere in the phase.
      [
        'symbol',
        'src/modules/shared-services/application/attachment-service.ts',
        'verifyEvidenceVersion',
      ],
      ['symbol', 'src/modules/quotation/data/quotation-repository.ts', 'insertEvidence'],
      // The fixture that makes the refusal falsifiable: two REAL versions differing
      // only in the entity their live link names.
      ['symbol', 'tests/backend/p1-20-helpers.ts', 'seedLinkedDocumentVersion'],
    ],
  ],
  [
    'P1-20-BE-013',
    'Additional-work quotation',
    [
      ['symbol', 'src/server/contracts/commercial-approval.ts', 'CommercialApprovalReader'],
      [
        'symbol',
        'src/modules/work-order/application/additional-work-service.ts',
        'assertLinkableQuotationRevision',
      ],
      ['audit', 'quo.additional_work.quotation_linked'],
      ['test', 'tests/backend/p1-20-additional-work-link.test.ts', 'links an ACCEPTED revision'],
    ],
  ],
  [
    'P1-20-BE-014',
    'NUMERIC/DECIMAL financial source of truth',
    [
      ['symbol', 'src/modules/pricing/domain/decimal.ts', 'Decimal'],
      ['symbol', 'src/modules/pricing/domain/money.ts', 'Money'],
      ['test', 'tests/unit/p1-20-decimal.test.ts', 'no binary floating-point drift'],
      ['test', 'tests/unit/p1-20-decimal.test.ts', 'numeric type parser is not overridden'],
    ],
  ],
  [
    'P1-20-SEC-001',
    'Permission and resolved-scope enforcement',
    [
      ['symbol', 'src/server/auth/authorization.ts', 'callerHoldsPermissionTenantWide'],
      ['test', 'tests/backend/p1-20-pricing.test.ts', 'need an unrestricted grant'],
      ['test', 'tests/backend/p1-20-quotation.test.ts', 'tenant, scope and idempotency floors'],
    ],
  ],
  [
    'P1-20-SEC-002',
    'Sensitive-data, export, and file-access controls',
    [
      [
        'test',
        'tests/backend/p1-20-service-catalog.test.ts',
        'no amount, currency, or price-rule field',
      ],
      ['test', 'tests/backend/p1-20-quotation.test.ts', 'never JSON numbers'],
    ],
  ],
  [
    'P1-20-SEC-003',
    'Abuse-case and privilege-escalation controls',
    [
      ['test', 'tests/backend/p1-20-pricing.test.ts', 'refuses a WILDCARD price rule'],
      ['test', 'tests/backend/p1-20-pricing.test.ts', 'callerApprovalCeiling respects grant scope'],
      ['test', 'tests/backend/p1-20-quotation.test.ts', 'REJECTS a client-supplied price'],
    ],
  ],
  [
    'P1-20-SEC-004',
    'Security audit-event coverage',
    [
      ['audit', 'svc.price_rule.recorded'],
      ['audit', 'quo.quotation_revision.issued'],
      ['test', 'tests/backend/p1-20-quotation.test.ts', 'audits WHY an elevated discount'],
    ],
  ],
  [
    'P1-20-QA-001',
    'Unit and component test coverage',
    [
      ['test', 'tests/unit/p1-20-decimal.test.ts', 'protected column specs'],
      [
        'test',
        'tests/unit/p1-20-discount-authorization.test.ts',
        'percentage thresholds are exact',
      ],
    ],
  ],
  [
    'P1-20-QA-002',
    'API/contract and error-path coverage',
    [
      ['test', 'tests/backend/p1-20-pricing.test.ts', 'unknown query parameter'],
      ['test', 'tests/backend/p1-20-quotation.test.ts', '404s an unknown quotation'],
    ],
  ],
  [
    'P1-20-QA-003',
    'Tenant/company/branch isolation coverage',
    [
      ['test', 'tests/backend/p1-20-pricing.test.ts', 'never resolves a tenant-A price'],
      ['test', 'tests/backend/p1-20-quotation.test.ts', 'never lets a tenant-B caller'],
      ['test', 'tests/backend/p1-20-service-catalog.test.ts', 'UNRELATED permission'],
    ],
  ],
  [
    'P1-20-QA-004',
    'Concurrency and idempotency coverage',
    [
      ['test', 'tests/backend/p1-20-quotation.test.ts', 'forced RACE'],
      ['test', 'tests/backend/p1-20-pricing.test.ts', 'forced race'],
      ['test', 'tests/backend/p1-20-quotation.test.ts', 'refuses no key'],
      // A missing-key refusal proves only that the header is mandatory. These three
      // are the replay half — the same key twice, one execution — one per suite that
      // carries an idempotent write.
      ['test', 'tests/backend/p1-20-quotation.test.ts', 'an Idempotency-Key replay executes once'],
      ['test', 'tests/backend/p1-20-pricing.test.ts', 'an Idempotency-Key replay executes once'],
      [
        'test',
        'tests/backend/p1-20-service-catalog.test.ts',
        'an Idempotency-Key replay executes once',
      ],
    ],
  ],
  [
    'P1-20-QA-005',
    'Regression and evidence packaging',
    [
      ['symbol', 'tests/backend/p1-19-labor-sessions.test.ts', 'correctionWindow'],
      [
        'test',
        'tests/backend/p1-20-additional-work-link.test.ts',
        'CommercialApprovalReader installation',
      ],
    ],
  ],
  [
    'P1-20-DO-001',
    'Continuous-integration quality gate',
    [
      // Exact forms, so a rename fails rather than passing on a shared prefix: the
      // npm script key as declared, and the CI invocation as written.
      ['symbol', 'package.json', '"validate:p1-20-inventory":'],
      ['symbol', '.github/workflows/ci.yml', 'run validate:p1-20-inventory'],
    ],
  ],
  [
    'P1-20-DO-002',
    'Structured logging, monitoring, and alert routing',
    [
      ['symbol', 'src/modules/quotation/application/quotation-service.ts', 'expireLapsed'],
      ['doc', 'docs/phase-1/phase-1-20/evidence/devops-observability.md'],
    ],
  ],
  [
    'P1-20-DOC-001',
    'Contract, catalog, and traceability synchronization',
    [
      ['symbol', 'scripts/p1-20-endpoint-inventory.mjs', 'TRACEABILITY'],
      ['symbol', 'tests/openapi-contract.test.ts', 'quotation-revisions'],
    ],
  ],
  [
    'P1-20-DOC-002',
    'Operator/developer guidance and change-log update',
    [['doc', 'docs/phase-1/phase-1-20/evidence/change-log.md']],
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
   * saying `implementedIn: 'P1-20'` above a field that still says `null` would satisfy
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
        // two P1-20 actions sat in the catalog with no producer at all.
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
    '# P1-20 endpoint inventory',
    '',
    '> GENERATED by `scripts/p1-20-endpoint-inventory.mjs`. Do not edit by hand —',
    '> `npm run validate:p1-20-inventory` regenerates it and CI fails on a stale copy.',
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
    '# P1-20 task traceability',
    '',
    '> GENERATED by `scripts/p1-20-endpoint-inventory.mjs`. Every one of the 27 task',
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
  console.error(`✖ P1-20 inventory FAILED with ${result.failures.length} problem(s):`);
  for (const failure of result.failures) console.error(`    - ${failure}`);
  process.exit(1);
}

console.log(
  `OK P1-20 inventory: ${result.operations.length} operation(s); permissions, audit actions, ` +
    `events and all ${TASKS.length} task identifiers reconcile.`
);
