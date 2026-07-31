/**
 * P1-23 endpoint inventory and catalog reconciliation (P1-23-QA-004, P1-23-DO-001,
 * P1-23-DOC-001).
 *
 * Derives this phase's public surface from the operation registry rather than from a
 * hand-kept list, and reconciles every declared permission and audit action against the
 * committed catalogs. A hand-written inventory documents what its author remembered;
 * this one cannot disagree with the code, because the code is its only input.
 *
 * Run with `--check` in CI. It exits non-zero when:
 *
 *   1. a declared permission code is not in the IAM permission seed;
 *   2. a declared audit action is not in the controlled audit-action catalog;
 *   3. an operation declares `scope: 'branch'` but its handler enforces no scope;
 *   4. a phase operation is served by a module this phase does not own;
 *   5. a P1-23 task names an ARTIFACT that does not exist, or names none at all;
 *   6. this phase claims an operation the phase baseline already had (see check 6);
 *   7. the generated documents are stale.
 *
 * The reconciliation direction is code -> catalog, deliberately. Catalog -> code would
 * be wrong in general: the seeds carry codes for phases not yet implemented, and a phase
 * is not obliged to consume all of them. "Every code this phase DECLARES must exist" is
 * the honest direction.
 *
 * ## Why the scope guard strips comments first
 *
 * P1-19 learned this the hard way: the first version of the equivalent guard was
 * satisfied by the COMMENT explaining the fix rather than by the fix. Comments are
 * removed before a handler is searched, so a claim in prose cannot satisfy a structural
 * check. The same stripping applies to `symbol` and `test` proofs below.
 *
 * ## What P1-23 changed from the P1-22 original, and why
 *
 * P1-22 delivered twenty operations across four modules it OWNED OUTRIGHT. P1-23 is a
 * different shape, and copying the P1-22 checks unexamined would have produced a gate
 * that reports success while measuring the wrong set:
 *
 *   - **This phase SHARES a module with an earlier phase.** `shared-services` was built
 *     by P1-15 and already contains twenty-one `shared.` operations. A check of the form
 *     "every `shared.` operation belongs to this phase" would sweep all of P1-15 into
 *     P1-23's inventory and report a surface four times its real size. So the phase set
 *     is an EXPLICIT ALLOWLIST (`PHASE_OPERATIONS`) rather than a prefix scan, and
 *     check 6 asserts that allowlist against the PINNED PHASE BASELINE: an operation
 *     this phase claims must genuinely be absent from the tree the phase started
 *     from. That check is what makes the allowlist honest rather than merely
 *     asserted; without it, adding a P1-15 id to the list below would inflate the
 *     count and nothing would object.
 *
 *     It is pinned to a SHA and not to `origin/develop` for a reason paid for once
 *     already — see `BASE_REF`. It also SKIPS, loudly, when the baseline commit is
 *     not present (a shallow CI checkout), and a skip is reported as a skip rather
 *     than counted as a pass.
 *
 *   - **No events, so no event checks.** P1-22 had checks 5 and 6 for `EVENT_CATALOG`.
 *     P1-23 publishes no event: every operation is a read, and the one audited operation
 *     records an inspection, not a state change. Rather than keep dead checks that can
 *     never fire (and would read as coverage), they are removed and their absence is
 *     stated here. `assertNoPhaseEvents` replaces them: it FAILS if a P1-23 operation
 *     ever starts publishing one, so the claim is enforced rather than assumed.
 *
 *   - **Two audit actions, both on reads.** That is unusual enough to be worth pinning:
 *     `shared.notification.delivery_inspected` and
 *     `shared.document.retention_evaluated` exist because looking at delivery detail and
 *     evaluating disposal are both privileged inspections. Check 2 reconciles them
 *     against the controlled catalog like any other.
 *
 * ## What `doc` can and cannot prove — stated honestly
 *
 * `doc` IS satisfiable by prose: the check is that an identifier appears in one named
 * file. It is inherited from P1-21/P1-22 with the same caveat rather than quietly
 * dropped. Every task below that carries a `doc` proof also carries a structural proof
 * (`operation`, `symbol` or `test`) alongside it, so no task in this phase rests on
 * prose alone. That is a stronger position than P1-22 shipped with, where three tasks
 * did.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_ROOT = join(ROOT, 'src', 'app', 'api', 'v1');
const EVIDENCE = join(ROOT, 'docs', 'phase-1', 'phase-1-23', 'evidence');
const OUTPUT = join(EVIDENCE, 'endpoint-inventory.md');
const TRACEABILITY = join(EVIDENCE, 'task-traceability.md');

const PHASE_LABEL = 'P1-23';

/** The modules that serve this phase. `shared-services` is SHARED with P1-15. */
const PHASE_MODULES = ['shared-services', 'reporting'];

