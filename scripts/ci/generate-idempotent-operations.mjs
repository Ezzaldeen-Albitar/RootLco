#!/usr/bin/env node
/**
 * Derives the Web client's idempotency manifest from the PUBLISHED contract
 * (`P1-27-INT-003`).
 *
 * ## Why this file exists
 *
 * The Web API client used to decide "does this request need an
 * `Idempotency-Key`?" from the HTTP method: POST yes, everything else no. That
 * is not a contract, it is a guess, and it was wrong for **nine** operations —
 * six PUT and three PATCH. Each answered `400 ERR-INT-002` *before authorization
 * was even evaluated*, so the screen looked broken rather than misconfigured.
 * That is `P1-26-F-015` in a second place.
 *
 * The backend's rule is not a method rule. `route-handler.ts` reads
 * `operation.idempotent` off the registration, and the generated OpenAPI
 * document expresses exactly that: an idempotent operation lists the
 * `IdempotencyKey` parameter, and a non-idempotent one does not. So the
 * authority already exists and is published — the client simply was not reading
 * it.
 *
 * ## Why a generated manifest rather than reading the document at runtime
 *
 * `docs/api/openapi.v1.json` is 365 KB. Shipping it to a browser to answer a
 * boolean per request would be absurd. This emits the boolean, keyed by
 * `METHOD path-template`, and `check-idempotent-operations.mjs` fails the build
 * if the emitted file and the contract disagree — so drift is caught by a gate
 * rather than by a user meeting a 400.
 *
 * The Web app therefore never imports API source, never reads `apps/api`, and
 * never re-derives a rule the backend owns. It consumes the published contract,
 * which is the one integration surface it is allowed.
 *
 * ## The audit class travels the same road (`P1-27-SEC-004`)
 *
 * `SEC-004` is "security audit-event coverage". Its console half was strong and
 * its correlation half found a real defect, but its AUDIT-EVENT half had no
 * executable assertion anywhere: `auditClass` occurred in `apps/web` only inside
 * docblocks, because the emitted table carried `template`, `method`,
 * `operationId` and `idempotent` and no audit class — so nothing in the Web tier
 * *could* derive one. Thirteen docblocks asserting "this write is
 * `auditClass: privileged`" were prose, and prose is what stops the next reader
 * checking.
 *
 * The fact was already published. `operation-registry.ts` normalises
 * `auditClass` onto every `RegisteredOperation`, and `openapi/document.ts:228`
 * emits it as `x-audit-class` — on all 243 operations, with six distinct values
 * matching `AuditClass` at `operation-registry.ts:42` exactly. So this reads it
 * out by the SAME path that already carries `idempotent`, rather than adding a
 * second hand-written table that could disagree with the first.
 *
 * An operation missing the extension emits `''` rather than a guessed default.
 * A guess would be indistinguishable from `none`, and "this write declares no
 * audit class at all" is precisely the condition the Web assertions exist to
 * fail on. Absence must stay visible.
 *
 * Usage:
 *   node scripts/ci/generate-idempotent-operations.mjs           # write
 *   node scripts/ci/generate-idempotent-operations.mjs --check   # compare
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { REPOSITORY_ROOT } from '../lib/repository-paths.mjs';

const CONTRACT = join(REPOSITORY_ROOT, 'docs', 'api', 'openapi.v1.json');
const TARGET = join(
  REPOSITORY_ROOT,
  'apps',
  'web',
  'src',
  'lib',
  'api',
  'idempotent-operations.ts'
);

const API_PREFIX = '/api/v1';
const IDEMPOTENCY_PARAMETER = '#/components/parameters/IdempotencyKey';
/**
 * The extension `openapi/document.ts:228` writes from `operation.auditClass`.
 *
 * Spelled as it appears in the document. The NAME `auditClass` occurs zero times
 * in `docs/api/openapi.v1.json` — reading for that name is how a previous
 * attempt concluded the fact was unpublished when it is published on every
 * operation.
 */
const AUDIT_CLASS_EXTENSION = 'x-audit-class';
const METHODS = ['get', 'put', 'post', 'patch', 'delete', 'head', 'options', 'trace'];

