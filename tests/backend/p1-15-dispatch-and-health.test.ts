/**
 * P1-15 worker dispatch and the health probes — operation-depth evidence.
 *
 * Two things are proved here that no other suite can prove, and they are
 * deliberately in one file because they share the same harness: a live database,
 * the *deployed* login roles, and the real composition root.
 *
 * ## 1. The health probes, driven through the real route handlers
 *
 * `tests/foundation/p1-15-health.test.ts` pins the projection contract at
 * compile time and mirrors the mapping with no database. That is the right depth
 * for a disclosure contract, and it is explicitly not evidence that the wired
 * endpoint behaves. So this file calls the exported `GET` of each route — the
 * whole `handleOperation` pipeline, the public path, the real
 * `HealthService` — and asserts the bytes a load balancer would actually
 * receive, with `foundationReadiness()` probing the live PostgreSQL through the
 * deployed `app_runtime` identity.
 *
 * The readiness assertions are about **disclosure**, not availability:
 * `foundationReadiness()` computes the connection's database role name, and this
 * file requires that neither `app_runtime` nor `postgres` — nor any host, port,
 * or driver message — appears anywhere in the JSON body. The unreachable-database
 * case is exercised too, because a failure path is where a driver string
 * normally escapes.
 *
 * ## 2. The worker dispatch path, end to end, on the worker role
 *
 * Dispatch runs on `app_worker`, and it must: the schema grants
 * `shared.delivery_attempts` INSERT and the `outbound_messages` status UPDATE to
 * that archetype and to no other, so a request-path role cannot claim a message
 * was sent. This suite therefore never touches the dispatcher from the runtime
 * pool.
 *
 * **How the worker connection is obtained, stated plainly:** this file uses
 * `withWorkerTransaction()` from `src/server/worker/worker-db.ts` — the real
 * composition path — because `tests/backend/helpers.ts` already points
 * `WORKER_DATABASE_URL` at `rootlco_test_worker`, a login whose only membership
 * is `app_worker`. Nothing is hand-assembled: the pool, the role, the absence of
 * any `app.tenant_id` context, and the transaction boundary are the ones the
 * deployed worker uses. A message is enqueued through the *runtime* identity via
 * the notification service and then only ever advanced through the worker one,
 * which is the enqueue/dispatch split the design rests on.
 *
 * `LocalMessageProvider` is deterministic and reaches no network, so the accept,
 * timeout, outage, rejection, and dead-letter paths are executed by real code
 * rather than described. Its `callCount` is what turns "the digest check happens
 * before the provider call" from a claim about ordering into a checked fact.
 *
 * `OUTBOX_MAX_ATTEMPTS` is lowered to 2 for this file so the retry budget can be
 * exhausted in a test rather than in eight round trips; the ceiling is read back
 * from `backendConfig()` and asserted, so the budget proof is tied to the
 * configured value and not to a hard-coded 2.
 *
 * GAP (stated rather than papered over): `MessageDispatcher.retry()` has its own
 * budget branch that dead-letters a `failed` message when `retry_count + 1`
 * reaches the ceiling. That branch is a defensive backstop and is **unreachable
 * through the dispatch loop**, because `dispatchOne()` evaluates the identical
 * condition first and dead-letters there. What this file proves instead is the
 * property that matters: the loop terminates in a dead letter after exactly
 * `OUTBOX_MAX_ATTEMPTS` attempts, and a dead-lettered message can no longer be
 * retried. The unreachable branch is not asserted, because reaching it would
 * require forging `retry_count`, which the lifecycle guard forbids to every role.
 *
 * The `postgres` admin connection appears only to provision fixtures and to read
 * back what landed. It carries BYPASSRLS, so nothing it does is evidence.
 *
 * COVERAGE-EVIDENCE (P1-15 dispatch and health):
 *   shared.health-live: success
 *   shared.health-ready: success
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import {
  TENANT_A,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  contextFor,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { __resetBackendConfigForTests, backendConfig } from '@/server/config/backend-config';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { withTransaction } from '@/server/db/transaction';
import { SYSTEM_ACTOR_ID, closeWorkerPool, withWorkerTransaction } from '@/server/worker/worker-db';
import {
  LocalMessageProvider,
  UnconfiguredMessageProvider,
  canonicalRenderedForm,
  setMessageProvider,
  sharedServicesModule,
  __resetMessageProviderForTests,
  type RenderedMessage,
} from '@/modules/shared-services';
import type { MessageDispatcher } from '@/modules/shared-services/application/message-dispatcher';
import type { SharedNotificationService } from '@/modules/shared-services/application/notification-service';
import { HEALTH_LIVE_OPERATION, GET as healthLiveRoute } from '@/app/api/v1/health/live/route';
import { HEALTH_READY_OPERATION, GET as healthReadyRoute } from '@/app/api/v1/health/ready/route';

// ---------------------------------------------------------------------------
// Deterministic fixtures. A distinct id space from every other backend suite so
// a concurrent fixture can never collide with one of these. All of it is
// ephemeral scaffolding removed by cleanBackendFixtures(); no business data.
// ---------------------------------------------------------------------------

/** Tenant A principal holding `shared.notification.send`. */
const U_SENDER = 'a8000000-0000-4000-8000-000000000001';
const ROLE_SENDER = 'a8100000-0000-4000-8000-000000000001';
const TEMPLATE_A = 'a8600000-0000-4000-8000-000000000001';
const TPLVER_A = 'a8700000-0000-4000-8000-000000000001';

