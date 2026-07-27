/**
 * Additional-work quotation linkage (Phase 1-20, P1-20-BE-013).
 *
 * The commercial approval and the operational approval must agree, and there must
 * be exactly ONE approval truth. `quo.approval_decisions` holds the customer's
 * decision; `wo.customer_approvals.quotation_revision_ref` holds only a reference to
 * the revision that decision was about.
 *
 * The reference is set at INSERT and only at INSERT, because
 * `tg_customer_approvals_immutable` freezes the column — so every validation has to
 * happen before the approval row exists, and a refusal must leave no partial state
 * on either side.
 *
 * Each case below is a way the two approvals could disagree:
 *
 *  - a quotation for a DIFFERENT work order clearing this one;
 *  - a revision from another company or branch;
 *  - a SUPERSEDED revision, which is not what the customer is being asked about;
 *  - a DRAFT revision, never presented;
 *  - an EXPIRED revision, which authorizes nothing;
 *  - a REJECTED revision releasing work the customer declined;
 *  - a revision still AWAITING decisions.
 *
 * ## What this block does and does not claim
 *
 * `wo.additional-work-approval` is a P1-19 operation and its evidence is
 * `tests/backend/p1-19-customer-approvals.test.ts`, which the coverage manifest names.
 * This file is NOT in that entry: it adds the P1-20 LINK cases on top, and the flags
 * below are only what this file itself proves.
 *
 * The block previously copied P1-19's full flag list — authorization, isolation,
 * cross-tenant, audit, outbox, stale-version, rollback — none of which exists here:
 * every `approve()` call uses `authAsWo(FULL)` with the correct `recordVersion`, the
 * file contains no `auditCountFor` or `outboxCountFor`, and its `approvalCount(...) === 0`
 * assertions follow refusals its own header says happen *before the approval row
 * exists*, which is a pre-check and not a rollback. The block was inert only because
 * the manifest does not name this file; adding it would have credited seven flags that
 * are not here. Copying another suite's declarations is how a gate stops measuring.
 *
 * ## Who may cite a revision
 *
 * Citing one requires `quo.quotation.read` in the request's own company and branch,
 * checked inside `assertLinkableQuotationRevision`. It is NOT declared on the
 * operation: `permissions` is a conjunction, so declaring it would force every P1-19
 * caller recording an approval *without* a quotation to hold a commercial permission
 * too. So the linking cases below authenticate as
 * `WO_APPROVER_WITH_QUOTATION_READ` — P1-19's approval authority plus that one read —
 * and `WO_APPROVER_NO_QUOTATION_READ`, one permission apart, proves the refusal.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   wo.additional-work-approval: route service success denial authorization
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  COMPANY_A1,
  TENANT_A,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import {
  FULL,
  PARTNER_A,
  createOpenWorkOrder,
  establishP1_19Fixtures,
  partyRoleFor,
  authAs as authAsWo,
} from './p1-19-helpers';
import {
  SERVICE_A,
  SVC_FULL,
  WO_APPROVER_NO_QUOTATION_READ,
  WO_APPROVER_WITH_QUOTATION_READ,
  TAX_CLASS_A,
  assignPriceList,
  auditCountFor,
  authAs,
  establishP1_20Fixtures,
  priceListVersionOf,
  seedDiscountCeiling,
} from './p1-20-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { POST as CREATE_LIST } from '@/app/api/v1/price-lists/route';
import { POST as CREATE_PL_VERSION } from '@/app/api/v1/price-lists/[priceListId]/versions/route';
import { POST as RECORD_RULE } from '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/rules/route';
import { POST as PUBLISH } from '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/publication/route';
import { POST as CREATE_QUOTATION } from '@/app/api/v1/quotations/route';
import { GET as QUOTATION_DETAIL } from '@/app/api/v1/quotations/[quotationId]/route';
import { POST as CREATE_REVISION } from '@/app/api/v1/quotations/[quotationId]/revisions/route';
import { POST as ISSUE } from '@/app/api/v1/quotations/[quotationId]/issue/route';
import { POST as DECIDE_REVISION } from '@/app/api/v1/quotation-revisions/[revisionId]/decisions/route';
import { POST as RAISE } from '@/app/api/v1/work-orders/[workOrderId]/additional-work/route';
import { POST as CREATE_JOB } from '@/app/api/v1/work-orders/[workOrderId]/jobs/route';
import { POST as APPROVE } from '@/app/api/v1/additional-work/[requestId]/approval/route';

let admin: Pool;
let runtime: Pool;
let codeSeq = 0;
let assignmentPriority = 300;

const nextCode = (): string => {
  codeSeq += 1;
  return `FX-AW-${String(Date.now() % 100000)}-${codeSeq}`;
};

const jsonPost = (url: string, body: unknown, ifMatch?: number): Request =>
  new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
      ...(ifMatch === undefined ? {} : { 'if-match': String(ifMatch) }),
    },
    body: JSON.stringify(body),
  });

interface Quotation {
  readonly id: string;
  readonly recordVersion: number;
  readonly currentRevisionId: string | null;
  readonly currentRevision: { readonly id: string } | null;
}

/** Publishes a price for SERVICE_A and assigns it at a fresh priority. */
async function publishPrice(amount: string): Promise<void> {
  authAs(SVC_FULL);
  const list = (await (
    await CREATE_LIST(
      jsonPost('http://localhost/api/v1/price-lists', {
        priceListCode: nextCode(),
        name: 'Link fixture',
        currency: 'JOD',
      })
    )
  ).json()) as { id: string; recordVersion: number };
  const version = (await (
    await CREATE_PL_VERSION(
      jsonPost('http://localhost/x', { effectiveFrom: '2020-01-01' }, list.recordVersion),
      { params: Promise.resolve({ priceListId: list.id }) }
    )
  ).json()) as { id: string };
  await RECORD_RULE(
    jsonPost('http://localhost/x', {
      serviceId: SERVICE_A,
      amount,
      companyId: COMPANY_A1,
      taxClassId: TAX_CLASS_A,
    }),
    { params: Promise.resolve({ priceListId: list.id, versionId: version.id }) }
  );
  await PUBLISH(
    jsonPost(
      'http://localhost/x',
      { effectiveFrom: '2020-01-01' },
      await priceListVersionOf(list.id)
    ),
    { params: Promise.resolve({ priceListId: list.id, versionId: version.id }) }
  );
  assignmentPriority += 1;
  await assignPriceList({
    tenantId: TENANT_A,
    priceListId: list.id,
    companyId: COMPANY_A1,
    branchId: null,
    customerClass: null,
    priority: assignmentPriority,
  });
}

