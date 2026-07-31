/**
 * P1-23 operation evidence — the notification read surface, driven through the
 * REAL wiring on the deployed `app_runtime` identity.
 *
 * P1-15 built the write half and granted `app_runtime` SELECT on both
 * `shared.outbound_messages` and `shared.delivery_attempts` without ever
 * exposing them. These three operations are the read half, and the property
 * this suite exists to pin is the one the database cannot pin for itself:
 *
 *   **RLS proves a row belongs to the tenant. It says nothing about which user
 *   inside that tenant may see it.**
 *
 * So a cross-tenant assertion alone would pass against an inbox that leaks every
 * message in the tenant to every user. The decisive test here is
 * `does not return a message addressed to another user in the SAME tenant` —
 * remove `recipient_user_id` from the repository predicate and that is the only
 * assertion in the repository that fails.
 *
 * The admin (`postgres`, BYPASSRLS) connection appears only to provision
 * preconditions and to read back what actually landed. Nothing it does is
 * evidence.
 *
 * Operations exercised here (coverage-gate references):
 *   shared.notification-list   shared.notification-read
 *   shared.notification-delivery-list
 *
 * ===========================================================================
 * WHY THE DELIVERY VIEW IS A DIFFERENT SHAPE
 * ===========================================================================
 * The inbox is recipient-scoped and unaudited: reading your own notifications
 * is not privileged. Delivery inspection is deliberately WIDER — an operator
 * diagnosing a stuck queue must see messages they did not receive — so it takes
 * a different permission (`shared.notification.delivery.read`) and writes an
 * audit record. Wider visibility that is not accountable is a leak with a
 * permission attached, and the audit assertion below is what keeps that true.
 *
 * ===========================================================================
 * WHAT MUST NEVER APPEAR IN A RESPONSE
 * ===========================================================================
 * `body_sha256` and `recipient_digest` are columns on the row and are asserted
 * absent from every projection. The first is an integrity digest of content
 * that is never persisted; the second is a salted digest of an external
 * destination. `delivery_attempts.details` is asserted absent for the same
 * reason — it is the one provider-shaped jsonb column that could carry a raw
 * provider payload.
 *
 * COVERAGE-EVIDENCE (P1-23 notification reads):
 *   shared.notification-list: route service success denial cross-tenant isolation authorization
 *   shared.notification-read: route service success denial cross-tenant isolation authorization
 *   shared.notification-delivery-list: route service success denial cross-tenant isolation authorization audit
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_PERMITTED,
  USER_SCOPED,
  USER_TENANT_B,
  USER_UNPERMITTED,
  adminPool,
  cleanBackendFixtures,
  contextFor,
  countRows,
  ensureBackendFixtures,
  runtimeAppPool,
} from './helpers';
import { __resetBackendConfigForTests } from '@/server/config/backend-config';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { withTransaction } from '@/server/db/transaction';
import { AppFailure } from '@/server/errors/app-failure';
import { requirePermissions } from '@/server/auth/authorization';
import { sharedServicesModule } from '@/modules/shared-services';

/**
 * The caller, and a SECOND user in the same tenant whose inbox must stay
 * private.
 *
 * Both come from `ensureBackendFixtures` rather than being minted here: the FK
 * on (tenant_id, recipient_user_id) requires a real `iam.user_accounts` row in
 * that tenant, and a row this file created is one `cleanBackendFixtures` away
 * from vanishing underneath a suite that runs alongside it.
 *
 * The neighbour is what makes the recipient predicate testable at all. Without
 * a second user inside TENANT_A every cross-user case would also be a
 * cross-tenant case, and the weaker guard would look sufficient.
 */
const CALLER = USER_PERMITTED;
const NEIGHBOUR = USER_SCOPED;

let admin: Pool;
let runtime: Pool;

/** Seeds one outbound message directly, bypassing the write path under test. */
async function seedMessage(input: {
  readonly id: string;
  readonly tenantId: string;
  readonly recipientUserId: string | null;
  readonly status?: string;
  readonly dedupeKey: string;
}): Promise<void> {
  await admin.query(
    `INSERT INTO shared.outbound_messages
       (id, tenant_id, channel, purpose, recipient_user_id, recipient_digest,
        body_sha256, dedupe_key, status, created_by)
     VALUES ($1, $2, 'in_app', 'transactional', $3,
             CASE WHEN $3::uuid IS NULL THEN decode(repeat('ab', 32), 'hex') ELSE NULL END,
             decode(repeat('cd', 32), 'hex'), $4, COALESCE($5, 'pending'), $6)`,
    [
      input.id,
      input.tenantId,
      input.recipientUserId,
      input.dedupeKey,
      input.status ?? null,
      input.tenantId === TENANT_B ? USER_TENANT_B : USER_A,
    ]
  );
}

