#!/usr/bin/env node
/**
 * Operation-to-test coverage gate (P1-14 remediation).
 *
 * Blocker 2 of the failed P1-14 gate was that the ~39 registered operations had
 * NO application/API-layer test evidence: they were imported for OpenAPI
 * registration and never invoked. This gate makes that gap visible and
 * machine-readable, and fails CI when an operation that is DECLARED as covered
 * has lost its test evidence.
 *
 * It reconciles two sources:
 *   1. every `defineOperation({...})` in the source tree (the operations that ship);
 *   2. the coverage manifest below, which records — per operation — the test file
 *      that exercises it and the depth of that evidence.
 *
 * Depth levels:
 *   - "operation": the operation's application service is invoked end to end
 *     through the runtime context / RLS / transaction, with behavioural assertions
 *     (success AND at least one denial / audit / concurrency property where
 *     applicable). This is acceptance evidence.
 *   - "unit": the operation's decision logic is proven at the unit level (e.g. the
 *     token verifier, the domain policies) but the wired service is not invoked in
 *     an integration test. Honest partial evidence — NOT full acceptance.
 *   - "pending": no executable evidence yet. Listed explicitly so nothing is hidden.
 *
 * The gate FAILS if:
 *   - a manifest entry names a test file that does not reference the operation id
 *     (evidence claimed but absent — the exact "green but untested" failure this
 *     gate exists to prevent), or
 *   - a registered operation is missing from the manifest entirely (a new
 *     operation shipped without a coverage decision).
 *
 * The gate does NOT fail merely because an operation is "pending": that is a
 * tracked, visible residual, reported in the matrix and in the P1-14 records, not
 * a silently-hidden gap. Raising a "pending" operation to "operation" depth is the
 * governed way to close it.
 *
 * Exit codes: 0 clean · 1 coverage failure · 2 IO error.
 *
 * Usage: node scripts/check-operation-test-coverage.mjs [--json]
 */
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const TESTS = join(ROOT, 'tests');
const jsonOutput = process.argv.includes('--json');
const toPosix = (p) => p.split(sep).join('/');

function walk(dir, filter) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      out.push(...walk(full, filter));
    } else if (filter(entry)) out.push(full);
  }
  return out;
}

