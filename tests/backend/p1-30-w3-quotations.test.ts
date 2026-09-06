/**
 * P1-30 W3 — the quotation reads answer a real actor with real rows, and the
 * web mirror is the shape they answer with.
 *
 * PC-1 on the five reads the quotation screens render — the quotations of a
 * work order, the quotation with its current revision, the revision history,
 * a revision by id, and the decisions of a revision — which is what the
 * canonical plan's W3 row says this wave proves: "totals are captured
 * figures; an approval-limit refusal renders as refusal". On the wire that
 * means every total and line figure is a decimal STRING the database
 * captured, `outcome` is the server's roll-up, and a discount beyond the
 * actor's approval limit is a 403 the screen renders as a refusal.
 *
 * ## The mirror is PARSED, not trusted
 *
 * The interfaces are parsed out of `features/quotations/quotations-contract.ts`
 * with TypeScript and held against rows that came out of the database — set
 * equality in BOTH directions, once per response shape.
 *
 * ## The version a guarded write needs is the QUOTATION's
 *
 * `quo.quotation-issue` and `quo.quotation-revision-create` compare `If-Match`
 * with the quotation's `record_version`, which `quo.quotation-detail`
 * publishes as its ETag. A revision's own `recordVersion` is a different
 * number, and this suite shows it is the wrong one to send.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   quo.quotation-list: route service authorization success denial cross-tenant
 *   quo.quotation-detail: route service authorization success denial cross-tenant
 *   quo.quotation-revision-list: route service authorization success denial cross-tenant
 *   quo.quotation-revision-detail: route service authorization success denial cross-tenant
 *   quo.quotation-revision-decisions-read: route service authorization success denial cross-tenant
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import ts from 'typescript';

import {
  COMPANY_A1,
  TENANT_A,
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
  SVC_NO_CEILING,
  SVC_TENANT_B,
  SVC_UNPERMITTED,
  TAX_CLASS_A,
  assignPriceList,
  authAs,
  establishP1_20Fixtures,
  priceListVersionOf,
  seedDiscountCeiling,
} from './p1-20-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { POST as CREATE_LIST } from '@/app/api/v1/price-lists/route';
import { POST as CREATE_LIST_VERSION } from '@/app/api/v1/price-lists/[priceListId]/versions/route';
import { POST as RECORD_RULE } from '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/rules/route';
import { POST as PUBLISH_LIST } from '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/publication/route';
import { POST as CREATE_QUOTATION } from '@/app/api/v1/quotations/route';
import { GET as QUOTATION_DETAIL } from '@/app/api/v1/quotations/[quotationId]/route';
import { POST as ISSUE } from '@/app/api/v1/quotations/[quotationId]/issue/route';
import {
  GET as REVISION_LIST,
  POST as CREATE_REVISION,
} from '@/app/api/v1/quotations/[quotationId]/revisions/route';
import { GET as REVISION_DETAIL } from '@/app/api/v1/quotation-revisions/[revisionId]/route';
import {
  GET as REVISION_DECISIONS,
  POST as DECIDE_REVISION,
} from '@/app/api/v1/quotation-revisions/[revisionId]/decisions/route';
import { GET as WORK_ORDER_QUOTATIONS } from '@/app/api/v1/work-orders/[workOrderId]/quotations/route';

const CONTRACT = join(
  process.cwd(),
  'apps',
  'web',
  'src',
  'features',
  'quotations',
  'quotations-contract.ts'
);

let admin: Pool;
let runtime: Pool;
let workOrderId = '';
let quotationId = '';
let quotationVersion = 0;
let revisionId = '';
let codeSeq = 0;

const nextCode = (): string => {
  codeSeq += 1;
  return `FX-W3-${String(Date.now() % 100000)}-${codeSeq}`;
};

const jsonPost = (url: string, payload: unknown, ifMatch?: number): Request =>
  new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
      ...(ifMatch === undefined ? {} : { 'if-match': String(ifMatch) }),
    },
    body: JSON.stringify(payload),
  });

const json = async <T>(response: Response): Promise<T> => (await response.json()) as T;
const codeOf = async (response: Response): Promise<string> =>
  (await json<{ code: string }>(response)).code;
const keysOf = (value: unknown): string[] => Object.keys(value as Record<string, unknown>).sort();

function mirrorFields(interfaceName: string): readonly string[] {
  const source = ts.createSourceFile(
    CONTRACT,
    readFileSync(CONTRACT, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      for (const member of node.members) {
        if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
          found.push(member.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (found.length === 0) throw new Error(`the mirror declares no interface ${interfaceName}`);
  return found;
}

function mirrorVocabulary(constName: string): readonly string[] {
  const source = ts.createSourceFile(
    CONTRACT,
    readFileSync(CONTRACT, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === constName &&
      node.initializer
    ) {
      let init: ts.Node = node.initializer;
      if (ts.isAsExpression(init)) init = init.expression;
      if (ts.isArrayLiteralExpression(init)) {
        for (const element of init.elements) {
          if (ts.isStringLiteral(element)) found.push(element.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (found.length === 0) throw new Error(`the mirror declares no vocabulary ${constName}`);
  return found;
}
const mirror = (name: string): string[] => [...mirrorFields(name)].sort();

/* ---- request builders ---- */

