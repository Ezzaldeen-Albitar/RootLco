/**
 * P1-15 notifications — the enqueue/dispatch split, proved at SQL level.
 *
 * Three source files make claims this suite is responsible for making falsifiable:
 *
 *  - `data/notification-repository.ts` says the request runtime may only SELECT
 *    and INSERT `shared.outbound_messages`, that the insert is gated on
 *    `shared.notification.send`, and that it "cannot claim it was sent, cannot
 *    forge a delivery attempt, and cannot mark it delivered";
 *  - `data/message-dispatch-repository.ts` says `app_worker` owns exactly the
 *    lifecycle edges in `DISPATCH_TRANSITIONS`, that timestamps and `retry_count`
 *    are assigned by `shared.guard_outbound_message_lifecycle()` and never
 *    written from the repository, and — the load-bearing one — that `app_worker`
 *    holds **nothing at all** on `shared.template_versions`, which is why
 *    rendered content is handed to the dispatcher instead of re-rendered;
 *  - `domain/notification-policy.ts` says its template checks exist only to
 *    produce a stable refusal, and that the *guarantee* is the database's
 *    (`guard_outbound_message_scope`).
 *
 * Every one of those statements is a statement about SQL, so every one of them is
 * tested here as SQL, on a real non-owner login.
 *
 * The regression test named P1-15-R-001 is the reason
 * `lck_template_versions_reference` exists. `guard_outbound_message_scope` takes a
 * `FOR SHARE` lock on the referenced template version, and under RLS a *locking*
 * read must additionally satisfy an UPDATE policy. The acting principal in that
 * test holds `shared.notification.send` and nothing else — no
 * `org.settings.manage` — so `upd_template_versions_tenant` admits no row for it,
 * and a platform version (`tenant_id IS NULL`) is outside that policy for anyone.
 * If the lock-only policy regressed, the guard would report "template version does
 * not exist" and platform templates would be unusable. The test is therefore
 * sensitive to exactly the defect it is named after.
 *
 * Connection discipline. Every capability, denial and isolation claim runs on
 * `rootlco_test_runtime`, `rootlco_test_worker` or `rootlco_test_readonly`. The
 * `postgres` admin connection carries BYPASSRLS; it provisions fixtures and reads
 * the catalog, and **nothing it does is evidence about runtime behaviour**. Where
 * a test deliberately runs a statement as admin — to reach a guard branch no
 * application role has the column privileges to reach — the test name says
 * "(admin probe)" and a comment says why.
 *
 * Denial shapes. A missing column/table privilege or a failed INSERT policy is
 * 42501; a guard raising `check_violation` is 23514; a missing referenced row
 * inside a guard is 23503; a duplicate key is 23505. A second failing probe in the
 * same transaction can only report 25P02, so each denial gets its own transaction.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client, Pool } from 'pg';
import { DISPATCH_TRANSITIONS } from '@/modules/shared-services/data/message-dispatch-repository';
import {
  adminPool,
  cleanFixtures,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  readonlyPool,
  runtimePool,
  TENANT_A,
  TENANT_B,
  withRolledBackTx,
  workerPool,
} from './helpers';

const SYS = '00000000-0000-4000-8000-000000000001';

/** Fixture principals and rows, distinct from every other suite's set. */
const SENDER_A = 'a0000000-0000-4000-8000-0000000e1501';
const NO_SEND_A = 'a0000000-0000-4000-8000-0000000e1502';
const SENDER_B = 'b0000000-0000-4000-8000-0000000e1501';
const ROLE_SEND_A = 'a0000000-0000-4000-8000-0000000e15c1';
const ROLE_NONE_A = 'a0000000-0000-4000-8000-0000000e15c2';
const ROLE_SEND_B = 'b0000000-0000-4000-8000-0000000e15c1';

const TEMPLATE_PLATFORM = '00000000-0000-4000-8000-0000000e15f1';
const TPLVER_PLATFORM_APPROVED = '00000000-0000-4000-8000-0000000e15f2';
const TPLVER_PLATFORM_DRAFT = '00000000-0000-4000-8000-0000000e15f3';
const TEMPLATE_A = 'a0000000-0000-4000-8000-0000000e15f4';
const TPLVER_A_APPROVED = 'a0000000-0000-4000-8000-0000000e15f5';
const TPLVER_A_DRAFT = 'a0000000-0000-4000-8000-0000000e15f6';
const TEMPLATE_B = 'b0000000-0000-4000-8000-0000000e15f4';
const TPLVER_B_APPROVED = 'b0000000-0000-4000-8000-0000000e15f5';

/** Committed messages the worker (which cannot INSERT one) acts upon. */
const MSG_LIFECYCLE = 'a0000000-0000-4000-8000-0000000e15a1';
const MSG_RETRY = 'a0000000-0000-4000-8000-0000000e15a2';
const MSG_ATTEMPTS = 'a0000000-0000-4000-8000-0000000e15a3';
const MSG_GUARD = 'a0000000-0000-4000-8000-0000000e15a4';
const MSG_DEDUPE = 'a0000000-0000-4000-8000-0000000e15a5';
const DEDUPE_TAKEN = 'fx-p15-ntf-dedupe';

/** The single permission `ins_outbound_messages_enqueue` gates on. */
const SEND_PERMISSION = 'shared.notification.send';

const AS_SENDER_A = { tenantId: TENANT_A, userId: SENDER_A };
const AS_NO_SEND_A = { tenantId: TENANT_A, userId: NO_SEND_A };
const AS_SENDER_B = { tenantId: TENANT_B, userId: SENDER_B };
const NO_CONTEXT = {};

const DIGEST = `decode(repeat('e5', 32), 'hex')`;
const BODY = `decode(repeat('b0', 32), 'hex')`;

let admin: Pool;
let runtime: Pool;
let readonly: Pool;
let worker: Pool;

type Q = { query: Client['query'] };

/**
 * Runs a statement on the ADMIN connection and reports how it failed.
 *
 * Used only for guard branches that no application role can reach, because the
 * columns involved are absent from every application GRANT. A returned code of
 * `(none)` means the statement succeeded, which every caller asserts against.
 */
async function adminProbe(sql: string, params: unknown[]): Promise<{ code: string; msg: string }> {
  try {
    await admin.query(sql, params);
  } catch (err) {
    return { code: (err as { code?: string }).code ?? '', msg: (err as Error).message };
  }
  return { code: '(none)', msg: '(the statement succeeded)' };
}

