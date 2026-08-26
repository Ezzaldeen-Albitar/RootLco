/**
 * Work and diagnostic evidence (BR-07, PRE-P1-29 backend remediation).
 *
 * A technician could not attach a photograph to the work they did. Evidence
 * binding existed for exactly TWO subjects — a diagnostic report and a customer
 * approval — and for nothing else, so Owner requirement 12 had no owner.
 *
 * The cases this suite exists for:
 *
 *  1. **N11/N12 — append-only at the GRANT layer**, proved as `app_runtime` with
 *     the tenant GUCs set inside a transaction and the row asserted REACHABLE
 *     first. This is the BR-04/BR-06 false green: `set_config(..., true)` is
 *     TRANSACTION-local, so without `BEGIN` the GUCs vanish, RLS narrows to zero
 *     rows, and an `UPDATE` that changed nothing RESOLVES — the assertion passes
 *     while the thing it claims to prove never ran.
 *  2. **S1 — cross-tenant binding refused at BOTH layers.** The service answers
 *     404, and the FK is asserted independently by attempting the same insert
 *     directly: `fk_job_evidence_version` is `(tenant_id, document_version_id)`,
 *     so a cross-tenant pair does not exist to be referenced.
 *  3. **P2 + S4 — the deliberate asymmetry.** A `pending` version BINDS and does
 *     not DOWNLOAD. Tightening bind-time would make capture fail intermittently
 *     on scan latency, losing the photograph rather than delaying it.
 *  4. **S3 — no storage leakage.** The response carries `documentVersionId` and
 *     no storage key, URL, checksum or bytes (`T-09`), asserted as a KEY SET so
 *     an ADDITION is caught, not only a substitution.
 *  5. **S5 — one declaration** of `EVIDENCE_REFUSED_STATES` in `apps/api/src`.
 *     There were THREE literals before this slice, not the two the contract
 *     recorded; the third was in `delivery` under a different name.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   wo.job-evidence-record: route service authorization success denial cross-tenant isolation audit idempotency
 *   wo.job-evidence-list: route service authorization success denial cross-tenant isolation
 *   wo.work-order-evidence-list: route service authorization success denial cross-tenant isolation
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';
import {
  BRANCH_A1,
  COMPANY_A1,
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
  READER,
  SCOPED_ELSEWHERE,
  TENANT_B_FULL,
  authAs,
  createOpenWorkOrder,
  establishP1_19Fixtures,
  establishTechnicianFixtures,
  seedDocumentVersion,
} from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import {
  GET as JOB_EVIDENCE_LIST,
  POST as JOB_EVIDENCE_RECORD,
} from '@/app/api/v1/jobs/[jobId]/evidence/route';
import { GET as WORK_ORDER_EVIDENCE_LIST } from '@/app/api/v1/work-orders/[workOrderId]/evidence/route';
import { POST as CREATE_JOB } from '@/app/api/v1/work-orders/[workOrderId]/jobs/route';

let admin: Pool;
let runtime: Pool;

interface EvidenceRow {
  readonly id: string;
  readonly jobId: string;
  readonly documentVersionId: string;
  readonly evidenceType: string;
  readonly note: string | null;
  readonly createdAt: string;
  readonly createdBy: string;
}
interface ItemsOf<T> {
  readonly items: readonly T[];
}
interface Problem {
  readonly code?: string;
}

const recordEvidence = (jobId: string, body: unknown, key = randomUUID()): Promise<Response> =>
  JOB_EVIDENCE_RECORD(
    new Request(`http://localhost/api/v1/jobs/${jobId}/evidence`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ jobId }) }
  );

const listJobEvidence = (jobId: string): Promise<Response> =>
  JOB_EVIDENCE_LIST(new Request(`http://localhost/api/v1/jobs/${jobId}/evidence`), {
    params: Promise.resolve({ jobId }),
  });

const listWorkOrderEvidence = (workOrderId: string): Promise<Response> =>
  WORK_ORDER_EVIDENCE_LIST(
    new Request(`http://localhost/api/v1/work-orders/${workOrderId}/evidence`),
    { params: Promise.resolve({ workOrderId }) }
  );

/** A job on a fresh open work order, created through the authoritative route. */
async function seedJob(
  options: { readonly tenantId?: string; readonly branchId?: string } = {}
): Promise<{ jobId: string; workOrderId: string }> {
  const tenantB = options.tenantId === TENANT_B;
  const order = tenantB
    ? await createOpenWorkOrder({ tenantId: TENANT_B, companyId: COMPANY_B1, branchId: BRANCH_B1 })
    : await createOpenWorkOrder(
        options.branchId === undefined ? {} : { branchId: options.branchId }
      );
  authAs(tenantB ? TENANT_B_FULL : FULL);
  const response = await CREATE_JOB(
    new Request(`http://localhost/api/v1/work-orders/${order.workOrderId}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify({ title: 'BR-07 evidenced work' }),
    }),
    { params: Promise.resolve({ workOrderId: order.workOrderId }) }
  );
  if (response.status !== 201) {
    throw new Error(
      `fixture job creation failed with ${response.status}: ${await response.text()}`
    );
  }
  return {
    jobId: ((await response.json()) as { id: string }).id,
    workOrderId: order.workOrderId,
  };
}

/** Marks a seeded version `quarantined`, which the fixture does not offer. */
async function quarantine(versionId: string): Promise<void> {
  await admin.query(
    `UPDATE shared.document_versions
        SET status = 'quarantined', quarantined_at = now()
      WHERE id = $1`,
    [versionId]
  );
}

/**
 * Runs statements as `app_runtime` with the tenant GUCs set, INSIDE a
 * transaction.
 *
 * `BEGIN` is the whole point and not decoration: `set_config(..., true)` is
 * TRANSACTION-local, so issued outside one each statement is its own transaction
 * and the setting is discarded before the next runs. `iam.allowed_branch_ids()`
 * would then return NULL, the row would be invisible, and an `UPDATE` would
 * affect zero rows and RESOLVE — "the write was refused" passing while nothing
 * was attempted. That is the BR-04 false green, and it is why every backstop
 * below proves the row REACHABLE before claiming a refusal means anything.
 */
async function asAppRuntime<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await runtime.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true),
              set_config('app.company_ids',$3,true), set_config('app.branch_ids',$4,true)`,
      [USER_A, TENANT_A, COMPANY_A1, BRANCH_A1]
    );
    const result = await fn(client);
    await client.query('ROLLBACK');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishTechnicianFixtures();
  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);
});

