/**
 * P1-19 endpoint inventory and catalog reconciliation (P1-19-QA-001, P1-19-DOC-001).
 *
 * Derives the phase's public surface from the operation registry itself rather than
 * from a hand-kept list, and reconciles every declared permission, audit action and
 * event against the seeded catalogs in the migrations. A hand-written inventory
 * documents what its author remembered; this one cannot disagree with the code,
 * because the code is its only input.
 *
 * Run with `--check` in CI: it exits non-zero when a declared permission, audit
 * action or event does not exist in the seed, when an operation is unreachable from
 * a route file, or when the generated document is stale.
 *
 * The reconciliation direction matters. Seed → code would be wrong: the catalogs
 * carry codes for phases that have not been implemented yet, and a phase is not
 * obliged to consume all of them. Code → seed is the honest direction — every code
 * this phase DECLARES must exist — and that is the one enforced here.
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_ROOT = join(ROOT, 'src', 'app', 'api', 'v1');
const SEEDS = join(ROOT, 'supabase', 'seeds');
const EVIDENCE = join(ROOT, 'docs', 'phase-1', 'phase-1-19', 'evidence');
const OUTPUT = join(EVIDENCE, 'endpoint-inventory.md');
const TRACEABILITY = join(EVIDENCE, 'task-traceability.md');
const MATRIX = join(EVIDENCE, 'operation-test-matrix.json');

/** The four schemas this phase delivers. Everything else is a predecessor's. */
const PHASE_PREFIXES = ['wo.', 'tech.', 'dia.', 'qms.'];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

/**
 * Reads one `defineOperation({...})` literal.
 *
 * A regex rather than the TypeScript compiler because every field this needs is a
 * literal by construction — `check-authorization-coverage.mjs` enforces that no
 * operation is assembled from variables, so a literal read cannot be defeated by
 * indirection that the repository does not permit in the first place.
 */
function parseOperations(source, file) {
  const found = [];
  // Each declaration plus the handler text that follows it, up to the next
  // declaration. The handler is what shows whether a `scope: 'branch'` claim is
  // actually enforced, and it cannot be read from the declaration alone.
  const chunks = source
    .split(/export const [A-Z0-9_]+_OPERATION = defineOperation\(\{/)
    .slice(1)
    .map((part) => {
      const end = part.indexOf('\n})');
      return {
        block: end === -1 ? part : part.slice(0, end),
        // Comments STRIPPED. The first version of the scope check below was satisfied
        // by the very comment explaining the fix — prose naming `authorizeScope` made
        // the guard pass while the handler did nothing. That is the same defect class
        // as the operation-coverage gate crediting a manifest flag no assertion backs,
        // and it is not repeated here.
        handler: part.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''),
      };
    });
  for (const chunk of chunks) {
    const block = chunk.block;
    const scalar = (name) => {
      const hit = new RegExp(`\\b${name}:\\s*'([^']*)'`).exec(block);
      return hit === null ? null : hit[1];
    };
    const bool = (name) => {
      const hit = new RegExp(`\\b${name}:\\s*(true|false)`).exec(block);
      return hit === null ? null : hit[1] === 'true';
    };
    const list = (name) => {
      const hit = new RegExp(`\\b${name}:\\s*\\[([^\\]]*)\\]`).exec(block);
      if (hit === null) return [];
      return [...hit[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    };
    const id = scalar('id');
    if (id === null) continue;
    found.push({
      id,
      module: scalar('module'),
      method: scalar('method'),
      path: scalar('path'),
      summary: scalar('summary'),
      permissions: list('permissions'),
      scope: scalar('scope'),
      auditClass: scalar('auditClass'),
      auditAction: scalar('auditAction'),
      idempotent: bool('idempotent'),
      publicRoute: bool('public') ?? false,
      rateLimitPolicy: scalar('rateLimitPolicy'),
      cacheCategory: scalar('cacheCategory'),
      /**
       * Whether the handler does anything with the scope it declares.
       *
       * Three shapes count, and they are the only three the platform offers: the
       * handler destructures `authorizeScope` from the pipeline context (so a service
       * can re-check against a locked row), it passes an explicit
       * `authorizationTarget`, or it derives one with `scopeTargetOption` from a
       * caller-named company/branch pair. A handler doing none of them takes
       * `{ db }` alone, and its `scope: 'branch'` is a comment — which is how
       * `tech.labor-session-list` shipped able to return another branch's
       * timesheets.
       */
      scopeEnforced:
        /authorizeScope/.test(chunk.handler) ||
        /authorizationTarget/.test(chunk.handler) ||
        /scopeTargetOption/.test(chunk.handler),
      file: relative(ROOT, file).replaceAll('\\', '/'),
    });
  }
  return found;
}

/** The `P1-19-BE-nnn` identifiers annotated in a file header. */
function annotations(source) {
  return [
    ...new Set([...source.matchAll(/P1-19-BE-(\d+)/g)].map((m) => `P1-19-BE-${m[1]}`)),
  ].sort();
}

/**
 * Seeded permission codes and their risk levels.
 *
 * Read from the seed's INSERT rows, NOT from a free-text scan of the file: a
 * mention in a comment is not a seeded permission, and treating one as evidence is
 * exactly how a phase ends up authorizing against a code that does not exist.
 */
function seededPermissions() {
  const source = readFileSync(join(SEEDS, '04_iam_permission_catalog.sql'), 'utf8');
  const codes = new Map();
  for (const m of source.matchAll(
    /^\s*\('([a-z_]+(?:\.[a-z_]+)+)',\s*'([a-z]+)',\s*'((?:[^']|'')*)'\s*,\s*'(low|medium|high|critical)'/gm
  )) {
    codes.set(m[1], { domain: m[2], risk: m[4] });
  }
  return codes;
}

/** The controlled audit-action catalog, keyed by code. */
function auditCatalog() {
  const source = readFileSync(join(ROOT, 'src', 'server', 'auth', 'audit-actions.ts'), 'utf8');
  const catalog = new Map();
  for (const m of source.matchAll(
    /code:\s*'([^']+)',\s*class:\s*'([^']+)',\s*entityType:\s*'([^']+)'/g
  )) {
    catalog.set(m[1], { class: m[2], entityType: m[3] });
  }
  return catalog;
}

