/**
 * P1-32-PRE-OD-FD11 — the auditable acceptance record of a quotation revision
 * (ADR-023 D11), through the two shipped decision routes and the decisions read.
 *
 * What these cases hold the product to: the decision that completes an acceptance
 * writes exactly ONE record in its own transaction, with the recorder and the time
 * taken from the server, never the request; the contact is validated and
 * normalised before anything is written, and refused on a rejection; a replay —
 * the same idempotency key, or the same decision sent again — never writes a
 * second record, and a contact sent with a decision already recorded (a replay
 * with a new key, or a line another call decided meanwhile) is refused rather
 * than answered 201 and dropped; the same idempotency key returns the stored
 * response and writes nothing, which is correct; a rejection writes none; a per-line acceptance records the
 * contact of the decision that completed it, and a contact on a line approval
 * that does not complete the acceptance is refused with nothing written, rather
 * than accepted and stored nowhere; the record cannot be changed by the
 * runtime; the read publishes it with no id where a name belongs, and says
 * nothing (null) for a revision accepted before records existed; and another
 * tenant can neither read nor create one. No permission code is new: the routes
 * keep `quo.decision.record` and `quo.quotation.read`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import {
  BRANCH_A1,
  IDENTITY_PROVIDER,
  COMPANY_A1,
  TENANT_A,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { PARTNER_A, createOpenWorkOrder, establishP1_19Fixtures } from './p1-19-helpers';
import {
  SERVICE_A,
  SVC_FULL,
  SVC_PRICE_SETTER,
  SVC_TENANT_B_FULL,
  TAX_CLASS_A,
  assignPriceList,
  authAs,
  establishP1_20Fixtures,
  priceListVersionOf,
  seedLinkedDocumentVersion,
  type Principal,
} from './p1-20-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { POST as CREATE_LIST } from '@/app/api/v1/price-lists/route';
import { POST as CREATE_LIST_VERSION } from '@/app/api/v1/price-lists/[priceListId]/versions/route';
import { POST as RECORD_RULE } from '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/rules/route';
import { POST as PUBLISH_LIST } from '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/publication/route';
import { POST as CREATE_QUOTATION } from '@/app/api/v1/quotations/route';
import { POST as ISSUE } from '@/app/api/v1/quotations/[quotationId]/issue/route';
import {
  GET as REVISION_DECISIONS,
  POST as DECIDE_REVISION,
} from '@/app/api/v1/quotation-revisions/[revisionId]/decisions/route';
import { POST as DECIDE_ITEM } from '@/app/api/v1/quotation-items/[quotationItemId]/decisions/route';

let admin: Pool;
let runtime: Pool;
let workOrderId = '';
let codeSeq = 0;

const nextCode = (): string => {
  codeSeq += 1;
  return `FX-FD11-${String(Date.now() % 100000)}-${codeSeq}`;
};

const jsonPost = (url: string, payload: unknown, ifMatch?: number, key?: string): Request =>
  new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': key ?? crypto.randomUUID(),
      ...(ifMatch === undefined ? {} : { 'if-match': String(ifMatch) }),
    },
    body: JSON.stringify(payload),
  });

const json = async <T>(response: Response): Promise<T> => (await response.json()) as T;

interface Issued {
  readonly quotationId: string;
  readonly revisionId: string;
  readonly itemIds: readonly string[];
}

/** A fresh quotation for PARTNER_A with `lines` lines, issued. */
async function issuedQuotation(lines = 1): Promise<Issued> {
  authAs(SVC_FULL);
  const created = await CREATE_QUOTATION(
    jsonPost('http://localhost/api/v1/quotations', {
      workOrderId,
      payerPartnerRef: PARTNER_A,
      lines: Array.from({ length: lines }, () => ({ serviceId: SERVICE_A, quantity: '1.000' })),
    })
  );
  if (created.status !== 201) throw new Error(`fixture quotation refused: ${created.status}`);
  const quotation = await json<{
    id: string;
    recordVersion: number;
    currentRevision: { id: string; lines: { id: string }[] } | null;
  }>(created);
  const revisionId = quotation.currentRevision?.id ?? '';
  const issued = await ISSUE(
    jsonPost(
      `http://localhost/api/v1/quotations/${quotation.id}/issue`,
      { revisionId },
      quotation.recordVersion
    ),
    { params: Promise.resolve({ quotationId: quotation.id }) }
  );
  if (issued.status !== 200) throw new Error(`fixture issue refused: ${issued.status}`);
  return {
    quotationId: quotation.id,
    revisionId,
    itemIds: (quotation.currentRevision?.lines ?? []).map((line) => line.id),
  };
}