/**
 * The operations this phase adds — an explicit allowlist, not a prefix scan, because
 * `shared.` is shared with P1-15. Check 6 proves every entry is genuinely new by
 * diffing against the pinned phase baseline, so this list cannot quietly absorb an
 * older phase's work.
 */
const PHASE_OPERATIONS = Object.freeze([
  'shared.notification-list',
  'shared.notification-read',
  'shared.notification-delivery-list',
  'shared.document-read',
  'shared.document-retention-evaluate',
  'rpt.report-catalogue',
  'rpt.report-read',
]);

/**
 * The commit check 6 measures novelty against — the PHASE BASELINE, pinned.
 *
 * It used to be `origin/develop`, and that was a design defect a green pull
 * request could never expose: while the phase was in review, `origin/develop`
 * WAS the baseline, so the check passed. The moment the feature merged, the
 * seven operations existed on `origin/develop` and the check reported all seven
 * as "an earlier phase's operation" — the gate destroyed itself on the first
 * push to the branch it was protecting.
 *
 * A moving ref was the wrong thing to compare against. The claim worth enforcing
 * is permanent: these operations were ABSENT FROM THE TREE THIS PHASE STARTED
 * FROM. `9f7ef083` is that tree (P1_23_BASE_SHA, recorded in the execution
 * checkpoint), and it never moves, so the check keeps its meaning on the feature
 * branch, on develop, and on main alike.
 */
const BASE_REF = process.env.P1_23_BASE_REF ?? '9f7ef083ba90be3343aec2be1c721e3826070946';

/**
 * The canonical 27 task identifiers, each with the ARTIFACTS that prove it was done.
 *
 * A task with an EMPTY proof array is reported as declaring nothing and the gate exits
 * non-zero. An empty list is not a pass.
 *
 * Proof kinds:
 *   - `operation`  a registered operation id, read from the route tree
 *   - `permission` a permission code that is seeded AND declared by some operation
 *   - `audit`      an audit action in the controlled catalog with a real producer
 *   - `symbol`     an exported symbol in a named source file, comments stripped
 *   - `test`       a test title substring in a named test file, comments stripped
 *   - `doc`        a named identifier in one named document
 *   - `ci`         an npm script name that a workflow runs AND package.json maps
 *                  to the named file — both links, because either alone passes
 *                  while the chain is broken
 *
 * A comment cannot register an operation, seed a permission, produce an audit action or
 * export a symbol, and `test` strips comments before searching so a JSDoc quoting a test
 * title does not count either.
 */
