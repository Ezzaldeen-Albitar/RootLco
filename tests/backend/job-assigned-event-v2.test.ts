/**
 * `job.assigned` schemaVersion 2 — the publisher resolves, the payload carries.
 *
 * These are BEHAVIOURAL proofs against authoritative state, not payload-shape
 * checks. The question each one answers is "did the publisher resolve the right
 * fact from the database", because the whole design rests on the publisher being
 * the only party that CAN: its consumer runs on `app_worker`, which has USAGE on
 * neither `wo` nor `tech` and no privilege on `shared.message_templates`.
 *
 * ## The digest is recomputed BY HAND here, deliberately
 *
 * `bodySha256` is checked against a string this file assembles itself —
 * `subject + '\0' + renderedBody` hashed with `node:crypto` — rather than by
 * calling `bodyDigest(canonicalRenderedForm(renderTemplate(...)))`. Calling the
 * production helpers would assert that a function equals itself and would keep
 * passing if all three changed together. Spelling the canonical form out is the
 * only version of this assertion that can fail for the right reason.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
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
} from './helpers';
import {
  BRANCH_B1,
  COMPANY_B1,
  FULL,
  SPLIT_WINDOW,
  TECH_A1,
  TECH_A1_ALT,
  TECH_B1,
  TENANT_B_FULL,
  advance,
  authAs,
  createOpenWorkOrder,
  createWorkOrder,
  establishP1_19Fixtures,
  establishTechnicianFixtures,
} from './p1-19-helpers';
import {
  __resetConsumersForTests,
  registerConsumer,
  runConsumer,
} from '@/server/worker/consumer-registry';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { POST as CREATE_JOB } from '@/app/api/v1/work-orders/[workOrderId]/jobs/route';
import { POST as ASSIGN } from '@/app/api/v1/jobs/[jobId]/assignments/route';
import { POST as REASSIGN } from '@/app/api/v1/jobs/[jobId]/reassignments/route';
import { ASSIGNMENT_TEMPLATE_CODE } from '@/modules/work-order/application/job-assignment-service';

let admin: Pool;
let runtime: Pool;

const TEMPLATE_A = '00000000-0000-4000-8000-00000000a201';
const TPLVER_A = '00000000-0000-4000-8000-00000000a202';
const TEMPLATE_B = '00000000-0000-4000-8000-00000000b201';
const TPLVER_B = '00000000-0000-4000-8000-00000000b202';

const SUBJECT = 'Job assigned';
/** One placeholder each, so the rendered form is predictable character for character. */
const BODY = 'You are {{assignmentRole}} on {{jobTitle}}.';
const JOB_TITLE = 'Replace front pads';

interface NotificationFacts {
  readonly templateVersionId: string;
  readonly channel: string;
  readonly purpose: string;
  readonly recipientUserId: string;
  readonly bodySha256: string;
  readonly dedupeKey: string;
  readonly consentRef: string | null;
}

interface EventRow {
  readonly schema_version: number;
  readonly payload: {
    jobId: string;
    assignmentId: string;
    assignmentRole: string;
    notification?: NotificationFacts;
  };
  readonly tenant_id: string;
  readonly company_id: string | null;
  readonly branch_id: string | null;
}

/** The one `job.assigned` row for a job, read as admin — never as RLS evidence. */
async function eventFor(jobId: string, assignmentId: string): Promise<EventRow> {
  const result = await admin.query<EventRow>(
    `SELECT schema_version, payload, tenant_id, company_id, branch_id
       FROM shared.event_outbox
      WHERE event_type = 'job.assigned' AND event_key = $1`,
    [`job.assigned:${assignmentId}`]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`no job.assigned event for assignment ${assignmentId}`);
  expect(row.payload.jobId).toBe(jobId);
  return row;
}

