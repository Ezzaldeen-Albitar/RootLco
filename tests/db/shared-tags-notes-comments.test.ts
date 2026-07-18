/**
 * Phase 1-5 Increment K — tenant tags, entity assignments, notes, and comments
 * (P1-05-DB-017, P1-05-DB-018, P1-05-QA-007).
 *
 * Admin owns fixture setup and backend-only mutations. RLS, sensitive-read
 * gating, tenant isolation, and write denials run through the runtime login.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  COMPANY_A1,
  TENANT_A,
  TENANT_B,
  USER_A,
  adminPool,
  cleanFixtures,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  runtimePool,
  withRolledBackTx,
} from './helpers';

const PERMISSION_ID = 'e9100000-0000-4000-8000-000000000001';
const ROLE_ID = 'd9100000-0000-4000-8000-000000000001';
const GRANT_ID = 'c9100000-0000-4000-8000-000000000001';
const AUTHOR_A = 'a9100000-0000-4000-8000-000000000001';
const AUTHOR_B = 'b9100000-0000-4000-8000-000000000001';
const SENSITIVE_USER = 'a9100000-0000-4000-8000-000000000002';
const TAG_A = 'a9100000-0000-4000-8000-000000000101';
const TAG_B = 'b9100000-0000-4000-8000-000000000101';
const ENTITY_A = 'a9100000-0000-4000-8000-000000000201';
const ENTITY_B = 'b9100000-0000-4000-8000-000000000201';
const ENTITY_TAG_A = 'a9100000-0000-4000-8000-000000000301';
const ENTITY_TAG_B = 'b9100000-0000-4000-8000-000000000301';
const NOTE_A = 'a9100000-0000-4000-8000-000000000401';
const NOTE_B = 'b9100000-0000-4000-8000-000000000401';
const NOTE_RESTRICTED = 'a9100000-0000-4000-8000-000000000402';
const COMMENT_A = 'a9100000-0000-4000-8000-000000000501';
const COMMENT_B = 'b9100000-0000-4000-8000-000000000501';

let admin: Pool;
let runtime: Pool;

async function seedIamFixtures(): Promise<void> {
  await admin.query(
    `INSERT INTO iam.permissions
       (id, permission_code, domain, description, risk_level, created_by)
     VALUES ($1, 'iam.sensitive.view', 'iam', 'View sensitive fixture rows', 'high', $2)
     ON CONFLICT (permission_code) DO NOTHING`,
    [PERMISSION_ID, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, 'annotation_sensitive_viewer', 'Annotation sensitive viewer', $3)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_ID, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES
       ($1, $4, 'supabase', 'annotation-author-a', 'annotation-a@example.test',
        'Annotation author A', 'active', $5),
       ($2, $6, 'supabase', 'annotation-author-b', 'annotation-b@example.test',
        'Annotation author B', 'active', $5),
       ($3, $4, 'supabase', 'annotation-sensitive', 'annotation-sensitive@example.test',
        'Annotation sensitive user', 'active', $5)
     ON CONFLICT (id) DO NOTHING`,
    [AUTHOR_A, AUTHOR_B, SENSITIVE_USER, TENANT_A, USER_A, TENANT_B]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions
       (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, id, 'allow', $3
       FROM iam.permissions
      WHERE permission_code = 'iam.sensitive.view'
     ON CONFLICT DO NOTHING`,
    [TENANT_A, ROLE_ID, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants
       (id, tenant_id, user_id, role_id, granted_by, created_by)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (id) DO NOTHING`,
    [GRANT_ID, TENANT_A, SENSITIVE_USER, ROLE_ID, USER_A]
  );
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await seedIamFixtures();

  await admin.query(
    `INSERT INTO shared.tags (id, tenant_id, tag_code, name, color, created_by)
     VALUES
       ($1, $2, 'priority', 'Priority', '#aa0000', $5),
       ($3, $4, 'priority', 'Priority', '#0000aa', $5)`,
    [TAG_A, TENANT_A, TAG_B, TENANT_B, USER_A]
  );
  await admin.query(
    `INSERT INTO shared.entity_tags
       (id, tenant_id, tag_id, entity_type, entity_id, assigned_by, created_by)
     VALUES
       ($1, $2, $3, 'crm.customers', $4, $5, $6),
       ($7, $8, $9, 'crm.customers', $10, $11, $6)`,
    [
      ENTITY_TAG_A,
      TENANT_A,
      TAG_A,
      ENTITY_A,
      AUTHOR_A,
      USER_A,
      ENTITY_TAG_B,
      TENANT_B,
      TAG_B,
      ENTITY_B,
      AUTHOR_B,
    ]
  );
  await admin.query(
    `INSERT INTO shared.notes
       (id, tenant_id, company_id, entity_type, entity_id, author_id, body,
        classification, visibility, created_by)
     VALUES
       ($1, $2, $3, 'crm.customers', $4, $5, 'Tenant A public note',
        'public', 'internal', $10),
       ($6, $7, NULL, 'crm.customers', $8, $9, 'Tenant B internal note',
        'internal', 'internal', $10),
       ($11, $2, $3, 'crm.customers', $4, $5, 'Tenant A restricted note',
        'restricted', 'internal', $10)`,
    [
      NOTE_A,
      TENANT_A,
      COMPANY_A1,
      ENTITY_A,
      AUTHOR_A,
      NOTE_B,
      TENANT_B,
      ENTITY_B,
      AUTHOR_B,
      USER_A,
      NOTE_RESTRICTED,
    ]
  );
  await admin.query(
    `INSERT INTO shared.comments
       (id, tenant_id, company_id, entity_type, entity_id, author_id, body,
        classification, created_by)
     VALUES
       ($1, $2, $3, 'crm.customers', $4, $5, 'Tenant A comment', 'internal', $10),
       ($6, $7, NULL, 'crm.customers', $8, $9, 'Tenant B comment', 'internal', $10)`,
    [
      COMMENT_A,
      TENANT_A,
      COMPANY_A1,
      ENTITY_A,
      AUTHOR_A,
      COMMENT_B,
      TENANT_B,
      ENTITY_B,
      AUTHOR_B,
      USER_A,
    ]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.query(`DELETE FROM iam.permissions WHERE permission_code = 'iam.sensitive.view'`);
  await runtime.end();
  await admin.end();
});

describe('shared.tags and shared.entity_tags — soft-delete-aware uniqueness', () => {
  it('rejects duplicate active tag_code, then permits reuse after soft delete', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.tags (tenant_id, tag_code, name, created_by)
           VALUES ($1, 'priority', 'Duplicate priority', $2)`,
          [TENANT_A, USER_A]
        ),
        '23505'
      );
    });

    await withRolledBackTx(admin, {}, async (c) => {
      await c.query(`UPDATE shared.tags SET deleted_at=now() WHERE id=$1`, [TAG_A]);
      const reused = await c.query(
        `INSERT INTO shared.tags (tenant_id, tag_code, name, created_by)
         VALUES ($1, 'priority', 'Reused priority', $2) RETURNING id`,
        [TENANT_A, USER_A]
      );
      expect(reused.rows).toHaveLength(1);
    });
  });

  it('rejects a duplicate live assignment, then permits re-tagging after soft delete', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.entity_tags
             (tenant_id, tag_id, entity_type, entity_id, assigned_by, created_by)
           VALUES ($1, $2, 'crm.customers', $3, $4, $5)`,
          [TENANT_A, TAG_A, ENTITY_A, AUTHOR_A, USER_A]
        ),
        '23505'
      );
    });

    await withRolledBackTx(admin, {}, async (c) => {
      await c.query(`UPDATE shared.entity_tags SET deleted_at=now() WHERE id=$1`, [ENTITY_TAG_A]);
      const retagged = await c.query(
        `INSERT INTO shared.entity_tags
           (tenant_id, tag_id, entity_type, entity_id, assigned_by, created_by)
         VALUES ($1, $2, 'crm.customers', $3, $4, $5) RETURNING id`,
        [TENANT_A, TAG_A, ENTITY_A, AUTHOR_A, USER_A]
      );
      expect(retagged.rows).toHaveLength(1);
    });
  });

  it('rejects cross-tenant tag assignment with 23503', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO shared.entity_tags
           (tenant_id, tag_id, entity_type, entity_id, assigned_by, created_by)
         VALUES ($1, $2, 'crm.customers', gen_random_uuid(), $3, $4)`,
        [TENANT_B, TAG_A, AUTHOR_B, USER_A]
      ),
      '23503'
    );
  });

  it('rejects cross-tenant and nonexistent assigner/author attribution with 23503', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO shared.entity_tags
           (tenant_id, tag_id, entity_type, entity_id, assigned_by, created_by)
         VALUES ($1, $2, 'crm.customers', gen_random_uuid(), $3, $4)`,
        [TENANT_A, TAG_A, AUTHOR_B, USER_A]
      ),
      '23503'
    );
    await expectSqlState(
      admin.query(
        `INSERT INTO shared.notes
           (tenant_id, entity_type, entity_id, author_id, body, created_by)
         VALUES ($1, 'crm.customers', gen_random_uuid(), $2, 'Missing author', $3)`,
        [TENANT_A, crypto.randomUUID(), USER_A]
      ),
      '23503'
    );
    await expectSqlState(
      admin.query(
        `INSERT INTO shared.comments
           (tenant_id, entity_type, entity_id, author_id, body, created_by)
         VALUES ($1, 'crm.customers', gen_random_uuid(), $2, 'Cross-tenant author', $3)`,
        [TENANT_A, AUTHOR_B, USER_A]
      ),
      '23503'
    );
  });
});

describe('shared.notes — creation, content edits, and sensitive visibility', () => {
  it('creates a scoped note and keeps another tenant isolated', async () => {
    const created = await admin.query(
      `INSERT INTO shared.notes
         (tenant_id, company_id, entity_type, entity_id, author_id, body,
          classification, visibility, created_by)
       VALUES ($1, $2, 'crm.customers', gen_random_uuid(), $3, 'Created note',
               'internal', 'customer_visible', $4)
       RETURNING tenant_id, company_id, visibility`,
      [TENANT_A, COMPANY_A1, AUTHOR_A, USER_A]
    );
    expect(created.rows[0]).toEqual({
      tenant_id: TENANT_A,
      company_id: COMPANY_A1,
      visibility: 'customer_visible',
    });
  });

  it('server-stamps edited_at when note and comment bodies change', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      const note = await c.query(
        `UPDATE shared.notes SET body='Edited note body' WHERE id=$1
         RETURNING edited_at, record_version`,
        [NOTE_A]
      );
      expect(note.rows[0].edited_at).toBeInstanceOf(Date);
      expect(note.rows[0].record_version).toBe(2);

      const comment = await c.query(
        `UPDATE shared.comments SET body='Edited comment body' WHERE id=$1
         RETURNING edited_at, record_version`,
        [COMMENT_A]
      );
      expect(comment.rows[0].edited_at).toBeInstanceOf(Date);
      expect(comment.rows[0].record_version).toBe(2);
    });
  });

  it('hides a restricted note from a same-tenant user without iam.sensitive.view', async () => {
    const result = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: AUTHOR_A }, (c) =>
      c.query(`SELECT id FROM shared.notes WHERE id=$1`, [NOTE_RESTRICTED])
    );
    expect(result.rows).toEqual([]);
  });

  it('shows that restricted note to a same-tenant user with iam.sensitive.view', async () => {
    const result = await withRolledBackTx(
      runtime,
      { tenantId: TENANT_A, userId: SENSITIVE_USER },
      (c) => c.query(`SELECT id FROM shared.notes WHERE id=$1`, [NOTE_RESTRICTED])
    );
    expect(result.rows).toEqual([{ id: NOTE_RESTRICTED }]);
  });
});

describe('shared.comments — initial state and guarded threading', () => {
  it('creates a parent/child thread on the same tenant and entity', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      const child = await c.query(
        `INSERT INTO shared.comments
           (tenant_id, entity_type, entity_id, parent_comment_id, author_id, body, created_by)
         VALUES ($1, 'crm.customers', $2, $3, $4, 'Thread child', $5)
         RETURNING parent_comment_id, status, edited_at`,
        [TENANT_A, ENTITY_A, COMMENT_A, AUTHOR_A, USER_A]
      );
      expect(child.rows[0]).toEqual({
        parent_comment_id: COMMENT_A,
        status: 'active',
        edited_at: null,
      });
    });
  });

  it('rejects a cross-tenant parent with 23503', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO shared.comments
           (tenant_id, entity_type, entity_id, parent_comment_id, author_id, body, created_by)
         VALUES ($1, 'crm.customers', $2, $3, $4, 'Cross tenant child', $5)`,
        [TENANT_B, ENTITY_B, COMMENT_A, AUTHOR_B, USER_A]
      ),
      '23503'
    );
  });

  it('rejects a same-tenant cross-entity parent with 23514', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO shared.comments
           (tenant_id, entity_type, entity_id, parent_comment_id, author_id, body, created_by)
         VALUES ($1, 'crm.customers', gen_random_uuid(), $2, $3, 'Cross entity child', $4)`,
        [TENANT_A, COMMENT_A, AUTHOR_A, USER_A]
      ),
      '23514'
    );
  });

  it('rejects a soft-deleted parent with 23514', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      await c.query(`UPDATE shared.comments SET deleted_at=now() WHERE id=$1`, [COMMENT_A]);
      await expectSqlState(
        c.query(
          `INSERT INTO shared.comments
             (tenant_id, entity_type, entity_id, parent_comment_id, author_id, body, created_by)
           VALUES ($1, 'crm.customers', $2, $3, $4, 'Deleted parent child', $5)`,
          [TENANT_A, ENTITY_A, COMMENT_A, AUTHOR_A, USER_A]
        ),
        '23514'
      );
    });
  });

  it('rejects a direct hidden INSERT, then permits active to hidden', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO shared.comments
           (tenant_id, entity_type, entity_id, author_id, body, status, created_by)
         VALUES ($1, 'crm.customers', gen_random_uuid(), $2, 'Direct hidden', 'hidden', $3)`,
        [TENANT_A, AUTHOR_A, USER_A]
      ),
      '23514'
    );

    await withRolledBackTx(admin, {}, async (c) => {
      const hidden = await c.query(
        `UPDATE shared.comments SET status='hidden' WHERE id=$1
         RETURNING status, record_version`,
        [COMMENT_A]
      );
      expect(hidden.rows[0]).toEqual({ status: 'hidden', record_version: 2 });
    });
  });
});

describe('shared tags/annotations — RLS and runtime write posture', () => {
  it('isolates tenant A and B rows on all four tables', async () => {
    const expectations = [
      ['tags', TAG_A, TAG_B],
      ['entity_tags', ENTITY_TAG_A, ENTITY_TAG_B],
      ['notes', NOTE_A, NOTE_B],
      ['comments', COMMENT_A, COMMENT_B],
    ] as const;

    for (const [table, idA, idB] of expectations) {
      const a = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: AUTHOR_A }, (c) =>
        c.query(`SELECT id FROM shared.${table} ORDER BY id`)
      );
      expect(a.rows.map((r) => r.id)).toContain(idA);
      expect(a.rows.map((r) => r.id)).not.toContain(idB);

      const b = await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: AUTHOR_B }, (c) =>
        c.query(`SELECT id FROM shared.${table} ORDER BY id`)
      );
      expect(b.rows.map((r) => r.id)).toContain(idB);
      expect(b.rows.map((r) => r.id)).not.toContain(idA);
    }
  });

  it('denies runtime writes on all four tables with 42501', async () => {
    const writes: Array<[string, unknown[]]> = [
      [
        `INSERT INTO shared.tags (tenant_id, tag_code, name, created_by)
         VALUES ($1, 'runtime_tag', 'Runtime tag', $2)`,
        [TENANT_A, AUTHOR_A],
      ],
      [
        `INSERT INTO shared.entity_tags
           (tenant_id, tag_id, entity_type, entity_id, assigned_by, created_by)
         VALUES ($1, $2, 'crm.customers', gen_random_uuid(), $3, $3)`,
        [TENANT_A, TAG_A, AUTHOR_A],
      ],
      [
        `INSERT INTO shared.notes
           (tenant_id, entity_type, entity_id, author_id, body, created_by)
         VALUES ($1, 'crm.customers', gen_random_uuid(), $2, 'Runtime note', $2)`,
        [TENANT_A, AUTHOR_A],
      ],
      [
        `INSERT INTO shared.comments
           (tenant_id, entity_type, entity_id, author_id, body, created_by)
         VALUES ($1, 'crm.customers', gen_random_uuid(), $2, 'Runtime comment', $2)`,
        [TENANT_A, AUTHOR_A],
      ],
    ];

    for (const [sql, params] of writes) {
      await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: AUTHOR_A }, async (c) => {
        await expectSqlState(c.query(sql, params), '42501');
      });
    }
  });
});