const TASKS = Object.freeze([
  // ---- Backend (14) --------------------------------------------------------
  [
    'P1-23-BE-001',
    'Notification read repository',
    [
      [
        'symbol',
        'src/modules/shared-services/data/notification-read-repository.ts',
        'NotificationReadRepository',
      ],
      [
        'symbol',
        'src/modules/shared-services/data/notification-read-repository.ts',
        'NOTIFICATION_ORDERING',
      ],
    ],
  ],
  [
    'P1-23-BE-002',
    'Notification inbox listing',
    [
      ['operation', 'shared.notification-list'],
      ['permission', 'shared.notification.read'],
      [
        'symbol',
        'src/modules/shared-services/application/notification-read-service.ts',
        'listMine',
      ],
      [
        'test',
        'tests/backend/p1-23-notification-reads.test.ts',
        'invokes shared.notification-list',
      ],
    ],
  ],
  [
    'P1-23-BE-003',
    'Notification single read',
    [
      ['operation', 'shared.notification-read'],
      [
        'symbol',
        'src/modules/shared-services/application/notification-read-service.ts',
        'readMine',
      ],
    ],
  ],
  [
    'P1-23-BE-004',
    'Recipient confinement on notification reads',
    [
      [
        'test',
        'tests/backend/p1-23-notification-reads.test.ts',
        'does not return a message addressed to another user in the SAME tenant',
      ],
    ],
  ],
  [
    'P1-23-BE-005',
    'Delivery attempt inspection',
    [
      ['operation', 'shared.notification-delivery-list'],
      ['permission', 'shared.notification.delivery.read'],
      ['audit', 'shared.notification.delivery_inspected'],
      [
        'symbol',
        'src/modules/shared-services/application/notification-read-service.ts',
        'readDeliveries',
      ],
    ],
  ],
  [
    'P1-23-BE-006',
    'Delivery projection excludes message body and recipient digest',
    [
      [
        'test',
        'tests/backend/p1-23-notification-reads.test.ts',
        'never projects the recipient digest or the body digest',
      ],
    ],
  ],
  [
    'P1-23-BE-007',
    'Document metadata read repository',
    [
      [
        'symbol',
        'src/modules/shared-services/data/document-read-repository.ts',
        'DocumentReadRepository',
      ],
    ],
  ],
  [
    'P1-23-BE-008',
    'Document metadata read operation',
    [
      ['operation', 'shared.document-read'],
      ['permission', 'shared.document.manage'],
      ['test', 'tests/backend/p1-23-document-retention.test.ts', 'invokes shared.document-read'],
    ],
  ],
  [
    'P1-23-BE-009',
    'Storage key never projected',
    [
      [
        'test',
        'tests/backend/p1-23-document-retention.test.ts',
        'projects exactly the approved field set and nothing else',
      ],
    ],
  ],
  [
    'P1-23-BE-010',
    'Retention evaluation delegated to the protected function',
    [
      ['operation', 'shared.document-retention-evaluate'],
      ['permission', 'shared.document.archive'],
      ['audit', 'shared.document.retention_evaluated'],
      [
        'symbol',
        'src/modules/shared-services/application/document-read-service.ts',
        'evaluateRetention',
      ],
    ],
  ],
  [
    'P1-23-BE-011',
    'Retention evaluation destroys nothing',
    [
      ['test', 'tests/backend/p1-23-document-retention.test.ts', 'never reports a deletion'],
      [
        'test',
        'tests/backend/p1-23-document-retention.test.ts',
        'reports the verdict the class data implies',
      ],
      [
        'test',
        'tests/backend/p1-23-document-retention.test.ts',
        'treats an archived document as decisive',
      ],
    ],
  ],
  [
    'P1-23-BE-012',
    'Reporting module foundation',
    [
      ['symbol', 'src/modules/reporting/index.ts', 'reportingModule'],
      [
        'symbol',
        'src/modules/reporting/data/report-catalogue-repository.ts',
        'ReportCatalogueRepository',
      ],
    ],
  ],
  [
    'P1-23-BE-013',
    'Report catalogue listing',
    [
      ['operation', 'rpt.report-catalogue'],
      ['permission', 'rpt.report.read'],
      ['symbol', 'src/modules/reporting/application/report-catalogue-service.ts', 'listPublished'],
    ],
  ],
  [
    'P1-23-BE-014',
    'Report definition read',
    [
      ['operation', 'rpt.report-read'],
      ['symbol', 'src/modules/reporting/application/report-catalogue-service.ts', 'readByCode'],
    ],
  ],

  // ---- Security (4) --------------------------------------------------------
  [
    'P1-23-SE-001',
    'Every phase operation refuses an unpermitted principal',
    [
      [
        'test',
        'tests/backend/p1-23-notification-reads.test.ts',
        'refuses each operation for a principal holding none of its permissions',
      ],
      [
        'test',
        'tests/backend/p1-23-document-retention.test.ts',
        'refuses both operations for a principal holding none of their permissions',
      ],
      [
        'test',
        'tests/backend/p1-23-reporting.test.ts',
        'refuses both operations for a principal holding none of their permissions',
      ],
    ],
  ],
  [
    'P1-23-SE-002',
    'Retention evaluation is guarded by archive, not by read',
    [
      [
        'test',
        'tests/backend/p1-23-document-retention.test.ts',
        'guards retention evaluation with the archive permission, not the read permission',
      ],
    ],
  ],
  [
    'P1-23-SE-003',
    'View permission is not export permission',
    [
      [
        'test',
        'tests/backend/p1-23-reporting.test.ts',
        'keeps view permission distinct from the per-report export permission',
      ],
    ],
  ],
  [
    'P1-23-SE-004',
    'Cross-tenant refusal on every phase read',
    [
      [
        'test',
        'tests/backend/p1-23-document-retention.test.ts',
        'refuses a document belonging to another tenant',
      ],
      ['test', 'tests/backend/p1-23-reporting.test.ts', 'does not list another tenant catalogue'],
    ],
  ],

  // ---- QA (5) --------------------------------------------------------------
  [
    'P1-23-QA-001',
    'Notification read evidence suite',
    [['test', 'tests/backend/p1-23-notification-reads.test.ts', 'shared.notification-list']],
  ],
  [
    'P1-23-QA-002',
    'Document and retention evidence suite',
    [['test', 'tests/backend/p1-23-document-retention.test.ts', 'evaluates, never destroys']],
  ],
  [
    'P1-23-QA-003',
    'Reporting evidence suite',
    [['test', 'tests/backend/p1-23-reporting.test.ts', 'rpt.report-catalogue']],
  ],
  [
    'P1-23-QA-004',
    'Operation-coverage gate extended to the rpt namespace',
    [
      ['symbol', 'scripts/check-operation-test-coverage.mjs', 'P1_23_PREFIXES'],
      ['test', 'tests/foundation/operation-coverage-gate.test.ts', 'P1-23'],
      ['doc', 'docs/phase-1/phase-1-23/execution-checkpoint.md', 'P1_23_PREFIXES'],
    ],
  ],
  [
    // The canonical task register is 27 (Backend 14, Security 4, QA 5, DevOps 2,
    // Documentation 2). The hostile mutation matrix belongs to THIS task rather
    // than a 28th: inventing a task id would change a total the phase mandate
    // fixes, and the matrix is the evidence that QA-005's assertions are real
    // rather than a separate deliverable.
    'P1-23-QA-005',
    'Retention ladder asserted in precedence order, proven by mutation',
    [
      [
        'test',
        'tests/backend/p1-23-document-retention.test.ts',
        'honours a legal-hold RECORD, not only the flag',
      ],
      [
        'test',
        'tests/backend/p1-23-document-retention.test.ts',
        'lets an active link block a document whose retention has already elapsed',
      ],
      ['symbol', 'scripts/p1-23-mutation-matrix.mjs', 'MUTATIONS'],
      ['symbol', 'scripts/p1-23-mutation-matrix.mjs', 'SURVIVED'],
      ['ci', 'validate:p1-23-mutations', 'scripts/p1-23-mutation-matrix.mjs'],
    ],
  ],

  // ---- DevOps (2) ----------------------------------------------------------
  [
    'P1-23-DO-001',
    'Phase inventory gate',
    [
      ['symbol', 'scripts/p1-23-endpoint-inventory.mjs', 'PHASE_OPERATIONS'],
      ['doc', 'docs/phase-1/phase-1-23/evidence/endpoint-inventory.md', 'rpt.report-catalogue'],
    ],
  ],
  [
    'P1-23-DO-002',
    'Phase inventory gate wired into CI',
    [
      ['ci', 'validate:p1-23-inventory', 'scripts/p1-23-endpoint-inventory.mjs'],
      ['symbol', 'scripts/p1-23-endpoint-inventory.mjs', 'assertNoPhaseEvents'],
    ],
  ],

  // ---- Documentation (2) ---------------------------------------------------
  [
    'P1-23-DOC-001',
    'Contract archaeology',
    [
      [
        'doc',
        'docs/phase-1/phase-1-23/contract-archaeology.md',
        'shared.document_deletion_eligibility',
      ],
      ['operation', 'shared.document-retention-evaluate'],
    ],
  ],
  [
    'P1-23-DOC-002',
    'Report execution limitation recorded',
    [
      ['doc', 'docs/phase-1/phase-1-23/contract-archaeology.md', 'executable'],
      ['symbol', 'src/modules/reporting/application/report-catalogue-service.ts', 'executable'],
    ],
  ],
]);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const failures = [];
const fail = (check, message) => failures.push(`[check ${check}] ${message}`);

