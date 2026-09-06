/**
 * P1-30 W1 — the service catalogue answers a real actor with real rows.
 *
 * PC-1 on `svc.service-list`, which is what the canonical plan's W1 row says
 * this wave proves: authorized sees, unauthorized is refused, cross-tenant is
 * invisible — and "retired and unavailable services rendered as such", which
 * on the wire means an archived service is still returned and still says so.
 *
 * ## The mirror is PARSED, not trusted
 *
 * `apps/web` may not import `apps/api`, so the row shape the screen renders is
 * a hand-written mirror in `features/services/services-contract.ts`, and a
 * mirror is a copy: it can name a field the backend dropped, or miss one it
 * added, and the repository would still be green. So the interfaces are parsed
 * out of the mirror's own source with TypeScript and held against a row that
 * came out of the database — set equality in BOTH directions, once for the
 * list row and once for the detail body, because they are two operations.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   svc.service-list: route service authorization success denial cross-tenant
 *   svc.service-detail: route service authorization success denial cross-tenant
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import ts from 'typescript';

import {
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { establishP1_19Fixtures } from './p1-19-helpers';
import {
  SERVICE_A,
  SERVICE_A_ARCHIVED,
  SERVICE_B,
  SVC_FULL,
  SVC_TENANT_B,
  SVC_UNPERMITTED,
  authAs,
  establishP1_20Fixtures,
} from './p1-20-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as LIST } from '@/app/api/v1/services/route';
import { GET as DETAIL } from '@/app/api/v1/services/[serviceId]/route';

const CONTRACT = join(
  process.cwd(),
  'apps',
  'web',
  'src',
  'features',
  'services',
  'services-contract.ts'
);

let admin: Pool;
let runtime: Pool;

interface Row {
  readonly id: string;
  readonly [key: string]: unknown;
}
interface Page {
  readonly items: readonly Row[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

function list(query: Record<string, string> = {}): Promise<Response> {
  const url = new URL('http://localhost/api/v1/services');
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return LIST(new Request(url));
}

function detail(serviceId: string): Promise<Response> {
  return DETAIL(new Request(`http://localhost/api/v1/services/${serviceId}`), {
    params: Promise.resolve({ serviceId }),
  });
}

const page = async (response: Response): Promise<Page> => (await response.json()) as Page;
const codeOf = async (response: Response): Promise<string> =>
  ((await response.json()) as { code: string }).code;

/**
 * The field names of one interface in the web contract, PARSED.
 *
 * A regular expression over the source would answer for a name inside a
 * comment or a neighbouring interface. This walks the real syntax tree, so what
 * comes back is what TypeScript itself sees.
 */
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

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  // P1-20's scoped principals are granted on BRANCH_A2, which P1-19 creates;
  // `fk_grant_scopes_branch` refuses the grant without it.
  await establishP1_19Fixtures(admin);
  await establishP1_20Fixtures(admin);
  runtime = runtimeAppPool(4);
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

