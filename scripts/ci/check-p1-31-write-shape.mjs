#!/usr/bin/env node
/**
 * P1-31 write-shape gate (`P1-31-SEC-004`).
 *
 * `apps/web` may not import `apps/api` source, so the request payload a P1-31
 * screen sends is transcribed by hand on the web side. This gate compares that
 * transcription against the real zod schemas of the `wty` and `rpt` writes and
 * fails on drift.
 *
 * ## Why a SIBLING and not a widening of `check-p1-30-payload-parity.mjs`
 *
 * That gate freezes `P1_30_DOMAINS = ['svc', 'quo', 'inv', 'sal']`, its scope is
 * pinned by name in `tests/ci/p1-30-payload-parity.test.ts`, and P1-30's closure
 * rests on it. Adding `wty`/`rpt` there would change a gate another phase's
 * closure depends on; change-control CC-37(a) refuses that. So this file is a
 * separate gate with its own scope, and that one stays byte-identical.
 *
 * The comparison (`compareOperation`), the schema locator (`bodySchemaOf`), the
 * naming rule (`typeNameFor`) and the interface reader (`readMirror`) are the
 * P1-29 gate's own exports, called with this gate's scope and this gate's
 * problem collector. Nothing is copied: a second reader is how the
 * brace-counting scanners drifted, and the P1-29 suite pins the borrowed
 * behaviour. What is this gate's own is the SCOPE, the mirror list, the shared
 * interfaces, and the type-alias resolution described below.
 *
 * ## The mirror lives in the feature trees, not `lib/contracts/`
 *
 * The P1-28 contract allow-list names six files under
 * `apps/web/src/lib/contracts/`, and a P1-31 operation has no row in it. The
 * warranty and reporting mirrors are therefore new source in their feature
 * trees — `features/warranty/warranty-contract.ts` and
 * `features/reports/reports-contract.ts` — and this gate reads exactly those two
 * files, hand-frozen for the reason the P1-29 gate records: a globbed directory
 * would let a stray file become a mirror, and the generated
 * `lib/api/idempotent-operations.ts` manifest already contains every operation
 * id in the form a scanner would match.
 *
 * ## Type ALIASES are resolved; interfaces are still read by `readMirror`
 *
 * These two mirrors spell a closed vocabulary as an exported type alias over an
 * exported `as const` array — `type CoveredScope = (typeof COVERED_SCOPES)[number]`
 * — because the same array is what the screens iterate to draw the control. The
 * P1-29 interface reader deliberately knows nothing about type aliases, so such
 * a field reads as an unresolved reference and every closed enum on this surface
 * would be reported as drift that is not there.
 *
 * So this gate resolves those aliases BEFORE comparing, and only those: an
 * exported alias whose right-hand side is a union of string literals, or
 * `(typeof X)[number]` over an exported array of string literals. That is an
 * ADDITION to the borrowed reader rather than a second copy of it — it reads a
 * construct `readMirror` ignores entirely and leaves every interface it returns
 * untouched. An alias it cannot resolve stays a reference and still fails,
 * which is the safe direction.
 *
 * ## Anti-vacuity, stated rather than pinned
 *
 * No magic counts. The gate asserts RELATIONSHIPS: every in-scope write either
 * carries an extracted body or is named in `BODYLESS` with a reason; the
 * extracted count is non-zero; the mirror declares at least one interface; and
 * at least one operation is actually COMPARED rather than declared pending. That
 * last clause is this gate's own and its siblings do not have it — five of the
 * eleven in-scope writes are declared away (four pending a consumer, one
 * bodyless), and a gate whose whole scope had drifted into `PENDING_MIRRORS`
 * would otherwise pass while comparing nothing.
 *
 *     node scripts/ci/check-p1-31-write-shape.mjs
 *     node scripts/ci/check-p1-31-write-shape.mjs --schemas <path>      # reuse an extraction
 *     node scripts/ci/check-p1-31-write-shape.mjs --mirror-root <dir>   # anti-vacuity proof
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

import { parseModule } from '../lib/typescript-source.mjs';
import {
  ROOT,
  bodySchemaOf,
  compareOperation,
  readMirror,
  typeNameFor,
} from './check-p1-29-payload-parity.mjs';

const slash = (p) => p.split(sep).join('/');

/**
 * The id namespaces this gate holds to a mirror. Deliberately NOT `sal`: every
 * `sal` write is already in the P1-30 gate's scope, and two gates comparing the
 * same operation would make a deletion in either one invisible.
 */
