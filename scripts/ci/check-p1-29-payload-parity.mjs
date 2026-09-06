#!/usr/bin/env node
/**
 * P1-29 request-payload parity gate (`PRE-P1-29-BR-08c`).
 *
 * `apps/web` may not import `apps/api` source, so the request payload shapes are
 * transcribed by hand on the web side. This gate compares that transcription
 * against the real zod schemas and fails on drift.
 *
 * ## What it does NOT check, said here rather than left to be inferred
 *
 * **Responses are not gated.** No machine-readable response source exists in this
 * repository: routes return service values, the only statement of a response shape
 * is a TypeScript interface, and `ts.createProgram` appears nowhere. `BR-08b` gave
 * eight anonymous response envelopes names; naming them did not make them
 * comparable. A green run of this gate says nothing whatsoever about responses.
 *
 * **Facets are not compared**, because a TypeScript interface cannot carry them:
 * `minLength`, `maxLength`, `maxItems`, `pattern`, `.refine` predicates, `.trim()`
 * and the `z.coerce` input side are all invisible on the mirror side. That is
 * precisely why the mirror declares one type per operation and never shares a type
 * between two — see `docs/phase-1/pre-p1-29-backend-remediation/br-08c-design-decisions.md`
 * §4 and §5. Two operations whose field names match can have an eightfold
 * difference in a length limit (`description` is 4000 on
 * `wo.additional-work-detail-record` and 500 on `wo.required-part-record`), and
 * nothing here would see it.
 *
 * ## Why it is a SIBLING of the P1-28 gate rather than a generalisation of it
 *
 * `check-p1-28-adapter-reachability.mjs` is what P1-28's seal rests on. Widening it
 * to cover P1-29 would change a gate a sealed phase depends on, so this is a
 * separate file and that one stays byte-identical.
 *
 * ## The anti-vacuity problem, and why there are no magic numbers here
 *
 * The contract specified "extracted bodies == 34, bodyless == {tech.labor-session-stop}".
 * Both were measured at 305 operations; the tree is at 334 and every intervening
 * slice landed in these four domains, so the live figures are 48 and three. A
 * hard-coded 34 would fail on its first run, and the tempting repair — relaxing the
 * assertion until it passes — deletes the protection the assertion existed for.
 *
 * So the gate computes and asserts a RELATIONSHIP instead: every P1-29 write either
 * carries an extracted body or is named in `BODYLESS` with a reason, and the
 * extracted count is non-zero. A gate pointed at the wrong directory extracts zero
 * and dies on the non-zero clause; a mirror that quietly shrinks cannot pass,
 * because every absence has to be written down.
 *
 *     node scripts/ci/check-p1-29-payload-parity.mjs
 *     node scripts/ci/check-p1-29-payload-parity.mjs --schemas <path>   # reuse an extraction
 *     node scripts/ci/check-p1-29-payload-parity.mjs --mirror-root <dir>  # C1 anti-vacuity
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

import { parseModule } from '../lib/typescript-source.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const ROOT = join(HERE, '..', '..');
const slash = (p) => p.split(sep).join('/');

/** The four domains P1-29 owns. */
export const P1_29_DOMAINS = Object.freeze(['wo', 'dia', 'qms', 'tech']);
const IN_SCOPE = new RegExp(`^(${P1_29_DOMAINS.join('|')})\\.`);
const WRITE_METHODS = Object.freeze(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * The mirror, frozen BY NAME.
 *
 * §2.4's vacuity trap is why this is a hand-written list and not a directory scan:
 * `apps/web/src/lib/api/idempotent-operations.ts` is GENERATED from the backend
 * register and already contains all 87 operation ids in the exact form a scanner
 * would match. A gate that globbed a directory, or that added the manifest to this
 * list, would pass every operation on day one with no mirror written at all.
 */
export const MIRROR_FILES = Object.freeze([
  join('lib', 'contracts', 'work-order-contract.ts'),
  join('lib', 'contracts', 'diagnostics-contract.ts'),
  join('lib', 'contracts', 'quality-contract.ts'),
  join('lib', 'contracts', 'technician-contract.ts'),
]);

/** Never a mirror file, whatever else changes. Named, so a scan cannot re-admit it. */
export const NEVER_A_MIRROR = Object.freeze(['idempotent-operations.ts']);

/** Writes that legitimately carry no request body — each with its reason. */
export const BODYLESS = Object.freeze({
  'tech.labor-session-stop':
    'stopping a session carries no operator input; the stop instant is the server clock',
  'tech.technician-availability-withdraw': 'a DELETE identified entirely by its path',
  'tech.technician-skill-withdraw': 'a DELETE identified entirely by its path',
});

/** Field-level dispositions for fields the mirror deliberately omits. */
export const DISPOSITION_STATES = Object.freeze(['PENDING', 'DELIBERATELY_ABSENT']);

/**
 * Backend fields the mirror does not carry, each with a reason.
 *
 * Keyed `<operation id>.<dotted field path>`. An omission that is NOT listed here
 * fails the gate — that is the difference between an honest subset and a dropped
 * field, and §2.4's deliberate-subset trap is why the distinction has to be
 * declared rather than inferred.
 */
/*
 * EMPTY, and that is the intended resting state.
 *
 * It held exactly one entry, `wo.job-update.departmentId`, from PRE-P1-29 BR-02
 * until P1-29 `W3`. BR-02 added the field to the API body and could not add it
 * to the mirror — `work-order-contract.ts` is classified `web`, and the
 * phase-ownership gate refuses a Backend branch that edits it — so the two gates
 * would have disagreed unless the omission was declared. It was declared
 * PENDING rather than DELIBERATELY_ABSENT, because the mirror SHOULD carry the
 * field: it was owed by the web lane, not renounced.
 *
 * `W3` is that lane and the work-order detail is the field's first caller, so
 * the mirror now carries it and the entry is GONE rather than left standing as
 * a satisfied exception. A disposition that outlives its reason is how a gate
 * stops meaning anything.
 */
export const DISPOSITIONS = Object.freeze({});

/**
 * Operations whose request-body mirror does not exist yet, keyed by operation id,
 * each with a `PENDING: ` reason. The operation-level counterpart of a PENDING
 * field disposition, and it exists for the same reason that one did: a Backend
 * slice can add an operation and cannot add its mirror interface, because
 * `work-order-contract.ts` is classified `web` and the phase-ownership gate
 * refuses a Backend branch that edits it. Left undeclared, the two gates would
 * disagree; declared DELIBERATELY_ABSENT, an operation the web lane is expected
 * to call would read as renounced. So the only state this map admits is PENDING.
 *
 * An entry cannot outlive its reason: once the mirror declares the interface the
 * entry is STALE and fails the gate, so the web slice that writes the mirror
 * must delete the entry in the same change. An entry without a reason fails too.
 *
 * EMPTY since P1-29 W8, which wrote `JobBlockerRaiseBody` and `JobBlockerResolveBody`
 * into the mirror as the first web slice to raise and resolve a blocker; the two
 * entries W6 declared were deleted in that same change, as the rule requires.
 */
export const PENDING_MIRRORS = Object.freeze({});

const problems = [];
const note = (message) => problems.push(message);

/**
 * Compare ONE operation's schema against the mirror, with the disposition policy
 * passed in rather than read from module state.
 *
 * Exported so `C8`/`C9` can vary the policy without rewriting the gate. The first
 * version of those cases copied this whole file to `scripts/ci/zz-c8-gate.mjs`
 * with a different `DISPOSITIONS` literal, ran it, and deleted it — which raced
 * `tests/ci/dependency-path-proof.test.ts`, a file that enumerates
 * `scripts/ci/*.mjs` and reads each one. It listed the copy and read it after the
 * delete, failed to COLLECT, contributed zero assertions, and vitest reported
 * `numFailedTests: 0` — so the run ledger recorded a green tier over a test file
 * that never ran. A gate whose own tests can manufacture a false green is worse
 * than no gate.
 *
 * Separating the policy DATA from the comparison LOGIC removes the need for a
 * copy at all, which is the fix rather than a workaround.
 */
export function compareOperation({
  operationId,
  schema,
  interfaces,
  dispositions = {},
  pendingMirrors = {},
}) {
  const found = [];
  const ctx = { note: (m) => found.push(m), dispositions };
  const typeName = typeNameFor(operationId);
  const iface = interfaces.get(typeName);
  if (Object.hasOwn(pendingMirrors, operationId)) {
    const reason = pendingMirrors[operationId];
    if (typeof reason !== 'string' || !/^PENDING: \S/.test(reason)) {
      return [`${operationId}: PENDING_MIRRORS entry carries no PENDING reason`];
    }
    if (iface) {
      return [
        `${operationId}: PENDING_MIRRORS entry is STALE — the mirror now declares \`${typeName}\`; delete the entry`,
      ];
    }
    return [];
  }
  if (!iface) return [`${operationId}: the mirror declares no \`${typeName}\``];
  compareShape(ctx, operationId, '', schema, iface, interfaces);
  return found;
}

/* -- the operation surface ------------------------------------------------- */

function loadRegister() {
  const path = join(ROOT, 'docs', 'phase-1', 'phase-1-24', 'evidence', 'operation-register.json');
  if (!existsSync(path)) {
    console.error(`::error::operation register absent at ${slash(relative(ROOT, path))}`);
    process.exit(2);
  }
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return Array.isArray(raw) ? raw : (raw.operations ?? []);
}

/**
 * Which exported schema does THIS operation's handler parse its body with?
 *
 * Parsed, not grepped. A route module can export several schemas (`Body`,
 * `PatchBody`) and host several handlers, so the identifier has to come from the
 * call inside the right handler — a file-level regex would attribute one method's
 * schema to another, which is the per-file attribution defect the P1-19 endpoint
 * inventory carried until `BR-06`.
 */
export function bodySchemaOf(source, method) {
  const file = parseModule(source);
  if (!file) return null;
  let found = null;

  const handler = file.statements.find(
    (s) => ts.isFunctionDeclaration(s) && s.name?.text === method
  );
  if (!handler) return null;

  const visit = (node) => {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const fn = node.expression.text;
      const args = node.arguments;
      // parseJsonBody(request, Schema)
      if (fn === 'parseJsonBody' && args.length >= 2 && ts.isIdentifier(args[1])) {
        found = args[1].text;
      }
      // parseOrFail(Schema, value, 'body')
      if (
        fn === 'parseOrFail' &&
        args.length >= 3 &&
        ts.isIdentifier(args[0]) &&
        ts.isStringLiteralLike(args[2]) &&
        args[2].text === 'body'
      ) {
        found = args[0].text;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(handler);
  return found;
}

/* -- the mirror ------------------------------------------------------------ */

/** `wo.job-create` -> `JobCreateBody`. */
export function typeNameFor(operationId) {
  const tail = operationId.slice(operationId.indexOf('.') + 1);
  return `${tail
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')}Body`;
}

/** Field name -> {optional, kind, union, nested}. `kind` is the comparable half. */
function readInterface(decl) {
  const fields = new Map();
  let indexSignature = false;

  for (const member of decl.members) {
    if (ts.isIndexSignatureDeclaration(member)) {
      indexSignature = true;
      continue;
    }
    if (!ts.isPropertySignature(member) || !member.name) continue;
    const name = member.name.getText();
    const optional = Boolean(member.questionToken);
    const t = member.type;
    fields.set(name, { optional, ...describeType(t) });
  }
  return { fields, indexSignature };
}

function describeType(t) {
  if (!t) return { kind: 'unknown' };
  if (ts.isArrayTypeNode(t)) return { kind: 'array', element: describeType(t.elementType) };
  if (ts.isTypeOperatorNode(t) && t.operator === ts.SyntaxKind.ReadonlyKeyword) {
    return describeType(t.type);
  }
  if (ts.isUnionTypeNode(t)) {
    const parts = t.types.map((x) => describeType(x));
    const literals = parts.filter((p) => p.kind === 'literal').map((p) => p.value);
    const nullable = parts.some((p) => p.kind === 'null');
    const rest = parts.filter((p) => p.kind !== 'literal' && p.kind !== 'null');
    if (literals.length) return { kind: 'enum', members: literals, nullable };
    if (rest.length === 1) return { ...rest[0], nullable };
    return { kind: 'union', parts, nullable };
  }
  if (ts.isLiteralTypeNode(t)) {
    if (t.literal.kind === ts.SyntaxKind.NullKeyword) return { kind: 'null' };
    if (t.literal.kind === ts.SyntaxKind.TrueKeyword) return { kind: 'literal', value: true };
    if (t.literal.kind === ts.SyntaxKind.FalseKeyword) return { kind: 'literal', value: false };
    if (ts.isStringLiteralLike(t.literal)) return { kind: 'literal', value: t.literal.text };
    return { kind: 'literal', value: t.literal.getText() };
  }
  switch (t.kind) {
    case ts.SyntaxKind.StringKeyword:
      return { kind: 'string' };
    case ts.SyntaxKind.NumberKeyword:
      return { kind: 'number' };
    case ts.SyntaxKind.BooleanKeyword:
      return { kind: 'boolean' };
    default:
      break;
  }
  if (ts.isTypeReferenceNode(t)) return { kind: 'ref', name: t.typeName.getText() };
  return { kind: 'unknown' };
}

/** Every exported interface across the frozen mirror list. */
/**
 * `files` and `report` are parameters so a SIBLING gate (P1-30's) can read its
 * own mirror list and collect its own problems without copying this reader —
 * two copies of a reader is how the brace-counting scanners drifted. Both
 * default to this module's own list and `note`, so every existing call is
 * byte-for-byte the same behaviour.
 */
export function readMirror(mirrorRoot, files = MIRROR_FILES, report = note) {
  const interfaces = new Map();
  const seenIn = new Map();

  for (const rel of files) {
    const path = join(mirrorRoot, rel);
    if (!existsSync(path)) {
      report(`mirror file absent: ${slash(rel)}`);
      continue;
    }
    if (NEVER_A_MIRROR.some((banned) => path.endsWith(banned))) {
      report(`${slash(rel)} is on NEVER_A_MIRROR and must not be read as a mirror`);
      continue;
    }
    const file = parseModule(readFileSync(path, 'utf8'));
    if (!file) {
      report(`mirror file does not parse: ${slash(rel)}`);
      continue;
    }
    for (const stmt of file.statements) {
      if (!ts.isInterfaceDeclaration(stmt)) continue;
      const exported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!exported) continue;
      const name = stmt.name.text;
      if (interfaces.has(name)) {
        report(`interface \`${name}\` is declared twice — ${seenIn.get(name)} and ${slash(rel)}`);
        continue;
      }
      interfaces.set(name, readInterface(stmt));
      seenIn.set(name, slash(rel));
    }
  }
  return interfaces;
}

/* -- the comparison -------------------------------------------------------- */

const JSON_PRIMITIVE = {
  string: 'string',
  number: 'number',
  integer: 'number',
  boolean: 'boolean',
};

/** Compare one operation's schema against one mirror interface. */
function compareShape(ctx, operationId, path, schema, iface, interfaces) {
  const note = ctx.note;
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const names = Object.keys(props);

  // The open record: nothing to enumerate, so an index signature IS the check.
  if (
    names.length === 0 &&
    schema.additionalProperties &&
    typeof schema.additionalProperties === 'object'
  ) {
    if (!iface.indexSignature) {
      note(
        `${operationId}${path}: backend is an OPEN RECORD but the mirror declares no index signature`
      );
    }
    return;
  }

  for (const name of names) {
    const spec = props[name];
    const field = iface.fields.get(name);
    if (!field) {
      const key = `${operationId}${path}.${name}`;
      const declared = ctx.dispositions[key];
      if (!declared) {
        note(
          `${operationId}${path}.${name}: present on the API, absent from the mirror, and NOT declared in DISPOSITIONS`
        );
      } else if (!DISPOSITION_STATES.includes(declared.state)) {
        note(
          `${key}: disposition \`${declared.state}\` is not one of ${DISPOSITION_STATES.join('/')}`
        );
      } else if (!String(declared.reason ?? '').trim()) {
        note(`${key}: disposition ${declared.state} carries no reason`);
      }
      continue;
    }

    const shouldBeRequired = required.has(name);
    if (shouldBeRequired === field.optional) {
      note(
        `${operationId}${path}.${name}: API says ${shouldBeRequired ? 'REQUIRED' : 'optional'}, mirror says ${field.optional ? 'optional' : 'REQUIRED'}`
      );
    }

    compareType(ctx, operationId, `${path}.${name}`, spec, field, interfaces);
  }

  for (const name of iface.fields.keys()) {
    if (!(name in props)) {
      note(`${operationId}${path}.${name}: declared by the mirror and UNKNOWN to the API`);
    }
  }
}

function compareType(ctx, operationId, path, spec, field, interfaces) {
  const note = ctx.note;
  // A pattern-constrained string. The mirror must declare `string` — not a union
  // of literals, and not some other primitive.
  //
  // The first version of this branch `return`ed unconditionally after checking
  // only for an enum, which silently disabled the PRIMITIVE-TYPE comparison for
  // every field carrying a pattern. That is 50 of the surface's 140 fields — 27
  // uuids, 8 ISO date-times, 3 decimal strings, a currency code, a DTC code —
  // exempted to protect the 4 state vocabularies the branch was written for.
  // `toState: string` could be changed to `number`, `boolean`, `string[]`, or a
  // reference to an interface nothing declares, and the gate printed
  // `0 problem(s)`.
  //
  // It was disclosed nowhere: the stated ceiling is that pattern is not compared
  // AS A FACET, which is true and fine. Skipping the type comparison of every
  // field that happens to carry one is a different thing, and the record's own
  // rule for this — "a gate's stated ceiling must never overstate what it checks"
  // — is exactly what it violated.
  if (spec.enum === undefined && spec.pattern !== undefined && spec.type === 'string') {
    if (field.kind === 'enum') {
      note(
        `${operationId}${path}: the API constrains this by PATTERN, not an enum — the vocabulary is tenant-extensible, so the mirror must declare \`string\`, never a union of literals`
      );
    } else if (field.kind !== 'string') {
      note(
        `${operationId}${path}: API is a pattern-constrained string, mirror declares \`${field.kind}\``
      );
    }
    return;
  }

  // `z.literal(v)` — a single-value vocabulary. The mirror must declare the
  // literal, not the wide primitive: `retire: z.literal(true)` is a set-only
  // tombstone flag, and a mirror saying `boolean` would tell a caller they may
  // send `retire: false`, which the API refuses.
  if (spec.const !== undefined) {
    if (field.kind !== 'literal') {
      note(
        `${operationId}${path}: API is the literal \`${String(spec.const)}\`, mirror declares \`${field.kind}\` — a wider type here promises values the API refuses`
      );
      return;
    }
    if (String(field.value) !== String(spec.const)) {
      note(
        `${operationId}${path}: API literal is \`${String(spec.const)}\`, mirror declares \`${String(field.value)}\``
      );
    }
    return;
  }

  if (Array.isArray(spec.enum)) {
    if (field.kind !== 'enum') {
      note(`${operationId}${path}: API is a closed enum, mirror declares \`${field.kind}\``);
      return;
    }
    const a = [...spec.enum].map(String).sort();
    const b = [...field.members].map(String).sort();
    if (a.join(' ') !== b.join(' ')) {
      const missing = a.filter((x) => !b.includes(x));
      const extra = b.filter((x) => !a.includes(x));
      note(
        `${operationId}${path}: enum drift —${missing.length ? ` missing ${missing.join(',')}` : ''}${extra.length ? ` unexpected ${extra.join(',')}` : ''}`
      );
    }
    return;
  }

  if (spec.type === 'array') {
    if (field.kind !== 'array') {
      note(`${operationId}${path}: API is an array, mirror declares \`${field.kind}\``);
      return;
    }
    const element = spec.items ?? {};
    if (element.type === 'object') {
      if (field.element.kind !== 'ref') {
        note(
          `${operationId}${path}[]: API element is an object, mirror declares \`${field.element.kind}\``
        );
        return;
      }
      const nested = interfaces.get(field.element.name);
      if (!nested) {
        note(
          `${operationId}${path}[]: mirror references \`${field.element.name}\`, which no mirror file declares`
        );
        return;
      }
      compareShape(ctx, operationId, `${path}[]`, element, nested, interfaces);
      return;
    }
    const want = JSON_PRIMITIVE[element.type];
    if (want && field.element.kind !== want) {
      note(
        `${operationId}${path}[]: API element is ${want}, mirror declares \`${field.element.kind}\``
      );
    }
    return;
  }

  if (spec.type === 'object') {
    if (field.kind !== 'ref') {
      note(`${operationId}${path}: API is an object, mirror declares \`${field.kind}\``);
      return;
    }
    const nested = interfaces.get(field.name);
    if (!nested) {
      note(
        `${operationId}${path}: mirror references \`${field.name}\`, which no mirror file declares`
      );
      return;
    }
    compareShape(ctx, operationId, path, spec, nested, interfaces);
    return;
  }

  // `anyOf [T, null]` — a nullable field. `describeType` already computes a
  // `nullable` flag from the mirror; the first version computed it and then never
  // compared it, so `string | null` -> `string` and `string` -> `string | null`
  // both passed.
  //
  // Both directions are real drift, and they are opposite mistakes. Dropping
  // `| null` tells a caller a field can never be cleared when the API accepts an
  // explicit null — on `wo.job-update.jobType`, omit means "leave alone" and null
  // means "clear it", and a mirror without the null cannot express the second.
  // Adding `| null` where the API forbids it promises a request that will be
  // refused.
  if (Array.isArray(spec.anyOf)) {
    const nonNull = spec.anyOf.find((x) => x.type !== 'null');
    const apiNullable = spec.anyOf.some((x) => x.type === 'null');
    if (apiNullable && !field.nullable) {
      note(
        `${operationId}${path}: API accepts null, mirror does not — an explicit null is how this field is CLEARED, and omitting it from the type makes that unreachable`
      );
    }
    // Recurse with nullability already settled at THIS level, or the sub-spec —
    // which is the plain `string` half and carries no null — would read the
    // field's `| null` as an invention of the mirror's.
    if (nonNull) {
      compareType(ctx, operationId, path, nonNull, { ...field, nullable: false }, interfaces);
    }
    return;
  }

  // The other direction: the mirror invents a null the API never accepts.
  if (field.nullable && spec.type !== 'null') {
    note(
      `${operationId}${path}: mirror accepts null, API does not — the type promises a request the API refuses`
    );
  }

  const want = JSON_PRIMITIVE[spec.type];
  if (want && field.kind !== want) {
    note(`${operationId}${path}: API is ${want}, mirror declares \`${field.kind}\``);
  }
}

/* -- extraction ------------------------------------------------------------ */

/**
 * Run the schemas out of the real zod objects, via `vitest`.
 *
 * A `.mjs` script cannot import a TypeScript route module, and reconstructing zod
 * semantics by hand is what `BR-08b` existed to make unnecessary. So the values
 * are read where `@/` resolves and handed back as JSON.
 */
function extract(map) {
  const dir = mkdtempSync(join(tmpdir(), 'p129-parity-'));
  const inPath = join(dir, 'operations.json');
  const outPath = join(dir, 'schemas.json');
  writeFileSync(inPath, `${JSON.stringify(map, null, 2)}\n`);
  execFileSync(
    'npx',
    ['vitest', 'run', 'tests/ci/p1-29-payload-extraction.test.ts', '--reporter=dot'],
    {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      env: { ...process.env, P1_29_OPERATIONS: inPath, P1_29_SCHEMAS: outPath },
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

  const register = loadRegister();
  const scope = register.filter((op) => IN_SCOPE.test(op.id));
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

  for (const id of Object.keys(BODYLESS)) {
    if (!writes.some((op) => op.id === id)) {
      note(`BODYLESS names \`${id}\`, which is not a P1-29 write — stale entry`);
    }
    if (bodies.some((b) => b.id === id)) {
      note(
        `BODYLESS names \`${id}\`, but it DOES parse a body — the allow-list is hiding a mirror row`
      );
    }
  }

  // ANTI-VACUITY. A gate pointed at nothing extracts nothing and must die here.
  if (bodies.length === 0) {
    note('extracted ZERO request bodies — the gate is examining nothing');
  }

  const schemasArg = arg('schemas');
  let schemas;
  if (schemasArg) {
    schemas = JSON.parse(readFileSync(schemasArg, 'utf8'));
  } else {
    const { outPath } = extract(bodies);
    schemas = JSON.parse(readFileSync(outPath, 'utf8'));
  }

  const mirrorRoot = arg('mirror-root') ?? join(ROOT, 'apps', 'web', 'src');
  const interfaces = readMirror(mirrorRoot);

  if (interfaces.size === 0) {
    note(
      'the mirror declares ZERO interfaces — a gate with nothing to compare against passes vacuously'
    );
  }

  for (const body of bodies) {
    const schema = schemas[body.id];
    if (!schema) {
      note(`${body.id}: no schema extracted`);
      continue;
    }
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

  console.log(
    `P1-29 payload parity: ${scope.length} operation(s) in scope, ${writes.length} write(s), ` +
      `${bodies.length} with a body, ${Object.keys(BODYLESS).length} declared bodyless.`
  );
  console.log(
    `  mirror: ${MIRROR_FILES.length} frozen file(s), ${interfaces.size} exported interface(s); ` +
      `${Object.keys(DISPOSITIONS).length} declared field disposition(s); ` +
      `${Object.keys(PENDING_MIRRORS).length} operation(s) whose mirror is declared PENDING` +
      (Object.keys(PENDING_MIRRORS).length ? ` (${Object.keys(PENDING_MIRRORS).join(', ')}).` : '.')
  );
  console.log(
    '  REQUESTS only. Responses are NOT statically gated — no machine-readable response source ' +
      'exists. Length, pattern and array-cardinality facets are NOT compared: a TypeScript ' +
      'interface cannot carry them.'
  );

  if (problems.length) {
    for (const p of problems) console.error(`::error::${p}`);
    console.error(`  ${problems.length} problem(s).`);
    process.exit(1);
  }
  console.log('  0 problem(s).');
}

// Entry-point check, not a filename check: a gate that only runs when it is called
// by one exact name cannot be copied, renamed, or wrapped -- and a test that does
// any of those would silently assert nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