const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const readIf = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// parse the route tree
// ---------------------------------------------------------------------------
const routeFiles = walk(API_ROOT);
/** @type {Map<string, {id:string,module:string,scope:string,permissions:string[],audit:string|null,file:string,chunk:string,source:string}>} */
const operations = new Map();

for (const file of routeFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/defineOperation\(\{[\s\S]*?\n\}\);/g)) {
    const chunk = match[0];
    const id = (chunk.match(/id:\s*'([^']+)'/) ?? [])[1];
    if (!id) continue;
    const permissions = [
      ...(chunk.match(/permissions:\s*\[([^\]]*)\]/) ?? ['', ''])[1].matchAll(/'([^']+)'/g),
    ].map((m) => m[1]);
    operations.set(id, {
      id,
      module: (chunk.match(/module:\s*'([^']+)'/) ?? [])[1] ?? '',
      scope: (chunk.match(/scope:\s*'([^']+)'/) ?? [])[1] ?? '',
      permissions,
      audit: (chunk.match(/auditAction:\s*'([^']+)'/) ?? [])[1] ?? null,
      file: relative(ROOT, file).split('\\').join('/'),
      chunk,
      source,
    });
  }
}

const phaseOps = PHASE_OPERATIONS.map((id) => {
  const op = operations.get(id);
  if (!op) fail(0, `operation ${id} is listed in PHASE_OPERATIONS but is not registered`);
  return op;
}).filter(Boolean);