export const P1_31_WRITE_DOMAINS = Object.freeze(['wty', 'rpt']);
const IN_SCOPE = new RegExp(`^(${P1_31_WRITE_DOMAINS.join('|')})\\.`);
const WRITE_METHODS = Object.freeze(['POST', 'PATCH', 'PUT', 'DELETE']);

/** The mirror files, relative to `apps/web/src`. Hand-frozen; see the docblock. */
export const MIRROR_FILES = Object.freeze([
  join('features', 'warranty', 'warranty-contract.ts'),
  join('features', 'reports', 'reports-contract.ts'),
]);

/**
 * Writes in scope that parse NO request body, each with the reason. An entry
 * here must name a write that exists and does not parse a body, or the gate
 * refuses it as stale.
 */
export const BODYLESS = Object.freeze({
  // Publication names the configuration and the version in the path and the
  // caller as publisher. The route parses path parameters only.
  'rpt.report-configuration-version-publish':
    'publication carries nothing but the configuration and the version in the path and the caller as publisher',
});

/**
 * Operations whose mirror interface is SHARED with another operation's, keyed by
 * operation id, valued by the interface the mirror actually declares.
 *
 * The P1-29 naming rule derives one interface name per operation, and its design
 * record's reason for that is facets: two operations whose field names match can
 * differ in a length limit that a TypeScript interface cannot express, so a
 * shared type hides the difference. The warranty mirror shares one
 * `WarrantyStatusSetBody` between the plan-status and the coverage-status
 * commands because both are a single `status` field over the same two-value
 * vocabulary.
 *
 * Declaring the share here rather than silently accepting a missing interface is
 * what keeps it honest: the target must exist, the operation must be in scope,
 * and the moment the mirror declares the operation's OWN name the entry is stale
 * and the gate fails until it is deleted. An entry cannot outlive its reason.
 */
export const SHARED_MIRRORS = Object.freeze({
  'wty.warranty-coverage-status-set': 'WarrantyStatusSetBody',
  'wty.warranty-policy-status-set': 'WarrantyStatusSetBody',
});

/** Field-level omissions the web side has decided, with reasons. Empty today. */
export const DISPOSITIONS = Object.freeze({});

/**
 * Operations whose request-body mirror does not exist, keyed by operation id,
 * each with a `PENDING: ` reason.
 *
 * The four `rpt.report-configuration-*` writes with a body are the original set,
 * and they are here because they have NO consumer: nothing under `apps/web` references them except the
 * generated `lib/api/idempotent-operations.ts` manifest, which is never a
 * mirror. Writing an interface for them would manufacture the
 * declared-but-never-wired shape this gate exists to catch, so they are declared
 * pending with the reason instead — change-control CC-37(b). The fifth
 * configuration write, `rpt.report-configuration-version-publish`, parses no
 * body at all and is declared in `BODYLESS`.
 *
 * `rpt.report-export` is published by the P-12 backend prerequisite before its
 * frontend download control. That next integration must add its consumed mirror
 * and remove this pending entry; backend publication is not frontend completion.
 *
 * `wty.warranty-generate` was declared here for a different reason and no
 * longer is: it HAS a consumer — the handover screen's issue control sends it —
 * and the adapter used to take a structural parameter, so no exported interface
 * carried the shape. The mirror now declares `WarrantyGenerateBody` and the
 * adapter takes it, so the entry was deleted and the operation is compared like
 * any other. It is recorded here as the worked example of the lifecycle below
 * rather than left as a hole the gate discloses but does not close.
 *
 * The lifecycle binds: the moment the mirror declares the interface, the entry
 * is STALE and this gate fails until it is deleted in that same change.
 */
