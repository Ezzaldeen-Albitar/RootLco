/**
 * Price-list lifecycle and deterministic resolution (Phase 1-20, P1-20-BE-004,
 * BE-005, BE-006, BE-014, P1-20-QA-002…004).
 *
 * Three things this suite is really about.
 *
 * **The money never becomes a float.** Amounts cross as decimal strings, are bound
 * with a `::numeric(18,4)` cast, and come back byte-identical — including values
 * IEEE-754 cannot hold. An over-scale amount, a negative one and exponential
 * notation are all refused at the boundary.
 *
 * **Resolution is deterministic or it is an error.** A missing price is not zero, a
 * tax class with no effective rate is not an untaxed line, and two rules tied on
 * both specificity and priority are a configuration conflict rather than
 * `svc.resolve_price`'s `id` tiebreak quietly choosing.
 *
 * **`scope: 'branch'` on `/prices` is real.** `SVC_PRICE_SCOPED_A2` holds
 * `svc.price.read` scoped to A2 *and* an unrelated permission scoped to A1, so A1 IS
 * in its `iam.allowed_branch_ids()` union: the row is readable and the permission is
 * held, so a scope-blind check would ALLOW it. Only a scoped permission check refuses
 * it (P1-18-A-01). This header previously named `SVC_PERMISSION_ELSEWHERE`, which
 * holds `svc.service.read` alone — so the case it described was a missing-permission
 * refusal wearing an isolation label.
 *
 * Operations exercised here: svc.price-list-list, svc.price-list-create,
 * svc.price-list-version-create, svc.price-rule-record,
 * svc.price-list-version-publish, svc.price-resolve.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   svc.price-list-list: route service authorization success denial cross-tenant
 *   svc.price-list-create: route service authorization success denial cross-tenant audit idempotency
 *   svc.price-list-version-create: route service authorization success denial audit stale-version cross-tenant idempotency
 *   svc.price-rule-record: route service authorization success denial audit cross-tenant idempotency isolation
 *   svc.price-list-version-publish: route service authorization success denial audit outbox stale-version concurrency cross-tenant idempotency
 *   svc.price-resolve: route service authorization success denial cross-tenant isolation
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  BRANCH_A1,
  COMPANY_A1,
  adminPool,
  cleanBackendFixtures,
  contextFor,
  countRows,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { BRANCH_A2, establishP1_19Fixtures } from './p1-19-helpers';
import {
  BRANCH_A2_OF_COMPANY_A2,
  COMPANY_A2,
  EFFECTIVE_FROM,
  SERVICE_A,
  SVC_FULL,
  SVC_NO_CEILING,
  SVC_PRICE_SCOPED_A2,
  SVC_READER,
  SVC_SCOPED_A2,
  SVC_TENANT_B,
  SVC_TENANT_B_FULL,
  TAX_CLASS_A,
  TAX_CLASS_A_UNRATED,
  assignPriceList,
  auditCountFor,
  authAs,
  establishP1_20Fixtures,
  outboxCountFor,
  priceListVersionOf,
  seedDiscountCeiling,
} from './p1-20-helpers';
import { TENANT_A } from './helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { withTransaction } from '@/server/db/transaction';
import { callerApprovalCeiling } from '@/server/auth/authorization';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as LIST_LISTS, POST as CREATE_LIST } from '@/app/api/v1/price-lists/route';
import { POST as CREATE_VERSION } from '@/app/api/v1/price-lists/[priceListId]/versions/route';
import { POST as RECORD_RULE } from '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/rules/route';
import { POST as PUBLISH } from '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/publication/route';
import { GET as RESOLVE } from '@/app/api/v1/prices/route';

let admin: Pool;
let runtime: Pool;
let codeSeq = 0;
let assignmentPriority = 0;

const nextCode = (): string => {
  codeSeq += 1;
  return `FX-PL-${String(Date.now() % 100000)}-${codeSeq}`;
};

function listLists(query: Record<string, string> = {}): Promise<Response> {
  const url = new URL('http://localhost/api/v1/price-lists');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return LIST_LISTS(new Request(url));
}

function createList(body: unknown): Promise<Response> {
  return CREATE_LIST(
    new Request('http://localhost/api/v1/price-lists', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    })
  );
}

function createVersion(
  priceListId: string,
  body: unknown,
  ifMatch: number | null
): Promise<Response> {
  return CREATE_VERSION(
    new Request(`http://localhost/api/v1/price-lists/${priceListId}/versions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
        ...(ifMatch === null ? {} : { 'if-match': String(ifMatch) }),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ priceListId }) }
  );
}

function recordRule(priceListId: string, versionId: string, body: unknown): Promise<Response> {
  return RECORD_RULE(
    new Request(`http://localhost/api/v1/price-lists/${priceListId}/versions/${versionId}/rules`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ priceListId, versionId }) }
  );
}

function publish(
  priceListId: string,
  versionId: string,
  body: unknown,
  ifMatch: number | null
): Promise<Response> {
  return PUBLISH(
    new Request(
      `http://localhost/api/v1/price-lists/${priceListId}/versions/${versionId}/publication`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
          ...(ifMatch === null ? {} : { 'if-match': String(ifMatch) }),
        },
        body: JSON.stringify(body),
      }
    ),
    { params: Promise.resolve({ priceListId, versionId }) }
  );
}

function resolve(query: Record<string, string>): Promise<Response> {
  const url = new URL('http://localhost/api/v1/prices');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return RESOLVE(new Request(url));
}

interface ListBody {
  readonly id: string;
  readonly priceListCode: string;
  readonly currency: string;
  readonly recordVersion: number;
}
interface VersionBody {
  readonly id: string;
  readonly versionNo: number;
  readonly status: string;
  readonly effectiveFrom: string;
}
interface RuleBody {
  readonly id: string;
  readonly amount: string;
  readonly currency: string;
}
interface ResolvedBody {
  readonly asOf: string;
  readonly unitPrice: string;
  readonly currency: string;
  readonly taxRate: string;
  readonly priceRuleId: string;
}

/**
 * Builds a published price list carrying one rule for `SERVICE_A`, and assigns it
 * to the given scope so `svc.resolve_price` can find it.
 */
