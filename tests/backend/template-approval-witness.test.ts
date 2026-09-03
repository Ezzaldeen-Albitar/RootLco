/**
 * `shared.template_version_approvals` — the immutable approval witness.
 *
 * Every worker case runs as a RESTRICTED ROLE, never as the admin connection: a
 * security proof taken as `postgres` proves nothing about the role the worker
 * actually connects as.
 *
 * ## What this table exists to make possible
 *
 * The BEFORE INSERT guard on `shared.outbound_messages` is SECURITY INVOKER and
 * reads `shared.template_versions`, which `app_worker` may never do — so before
 * this witness a worker could not name a template version at all, and the column
 * had to be left NULL. That is not a design; it is a hole where provenance should
 * be.
 *
 * A composite foreign key alone could not close it. Referential-integrity checks
 * DO run with the constraint's rights rather than the caller's, so existence and
 * tenancy can be made declarative — but `status` is MUTABLE, PostgreSQL cannot use
 * a partial unique index as a foreign-key target, and folding the status into the
 * referenced key would make the key refuse the UPDATE that retires any version a
 * message was ever sent from.
 *
 * So approval is recorded ONCE, immutably, and referenced thereafter. The worker's
 * question is not "is this approved now" but "was this validly approved for the
 * carried scope when it was selected" — which is the only question that can be
 * answered at consumption time without coupling a historical event to a future
 * catalogue edit.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import {
  TENANT_A,
  TENANT_B,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
  workerAppPool,
} from './helpers';

let admin: Pool;
let worker: Pool;
let runtime: Pool;

const PLATFORM_OWNER = '00000000-0000-0000-0000-000000000000';

const TPL_A = '33333333-3333-4333-8333-333333333a01';
const VER_A = '33333333-3333-4333-8333-333333333a02';
const TPL_B = '33333333-3333-4333-8333-333333333b01';
const VER_B = '33333333-3333-4333-8333-333333333b02';
const VER_A_RETIRED = '33333333-3333-4333-8333-333333333a03';
/** Approved but deliberately NOT witnessed, so the scope-lie case reaches the FK. */
const VER_A_UNWITNESSED = '33333333-3333-4333-8333-333333333a04';

/** Ids of the witnesses created for the fixture versions, read back after seeding. */
const witness: Record<string, string> = {};

async function seedApprovedVersion(input: {
  readonly templateId: string;
  readonly versionId: string;
  readonly tenantId: string;
  readonly approver: string;
  readonly code: string;
}): Promise<void> {
  await admin.query(
    `INSERT INTO shared.message_templates
       (id, scope, tenant_id, template_code, name, channel, purpose, locale_code, status, created_by)
     VALUES ($1, 'tenant', $2, $3, 'witness fixture', 'in_app', 'transactional', 'en', 'active', $4)
     ON CONFLICT (id) DO NOTHING`,
    [input.templateId, input.tenantId, input.code, input.approver]
  );
  await admin.query(
    `INSERT INTO shared.template_versions
       (id, tenant_id, template_id, version_number, subject, body, content_hash, created_by)
     VALUES ($1, $2, $3, 1, 's', 'b', decode(repeat('ab', 32), 'hex'), $4)
     ON CONFLICT (id) DO NOTHING`,
    [input.versionId, input.tenantId, input.templateId, input.approver]
  );
  // Through the shipped lifecycle: a version must START as an unstamped draft,
  // which a guard enforces, so this cannot shortcut straight to approved.
  await admin.query(
    `UPDATE shared.template_versions SET status = 'approved', approved_by = $2
      WHERE id = $1 AND status = 'draft'`,
    [input.versionId, input.approver]
  );
  await admin.query(
    `INSERT INTO shared.template_version_approvals
       (tenant_id, owner_tenant_id, template_version_id, approved_by)
     VALUES ($1, $1, $2, $3)
     ON CONFLICT (template_version_id) DO NOTHING`,
    [input.tenantId, input.versionId, input.approver]
  );
}