afterEach(() => __resetAuthenticatorForTests());
afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

describe('wo.job-evidence-record — binding a captured version to a job', () => {
  it('P1/P2 — a PENDING version binds, and the persisted row carries the right scope and actor', async () => {
    const job = await seedJob();
    const versionId = await seedDocumentVersion(); // pending by default
    authAs(FULL);
    const response = await recordEvidence(job.jobId, {
      documentVersionId: versionId,
      evidenceType: 'after',
      note: 'Caliper refitted and torqued.',
    });
    if (response.status !== 201) {
      throw new Error(`bind returned ${response.status}: ${await response.text()}`);
    }
    const row = (await response.json()) as EvidenceRow;
    expect(row.jobId).toBe(job.jobId);
    expect(row.documentVersionId).toBe(versionId);
    expect(row.createdBy).toBe(FULL.userId);

    // The PERSISTED row, not merely the response. A test that asserts a status
    // and never looks at the database proves the route returned, not that it
    // recorded — and scope is the thing most worth proving it recorded.
    const persisted = await admin.query<{
      company_id: string;
      branch_id: string;
      job_id: string;
      document_version_id: string;
      evidence_type: string;
      note: string;
      created_by: string;
    }>(
      `SELECT company_id, branch_id, job_id, document_version_id, evidence_type, note, created_by
         FROM wo.job_evidence WHERE id = $1`,
      [row.id]
    );
    const stored = persisted.rows[0];
    expect(stored?.company_id).toBe(COMPANY_A1);
    expect(stored?.branch_id).toBe(BRANCH_A1);
    expect(stored?.job_id).toBe(job.jobId);
    expect(stored?.document_version_id).toBe(versionId);
    expect(stored?.evidence_type).toBe('after');
    expect(stored?.note).toBe('Caliper refitted and torqued.');
    expect(stored?.created_by).toBe(FULL.userId);
  });

  it('P4 — evidence binds to a job in a TERMINAL state', async () => {
    /*
     * A technician writing up finished work is the normal case. Refusing it
     * would lose the evidence rather than defer it.
     *
     * The terminal state is a PLATFORM one reached over a PLATFORM edge
     * (`planned -> cancelled`), not a tenant state this fixture invents:
     * `ck_job_states_tenant_not_terminal` forbids a tenant authoring a terminal
     * state at all, which is the constraint doing exactly its job. So the job is
     * moved through the shipped graph instead of around it.
     */
    const job = await seedJob();
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true),
                set_config('app.actor_id',$1,true),
                set_config('app.status_reason',$3,true)`,
        [USER_A, TENANT_A, 'BR-07 fixture: reaching a terminal state over the shipped edge']
      );
      // The edge REQUIRES a reason and the guard says so. Supplying one is
      // using the graph as designed rather than working around it.
      await client.query(`UPDATE wo.jobs SET state = 'cancelled' WHERE id = $1`, [job.jobId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    const terminal = await admin.query<{ is_terminal: boolean }>(
      `SELECT js.is_terminal FROM wo.jobs j
         JOIN wo.job_states js ON js.code = j.state
          AND (js.scope = 'platform' OR js.tenant_id = j.tenant_id)
        WHERE j.id = $1`,
      [job.jobId]
    );
    expect(terminal.rows[0]?.is_terminal, 'the fixture must actually be terminal').toBe(true);

    const versionId = await seedDocumentVersion();
    authAs(FULL);
    expect(
      (await recordEvidence(job.jobId, { documentVersionId: versionId, evidenceType: 'after' }))
        .status
    ).toBe(201);
  });
  it('P5 — two different versions bind to one job and both come back', async () => {
    const job = await seedJob();
    const first = await seedDocumentVersion();
    const second = await seedDocumentVersion();
    authAs(FULL);
    expect(
      (await recordEvidence(job.jobId, { documentVersionId: first, evidenceType: 'before' })).status
    ).toBe(201);
    authAs(FULL);
    expect(
      (await recordEvidence(job.jobId, { documentVersionId: second, evidenceType: 'after' })).status
    ).toBe(201);

    authAs(FULL);
    const listed = (await (await listJobEvidence(job.jobId)).json()) as ItemsOf<EvidenceRow>;
    expect(listed.items.map((entry) => entry.documentVersionId).sort()).toEqual(
      [first, second].sort()
    );
  });

  it('N3/N4 — a QUARANTINED and a REJECTED version are both refused with ERR-DOC-001, and leave no row', async () => {
    const job = await seedJob();

    const quarantined = await seedDocumentVersion();
    await quarantine(quarantined);
    authAs(FULL);
    const q = await recordEvidence(job.jobId, {
      documentVersionId: quarantined,
      evidenceType: 'defect',
    });
    expect(q.status).toBe(409);
    expect(((await q.json()) as Problem).code).toBe('ERR-DOC-001');

    const rejected = await seedDocumentVersion({ status: 'rejected' });
    authAs(FULL);
    const r = await recordEvidence(job.jobId, {
      documentVersionId: rejected,
      evidenceType: 'defect',
    });
    expect(r.status).toBe(409);
    expect(((await r.json()) as Problem).code).toBe('ERR-DOC-001');

    // A refused bind must leave NO row: the gate runs before the write.
    const rows = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM wo.job_evidence
        WHERE job_id = $1 AND document_version_id = ANY($2::uuid[])`,
      [job.jobId, [quarantined, rejected]]
    );
    expect(Number(rows.rows[0]?.n), 'a refused bind must persist nothing').toBe(0);
  });

  it('N5..N9 — blank type, oversized note, unknown key, forged createdBy and a missing key are each refused', async () => {
    const job = await seedJob();
    const versionId = await seedDocumentVersion();

    authAs(FULL);
    expect(
      (await recordEvidence(job.jobId, { documentVersionId: versionId, evidenceType: '  ' })).status
    ).toBe(422);
    authAs(FULL);
    expect(
      (
        await recordEvidence(job.jobId, {
          documentVersionId: versionId,
          evidenceType: 'after',
          note: 'x'.repeat(1001),
        })
      ).status
    ).toBe(422);
    authAs(FULL);
    expect(
      (
        await recordEvidence(job.jobId, {
          documentVersionId: versionId,
          evidenceType: 'after',
          unexpected: 1,
        })
      ).status
    ).toBe(422);
    // Evidence whose author the author chooses is not evidence.
    authAs(FULL);
    expect(
      (
        await recordEvidence(job.jobId, {
          documentVersionId: versionId,
          evidenceType: 'after',
          createdBy: randomUUID(),
        })
      ).status
    ).toBe(422);

    authAs(FULL);
    const noKey = await JOB_EVIDENCE_RECORD(
      new Request(`http://localhost/api/v1/jobs/${job.jobId}/evidence`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documentVersionId: versionId, evidenceType: 'after' }),
      }),
      { params: Promise.resolve({ jobId: job.jobId }) }
    );
    expect(noKey.status).toBe(400);
    expect(((await noKey.json()) as Problem).code).toBe('ERR-INT-002');
  });

  it('idempotency — the same key replays rather than binding twice', async () => {
    // This can only pass if '/jobs/{jobId}/evidence' is in ROUTE_TEMPLATES: an
    // unregistered template refuses to fingerprint and answers ERR-INT-002 with
    // a perfectly valid header. That was the BR-04 defect.
    const job = await seedJob();
    const versionId = await seedDocumentVersion();
    const key = randomUUID();
    authAs(FULL);
    expect(
      (
        await recordEvidence(
          job.jobId,
          { documentVersionId: versionId, evidenceType: 'after' },
          key
        )
      ).status
    ).toBe(201);
    authAs(FULL);
    const replay = await recordEvidence(
      job.jobId,
      { documentVersionId: versionId, evidenceType: 'after' },
      key
    );
    expect([200, 201]).toContain(replay.status);

    const count = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM wo.job_evidence
        WHERE job_id = $1 AND document_version_id = $2`,
      [job.jobId, versionId]
    );
    expect(Number(count.rows[0]?.n)).toBe(1);
  });
});

describe('wo.job-evidence-list / wo.work-order-evidence-list', () => {
  it('P3 — a work order shows the evidence of ALL its jobs, each with its jobTitle', async () => {
    const first = await seedJob();
    // A second job on the SAME work order.
    authAs(FULL);
    const secondResponse = await CREATE_JOB(
      new Request(`http://localhost/api/v1/work-orders/${first.workOrderId}/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
        body: JSON.stringify({ title: 'BR-07 second piece of work' }),
      }),
      { params: Promise.resolve({ workOrderId: first.workOrderId }) }
    );
    const secondJobId = ((await secondResponse.json()) as { id: string }).id;

    for (const jobId of [first.jobId, secondJobId]) {
      const versionId = await seedDocumentVersion();
      authAs(FULL);
      expect(
        (await recordEvidence(jobId, { documentVersionId: versionId, evidenceType: 'after' }))
          .status
      ).toBe(201);
    }

    authAs(FULL);
    const body = (await (await listWorkOrderEvidence(first.workOrderId)).json()) as ItemsOf<
      EvidenceRow & { jobTitle: string }
    >;
    expect(body.items).toHaveLength(2);
    expect(body.items.map((entry) => entry.jobId).sort()).toEqual(
      [first.jobId, secondJobId].sort()
    );
    // A gallery that cannot say which piece of work each photograph evidences is
    // not much of a gallery.
    expect(body.items.map((entry) => entry.jobTitle).sort()).toEqual(
      ['BR-07 evidenced work', 'BR-07 second piece of work'].sort()
    );
  });

  it('S3 — no storage key, URL, checksum or bytes reach the caller', async () => {
    const job = await seedJob();
    const versionId = await seedDocumentVersion();
    authAs(FULL);
    const created = (await (
      await recordEvidence(job.jobId, { documentVersionId: versionId, evidenceType: 'after' })
    ).json()) as EvidenceRow;

    // The exact KEY SET, in both directions: an ADDITION is what a field-by-field
    // check cannot see, and a storage key appearing later is exactly that shape.
    expect(Object.keys(created).sort()).toEqual([
      'createdAt',
      'createdBy',
      'documentVersionId',
      'evidenceType',
      'id',
      'jobId',
      'note',
    ]);

    authAs(FULL);
    const listed = await (await listJobEvidence(job.jobId)).text();
    for (const forbidden of ['storageKey', 'storage_key', 'sha256', 'url', 'signedUrl', 'bytes']) {
      expect(listed.includes(`"${forbidden}"`), `${forbidden} leaked`).toBe(false);
    }
  });
});