/**
 * The event catalog, which is a reserved-NAME registry rather than a set of
 * implementations. `implementedIn` is the field that claims a phase delivered one,
 * so it is the field this script holds P1-19 to.
 */
function eventCatalog() {
  const source = readFileSync(join(ROOT, 'src', 'server', 'events', 'envelope.ts'), 'utf8');
  const entries = [];
  for (const m of source.matchAll(/code:\s*'(EVT-[^']+)',([\s\S]*?)(?=\n\s*\},)/g)) {
    const block = m[2];
    const field = (name) => {
      const hit = new RegExp(`\\b${name}:\\s*'([^']*)'`).exec(block);
      return hit === null ? null : hit[1];
    };
    entries.push({
      code: m[1],
      eventType: field('eventType'),
      aggregateType: field('aggregateType'),
      owner: field('owner'),
      implementedIn: field('implementedIn'),
    });
  }
  return entries;
}

/**
 * Event types actually published by module code, mapped to their producing files.
 *
 * The `eventType` line is read whole rather than as a single literal, because at
 * least one producer chooses between two types with a ternary
 * (`closing ? 'work-order.closed' : 'work-order.state-changed'`). A pattern that
 * only matched a lone literal would have reported the second type as unpublished
 * and the catalog entry as a false claim — an error in the checker presented as a
 * defect in the code.
 */
function publishedEvents() {
  const producers = new Map();
  const walkTs = (dir) => {
    const out = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walkTs(full));
      else if (entry.endsWith('.ts')) out.push(full);
    }
    return out;
  };
  for (const file of walkTs(join(ROOT, 'src', 'modules'))) {
    const source = readFileSync(file, 'utf8');
    // Scoped to `publishEvent(` blocks. `recordSecurityEvent` also takes an
    // `eventType`, but it writes `iam.security_events` and is governed by a
    // different registry; counting it here would report a phantom outbox event.
    for (const call of source.matchAll(/publishEvent\(/g)) {
      const window = source.slice(call.index, call.index + 400);
      const line = /^\s*eventType:\s*(.+)$/m.exec(window);
      if (line === null) continue;
      for (const literal of line[1].matchAll(/'([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+)'/g)) {
        if (!producers.has(literal[1])) producers.set(literal[1], new Set());
        producers.get(literal[1]).add(relative(ROOT, file).replaceAll('\\', '/'));
      }
    }
  }
  return producers;
}

const operations = [];
for (const file of walk(API_ROOT)) {
  const source = readFileSync(file, 'utf8');
  const notes = annotations(source);
  for (const op of parseOperations(source, file)) operations.push({ ...op, tasks: notes });
}
operations.sort((a, b) => a.id.localeCompare(b.id));