function decideRevision(revisionId: string, body: unknown, key?: string): Promise<Response> {
  return DECIDE_REVISION(
    jsonPost(
      `http://localhost/api/v1/quotation-revisions/${revisionId}/decisions`,
      body,
      undefined,
      key
    ),
    { params: Promise.resolve({ revisionId }) }
  );
}
function decideItem(itemId: string, body: unknown): Promise<Response> {
  return DECIDE_ITEM(
    jsonPost(`http://localhost/api/v1/quotation-items/${itemId}/decisions`, body),
    { params: Promise.resolve({ quotationItemId: itemId }) }
  );
}
function readDecisions(revisionId: string): Promise<Response> {
  return REVISION_DECISIONS(
    new Request(`http://localhost/api/v1/quotation-revisions/${revisionId}/decisions`),
    { params: Promise.resolve({ revisionId }) }
  );
}

interface StoredRecord {
  id: string;
  customer_partner_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  channel: string;
  evidence_kind: string | null;
  reference_note: string | null;
  evidence_document_version_id: string | null;
  recorded_by: string;
  accepted_at: Date;
}

async function recordsFor(revisionId: string): Promise<StoredRecord[]> {
  const result = await admin.query<StoredRecord>(
    `SELECT id, customer_partner_id, contact_name, contact_phone, channel, evidence_kind,
            reference_note, evidence_document_version_id, recorded_by, accepted_at
       FROM quo.acceptance_records WHERE quotation_revision_id = $1`,
    [revisionId]
  );
  return result.rows;
}

async function decisionCount(revisionId: string): Promise<number> {
  const result = await admin.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM quo.approval_decisions WHERE quotation_revision_id = $1`,
    [revisionId]
  );
  return result.rows[0]?.n ?? 0;
}

/** A published, assigned price list carrying one taxed rule for SERVICE_A. */
async function publishPrice(amount: string): Promise<void> {
  // An administrator sets and publishes the fixture price, so a quotation the suite
  // writes as SVC_FULL is not one whose writer set its price (ADR-023 D8).
  authAs(SVC_PRICE_SETTER);
  const list = await json<{ id: string; recordVersion: number }>(
    await CREATE_LIST(
      jsonPost('http://localhost/api/v1/price-lists', {
        priceListCode: nextCode(),
        name: 'FD11 fixture list',
        currency: 'JOD',
      })
    )
  );
  const version = await json<{ id: string }>(
    await CREATE_LIST_VERSION(
      jsonPost(
        `http://localhost/api/v1/price-lists/${list.id}/versions`,
        { effectiveFrom: '2020-01-01' },
        list.recordVersion
      ),
      { params: Promise.resolve({ priceListId: list.id }) }
    )
  );
  const rule = await RECORD_RULE(
    jsonPost(`http://localhost/api/v1/price-lists/${list.id}/versions/${version.id}/rules`, {
      serviceId: SERVICE_A,
      amount,
      companyId: COMPANY_A1,
      taxClassId: TAX_CLASS_A,
    }),
    { params: Promise.resolve({ priceListId: list.id, versionId: version.id }) }
  );
  if (rule.status !== 201) throw new Error(`fixture rule refused: ${rule.status}`);
  const published = await PUBLISH_LIST(
    jsonPost(
      `http://localhost/api/v1/price-lists/${list.id}/versions/${version.id}/publication`,
      { effectiveFrom: '2020-01-01' },
      await priceListVersionOf(list.id)
    ),
    { params: Promise.resolve({ priceListId: list.id, versionId: version.id }) }
  );
  if (published.status !== 200) throw new Error(`fixture publish refused: ${published.status}`);
  await assignPriceList({
    tenantId: TENANT_A,
    priceListId: list.id,
    companyId: COMPANY_A1,
    branchId: null,
    customerClass: null,
    priority: 700,
  });
  authAs(SVC_FULL);
}