function enqueueSql(): string {
  return `INSERT INTO shared.outbound_messages
            (tenant_id, channel, purpose, dedupe_key, body_sha256, recipient_user_id,
             created_by, template_version_id, template_owner_tenant_id, approval_witness_id)
          VALUES ($1, 'in_app', 'transactional', $2, sha256('b'::bytea), $3, $3, $4, $5, $6)
          RETURNING id, status, template_version_id`;
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);

  await seedApprovedVersion({
    templateId: TPL_A,
    versionId: VER_A,
    tenantId: TENANT_A,
    approver: USER_A,
    code: 'fx_witness_a',
  });
  const userB = await admin.query<{ id: string }>(
    `SELECT id FROM iam.user_accounts WHERE tenant_id = $1 LIMIT 1`,
    [TENANT_B]
  );
  await seedApprovedVersion({
    templateId: TPL_B,
    versionId: VER_B,
    tenantId: TENANT_B,
    approver: userB.rows[0]?.id ?? USER_A,
    code: 'fx_witness_b',
  });
  // A second tenant-A version that will be RETIRED after its witness exists —
  // the whole point of the snapshot rule.
  await admin.query(
    `INSERT INTO shared.template_versions
       (id, tenant_id, template_id, version_number, subject, body, content_hash, created_by)
     VALUES ($1, $2, $3, 2, 's', 'b', decode(repeat('cd', 32), 'hex'), $4)
     ON CONFLICT (id) DO NOTHING`,
    [VER_A_RETIRED, TENANT_A, TPL_A, USER_A]
  );
  await admin.query(
    `UPDATE shared.template_versions SET status = 'approved', approved_by = $2
      WHERE id = $1 AND status = 'draft'`,
    [VER_A_RETIRED, USER_A]
  );
  await admin.query(
    `INSERT INTO shared.template_version_approvals
       (tenant_id, owner_tenant_id, template_version_id, approved_by)
     VALUES ($1, $1, $2, $3) ON CONFLICT (template_version_id) DO NOTHING`,
    [TENANT_A, VER_A_RETIRED, USER_A]
  );

  await admin.query(
    `INSERT INTO shared.template_versions
       (id, tenant_id, template_id, version_number, subject, body, content_hash, created_by)
     VALUES ($1, $2, $3, 3, 's', 'b', decode(repeat('ef', 32), 'hex'), $4)
     ON CONFLICT (id) DO NOTHING`,
    [VER_A_UNWITNESSED, TENANT_A, TPL_A, USER_A]
  );
  await admin.query(
    `UPDATE shared.template_versions SET status = 'approved', approved_by = $2
      WHERE id = $1 AND status = 'draft'`,
    [VER_A_UNWITNESSED, USER_A]
  );

  const rows = await admin.query<{ id: string; template_version_id: string }>(
    `SELECT id, template_version_id FROM shared.template_version_approvals
      WHERE template_version_id = ANY($1::uuid[])`,
    [[VER_A, VER_B, VER_A_RETIRED, VER_A_UNWITNESSED]]
  );
  for (const r of rows.rows) witness[r.template_version_id] = r.id;

  worker = workerAppPool(3);
  runtime = runtimeAppPool(2);
}, 240_000);

afterAll(async () => {
  if (admin) {
    // Messages first: fk_outbound_messages_approval_witness is ON DELETE RESTRICT,
    // so a witness cannot be removed while a message still cites it. That refusal
    // is the constraint working, and the teardown has to respect it.
    await admin.query(
      `DELETE FROM shared.outbound_messages WHERE template_version_id = ANY($1::uuid[])`,
      [[VER_A, VER_B, VER_A_RETIRED, VER_A_UNWITNESSED]]
    );
    await admin.query(
      `DELETE FROM shared.template_version_approvals
                        WHERE template_version_id = ANY($1::uuid[])`,
      [[VER_A, VER_B, VER_A_RETIRED, VER_A_UNWITNESSED]]
    );
    await admin.query(`DELETE FROM shared.template_versions WHERE id = ANY($1::uuid[])`, [
      [VER_A, VER_B, VER_A_RETIRED, VER_A_UNWITNESSED],
    ]);
    await admin.query(`DELETE FROM shared.message_templates WHERE id = ANY($1::uuid[])`, [
      [TPL_A, TPL_B],
    ]);
    await cleanBackendFixtures(admin);
  }
  await Promise.all([worker?.end(), runtime?.end(), admin?.end()]);
});