/** A quotation on a given work order, with one line. */
async function quoteFor(workOrderId: string): Promise<Quotation> {
  authAs(SVC_FULL);
  const response = await CREATE_QUOTATION(
    jsonPost('http://localhost/api/v1/quotations', {
      workOrderId,
      payerPartnerRef: PARTNER_A,
      lines: [{ serviceId: SERVICE_A, quantity: '1.000' }],
    })
  );
  expect(response.status).toBe(201);
  return (await response.json()) as Quotation;
}

async function rereadQuotation(quotationId: string): Promise<Quotation> {
  authAs(SVC_FULL);
  return (await (
    await QUOTATION_DETAIL(new Request(`http://localhost/api/v1/quotations/${quotationId}`), {
      params: Promise.resolve({ quotationId }),
    })
  ).json()) as Quotation;
}

async function issueQuotation(q: Quotation, expiresAt?: string): Promise<string> {
  authAs(SVC_FULL);
  const revisionId = q.currentRevision?.id as string;
  const response = await ISSUE(
    jsonPost(
      `http://localhost/api/v1/quotations/${q.id}/issue`,
      { revisionId, ...(expiresAt === undefined ? {} : { expiresAt }) },
      q.recordVersion
    ),
    { params: Promise.resolve({ quotationId: q.id }) }
  );
  expect(response.status).toBe(200);
  return revisionId;
}

