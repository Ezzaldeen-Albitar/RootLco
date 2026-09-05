/**
 * P1-30 W2 — the pricing reads answer a real actor with real rows, and the
 * web mirror is the shape they answer with.
 *
 * PC-1 on the four reads the pricing screens render — the price-list list and
 * detail, the rules of a version, and the resolved price — which is what the
 * canonical plan's W2 row says this wave proves: "a resolved price shown is
 * the server's; tax display from the resolved figures". On the wire that means
 * `unitPrice`, `amount` and `taxRate` are decimal STRINGS the screen passes
 * through, `taxRate` is a FRACTION, and `specificity` is a number the server
 * computed.
 *
 * ## The mirror is PARSED, not trusted
 *
 * `apps/web` may not import `apps/api`, so the shapes the screens render are a
 * hand-written mirror in `features/pricing/pricing-contract.ts`, and a mirror
 * is a copy: it can name a field the backend dropped, or miss one it added,
 * and the repository would still be green. So the interfaces are parsed out of
 * the mirror's own source with TypeScript and held against rows that came out
 * of the database — set equality in BOTH directions, once per response shape.
 *
 * ## The version a guarded write needs is the LIST's
 *
 * `svc.price-list-version-create` and `-publish` guard the price list's
 * `record_version`, which is what `svc.price-list-detail` publishes as its
 * ETag. This suite takes it from the detail — the way the screen does — and
 * shows a stale one is refused.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   svc.price-list-list: route service authorization success denial cross-tenant
 *   svc.price-list-detail: route service authorization success denial cross-tenant
 *   svc.price-rule-list: route service authorization success denial cross-tenant
 *   svc.price-resolve: route service authorization success denial cross-tenant
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import ts from 'typescript';

import {
  BRANCH_A1,
  COMPANY_A1,
  TENANT_A,
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
  SVC_TENANT_B,
  SVC_UNPERMITTED,
  TAX_CLASS_A,
  TAX_RATE_FRACTION,
  assignPriceList,
  authAs,
  establishP1_20Fixtures,
  priceListVersionOf,
} from './p1-20-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as LIST_LISTS, POST as CREATE_LIST } from '@/app/api/v1/price-lists/route';
import { GET as DETAIL } from '@/app/api/v1/price-lists/[priceListId]/route';
import { POST as CREATE_VERSION } from '@/app/api/v1/price-lists/[priceListId]/versions/route';
import {
  GET as LIST_RULES,
  POST as RECORD_RULE,
} from '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/rules/route';
import { POST as PUBLISH } from '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/publication/route';
import { GET as RESOLVE } from '@/app/api/v1/prices/route';

const CONTRACT = join(
  process.cwd(),
  'apps',
  'web',
  'src',
  'features',
  'pricing',
  'pricing-contract.ts'
);

const AMOUNT = '77.5000';

let admin: Pool;
let runtime: Pool;
let listId = '';
let versionId = '';
let codeSeq = 0;

const nextCode = (): string => {
  codeSeq += 1;
  return `FX-W2-${String(Date.now() % 100000)}-${codeSeq}`;
};

const JSON_HEADERS = (extra: Record<string, string> = {}) => ({
  'content-type': 'application/json',
  'idempotency-key': crypto.randomUUID(),
  ...extra,
});

function listLists(query: Record<string, string> = {}): Promise<Response> {
  const url = new URL('http://localhost/api/v1/price-lists');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return LIST_LISTS(new Request(url));
}

function detail(priceListId: string): Promise<Response> {
  return DETAIL(new Request(`http://localhost/api/v1/price-lists/${priceListId}`), {
    params: Promise.resolve({ priceListId }),
  });
}

function rules(priceListId: string, version: string): Promise<Response> {
  return LIST_RULES(
    new Request(`http://localhost/api/v1/price-lists/${priceListId}/versions/${version}/rules`),
    { params: Promise.resolve({ priceListId, versionId: version }) }
  );
}

function resolve(query: Record<string, string>): Promise<Response> {
  const url = new URL('http://localhost/api/v1/prices');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return RESOLVE(new Request(url));
}

function createList(body: unknown): Promise<Response> {
  return CREATE_LIST(
    new Request('http://localhost/api/v1/price-lists', {
      method: 'POST',
      headers: JSON_HEADERS(),
      body: JSON.stringify(body),
    })
  );
}

function createVersion(priceListId: string, body: unknown, ifMatch: number): Promise<Response> {
  return CREATE_VERSION(
    new Request(`http://localhost/api/v1/price-lists/${priceListId}/versions`, {
      method: 'POST',
      headers: JSON_HEADERS({ 'if-match': String(ifMatch) }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ priceListId }) }
  );
}

function recordRule(priceListId: string, version: string, body: unknown): Promise<Response> {
  return RECORD_RULE(
    new Request(`http://localhost/api/v1/price-lists/${priceListId}/versions/${version}/rules`, {
      method: 'POST',
      headers: JSON_HEADERS(),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ priceListId, versionId: version }) }
  );
}

function publish(
  priceListId: string,
  version: string,
  body: unknown,
  ifMatch: number
): Promise<Response> {
  return PUBLISH(
    new Request(
      `http://localhost/api/v1/price-lists/${priceListId}/versions/${version}/publication`,
      {
        method: 'POST',
        headers: JSON_HEADERS({ 'if-match': String(ifMatch) }),
        body: JSON.stringify(body),
      }
    ),
    { params: Promise.resolve({ priceListId, versionId: version }) }
  );
}

const json = async <T>(response: Response): Promise<T> => (await response.json()) as T;
const codeOf = async (response: Response): Promise<string> =>
  (await json<{ code: string }>(response)).code;

/** The field names of one interface in the web contract, PARSED from its syntax tree. */
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