describe('B — the witness itself', () => {
  it('maps to exactly one version, in the version’s own scope', async () => {
    const row = await admin.query<{
      template_version_id: string;
      owner_tenant_id: string;
      tenant_id: string | null;
    }>(
      `SELECT template_version_id, owner_tenant_id, tenant_id
         FROM shared.template_version_approvals WHERE id = $1`,
      [witness[VER_A]]
    );
    expect(row.rows[0]?.template_version_id).toBe(VER_A);
    expect(row.rows[0]?.owner_tenant_id).toBe(TENANT_A);
    expect(row.rows[0]?.tenant_id).toBe(TENANT_A);
  });

  it('is CANONICAL — a second witness for the same version is refused', async () => {
    await expect(
      admin.query(
        `INSERT INTO shared.template_version_approvals
           (tenant_id, owner_tenant_id, template_version_id, approved_by)
         VALUES ($1, $1, $2, $3)`,
        [TENANT_A, VER_A, USER_A]
      )
    ).rejects.toThrow(/uq_template_version_approvals_version|duplicate key/);
  });

  it('cannot claim a scope the version does not have', async () => {
    // Tenant A's version, witnessed as though it were platform content. The
    // composite key to template_versions(owner_tenant_id, id) refuses it, so a
    // witness cannot lie about the scope it certifies.
    await expect(
      admin.query(
        `INSERT INTO shared.template_version_approvals
           (tenant_id, owner_tenant_id, template_version_id, approved_by)
         VALUES (NULL, $1, $2, $3)`,
        [PLATFORM_OWNER, VER_A_UNWITNESSED, USER_A]
      )
    ).rejects.toThrow(/fk_template_version_approvals_version|foreign key/);
  });

  it('is IMMUTABLE and undeletable — no application role holds UPDATE or DELETE', async () => {
    const grants = await admin.query<{ grantee: string; privilege_type: string }>(
      `SELECT grantee, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'shared' AND table_name = 'template_version_approvals'
          AND grantee LIKE 'app%'
        ORDER BY grantee, privilege_type`
    );
    const held = grants.rows.map((r) => `${r.grantee}:${r.privilege_type}`);
    expect(held).toEqual(['app_readonly:SELECT', 'app_runtime:INSERT', 'app_runtime:SELECT']);
    // Stated as an absence too, because the list above could grow without anyone
    // noticing which verb had been added.
    expect(held.some((g) => g.endsWith(':UPDATE'))).toBe(false);
    expect(held.some((g) => g.endsWith(':DELETE'))).toBe(false);
  });

  it('cannot be created, read, or rewritten by app_worker', async () => {
    await expect(
      worker.query(`SELECT 1 FROM shared.template_version_approvals LIMIT 1`)
    ).rejects.toThrow(/permission denied/);
    await expect(
      worker.query(
        `INSERT INTO shared.template_version_approvals
           (tenant_id, owner_tenant_id, template_version_id, approved_by)
         VALUES ($1, $1, $2, $3)`,
        [TENANT_A, VER_B, USER_A]
      )
    ).rejects.toThrow(/permission denied/);
    await expect(
      worker.query(`UPDATE shared.template_version_approvals SET approved_by = $1 WHERE false`, [
        USER_A,
      ])
    ).rejects.toThrow(/permission denied/);
  });
});