/**
 * A reviewer who may read quotations AND users — the caller the identity directory
 * names people to. Seeded the way the P1-20 principals are; removed with the
 * fixture tenant.
 */
const REVIEWER: Principal = {
  roleId: 'fd110000-0000-4000-8000-0000000000a1',
  userId: 'fd110000-0000-4000-8000-0000000000a2',
  subject: 'fx_fd11_reviewer',
  tenantId: TENANT_A,
  permissions: ['quo.quotation.read', 'iam.user.read'],
};

async function seedReviewer(): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','FD11 Reviewer','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [REVIEWER.userId, TENANT_A, IDENTITY_PROVIDER, REVIEWER.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'FD11 fixture',$4) ON CONFLICT (id) DO NOTHING`,
    [REVIEWER.roleId, TENANT_A, REVIEWER.subject, USER_A]
  );
  for (const code of REVIEWER.permissions) {
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
        WHERE p.permission_code = $4
       ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
      [TENANT_A, REVIEWER.roleId, USER_A, code]
    );
  }
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     SELECT $1,$2,$3,'unrestricted',$4,$4
      WHERE NOT EXISTS (SELECT 1 FROM iam.role_grants
                         WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3)`,
    [TENANT_A, REVIEWER.userId, REVIEWER.roleId, USER_A]
  );
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_20Fixtures(admin);
  await seedReviewer();
  runtime = runtimeAppPool(8);
  __setPrimaryPoolForTests(runtime);
  await publishPrice('100.0000');
  workOrderId = (await createOpenWorkOrder()).workOrderId;
  __resetAuthenticatorForTests();
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

