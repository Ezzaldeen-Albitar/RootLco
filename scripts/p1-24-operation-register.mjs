/**
 * P1-24 integrated operation register (P1-24-BE-001, P1-24-QA-002, P1-24-DOC-001).
 *
 * ===========================================================================
 * WHAT THIS IS, AND WHY IT IS NOT ANOTHER ENDPOINT INVENTORY
 * ===========================================================================
 * Every phase from P1-19 onward ships a `p1-NN-endpoint-inventory.mjs` that
 * proves ONE phase's own surface. P1-24 is the integration and release gate, so
 * its unit of work is the OPPOSITE: the whole backend at once, across every
 * phase, reconciled against every catalog simultaneously.
 *
 * The register is derived, never authored. Its only inputs are:
 *
 *   - the `defineOperation({...})` literals in `src/app/api/**\/route.ts`
 *   - `docs/api/openapi.v1.json`            (the published contract)
 *   - `supabase/seeds/04_iam_permission_catalog.sql`  (permission codes)
 *   - `src/server/auth/audit-actions.ts`    (controlled audit actions)
 *   - `src/server/events/envelope.ts`       (the event catalog)
 *   - `src/server/errors/catalog.ts`        (structured error codes)
 *   - the coverage manifest in `scripts/check-operation-test-coverage.mjs`
 *
 * A hand-written register documents what its author remembered. This one cannot
 * disagree with the code, because the code is its only input.
 *
 * ===========================================================================
 * THE CLASSIFICATION, AND WHAT MAKES IT HONEST
 * ===========================================================================
 * §11 of the phase brief requires every public operation to carry exactly one
 * of: Covered · Partially covered · Uncovered · Not applicable · Blocked. Those
 * words are worthless if a human assigns them, so each is COMPUTED from the
 * union of evidence flags the operation's own tests declare, measured against
 * the requirements its own registration derives:
 *
 *   Covered            every derived requirement is met by declared evidence
 *   Partially covered  the operation is invoked, but at least one requirement
 *                      has no evidence behind it
 *   Uncovered          no test file references the operation at all
 *   Not applicable     reserved; no operation currently qualifies, and the
 *                      register says so rather than leaving the state unused
 *                      and unexplained
 *   Blocked            named in BLOCKED_BY_DECISION against an open decision
 *
 * "Partially covered" is deliberately not a passing state. The register reports
 * it, `--check` fails on it above the recorded ceiling, and the ceiling only
 * ever moves down. That is the mechanism by which P1-24's own remediation
 * cannot silently regress after the phase closes.
 *
 * ===========================================================================
 * WHY THE DERIVED FLOOR IS RE-COMPUTED HERE RATHER THAN IMPORTED
 * ===========================================================================
 * It is NOT re-computed. `derivedRequirements` is imported from the coverage
 * gate, so the register and the gate cannot disagree about what an operation
 * owes. A second implementation of the same rule is a second source of truth,
 * and the two would drift silently until the drift was the finding.
 *
 * Exit codes: 0 clean · 1 reconciliation failure · 2 IO error.
 * Usage:
 *   node scripts/p1-24-operation-register.mjs            regenerate
 *   node scripts/p1-24-operation-register.mjs --check    fail if stale/degraded
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MANIFEST,
  derivedRequirements,
  parseProvidedFlags,
} from './check-operation-test-coverage.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_ROOT = join(ROOT, 'src', 'app', 'api');
const EVIDENCE = join(ROOT, 'docs', 'phase-1', 'phase-1-24', 'evidence');
const REGISTER_MD = join(EVIDENCE, 'operation-register.md');
const REGISTER_JSON = join(EVIDENCE, 'operation-register.json');

const toPosix = (p) => p.split(sep).join('/');

/**
 * Operations whose coverage is deliberately deferred against a recorded open
 * decision. Empty is the correct state: a non-empty list is a claim that must
 * name a decision id, and the check below refuses an entry that does not.
 */
