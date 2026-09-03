/**
 * P1-29 `W1` — the work-order queue, proved on a REAL response.
 *
 * ## Why this exists beside `p1-19-work-order-reads.test.ts`
 *
 * That file proves the OPERATION: 401, 403, keyset order, branch isolation,
 * cross-tenant silence. This one proves the SCREEN'S claim on top of it — that
 * the intended actor can actually retrieve and see the queue, that a refusal
 * reaches the screen as a refusal, and that the contract mirror the web adapter
 * types itself against is the shape the backend really answers with.
 *
 * The last of those is the one a structural check cannot make. `W1` adds a
 * hand-written mirror in `apps/web`, and a mirror is a copy: it can name a field
 * the response does not carry, or miss one it does, and every gate in the
 * repository would still be green. So the mirror is PARSED out of its own source
 * and held against the keys of a row that came out of the database through the
 * real route handler.
 *
 * ## PC-1, and why a structural check would not have done
 *
 * `INT-113` is the precedent: six shipped operations answered 500 to every
 * request while every structural gate stayed green. A route that exists, a
 * permission that exists and a component that renders prove nothing about
 * whether an operator sees data. Every assertion below reads a real HTTP
 * response produced against a real database.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import ts from 'typescript';
import {
  BRANCH_A1,
  COMPANY_A1,
  SUBJECT_UNPERMITTED,
  TENANT_B,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import {
  BRANCH_B1,
  COMPANY_B1,
  READER,
  TENANT_B_FULL,
  authAs,
  authAsSubject,
  createWorkOrder,
  establishP1_19Fixtures,
} from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as LIST } from '@/app/api/v1/work-orders/route';

const CONTRACT = join(
  process.cwd(),
  'apps',
  'web',
  'src',
  'features',
  'work-orders',
  'work-orders-contract.ts'
);

let admin: Pool;
let runtime: Pool;

function board(query: Record<string, string> = {}): Promise<Response> {
  const url = new URL('http://localhost/api/v1/work-orders');
  url.searchParams.set('companyId', COMPANY_A1);
  url.searchParams.set('branchId', BRANCH_A1);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return LIST(new Request(url));
}

interface Row {
  readonly id: string;
  readonly [key: string]: unknown;
}
interface Page {
  readonly items: readonly Row[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

const page = async (response: Response): Promise<Page> => (await response.json()) as Page;

/**
 * The field names of one interface in the web contract, PARSED.
 *
 * A regular expression over the source would answer for a name inside a comment
 * or a neighbouring interface. This walks the real syntax tree, so what comes
 * back is what TypeScript itself sees — the rule this repository already applies
 * to its gate scanners, applied here for the same reason.
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

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
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

describe('P1-29 W1 — the work-order queue answers a real actor with real rows', () => {
  it('W1-1 a permitted actor sees a work order that exists in their branch', async () => {
    const created = await createWorkOrder();

    authAs(READER);
    const response = await board();
    expect(response.status).toBe(200);

    const body = await page(response);
    // ANTI-VACUITY, and it is the point rather than a formality: a board that
    // answered 200 with nothing would satisfy every other assertion in this file
    // while proving that an operator sees anything at all. An empty fixture must
    // not be able to masquerade as a working screen.
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.map((row) => row.id)).toContain(created.workOrderId);

    const row = body.items.find((item) => item.id === created.workOrderId);
    expect(row).toBeDefined();
    // The projections the screen renders as columns, present on a real row.
    expect(row).toHaveProperty('vehicle');
    expect(row).toHaveProperty('customer');
    expect(typeof (row as Row)['openedAt']).toBe('string');
    expect(typeof (row as Row)['state']).toBe('string');
  });

  it('W1-2 an actor without the code is REFUSED, and refusal is not an empty board', async () => {
    await createWorkOrder();

    authAsSubject(SUBJECT_UNPERMITTED);
    const response = await board();

    // The distinction the whole adapter turns on. A 200 with zero rows would
    // reach an operator as "this branch has no work orders" — a false statement
    // about the business — instead of "you may not read this".
    expect(response.status).toBe(403);
    expect(response.status).not.toBe(200);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-IAM-001');
  });

  it('W1-3 a work order in another tenant is not on this board', async () => {
    const mine = await createWorkOrder();
    const theirs = await createWorkOrder({
      tenantId: TENANT_B,
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
    });

    authAs(READER);
    const body = await page(await board());
    const ids = body.items.map((row) => row.id);
    expect(ids).toContain(mine.workOrderId);
    expect(ids).not.toContain(theirs.workOrderId);

    // And the other direction, so this is isolation rather than an ordering
    // accident: tenant B's own board carries its row and none of tenant A's.
    authAs(TENANT_B_FULL);
    const url = new URL('http://localhost/api/v1/work-orders');
    url.searchParams.set('companyId', COMPANY_B1);
    url.searchParams.set('branchId', BRANCH_B1);
    const theirBoard = await page(await LIST(new Request(url)));
    const theirIds = theirBoard.items.map((row) => row.id);
    expect(theirIds).toContain(theirs.workOrderId);
    expect(theirIds).not.toContain(mine.workOrderId);
  });

  it('W1-4 the web contract mirror is the shape the backend really answers with', async () => {
    await createWorkOrder();
    authAs(READER);
    const body = await page(await board());
    const row = body.items[0];
    expect(row).toBeDefined();

    const declared = [...mirrorFields('WorkOrderListEntry')].sort();
    const actual = Object.keys(row as Row).sort();

    // Set equality in BOTH directions. A mirror missing a field silently drops a
    // column the operator was meant to see; a mirror naming a field the response
    // does not carry types a screen against data that will be `undefined` at
    // runtime, which is the adapter-mapping defect this case exists to catch.
    expect(actual, 'the mirror does not describe the published row').toEqual(declared);

    // The nested projections, held the same way rather than assumed from the
    // parent matching.
    const vehicle = (row as Row)['vehicle'] as Record<string, unknown>;
    expect(Object.keys(vehicle).sort()).toEqual([...mirrorFields('WorkOrderVehicle')].sort());
    const customer = (row as Row)['customer'] as Record<string, unknown> | null;
    if (customer !== null) {
      expect(Object.keys(customer).sort()).toEqual([...mirrorFields('WorkOrderCustomer')].sort());
    }
  });

  it('W1-5 the kinds the screen offers are the kinds the backend accepts', async () => {
    await createWorkOrder();
    authAs(READER);

    // `kind` is a CLOSED vocabulary and the screen renders a select over its own
    // copy of it. A copy that drifted would offer a filter the backend rejects,
    // or hide one it accepts.
    const source = readFileSync(CONTRACT, 'utf8');
    const mirrored = [...source.matchAll(/'(ordinary|rework)'/g)].map((match) => match[1]);
    expect(new Set(mirrored)).toEqual(new Set(['ordinary', 'rework']));

    for (const kind of ['ordinary', 'rework']) {
      expect((await board({ kind })).status, `${kind} was refused`).toBe(200);
    }
    // And one the mirror does not offer, to prove the vocabulary is closed at
    // the backend rather than merely narrow in the mirror.
    expect((await board({ kind: 'inspection' })).status).toBe(422);
  });
});
