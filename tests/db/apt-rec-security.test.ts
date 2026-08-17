/**
 * Phase 1-8 Appointment/Reception security posture (P1-08-SEC).
 *
 * Auto-enumerates EVERY apt/rec table from the live catalog and asserts the
 * security invariants structurally, so a NEW table that lacks RLS, grants, the
 * sensitive gate, or append-only protection fails automatically — the suite needs
 * no hand-maintained per-table list.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { adminPool } from './helpers';

// Row-gated restricted-payload tables: their read policy MUST require sensitive.view.
const RESTRICTED_TABLES = new Set(['rec.complaint_details', 'rec.vehicle_content_details']);
// Append-only ledgers: app roles may INSERT + SELECT but never UPDATE/DELETE.
const APPEND_ONLY = new Set([
  'apt.appointment_status_history',
  'rec.reception_status_history',
  'rec.custody_history',
  'rec.signatures',
  'rec.refusals',
  'rec.authorizations',
  // The reception evidence contracts (Owner decisions FE-012, FE-018, FE-019).
  // A waived capture and a signature lifecycle event are decisions, and a
  // decision that could be edited afterwards is not a record of anything.
  'rec.capture_requirement_overrides',
  'rec.signature_events',
]);
// Dual-scope config catalogs (tenant_id nullable by design; not branch-scoped).
const CONFIG_CATALOGS = new Set([
  'apt.appointment_types',
  'apt.source_channels',
  'apt.cancellation_reasons',
  'rec.visit_reasons',
  'rec.fuel_levels',
  'rec.warning_light_codes',
  'rec.refusal_reasons',
]);
/**
 * Tenant-scoped configuration that is NOT branch-scoped, so the
 * tenant/company/branch NOT NULL rule below does not apply to it.
 *
 * Distinct from `CONFIG_CATALOGS` on purpose: those carry a nullable
 * `tenant_id` because a PLATFORM default may exist. These three always belong
 * to a tenant — `tenant_id` is NOT NULL on all of them — and it is
 * `company_id`/`branch_id` that are optional, because a template or a capture
 * rule may apply to the whole tenant or to one branch
 * (`ck_damage_map_templates_scope`, `ck_capture_policy_scope`).
 * `rec.damage_map_template_versions` has neither column at all: it is scoped by
 * the slot it belongs to, through `fk_damage_map_template_version_template`.
 */
const TENANT_SCOPED_CONFIG = new Set([
  'rec.capture_policy_rules',
  'rec.damage_map_templates',
  'rec.damage_map_template_versions',
]);

let admin: Pool;
let tables: string[] = [];

beforeAll(async () => {
  admin = adminPool();
  const { rows } = await admin.query(
    `SELECT table_schema || '.' || table_name AS fq
       FROM information_schema.tables
      WHERE table_schema IN ('apt', 'rec') AND table_type = 'BASE TABLE'
      ORDER BY 1`
  );
  tables = rows.map((r) => r.fq);
});

afterAll(async () => {
  await admin.end();
});

