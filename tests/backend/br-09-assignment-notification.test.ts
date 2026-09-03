/**
 * BR-09 — `job.assigned` v2 becomes one notification for the assigned technician.
 *
 * These run the REAL consumer through the REAL registry against a live database,
 * because the defect this closes was a consumer that existed, typechecked, and was
 * never registered: `consumersFor('job.assigned')` returned an empty set and the
 * worker completed every event having done nothing. A unit test of the handler
 * would have passed throughout.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import {
  TENANT_A,
  TENANT_B,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  workerAppPool,
} from './helpers';
import {
  consumersFor,
  runConsumer,
  __resetConsumersForTests,
  type ConsumedEvent,
} from '@/server/worker/consumer-registry';
import {
  registerWorkerConsumers,
  JOB_ASSIGNED_NOTIFIER,
  PoisonPayloadError,
} from '@/server/worker/consumers';
import { setNotificationService } from '@/server/contracts/notification-service';
import { sharedServicesModule } from '@/modules/shared-services';
import { __setWorkerPoolForTests } from '@/server/worker/worker-db';

let admin: Pool;
let workerPool: Pool;

const TPL = '55555555-5555-4555-8555-555555555501';
const VER = '55555555-5555-4555-8555-555555555502';
const TPL_B = '55555555-5555-4555-8555-5555555555b1';
const VER_B = '55555555-5555-4555-8555-5555555555b2';
let witnessA = '';
let witnessB = '';
let recipientA = '';
let recipientB = '';

async function seedApproved(templateId: string, versionId: string, tenantId: string, by: string) {
  await admin.query(
    `INSERT INTO shared.message_templates
       (id, scope, tenant_id, template_code, name, channel, purpose, locale_code, status, created_by)
     VALUES ($1,'tenant',$2,'fx_br09','br-09 fixture','in_app','transactional','en','active',$3)
     ON CONFLICT (id) DO NOTHING`,
    [templateId, tenantId, by]
  );
  await admin.query(
    `INSERT INTO shared.template_versions
       (id, tenant_id, template_id, version_number, subject, body, content_hash, created_by)
     VALUES ($1,$2,$3,1,'s','b',decode(repeat('ab',32),'hex'),$4)
     ON CONFLICT (id) DO NOTHING`,
    [versionId, tenantId, templateId, by]
  );
  await admin.query(
    `UPDATE shared.template_versions SET status='approved', approved_by=$2
      WHERE id=$1 AND status='draft'`,
    [versionId, by]
  );
  const w = await admin.query<{ id: string }>(
    `INSERT INTO shared.template_version_approvals
       (tenant_id, owner_tenant_id, template_version_id, approved_by)
     VALUES ($1,$1,$2,$3)
     ON CONFLICT (template_version_id) DO UPDATE SET approved_by = EXCLUDED.approved_by
     RETURNING id`,
    [tenantId, versionId, by]
  );
  return w.rows[0]?.id ?? '';
}

/** A v2 event exactly as the publisher emits one. */
function v2Event(
  overrides: Partial<ConsumedEvent> & { notification?: unknown } = {}
): ConsumedEvent {
  const { notification, ...rest } = overrides;
  return {
    id: randomUUID(),
    tenantId: TENANT_A,
    companyId: null,
    branchId: null,
    createdBy: USER_A,
    eventType: 'job.assigned',
    schemaVersion: 2,
    aggregateType: 'wo.job',
    aggregateId: randomUUID(),
    aggregateVersion: 1,
    correlationId: null,
    causationId: null,
    payload: {
      jobId: randomUUID(),
      assignmentId: randomUUID(),
      assignmentRole: 'primary',
      ...(notification === undefined
        ? {
            notification: {
              templateVersionId: VER,
              approvalWitnessId: witnessA,
              templateOwnerTenantId: TENANT_A,
              channel: 'in_app',
              purpose: 'transactional',
              recipientUserId: recipientA,
              bodySha256: 'a'.repeat(64),
              dedupeKey: `br09:${randomUUID()}`,
              consentRef: null,
            },
          }
        : notification === null
          ? {}
          : { notification }),
    },
    headers: {},
    attemptCount: 0,
    ...rest,
  } as ConsumedEvent;
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);

  recipientA = USER_A;
  const bUser = await admin.query<{ id: string }>(
    `SELECT id FROM iam.user_accounts WHERE tenant_id = $1 LIMIT 1`,
    [TENANT_B]
  );
  recipientB = bUser.rows[0]?.id ?? USER_A;

  witnessA = await seedApproved(TPL, VER, TENANT_A, USER_A);
  witnessB = await seedApproved(TPL_B, VER_B, TENANT_B, recipientB);

  // The worker pool is what the consumer writes through — the RESTRICTED role, not
  // the admin connection, so every refusal below is the real one and every success
  // proves the grant rather than the fixture.
  workerPool = workerAppPool(3);
  __setWorkerPoolForTests(workerPool);
  setNotificationService(sharedServicesModule().notifications);
  __resetConsumersForTests();
  registerWorkerConsumers();
}, 240_000);

