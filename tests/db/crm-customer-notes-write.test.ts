/**
 * DBCR-P1-16-001 — CRM customer notes write capability on shared.notes.
 *
 * Proves the additive grant + two RLS policies added by
 * supabase/migrations/20260730090000_crm_customer_notes_write_capability.sql,
 * plus the seeded permission crm.customer.note.write. Before this change
 * shared.notes was SELECT-only for app_runtime (INSERT raised 42501). After it,
 * a note author holding crm.customer.note.write may create, revise, and
 * soft-retire a note attached to a LIVE customer in their OWN tenant — and every
 * other path stays denied. Nothing widens beyond customer notes.
 *
 * Admin owns fixture setup; every capability and denial runs through the
 * least-privilege runtime/readonly login, exactly like the Phase 1-5 suite.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  TENANT_A,
  TENANT_B,
  USER_A,
  adminPool,
  cleanFixtures,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  readonlyPool,
  runtimePool,
  withRolledBackTx,
} from './helpers';

const ROLE_A = 'c1600000-0000-4000-8000-000000000001';
const ROLE_B = 'c1600000-0000-4000-8000-000000000002';
// Tenant A: AUTHOR holds crm.customer.note.write, AUTHOR2 also holds it (a second
// authorized user, to prove per-author isolation), NOPERM holds nothing.
const AUTHOR = 'c1600000-0000-4000-8000-000000000101';
const AUTHOR2 = 'c1600000-0000-4000-8000-000000000102';
const NOPERM = 'c1600000-0000-4000-8000-000000000103';
// Tenant B author (holds the permission in tenant B).
const AUTHOR_B = 'c1600000-0000-4000-8000-000000000201';
const PARTNER_A = 'c1600000-0000-4000-8000-000000000301';
const PARTNER_B = 'c1600000-0000-4000-8000-000000000302';
const NOTE_SEED = 'c1600000-0000-4000-8000-000000000401';

let admin: Pool;
let runtime: Pool;
let readonly: Pool;

async function seedFixtures(): Promise<void> {
  // The permission is platform reference data (seed 04). Insert idempotently so
  // the suite is self-contained regardless of seed order; never delete it.
  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ('crm.customer.note.write', 'crm', 'Author and edit customer notes', 'medium', $1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES
       ($1, $5, 'supabase', 'crm-note-author-a',  'crm-note-a@example.test',  'CRM note author A',  'active', $6),
       ($2, $5, 'supabase', 'crm-note-author-a2', 'crm-note-a2@example.test', 'CRM note author A2', 'active', $6),
       ($3, $5, 'supabase', 'crm-note-noperm',    'crm-note-np@example.test', 'CRM note no-perm',   'active', $6),
       ($4, $7, 'supabase', 'crm-note-author-b',  'crm-note-b@example.test',  'CRM note author B',  'active', $6)
     ON CONFLICT (id) DO NOTHING`,
    [AUTHOR, AUTHOR2, NOPERM, AUTHOR_B, TENANT_A, USER_A, TENANT_B]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $3, 'crm_note_author', 'CRM note author', $5),
            ($2, $4, 'crm_note_author', 'CRM note author', $5)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_A, ROLE_B, TENANT_A, TENANT_B, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid, $2::uuid, id, 'allow', $3::uuid FROM iam.permissions WHERE permission_code = 'crm.customer.note.write'
     UNION ALL
     SELECT $4::uuid, $5::uuid, id, 'allow', $3::uuid FROM iam.permissions WHERE permission_code = 'crm.customer.note.write'
     ON CONFLICT DO NOTHING`,
    [TENANT_A, ROLE_A, USER_A, TENANT_B, ROLE_B]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, granted_by, created_by)
     VALUES
       ('c1600000-0000-4000-8000-000000000501', $1, $2, $3, $8, $8),
       ('c1600000-0000-4000-8000-000000000502', $1, $4, $3, $8, $8),
       ('c1600000-0000-4000-8000-000000000503', $5, $6, $7, $8, $8)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, AUTHOR, ROLE_A, AUTHOR2, TENANT_B, AUTHOR_B, ROLE_B, USER_A]
  );
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, created_by)
     VALUES ($1, $3, 'individual', 'Customer A', $5),
            ($2, $4, 'individual', 'Customer B', $5)
     ON CONFLICT (id) DO NOTHING`,
    [PARTNER_A, PARTNER_B, TENANT_A, TENANT_B, USER_A]
  );
  // A committed note authored by AUTHOR on PARTNER_A, for the revision tests.
  await admin.query(
    `INSERT INTO shared.notes
       (id, tenant_id, entity_type, entity_id, author_id, body, classification, visibility, created_by)
     VALUES ($1, $2, 'crm.business_partners', $3, $4, 'Original body', 'internal', 'internal', $4)
     ON CONFLICT (id) DO NOTHING`,
    [NOTE_SEED, TENANT_A, PARTNER_A, AUTHOR]
  );
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  readonly = readonlyPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await seedFixtures();
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await readonly.end();
  await admin.end();
});

const INSERT_NOTE = `INSERT INTO shared.notes
    (tenant_id, entity_type, entity_id, author_id, body, classification, visibility, created_by)
   VALUES ($1, $2, $3, $4, $5, 'internal', 'internal', $4)`;

describe('DBCR-P1-16-001 — CRM customer note creation', () => {
  it('permits an authorized author to create a note on a live customer', async () => {
    const r = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: AUTHOR }, (c) =>
      c.query(INSERT_NOTE, [TENANT_A, 'crm.business_partners', PARTNER_A, AUTHOR, 'A fresh note'])
    );
    expect(r.rowCount).toBe(1);
  });

  it('denies a note author who lacks crm.customer.note.write (42501)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: NOPERM }, (c) =>
      expectSqlState(
        c.query(INSERT_NOTE, [TENANT_A, 'crm.business_partners', PARTNER_A, NOPERM, 'No perm']),
        '42501'
      )
    );
  });

  it('denies a note on a non-customer entity type (42501)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: AUTHOR }, (c) =>
      expectSqlState(
        c.query(INSERT_NOTE, [TENANT_A, 'crm.vehicles', PARTNER_A, AUTHOR, 'Wrong entity']),
        '42501'
      )
    );
  });

  it('denies a note on a non-existent customer (42501)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: AUTHOR }, (c) =>
      expectSqlState(
        c.query(INSERT_NOTE, [
          TENANT_A,
          'crm.business_partners',
          '00000000-0000-4000-8000-0000000000ff',
          AUTHOR,
          'Ghost',
        ]),
        '42501'
      )
    );
  });

  it("denies a note on another tenant's customer (42501)", async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: AUTHOR }, (c) =>
      expectSqlState(
        c.query(INSERT_NOTE, [
          TENANT_A,
          'crm.business_partners',
          PARTNER_B,
          AUTHOR,
          'Cross tenant',
        ]),
        '42501'
      )
    );
  });

  it('denies authoring a note as a different user — author spoof (42501)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: AUTHOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.notes
             (tenant_id, entity_type, entity_id, author_id, body, classification, visibility, created_by)
           VALUES ($1, 'crm.business_partners', $2, $3, 'Spoof', 'internal', 'internal', $4)`,
          [TENANT_A, PARTNER_A, AUTHOR2, AUTHOR]
        ),
        '42501'
      )
    );
  });

  it('denies the readonly role from creating a note (42501)', async () => {
    await withRolledBackTx(readonly, { tenantId: TENANT_A, userId: AUTHOR }, (c) =>
      expectSqlState(
        c.query(INSERT_NOTE, [TENANT_A, 'crm.business_partners', PARTNER_A, AUTHOR, 'Readonly']),
        '42501'
      )
    );
  });
});

describe('DBCR-P1-16-001 — CRM customer note revision and retirement', () => {
  it('permits the author to revise their own note and stamps edited_at', async () => {
    const r = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: AUTHOR }, (c) =>
      c.query(
        `UPDATE shared.notes SET body = 'Revised body'
          WHERE id = $1 RETURNING edited_at, record_version`,
        [NOTE_SEED]
      )
    );
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].edited_at).not.toBeNull();
    expect(r.rows[0].record_version).toBe(2);
  });

  it('permits the author to soft-retire their own note', async () => {
    const r = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: AUTHOR }, (c) =>
      c.query(`UPDATE shared.notes SET deleted_at = now() WHERE id = $1`, [NOTE_SEED])
    );
    expect(r.rowCount).toBe(1);
  });

  it("does not let a different authorized user edit another author's note", async () => {
    const r = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: AUTHOR2 }, (c) =>
      c.query(`UPDATE shared.notes SET body = 'Hijacked' WHERE id = $1`, [NOTE_SEED])
    );
    expect(r.rowCount).toBe(0);
  });

  it('cannot physically delete a note (42501)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: AUTHOR }, (c) =>
      expectSqlState(c.query(`DELETE FROM shared.notes WHERE id = $1`, [NOTE_SEED]), '42501')
    );
  });

  it('cannot re-parent a note by naming a frozen column on UPDATE (42501)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: AUTHOR }, (c) =>
      expectSqlState(
        c.query(`UPDATE shared.notes SET author_id = $2 WHERE id = $1`, [NOTE_SEED, AUTHOR2]),
        '42501'
      )
    );
  });
});

describe('DBCR-P1-16-001 — capability does not widen beyond customer notes', () => {
  it('still denies runtime writes to shared.tags, entity_tags, and comments (42501)', async () => {
    const denied: Array<[string, unknown[]]> = [
      [
        `INSERT INTO shared.tags (tenant_id, tag_code, name, created_by)
         VALUES ($1, 'runtime_tag', 'Runtime tag', $2)`,
        [TENANT_A, AUTHOR],
      ],
      [
        `INSERT INTO shared.entity_tags (tenant_id, tag_id, entity_type, entity_id, assigned_by, created_by)
         VALUES ($1, gen_random_uuid(), 'crm.business_partners', $2, $3, $3)`,
        [TENANT_A, PARTNER_A, AUTHOR],
      ],
      [
        `INSERT INTO shared.comments (tenant_id, entity_type, entity_id, author_id, body, created_by)
         VALUES ($1, 'crm.business_partners', $2, $3, 'Runtime comment', $3)`,
        [TENANT_A, PARTNER_A, AUTHOR],
      ],
    ];
    for (const [sql, params] of denied) {
      await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: AUTHOR }, (c) =>
        expectSqlState(c.query(sql, params), '42501')
      );
    }
  });
});