describe('P1-30 W1 — svc.service-list answers a real actor with real rows', () => {
  it('W1-1 a permitted actor sees the services of their tenant', async () => {
    authAs(SVC_FULL);
    const response = await list({ limit: '100' });
    expect(response.status).toBe(200);
    const body = await page(response);
    expect(body.items.map((row) => row.id)).toContain(SERVICE_A);
    const row = body.items.find((entry) => entry.id === SERVICE_A);
    expect(typeof row?.['serviceCode']).toBe('string');
    expect(typeof row?.['lifecycleStatus']).toBe('string');
    expect(typeof row?.['recordVersion']).toBe('number');
    // The server's own end-of-set signals, and no total to invent.
    expect(typeof body.hasMore).toBe('boolean');
    expect(body).not.toHaveProperty('total');
  });

  it('W1-2 an actor without svc.service.read is REFUSED, and refusal is not an empty catalogue', async () => {
    authAs(SVC_UNPERMITTED);
    const response = await list();
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe('ERR-IAM-001');
  });

  it('W1-3 a service in another tenant is not in this catalogue, in either direction', async () => {
    authAs(SVC_FULL);
    const mine = (await page(await list({ limit: '100' }))).items.map((row) => row.id);
    expect(mine).toContain(SERVICE_A);
    expect(mine).not.toContain(SERVICE_B);

    authAs(SVC_TENANT_B);
    const theirs = (await page(await list({ limit: '100' }))).items.map((row) => row.id);
    expect(theirs).toContain(SERVICE_B);
    expect(theirs).not.toContain(SERVICE_A);

    // The id-addressed read agrees: tenant B cannot read tenant A's service.
    const foreign = await detail(SERVICE_A);
    expect(foreign.status).toBe(404);
    expect(await codeOf(foreign)).toBe('ERR-RES-001');
  });

  it('W1-4 the web contract mirror is the shape the backend really answers with', async () => {
    authAs(SVC_FULL);
    const row = (await page(await list({ limit: '100' }))).items.find((e) => e.id === SERVICE_A);
    expect(row).toBeDefined();
    // Set equality in BOTH directions. A mirror missing a field silently drops
    // a column the operator was meant to see; a mirror naming a field the
    // response lacks renders a blank and calls it data.
    expect(Object.keys(row ?? {}).sort()).toEqual([...mirrorFields('ServiceSummary')].sort());

    const one = (await (await detail(SERVICE_A)).json()) as Record<string, unknown>;
    expect(Object.keys(one).sort()).toEqual([...mirrorFields('ServiceDetail')].sort());
  });

  it('W1-5 a retired service is still listed and says so; the filter separates the two', async () => {
    authAs(SVC_FULL);
    // Unfiltered: archived rows are RETURNED. Hiding them would make every work
    // order that cites one dangle, and the screen renders them as retired.
    const all = (await page(await list({ limit: '100' }))).items;
    const retired = all.find((row) => row.id === SERVICE_A_ARCHIVED);
    expect(retired).toBeDefined();
    expect(retired?.['lifecycleStatus']).toBe('archived');

    // Filtered to active: the retired one is gone and the active one remains.
    const active = (await page(await list({ limit: '100', lifecycleStatus: 'active' }))).items;
    expect(active.map((row) => row.id)).toContain(SERVICE_A);
    expect(active.map((row) => row.id)).not.toContain(SERVICE_A_ARCHIVED);

    // And the other way round.
    const archived = (await page(await list({ limit: '100', lifecycleStatus: 'archived' }))).items;
    expect(archived.map((row) => row.id)).toContain(SERVICE_A_ARCHIVED);
    expect(archived.map((row) => row.id)).not.toContain(SERVICE_A);
  });

  it('W1-6 the lifecycle vocabulary the screen offers is the one the backend accepts', async () => {
    authAs(SVC_FULL);
    const mirrored = mirrorVocabulary('SERVICE_LIFECYCLE_STATES');
    expect(new Set(mirrored)).toEqual(new Set(['active', 'archived']));
    for (const state of mirrored) {
      expect((await list({ lifecycleStatus: state })).status, `${state} was refused`).toBe(200);
    }
    // A value outside the vocabulary is a 422, not a silently empty page.
    const refused = await list({ lifecycleStatus: 'retired' });
    expect(refused.status).toBe(422);
    expect(await codeOf(refused)).toBe('ERR-VAL-001');
  });

  it('W1-7 an unknown query parameter is refused rather than ignored', async () => {
    authAs(SVC_FULL);
    // The screen sends `availableAtBranchId`; a misspelt filter must not become
    // the unfiltered catalogue an operator believes was narrowed.
    const refused = await list({ availableAtBranch: SERVICE_A });
    expect(refused.status).toBe(422);
    expect(await codeOf(refused)).toBe('ERR-VAL-001');
  });
});
