/**
 * The worker's enqueue authority on `shared.outbound_messages`.
 *
 * Every case runs as a RESTRICTED APPLICATION ROLE, never as the admin
 * connection. A security proof taken as `postgres` proves nothing about the role
 * the worker actually connects as.
 *
 * ## Why this is a grant and a RESTRICTIVE policy, not a function
 *
 * A `SECURITY DEFINER` function was written first and this repository refuses
 * it — `migration-replay-checks.mjs` fails on a non-zero count and
 * `rls-matrix.mjs` fails each one with "runs with the owner's rights and
 * bypasses RLS". The prohibition is right: bypassing RLS is the one thing this
 * schema's model may never do.
 *
 * The check that function was going to make — does the claimed tenant OWN the
 * claimed recipient — is answered EARLIER instead, by the publisher, which runs
 * as `app_runtime` inside the tenant's own context and resolves the recipient
 * from `tech.technician_profiles` at publish time. The worker forwards a
 * verified fact rather than asserting an unverified one, so the database layer
 * only has to pin what a worker may WRITE.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import {
  TENANT_A,
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

const COLUMNS =
  '(tenant_id, channel, purpose, dedupe_key, body_sha256, recipient_user_id, created_by)';
const VALUES = `($1, 'in_app', 'transactional', $2, sha256('body'::bytea), $3, $4)`;

function args(dedupeKey: string): unknown[] {
  return [TENANT_A, dedupeKey, USER_A, USER_A];
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  // Cleaned BEFORE seeding, as every sibling suite does: the fixtures are not
  // idempotent, and the Supabase container is shared across worktrees, so "it
  // passed once" is not the same as "it can run again".
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  worker = workerAppPool(2);
  runtime = runtimeAppPool(2);
}, 120_000);

afterAll(async () => {
  // Cleaned AFTER, not only before. `no-fake-data` asserts every business table
  // is empty once fixtures are torn down, and it runs in a later tier against
  // the same shared database — so a suite that seeds and does not clean up fails
  // a file it never mentions.
  if (admin) await cleanBackendFixtures(admin);
  await Promise.all([worker?.end(), runtime?.end(), admin?.end()]);
});

describe('the worker may enqueue, and only a pending message', () => {
  it('enqueues a pending message', async () => {
    const key = `ok:${Date.now()}`;
    const inserted = await worker.query<{ id: string }>(
      `INSERT INTO shared.outbound_messages ${COLUMNS} VALUES ${VALUES} RETURNING id`,
      args(key)
    );
    const id = inserted.rows[0]?.id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const row = await admin.query<{ status: string; tenant_id: string }>(
      `SELECT status, tenant_id FROM shared.outbound_messages WHERE id = $1`,
      [id]
    );
    // `status` is outside the column grant, so the default is the only status a
    // worker can produce — and the RESTRICTIVE policy pins it a second time.
    expect(row.rows[0]?.status).toBe('pending');
    expect(row.rows[0]?.tenant_id).toBe(TENANT_A);
  });

  it('cannot set a status of its own choosing', async () => {
    await expect(
      worker.query(
        `INSERT INTO shared.outbound_messages
           (tenant_id, channel, purpose, dedupe_key, body_sha256, recipient_user_id,
            created_by, status)
         VALUES ($1, 'in_app', 'transactional', $2, sha256('b'::bytea), $3, $4, 'sent')`,
        args(`status:${Date.now()}`)
      )
    ).rejects.toThrow(/permission denied for table outbound_messages/);
  });

  it('cannot name a template_version_id, because the BEFORE INSERT guard reads a table it may not', async () => {
    /*
     * THE CONSTRAINT THAT SHAPES THE WHOLE WORKER ENQUEUE PATH, pinned here so it
     * is never rediscovered.
     *
     * `shared.outbound_messages` carries `tg_outbound_messages_guard_scope` ->
     * `shared.guard_outbound_message_scope()`, which is SECURITY INVOKER. When
     * `NEW.template_version_id IS NOT NULL` it runs
     * `SELECT tenant_id, status FROM shared.template_versions ... FOR SHARE`, and
     * `app_worker` holds no privilege on that table at all.
     *
     * So the grant and the RESTRICTIVE policy are not sufficient by themselves:
     * a worker-enqueued row must leave `template_version_id` NULL. The earlier
     * version of this suite missed it because its column list simply never named
     * the column, which is exactly the kind of blind spot a passing test can hide.
     *
     * Granting the worker a SELECT here — even column-level — is what the
     * payload-carries-the-facts decision forbids, and a SECURITY DEFINER guard is
     * prohibited outright, so the refusal below is the design and not a defect.
     */
    await expect(
      worker.query(
        `INSERT INTO shared.outbound_messages
           (tenant_id, channel, purpose, dedupe_key, body_sha256, recipient_user_id,
            created_by, template_version_id)
         VALUES ($1, 'in_app', 'transactional', $2, sha256('b'::bytea), $3, $4,
                 '00000000-0000-4000-8000-00000000ffff')`,
        args(`tvid:${Date.now()}`)
      )
    ).rejects.toThrow(/permission denied for table template_versions/);
  });

  it('honours the existing (tenant_id, dedupe_key) conflict rather than a new mechanism', async () => {
    const key = `dedupe:${Date.now()}`;
    await worker.query(
      `INSERT INTO shared.outbound_messages ${COLUMNS} VALUES ${VALUES}
       ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
      args(key)
    );
    await worker.query(
      `INSERT INTO shared.outbound_messages ${COLUMNS} VALUES ${VALUES}
       ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
      args(key)
    );
    const count = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM shared.outbound_messages
        WHERE tenant_id = $1 AND dedupe_key = $2`,
      [TENANT_A, key]
    );
    // Idempotency stays where the platform already put it.
    expect(count.rows[0]?.n).toBe('1');
  });
});

describe('the worker gains nothing else', () => {
  it('still cannot UPDATE a column outside its dispatch grant', async () => {
    await expect(
      worker.query(`UPDATE shared.outbound_messages SET purpose = 'system' WHERE false`)
    ).rejects.toThrow(/permission denied/);
  });

  it('still cannot DELETE', async () => {
    await expect(worker.query(`DELETE FROM shared.outbound_messages WHERE false`)).rejects.toThrow(
      /permission denied/
    );
  });

  it('still cannot read `tech` — the schema the publisher resolves the recipient from', async () => {
    await expect(worker.query(`SELECT 1 FROM tech.technician_profiles LIMIT 1`)).rejects.toThrow(
      /permission denied for schema tech/
    );
  });

  it('still cannot read the template tables', async () => {
    await expect(worker.query(`SELECT 1 FROM shared.message_templates LIMIT 1`)).rejects.toThrow(
      /permission denied/
    );
    await expect(worker.query(`SELECT 1 FROM shared.template_versions LIMIT 1`)).rejects.toThrow(
      /permission denied/
    );
  });
});

describe('the request path is untouched', () => {
  it('app_runtime still meets RLS, not a permission error', async () => {
    // The distinction is the whole point. `permission denied` would mean this
    // migration had disturbed the runtime's grant; an RLS refusal means the
    // grant is intact and `ins_outbound_messages_enqueue` is still what decides.
    await expect(
      runtime.query(
        `INSERT INTO shared.outbound_messages ${COLUMNS} VALUES ${VALUES}`,
        args(`runtime:${Date.now()}`)
      )
    ).rejects.toThrow(/row-level security policy/);
  });
});

describe('the platform prohibition this design exists to respect', () => {
  it('introduces no SECURITY DEFINER function anywhere in the application schemas', async () => {
    // `migration-replay-checks.mjs` fails on any non-zero count and
    // `rls-matrix.mjs` fails each one by name. Asserted here too so a future
    // change cannot reintroduce one and discover the prohibition in CI.
    const r = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosecdef
          AND n.nspname IN ('shared','iam','wo','tech','crm','org','inv','sal','quo','dia','qms','rec','apt')`
    );
    expect(r.rows[0]?.n).toBe('0');
  });

  it('narrows the worker by a RESTRICTIVE policy, leaving the dispatch policy intact', async () => {
    const r = await admin.query<{ policyname: string; permissive: string; cmd: string }>(
      `SELECT policyname, permissive, cmd FROM pg_policies
        WHERE schemaname = 'shared' AND tablename = 'outbound_messages'
        ORDER BY policyname`
    );
    const byName = new Map(r.rows.map((p) => [p.policyname, p]));

    const scope = byName.get('wkr_outbound_messages_enqueue_scope');
    expect(scope?.permissive).toBe('RESTRICTIVE');
    expect(scope?.cmd).toBe('INSERT');

    // Untouched: the worker's SELECT depends on this one, so narrowing it would
    // have broken dispatch reads.
    const dispatch = byName.get('wkr_outbound_messages_dispatch');
    expect(dispatch?.permissive).toBe('PERMISSIVE');
    expect(dispatch?.cmd).toBe('ALL');
  });
});