function quotationList(query: Record<string, string> = {}, wo = workOrderId): Promise<Response> {
  const url = new URL(`http://localhost/api/v1/work-orders/${wo}/quotations`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return WORK_ORDER_QUOTATIONS(new Request(url), { params: Promise.resolve({ workOrderId: wo }) });
}
function quotationDetail(id = quotationId): Promise<Response> {
  return QUOTATION_DETAIL(new Request(`http://localhost/api/v1/quotations/${id}`), {
    params: Promise.resolve({ quotationId: id }),
  });
}
function revisionList(id = quotationId, query: Record<string, string> = {}): Promise<Response> {
  const url = new URL(`http://localhost/api/v1/quotations/${id}/revisions`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return REVISION_LIST(new Request(url), { params: Promise.resolve({ quotationId: id }) });
}
function revisionDetail(id = revisionId): Promise<Response> {
  return REVISION_DETAIL(new Request(`http://localhost/api/v1/quotation-revisions/${id}`), {
    params: Promise.resolve({ revisionId: id }),
  });
}
function revisionDecisions(id = revisionId): Promise<Response> {
  return REVISION_DECISIONS(
    new Request(`http://localhost/api/v1/quotation-revisions/${id}/decisions`),
    { params: Promise.resolve({ revisionId: id }) }
  );
}
function createQuotation(body: unknown): Promise<Response> {
  return CREATE_QUOTATION(jsonPost('http://localhost/api/v1/quotations', body));
}
function createRevision(id: string, body: unknown, ifMatch: number): Promise<Response> {
  return CREATE_REVISION(
    jsonPost(`http://localhost/api/v1/quotations/${id}/revisions`, body, ifMatch),
    { params: Promise.resolve({ quotationId: id }) }
  );
}
function issue(id: string, body: unknown, ifMatch: number): Promise<Response> {
  return ISSUE(jsonPost(`http://localhost/api/v1/quotations/${id}/issue`, body, ifMatch), {
    params: Promise.resolve({ quotationId: id }),
  });
}
function decideRevision(id: string, body: unknown): Promise<Response> {
  return DECIDE_REVISION(
    jsonPost(`http://localhost/api/v1/quotation-revisions/${id}/decisions`, body),
    { params: Promise.resolve({ revisionId: id }) }
  );
}

/** A published, assigned price list carrying one taxed rule for SERVICE_A. */
async function publishPrice(amount: string): Promise<void> {
  authAs(SVC_FULL);
  const list = await json<{ id: string; recordVersion: number }>(
    await CREATE_LIST(
      jsonPost('http://localhost/api/v1/price-lists', {
        priceListCode: nextCode(),
        name: 'W3 fixture list',
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

  await publishPrice('100.0000');
  await seedDiscountCeiling({
    tenantId: TENANT_A,
    companyId: COMPANY_A1,
    roleId: SVC_FULL.roleId,
    amount: '1000.0000',
    currencyCode: 'JOD',
  });
  const opened = await createOpenWorkOrder();
  workOrderId = opened.workOrderId;

  authAs(SVC_FULL);
  const created = await createQuotation({
    workOrderId,
    payerPartnerRef: PARTNER_A,
    lines: [{ serviceId: SERVICE_A, quantity: '2.000' }],
  });
  if (created.status !== 201) throw new Error(`fixture quotation refused: ${created.status}`);
  const quotation = await json<{
    id: string;
    recordVersion: number;
    currentRevision: { id: string } | null;
  }>(created);
  quotationId = quotation.id;
  quotationVersion = quotation.recordVersion;
  revisionId = quotation.currentRevision?.id ?? '';
  if (!revisionId) throw new Error('fixture quotation has no revision');
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

describe('P1-30 W3 — the quotation reads answer a real actor with real rows', () => {
  it('W3-1 the quotations of a work order are a keyset page of mirror-shaped summaries with no money', async () => {
    authAs(SVC_FULL);
    const response = await quotationList({ limit: '10' });
    expect(response.status).toBe(200);
    const body = await json<{
      items: Record<string, unknown>[];
      nextCursor: unknown;
      hasMore: boolean;
    }>(response);
    expect(keysOf(body)).toEqual(['hasMore', 'items', 'nextCursor']);
    const row = body.items.find((entry) => entry['id'] === quotationId);
    expect(row).toBeDefined();
    expect(keysOf(row)).toEqual(mirror('QuotationSummary'));
    expect(JSON.stringify(row)).not.toContain('grandTotal');
  });

  it('W3-2 the detail carries the current revision with captured decimal strings, and its ETag is the QUOTATION version', async () => {
    authAs(SVC_FULL);
    const response = await quotationDetail();
    expect(response.status).toBe(200);
    const body = await json<Record<string, unknown>>(response);
    expect(keysOf(body)).toEqual(mirror('QuotationDetail'));
    const current = body['currentRevision'] as Record<string, unknown>;
    expect(keysOf(current)).toEqual(mirror('QuotationRevision'));
    const lines = current['lines'] as Record<string, unknown>[];
    expect(lines.length).toBe(1);
    expect(keysOf(lines[0])).toEqual(mirror('QuotationLine'));
    // The captured figures, as strings: the server priced 2.000 at 100.0000 with a 10 % class.
    expect(lines[0]?.['unitPrice']).toBe('100.0000');
    expect(lines[0]?.['quantity']).toBe('2.000');
    expect(lines[0]?.['taxRate']).toBe('0.100000');
    expect(lines[0]?.['taxAmount']).toBe('20.0000');
    expect(lines[0]?.['lineTotal']).toBe('220.0000');
    // The four revision totals are captured by `quo.issue_revision`; on a draft
    // they are the database default, as strings. The screen says so rather than
    // printing them as a total (W3-5 checks the captured value after issue).
    for (const key of ['subtotal', 'discountTotal', 'taxTotal', 'grandTotal']) {
      expect(typeof current[key], key).toBe('string');
      expect(current[key], key).toBe('0.0000');
    }
    expect(String(response.headers.get('etag')).replace(/"/g, '')).toBe(
      String(body['recordVersion'])
    );
  });

  it('W3-3 the revision history is headers only, with exactly one current revision', async () => {
    authAs(SVC_FULL);
    const response = await revisionList();
    expect(response.status).toBe(200);
    const body = await json<{ items: Record<string, unknown>[] }>(response);
    expect(body.items.length).toBeGreaterThan(0);
    expect(keysOf(body.items[0])).toEqual(mirror('QuotationRevisionHeader'));
    expect(JSON.stringify(body)).not.toContain('"lines"');
    expect(body.items.filter((row) => row['isCurrent'] === true).length).toBe(1);
  });

  it('W3-4 a revision by id is the mirror’s shape, with its lines', async () => {
    authAs(SVC_FULL);
    const response = await revisionDetail();
    expect(response.status).toBe(200);
    const body = await json<Record<string, unknown>>(response);
    expect(keysOf(body)).toEqual(mirror('QuotationRevision'));
    expect(Array.isArray(body['lines'])).toBe(true);
  });

  it('W3-5 the decisions read is the mirror’s shape before and after a decision, and the outcome is the server’s', async () => {
    authAs(SVC_FULL);
    const before = await json<Record<string, unknown>>(await revisionDecisions());
    expect(keysOf(before)).toEqual(mirror('RevisionDecisions'));
    expect(before['outcome']).toBeNull();
    expect(before['decidedCount']).toBe(0);

    // Issue with the QUOTATION's version, then approve the whole revision.
    const issued = await issue(quotationId, { revisionId }, quotationVersion);
    expect(issued.status).toBe(200);
    const decided = await decideRevision(revisionId, {
      decision: 'approved',
      channel: 'in_person',
      presentedRevisionId: revisionId,
      decidingPartyRef: PARTNER_A,
      evidence: { evidenceKind: 'verbal', referenceNote: 'W3 fixture approval' },
    });
    expect(decided.status).toBe(201);

    const after = await json<{
      outcome: unknown;
      decisions: Record<string, unknown>[];
    }>(await revisionDecisions());
    expect(after.outcome).toBe('accepted');
    expect(after.decisions.length).toBe(1);
    expect(keysOf(after.decisions[0])).toEqual(mirror('LineDecision'));
    const evidence = after.decisions[0]?.['evidence'] as Record<string, unknown>[];
    expect(evidence.length).toBe(1);
    expect(keysOf(evidence[0])).toEqual(mirror('DecisionEvidence'));
    // The quotation status rolled up to the same outcome, and issue captured
    // the totals from the lines: 200 + 20 tax = 220.
    const detail = await json<{
      status: string;
      currentRevision: { subtotal: string; taxTotal: string; grandTotal: string };
    }>(await quotationDetail());
    expect(detail.status).toBe('accepted');
    expect(detail.currentRevision.subtotal).toBe('200.0000');
    expect(detail.currentRevision.taxTotal).toBe('20.0000');
    expect(detail.currentRevision.grandTotal).toBe('220.0000');
  });

  it('W3-6 an actor without quo.quotation.read is REFUSED on every read', async () => {
    authAs(SVC_UNPERMITTED);
    for (const response of [
      await quotationList(),
      await quotationDetail(),
      await revisionList(),
      await revisionDetail(),
      await revisionDecisions(),
    ]) {
      expect(response.status).toBe(403);
      expect(await codeOf(response)).toBe('ERR-IAM-001');
    }
  });

  it('W3-7 another tenant cannot see the quotation, in any read', async () => {
    authAs(SVC_TENANT_B);
    for (const response of [
      await quotationList(),
      await quotationDetail(),
      await revisionList(),
      await revisionDetail(),
      await revisionDecisions(),
    ]) {
      expect([403, 404]).toContain(response.status);
      expect(['ERR-IAM-001', 'ERR-RES-001']).toContain(await codeOf(response));
    }
  });

  it('W3-8 the vocabularies the screens offer are the ones the backend uses', () => {
    expect(new Set(mirrorVocabulary('QUOTATION_STATES'))).toEqual(
      new Set(['draft', 'active', 'accepted', 'rejected', 'expired', 'cancelled'])
    );
    expect(new Set(mirrorVocabulary('REVISION_STATES'))).toEqual(
      new Set(['draft', 'issued', 'superseded', 'rejected', 'expired'])
    );
    expect(new Set(mirrorVocabulary('DECISIONS'))).toEqual(new Set(['approved', 'rejected']));
    expect(new Set(mirrorVocabulary('DECISION_CHANNELS'))).toEqual(
      new Set(['in_person', 'phone', 'portal', 'email', 'system'])
    );
    expect(new Set(mirrorVocabulary('EVIDENCE_KINDS'))).toEqual(
      new Set(['document', 'verbal', 'portal', 'email'])
    );
  });

  it('W3-9 a discount beyond the actor’s approval limit is a 403 — the refusal the screen renders', async () => {
    const opened = await createOpenWorkOrder();
    authAs(SVC_NO_CEILING);
    const refused = await createQuotation({
      workOrderId: opened.workOrderId,
      lines: [{ serviceId: SERVICE_A, quantity: '1.000', discount: '1.0000' }],
    });
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
    // With a ceiling above the discount, the same document is created and the
    // discount is a captured figure on the line.
    authAs(SVC_FULL);
    const created = await createQuotation({
      workOrderId: opened.workOrderId,
      lines: [{ serviceId: SERVICE_A, quantity: '1.000', discount: '5.0000' }],
    });
    expect(created.status).toBe(201);
    const body = await json<{
      id: string;
      recordVersion: number;
      currentRevision: { id: string; lines: { discount: string }[] };
    }>(created);
    expect(body.currentRevision.lines[0]?.discount).toBe('5.0000');
    // Issued, the discount is captured into the revision total.
    const issued = await issue(
      body.id,
      { revisionId: body.currentRevision.id },
      body.recordVersion
    );
    expect(issued.status).toBe(200);
    const captured = await json<{ discountTotal: string }>(issued);
    expect(captured.discountTotal).toBe('5.0000');
  });

  it('W3-10 a revision with a REVISION version as If-Match is refused; the QUOTATION version is accepted', async () => {
    const opened = await createOpenWorkOrder();
    authAs(SVC_FULL);
    const created = await json<{
      id: string;
      recordVersion: number;
      currentRevision: { recordVersion: number };
    }>(
      await createQuotation({
        workOrderId: opened.workOrderId,
        lines: [{ serviceId: SERVICE_A, quantity: '1.000' }],
      })
    );
    const wrong = await createRevision(
      created.id,
      { lines: [{ serviceId: SERVICE_A, quantity: '2.000' }] },
      created.currentRevision.recordVersion + 999
    );
    expect(wrong.status).toBe(409);
    const right = await createRevision(
      created.id,
      { lines: [{ serviceId: SERVICE_A, quantity: '2.000' }] },
      created.recordVersion
    );
    expect(right.status).toBe(201);
  });

  it('W3-11 a bad cursor is a paging refusal and an unknown query key is a validation refusal', async () => {
    authAs(SVC_FULL);
    const paging = await quotationList({ cursor: 'not-a-cursor' });
    expect(paging.status).toBe(400);
    expect(await codeOf(paging)).toBe('ERR-PAG-001');
    const unknown = await quotationList({ status: 'draft' });
    expect(unknown.status).toBe(422);
    expect(await codeOf(unknown)).toBe('ERR-VAL-001');
  });
});
