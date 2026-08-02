#!/usr/bin/env node
/**
 * Idempotency declaration ↔ replay evidence (initiative §18).
 *
 * "Mechanically fail the gate if an operation declares idempotency without
 * replay evidence."
 *
 * `idempotent: true` on a route is a PROMISE to the caller: retry this and you
 * will not double-charge, double-issue, double-audit or double-publish. A
 * promise nobody exercised is a comment.
 *
 * The check joins two sources that are maintained by different people at
 * different times, which is exactly why it catches drift:
 *
 *   apps/api/src/app/api/v1/**\/route.ts    — who DECLARES idempotency
 *   operation-test-matrix.json `derived`    — who has replay evidence, derived
 *                                             from the tests that actually exist
 *
 * `derived` is used rather than `declared` on purpose: `declared` is what the
 * test file's header comment claims, and a comment cannot satisfy a structural
 * requirement.
 *
 * Usage:
 *   node scripts/ci/check-idempotency-evidence.mjs \
 *     [--matrix docs/phase-1/phase-1-14/evidence/operation-test-matrix.json] [--json out.json]
 * Exit codes: 0 pass · 1 an unproven promise · 2 IO error.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { API_ROUTES_V1_ROOT, fromRoot, toRepositoryPath } from '../lib/repository-paths.mjs';

export const ROUTE_ROOT = API_ROUTES_V1_ROOT;
export const DEFAULT_MATRIX = fromRoot(
  'docs',
  'phase-1',
  'phase-1-14',
  'evidence',
  'operation-test-matrix.json'
);
export const EVIDENCE_KEY = 'idempotency';

/**
 * Extracts `{ id, idempotent }` for every operation defined in a route module.
 *
 * A route file may define several operations, so the declarations are split on
 * the `id:` key and each block is inspected independently — scanning the whole
 * file would let one idempotent operation vouch for its non-idempotent
 * neighbour.
 */
export function parseOperations(source, file) {
  const out = [];
  const idPattern = /\bid:\s*'([^']+)'/g;
  const matches = [...source.matchAll(idPattern)];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : source.length;
    const block = source.slice(start, end);
    out.push({
      id: matches[i][1],
      idempotent: /\bidempotent:\s*true\b/.test(block),
      file,
    });
  }
  return out;
}

export function discoverDeclarations(root = ROUTE_ROOT) {
  const out = [];
  if (!existsSync(root)) return out;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name !== 'route.ts' && entry.name !== 'route.tsx') continue;
      out.push(...parseOperations(readFileSync(full, 'utf8'), toRepositoryPath(full)));
    }
  };
  walk(root);
  return out;
}