/** Inserts a committed pending message as ADMIN. A precondition, never evidence. */
async function seedMessage(id: string, dedupeKey: string): Promise<void> {
  await admin.query(
    `INSERT INTO shared.outbound_messages
       (id, tenant_id, template_version_id, channel, purpose, recipient_digest,
        body_sha256, dedupe_key, created_by)
     VALUES ($1, $2, $3, 'email', 'transactional', ${DIGEST}, ${BODY}, $4, $5)`,
    [id, TENANT_A, TPLVER_PLATFORM_APPROVED, dedupeKey, SYS]
  );
}

/**
 * Rebuilds the notification fixtures on the ADMIN connection.
 *
 * Template versions are created as drafts and then transitioned, because
 * `guard_template_version_lifecycle` refuses a version born approved — the
 * fixture obeys the same rule every legitimate writer does.
 */
async function seedNotificationFixtures(): Promise<void> {
  await admin.query(
    `UPDATE shared.message_templates SET active_version_id = NULL
      WHERE tenant_id = ANY($1::uuid[]) OR id = $2`,
    [[TENANT_A, TENANT_B], TEMPLATE_PLATFORM]
  );
  for (const table of [
    'shared.delivery_attempts',
    'shared.outbound_messages',
    'shared.template_versions',
    'shared.message_templates',
    'iam.role_grants',
    'iam.role_permissions',
    'iam.user_accounts',
    'iam.roles',
  ]) {
    await admin.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [
      [TENANT_A, TENANT_B],
    ]);
  }
  // Platform rows carry tenant_id NULL, so the tenant sweep above misses them.
  await admin.query(`DELETE FROM shared.template_versions WHERE id = ANY($1::uuid[])`, [
    [TPLVER_PLATFORM_APPROVED, TPLVER_PLATFORM_DRAFT],
  ]);
  await admin.query(`DELETE FROM shared.message_templates WHERE id = $1`, [TEMPLATE_PLATFORM]);

  for (const [id, tenant, code, name] of [
    [ROLE_SEND_A, TENANT_A, 'fx_p15_ntf_send', 'Fixture Notification Sender Role A'],
    [ROLE_NONE_A, TENANT_A, 'fx_p15_ntf_none', 'Fixture No-Permission Role A'],
    [ROLE_SEND_B, TENANT_B, 'fx_p15_ntf_send', 'Fixture Notification Sender Role B'],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.roles (id, tenant_id, role_code, name, is_system, created_by)
       VALUES ($1, $2, $3, $4, false, $5)`,
      [id, tenant, code, name, SYS]
    );
  }

  for (const [id, tenant, subject, email, name] of [
    [SENDER_A, TENANT_A, 'fx-p15-ntf-a', 'fx-p15-ntf-a@example.test', 'Fixture Sender A'],
    [NO_SEND_A, TENANT_A, 'fx-p15-ntf-none', 'fx-p15-ntf-none@example.test', 'Fixture No Send A'],
    [SENDER_B, TENANT_B, 'fx-p15-ntf-b', 'fx-p15-ntf-b@example.test', 'Fixture Sender B'],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.user_accounts
         (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1, $2, 'supabase', $3, $4, $5, 'active', $6)`,
      [id, tenant, subject, email, name, SYS]
    );
  }

  // The sender roles map `shared.notification.send` and DELIBERATELY NOTHING
  // ELSE — in particular not `org.settings.manage`. That absence is what makes
  // the P1-15-R-001 regression test below sensitive: without the lock-only
  // policy, a principal like this cannot take the FOR SHARE lock the enqueue
  // guard needs, on a platform template or on its own tenant's.
  for (const [role, tenant] of [
    [ROLE_SEND_A, TENANT_A],
    [ROLE_SEND_B, TENANT_B],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1, $2, id, 'allow', $3 FROM iam.permissions WHERE permission_code = $4`,
      [tenant, role, SYS, SEND_PERMISSION]
    );
  }

  for (const [tenant, user, role] of [
    [TENANT_A, SENDER_A, ROLE_SEND_A],
    [TENANT_A, NO_SEND_A, ROLE_NONE_A],
    [TENANT_B, SENDER_B, ROLE_SEND_B],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.role_grants
         (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
       VALUES ($1, $2, $3, 'unrestricted', 'active', $4, $4)`,
      [tenant, user, role, SYS]
    );
  }

  for (const [id, scope, tenant, code] of [
    [TEMPLATE_PLATFORM, 'platform', null, 'fx_p15_ntf_platform'],
    [TEMPLATE_A, 'tenant', TENANT_A, 'fx_p15_ntf_tenant'],
    [TEMPLATE_B, 'tenant', TENANT_B, 'fx_p15_ntf_tenant'],
  ] as const) {
    await admin.query(
      `INSERT INTO shared.message_templates
         (id, scope, tenant_id, template_code, name, channel, purpose, locale_code, status, created_by)
       VALUES ($1, $2, $3, $4, 'Fixture Notification Template', 'email', 'transactional',
               'en', 'active', $5)`,
      [id, scope, tenant, code, SYS]
    );
  }

  for (const [id, tenant, template, number, body] of [
    [TPLVER_PLATFORM_APPROVED, null, TEMPLATE_PLATFORM, 1, 'Platform approved body'],
    [TPLVER_PLATFORM_DRAFT, null, TEMPLATE_PLATFORM, 2, 'Platform draft body'],
    [TPLVER_A_APPROVED, TENANT_A, TEMPLATE_A, 1, 'Tenant A approved body'],
    [TPLVER_A_DRAFT, TENANT_A, TEMPLATE_A, 2, 'Tenant A draft body'],
    [TPLVER_B_APPROVED, TENANT_B, TEMPLATE_B, 1, 'Tenant B approved body'],
  ] as const) {
    await admin.query(
      `INSERT INTO shared.template_versions
         (id, tenant_id, template_id, version_number, subject, body, content_hash, created_by)
       VALUES ($1, $2, $3, $4, 'Fixture subject', $5, decode(repeat('cc', 32), 'hex'), $6)`,
      [id, tenant, template, number, body, SYS]
    );
  }

  // approved_by is tenant-bound by a composite FK, so each tenant version is
  // approved by one of its own users; a platform version's NULL tenant makes the
  // composite FK inapplicable.
  for (const [id, approver] of [
    [TPLVER_PLATFORM_APPROVED, SYS],
    [TPLVER_A_APPROVED, SENDER_A],
    [TPLVER_B_APPROVED, SENDER_B],
  ] as const) {
    await admin.query(
      `UPDATE shared.template_versions SET status = 'approved', approved_by = $2 WHERE id = $1`,
      [id, approver]
    );
  }

  for (const [id, key] of [
    [MSG_LIFECYCLE, 'fx-p15-ntf-lifecycle'],
    [MSG_RETRY, 'fx-p15-ntf-retry'],
    [MSG_ATTEMPTS, 'fx-p15-ntf-attempts'],
    [MSG_GUARD, 'fx-p15-ntf-guard'],
    [MSG_DEDUPE, DEDUPE_TAKEN],
  ] as const) {
    await seedMessage(id, key);
  }
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();
  readonly = readonlyPool();
  worker = workerPool();
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.query(`DELETE FROM shared.template_versions WHERE id = ANY($1::uuid[])`, [
    [TPLVER_PLATFORM_APPROVED, TPLVER_PLATFORM_DRAFT],
  ]);
  await admin.query(`DELETE FROM shared.message_templates WHERE id = $1`, [TEMPLATE_PLATFORM]);
  await Promise.all([runtime.end(), readonly.end(), worker.end()]);
  await admin.end();
});