async function acceptRevision(revisionId: string): Promise<void> {
  authAs(SVC_FULL);
  const response = await DECIDE_REVISION(
    jsonPost(`http://localhost/api/v1/quotation-revisions/${revisionId}/decisions`, {
      decision: 'approved',
      channel: 'in_person',
      decidingPartyRef: PARTNER_A,
      presentedRevisionId: revisionId,
    }),
    { params: Promise.resolve({ revisionId }) }
  );
  expect(response.status).toBe(201);
}

async function rejectRevision(revisionId: string): Promise<void> {
  authAs(SVC_FULL);
  const response = await DECIDE_REVISION(
    jsonPost(`http://localhost/api/v1/quotation-revisions/${revisionId}/decisions`, {
      decision: 'rejected',
      channel: 'phone',
      presentedRevisionId: revisionId,
    }),
    { params: Promise.resolve({ revisionId }) }
  );
  expect(response.status).toBe(201);
}

/**
 * Raises an additional-work request, with a real originating job.
 *
 * The origin is REQUIRED by the P1-19 service - a request whose provenance is
 * unrecorded cannot be traced to what discovered it - so the fixture creates a job
 * first. Passing neither a job nor a finding is a 422, and reading recordVersion off
 * that failed body produced an If-Match of "undefined" and a 428 that looked
 * nothing like the real cause.
 */
async function raiseRequest(workOrderId: string): Promise<{ id: string; recordVersion: number }> {
  authAsWo(FULL);
  const job = await CREATE_JOB(
    jsonPost(`http://localhost/api/v1/work-orders/${workOrderId}/jobs`, {
      title: 'Brake inspection',
    }),
    { params: Promise.resolve({ workOrderId }) }
  );
  expect(job.status).toBe(201);
  const jobId = ((await job.json()) as { id: string }).id;

  authAsWo(FULL);
  const response = await RAISE(
    jsonPost(`http://localhost/api/v1/work-orders/${workOrderId}/additional-work`, {
      summary: 'Replace the worn brake discs',
      isRequired: true,
      originatingJobId: jobId,
    }),
    { params: Promise.resolve({ workOrderId }) }
  );
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; recordVersion: number };
}

function approve(requestId: string, body: unknown, ifMatch: number): Promise<Response> {
  return APPROVE(
    jsonPost(`http://localhost/api/v1/additional-work/${requestId}/approval`, body, ifMatch),
    { params: Promise.resolve({ requestId }) }
  );
}

async function storedRef(requestId: string): Promise<string | null | undefined> {
  const result = await admin.query<{ quotation_revision_ref: string | null }>(
    `SELECT quotation_revision_ref FROM wo.customer_approvals
      WHERE additional_work_request_id = $1`,
    [requestId]
  );
  return result.rows[0]?.quotation_revision_ref;
}

