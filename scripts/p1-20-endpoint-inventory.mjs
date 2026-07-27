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
 *   6. a P1-20 task identifier resolves to no evidence anchor;
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
 * The canonical 27 task identifiers. Every one must resolve to an anchor.
 *
 * The third element is WHERE the anchor has to be:
 *
 *  - `'code'` — under `src/`, `tests/` or `scripts/`. The default, and what every
 *    backend, security, QA and devops task owes: those tasks produce code, and a
 *    document describing code is not evidence the code exists.
 *  - an explicit repo-relative FILE — for a task whose deliverable genuinely is a
 *    document. Naming the exact file is what keeps it from being vacuous: the
 *    identifier has to appear in the artifact the task is about, not in whichever
 *    evidence document happens to tabulate all 27 identifiers.
 *
 * Requiring a code anchor for a documentation task would only teach the next author
 * to paste an identifier into a comment, which is the failure this gate exists to
 * prevent, dressed up as compliance.
 */
const TASKS = Object.freeze([
  ['P1-20-BE-001', 'Service management'],
  ['P1-20-BE-002', 'Branch service availability'],
  ['P1-20-BE-003', 'Standard labour time'],
  ['P1-20-BE-004', 'Price-list selection'],
  ['P1-20-BE-005', 'Tax calculation'],
  ['P1-20-BE-006', 'Discount authorization'],
  ['P1-20-BE-007', 'Quotation creation/versioning/sending'],
  ['P1-20-BE-008', 'Approval'],
  ['P1-20-BE-009', 'Rejection'],
  ['P1-20-BE-010', 'Expiration'],
  ['P1-20-BE-011', 'Revision'],
  ['P1-20-BE-012', 'Approval evidence'],
  ['P1-20-BE-013', 'Additional-work quotation'],
  ['P1-20-BE-014', 'NUMERIC/DECIMAL financial source of truth'],
  ['P1-20-SEC-001', 'Permission and resolved-scope enforcement'],
  ['P1-20-SEC-002', 'Sensitive-data, export, and file-access controls'],
  ['P1-20-SEC-003', 'Abuse-case and privilege-escalation controls'],
  ['P1-20-SEC-004', 'Security audit-event coverage'],
  ['P1-20-QA-001', 'Unit and component test coverage'],
  ['P1-20-QA-002', 'API/contract and error-path coverage'],
  ['P1-20-QA-003', 'Tenant/company/branch isolation coverage'],
  ['P1-20-QA-004', 'Concurrency and idempotency coverage'],
  ['P1-20-QA-005', 'Regression and evidence packaging'],
  ['P1-20-DO-001', 'Continuous-integration quality gate'],
  ['P1-20-DO-002', 'Structured logging, monitoring, and alert routing'],
  ['P1-20-DOC-001', 'Contract, catalog, and traceability synchronization'],
  [
    'P1-20-DOC-002',
    'Operator/developer guidance and change-log update',
    'docs/phase-1/phase-1-20/evidence/change-log.md',
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
    const declaration = part.slice(0, part.indexOf('});'));
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
  const eventCatalog = readFileSync(join(ROOT, 'src', 'server', 'events', 'envelope.ts'), 'utf8');

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
    if (!clean.includes('quotationRevisionRef')) continue;
    if (!clean.includes("'@/modules/quotation'")) {
      failures.push(
        `${relative(ROOT, file).split('\\').join('/')}: cites quotationRevisionRef but does not ` +
          `import '@/modules/quotation', so CommercialApprovalReader may be uninstalled in a ` +
          `process that serves this route first`
      );
    }
  }

  // ---- 6. Every task identifier resolves to an anchor --------------------
  /**
   * NO DOCUMENT counts as an anchor. Only `src/`, `tests/` or `scripts/`.
   *
   * Excluding just this script and the two files it generates was not enough, and
   * an independent review caught it: `task-register.md` is hand-written evidence
   * that prints all 27 identifiers in its tables, so five of them (`BE-002`,
   * `BE-003`, `BE-009`, `BE-010`, `DOC-001`) resolved to that file and nothing
   * else. The gate could then never fail — deleting every P1-20 source and test
   * file would still have reported 27/27.
   *
   * The rule is now structural rather than a blacklist: `docs/` is not searched at
   * all, so an identifier must appear in code, a test, or a gate script. A document
   * may still *describe* a task, and should, but describing it is not evidence that
   * it exists.
   *
   * This script IS searched, because it is itself the CI quality gate and the
   * traceability generator, which is real work for three of the tasks. But its
   * `TASKS` declaration is blanked out first: that array is the gate's INPUT, and a
   * gate whose input satisfies its own assertion asserts nothing.
   */
  const anchors = new Map();
  const searchRoots = [join(ROOT, 'src'), join(ROOT, 'tests'), join(ROOT, 'scripts')];
  const SELF = relative(ROOT, fileURLToPath(import.meta.url))
    .split('\\')
    .join('/');
  const haystack = [];
  for (const root of searchRoots) {
    if (!existsSync(root)) continue;
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of readdirSync(current)) {
        const full = join(current, entry);
        if (statSync(full).isDirectory()) stack.push(full);
        else if (/\.(ts|mjs|md)$/.test(entry)) {
          const name = relative(ROOT, full).split('\\').join('/');
          const text = readFileSync(full, 'utf8');
          haystack.push([
            name,
            name === SELF ? text.replace(/const TASKS =[\s\S]*?\n\]\);/, '') : text,
          ]);
        }
      }
    }
  }
  for (const [id, , where] of TASKS) {
    if (where !== undefined && where !== 'code') {
      // A DOCUMENT task, anchored in the one named artifact. Read directly rather than
      // searched, so a mention anywhere else in `docs/` cannot satisfy it.
      const abs = join(ROOT, where);
      const present = existsSync(abs) && readFileSync(abs, 'utf8').includes(id);
      anchors.set(id, present ? [where] : []);
      if (!present) {
        failures.push(`${id}: not named in ${where}, the artifact this task delivers`);
      }
      continue;
    }
    const hits = haystack.filter(([, text]) => text.includes(id)).map(([file]) => file);
    anchors.set(id, hits);
    if (hits.length === 0) {
      failures.push(`${id}: no evidence anchor — the identifier appears nowhere in the repository`);
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