const NOTIFY_PERMISSION = 'shared.notification.send';

const LIVE_URL = 'http://localhost/api/v1/health/live';
const READY_URL = 'http://localhost/api/v1/health/ready';

/**
 * Retry ceiling for this file.
 *
 * Two is the smallest value that still exercises a *retry* before the dead
 * letter: attempt one fails, `retry()` requeues, attempt two exhausts the budget.
 */
const MAX_ATTEMPTS = '2';
const ORIGINAL_MAX_ATTEMPTS = process.env.OUTBOX_MAX_ATTEMPTS;

/**
 * Strings that must never appear in a health response body.
 *
 * The role name and the driver's own words are the two disclosures the
 * projection exists to prevent; the host, port, and database name are what an
 * attacker would use them for.
 */
const FORBIDDEN_IN_HEALTH_BODY = [
  'app_runtime',
  'app_worker',
  'postgres',
  'rootlco_test_runtime',
  'rootlco_test_worker',
  'detail',
  '127.0.0.1',
  '54322',
  'password',
  'ECONNREFUSED',
  'permission denied',
  'pg_roles',
  'has_table_privilege',
];

interface LivenessBody {
  readonly status?: string;
  readonly uptimeSeconds?: number;
}

interface ReadinessBody {
  readonly status?: string;
  readonly checks?: readonly Record<string, unknown>[];
}

interface AttemptRow {
  readonly attempt_number: number;
  readonly status: string;
  readonly provider_code: string;
  readonly provider_message_ref: string | null;
  readonly response_code: string | null;
  readonly error_summary: string | null;
  readonly created_by: string;
}

interface MessageRow {
  readonly status: string;
  readonly failure_class: string | null;
  readonly retry_count: number;
  readonly queued_at: Date | null;
  readonly delivered_at: Date | null;
  readonly body_sha256: Buffer;
}

let admin: Pool;
let runtime: Pool;
let notifications: SharedNotificationService;
let dispatcher: MessageDispatcher;

const asSender = () =>
  contextFor({ userId: U_SENDER, operation: 'shared.p1-15-dispatch', module: 'shared-services' });

// ---------------------------------------------------------------------------
// Readers. `admin` is used here and only here — reading back what landed is not
// a capability claim, and a privilege-poor reader would make "absent" and
// "invisible" indistinguishable.
// ---------------------------------------------------------------------------

async function messageRow(messageId: string): Promise<MessageRow | undefined> {
  const result = await admin.query<MessageRow>(
    `SELECT status, failure_class, retry_count, queued_at, delivered_at, body_sha256
       FROM shared.outbound_messages WHERE id = $1`,
    [messageId]
  );
  return result.rows[0];
}