/** The members of an exported `as const` string array in the mirror, PARSED. */
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

const keysOf = (value: unknown): string[] => Object.keys(value as Record<string, unknown>).sort();
const mirror = (name: string): string[] => [...mirrorFields(name)].sort();

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_20Fixtures(admin);
  runtime = runtimeAppPool(8);
  __setPrimaryPoolForTests(runtime);

  // One published price list with one company-scoped, taxed rule for
  // SERVICE_A, assigned to company A1 — built through the real routes, with
  // If-Match taken from the LIST, the way the screen does it.
  authAs(SVC_FULL);
  const created = await json<{ id: string; recordVersion: number }>(
    await createList({ priceListCode: nextCode(), name: 'W2 fixture list', currency: 'JOD' })
  );
  listId = created.id;
  const version = await json<{ id: string }>(
    await createVersion(listId, { effectiveFrom: '2020-01-01' }, created.recordVersion)
  );
  versionId = version.id;
  const recorded = await recordRule(listId, versionId, {
    serviceId: SERVICE_A,
    amount: AMOUNT,
    companyId: COMPANY_A1,
    taxClassId: TAX_CLASS_A,
  });
  if (recorded.status !== 201) throw new Error(`fixture rule refused: ${recorded.status}`);
  const published = await publish(
    listId,
    versionId,
    { effectiveFrom: '2020-01-01' },
    await priceListVersionOf(listId)
  );
  if (published.status !== 200) throw new Error(`fixture publish refused: ${published.status}`);
  await assignPriceList({
    tenantId: TENANT_A,
    priceListId: listId,
    companyId: COMPANY_A1,
    branchId: null,
    customerClass: null,
    priority: 1,
  });
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

