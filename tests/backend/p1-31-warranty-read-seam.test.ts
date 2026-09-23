/**
 * The warranty read seam (Phase 1-31, prerequisites P-6, P-7 and P-18).
 *
 * Three things are proved here and they are different in kind. **P-6** publishes
 * `GET /api/v1/warranties`, the chapter's second declared API, over a branch-wide
 * query that did not exist. **P-7** mints `wty.warranty.read` and re-points
 * `wty.warranty-detail` off `wty.warranty.issue` — a READ that was gated on the
 * authority to CREATE a warranty, which is a defect and not a convention. **P-18**,
 * added 2026-09-13, publishes `GET /api/v1/warranties/{warrantyId}/status-history`
 * over `wty.warranty_status_history`, which had no reader anywhere in
 * `apps/api/src` — the ledger limb this file previously recorded as open.
 *
 * ## The permission claim is proved BEHAVIOURALLY, in both directions
 *
 * Asserting that a registration names a string proves only that somebody typed it.
 * Two principals decide the claim instead, and each is the counterfactual of the
 * other:
 *
 *   - `WTY_READ_ONLY` holds `wty.warranty.read` and NOTHING else. It could not have
 *     issued the warranty it reads — the arrangement is done by `SAL_FULL` through
 *     the real generation route and the authenticator is reset in between — so a
 *     200 from it is proof that the read no longer depends on a write code.
 *   - `WTY_ISSUE_ONLY` holds `wty.warranty.issue` and nothing else: yesterday's
 *     caller. It is REFUSED both reads with `ERR-IAM-001` naming
 *     `wty.warranty.read`, and it can still generate a warranty.
 *
 * Collapse the two codes back into one and both cases go red, in opposite
 * directions. That is the property a single assertion on `operation.permissions`
 * cannot have.
 *
 * ## No money, and that is a measurement rather than a promise
 *
 * `wty` has 80 columns and not one is an amount, a currency or a cap in any unit of
 * account, so a "covered value" would be a fabricated business fact.
 * `refusesAnyMoneyShapedNumber` walks every response for a JSON number under any
 * money-shaped key, and `odometerAtIssue` / `odometerLimit` are asserted to be exact
 * decimal STRINGS — they are distance readings, and a float is not available to them
 * either.
 *
 * ## What this file deliberately does NOT claim
 *
 * It does not touch a write path, an eligibility rule or the issue flow, and it does
 * not close **PPD-04 / P-10** (no warranty-policy writer exists; the fixtures still
 * seed policies and coverage by SQL).
 *
 * It also does not invent a status ADVANCE. Nothing in this phase moves
 * `wty.warranty_records.status` — `assertWritableStatus` refuses structurally — so the
 * only transition an operation can produce is the genesis row `wty.issue_warranty`
 * writes, and the P-18 section says so twice: once as the honest negative on a warranty
 * left exactly as the product created it, and once in the comment above the fixture
 * that appends further transitions by SQL because no writer exists to append them.
 *
 * COVERAGE-EVIDENCE (P1-31 warranty read seam):
 *   wty.warranty-list: route service authorization success denial cross-tenant isolation pagination
 *   wty.warranty-detail: route service authorization success denial cross-tenant isolation
 *   wty.warranty-status-history: route service authorization success denial cross-tenant isolation pagination
 *
 * None declares an `audit` flag: all three register `auditClass: 'none'`, so claiming
 * one would claim a record they do not write. None declares `idempotency` or
 * `stale-version` — they are reads, and none is `idempotent` or `versionGuarded`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  BRANCH_A1,
  COMPANY_A1,
  IDENTITY_PROVIDER,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_B,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import {
  BRANCH_A2,
  BRANCH_B1,
  COMPANY_B1,
  PARTNER_A,
  createWorkOrder,
  establishP1_19Fixtures,
  type Principal,
} from './p1-19-helpers';
import {
  BRANCH_A9,
  COMPANY_A9,
  COVERAGE_ACTIVE,
  COVERAGE_DURATION_MONTHS,
  COVERAGE_EFFECTIVE_FROM,
  COVERAGE_ODOMETER_ALLOWANCE,
  POLICY_ACTIVE,
  POLICY_ACTIVE_CODE,
  SAL_FULL,
  SAL_PERMISSION_ELSEWHERE,
  SAL_TENANT_B,
  authAs,
  cleanP1_22Fixtures,
  establishP1_22Fixtures,
  expectedWarrantyTerms,
  seedDeliveredDelivery,
  type SeededDelivery,
} from './p1-22-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { __resetRateLimitForTests } from '@/server/http/rate-limit';
import { TENANT_ADMINISTRATOR_ROLE } from '@/modules/iam';
import { vehicleModule } from '@/modules/vehicle';
import { SERVICE_REQUESTER } from '@/modules/reception';
import { WarrantyRepository } from '@/modules/warranty/data/warranty-repository';
import { buildRequestContext } from '@/server/context/request-context';
import { withReadOnlyTransaction } from '@/server/db/transaction';
import { POST as GENERATE_WARRANTY } from '@/app/api/v1/deliveries/[deliveryId]/warranties/route';
import { WARRANTY_LIST_OPERATION, GET as LIST_WARRANTIES } from '@/app/api/v1/warranties/route';
import {
  WARRANTY_DETAIL_OPERATION,
  GET as READ_WARRANTY,
} from '@/app/api/v1/warranties/[warrantyId]/route';
import {
  WARRANTY_STATUS_HISTORY_OPERATION,
  GET as READ_STATUS_HISTORY,
} from '@/app/api/v1/warranties/[warrantyId]/status-history/route';

let admin: Pool;
let runtime: Pool;

/** The Owner-directive fixtures (P1-32-PRE-OD-UX). See the beforeAll. */
const OD_BRANCH = 'f1220000-0000-4000-8000-0000000000e3';
const OD_PARTNER = 'f1220000-0000-4000-8000-0000000000e4';
const OD_SEARCH_NAME = 'Rawan Al-Masri';
const OD_SEARCH_PHONE = '962795443322';
const OD_SEARCH_PLATE = 'GH 5533';
let OD_IN_A2: ArrangedWarranty;
let OD_IN_A3: ArrangedWarranty;
let OD_SEARCHABLE: ArrangedWarranty;

/**
 * The display fixtures (Owner directive, P1-32-PRE-OD-UX).
 *
 * `OD_SEARCHABLE` already carries a plate and a party on its visit, so the same
 * warranty is given a tenant catalogue make and model and a display number and
 * becomes the one record every display assertion below reads. Its VIN is the one
 * the shared visit fixture generated, so it is read back rather than asserted from
 * a constant this file made up.
 */
const OD_MAKE = 'f1320000-0000-4000-8000-000000000811';
const OD_MODEL = 'f1320000-0000-4000-8000-000000000812';
const OD_MAKE_NAME = 'Fixture Make';
const OD_MODEL_NAME = 'Fixture Model';
const OD_MAKE_MODEL = `${OD_MAKE_NAME} ${OD_MODEL_NAME}`;
const OD_VEHICLE_NUMBER = 'FX-P132-WTY-V1';
/** Read back from `veh.vehicles.vin_normalized`; the fixture generates it. */
let OD_VIN = '';
/**
 * The party `rec.accept_check_in` recorded as the visit's service requester, and
 * the name `crm.business_partners` holds for it.
 *
 * The check-in primitive writes exactly one `service_requester` row, and the
 * search fixture above adds a SECOND partner in the same role with a later
 * `valid_from`. That is not a flaw in the fixture: `uq_reception_party_roles_active`
 * is unique on (visit, partner, role), so two partners legitimately holding the
 * role at once is a state the read has to answer deterministically — and it names
 * the earliest `valid_from`, which is this one.
 *
 * This visit cannot PROVE that rule on its own: the check-in row is also the one
 * recorded first and the one with the lower partner id, so three different rules
 * agree on it. `OD_TIEBREAK` below is the fixture that tells them apart.
 */
const OD_CHECKIN_PARTNER_NAME = 'Reception Requester';

/**
 * A vehicle in the OTHER tenant, with a display number of its own.
 *
 * The tenant case further down asks the vehicle module to resolve this id under
 * a tenant-A session. Without a real row there the empty answer would prove
 * nothing, so the row is seeded and its existence asserted at the point of use.
 */
const OD_TENANT_B_VEHICLE = 'f1320000-0000-4000-8000-000000000821';
const OD_TENANT_B_VIN = '1P32B00000000001';
const OD_TENANT_B_NUMBER = 'FX-P132-WTY-VB';
/** A warranty whose vehicle row is soft-deleted after it is issued. */
let OD_NO_VEHICLE: ArrangedWarranty;
/** A warranty whose visit's service requester is dated out after it is issued. */
let OD_NO_PARTY: ArrangedWarranty;
/** That partner's id, named so every assertion says which one it means. */
const OD_PARTNER_EXPECTED = PARTNER_A;

/**
 * The tie-break fixture (Owner directive, P1-32-PRE-OD-UX).
 *
 * One warranty whose visit ends up with THREE open `service_requester` roles,
 * arranged so that the rule the read claims — earliest `valid_from` wins — is
 * the only rule that picks `OD_TIE_EARLIEST`:
 *
 *   | partner            | recorded | partner id | valid_from       |
 *   | check-in (A)       | first    | lowest     | check-in instant |
 *   | `OD_TIE_EARLIEST`  | second   | middle     | two days before  |
 *   | `OD_TIE_HIGHEST`   | last     | highest    | one day before   |
 *
 * "first recorded" and "lowest id" pick the check-in partner, "last recorded"
 * and "highest id" pick `OD_TIE_HIGHEST`, "latest valid_from" picks the check-in
 * partner again. Only the ordering the repository states picks the middle row.
 */
let OD_TIEBREAK: ArrangedWarranty;
const OD_TIE_EARLIEST = 'f1320000-0000-4000-8000-000000000831';
const OD_TIE_EARLIEST_NAME = 'Fixture Earliest Requester';
const OD_TIE_HIGHEST = 'f1320000-0000-4000-8000-000000000839';
const OD_TIE_HIGHEST_NAME = 'Fixture Highest Requester';

/** A work order in the OTHER tenant whose visit names a service requester. */
let OD_TENANT_B_WORK_ORDER = '';

/** The code this slice mints. Written once, used by every assertion below. */
const WARRANTY_READ = 'wty.warranty.read';
const WARRANTY_ISSUE = 'wty.warranty.issue';
const POLICY_MANAGE = 'wty.policy.manage';
/**
 * The two codes the display blocks are narrowed on (Owner directive,
 * P1-32-PRE-OD-UX).
 *
 * Neither is a warranty code and neither gates the read itself: a caller holding
 * `wty.warranty.read` alone still gets every row and every warranty field. These
 * decide only what the two display blocks are allowed to say.
 */
const VEHICLE_READ = 'veh.vehicle.read';
const CUSTOMER_READ = 'crm.customer.read';

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

interface WarrantyListRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly vehicleId: string;
  readonly workOrderId: string;
  readonly deliveryRecordId: string;
  readonly status: string;
  readonly startDate: string;
  readonly expiryDate: string;
  readonly odometerAtIssue: string;
  readonly odometerLimit: string | null;
  readonly policy: {
    readonly id: string;
    readonly policyCode: string;
    readonly name: string;
    readonly status: string;
  };
  /** The car, named (Owner directive, P1-32-PRE-OD-UX). */
  readonly vehicle: {
    readonly id: string;
    readonly plate: string | null;
    readonly vin: string | null;
    readonly makeModel: string | null;
    readonly displayNumber: string | null;
  };
  /** The party who brought it in, or null when the visit names none. */
  readonly customer: { readonly id: string; readonly displayName: string | null } | null;
  readonly recordVersion: number;
}