/**
 * Every operation the contract publishes, with whether it demands a key and the
 * audit class it declares.
 *
 * The `$ref` is the signal, not a heuristic on the parameter's name: the
 * document is generated from the registry, and `operationObject()` pushes that
 * exact ref when — and only when — `operation.idempotent` is true.
 *
 * The audit class is read the same way — straight off the published extension,
 * with no inference from the method, the path or the operation id. A missing or
 * non-string extension yields `''`, which is a value no operation legitimately
 * carries, so the Web assertions can fail on it by name.
 */
export function readContract(documentText) {
  const document = JSON.parse(documentText);
  const operations = [];

  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(item ?? {})) {
      if (!METHODS.includes(method)) continue;
      const parameters = Array.isArray(operation.parameters) ? operation.parameters : [];
      const auditClass = operation[AUDIT_CLASS_EXTENSION];
      operations.push({
        // Stored WITHOUT the `/api/v1` prefix, because that is how the Web
        // client is called — it holds the prefix in its base URL.
        template: path.startsWith(API_PREFIX) ? path.slice(API_PREFIX.length) : path,
        method: method.toUpperCase(),
        operationId: operation.operationId ?? '',
        idempotent: parameters.some((parameter) => parameter?.$ref === IDEMPOTENCY_PARAMETER),
        auditClass: typeof auditClass === 'string' ? auditClass : '',
      });
    }
  }

  // Sorted so the emitted file is byte-stable across runs and machines. A
  // generated artefact whose order depends on object-key iteration produces a
  // permanent diff between a developer and a build agent.
  operations.sort((a, b) =>
    a.template === b.template
      ? a.method.localeCompare(b.method)
      : a.template.localeCompare(b.template)
  );
  return operations;
}

export function render(operations) {
  const idempotent = operations.filter((operation) => operation.idempotent);
  const byMethod = new Map();
  for (const operation of idempotent) {
    byMethod.set(operation.method, (byMethod.get(operation.method) ?? 0) + 1);
  }
  const breakdown = [...byMethod]
    .sort()
    .map(([method, count]) => `${method} ${count}`)
    .join(', ');

  // Computed from the operations, never asserted as a literal, so the sentence
  // in the emitted header cannot drift away from the emitted rows.
  const byAuditClass = new Map();
  for (const operation of operations) {
    const key = operation.auditClass === '' ? '(absent)' : operation.auditClass;
    byAuditClass.set(key, (byAuditClass.get(key) ?? 0) + 1);
  }
  const auditBreakdown = [...byAuditClass]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([auditClass, count]) => `${auditClass} ${count}`)
    .join(', ');

  const lines = [
    '/**',
    ' * GENERATED — do not edit by hand.',
    ' *',
    ' * Produced by `scripts/ci/generate-idempotent-operations.mjs` from the published',
    ' * contract `docs/api/openapi.v1.json`, and reconciled against it by',
    ' * `npm run validate:idempotent-operations`.',
    ' *',
    ' * ## What this is for (`P1-27-INT-003`)',
    ' *',
    ' * The backend requires an `Idempotency-Key` header on every operation it',
    ' * registers as idempotent, and answers `400 ERR-INT-002` without one — before',
    ' * authorization is evaluated. That set is NOT "the POST operations": it is',
    ` * currently ${idempotent.length} operations (${breakdown}).`,
    ' *',
    ' * The client used to infer the answer from the HTTP method, which was wrong for',
    ' * every non-POST member of that set. This table is the contract instead of a',
    ' * guess, and the gate is what keeps it true.',
    ' *',
    ' * ## The audit class (`P1-27-SEC-004`)',
    ' *',
    ' * `auditClass` is the published `x-audit-class` extension, which',
    ' * `openapi/document.ts:228` writes from the operation registration. Before it',
    ' * was carried here, `auditClass` existed in `apps/web` only inside docblocks —',
    ' * thirteen of them stating which class a write declares, none of them checkable',
    ' * — because the Web tier held no data from which one could be derived.',
    ' *',
    ` * Currently ${auditBreakdown}.`,
    ' *',
    ' * `(absent)` above would mean an operation the document publishes with NO audit',
    ' * class. It is emitted as the empty string rather than defaulted to `none`,',
    ' * because a defaulted value is indistinguishable from a declared one and the',
    ' * whole point of the Web assertions is to fail on the undeclared case.',
    ' */',
    '',
    '/** One published operation, keyed by the template the client calls. */',
    'export interface PublishedOperation {',
    '  /** Path template WITHOUT the `/api/v1` prefix — the client holds that. */',
    '  readonly template: string;',
    '  readonly method: string;',
    '  readonly operationId: string;',
    '  /** True when the backend will refuse the request without a key. */',
    '  readonly idempotent: boolean;',
    '  /**',
    "   * The published `x-audit-class`: `'none'` when the operation writes no audit",
    '   * event, otherwise the class of event it writes. Empty string when the',
    '   * document publishes the operation without the extension at all — which is',
    '   * a defect, not a default.',
    '   */',
    '  readonly auditClass: string;',
    '}',
    '',
    `/** Every operation the contract publishes. ${operations.length} of them. */`,
    'export const PUBLISHED_OPERATIONS: readonly PublishedOperation[] = Object.freeze([',
  ];

  for (const operation of operations) {
    lines.push(
      `  { template: ${JSON.stringify(operation.template)}, method: ${JSON.stringify(
        operation.method
      )}, operationId: ${JSON.stringify(operation.operationId)}, idempotent: ${
        operation.idempotent
      }, auditClass: ${JSON.stringify(operation.auditClass)} },`
    );
  }

  lines.push(']);', '');
  return lines.join('\n');
}