describe('C — the worker enqueue', () => {
  it('persists the ACTUAL template_version_id, not a NULL', async () => {
    const r = await worker.query<{ status: string; template_version_id: string }>(enqueueSql(), [
      TENANT_A,
      `wit-ok:${Date.now()}`,
      USER_A,
      VER_A,
      TENANT_A,
      witness[VER_A],
    ]);
    // The whole point of the witness: provenance survives into the row.
    expect(r.rows[0]?.template_version_id).toBe(VER_A);
    expect(r.rows[0]?.status).toBe('pending');
  });

  it('cannot fall back to a NULL template_version_id', async () => {
    // Closed deliberately: leaving the column NULL was the workaround this
    // mechanism exists to retire, so the worker policy refuses it outright.
    await expect(
      worker.query(
        `INSERT INTO shared.outbound_messages
           (tenant_id, channel, purpose, dedupe_key, body_sha256, recipient_user_id, created_by)
         VALUES ($1, 'in_app', 'transactional', $2, sha256('b'::bytea), $3, $3)`,
        [TENANT_A, `wit-null:${Date.now()}`, USER_A]
      )
    ).rejects.toThrow(/row-level security policy/);
  });

  it('cannot name a version without the witness that proves it', async () => {
    // Falls through to the guard, which reads the template table — and cannot.
    await expect(
      worker.query(
        `INSERT INTO shared.outbound_messages
           (tenant_id, channel, purpose, dedupe_key, body_sha256, recipient_user_id,
            created_by, template_version_id, template_owner_tenant_id)
         VALUES ($1, 'in_app', 'transactional', $2, sha256('b'::bytea), $3, $3, $4, $1)`,
        [TENANT_A, `wit-none:${Date.now()}`, USER_A, VER_A]
      )
    ).rejects.toThrow(/row-level security policy|permission denied/);
  });

  it('refuses a witness belonging to a DIFFERENT version', async () => {
    await expect(
      worker.query(enqueueSql(), [
        TENANT_A,
        `wit-mismatch:${Date.now()}`,
        USER_A,
        VER_A,
        TENANT_A,
        witness[VER_A_RETIRED],
      ])
    ).rejects.toThrow(/fk_outbound_messages_approval_witness|foreign key/);
  });

  it('refuses a nonexistent witness', async () => {
    await expect(
      worker.query(enqueueSql(), [
        TENANT_A,
        `wit-ghost:${Date.now()}`,
        USER_A,
        VER_A,
        TENANT_A,
        '99999999-9999-4999-8999-999999999999',
      ])
    ).rejects.toThrow(/fk_outbound_messages_approval_witness|foreign key/);
  });

  it('refuses another tenant’s version even with that tenant’s real witness', async () => {
    await expect(
      worker.query(enqueueSql(), [
        TENANT_A,
        `wit-cross:${Date.now()}`,
        USER_A,
        VER_B,
        TENANT_B,
        witness[VER_B],
      ])
    ).rejects.toThrow(/ck_outbound_messages_template_owner_scope|violates check constraint/);
  });

  it('still cannot read either template table, or control status, or delete', async () => {
    await expect(worker.query(`SELECT 1 FROM shared.template_versions LIMIT 1`)).rejects.toThrow(
      /permission denied/
    );
    await expect(worker.query(`SELECT 1 FROM shared.message_templates LIMIT 1`)).rejects.toThrow(
      /permission denied/
    );
    await expect(worker.query(`SELECT 1 FROM tech.technician_profiles LIMIT 1`)).rejects.toThrow(
      /permission denied for schema tech/
    );
    await expect(
      worker.query(
        `INSERT INTO shared.outbound_messages
           (tenant_id, channel, purpose, dedupe_key, body_sha256, recipient_user_id, created_by,
            template_version_id, template_owner_tenant_id, approval_witness_id, status)
         VALUES ($1,'in_app','transactional',$2,sha256('b'::bytea),$3,$3,$4,$5,$6,'sent')`,
        [TENANT_A, `wit-status:${Date.now()}`, USER_A, VER_A, TENANT_A, witness[VER_A]]
      )
    ).rejects.toThrow(/permission denied for table outbound_messages/);
    await expect(worker.query(`DELETE FROM shared.outbound_messages WHERE false`)).rejects.toThrow(
      /permission denied/
    );
  });

  it('introduces no SECURITY DEFINER function anywhere in the application schemas', async () => {
    const r = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosecdef
          AND n.nspname IN ('shared','iam','wo','tech','crm','org','inv','sal','quo','dia','qms','rec','apt')`
    );
    expect(r.rows[0]?.n).toBe('0');
  });
});

describe('D — the retirement race, which is what the snapshot rule is FOR', () => {
  it('enqueues from a version retired AFTER its witness was written', async () => {
    // 1. approved, 2. witnessed (both in beforeAll), 3. retired here, 4. consumed.
    await admin.query(`UPDATE shared.template_versions SET status = 'retired' WHERE id = $1`, [
      VER_A_RETIRED,
    ]);
    const state = await admin.query<{ status: string }>(
      `SELECT status FROM shared.template_versions WHERE id = $1`,
      [VER_A_RETIRED]
    );
    // The premise, computed rather than assumed: without a real retirement this
    // case would pass for the wrong reason.
    expect(state.rows[0]?.status).toBe('retired');

    const r = await worker.query<{ template_version_id: string; status: string }>(enqueueSql(), [
      TENANT_A,
      `wit-retired:${Date.now()}`,
      USER_A,
      VER_A_RETIRED,
      TENANT_A,
      witness[VER_A_RETIRED],
    ]);
    // An event emitted while the version was approved must still be deliverable.
    // Re-reading current status here would make asynchronous delivery depend on a
    // catalogue edit made after the event was published.
    expect(r.rows[0]?.template_version_id).toBe(VER_A_RETIRED);
    expect(r.rows[0]?.status).toBe('pending');
  });

  it('and the REQUEST path still refuses that same retired version', async () => {
    // The two paths are deliberately NOT symmetrical. The request path has live
    // template access and keeps its stronger current-state defence; only the
    // asynchronous path trades it for a snapshot it can actually verify.
    await expect(
      runtime.query(
        `INSERT INTO shared.outbound_messages
           (tenant_id, channel, purpose, dedupe_key, body_sha256, recipient_user_id,
            created_by, template_version_id)
         VALUES ($1, 'in_app', 'transactional', $2, sha256('b'::bytea), $3, $3, $4)`,
        [TENANT_A, `wit-req:${Date.now()}`, USER_A, VER_A_RETIRED]
      )
      // Either refusal is the request path holding its ground, and BOTH come from
      // the guard's live lookup rather than from the witness. `does not exist` is
      // the documented P1-15-R-001 mechanism: the guard's FOR SHARE is a LOCKING
      // read, which under RLS additionally needs an UPDATE policy, so a sender
      // without `org.settings.manage` sees no row rather than a retired one.
    ).rejects.toThrow(/is not approved|does not exist|row-level security policy/);
  });
});

describe('E — the constraints these proofs depend on actually exist', () => {
  /*
   * ANTI-VACUITY. Every refusal above is produced by a named constraint or policy.
   * If one were dropped, most of those cases would go green for the wrong reason —
   * an INSERT that no longer fails is indistinguishable from an INSERT that was
   * never attempted. So the mechanisms are asserted by name, and removing any one
   * of them turns this case red immediately rather than silently widening the
   * others.
   */
  it('names the witness foreign key, the scope check, and the worker policy', async () => {
    const cons = await admin.query<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conrelid = 'shared.outbound_messages'::regclass
          AND conname IN ('fk_outbound_messages_approval_witness',
                          'ck_outbound_messages_template_owner_scope')
        ORDER BY conname`
    );
    expect(cons.rows.map((r) => r.conname)).toEqual([
      'ck_outbound_messages_template_owner_scope',
      'fk_outbound_messages_approval_witness',
    ]);
    // The FK must be the THREE-column form. A two-column version would still
    // exist, still be named this, and still prove strictly less.
    expect(cons.rows[1]?.def).toContain(
      'approval_witness_id, template_version_id, template_owner_tenant_id'
    );

    const pol = await admin.query<{ qual: string | null; withcheck: string | null }>(
      `SELECT qual, with_check AS withcheck FROM pg_policies
        WHERE schemaname = 'shared' AND tablename = 'outbound_messages'
          AND policyname = 'wkr_outbound_messages_enqueue_scope'`
    );
    const check = pol.rows[0]?.withcheck ?? '';
    for (const required of [
      'template_version_id IS NOT NULL',
      'approval_witness_id IS NOT NULL',
      'template_owner_tenant_id IS NOT NULL',
    ]) {
      expect(check).toContain(required);
    }

    const wit = await admin.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'shared.template_version_approvals'::regclass
          AND conname IN ('uq_template_version_approvals_binding',
                          'fk_template_version_approvals_version')
        ORDER BY conname`
    );
    expect(wit.rows.map((r) => r.conname)).toEqual([
      'fk_template_version_approvals_version',
      'uq_template_version_approvals_binding',
    ]);
  });
});