/** Seeds an ACTIVE template with an APPROVED version for one tenant. */
async function seedTemplate(input: {
  readonly templateId: string;
  readonly versionId: string;
  readonly tenantId: string;
  readonly approver: string;
  readonly channel: 'in_app' | 'email';
}): Promise<void> {
  await admin.query(
    `INSERT INTO shared.message_templates
       (id, scope, tenant_id, template_code, name, channel, purpose, locale_code, status, created_by)
     VALUES ($1, 'tenant', $2, $3, 'v2 fixture template', $4, 'transactional', 'en', 'active', $5)
     ON CONFLICT (id) DO NOTHING`,
    [input.templateId, input.tenantId, ASSIGNMENT_TEMPLATE_CODE, input.channel, input.approver]
  );
  await admin.query(
    `INSERT INTO shared.template_versions
       (id, tenant_id, template_id, version_number, subject, body, content_hash, created_by)
     VALUES ($1, $2, $3, 1, $4, $5, decode(repeat('ab', 32), 'hex'), $6)
     ON CONFLICT (id) DO NOTHING`,
    [input.versionId, input.tenantId, input.templateId, SUBJECT, BODY, input.approver]
  );
  await admin.query(
    `UPDATE shared.template_versions SET status = 'approved', approved_by = $2
      WHERE id = $1 AND status = 'draft'`,
    [input.versionId, input.approver]
  );
  // A template is only usable through its ACTIVE version pointer.
  await admin.query(`UPDATE shared.message_templates SET active_version_id = $2 WHERE id = $1`, [
    input.templateId,
    input.versionId,
  ]);
}

async function dropTemplates(): Promise<void> {
  await admin.query(
    `UPDATE shared.message_templates SET active_version_id = NULL
                      WHERE template_code = $1`,
    [ASSIGNMENT_TEMPLATE_CODE]
  );
  await admin.query(
    `DELETE FROM shared.template_versions
                      WHERE template_id IN (SELECT id FROM shared.message_templates
                                             WHERE template_code = $1)`,
    [ASSIGNMENT_TEMPLATE_CODE]
  );
  await admin.query(`DELETE FROM shared.message_templates WHERE template_code = $1`, [
    ASSIGNMENT_TEMPLATE_CODE,
  ]);
}

/** The digest the publisher must have produced, assembled independently. */
function expectedDigest(role: string, title: string): string {
  const body = `You are ${role} on ${title}.`;
  return createHash('sha256').update(`${SUBJECT}\u0000${body}`, 'utf8').digest('hex');
}

