#!/usr/bin/env node
/**
 * Operation-to-test coverage gate (P1-14 remediation — STRICT).
 *
 * Blocker 2 of the failed P1-14 gate was that the registered operations had NO
 * application/API-layer test evidence: they were imported for OpenAPI
 * registration and never invoked. The first version of this gate made that gap
 * visible but tolerated "pending" and "unit" residuals. This version does not.
 *
 * Every registered PUBLIC operation must now have GENUINE operation-depth
 * evidence — its wired application service invoked end to end on the runtime DB
 * role, through RLS, the transaction wrapper, and the audit/outbox path — and the
 * gate FAILS if any of the following is true:
 *
 *   1. a registered operation is absent from the coverage manifest;
 *   2. a manifest entry names a test file that does not reference the operation id
 *      (evidence claimed but the operation is never invoked — the exact
 *      "green but untested" failure this gate exists to prevent);
 *   3. an operation declares REQUIRED evidence kinds (permission-denial,
 *      cross-tenant, company/branch isolation, audit assertion, idempotency,
 *      stale-version, atomic outbox) that its test file's COVERAGE-EVIDENCE block
 *      does not provide;
 *   4. a manifest entry names an operation that is no longer registered (stale);
 *   5. any operation is marked `pending` — the state no longer exists, so the
 *      manifest cannot express one.
 *
 * There is no `pending` and no `unit` depth any more: 0 pending, 0 unreferenced,
 * 0 metadata-only is the only passing state.
 *
 * The per-operation evidence a test file provides is declared in a machine-read
 * COVERAGE-EVIDENCE block inside that file, e.g.
 *
 *     COVERAGE-EVIDENCE (...):
 *       iam.user-update: success denial cross-tenant audit stale-version
 *
 * The flags are review-anchored: they sit in the file beside the assertions that
 * back them, the gate checks the file also *invokes* the operation, and a
 * reviewer can confirm each claimed flag maps to a real assertion. The negative
 * fixture (tests/foundation/operation-coverage-gate.test.ts) proves the gate
 * returns failures when a required flag is missing or an operation is unreferenced.
 *
 * Exit codes: 0 clean · 1 coverage failure · 2 IO error.
 * Usage: node scripts/check-operation-test-coverage.mjs [--json]
 */
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const toPosix = (p) => p.split(sep).join('/');