interface WarrantyListBody {
  readonly items: readonly WarrantyListRow[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

interface WarrantyDetailBody extends WarrantyListRow {
  readonly coverage: { readonly id: string; readonly coveredScope: string };
  readonly items: readonly { readonly id: string; readonly itemKind: string }[];
  readonly replayed: boolean;
}

/** One transition as `wty.warranty-status-history` publishes it (P-18). */
interface StatusHistoryRow {
  readonly id: string;
  readonly fromStatus: string | null;
  readonly toStatus: string;
  readonly reason: string | null;
  readonly actorId: string;
  readonly occurredAt: string;
}

interface StatusHistoryBody {
  readonly warrantyId: string;
  readonly transitions: {
    readonly items: readonly StatusHistoryRow[];
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
  };
}

interface ProblemBody {
  readonly code: string;
  readonly status: number;
  readonly requiredPermissions?: readonly string[];
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

const problemOf = (response: Response): Promise<ProblemBody> => bodyOf<ProblemBody>(response);

// ---------------------------------------------------------------------------
// Statement counting (Owner directive, P1-32-PRE-OD-UX)
//
// The display blocks are documented as a CONSTANT number of statements per page.
// A docblock cannot fail, so the claim is measured: the runtime pool is wrapped
// at its connection boundary, below the route, the service, the repositories and
// the transaction helper, so every statement PostgreSQL is asked is recorded —
// the same technique `p1-24-read-path-shape.test.ts` uses. Counting is off
// unless a case turns it on, so every other case in this file runs unobserved.
// ---------------------------------------------------------------------------

let statements: string[] = [];
let counting = false;
/** Clients are pooled and reused, so each is wrapped at most once. */
const wrapped = new WeakSet<PoolClient>();

function wrapClient(client: PoolClient): void {
  if (wrapped.has(client)) return;
  wrapped.add(client);
  // Forwarded verbatim and typed through `unknown`: the wrapper interprets
  // nothing, it only records the statement text.
  const query = client.query.bind(client) as (...args: readonly unknown[]) => unknown;
  const counted = (...args: readonly unknown[]): unknown => {
    if (counting) {
      const first = args[0];
      statements.push(
        typeof first === 'string'
          ? first
          : String((first as { text?: string } | undefined)?.text ?? '<config>')
      );
    }
    return query(...args);
  };
  (client as unknown as { query: unknown }).query = counted;
}

/**
 * Wraps every client the pool hands out, in both of `pg`'s calling styles:
 * the promise form the transaction helper uses, and the callback form
 * `Pool.query` uses internally.
 */
function instrument(pool: Pool): void {
  const connect = pool.connect.bind(pool) as (...args: readonly unknown[]) => unknown;
  const patched = (...args: readonly unknown[]): unknown => {
    const callback = args[0];
    if (typeof callback === 'function') {
      return connect((error: unknown, client: PoolClient | undefined, release: unknown) => {
        if (client !== undefined) wrapClient(client);
        (callback as (...values: readonly unknown[]) => void)(error, client, release);
      });
    }
    return (connect() as Promise<PoolClient>).then((client) => {
      wrapClient(client);
      return client;
    });
  };
  (pool as unknown as { connect: unknown }).connect = patched;
}

interface Measured {
  readonly status: number;
  readonly text: string;
  readonly statements: readonly string[];
}

/** Runs one request with counting on, and returns every statement it sent. */
async function measure(run: () => Promise<Response>): Promise<Measured> {
  statements = [];
  counting = true;
  try {
    const response = await run();
    const text = await response.text();
    return { status: response.status, text, statements: [...statements] };
  } finally {
    counting = false;
  }
}

/**
 * The five statements the display assembly may send, recognised by their text.
 *
 * Each pattern names a statement only the display path issues on these reads:
 * the two capability questions are spelled with a LITERAL code (the search box's
 * capability question binds its code as a parameter, so it cannot match), and
 * the other three are the three batched lookups. The case that measures a caller
 * holding both codes asserts every kind appears exactly once, which is what keeps
 * a pattern that stopped matching from reporting a clean zero.
 */
const DISPLAY_STATEMENT_KINDS = Object.freeze({
  vehicleCapability: /iam\.has_permission\('veh\.vehicle\.read'\)/,
  vehicleIdentities: /FROM veh\.vehicles v\s+LEFT JOIN veh\.makes/,
  partnerIds: /SELECT w\.id AS work_order_id, r\.partner_id/,
  customerCapability: /iam\.has_permission\('crm\.customer\.read'\)/,
  customerNames: /FROM crm\.business_partners\s+WHERE tenant_id = \$1 AND id = ANY/,
});

type DisplayStatementKind = keyof typeof DISPLAY_STATEMENT_KINDS;

/** How many statements of each display kind a measured request sent. */
function displayStatementCounts(
  sent: readonly string[]
): Readonly<Record<DisplayStatementKind, number>> {
  const counts: Record<DisplayStatementKind, number> = {
    vehicleCapability: 0,
    vehicleIdentities: 0,
    partnerIds: 0,
    customerCapability: 0,
    customerNames: 0,
  };
  for (const text of sent) {
    for (const [kind, pattern] of Object.entries(DISPLAY_STATEMENT_KINDS)) {
      if (pattern.test(text)) counts[kind as DisplayStatementKind] += 1;
    }
  }
  return counts;
}

const totalOf = (counts: Readonly<Record<DisplayStatementKind, number>>): number =>
  Object.values(counts).reduce((sum, count) => sum + count, 0);

// ---------------------------------------------------------------------------
// Route invocation
// ---------------------------------------------------------------------------

function listWarranties(
  query: Record<string, string | number | undefined> = {}
): Promise<Response> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return LIST_WARRANTIES(new Request(`http://localhost/api/v1/warranties?${search.toString()}`));
}

const readWarranty = (warrantyId: string): Promise<Response> =>
  READ_WARRANTY(new Request(`http://localhost/api/v1/warranties/${warrantyId}`), {
    params: Promise.resolve({ warrantyId }),
  });

function readStatusHistory(
  warrantyId: string,
  query: Record<string, string | number | undefined> = {}
): Promise<Response> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return READ_STATUS_HISTORY(
    new Request(
      `http://localhost/api/v1/warranties/${warrantyId}/status-history?${search.toString()}`
    ),
    { params: Promise.resolve({ warrantyId }) }
  );
}

const generateWarranty = (deliveryId: string, policyId: string): Promise<Response> =>
  GENERATE_WARRANTY(
    new Request(`http://localhost/api/v1/deliveries/${deliveryId}/warranties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify({ policyId }),
    }),
    { params: Promise.resolve({ deliveryId }) }
  );

// ---------------------------------------------------------------------------
// Principals minted by this file
//
// Each holds ONE code, so every refusal below is about that code and never about
// tenancy, scope or a second missing permission.
// ---------------------------------------------------------------------------

/** `wty.warranty.read` and nothing else. The principal P-7 exists for. */
const WTY_READ_ONLY: Principal = {
  roleId: 'f1310000-0000-4000-8000-0000000007a1',
  userId: 'f1310000-0000-4000-8000-0000000007a2',
  subject: 'fx_p1_31_wty_read_only',
  tenantId: TENANT_A,
  permissions: [WARRANTY_READ],
};

/** `wty.warranty.issue` and nothing else — the caller the old gate served. */
const WTY_ISSUE_ONLY: Principal = {
  roleId: 'f1310000-0000-4000-8000-0000000007b1',
  userId: 'f1310000-0000-4000-8000-0000000007b2',
  subject: 'fx_p1_31_wty_issue_only',
  tenantId: TENANT_A,
  permissions: [WARRANTY_ISSUE, 'wo.work_order.read', 'sal.delivery.view'],
};

/** `wty.policy.manage` and nothing else — the code the read must NOT borrow. */
const WTY_POLICY_ONLY: Principal = {
  roleId: 'f1310000-0000-4000-8000-0000000007c1',
  userId: 'f1310000-0000-4000-8000-0000000007c2',
  subject: 'fx_p1_31_wty_policy_only',
  tenantId: TENANT_A,
  permissions: [POLICY_MANAGE],
};

/** Tenant B, holding the read code. Its refusal is the tenant boundary. */
const WTY_READ_TENANT_B: Principal = {
  roleId: 'f1310000-0000-4000-8000-0000000007d1',
  userId: 'f1310000-0000-4000-8000-0000000007d2',
  subject: 'fx_p1_31_wty_read_tenant_b',
  tenantId: TENANT_B,
  permissions: [WARRANTY_READ],
};

/**
 * Holds the read code, SCOPED to branch A2. RLS hides every A1 row from it.
 *
 * It has to hold `wty.warranty.read`, or its refusal would be the missing
 * permission rather than the branch boundary — which is exactly what the P1-22
 * principals would prove here, since none of them holds the code this slice minted.
 */
const WTY_READ_SCOPED_A2: Principal = {
  roleId: 'f1310000-0000-4000-8000-0000000007e1',
  userId: 'f1310000-0000-4000-8000-0000000007e2',
  subject: 'fx_p1_31_wty_read_scoped_a2',
  tenantId: TENANT_A,
  permissions: [WARRANTY_READ],
};

/**
 * Scoped to A2 and holding the read code, with A1 inside its permission-blind
 * `iam.allowed_branch_ids()` union through an unrelated widening grant.
 *
 * The decisive isolation principal: A1's rows ARE visible to RLS for this caller,
 * so the only thing that can refuse an A1 request is the scoped permission check.
 */
const WTY_READ_ELSEWHERE: Principal = {
  roleId: 'f1310000-0000-4000-8000-0000000007f1',
  userId: 'f1310000-0000-4000-8000-0000000007f2',
  subject: 'fx_p1_31_wty_read_elsewhere',
  tenantId: TENANT_A,
  permissions: [WARRANTY_READ],
};

/** A role carrying one unrelated code. It widens reach, never authority. */
const WIDENING_ROLE = 'f1310000-0000-4000-8000-0000000007f3';
const WIDENING_PERMISSION = 'org.tenant.read';

/**
 * The three display principals (Owner directive, P1-32-PRE-OD-UX).
 *
 * Each is the warranty read code PLUS exactly one more, so every assertion below
 * about a withheld field is about THAT code and never about tenancy, scope or a
 * second absent permission. `WTY_READ_ONLY`, which holds the warranty code alone,
 * is the fourth corner of the same square.
 *
 * Minted here rather than added to a shared fixture role: `SAL_FULL` is used by
 * several suites against the same database, and widening it would change what
 * those suites are testing.
 */
const WTY_READ_WITH_VEHICLE: Principal = {
  roleId: 'f1320000-0000-4000-8000-000000000801',
  userId: 'f1320000-0000-4000-8000-000000000802',
  subject: 'fx_p1_32_wty_read_vehicle',
  tenantId: TENANT_A,
  permissions: [WARRANTY_READ, VEHICLE_READ],
};

const WTY_READ_WITH_CUSTOMER: Principal = {
  roleId: 'f1320000-0000-4000-8000-000000000803',
  userId: 'f1320000-0000-4000-8000-000000000804',
  subject: 'fx_p1_32_wty_read_customer',
  tenantId: TENANT_A,
  permissions: [WARRANTY_READ, CUSTOMER_READ],
};

const WTY_READ_WITH_DISPLAY: Principal = {
  roleId: 'f1320000-0000-4000-8000-000000000805',
  userId: 'f1320000-0000-4000-8000-000000000806',
  subject: 'fx_p1_32_wty_read_display',
  tenantId: TENANT_A,
  permissions: [WARRANTY_READ, VEHICLE_READ, CUSTOMER_READ],
};

/**
 * Tenant B, holding every display code there is.
 *
 * The decisive cross-tenant principal: it could be told a plate, a VIN and a name
 * about any car in its OWN tenant, so anything it learns about tenant A's warranty
 * is a leak from the resolution rather than a missing permission.
 */
const WTY_DISPLAY_TENANT_B: Principal = {
  roleId: 'f1320000-0000-4000-8000-000000000807',
  userId: 'f1320000-0000-4000-8000-000000000808',
  subject: 'fx_p1_32_wty_display_tenant_b',
  tenantId: TENANT_B,
  permissions: [WARRANTY_READ, VEHICLE_READ, CUSTOMER_READ],
};

const LOCAL_PRINCIPALS = [
  WTY_READ_ONLY,
  WTY_ISSUE_ONLY,
  WTY_POLICY_ONLY,
  WTY_READ_TENANT_B,
  WTY_READ_WITH_VEHICLE,
  WTY_READ_WITH_CUSTOMER,
  WTY_READ_WITH_DISPLAY,
  WTY_DISPLAY_TENANT_B,
] as const;

/**
 * Seeds one principal's account, role, role-permission rows and unrestricted grant.
 *
 * The `role_permissions` insert JOINS `iam.permissions` on `permission_code`, so a
 * code absent from the seeded catalogue yields NO row and the principal silently
 * holds nothing. That is deliberate: if `wty.warranty.read` were missing from the
 * database this file would go red on the success case rather than passing while
 * proving nothing.
 */
async function seedAccountAndRole(principal: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','P1-31 warranty read-seam principal','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [principal.userId, principal.tenantId, IDENTITY_PROVIDER, principal.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-31 warranty read-seam fixture',$4) ON CONFLICT (id) DO NOTHING`,
    [principal.roleId, principal.tenantId, principal.subject, USER_A]
  );
  for (const code of principal.permissions) {
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
        WHERE p.permission_code = $4
       ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
      [principal.tenantId, principal.roleId, USER_A, code]
    );
  }
}