describe('an acceptance writes exactly one record, stamped by the server', () => {
  it('records who accepted, through whom, how, the reference, the recorder and the time', async () => {
    const q = await issuedQuotation();
    authAs(SVC_FULL);
    const decided = await decideRevision(q.revisionId, {
      decision: 'approved',
      channel: 'phone',
      decidingPartyRef: PARTNER_A,
      evidence: { evidenceKind: 'verbal', referenceNote: 'Call ref 42' },
      contactName: '  Sami Nasser ',
      // Arabic-Indic digits and spacing, normalised by the server.
      contactPhone: '+٩٦٢ ٧٩ ١٢٣ ٤٥٦٧',
      presentedRevisionId: q.revisionId,
    });
    expect(decided.status).toBe(201);

    const rows = await recordsFor(q.revisionId);
    expect(rows).toHaveLength(1);
    const row = rows[0] as StoredRecord;
    expect(row).toMatchObject({
      customer_partner_id: PARTNER_A,
      contact_name: 'Sami Nasser',
      contact_phone: '+962791234567',
      channel: 'phone',
      evidence_kind: 'verbal',
      reference_note: 'Call ref 42',
      evidence_document_version_id: null,
      // The signed-in user, never a value the request could carry.
      recorded_by: SVC_FULL.userId,
    });
    // The database's time of the very transaction that recorded the decisions.
    const decidedAt = await admin.query<{ decided_at: Date }>(
      `SELECT decided_at FROM quo.approval_decisions WHERE quotation_revision_id = $1`,
      [q.revisionId]
    );
    expect(row.accepted_at.toISOString()).toBe(decidedAt.rows[0]?.decided_at.toISOString());

    // The acceptance audit names the record — and only the record, never its contents.
    const details = await admin.query<{ field_name: string; new_value_masked: string | null }>(
      `SELECT d.field_name, d.new_value_masked
         FROM iam.audit_records r
         JOIN iam.audit_record_details d ON d.tenant_id = r.tenant_id AND d.audit_record_id = r.id
        WHERE r.action = 'quo.quotation.accepted' AND r.entity_id = $1`,
      [q.quotationId]
    );
    const fields = details.rows.map((d) => d.field_name);
    expect(fields).toContain('acceptanceRecordId');
    expect(JSON.stringify(details.rows)).not.toContain('Sami Nasser');
  });

  it('publishes the record on the decisions read, naming no one by id where a name belongs', async () => {
    const q = await issuedQuotation();
    authAs(SVC_FULL);
    expect(
      (
        await decideRevision(q.revisionId, {
          decision: 'approved',
          channel: 'in_person',
          contactName: 'Sami Nasser',
          presentedRevisionId: q.revisionId,
        })
      ).status
    ).toBe(201);
    const read = await readDecisions(q.revisionId);
    expect(read.status).toBe(200);
    const body = await json<{
      outcome: string;
      acceptance: Record<string, unknown> & {
        recordedBy: { id: string; displayName: string | null };
      };
    }>(read);
    expect(body.outcome).toBe('accepted');
    expect(body.acceptance).toMatchObject({
      quotationRevisionId: q.revisionId,
      // Not attributed to the payer: nothing is filled in for them.
      customerPartnerId: null,
      contactName: 'Sami Nasser',
      contactPhone: null,
      channel: 'in_person',
      evidenceKind: null,
      referenceNote: null,
      documentVersionId: null,
      recordedByCaller: true,
    });
    expect(body.acceptance.recordedBy.id).toBe(SVC_FULL.userId);
    // The caller holds no user-read permission, so the directory names nobody.
    expect(body.acceptance.recordedBy.displayName).toBeNull();
    expect(Number.isNaN(Date.parse(String(body.acceptance['acceptedAt'])))).toBe(false);
  });

  it('names the recorder to a caller who may read users', async () => {
    const q = await issuedQuotation();
    authAs(SVC_FULL);
    expect(
      (
        await decideRevision(q.revisionId, {
          decision: 'approved',
          channel: 'phone',
          presentedRevisionId: q.revisionId,
        })
      ).status
    ).toBe(201);
    authAs(REVIEWER);
    const read = await readDecisions(q.revisionId);
    expect(read.status).toBe(200);
    const body = await json<{
      acceptance: {
        recordedBy: { id: string; displayName: string | null };
        recordedByCaller: boolean;
      };
    }>(read);
    // The recorder's own account name, as the directory holds it.
    expect(body.acceptance.recordedBy).toEqual({
      id: SVC_FULL.userId,
      displayName: 'P1-20 Principal',
    });
    expect(body.acceptance.recordedByCaller).toBe(false);
  });

  it('keeps the document an acceptance rests on', async () => {
    const q = await issuedQuotation();
    const doc = await seedLinkedDocumentVersion({
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      linkedTo: { entityType: 'quo.quotations', entityId: q.quotationId },
      title: 'Signed acceptance letter',
    });
    authAs(SVC_FULL);
    const decided = await decideRevision(q.revisionId, {
      decision: 'approved',
      channel: 'email',
      evidence: { evidenceKind: 'document', documentVersionId: doc.versionId },
      presentedRevisionId: q.revisionId,
    });
    expect(decided.status).toBe(201);
    const [row] = await recordsFor(q.revisionId);
    expect(row?.evidence_kind).toBe('document');
    expect(row?.evidence_document_version_id).toBe(doc.versionId);
  });
});