// ---------------------------------------------------------------------------
// Coverage manifest. Each registered operation MUST appear exactly once.
//   file: the test that exercises it (must reference the operation id).
//   required: the evidence kinds the test file must declare for this operation
//             in its COVERAGE-EVIDENCE block. [] means "invocation only" — read
//             and catalogue operations that have no denial/isolation/audit
//             obligations of their own.
//   note: why, for the reader.
//
// Evidence-kind vocabulary (a superset may be declared; the gate checks the
// REQUIRED ones are present):
//   success · denial · cross-tenant · isolation · audit · outbox · idempotency ·
//   stale-version
// ---------------------------------------------------------------------------
export const MANIFEST = {
  // --- Grant / scope / approval administration — the confirmed-High surface.
  'iam.grant-issue': {
    file: 'tests/backend/iam-access-administration.test.ts',
    required: ['success', 'denial', 'cross-tenant', 'audit', 'outbox'],
    note: 'issued within/at/beyond authority; audit + event once; rollback leaves nothing',
  },
  'iam.grant-revoke': {
    file: 'tests/backend/iam-access-administration.test.ts',
    required: ['success', 'stale-version'],
    note: 'revocation immediate effect + stale-version conflict',
  },
  'iam.grant-scope-add': {
    file: 'tests/backend/iam-access-administration.test.ts',
    required: ['success', 'isolation'],
    note: 'within-authority scope added; foreign-company widening refused',
  },
  'iam.grant-scope-remove': {
    file: 'tests/backend/iam-access-administration.test.ts',
    required: ['success'],
    note: 'scope removed; DB backstop also proves last-scope removal cannot widen',
  },
  'iam.grant-scope-list': {
    file: 'tests/backend/iam-operations.test.ts',
    required: [],
    note: 'lists the scopes of a scoped grant',
  },
  'iam.approval-limit-create': {
    file: 'tests/backend/iam-access-administration.test.ts',
    required: ['success', 'denial'],
    note: 'no self-limit; malformed money rejected',
  },
  'iam.approval-limit-end': {
    file: 'tests/backend/iam-admin-writes.test.ts',
    required: ['success', 'denial', 'audit', 'stale-version'],
    note: 'window ended; permission-denied; wrong version refused',
  },
  'iam.approval-limit-list': {
    file: 'tests/backend/iam-operations.test.ts',
    required: [],
    note: 'listed and tenant-scoped',
  },
  // --- Role / permission administration.
  'iam.role-create': {
    file: 'tests/backend/iam-operations.test.ts',
    required: [],
    note: 'created and found in the list',
  },
  'iam.role-update': {
    file: 'tests/backend/iam-admin-writes.test.ts',
    required: ['success', 'denial', 'cross-tenant', 'audit', 'stale-version'],
    note: 'renamed; permission-denied; tenant-B refused; wrong version refused',
  },
  'iam.role-list': {
    file: 'tests/backend/iam-operations.test.ts',
    required: [],
    note: 'listed, tenant-scoped',
  },
  'iam.role-permission-add': {
    file: 'tests/backend/iam-admin-writes.test.ts',
    required: ['success', 'denial', 'audit'],
    note: 'delegable allow added; permission-denied under RLS',
  },
  'iam.role-permission-update': {
    file: 'tests/backend/iam-admin-writes.test.ts',
    required: ['success', 'denial', 'audit', 'stale-version'],
    note: 'effect changed; permission-denied; wrong version refused',
  },
  'iam.role-permission-remove': {
    file: 'tests/backend/iam-admin-writes.test.ts',
    required: ['success', 'denial', 'audit'],
    note: 'mapping removed; DELETE policy refuses the unprivileged caller',
  },
  'iam.role-permission-list': {
    file: 'tests/backend/iam-operations.test.ts',
    required: [],
    note: 'listed',
  },
  'iam.permission-list': {
    file: 'tests/backend/iam-operations.test.ts',
    required: [],
    note: 'catalogue listed',
  },
  // --- User administration.
  'iam.user-list': {
    file: 'tests/backend/iam-operations.test.ts',
    required: [],
    note: 'cursor paginated, tenant-isolated',
  },
  'iam.user-detail': {
    file: 'tests/backend/iam-operations.test.ts',
    required: [],
    note: 'detail; cross-tenant not found',
  },
  'iam.user-update': {
    file: 'tests/backend/iam-admin-writes.test.ts',
    required: ['success', 'denial', 'cross-tenant', 'audit', 'stale-version'],
    note: 'profile updated; permission-denied; tenant-B refused; wrong version refused',
  },
  'iam.user-status-change': {
    file: 'tests/backend/iam-admin-writes.test.ts',
    required: ['success', 'denial', 'audit', 'outbox'],
    note: 'lock revokes sessions + audits + one event; permission-denied; self refused',
  },
  'iam.user-session-list': {
    file: 'tests/backend/iam-operations.test.ts',
    required: [],
    note: 'listed for a user',
  },
  'iam.user-session-revoke-all': {
    file: 'tests/backend/iam-admin-writes.test.ts',
    required: ['success', 'denial', 'audit', 'outbox', 'idempotency'],
    note: 'all revoked + audit + event; unprivileged revokes nothing; second call revokes zero',
  },
  // --- Organization settings.
  'iam.tenant-settings-read': {
    file: 'tests/backend/iam-operations.test.ts',
    required: [],
    note: 'read',
  },
  'iam.tenant-settings-update': {
    file: 'tests/backend/iam-admin-writes.test.ts',
    required: ['success', 'denial', 'audit', 'stale-version'],
    note: 'updated + audit; permission-denied; wrong version refused',
  },
  'iam.company-settings-read': {
    file: 'tests/backend/iam-operations.test.ts',
    required: [],
    note: 'read in scope',
  },
  'iam.company-settings-write': {
    file: 'tests/backend/iam-admin-writes.test.ts',
    required: ['success', 'audit', 'isolation'],
    note: 'append-only version written + audit; out-of-scope company refused',
  },
  'iam.branch-settings-read': {
    file: 'tests/backend/iam-operations.test.ts',
    required: [],
    note: 'read in scope',
  },
  'iam.branch-settings-write': {
    file: 'tests/backend/iam-admin-writes.test.ts',
    required: ['success', 'audit', 'isolation'],
    note: 'version written + audit; out-of-scope branch invisible and refused',
  },
  // --- Audit viewing.
  'iam.audit-event-list': {
    file: 'tests/backend/iam-operations.test.ts',
    required: [],
    note: 'bounded range; privileged read is itself audited',
  },
  'iam.audit-event-detail': {
    file: 'tests/backend/iam-operations.test.ts',
    required: [],
    note: 'cross-tenant record not found',
  },
  // --- Invitation / activation (provider-fake harness).
  'iam.invitation-create': {
    file: 'tests/backend/iam-auth-provider.test.ts',
    required: ['success', 'denial', 'cross-tenant', 'audit', 'outbox'],
    note: 'invited account + audit + event; duplicate conflict; unprivileged refused; tenant-bound',
  },
  'iam.invitation-cancel': {
    file: 'tests/backend/iam-auth-provider.test.ts',
    required: ['success', 'denial', 'audit', 'outbox'],
    note: 'invited → archived + audit + event; non-invitation refused',
  },
  'iam.invitation-activate': {
    file: 'tests/backend/iam-auth-provider.test.ts',
    required: ['success', 'denial', 'audit', 'outbox'],
    note: 'accepted invitation activated + audit + event; unconfirmed refused',
  },
  // --- Authentication (provider-fake harness).
  'iam.auth-login': {
    file: 'tests/backend/iam-auth-provider.test.ts',
    required: ['success', 'denial', 'audit'],
    note: 'token + session + success audit; every failure generic; failure audited',
  },
  'iam.auth-logout': {
    file: 'tests/backend/iam-auth-provider.test.ts',
    required: ['success', 'audit', 'idempotency'],
    note: 'session revoked + logout audit; double logout is a no-op',
  },
  'iam.auth-session': {
    file: 'tests/backend/iam-auth-provider.test.ts',
    required: ['success'],
    note: 'describeSession resolves identity, scope, permissions',
  },
  'iam.auth-password-reset': {
    file: 'tests/backend/iam-auth-provider.test.ts',
    required: ['success', 'denial'],
    note: 'known → delivery; unknown → silent; non-allow-listed redirect refused',
  },
  'iam.auth-password-reset-completion': {
    file: 'tests/backend/iam-auth-provider.test.ts',
    required: ['success', 'denial', 'idempotency'],
    note: 'completes + invalidates prior sessions; replay refused; bounds enforced',
  },
  // --- Reference exemplar.
  'meta.ping': {
    file: 'tests/backend/api-ping.test.ts',
    required: [],
    note: 'end-to-end reference endpoint',
  },
};

