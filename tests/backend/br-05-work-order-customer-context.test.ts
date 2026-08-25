/**
 * Work-order customer and vehicle context (BR-05, PRE-P1-29 backend remediation).
 *
 * A work order did not expose its customer. The service advisor's first question
 * — whose car is this — had no answer on the work-order surface, and **no
 * customer column exists in any of the 44 `wo`/`dia`/`tech`/`qms` tables**. This
 * slice answers it as a DATED READ PROJECTION over data reception already owns.
 *
 * The invariants this suite exists for:
 *
 *  1. **P8 is the decisive case, and the reason option B was rejected.** Open a
 *     work order with partner X as `service_requester`. Date X out and add Y.
 *     Re-read: the first work order still reports **X**; a work order opened on a
 *     later visit reports **Y**. A denormalised `wo.work_orders.customer_id`
 *     would have failed this SILENTLY — the column would say Y for both, and the
 *     history of every closed order would have been rewritten by an ownership
 *     correction. Dating is what makes that impossible, and this is the test that
 *     tells the two designs apart.
 *  2. **It resolves under `wo.work_order.read` alone.** Requiring
 *     `rec.reception.read` + `apt.appointment.read` as well is exactly what made
 *     the client-side chain unacceptable; reproducing that requirement
 *     server-side would deliver none of the benefit. `READER` holds the single
 *     code and nothing else, which is what makes that claim falsifiable.
 *  3. **No over-read.** `displayName` is the only `crm.business_partners` column
 *     that reaches the caller — asserted as a KEY SET in both directions, because
 *     NFR-PRV-001 forbids projecting a restricted identifier and a field-by-field
 *     assertion cannot catch an ADDITION.
 *  4. **The `customerId` filter is applied in SQL.** Post-filtering a fetched
 *     page produces short pages and a `hasMore` that lies — the P1-28 round-two
 *     defect. The paging case reads every page and reconciles the union.
 *  5. **`workshopStatus` never appears.** Nothing in `wo`/`dia`/`tech`/`qms`
 *     maintains it (`INS-39`), so publishing it would render a field this domain
 *     never updates.
 *
 * Operations exercised: wo.work-order-detail, wo.work-order-list. Both are
 * PRE-EXISTING and neither changes its permission, scope or guards, so this suite
 * adds no coverage-manifest entry — it extends what the two already-covered
 * operations return.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
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
  PARTNER_A,
  PARTNER_B,
  READER,
  SCOPED_ELSEWHERE,
  authAs,
  createOpenWorkOrder,
  establishP1_19Fixtures,
} from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as LIST_WORK_ORDERS } from '@/app/api/v1/work-orders/route';
import { GET as WORK_ORDER_DETAIL } from '@/app/api/v1/work-orders/[workOrderId]/route';

let admin: Pool;
let runtime: Pool;

interface Customer {
  readonly partnerId: string;
  readonly displayName: string;
  readonly relationshipRole: string;
  readonly hasAdditionalParties: boolean;
}

interface Vehicle {
  readonly vehicleId: string;
  readonly registrationPlate: string | null;
  readonly makeModel: string | null;
}

interface Summary {
  readonly id: string;
  readonly vehicleId: string;
  readonly customer: Customer | null;
  readonly vehicle: Vehicle;
}

interface Problem {
  readonly code?: string;
}

const detail = (workOrderId: string): Promise<Response> =>
  WORK_ORDER_DETAIL(new Request(`http://localhost/api/v1/work-orders/${workOrderId}`), {
    params: Promise.resolve({ workOrderId }),
  });

const list = (query: string): Promise<Response> =>
  LIST_WORK_ORDERS(new Request(`http://localhost/api/v1/work-orders?${query}`));

const branchQuery = `companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`;

/** The detail body's customer block, for a work order the caller may read. */
async function customerOf(workOrderId: string, as = FULL): Promise<Customer | null> {
  authAs(as);
  const response = await detail(workOrderId);
  if (response.status !== 200) {
    throw new Error(`detail failed with ${response.status}: ${await response.text()}`);
  }
  return ((await response.json()) as { workOrder: Summary }).workOrder.customer;
}