describe('P1-30 W2 — the pricing reads answer a real actor with real rows', () => {
  it('W2-1 the list is bounded, not paged, and its row is the mirror’s shape', async () => {
    authAs(SVC_FULL);
    const response = await listLists({ limit: '100' });
    expect(response.status).toBe(200);
    const body = await json<{ items: Record<string, unknown>[] }>(response);
    // The contract publishes `items` and NOTHING else: no cursor, no hasMore, no total.
    expect(keysOf(body)).toEqual(['items']);
    const row = body.items.find((entry) => entry['id'] === listId);
    expect(row).toBeDefined();
    expect(keysOf(row)).toEqual(mirror('PriceListSummary'));
    expect(typeof row?.['recordVersion']).toBe('number');
    expect(row?.['currency']).toBe('JOD');
  });

  it('W2-2 the detail carries the versions inside it, and its ETag is the LIST version', async () => {
    authAs(SVC_FULL);
    const response = await detail(listId);
    expect(response.status).toBe(200);
    const body = await json<{ versions: Record<string, unknown>[]; recordVersion: number }>(
      response
    );
    expect(keysOf(body)).toEqual(mirror('PriceListDetail'));
    expect(body.versions.length).toBeGreaterThan(0);
    expect(keysOf(body.versions[0])).toEqual(mirror('PriceListVersion'));
    expect(body.versions[0]?.['status']).toBe('published');
    const etag = response.headers.get('etag');
    expect(etag).not.toBeNull();
    // The ETag is the LIST's record version — the one the guarded writes need.
    expect(String(etag).replace(/"/g, '')).toBe(String(await priceListVersionOf(listId)));
    expect(body.recordVersion).toBe(await priceListVersionOf(listId));
  });

  it('W2-3 the rules list is the mirror’s shape, with money as strings and specificity as the server’s number', async () => {
    authAs(SVC_FULL);
    const response = await rules(listId, versionId);
    expect(response.status).toBe(200);
    const body = await json<{ rules: Record<string, unknown>[]; currency: string }>(response);
    expect(keysOf(body)).toEqual(mirror('PriceListRules'));
    expect(body.rules.length).toBe(1);
    const rule = body.rules[0] as Record<string, unknown>;
    expect(keysOf(rule)).toEqual(mirror('PriceRuleRow'));
    expect(keysOf(rule['service'])).toEqual(mirror('PriceRuleService'));
    expect(keysOf(rule['appliesTo'])).toEqual(mirror('PriceRuleNarrowing'));
    expect(typeof rule['amount']).toBe('string');
    expect(rule['amount']).toBe(AMOUNT);
    expect(rule['currency']).toBe('JOD');
    expect(body.currency).toBe('JOD');
    // Company named, no branch, no class: the server weighs that as 2.
    expect(rule['specificity']).toBe(2);
    expect(typeof rule['priority']).toBe('number');
    expect((rule['appliesTo'] as Record<string, unknown>)['companyId']).toBe(COMPANY_A1);
  });

  it('W2-4 the resolved price is the server’s figures — strings, and the tax rate a fraction', async () => {
    authAs(SVC_FULL);
    const response = await resolve({
      serviceId: SERVICE_A,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
    });
    expect(response.status).toBe(200);
    const body = await json<Record<string, unknown>>(response);
    expect(keysOf(body)).toEqual(mirror('ResolvedPrice'));
    expect(typeof body['unitPrice']).toBe('string');
    expect(body['unitPrice']).toBe(AMOUNT);
    expect(body['currency']).toBe('JOD');
    expect(typeof body['taxRate']).toBe('string');
    expect(body['taxRate']).toBe(TAX_RATE_FRACTION);
    expect(typeof body['taxClassCode']).toBe('string');
    expect(typeof body['asOf']).toBe('string');
  });

  it('W2-5 an actor without svc.price.read is REFUSED on every read; refusal is not an empty list', async () => {
    authAs(SVC_UNPERMITTED);
    for (const response of [
      await listLists(),
      await detail(listId),
      await rules(listId, versionId),
      await resolve({ serviceId: SERVICE_A, companyId: COMPANY_A1, branchId: BRANCH_A1 }),
    ]) {
      expect(response.status).toBe(403);
      expect(await codeOf(response)).toBe('ERR-IAM-001');
    }
  });

  it('W2-6 another tenant cannot see the list, the detail or the rules', async () => {
    authAs(SVC_TENANT_B);
    const theirs = await json<{ items: { id: string }[] }>(await listLists({ limit: '100' }));
    expect(theirs.items.map((row) => row.id)).not.toContain(listId);
    const foreign = await detail(listId);
    expect(foreign.status).toBe(404);
    expect(await codeOf(foreign)).toBe('ERR-RES-001');
    const foreignRules = await rules(listId, versionId);
    expect(foreignRules.status).toBe(404);
    expect(await codeOf(foreignRules)).toBe('ERR-RES-001');
  });

  it('W2-7 the vocabularies the screens offer are the ones the backend uses', async () => {
    expect(new Set(mirrorVocabulary('PRICE_LIST_VERSION_STATES'))).toEqual(
      new Set(['draft', 'published', 'archived'])
    );
    expect(new Set(mirrorVocabulary('ACTIVATION_STATES'))).toEqual(new Set(['active', 'inactive']));
  });

  it('W2-8 a guarded write with a stale LIST version is refused, and the detail’s version is accepted', async () => {
    authAs(SVC_FULL);
    const current = await priceListVersionOf(listId);
    const stale = await createVersion(listId, { effectiveFrom: '2030-01-01' }, current + 999);
    expect(stale.status).toBe(409);
    const fresh = await createVersion(listId, { effectiveFrom: '2030-01-01' }, current);
    expect(fresh.status).toBe(201);
    const body = await json<Record<string, unknown>>(fresh);
    expect(keysOf(body)).toEqual(mirror('PriceListVersion'));
    expect(body['status']).toBe('draft');
  });

  it('W2-9 a version under another list is a uniform not-found, and a malformed id is a validation refusal', async () => {
    authAs(SVC_FULL);
    const other = await json<{ id: string }>(
      await createList({ priceListCode: nextCode(), name: 'Other list', currency: 'JOD' })
    );
    const crossed = await rules(other.id, versionId);
    expect(crossed.status).toBe(404);
    expect(await codeOf(crossed)).toBe('ERR-RES-001');
    const malformed = await detail('not-a-price-list');
    expect(malformed.status).toBe(422);
    expect(await codeOf(malformed)).toBe('ERR-VAL-001');
  });
});