async function publishedListFor(input: {
  amount: string;
  currency?: string;
  taxClassId?: string | null;
  branchId?: string | null;
  effectiveFrom?: string;
  priority?: number;
}): Promise<{ priceListId: string; versionId: string }> {
  authAs(SVC_FULL);
  const created = (await (
    await createList({
      priceListCode: nextCode(),
      name: 'Fixture list',
      currency: input.currency ?? 'JOD',
    })
  ).json()) as ListBody;

  const version = (await (
    await createVersion(
      created.id,
      { effectiveFrom: input.effectiveFrom ?? '2020-01-01' },
      created.recordVersion
    )
  ).json()) as VersionBody;

  const ruleResponse = await recordRule(created.id, version.id, {
    serviceId: SERVICE_A,
    amount: input.amount,
    // A tax class requires a company-scoped rule; keep the two together.
    ...(input.taxClassId === undefined || input.taxClassId === null
      ? {}
      : { companyId: COMPANY_A1, taxClassId: input.taxClassId }),
    ...(input.branchId === undefined || input.branchId === null
      ? {}
      : { companyId: COMPANY_A1, branchId: input.branchId }),
    ...(input.priority === undefined ? {} : { priority: input.priority }),
  });
  expect(ruleResponse.status).toBe(201);

  const published = await publish(
    created.id,
    version.id,
    { effectiveFrom: input.effectiveFrom ?? '2020-01-01' },
    await priceListVersionOf(created.id)
  );
  expect(published.status).toBe(200);

  // A DISTINCT, increasing priority per fixture: the signature index is unique on
  // (tenant, company, branch, class, priority) where active, so reusing one made
  // the first assignment win forever and every later fixture silently ignored.
  assignmentPriority += 1;
  await assignPriceList({
    tenantId: TENANT_A,
    priceListId: created.id,
    companyId: COMPANY_A1,
    branchId: input.branchId ?? null,
    customerClass: null,
    priority: input.priority ?? assignmentPriority,
  });
  return { priceListId: created.id, versionId: version.id };
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

describe('svc.price-list-list / create — authorization', () => {
  it('401 unauthenticated, and 403 for a caller holding only svc.service.read', async () => {
    __resetAuthenticatorForTests();
    expect((await listLists()).status).toBe(401);

    authAs(SVC_READER);
    const refusedRead = await listLists();
    expect(refusedRead.status).toBe(403);
    expect(((await refusedRead.json()) as { code: string }).code).toBe('ERR-IAM-001');
  });

  it('refuses creation to a caller with only svc.price.read', async () => {
    // SVC_TENANT_B holds price.read but not price.manage.
    authAs(SVC_TENANT_B);
    const refused = await createList({
      priceListCode: nextCode(),
      name: 'Nope',
      currency: 'USD',
    });
    expect(refused.status).toBe(403);
  });
});

describe('svc.price-list-create — the currency is a one-way decision', () => {
  it('creates a list and records the immutable currency in the audit trail', async () => {
    authAs(SVC_FULL);
    const code = nextCode();
    const response = await createList({ priceListCode: code, name: 'Standard', currency: 'JOD' });
    expect(response.status).toBe(201);
    const body = (await response.json()) as ListBody;
    expect(body.currency).toBe('JOD');
    expect(body.priceListCode).toBe(code);
    expect(await auditCountFor('svc.price_list.created', body.id)).toBe(1);
  });

  it('accepts every currency shared.currencies supports, hard-coding none', async () => {
    authAs(SVC_FULL);
    // The supported set is reference data (shared.currencies), referenced by
    // fk_price_lists_currency. No currency is privileged in code, and the pilot
    // tenant's own currency is not special here.
    for (const currency of ['USD', 'EUR', 'JOD']) {
      const response = await createList({
        priceListCode: nextCode(),
        name: `List ${currency}`,
        currency,
      });
      expect(response.status).toBe(201);
      expect(((await response.json()) as ListBody).currency).toBe(currency);
    }
  });

  it('refuses an unsupported currency as a field error, not a 500', async () => {
    authAs(SVC_FULL);
    // Well-formed ISO-4217 but absent from shared.currencies. The foreign-key
    // violation is mapped to ERR-VAL-001 naming the field.
    const response = await createList({ priceListCode: nextCode(), name: 'x', currency: 'GBP' });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-VAL-001');
  });

  it('refuses a malformed currency and an unknown field', async () => {
    authAs(SVC_FULL);
    expect(
      (await createList({ priceListCode: nextCode(), name: 'x', currency: 'jod' })).status
    ).toBe(422);
    expect(
      (await createList({ priceListCode: nextCode(), name: 'x', currency: 'JODX' })).status
    ).toBe(422);
    expect(
      (await createList({ priceListCode: nextCode(), name: 'x', currency: 'JOD', amount: '1' }))
        .status
    ).toBe(422);
  });

  it('refuses a duplicate price-list code', async () => {
    authAs(SVC_FULL);
    const code = nextCode();
    expect((await createList({ priceListCode: code, name: 'a', currency: 'JOD' })).status).toBe(
      201
    );
    const duplicate = await createList({ priceListCode: code, name: 'b', currency: 'JOD' });
    // A conflict the caller can resolve, so ERR-CON-001 - not ERR-SYS-001, which
    // is what a raw uq_price_lists_code violation produced before it was mapped.
    expect(duplicate.status).toBe(409);
    expect(((await duplicate.json()) as { code: string }).code).toBe('ERR-CON-001');
  });

  it('never shows a tenant-B list to tenant A', async () => {
    authAs(SVC_TENANT_B);
    // Tenant B cannot create (no manage), so seed visibility via tenant A only and
    // assert the tenant-A listing does not leak across.
    authAs(SVC_FULL);
    const mine = (await (
      await createList({
        priceListCode: nextCode(),
        name: 'Tenant A only',
        currency: 'JOD',
      })
    ).json()) as ListBody;

    authAs(SVC_TENANT_B);
    const asB = (await (await listLists()).json()) as { items: readonly ListBody[] };
    expect(asB.items.map((i) => i.id)).not.toContain(mine.id);

    /**
     * The POSITIVE half, which the assertion above cannot supply.
     *
     * "Tenant B's page does not contain tenant A's id" is also true of a route that
     * returns an empty page to everyone, so on its own it is not evidence that the
     * listing works — only that it does not leak. Asserting tenant A sees its OWN
     * list is what makes the negative meaningful.
     */
    authAs(SVC_FULL);
    const asA = await listLists();
    expect(asA.status).toBe(200);
    const mineListed = (await asA.json()) as { items: readonly ListBody[] };
    expect(mineListed.items.map((i) => i.id)).toContain(mine.id);
  });

  it('refuses an over-large limit and an unknown query parameter', async () => {
    authAs(SVC_FULL);
    // `schemas.limit` bounds the page; the schema is `.strict()`, so an unknown
    // parameter is a 422 rather than something silently ignored.
    expect((await listLists({ limit: '100000' })).status).toBe(422);
    expect((await listLists({ nope: 'x' })).status).toBe(422);
  });
});

describe('svc.price-list-version-create — concurrency', () => {
  it('creates version 1 then 2, monotonically', async () => {
    authAs(SVC_FULL);
    const list = (await (
      await createList({
        priceListCode: nextCode(),
        name: 'Versioned',
        currency: 'JOD',
      })
    ).json()) as ListBody;

    const first = await createVersion(list.id, { effectiveFrom: '2020-01-01' }, list.recordVersion);
    expect(first.status).toBe(201);
    expect(((await first.json()) as VersionBody).versionNo).toBe(1);

    const second = await createVersion(
      list.id,
      { effectiveFrom: '2021-01-01' },
      await priceListVersionOf(list.id)
    );
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as VersionBody;
    expect(secondBody.versionNo).toBe(2);
    expect(await auditCountFor('svc.price_list_version.created', secondBody.id)).toBe(1);
  });

  it('requires If-Match and refuses a stale record version', async () => {
    authAs(SVC_FULL);
    const list = (await (
      await createList({
        priceListCode: nextCode(),
        name: 'Guarded',
        currency: 'JOD',
      })
    ).json()) as ListBody;

    const missing = await createVersion(list.id, { effectiveFrom: '2020-01-01' }, null);
    expect(missing.status).toBeGreaterThanOrEqual(400);
    expect(((await missing.json()) as { code: string }).code).toBe('ERR-CON-002');

    const stale = await createVersion(list.id, { effectiveFrom: '2020-01-01' }, 999);
    expect(((await stale.json()) as { code: string }).code).toBe('ERR-CON-001');
  });
});

describe('svc.price-rule-record — exact money at the boundary', () => {
  async function draftVersion(): Promise<{ listId: string; versionId: string }> {
    authAs(SVC_FULL);
    const list = (await (
      await createList({
        priceListCode: nextCode(),
        name: 'Rules',
        currency: 'JOD',
      })
    ).json()) as ListBody;
    const version = (await (
      await createVersion(list.id, { effectiveFrom: '2020-01-01' }, list.recordVersion)
    ).json()) as VersionBody;
    return { listId: list.id, versionId: version.id };
  }

  it.each([
    ['0', '0.0000'],
    ['0.0001', '0.0001'],
    ['1.005', '1.0050'],
    ['2.675', '2.6750'],
    ['99999999999999.9999', '99999999999999.9999'],
  ])('stores %s as %s with no floating drift', async (input, expected) => {
    const { listId, versionId } = await draftVersion();
    const response = await recordRule(listId, versionId, { serviceId: SERVICE_A, amount: input });
    expect(response.status).toBe(201);
    expect(((await response.json()) as RuleBody).amount).toBe(expected);
  });

  it('refuses over-scale, negative and exponential amounts', async () => {
    const { listId, versionId } = await draftVersion();
    for (const bad of ['1.00001', '-1', '1e3', '1E3', 'NaN', '', '01', '.5']) {
      const response = await recordRule(listId, versionId, {
        serviceId: SERVICE_A,
        amount: bad,
      });
      expect(response.status, `amount ${bad}`).toBe(422);
    }
  });

  it('refuses a JSON number, so a float cannot reach a money column', async () => {
    const { listId, versionId } = await draftVersion();
    const response = await recordRule(listId, versionId, { serviceId: SERVICE_A, amount: 1.5 });
    expect(response.status).toBe(422);
  });

  it('refuses a tax class on a rule that is not company-scoped', async () => {
    const { listId, versionId } = await draftVersion();
    const response = await recordRule(listId, versionId, {
      serviceId: SERVICE_A,
      amount: '10.0000',
      taxClassId: TAX_CLASS_A,
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-VAL-001');
  });

  it('writes one financial audit record carrying the amount', async () => {
    const { listId, versionId } = await draftVersion();
    const rule = (await (
      await recordRule(listId, versionId, {
        serviceId: SERVICE_A,
        amount: '12.3400',
      })
    ).json()) as RuleBody;
    expect(await auditCountFor('svc.price_rule.recorded', rule.id)).toBe(1);
  });

  it('refuses a rule on a PUBLISHED version, so published prices are immutable', async () => {
    const { priceListId, versionId } = await publishedListFor({ amount: '5.0000' });
    authAs(SVC_FULL);
    const response = await recordRule(priceListId, versionId, {
      serviceId: SERVICE_A,
      amount: '6.0000',
    });
    // The service refuses a non-draft version before the trigger would.
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-TRN-001');
  });
});

describe('svc.price-list-version-publish', () => {
  it('refuses a caller holding no price permission at all', async () => {
    // SVC_READER holds NEITHER svc.price.manage nor svc.price.publish, so this proves
    // only that an unrelated principal is refused. It was previously titled "needs
    // svc.price.publish, not merely svc.price.manage", which it cannot show: proving
    // the SPLIT needs a principal holding one permission and not the other, and that
    // case is 'publication needs svc.price.publish, and svc.price.manage is not
    // enough' below, using SVC_NO_CEILING.
    authAs(SVC_READER);
    const refused = await publish(
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      { effectiveFrom: '2020-01-01' },
      1
    );
    expect(refused.status).toBe(403);
  });

  it('refuses a version with no rules', async () => {
    authAs(SVC_FULL);
    const list = (await (
      await createList({
        priceListCode: nextCode(),
        name: 'Empty',
        currency: 'JOD',
      })
    ).json()) as ListBody;
    const version = (await (
      await createVersion(list.id, { effectiveFrom: '2020-01-01' }, list.recordVersion)
    ).json()) as VersionBody;

    const response = await publish(
      list.id,
      version.id,
      { effectiveFrom: '2020-01-01' },
      await priceListVersionOf(list.id)
    );
    expect(response.status).toBe(422);
    // The problem document carries title and code, never the internal message -
    // handleOperation deliberately does not leak it - so the code is the contract.
    expect(((await response.json()) as { code: string }).code).toBe('ERR-VAL-001');
  });

  it('publishes, audits, and emits exactly one outbox event', async () => {
    const { priceListId, versionId } = await publishedListFor({ amount: '7.5000' });
    expect(await auditCountFor('svc.price_list_version.published', versionId)).toBe(1);
    expect(await outboxCountFor(`price-list.published:${versionId}`)).toBe(1);
    void priceListId;
  });

  it('refuses a second publication of the same version', async () => {
    const { priceListId, versionId } = await publishedListFor({ amount: '8.0000' });
    authAs(SVC_FULL);
    const again = await publish(
      priceListId,
      versionId,
      { effectiveFrom: '2021-01-01' },
      await priceListVersionOf(priceListId)
    );
    expect(again.status).toBeGreaterThanOrEqual(400);
    // Still exactly one event — a retry cannot double-publish.
    expect(await outboxCountFor(`price-list.published:${versionId}`)).toBe(1);
  });

  it('refuses an effectiveFrom at or before the open published version, forward-only', async () => {
    authAs(SVC_FULL);
    const list = (await (
      await createList({
        priceListCode: nextCode(),
        name: 'Succession',
        currency: 'JOD',
      })
    ).json()) as ListBody;

    const v1 = (await (
      await createVersion(list.id, { effectiveFrom: '2020-01-01' }, list.recordVersion)
    ).json()) as VersionBody;
    await recordRule(list.id, v1.id, { serviceId: SERVICE_A, amount: '1.0000' });
    expect(
      (
        await publish(
          list.id,
          v1.id,
          { effectiveFrom: '2022-01-01' },
          await priceListVersionOf(list.id)
        )
      ).status
    ).toBe(200);

    const v2 = (await (
      await createVersion(
        list.id,
        { effectiveFrom: '2020-01-01' },
        await priceListVersionOf(list.id)
      )
    ).json()) as VersionBody;
    await recordRule(list.id, v2.id, { serviceId: SERVICE_A, amount: '2.0000' });

    // Earlier than the currently published version's start — the function refuses.
    const backwards = await publish(
      list.id,
      v2.id,
      { effectiveFrom: '2021-01-01' },
      await priceListVersionOf(list.id)
    );
    expect(backwards.status).toBeGreaterThanOrEqual(400);

    // Later is accepted, and closes v1's effective_to.
    const forwards = await publish(
      list.id,
      v2.id,
      { effectiveFrom: '2023-01-01' },
      await priceListVersionOf(list.id)
    );
    expect(forwards.status).toBe(200);
  });

  it('leaves exactly one published version and one event under a forced race', async () => {
    authAs(SVC_FULL);
    const list = (await (
      await createList({
        priceListCode: nextCode(),
        name: 'Race',
        currency: 'JOD',
      })
    ).json()) as ListBody;
    const version = (await (
      await createVersion(list.id, { effectiveFrom: '2020-01-01' }, list.recordVersion)
    ).json()) as VersionBody;
    await recordRule(list.id, version.id, { serviceId: SERVICE_A, amount: '3.0000' });

    const ifMatch = await priceListVersionOf(list.id);
    const [a, b] = await Promise.all([
      publish(list.id, version.id, { effectiveFrom: '2020-06-01' }, ifMatch),
      publish(list.id, version.id, { effectiveFrom: '2020-06-01' }, ifMatch),
    ]);
    const statuses = [a.status, b.status].sort();
    // Exactly one wins; the loser is a conflict or a transition refusal.
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(await outboxCountFor(`price-list.published:${version.id}`)).toBe(1);
  });
});

describe('svc.price-resolve — deterministic or an error', () => {
  it('resolves a published price with its tax rate', async () => {
    const { priceListId } = await publishedListFor({
      amount: '100.0000',
      taxClassId: TAX_CLASS_A,
    });
    void priceListId;

    authAs(SVC_FULL);
    const response = await resolve({
      serviceId: SERVICE_A,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as ResolvedBody;
    expect(body.unitPrice).toBe('100.0000');
    expect(body.currency).toBe('JOD');
    // A FRACTION in [0,1], six decimal places — never a percentage.
    expect(body.taxRate).toBe('0.100000');
    expect(body.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('treats a rule with no tax class as configured-untaxed at rate zero', async () => {
    await publishedListFor({ amount: '50.0000' });
    authAs(SVC_FULL);
    const body = (await (
      await resolve({
        serviceId: SERVICE_A,
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
      })
    ).json()) as ResolvedBody;
    expect(body.taxRate).toBe('0.000000');
  });

  it('refuses when a rule names a tax class that has NO effective rate', async () => {
    await publishedListFor({ amount: '60.0000', taxClassId: TAX_CLASS_A_UNRATED });
    authAs(SVC_FULL);
    const response = await resolve({
      serviceId: SERVICE_A,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
    });
    // Not an untaxed line: under-charging silently is unrecoverable once issued.
    // The problem document carries title and code only — the operator-facing
    // distinction between "no price" and "no tax rate" lives in the logs, because
    // handleOperation deliberately does not leak an internal message to a client.
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-VAL-001');
  });

  it('refuses when no price is configured, rather than answering zero', async () => {
    authAs(SVC_FULL);
    const response = await resolve({
      serviceId: '00000000-0000-4000-8000-0000000000ff',
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-VAL-001');
  });

  it('requires companyId and branchId, because they are the scope target', async () => {
    authAs(SVC_FULL);
    expect((await resolve({ serviceId: SERVICE_A, companyId: COMPANY_A1 })).status).toBe(422);
    expect((await resolve({ serviceId: SERVICE_A, branchId: BRANCH_A1 })).status).toBe(422);
  });

  it('refuses a branch the caller holds no price permission in (P1-18-A-01)', async () => {
    await publishedListFor({ amount: '10.0000' });

    // A principal holding NO price permission at all: refused, but that refusal is
    // the missing permission and says nothing about scope. Kept as the permission
    // case; the isolation case is the one below.
    authAs(SVC_SCOPED_A2);
    expect(
      (
        await resolve({
          serviceId: SERVICE_A,
          companyId: COMPANY_A1,
          branchId: BRANCH_A1,
        })
      ).status
    ).toBe(403);

    /**
     * The DECISIVE isolation case, and it needs a principal that holds
     * `svc.price.read`.
     *
     * An earlier version of this test used `SVC_SCOPED_A2` and
     * `SVC_PERMISSION_ELSEWHERE`, neither of which holds `svc.price.read` — the
     * permission this route declares. Both 403s were therefore missing-permission
     * refusals, and a scope-BLIND implementation (`iam.has_permission` with no scope,
     * the P1-18-A-01 fallback) produces exactly the same 403. The test could not fail
     * on the defect it was written for.
     *
     * `SVC_PRICE_SCOPED_A2` holds `svc.price.read` in full, scoped to branch A2, and
     * carries the widening grant that puts A1 in its `iam.allowed_branch_ids()` union.
     * So the row is readable and the permission is held: a scope-blind check would
     * ALLOW this and resolve A1's price. Only the scoped check refuses it.
     */
    authAs(SVC_PRICE_SCOPED_A2);
    const refusedElsewhere = await resolve({
      serviceId: SERVICE_A,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
    });
    expect(refusedElsewhere.status).toBe(403);
    // One read of the body, then both assertions off it: a Response body can be
    // consumed only once.
    const refusalText = await refusedElsewhere.text();
    expect((JSON.parse(refusalText) as { code: string }).code).toBe('ERR-IAM-001');
    expect(refusalText).not.toContain('10.0000');
  });

  it('never resolves a tenant-A price for a tenant-B caller', async () => {
    await publishedListFor({ amount: '20.0000' });
    authAs(SVC_TENANT_B);
    const response = await resolve({
      serviceId: SERVICE_A,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
    });
    // Either a scope refusal or "no price" — never tenant A's amount.
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.text()).not.toContain('20.0000');
  });

  /**
   * The ambiguity guard is defensive, and this proves WHY rather than pretending
   * the guard has a positive case.
   *
   * `PriceResolutionService` refuses with `ERR-CON-001` when two rules tie on both
   * specificity and priority. That state cannot be constructed while
   * `uq_price_rules_signature` exists: it is
   * `(version, service, company, branch, customer_class, priority)` with
   * `NULLS NOT DISTINCT`, and a specificity score determines exactly which of
   * company/branch/class are non-null (4 = branch only, 3 = company+class,
   * 6 = branch+company, …), while the resolver's filter forces each non-null
   * column to equal the query value. So a tie implies an identical signature.
   *
   * Asserting the index refuses the duplicate is therefore the honest test: it
   * pins the guarantee the defensive branch depends on, and it would fail if that
   * index were ever dropped or widened — which is exactly when the branch would
   * stop being unreachable.
   */
  it('cannot construct a rule-level tie, because the signature index forbids it', async () => {
    authAs(SVC_FULL);
    const list = (await (
      await createList({
        priceListCode: nextCode(),
        name: 'Tie attempt',
        currency: 'JOD',
      })
    ).json()) as ListBody;
    const version = (await (
      await createVersion(list.id, { effectiveFrom: '2020-01-01' }, list.recordVersion)
    ).json()) as VersionBody;

    const first = await recordRule(list.id, version.id, {
      serviceId: SERVICE_A,
      amount: '41.0000',
      priority: 7,
    });
    expect(first.status).toBe(201);

    // Identical specificity (both wildcard) and identical priority — a true tie.
    const tie = await recordRule(list.id, version.id, {
      serviceId: SERVICE_A,
      amount: '42.0000',
      priority: 7,
    });
    expect(tie.status).toBe(409);
    expect(((await tie.json()) as { code: string }).code).toBe('ERR-CON-001');

    // A DIFFERENT priority is accepted, and then the tie no longer exists: priority
    // is what breaks specificity ties, so resolution stays deterministic.
    const distinct = await recordRule(list.id, version.id, {
      serviceId: SERVICE_A,
      amount: '43.0000',
      priority: 8,
    });
    expect(distinct.status).toBe(201);
  });

  it('refuses an unknown query parameter and a timezone-carrying asOf', async () => {
    authAs(SVC_FULL);
    expect(
      (
        await resolve({
          serviceId: SERVICE_A,
          companyId: COMPANY_A1,
          branchId: BRANCH_A1,
          nope: 'x',
        })
      ).status
    ).toBe(422);
    expect(
      (
        await resolve({
          serviceId: SERVICE_A,
          companyId: COMPANY_A1,
          branchId: BRANCH_A1,
          asOf: '2026-07-27T00:00:00Z',
        })
      ).status
    ).toBe(422);
  });
});

/**
 * The floors the operation-coverage gate derives from the registrations themselves
 * (P1-20-SEC-001, P1-20-QA-003, P1-20-QA-004).
 *
 * Every write here declares `idempotent: true`, three are addressed by a caller-
 * supplied id in the path, and the rule write declares `scope: 'branch'`. The gate
 * requires `idempotency`, `cross-tenant` and `isolation` evidence for exactly those
 * reasons, and it required them only after `svc.`/`quo.` were added to
 * `DERIVED_PREFIXES` — before that the floor was empty and these cases did not
 * exist. They are written against the same route handlers as the cases above, so
 * each proves the deployed refusal rather than a declaration about it.
 */
describe('svc pricing writes — tenant, scope and idempotency floors', () => {
  /** A draft version on a tenant-A list, addressable by id. */
  async function tenantADraft(): Promise<{ priceListId: string; versionId: string }> {
    authAs(SVC_FULL);
    const list = (await (
      await createList({ priceListCode: nextCode(), name: 'Floor fixture', currency: 'JOD' })
    ).json()) as ListBody;
    const version = (await (
      await createVersion(list.id, { effectiveFrom: '2021-01-01' }, list.recordVersion)
    ).json()) as VersionBody;
    return { priceListId: list.id, versionId: version.id };
  }

  /** The same POST, minus the `Idempotency-Key` header. */
  const withoutKey = (url: string, body: unknown, ifMatch?: number): Request =>
    new Request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(ifMatch === undefined ? {} : { 'if-match': String(ifMatch) }),
      },
      body: JSON.stringify(body),
    });

  it('svc.price-list-create refuses a command with no Idempotency-Key', async () => {
    authAs(SVC_FULL);
    const response = await CREATE_LIST(
      withoutKey('http://localhost/api/v1/price-lists', {
        priceListCode: nextCode(),
        name: 'No key',
        currency: 'JOD',
      })
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-INT-002');
  });

  it('svc.price-list-version-create refuses no Idempotency-Key, and a tenant-B caller', async () => {
    authAs(SVC_FULL);
    const list = (await (
      await createList({ priceListCode: nextCode(), name: 'Key floor', currency: 'JOD' })
    ).json()) as ListBody;

    const noKey = await CREATE_VERSION(
      withoutKey(
        `http://localhost/api/v1/price-lists/${list.id}/versions`,
        { effectiveFrom: '2021-01-01' },
        list.recordVersion
      ),
      { params: Promise.resolve({ priceListId: list.id }) }
    );
    expect(noKey.status).toBeGreaterThanOrEqual(400);
    expect(((await noKey.json()) as { code: string }).code).toBe('ERR-INT-002');

    // SVC_TENANT_B_FULL holds svc.price.manage unrestricted, so the only thing left
    // to refuse it is the tenant boundary.
    authAs(SVC_TENANT_B_FULL);
    const asB = await createVersion(list.id, { effectiveFrom: '2021-06-01' }, list.recordVersion);
    expect(asB.status).toBeGreaterThanOrEqual(400);
    expect(asB.status).toBeLessThan(500);
    expect(
      await countRows(admin, 'svc.price_list_versions', 'price_list_id = $1 AND version_no > 1', [
        list.id,
      ])
    ).toBe(0);
  });

  it('svc.price-rule-record refuses no Idempotency-Key, a tenant-B caller, and another branch', async () => {
    const draft = await tenantADraft();

    authAs(SVC_FULL);
    const noKey = await RECORD_RULE(
      withoutKey(
        `http://localhost/api/v1/price-lists/${draft.priceListId}/versions/${draft.versionId}/rules`,
        { serviceId: SERVICE_A, amount: '1.0000' }
      ),
      {
        params: Promise.resolve({
          priceListId: draft.priceListId,
          versionId: draft.versionId,
        }),
      }
    );
    expect(noKey.status).toBeGreaterThanOrEqual(400);
    expect(((await noKey.json()) as { code: string }).code).toBe('ERR-INT-002');

    authAs(SVC_TENANT_B_FULL);
    const asB = await recordRule(draft.priceListId, draft.versionId, {
      serviceId: SERVICE_A,
      amount: '9999.0000',
    });
    expect(asB.status).toBeGreaterThanOrEqual(400);
    expect(asB.status).toBeLessThan(500);

    /**
     * The isolation case, and the reason `scope: 'branch'` is not decoration here.
     *
     * SVC_PRICE_SCOPED_A2 holds `svc.price.manage` in FULL — scoped to branch A2. A
     * rule naming branch A1 sets the price charged in A1, so it must be refused, and
     * the refusal has to be the resolved scope rather than a missing permission,
     * which is why this principal holds the permission unreservedly.
     */
    authAs(SVC_PRICE_SCOPED_A2);
    const wrongBranch = await recordRule(draft.priceListId, draft.versionId, {
      serviceId: SERVICE_A,
      amount: '0.0100',
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      priority: 999,
    });
    expect(wrongBranch.status).toBe(403);
    expect(((await wrongBranch.json()) as { code: string }).code).toBe('ERR-IAM-001');
    expect(
      await countRows(admin, 'svc.price_rules', 'price_list_version_id = $1', [draft.versionId])
    ).toBe(0);
  });

  it('refuses a caller who lacks the write permission on every pricing write', async () => {
    /**
     * The `authorization` floor, which the tenant and scope cases cannot supply.
     *
     * A tenant-B refusal proves the tenant boundary; an A2-scoped refusal proves the
     * scope check. Neither proves that a caller in the RIGHT tenant and the RIGHT
     * branch, lacking only the permission, is refused — and every earlier call on
     * these three routes used a principal that held it. `SVC_READER` holds
     * `svc.service.read` alone.
     */
    const draft = await tenantADraft();

    authAs(SVC_READER);
    const version = await createVersion(draft.priceListId, { effectiveFrom: '2022-01-01' }, 1);
    expect(version.status).toBe(403);
    expect(((await version.json()) as { code: string }).code).toBe('ERR-IAM-001');

    const rule = await recordRule(draft.priceListId, draft.versionId, {
      serviceId: SERVICE_A,
      amount: '1.0000',
    });
    expect(rule.status).toBe(403);
    expect(((await rule.json()) as { code: string }).code).toBe('ERR-IAM-001');

    const published = await publish(
      draft.priceListId,
      draft.versionId,
      { effectiveFrom: '2022-01-01' },
      1
    );
    expect(published.status).toBe(403);

    // 401 as well: an unauthenticated caller never reaches the permission check.
    __resetAuthenticatorForTests();
    expect(
      (
        await recordRule(draft.priceListId, draft.versionId, {
          serviceId: SERVICE_A,
          amount: '1.0000',
        })
      ).status
    ).toBe(401);
  });

  it('publication needs svc.price.publish, and svc.price.manage is not enough', async () => {
    /**
     * The permission SPLIT, proved with a principal that holds one and not the other.
     *
     * The existing case for this used `SVC_READER`, which holds NEITHER — so it proved
     * only that some unrelated principal is refused, while the evidence claimed the
     * split was demonstrated. `SVC_NO_CEILING` holds `svc.price.manage` (it builds the
     * draft below itself) and not `svc.price.publish`, which is the only shape that
     * can distinguish the two.
     */
    authAs(SVC_NO_CEILING);
    const list = (await (
      await createList({ priceListCode: nextCode(), name: 'Split proof', currency: 'JOD' })
    ).json()) as ListBody;
    expect(list.id).toBeDefined();
    const version = (await (
      await createVersion(list.id, { effectiveFrom: '2022-03-01' }, list.recordVersion)
    ).json()) as VersionBody;
    expect(
      (await recordRule(list.id, version.id, { serviceId: SERVICE_A, amount: '7.0000' })).status
    ).toBe(201);

    // Same principal, same list it just built: only the publish permission is missing.
    const refused = await publish(
      list.id,
      version.id,
      { effectiveFrom: '2022-03-01' },
      await priceListVersionOf(list.id)
    );
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { code: string }).code).toBe('ERR-IAM-001');

    // And SVC_FULL, which holds both, publishes the very same version.
    authAs(SVC_FULL);
    expect(
      (
        await publish(
          list.id,
          version.id,
          { effectiveFrom: '2022-03-01' },
          await priceListVersionOf(list.id)
        )
      ).status
    ).toBe(200);
  });

  it('svc.price-list-version-publish refuses a WRONG If-Match, not merely a missing one', async () => {
    /**
     * The `stale-version` floor. `versionGuarded: true` means two things — the header
     * is mandatory, and a wrong value is refused — and only the first was tested: every
     * publish call passed `await priceListVersionOf(...)`, the current version.
     */
    const draft = await tenantADraft();
    authAs(SVC_FULL);
    expect(
      (
        await recordRule(draft.priceListId, draft.versionId, {
          serviceId: SERVICE_A,
          amount: '3.0000',
        })
      ).status
    ).toBe(201);

    const stale = await publish(
      draft.priceListId,
      draft.versionId,
      { effectiveFrom: '2022-05-01' },
      999
    );
    expect(stale.status).toBeGreaterThanOrEqual(400);
    expect(((await stale.json()) as { code: string }).code).toBe('ERR-CON-001');

    // Still draft, so the stale request changed nothing.
    const after = await admin.query<{ status: string }>(
      `SELECT status FROM svc.price_list_versions WHERE id = $1`,
      [draft.versionId]
    );
    expect(after.rows[0]?.status).toBe('draft');
  });

  it('svc.price-list-version-publish refuses no Idempotency-Key, and a tenant-B caller', async () => {
    const draft = await tenantADraft();
    authAs(SVC_FULL);
    expect(
      (
        await recordRule(draft.priceListId, draft.versionId, {
          serviceId: SERVICE_A,
          amount: '5.0000',
        })
      ).status
    ).toBe(201);

    const noKey = await PUBLISH(
      withoutKey(
        `http://localhost/api/v1/price-lists/${draft.priceListId}/versions/${draft.versionId}/publication`,
        { effectiveFrom: '2021-01-01' },
        await priceListVersionOf(draft.priceListId)
      ),
      {
        params: Promise.resolve({
          priceListId: draft.priceListId,
          versionId: draft.versionId,
        }),
      }
    );
    expect(noKey.status).toBeGreaterThanOrEqual(400);
    expect(((await noKey.json()) as { code: string }).code).toBe('ERR-INT-002');

    authAs(SVC_TENANT_B_FULL);
    const asB = await publish(
      draft.priceListId,
      draft.versionId,
      { effectiveFrom: '2021-01-01' },
      await priceListVersionOf(draft.priceListId)
    );
    expect(asB.status).toBeGreaterThanOrEqual(400);
    expect(asB.status).toBeLessThan(500);
    // Still draft: a tenant-B caller could not publish tenant A's version.
    const after = await admin.query<{ status: string }>(
      `SELECT status FROM svc.price_list_versions WHERE id = $1`,
      [draft.versionId]
    );
    expect(after.rows[0]?.status).toBe('draft');
  });
});

/**
 * `callerApprovalCeiling` — a role's ceiling counts only where the GRANT reaches
 * (P1-20-BE-006, P1-20-SEC-001, P1-20-SEC-003).
 *
 * `iam.approval_limits` rows are per `(role, company)`, and a role grant may be
 * confined to particular companies or branches. The helper's role subquery filtered on
 * tenant and user only, so an actor inherited a role's ceiling in EVERY company that
 * role had a limit in — including companies their grant of that role never covered.
 *
 * Demonstrating it needs two companies in one tenant, which is why the P1-20 fixtures
 * seed `COMPANY_A2`. `SVC_PRICE_SCOPED_A2`'s grants are branch-scoped inside
 * `COMPANY_A1`, so a limit for its role in `COMPANY_A2` must not reach it, while the
 * same role's limit in `COMPANY_A1` must — a branch-scoped approver keeps the ceiling
 * their own company grants them.
 */
describe('callerApprovalCeiling respects grant scope', () => {
  const ceilingFor = (
    companyId: string
  ): Promise<{ amount: string; currencyCode: string } | null> =>
    withTransaction(
      contextFor({
        userId: SVC_PRICE_SCOPED_A2.userId,
        tenantId: TENANT_A,
        companyIds: [COMPANY_A1, COMPANY_A2],
        branchIds: [BRANCH_A1, BRANCH_A2_OF_COMPANY_A2],
        operation: 'svc.price-resolve',
        module: 'pricing',
      }),
      (db) => callerApprovalCeiling(db, companyId, 'discount', EFFECTIVE_FROM)
    );

  it('ignores a role limit in a company the role grant does not cover', async () => {
    await seedDiscountCeiling({
      tenantId: TENANT_A,
      companyId: COMPANY_A2,
      roleId: SVC_PRICE_SCOPED_A2.roleId,
      amount: '5000.0000',
      currencyCode: 'JOD',
    });
    // The row exists and matches tenant, company, role and limit type — everything the
    // previous query looked at. Only grant scope excludes it.
    const seeded = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM iam.approval_limits
        WHERE tenant_id = $1 AND company_id = $2 AND role_id = $3`,
      [TENANT_A, COMPANY_A2, SVC_PRICE_SCOPED_A2.roleId]
    );
    expect(seeded.rows[0]?.n).toBe('1');

    expect(await ceilingFor(COMPANY_A2)).toBeNull();
  });

  it('honours the same role limit in the company the grant DOES cover', async () => {
    await seedDiscountCeiling({
      tenantId: TENANT_A,
      companyId: COMPANY_A1,
      roleId: SVC_PRICE_SCOPED_A2.roleId,
      amount: '25.0000',
      currencyCode: 'JOD',
    });
    // The grant is branch-scoped in COMPANY_A1, and a branch belongs to a company, so
    // the limit reaches it. Without this half the fix could have been "always return
    // null", which no assertion above would have caught.
    expect(await ceilingFor(COMPANY_A1)).toEqual({ amount: '25.0000', currencyCode: 'JOD' });
  });
});

/**
 * Tenant-wide price writes require tenant-wide authority (P1-20-SEC-001, P1-20-SEC-003).
 *
 * This closes the escalation the `scope: 'branch'` change on `svc.price-rule-record` only
 * half closed. Authorizing the SELECTOR protects the narrow case and leaves the broad one
 * open: a rule with both selectors omitted is a WILDCARD, which `svc.resolve_price` applies
 * to every company and every branch, and an empty target makes `requiresScopedEvaluation`
 * return false whatever the declared scope — so that path fell through to the scope-blind
 * `iam.has_permission`. An actor granted `svc.price.manage` in one branch could therefore
 * price every branch, which is exactly what the change was supposed to prevent.
 *
 * `SVC_PRICE_SCOPED_A2` is the decisive principal: it holds `svc.price.manage` and
 * `svc.price.publish` in FULL, so every refusal below is the SCOPE MODE of its grant and
 * nothing else. `SVC_FULL` holds the same permissions through an unrestricted grant and
 * must succeed on the identical request, which is what makes the discrimination real
 * rather than a blanket refusal.
 */
describe('tenant-wide price writes need an unrestricted grant', () => {
  it('refuses a WILDCARD price rule to a branch-scoped actor, and allows it to an unrestricted one', async () => {
    authAs(SVC_FULL);
    const list = (await (
      await createList({ priceListCode: nextCode(), name: 'Wildcard scope', currency: 'JOD' })
    ).json()) as ListBody;
    const version = (await (
      await createVersion(list.id, { effectiveFrom: '2023-01-01' }, list.recordVersion)
    ).json()) as VersionBody;

    // The wildcard rule: no companyId, no branchId. Broadest possible selector.
    const wildcard = { serviceId: SERVICE_A, amount: '0.0100' };

    authAs(SVC_PRICE_SCOPED_A2);
    const refused = await recordRule(list.id, version.id, wildcard);
    expect(refused.status).toBe(403);
    const body = (await refused.json()) as { code: string };
    expect(body.code).toBe('ERR-IAM-001');
    expect(
      await countRows(admin, 'svc.price_rules', 'price_list_version_id = $1', [version.id])
    ).toBe(0);

    // The SAME request from an unrestricted grant succeeds, so the refusal above is the
    // grant's scope mode and not the request, the permission, or the version's state.
    authAs(SVC_FULL);
    expect((await recordRule(list.id, version.id, wildcard)).status).toBe(201);
    expect(
      await countRows(admin, 'svc.price_rules', 'price_list_version_id = $1', [version.id])
    ).toBe(1);

    // And the branch-scoped actor can still write a rule for its OWN branch, which is
    // what its grant says. A blanket refusal would have been the wrong fix.
    authAs(SVC_PRICE_SCOPED_A2);
    expect(
      (
        await recordRule(list.id, version.id, {
          serviceId: SERVICE_A,
          amount: '5.0000',
          companyId: COMPANY_A1,
          branchId: BRANCH_A2,
          priority: 3,
        })
      ).status
    ).toBe(201);
  });

  it('refuses PUBLICATION to a branch-scoped actor holding svc.price.publish in full', async () => {
    authAs(SVC_FULL);
    const list = (await (
      await createList({ priceListCode: nextCode(), name: 'Publish scope', currency: 'JOD' })
    ).json()) as ListBody;
    const version = (await (
      await createVersion(list.id, { effectiveFrom: '2023-02-01' }, list.recordVersion)
    ).json()) as VersionBody;
    expect(
      (await recordRule(list.id, version.id, { serviceId: SERVICE_A, amount: '9.0000' })).status
    ).toBe(201);

    /**
     * Publication is what makes a version's prices the ones the tenant charges, and it is
     * effectively irreversible — the freeze guard permits only `published → archived`. A
     * price list carries no company and no branch, so there is no target to authorize and
     * `scope: 'tenant'` degraded to a scope-blind check.
     */
    authAs(SVC_PRICE_SCOPED_A2);
    const refused = await publish(
      list.id,
      version.id,
      { effectiveFrom: '2023-02-01' },
      await priceListVersionOf(list.id)
    );
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { code: string }).code).toBe('ERR-IAM-001');
    const still = await admin.query<{ status: string }>(
      `SELECT status FROM svc.price_list_versions WHERE id = $1`,
      [version.id]
    );
    expect(still.rows[0]?.status).toBe('draft');

    // Unrestricted: the same version publishes.
    authAs(SVC_FULL);
    expect(
      (
        await publish(
          list.id,
          version.id,
          { effectiveFrom: '2023-02-01' },
          await priceListVersionOf(list.id)
        )
      ).status
    ).toBe(200);
  });
});
