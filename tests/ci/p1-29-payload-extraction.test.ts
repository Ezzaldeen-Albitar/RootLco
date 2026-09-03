/**
 * Reads the P1-29 request schemas out of the real route modules, as VALUES.
 *
 * This is the half of `check-p1-29-payload-parity.mjs` that cannot live in the
 * gate script: a `.mjs` file cannot import a TypeScript route module, and
 * reconstructing zod semantics by hand is exactly what `BR-08b` exported the
 * schemas to make unnecessary. `vitest` is where `@/` resolves, so the extraction
 * runs here and hands JSON back.
 *
 * `import.meta.glob` rather than a generated import list: 269 route modules would
 * otherwise need a generated file, and a generated file is one more artefact to
 * keep in sync with the tree it describes.
 *
 * Driven by the gate through two environment variables. Run on its own with
 * neither set it falls back to the same P1-29 census the gate computes, and NOT
 * to "every body in the tree" — that fallback was tried and it fails, which is
 * worth recording rather than quietly narrowing:
 *
 *     convertible:   181
 *     UNCONVERTIBLE:   2
 *       /attachments/versions/route.ts :: Body — Date cannot be represented in JSON Schema
 *       /notifications/route.ts        :: Body — Date cannot be represented in JSON Schema
 *
 * `z.toJSONSchema` has no representation for `z.date()`. Both offenders are
 * outside P1-29 (`att.` and `shared.`), so all 48 bodies here convert — but a
 * later slice that generalises this gate to the whole tree will meet exactly
 * those two walls, and it should meet them as a known limit rather than as a
 * surprise on a Friday.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import { ROOT, bodySchemaOf } from '../../scripts/ci/check-p1-29-payload-parity.mjs';

// The call site stays written out in full: `import.meta.glob` is a Vite
// COMPILE-TIME transform, not a function value, so assigning it to a variable
// type-checks and then fails at runtime. Its type lives in
// tests/ci/vite-import-meta.d.ts, which records why it has to be ambient.
const modules = import.meta.glob('/apps/api/src/app/api/v1/**/route.ts', { eager: true });

interface Row {
  readonly id: string;
  readonly schema: string;
  readonly file: string;
}

/**
 * The same P1-29 census the gate computes, using the gate's own resolver.
 *
 * Sharing `bodySchemaOf` rather than re-deriving it here is deliberate: two
 * implementations of "which schema does this handler parse" would drift, and the
 * one that drifted would be the one nobody ran.
 */
function census(): Row[] {
  const register = JSON.parse(
    readFileSync(join(ROOT, 'docs/phase-1/phase-1-24/evidence/operation-register.json'), 'utf8')
  ) as { operations?: unknown[] } | unknown[];
  const operations = (Array.isArray(register) ? register : (register.operations ?? [])) as {
    id: string;
    method: string;
    file: string;
  }[];

  const rows: Row[] = [];
  for (const op of operations) {
    if (!/^(wo|dia|qms|tech)\./.test(op.id)) continue;
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(op.method)) continue;
    const path = join(ROOT, op.file);
    if (!existsSync(path)) continue;
    const schema = bodySchemaOf(readFileSync(path, 'utf8'), op.method);
    if (schema) rows.push({ id: op.id, schema, file: op.file });
  }
  return rows;
}

describe('P1-29 request payload extraction', () => {
  it('converts every declared body to canonical JSON Schema', () => {
    const inPath = process.env.P1_29_OPERATIONS;
    const outPath = process.env.P1_29_SCHEMAS;

    const rows: Row[] =
      inPath && existsSync(inPath) ? (JSON.parse(readFileSync(inPath, 'utf8')) as Row[]) : census();

    const out: Record<string, unknown> = {};
    const missing: string[] = [];

    for (const row of rows) {
      const path = row.file.startsWith('/') ? row.file : `/${row.file}`;
      const mod = modules[path];
      if (!mod) {
        missing.push(`${row.id}: route module not globbed — ${path}`);
        continue;
      }
      const schema = mod[row.schema];
      if (schema === undefined) {
        missing.push(`${row.id}: export \`${row.schema}\` absent from ${path}`);
        continue;
      }
      out[row.id] = z.toJSONSchema(schema as never);
    }

    if (outPath) writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);

    expect(missing).toEqual([]);
    expect(Object.keys(out).length).toBe(rows.length);
    expect(rows.length).toBeGreaterThan(0);
  });
});
