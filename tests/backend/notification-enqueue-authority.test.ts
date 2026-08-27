/**
 * `shared.enqueue_notification` — the worker's enqueue authority.
 *
 * Every case here runs as a RESTRICTED APPLICATION ROLE, never as the admin
 * connection. A security proof taken as `postgres` proves nothing about the role
 * the worker actually connects as, and this repository has recorded that lesson
 * before.
 *
 * ## What the function is for, in one sentence
 *
 * `app_worker` may not read `tech`, has no `app.tenant_id`, and must still be
 * unable to address a notification into a tenant that does not own the
 * recipient — so the one check no RLS policy can make for it is made here, by a
 * definer function that can see what the caller may not.
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
import { establishP1_19Fixtures, establishTechnicianFixtures } from './p1-19-helpers';

const SIGNATURE = 'uuid,uuid,uuid,uuid,text,text,uuid,bytea,text,text,uuid';
const FN = `shared.enqueue_notification(${SIGNATURE})`;

let admin: Pool;
let worker: Pool;
let runtime: Pool;

/** A live technician of TENANT_A, and the user account it resolves to. */
let technicianUserId = '';

async function enqueueAsWorker(
  tenantId: string,
  recipientUserId: string,
  dedupeKey: string
): Promise<string | null> {
  const result = await worker.query<{ id: string | null }>(
    `SELECT shared.enqueue_notification(
       $1::uuid, NULL, NULL, NULL, 'in_app', 'transactional',
       $2::uuid, sha256('body'::bytea), $3, NULL, $4::uuid
     ) AS id`,
    [tenantId, recipientUserId, dedupeKey, USER_A]
  );
  return result.rows[0]?.id ?? null;
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  // Cleaned BEFORE seeding, as every sibling suite does. The fixtures are not
  // idempotent — a second run without this fails on `pk_role_grants` — and the
  // Supabase container is shared across worktrees, so "it passed once" is not
  // the same as "it can run again".
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  // `establishP1_19Fixtures` is what assigns the module-level pool that
  // `establishTechnicianFixtures` connects with; calling the second alone fails
  // with `Cannot read properties of undefined (reading 'connect')`.
  await establishP1_19Fixtures(admin);
  await establishTechnicianFixtures();
  worker = workerAppPool(2);
  runtime = runtimeAppPool(2);

  const found = await admin.query<{ user_id: string }>(
    `SELECT user_id FROM tech.technician_profiles
      WHERE tenant_id = $1 AND deleted_at IS NULL
      ORDER BY created_at ASC LIMIT 1`,
    [TENANT_A]
  );
  technicianUserId = found.rows[0]?.user_id ?? '';
  expect(technicianUserId, 'the fixtures must establish a live technician').not.toBe('');
}, 180_000);

afterAll(async () => {
  await Promise.all([worker?.end(), runtime?.end(), admin?.end()]);
});

