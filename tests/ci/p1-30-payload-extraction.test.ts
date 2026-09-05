/**
 * Turns the P1-30 in-scope request bodies into canonical JSON Schema.
 *
 * Runs under vitest because that is the only place the route modules can be
 * imported with their `@/` aliases resolved; `check-p1-30-payload-parity.mjs`
 * shells out to this file with `P1_30_OPERATIONS` (the rows to convert) and
 * `P1_30_SCHEMAS` (where to write them). Run bare, it converts every in-scope
 * body it can find and asserts none is missing — which is itself a check that
 * every `svc` write exports the schema its handler parses.
 *
 * A sibling of `p1-29-payload-extraction.test.ts` with P1-30's scope; the
 * schema locator is the P1-29 gate's own.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ROOT, bodySchemaOf } from '../../scripts/ci/check-p1-29-payload-parity.mjs';
import { P1_30_DOMAINS } from '../../scripts/ci/check-p1-30-payload-parity.mjs';

// The call site stays written out in full: `import.meta.glob` is a Vite
// COMPILE-TIME transform, not a function value, so assigning it to a variable
// type-checks and then fails at runtime.
const modules = import.meta.glob('/apps/api/src/app/api/v1/**/route.ts', { eager: true });

interface Row {
  readonly id: string;
  readonly schema: string;
  readonly file: string;
}

function census(): Row[] {
  const register = JSON.parse(
    readFileSync(join(ROOT, 'docs/phase-1/phase-1-24/evidence/operation-register.json'), 'utf8')
  ) as { operations?: unknown[] } | unknown[];
  const operations = (Array.isArray(register) ? register : (register.operations ?? [])) as {
    id: string;
    method: string;
    file: string;
  }[];
  const inScope = new RegExp(`^(${P1_30_DOMAINS.join('|')})\\.`);
  const rows: Row[] = [];
  for (const op of operations) {
    if (!inScope.test(op.id)) continue;
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(op.method)) continue;
    const path = join(ROOT, op.file);
    if (!existsSync(path)) continue;
    const schema = bodySchemaOf(readFileSync(path, 'utf8'), op.method);
    if (schema) rows.push({ id: op.id, schema, file: op.file });
  }
  return rows;
}

describe('P1-30 request payload extraction', () => {
  it('converts every declared body to canonical JSON Schema', () => {
    const inPath = process.env.P1_30_OPERATIONS;
    const outPath = process.env.P1_30_SCHEMAS;
    const rows: Row[] =
      inPath && existsSync(inPath) ? (JSON.parse(readFileSync(inPath, 'utf8')) as Row[]) : census();
    const out: Record<string, unknown> = {};
    const missing: string[] = [];
    for (const row of rows) {
      const path = row.file.startsWith('/') ? row.file : `/${row.file}`;
      const mod = modules[path] as Record<string, unknown> | undefined;
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
    // Non-vacuity: an empty scope would make everything above meaningless.
    expect(rows.length).toBeGreaterThan(0);
  });
});