export const PENDING_MIRRORS = Object.freeze({
  'rpt.report-export':
    'PENDING: P-12 backend prerequisite is published before its frontend download control; the next P1-31 frontend integration owes the consumed ReportExportBody mirror',
  'rpt.report-configuration-create':
    'PENDING: no screen or adapter in apps/web calls this write — CC-37(b); the phase that builds the configuration screen owes the mirror',
  'rpt.report-configuration-update':
    'PENDING: no screen or adapter in apps/web calls this write — CC-37(b); the phase that builds the configuration screen owes the mirror',
  'rpt.report-configuration-status-set':
    'PENDING: no screen or adapter in apps/web calls this write — CC-37(b); the phase that builds the configuration screen owes the mirror',
  'rpt.report-configuration-version-create':
    'PENDING: no screen or adapter in apps/web calls this write — CC-37(b); the phase that builds the configuration screen owes the mirror',
});

const problems = [];
const note = (message) => problems.push(message);

function loadRegister() {
  const path = join(ROOT, 'docs', 'phase-1', 'phase-1-24', 'evidence', 'operation-register.json');
  if (!existsSync(path)) {
    console.error(`::error::operation register absent at ${slash(relative(ROOT, path))}`);
    process.exit(2);
  }
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return Array.isArray(raw) ? raw : (raw.operations ?? []);
}

/* -- type aliases ---------------------------------------------------------- */

/** Every string-literal member of a union type node, or null if it is not one. */
function unionMembers(node) {
  if (!node || !ts.isUnionTypeNode(node)) return null;
  const members = [];
  for (const part of node.types) {
    if (!ts.isLiteralTypeNode(part) || !ts.isStringLiteralLike(part.literal)) return null;
    members.push(part.literal.text);
  }
  return members.length > 0 ? members : null;
}

/** Every string-literal element of an `as const` array initialiser, or null. */
function constArrayMembers(initializer) {
  let node = initializer;
  while (node && ts.isAsExpression(node)) node = node.expression;
  if (!node || !ts.isArrayLiteralExpression(node)) return null;
  const members = [];
  for (const element of node.elements) {
    if (!ts.isStringLiteralLike(element)) return null;
    members.push(element.text);
  }
  return members.length > 0 ? members : null;
}

/**
 * Exported closed vocabularies declared as a TYPE ALIAS across the mirror files.
 *
 * Two forms, and only two: a union of string literals, and `(typeof X)[number]`
 * over an exported array of string literals in the same file. Anything else is
 * left unresolved on purpose — an alias this cannot read stays a reference and
 * the comparison reports it, which is the safe direction.
 */
export function readTypeAliases(mirrorRoot, files = MIRROR_FILES, report = note) {
  const aliases = new Map();

  for (const rel of files) {
    const path = join(mirrorRoot, rel);
    if (!existsSync(path)) continue;
    const file = parseModule(readFileSync(path, 'utf8'));
    if (!file) {
      report(`mirror file does not parse: ${slash(rel)}`);
      continue;
    }

    const arrays = new Map();
    for (const stmt of file.statements) {
      if (!ts.isVariableStatement(stmt)) continue;
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const members = constArrayMembers(decl.initializer);
        if (members) arrays.set(decl.name.text, members);
      }
    }

    for (const stmt of file.statements) {
      if (!ts.isTypeAliasDeclaration(stmt)) continue;
      if (!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      const name = stmt.name.text;

      const direct = unionMembers(stmt.type);
      if (direct) {
        aliases.set(name, direct);
        continue;
      }

      // `(typeof COVERED_SCOPES)[number]`. The object half arrives PARENTHESIZED
      // — that is the only way the construct can be written — so the wrapper is
      // unwrapped rather than assumed away; a version of this that read
      // `objectType` directly resolved nothing and reported every closed
      // vocabulary on the surface as drift.
      const t = stmt.type;
      if (!ts.isIndexedAccessTypeNode(t)) continue;
      if (t.indexType.kind !== ts.SyntaxKind.NumberKeyword) continue;
      let object = t.objectType;
      while (ts.isParenthesizedTypeNode(object)) object = object.type;
      if (!ts.isTypeQueryNode(object) || !ts.isIdentifier(object.exprName)) continue;
      const members = arrays.get(object.exprName.text);
      if (members) aliases.set(name, members);
    }
  }
  return aliases;
}