beforeEach(async () => {
  await seedNotificationFixtures();
});

/** The enqueue statement every test in the first sections varies one fact of. */
const ENQUEUE = `
  INSERT INTO shared.outbound_messages
    (tenant_id, template_version_id, channel, purpose, recipient_digest,
     body_sha256, dedupe_key, created_by)
  VALUES ($1, $2, 'email', 'transactional', ${DIGEST}, ${BODY}, $3, $4)`;

// ---------------------------------------------------------------------------

describe('P1-15 notifications / enqueue requires shared.notification.send in scope', () => {
  it('a principal holding the permission enqueues a message', async () => {
    const inserted = await withRolledBackTx(runtime, AS_SENDER_A, async (c: Q) => {
      const r = await c.query(ENQUEUE, [
        TENANT_A,
        TPLVER_PLATFORM_APPROVED,
        'fx-p15-ntf-allowed',
        SENDER_A,
      ]);
      return r.rowCount;
    });
    expect(inserted).toBe(1);
  });

  it('the same statement from a principal without the permission is refused', async () => {
    // The only difference from the test above is the absent iam.role_permissions
    // row, so the denial is attributable to the permission and to nothing else.
    await withRolledBackTx(runtime, AS_NO_SEND_A, async (c: Q) => {
      await expectSqlState(
        c.query(ENQUEUE, [TENANT_A, TPLVER_PLATFORM_APPROVED, 'fx-p15-ntf-denied', NO_SEND_A]),
        '42501'
      );
    });
  });

  it('with no session context there is no tenant to compare against and the insert is refused', async () => {
    await withRolledBackTx(runtime, NO_CONTEXT, async (c: Q) => {
      // The platform template version is visible and lockable without a tenant, so
      // the scope guard passes and the enqueue policy is the only thing that can
      // refuse: iam.current_tenant_id() is NULL and matches nothing.
      await expectSqlState(
        c.query(ENQUEUE, [TENANT_A, TPLVER_PLATFORM_APPROVED, 'fx-p15-ntf-nocontext', SENDER_A]),
        '42501'
      );
    });
  });

  it('authorship cannot be forged — created_by must be the acting user', async () => {
    await withRolledBackTx(runtime, AS_SENDER_A, async (c: Q) => {
      await expectSqlState(
        c.query(ENQUEUE, [TENANT_A, TPLVER_PLATFORM_APPROVED, 'fx-p15-ntf-forged', NO_SEND_A]),
        '42501'
      );
    });
  });

  it('a tenant-B sender cannot enqueue into tenant A', async () => {
    await withRolledBackTx(runtime, AS_SENDER_B, async (c: Q) => {
      await expectSqlState(
        c.query(ENQUEUE, [TENANT_A, TPLVER_PLATFORM_APPROVED, 'fx-p15-ntf-cross', SENDER_B]),
        '42501'
      );
    });
  });

  it('the read-only role cannot enqueue even as the permitted principal', async () => {
    await withRolledBackTx(readonly, AS_SENDER_A, async (c: Q) => {
      await expectSqlState(
        c.query(ENQUEUE, [TENANT_A, TPLVER_PLATFORM_APPROVED, 'fx-p15-ntf-readonly', SENDER_A]),
        '42501'
      );
    });
  });
});

// ---------------------------------------------------------------------------

describe('P1-15 notifications / a message is always born pending, unstamped, retry_count 0', () => {
  it('the enqueued row carries pending, retry_count 0, and no lifecycle stamp at all', async () => {
    const row = await withRolledBackTx(runtime, AS_SENDER_A, async (c: Q) => {
      const r = await c.query<{
        status: string;
        retry_count: number;
        failure_class: string | null;
        queued_at: Date | null;
        sending_at: Date | null;
        sent_at: Date | null;
        delivered_at: Date | null;
        failed_at: Date | null;
        cancelled_at: Date | null;
      }>(
        `${ENQUEUE}
         RETURNING status, retry_count, failure_class, queued_at, sending_at, sent_at,
                   delivered_at, failed_at, cancelled_at`,
        [TENANT_A, TPLVER_PLATFORM_APPROVED, 'fx-p15-ntf-born', SENDER_A]
      );
      return r.rows[0];
    });
    expect(row?.status).toBe('pending');
    expect(row?.retry_count).toBe(0);
    expect(row?.failure_class).toBeNull();
    expect(row?.queued_at).toBeNull();
    expect(row?.sending_at).toBeNull();
    expect(row?.sent_at).toBeNull();
    expect(row?.delivered_at).toBeNull();
    expect(row?.failed_at).toBeNull();
    expect(row?.cancelled_at).toBeNull();
  });

  // The strongest form of "born pending": these columns are absent from the
  // INSERT column grant, so no initial lifecycle state is even expressible
  // through the request path. The guard below is the second, writer-independent
  // layer. Each probe gets its own transaction so it reports its own SQLSTATE.
  const UNGRANTED_ON_INSERT: ReadonlyArray<readonly [string, string]> = [
    ['status', `'queued'`],
    ['retry_count', '7'],
    ['queued_at', 'now()'],
    ['sent_at', 'now()'],
    ['delivered_at', 'now()'],
    ['failure_class', `'fx_forged'`],
  ];

  for (const [column, value] of UNGRANTED_ON_INSERT) {
    it(`the request role cannot name ${column} on an enqueue at all`, async () => {
      await withRolledBackTx(runtime, AS_SENDER_A, async (c: Q) => {
        await expectSqlState(
          c.query(
            `INSERT INTO shared.outbound_messages
               (tenant_id, template_version_id, channel, purpose, recipient_digest,
                body_sha256, dedupe_key, ${column}, created_by)
             VALUES ($1, $2, 'email', 'transactional', ${DIGEST}, ${BODY}, $3, ${value}, $4)`,
            [TENANT_A, TPLVER_PLATFORM_APPROVED, `fx-p15-ntf-col-${column}`, SENDER_A]
          ),
          '42501'
        );
      });
    });
  }

  it('guard_outbound_message_lifecycle refuses a pre-stamped message from ANY writer (admin probe)', async () => {
    // ADMIN statement on purpose. It is NOT evidence about app_runtime — the six
    // tests above are. It exists because the guard must also hold for a writer
    // that has every column privilege, and only the BYPASSRLS connection can
    // reach that code path.
    const probe = await adminProbe(
      `INSERT INTO shared.outbound_messages
         (tenant_id, template_version_id, channel, purpose, recipient_digest, body_sha256,
          dedupe_key, status, queued_at, retry_count, created_by)
       VALUES ($1, $2, 'email', 'transactional', ${DIGEST}, ${BODY}, $3, 'sent', now(), 3, $4)`,
      [TENANT_A, TPLVER_PLATFORM_APPROVED, 'fx-p15-ntf-admin-born', SYS]
    );
    expect(probe.code).toBe('23514');
    expect(probe.msg).toContain('must start as unstamped pending with retry_count zero');
  });
});

