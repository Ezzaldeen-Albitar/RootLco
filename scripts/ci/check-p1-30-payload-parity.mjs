#!/usr/bin/env node
/**
 * P1-30 request-payload parity gate.
 *
 * `apps/web` may not import `apps/api` source, so the request payload shapes a
 * P1-30 screen sends are transcribed by hand on the web side. This gate
 * compares that transcription against the real zod schemas and fails on drift —
 * the canonical plan's §5.6 names it as a completion condition.
 *
 * ## A sibling of `check-p1-29-payload-parity.mjs`, and what it borrows
 *
 * The comparison (`compareOperation`), the schema locator (`bodySchemaOf`), the
 * naming rule (`typeNameFor`) and the mirror reader (`readMirror`) are the
 * P1-29 gate's own exports, called with this gate's mirror list and this
 * gate's problem collector. Nothing is copied: a second reader is how the
 * brace-counting scanners drifted, and the P1-29 suite (C1–C11) pins the
 * borrowed behaviour. What is this gate's own is the SCOPE — which domains,
 * which mirror files, which operations are declared bodyless — because those
 * are P1-30's facts and the P1-29 gate must not learn them.
 *
 * ## The scope grows with the phase, like `P1_30_AREAS` does
 *
 * `P1_30_DOMAINS` names the id namespaces whose writes are held to a mirror
 * TODAY. W1 ships the service-catalogue screens, so it is `svc`; W3 adds `quo`,
 * W4/W5 `inv`, W6/W7 `sal` and `wty`. A wave that builds a screen against a
 * domain not listed here must add the domain AND its mirror in the same
 * change, and `tests/ci/p1-30-payload-parity.test.ts` pins the list by name.
 * Listing every P1-30 domain on day one would demand mirrors for dozens of
 * writes no screen calls yet, which is documentation with nothing behind it.
 *
 * ## Anti-vacuity, stated rather than pinned
 *
 * No magic counts: the gate asserts a RELATIONSHIP — every in-scope write either
 * carries an extracted body or is named in `BODYLESS` with a reason, and the
 * extracted count is non-zero. A gate pointed at the wrong directory extracts
 * zero and dies on the non-zero clause.
 *
 *     node scripts/ci/check-p1-30-payload-parity.mjs
 *     node scripts/ci/check-p1-30-payload-parity.mjs --schemas <path>       # reuse an extraction
 *     node scripts/ci/check-p1-30-payload-parity.mjs --mirror-root <dir>    # anti-vacuity proof
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ROOT, bodySchemaOf, compareOperation, readMirror } from './check-p1-29-payload-parity.mjs';

const slash = (p) => p.split(sep).join('/');

/** The P1-30 id namespaces held to a mirror today. Grows per wave; pinned by the test. */
export const P1_30_DOMAINS = Object.freeze(['svc', 'quo', 'inv', 'sal']);
const IN_SCOPE = new RegExp(`^(${P1_30_DOMAINS.join('|')})\\.`);
const WRITE_METHODS = Object.freeze(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * The mirror files, relative to `apps/web/src`. Hand-frozen for the reason the
 * P1-29 gate records: a globbed directory would let a stray file become a
 * mirror, and the generated manifest is the file most likely to stray.
 */
export const MIRROR_FILES = Object.freeze([
  join('lib', 'contracts', 'services-contract.ts'),
  join('lib', 'contracts', 'pricing-contract.ts'),
  join('lib', 'contracts', 'quotations-contract.ts'),
  join('lib', 'contracts', 'inventory-contract.ts'),
  join('lib', 'contracts', 'billing-contract.ts'),
]);

/**
 * Writes in scope that parse NO request body, each with the reason. Empty
 * today: every `svc` write carries a body. An entry here must name a write
 * that exists and does not parse a body, or the gate refuses it as stale.
 */
export const BODYLESS = Object.freeze({
  // The approval is the act itself: the batch is the path parameter and the
  // approver is the caller. Entered scope with `inv` in W4; no P1-30 screen sends it.
  'inv.opening-batch-approve':
    'the approval carries nothing but the batch in the path and the caller as approver',
  // Issuance has no parameters: the invoice is the path parameter and the
  // version travels as If-Match. Sent by the W6 screen with no body.
  'sal.invoice-issue':
    'issuance carries nothing but the invoice in the path and its version as If-Match',
  // The amount was fixed at request time; the approval names the note in the path.
  'sal.credit-note-approve':
    'the approval carries nothing but the credit note in the path and the caller as approver',
});

/** Field-level omissions the web side has decided, with reasons. Empty today. */
export const DISPOSITIONS = Object.freeze({});

/**
 * Operations whose request-body mirror does not exist YET, keyed by operation
 * id, each with a `PENDING: ` reason naming the wave that owes it.
 *
 * The five pricing writes are `svc` — the same id namespace as the catalogue —
 * so they entered this gate's scope with W1 although no W1 screen sends them.
 * They belong to W2 (price lists, versions, rules and assignment; canonical
 * plan §4). Mirroring them here would be a shape with no consumer, which is
 * the "declared but never wired" defect this repository keeps refusing; leaving
 * them undeclared would be a red that says nothing. So they are PENDING, and
 * the P1-29 comparison enforces the lifecycle: the moment W2's mirror declares
 * the interface, the entry is STALE and fails, so W2 must delete it in the
 * same change. An entry cannot outlive its reason.
 */
export const PENDING_MIRRORS = Object.freeze({
  // W2 wrote the pricing mirror and deleted its five entries in the same change.
  // The `inv` writes entered this scope with W4 (the two reservation writes); W5
  // wrote the issue and return mirrors and deleted their entries in the same
  // change. Damage, intake and opening batches are sent by no P1-30 screen
  // (FE-008…FE-013 do not render them), so their mirrors have no consumer in this
  // phase and are owed by whichever phase builds one.
  'inv.damaged-stock-create':
    'PENDING: no P1-30 screen sends this (outside FE-008…FE-013); a later phase owes the mirror',
  'inv.customer-supplied-part-create':
    'PENDING: no P1-30 screen sends this (outside FE-008…FE-013); a later phase owes the mirror',
  'inv.external-purchase-part-create':
    'PENDING: no P1-30 screen sends this (outside FE-008…FE-013); a later phase owes the mirror',
  'inv.opening-batch-create':
    'PENDING: no P1-30 screen sends this (outside FE-008…FE-013); a later phase owes the mirror',
  'inv.opening-batch-line-create':
    'PENDING: no P1-30 screen sends this (outside FE-008…FE-013); a later phase owes the mirror',
  // The `sal` writes entered this scope with W6, which mirrors the invoice
  // create and cancel bodies. Payments belong to W7 (canonical plan §4); credit
  // notes and deliveries are sent by no P1-30 screen.
  'sal.credit-note-create':
    'PENDING: no P1-30 screen sends this (credit notes are in no FE row); a later phase owes the mirror',
  'sal.payment-record': 'PENDING: P1-30 W7 (FE-016) writes the payment mirror',
  'sal.payment-allocate': 'PENDING: P1-30 W7 (FE-017) writes the allocation mirror',
  'sal.delivery-checklist-record':
    'PENDING: no P1-30 screen sends this (FE-008…FE-021 do not render deliveries); a later phase owes the mirror',
  'sal.delivery-complete':
    'PENDING: no P1-30 screen sends this (FE-008…FE-021 do not render deliveries); a later phase owes the mirror',
  'sal.delivery-create':
    'PENDING: no P1-30 screen sends this (FE-008…FE-021 do not render deliveries); a later phase owes the mirror',
  'sal.delivery-receiver-verify':
    'PENDING: no P1-30 screen sends this (FE-008…FE-021 do not render deliveries); a later phase owes the mirror',
  'sal.delivery-signature-attach':
    'PENDING: no P1-30 screen sends this (FE-008…FE-021 do not render deliveries); a later phase owes the mirror',
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

/**
 * Turns each located zod export into canonical JSON Schema by running the
 * extraction test under vitest — the only place the route modules can be
 * imported with their aliases resolved. Same mechanism as the P1-29 gate, with
 * this gate's own operation list and environment names.
 */
function extract(rows) {
  const dir = mkdtempSync(join(tmpdir(), 'p130-parity-'));
  const inPath = join(dir, 'operations.json');
  const outPath = join(dir, 'schemas.json');
  writeFileSync(inPath, `${JSON.stringify(rows, null, 2)}\n`);
  execFileSync(
    'npx',
    ['vitest', 'run', 'tests/ci/p1-30-payload-extraction.test.ts', '--reporter=dot'],
    {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      env: { ...process.env, P1_30_OPERATIONS: inPath, P1_30_SCHEMAS: outPath },
      maxBuffer: 64 * 1024 * 1024,
    }
  );
  return { inPath, outPath, dir };
}

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

function main() {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? undefined : process.argv[i + 1];
  };
  const { scope, writes, bodies } = inScopeBodies();

  for (const id of Object.keys(BODYLESS)) {
    if (!writes.some((op) => op.id === id)) {
      note(`BODYLESS names \`${id}\`, which is not a P1-30 write in scope — stale entry`);
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
  let schemas = {};
  if (schemasArg) {
    schemas = JSON.parse(readFileSync(schemasArg, 'utf8'));
  } else if (bodies.length > 0) {
    const { outPath } = extract(bodies);
    schemas = JSON.parse(readFileSync(outPath, 'utf8'));
  }

  const mirrorRoot = arg('mirror-root') ?? join(ROOT, 'apps', 'web', 'src');
  const interfaces = readMirror(mirrorRoot, MIRROR_FILES, note);
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
    `P1-30 payload parity [${P1_30_DOMAINS.join(', ')}]: ${scope.length} operation(s) in scope, ` +
      `${writes.length} write(s), ${bodies.length} with a body, ` +
      `${Object.keys(BODYLESS).length} declared bodyless, ${Object.keys(PENDING_MIRRORS).length} pending a later wave, ${interfaces.size} mirror interface(s).`
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