const BLOCKED_BY_DECISION = Object.freeze({});

/**
 * The ceiling on `Partially covered`. This number may only ever DECREASE.
 *
 * P1-24 entered with 39 operations outside the derived-evidence floor
 * (`iam.` 38 + `meta.` 1) and drove that to zero — see
 * `docs/phase-1/phase-1-24/findings.md`, P1-24-F-001. Zero is therefore the
 * only defensible ceiling, and a future phase that re-introduces a partially
 * covered operation has to change this line in a reviewed diff rather than
 * quietly adding one more.
 */
const MAX_PARTIAL = 0;

/** The ceiling on `Uncovered`. Same rule. */
const MAX_UNCOVERED = 0;

// ---------------------------------------------------------------------------
// Source parsing
// ---------------------------------------------------------------------------

/**
 * Removes comments before any structural search. Without this a
 * `defineOperation(` inside a doc comment is parsed as a declaration, and a
 * claim written in prose satisfies a check meant to measure code.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walk(directory, out = []) {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

/** Extracts every `defineOperation({ … })` object literal by brace matching. */
function extractDeclarations(source) {
  const literals = [];
  const marker = 'defineOperation(';
  let index = source.indexOf(marker);
  while (index !== -1) {
    const open = source.indexOf('{', index);
    if (open === -1) break;
    let depth = 0;
    let cursor = open;
    for (; cursor < source.length; cursor++) {
      if (source[cursor] === '{') depth++;
      else if (source[cursor] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    literals.push(source.slice(open, cursor + 1));
    index = source.indexOf(marker, cursor);
  }
  return literals;
}

const scalar = (literal, key) => {
  const match = new RegExp(`\\b${key}:\\s*'([^']*)'`).exec(literal);
  return match ? match[1] : undefined;
};
const boolean = (literal, key) => new RegExp(`\\b${key}:\\s*true\\b`).test(literal);
const list = (literal, key) => {
  const match = new RegExp(`\\b${key}:\\s*\\[([^\\]]*)\\]`).exec(literal);
  if (!match) return [];
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
};

function readOperations() {
  const operations = [];
  for (const file of walk(API_ROOT)) {
    const relativePath = toPosix(relative(ROOT, file));
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const literal of extractDeclarations(source)) {
      const id = scalar(literal, 'id');
      if (!id) continue;
      operations.push({
        id,
        module: scalar(literal, 'module'),
        method: scalar(literal, 'method'),
        path: scalar(literal, 'path'),
        summary: scalar(literal, 'summary'),
        permissions: list(literal, 'permissions'),
        public: boolean(literal, 'public'),
        scope: scalar(literal, 'scope'),
        auditClass: scalar(literal, 'auditClass'),
        auditAction: scalar(literal, 'auditAction'),
        idempotent: boolean(literal, 'idempotent'),
        versionGuarded: boolean(literal, 'versionGuarded'),
        rateLimitPolicy: scalar(literal, 'rateLimitPolicy'),
        cacheCategory: scalar(literal, 'cacheCategory'),
        file: relativePath,
      });
    }
  }
  operations.sort((a, b) => a.id.localeCompare(b.id));
  return operations;
}

// ---------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------

/**
 * Permission codes contain underscores (`wo.work_order.read`). An alphabet that
 * omits `_` matches the prefix `wo.work` and reports 34 perfectly valid codes as
 * missing — a false finding that reads exactly like a real one.
 */
function readPermissionCodes() {
  const sql = readFileSync(
    join(ROOT, 'supabase', 'seeds', '04_iam_permission_catalog.sql'),
    'utf8'
  );
  return new Set(
    [...sql.matchAll(/\(\s*'([a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+)'\s*,/g)].map((m) => m[1])
  );
}

function readAuditActions() {
  const source = readFileSync(join(ROOT, 'src', 'server', 'auth', 'audit-actions.ts'), 'utf8');
  return new Set([...source.matchAll(/\bcode:\s*'([^']+)'/g)].map((m) => m[1]));
}

/**
 * Reads the event catalog by BLOCK, then extracts each field independently.
 *
 * The first version of this function matched all six fields in one alternation-free
 * sequence, which silently required them to appear in that exact order with nothing
 * between them. Eleven of the fifty entries carry a doc comment or order their
 * fields differently, so it returned 39 and the register understated the event
 * catalog by 22% while reporting no error at all.
 *
 * That is the same failure mode as the two recorded non-findings in
 * `docs/phase-1/phase-1-24/findings.md`: a parser that under-matches looks exactly
 * like a smaller input. The defence is not a better regex — it is the assertion
 * below, which counts `EVT-` codes in the file and fails when the structured parse
 * disagrees. A parse that starts missing entries becomes a build failure rather
 * than a quieter number.
 */
function readEventCatalog() {
  const source = readFileSync(join(ROOT, 'src', 'server', 'events', 'envelope.ts'), 'utf8');
  const entries = [];
  // One block per catalog entry: from a `code: 'EVT-…'` to the next one (or the end).
  const starts = [...source.matchAll(/\bcode:\s*'(EVT-[A-Z0-9-]+)'/g)];
  for (let index = 0; index < starts.length; index++) {
    const from = starts[index].index;
    const to = index + 1 < starts.length ? starts[index + 1].index : source.length;
    const block = source.slice(from, to);
    const field = (name) => {
      const match = new RegExp(`\\b${name}:\\s*'([^']*)'`).exec(block);
      return match ? match[1] : null;
    };
    const version = /\bschemaVersion:\s*(\d+)/.exec(block);
    entries.push({
      code: starts[index][1],
      eventType: field('eventType'),
      schemaVersion: version ? Number(version[1]) : null,
      aggregateType: field('aggregateType'),
      owner: field('owner'),
      implementedIn: field('implementedIn'),
    });
  }

  const declared = [...source.matchAll(/\beventType:\s*'/g)].length;
  if (entries.length !== declared || entries.some((entry) => entry.eventType === null)) {
    throw new Error(
      `event catalog parse is incomplete: ${entries.length} block(s) for ${declared} eventType ` +
        'declaration(s). Fix the parser rather than accepting the smaller number.'
    );
  }
  return entries;
}

function readErrorCodes() {
  const source = readFileSync(join(ROOT, 'src', 'server', 'errors', 'catalog.ts'), 'utf8');
  return new Set([...source.matchAll(/\bcode:\s*'(ERR-[A-Z0-9-]+)'/g)].map((m) => m[1]));
}

function readOpenApi() {
  const document = JSON.parse(readFileSync(join(ROOT, 'docs', 'api', 'openapi.v1.json'), 'utf8'));
  const byOperationId = new Map();
  const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
  let operationCount = 0;
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const method of METHODS) {
      const operation = item[method];
      if (!operation) continue;
      operationCount++;
      byOperationId.set(operation.operationId, {
        path,
        method: method.toUpperCase(),
        responses: Object.keys(operation.responses ?? {}),
        hasRequestBody: Boolean(operation.requestBody),
        security: operation.security ?? null,
      });
    }
  }
  return {
    document,
    byOperationId,
    pathCount: Object.keys(document.paths ?? {}).length,
    operationCount,
    schemaCount: Object.keys(document.components?.schemas ?? {}).length,
    securitySchemeCount: Object.keys(document.components?.securitySchemes ?? {}).length,
  };
}

// ---------------------------------------------------------------------------
// Test evidence
// ---------------------------------------------------------------------------

function collectTestFiles() {
  const roots = [join(ROOT, 'tests')];
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) visit(full);
      else if (entry.endsWith('.ts')) files.push(full);
    }
  };
  for (const root of roots) if (existsSync(root)) visit(root);
  return files;
}