async function seedJob(input: { readonly tenantId?: string } = {}): Promise<{
  readonly id: string;
  readonly recordVersion: number;
}> {
  let workOrderId: string;
  let as = FULL;
  if (input.tenantId === TENANT_B) {
    const order = await createWorkOrder({
      tenantId: TENANT_B,
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
    });
    await advance(order.workOrderId, [{ toState: 'open' }], TENANT_B_FULL);
    workOrderId = order.workOrderId;
    as = TENANT_B_FULL;
  } else {
    workOrderId = (await createOpenWorkOrder({})).workOrderId;
  }
  authAs(as);
  const response = await CREATE_JOB(
    new Request(`http://localhost/api/v1/work-orders/${workOrderId}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify({ title: JOB_TITLE }),
    }),
    { params: Promise.resolve({ workOrderId }) }
  );
  if (response.status !== 201) throw new Error(`job creation failed: ${response.status}`);
  return (await response.json()) as { id: string; recordVersion: number };
}

async function assign(
  jobId: string,
  technicianProfileId: string,
  as = FULL
): Promise<{ readonly id: string }> {
  authAs(as);
  const response = await ASSIGN(
    new Request(`http://localhost/api/v1/jobs/${jobId}/assignments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify({
        technicianProfileId,
        window: { from: SPLIT_WINDOW.from, to: SPLIT_WINDOW.to },
      }),
    }),
    { params: Promise.resolve({ jobId }) }
  );
  if (response.status !== 201) {
    throw new Error(`assign failed with ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as { id: string };
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  // Order matters: `establishP1_19Fixtures` assigns the module-level pool the
  // technician fixtures then use. Calling the second alone throws on `connect`.
  await establishP1_19Fixtures(admin);
  await establishTechnicianFixtures();
  runtime = runtimeAppPool(8);
  __setPrimaryPoolForTests(runtime);
}, 240_000);

afterEach(() => __resetAuthenticatorForTests());

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

describe('with no template authored — the ordinary state of every tenant', () => {
  it('publishes v2 without a notification block, and the assignment still succeeds', async () => {
    await dropTemplates();
    const job = await seedJob();
    const assignment = await assign(job.id, TECH_A1);

    const event = await eventFor(job.id, assignment.id);
    expect(event.schema_version).toBe(2);
    expect(event.payload.assignmentId).toBe(assignment.id);
    expect(event.payload.assignmentRole).toBe('primary');
    // ABSENT, not null-filled: a consumer must be able to tell "nothing to send"
    // from "something to send whose fields happen to be empty".
    expect(event.payload.notification).toBeUndefined();
    expect(Object.hasOwn(event.payload, 'notification')).toBe(false);
  });
});

describe('with an approved, active template', () => {
  beforeAll(async () => {
    await dropTemplates();
    await seedTemplate({
      templateId: TEMPLATE_A,
      versionId: TPLVER_A,
      tenantId: TENANT_A,
      approver: USER_A,
      channel: 'in_app',
    });
  }, 120_000);

  it('carries the immutable version, the resolved channel, and the template purpose', async () => {
    const job = await seedJob();
    const assignment = await assign(job.id, TECH_A1);
    const facts = (await eventFor(job.id, assignment.id)).payload.notification;

    expect(facts).toBeDefined();
    // The VERSION id, not the template id: a template's active version can move,
    // and a message must name the immutable content it was rendered from.
    expect(facts?.templateVersionId).toBe(TPLVER_A);
    // `in_app` is first in the publisher's preference order AND the only channel
    // authored, so this is the resolved channel rather than a default.
    expect(facts?.channel).toBe('in_app');
    // A TEMPLATE fact, never a caller choice.
    expect(facts?.purpose).toBe('transactional');
    expect(facts?.dedupeKey).toBe(`job-assigned:${assignment.id}`);
    // No consent record exists for an internal staff recipient: the platform's
    // consent model is `crm.consent_history`, which covers customers. Null says
    // none was consulted; an id would claim one was.
    expect(facts?.consentRef).toBeNull();
  });

  it('resolves the recipient to the ASSIGNED technician own user account', async () => {
    const job = await seedJob();
    const assignment = await assign(job.id, TECH_A1);
    const facts = (await eventFor(job.id, assignment.id)).payload.notification;

    const profile = await admin.query<{ user_id: string; tenant_id: string }>(
      `SELECT user_id, tenant_id FROM tech.technician_profiles WHERE id = $1`,
      [TECH_A1]
    );
    // Read from the database, not from a constant the publisher could also have
    // read wrongly: the recipient must BE this profile's user.
    expect(facts?.recipientUserId).toBe(profile.rows[0]?.user_id);
    expect(profile.rows[0]?.tenant_id).toBe(TENANT_A);
  });

  it('derives bodySha256 from the rendered content BEFORE publishing it', async () => {
    const job = await seedJob();
    const assignment = await assign(job.id, TECH_A1);
    const facts = (await eventFor(job.id, assignment.id)).payload.notification;

    // Assembled by hand — see the header. If the publisher rendered different
    // variables, hashed a different canonical form, or hashed nothing at all,
    // this disagrees.
    expect(facts?.bodySha256).toBe(expectedDigest('primary', JOB_TITLE));
    expect(facts?.bodySha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('carries no rendered content and no address anywhere in the payload', async () => {
    const job = await seedJob();
    const assignment = await assign(job.id, TECH_A1);
    const event = await eventFor(job.id, assignment.id);
    const serialised = JSON.stringify(event.payload);

    // The platform's rule is that rendered content is never persisted, and an
    // outbox payload is persistence.
    expect(serialised).not.toContain('You are primary on');
    expect(serialised).not.toContain(SUBJECT);
    expect(serialised).not.toContain(BODY);
    // A recipient is an opaque UUID by contract; an address would mean the
    // publisher had resolved one, which nothing on this path should ever do.
    expect(serialised).not.toContain('@');
  });

  it('re-resolves the recipient on REASSIGNMENT rather than repeating the first', async () => {
    const job = await seedJob();
    const first = await assign(job.id, TECH_A1);

    authAs(FULL);
    const response = await REASSIGN(
      new Request(`http://localhost/api/v1/jobs/${job.id}/reassignments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
        body: JSON.stringify({
          technicianProfileId: TECH_A1_ALT,
          reason: 'handover for the v2 proof',
          window: { from: SPLIT_WINDOW.from, to: SPLIT_WINDOW.to },
        }),
      }),
      { params: Promise.resolve({ jobId: job.id }) }
    );
    // 201: a reassignment OPENS a new assignment row, and the route returns the
    // created resource — `reassignments/route.ts:101`.
    expect(response.status).toBe(201);
    const opened = ((await response.json()) as { opened: { id: string } }).opened;

    const users = await admin.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM tech.technician_profiles WHERE id = ANY($1::uuid[])`,
      [[TECH_A1, TECH_A1_ALT]]
    );
    const byProfile = new Map(users.rows.map((r) => [r.id, r.user_id]));

    const firstFacts = (await eventFor(job.id, first.id)).payload.notification;
    const secondFacts = (await eventFor(job.id, opened.id)).payload.notification;

    expect(firstFacts?.recipientUserId).toBe(byProfile.get(TECH_A1));
    expect(secondFacts?.recipientUserId).toBe(byProfile.get(TECH_A1_ALT));
    // The premise, computed rather than assumed: without two distinct users the
    // assertion above would pass for the wrong reason.
    expect(byProfile.get(TECH_A1)).not.toBe(byProfile.get(TECH_A1_ALT));
    // Keyed per ASSIGNMENT, so the handover does not collide with the first.
    expect(secondFacts?.dedupeKey).toBe(`job-assigned:${opened.id}`);
    expect(firstFacts?.dedupeKey).not.toBe(secondFacts?.dedupeKey);
  });
});

describe('the version bump is enforced by the EXISTING registry, not cosmetic', () => {
  it('refuses a consumer that understands only v1, without running its handler', async () => {
    await dropTemplates();
    const job = await seedJob();
    const assignment = await assign(job.id, TECH_A1);
    const event = await eventFor(job.id, assignment.id);

    let handlerRan = false;
    const stale = registerConsumer({
      code: 'fx_v1_only_notifier',
      handles: ['job.assigned'],
      // A consumer written against the OLD payload. It would read a payload whose
      // notification facts it does not know about and would resolve them from
      // `wo`/`tech` — reads `app_worker` cannot make.
      supportedSchemaVersions: [1],
      handle: async () => {
        handlerRan = true;
        return 'applied';
      },
    });

    const outcome = await runConsumer(stale, {
      id: randomUUID(),
      tenantId: event.tenant_id,
      companyId: event.company_id,
      branchId: event.branch_id,
      createdBy: USER_A,
      eventType: 'job.assigned',
      schemaVersion: event.schema_version,
      aggregateType: 'wo.job',
      aggregateId: job.id,
      aggregateVersion: 1,
      correlationId: null,
      causationId: null,
      payload: event.payload as unknown as Record<string, unknown>,
      headers: {},
      attemptCount: 0,
    });

    // The published version really is 2 — without this the case would pass for
    // the wrong reason against a v1 event.
    expect(event.schema_version).toBe(2);
    expect(outcome.status).toBe('unsupported-version');
    // The decisive half: refused BEFORE the handler, so a stale consumer cannot
    // half-apply a payload it misreads.
    expect(handlerRan).toBe(false);
    __resetConsumersForTests();
    expect(stale.code).toBe('fx_v1_only_notifier');
  });
});

describe('cross-tenant injection is not representable', () => {
  it('never resolves another tenant template or another tenant recipient', async () => {
    await dropTemplates();
    // Both tenants author the SAME template code. If resolution leaked, tenant B
    // could be handed tenant A's version id.
    await seedTemplate({
      templateId: TEMPLATE_A,
      versionId: TPLVER_A,
      tenantId: TENANT_A,
      approver: USER_A,
      channel: 'in_app',
    });
    const tenantBUser = await admin.query<{ user_id: string }>(
      `SELECT user_id FROM tech.technician_profiles WHERE id = $1`,
      [TECH_B1]
    );
    await seedTemplate({
      templateId: TEMPLATE_B,
      versionId: TPLVER_B,
      tenantId: TENANT_B,
      approver: tenantBUser.rows[0]?.user_id ?? USER_A,
      channel: 'in_app',
    });

    const job = await seedJob({ tenantId: TENANT_B });
    const assignment = await assign(job.id, TECH_B1, TENANT_B_FULL);
    const event = await eventFor(job.id, assignment.id);
    const facts = event.payload.notification;

    expect(event.tenant_id).toBe(TENANT_B);
    // Tenant B's own version, and demonstrably NOT tenant A's.
    expect(facts?.templateVersionId).toBe(TPLVER_B);
    expect(facts?.templateVersionId).not.toBe(TPLVER_A);
    expect(facts?.recipientUserId).toBe(tenantBUser.rows[0]?.user_id);

    // And the recipient is a user of THIS tenant, checked against the database
    // rather than inferred from the profile the test asked for.
    const owner = await admin.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM iam.user_accounts WHERE id = $1`,
      [facts?.recipientUserId]
    );
    expect(owner.rows[0]?.tenant_id).toBe(TENANT_B);
  });
});