/**
 * The rendered file, formatted by Prettier with the WEB workspace's own config.
 *
 * Not a nicety. `apps/web` runs `format:check` over its own tree, so a generated
 * file that Prettier would reformat fails the build — and formatting it by hand
 * afterwards makes it differ from what the generator writes, so the drift gate
 * then fails instead. Running the formatter here means the two can never
 * disagree, and it uses `resolveConfig` on the target path so it picks up the
 * workspace's config rather than the root's (they are separate on purpose).
 */
export async function renderFormatted(operations) {
  const config = (await resolveConfig(TARGET)) ?? {};
  return format(render(operations), { ...config, parser: 'typescript' });
}

const documentText = readFileSync(CONTRACT, 'utf8');
const operations = readContract(documentText);
const rendered = await renderFormatted(operations);
const check = process.argv.includes('--check');

const idempotentCount = operations.filter((operation) => operation.idempotent).length;
// Reported, never enforced here. An operation published without an audit class
// is a BACKEND defect, and this generator's job is to carry the document
// faithfully — including its gaps — so the Web assertions can name them. Failing
// the build here instead would hide the gap behind a generator error.
const unclassified = operations.filter((operation) => operation.auditClass === '');
console.log(
  `Idempotency manifest: ${operations.length} published operation(s), ${idempotentCount} idempotent, ` +
    `${operations.length - unclassified.length} with a published audit class`
);
if (unclassified.length > 0) {
  console.warn(
    `WARNING: ${unclassified.length} operation(s) publish no x-audit-class: ` +
      unclassified.map((operation) => `${operation.method} ${operation.template}`).join(', ')
  );
}

if (check) {
  let current = '';
  try {
    current = readFileSync(TARGET, 'utf8');
  } catch {
    console.error(`\nMissing: ${TARGET}`);
    console.error('Run: node scripts/ci/generate-idempotent-operations.mjs');
    process.exit(1);
  }
  // Newline-normalised, because the repository is developed on Windows and
  // built on Linux and a CRLF difference is not contract drift.
  if (current.replace(/\r\n/g, '\n') !== rendered) {
    console.error('\nDRIFT: the manifest does not match the published contract.');
    console.error('Run: node scripts/ci/generate-idempotent-operations.mjs');
    process.exit(1);
  }
  console.log('OK: manifest matches the published contract');
} else {
  writeFileSync(TARGET, rendered, 'utf8');
  console.log(`Wrote apps/web/src/lib/api/idempotent-operations.ts`);
}
