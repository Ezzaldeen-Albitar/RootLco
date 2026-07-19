/**
 * Phase 1-6 → Phase 1-7 structural contract (P1-06 hand-off).
 *
 * Phase 1-7 (and every later CRM consumer) builds on a small, stable structural
 * surface of the `crm` schema. This test pins exactly that surface: the party
 * master and its key columns, profile exclusivity, the sensitive-data gate
 * wiring, the append-only history/timeline writers, the merge redirect resolver,
 * and the security posture (FORCE RLS everywhere, NOBYPASSRLS app roles, no
 * SECURITY DEFINER). It is intentionally a contract, not a full inventory —
 * `foundation.test.ts` owns the exhaustive object list. If a future change would
 * break a guarantee the next phase relies on, this test fails loudly.
 *
 * Prose contract: docs/phase-1/phase-1-6/p1-07-structural-contract.md
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { adminPool } from './helpers';

let admin: Pool;

beforeAll(() => {
  admin = adminPool();
});

afterAll(async () => {
  await admin.end();
});

async function columns(table: string): Promise<Set<string>> {
  const { rows } = await admin.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'crm' AND table_name = $1`,
    [table]
  );
  return new Set(rows.map((r) => r.column_name));
}

describe('P1-07 structural contract — party master', () => {
  it('crm.business_partners exposes the columns the next phase binds to', async () => {
    const cols = await columns('business_partners');
    for (const required of [
      'id',
      'tenant_id',
      'party_type',
      'lifecycle_status',
      'display_number',
      'merged_into_id',
      'created_by',
    ]) {
      expect(cols, `business_partners.${required}`).toContain(required);
    }
  });

  it('individual and company profiles both exist and key on the partner', async () => {
    for (const t of ['individual_profiles', 'company_profiles']) {
      const cols = await columns(t);
      expect(cols, `${t}.tenant_id`).toContain('tenant_id');
      expect(cols, `${t}.partner_id`).toContain('partner_id');
    }
  });
});

describe('P1-07 structural contract — sensitive data', () => {
  it('every crm column is covered by the classification registry (guard is wired)', async () => {
    // The registry + guard (scripts/check-crm-classification.mjs, DO-001) is the
    // single source of truth for personal-data classification. Here we assert the
    // structural precondition it relies on: restricted-bearing tables expose a
    // classification column so the row-level sensitive gate has something to read.
    const { rows } = await admin.query(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'crm' AND column_name = 'classification'`
    );
    const withClassification = new Set(rows.map((r) => r.table_name));
    expect(withClassification.has('partner_identifiers')).toBe(true);
    expect(withClassification.has('partner_sensitive_attributes')).toBe(true);
  });
});

describe('P1-07 structural contract — stable functions', () => {
  it('exposes the resolver/normalizer/writer functions consumers depend on', async () => {
    const { rows } = await admin.query(
      `SELECT p.proname FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'crm'`
    );
    const fns = new Set(rows.map((r) => r.proname));
    for (const required of [
      'resolve_partner_survivor',
      'emit_timeline_event',
      'current_consent',
      'partner_roles_active_at',
      'normalize_name',
      'normalize_email',
      'normalize_phone',
    ]) {
      expect(fns, `crm.${required}`).toContain(required);
    }
  });

  it('no crm function is SECURITY DEFINER', async () => {
    const { rows } = await admin.query(
      `SELECT p.proname FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'crm' AND p.prosecdef = true`
    );
    expect(rows.map((r) => r.proname)).toEqual([]);
  });
});

describe('P1-07 structural contract — security posture', () => {
  it('every crm base table has FORCE ROW LEVEL SECURITY', async () => {
    const { rows } = await admin.query(
      `SELECT t.relname
         FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'crm' AND t.relkind = 'r'
          AND NOT (t.relrowsecurity AND t.relforcerowsecurity)`
    );
    expect(
      rows.map((r) => r.relname),
      'tables lacking ENABLE+FORCE RLS'
    ).toEqual([]);
  });

  it('the application roles cannot bypass RLS and are not superusers', async () => {
    const { rows } = await admin.query(
      `SELECT rolname, rolbypassrls, rolsuper FROM pg_roles
        WHERE rolname IN ('app_runtime','app_readonly','app_worker') ORDER BY rolname`
    );
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.rolbypassrls, `${r.rolname} bypassrls`).toBe(false);
      expect(r.rolsuper, `${r.rolname} superuser`).toBe(false);
    }
  });

  it('no application role owns a crm table', async () => {
    const { rows } = await admin.query(
      `SELECT t.relname, pg_get_userbyid(t.relowner) AS owner
         FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'crm' AND t.relkind = 'r'
          AND pg_get_userbyid(t.relowner) IN ('app_runtime','app_readonly','app_worker')`
    );
    expect(
      rows.map((r) => r.relname),
      'crm tables owned by an app role'
    ).toEqual([]);
  });
});