/** Account, role, permissions and an UNRESTRICTED grant. */
async function seedLocalPrincipal(principal: Principal): Promise<void> {
  await seedAccountAndRole(principal);
  const existing = await admin.query(
    `SELECT 1 FROM iam.role_grants WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3`,
    [principal.tenantId, principal.userId, principal.roleId]
  );
  if (existing.rowCount === 0) {
    await admin.query(
      `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
      [principal.tenantId, principal.userId, principal.roleId, USER_A]
    );
  }
}

/**
 * Seeds a principal's account, role and permission rows WITHOUT a grant, then binds
 * a scoped grant and its scope row in ONE transaction.
 *
 * One transaction because `tg_role_grants_require_scope` is DEFERRABLE: a scoped
 * grant with no scope row is refused at COMMIT, not at INSERT.
 */
async function bindScopedGrant(
  grantId: string,
  input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly roleId: string;
    readonly companyId: string;
    readonly branchId: string;
  }
): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(`SELECT 1 FROM iam.role_grants WHERE id = $1`, [grantId]);
    if (existing.rowCount === 0) {
      await client.query(
        `INSERT INTO iam.role_grants
           (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
         VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
        [grantId, input.tenantId, input.userId, input.roleId, USER_A]
      );
      await client.query(
        `INSERT INTO iam.grant_scopes
           (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
         VALUES ($1,$2,'branch',$3,$4,$5)`,
        [input.tenantId, grantId, input.companyId, input.branchId, USER_A]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedScopedPrincipal(
  principal: Principal,
  grantId: string,
  scope: { readonly companyId: string; readonly branchId: string }
): Promise<void> {
  await seedAccountAndRole(principal);
  await bindScopedGrant(grantId, {
    tenantId: principal.tenantId,
    userId: principal.userId,
    roleId: principal.roleId,
    companyId: scope.companyId,
    branchId: scope.branchId,
  });
}

/**
 * Runs one fixture statement under the tenant and actor GUCs.
 *
 * For ATTRIBUTION, not for permission. `shared.touch_row_metadata` is a BEFORE
 * UPDATE trigger on both tables the two fixtures below correct, and it stamps
 * `updated_by` from `iam.current_user_id()`, which reads `app.user_id`. Both
 * those columns are NULLABLE, so a bare admin UPDATE is not refused — it
 * succeeds and leaves a correction no actor ever made, which is the worse
 * outcome of the two because nothing later would flag it. The GUCs name the
 * same actor the product would have named, exactly as `seedVehicleDisplay`
 * below sets them for its own UPDATE.
 */
async function asTenantActor<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Gives one vehicle a catalogue make and model and a display number, and returns
 * the VIN the shared fixture generated for it (Owner directive, P1-32-PRE-OD-UX).
 *
 * By SQL because the vehicle update route is the only writer of a car's catalogue
 * references, and reaching it would mean arranging a second authenticated
 * principal in the middle of a fixture — this file's subject is the warranty read
 * rather than the vehicle write. (Its operation id is deliberately not spelled
 * here: the P1-24 register counts a raw mention in a test file as a reference, and
 * this file is not evidence for that operation.)
 *
 * `tg_vehicles_catalog_refs` validates both references on UPDATE, so a make or
 * model this tenant cannot use is refused here rather than silently ignored — the
 * fixture cannot fabricate a catalogue link that the product would not allow.
 */
async function seedVehicleDisplay(vehicleId: string): Promise<string> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );
    await client.query(
      `INSERT INTO veh.makes (id, scope, tenant_id, code, name, created_by)
       VALUES ($1,'tenant',$2,'fx_p132_make',$3,$4) ON CONFLICT (id) DO NOTHING`,
      [OD_MAKE, TENANT_A, OD_MAKE_NAME, USER_A]
    );
    await client.query(
      `INSERT INTO veh.models (id, scope, tenant_id, make_id, code, name, created_by)
       VALUES ($1,'tenant',$2,$3,'fx_p132_model',$4,$5) ON CONFLICT (id) DO NOTHING`,
      [OD_MODEL, TENANT_A, OD_MAKE, OD_MODEL_NAME, USER_A]
    );
    const updated = await client.query<{ vin_normalized: string | null }>(
      `UPDATE veh.vehicles
          SET make_id = $2, model_id = $3, display_number = $4
        WHERE tenant_id = $1 AND id = $5
        RETURNING vin_normalized`,
      [TENANT_A, OD_MAKE, OD_MODEL, OD_VEHICLE_NUMBER, vehicleId]
    );
    await client.query('COMMIT');
    return updated.rows[0]?.vin_normalized ?? '';
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** A COMPANY_A9 policy and coverage, so a warranty can exist in a second branch. */
const A9_POLICY = 'f1310000-0000-4000-8000-000000000901';
const A9_POLICY_CODE = 'fx_p131_a9_policy';
const A9_COVERAGE = 'f1310000-0000-4000-8000-000000000902';

/**
 * Seeds the second branch's warranty configuration by SQL.
 *
 * By SQL because there is no writer: `wty.policy.manage` is declared by no operation
 * anywhere in the product (**PPD-04**, prerequisite P-10), which is a finding this
 * slice records and does not close. The P1-22 fixtures seed COMPANY_A1's policies
 * the same way and for the same reason.
 */
async function seedSecondBranchPolicy(): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );
    await client.query(
      `INSERT INTO wty.warranty_policies
         (id, tenant_id, company_id, policy_code, name, status, created_by)
       VALUES ($1,$2,$3,$4,'P1-31 second-branch policy','active',$5)
       ON CONFLICT (id) DO NOTHING`,
      [A9_POLICY, TENANT_A, COMPANY_A9, A9_POLICY_CODE, USER_A]
    );
    await client.query(
      `INSERT INTO wty.warranty_coverage
         (id, tenant_id, company_id, policy_id, covered_scope, duration_months,
          odometer_limit, effective_from, effective_to, status, created_by)
       VALUES ($1,$2,$3,$4,'all',$5,$6::integer,$7::date,NULL,'active',$8)
       ON CONFLICT (id) DO NOTHING`,
      [
        A9_COVERAGE,
        TENANT_A,
        COMPANY_A9,
        A9_POLICY,
        COVERAGE_DURATION_MONTHS,
        COVERAGE_ODOMETER_ALLOWANCE,
        COVERAGE_EFFECTIVE_FROM,
        USER_A,
      ]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Every code the fixture principals hold must actually be in the catalogue. */
async function heldPermissionCodes(principal: Principal): Promise<readonly string[]> {
  const rows = await admin.query<{ permission_code: string }>(
    `SELECT p.permission_code
       FROM iam.role_permissions rp
       JOIN iam.permissions p ON p.id = rp.permission_id
      WHERE rp.tenant_id = $1 AND rp.role_id = $2
      ORDER BY 1`,
    [principal.tenantId, principal.roleId]
  );
  return rows.rows.map((row) => row.permission_code);
}

// ---------------------------------------------------------------------------
// Money guard
// ---------------------------------------------------------------------------

const MONEY_KEYS = Object.freeze([
  'amount',
  'currency',
  'price',
  'total',
  'cost',
  'balance',
  'value',
  'net',
  'gross',
  'tax',
]);

function refusesAnyMoneyShapedNumber(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) refusesAnyMoneyShapedNumber(entry);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'number') {
      expect(MONEY_KEYS.some((money) => key.toLowerCase().includes(money))).toBe(false);
    }
    refusesAnyMoneyShapedNumber(entry);
  }
}

/** An exact decimal string — never a float, never an exponent. */
const DECIMAL_STRING = /^\d+(\.\d+)?$/;

// ---------------------------------------------------------------------------
// Arrangement — real routes, then the authenticator is thrown away
// ---------------------------------------------------------------------------

interface ArrangedWarranty {
  readonly warrantyId: string;
  readonly delivery: SeededDelivery;
}

/**
 * Issues a warranty through `POST /deliveries/{id}/warranties` as `SAL_FULL`.
 *
 * Arranged through the product rather than by INSERT, because the claim under test
 * is that a warranty a workshop actually issued can be found again — not that a row
 * planted by the fixture can be selected.
 */
async function arrangeWarranty(
  tag: string,
  scope: { readonly companyId?: string; readonly branchId?: string } = {}
): Promise<ArrangedWarranty> {
  const delivery = await seedDeliveredDelivery(tag, scope);
  authAs(SAL_FULL);
  const response = await generateWarranty(delivery.deliveryId, POLICY_ACTIVE);
  if (response.status !== 201) {
    throw new Error(
      `arrangement for ${tag} failed with ${response.status}: ${await response.text()}`
    );
  }
  const body = await bodyOf<WarrantyDetailBody>(response);
  __resetAuthenticatorForTests();
  return { warrantyId: body.id, delivery };
}

/** One arranged transition. `reason` is null where a transition carries none. */
interface TransitionStep {
  readonly from: string;
  readonly to: string;
  readonly reason: string | null;
}

/**
 * Appends further transitions to one warranty's ledger, by SQL.
 *
 * This exists because **no operation in this repository advances a warranty status**.
 * `wty.warranty_records.status` may legally move to `active`, `expired` or `voided`,
 * `assertWritableStatus` refuses every one of them structurally, and
 * `wty.issue_warranty` is the only writer of `wty.warranty_status_history` anywhere —
 * so the genesis row is the only transition the product can produce today. A ledger
 * READ still has to page a ledger of any length, and the only way to arrange one is
 * this fixture. It is stated rather than disguised, and the honest negative below
 * reads a warranty this fixture never touched so the single-row case is proved too.
 *
 * It does exactly what a writer would have to do and nothing more: the record's status
 * moves and the transition is appended in the same transaction as that move, under the
 * actor GUC the `shared.stamp_status_history` BEFORE INSERT trigger reads, so `actor_id`
 * and `occurred_at` are server-stamped here exactly as they are in production. Nothing
 * is inserted with a chosen id, actor or timestamp.
 *
 * **`inOneTransaction` decides whether the appended rows TIE**, and the two fixtures
 * below use one setting each because they prove different things:
 *
 *  - **`false` (the default)** puts each step in its own transaction, so `occurred_at`
 *    — which is `now()`, transaction-stable — strictly increases and the newest-first
 *    order over the whole ledger is TOTAL on the sort key alone. That is the fixture the
 *    ordering assertion needs, because an order that is total can be asserted exactly.
 *  - **`true`** puts every step in ONE transaction, so the appended rows share
 *    `occurred_at` to the MICROSECOND. That is the `P1-27-INT-006` condition — the one a
 *    millisecond-truncated cursor silently skips — and within it the read's order is
 *    decided by the `id` tie-break, which is a random uuid. So the tied fixture is used
 *    for the PAGING case, which asserts that nothing is skipped or repeated, and never
 *    for an order assertion: asserting an order across a tie would be asserting more
 *    than the ordering contract gives.
 */
