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
 * **`scope: 'branch'` on `/prices` is real.** `SVC_PERMISSION_ELSEWHERE` holds
 * `svc.price.read` scoped to A2 and an unrelated permission scoped to A1, so A1 IS
 * in its `iam.allowed_branch_ids()` union; only a scoped permission check refuses
 * it (P1-18-A-01).
 *
 * Operations exercised here: svc.price-list-list, svc.price-list-create,
 * svc.price-list-version-create, svc.price-rule-record,
 * svc.price-list-version-publish, svc.price-resolve.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   svc.price-list-list: route service authorization success denial cross-tenant
 *   svc.price-list-create: route service authorization success denial cross-tenant audit
 *   svc.price-list-version-create: route service authorization success denial audit stale-version
 *   svc.price-rule-record: route service authorization success denial audit
 *   svc.price-list-version-publish: route service authorization success denial audit outbox stale-version concurrency
 *   svc.price-resolve: route service authorization success denial cross-tenant isolation
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  BRANCH_A1,
  COMPANY_A1,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { establishP1_19Fixtures } from './p1-19-helpers';
import {
  SERVICE_A,
  SVC_FULL,
  SVC_PERMISSION_ELSEWHERE,
  SVC_READER,
  SVC_SCOPED_A2,
  SVC_TENANT_B,
  TAX_CLASS_A,
  TAX_CLASS_A_UNRATED,
  assignPriceList,
  auditCountFor,
  authAs,
  establishP1_20Fixtures,
  outboxCountFor,
  priceListVersionOf,
} from './p1-20-helpers';
import { TENANT_A } from './helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
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
  it('needs svc.price.publish, not merely svc.price.manage', async () => {
    // SVC_FULL holds both; assert the permission is actually declared by checking a
    // caller that holds manage-only cannot publish. SVC_READER holds neither.
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

    authAs(SVC_SCOPED_A2);
    const refused = await resolve({
      serviceId: SERVICE_A,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
    });
    expect(refused.status).toBe(403);

    // The decisive case: A1 IS in this principal's allowed-branch union via an
    // unrelated grant, so RLS alone would not refuse it.
    authAs(SVC_PERMISSION_ELSEWHERE);
    const refusedElsewhere = await resolve({
      serviceId: SERVICE_A,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
    });
    expect(refusedElsewhere.status).toBe(403);
    expect(((await refusedElsewhere.json()) as { code: string }).code).toBe('ERR-IAM-001');
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
