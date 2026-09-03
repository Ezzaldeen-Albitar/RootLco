/**
 * P1-29 `W8` (Backend seam) — `qms.qc-check-list`, the QC check vocabulary.
 *
 * The quality and closure view cannot be built on the surface `develop`
 * carried, and this file says exactly why before it proves the read that
 * closes the gap:
 *
 *  1. **G1 — the gap, on real responses.** `qms.qc-record-detail` returns the
 *     record's RESULTS and `unresolvedMandatory` — the mandatory checks still
 *     open — and nothing names an OPTIONAL check until it is answered. With the
 *     P1-19 fixture (one mandatory check, one optional), a fresh record's
 *     detail names the mandatory check and not the optional one. If a later
 *     change enriches the detail this case goes red and the seam can be retired.
 *  2. **P1 — the vocabulary comes back by code**, in the resolution the gate
 *     applies (tenant shadowing platform), each row carrying its scope, status
 *     and version, and both fixture checks present with their mandatory flag.
 *  3. **N1 — an unknown query parameter is a 422**, not a silent ignore.
 *  4. **N2 — no `qms.quality_control.read`, no vocabulary** (403), and no grant.
 *  5. **S1 — another tenant does not see this tenant's rows.**
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   qms.qc-check-list: route service authorization success denial cross-tenant isolation
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  SUBJECT_UNPERMITTED,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import {
  FULL,
  QC_CHECK_MANDATORY,
  QC_CHECK_OPTIONAL,
  READER,
  TENANT_B_FULL,
  authAs,
  authAsSubject,
  createOpenWorkOrder,
  establishP1_19Fixtures,
  establishQualityFixtures,
} from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as LIST_CHECKS, QC_CHECK_LIST_OPERATION } from '@/app/api/v1/qc-checks/route';
import { POST as OPEN_QC } from '@/app/api/v1/work-orders/[workOrderId]/quality-controls/route';
import { GET as QC_DETAIL } from '@/app/api/v1/quality-controls/[recordId]/route';

let admin: Pool;
let runtime: Pool;
let mandatoryId: string;

const VOCABULARY_FIELDS = [
  'id',
  'scope',
  'code',
  'name',
  'isMandatory',
  'isSafetyCritical',
  'status',
  'recordVersion',
] as const;

interface CheckRow {
  readonly id: string;
  readonly scope: string;
  readonly code: string;
  readonly name: string;
  readonly isMandatory: boolean;
  readonly isSafetyCritical: boolean;
  readonly status: string;
  readonly recordVersion: number;
}
interface Items {
  readonly items: readonly CheckRow[];
}
interface Problem {
  readonly code?: string;
}

const json = <T>(response: Response): Promise<T> => response.json() as Promise<T>;

const listChecks = (query = ''): Promise<Response> =>
  LIST_CHECKS(new Request(`http://localhost/api/v1/qc-checks${query ? `?${query}` : ''}`));

/** A fresh QC record on an open work order, through the route the screen calls. */
async function seedQcRecord(): Promise<string> {
  const order = await createOpenWorkOrder();
  authAs(FULL);
  const opened = await OPEN_QC(
    new Request(`http://localhost/api/v1/work-orders/${order.workOrderId}/quality-controls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify({}),
    }),
    { params: Promise.resolve({ workOrderId: order.workOrderId }) }
  );
  if (opened.status !== 201) throw new Error(`fixture QC record failed with ${opened.status}`);
  return (await json<{ id: string }>(opened)).id;
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  runtime = runtimeAppPool(4);
  __setPrimaryPoolForTests(runtime);
  mandatoryId = (await establishQualityFixtures()).mandatoryId;
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

describe('qms.qc-check-list — the gap it closes, on real responses', () => {
  it('declares the id and authority the canonical record states', () => {
    expect(QC_CHECK_LIST_OPERATION.id).toBe('qms.qc-check-list');
    expect(QC_CHECK_LIST_OPERATION.permissions).toEqual(['qms.quality_control.read']);
    expect(QC_CHECK_LIST_OPERATION.method).toBe('GET');
    expect(QC_CHECK_LIST_OPERATION.path).toBe('/qc-checks');
  });

  it('G1 — a fresh record’s detail names the mandatory check and never the optional one', async () => {
    const recordId = await seedQcRecord();
    authAs(FULL);
    const detail = await QC_DETAIL(
      new Request(`http://localhost/api/v1/quality-controls/${recordId}`),
      {
        params: Promise.resolve({ recordId }),
      }
    );
    expect(detail.status).toBe(200);
    const body = await json<{
      readonly results: readonly unknown[];
      readonly unresolvedMandatory: readonly Record<string, unknown>[];
    }>(detail);
    expect(body.results).toEqual([]);
    const named = body.unresolvedMandatory.map((c) => c['code']);
    expect(named).toContain(QC_CHECK_MANDATORY);
    expect(named).not.toContain(QC_CHECK_OPTIONAL);
    expect(body.unresolvedMandatory.find((c) => c['code'] === QC_CHECK_MANDATORY)?.['id']).toBe(
      mandatoryId
    );
  });
});

describe('qms.qc-check-list — the read', () => {
  it('P1 — the vocabulary comes back by code, both fixture checks, full shape', async () => {
    authAs(FULL);
    const response = await listChecks();
    expect(response.status).toBe(200);
    const { items } = await json<Items>(response);
    const codes = items.map((row) => row.code);
    expect(codes).toEqual([...codes].sort());
    expect(new Set(codes).size).toBe(codes.length);
    const mandatory = items.find((row) => row.code === QC_CHECK_MANDATORY);
    const optional = items.find((row) => row.code === QC_CHECK_OPTIONAL);
    expect(mandatory?.isMandatory).toBe(true);
    expect(mandatory?.id).toBe(mandatoryId);
    expect(optional?.isMandatory).toBe(false);
    for (const row of items) {
      expect(Object.keys(row).sort()).toEqual([...VOCABULARY_FIELDS].sort());
      expect(['platform', 'tenant']).toContain(row.scope);
    }
  });

  it('N1 — an unknown query parameter is a 422, not a silent ignore', async () => {
    authAs(FULL);
    const response = await listChecks('limit=5');
    expect(response.status).toBe(422);
    expect((await json<Problem>(response)).code).toBe('ERR-VAL-001');
  });

  it('N2 — without qms.quality_control.read the read is refused, and so is no grant at all', async () => {
    authAs(READER);
    expect((await listChecks()).status).toBe(403);
    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await listChecks()).status).toBe(403);
  });

  it('S1 — another tenant does not see this tenant’s rows', async () => {
    authAs(TENANT_B_FULL);
    const response = await listChecks();
    expect(response.status).toBe(200);
    const { items } = await json<Items>(response);
    expect(items.find((row) => row.id === mandatoryId)).toBeUndefined();
  });
});