afterEach(async () => {
  await admin.query(`DELETE FROM shared.outbound_messages WHERE dedupe_key LIKE 'br09:%'`);
  await admin.query(`DELETE FROM shared.processed_events WHERE consumer_code = $1`, [
    JOB_ASSIGNED_NOTIFIER,
  ]);
});

afterAll(async () => {
  __resetConsumersForTests();
  __setWorkerPoolForTests(undefined);
  if (workerPool) await workerPool.end();
  if (admin) {
    await admin.query(
      `DELETE FROM shared.outbound_messages WHERE template_version_id = ANY($1::uuid[])`,
      [[VER, VER_B]]
    );
    await admin.query(
      `DELETE FROM shared.template_version_approvals WHERE template_version_id = ANY($1::uuid[])`,
      [[VER, VER_B]]
    );
    await admin.query(`DELETE FROM shared.template_versions WHERE id = ANY($1::uuid[])`, [
      [VER, VER_B],
    ]);
    await admin.query(`DELETE FROM shared.message_templates WHERE id = ANY($1::uuid[])`, [
      [TPL, TPL_B],
    ]);
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

describe('registration — the defect INS-25 actually was', () => {
  it('registers for job.assigned, which previously had NO consumer at all', () => {
    const subscribers = consumersFor('job.assigned');
    expect(subscribers.map((c) => c.code)).toContain(JOB_ASSIGNED_NOTIFIER);
  });

  it('declares [2] only, because there is no honest v1 handler', () => {
    const c = consumersFor('job.assigned').find((x) => x.code === JOB_ASSIGNED_NOTIFIER);
    expect(c?.supportedSchemaVersions).toEqual([2]);
  });

  it('uses a code the processed_events format accepts', () => {
    // `ck_processed_events_consumer_code_format` is ^[a-z][a-z0-9_.]{1,62}$ — the
    // contract's hyphenated name could never have been written.
    expect(JOB_ASSIGNED_NOTIFIER).toMatch(/^[a-z][a-z0-9_.]{1,62}$/);
    expect(JOB_ASSIGNED_NOTIFIER).not.toContain('-');
  });
});

describe('the enqueue', () => {
  it('enqueues ONE pending message for the carried recipient, naming the real version', async () => {
    const consumer = consumersFor('job.assigned').find((c) => c.code === JOB_ASSIGNED_NOTIFIER)!;
    const event = v2Event();
    const outcome = await runConsumer(consumer, event);
    expect(outcome.status).toBe('applied');

    const key = (event.payload['notification'] as { dedupeKey: string }).dedupeKey;
    const row = await admin.query<{
      status: string;
      template_version_id: string;
      approval_witness_id: string;
      recipient_user_id: string;
      tenant_id: string;
    }>(
      `SELECT status, template_version_id, approval_witness_id, recipient_user_id, tenant_id
         FROM shared.outbound_messages WHERE dedupe_key = $1`,
      [key]
    );
    expect(row.rows).toHaveLength(1);
    // Inspect the PERSISTED row, not the return value: a consumer that reported
    // success without writing would pass an outcome-only assertion.
    expect(row.rows[0]?.status).toBe('pending');
    expect(row.rows[0]?.template_version_id).toBe(VER);
    expect(row.rows[0]?.approval_witness_id).toBe(witnessA);
    expect(row.rows[0]?.recipient_user_id).toBe(recipientA);
    expect(row.rows[0]?.tenant_id).toBe(TENANT_A);
  });

  it('produces ONE message under replay, through the platform’s own conflict target', async () => {
    const consumer = consumersFor('job.assigned').find((c) => c.code === JOB_ASSIGNED_NOTIFIER)!;
    const event = v2Event();
    const key = (event.payload['notification'] as { dedupeKey: string }).dedupeKey;

    await runConsumer(consumer, event);
    // A redelivery of the SAME event id aborts on processed_events; a different id
    // carrying the same dedupe key is stopped by (tenant_id, dedupe_key). Both
    // paths are exercised, and neither is a mechanism this consumer invented.
    const first = await runConsumer(consumer, event);
    const second = await runConsumer(consumer, { ...event, id: randomUUID() });

    expect(first.status).toBe('already-processed');
    expect(second.status).toBe('applied');
    const count = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM shared.outbound_messages WHERE dedupe_key = $1`,
      [key]
    );
    expect(count.rows[0]?.n).toBe('1');
  });

  it('treats an absent notification block as COMPLETED, NOT DELIVERED', async () => {
    const consumer = consumersFor('job.assigned').find((c) => c.code === JOB_ASSIGNED_NOTIFIER)!;
    const outcome = await runConsumer(consumer, v2Event({ notification: null }));
    expect(outcome.status).toBe('skipped');
    const count = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM shared.outbound_messages WHERE dedupe_key LIKE 'br09:%'`
    );
    expect(count.rows[0]?.n).toBe('0');
  });
});

describe('tenant isolation and poison', () => {
  it('cannot enqueue another tenant’s template, even with that tenant’s real witness', async () => {
    const consumer = consumersFor('job.assigned').find((c) => c.code === JOB_ASSIGNED_NOTIFIER)!;
    // Tenant A's event naming tenant B's version and witness. The database refuses
    // it — ck_outbound_messages_template_owner_scope — so a forged payload cannot
    // reach across tenants even though the consumer performs no checks of its own.
    await expect(
      runConsumer(
        consumer,
        v2Event({
          notification: {
            templateVersionId: VER_B,
            approvalWitnessId: witnessB,
            templateOwnerTenantId: TENANT_B,
            channel: 'in_app',
            purpose: 'transactional',
            recipientUserId: recipientA,
            bodySha256: 'b'.repeat(64),
            dedupeKey: `br09:${randomUUID()}`,
            consentRef: null,
          },
        })
      )
    ).rejects.toThrow(/check constraint|foreign key|row-level security/);
  });

  it('refuses an unsupported schema version BEFORE the handler runs', async () => {
    const consumer = consumersFor('job.assigned').find((c) => c.code === JOB_ASSIGNED_NOTIFIER)!;
    const outcome = await runConsumer(consumer, v2Event({ schemaVersion: 1 }));
    expect(outcome.status).toBe('unsupported-version');
    const count = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM shared.outbound_messages WHERE dedupe_key LIKE 'br09:%'`
    );
    expect(count.rows[0]?.n).toBe('0');
  });

  it('treats a malformed notification block as poison, not as a no-op', async () => {
    const consumer = consumersFor('job.assigned').find((c) => c.code === JOB_ASSIGNED_NOTIFIER)!;
    // The CLASS is the contract, not any one message: which field is reported
    // depends on validation order, and pinning a specific sentence would make this
    // case fail when a reader reorders two checks that both refuse correctly.
    await expect(
      runConsumer(consumer, v2Event({ notification: { templateVersionId: 'not-a-uuid' } }))
    ).rejects.toThrow(PoisonPayloadError);
    await expect(
      runConsumer(consumer, v2Event({ notification: 'a string, not an object' }))
    ).rejects.toThrow(PoisonPayloadError);

    // And a payload whose fields are all present but one is the wrong SHAPE is
    // refused too — a best-effort parse here would turn a publisher contract change
    // into a silently wrong notification.
    const good = (v2Event().payload as { notification: Record<string, unknown> }).notification;
    await expect(
      runConsumer(consumer, v2Event({ notification: { ...good, bodySha256: 'too-short' } }))
    ).rejects.toThrow(PoisonPayloadError);

    const count = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM shared.outbound_messages WHERE dedupe_key LIKE 'br09:%'`
    );
    expect(count.rows[0]?.n).toBe('0');
  });
});

describe('the boundary the consumer never crosses', () => {
  it('names no business or template relation anywhere in its source', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(process.cwd(), 'apps/api/src/server/worker/consumers/job-assigned-notifier.ts'),
      'utf8'
    );
    // Comments are stripped first: this file DESCRIBES the tables it must not read,
    // and a scanner that matched its own prose would pass for the wrong reason —
    // the same defect corrected in check-p1-29-access.mjs.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    expect(code.length).toBeGreaterThan(500);
    for (const forbidden of [
      'wo.job_assignments',
      'wo.jobs',
      'tech.technician_profiles',
      'shared.message_templates',
      'shared.template_versions',
      'shared.template_version_approvals',
    ]) {
      expect(code).not.toContain(forbidden);
    }
    // And it issues no SQL of its own at all.
    expect(code).not.toMatch(/\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
  });
});