/** The approval row's id, which the link audit record is filed against. */
async function approvalIdFor(requestId: string): Promise<string> {
  const result = await admin.query<{ id: string }>(
    `SELECT id::text AS id FROM wo.customer_approvals
      WHERE additional_work_request_id = $1 AND deleted_at IS NULL`,
    [requestId]
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error(`no approval row for request ${requestId}`);
  return id;
}

async function approvalCount(requestId: string): Promise<number> {
  const result = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM wo.customer_approvals
      WHERE additional_work_request_id = $1`,
    [requestId]
  );
  return Number.parseInt(result.rows[0]?.n ?? '0', 10);
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_20Fixtures(admin);
  runtime = runtimeAppPool(8);
  __setPrimaryPoolForTests(runtime);
  await seedDiscountCeiling({
    tenantId: TENANT_A,
    companyId: COMPANY_A1,
    roleId: SVC_FULL.roleId,
    amount: '9999.0000',
    currencyCode: 'JOD',
  });
  await publishPrice('100.0000');
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

describe('P1-20-BE-013 — the accepted commercial scope clears the operational gate', () => {
  it('links an ACCEPTED revision to the approval, on the same work order', async () => {
    const order = await createOpenWorkOrder();
    const request = await raiseRequest(order.workOrderId);
    const quotation = await quoteFor(order.workOrderId);
    const revisionId = await issueQuotation(quotation);
    await acceptRevision(revisionId);

    const roleId = await partyRoleFor(order.visitId);
    authAs(WO_APPROVER_WITH_QUOTATION_READ);
    const response = await approve(
      request.id,
      {
        decision: 'approved',
        channel: 'in_person',
        decidingPartyRoleId: roleId,
        presentedScope: 'Replace the worn brake discs — JOD 110.0000',
        quotationRevisionRef: revisionId,
      },
      request.recordVersion
    );
    expect(response.status).toBe(201);

    // The reference is stored, and it is the revision the customer accepted.
    expect(await storedRef(request.id)).toBe(revisionId);
  });

  it('permits an approval with NO quotation reference, because the column is nullable', async () => {
    // A verbal approval of obviously-required work is a real workflow; the link is
    // optional by design and its absence must not be an error.
    const order = await createOpenWorkOrder();
    const request = await raiseRequest(order.workOrderId);
    const roleId = await partyRoleFor(order.visitId);
    authAs(WO_APPROVER_WITH_QUOTATION_READ);
    const response = await approve(
      request.id,
      {
        decision: 'approved',
        channel: 'phone',
        decidingPartyRoleId: roleId,
        presentedScope: 'Verbally approved, no priced quotation',
      },
      request.recordVersion
    );
    expect(response.status).toBe(201);
    expect(await storedRef(request.id)).toBeNull();
  });
});

describe('P1-20-BE-013 — a quotation that does not justify the work clears nothing', () => {
  /** Builds a request plus an accepted quotation on a DIFFERENT work order. */
  async function crossOrderSetup(): Promise<{
    requestId: string;
    version: number;
    roleId: string;
    otherRevisionId: string;
  }> {
    const order = await createOpenWorkOrder();
    const other = await createOpenWorkOrder();
    const request = await raiseRequest(order.workOrderId);
    const otherQuotation = await quoteFor(other.workOrderId);
    const otherRevisionId = await issueQuotation(otherQuotation);
    await acceptRevision(otherRevisionId);
    return {
      requestId: request.id,
      version: request.recordVersion,
      roleId: await partyRoleFor(order.visitId),
      otherRevisionId,
    };
  }

  it('refuses a revision belonging to another work order', async () => {
    const setup = await crossOrderSetup();
    authAs(WO_APPROVER_WITH_QUOTATION_READ);
    const response = await approve(
      setup.requestId,
      {
        decision: 'approved',
        channel: 'in_person',
        decidingPartyRoleId: setup.roleId,
        presentedScope: 'Someone else’s quotation',
        quotationRevisionRef: setup.otherRevisionId,
      },
      setup.version
    );
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-VAL-001');
    // Nothing partial: no approval row at all, so the request is still decidable.
    expect(await approvalCount(setup.requestId)).toBe(0);
  });

  it('refuses a REJECTED revision, so declined work is never released', async () => {
    const order = await createOpenWorkOrder();
    const request = await raiseRequest(order.workOrderId);
    const quotation = await quoteFor(order.workOrderId);
    const revisionId = await issueQuotation(quotation);
    await rejectRevision(revisionId);

    const roleId = await partyRoleFor(order.visitId);
    authAs(WO_APPROVER_WITH_QUOTATION_READ);
    const response = await approve(
      request.id,
      {
        decision: 'approved',
        channel: 'in_person',
        decidingPartyRoleId: roleId,
        presentedScope: 'Customer said no',
        quotationRevisionRef: revisionId,
      },
      request.recordVersion
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-TRN-001');
    expect(await approvalCount(request.id)).toBe(0);
  });

  it('refuses a revision still AWAITING decisions', async () => {
    const order = await createOpenWorkOrder();
    const request = await raiseRequest(order.workOrderId);
    const quotation = await quoteFor(order.workOrderId);
    const revisionId = await issueQuotation(quotation);
    // Issued but undecided: the customer has been shown it and said nothing.

    const roleId = await partyRoleFor(order.visitId);
    authAs(WO_APPROVER_WITH_QUOTATION_READ);
    const response = await approve(
      request.id,
      {
        decision: 'approved',
        channel: 'portal',
        decidingPartyRoleId: roleId,
        presentedScope: 'Not yet decided',
        quotationRevisionRef: revisionId,
      },
      request.recordVersion
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-TRN-001');
    expect(await approvalCount(request.id)).toBe(0);
  });

  it('refuses a DRAFT revision, which was never presented', async () => {
    const order = await createOpenWorkOrder();
    const request = await raiseRequest(order.workOrderId);
    const quotation = await quoteFor(order.workOrderId);
    const draftRevisionId = quotation.currentRevision?.id as string;

    const roleId = await partyRoleFor(order.visitId);
    authAs(WO_APPROVER_WITH_QUOTATION_READ);
    const response = await approve(
      request.id,
      {
        decision: 'approved',
        channel: 'in_person',
        decidingPartyRoleId: roleId,
        presentedScope: 'A draft',
        quotationRevisionRef: draftRevisionId,
      },
      request.recordVersion
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await approvalCount(request.id)).toBe(0);
  });

  it('refuses a SUPERSEDED revision', async () => {
    const order = await createOpenWorkOrder();
    const request = await raiseRequest(order.workOrderId);
    const quotation = await quoteFor(order.workOrderId);
    const first = await issueQuotation(quotation);

    // Revise and issue again: `first` is now superseded.
    const afterFirst = await rereadQuotation(quotation.id);
    authAs(SVC_FULL);
    const second = (await (
      await CREATE_REVISION(
        jsonPost(
          `http://localhost/api/v1/quotations/${quotation.id}/revisions`,
          { lines: [{ serviceId: SERVICE_A, quantity: '2.000' }] },
          afterFirst.recordVersion
        ),
        { params: Promise.resolve({ quotationId: quotation.id }) }
      )
    ).json()) as { id: string };
    const afterRevise = await rereadQuotation(quotation.id);
    authAs(SVC_FULL);
    await ISSUE(
      jsonPost(
        `http://localhost/api/v1/quotations/${quotation.id}/issue`,
        { revisionId: second.id },
        afterRevise.recordVersion
      ),
      { params: Promise.resolve({ quotationId: quotation.id }) }
    );
    await acceptRevision(second.id);

    const roleId = await partyRoleFor(order.visitId);
    authAs(WO_APPROVER_WITH_QUOTATION_READ);
    const response = await approve(
      request.id,
      {
        decision: 'approved',
        channel: 'in_person',
        decidingPartyRoleId: roleId,
        presentedScope: 'The old revision',
        quotationRevisionRef: first,
      },
      request.recordVersion
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-CON-001');
    expect(await approvalCount(request.id)).toBe(0);

    // The CURRENT accepted revision does clear it.
    authAs(WO_APPROVER_WITH_QUOTATION_READ);
    const accepted = await approve(
      request.id,
      {
        decision: 'approved',
        channel: 'in_person',
        decidingPartyRoleId: roleId,
        presentedScope: 'The current revision',
        quotationRevisionRef: second.id,
      },
      request.recordVersion
    );
    expect(accepted.status).toBe(201);
    expect(await storedRef(request.id)).toBe(second.id);
  });

  it('refuses an EXPIRED revision', async () => {
    const order = await createOpenWorkOrder();
    const request = await raiseRequest(order.workOrderId);
    const quotation = await quoteFor(order.workOrderId);
    // Issue with a short expiry, then let the database clock pass it.
    const revisionId = await issueQuotation(quotation, new Date(Date.now() + 1_000).toISOString());
    await acceptRevision(revisionId);
    // Force the lapse rather than sleeping: expiry is compared against now().
    await admin.query(
      `UPDATE quo.quotation_revisions SET expires_at = now() - interval '1 hour' WHERE id = $1`,
      [revisionId]
    );

    const roleId = await partyRoleFor(order.visitId);
    authAs(WO_APPROVER_WITH_QUOTATION_READ);
    const response = await approve(
      request.id,
      {
        decision: 'approved',
        channel: 'in_person',
        decidingPartyRoleId: roleId,
        presentedScope: 'A lapsed quotation',
        quotationRevisionRef: revisionId,
      },
      request.recordVersion
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-TRN-001');
    expect(await approvalCount(request.id)).toBe(0);
  });

  it('refuses an unknown revision id without disclosing whether it exists', async () => {
    const order = await createOpenWorkOrder();
    const request = await raiseRequest(order.workOrderId);
    const roleId = await partyRoleFor(order.visitId);
    authAs(WO_APPROVER_WITH_QUOTATION_READ);
    const response = await approve(
      request.id,
      {
        decision: 'approved',
        channel: 'in_person',
        decidingPartyRoleId: roleId,
        presentedScope: 'Invented reference',
        quotationRevisionRef: '00000000-0000-4000-8000-0000000000cc',
      },
      request.recordVersion
    );
    expect(response.status).toBe(404);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-RES-001');
    expect(await approvalCount(request.id)).toBe(0);
  });
});

