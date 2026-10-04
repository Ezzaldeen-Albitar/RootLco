/**
 * The environment contract must see the names the schema reads, not only the
 * ones spelled `process.env.NAME`.
 *
 * `scripts/ci/check-env-contract.mjs` existed to answer one question — "can a
 * fresh clone reproduce this build, or does it depend on an undocumented
 * variable?" — and for a long time it answered "yes" over nine names while the
 * backend read roughly fifty. The reason is structural rather than careless:
 * `apps/api/src/server/config/backend-config.ts` hands the WHOLE of
 * `process.env` to one zod object, so not one of its keys appears as a literal
 * anywhere in the source. A literal scan cannot see them, and a check that
 * cannot see a dependency reports a contract it never compared.
 *
 * This suite runs the extractor over the REAL schema file rather than a
 * fixture, on purpose. A fixture would prove the regex matches the shape the
 * fixture was written in; the defect being guarded against is the schema
 * drifting into a shape the regex cannot see, and only the real file can fail
 * that way.
 *
 * The count assertion is the part that catches the silent case. Membership
 * alone would still pass if a future helper — a third spelling alongside `z.`
 * and `bounded(` — made a dozen keys invisible: they would simply stop being
 * required, and nothing would go red. So the extracted total is compared
 * against an independent count of the schema's own property lines, computed
 * here by a different rule than the extractor uses.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  API_CONTRACT,
  BACKEND_CONFIG,
  CONTRACT,
  addSchemaUsage,
  allDocumentedNames,
  evaluate,
  readSchemaKeys,
  scanSource,
} from '../../scripts/ci/check-env-contract.mjs';

const schemaSource = readFileSync(BACKEND_CONFIG, 'utf8');
const extracted = readSchemaKeys(schemaSource);

/**
 * The text of `const schema = z.object({ ... })`, and nothing else in the file.
 *
 * The file now holds a SECOND object literal keyed by environment names —
 * `RESERVED_SETTINGS`, the register of settings that are accepted and read by
 * nothing — whose properties are indented exactly as the schema's are. The
 * counter below cannot tell them apart by indentation, and widening it to
 * tolerate them would have quietly inflated the expected total by three, which
 * is precisely the silent drift the count exists to catch. So the region is
 * delimited first, by the schema's own opening and its closing `});` at column
 * zero, and the count is taken inside it.
 */
function schemaRegion(source: string): string {
  const opening = source.indexOf('const schema = z.object({');
  const closing = source.indexOf('\n});', opening);
  if (opening === -1 || closing === -1) {
    throw new Error('the schema declaration was not found — the counter has nothing to count');
  }
  return source.slice(opening, closing);
}

/**
 * An independent count of the schema's properties.
 *
 * Deliberately a different rule from the extractor's: this one keys on the
 * INDENTATION of a top-level property — exactly two spaces, which Prettier
 * guarantees — and says nothing at all about what follows the colon. The
 * extractor keys on what follows the colon and is relaxed about the
 * indentation. Two rules that can only agree when both are right.
 */
function countSchemaProperties(source: string): number {
  return schemaRegion(source)
    .split(/\r?\n/)
    .filter((line) => /^ {2}[A-Z][A-Z0-9_]*:/.test(line)).length;
}

describe('schema key extraction', () => {
  it('finds the names that decide whether the deployment can serve a request', () => {
    // Each of these is invisible to a `process.env.NAME` scan, and each one
    // absent takes a whole capability down: the request pool, the control
    // plane, and token verification.
    expect(extracted.has('DATABASE_URL')).toBe(true);
    expect(extracted.has('PLATFORM_DATABASE_URL')).toBe(true);
    expect(extracted.has('AUTH_JWT_SECRET')).toBe(true);
  });

  it('finds the wrapped and helper-valued entries, not only `NAME: z.thing()`', () => {
    // `WORKER_ID: z\n    .string()` — the formatter's wrapped form.
    expect(extracted.has('WORKER_ID')).toBe(true);
    // `RATE_LIMIT_ENABLED: z\n    .enum([...])` — same shape, different type.
    expect(extracted.has('RATE_LIMIT_ENABLED')).toBe(true);
    // `DB_POOL_MAX: bounded(1, 50, 10)` — the local range helper, whose value
    // never begins with `z.` at all.
    expect(extracted.has('DB_POOL_MAX')).toBe(true);
  });

  it('extracts every property the schema declares, counted a different way', () => {
    expect(extracted.size).toBe(countSchemaProperties(schemaSource));
  });

  it('counts the schema only, not the reserved register beside it', () => {
    // The delimiting is what makes the count above meaningful, so it is
    // asserted rather than assumed: the region must stop before
    // `RESERVED_SETTINGS`, whose keys are environment names at the same
    // indentation, and must still contain the schema's own last entry.
    const region = schemaRegion(schemaSource);
    expect(region).toContain('EXPORT_MAX_ROWS');
    // The declaration, not the word: several schema entries name the register
    // in their own documentation, which is exactly why they are reserved.
    expect(region).not.toContain('export const RESERVED_SETTINGS');
  });

  it('extracts nothing from a schema whose keys are not environment names', () => {
    // Guards the opposite failure: a regex loose enough to match any property
    // would make the contract meaningless by flooding it with non-names.
    const notEnvironment = ['const s = z.object({', '  someValue: z.string(),', '});'].join('\n');
    expect(readSchemaKeys(notEnvironment).size).toBe(0);
  });
});

describe('the documented set covers the read set', () => {
  it('leaves nothing undocumented across both templates', () => {
    const usage = addSchemaUsage(scanSource());
    const result = evaluate(usage, allDocumentedNames());

    // Named, not counted: a failure here has to say WHICH name a fresh clone
    // cannot supply.
    expect(result.undocumented.map((entry) => entry.name)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('reads both templates, because the API tier documents its own names', () => {
    const rootOnly = allDocumentedNames([CONTRACT]);
    const both = allDocumentedNames([CONTRACT, API_CONTRACT]);

    expect(both.size).toBeGreaterThan(rootOnly.size);
    // The union is what the check uses, and the API template is where the
    // server-only surface is written down.
    expect(both.has('PLATFORM_DATABASE_URL')).toBe(true);
    expect(rootOnly.has('PLATFORM_DATABASE_URL')).toBe(false);
  });

  it('still fails when a read name is documented nowhere', () => {
    // Falsifiability: the pass above must be a property of the repository, not
    // of a check that cannot go red.
    const usage = addSchemaUsage(scanSource());
    const withoutOne = new Set(allDocumentedNames());
    withoutOne.delete('DATABASE_URL');

    const result = evaluate(usage, withoutOne);
    expect(result.ok).toBe(false);
    expect(result.undocumented.map((entry) => entry.name)).toContain('DATABASE_URL');
  });
});