async function attemptRows(messageId: string): Promise<readonly AttemptRow[]> {
  const result = await admin.query<AttemptRow>(
    `SELECT attempt_number, status, provider_code, provider_message_ref, response_code,
            error_summary, created_by
       FROM shared.delivery_attempts
      WHERE message_id = $1
      ORDER BY attempt_number`,
    [messageId]
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Message fixtures. Enqueue runs on the RUNTIME identity through the real
// notification service; every subsequent step runs on the WORKER identity.
// ---------------------------------------------------------------------------

interface QueuedFixture {
  readonly messageId: string;
  readonly rendered: RenderedMessage;
  readonly recipientRef: string;
}

async function enqueueMessage(): Promise<QueuedFixture> {
  const recipientRef = randomUUID();
  const result = await withTransaction(asSender(), (db) =>
    notifications.queueMessageWithRendering(db, {
      channel: 'email',
      templateVersionId: TPLVER_A,
      locale: 'en',
      dedupeKey: `fx-p15-dsp-${randomUUID()}`,
      recipientRef,
      variables: { name: 'fx Recipient' },
      consentEvaluation: {
        granted: true,
        consentRecordId: 'fx-p15-dsp-consent',
        evaluatedAt: new Date(),
      },
      companyId: null,
      branchId: null,
    })
  );
  return { messageId: result.queued.messageId, rendered: result.rendered, recipientRef };
}

/** Promotes every pending message on the worker connection. */
const promotePending = (limit = 50): Promise<number> =>
  withWorkerTransaction((db) => dispatcher.promotePending(db, limit));

/** Enqueues one message and leaves it `queued`, ready to dispatch. */
async function queuedMessage(): Promise<QueuedFixture> {
  const message = await enqueueMessage();
  await promotePending();
  return message;
}

/** One dispatch attempt on the worker connection. */
const dispatchOnce = (message: QueuedFixture, rendered?: RenderedMessage) =>
  withWorkerTransaction((db) =>
    dispatcher.dispatchOne(db, {
      tenantId: TENANT_A,
      messageId: message.messageId,
      rendered: rendered ?? message.rendered,
      recipientRef: message.recipientRef,
    })
  );

const retryOnce = (messageId: string) =>
  withWorkerTransaction((db) => dispatcher.retry(db, TENANT_A, messageId));

// ---------------------------------------------------------------------------

async function seedSuiteFixtures(): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, 'test_harness', 'fx_p15_dsp_sender', 'fx-p15-dsp-sender@example.test',
             'P1-15 Dispatch Fixture', 'active', $3)
     ON CONFLICT (id) DO NOTHING`,
    [U_SENDER, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, 'fx_p15_dsp_sender', 'P1-15 dispatch sender', $3)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_SENDER, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, id, 'allow', $3 FROM iam.permissions WHERE permission_code = $4
     ON CONFLICT DO NOTHING`,
    [TENANT_A, ROLE_SENDER, USER_A, NOTIFY_PERMISSION]
  );
  await admin.query(
    `INSERT INTO iam.role_grants
       (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
     SELECT $1, $2, $3, 'unrestricted', 'active', $4, $4
      WHERE NOT EXISTS (
        SELECT 1 FROM iam.role_grants WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3)`,
    [TENANT_A, U_SENDER, ROLE_SENDER, USER_A]
  );

  await admin.query(
    `INSERT INTO shared.message_templates
       (id, scope, tenant_id, template_code, name, channel, purpose, locale_code, status, created_by)
     VALUES ($1, 'tenant', $2, 'fx_p15_dsp_tpl', 'P1-15 dispatch fixture template', 'email',
             'transactional', 'en', 'active', $3)
     ON CONFLICT (id) DO NOTHING`,
    [TEMPLATE_A, TENANT_A, USER_A]
  );
  // A version is born a draft and is then approved: `guard_template_version_lifecycle`
  // refuses a version born approved, and the fixture obeys the same rule every
  // legitimate writer does.
  await admin.query(
    `INSERT INTO shared.template_versions
       (id, tenant_id, template_id, version_number, subject, body, content_hash, created_by)
     VALUES ($1, $2, $3, 1, 'P1-15 dispatch fixture subject',
             'Hello {{name}}, your vehicle is ready for collection.',
             decode(repeat('dd', 32), 'hex'), $4)
     ON CONFLICT (id) DO NOTHING`,
    [TPLVER_A, TENANT_A, TEMPLATE_A, USER_A]
  );
  await admin.query(
    `UPDATE shared.template_versions SET status = 'approved', approved_by = $2
      WHERE id = $1 AND status = 'draft'`,
    [TPLVER_A, U_SENDER]
  );
}

beforeAll(async () => {
  process.env.OUTBOX_MAX_ATTEMPTS = MAX_ATTEMPTS;
  __resetBackendConfigForTests();

  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await seedSuiteFixtures();

  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);

  const module_ = sharedServicesModule();
  notifications = module_.notifications;
  dispatcher = module_.dispatcher;
});