describe('BR-07 authorization, tenancy and append-only', () => {
  const NOBODY = { ...READER, permissions: [], subject: 'fx_br_07_nobody' };

  it('N1/N2 — every operation refuses a principal with no grant, and a reader cannot WRITE', async () => {
    const job = await seedJob();
    const versionId = await seedDocumentVersion();

    for (const [name, status] of [
      [
        'wo.job-evidence-record',
        (authAs(NOBODY),
        (await recordEvidence(job.jobId, { documentVersionId: versionId, evidenceType: 'after' }))
          .status),
      ],
      ['wo.job-evidence-list', (authAs(NOBODY), (await listJobEvidence(job.jobId)).status)],
      [
        'wo.work-order-evidence-list',
        (authAs(NOBODY), (await listWorkOrderEvidence(job.workOrderId)).status),
      ],
    ] as readonly [string, number][]) {
      expect([401, 403], name).toContain(status);
    }

    // READER holds wo.work_order.read — the evidence READ code — and not
    // tech.labor.record. That is authorization refusing an authenticated caller,
    // which the no-grant case above structurally cannot demonstrate.
    authAs(READER);
    expect((await listJobEvidence(job.jobId)).status).toBe(200);
    authAs(READER);
    expect(
      (await recordEvidence(job.jobId, { documentVersionId: versionId, evidenceType: 'after' }))
        .status
    ).toBe(403);
  });

  it('S2/N10 — a job in an unheld branch is refused and discloses nothing', async () => {
    const job = await seedJob();
    const versionId = await seedDocumentVersion();
    authAs(SCOPED_ELSEWHERE);
    const write = await recordEvidence(job.jobId, {
      documentVersionId: versionId,
      evidenceType: 'after',
    });
    expect([403, 404]).toContain(write.status);
    authAs(SCOPED_ELSEWHERE);
    const read = await listJobEvidence(job.jobId);
    expect([403, 404]).toContain(read.status);

    const leaked = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM wo.job_evidence WHERE job_id = $1`,
      [job.jobId]
    );
    expect(Number(leaked.rows[0]?.n), 'a refused bind must leave no row').toBe(0);
  });

  it('S1 — a cross-tenant version is refused by the SERVICE and, independently, by the FK', async () => {
    const job = await seedJob();
    const foreignVersion = await seedDocumentVersion({ tenantId: TENANT_B });

    // Layer one: the service.
    authAs(FULL);
    const response = await recordEvidence(job.jobId, {
      documentVersionId: foreignVersion,
      evidenceType: 'after',
    });
    expect(response.status).toBe(404);
    expect(((await response.json()) as Problem).code).toBe('ERR-RES-001');

    // Layer two: the constraint, asserted independently of the service so the
    // 404 above cannot be the only thing standing between a tenant and another
    // tenant's document. fk_job_evidence_version is (tenant_id, document_version_id).
    await expect(
      admin.query(
        `INSERT INTO wo.job_evidence
           (tenant_id, company_id, branch_id, job_id, document_version_id, evidence_type, created_by)
         VALUES ($1,$2,$3,$4,$5,'after',$6)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, job.jobId, foreignVersion, USER_A]
      )
    ).rejects.toThrow(/foreign key|violates/i);
  });

  it('S6 — a tenant-B caller sees none of tenant A’s evidence', async () => {
    const mine = await seedJob();
    const versionId = await seedDocumentVersion();
    authAs(FULL);
    await recordEvidence(mine.jobId, { documentVersionId: versionId, evidenceType: 'after' });

    authAs(TENANT_B_FULL);
    const read = await listJobEvidence(mine.jobId);
    expect([403, 404]).toContain(read.status);
    expect(JSON.stringify(await read.json())).not.toContain(versionId);
  });

  it('N11/N12 — append-only at the GRANT layer, with the row proved REACHABLE first', async () => {
    const job = await seedJob();
    const versionId = await seedDocumentVersion();
    authAs(FULL);
    const row = (await (
      await recordEvidence(job.jobId, { documentVersionId: versionId, evidenceType: 'after' })
    ).json()) as EvidenceRow;

    await asAppRuntime(async (client) => {
      const visible = await client.query(`SELECT id FROM wo.job_evidence WHERE id = $1`, [row.id]);
      expect(
        visible.rowCount,
        'app_runtime cannot see the row; the refusals below would be vacuous'
      ).toBe(1);

      // SAVEPOINTs, because a refused statement ABORTS the transaction and every
      // later statement would fail with "current transaction is aborted" — a
      // different error that would satisfy a /permission denied/ matcher only by
      // accident, making the DELETE case prove nothing.
      await client.query('SAVEPOINT attempt_update');
      await expect(
        client.query(`UPDATE wo.job_evidence SET evidence_type = 'tampered' WHERE id = $1`, [
          row.id,
        ])
      ).rejects.toThrow(/permission denied/i);
      await client.query('ROLLBACK TO SAVEPOINT attempt_update');

      await client.query('SAVEPOINT attempt_delete');
      await expect(
        client.query(`DELETE FROM wo.job_evidence WHERE id = $1`, [row.id])
      ).rejects.toThrow(/permission denied/i);
      await client.query('ROLLBACK TO SAVEPOINT attempt_delete');
    });

    const after = await admin.query<{ evidence_type: string }>(
      `SELECT evidence_type FROM wo.job_evidence WHERE id = $1`,
      [row.id]
    );
    expect(after.rows[0]?.evidence_type).toBe('after');
  });
});