describe('P1-20-BE-013 — there is one approval truth', () => {
  it('stores only a REFERENCE; the decision itself stays in quo.approval_decisions', async () => {
    const order = await createOpenWorkOrder();
    const request = await raiseRequest(order.workOrderId);
    const quotation = await quoteFor(order.workOrderId);
    const revisionId = await issueQuotation(quotation);
    await acceptRevision(revisionId);

    const roleId = await partyRoleFor(order.visitId);

    /**
     * The same approval, WITHOUT `quo.quotation.read`, is refused first.
     *
     * `WO_APPROVER_NO_QUOTATION_READ` is one permission apart from the principal that
     * succeeds below: same tenant, same branch, same `wo.additional_work.approve`. So
     * this 403 can only be the commercial read, which is the control's whole point —
     * without it, `wo.additional_work.approve` alone let a caller learn a revision's
     * acceptance state, currency and total from the refusal messages this file asserts.
     */
    authAs(WO_APPROVER_NO_QUOTATION_READ);
    const withoutRead = await approve(
      request.id,
      {
        decision: 'approved',
        channel: 'in_person',
        decidingPartyRoleId: roleId,
        presentedScope: 'Linked',
        quotationRevisionRef: revisionId,
      },
      request.recordVersion
    );
    expect(withoutRead.status).toBe(403);
    expect(((await withoutRead.json()) as { code: string }).code).toBe('ERR-IAM-001');
    expect(await approvalCount(request.id)).toBe(0);

    authAs(WO_APPROVER_WITH_QUOTATION_READ);
    expect(
      (
        await approve(
          request.id,
          {
            decision: 'approved',
            channel: 'in_person',
            decidingPartyRoleId: roleId,
            presentedScope: 'Linked',
            quotationRevisionRef: revisionId,
          },
          request.recordVersion
        )
      ).status
    ).toBe(201);
    // The link is its own audit fact, so an auditor can answer "on what commercial
    // basis was this released?" from the trail rather than by inference.
    expect(
      await auditCountFor('quo.additional_work.quotation_linked', await approvalIdFor(request.id))
    ).toBe(1);

    // The commercial decision rows are the quotation module's, and the operational
    // approval adds no copy of them — only the reference.
    const commercial = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM quo.approval_decisions WHERE quotation_revision_id = $1`,
      [revisionId]
    );
    expect(Number.parseInt(commercial.rows[0]?.n ?? '0', 10)).toBeGreaterThan(0);

    const operational = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM wo.customer_approvals
        WHERE additional_work_request_id = $1`,
      [request.id]
    );
    expect(operational.rows[0]?.n).toBe('1');
  });

  it('does not touch inventory', async () => {
    // P1-21 owns reservation and issue. Asserted rather than assumed, because a
    // commercial approval is exactly where stock coupling would be tempting.
    const before = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM inv.stock_movements`
    );
    const order = await createOpenWorkOrder();
    const request = await raiseRequest(order.workOrderId);
    const quotation = await quoteFor(order.workOrderId);
    const revisionId = await issueQuotation(quotation);
    await acceptRevision(revisionId);
    const roleId = await partyRoleFor(order.visitId);
    authAs(WO_APPROVER_WITH_QUOTATION_READ);
    await approve(
      request.id,
      {
        decision: 'approved',
        channel: 'in_person',
        decidingPartyRoleId: roleId,
        presentedScope: 'Linked',
        quotationRevisionRef: revisionId,
      },
      request.recordVersion
    );
    const after = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM inv.stock_movements`
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });
});