afterEach(() => {
  // Back to the honest default between tests: an adapter that refuses to deliver
  // rather than one left over from a neighbouring assertion.
  __resetMessageProviderForTests();
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  __resetMessageProviderForTests();
  await closeWorkerPool();
  await runtime.end();
  await cleanBackendFixtures(admin);
  await admin.end();

  if (ORIGINAL_MAX_ATTEMPTS === undefined) delete process.env.OUTBOX_MAX_ATTEMPTS;
  else process.env.OUTBOX_MAX_ATTEMPTS = ORIGINAL_MAX_ATTEMPTS;
  __resetBackendConfigForTests();
});

// ===========================================================================
// shared.health-live
// ===========================================================================
describe('shared.health-live', () => {
  it('answers 200 with exactly { status, uptimeSeconds } through the wired route', async () => {
    const response = await healthLiveRoute(new Request(LIVE_URL));
    const body = (await response.json()) as LivenessBody;

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    // The exact key set, not a subset: a later "just add the version, it is
    // harmless" is a failing test rather than a review comment someone misses.
    expect(Object.keys(body).sort()).toEqual(['status', 'uptimeSeconds']);
    expect(body.status).toBe('alive');
    expect(Number.isInteger(body.uptimeSeconds)).toBe(true);
    expect(body.uptimeSeconds ?? -1).toBeGreaterThanOrEqual(0);
    // Seconds since process start — a duration, never a wall-clock instant that
    // would date the deployment.
    expect(body.uptimeSeconds ?? -1).toBeLessThanOrEqual(Math.ceil(process.uptime()));
    expect(response.headers.get('x-correlation-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('is registered as a public operation that audits nothing', async () => {
    expect(HEALTH_LIVE_OPERATION.id).toBe('shared.health-live');
    expect(HEALTH_LIVE_OPERATION.public).toBe(true);
    expect(HEALTH_LIVE_OPERATION.auditClass).toBe('none');
    // A public declaration without a stated reason is how an endpoint quietly
    // loses its authentication.
    expect((HEALTH_LIVE_OPERATION.publicReason ?? '').length).toBeGreaterThan(20);
    expect(HEALTH_LIVE_OPERATION.permissions).toEqual([]);
  });

  it('answers with no database reachable through configuration at all', async () => {
    // A liveness probe that queries the database restarts a healthy process every
    // time the database hiccups. Proving that here means removing the connection
    // entirely: with no injected pool AND no DATABASE_URL, any database access
    // raises DatabaseNotConfiguredError, which would surface as a 500 problem
    // document instead of the 200 asserted below.
    const originalDsn = process.env.DATABASE_URL;
    __setPrimaryPoolForTests(undefined);
    delete process.env.DATABASE_URL;
    __resetBackendConfigForTests();

    try {
      const response = await healthLiveRoute(new Request(LIVE_URL));
      const body = (await response.json()) as LivenessBody;

      expect(response.status).toBe(200);
      expect(body.status).toBe('alive');
    } finally {
      if (originalDsn !== undefined) process.env.DATABASE_URL = originalDsn;
      __resetBackendConfigForTests();
      __setPrimaryPoolForTests(runtime);
    }
  });

  it('discloses no hostname and no database role or name in the body', async () => {
    const response = await healthLiveRoute(new Request(LIVE_URL));
    const text = await response.text();

    expect(text).not.toContain(hostname());
    for (const forbidden of FORBIDDEN_IN_HEALTH_BODY) {
      expect(text).not.toContain(forbidden);
    }
  });
});

// ===========================================================================
// shared.health-ready
// ===========================================================================
describe('shared.health-ready', () => {
  it('probes the live database and answers 200 with a verdict of ready or degraded', async () => {
    const response = await healthReadyRoute(new Request(READY_URL));
    const body = (await response.json()) as ReadinessBody;

    expect(response.status).toBe(200);
    // `unavailable` would be 503. The database is up and the connection role is
    // the deployed `app_runtime` member, so the verdict is one of the two states
    // that keep an instance in rotation.
    expect(['ready', 'degraded']).toContain(body.status);
    expect(Object.keys(body).sort()).toEqual(['checks', 'status']);

    const checks = body.checks ?? [];
    expect(checks.length).toBeGreaterThan(0);
    // The probe really reached PostgreSQL: this check is only pushed after the
    // read-only transaction and the privilege queries have succeeded.
    const reachable = checks.find((check) => check['name'] === 'database.reachable');
    expect(reachable?.['ok']).toBe(true);
    const noBypass = checks.find((check) => check['name'] === 'database.role.no-bypassrls');
    expect(noBypass?.['ok']).toBe(true);
  });

  it('returns checks carrying only { name, ok } — never the role name behind them', async () => {
    const response = await healthReadyRoute(new Request(READY_URL));
    const body = (await response.json()) as ReadinessBody;

    for (const check of body.checks ?? []) {
      expect(Object.keys(check).sort()).toEqual(['name', 'ok']);
      expect(typeof check['name']).toBe('string');
      expect(typeof check['ok']).toBe('boolean');
    }
  });

  it('leaks no database role name, host, or driver message into the JSON body', async () => {
    // `foundationReadiness()` puts the connection's role name in
    // `checks[].detail`. The projection drops it, so the two role names the
    // platform actually uses must be absent from the body a load balancer reads.
    const response = await healthReadyRoute(new Request(READY_URL));
    const text = await response.text();

    for (const forbidden of FORBIDDEN_IN_HEALTH_BODY) {
      expect(text).not.toContain(forbidden);
    }
    expect(text).not.toContain(hostname());
  });

  it('is registered as a public, never-cached operation that audits nothing', async () => {
    expect(HEALTH_READY_OPERATION.id).toBe('shared.health-ready');
    expect(HEALTH_READY_OPERATION.public).toBe(true);
    expect(HEALTH_READY_OPERATION.auditClass).toBe('none');
    expect(HEALTH_READY_OPERATION.cacheCategory).toBe('never');
    expect((HEALTH_READY_OPERATION.publicReason ?? '').length).toBeGreaterThan(20);
    expect(HEALTH_READY_OPERATION.permissions).toEqual([]);
  });

  it('answers 503 with no driver message when the database does not answer', async () => {
    // The failure path is where a driver string normally escapes: pg would say
    // "connect ECONNREFUSED 127.0.0.1:1" and a naive handler would forward it.
    const deadPool = new Pool({
      host: '127.0.0.1',
      port: 1,
      database: 'postgres',
      user: 'nobody',
      password: 'nobody',
      connectionTimeoutMillis: 1_000,
      max: 1,
    });
    // An idle-client error without a listener would kill the process.
    deadPool.on('error', () => {});
    __setPrimaryPoolForTests(deadPool);

    try {
      const response = await healthReadyRoute(new Request(READY_URL));
      const text = await response.text();
      const body = JSON.parse(text) as ReadinessBody;

      expect(response.status).toBe(503);
      expect(body.status).toBe('unavailable');
      expect(Object.keys(body).sort()).toEqual(['checks', 'status']);
      for (const check of body.checks ?? []) {
        expect(Object.keys(check).sort()).toEqual(['name', 'ok']);
      }
      for (const forbidden of FORBIDDEN_IN_HEALTH_BODY) {
        expect(text).not.toContain(forbidden);
      }
    } finally {
      __setPrimaryPoolForTests(runtime);
      await deadPool.end();
    }
  });
});

// ===========================================================================
// Worker dispatch — promotion
// ===========================================================================
describe('worker dispatch / promotion', () => {
  it('promotes a message enqueued by the runtime from pending to queued', async () => {
    const message = await enqueueMessage();

    const before = await messageRow(message.messageId);
    expect(before?.status).toBe('pending');
    expect(before?.queued_at).toBeNull();

    const promoted = await promotePending();
    expect(promoted).toBeGreaterThanOrEqual(1);

    const after = await messageRow(message.messageId);
    expect(after?.status).toBe('queued');
    // The timestamp is server-stamped by the lifecycle guard, never written by
    // the repository — its presence is the proof the guarded edge was taken.
    expect(after?.queued_at).not.toBeNull();
    expect(after?.retry_count).toBe(0);
  });
});

// ===========================================================================
// Worker dispatch — delivery
// ===========================================================================
describe('worker dispatch / delivery', () => {
  it('delivers a queued message with the accepting provider and records one attempt', async () => {
    const provider = new LocalMessageProvider({ behaviour: 'accept' });
    setMessageProvider(provider);
    const message = await queuedMessage();

    const result = await dispatchOnce(message);

    expect(result).toEqual({ outcome: 'delivered', attemptNumber: 1 });
    expect(provider.callCount).toBe(1);

    const row = await messageRow(message.messageId);
    expect(row?.status).toBe('delivered');
    expect(row?.delivered_at).not.toBeNull();
    expect(row?.failure_class).toBeNull();

    const attempts = await attemptRows(message.messageId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe('delivered');
    expect(attempts[0]?.attempt_number).toBe(1);
    expect(attempts[0]?.provider_code).toBe('local_fake');
    // The local adapter derives its reference from the message id, so the value
    // recorded on the attempt is checkable rather than merely non-null.
    expect(attempts[0]?.provider_message_ref).toBe(`local-${message.messageId}`);
    expect(attempts[0]?.response_code).toBe('202');
    expect(attempts[0]?.error_summary).toBeNull();
    // The repository re-declares the system actor rather than importing it. The
    // two spellings must agree, or worker-written rows would be attributed to an
    // actor the platform does not otherwise know.
    expect(attempts[0]?.created_by).toBe(SYSTEM_ACTOR_ID);
  });
});

// ===========================================================================
// Worker dispatch — integrity
// ===========================================================================
describe('worker dispatch / content integrity', () => {
  it('refuses to contact the provider when the rendered body does not match body_sha256', async () => {
    const provider = new LocalMessageProvider({ behaviour: 'accept' });
    setMessageProvider(provider);
    const message = await queuedMessage();

    const tampered: RenderedMessage = {
      ...message.rendered,
      body: `${message.rendered.body} <!-- injected after enqueue -->`,
    };
    // The premise, checked rather than assumed: the tampered content really does
    // hash to something other than what the row stores.
    const stored = (await messageRow(message.messageId))?.body_sha256;
    const tamperedDigest = createHash('sha256')
      .update(canonicalRenderedForm(tampered), 'utf8')
      .digest();
    expect(stored?.equals(tamperedDigest)).toBe(false);

    const before = provider.callCount;
    const result = await dispatchOnce(message, tampered);

    expect(result).toEqual({ outcome: 'failed', attemptNumber: 1, retryable: false });
    // The load-bearing assertion: content that was tampered with between enqueue
    // and dispatch never reaches a provider at all.
    expect(provider.callCount).toBe(before);

    const row = await messageRow(message.messageId);
    expect(row?.status).toBe('cancelled');
    expect(row?.failure_class).toBe('integrity');

    const attempts = await attemptRows(message.messageId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe('errored');
    expect(attempts[0]?.error_summary).toBe('content_digest_mismatch');
    expect(attempts[0]?.provider_message_ref).toBeNull();
  });
});

// ===========================================================================
// Worker dispatch — failure classification
// ===========================================================================
describe('worker dispatch / failure classification', () => {
  it('records a timeout as an errored attempt with a sanitised summary and leaves it failed', async () => {
    const provider = new LocalMessageProvider({ behaviour: 'timeout' });
    setMessageProvider(provider);
    const message = await queuedMessage();

    const result = await dispatchOnce(message);

    expect(result).toEqual({ outcome: 'failed', attemptNumber: 1, retryable: true });
    expect(provider.callCount).toBe(1);

    const row = await messageRow(message.messageId);
    expect(row?.status).toBe('failed');
    expect(row?.failure_class).toBe('timeout');

    const attempts = await attemptRows(message.messageId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe('errored');
    // The stable short code, not the adapter's own sentence. A provider message
    // routinely echoes the destination back, which is exactly what must not be
    // written to an append-only evidence table.
    expect(attempts[0]?.error_summary).toBe('provider_timeout');
    expect(attempts[0]?.error_summary).not.toContain('local_fake');
    expect(attempts[0]?.error_summary).not.toContain(' ');
  });

  it('treats an outage as retryable: retry moves failed to queued and increments retry_count', async () => {
    const provider = new LocalMessageProvider({ behaviour: 'outage' });
    setMessageProvider(provider);
    const message = await queuedMessage();

    await dispatchOnce(message);
    const failed = await messageRow(message.messageId);
    expect(failed?.status).toBe('failed');
    expect(failed?.failure_class).toBe('outage');
    const retryCountBefore = failed?.retry_count ?? -1;

    const moved = await retryOnce(message.messageId);
    expect(moved).toBe(true);

    const requeued = await messageRow(message.messageId);
    expect(requeued?.status).toBe('queued');
    // `retry_count` is assigned by the lifecycle guard on failed→queued, not by
    // the repository, so the increment is the database's statement about how many
    // times this message has been re-queued.
    expect(requeued?.retry_count).toBe(retryCountBefore + 1);
    expect(requeued?.failure_class).toBeNull();
  });

  it('dead-letters a rejection immediately, because a retry cannot succeed', async () => {
    const provider = new LocalMessageProvider({ behaviour: 'reject' });
    setMessageProvider(provider);
    const message = await queuedMessage();

    const result = await dispatchOnce(message);

    expect(result).toEqual({ outcome: 'dead-lettered', attemptNumber: 1 });

    const row = await messageRow(message.messageId);
    // `cancelled` is the schema's terminal failure state and is the only state
    // where the CHECK permits a failure_class to survive.
    expect(row?.status).toBe('cancelled');
    expect(row?.failure_class).toBe('rejected');
    expect(row?.retry_count).toBe(0);

    const attempts = await attemptRows(message.messageId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe('errored');
    expect(attempts[0]?.error_summary).toBe('provider_rejected_message');

    // Nothing was deleted: the dead letter stays queryable with its history, and
    // it cannot be revived by asking again.
    expect(await retryOnce(message.messageId)).toBe(false);
    expect((await messageRow(message.messageId))?.status).toBe('cancelled');
  });
});

// ===========================================================================
// Worker dispatch — the retry budget
// ===========================================================================
describe('worker dispatch / the retry budget is bounded', () => {
  it('dead-letters after OUTBOX_MAX_ATTEMPTS instead of retrying forever', async () => {
    const ceiling = backendConfig().OUTBOX_MAX_ATTEMPTS;
    // Tied to the configured value, so this proof cannot silently become a proof
    // about the number two.
    expect(ceiling).toBe(Number(MAX_ATTEMPTS));

    const provider = new LocalMessageProvider({ behaviour: 'outage' });
    setMessageProvider(provider);
    const message = await queuedMessage();

    const first = await dispatchOnce(message);
    expect(first).toEqual({ outcome: 'failed', attemptNumber: 1, retryable: true });
    expect(await retryOnce(message.messageId)).toBe(true);

    const last = await dispatchOnce(message);
    expect(last).toEqual({ outcome: 'dead-lettered', attemptNumber: ceiling });

    const row = await messageRow(message.messageId);
    expect(row?.status).toBe('cancelled');
    expect(row?.failure_class).toBe('outage');
    expect(row?.retry_count).toBe(ceiling - 1);

    // Exactly as many attempts as the budget allows, and no more. The provider
    // was contacted the same number of times.
    const attempts = await attemptRows(message.messageId);
    expect(attempts).toHaveLength(ceiling);
    expect(attempts.map((attempt) => attempt.status)).toEqual(
      Array.from({ length: ceiling }, () => 'errored')
    );
    expect(provider.callCount).toBe(ceiling);

    // The loop is over: a dead-lettered message is not `failed`, so retry refuses.
    expect(await retryOnce(message.messageId)).toBe(false);
    expect((await messageRow(message.messageId))?.status).toBe('cancelled');
    expect(await attemptRows(message.messageId)).toHaveLength(ceiling);
  });
});

// ===========================================================================
// Worker dispatch — the default provider
// ===========================================================================
describe('worker dispatch / the unconfigured provider', () => {
  it('refuses to deliver rather than pretending a provider exists', async () => {
    // The shipped default. No production delivery provider is provisioned
    // (ADR-012 remains open), and the honest behaviour is a recorded failure, not
    // a message marked delivered that went nowhere.
    setMessageProvider(new UnconfiguredMessageProvider());
    const message = await queuedMessage();

    const result = await dispatchOnce(message);

    expect(result).toEqual({ outcome: 'failed', attemptNumber: 1, retryable: true });

    const row = await messageRow(message.messageId);
    expect(row?.status).toBe('failed');
    expect(row?.delivered_at).toBeNull();
    expect(row?.failure_class).toBe('outage');

    const attempts = await attemptRows(message.messageId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe('errored');
    expect(attempts[0]?.provider_code).toBe('unconfigured');
    expect(attempts[0]?.error_summary).toBe('provider_unconfigured');
    // Nothing anywhere in this message's evidence claims a delivery happened.
    expect(attempts.some((attempt) => attempt.status === 'delivered')).toBe(false);
  });
});
