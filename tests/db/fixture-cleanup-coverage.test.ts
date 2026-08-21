/**
 * Every tenant-scoped table is unwound by the fixture cleanup authority.
 *
 * `cleanFixtures` → `deleteTenantCascade` is the only thing standing between one
 * suite's rows and the next suite's assumptions. A table missing from it does not
 * fail loudly; it survives cleanup, and the next suite inherits whatever the last
 * one left behind. That is how six P1-18 tables — `capture_policy_rules`,
 * `capture_requirement_overrides`, `damage_map_template_versions`,
 * `damage_map_templates`, `reception_evidence_bindings` and `signature_events` —
 * came to be absent from the cascade while the tier looked healthy.
 *
 * So the list is not checked against another list. It is checked against the
 * DATABASE: every table that carries a `tenant_id` column must be named, and the
 * next table anyone adds is covered on the day it is created rather than on the
 * day somebody remembers. A hand-maintained mirror would reproduce the original
 * defect exactly one release later.
 *
 * Two escape hatches, both narrow and both justified per row:
 *  - `PARENT_CASCADES` — the row is removed by an `ON DELETE CASCADE` from a
 *    parent that IS named, so deleting it separately would be dead code;
 *  - `NOT_FIXTURE_STATE` — platform catalogues that fixtures never write.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { adminPool } from './helpers';

const HELPERS = fileURLToPath(new URL('./helpers.ts', import.meta.url));

/** Business schemas whose tenant rows a suite can create. */
const SCHEMAS = [
  'org',
  'iam',
  'shared',
  'crm',
  'veh',
  'apt',
  'rec',
  'wo',
  'tech',
  'dia',
  'qms',
  'svc',
  'quo',
  'inv',
  'sal',
  'wty',
  'rpt',
] as const;

/**
 * Removed by a parent's ON DELETE CASCADE. Each names the parent, and the parent
 * must itself be in the cascade — asserted below, so this cannot become a place
 * to park a table nobody deletes.
 */
const PARENT_CASCADES: ReadonlyMap<string, string> = new Map([
  // Each verified against pg_constraint.confdeltype = 'c' on the rebuilt
  // database, not assumed from the table's name.
  ['iam.audit_integrity_links', 'iam.audit_records'],
  ['iam.audit_record_details', 'iam.audit_records'],
  ['iam.grant_scopes', 'iam.role_grants'],
  ['shared.status_evidence', 'shared.status_history'],
]);

/** Platform catalogues fixtures never write per-tenant rows into. */
const NOT_FIXTURE_STATE: ReadonlySet<string> = new Set([
  'iam.permissions', // platform catalogue, seeded, asserted by the census suite
]);

let admin: Pool;

beforeAll(() => {
  admin = adminPool();
});

afterAll(async () => {
  await admin.end();
});

describe('the fixture cleanup authority covers every tenant-scoped table', () => {
  it('names each one, derived from the database rather than from a second list', async () => {
    const { rows } = await admin.query<{ qualified: string }>(
      `SELECT c.table_schema || '.' || c.table_name AS qualified
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.column_name = 'tenant_id'
          AND t.table_type = 'BASE TABLE'
          AND c.table_schema = ANY($1::text[])
        ORDER BY 1`,
      [SCHEMAS]
    );

    // Anti-vacuity: an empty or tiny answer would make the sweep meaningless.
    expect(rows.length).toBeGreaterThan(80);

    const helpers = readFileSync(HELPERS, 'utf8');
    const missing = rows
      .map((row) => row.qualified)
      .filter((table) => !NOT_FIXTURE_STATE.has(table) && !PARENT_CASCADES.has(table))
      .filter((table) => !helpers.includes(`'${table}'`));

    expect(
      missing,
      `these tenant-scoped tables are never unwound by cleanFixtures, so their rows ` +
        `survive into the next suite:\n  ${missing.join('\n  ')}`
    ).toEqual([]);
  });

  it('covers the six P1-18 tables by name, so this cannot pass by exclusion', () => {
    const helpers = readFileSync(HELPERS, 'utf8');
    for (const table of [
      'rec.capture_policy_rules',
      'rec.capture_requirement_overrides',
      'rec.damage_map_template_versions',
      'rec.damage_map_templates',
      'rec.reception_evidence_bindings',
      'rec.signature_events',
    ]) {
      expect(helpers, `${table} must be unwound by deleteTenantCascade`).toContain(`'${table}'`);
    }
  });

  it('keeps every declared exception honest: the parent it defers to is itself deleted', () => {
    const helpers = readFileSync(HELPERS, 'utf8');
    for (const [child, parent] of PARENT_CASCADES) {
      expect(helpers, `${child} defers to ${parent}, which must itself be deleted`).toContain(
        `'${parent}'`
      );
    }
    // An exception list that grew without anyone noticing is its own defect.
    expect(PARENT_CASCADES.size + NOT_FIXTURE_STATE.size).toBeLessThan(8);
  });

  it('unwinds children before parents: the P1-18 order respects the FK graph', () => {
    const helpers = readFileSync(HELPERS, 'utf8');
    const at = (table: string): number => helpers.indexOf(`'${table}'`);

    // signature_events -> signatures
    expect(at('rec.signature_events')).toBeLessThan(at('rec.signatures'));
    // damage_maps -> damage_map_template_versions -> damage_map_templates
    expect(at('rec.damage_maps')).toBeLessThan(at('rec.damage_map_template_versions'));
    expect(at('rec.damage_map_template_versions')).toBeLessThan(at('rec.damage_map_templates'));
    // bindings and overrides -> reception_visits
    expect(at('rec.reception_evidence_bindings')).toBeLessThan(at('rec.reception_visits'));
    expect(at('rec.capture_requirement_overrides')).toBeLessThan(at('rec.reception_visits'));
  });
});