beforeAll(async () => {
  __resetBackendConfigForTests();
  admin = adminPool();
  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);
  await ensureBackendFixtures(admin);
});

afterAll(async () => {
  await admin.query(`DELETE FROM shared.delivery_attempts WHERE tenant_id = ANY($1::uuid[])`, [
    [TENANT_A, TENANT_B],
  ]);
  await admin.query(`DELETE FROM shared.outbound_messages WHERE tenant_id = ANY($1::uuid[])`, [
    [TENANT_A, TENANT_B],
  ]);
  await cleanBackendFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('shared.notification-list — the caller reads only their own inbox', () => {
  it('invokes shared.notification-list and returns the caller own messages, newest first', async () => {
    const mine1 = randomUUID();
    const mine2 = randomUUID();
    await seedMessage({
      id: mine1,
      tenantId: TENANT_A,
      recipientUserId: CALLER,
      dedupeKey: `p123-${mine1}`,
    });
    await seedMessage({
      id: mine2,
      tenantId: TENANT_A,
      recipientUserId: CALLER,
      dedupeKey: `p123-${mine2}`,
    });

    const page = await withTransaction(
      contextFor({ tenantId: TENANT_A, userId: CALLER, operation: 'shared.notification-list' }),
      (db) => sharedServicesModule().notificationReads.listMine(db, {})
    );

    const ids = page.items.map((item) => item.notificationId);
    expect(ids).toContain(mine1);
    expect(ids).toContain(mine2);
    // Newest first: the second insert must precede the first.
    expect(ids.indexOf(mine2)).toBeLessThan(ids.indexOf(mine1));
  });

  it('does not return a message addressed to another user in the SAME tenant', async () => {
    // THE decisive assertion. RLS lets this row through — it is the caller's
    // tenant — so only the repository's `recipient_user_id` predicate keeps it
    // out. Delete that predicate and this is the single test that fails.
    const neighbours = randomUUID();
    await seedMessage({
      id: neighbours,
      tenantId: TENANT_A,
      recipientUserId: NEIGHBOUR,
      dedupeKey: `p123-${neighbours}`,
    });

    const page = await withTransaction(
      contextFor({ tenantId: TENANT_A, userId: CALLER, operation: 'shared.notification-list' }),
      (db) => sharedServicesModule().notificationReads.listMine(db, {})
    );

    expect(page.items.map((i) => i.notificationId)).not.toContain(neighbours);
  });

  it('does not return another tenant messages', async () => {
    const foreign = randomUUID();
    await seedMessage({
      id: foreign,
      tenantId: TENANT_B,
      recipientUserId: USER_TENANT_B,
      dedupeKey: `p123-${foreign}`,
    });

    const page = await withTransaction(
      contextFor({ tenantId: TENANT_A, userId: CALLER, operation: 'shared.notification-list' }),
      (db) => sharedServicesModule().notificationReads.listMine(db, {})
    );

    expect(page.items.map((i) => i.notificationId)).not.toContain(foreign);
  });

  it('never projects the recipient digest or the body digest', async () => {
    const mine = randomUUID();
    await seedMessage({
      id: mine,
      tenantId: TENANT_A,
      recipientUserId: CALLER,
      dedupeKey: `p123-${mine}`,
    });

    const page = await withTransaction(
      contextFor({ tenantId: TENANT_A, userId: CALLER, operation: 'shared.notification-list' }),
      (db) => sharedServicesModule().notificationReads.listMine(db, {})
    );

    // An EXACT key set, not a "does not contain" scan.
    //
    // The scan this replaced could not fail in the direction that matters. It
    // forbade five spellings by name, so a projection that leaked
    // `recipient_digest` under any SIXTH name passed, and the value-level check
    // (`cdcdcdcd`) compared a hex literal against a `bytea` column that does not
    // serialise to that form at all — so it was asserting against a string the
    // response could never have contained however broken the projection was.
    //
    // Widening the projection by one column now fails here whatever it is called.
    const item = page.items[0];
    expect(item, 'the seeded message must be visible to its recipient').toBeDefined();
    expect(Object.keys(item!).sort()).toEqual(
      [
        'branchId',
        'cancelledAt',
        'channel',
        'companyId',
        'createdAt',
        'deliveredAt',
        'failedAt',
        'failureClass',
        'notificationId',
        'purpose',
        'queuedAt',
        'recordVersion',
        'sentAt',
        'status',
        'templateVersionId',
        'retryCount',
      ].sort()
    );
  });

  it('bounds the page size rather than trusting the caller', async () => {
    const page = await withTransaction(
      contextFor({ tenantId: TENANT_A, userId: CALLER, operation: 'shared.notification-list' }),
      (db) => sharedServicesModule().notificationReads.listMine(db, { limit: 10_000 })
    );
    // MAX_PAGE_SIZE is the foundation's clamp; the exact value is its business,
    // but an unbounded request must not produce an unbounded page.
    expect(page.items.length).toBeLessThanOrEqual(100);
  });
});

describe('shared.notification-read — one message, and only if it is yours', () => {
  it('invokes shared.notification-read and returns the caller own message', async () => {
    const mine = randomUUID();
    await seedMessage({
      id: mine,
      tenantId: TENANT_A,
      recipientUserId: CALLER,
      dedupeKey: `p123-${mine}`,
    });

    const view = await withTransaction(
      contextFor({ tenantId: TENANT_A, userId: CALLER, operation: 'shared.notification-read' }),
      (db) => sharedServicesModule().notificationReads.readMine(db, mine)
    );

    expect(view.notificationId).toBe(mine);
    expect(view.status).toBe('pending');
    expect(view.channel).toBe('in_app');
  });

  it('refuses a message addressed to another user in the same tenant, indistinguishably from absent', async () => {
    const neighbours = randomUUID();
    await seedMessage({
      id: neighbours,
      tenantId: TENANT_A,
      recipientUserId: NEIGHBOUR,
      dedupeKey: `p123-${neighbours}`,
    });

    const denied = await withTransaction(
      contextFor({ tenantId: TENANT_A, userId: CALLER, operation: 'shared.notification-read' }),
      (db) =>
        sharedServicesModule()
          .notificationReads.readMine(db, neighbours)
          .then(() => null)
          .catch((error: unknown) => error)
    );

    expect(denied).toBeInstanceOf(AppFailure);
    expect((denied as AppFailure).code).toBe('ERR-RES-001');

    // Same failure for an id that does not exist at all: the endpoint must not
    // let a caller distinguish "not yours" from "not real".
    const absent = await withTransaction(
      contextFor({ tenantId: TENANT_A, userId: CALLER, operation: 'shared.notification-read' }),
      (db) =>
        sharedServicesModule()
          .notificationReads.readMine(db, randomUUID())
          .then(() => null)
          .catch((error: unknown) => error)
    );
    expect((absent as AppFailure).code).toBe('ERR-RES-001');
  });

  it('carries no identifier in the failure details', async () => {
    // `SafeDetails` is a closed shape, and the failure deliberately sets none:
    // an error body is exactly where identifiers drift into logs.
    const denied = (await withTransaction(
      contextFor({ tenantId: TENANT_A, userId: CALLER, operation: 'shared.notification-read' }),
      (db) =>
        sharedServicesModule()
          .notificationReads.readMine(db, randomUUID())
          .then(() => null)
          .catch((error: unknown) => error)
    )) as AppFailure;

    expect(JSON.stringify(denied.safeDetails ?? {})).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it('refuses a message belonging to another tenant', async () => {
    const foreign = randomUUID();
    await seedMessage({
      id: foreign,
      tenantId: TENANT_B,
      recipientUserId: USER_TENANT_B,
      dedupeKey: `p123-${foreign}`,
    });

    const denied = (await withTransaction(
      contextFor({ tenantId: TENANT_A, userId: CALLER, operation: 'shared.notification-read' }),
      (db) =>
        sharedServicesModule()
          .notificationReads.readMine(db, foreign)
          .then(() => null)
          .catch((error: unknown) => error)
    )) as AppFailure;

    expect(denied.code).toBe('ERR-RES-001');
  });
});

describe('shared.notification-delivery-list — privileged inspection, and audited', () => {
  it('returns only the addressed message attempts when another message also has some', async () => {
    // TWO messages, each with attempts. Without the second, dropping the
    // `message_id` predicate returns the same rows and nothing notices — which is
    // exactly what the mutation matrix found: the confinement SURVIVED every
    // assertion in this suite until this case existed.
    const target = randomUUID();
    const other = randomUUID();
    for (const id of [target, other]) {
      await seedMessage({
        id,
        tenantId: TENANT_A,
        recipientUserId: NEIGHBOUR,
        dedupeKey: `p123-${id}`,
      });
    }
    await admin.query(
      // `ck_delivery_attempts_completion` requires `completed_at` on a terminal
      // status, and `ck_delivery_attempts_error_summary` requires a summary on
      // `errored`. Every row here is `accepted`: the confinement is proven by
      // WHICH rows come back, not by their statuses.
      `INSERT INTO shared.delivery_attempts
         (tenant_id, message_id, attempt_number, provider_code, status,
          completed_at, created_by)
       VALUES ($1, $2, 1, 'local_test', 'accepted', now(), $4),
              ($1, $3, 1, 'local_test', 'accepted', now(), $4),
              ($1, $3, 2, 'local_test', 'accepted', now(), $4)`,
      [TENANT_A, target, other, USER_A]
    );

    const result = await withTransaction(
      contextFor({
        tenantId: TENANT_A,
        userId: CALLER,
        operation: 'shared.notification-delivery-list',
      }),
      (db) => sharedServicesModule().notificationReads.readDeliveries(db, target)
    );

    // One attempt belongs to `target`; three exist in the tenant.
    expect(result.attempts).toHaveLength(1);
    // And every returned attempt must belong to the message that was asked for.
    // An operator inspecting one delivery must not be shown another's history.
    expect(result.attempts[0]?.attemptNumber).toBe(1);
    expect(result.notification.notificationId).toBe(target);
  });

  it('invokes shared.notification-delivery-list and reports attempts as stored', async () => {
    const message = randomUUID();
    await seedMessage({
      id: message,
      tenantId: TENANT_A,
      // Addressed to the NEIGHBOUR: an operator must be able to inspect delivery
      // of a message they did not receive, which is the whole point of the
      // wider permission.
      recipientUserId: NEIGHBOUR,
      dedupeKey: `p123-${message}`,
    });
    await admin.query(
      `INSERT INTO shared.delivery_attempts
         (tenant_id, message_id, attempt_number, provider_code, status,
          response_code, error_summary, details, completed_at, created_by)
       VALUES ($1, $2, 1, 'local_test', 'errored', '500', 'provider refused',
               '{"raw":"must-not-leak"}'::jsonb, now(), $3),
              ($1, $2, 2, 'local_test', 'accepted', '202', NULL,
               '{}'::jsonb, now(), $3)`,
      [TENANT_A, message, USER_A]
    );

    const result = await withTransaction(
      contextFor({
        tenantId: TENANT_A,
        userId: CALLER,
        operation: 'shared.notification-delivery-list',
      }),
      (db) => sharedServicesModule().notificationReads.readDeliveries(db, message)
    );

    expect(result.notification.notificationId).toBe(message);
    expect(result.attempts).toHaveLength(2);
    // Oldest attempt first — the story an operator reads.
    expect(result.attempts[0]?.attemptNumber).toBe(1);
    expect(result.attempts[1]?.attemptNumber).toBe(2);

    // `accepted` is NOT reported as `delivered`. The contract distinguishes
    // "the provider took it" from "the provider evidenced arrival", and
    // collapsing them would contradict ck_delivery_attempts_status.
    expect(result.attempts[1]?.status).toBe('accepted');
    expect(result.attempts.map((a) => a.status)).not.toContain('delivered');
    expect(result.notification.deliveredAt).toBeNull();
  });

  it('never projects the raw provider payload', async () => {
    const message = randomUUID();
    await seedMessage({
      id: message,
      tenantId: TENANT_A,
      recipientUserId: CALLER,
      dedupeKey: `p123-${message}`,
    });
    await admin.query(
      `INSERT INTO shared.delivery_attempts
         (tenant_id, message_id, attempt_number, provider_code, status,
          error_summary, details, completed_at, created_by)
       VALUES ($1, $2, 1, 'local_test', 'errored', 'refused',
               '{"raw":"must-not-leak","token":"secret-value"}'::jsonb, now(), $3)`,
      [TENANT_A, message, USER_A]
    );

    const result = await withTransaction(
      contextFor({
        tenantId: TENANT_A,
        userId: CALLER,
        operation: 'shared.notification-delivery-list',
      }),
      (db) => sharedServicesModule().notificationReads.readDeliveries(db, message)
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('must-not-leak');
    expect(serialized).not.toContain('secret-value');
    expect(serialized).not.toContain('details');
    // The normalized classification IS reported — redaction must not become
    // silence, or an operator cannot diagnose anything.
    expect(serialized).toContain('refused');
  });

  it('refuses a message belonging to another tenant', async () => {
    const foreign = randomUUID();
    await seedMessage({
      id: foreign,
      tenantId: TENANT_B,
      recipientUserId: USER_TENANT_B,
      dedupeKey: `p123-${foreign}`,
    });

    const denied = (await withTransaction(
      contextFor({
        tenantId: TENANT_A,
        userId: CALLER,
        operation: 'shared.notification-delivery-list',
      }),
      (db) =>
        sharedServicesModule()
          .notificationReads.readDeliveries(db, foreign)
          .then(() => null)
          .catch((error: unknown) => error)
    )) as AppFailure;

    expect(denied.code).toBe('ERR-RES-001');
  });

  it('records an audit entry for the privileged inspection', async () => {
    const message = randomUUID();
    await seedMessage({
      id: message,
      tenantId: TENANT_A,
      recipientUserId: NEIGHBOUR,
      dedupeKey: `p123-${message}`,
    });

    const before = await countRows(
      admin,
      'iam.audit_records',
      "tenant_id = $1 AND action = 'shared.notification.delivery_inspected'",
      [TENANT_A]
    );

    await withTransaction(
      contextFor({
        tenantId: TENANT_A,
        userId: CALLER,
        operation: 'shared.notification-delivery-list',
      }),
      (db) => sharedServicesModule().notificationReads.readDeliveries(db, message)
    );

    const after = await countRows(
      admin,
      'iam.audit_records',
      "tenant_id = $1 AND action = 'shared.notification.delivery_inspected'",
      [TENANT_A]
    );

    // A DELTA, not an absolute: an absolute count passes vacuously the moment
    // any other test in the file writes the same action.
    expect(after - before).toBe(1);
  });
});

/**
 * Authorization, proven against the deployed catalog rather than against a mock.
 *
 * The three operations are checked by `handleOperation` from their
 * `defineOperation({ permissions })` declaration, so the proof that matters is
 * that the permission the route names is genuinely refused for a principal who
 * lacks it — and, for the delivery view, that it is a DIFFERENT permission from
 * the inbox.
 *
 * A single permission covering both would be the quiet failure: every test here
 * would still pass while an ordinary user could read the delivery history of
 * every message in the tenant.
 */
describe('P1-23 notification reads — authorization', () => {
  it('refuses each operation for a principal holding none of its permissions', async () => {
    const { NOTIFICATION_LIST_OPERATION } = await import('@/app/api/v1/notifications/route');
    const { NOTIFICATION_READ_OPERATION } =
      await import('@/app/api/v1/notifications/[notificationId]/route');
    const { NOTIFICATION_DELIVERY_LIST_OPERATION } =
      await import('@/app/api/v1/notifications/[notificationId]/deliveries/route');

    // The registered operation is passed, not a hand-written permission string:
    // that is what makes this a proof about the DEPLOYED declaration rather than
    // about a literal a future edit could drift away from.
    for (const operation of [
      NOTIFICATION_LIST_OPERATION,
      NOTIFICATION_READ_OPERATION,
      NOTIFICATION_DELIVERY_LIST_OPERATION,
    ]) {
      const denied = await withTransaction(
        contextFor({ tenantId: TENANT_A, userId: USER_UNPERMITTED, operation: operation.id }),
        (db) =>
          requirePermissions(db, operation)
            .then(() => null)
            .catch((error: unknown) => error)
      );
      expect(denied, `${operation.id} must refuse an unpermitted principal`).toBeInstanceOf(
        AppFailure
      );
    }
  });

  it('guards delivery inspection with a DIFFERENT permission from the inbox', async () => {
    // A principal holding only the inbox permission must not reach the delivery
    // view. If the two ever collapse to one code this is the assertion that
    // fails, and it fails before any data leaks.
    const { NOTIFICATION_LIST_OPERATION } = await import('@/app/api/v1/notifications/route');
    const { NOTIFICATION_DELIVERY_LIST_OPERATION } =
      await import('@/app/api/v1/notifications/[notificationId]/deliveries/route');
    expect(NOTIFICATION_LIST_OPERATION.permissions).toEqual(['shared.notification.read']);
    expect(NOTIFICATION_DELIVERY_LIST_OPERATION.permissions).toEqual([
      'shared.notification.delivery.read',
    ]);
    expect(NOTIFICATION_DELIVERY_LIST_OPERATION.permissions).not.toEqual(
      NOTIFICATION_LIST_OPERATION.permissions
    );
    // And the wider one is audited while the inbox is not.
    expect(NOTIFICATION_DELIVERY_LIST_OPERATION.auditClass).toBe('security');
    expect(NOTIFICATION_LIST_OPERATION.auditClass).toBe('none');
  });
});