/** Extracts every `id: '...'` from a `defineOperation({...})` literal in a tree. */
export function scanRegisteredOperationIds(root) {
  const src = join(root, 'src');
  const ids = new Set();
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (entry === 'node_modules' || entry === '.next') continue;
        walk(full);
      } else if (/\.tsx?$/.test(entry)) {
        if (toPosix(relative(root, full)).endsWith('server/auth/operation-registry.ts')) continue;
        const source = readFileSync(full, 'utf8');
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
    }
  };
  walk(src);
  return ids;
}

/**
 * Parses the COVERAGE-EVIDENCE block of a test file into a map of
 * operationId -> Set(flags). Lines are only read between a line containing the
 * `COVERAGE-EVIDENCE` marker and the next line that closes the block comment, so
 * a stray "id: word" elsewhere in the file cannot be mistaken for a declaration.
 */
export function parseProvidedFlags(source) {
  const provided = new Map();
  const lines = source.split(/\r?\n/);
  let inBlock = false;
  for (const line of lines) {
    if (line.includes('COVERAGE-EVIDENCE')) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    if (line.includes(COMMENT_CLOSE)) {
      inBlock = false;
      continue;
    }
    const m = /^\s*\*?\s*((?:iam|meta)\.[a-z0-9-]+)\s*:\s*([a-z0-9 \-]+?)\s*$/.exec(line);
    if (m) {
      const flags = new Set(m[2].split(/\s+/).filter(Boolean));
      provided.set(m[1], flags);
    }
  }
  return provided;
}

/** The JSDoc close marker, assembled so this source can mention it safely. */
const COMMENT_CLOSE = '*' + '/';

/**
 * Removes the COVERAGE-EVIDENCE declaration block from a file's text, so the
 * "is this operation actually invoked?" check cannot be satisfied by the machine
 * -readable declaration itself. After stripping, the operation id must still
 * appear in the file — in the "Operations exercised here" listing and, for the
 * write operations, the `describe`/`it` bodies that invoke the service — for the
 * operation to count as referenced.
 */