/**
 * The port is installed by the path that USES it (P1-20-BE-013).
 *
 * `@/modules/quotation` calls `setCommercialApprovalReader` at module scope, and
 * `@/modules/work-order` must not import it — that is the cycle the port exists to
 * break. So whether the port exists depended on some *other* route having been loaded
 * first: nothing else in `src/` imports the quotation module, so a fresh Node process
 * (cold start, restart, scale-out) that received this endpoint before any `/quotations*`
 * route found the reader uninstalled and answered `ERR-SYS-001`. Fail-closed, so no
 * unvalidated link was ever written, but P1-20-BE-013 was intermittently unavailable
 * for reasons a caller could not see or retry around.
 *
 * Every other test in this file imports the quotation routes at module scope, so the
 * port is always installed in the test process and none of them can observe this. A
 * fresh module registry is the only way to see it: `vi.resetModules()` gives the dynamic
 * imports below their own graph, so the reader they see is the one the approval route's
 * own imports produce and nothing else.
 *
 * The stub handle proves which implementation answered. The uninstalled default throws
 * before touching a database; the real one reads through the repository, so a handle
 * whose `query` raises a sentinel distinguishes "installed" from "still the default"
 * without needing the port to succeed.
 */
describe('CommercialApprovalReader installation', () => {
  const SENTINEL = 'SENTINEL_DB_REACHED';
  const stubDb = {
    context: {
      correlationId: '00000000-0000-4000-8000-0000000000ff',
      operation: 'wo.additional-work-approval',
      module: 'work-order',
      principal: { tenantId: TENANT_A, userId: USER_A },
    },
    query: () => {
      throw new Error(SENTINEL);
    },
  };

  it('is uninstalled by default and installed by importing the approval route alone', async () => {
    vi.resetModules();

    const contract = await import('@/server/contracts/commercial-approval');
    contract.__resetCommercialApprovalReaderForTests();

    // The fail-loud default: an authorization-shaped question answered by an
    // uninstalled port must not look like a legitimate "not found".
    await expect(
      contract
        .commercialApprovalReader()
        .standingOf(stubDb as never, 'd2999999-0000-4000-8000-0000000000aa')
    ).rejects.toThrow(/not installed/);

    // The ONLY import: the approval route. It pulls in `@/modules/work-order` and,
    // because of the side-effect import added for this reason, `@/modules/quotation`.
    await import('@/app/api/v1/additional-work/[requestId]/approval/route');

    // Now a real implementation answers — proved by it reaching the database handle,
    // which the default never does.
    await expect(
      contract
        .commercialApprovalReader()
        .standingOf(stubDb as never, 'd2999999-0000-4000-8000-0000000000aa')
    ).rejects.toThrow(SENTINEL);

    vi.resetModules();
  });
});