describe('S5 — the shared refusal rule has ONE declaration', () => {
  it('no module re-declares the refused-state array', () => {
    /*
     * The contract records the constant as duplicated twice. It was duplicated
     * THREE times — diagnostics, work-order, and delivery under the different
     * name REFUSED_VERSION_STATES, which is why an identifier grep missed it and
     * a VALUE grep found it. This case greps the values, for that reason.
     */
    const root = join(process.cwd(), 'apps', 'api', 'src');
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!full.endsWith('.ts')) continue;
        const source = readFileSync(full, 'utf8');
        // Comments stripped: the authoritative definition's own header QUOTES the
        // literal to explain the history, and prose must not trip a code check.
        const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        if (/Object\.freeze\(\s*\[\s*'rejected',\s*'quarantined',?\s*\]\s*\)/.test(code)) {
          hits.push(full.replace(root, '').replace(/\\/g, '/'));
        }
      }
    };
    walk(root);
    expect(hits, 'the refusal rule must be declared exactly once').toEqual([
      '/modules/shared-services/domain/attachment-policy.ts',
    ]);
  });

  it('this slice adds no upload route and no storage call', () => {
    // "No second media subsystem" is a Definition-of-Done item, so it is measured
    // rather than asserted in prose.
    for (const file of [
      'apps/api/src/app/api/v1/jobs/[jobId]/evidence/route.ts',
      'apps/api/src/app/api/v1/work-orders/[workOrderId]/evidence/route.ts',
    ]) {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const forbidden of ['s3', 'S3Storage', 'buildStorageKey', 'connect-src', 'PutObject']) {
        expect(code.includes(forbidden), `${file} reaches for ${forbidden}`).toBe(false);
      }
    }
  });
});
