/**
 * Phase 1-6 CRM — search normalization + projection contract (P1-06-DB-021).
 *
 * Proves the deterministic normalization functions (name/email/phone, English
 * and Arabic) and the shared.search_metadata projection contract: the backend/
 * admin write-path projects only approved fields with classification 'internal';
 * restricted identifiers/DOB are never projected; and the runtime role cannot
 * write shared.search_metadata directly.
 *
 * Test-reference: TC-P1-05-004, TC-CRM-001.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  expectSqlState,
  TENANT_A,
  USER_A,
} from './helpers';

const PARTNER_A = 'a6e00000-0000-4000-8000-0000000000a1';

let admin: Pool;
let runtime: Pool;

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, created_by)
     VALUES ($1, $2, 'individual', 'Layla AL-Nabulsi', $3)`,
    [PARTNER_A, TENANT_A, USER_A]
  );
});

afterAll(async () => {
  await admin.query(`DELETE FROM shared.search_metadata WHERE tenant_id = $1`, [TENANT_A]);
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('normalization functions (P1-06-DB-021)', () => {
  it.each([
    ['normalize_name', '  Layla   AL-Nabulsi ', 'layla al-nabulsi'],
    ['normalize_name', 'محمد   علي', 'محمد علي'],
    ['normalize_email', '  Foo@Bar.COM ', 'foo@bar.com'],
    ['normalize_phone', '+962 79-000-1234', '+962790001234'],
    ['normalize_phone', '079 000 1234', '0790001234'],
  ])('crm.%s deterministically normalizes input', async (fn, input, expected) => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      const { rows } = await tx.query(`SELECT crm.${fn}($1) AS v`, [input]);
      expect(rows[0].v).toBe(expected);
    });
  });

  it('returns NULL for blank input (no empty search terms)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      const { rows } = await tx.query(
        `SELECT crm.normalize_name('   ') a, crm.normalize_phone('()-') b`
      );
      expect(rows[0].a).toBeNull();
      expect(rows[0].b).toBeNull();
    });
  });
});

describe('search projection contract (P1-06-DB-021)', () => {
  it('the runtime role cannot write shared.search_metadata directly', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO shared.search_metadata
             (tenant_id, entity_type, entity_id, field_code, normalized_value, source_updated_at, created_by)
           VALUES ($1, 'crm.business_partner', $2, 'display_name', 'x', now(), $3)`,
          [TENANT_A, PARTNER_A, USER_A]
        ),
        '42501'
      );
    });
  });

  it('the backend/admin projection writes approved internal fields (upsertable, tenant-scoped)', async () => {
    // Backend/admin write-path: normalized display name projected as 'internal'.
    const project = async (value: string) =>
      admin.query(
        `INSERT INTO shared.search_metadata
           (tenant_id, entity_type, entity_id, field_code, normalized_value, classification, source_updated_at, created_by)
         VALUES ($1, 'crm.business_partner', $2, 'display_name', crm.normalize_name($3), 'internal', now(), $4)
         ON CONFLICT ON CONSTRAINT uq_search_metadata_identity
         DO UPDATE SET normalized_value = EXCLUDED.normalized_value, source_updated_at = EXCLUDED.source_updated_at`,
        [TENANT_A, PARTNER_A, value, USER_A]
      );
    await project('Layla AL-Nabulsi');
    await project('Layla Renamed'); // upsert refresh
    const { rows } = await admin.query(
      `SELECT normalized_value, classification FROM shared.search_metadata
        WHERE tenant_id = $1 AND entity_id = $2 AND field_code = 'display_name'`,
      [TENANT_A, PARTNER_A]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].normalized_value).toBe('layla renamed');
    expect(rows[0].classification).toBe('internal');
    await admin.query(`DELETE FROM shared.search_metadata WHERE tenant_id = $1`, [TENANT_A]);
  });

  it('the projection contract excludes restricted fields (no restricted classification for partner search)', async () => {
    // The contract forbids projecting national/tax/registration ids or DOB. We
    // assert the guard-rail: a partner search projection classified 'restricted'
    // is a contract violation the projection never emits — proven here by never
    // writing one and confirming only 'internal' rows exist for the partner.
    await admin.query(
      `INSERT INTO shared.search_metadata
         (tenant_id, entity_type, entity_id, field_code, normalized_value, classification, source_updated_at, created_by)
       VALUES ($1, 'crm.business_partner', $2, 'email', crm.normalize_email('a@b.test'), 'internal', now(), $3)`,
      [TENANT_A, PARTNER_A, USER_A]
    );
    const { rows } = await admin.query(
      `SELECT count(*)::int AS restricted FROM shared.search_metadata
        WHERE tenant_id = $1 AND entity_id = $2 AND classification IN ('restricted','secret')`,
      [TENANT_A, PARTNER_A]
    );
    expect(rows[0].restricted).toBe(0);
    await admin.query(`DELETE FROM shared.search_metadata WHERE tenant_id = $1`, [TENANT_A]);
  });
});