// ---------------------------------------------------------------------------
// check 1 — declared permissions are seeded
// ---------------------------------------------------------------------------
const seedText = (() => {
  const candidates = [
    join(ROOT, 'supabase', 'seed.sql'),
    ...walk_sql(join(ROOT, 'supabase', 'seeds')),
    ...walk_sql(join(ROOT, 'supabase', 'migrations')),
  ];
  return candidates.map((p) => readIf(p) ?? '').join('\n');
})();

function walk_sql(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => join(dir, f));
}

const declaredPermissions = new Set(phaseOps.flatMap((op) => op.permissions));
for (const code of [...declaredPermissions].sort()) {
  if (!seedText.includes(`'${code}'`)) {
    fail(1, `permission ${code} is declared by a P1-23 operation but is not seeded`);
  }
}

// ---------------------------------------------------------------------------
// check 2 — declared audit actions are in the controlled catalog
// ---------------------------------------------------------------------------
const auditCatalog = readIf(join(ROOT, 'src', 'server', 'auth', 'audit-actions.ts')) ?? '';
const declaredAudits = phaseOps.map((op) => op.audit).filter(Boolean);
for (const action of declaredAudits) {
  if (!stripComments(auditCatalog).includes(`'${action}'`)) {
    fail(2, `audit action ${action} is declared but is not in the controlled catalog`);
  }
}

// ---------------------------------------------------------------------------
// check 3 — a branch-scoped operation must actually enforce scope
// ---------------------------------------------------------------------------
for (const op of phaseOps) {
  if (op.scope !== 'branch') continue;
  const body = stripComments(op.source);
  if (!/branchId/.test(body)) {
    fail(3, `${op.id} declares scope 'branch' but its handler never mentions branchId`);
  }
}

// ---------------------------------------------------------------------------
// check 4 — every phase operation is served by a module this phase owns
// ---------------------------------------------------------------------------
for (const dir of PHASE_MODULES) {
  if (!existsSync(join(ROOT, 'src', 'modules', dir))) {
    fail(4, `PHASE_MODULES names src/modules/${dir}, which does not exist`);
  }
}
for (const op of phaseOps) {
  if (!PHASE_MODULES.includes(op.module)) {
    fail(4, `${op.id} declares module '${op.module}', which P1-23 does not own`);
  }
}