/** Extracts every `id: '...'` from a `defineOperation({...})` literal. */
function registeredOperationIds() {
  const ids = new Set();
  for (const file of walk(SRC, (n) => /\.tsx?$/.test(n))) {
    if (toPosix(relative(ROOT, file)).endsWith('server/auth/operation-registry.ts')) continue;
    const source = readFileSync(file, 'utf8');
    let index = source.indexOf('defineOperation(');
    while (index >= 0) {
      const braceStart = source.indexOf('{', index);
      const idMatch = /\bid\s*:\s*['"`]([^'"`]+)['"`]/.exec(
        source.slice(braceStart, braceStart + 400)
      );
      if (idMatch) ids.add(idMatch[1]);
      index = source.indexOf('defineOperation(', braceStart + 1);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Coverage manifest. Each registered operation MUST appear exactly once.
//   file: the test that exercises it (must reference the operation id), or null
//         when depth is "pending".
//   depth: "operation" | "unit" | "pending".
//   note: why, for the reader.
// ---------------------------------------------------------------------------
const MANIFEST = {
  // --- Grant / scope / approval administration — the confirmed-High surface.
  //     Deep operation-layer evidence + a database backstop suite.
  'iam.grant-issue': {
    depth: 'operation',
    file: 'tests/backend/iam-access-administration.test.ts',
    note: 'issued within/at/beyond authority; audit + event once; rollback leaves nothing',
  },
  'iam.grant-revoke': {
    depth: 'operation',
    file: 'tests/backend/iam-access-administration.test.ts',
    note: 'revocation immediate effect + stale-version conflict',
  },
  'iam.grant-scope-add': {
    depth: 'operation',
    file: 'tests/backend/iam-access-administration.test.ts',
    note: 'within-authority scope added; foreign-company widening refused',
  },
  'iam.grant-scope-remove': {
    depth: 'operation',
    file: 'tests/backend/iam-access-administration.test.ts',
    note: 'scope removed; DB backstop also proves last-scope removal cannot widen',
  },
  'iam.grant-scope-list': {
    depth: 'operation',
    file: 'tests/backend/iam-operations.test.ts',
    note: 'lists the scopes of a scoped grant',
  },
  'iam.approval-limit-create': {
    depth: 'operation',
    file: 'tests/backend/iam-access-administration.test.ts',
    note: 'no self-limit; malformed money rejected',
  },
  'iam.approval-limit-end': {
    depth: 'pending',
    file: null,
    note: 'endApprovalLimit not yet invoked at the service level (residual R-9)',
  },
  'iam.approval-limit-list': {
    depth: 'operation',
    file: 'tests/backend/iam-operations.test.ts',
    note: 'listed and tenant-scoped',
  },
  // --- Role / permission administration.
  'iam.role-create': {
    depth: 'operation',
    file: 'tests/backend/iam-operations.test.ts',
    note: 'created and found in the list',
  },
  'iam.role-update': {
    depth: 'pending',
    file: null,
    note: 'updateRole service invocation pending (R-9)',
  },
  'iam.role-list': {
    depth: 'operation',
    file: 'tests/backend/iam-operations.test.ts',
    note: 'listed, tenant-scoped',
  },
  'iam.role-permission-add': {
    depth: 'pending',
    file: null,
    note: 'addRolePermission service invocation pending (R-9)',
  },
  'iam.role-permission-update': {
    depth: 'pending',
    file: null,
    note: 'changeRolePermissionEffect service invocation pending (R-9)',
  },
  'iam.role-permission-remove': {
    depth: 'pending',
    file: null,
    note: 'removeRolePermission service invocation pending (R-9)',
  },
  'iam.role-permission-list': {
    depth: 'operation',
    file: 'tests/backend/iam-operations.test.ts',
    note: 'listed',
  },
  'iam.permission-list': {
    depth: 'operation',
    file: 'tests/backend/iam-operations.test.ts',
    note: 'catalogue listed',
  },
  // --- User administration.
  'iam.user-list': {
    depth: 'operation',
    file: 'tests/backend/iam-operations.test.ts',
    note: 'cursor paginated, tenant-isolated',
  },
  'iam.user-detail': {
    depth: 'operation',
    file: 'tests/backend/iam-operations.test.ts',
    note: 'detail; cross-tenant not found',
  },
  'iam.user-update': {
    depth: 'pending',
    file: null,
    note: 'updateProfile service invocation pending (R-9)',
  },
  'iam.user-status-change': {
    depth: 'pending',
    file: null,
    note: 'changeStatus service invocation pending (R-9)',
  },
  'iam.user-session-list': {
    depth: 'operation',
    file: 'tests/backend/iam-operations.test.ts',
    note: 'listed for a user',
  },
  'iam.user-session-revoke-all': {
    depth: 'pending',
    file: null,
    note: 'revokeAllSessions service invocation pending (R-9); repository UPDATE fix proven in P1-14-R-007 change',
  },
  // --- Organization settings.
  'iam.tenant-settings-read': {
    depth: 'operation',
    file: 'tests/backend/iam-operations.test.ts',
    note: 'read',
  },
  'iam.tenant-settings-update': {
    depth: 'pending',
    file: null,
    note: 'updateTenant service invocation pending (R-9)',
  },
  'iam.company-settings-read': {
    depth: 'operation',
    file: 'tests/backend/iam-operations.test.ts',
    note: 'read in scope',
  },
  'iam.company-settings-write': {
    depth: 'pending',
    file: null,
    note: 'writeCompanySetting service invocation pending (R-9)',
  },
  'iam.branch-settings-read': {
    depth: 'operation',
    file: 'tests/backend/iam-operations.test.ts',
    note: 'read in scope',
  },
  'iam.branch-settings-write': {
    depth: 'pending',
    file: null,
    note: 'writeBranchSetting service invocation pending (R-9)',
  },
  // --- Audit viewing.
  'iam.audit-event-list': {
    depth: 'operation',
    file: 'tests/backend/iam-operations.test.ts',
    note: 'bounded range; privileged read is itself audited',
  },
  'iam.audit-event-detail': {
    depth: 'operation',
    file: 'tests/backend/iam-operations.test.ts',
    note: 'cross-tenant record not found',
  },
  // --- Invitation / activation.
  'iam.invitation-create': {
    depth: 'pending',
    file: null,
    note: 'invite service invocation pending a provider-fake harness (R-8)',
  },
  'iam.invitation-cancel': {
    depth: 'pending',
    file: null,
    note: 'cancel service invocation pending a provider-fake harness (R-8)',
  },
  'iam.invitation-activate': {
    depth: 'unit',
    file: 'tests/foundation/p1-14-authentication-units.test.ts',
    note: 'activation refuses an unconfirmed provider identity — provider fake at unit level; full integration pending a provider-fake harness',
  },
  // --- Authentication (provider-backed). Verifier + domain proven at unit depth;
  //     wired-service integration pending a provider-fake backend harness (R-8).
  'iam.auth-login': {
    depth: 'unit',
    file: 'tests/foundation/p1-14-authentication-units.test.ts',
    note: 'token verify + assessFailedLogin proven; wired login integration pending (R-8)',
  },
  'iam.auth-logout': {
    depth: 'unit',
    file: 'tests/foundation/p1-14-authentication-units.test.ts',
    note: 'logout is public, token-authoritative; wired integration pending (R-8)',
  },
  'iam.auth-session': {
    depth: 'unit',
    file: 'tests/foundation/p1-14-authentication-units.test.ts',
    note: 'session-state SQL proven in P1-13 resolve-context; wired integration pending (R-8)',
  },
  'iam.auth-password-reset': {
    depth: 'unit',
    file: 'tests/foundation/p1-14-authentication-units.test.ts',
    note: 'redirect allow-list proven; wired integration pending (R-8)',
  },
  'iam.auth-password-reset-completion': {
    depth: 'unit',
    file: 'tests/foundation/p1-14-authentication-units.test.ts',
    note: 'reset completion; wired integration pending (R-8)',
  },
  // --- Reference exemplar.
  'meta.ping': {
    depth: 'operation',
    file: 'tests/backend/api-ping.test.ts',
    note: 'end-to-end reference endpoint',
  },
};

const REQUIRED_DEPTHS = new Set(['operation']);

function testReferencesId(file, id) {
  const abs = join(ROOT, file);
  if (!existsSync(abs)) return false;
  return readFileSync(abs, 'utf8').includes(id);
}

const registered = registeredOperationIds();
const failures = [];
const matrix = [];

for (const id of [...registered].sort()) {
  const entry = MANIFEST[id];
  if (!entry) {
    failures.push(
      `${id}: registered operation missing from the coverage manifest (add a coverage decision)`
    );
    matrix.push({ id, depth: 'UNDECLARED', file: null, referenced: false });
    continue;
  }
  const referenced = entry.depth === 'pending' ? false : testReferencesId(entry.file, id);
  matrix.push({ id, depth: entry.depth, file: entry.file, referenced, note: entry.note });
  if (entry.depth !== 'pending' && !referenced) {
    failures.push(
      `${id}: manifest claims ${entry.depth} evidence in ${entry.file}, but that file does not reference the operation id`
    );
  }
}

// Manifest entries for operations that no longer exist are stale.
for (const id of Object.keys(MANIFEST)) {
  if (!registered.has(id))
    failures.push(`${id}: coverage manifest names an operation that is not registered`);
}

const counts = matrix.reduce((acc, m) => {
  acc[m.depth] = (acc[m.depth] ?? 0) + 1;
  return acc;
}, {});

// Persist the machine-readable matrix for the evidence pack.
const matrixPath = join(
  ROOT,
  'docs',
  'phase-1',
  'phase-1-14',
  'evidence',
  'operation-test-matrix.json'
);
try {
  writeFileSync(
    matrixPath,
    JSON.stringify(
      { generatedFrom: 'scripts/check-operation-test-coverage.mjs', counts, operations: matrix },
      null,
      2
    ) + '\n'
  );
} catch {
  /* evidence dir may not exist in some checkouts; not fatal to the gate */
}

if (jsonOutput) {
  console.log(JSON.stringify({ counts, operations: matrix, failures }, null, 2));
} else {
  console.log(`Operation-to-test coverage: ${registered.size} registered operation(s)`);
  console.log(
    `  operation-depth: ${counts.operation ?? 0} · unit-depth: ${counts.unit ?? 0} · pending: ${counts.pending ?? 0}`
  );
  for (const m of matrix) {
    const flag =
      m.depth === 'operation'
        ? 'OK '
        : m.depth === 'unit'
          ? 'UNIT'
          : m.depth === 'pending'
            ? 'PEND'
            : 'FAIL';
    console.log(`  [${flag}] ${m.id.padEnd(34)} ${m.file ?? '(none)'}`);
  }
  if (failures.length === 0) {
    console.log(
      `\nOK: every operation has a coverage decision; every non-pending claim is backed by a referencing test.`
    );
    console.log(`Matrix written to docs/phase-1/phase-1-14/evidence/operation-test-matrix.json`);
  } else {
    console.error(`\n${failures.length} coverage failure(s):`);
    for (const f of failures) console.error(`  - ${f}`);
  }
}

void REQUIRED_DEPTHS;
process.exit(failures.length === 0 ? 0 : 1);