describe('the contact is checked before anything is written', () => {
  it.each([
    [{ contactPhone: 'call me' }, 'contactPhone', 'invalid_phone'],
    [{ contactPhone: '12' }, 'contactPhone', 'invalid_phone'],
    [{ contactName: '   ' }, 'contactName', 'blank'],
  ])('refuses %j with a field violation and records nothing', async (contact, field, rule) => {
    const q = await issuedQuotation();
    authAs(SVC_FULL);
    const refused = await decideRevision(q.revisionId, {
      decision: 'approved',
      channel: 'phone',
      ...contact,
      presentedRevisionId: q.revisionId,
    });
    expect(refused.status).toBe(422);
    const problem = await json<{ violations?: { path: string; rule: string }[] }>(refused);
    expect(problem.violations).toEqual([{ path: `body.${field}`, rule }]);
    expect(await decisionCount(q.revisionId)).toBe(0);
    expect(await recordsFor(q.revisionId)).toHaveLength(0);
  });

  it('refuses a contact on a rejection rather than losing it', async () => {
    const q = await issuedQuotation();
    authAs(SVC_FULL);
    const refused = await decideRevision(q.revisionId, {
      decision: 'rejected',
      channel: 'phone',
      contactName: 'Sami Nasser',
      presentedRevisionId: q.revisionId,
    });
    expect(refused.status).toBe(422);
    const problem = await json<{ violations?: { path: string; rule: string }[] }>(refused);
    expect(problem.violations).toEqual([
      { path: 'body.contactName', rule: 'acceptance_contact_on_rejection' },
    ]);
    expect(await decisionCount(q.revisionId)).toBe(0);
  });

  it('refuses a name longer than the column at the route', async () => {
    const q = await issuedQuotation();
    authAs(SVC_FULL);
    const refused = await decideRevision(q.revisionId, {
      decision: 'approved',
      channel: 'phone',
      contactName: 'x'.repeat(201),
      presentedRevisionId: q.revisionId,
    });
    expect(refused.status).toBe(422);
    expect(await recordsFor(q.revisionId)).toHaveLength(0);
  });
});