/**
 * Builds `operationId -> { files, flags }` from the COVERAGE-EVIDENCE blocks
 * and from raw references.
 *
 * The two are kept apart on purpose. A raw reference proves only that a file
 * MENTIONS the id — which is how an operation ends up "invoked" while nothing
 * asserts its authorization. Flags are the reviewable claim; references are the
 * denominator that makes an unreferenced operation visible as Uncovered rather
 * than silently absent.
 */
function collectEvidence(operationIds) {
  const references = new Map(operationIds.map((id) => [id, new Set()]));
  const flags = new Map(operationIds.map((id) => [id, new Set()]));
  for (const file of collectTestFiles()) {
    const relativePath = toPosix(relative(ROOT, file));
    const source = readFileSync(file, 'utf8');
    for (const id of operationIds) if (source.includes(id)) references.get(id).add(relativePath);
    for (const [id, provided] of parseProvidedFlags(source)) {
      if (!flags.has(id)) continue;
      for (const flag of provided) flags.get(id).add(flag);
    }
  }
  return { references, flags };
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

function build() {
  const operations = readOperations();
  const permissionCodes = readPermissionCodes();
  const auditActions = readAuditActions();
  const events = readEventCatalog();
  const errorCodes = readErrorCodes();
  const openapi = readOpenApi();
  const { references, flags } = collectEvidence(operations.map((o) => o.id));

  const failures = [];
  const rows = [];

  for (const operation of operations) {
    const published = openapi.byOperationId.get(operation.id);
    const required = derivedRequirements(operation);
    const declared = MANIFEST[operation.id]?.required ?? [];
    const effective = [...new Set([...required, ...declared])];
    const provided = flags.get(operation.id) ?? new Set();
    const referencedIn = [...(references.get(operation.id) ?? new Set())];
    const missing = effective.filter((requirement) => !provided.has(requirement));

    let classification;
    if (BLOCKED_BY_DECISION[operation.id]) classification = 'Blocked';
    else if (referencedIn.length === 0) classification = 'Uncovered';
    else if (missing.length === 0) classification = 'Covered';
    else classification = 'Partially covered';

    // --- reconciliation, one failure per real disagreement ------------------
    if (!published) {
      failures.push(`${operation.id}: registered but absent from docs/api/openapi.v1.json`);
    } else {
      if (published.path !== `/api/v1${operation.path}`) {
        failures.push(
          `${operation.id}: OpenAPI path ${published.path} != registered /api/v1${operation.path}`
        );
      }
      if (published.method !== operation.method) {
        failures.push(
          `${operation.id}: OpenAPI method ${published.method} != registered ${operation.method}`
        );
      }
      // A public operation carries no security requirement; every other one must.
      const secured = Array.isArray(published.security) && published.security.length > 0;
      if (operation.public && secured) {
        failures.push(`${operation.id}: declared public but published with a security requirement`);
      }
      if (!operation.public && !secured) {
        failures.push(`${operation.id}: authenticated operation published with no security scheme`);
      }
    }
    for (const code of operation.permissions) {
      if (!permissionCodes.has(code)) {
        failures.push(`${operation.id}: permission "${code}" is not in the IAM permission seed`);
      }
    }
    if (operation.auditClass && operation.auditClass !== 'none') {
      if (!operation.auditAction) {
        failures.push(`${operation.id}: auditClass ${operation.auditClass} with no auditAction`);
      } else if (!auditActions.has(operation.auditAction)) {
        failures.push(
          `${operation.id}: audit action "${operation.auditAction}" is not in the controlled catalog`
        );
      }
    }
    if (!MANIFEST[operation.id]) {
      failures.push(`${operation.id}: absent from the operation coverage manifest`);
    }

    rows.push({
      id: operation.id,
      domain: operation.module,
      method: operation.method,
      route: `/api/v1${operation.path}`,
      permissions: operation.permissions,
      public: operation.public,
      scope: operation.scope ?? 'tenant',
      transaction:
        operation.method === 'GET' ? 'read (no business mutation)' : 'transactional write',
      auditClass: operation.auditClass ?? 'none',
      auditAction: operation.auditAction ?? null,
      idempotent: Boolean(operation.idempotent),
      versionGuarded: Boolean(operation.versionGuarded),
      openapi: published ? `${published.method} ${published.path}` : null,
      documentedResponses: published?.responses ?? [],
      requiredEvidence: effective,
      providedEvidence: [...provided].sort(),
      missingEvidence: missing,
      tests: referencedIn,
      classification,
      file: operation.file,
    });
  }

  // Reverse direction: a published operation with no registration.
  for (const operationId of openapi.byOperationId.keys()) {
    if (!operations.some((o) => o.id === operationId)) {
      failures.push(`${operationId}: published in OpenAPI but not registered in any route`);
    }
  }

  // Blocked entries must name a decision, or the state is a hiding place.
  for (const [id, decision] of Object.entries(BLOCKED_BY_DECISION)) {
    if (!/^P1-\d\d-D-\d+$/.test(decision ?? '')) {
      failures.push(`${id}: Blocked without a decision id of the form P1-NN-D-NN`);
    }
  }

  const counts = rows.reduce((accumulator, row) => {
    accumulator[row.classification] = (accumulator[row.classification] ?? 0) + 1;
    return accumulator;
  }, {});

  if ((counts['Partially covered'] ?? 0) > MAX_PARTIAL) {
    failures.push(
      `Partially covered operations: ${counts['Partially covered']} > ceiling ${MAX_PARTIAL}`
    );
  }
  if ((counts.Uncovered ?? 0) > MAX_UNCOVERED) {
    failures.push(`Uncovered operations: ${counts.Uncovered} > ceiling ${MAX_UNCOVERED}`);
  }

  return { rows, counts, failures, openapi, events, errorCodes, permissionCodes, auditActions };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderMarkdown(result) {
  const { rows, counts, openapi, events, errorCodes, permissionCodes, auditActions } = result;

  const domains = [...new Set(rows.map((row) => row.domain))].sort();
  const lines = [];
  lines.push('<!-- Generated by scripts/p1-24-operation-register.mjs. Do not edit by hand. -->');
  lines.push('');
  lines.push('# P1-24 — integrated operation register');
  lines.push('');
  lines.push(
    'Derived from the operation registry, the published contract and the committed catalogs.',
    'Regenerate with `node scripts/p1-24-operation-register.mjs`; CI runs it with `--check`.'
  );
  lines.push('');
  lines.push('## Totals');
  lines.push('');
  lines.push('| Measure | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Public operations | ${rows.length} |`);
  lines.push(`| Domains (modules) | ${domains.length} |`);
  lines.push(`| OpenAPI paths | ${openapi.pathCount} |`);
  lines.push(`| OpenAPI operations | ${openapi.operationCount} |`);
  lines.push(`| OpenAPI schemas | ${openapi.schemaCount} |`);
  lines.push(`| OpenAPI security schemes | ${openapi.securitySchemeCount} |`);
  lines.push(`| Permission codes seeded | ${permissionCodes.size} |`);
  lines.push(`| Audit actions catalogued | ${auditActions.size} |`);
  lines.push(`| Domain events catalogued | ${events.length} |`);
  lines.push(`| Structured error codes | ${errorCodes.size} |`);
  lines.push('');
  lines.push('## Coverage classification');
  lines.push('');
  lines.push('| Classification | Operations |');
  lines.push('| --- | --- |');
  for (const state of ['Covered', 'Partially covered', 'Uncovered', 'Not applicable', 'Blocked']) {
    lines.push(`| ${state} | ${counts[state] ?? 0} |`);
  }
  lines.push('');
  lines.push('## Domains');
  lines.push('');
  lines.push('| Domain | Operations | Covered | Writes | Audited | Idempotent | Version-guarded |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const domain of domains) {
    const scoped = rows.filter((row) => row.domain === domain);
    lines.push(
      `| ${domain} | ${scoped.length} | ${scoped.filter((r) => r.classification === 'Covered').length} | ` +
        `${scoped.filter((r) => r.method !== 'GET').length} | ` +
        `${scoped.filter((r) => r.auditClass !== 'none').length} | ` +
        `${scoped.filter((r) => r.idempotent).length} | ` +
        `${scoped.filter((r) => r.versionGuarded).length} |`
    );
  }
  lines.push('');
  lines.push('## Operations');
  lines.push('');
  lines.push(
    '| Operation | Method | Route | Scope | Permissions | Audit | Idem | Ver | Evidence | Class |'
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of rows) {
    lines.push(
      `| \`${row.id}\` | ${row.method} | \`${row.route}\` | ${row.scope} | ` +
        `${row.public ? '_public_' : row.permissions.map((p) => `\`${p}\``).join('<br>')} | ` +
        `${row.auditClass === 'none' ? '—' : row.auditAction} | ` +
        `${row.idempotent ? 'yes' : '—'} | ${row.versionGuarded ? 'yes' : '—'} | ` +
        `${row.providedEvidence.join(' ') || '—'} | ${row.classification} |`
    );
  }
  lines.push('');
  lines.push('## Event catalog');
  lines.push('');
  lines.push('| Code | Event type | v | Aggregate | Owner | Implemented in |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const event of events) {
    lines.push(
      `| ${event.code} | \`${event.eventType}\` | ${event.schemaVersion} | ${event.aggregateType} | ${event.owner} | ${event.implementedIn} |`
    );
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const CHECK = process.argv.includes('--check');

let result;
try {
  result = build();
} catch (error) {
  console.error(`p1-24-operation-register: ${error.message}`);
  process.exit(2);
}

const markdown = renderMarkdown(result);
const json = `${JSON.stringify(
  {
    generatedBy: 'scripts/p1-24-operation-register.mjs',
    totals: {
      operations: result.rows.length,
      openapiPaths: result.openapi.pathCount,
      openapiOperations: result.openapi.operationCount,
      openapiSchemas: result.openapi.schemaCount,
      events: result.events.length,
      errorCodes: result.errorCodes.size,
      permissionCodes: result.permissionCodes.size,
      auditActions: result.auditActions.size,
    },
    counts: result.counts,
    operations: result.rows,
  },
  null,
  2
)}\n`;

const prettier = await import('prettier');
const formatted = {
  md: await prettier.format(markdown, { parser: 'markdown', filepath: REGISTER_MD }),
  json: await prettier.format(json, { parser: 'json', filepath: REGISTER_JSON }),
};

if (CHECK) {
  const stale = [];
  for (const [path, content] of [
    [REGISTER_MD, formatted.md],
    [REGISTER_JSON, formatted.json],
  ]) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== content) {
      stale.push(toPosix(relative(ROOT, path)));
    }
  }
  if (stale.length) {
    result.failures.push(
      `generated register is stale: ${stale.join(', ')} — run node scripts/p1-24-operation-register.mjs`
    );
  }
} else {
  await writeFile(REGISTER_MD, formatted.md, 'utf8');
  await writeFile(REGISTER_JSON, formatted.json, 'utf8');
}

console.log(`P1-24 operation register: ${result.rows.length} operations`);
for (const [state, count] of Object.entries(result.counts).sort()) {
  console.log(`  ${state.padEnd(20)} ${count}`);
}
console.log(
  `  OpenAPI ${result.openapi.pathCount} paths / ${result.openapi.operationCount} operations / ${result.openapi.schemaCount} schemas`
);

if (result.failures.length) {
  console.error(`\n${result.failures.length} reconciliation failure(s):`);
  for (const failure of result.failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(CHECK ? '\nOK: register is current and reconciled.' : '\nOK: register regenerated.');