/**
 * A copy of the interface map with every field whose type is a resolvable alias
 * rewritten as the enum it stands for. Nothing else is touched, and the input
 * map is left alone.
 */
export function resolveAliases(interfaces, aliases) {
  const substitute = (field) => {
    if (field.kind === 'array' && field.element) {
      return { ...field, element: substitute(field.element) };
    }
    if (field.kind !== 'ref' || !aliases.has(field.name)) return field;
    return { ...field, kind: 'enum', members: aliases.get(field.name) };
  };

  const out = new Map();
  for (const [name, iface] of interfaces) {
    const fields = new Map();
    for (const [field, described] of iface.fields) fields.set(field, substitute(described));
    out.set(name, { ...iface, fields });
  }
  return out;
}

/* -- scope ----------------------------------------------------------------- */

/** The in-scope writes and, for each, the zod export its handler parses. */
export function inScopeBodies(register = loadRegister()) {
  const scope = register.filter((op) => IN_SCOPE.test(op.id ?? ''));
  const writes = scope.filter((op) => WRITE_METHODS.includes(op.method));
  const bodies = [];
  for (const op of writes) {
    const path = join(ROOT, op.file);
    const source = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const schema = bodySchemaOf(source, op.method);
    if (schema) bodies.push({ id: op.id, schema, file: op.file });
    else if (!(op.id in BODYLESS)) {
      note(`${op.id} (${op.method}) parses no request body and is not declared in BODYLESS`);
    }
  }
  return { scope, writes, bodies };
}

/**
 * Turns each located zod export into canonical JSON Schema by running the
 * extraction test under vitest — the only place the route modules can be
 * imported with their aliases resolved.
 */
function extract(rows) {
  const dir = mkdtempSync(join(tmpdir(), 'p131-write-shape-'));
  const inPath = join(dir, 'operations.json');
  const outPath = join(dir, 'schemas.json');
  writeFileSync(inPath, `${JSON.stringify(rows, null, 2)}\n`);
  execFileSync(
    'npx',
    ['vitest', 'run', 'tests/ci/p1-31-write-shape-extraction.test.ts', '--reporter=dot'],
    {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      env: { ...process.env, P1_31_OPERATIONS: inPath, P1_31_SCHEMAS: outPath },
      maxBuffer: 64 * 1024 * 1024,
    }
  );
  return { inPath, outPath, dir };
}

/* -- main ------------------------------------------------------------------ */