describe('apt/rec security posture (auto-enumerated)', () => {
  it('discovered the full apt/rec table set', () => {
    // 6 apt + 29 rec (guards a regression that would silently drop coverage).
    // The reception evidence contracts add six: rec.capture_policy_rules,
    // rec.damage_map_templates, rec.damage_map_template_versions,
    // rec.reception_evidence_bindings, rec.capture_requirement_overrides and
    // rec.signature_events. Every assertion below is auto-enumerated, so all six
    // are held to the same posture as the twenty-three that preceded them.
    expect(tables.length).toBe(35);
  });

  it('every apt/rec table has RLS enabled AND forced', async () => {
    const { rows } = await admin.query(
      `SELECT n.nspname || '.' || c.relname AS fq, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('apt', 'rec') AND c.relkind = 'r'`
    );
    for (const r of rows) {
      expect(r.relrowsecurity, `${r.fq} RLS enabled`).toBe(true);
      expect(r.relforcerowsecurity, `${r.fq} RLS forced`).toBe(true);
    }
  });

  it('no apt/rec table grants DELETE to any application role', async () => {
    const { rows } = await admin.query(
      `SELECT table_schema || '.' || table_name AS fq
         FROM information_schema.role_table_grants
        WHERE table_schema IN ('apt', 'rec')
          AND grantee IN ('app_runtime', 'app_readonly', 'app_worker')
          AND privilege_type = 'DELETE'`
    );
    expect(rows.map((r) => r.fq)).toEqual([]);
  });

  it('app_readonly holds SELECT only (never INSERT/UPDATE) on apt/rec', async () => {
    const { rows } = await admin.query(
      `SELECT table_schema || '.' || table_name AS fq, privilege_type
         FROM information_schema.role_table_grants
        WHERE table_schema IN ('apt', 'rec') AND grantee = 'app_readonly'
          AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')`
    );
    expect(rows.map((r) => `${r.fq}:${r.privilege_type}`)).toEqual([]);
  });

  it('every table carries at least a SELECT and an INSERT policy for the runtime', async () => {
    const { rows } = await admin.query(
      `SELECT n.nspname || '.' || c.relname AS fq, p.polcmd
         FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('apt', 'rec')`
    );
    const byTable = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!byTable.has(r.fq)) byTable.set(r.fq, new Set());
      byTable.get(r.fq)!.add(r.polcmd);
    }
    for (const t of tables) {
      const cmds = byTable.get(t) ?? new Set();
      // polcmd: 'r' SELECT, 'a' INSERT, 'w' UPDATE, '*' ALL
      expect(cmds.has('r'), `${t} has a SELECT policy`).toBe(true);
      expect(cmds.has('a'), `${t} has an INSERT policy`).toBe(true);
    }
  });

  it('restricted-payload tables gate reads on iam.sensitive.view', async () => {
    for (const t of RESTRICTED_TABLES) {
      const [schema, name] = t.split('.');
      const { rows } = await admin.query(
        `SELECT pg_get_expr(p.polqual, p.polrelid) AS qual
           FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = $2 AND p.polcmd = 'r'`,
        [schema, name]
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.qual, `${t} SELECT policy must require sensitive.view`).toContain(
          'has_permission'
        );
      }
    }
  });

  it('append-only ledgers grant INSERT+SELECT but never UPDATE to the runtime', async () => {
    const { rows } = await admin.query(
      `SELECT table_schema || '.' || table_name AS fq, privilege_type
         FROM information_schema.role_table_grants
        WHERE table_schema IN ('apt', 'rec') AND grantee = 'app_runtime'
          AND privilege_type IN ('INSERT', 'SELECT', 'UPDATE')`
    );
    const grants = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!grants.has(r.fq)) grants.set(r.fq, new Set());
      grants.get(r.fq)!.add(r.privilege_type);
    }
    for (const t of APPEND_ONLY) {
      const g = grants.get(t) ?? new Set();
      expect(g.has('INSERT'), `${t} runtime INSERT`).toBe(true);
      expect(g.has('SELECT'), `${t} runtime SELECT`).toBe(true);
      expect(g.has('UPDATE'), `${t} must NOT grant runtime UPDATE`).toBe(false);
    }
  });

  it('every branch-scoped table carries tenant/company/branch NOT NULL', async () => {
    const { rows } = await admin.query(
      `SELECT table_schema || '.' || table_name AS fq, column_name, is_nullable
         FROM information_schema.columns
        WHERE table_schema IN ('apt', 'rec')
          AND column_name IN ('tenant_id', 'company_id', 'branch_id')`
    );
    const cols = new Map<string, Map<string, string>>();
    for (const r of rows) {
      if (!cols.has(r.fq)) cols.set(r.fq, new Map());
      cols.get(r.fq)!.set(r.column_name, r.is_nullable);
    }
    for (const t of tables) {
      if (CONFIG_CATALOGS.has(t)) continue; // dual-scope: tenant_id nullable, no company/branch
      if (TENANT_SCOPED_CONFIG.has(t)) continue; // tenant-owned, branch optional or absent
      const c = cols.get(t)!;
      expect(c.get('tenant_id'), `${t} tenant_id NOT NULL`).toBe('NO');
      expect(c.get('company_id'), `${t} company_id NOT NULL`).toBe('NO');
      expect(c.get('branch_id'), `${t} branch_id NOT NULL`).toBe('NO');
    }
  });
});