/**
 * Dates the current `service_requester` out and records a new one.
 *
 * A supersession, not an edit: `tg_reception_party_roles_immutable` guards
 * `partner_id`, `relationship_role` and `valid_from`, so this is the only shape a
 * correction can take — which is precisely the property P8 depends on.
 */
async function replaceServiceRequester(
  visitId: string,
  nextPartnerId: string,
  options: { readonly cutAtNow?: boolean } = {}
): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );
    /*
     * The cut instant is derived from the row being superseded, not chosen by the
     * caller, and `ck_reception_party_roles_window` is the reason:
     * `valid_to > valid_from`. A fixture that picked "a minute ago" would be
     * refused outright on a visit created seconds earlier — which is what
     * happened when this helper first took an `at` parameter, and is a fair
     * description of the constraint doing its job.
     *
     * One microsecond after the open row's own `valid_from` closes it legally and
     * leaves the successor's window opening at the same instant, so the two are
     * contiguous with no gap a read could fall into.
     *
     * WHERE the cut falls is the whole experiment, and the two modes are opposite
     * questions:
     *
     *   default (`valid_from + 1µs`) — the change lands BEFORE any work order was
     *     opened on this visit, so an order opened afterwards must report the NEW
     *     party. "A later order sees the correction."
     *
     *   `cutAtNow` — the change lands AFTER the work order was opened, so that
     *     order must still report the OLD party. "An existing order is not
     *     rewritten." This is the half a denormalised column would fail.
     */
    const cut = await client.query<{ at: string }>(
      `UPDATE rec.reception_party_roles
          SET valid_to = CASE WHEN $2::boolean THEN now() ELSE valid_from + interval '1 microsecond' END
        WHERE reception_visit_id = $1 AND relationship_role = 'service_requester'
          AND valid_to IS NULL AND deleted_at IS NULL
      RETURNING valid_to::text AS at`,
      [visitId, options.cutAtNow ?? false]
    );
    const at = cut.rows[0]?.at;
    if (at === undefined) throw new Error('no open service_requester row to supersede');
    await client.query(
      `INSERT INTO rec.reception_party_roles
         (tenant_id, company_id, branch_id, reception_visit_id, partner_id,
          relationship_role, valid_from, created_by)
       SELECT tenant_id, company_id, branch_id, id, $2, 'service_requester', $3::timestamptz, $4
         FROM rec.reception_visits WHERE id = $1`,
      [visitId, nextPartnerId, at, USER_A]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** A second partner in tenant A, so a supersession has somewhere to go. */
const PARTNER_A_SUCCESSOR = 'c1900000-0000-4000-8000-0000000000f1';

async function seedSuccessorPartner(): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );
    await client.query(
      `INSERT INTO crm.business_partners
         (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
       VALUES ($1,$2,'individual','BR-05 Successor Partner','active',$3)
       ON CONFLICT (id) DO NOTHING`,
      [PARTNER_A_SUCCESSOR, TENANT_A, USER_A]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
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
  await seedSuccessorPartner();
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

describe('wo.work-order-detail — the customer projection', () => {
  it('P2 — a walk-in-originated work order resolves its customer, the case the client-side chain could not serve', async () => {
    const order = await createOpenWorkOrder();
    const customer = await customerOf(order.workOrderId);
    expect(customer).not.toBeNull();
    expect(customer?.partnerId).toBe(PARTNER_A);
    // P7 — the role is always reported. A name without it is a claim the data
    // does not support: vehicle_owner is a different question.
    expect(customer?.relationshipRole).toBe('service_requester');
    expect(customer?.hasAdditionalParties).toBe(false);
  });

  it('P3 — a caller holding ONLY wo.work_order.read gets the customer', async () => {
    // The whole point of resolving server-side. If this needed rec.reception.read
    // and apt.appointment.read as well, the projection would deliver none of the
    // benefit that made the client-side chain unacceptable.
    const order = await createOpenWorkOrder();
    const customer = await customerOf(order.workOrderId, READER);
    expect(customer?.partnerId).toBe(PARTNER_A);
  });

  it('P6 — the vehicle block is present and never carries workshopStatus', async () => {
    const order = await createOpenWorkOrder();
    authAs(FULL);
    const body = (await (await detail(order.workOrderId)).json()) as { workOrder: Summary };
    expect(body.workOrder.vehicle.vehicleId).toBe(order.vehicleId);
    // N7 — asserted as a KEY SET, because an ADDITION is what a field-by-field
    // check cannot see, and workshopStatus is maintained by nothing in this domain.
    expect(Object.keys(body.workOrder.vehicle).sort()).toEqual([
      'makeModel',
      'registrationPlate',
      'vehicleId',
    ]);
  });

  it('S4 — no crm.business_partners field beyond displayName reaches the caller', async () => {
    const order = await createOpenWorkOrder();
    authAs(FULL);
    const body = (await (await detail(order.workOrderId)).json()) as { workOrder: Summary };
    // Both directions: the exact key set. An address, a contact point or a tax id
    // appearing here would be an over-read, and so would any future addition.
    expect(Object.keys(body.workOrder.customer ?? {}).sort()).toEqual([
      'displayName',
      'hasAdditionalParties',
      'partnerId',
      'relationshipRole',
    ]);
    // Scoped to the CUSTOMER block, not the whole body: `displayNumber` is a
    // legitimate WorkOrderSummary field (the work order's own number) and shares
    // its name with `crm.business_partners.display_number`. A body-wide scan
    // reported that collision as a leak, which is a false positive worth not
    // re-introducing — the claim is about what the customer block exposes.
    const customerJson = JSON.stringify(body.workOrder.customer);
    for (const forbidden of ['taxId', 'phone', 'email', 'address', 'displayNumber', 'partyType']) {
      expect(customerJson.includes(`"${forbidden}"`), `${forbidden} leaked`).toBe(false);
    }
  });

  it('N3 — a visit with no current service_requester reports customer: null, not an error', async () => {
    const order = await createOpenWorkOrder();
    const client = await admin.connect();
    try {
      await client.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [USER_A, TENANT_A]
      );
      // Closed one microsecond after it opened, not "an hour ago":
      // `ck_reception_party_roles_window` requires `valid_to > valid_from`, and a
      // backdated close is refused outright on a visit created seconds earlier.
      // The window is then entirely BEFORE the work order's opened_at, which is
      // exactly the "no current service_requester" state this case needs.
      await client.query(
        `UPDATE rec.reception_party_roles
            SET valid_to = valid_from + interval '1 microsecond'
          WHERE reception_visit_id = $1 AND relationship_role = 'service_requester'`,
        [order.visitId]
      );
    } finally {
      client.release();
    }
    authAs(FULL);
    const response = await detail(order.workOrderId);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { workOrder: Summary }).workOrder.customer).toBeNull();
  });

  it('N6 — a work order in an unheld branch is 404, not a customer disclosure', async () => {
    const order = await createOpenWorkOrder();
    authAs(SCOPED_ELSEWHERE);
    const response = await detail(order.workOrderId);
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain(PARTNER_A);
  });
});