export function evaluate(
  declarations,
  matrix,
  exceptions = { operations: [] },
  today = new Date()
) {
  const byId = new Map();
  for (const op of matrix.operations ?? []) byId.set(op.id, op);

  const promised = declarations.filter((d) => d.idempotent);
  const unproven = [];
  const unknown = [];
  const proven = [];

  for (const declaration of promised) {
    const entry = byId.get(declaration.id);
    if (!entry) {
      unknown.push(declaration);
      continue;
    }
    const derived = new Set(entry.derived ?? []);
    if (derived.has(EVIDENCE_KEY)) proven.push(declaration);
    else unproven.push({ ...declaration, files: entry.files ?? [] });
  }

  // ---- itemised, expiring exceptions -------------------------------------
  // Every entry names ONE operation. There is no wildcard and no whole-module
  // waiver: a class-wide suppression would hide the next one silently, which is
  // precisely the failure this check exists to prevent.
  const byException = new Map((exceptions.operations ?? []).map((e) => [e.id, e]));
  const usedExceptions = new Set();
  const failures = [];
  const waived = [];

  const consider = (op, message) => {
    const entry = byException.get(op.id);
    if (!entry) {
      failures.push(message);
      return;
    }
    usedExceptions.add(op.id);
    const review = new Date(entry.reviewBy);
    if (Number.isNaN(review.getTime())) {
      failures.push(`idempotency exception for \`${op.id}\` has an unparseable \`reviewBy\` date.`);
    } else if (review < today) {
      failures.push(
        `idempotency exception for \`${op.id}\` expired on ${entry.reviewBy}. ` +
          'Write the replay test or restate the exception with a fresh reason.'
      );
    } else if (!entry.reason || !entry.owner) {
      failures.push(`idempotency exception for \`${op.id}\` is missing a reason or an owner.`);
    } else {
      waived.push({ ...op, exception: entry });
    }
  };

  for (const op of unproven) {
    consider(
      op,
      `\`${op.id}\` declares \`idempotent: true\` in ${op.file} but no test exercises replay. ` +
        'A retry promise nobody exercised is a comment. Add a same-key/same-payload replay assertion that ' +
        'proves state, audit and outbox are each written once.'
    );
  }
  for (const op of unknown) {
    consider(
      op,
      `\`${op.id}\` declares \`idempotent: true\` in ${op.file} but is absent from the operation-test matrix, ` +
        'so no coverage decision exists for it at all.'
    );
  }

  // A stale exception makes the list look more permissive than reality.
  for (const entry of exceptions.operations ?? []) {
    if (!usedExceptions.has(entry.id)) {
      failures.push(
        `idempotency exception for \`${entry.id}\` matches nothing — the operation now has replay evidence, ` +
          'or no longer declares idempotency. Remove the entry.'
      );
    }
  }

  return {
    ok: failures.length === 0,
    totalOperations: declarations.length,
    declaredIdempotent: promised.length,
    proven: proven.length,
    waived: waived.length,
    waivedOperations: waived.map((w) => ({
      id: w.id,
      reviewBy: w.exception.reviewBy,
      owner: w.exception.owner,
    })),
    unproven,
    unknown,
    failures,
  };
}

export function toMarkdown(result) {
  const lines = ['### Idempotency evidence', ''];
  lines.push('| Measure | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Operations declared in routes | ${result.totalOperations} |`);
  lines.push(`| Declaring \`idempotent: true\` | ${result.declaredIdempotent} |`);
  lines.push(`| With replay evidence | ${result.proven} |`);
  lines.push(`| Without replay evidence | ${result.unproven.length + result.unknown.length} |`);
  lines.push(`| …of which waived, with an expiry | ${result.waived} |`);
  lines.push('');
  if (result.waivedOperations?.length) {
    lines.push('<details><summary>Waived idempotency promises (recorded, expiring)</summary>');
    lines.push('');
    lines.push('| Operation | Owner | Review by |');
    lines.push('| --- | --- | --- |');
    for (const w of result.waivedOperations)
      lines.push(`| \`${w.id}\` | ${w.owner} | ${w.reviewBy} |`);
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
  if (result.failures.length) {
    lines.push('**Unproven idempotency promises**');
    lines.push('');
    for (const f of result.failures) lines.push(`- ❌ ${f}`);
  } else {
    lines.push('**Every idempotency promise is backed by replay evidence.**');
  }
  return lines.join('\n');
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const matrixPath = arg('--matrix') ?? DEFAULT_MATRIX;
  if (!existsSync(matrixPath)) {
    console.error(`operation-test matrix not found at ${matrixPath}`);
    process.exit(2);
  }
  const declarations = discoverDeclarations();
  if (declarations.length === 0) {
    console.error(
      `no operations found under ${ROUTE_ROOT} — refusing to report "clean" over an empty set`
    );
    process.exit(2);
  }
  const matrix = JSON.parse(readFileSync(matrixPath, 'utf8'));
  const exceptionsPath =
    arg('--exceptions') ?? join('.github', 'ci-baselines', 'idempotency-exceptions.json');
  const exceptions = existsSync(exceptionsPath)
    ? JSON.parse(readFileSync(exceptionsPath, 'utf8'))
    : { operations: [] };
  const result = evaluate(declarations, matrix, exceptions);

  const jsonOut = arg('--json');
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(result, null, 2)}\n`);
  const mdOut = arg('--markdown');
  if (mdOut) writeFileSync(mdOut, `${toMarkdown(result)}\n`);

  console.log(toMarkdown(result));
  for (const op of [...result.unproven, ...result.unknown]) {
    console.log(`::error file=${op.file}::${op.id} declares idempotency with no replay evidence`);
  }
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