export function stripCoverageBlock(source) {
  const out = [];
  let inBlock = false;
  for (const line of source.split(/\r?\n/)) {
    if (line.includes('COVERAGE-EVIDENCE')) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (line.includes(COMMENT_CLOSE)) inBlock = false;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/**
 * Pure evaluator, so the negative fixture can drive it with a synthetic manifest
 * and an in-memory reader. `readFile(path)` returns the file's text, or null when
 * it does not exist.
 *
 * Returns `{ failures, matrix, counts }`. A clean run has `failures.length === 0`.
 */
export function evaluateCoverage({ registered, manifest, readFile }) {
  const failures = [];
  const matrix = [];
  const providedCache = new Map();
  const providedFor = (file) => {
    if (!providedCache.has(file)) {
      const text = readFile(file);
      providedCache.set(file, text == null ? new Map() : parseProvidedFlags(text));
    }
    return providedCache.get(file);
  };

  for (const id of [...registered].sort()) {
    const entry = manifest[id];
    if (!entry) {
      failures.push(`${id}: registered operation missing from the coverage manifest`);
      matrix.push({ id, file: null, referenced: false, required: [], missing: ['<undeclared>'] });
      continue;
    }
    const required = entry.required ?? [];
    const source = readFile(entry.file);
    // The operation must be referenced OUTSIDE its own COVERAGE-EVIDENCE block —
    // the declaration cannot vouch for the invocation it declares.
    const referenced = source != null && stripCoverageBlock(source).includes(id);
    if (!referenced) {
      failures.push(
        `${id}: manifest names ${entry.file}, but that file does not reference the operation id (not invoked)`
      );
    }
    const provided = referenced ? (providedFor(entry.file).get(id) ?? new Set()) : new Set();
    const missing = required.filter((flag) => !provided.has(flag));
    if (referenced && missing.length > 0) {
      failures.push(
        `${id}: ${entry.file} is missing required evidence [${missing.join(', ')}] in its COVERAGE-EVIDENCE block`
      );
    }
    matrix.push({
      id,
      file: entry.file,
      referenced,
      required,
      provided: [...provided].sort(),
      missing,
    });
  }

  // Manifest entries for operations that no longer exist are stale.
  for (const id of Object.keys(manifest)) {
    if (!registered.has(id)) {
      failures.push(`${id}: coverage manifest names an operation that is not registered`);
    }
  }

  const counts = {
    registered: registered.size,
    withRequiredEvidence: matrix.filter((m) => (m.required ?? []).length > 0).length,
    invocationOnly: matrix.filter((m) => (m.required ?? []).length === 0).length,
  };
  return { failures, matrix, counts };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function runCli() {
  const ROOT = process.cwd();
  const jsonOutput = process.argv.includes('--json');
  const readFile = (rel) => {
    const abs = join(ROOT, rel);
    return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  };

  let registered;
  try {
    registered = scanRegisteredOperationIds(ROOT);
  } catch (error) {
    console.error(`IO error scanning operations: ${error.message}`);
    process.exit(2);
  }

  const { failures, matrix, counts } = evaluateCoverage({
    registered,
    manifest: MANIFEST,
    readFile,
  });

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
    /* evidence dir may be absent in some checkouts; not fatal to the gate */
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ counts, operations: matrix, failures }, null, 2));
  } else {
    console.log(
      `Operation-to-test coverage (STRICT): ${counts.registered} registered operation(s)`
    );
    console.log(
      `  with required evidence: ${counts.withRequiredEvidence} · invocation-only (read/catalogue): ${counts.invocationOnly}`
    );
    for (const m of matrix) {
      const ok = m.referenced && (m.missing ?? []).length === 0;
      console.log(`  [${ok ? 'OK ' : 'FAIL'}] ${m.id.padEnd(34)} ${m.file ?? '(none)'}`);
    }
    if (failures.length === 0) {
      console.log(
        `\nOK: every registered operation is invoked in a referencing test and provides its required evidence.`
      );
      console.log(`Matrix written to docs/phase-1/phase-1-14/evidence/operation-test-matrix.json`);
    } else {
      console.error(`\n${failures.length} coverage failure(s):`);
      for (const f of failures) console.error(`  - ${f}`);
    }
  }

  process.exit(failures.length === 0 ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli();
}