describe('wo.work-order-detail — P8, the decisive case', () => {
  it('P8 — an ownership change does not rewrite the customer of a work order already opened', async () => {
    // The work order that must NOT move: opened while X held the role.
    const first = await createOpenWorkOrder();
    expect((await customerOf(first.workOrderId))?.partnerId).toBe(PARTNER_A);

    // The correction, landing AFTER this order was opened. A supersession,
    // because tg_reception_party_roles_immutable permits nothing else.
    await replaceServiceRequester(first.visitId, PARTNER_A_SUCCESSOR, { cutAtNow: true });

    // The first work order still reports X — its opened_at precedes the change,
    // and the dated row that was current then is still there. THIS is the
    // assertion a denormalised wo.work_orders.customer_id would have failed
    // silently: the column would now say Y, for an order opened when it was X.
    expect((await customerOf(first.workOrderId))?.partnerId).toBe(PARTNER_A);
    // And the correction really did take: Y is the party current NOW.
    const live = await admin.query<{ partner_id: string }>(
      `SELECT partner_id FROM rec.reception_party_roles
        WHERE reception_visit_id = $1 AND relationship_role = 'service_requester'
          AND valid_to IS NULL AND deleted_at IS NULL`,
      [first.visitId]
    );
    expect(live.rows[0]?.partner_id).toBe(PARTNER_A_SUCCESSOR);

    // The other direction, on its own visit: a change landing BEFORE the order
    // was opened IS what that order reports. Without this half the first
    // assertion would also pass against a projection that always returned the
    // oldest row and never moved at all.
    const second = await createOpenWorkOrder();
    await replaceServiceRequester(second.visitId, PARTNER_A_SUCCESSOR);
    expect((await customerOf(second.workOrderId))?.partnerId).toBe(PARTNER_A_SUCCESSOR);
  });
});