function main() {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? undefined : process.argv[i + 1];
  };
  const { scope, writes, bodies } = inScopeBodies();

  for (const id of Object.keys(BODYLESS)) {
    if (!writes.some((op) => op.id === id)) {
      note(`BODYLESS names \`${id}\`, which is not a P1-31 write in scope — stale entry`);
    }
    if (bodies.some((b) => b.id === id)) {
      note(
        `BODYLESS names \`${id}\`, but it DOES parse a body — the allow-list is hiding a mirror row`
      );
    }
  }

  for (const id of Object.keys(PENDING_MIRRORS)) {
    if (!writes.some((op) => op.id === id)) {
      note(`PENDING_MIRRORS names \`${id}\`, which is not a P1-31 write in scope — stale entry`);
    }
  }

  // ANTI-VACUITY. A gate pointed at nothing extracts nothing and must die here.
  if (bodies.length === 0) {
    note('extracted ZERO request bodies — the gate is examining nothing');
  }

  const schemasArg = arg('schemas');
  let schemas = {};
  if (schemasArg) {
    schemas = JSON.parse(readFileSync(schemasArg, 'utf8'));
  } else if (bodies.length > 0) {
    const { outPath } = extract(bodies);
    schemas = JSON.parse(readFileSync(outPath, 'utf8'));
  }

  const mirrorRoot = arg('mirror-root') ?? join(ROOT, 'apps', 'web', 'src');
  const declared = readMirror(mirrorRoot, MIRROR_FILES, note);
  const aliases = readTypeAliases(mirrorRoot, MIRROR_FILES, note);
  const interfaces = resolveAliases(declared, aliases);

  if (interfaces.size === 0) {
    note(
      'the mirror declares ZERO interfaces — a gate with nothing to compare against passes vacuously'
    );
  }

  // The shared interfaces, checked in both directions before anything uses them.
  for (const [id, target] of Object.entries(SHARED_MIRRORS)) {
    if (!writes.some((op) => op.id === id)) {
      note(`SHARED_MIRRORS names \`${id}\`, which is not a P1-31 write in scope — stale entry`);
      continue;
    }
    if (Object.hasOwn(PENDING_MIRRORS, id)) {
      note(`${id}: declared both SHARED with \`${target}\` and PENDING — one of the two is untrue`);
      continue;
    }
    const own = typeNameFor(id);
    if (interfaces.has(own)) {
      note(
        `${id}: SHARED_MIRRORS entry is STALE — the mirror now declares its own \`${own}\`; delete the entry`
      );
      continue;
    }
    const shared = interfaces.get(target);
    if (!shared) {
      note(`${id}: SHARED_MIRRORS points at \`${target}\`, which no mirror file declares`);
      continue;
    }
    interfaces.set(own, shared);
  }

  let compared = 0;
  for (const body of bodies) {
    const schema = schemas[body.id];
    if (!schema) {
      note(`${body.id}: no schema extracted`);
      continue;
    }
    if (!Object.hasOwn(PENDING_MIRRORS, body.id)) compared += 1;
    for (const problem of compareOperation({
      operationId: body.id,
      schema,
      interfaces,
      dispositions: DISPOSITIONS,
      pendingMirrors: PENDING_MIRRORS,
    })) {
      note(problem);
    }
  }

  // ANTI-VACUITY, this gate's own: a scope that has drifted entirely into
  // PENDING_MIRRORS compares nothing and must not read as health.
  if (bodies.length > 0 && compared === 0) {
    note(
      'every in-scope write is declared PENDING — the gate compared no operation against its mirror'
    );
  }

  console.log(
    `P1-31 write shape [${P1_31_WRITE_DOMAINS.join(', ')}]: ${scope.length} operation(s) in scope, ` +
      `${writes.length} write(s), ${bodies.length} with a body, ` +
      `${Object.keys(BODYLESS).length} declared bodyless, ` +
      `${Object.keys(PENDING_MIRRORS).length} pending a consumer, ` +
      `${compared} compared against ${interfaces.size} mirror interface(s) and ${aliases.size} resolved alias(es).`
  );
  console.log(
    '  REQUESTS only. Responses are NOT statically gated. Length, pattern and array-cardinality ' +
      'facets are NOT compared: a TypeScript interface cannot carry them.'
  );
  if (problems.length > 0) {
    for (const problem of problems) console.error(`::error::${problem}`);
    console.error(`  ${problems.length} problem(s).`);
    process.exit(1);
  }
  console.log('  0 problem(s).');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