describe('a replay never writes a second record', () => {
  it('the same idempotency key answers as before and writes nothing more', async () => {
    const q = await issuedQuotation();
    authAs(SVC_FULL);
    const key = crypto.randomUUID();
    const body = {
      decision: 'approved',
      channel: 'phone',
      contactName: 'Sami Nasser',
      presentedRevisionId: q.revisionId,
    };
    const first = await decideRevision(q.revisionId, body, key);
    expect(first.status).toBe(201);
    const recorded = await first.json();
    // The replay answers with the recorded body, under the 200 every replayed write
    // answers with, and executes nothing.
    const again = await decideRevision(q.revisionId, body, key);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(recorded);
    expect(await recordsFor(q.revisionId)).toHaveLength(1);
  });

  it('the same decision sent again with a new key and a different contact is refused, and the first record stands', async () => {
    const q = await issuedQuotation();
    authAs(SVC_FULL);
    const first = await decideRevision(q.revisionId, {
      decision: 'approved',
      channel: 'phone',
      contactName: 'Sami Nasser',
      presentedRevisionId: q.revisionId,
    });
    expect(first.status).toBe(201);
    const [before] = await recordsFor(q.revisionId);
    const decisionsBefore = await decisionCount(q.revisionId);
    // Every line is already decided, so this call writes no line and no record: the
    // contact would be answered 201 and kept nowhere. It is refused instead.
    const again = await decideRevision(q.revisionId, {
      decision: 'approved',
      channel: 'email',
      contactName: 'Someone Else',
      presentedRevisionId: q.revisionId,
    });
    expect(again.status).toBe(422);
    expect(
      (await json<{ violations?: { path: string; rule: string }[] }>(again)).violations
    ).toEqual([{ path: 'body.contactName', rule: 'acceptance_contact_already_recorded' }]);
    expect(await decisionCount(q.revisionId)).toBe(decisionsBefore);
    expect(await recordsFor(q.revisionId)).toEqual([before]);
    // The same replay with no contact still settles as before.
    const settled = await decideRevision(q.revisionId, {
      decision: 'approved',
      channel: 'email',
      presentedRevisionId: q.revisionId,
    });
    expect(settled.status).toBe(201);
    expect(await recordsFor(q.revisionId)).toEqual([before]);
  });

  it('a contact on a line another call decided meanwhile is refused, and that call’s record stands', async () => {
    const q = await issuedQuotation(2);
    authAs(SVC_FULL);
    const [first, second] = q.itemIds as [string, string];
    expect(
      (
        await decideItem(first, {
          decision: 'approved',
          channel: 'phone',
          presentedRevisionId: q.revisionId,
        })
      ).status
    ).toBe(201);
    // Another operator approves the last open line with no contact, which completes
    // the acceptance and writes the record.
    expect(
      (
        await decideItem(second, {
          decision: 'approved',
          channel: 'phone',
          presentedRevisionId: q.revisionId,
        })
      ).status
    ).toBe(201);
    const [before] = await recordsFor(q.revisionId);
    expect(before).toMatchObject({ contact_name: null, contact_phone: null });
    // The first operator's screen still showed that line open and sends its contact.
    const refused = await decideItem(second, {
      decision: 'approved',
      channel: 'phone',
      contactName: 'Late Caller',
      contactPhone: '0791234567',
      presentedRevisionId: q.revisionId,
    });
    expect(refused.status).toBe(422);
    expect(
      (await json<{ violations?: { path: string; rule: string }[] }>(refused)).violations
    ).toEqual([{ path: 'body.contactName', rule: 'acceptance_contact_already_recorded' }]);
    expect(await decisionCount(q.revisionId)).toBe(2);
    expect(await recordsFor(q.revisionId)).toEqual([before]);
  });
});

describe('only an acceptance writes a record', () => {
  it('a rejection writes none', async () => {
    const q = await issuedQuotation();
    authAs(SVC_FULL);
    const decided = await decideRevision(q.revisionId, {
      decision: 'rejected',
      channel: 'phone',
      presentedRevisionId: q.revisionId,
    });
    expect(decided.status).toBe(201);
    expect(await recordsFor(q.revisionId)).toHaveLength(0);
    const body = await json<{ outcome: string; acceptance: unknown }>(
      await readDecisions(q.revisionId)
    );
    expect(body.outcome).toBe('rejected');
    expect(body.acceptance).toBeNull();
  });

  it('line by line, a contact on an approval that does not complete is refused, and the completing one supplies it', async () => {
    const q = await issuedQuotation(2);
    authAs(SVC_FULL);
    const [first, second] = q.itemIds as [string, string];
    // One line would still be open, so no record would be written: a contact given
    // here would be answered 201 and stored nowhere. It is refused, and nothing
    // is written.
    const refused = await decideItem(first, {
      decision: 'approved',
      channel: 'phone',
      contactName: 'First Caller',
      presentedRevisionId: q.revisionId,
    });
    expect(refused.status).toBe(422);
    const problem = await json<{ violations?: { path: string; rule: string }[] }>(refused);
    expect(problem.violations).toEqual([
      { path: 'body.contactName', rule: 'acceptance_contact_not_completing' },
    ]);
    expect(await decisionCount(q.revisionId)).toBe(0);
    expect(await recordsFor(q.revisionId)).toHaveLength(0);
    // A telephone number alone is refused the same way.
    const refusedPhone = await decideItem(first, {
      decision: 'approved',
      channel: 'phone',
      contactPhone: '0791234567',
      presentedRevisionId: q.revisionId,
    });
    expect(refusedPhone.status).toBe(422);
    expect(
      (await json<{ violations?: { path: string; rule: string }[] }>(refusedPhone)).violations
    ).toEqual([{ path: 'body.contactPhone', rule: 'acceptance_contact_not_completing' }]);
    expect(await decisionCount(q.revisionId)).toBe(0);

    expect(
      (
        await decideItem(first, {
          decision: 'approved',
          channel: 'phone',
          presentedRevisionId: q.revisionId,
        })
      ).status
    ).toBe(201);
    // One line still open: not accepted, so no record yet.
    expect(await recordsFor(q.revisionId)).toHaveLength(0);
    expect(
      (
        await decideItem(second, {
          decision: 'approved',
          channel: 'email',
          contactName: 'Second Caller',
          contactPhone: '0791234567',
          presentedRevisionId: q.revisionId,
        })
      ).status
    ).toBe(201);
    const rows = await recordsFor(q.revisionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      contact_name: 'Second Caller',
      contact_phone: '0791234567',
      channel: 'email',
    });
  });
});