// ---------------------------------------------------------------------------

describe('P1-15 notifications / uq_outbound_messages_dedupe is scoped to (tenant, dedupe_key)', () => {
  it('a second INSERT with the same tenant and dedupe key raises 23505', async () => {
    // MSG_DEDUPE already holds this key in tenant A, committed by the fixture.
    await withRolledBackTx(runtime, AS_SENDER_A, async (c: Q) => {
      await expectSqlState(
        c.query(ENQUEUE, [TENANT_A, TPLVER_PLATFORM_APPROVED, DEDUPE_TAKEN, SENDER_A]),
        '23505'
      );
    });
  });

  it('two enqueues of the same key inside one transaction collide the same way', async () => {
    await withRolledBackTx(runtime, AS_SENDER_A, async (c: Q) => {
      const first = await c.query(ENQUEUE, [
        TENANT_A,
        TPLVER_PLATFORM_APPROVED,
        'fx-p15-ntf-twice',
        SENDER_A,
      ]);
      expect(first.rowCount).toBe(1);
      await expectSqlState(
        c.query(ENQUEUE, [TENANT_A, TPLVER_PLATFORM_APPROVED, 'fx-p15-ntf-twice', SENDER_A]),
        '23505'
      );
    });
  });

  it('ON CONFLICT DO NOTHING yields no row and leaves the existing message untouched', async () => {
    // This is the shape NotificationRepository.enqueue depends on: the pre-existing
    // row may already be `sending`, so it must not be updated, re-attributed, or
    // otherwise disturbed by a duplicate request.
    const outcome = await withRolledBackTx(runtime, AS_SENDER_A, async (c: Q) => {
      const conflicted = await c.query(
        `${ENQUEUE} ON CONFLICT (tenant_id, dedupe_key) DO NOTHING RETURNING id`,
        [TENANT_A, TPLVER_PLATFORM_APPROVED, DEDUPE_TAKEN, SENDER_A]
      );
      const existing = await c.query<{ id: string; created_by: string; status: string }>(
        `SELECT id, created_by, status FROM shared.outbound_messages
          WHERE tenant_id = $1 AND dedupe_key = $2`,
        [TENANT_A, DEDUPE_TAKEN]
      );
      return { inserted: conflicted.rowCount, row: existing.rows[0] };
    });
    expect(outcome.inserted).toBe(0);
    expect(outcome.row?.id).toBe(MSG_DEDUPE);
    expect(outcome.row?.created_by).toBe(SYS);
    expect(outcome.row?.status).toBe('pending');
  });

  it('the same dedupe key in another tenant is accepted — the identity is tenant-scoped', async () => {
    const inserted = await withRolledBackTx(runtime, AS_SENDER_B, async (c: Q) => {
      const r = await c.query(ENQUEUE, [
        TENANT_B,
        TPLVER_PLATFORM_APPROVED,
        DEDUPE_TAKEN,
        SENDER_B,
      ]);
      return r.rowCount;
    });
    expect(inserted).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('P1-15 notifications / guard_outbound_message_scope gates the template reference', () => {
  it('a DRAFT platform version cannot be enqueued from', async () => {
    await withRolledBackTx(runtime, AS_SENDER_A, async (c: Q) => {
      const code = await expectSqlState(
        c.query(ENQUEUE, [TENANT_A, TPLVER_PLATFORM_DRAFT, 'fx-p15-ntf-draft-p', SENDER_A]),
        '23514'
      );
      expect(code).toBe('23514');
    });
  });

  it('a DRAFT tenant version cannot be enqueued from either', async () => {
    await withRolledBackTx(runtime, AS_SENDER_A, async (c: Q) => {
      await expectSqlState(
        c.query(ENQUEUE, [TENANT_A, TPLVER_A_DRAFT, 'fx-p15-ntf-draft-t', SENDER_A]),
        '23514'
      );
    });
  });

  it('the draft refusal names approval as the reason (admin probe of the guard message)', async () => {
    // Admin reaches the identical branch; asserting the message here keeps the
    // runtime tests above free of message coupling while still proving that the
    // 23514 they observe is the approval branch and not some other CHECK.
    const probe = await adminProbe(
      `INSERT INTO shared.outbound_messages
         (tenant_id, template_version_id, channel, purpose, recipient_digest, body_sha256,
          dedupe_key, created_by)
       VALUES ($1, $2, 'email', 'transactional', ${DIGEST}, ${BODY}, $3, $4)`,
      [TENANT_A, TPLVER_PLATFORM_DRAFT, 'fx-p15-ntf-admin-draft', SYS]
    );
    expect(probe.code).toBe('23514');
    expect(probe.msg).toContain('is not approved');
  });

  it("another tenant's approved version is invisible to the guard, which reports it missing", async () => {
    await withRolledBackTx(runtime, AS_SENDER_A, async (c: Q) => {
      // The referenced row exists, but not inside tenant A's RLS view: the guard's
      // `SELECT ... FOR SHARE` finds nothing and raises foreign_key_violation. The
      // table-level FK cannot produce this denial — referential-integrity checks
      // bypass RLS by design — so the guard is the control being observed.
      const code = await expectSqlState(
        c.query(ENQUEUE, [TENANT_A, TPLVER_B_APPROVED, 'fx-p15-ntf-otherten', SENDER_A]),
        '23503'
      );
      expect(code).toBe('23503');
    });
  });

  it('the cross-tenant compatibility branch itself refuses (admin probe)', async () => {
    // Only a BYPASSRLS writer can see tenant B's version while inserting a tenant A
    // message, so only admin can reach the branch that compares the two tenants.
    // For app_runtime the row is simply not there, which is the test above.
    const probe = await adminProbe(
      `INSERT INTO shared.outbound_messages
         (tenant_id, template_version_id, channel, purpose, recipient_digest, body_sha256,
          dedupe_key, created_by)
       VALUES ($1, $2, 'email', 'transactional', ${DIGEST}, ${BODY}, $3, $4)`,
      [TENANT_A, TPLVER_B_APPROVED, 'fx-p15-ntf-admin-cross', SYS]
    );
    expect(probe.code).toBe('23514');
    expect(probe.msg).toContain('is not compatible with tenant');
  });
});

// ---------------------------------------------------------------------------

describe('P1-15 notifications / P1-15-R-001 regression: platform templates stay enqueueable', () => {
  // FINDING P1-15-R-001. `guard_outbound_message_scope` resolves the referenced
  // version with `SELECT ... FOR SHARE`, and under RLS a locking read must also
  // satisfy an UPDATE policy. `upd_template_versions_tenant` demands
  // `tenant_id IS NOT NULL`, `tenant_id = iam.current_tenant_id()` AND
  // `org.settings.manage`. SENDER_A holds `shared.notification.send` and nothing
  // else, so that policy admits nothing for it — on a platform row for anyone, and
  // on its own tenant's rows for this principal. The only reason these tests can
  // pass is `lck_template_versions_reference`. If it were dropped, the guard would
  // report "template version does not exist" and every platform template would
  // become unusable.

  it('a sender holding ONLY shared.notification.send enqueues from an approved PLATFORM version', async () => {
    const row = await withRolledBackTx(runtime, AS_SENDER_A, async (c: Q) => {
      const r = await c.query<{ status: string; template_version_id: string }>(
        `${ENQUEUE} RETURNING status, template_version_id`,
        [TENANT_A, TPLVER_PLATFORM_APPROVED, 'fx-p15-ntf-r001-platform', SENDER_A]
      );
      return r.rows[0];
    });
    expect(row?.status).toBe('pending');
    expect(row?.template_version_id).toBe(TPLVER_PLATFORM_APPROVED);
  });

  it('that same sender can take the guard’s FOR SHARE lock on the platform version directly', async () => {
    // The mechanism, isolated from the INSERT. A plain SELECT would succeed on the
    // SELECT policy alone; adding FOR SHARE is what pulls the UPDATE policies in,
    // so this statement fails without the lock-only policy and succeeds with it.
    const locked = await withRolledBackTx(runtime, AS_SENDER_A, async (c: Q) => {
      const r = await c.query<{ id: string }>(
        `SELECT id FROM shared.template_versions WHERE id = $1 FOR SHARE`,
        [TPLVER_PLATFORM_APPROVED]
      );
      return r.rows.map((x) => x.id);
    });
    expect(locked).toEqual([TPLVER_PLATFORM_APPROVED]);
  });

  it('the control: on a relation with NO lock-only policy, the same locking read loses the row', async () => {
    // `shared.message_templates` is the counter-example that makes the mechanism
    // visible instead of merely asserted. Its only UPDATE policy demands
    // scope='tenant' plus `org.settings.manage`, and there is no lock-only policy
    // beside it. So for this principal the PLATFORM template is readable and
    // NOT lockable — the row is silently filtered out of the locking read.
    //
    // That is precisely what `shared.template_versions` would do without
    // `lck_template_versions_reference`: the enqueue guard's SELECT ... FOR SHARE
    // would find nothing and raise "template version does not exist". The two
    // counts below differ by exactly that policy's absence.
    const counts = await withRolledBackTx(runtime, AS_SENDER_A, async (c: Q) => {
      const plain = await c.query<{ id: string }>(
        `SELECT id FROM shared.message_templates WHERE id = $1`,
        [TEMPLATE_PLATFORM]
      );
      const locking = await c.query<{ id: string }>(
        `SELECT id FROM shared.message_templates WHERE id = $1 FOR SHARE`,
        [TEMPLATE_PLATFORM]
      );
      return { plain: plain.rows.length, locking: locking.rows.length };
    });
    expect(counts.plain).toBe(1);
    expect(counts.locking).toBe(0);
  });

  it('the same sender can also enqueue from its own tenant’s approved version', async () => {
    const inserted = await withRolledBackTx(runtime, AS_SENDER_A, async (c: Q) => {
      const r = await c.query(ENQUEUE, [
        TENANT_A,
        TPLVER_A_APPROVED,
        'fx-p15-ntf-r001-tenant',
        SENDER_A,
      ]);
      return r.rowCount;
    });
    expect(inserted).toBe(1);
  });

  it('the widening is lock-only: the policy is an UPDATE policy whose WITH CHECK is false', async () => {
    const { rows } = await admin.query<{ cmd: string; qual: string; withcheck: string }>(
      `SELECT p.polcmd AS cmd,
              pg_get_expr(p.polqual, p.polrelid) AS qual,
              pg_get_expr(p.polwithcheck, p.polrelid) AS withcheck
         FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'shared' AND c.relname = 'template_versions'
          AND p.polname = 'lck_template_versions_reference'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cmd).toBe('w');
    expect(rows[0]?.withcheck).toBe('false');
  });

  it('the lock-only policy is not a write path — a platform version cannot be mutated', async () => {
    await withRolledBackTx(runtime, AS_SENDER_A, async (c: Q) => {
      // Lockable, never mutable: WITH CHECK false, and the only other WITH CHECK
      // demands tenant ownership a platform row cannot acquire.
      await expectSqlState(
        c.query(`UPDATE shared.template_versions SET subject = 'hijacked' WHERE id = $1`, [
          TPLVER_PLATFORM_DRAFT,
        ]),
        '42501'
      );
    });
    const after = await admin.query<{ subject: string }>(
      `SELECT subject FROM shared.template_versions WHERE id = $1`,
      [TPLVER_PLATFORM_DRAFT]
    );
    expect(after.rows[0]?.subject).toBe('Fixture subject');
  });
});

// ---------------------------------------------------------------------------

describe('P1-15 notifications / app_runtime cannot forge delivery evidence', () => {
  it('inserting a delivery attempt is refused with 42501', async () => {
    await withRolledBackTx(runtime, AS_SENDER_A, async (c: Q) => {
      const code = await expectSqlState(
        c.query(
          `INSERT INTO shared.delivery_attempts
             (tenant_id, message_id, attempt_number, provider_code, status, completed_at, created_by)
           VALUES ($1, $2, 1, 'forged', 'delivered', now(), $3)`,
          [TENANT_A, MSG_LIFECYCLE, SENDER_A]
        ),
        '42501'
      );
      expect(code).toBe('42501');
    });
  });

  it('updating a message status is refused with 42501 — a privilege error, not zero rows', async () => {
    // The distinction matters. A policy USING clause that filtered the row would
    // report success with rowCount 0; here there is no UPDATE privilege at all, so
    // the statement is rejected before any row is considered.
    await withRolledBackTx(runtime, AS_SENDER_A, async (c: Q) => {
      const code = await expectSqlState(
        c.query(
          `UPDATE shared.outbound_messages SET status = 'delivered'
            WHERE tenant_id = $1 AND id = $2`,
          [TENANT_A, MSG_LIFECYCLE]
        ),
        '42501'
      );
      expect(code).toBe('42501');
    });
  });

  it('the catalog confirms app_runtime holds no UPDATE column privilege on outbound_messages', async () => {
    const { rows } = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.column_privileges
        WHERE table_schema = 'shared' AND table_name = 'outbound_messages'
          AND grantee = 'app_runtime' AND privilege_type = 'UPDATE'`
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it('app_runtime holds no privilege whatsoever on delivery_attempts beyond SELECT', async () => {
    const { rows } = await admin.query<{ privilege_type: string }>(
      `SELECT DISTINCT privilege_type FROM information_schema.table_privileges
        WHERE table_schema = 'shared' AND table_name = 'delivery_attempts'
          AND grantee = 'app_runtime'`
    );
    expect(rows.map((r) => r.privilege_type).sort()).toEqual(['SELECT']);
  });

  it('a message cannot be deleted by the request role', async () => {
    await withRolledBackTx(runtime, AS_SENDER_A, async (c: Q) => {
      await expectSqlState(
        c.query(`DELETE FROM shared.outbound_messages WHERE tenant_id = $1 AND id = $2`, [
          TENANT_A,
          MSG_LIFECYCLE,
        ]),
        '42501'
      );
    });
  });
});

// ---------------------------------------------------------------------------

describe('P1-15 notifications / the worker owns the dispatch lifecycle', () => {
  /** Advances a message on the worker connection, asserting exactly one row moved. */
  async function move(c: Q, id: string, from: string, to: string, failure?: string): Promise<void> {
    const r =
      failure === undefined
        ? await c.query(
            `UPDATE shared.outbound_messages SET status = $3
              WHERE tenant_id = $1 AND id = $2 AND status = $4`,
            [TENANT_A, id, to, from]
          )
        : await c.query(
            `UPDATE shared.outbound_messages SET status = $3, failure_class = $5
              WHERE tenant_id = $1 AND id = $2 AND status = $4`,
            [TENANT_A, id, to, from, failure]
          );
    expect(r.rowCount, `${from} -> ${to}`).toBe(1);
  }

  it('pending -> queued -> sending -> sent -> delivered succeeds and stamps each step', async () => {
    const row = await withRolledBackTx(worker, NO_CONTEXT, async (c: Q) => {
      await move(c, MSG_LIFECYCLE, DISPATCH_TRANSITIONS.queue.from, DISPATCH_TRANSITIONS.queue.to);
      await move(c, MSG_LIFECYCLE, DISPATCH_TRANSITIONS.start.from, DISPATCH_TRANSITIONS.start.to);
      await move(c, MSG_LIFECYCLE, DISPATCH_TRANSITIONS.sent.from, DISPATCH_TRANSITIONS.sent.to);
      await move(
        c,
        MSG_LIFECYCLE,
        DISPATCH_TRANSITIONS.delivered.from,
        DISPATCH_TRANSITIONS.delivered.to
      );
      const r = await c.query<{
        status: string;
        retry_count: number;
        queued_at: Date | null;
        sending_at: Date | null;
        sent_at: Date | null;
        delivered_at: Date | null;
      }>(
        `SELECT status, retry_count, queued_at, sending_at, sent_at, delivered_at
           FROM shared.outbound_messages WHERE id = $1`,
        [MSG_LIFECYCLE]
      );
      return r.rows[0];
    });
    expect(row?.status).toBe('delivered');
    expect(row?.retry_count).toBe(0);
    expect(row?.queued_at).not.toBeNull();
    expect(row?.sending_at).not.toBeNull();
    expect(row?.sent_at).not.toBeNull();
    expect(row?.delivered_at).not.toBeNull();
  });

  it('an invalid edge (pending -> sent) is refused by the lifecycle guard', async () => {
    await withRolledBackTx(worker, NO_CONTEXT, async (c: Q) => {
      const code = await expectSqlState(
        c.query(
          `UPDATE shared.outbound_messages SET status = 'sent' WHERE tenant_id = $1 AND id = $2`,
          [TENANT_A, MSG_LIFECYCLE]
        ),
        '23514'
      );
      expect(code).toBe('23514');
    });
  });

  it('sending -> failed without a failure_class is refused', async () => {
    await withRolledBackTx(worker, NO_CONTEXT, async (c: Q) => {
      await move(c, MSG_RETRY, 'pending', 'queued');
      await move(c, MSG_RETRY, 'queued', 'sending');
      await expectSqlState(
        c.query(
          `UPDATE shared.outbound_messages SET status = 'failed' WHERE tenant_id = $1 AND id = $2`,
          [TENANT_A, MSG_RETRY]
        ),
        '23514'
      );
    });
  });

  it('failed -> queued increments retry_count by exactly one and clears the failure state', async () => {
    const outcome = await withRolledBackTx(worker, NO_CONTEXT, async (c: Q) => {
      await move(c, MSG_RETRY, 'pending', 'queued');
      await move(c, MSG_RETRY, 'queued', 'sending');
      await move(c, MSG_RETRY, 'sending', 'failed', 'fx_transient');

      const failed = await c.query<{ retry_count: number; failure_class: string | null }>(
        `SELECT retry_count, failure_class FROM shared.outbound_messages WHERE id = $1`,
        [MSG_RETRY]
      );

      // The dispatcher names failure_class because the column is in its grant and
      // the guard's own assignment must be reachable in a single statement.
      const retried = await c.query(
        `UPDATE shared.outbound_messages SET status = 'queued', failure_class = NULL
          WHERE tenant_id = $1 AND id = $2 AND status = 'failed'`,
        [TENANT_A, MSG_RETRY]
      );
      expect(retried.rowCount).toBe(1);

      const after = await c.query<{
        status: string;
        retry_count: number;
        failure_class: string | null;
        sending_at: Date | null;
        failed_at: Date | null;
        queued_at: Date | null;
      }>(
        `SELECT status, retry_count, failure_class, sending_at, failed_at, queued_at
           FROM shared.outbound_messages WHERE id = $1`,
        [MSG_RETRY]
      );
      return { failed: failed.rows[0], after: after.rows[0] };
    });

    expect(outcome.failed?.retry_count).toBe(0);
    expect(outcome.failed?.failure_class).toBe('fx_transient');
    expect(outcome.after?.status).toBe('queued');
    expect(outcome.after?.retry_count).toBe(1);
    expect(outcome.after?.failure_class).toBeNull();
    expect(outcome.after?.sending_at).toBeNull();
    expect(outcome.after?.failed_at).toBeNull();
    expect(outcome.after?.queued_at).not.toBeNull();
  });

  it('the worker cannot name retry_count in an UPDATE at all', async () => {
    await withRolledBackTx(worker, NO_CONTEXT, async (c: Q) => {
      await expectSqlState(
        c.query(
          `UPDATE shared.outbound_messages SET status = 'queued', retry_count = retry_count + 1
            WHERE tenant_id = $1 AND id = $2`,
          [TENANT_A, MSG_LIFECYCLE]
        ),
        '42501'
      );
    });
  });

  it('retry_count may not change on any other edge, for ANY writer (admin probe)', async () => {
    // retry_count is outside every application UPDATE grant, so only the BYPASSRLS
    // connection can reach the guard branch that owns the value itself.
    const probe = await adminProbe(
      `UPDATE shared.outbound_messages SET status = 'queued', retry_count = 5 WHERE id = $1`,
      [MSG_GUARD]
    );
    expect(probe.code).toBe('23514');
    expect(probe.msg).toContain('retry_count changes only on failed to queued');
  });

  it('lifecycle fields cannot change without a status transition, for ANY writer (admin probe)', async () => {
    const probe = await adminProbe(
      `UPDATE shared.outbound_messages SET status = 'pending', retry_count = 4 WHERE id = $1`,
      [MSG_GUARD]
    );
    expect(probe.code).toBe('23514');
    expect(probe.msg).toContain('may change only with a status transition');
  });

  it('the worker holds UPDATE on exactly status and failure_class', async () => {
    const { rows } = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.column_privileges
        WHERE table_schema = 'shared' AND table_name = 'outbound_messages'
          AND grantee = 'app_worker' AND privilege_type = 'UPDATE'
        ORDER BY column_name`
    );
    expect(rows.map((r) => r.column_name)).toEqual(['failure_class', 'status']);
  });

  it('the worker cannot enqueue a message of its own', async () => {
    await withRolledBackTx(worker, NO_CONTEXT, async (c: Q) => {
      await expectSqlState(
        c.query(ENQUEUE, [TENANT_A, TPLVER_PLATFORM_APPROVED, 'fx-p15-ntf-worker-ins', SYS]),
        '42501'
      );
    });
  });

  it('the worker cannot delete a message', async () => {
    await withRolledBackTx(worker, NO_CONTEXT, async (c: Q) => {
      await expectSqlState(
        c.query(`DELETE FROM shared.outbound_messages WHERE id = $1`, [MSG_LIFECYCLE]),
        '42501'
      );
    });
  });
});

// ---------------------------------------------------------------------------

describe('P1-15 notifications / lifecycle timestamps are server-controlled', () => {
  const SERVER_STAMPS = ['queued_at', 'sending_at', 'sent_at', 'delivered_at'] as const;

  for (const column of SERVER_STAMPS) {
    it(`the worker cannot name ${column} in a transition — it is outside the column grant`, async () => {
      // For app_worker the refusal is 42501: the privilege layer stops the
      // statement before the guard is consulted. The guard's own 23514 refusal is
      // proved by the admin probe below, which is the only way to reach it.
      await withRolledBackTx(worker, NO_CONTEXT, async (c: Q) => {
        await expectSqlState(
          c.query(
            `UPDATE shared.outbound_messages SET status = 'queued', ${column} = now()
              WHERE tenant_id = $1 AND id = $2`,
            [TENANT_A, MSG_LIFECYCLE]
          ),
          '42501'
        );
      });
    });
  }

  it('an UPDATE that sets queued_at directly is refused 23514 for ANY writer (admin probe)', async () => {
    const probe = await adminProbe(
      `UPDATE shared.outbound_messages SET status = 'queued', queued_at = now() WHERE id = $1`,
      [MSG_GUARD]
    );
    expect(probe.code).toBe('23514');
    expect(probe.msg).toContain('lifecycle timestamps are server-controlled');
  });

  it('an UPDATE that sets sent_at directly is refused 23514 for ANY writer (admin probe)', async () => {
    const probe = await adminProbe(
      `UPDATE shared.outbound_messages SET status = 'queued', sent_at = now() WHERE id = $1`,
      [MSG_GUARD]
    );
    expect(probe.code).toBe('23514');
    expect(probe.msg).toContain('lifecycle timestamps are server-controlled');
  });
});

// ---------------------------------------------------------------------------

describe('P1-15 notifications / delivery attempts are append-only worker evidence', () => {
  it('the worker records an attempt against a message', async () => {
    const inserted = await withRolledBackTx(worker, NO_CONTEXT, async (c: Q) => {
      const r = await c.query<{ attempt_number: number; completed_at: Date | null }>(
        `INSERT INTO shared.delivery_attempts
           (tenant_id, message_id, attempt_number, provider_code, status, created_by)
         VALUES ($1, $2, 1, 'fx_provider', 'started', $3)
         RETURNING attempt_number, completed_at`,
        [TENANT_A, MSG_ATTEMPTS, SYS]
      );
      return r.rows[0];
    });
    expect(inserted?.attempt_number).toBe(1);
    expect(inserted?.completed_at).toBeNull();
  });

  it('uq_delivery_attempts_message_number refuses a duplicate attempt number', async () => {
    await withRolledBackTx(worker, NO_CONTEXT, async (c: Q) => {
      const first = await c.query(
        `INSERT INTO shared.delivery_attempts
           (tenant_id, message_id, attempt_number, provider_code, status, created_by)
         VALUES ($1, $2, 1, 'fx_provider', 'started', $3)`,
        [TENANT_A, MSG_ATTEMPTS, SYS]
      );
      expect(first.rowCount).toBe(1);
      const code = await expectSqlState(
        c.query(
          `INSERT INTO shared.delivery_attempts
             (tenant_id, message_id, attempt_number, provider_code, status, completed_at, created_by)
           VALUES ($1, $2, 1, 'fx_other_provider', 'delivered', now(), $3)`,
          [TENANT_A, MSG_ATTEMPTS, SYS]
        ),
        '23505'
      );
      expect(code).toBe('23505');
    });
  });

  it('the next attempt number is accepted, so retries append rather than overwrite', async () => {
    const numbers = await withRolledBackTx(worker, NO_CONTEXT, async (c: Q) => {
      for (const [n, status] of [
        [1, 'errored'],
        [2, 'delivered'],
      ] as const) {
        await c.query(
          `INSERT INTO shared.delivery_attempts
             (tenant_id, message_id, attempt_number, provider_code, status, error_summary,
              completed_at, created_by)
           VALUES ($1, $2, $3, 'fx_provider', $4, $5, now(), $6)`,
          [
            TENANT_A,
            MSG_ATTEMPTS,
            n,
            status,
            status === 'errored' ? 'fx sanitized transport failure' : null,
            SYS,
          ]
        );
      }
      const r = await c.query<{ attempt_number: number }>(
        `SELECT attempt_number FROM shared.delivery_attempts
          WHERE tenant_id = $1 AND message_id = $2 ORDER BY attempt_number`,
        [TENANT_A, MSG_ATTEMPTS]
      );
      return r.rows.map((x) => x.attempt_number);
    });
    expect(numbers).toEqual([1, 2]);
  });

  it('an errored attempt with no error_summary is refused', async () => {
    await withRolledBackTx(worker, NO_CONTEXT, async (c: Q) => {
      // completed_at is supplied so ck_delivery_attempts_completion is satisfied
      // and the missing summary is the only thing that can refuse the row.
      const code = await expectSqlState(
        c.query(
          `INSERT INTO shared.delivery_attempts
             (tenant_id, message_id, attempt_number, provider_code, status, completed_at, created_by)
           VALUES ($1, $2, 3, 'fx_provider', 'errored', now(), $3)`,
          [TENANT_A, MSG_ATTEMPTS, SYS]
        ),
        '23514'
      );
      expect(code).toBe('23514');
    });
  });

  it('an errored attempt with a blank error_summary is refused too', async () => {
    await withRolledBackTx(worker, NO_CONTEXT, async (c: Q) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.delivery_attempts
             (tenant_id, message_id, attempt_number, provider_code, status, error_summary,
              completed_at, created_by)
           VALUES ($1, $2, 4, 'fx_provider', 'errored', '   ', now(), $3)`,
          [TENANT_A, MSG_ATTEMPTS, SYS]
        ),
        '23514'
      );
    });
  });

  it('a recorded attempt cannot be rewritten — the worker holds no UPDATE', async () => {
    await withRolledBackTx(worker, NO_CONTEXT, async (c: Q) => {
      const first = await c.query(
        `INSERT INTO shared.delivery_attempts
           (tenant_id, message_id, attempt_number, provider_code, status, error_summary,
            completed_at, created_by)
         VALUES ($1, $2, 5, 'fx_provider', 'errored', 'fx sanitized failure', now(), $3)`,
        [TENANT_A, MSG_ATTEMPTS, SYS]
      );
      expect(first.rowCount).toBe(1);
      // Rewriting an errored attempt as delivered is the forgery this absence
      // prevents; the table has no triggers, so the missing grant is the control.
      await expectSqlState(
        c.query(
          `UPDATE shared.delivery_attempts SET status = 'delivered'
            WHERE tenant_id = $1 AND message_id = $2`,
          [TENANT_A, MSG_ATTEMPTS]
        ),
        '42501'
      );
    });
  });

  it('a recorded attempt cannot be deleted either', async () => {
    await withRolledBackTx(worker, NO_CONTEXT, async (c: Q) => {
      await expectSqlState(
        c.query(`DELETE FROM shared.delivery_attempts WHERE tenant_id = $1`, [TENANT_A]),
        '42501'
      );
    });
  });
});

// ---------------------------------------------------------------------------

describe('P1-15 notifications / the worker cannot read template content', () => {
  // THE REASON RENDERED CONTENT IS HANDED TO THE DISPATCHER.
  //
  // message-dispatch-repository.ts states that `app_worker` holds "nothing at all"
  // on shared.template_versions, and derives the whole content-flow design from it:
  // the worker cannot re-render a message, and outbound_messages stores no body
  // (only body_sha256, documented as a digest of content not persisted here). If
  // this test ever failed, that design statement would be false.

  it('has_table_privilege reports false for app_worker SELECT on shared.template_versions', async () => {
    const { rows } = await admin.query<{ sel: boolean; ins: boolean; upd: boolean; del: boolean }>(
      `SELECT has_table_privilege('app_worker', 'shared.template_versions', 'SELECT') AS sel,
              has_table_privilege('app_worker', 'shared.template_versions', 'INSERT') AS ins,
              has_table_privilege('app_worker', 'shared.template_versions', 'UPDATE') AS upd,
              has_table_privilege('app_worker', 'shared.template_versions', 'DELETE') AS del`
    );
    expect(rows[0]?.sel).toBe(false);
    expect(rows[0]?.ins).toBe(false);
    expect(rows[0]?.upd).toBe(false);
    expect(rows[0]?.del).toBe(false);
  });

  it('the worker login is refused when it tries to read a template version', async () => {
    await withRolledBackTx(worker, NO_CONTEXT, async (c: Q) => {
      await expectSqlState(
        c.query(`SELECT body FROM shared.template_versions WHERE id = $1`, [
          TPLVER_PLATFORM_APPROVED,
        ]),
        '42501'
      );
    });
  });

  it('the worker login is refused on shared.message_templates as well', async () => {
    await withRolledBackTx(worker, NO_CONTEXT, async (c: Q) => {
      await expectSqlState(
        c.query(`SELECT name FROM shared.message_templates WHERE id = $1`, [TEMPLATE_PLATFORM]),
        '42501'
      );
    });
  });

  it('the catalog lists no privilege of any kind for app_worker on either template relation', async () => {
    const { rows } = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.table_privileges
        WHERE table_schema = 'shared'
          AND table_name IN ('message_templates', 'template_versions')
          AND grantee = 'app_worker'`
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it('the message row the worker does read carries a digest and no body column exists', async () => {
    // The other half of the same design: even with full SELECT on the message, the
    // worker finds only body_sha256. There is no content column to read.
    const columns = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'shared' AND table_name = 'outbound_messages'
          AND column_name IN ('body', 'subject', 'content', 'rendered_body', 'body_sha256')
        ORDER BY column_name`
    );
    expect(columns.rows.map((r) => r.column_name)).toEqual(['body_sha256']);

    const digest = await withRolledBackTx(worker, NO_CONTEXT, async (c: Q) => {
      const r = await c.query<{ len: number }>(
        `SELECT octet_length(body_sha256) AS len FROM shared.outbound_messages WHERE id = $1`,
        [MSG_LIFECYCLE]
      );
      return r.rows[0]?.len;
    });
    expect(digest).toBe(32);
  });
});