async function appendTransitions(
  warrantyId: string,
  steps: readonly TransitionStep[],
  options: { readonly inOneTransaction?: boolean } = {}
): Promise<void> {
  const batches = options.inOneTransaction === true ? [steps] : steps.map((step) => [step]);
  for (const batch of batches) {
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [USER_A, TENANT_A]
      );
      for (const step of batch) {
        await client.query(
          `UPDATE wty.warranty_records SET status = $2 WHERE id = $1 AND tenant_id = $3`,
          [warrantyId, step.to, TENANT_A]
        );
        await client.query(
          `INSERT INTO wty.warranty_status_history
             (tenant_id, company_id, branch_id, warranty_record_id, from_status, to_status, reason)
           SELECT r.tenant_id, r.company_id, r.branch_id, r.id, $2, $3, $4
             FROM wty.warranty_records r
            WHERE r.id = $1 AND r.tenant_id = $5`,
          [warrantyId, step.from, step.to, step.reason, TENANT_A]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

let FIRST: ArrangedWarranty;
let SECOND: ArrangedWarranty;
/** Transitions in SEPARATE transactions — a strictly ordered ledger. */
let LEDGER: ArrangedWarranty;
/** Transitions in ONE transaction — a ledger with a microsecond tie in it. */
let TIED: ArrangedWarranty;
/** The two steps both ledger fixtures are advanced through. */
const VOID_REASON = 'coverage terms were superseded by a linked record';
const ADVANCE: readonly TransitionStep[] = Object.freeze([
  { from: 'issued', to: 'active', reason: null },
  { from: 'active', to: 'voided', reason: VOID_REASON },
]);

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  runtime = runtimeAppPool(6);
  // Counting is OFF until a case turns it on; see "Statement counting" above.
  instrument(runtime);
  __setPrimaryPoolForTests(runtime);
  await establishP1_22Fixtures(admin);
  for (const principal of LOCAL_PRINCIPALS) await seedLocalPrincipal(principal);
  await seedScopedPrincipal(WTY_READ_SCOPED_A2, 'f1310000-0000-4000-8000-0000000007e3', {
    companyId: COMPANY_A1,
    branchId: BRANCH_A2,
  });
  await seedScopedPrincipal(WTY_READ_ELSEWHERE, 'f1310000-0000-4000-8000-0000000007f4', {
    companyId: COMPANY_A1,
    branchId: BRANCH_A2,
  });
  // The widening grant: one unrelated code scoped to BRANCH_A1, so A1 enters this
  // user's permission-blind branch union without any warranty authority there.
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,'fx_p1_31_widening','P1-31 widening',$3) ON CONFLICT (id) DO NOTHING`,
    [WIDENING_ROLE, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code = $4
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, WIDENING_ROLE, USER_A, WIDENING_PERMISSION]
  );
  await bindScopedGrant('f1310000-0000-4000-8000-0000000007f5', {
    tenantId: TENANT_A,
    userId: WTY_READ_ELSEWHERE.userId,
    roleId: WIDENING_ROLE,
    companyId: COMPANY_A1,
    branchId: BRANCH_A1,
  });
  await seedSecondBranchPolicy();
  FIRST = await arrangeWarranty('p131_wty_one');
  SECOND = await arrangeWarranty('p131_wty_two');
  // P-18. Two further warranties, both issued through the same route as the other two
  // and both advanced through the SAME two steps — the difference is only whether the
  // appended rows tie on `occurred_at`, and each fixture is therefore used for exactly
  // one property. FIRST and SECOND are deliberately left as the product created them,
  // so the genesis-only case below reads a warranty no fixture has touched rather than
  // one this file reset.
  LEDGER = await arrangeWarranty('p131_wty_ledger');
  await appendTransitions(LEDGER.warrantyId, ADVANCE);
  TIED = await arrangeWarranty('p131_wty_tied');
  await appendTransitions(TIED.warrantyId, ADVANCE, { inOneTransaction: true });

  // --- Owner directive P1-32-PRE-OD-UX -------------------------------------
  // Owner directive P1-32-PRE-OD-UX: the search box's NAME and PHONE arms read
  // `crm.*` and are switched off for a caller that does not work with customers.
  // Granted on this principal's own role, additively, so no shared fixture moves.
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1,$2,id,'allow',$3 FROM iam.permissions WHERE permission_code = 'crm.customer.read'
     ON CONFLICT DO NOTHING`,
    [TENANT_A, SAL_FULL.roleId, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1,$2,id,'allow',$3 FROM iam.permissions WHERE permission_code = 'crm.customer.read'
     ON CONFLICT DO NOTHING`,
    [TENANT_A, SAL_PERMISSION_ELSEWHERE.roleId, USER_A]
  );
  // A THIRD branch of the same company, plus a second branch scope on
  // `SAL_PERMISSION_ELSEWHERE`'s grant, so that principal holds TWO authorized
  // branches while BRANCH_A1 stays inside its RLS union and outside its
  // authority. Additive: no existing case in this file names OD_BRANCH.
  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'branch_od_wty','Fixture Branch OD Warranty','UTC',$4)
     ON CONFLICT (id) DO NOTHING`,
    [OD_BRANCH, TENANT_A, COMPANY_A1, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
     SELECT $1,$2,'branch',$3,$4,$5
      WHERE NOT EXISTS (
        SELECT 1 FROM iam.grant_scopes
         WHERE tenant_id = $1 AND grant_id = $2 AND branch_id = $4)`,
    [TENANT_A, SAL_PERMISSION_ELSEWHERE.grantId, COMPANY_A1, OD_BRANCH, USER_A]
  );
  OD_IN_A2 = await arrangeWarranty('p131_wty_od_a2', {
    companyId: COMPANY_A1,
    branchId: BRANCH_A2,
  });
  OD_IN_A3 = await arrangeWarranty('p131_wty_od_a3', {
    companyId: COMPANY_A1,
    branchId: OD_BRANCH,
  });
  // The searchable warranty: the work order's visit names a partner with a
  // distinctive name and a phone, and the vehicle carries a plate.
  OD_SEARCHABLE = await arrangeWarranty('p131_wty_od_search');
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
     VALUES ($1,$2,'individual',$3,'active',$4) ON CONFLICT (id) DO NOTHING`,
    [OD_PARTNER, TENANT_A, OD_SEARCH_NAME, USER_A]
  );
  await admin.query(
    `INSERT INTO crm.contact_points
       (tenant_id, partner_id, channel, normalized_value, raw_value, is_primary, created_by)
     SELECT $1,$2,'mobile',$3,$3,true,$4
      WHERE NOT EXISTS (
        SELECT 1 FROM crm.contact_points WHERE tenant_id = $1 AND partner_id = $2)`,
    [TENANT_A, OD_PARTNER, OD_SEARCH_PHONE, USER_A]
  );
  await admin.query(
    `INSERT INTO rec.reception_party_roles
       (tenant_id, company_id, branch_id, reception_visit_id, partner_id, relationship_role,
        valid_from, created_by)
     VALUES ($1,$2,$3,$4,$5,'service_requester',now(),$6)`,
    [
      TENANT_A,
      OD_SEARCHABLE.delivery.companyId,
      OD_SEARCHABLE.delivery.branchId,
      OD_SEARCHABLE.delivery.visitId,
      OD_PARTNER,
      USER_A,
    ]
  );
  await admin.query(
    `INSERT INTO veh.plate_history
       (tenant_id, vehicle_id, country_code, plate_raw, valid_from, created_by)
     VALUES ($1,$2,'JO',$3,current_date,$4)`,
    [TENANT_A, OD_SEARCHABLE.delivery.vehicleId, OD_SEARCH_PLATE, USER_A]
  );
  // The display fixtures: a tenant catalogue make and model, and a vehicle number,
  // on the SAME car the plate above belongs to. Tenant-scoped rather than platform
  // rows, because the platform catalogue ships empty by policy and a fixture must
  // not be the thing that fills it.
  OD_VIN = await seedVehicleDisplay(OD_SEARCHABLE.delivery.vehicleId);

  // A vehicle in tenant B. Nothing in tenant A references it; it exists so the
  // tenant predicate inside the vehicle module's own read has something real to
  // decline to resolve.
  await admin.query(
    `INSERT INTO veh.vehicles
       (id, tenant_id, vin_raw, display_number, powertrain_category, lifecycle_status, created_by)
     VALUES ($1,$2,$3,$4,'ice','active',$5) ON CONFLICT (id) DO NOTHING`,
    // Attributed to tenant B's own user: a tenant-A actor creating a tenant-B row
    // is a state the product cannot produce, and a fixture must not rely on one.
    [OD_TENANT_B_VEHICLE, TENANT_B, OD_TENANT_B_VIN, OD_TENANT_B_NUMBER, USER_B]
  );

  // A warranty whose car is then soft-deleted. Issued through the real route
  // first, so the record is one the product made and only the vehicle row goes
  // away underneath it — which is the state `vehicleBlockFor` exists for.
  //
  // By SQL because no operation in this repository soft-deletes a vehicle: the
  // lifecycle routes move `lifecycle_status`, and `deleted_at` has no writer.
  // That absence is recorded here rather than worked around silently.
  OD_NO_VEHICLE = await arrangeWarranty('p131_wty_od_novehicle');
  await asTenantActor((client) =>
    client.query(
      `UPDATE veh.vehicles SET deleted_at = now(), deleted_by = $3
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [TENANT_A, OD_NO_VEHICLE.delivery.vehicleId, USER_A]
    )
  );

  // A warranty whose visit no longer names a service requester. The role is
  // DATED OUT rather than deleted, which is the only correction the table
  // allows: `tg_reception_party_roles_immutable` freezes the partner, the role
  // and `valid_from`, so a correction writes `valid_to` and nothing else.
  //
  // The activation check that demands an active service requester fires only on
  // the transition INTO `authorized`, which this visit passed long before, so
  // dating the role out afterwards is a state the schema permits and a screen
  // has to render.
  OD_NO_PARTY = await arrangeWarranty('p131_wty_od_noparty');
  await asTenantActor((client) =>
    client.query(
      `UPDATE rec.reception_party_roles SET valid_to = now()
        WHERE tenant_id = $1 AND reception_visit_id = $2
          AND relationship_role = $3 AND valid_to IS NULL AND deleted_at IS NULL`,
      [TENANT_A, OD_NO_PARTY.delivery.visitId, 'service_requester']
    )
  );

  // The tie-break fixture; see `OD_TIEBREAK`. The two extra roles are recorded
  // AFTER the check-in's own row, in separate statements so `created_at` orders
  // them, and each is back-dated against the check-in's `valid_from`.
  // Back-dating is the only way to arrange it: `tg_reception_party_roles_immutable`
  // freezes `valid_from` once written, so a role recorded late with an earlier
  // start is what a late correction to a visit looks like.
  OD_TIEBREAK = await arrangeWarranty('p131_wty_od_tiebreak');
  for (const [partnerId, name] of [
    [OD_TIE_EARLIEST, OD_TIE_EARLIEST_NAME],
    [OD_TIE_HIGHEST, OD_TIE_HIGHEST_NAME],
  ] as const) {
    await admin.query(
      `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
       VALUES ($1,$2,'individual',$3,'active',$4) ON CONFLICT (id) DO NOTHING`,
      [partnerId, TENANT_A, name, USER_A]
    );
  }
  for (const [partnerId, backdate] of [
    [OD_TIE_EARLIEST, '2 days'],
    [OD_TIE_HIGHEST, '1 day'],
  ] as const) {
    const recorded = await admin.query(
      `INSERT INTO rec.reception_party_roles
         (tenant_id, company_id, branch_id, reception_visit_id, partner_id, relationship_role,
          valid_from, created_by)
       SELECT r.tenant_id, r.company_id, r.branch_id, r.reception_visit_id, $3,
              r.relationship_role, r.valid_from - $4::interval, $5
         FROM rec.reception_party_roles r
        WHERE r.tenant_id = $1 AND r.reception_visit_id = $2 AND r.partner_id = $6
          AND r.relationship_role = 'service_requester'
          AND r.valid_to IS NULL AND r.deleted_at IS NULL`,
      [TENANT_A, OD_TIEBREAK.delivery.visitId, partnerId, backdate, USER_A, PARTNER_A]
    );
    if (recorded.rowCount !== 1) {
      throw new Error(`tie-break role for ${partnerId} was not recorded`);
    }
  }

  // A work order in tenant B, made through the same conversion route the tenant-A
  // ones are, so its visit carries the service requester `rec.accept_check_in`
  // wrote. The partner-id lookup's tenant case needs a row that would answer if
  // the predicate were missing.
  const tenantBOrder = await createWorkOrder({
    tenantId: TENANT_B,
    companyId: COMPANY_B1,
    branchId: BRANCH_B1,
  });
  __resetAuthenticatorForTests();
  OD_TENANT_B_WORK_ORDER = tenantBOrder.workOrderId;
}, 240_000);

afterEach(() => {
  __resetAuthenticatorForTests();
  // `wty.warranty-list` carries the `expensive-read` policy and the Owner
  // directive cases (P1-32-PRE-OD-UX) each make several list calls; without this
  // a later case answers 429 and the failure reads as a broken filter.
  __resetRateLimitForTests();
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  await cleanP1_22Fixtures().catch(() => undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

// ---------------------------------------------------------------------------
// P-7 — the minted code, and the re-point
// ---------------------------------------------------------------------------

describe('P-7 the minted read code', () => {
  it('is seeded once, in the wty domain, at low risk', async () => {
    const rows = await admin.query<{ domain: string; risk_level: string; description: string }>(
      `SELECT domain, risk_level, description FROM iam.permissions WHERE permission_code = $1`,
      [WARRANTY_READ]
    );
    // Exactly one row: the catalogue seed is the only shipping insert into
    // iam.permissions and it is idempotent, so a duplicate would mean a second
    // authority for the same name.
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]?.domain).toBe('wty');
    expect(rows.rows[0]?.risk_level).toBe('low');
    expect(rows.rows[0]?.description).toContain('warranty');
  });

  it('gates both warranty reads, and gates no write', () => {
    expect(WARRANTY_LIST_OPERATION.id).toBe('wty.warranty-list');
    expect(WARRANTY_DETAIL_OPERATION.id).toBe('wty.warranty-detail');
    for (const operation of [WARRANTY_LIST_OPERATION, WARRANTY_DETAIL_OPERATION]) {
      // The re-point, and the new declaration. `wty.warranty.issue` is the write
      // code the detail read used to carry; `wty.policy.manage` is the code the
      // route docblock refused to borrow because it grants coverage administration.
      expect(operation.permissions).toEqual([WARRANTY_READ]);
      expect(operation.permissions).not.toContain(WARRANTY_ISSUE);
      expect(operation.permissions).not.toContain(POLICY_MANAGE);
      expect(operation.method).toBe('GET');
      expect(operation.scope).toBe('branch');
      expect(operation.auditClass).toBe('none');
    }
  });

  it('is carried by the tenant administrator provisioning bundle (CC-07)', () => {
    // Withholding it while re-pointing the detail read would REMOVE a capability a
    // freshly provisioned administrator already has through `wty.warranty.issue`,
    // which is the one thing the CC-01/CC-02/CC-04 exclusions never do.
    expect(TENANT_ADMINISTRATOR_ROLE.permissionCodes).toContain(WARRANTY_READ);
    // Nothing is withdrawn: `wty.warranty-generate` still declares the issue code.
    expect(TENANT_ADMINISTRATOR_ROLE.permissionCodes).toContain(WARRANTY_ISSUE);
    // `wty.policy.manage` was still excluded when P-7 landed (CC-01). P-10
    // published the five operations that declare it on 2026-09-09 and carried it
    // into the bundle on CC-01's own terms, so the bundle holds it now. This
    // slice's claim is unaffected either way: the two reads declare
    // `wty.warranty.read`, and the case above proves a holder of ONLY
    // `wty.policy.manage` is refused them.
    expect(TENANT_ADMINISTRATOR_ROLE.permissionCodes).toContain(POLICY_MANAGE);
    expect(new Set(TENANT_ADMINISTRATOR_ROLE.permissionCodes).size).toBe(
      TENANT_ADMINISTRATOR_ROLE.permissionCodes.length
    );
  });

  it('actually reaches the fixture principals, so a refusal below means something', async () => {
    expect(await heldPermissionCodes(WTY_READ_ONLY)).toEqual([WARRANTY_READ]);
    expect(await heldPermissionCodes(WTY_POLICY_ONLY)).toEqual([POLICY_MANAGE]);
    expect(await heldPermissionCodes(WTY_ISSUE_ONLY)).toContain(WARRANTY_ISSUE);
    expect(await heldPermissionCodes(WTY_ISSUE_ONLY)).not.toContain(WARRANTY_READ);
  });
});

describe('P-7 the read is no longer gated on a write code', () => {
  it('a principal holding ONLY wty.warranty.read reads a warranty it could not have issued', async () => {
    // The arrangement was performed by SAL_FULL and the authenticator was reset, so
    // this principal has no relationship to the write that created the row.
    authAs(WTY_READ_ONLY);
    const detail = await readWarranty(FIRST.warrantyId);
    expect(detail.status).toBe(200);
    const body = await bodyOf<WarrantyDetailBody>(detail);
    expect(body.id).toBe(FIRST.warrantyId);
    expect(body.deliveryRecordId).toBe(FIRST.delivery.deliveryId);

    const list = await listWarranties({
      companyId: FIRST.delivery.companyId,
      branchId: FIRST.delivery.branchId,
    });
    expect(list.status).toBe(200);
    const page = await bodyOf<WarrantyListBody>(list);
    expect(page.items.map((row) => row.id)).toContain(FIRST.warrantyId);
  });

  it('that principal can neither issue a warranty nor manage policy', async () => {
    authAs(WTY_READ_ONLY);
    const refused = await generateWarranty(SECOND.delivery.deliveryId, POLICY_ACTIVE);
    expect(refused.status).toBe(403);
    const problem = await problemOf(refused);
    expect(problem.code).toBe('ERR-IAM-001');
    // The registered code, named: the read code confers no authority to issue.
    expect(problem.requiredPermissions).toContain(WARRANTY_ISSUE);
    expect(problem.requiredPermissions).not.toContain(WARRANTY_READ);
    // And it holds no policy authority at all — `wty.policy.manage` is declared by
    // no operation in the product (PPD-04 / P-10), so the strongest available proof
    // is that the code is not held rather than that a route refuses it.
    expect(await heldPermissionCodes(WTY_READ_ONLY)).not.toContain(POLICY_MANAGE);
  });

  it('yesterday caller — wty.warranty.issue alone — is now REFUSED both reads', async () => {
    authAs(WTY_ISSUE_ONLY);
    for (const [label, response] of [
      ['detail', await readWarranty(FIRST.warrantyId)] as const,
      [
        'list',
        await listWarranties({
          companyId: FIRST.delivery.companyId,
          branchId: FIRST.delivery.branchId,
        }),
      ] as const,
    ]) {
      expect(response.status, label).toBe(403);
      const problem = await problemOf(response);
      expect(problem.code, label).toBe('ERR-IAM-001');
      expect(problem.requiredPermissions, label).toEqual([WARRANTY_READ]);
    }
  });

  it('and can still generate a warranty, so nothing was taken from the write path', async () => {
    const delivery = await seedDeliveredDelivery('p131_wty_issue_only');
    authAs(WTY_ISSUE_ONLY);
    const created = await generateWarranty(delivery.deliveryId, POLICY_ACTIVE);
    expect(created.status).toBe(201);
    expect((await bodyOf<WarrantyDetailBody>(created)).deliveryRecordId).toBe(delivery.deliveryId);
  });

  it('wty.policy.manage alone is refused both reads, so the read never borrows it', async () => {
    authAs(WTY_POLICY_ONLY);
    const detail = await readWarranty(FIRST.warrantyId);
    expect(detail.status).toBe(403);
    expect((await problemOf(detail)).requiredPermissions).toEqual([WARRANTY_READ]);
    const list = await listWarranties({
      companyId: FIRST.delivery.companyId,
      branchId: FIRST.delivery.branchId,
    });
    expect(list.status).toBe(403);
    expect((await problemOf(list)).requiredPermissions).toEqual([WARRANTY_READ]);
  });
});

// ---------------------------------------------------------------------------
// P-6 — the list itself
// ---------------------------------------------------------------------------

describe('P-6 GET /api/v1/warranties', () => {
  it('publishes the record fields and a resolvable policy, with no money anywhere', async () => {
    authAs(WTY_READ_ONLY);
    const response = await listWarranties({
      companyId: FIRST.delivery.companyId,
      branchId: FIRST.delivery.branchId,
    });
    expect(response.status).toBe(200);
    const page = await bodyOf<WarrantyListBody>(response);
    const row = page.items.find((entry) => entry.id === FIRST.warrantyId);
    expect(row).toBeDefined();
    if (row === undefined) return;

    // Every term is compared against what PostgreSQL derives from the fixture rows,
    // never against a value this file computed: a one-day drift in a contractual
    // date is a wrong warranty document, not a rounding detail.
    const expected = await expectedWarrantyTerms(FIRST.delivery.deliveryId, COVERAGE_ACTIVE);
    expect(row.startDate).toBe(expected.startDate);
    expect(row.expiryDate).toBe(expected.expiryDate);
    expect(row.odometerAtIssue).toBe(expected.odometerAtIssue);
    expect(row.odometerLimit).toBe(expected.odometerLimit);
    expect(row.vehicleId).toBe(FIRST.delivery.vehicleId);
    expect(row.workOrderId).toBe(FIRST.delivery.workOrderId);
    expect(row.deliveryRecordId).toBe(FIRST.delivery.deliveryId);
    expect(row.status).toBe('issued');
    expect(row.recordVersion).toBeGreaterThan(0);

    // The policy travels resolved. No operation lists warranty policies (PPD-04 /
    // P-10), so a bare policyId would be an identifier nobody could resolve.
    expect(row.policy.id).toBe(POLICY_ACTIVE);
    expect(row.policy.policyCode).toBe(POLICY_ACTIVE_CODE);
    expect(row.policy.status).toBe('active');
    expect(row.policy.name.length).toBeGreaterThan(0);

    // Distance readings as exact decimal STRINGS, and no money-shaped number at all.
    expect(typeof row.odometerAtIssue).toBe('string');
    expect(row.odometerAtIssue).toMatch(DECIMAL_STRING);
    if (row.odometerLimit !== null) expect(row.odometerLimit).toMatch(DECIMAL_STRING);
    refusesAnyMoneyShapedNumber(page);
  });

  it('spells every shared field exactly as the detail read spells it', async () => {
    authAs(WTY_READ_ONLY);
    const list = await listWarranties({
      companyId: FIRST.delivery.companyId,
      branchId: FIRST.delivery.branchId,
    });
    const row = (await bodyOf<WarrantyListBody>(list)).items.find(
      (entry) => entry.id === FIRST.warrantyId
    );
    const detail = await bodyOf<WarrantyDetailBody>(await readWarranty(FIRST.warrantyId));
    expect(row).toBeDefined();
    if (row === undefined) return;
    // One shape, not two. Every key the list publishes carries the detail read's own
    // value — including `odometerLimit`, which is the record's ABSOLUTE ceiling in
    // both and never the coverage's relative allowance.
    for (const key of Object.keys(row) as (keyof WarrantyListRow)[]) {
      expect({ key, value: row[key] }).toEqual({
        key,
        value: detail[key as keyof WarrantyDetailBody],
      });
    }
    // The list is a projection and stops there: coverage terms and covered items
    // belong to the detail read, which already publishes them.
    expect(Object.keys(row)).not.toContain('coverage');
    expect(Object.keys(row)).not.toContain('items');
    expect(Object.keys(row)).not.toContain('replayed');
  });

  it('is scoped by the SERVER on an unfiltered call, and never bleeds a branch', async () => {
    // A second company and branch inside the SAME tenant, so what separates the two
    // pages cannot be tenancy.
    const elsewhere = await seedDeliveredDelivery('p131_wty_a9', {
      companyId: COMPANY_A9,
      branchId: BRANCH_A9,
    });
    authAs(SAL_FULL);
    // A9's own policy. `POLICY_ACTIVE` belongs to COMPANY_A1 and generation answers
    // ERR-RES-001 for it here — which is itself the composite scope key doing its job.
    const created = await generateWarranty(elsewhere.deliveryId, A9_POLICY);
    expect(created.status).toBe(201);
    const foreignBranchWarranty = (await bodyOf<WarrantyDetailBody>(created)).id;
    __resetAuthenticatorForTests();

    authAs(WTY_READ_ONLY);
    const page = await bodyOf<WarrantyListBody>(
      await listWarranties({
        companyId: FIRST.delivery.companyId,
        branchId: FIRST.delivery.branchId,
        limit: 100,
      })
    );
    const ids = page.items.map((row) => row.id);
    expect(ids).toContain(FIRST.warrantyId);
    expect(ids).toContain(SECOND.warrantyId);
    // The unfiltered call returns the SERVER's scope and nothing wider.
    expect(ids).not.toContain(foreignBranchWarranty);
    for (const row of page.items) {
      expect(row.companyId).toBe(FIRST.delivery.companyId);
      expect(row.branchId).toBe(FIRST.delivery.branchId);
    }
  });

  it('filters by vehicle, and the filter actually filters', async () => {
    authAs(WTY_READ_ONLY);
    const filtered = await bodyOf<WarrantyListBody>(
      await listWarranties({
        companyId: FIRST.delivery.companyId,
        branchId: FIRST.delivery.branchId,
        vehicleId: FIRST.delivery.vehicleId,
      })
    );
    expect(filtered.items.map((row) => row.id)).toEqual([FIRST.warrantyId]);
    // The complement, so the assertion above cannot pass because the filter dropped
    // everything: the same list unfiltered carries the second warranty too.
    expect(SECOND.delivery.vehicleId).not.toBe(FIRST.delivery.vehicleId);
    const unfiltered = await bodyOf<WarrantyListBody>(
      await listWarranties({
        companyId: FIRST.delivery.companyId,
        branchId: FIRST.delivery.branchId,
        limit: 100,
      })
    );
    expect(unfiltered.items.map((row) => row.id)).toContain(SECOND.warrantyId);

    // A vehicle with no warranty is an empty page, not a 404.
    const none = await listWarranties({
      companyId: FIRST.delivery.companyId,
      branchId: FIRST.delivery.branchId,
      vehicleId: randomUUID(),
    });
    expect(none.status).toBe(200);
    expect((await bodyOf<WarrantyListBody>(none)).items).toEqual([]);
  });

  it('requires the scope target, and refuses an unknown parameter', async () => {
    authAs(WTY_READ_ONLY);
    const noScope = await listWarranties({});
    expect(noScope.status).toBe(422);
    expect((await problemOf(noScope)).code).toBe('ERR-VAL-001');

    const branchOnly = await listWarranties({ branchId: FIRST.delivery.branchId });
    expect(branchOnly.status).toBe(422);

    const unknown = await listWarranties({
      companyId: FIRST.delivery.companyId,
      branchId: FIRST.delivery.branchId,
      somethingElse: 'x',
    });
    // 422 and not a filter silently dropped: a caller who mistyped `vehicleId` and
    // was shown the whole branch would read the page as that vehicle's.
    expect(unknown.status).toBe(422);
    expect((await problemOf(unknown)).code).toBe('ERR-VAL-001');
  });

  it('401 unauthenticated, on both reads', async () => {
    __resetAuthenticatorForTests();
    expect(
      (
        await listWarranties({
          companyId: FIRST.delivery.companyId,
          branchId: FIRST.delivery.branchId,
        })
      ).status
    ).toBe(401);
    expect((await readWarranty(FIRST.warrantyId)).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Tenancy and scope
// ---------------------------------------------------------------------------

describe('another tenant learns nothing about existence', () => {
  it('is refused the list of a scope it does not hold, and told nothing about it', async () => {
    authAs(WTY_READ_TENANT_B);
    const response = await listWarranties({
      companyId: FIRST.delivery.companyId,
      branchId: FIRST.delivery.branchId,
    });
    // A refusal that is identical whether or not that branch has warranties — the
    // scope is refused before a row is read, so the answer carries no existence.
    expect(response.status).toBe(403);
    expect((await problemOf(response)).code).toBe('ERR-IAM-001');
  });

  it('is answered ERR-RES-001 for a real warranty id, never a 403', async () => {
    authAs(WTY_READ_TENANT_B);
    const response = await readWarranty(FIRST.warrantyId);
    // Not-found is decided BEFORE any scope decision, so a foreign tenant cannot
    // tell a real warranty id from an invented one.
    expect(response.status).toBe(404);
    expect((await problemOf(response)).code).toBe('ERR-RES-001');

    const invented = await readWarranty(randomUUID());
    expect(invented.status).toBe(404);
    expect((await problemOf(invented)).code).toBe('ERR-RES-001');
  });

  it('a tenant-B principal holding every sal/wty code, the read code included, still learns nothing', async () => {
    // `SAL_TENANT_B` holds the full sal/wty set INCLUDING `wty.warranty.read`, so
    // nothing about this refusal is a missing permission: it is tenancy, and it is
    // reported as an absent resource rather than as a forbidden one.
    authAs(SAL_TENANT_B);
    const response = await readWarranty(FIRST.warrantyId);
    expect(response.status).toBe(404);
    expect((await problemOf(response)).code).toBe('ERR-RES-001');
  });
});

describe('branch isolation, in both layers', () => {
  it('404 from RLS when the caller is scoped to another branch', async () => {
    // Holds `wty.warranty.read`, so this refusal cannot be the permission.
    authAs(WTY_READ_SCOPED_A2);
    const response = await readWarranty(FIRST.warrantyId);
    expect(response.status).toBe(404);
    expect((await problemOf(response)).code).toBe('ERR-RES-001');
  });

  it('403 from authorizeScope when RLS can see the row but the grant is elsewhere', async () => {
    // The decisive case, and it is decisive only on the DETAIL read. That request
    // carries no scope target, so the pre-handler evaluates the permission
    // SCOPE-BLIND through `iam.has_permission` and this caller — which holds
    // `wty.warranty.read` in A2 — passes it. Its widening grant puts BRANCH_A1
    // inside the permission-blind `iam.allowed_branch_ids()` union, so RLS returns
    // the row too. The in-service `authorizeScope` on the row's OWN company and
    // branch is therefore the only guard left, and deleting that call turns this
    // 403 into a 200.
    authAs(WTY_READ_ELSEWHERE);
    const detail = await readWarranty(FIRST.warrantyId);
    expect(detail.status).toBe(403);
    expect((await problemOf(detail)).code).toBe('ERR-IAM-001');

    // And on the list, where the caller NAMES the scope: the target is refused
    // before any row is read, so a client-asserted pair is never authoritative.
    const list = await listWarranties({
      companyId: FIRST.delivery.companyId,
      branchId: FIRST.delivery.branchId,
    });
    expect(list.status).toBe(403);
    expect((await problemOf(list)).code).toBe('ERR-IAM-001');
  });
});

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

describe('the list pages', () => {
  it('pages disjointly over two warranties that share a start_date', async () => {
    // Both fixtures were delivered inside this run, so `start_date` — the sort key —
    // is the SAME calendar day for both. The `id` tie-break is the only thing making
    // the order total, which is exactly the case a sort-value-only cursor loses.
    expect(FIRST.delivery.deliveredOn).toBe(SECOND.delivery.deliveredOn);

    authAs(WTY_READ_ONLY);
    const scope = {
      companyId: FIRST.delivery.companyId,
      branchId: FIRST.delivery.branchId,
    };

    // Walked one row at a time to exhaustion rather than sampled two pages: the
    // property under test is that the cursor loses nothing and repeats nothing over
    // the WHOLE set, and a two-page sample cannot see a row dropped at page five.
    const walked: string[] = [];
    const startDates: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const response: Response = await listWarranties({
        ...scope,
        limit: 1,
        ...(cursor === null ? {} : { cursor }),
      });
      expect(response.status).toBe(200);
      const page: WarrantyListBody = await bodyOf<WarrantyListBody>(response);
      expect(page.items).toHaveLength(1);
      const row = page.items[0];
      if (row !== undefined) {
        walked.push(row.id);
        startDates.push(row.startDate);
      }
      cursor = page.nextCursor;
      expect(page.hasMore).toBe(cursor !== null);
      pages += 1;
      // A cursor that never advanced would otherwise spin for ever, which is a
      // failure mode a fixed two-page assertion cannot tell apart from success.
      expect(pages).toBeLessThan(50);
    } while (cursor !== null);

    // Nothing repeated and nothing skipped: the walk is exactly the branch live
    // warranty rows as the database holds them.
    expect(new Set(walked).size).toBe(walked.length);
    expect(walked).toContain(FIRST.warrantyId);
    expect(walked).toContain(SECOND.warrantyId);
    const actual = await admin.query<{ id: string }>(
      `SELECT id FROM wty.warranty_records
        WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3 AND deleted_at IS NULL`,
      [TENANT_A, FIRST.delivery.companyId, FIRST.delivery.branchId]
    );
    expect([...walked].sort()).toEqual(actual.rows.map((r) => r.id).sort());

    // And the walk really did cross a tie: at least two rows share the `start_date`
    // the cursor sorts on, so the `id` tie-break was load-bearing rather than
    // incidental.
    expect(new Set(startDates).size).toBeLessThan(startDates.length);
  });

  it('refuses a malformed cursor and an oversized page, differently', async () => {
    authAs(WTY_READ_ONLY);
    const scope = {
      companyId: FIRST.delivery.companyId,
      branchId: FIRST.delivery.branchId,
    };
    const badCursor = await listWarranties({ ...scope, cursor: 'not-a-cursor' });
    expect(badCursor.status).toBe(400);
    expect((await problemOf(badCursor)).code).toBe('ERR-PAG-001');

    const oversized = await listWarranties({ ...scope, limit: 5000 });
    expect(oversized.status).toBe(422);
    expect((await problemOf(oversized)).code).toBe('ERR-VAL-001');
  });

  it('refuses a cursor minted for a different list', async () => {
    // The ordering contract's key is part of the cursor, so a cursor cannot be spent
    // on a list it was not minted for.
    authAs(WTY_READ_ONLY);
    const crossed = await listWarranties({
      companyId: FIRST.delivery.companyId,
      branchId: FIRST.delivery.branchId,
      cursor: Buffer.from(
        JSON.stringify({ k: 'sal.receipts:received_at_desc', v: '2026-01-01', i: randomUUID() })
      ).toString('base64url'),
    });
    expect(crossed.status).toBe(400);
    expect((await problemOf(crossed)).code).toBe('ERR-PAG-001');
  });
});

// ---------------------------------------------------------------------------
// P-18 — the transition ledger (CC-10)
//
// `wty.warranty_status_history` is written inside `wty.issue_warranty`, in the same
// statement that creates the record, and before this route was read by nothing
// anywhere in `apps/api/src`. P-6 closed VHM-06 / WF-26 / PPD-13 in its list limb
// and left the ledger limb open; this closes it.
// ---------------------------------------------------------------------------

describe('P-18 the operation registration', () => {
  it('declares the read code, a branch scope and no audit record', () => {
    expect(WARRANTY_STATUS_HISTORY_OPERATION.id).toBe('wty.warranty-status-history');
    expect(WARRANTY_STATUS_HISTORY_OPERATION.method).toBe('GET');
    expect(WARRANTY_STATUS_HISTORY_OPERATION.path).toBe('/warranties/{warrantyId}/status-history');
    expect(WARRANTY_STATUS_HISTORY_OPERATION.module).toBe('warranty');
    // Uniform with the other two warranty reads. A different gate would mean a
    // caller could read the record but not how it reached its status.
    expect(WARRANTY_STATUS_HISTORY_OPERATION.permissions).toEqual([WARRANTY_READ]);
    expect(WARRANTY_STATUS_HISTORY_OPERATION.permissions).not.toContain(WARRANTY_ISSUE);
    expect(WARRANTY_STATUS_HISTORY_OPERATION.permissions).not.toContain(POLICY_MANAGE);
    expect(WARRANTY_STATUS_HISTORY_OPERATION.scope).toBe('branch');
    // A read writes no audit record, so declaring a class would claim one.
    expect(WARRANTY_STATUS_HISTORY_OPERATION.auditClass).toBe('none');
  });
});

describe('P-18 GET /api/v1/warranties/{warrantyId}/status-history', () => {
  it('publishes every transition newest first, with the genesis row last', async () => {
    authAs(WTY_READ_ONLY);
    const response = await readStatusHistory(LEDGER.warrantyId);
    expect(response.status).toBe(200);
    const body = await bodyOf<StatusHistoryBody>(response);

    // Self-identifying: the subject travels with the page, so a ledger is never a
    // bare list with no warranty attached to it.
    expect(body.warrantyId).toBe(LEDGER.warrantyId);

    // Newest first: the two appended transitions, then the genesis row the primitive
    // wrote when the record was created. This ledger is asserted in EXACT order
    // because `LEDGER`'s transitions were appended in separate transactions, so no
    // two rows share `occurred_at` and the order is total on the sort key alone. The
    // tied ledger is deliberately NOT asserted this way — see the paging case.
    expect(body.transitions.items.map((row) => row.toStatus)).toEqual([
      'voided',
      'active',
      'issued',
    ]);
    expect(body.transitions.items.map((row) => row.fromStatus)).toEqual(['active', 'issued', null]);

    // The stamps really do decrease, so the order above is the read's doing rather
    // than an accident of insertion order.
    const stamps = body.transitions.items.map((row) => Date.parse(row.occurredAt));
    expect(stamps[0]).toBeGreaterThan(stamps[1] ?? 0);
    expect(stamps[1]).toBeGreaterThan(stamps[2] ?? 0);

    // The oldest row IS the origin: `from_status` is null on it and only on it, so
    // no synthetic origin block is needed and none is published.
    const oldest = body.transitions.items[body.transitions.items.length - 1];
    expect(oldest?.fromStatus).toBeNull();
    expect(oldest?.toStatus).toBe('issued');
    expect(Object.keys(body)).toEqual(['warrantyId', 'transitions']);
    expect(body).not.toHaveProperty('origin');

    // `reason` is carried verbatim, and is null where no reason was given rather
    // than an empty string standing in for one.
    expect(body.transitions.items[0]?.reason).toBe(VOID_REASON);
    expect(body.transitions.items[1]?.reason).toBeNull();
    expect(oldest?.reason).toBeNull();

    // Every row is attributed and server-stamped. `actor_id` is NOT NULL in the DDL
    // and `shared.stamp_status_history` sets it from the session context, so an
    // unattributed transition cannot exist to be published.
    for (const row of body.transitions.items) {
      expect(typeof row.actorId).toBe('string');
      expect(row.actorId.length).toBeGreaterThan(0);
      expect(new Date(row.occurredAt).toISOString()).toBe(row.occurredAt);
    }

    // The ledger carries no monetary value, because `wty` holds no monetary column.
    refusesAnyMoneyShapedNumber(body);
  });

  it('is exactly the ledger the database holds, and nothing reconstructed', async () => {
    // The wire rows are compared against the table itself, so a mapper that dropped,
    // duplicated or re-ordered a transition is caught rather than assumed away.
    // Ordered `(occurred_at DESC, id DESC)` and not by `seq`, because `id` is the
    // tie-break the read actually uses — `keysetFragment` compares `(sort, id)`. On
    // this ledger no two rows tie, so the two orderings agree; using the read's own
    // one keeps the comparison honest if that ever stops being so.
    const stored = await admin.query<{ id: string; to_status: string }>(
      `SELECT id, to_status FROM wty.warranty_status_history
        WHERE tenant_id = $1 AND warranty_record_id = $2
        ORDER BY occurred_at DESC, id DESC`,
      [TENANT_A, LEDGER.warrantyId]
    );
    authAs(WTY_READ_ONLY);
    const body = await bodyOf<StatusHistoryBody>(
      await readStatusHistory(LEDGER.warrantyId, { limit: 100 })
    );
    expect(body.transitions.items.map((row) => row.id)).toEqual(stored.rows.map((row) => row.id));
  });

  it('returns EXACTLY the genesis row for a warranty the product alone created', async () => {
    // The honest negative, and the one that states what this ledger really contains
    // today. FIRST was issued through `POST /deliveries/{id}/warranties` and never
    // touched again: nothing in this phase advances `wty.warranty_records.status`,
    // so its ledger is the single row `wty.issue_warranty` wrote in the same
    // statement as the record — `NULL -> 'issued'`, attributed to the issuing actor.
    // That is one row, not an empty page: a warranty with no history at all would
    // mean the primitive had not written the genesis row.
    authAs(WTY_READ_ONLY);
    const body = await bodyOf<StatusHistoryBody>(await readStatusHistory(FIRST.warrantyId));
    expect(body.warrantyId).toBe(FIRST.warrantyId);
    expect(body.transitions.items).toHaveLength(1);
    expect(body.transitions.items[0]?.fromStatus).toBeNull();
    expect(body.transitions.items[0]?.toStatus).toBe('issued');
    expect(body.transitions.items[0]?.reason).toBeNull();
    expect(body.transitions.hasMore).toBe(false);
    expect(body.transitions.nextCursor).toBeNull();

    // And the record itself still reads `issued`, so the ledger and the record agree.
    const detail = await bodyOf<WarrantyDetailBody>(await readWarranty(FIRST.warrantyId));
    expect(detail.status).toBe('issued');
  });

  it('pages disjointly straight through a microsecond tie', async () => {
    // `TIED`'s two appended transitions were written in ONE transaction, so
    // `occurred_at` — the sort key — is identical to the microsecond. That is
    // `P1-27-INT-006`: a cursor truncated to milliseconds skips the second row
    // silently, and only a walk to exhaustion over the tie can see it happen.
    //
    // This case asserts completeness and disjointness and deliberately NOT an order.
    // Within a tie the read falls back to the `id` tie-break, which is a random uuid,
    // so the relative order of the two tied rows is not something the ordering
    // contract promises — and asserting it would be asserting more than the contract
    // gives. The exact order is asserted on `LEDGER`, where nothing ties.
    authAs(WTY_READ_ONLY);
    const walked: string[] = [];
    const stamps: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const response: Response = await readStatusHistory(TIED.warrantyId, {
        limit: 1,
        ...(cursor === null ? {} : { cursor }),
      });
      expect(response.status).toBe(200);
      const page: StatusHistoryBody = await bodyOf<StatusHistoryBody>(response);
      expect(page.transitions.items).toHaveLength(1);
      const row = page.transitions.items[0];
      if (row !== undefined) {
        walked.push(row.id);
        stamps.push(row.occurredAt);
      }
      cursor = page.transitions.nextCursor;
      expect(page.transitions.hasMore).toBe(cursor !== null);
      pages += 1;
      // A cursor that never advanced would otherwise spin for ever.
      expect(pages).toBeLessThan(50);
    } while (cursor !== null);

    // Nothing repeated and nothing skipped, against the table itself.
    expect(new Set(walked).size).toBe(walked.length);
    const stored = await admin.query<{ id: string }>(
      `SELECT id FROM wty.warranty_status_history
        WHERE tenant_id = $1 AND warranty_record_id = $2`,
      [TENANT_A, TIED.warrantyId]
    );
    expect(walked.length).toBe(3);
    expect([...walked].sort()).toEqual(stored.rows.map((row) => row.id).sort());

    // And the walk really did cross the tie, so the `id` tie-break and the
    // microsecond cursor were both load-bearing rather than incidental. Without the
    // tie this case would pass against a millisecond-truncated cursor too.
    expect(new Set(stamps).size).toBeLessThan(stamps.length);
  });

  it('refuses a malformed cursor, an oversized page and a foreign cursor', async () => {
    authAs(WTY_READ_ONLY);
    const badCursor = await readStatusHistory(LEDGER.warrantyId, { cursor: 'not-a-cursor' });
    expect(badCursor.status).toBe(400);
    expect((await problemOf(badCursor)).code).toBe('ERR-PAG-001');

    const oversized = await readStatusHistory(LEDGER.warrantyId, { limit: 5000 });
    expect(oversized.status).toBe(422);
    expect((await problemOf(oversized)).code).toBe('ERR-VAL-001');

    // The ordering contract's key is part of the cursor, so a cursor minted for the
    // DELIVERY ledger — the read this one mirrors field for field — cannot be spent
    // here. That is the pair most likely to be confused by a caller.
    const crossed = await readStatusHistory(LEDGER.warrantyId, {
      cursor: Buffer.from(
        JSON.stringify({
          k: 'sal.delivery_status_history:occurred_at_desc',
          v: '2026-01-01T00:00:00.000000Z',
          i: randomUUID(),
        })
      ).toString('base64url'),
    });
    expect(crossed.status).toBe(400);
    expect((await problemOf(crossed)).code).toBe('ERR-PAG-001');
  });

  it('401 unauthenticated', async () => {
    __resetAuthenticatorForTests();
    expect((await readStatusHistory(LEDGER.warrantyId)).status).toBe(401);
  });

  it('403 ERR-IAM-001 for a caller without wty.warranty.read', async () => {
    // Both counterfactuals: the write code the detail read used to carry, and the
    // administration code it refused to borrow. Neither reaches the ledger.
    for (const principal of [WTY_ISSUE_ONLY, WTY_POLICY_ONLY]) {
      authAs(principal);
      const response = await readStatusHistory(LEDGER.warrantyId);
      expect(response.status, principal.subject).toBe(403);
      const problem = await problemOf(response);
      expect(problem.code, principal.subject).toBe('ERR-IAM-001');
      expect(problem.requiredPermissions, principal.subject).toEqual([WARRANTY_READ]);
      __resetAuthenticatorForTests();
    }
  });
});

describe('P-18 the ledger is refused across a tenant and across a branch', () => {
  it('answers a foreign tenant ERR-RES-001 for a real id and for an invented one', async () => {
    // Not-found is decided BEFORE any scope decision, so a foreign tenant cannot
    // tell a real warranty id from one it made up — and holding the read code makes
    // no difference, which is what separates tenancy from permission here.
    for (const principal of [WTY_READ_TENANT_B, SAL_TENANT_B]) {
      authAs(principal);
      const real = await readStatusHistory(LEDGER.warrantyId);
      expect(real.status).toBe(404);
      expect((await problemOf(real)).code).toBe('ERR-RES-001');

      const invented = await readStatusHistory(randomUUID());
      expect(invented.status).toBe(404);
      expect((await problemOf(invented)).code).toBe('ERR-RES-001');
      __resetAuthenticatorForTests();
    }
  });

  it('404 from RLS in another branch, 403 from authorizeScope when RLS can see the row', async () => {
    // Holds `wty.warranty.read` in A2 only, with no reach into A1: the record is
    // invisible and the answer is an absent resource.
    authAs(WTY_READ_SCOPED_A2);
    const hidden = await readStatusHistory(LEDGER.warrantyId);
    expect(hidden.status).toBe(404);
    expect((await problemOf(hidden)).code).toBe('ERR-RES-001');
    __resetAuthenticatorForTests();

    // The decisive case. This caller holds the code in A2, so the scope-blind
    // pre-handler check passes, and its unrelated widening grant puts BRANCH_A1
    // inside the permission-blind `iam.allowed_branch_ids()` union, so RLS returns
    // the record too. The in-service `authorizeScope` on the record's OWN company
    // and branch is the only guard left, and deleting that call turns this 403 into
    // a 200 that would publish another branch's ledger.
    authAs(WTY_READ_ELSEWHERE);
    const refused = await readStatusHistory(LEDGER.warrantyId);
    expect(refused.status).toBe(403);
    expect((await problemOf(refused)).code).toBe('ERR-IAM-001');
  });
});

// ---------------------------------------------------------------------------
// The branch-optional list and the search box (Owner directive, P1-32-PRE-OD-UX)
// ---------------------------------------------------------------------------

describe('the branch-optional warranty list', () => {
  it('omitting branchId returns the two authorized branches and nothing from the third', async () => {
    // `SAL_PERMISSION_ELSEWHERE` holds the read in BRANCH_A2 and, through this
    // suite's extra scope row, in OD_BRANCH — while its widening grant puts
    // BRANCH_A1 inside the permission-blind allowed-branch union with no
    // authority there. A page built from row-level security alone returns
    // BRANCH_A1's warranties; a page built from a per-branch decision does not.
    authAs(SAL_PERMISSION_ELSEWHERE);
    const response = await listWarranties({ companyId: COMPANY_A1, limit: 100 });
    expect(response.status).toBe(200);
    const rows = (await bodyOf<WarrantyListBody>(response)).items;
    const ids = rows.map((row) => row.id);

    expect(ids).toEqual(expect.arrayContaining([OD_IN_A2.warrantyId, OD_IN_A3.warrantyId]));
    // The assertion that fails if the union comes from the policy.
    expect(ids).not.toContain(FIRST.warrantyId);
    expect(ids).not.toContain(SECOND.warrantyId);
    expect(rows.every((row) => row.branchId === BRANCH_A2 || row.branchId === OD_BRANCH)).toBe(
      true
    );

    // The complement, so the absence above is the narrowing rather than a
    // fixture that never landed.
    authAs(SAL_FULL);
    const everything = await listWarranties({ companyId: COMPANY_A1, limit: 100 });
    expect(everything.status).toBe(200);
    const allIds = (await bodyOf<WarrantyListBody>(everything)).items.map((row) => row.id);
    expect(allIds).toEqual(
      expect.arrayContaining([FIRST.warrantyId, OD_IN_A2.warrantyId, OD_IN_A3.warrantyId])
    );
  });

  it('a branchId the caller holds no read in is still refused', async () => {
    authAs(SAL_PERMISSION_ELSEWHERE);
    const response = await listWarranties({
      companyId: COMPANY_A1,
      branchId: FIRST.delivery.branchId,
    });
    expect(response.status).toBe(403);
    expect((await problemOf(response)).code).toBe('ERR-IAM-001');
  });

  it('a company none of the caller branches belong to is refused, not answered empty', async () => {
    authAs(SAL_PERMISSION_ELSEWHERE);
    const response = await listWarranties({ companyId: COMPANY_A9, limit: 100 });
    // A refusal and not an empty page: an empty page would report that the other
    // company issues no warranties, which is not this caller's to learn.
    expect(response.status).toBe(403);
    expect((await problemOf(response)).code).toBe('ERR-IAM-001');
  });
});

describe('the warranty search box', () => {
  /** The ids on the page for one box, as the full caller in BRANCH_A1. */
  async function search(box: string): Promise<readonly string[]> {
    authAs(SAL_FULL);
    const response = await listWarranties({
      companyId: COMPANY_A1,
      branchId: OD_SEARCHABLE.delivery.branchId,
      limit: 100,
      q: box,
    });
    expect(response.status).toBe(200);
    return (await bodyOf<WarrantyListBody>(response)).items.map((row) => row.id);
  }

  it('finds the warranty by part of the customer name on its work order visit', async () => {
    const ids = await search(OD_SEARCH_NAME.slice(0, 6));
    expect(ids).toContain(OD_SEARCHABLE.warrantyId);
    expect(ids).not.toContain(SECOND.warrantyId);
  });

  it('finds the warranty by a phone tail typed in Arabic-Indic digits', async () => {
    const ids = await search('٥٤٤٣٣٢٢');
    expect(ids).toContain(OD_SEARCHABLE.warrantyId);
    expect(ids).not.toContain(SECOND.warrantyId);
  });

  it('finds the warranty by the plate of the covered vehicle', async () => {
    for (const typed of ['gh5533', 'GH  5533']) {
      const ids = await search(typed);
      expect(ids, typed).toContain(OD_SEARCHABLE.warrantyId);
      expect(ids, typed).not.toContain(SECOND.warrantyId);
    }
  });

  it('returns an empty page for a box nothing matches and refuses a one-character box', async () => {
    expect(await search('zzzznosuchcustomer')).toEqual([]);
    authAs(SAL_FULL);
    expect(
      (
        await listWarranties({
          companyId: COMPANY_A1,
          branchId: OD_SEARCHABLE.delivery.branchId,
          q: 'a',
        })
      ).status
    ).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// The display blocks (Owner directive, P1-32-PRE-OD-UX)
//
// A warranty row named its car by uuid and named its customer not at all, so a
// list of warranties could not be read by the person looking at it. The two blocks
// below close that, and the interesting half is what they REFUSE to say: the
// registration is the vehicle module's to withhold and the name is the CRM
// module's, so each is proved present for a caller holding that module's code and
// absent for a caller holding only the warranty one.
//
// The narrowing cases read ONE arranged warranty — `OD_SEARCHABLE` — whose car
// carries a plate, a VIN, a catalogue make and model and a vehicle number, and
// whose originating visit names a service requester. A fixture missing any of them
// would make an assertion pass by accident, so the fixture is asserted first.
//
// Three further warranties carry the states that are NOT a narrowing and must
// not be reported as one: a car whose row is gone, a visit that names no
// service requester, and a vehicle belonging to another tenant.
// ---------------------------------------------------------------------------

describe('the warranty row names the car and the customer', () => {
  /** One arranged warranty's row off the branch list, as one principal sees it. */
  async function rowFor(
    principal: Principal,
    warranty: ArrangedWarranty = OD_SEARCHABLE
  ): Promise<WarrantyListRow> {
    authAs(principal);
    const response = await listWarranties({
      companyId: COMPANY_A1,
      branchId: warranty.delivery.branchId,
      limit: 100,
    });
    expect(response.status, principal.subject).toBe(200);
    const row = (await bodyOf<WarrantyListBody>(response)).items.find(
      (item) => item.id === warranty.warrantyId
    );
    expect(row, `${principal.subject} could not see the arranged warranty`).toBeDefined();
    __resetAuthenticatorForTests();
    return row!;
  }

  /** The same warranty off the detail read. */
  async function detailFor(
    principal: Principal,
    warranty: ArrangedWarranty = OD_SEARCHABLE
  ): Promise<WarrantyDetailBody> {
    authAs(principal);
    const response = await readWarranty(warranty.warrantyId);
    expect(response.status, principal.subject).toBe(200);
    const body = await bodyOf<WarrantyDetailBody>(response);
    __resetAuthenticatorForTests();
    return body;
  }

  it('the fixture really carries every field the cases below assert', async () => {
    // Anti-vacuity, run first: a plate or a VIN that was never seeded would make
    // every "withheld" assertion below pass while proving nothing at all.
    expect(OD_VIN.length, 'the fixture vehicle has no normalised VIN').toBeGreaterThan(0);
    expect(OD_SEARCH_PLATE.length).toBeGreaterThan(0);
    const seeded = await admin.query<{ display_number: string | null; plate: string | null }>(
      `SELECT v.display_number,
              (SELECT ph.plate_raw FROM veh.plate_history ph
                WHERE ph.tenant_id = v.tenant_id AND ph.vehicle_id = v.id
                  AND ph.valid_to IS NULL LIMIT 1) AS plate
         FROM veh.vehicles v WHERE v.tenant_id = $1 AND v.id = $2`,
      [TENANT_A, OD_SEARCHABLE.delivery.vehicleId]
    );
    expect(seeded.rows[0]?.display_number).toBe(OD_VEHICLE_NUMBER);
    expect(seeded.rows[0]?.plate).toBe(OD_SEARCH_PLATE);
  });

  it('gives a caller holding both codes the whole block, on the list and on the detail', async () => {
    for (const body of [
      await rowFor(WTY_READ_WITH_DISPLAY),
      await detailFor(WTY_READ_WITH_DISPLAY),
    ]) {
      expect(body.vehicle.id).toBe(OD_SEARCHABLE.delivery.vehicleId);
      expect(body.vehicle.plate).toBe(OD_SEARCH_PLATE);
      expect(body.vehicle.vin).toBe(OD_VIN);
      expect(body.vehicle.makeModel).toBe(OD_MAKE_MODEL);
      expect(body.vehicle.displayNumber).toBe(OD_VEHICLE_NUMBER);
      // The identifier stays beside the block, so nothing that navigated by it
      // breaks and nothing has to be reconstructed from a label.
      expect(body.vehicleId).toBe(body.vehicle.id);

      // The visit's earliest service requester, named, WITH its partner id: this
      // caller holds `crm.customer.read`. Two partners hold the role on this
      // visit, but here every plausible rule agrees on the answer, so the
      // tie-break itself is proved by the `OD_TIEBREAK` case below.
      expect(body.customer?.id).toBe(OD_PARTNER_EXPECTED);
      expect(body.customer?.displayName).toBe(OD_CHECKIN_PARTNER_NAME);
    }
  });

  it('withholds the plate and the VIN from a caller without veh.vehicle.read', async () => {
    // The counterfactual of the case above, one code apart. This caller is told
    // WHICH car — the id, the number and the catalogue label — and is not told its
    // registration, which is the vehicle module's to give.
    for (const body of [
      await rowFor(WTY_READ_WITH_CUSTOMER),
      await detailFor(WTY_READ_WITH_CUSTOMER),
    ]) {
      expect(body.vehicle.plate).toBeNull();
      expect(body.vehicle.vin).toBeNull();
      expect(body.vehicle.makeModel).toBe(OD_MAKE_MODEL);
      expect(body.vehicle.displayNumber).toBe(OD_VEHICLE_NUMBER);
      // The narrowing is on the registration and nothing else: the name and the
      // partner id still arrive, because this caller holds the CRM code.
      expect(body.customer?.displayName).toBe(OD_CHECKIN_PARTNER_NAME);
      expect(body.customer?.id).toBe(OD_PARTNER_EXPECTED);
    }
  });

  it('withholds the name AND the partner id from a caller without crm.customer.read', async () => {
    for (const body of [
      await rowFor(WTY_READ_WITH_VEHICLE),
      await detailFor(WTY_READ_WITH_VEHICLE),
    ]) {
      // The warranty HAS a customer and this caller is told so — the block is
      // published — but with neither the name nor the partner id. The id is a
      // CRM identifier exactly as the name is: published to a caller who may
      // not read customers it would let them correlate one customer's
      // warranties. Dropping the block instead would report that the warranty
      // was issued to nobody.
      expect(body.customer).not.toBeNull();
      expect(body.customer).toEqual({ id: null, displayName: null });
      // And the registration still arrives, because this caller holds the vehicle
      // code. The two narrowings are independent.
      expect(body.vehicle.plate).toBe(OD_SEARCH_PLATE);
      expect(body.vehicle.vin).toBe(OD_VIN);
    }
  });

  it('withholds both from a caller holding the warranty code alone', async () => {
    for (const body of [await rowFor(WTY_READ_ONLY), await detailFor(WTY_READ_ONLY)]) {
      expect(body.vehicle.plate).toBeNull();
      expect(body.vehicle.vin).toBeNull();
      expect(body.customer).toEqual({ id: null, displayName: null });
      // Everything the warranty itself says is still published: the blocks narrow,
      // they never turn the read into a partial one.
      expect(body.vehicle.makeModel).toBe(OD_MAKE_MODEL);
      expect(body.id).toBe(OD_SEARCHABLE.warrantyId);
      expect(body.status).toBe('issued');
      expect(body.odometerAtIssue).toMatch(DECIMAL_STRING);
    }
  });

  it('refuses another tenant the record before either display lookup can run', async () => {
    // What this proves, stated exactly: the refusal is decided BEFORE the two
    // blocks are resolved, so no `veh` and no `crm` read happens on behalf of a
    // caller who may not have the record, and no fragment of either reaches the
    // response. The principal holds the vehicle code AND the customer code AND
    // the warranty code in tenant B, so nothing but tenancy can be refusing it,
    // and the refusal is read from the response TEXT so a leak into a field of
    // any shape would fail it.
    //
    // It is NOT a test of the tenant predicate INSIDE those lookups. A request
    // that never reaches them cannot exercise them, and calling this an
    // isolation test would be claiming a guarantee from the wrong evidence. The
    // case below tests that predicate directly.
    //
    // "Before" is measured, not inferred: every statement the refused request
    // sends is recorded, and none of them may be one of the five display
    // statements.
    authAs(WTY_DISPLAY_TENANT_B);
    const detail = await measure(() => readWarranty(OD_SEARCHABLE.warrantyId));
    expect(detail.status).toBe(404);
    const text = detail.text;
    expect(JSON.parse(text).code).toBe('ERR-RES-001');
    for (const secret of [OD_SEARCH_PLATE, OD_VIN, OD_CHECKIN_PARTNER_NAME, OD_VEHICLE_NUMBER]) {
      expect(text, secret).not.toContain(secret);
    }
    // The refused request did reach the database — a zero from a request that
    // sent nothing at all would prove nothing — and sent no display statement.
    expect(detail.statements.length).toBeGreaterThan(0);
    expect(totalOf(displayStatementCounts(detail.statements))).toBe(0);
    __resetAuthenticatorForTests();

    // The positive control for the counter: the same read, by a tenant-A caller
    // holding the same three codes, sends all five. Without it a pattern that had
    // stopped matching would make the zero above pass while proving nothing.
    authAs(WTY_READ_WITH_DISPLAY);
    const allowed = await measure(() => readWarranty(OD_SEARCHABLE.warrantyId));
    expect(allowed.status).toBe(200);
    expect(totalOf(displayStatementCounts(allowed.statements))).toBe(5);
    __resetAuthenticatorForTests();

    // The list side of the same boundary: a company in tenant A is refused rather
    // than answered with an empty page, so the absence above is the tenant
    // boundary and not a warranty that failed to arrange.
    authAs(WTY_DISPLAY_TENANT_B);
    const list = await listWarranties({
      companyId: COMPANY_A1,
      branchId: OD_SEARCHABLE.delivery.branchId,
      limit: 100,
    });
    expect(list.status).toBe(403);
    expect((await problemOf(list)).code).toBe('ERR-IAM-001');
  });

  it('resolves nothing for a vehicle of another tenant, and the same call resolves this one', async () => {
    // The tenant predicate inside the display read itself, exercised where it
    // lives. It is reached through the vehicle module's PUBLIC surface — the
    // same door the warranty service uses — under a real tenant-A transaction,
    // so the session GUCs and row-level security are the ones production runs
    // with rather than a harness approximation.
    const context = buildRequestContext({
      correlationId: randomUUID(),
      principal: { userId: WTY_READ_WITH_DISPLAY.userId, tenantId: TENANT_A },
      operation: WARRANTY_LIST_OPERATION.id,
      module: 'warranty',
    });
    const resolved = await withReadOnlyTransaction(context, (db) =>
      vehicleModule().vehicleRead.resolveDisplayIdentities(db, [
        OD_SEARCHABLE.delivery.vehicleId,
        OD_TENANT_B_VEHICLE,
      ])
    );

    // The positive control FIRST: without it an empty map would prove only that
    // the call is broken, which is the shape of false green this whole file is
    // written against.
    expect(resolved.get(OD_SEARCHABLE.delivery.vehicleId)?.displayNumber).toBe(OD_VEHICLE_NUMBER);
    expect(resolved.get(OD_SEARCHABLE.delivery.vehicleId)?.plate).toBe(OD_SEARCH_PLATE);

    // And the other tenant's car is absent from the map rather than present and
    // blanked: an id this session may not resolve is not an id it holds nothing
    // about, it is an id it does not have.
    expect(resolved.has(OD_TENANT_B_VEHICLE)).toBe(false);

    // Anti-vacuity: that row really exists, so its absence above is the
    // predicate and not a fixture that never landed.
    const other = await admin.query<{ display_number: string | null }>(
      `SELECT display_number FROM veh.vehicles WHERE id = $1 AND tenant_id = $2`,
      [OD_TENANT_B_VEHICLE, TENANT_B]
    );
    expect(other.rows[0]?.display_number).toBe(OD_TENANT_B_NUMBER);
  });

  it('publishes an id-only vehicle block when the car row is gone', async () => {
    // Read by a caller holding EVERY display code, so the nulls below are the
    // missing row and never a withheld field — the two would be
    // indistinguishable for a caller holding neither code, which is exactly why
    // this case uses the one that holds both.
    //
    // The block is published rather than dropped: `vehicle_id` is NOT NULL on
    // the warranty, so the id is always known and only the labels are gone. A
    // response that omitted the block would say the warranty covers no car.
    const expected = {
      id: OD_NO_VEHICLE.delivery.vehicleId,
      plate: null,
      vin: null,
      makeModel: null,
      displayNumber: null,
    };
    for (const body of [
      await rowFor(WTY_READ_WITH_DISPLAY, OD_NO_VEHICLE),
      await detailFor(WTY_READ_WITH_DISPLAY, OD_NO_VEHICLE),
    ]) {
      expect(body.vehicle).toEqual(expected);
      // The rest of the record is untouched: an unresolvable car does not make
      // the row a partial answer.
      expect(body.id).toBe(OD_NO_VEHICLE.warrantyId);
      expect(body.vehicleId).toBe(OD_NO_VEHICLE.delivery.vehicleId);
      expect(body.status).toBe('issued');
    }

    // Anti-vacuity: the row is soft-deleted rather than absent, and the same
    // caller resolves a car that is not.
    const gone = await admin.query<{ deleted_at: Date | null }>(
      `SELECT deleted_at FROM veh.vehicles WHERE tenant_id = $1 AND id = $2`,
      [TENANT_A, OD_NO_VEHICLE.delivery.vehicleId]
    );
    expect(gone.rowCount).toBe(1);
    expect(gone.rows[0]?.deleted_at).not.toBeNull();
    expect((await rowFor(WTY_READ_WITH_DISPLAY)).vehicle.displayNumber).toBe(OD_VEHICLE_NUMBER);
  });

  it('publishes no customer at all when the visit names no service requester', async () => {
    // The whole block is null, not a block with null fields. The two mean
    // different things and a screen says different words for them: a block
    // whose id and name are both null is "there is a customer and you may not
    // be told who", a null BLOCK is "this warranty names nobody".
    for (const body of [
      await rowFor(WTY_READ_WITH_DISPLAY, OD_NO_PARTY),
      await detailFor(WTY_READ_WITH_DISPLAY, OD_NO_PARTY),
    ]) {
      expect(body.customer).toBeNull();
      // The car still arrives, so a missing customer is not a page whose
      // resolution failed.
      expect(body.vehicle.id).toBe(OD_NO_PARTY.delivery.vehicleId);
      expect(body.id).toBe(OD_NO_PARTY.warrantyId);
    }

    // Anti-vacuity, both halves: the role EXISTED and is dated out, so this is a
    // corrected visit rather than one the fixture failed to populate — and the
    // same caller is still told the customer of a visit that has one.
    const roles = await admin.query<{ open: string; closed: string }>(
      `SELECT count(*) FILTER (WHERE valid_to IS NULL)::text AS open,
              count(*) FILTER (WHERE valid_to IS NOT NULL)::text AS closed
         FROM rec.reception_party_roles
        WHERE tenant_id = $1 AND reception_visit_id = $2
          AND relationship_role = $3 AND deleted_at IS NULL`,
      [TENANT_A, OD_NO_PARTY.delivery.visitId, 'service_requester']
    );
    expect(roles.rows[0]?.open).toBe('0');
    expect(roles.rows[0]?.closed).toBe('1');
    expect((await rowFor(WTY_READ_WITH_DISPLAY)).customer?.id).toBe(OD_PARTNER_EXPECTED);
  });
});

describe('the customer block names the earliest requester, by that rule alone', () => {
  it('picks the earliest valid_from even when it was neither recorded first nor has the lowest id', async () => {
    // Anti-vacuity FIRST: the fixture really separates the candidate rules. If
    // the earliest `valid_from` were also the first recorded or the lowest id,
    // an unordered or id-ordered read would pass this case by accident — which
    // is exactly what the `OD_SEARCHABLE` visit could not rule out.
    const roles = await admin.query<{
      partner_id: string;
      by_valid_from: string;
      by_recorded: string;
      by_id: string;
    }>(
      `SELECT partner_id::text,
              row_number() OVER (ORDER BY valid_from ASC)::text AS by_valid_from,
              row_number() OVER (ORDER BY created_at ASC)::text AS by_recorded,
              row_number() OVER (ORDER BY partner_id ASC)::text AS by_id
         FROM rec.reception_party_roles
        WHERE tenant_id = $1 AND reception_visit_id = $2 AND relationship_role = $3
          AND valid_to IS NULL AND deleted_at IS NULL`,
      [TENANT_A, OD_TIEBREAK.delivery.visitId, SERVICE_REQUESTER]
    );
    expect(roles.rowCount).toBe(3);
    const earliest = roles.rows.find((row) => row.by_valid_from === '1');
    expect(earliest?.partner_id).toBe(OD_TIE_EARLIEST);
    // Neither the first nor the last recorded, neither the lowest nor the highest id.
    expect(earliest?.by_recorded).toBe('2');
    expect(earliest?.by_id).toBe('2');

    authAs(WTY_READ_WITH_DISPLAY);
    const list = await listWarranties({
      companyId: COMPANY_A1,
      branchId: OD_TIEBREAK.delivery.branchId,
      limit: 100,
    });
    expect(list.status).toBe(200);
    const row = (await bodyOf<WarrantyListBody>(list)).items.find(
      (item) => item.id === OD_TIEBREAK.warrantyId
    );
    __resetAuthenticatorForTests();
    authAs(WTY_READ_WITH_DISPLAY);
    const detail = await readWarranty(OD_TIEBREAK.warrantyId);
    expect(detail.status).toBe(200);
    const body = await bodyOf<WarrantyDetailBody>(detail);

    for (const answer of [row, body]) {
      expect(answer?.customer).toEqual({ id: OD_TIE_EARLIEST, displayName: OD_TIE_EARLIEST_NAME });
    }
  });
});

describe('the partner-id lookup behind the customer block', () => {
  const repository = new WarrantyRepository();

  /**
   * `findCustomerPartnerIds` run directly, on the runtime pool, as one principal.
   *
   * Under a real read-only transaction, so the session settings and row-level
   * security are the ones production runs with, exactly as the vehicle lookup's
   * tenant case above runs its own read.
   *
   * `scope` is the company and branch set the request context carries into
   * `app.company_ids` / `app.branch_ids`, which is what `iam.allowed_branch_ids()`
   * reads. It is omitted for an unrestricted caller, and for a scoped one it is
   * the set that caller's single scoped grant resolves to.
   */
  function lookUp(
    principal: Principal,
    workOrderIds: readonly string[],
    scope?: { readonly companyIds: readonly string[]; readonly branchIds: readonly string[] }
  ): Promise<ReadonlyMap<string, string>> {
    const context = buildRequestContext({
      correlationId: randomUUID(),
      principal: { userId: principal.userId, tenantId: principal.tenantId },
      ...(scope === undefined ? {} : { companyIds: scope.companyIds, branchIds: scope.branchIds }),
      operation: WARRANTY_LIST_OPERATION.id,
      module: 'warranty',
    });
    return withReadOnlyTransaction(context, (db) =>
      repository.findCustomerPartnerIds(db, workOrderIds, SERVICE_REQUESTER)
    );
  }

  it('never answers for another tenant, and each tenant still answers for its own', async () => {
    // Anti-vacuity: the tenant-B work order's visit really names a requester, so
    // its absence below is the predicate and not an empty visit.
    const other = await admin.query<{ partner_id: string }>(
      `SELECT r.partner_id::text
         FROM wo.work_orders w
         JOIN rec.reception_party_roles r
           ON r.tenant_id = w.tenant_id AND r.reception_visit_id = w.reception_visit_id
        WHERE w.tenant_id = $1 AND w.id = $2 AND r.relationship_role = $3
          AND r.valid_to IS NULL AND r.deleted_at IS NULL`,
      [TENANT_B, OD_TENANT_B_WORK_ORDER, SERVICE_REQUESTER]
    );
    expect(other.rowCount).toBeGreaterThan(0);

    const both = [OD_SEARCHABLE.delivery.workOrderId, OD_TENANT_B_WORK_ORDER];

    // Tenant A: its own work order answers (the positive control), tenant B's
    // does not.
    const fromA = await lookUp(WTY_READ_WITH_DISPLAY, both);
    expect(fromA.get(OD_SEARCHABLE.delivery.workOrderId)).toBe(OD_PARTNER_EXPECTED);
    expect(fromA.has(OD_TENANT_B_WORK_ORDER)).toBe(false);
    expect(fromA.size).toBe(1);

    // And the mirror image, so the tenant-B row is shown to be resolvable at all:
    // the same call under tenant B answers for its own work order and not A's.
    const fromB = await lookUp(WTY_DISPLAY_TENANT_B, both);
    expect(fromB.get(OD_TENANT_B_WORK_ORDER)).toBe(other.rows[0]?.partner_id);
    expect(fromB.has(OD_SEARCHABLE.delivery.workOrderId)).toBe(false);
    expect(fromB.size).toBe(1);
  });

  it('never answers for a branch row-level security hides from a branch-narrowed caller', async () => {
    const both = [FIRST.delivery.workOrderId, OD_IN_A2.delivery.workOrderId];

    // The positive control: an unrestricted caller in the same tenant is told
    // the requester of both, so both work orders do name one.
    const unrestricted = await lookUp(WTY_READ_WITH_DISPLAY, both);
    expect(unrestricted.has(FIRST.delivery.workOrderId)).toBe(true);
    expect(unrestricted.has(OD_IN_A2.delivery.workOrderId)).toBe(true);

    // Scoped to BRANCH_A2 alone: the A2 work order answers, the A1 one does not.
    // The method takes no branch argument, so this is row-level security doing
    // the narrowing, and the case fails if the statement ever stops running
    // under it (a table owner or a bypassing role would answer for both).
    const narrowed = await lookUp(WTY_READ_SCOPED_A2, both, {
      companyIds: [COMPANY_A1],
      branchIds: [BRANCH_A2],
    });
    expect(narrowed.has(OD_IN_A2.delivery.workOrderId)).toBe(true);
    expect(narrowed.has(FIRST.delivery.workOrderId)).toBe(false);
    expect(narrowed.size).toBe(1);
  });
});

describe('the display blocks cost the same few statements for one row as for a page', () => {
  /** One branch list page, measured, as one principal. */
  async function measuredPage(principal: Principal, limit: number): Promise<Measured> {
    // The list carries the `expensive-read` bucket; this case makes several
    // calls in a row and must not be measuring a 429.
    __resetRateLimitForTests();
    authAs(principal);
    try {
      return await measure(() =>
        listWarranties({ companyId: COMPANY_A1, branchId: BRANCH_A1, limit })
      );
    } finally {
      __resetAuthenticatorForTests();
    }
  }

  const rowsOf = (measured: Measured): readonly WarrantyListRow[] =>
    (JSON.parse(measured.text) as WarrantyListBody).items;

  it('sends at most five display statements for a page of one and a page of many, and the same number for both', async () => {
    for (const [principal, expected] of [
      // Both codes: every one of the five, exactly once.
      [
        WTY_READ_WITH_DISPLAY,
        {
          vehicleCapability: 1,
          vehicleIdentities: 1,
          partnerIds: 1,
          customerCapability: 1,
          customerNames: 1,
        },
      ],
      // The warranty code alone: the CRM read stops after its capability question.
      [
        WTY_READ_ONLY,
        {
          vehicleCapability: 1,
          vehicleIdentities: 1,
          partnerIds: 1,
          customerCapability: 1,
          customerNames: 0,
        },
      ],
    ] as const) {
      // Warm first, so both measurements are of reused connections: a cold pool
      // client sends set-up statements a warm one does not, which would read as
      // a page that got cheaper as it grew.
      await measuredPage(principal, 1);
      await measuredPage(principal, 100);

      const one = await measuredPage(principal, 1);
      const many = await measuredPage(principal, 100);
      expect(one.status, principal.subject).toBe(200);
      expect(many.status, principal.subject).toBe(200);

      // Anti-vacuity: the large page really is large and really is varied — one
      // car per arranged warranty and, for the caller who may be told them, more
      // than one customer — so a per-row lookup would have shown up.
      const oneRows = rowsOf(one);
      const manyRows = rowsOf(many);
      expect(oneRows).toHaveLength(1);
      expect(manyRows.length).toBeGreaterThanOrEqual(8);
      expect(new Set(manyRows.map((row) => row.vehicle.id)).size).toBeGreaterThanOrEqual(8);
      if (principal === WTY_READ_WITH_DISPLAY) {
        const customers = new Set(
          manyRows.map((row) => row.customer?.id).filter((id) => typeof id === 'string')
        );
        expect(customers.size).toBeGreaterThanOrEqual(2);
      }

      const oneCounts = displayStatementCounts(one.statements);
      const manyCounts = displayStatementCounts(many.statements);
      expect(oneCounts, principal.subject).toEqual(expected);
      expect(manyCounts, principal.subject).toEqual(expected);
      expect(totalOf(manyCounts)).toBeLessThanOrEqual(5);
      // And the whole request, not only the display part, costs the same for
      // one row as for many: an N+1 anywhere on the page fails here.
      expect(many.statements.length, principal.subject).toBe(one.statements.length);
    }
  });

  it('the detail read uses the same bounded assembly', async () => {
    authAs(WTY_READ_WITH_DISPLAY);
    const detail = await measure(() => readWarranty(OD_SEARCHABLE.warrantyId));
    __resetAuthenticatorForTests();
    expect(detail.status).toBe(200);
    expect(displayStatementCounts(detail.statements)).toEqual({
      vehicleCapability: 1,
      vehicleIdentities: 1,
      partnerIds: 1,
      customerCapability: 1,
      customerNames: 1,
    });
  });
});