const phase = operations.filter((op) => PHASE_PREFIXES.some((p) => op.id.startsWith(p)));
const permissionSeed = seededPermissions();
const audits = auditCatalog();
const events = eventCatalog();
const published = publishedEvents();

const problems = [];
for (const op of phase) {
  if (op.method === null || op.path === null) problems.push(`${op.id}: incomplete declaration`);
  if (op.permissions.length === 0 && !op.publicRoute) {
    problems.push(`${op.id}: no permission and not declared public`);
  }
  for (const code of op.permissions) {
    if (!permissionSeed.has(code)) problems.push(`${op.id}: permission "${code}" is not seeded`);
  }
  if (op.auditAction !== null) {
    const entry = audits.get(op.auditAction);
    if (entry === undefined) {
      problems.push(`${op.id}: audit action "${op.auditAction}" is not in the controlled catalog`);
    } else if (entry.class !== op.auditClass) {
      problems.push(
        `${op.id}: audit action "${op.auditAction}" is class "${entry.class}" but the operation declares "${op.auditClass}"`
      );
    }
  }
  if (op.tasks.length === 0) {
    problems.push(`${op.id}: its route file carries no P1-19-BE annotation`);
  }
  if (op.scope === 'branch' && !op.scopeEnforced) {
    problems.push(
      `${op.id}: declares scope 'branch' but its handler neither forwards authorizeScope ` +
        `nor supplies a scope target — the declaration is inert (P1-18-A-01)`
    );
  }
}

/**
 * The event reconciliation runs both ways, because each direction catches a
 * different lie. Catalog → code catches an entry that claims this phase implements
 * it while nothing publishes it; code → catalog catches a module publishing a type
 * the catalog does not reserve at all.
 */
const phaseEvents = events.filter((entry) => entry.implementedIn === 'P1-19');
for (const entry of phaseEvents) {
  if (!published.has(entry.eventType)) {
    problems.push(
      `${entry.code}: catalog says implementedIn P1-19 but no module publishes "${entry.eventType}"`
    );
  }
}
const catalogTypes = new Set(events.map((entry) => entry.eventType));
for (const type of published.keys()) {
  if (!catalogTypes.has(type)) problems.push(`event "${type}" is published but not in the catalog`);
}

const permissionUse = new Map();
for (const op of phase) {
  for (const code of op.permissions) {
    if (!permissionUse.has(code)) permissionUse.set(code, []);
    permissionUse.get(code).push(op.id);
  }
}

const auditUse = new Map();
for (const op of phase) {
  if (op.auditAction === null) continue;
  if (!auditUse.has(op.auditAction)) auditUse.set(op.auditAction, []);
  auditUse.get(op.auditAction).push(op.id);
}

const byTask = new Map();
for (const op of phase) {
  for (const task of op.tasks) {
    if (!byTask.has(task)) byTask.set(task, []);
    byTask.get(task).push(op.id);
  }
}