describe('the allowed caller can enqueue, and only through this path', () => {
  it('the worker enqueues for a live technician of the named tenant', async () => {
    const id = await enqueueAsWorker(TENANT_A, technicianUserId, `ok:${Date.now()}`);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const row = await admin.query<{ status: string; tenant_id: string; recipient_user_id: string }>(
      `SELECT status, tenant_id, recipient_user_id FROM shared.outbound_messages WHERE id = $1`,
      [id]
    );
    // `status` is not a parameter of the function, so 'pending' is the only
    // status any caller of it can produce.
    expect(row.rows[0]?.status).toBe('pending');
    expect(row.rows[0]?.tenant_id).toBe(TENANT_A);
    expect(row.rows[0]?.recipient_user_id).toBe(technicianUserId);
  });

  it('a replayed dedupe key returns the SAME message rather than a second one', async () => {
    const key = `replay:${Date.now()}`;
    const first = await enqueueAsWorker(TENANT_A, technicianUserId, key);
    const second = await enqueueAsWorker(TENANT_A, technicianUserId, key);
    expect(second).toBe(first);

    const count = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM shared.outbound_messages
        WHERE tenant_id = $1 AND dedupe_key = $2`,
      [TENANT_A, key]
    );
    // Idempotency stays where the platform already put it — the existing
    // (tenant_id, dedupe_key) conflict — rather than in a second mechanism.
    expect(count.rows[0]?.n).toBe('1');
  });
});

describe('the enqueue cannot be aimed at another tenant', () => {
  it('refuses a recipient who is not a technician of the named tenant', async () => {
    await expect(
      enqueueAsWorker(TENANT_B, technicianUserId, `crosstenant:${Date.now()}`)
    ).rejects.toThrow(/is not a live technician of tenant/);
  });

  it('refuses a recipient who is no technician at all', async () => {
    await expect(enqueueAsWorker(TENANT_A, USER_A, `nontech:${Date.now()}`)).rejects.toThrow(
      /is not a live technician of tenant/
    );
  });

  it('refuses a null tenant, recipient or author', async () => {
    await expect(
      worker.query(
        `SELECT shared.enqueue_notification(NULL::uuid, NULL, NULL, NULL, 'in_app',
           'transactional', $1::uuid, sha256('b'::bytea), 'k', NULL, $2::uuid)`,
        [technicianUserId, USER_A]
      )
    ).rejects.toThrow(/requires tenant, recipient and author/);
  });
});

describe('no role gains anything but EXECUTE, and only the worker gains that', () => {
  it.each([
    ['public', false],
    ['app_runtime', false],
    ['app_readonly', false],
    ['app_worker', true],
  ])('EXECUTE for %s is %s', async (role, allowed) => {
    const r = await admin.query<{ ok: boolean }>(
      `SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`,
      [role, FN]
    );
    expect(r.rows[0]?.ok).toBe(allowed);
  });

  it('the worker still cannot INSERT the table directly', async () => {
    await expect(
      worker.query(
        `INSERT INTO shared.outbound_messages
           (tenant_id, channel, purpose, dedupe_key, body_sha256, recipient_user_id, created_by)
         VALUES ($1, 'in_app', 'transactional', $2, sha256('b'::bytea), $3, $4)`,
        [TENANT_A, `direct:${Date.now()}`, technicianUserId, USER_A]
      )
    ).rejects.toThrow(/permission denied for table outbound_messages/);
  });

  it('the worker still cannot DELETE the table', async () => {
    await expect(worker.query(`DELETE FROM shared.outbound_messages WHERE false`)).rejects.toThrow(
      /permission denied/
    );
  });

  it('the worker still cannot read `tech` — the schema the function reads FOR it', async () => {
    await expect(worker.query(`SELECT 1 FROM tech.technician_profiles LIMIT 1`)).rejects.toThrow(
      /permission denied for schema tech/
    );
  });

  it('the request path is untouched: app_runtime keeps its own INSERT and policy', async () => {
    // Not `permission denied` — the runtime's grant is intact and RLS is what
    // answers. Proving this here is what stops a future "simplification" from
    // routing the request path through the definer function and silently
    // discarding `ins_outbound_messages_enqueue`.
    await expect(
      runtime.query(
        `INSERT INTO shared.outbound_messages
           (tenant_id, channel, purpose, dedupe_key, body_sha256, recipient_user_id, created_by)
         VALUES ($1, 'in_app', 'transactional', $2, sha256('b'::bytea), $3, $4)`,
        [TENANT_A, `runtime:${Date.now()}`, technicianUserId, USER_A]
      )
    ).rejects.toThrow(/row-level security policy/);
  });
});

describe('the definer function cannot be redirected', () => {
  it('pins a search_path that excludes `public`', async () => {
    const r = await admin.query<{ cfg: string[] }>(
      `SELECT proconfig AS cfg FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'shared' AND p.proname = 'enqueue_notification'`
    );
    const cfg = (r.rows[0]?.cfg ?? []).join(',');
    expect(cfg).toContain('search_path=');
    // `public` is where an attacker plants a shadowing object; `pg_catalog`
    // first is what stops a planted `sha256` or `EXISTS` target resolving.
    expect(cfg).not.toMatch(/(^|[=, ])public([, ]|$)/);
    expect(cfg).toMatch(/search_path=pg_catalog/);
  });

  it('carries no dynamic SQL for a caller to steer', async () => {
    const r = await admin.query<{ src: string }>(
      `SELECT prosrc AS src FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'shared' AND p.proname = 'enqueue_notification'`
    );

    // Comments are stripped FIRST, and the reason is that this assertion failed
    // on its first run against a body whose comment reads "No dynamic SQL, no
    // `EXECUTE`". Prose describing a rule contains the rule, so a check that
    // searches raw source cannot tell the two apart — the same defect this
    // slice's sibling gate (`check-p1-29-access.mjs`) was corrected for, here
    // reproduced by a test written to prevent it.
    const code = (r.rows[0]?.src ?? '').replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

    expect(code).not.toMatch(/\bEXECUTE\b/i);
    expect(code).not.toMatch(/\bformat\s*\(/i);
    expect(code).not.toMatch(/\bquote_ident\b/i);
    // Non-vacuity: the stripped body must still be the function, not nothing.
    expect(code).toMatch(/INSERT INTO shared\.outbound_messages/);
  });
});