// ---------------------------------------------------------------------------
// check 6 — every claimed operation is genuinely NEW versus the base branch
//
// This is what keeps PHASE_OPERATIONS honest. `shared-services` is shared with
// P1-15, so without this an older phase's operation could be added to the list
// and inflate this phase's reported surface with nothing to object.
// ---------------------------------------------------------------------------
function baseOperationIds() {
  try {
    const listing = execFileSync(
      'git',
      ['ls-tree', '-r', '--name-only', BASE_REF, 'src/app/api/v1'],
      {
        encoding: 'utf8',
        cwd: ROOT,
      }
    )
      .split('\n')
      .filter((f) => f.endsWith('route.ts'));
    const ids = new Set();
    for (const f of listing) {
      let text = '';
      try {
        text = execFileSync('git', ['show', `${BASE_REF}:${f}`], {
          encoding: 'utf8',
          cwd: ROOT,
          maxBuffer: 1e8,
        });
      } catch {
        continue;
      }
      for (const m of text.matchAll(/id:\s*'([a-z]+\.[a-z0-9-]+)'/g)) ids.add(m[1]);
    }
    return ids;
  } catch {
    return null;
  }
}

const baseIds = baseOperationIds();
if (baseIds === null) {
  // Not a failure: a shallow CI checkout legitimately does not contain the phase
  // baseline commit. Silence would be wrong, so this SAYS it was skipped rather
  // than letting a check that did not run read as one that passed. The check is
  // therefore only meaningful where full history exists -- locally, and in any job
  // that checks out with fetch-depth 0.
  console.log(
    `  NOTE: baseline ${BASE_REF.slice(0, 12)} not present in this checkout; novelty check 6 SKIPPED (not passed)`
  );
} else {
  for (const id of PHASE_OPERATIONS) {
    if (baseIds.has(id)) {
      fail(
        6,
        `${id} already exists on ${BASE_REF}; P1-23 must not claim an earlier phase's operation`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// this phase publishes no event — enforced, not assumed
// ---------------------------------------------------------------------------
export function assertNoPhaseEvents() {
  for (const op of phaseOps) {
    if (/publish(Event)?\s*\(/.test(stripComments(op.source))) {
      fail(
        'events',
        `${op.id} publishes an event; P1-23 is read-only and its gate has no event reconciliation`
      );
    }
  }
}
assertNoPhaseEvents();

// ---------------------------------------------------------------------------
// check 5 — task artifact proofs
// ---------------------------------------------------------------------------
const seededOrDeclared = (code) =>
  seedText.includes(`'${code}'`) &&
  [...operations.values()].some((o) => o.permissions.includes(code));

const ciText = (() => {
  const dir = join(ROOT, '.github', 'workflows');
  if (!existsSync(dir)) return '';
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');
})();

const taskRows = [];
for (const [id, title, proofs] of TASKS) {
  const problems = [];
  if (proofs.length === 0) problems.push('declares no artifact at all');

  for (const proof of proofs) {
    const [kind, a, b] = proof;
    if (kind === 'operation') {
      if (!operations.has(a)) problems.push(`operation ${a} is not registered`);
    } else if (kind === 'permission') {
      if (!seededOrDeclared(a)) problems.push(`permission ${a} is not both seeded and declared`);
    } else if (kind === 'audit') {
      if (!stripComments(auditCatalog).includes(`'${a}'`))
        problems.push(`audit action ${a} is not in the catalog`);
      else if (!declaredAudits.includes(a))
        problems.push(`audit action ${a} has no P1-23 producer`);
    } else if (kind === 'symbol') {
      const text = readIf(join(ROOT, a));
      if (text === null) problems.push(`file ${a} does not exist`);
      else if (!stripComments(text).includes(b)) problems.push(`${a} does not define ${b}`);
    } else if (kind === 'test') {
      const text = readIf(join(ROOT, a));
      if (text === null) problems.push(`test file ${a} does not exist`);
      else if (!stripComments(text).includes(b)) problems.push(`${a} has no test matching "${b}"`);
    } else if (kind === 'doc') {
      const text = readIf(join(ROOT, a));
      if (text === null) problems.push(`document ${a} does not exist`);
      else if (!text.includes(b)) problems.push(`${a} does not mention ${b}`);
    } else if (kind === 'ci') {
      // Two links, both required. A workflow calls an npm SCRIPT NAME, and
      // package.json maps that name to a file — so checking either end alone
      // passes while the chain is broken: a workflow can invoke a script that
      // package.json no longer defines, and package.json can define one that no
      // workflow ever runs. `a` is the npm script name, `b` the file it must run.
      const pkg = JSON.parse(readIf(join(ROOT, 'package.json')) ?? '{}');
      const mapped = pkg.scripts?.[a];
      if (!mapped) problems.push(`package.json defines no script "${a}"`);
      else if (!mapped.includes(b)) problems.push(`npm script "${a}" does not run ${b}`);
      if (!ciText.includes(`npm run ${a}`)) problems.push(`no workflow runs "npm run ${a}"`);
    } else {
      problems.push(`unknown proof kind ${kind}`);
    }
  }

  for (const p of problems) fail(5, `${id} — ${p}`);
  taskRows.push({ id, title, proofs: proofs.length, ok: problems.length === 0 });
}

// ---------------------------------------------------------------------------
// generated documents
// ---------------------------------------------------------------------------
const inventory = [
  `# ${PHASE_LABEL} — Endpoint Inventory`,
  '',
  '<!-- GENERATED by scripts/p1-23-endpoint-inventory.mjs — do not edit by hand. -->',
  '',
  `${phaseOps.length} operations, derived from the route tree.`,
  '',
  '| Operation | Module | Scope | Permissions | Audit action | Route file |',
  '| --------- | ------ | ----- | ----------- | ------------ | ---------- |',
  ...phaseOps
    .slice()
    .sort((x, y) => (x.id < y.id ? -1 : 1))
    .map(
      (op) =>
        `| \`${op.id}\` | ${op.module} | ${op.scope} | ${op.permissions.map((p) => `\`${p}\``).join('<br>')} | ${
          op.audit ? `\`${op.audit}\`` : '—'
        } | \`${op.file}\` |`
    ),
  '',
  '## Events',
  '',
  'None. Every operation in this phase is a read; the two audited operations record an',
  'inspection, not a state change. `assertNoPhaseEvents` fails the gate if that changes.',
  '',
].join('\n');

const traceability = [
  `# ${PHASE_LABEL} — Task Traceability`,
  '',
  '<!-- GENERATED by scripts/p1-23-endpoint-inventory.mjs — do not edit by hand. -->',
  '',
  `${TASKS.length} tasks. A task with no artifact proof FAILS the gate.`,
  '',
  '| Task | Title | Proofs | Status |',
  '| ---- | ----- | ------ | ------ |',
  ...taskRows.map(
    (t) => `| \`${t.id}\` | ${t.title} | ${t.proofs} | ${t.ok ? 'satisfied' : 'FAILING'} |`
  ),
  '',
].join('\n');

/**
 * Generated markdown is written THROUGH prettier, using the repository's own
 * config, so the file this script produces is byte-identical to the file
 * `format:check` wants.
 *
 * Without this the two gates contradict each other and the loser is whichever
 * ran second: `prettier --write docs` re-pads the markdown tables, `--check`
 * then reports the documents stale, regenerating un-pads them, and
 * `format:check` fails instead. Every prior phase's generator happens to emit
 * prettier-stable output; relying on that coincidence is what broke here.
 */
async function write(path, text) {
  let formatted = text;
  try {
    const prettier = await import('prettier');
    const config = (await prettier.resolveConfig(path)) ?? {};
    formatted = await prettier.format(text, { ...config, filepath: path });
  } catch {
    // Prettier unavailable (e.g. a production install). Writing the raw text is
    // correct then; format:check does not run in that environment either.
  }
  const previous = readIf(path);
  if (previous === formatted) return false;
  await writeFile(path, formatted, 'utf8');
  return true;
}

const checkMode = process.argv.includes('--check');
const inventoryChanged = await write(OUTPUT, inventory);
const traceabilityChanged = await write(TRACEABILITY, traceability);

if (checkMode && (inventoryChanged || traceabilityChanged)) {
  fail(7, 'generated documents are stale — re-run scripts/p1-23-endpoint-inventory.mjs and commit');
}

console.log(`${PHASE_LABEL} inventory: ${phaseOps.length} operations, ${TASKS.length} tasks`);
console.log(`  permissions declared: ${declaredPermissions.size}`);
console.log(`  audit actions: ${declaredAudits.length}`);
console.log(`  tasks satisfied: ${taskRows.filter((t) => t.ok).length}/${taskRows.length}`);

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('  all checks passed');