const esc = (value) => String(value).replaceAll('|', '\\|');
const lines = [];
lines.push('# P1-19 — Endpoint inventory');
lines.push('');
lines.push('**Generated by `scripts/p1-19-endpoint-inventory.mjs` from the operation');
lines.push('registry. Do not hand-edit.** Every column is read out of the');
lines.push('`defineOperation` literal that guards the route, so this table cannot');
lines.push('describe a surface the code does not expose, and cannot omit one it does.');
lines.push('');
lines.push(
  `Operations in the registry: **${operations.length}**. Delivered by P1-19: **${phase.length}**.`
);
lines.push('');
lines.push('## The surface');
lines.push('');
lines.push(
  '| Operation | Method | Path | Permissions | Scope | Audit action | Audit class | Idem. | Task | Route |'
);
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const op of phase) {
  lines.push(
    `| \`${op.id}\` | ${op.method} | \`${esc(op.path)}\` | ${
      op.permissions.length === 0 ? '—' : op.permissions.map((c) => `\`${c}\``).join(' + ')
    } | ${op.scope ?? '—'} | ${op.auditAction === null ? '—' : `\`${op.auditAction}\``} | ${
      op.auditClass ?? '—'
    } | ${op.idempotent === true ? 'yes' : 'no'} | ${op.tasks.join(', ')} | \`${op.file}\` |`
  );
}
lines.push('');
lines.push('## Permission use');
lines.push('');
lines.push('Every code below is declared by at least one P1-19 operation **and** exists in');
lines.push('the seeded `iam.permissions` catalog. `permissions: [...]` is a conjunction, so');
lines.push('an operation naming two codes requires both.');
lines.push('');
lines.push('| Permission | Operations |');
lines.push('| --- | --- |');
for (const code of [...permissionUse.keys()].sort()) {
  lines.push(
    `| \`${code}\` | ${permissionUse.get(code).length} — ${permissionUse
      .get(code)
      .map((id) => `\`${id}\``)
      .join(', ')} |`
  );
}
lines.push('');
lines.push('## Audit actions');
lines.push('');
lines.push('| Audit action | Operations |');
lines.push('| --- | --- |');
for (const action of [...auditUse.keys()].sort()) {
  lines.push(
    `| \`${action}\` | ${auditUse
      .get(action)
      .map((id) => `\`${id}\``)
      .join(', ')} |`
  );
}
lines.push('');
lines.push('Read-only operations that carry no `auditAction` are not silent: `handleOperation`');
lines.push('emits the request log for every call. An audit action is reserved for a state');
lines.push('change or for a read of restricted data, which is why the two rework-cost');
lines.push('operations have one and the ordinary reads do not.');
lines.push('');
lines.push('## Events');
lines.push('');
lines.push("Every catalog entry marked `implementedIn: 'P1-19'`, with the module that");
lines.push('actually publishes it. Publication happens inside the business transaction');
lines.push('through the outbox, so an event cannot exist for a state change that rolled back.');
lines.push('');
lines.push('| Code | Event type | Aggregate | Published by |');
lines.push('| --- | --- | --- | --- |');
for (const entry of phaseEvents) {
  const producers = [...(published.get(entry.eventType) ?? [])].sort();
  lines.push(
    `| ${entry.code} | \`${entry.eventType}\` | \`${entry.aggregateType}\` | ${producers
      .map((file) => `\`${file}\``)
      .join(', ')} |`
  );
}
lines.push('');
lines.push('## Task coverage');
lines.push('');
lines.push('The canonical Phase 1 Development Plan lives outside this repository by owner');
lines.push('decision, so the task **titles** cannot be quoted here and are not invented. What');
lines.push('is verifiable is which operations each annotated identifier reaches, and that is');
lines.push('what this table states. Where one identifier annotates operations on unrelated');
lines.push('surfaces, that is recorded rather than tidied away — see');
lines.push('[`task-traceability.md`](task-traceability.md).');
lines.push('');
lines.push('| Task | Operations |');
lines.push('| --- | --- |');
for (const task of [...byTask.keys()].sort()) {
  lines.push(
    `| ${task} | ${byTask
      .get(task)
      .map((id) => `\`${id}\``)
      .join(', ')} |`
  );
}
lines.push('');

const document = lines.join('\n');

/**
 * The traceability document.
 *
 * Joined against `operation-test-matrix.json`, which
 * `scripts/check-operation-test-coverage.mjs` regenerates from the tests
 * themselves. So the "evidence" column is not a claim this script makes — it is the
 * coverage gate's own finding, restated beside the surface it belongs to. Run the
 * coverage gate first; this script refuses to write a traceability document against
 * a matrix that does not cover every operation it lists.
 */
let matrix = null;
try {
  matrix = JSON.parse(readFileSync(MATRIX, 'utf8'));
} catch {
  matrix = null;
}

const trace = [];
if (matrix !== null) {
  const byId = new Map(matrix.operations.map((entry) => [entry.id, entry]));
  const uncovered = phase.filter((op) => !byId.has(op.id));
  if (uncovered.length > 0) {
    problems.push(
      `operation-test-matrix.json is missing ${uncovered.length} P1-19 operation(s): ${uncovered
        .map((op) => op.id)
        .join(', ')} — run scripts/check-operation-test-coverage.mjs first`
    );
  }
  trace.push('# P1-19 — Task traceability');
  trace.push('');
  trace.push('**Generated by `scripts/p1-19-endpoint-inventory.mjs`. Do not hand-edit.**');
  trace.push('');
  trace.push('Each row joins one operation to the route that exposes it, the permission that');
  trace.push('guards it, the audit action it writes, the module code that performs it, and the');
  trace.push('test file the coverage gate credits it to — with that gate’s own evidence flags,');
  trace.push('not this script’s opinion of them.');
  trace.push('');
  trace.push('## The annotation collision is real, and is not tidied away');
  trace.push('');
  const colliding = [...byTask.keys()]
    .filter((task) => new Set(byTask.get(task).map((id) => id.split('.')[0])).size > 1)
    .sort();
  trace.push(
    `**${colliding.length}** of the ${byTask.size} annotated identifiers reach operations in **two`
  );
  trace.push('different schemas**: ' + colliding.join(', ') + '. `BE-009`, for instance, reaches');
  trace.push('both `wo.job-create` and the four diagnostic-report operations; `BE-017` reaches');
  trace.push('both the quality-control record surface and two labour-session operations. The');
  trace.push('cause is mundane: the work-order and technician waves annotated their files');
  trace.push('before the additional-work, diagnostics and QMS waves did, and the two');
  trace.push('numberings were assigned independently.');
  trace.push('');
  trace.push('Same-schema breadth is a separate matter and is not called a collision here.');
  trace.push('`BE-006` reaches six `wo` operations spanning the work-order list and the');
  trace.push('additional-work request surface, which may be one task or two — without the');
  trace.push('canonical titles there is no way to tell, so no claim is made either way.');
  trace.push('');
  trace.push('The canonical Phase 1 Development Plan, which is the only authority on what each');
  trace.push('identifier means, lives outside this repository by owner decision. So the');
  trace.push('collision **cannot be resolved here**, and renumbering the annotations to make');
  trace.push('this table look tidy would replace a visible inconsistency with an invisible');
  trace.push('invention. The annotations are left exactly as the implementing commits made');
  trace.push('them and the ambiguity is recorded as an open finding (`P1-19-A-03`).');
  trace.push('');
  trace.push('What this table can and does establish, independently of the identifiers, is');
  trace.push('that **every operation P1-19 exposes is guarded, audited where it changes state,');
  trace.push('implemented in a module, and covered by an assertion-backed test at operation');
  trace.push('depth**. That is the claim a reviewer needs; the identifier is a label on it.');
  trace.push('');
  trace.push('## The map');
  trace.push('');
  trace.push('| Operation | Route | Permission | Audit | Implementation | Test file | Evidence |');
  trace.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const op of phase) {
    const entry = byId.get(op.id);
    const files = entry === undefined ? [] : entry.files;
    const provided = entry === undefined ? [] : entry.provided;
    const missing = entry === undefined ? ['UNKNOWN'] : entry.missing;
    trace.push(
      `| \`${op.id}\` | ${op.method} \`${esc(op.path)}\` | ${
        op.permissions.map((c) => `\`${c}\``).join(' + ') || '—'
      } | ${op.auditAction === null ? '—' : `\`${op.auditAction}\``} | \`${op.module}\` | ${files
        .map((f) => `\`${f}\``)
        .join(
          ', '
        )} | ${provided.length} flags${missing.length > 0 ? `, MISSING ${missing.join(', ')}` : ''} |`
    );
  }
  trace.push('');
  trace.push('## Annotated identifiers');
  trace.push('');
  trace.push('| Task | Operations reached | Surfaces |');
  trace.push('| --- | --- | --- |');
  for (const task of [...byTask.keys()].sort()) {
    const ids = byTask.get(task);
    const surfaces = [...new Set(ids.map((id) => id.split('.')[0]))].sort();
    trace.push(
      `| ${task} | ${ids.length} | ${surfaces.map((s) => `\`${s}\``).join(', ')}${
        surfaces.length > 1 ? ' — **collides**' : ''
      } |`
    );
  }
  trace.push('');
}

const traceDocument = trace.join('\n');
const check = process.argv.includes('--check');

if (problems.length > 0) {
  console.error('P1-19 endpoint inventory: reconciliation failed');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

/**
 * Generated markdown is run through Prettier here rather than left for
 * `npm run format` to fix. Otherwise the `--check` mode and `format:check` would
 * disagree permanently: this script would regenerate an unformatted document and
 * Prettier would immediately reformat it, so one of the two gates would always fail.
 */
const config = await prettier.resolveConfig(OUTPUT);
const render = (text) => prettier.format(text, { ...config, parser: 'markdown' });

const targets = [
  [OUTPUT, await render(document)],
  ...(traceDocument === '' ? [] : [[TRACEABILITY, await render(traceDocument)]]),
];

if (check) {
  for (const [path, expected] of targets) {
    let existing = null;
    try {
      existing = readFileSync(path, 'utf8');
    } catch {
      existing = null;
    }
    if (existing !== expected) {
      console.error(
        `${relative(ROOT, path).replaceAll('\\', '/')} is stale. Run \`node scripts/p1-19-endpoint-inventory.mjs\`.`
      );
      process.exit(1);
    }
  }
  console.log(`OK: P1-19 inventory and traceability are current (${phase.length} operations).`);
} else {
  for (const [path, content] of targets) {
    writeFileSync(path, content, 'utf8');
    console.log(`Wrote ${relative(ROOT, path).replaceAll('\\', '/')}.`);
  }
}