describe('the record is immutable and its tenant’s own', () => {
  it('the application role can neither change nor remove a record', async () => {
    const q = await issuedQuotation();
    authAs(SVC_FULL);
    await decideRevision(q.revisionId, {
      decision: 'approved',
      channel: 'phone',
      presentedRevisionId: q.revisionId,
    });
    const [row] = await recordsFor(q.revisionId);
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_A]);
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [SVC_FULL.userId]);
      await expect(
        client.query(`UPDATE quo.acceptance_records SET contact_name = 'X' WHERE id = $1`, [
          row?.id,
        ])
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    const again = await runtime.connect();
    try {
      await again.query('BEGIN');
      await again.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_A]);
      await expect(
        again.query(`DELETE FROM quo.acceptance_records WHERE id = $1`, [row?.id])
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await again.query('ROLLBACK');
      again.release();
    }
    expect(await recordsFor(q.revisionId)).toEqual([row]);
  });

  it('another tenant cannot read the record nor decide the revision', async () => {
    const q = await issuedQuotation();
    authAs(SVC_FULL);
    await decideRevision(q.revisionId, {
      decision: 'approved',
      channel: 'phone',
      contactName: 'Sami Nasser',
      presentedRevisionId: q.revisionId,
    });
    authAs(SVC_TENANT_B_FULL);
    const read = await readDecisions(q.revisionId);
    expect([403, 404]).toContain(read.status);
    expect(JSON.stringify(await read.json())).not.toContain('Sami Nasser');
    const other = await issuedQuotation();
    authAs(SVC_TENANT_B_FULL);
    const decided = await decideRevision(other.revisionId, {
      decision: 'approved',
      channel: 'phone',
      contactName: 'Intruder',
      presentedRevisionId: other.revisionId,
    });
    expect([403, 404]).toContain(decided.status);
    expect(await recordsFor(other.revisionId)).toHaveLength(0);
  });

  it('an acceptance recorded before records existed reads as accepted with no record', async () => {
    const q = await issuedQuotation();
    authAs(SVC_FULL);
    await decideRevision(q.revisionId, {
      decision: 'approved',
      channel: 'phone',
      presentedRevisionId: q.revisionId,
    });
    // Stand in for history: remove the record as a pre-existing acceptance never had one.
    await admin.query(`DELETE FROM quo.acceptance_records WHERE quotation_revision_id = $1`, [
      q.revisionId,
    ]);
    const body = await json<{ outcome: string; acceptance: unknown }>(
      await readDecisions(q.revisionId)
    );
    expect(body.outcome).toBe('accepted');
    expect(body.acceptance).toBeNull();
    // A later replay of the acceptance does not backfill one.
    await decideRevision(q.revisionId, {
      decision: 'approved',
      channel: 'phone',
      contactName: 'Invented Later',
      presentedRevisionId: q.revisionId,
    });
    expect(await recordsFor(q.revisionId)).toHaveLength(0);
  });
});