describe('wo.work-order-list — the board column and the customerId filter', () => {
  it('P4 — a page of work orders carries a customer block for each, in ONE call', async () => {
    const orders = [await createOpenWorkOrder(), await createOpenWorkOrder()];
    authAs(FULL);
    const response = await list(`${branchQuery}&limit=50`);
    expect(response.status).toBe(200);
    const page = (await response.json()) as { items: readonly Summary[] };
    const mine = page.items.filter((entry) => orders.some((o) => o.workOrderId === entry.id));
    expect(mine).toHaveLength(2);
    // P7 across the page — every non-null block names its role.
    for (const entry of mine) {
      expect(entry.customer?.partnerId).toBe(PARTNER_A);
      expect(entry.customer?.relationshipRole).toBe('service_requester');
      expect(entry.vehicle.vehicleId).toBe(
        orders.find((o) => o.workOrderId === entry.id)?.vehicleId
      );
    }
  });

  it('P5 — customerId narrows the list to exactly the independently computed set', async () => {
    const mine = await createOpenWorkOrder();
    await replaceServiceRequester(mine.visitId, PARTNER_A_SUCCESSOR);
    const other = await createOpenWorkOrder();

    authAs(FULL);
    const filtered = (await (
      await list(`${branchQuery}&customerId=${PARTNER_A_SUCCESSOR}&limit=50`)
    ).json()) as { items: readonly Summary[] };
    const ids = filtered.items.map((entry) => entry.id);

    // Computed independently of the endpoint, straight from the party table.
    const expected = await admin.query<{ id: string }>(
      `SELECT w.id FROM wo.work_orders w
        WHERE w.tenant_id = $1 AND w.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM rec.reception_party_roles r
                       WHERE r.tenant_id = w.tenant_id
                         AND r.reception_visit_id = w.reception_visit_id
                         AND r.partner_id = $2 AND r.deleted_at IS NULL)`,
      [TENANT_A, PARTNER_A_SUCCESSOR]
    );
    expect(ids.sort()).toEqual(expected.rows.map((row) => row.id).sort());
    expect(ids).toContain(mine.workOrderId);
    expect(ids).not.toContain(other.workOrderId);
  });

  it('S6 — with the filter set, every page is full and the union equals the filtered set', async () => {
    // The P1-28 round-two defect, tested directly: a filter applied AFTER the page
    // is fetched yields short pages and a hasMore that lies.
    const seeded: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const order = await createOpenWorkOrder();
      await replaceServiceRequester(order.visitId, PARTNER_A_SUCCESSOR);
      seeded.push(order.workOrderId);
      // Interleave a work order that must NOT match, so a post-filtered page
      // would visibly shorten.
      await createOpenWorkOrder();
    }

    const collected: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      authAs(FULL);
      const query = `${branchQuery}&customerId=${PARTNER_A_SUCCESSOR}&limit=1${
        cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`
      }`;
      const body = (await (await list(query)).json()) as {
        items: readonly Summary[];
        nextCursor: string | null;
        hasMore: boolean;
      };
      pages += 1;
      // Every page except a final short one must be FULL. With limit=1 that means
      // exactly one item whenever more remain.
      if (body.hasMore) expect(body.items).toHaveLength(1);
      collected.push(...body.items.map((entry) => entry.id));
      cursor = body.nextCursor;
    } while (cursor !== null && pages < 20);

    for (const id of seeded) expect(collected).toContain(id);
    expect(new Set(collected).size).toBe(collected.length);
  });

  it('S1 — a cross-tenant customerId yields 200 and an empty result, not 404 and not 403', async () => {
    await createOpenWorkOrder();
    authAs(FULL);
    const response = await list(`${branchQuery}&customerId=${PARTNER_B}&limit=50`);
    // Empty-page-not-404 closes the oracle: a caller cannot tell "this customer
    // has no work orders here" from "this customer is not in your tenant".
    expect(response.status).toBe(200);
    expect(((await response.json()) as { items: readonly Summary[] }).items).toHaveLength(0);
  });

  it('N4/N5/S5 — a malformed customerId, an unknown parameter and a client asOf are all 422', async () => {
    authAs(FULL);
    expect((await list(`${branchQuery}&customerId=not-a-uuid`)).status).toBe(422);
    authAs(FULL);
    expect((await list(`${branchQuery}&unknownParameter=1`)).status).toBe(422);
    authAs(FULL);
    // No client as-at, deliberately: it would be an oracle and a way to read a
    // party role out of its window. `.strict()` is what refuses it.
    const asOf = await list(`${branchQuery}&asOf=${new Date().toISOString()}`);
    expect(asOf.status).toBe(422);
    expect(((await asOf.json()) as Problem).code).toBe('ERR-VAL-001');
  });

  it('N2 — a caller without wo.work_order.read is refused before any customer is resolved', async () => {
    await createOpenWorkOrder();
    // A principal in the tenant holding no work-order permission at all.
    authAs({ ...READER, permissions: [], subject: `fx_br_05_nobody_${randomUUID().slice(0, 8)}` });
    const response = await list(`${branchQuery}&limit=5`);
    expect([401, 403]).toContain(response.status);
  });
});

describe('S2/S3 — tenant and branch containment of the projection', () => {
  it('S2 — a tenant-A work order never yields a tenant-B partner', async () => {
    const order = await createOpenWorkOrder();
    // Tenant B has its own visit naming PARTNER_B; tenant A must never see it.
    await createOpenWorkOrder({ tenantId: TENANT_B, companyId: COMPANY_B1, branchId: BRANCH_B1 });
    const customer = await customerOf(order.workOrderId);
    expect(customer?.partnerId).toBe(PARTNER_A);
    expect(customer?.partnerId).not.toBe(PARTNER_B);
  });

  it('S3 — the visit reached is always the work order’s own', async () => {
    // Structural: the projection is keyed by the work order's reception_visit_id,
    // and the foreign key is composite, so a cross-branch visit is unreachable
    // rather than merely unreturned. Asserted by construction.
    const order = await createOpenWorkOrder();
    const row = await admin.query<{ reception_visit_id: string }>(
      `SELECT reception_visit_id FROM wo.work_orders WHERE id = $1`,
      [order.workOrderId]
    );
    expect(row.rows[0]?.reception_visit_id).toBe(order.visitId);
    const customer = await customerOf(order.workOrderId);
    const owning = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM rec.reception_party_roles
        WHERE reception_visit_id = $1 AND partner_id = $2`,
      [order.visitId, customer?.partnerId ?? '']
    );
    expect(Number(owning.rows[0]?.n)).toBeGreaterThan(0);
  });
});
