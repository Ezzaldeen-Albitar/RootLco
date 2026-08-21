/**
 * Warranty generation and reads (Phase 1-22 — P1-22-BE-018).
 *
 * Two operations, and the shorter list is the more important one: this surface
 * GENERATES warranty records from a committed handover and READS them back. It does
 * not intake, assess, adjudicate or reimburse a claim, and the last test in this file
 * asserts that structurally rather than trusting a comment (`P1-22-L-01`).
 *
 * ## What the assertions rest on
 *
 * A 201 proves a row was written. What proves the RIGHT row was written is the
 * arithmetic: `start_date` is the delivery's own calendar day, `expiry_date` is that
 * day plus the coverage's `duration_months`, and `odometer_limit` on the RECORD is
 * ABSOLUTE — the reading captured at handover PLUS the coverage's RELATIVE allowance.
 * The two `odometer_limit` columns are identically named in two tables and confusing
 * them yields a warranty whose limit is either the allowance alone or double-counted,
 * and `ck_warranty_records_odometer` (`limit >= at_issue`) would catch neither. Every
 * expected term is therefore derived by PostgreSQL from the fixture rows rather than
 * hard-coded or computed in JavaScript: a one-day drift in a contractual date is a
 * wrong document, not a rounding detail.
 *
 * Every count assertion is a DELTA. The fixtures write real audit and outbox rows of
 * their own, so an absolute tenant-wide total would be measuring arrangement.
 *
 * COVERAGE-EVIDENCE (P1-22 warranty):
 *   wty.warranty-generate: route service authorization success denial audit outbox idempotency isolation cross-tenant
 *   wty.warranty-detail: route service authorization success denial isolation cross-tenant
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
} from './helpers';
import { establishP1_19Fixtures } from './p1-19-helpers';
import {
  BRANCH_A9,
  COMPANY_A9,
  COVERAGE_ACTIVE,
  COVERAGE_DURATION_MONTHS,
  COVERAGE_ODOMETER_ALLOWANCE,
  DELIVERY_ODOMETER,
  POLICY_ACTIVE,
  POLICY_ACTIVE_CODE,
  POLICY_ARCHIVED,
  POLICY_ARCHIVED_CODE,
  POLICY_NO_COVERAGE,
  SAL_COMPANY_SCOPED,
  SAL_FULL,
  SAL_PERMISSION_ELSEWHERE,
  SAL_READER,
  SAL_TENANT_B,
  auditCountFor,
  authAs,
  cleanP1_22Fixtures,
  countRowsOf,
  establishP1_22Fixtures,
  expectedWarrantyTerms,
  outboxCountFor,
  seedDeliveredDelivery,
  seedReadyDelivery,
} from './p1-22-helpers';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { allOperations } from '@/server/auth/operation-registry';
import { WarrantyRuleError, assertPolicyActive } from '@/modules/warranty';
import { POST as GENERATE_WARRANTY } from '@/app/api/v1/deliveries/[deliveryId]/warranties/route';
import { GET as READ_WARRANTY } from '@/app/api/v1/warranties/[warrantyId]/route';
import { API_ROOT } from '../../scripts/lib/repository-paths.mjs';

let admin: Pool;

interface WarrantyBody {
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
  readonly policy: { readonly id: string; readonly policyCode: string; readonly status: string };
  readonly coverage: {
    readonly id: string;
    readonly coveredScope: string;
    readonly durationMonths: number;
    readonly odometerAllowance: string | null;
  };
  readonly items: readonly { readonly id: string; readonly itemKind: string }[];
  readonly replayed: boolean;
}

interface ProblemBody {
  readonly code: string;
  readonly status: number;
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

/** `wty.warranty-generate` declares `idempotent: true`, so the header is mandatory. */
const generateWarranty = (
  deliveryId: string,
  body: unknown = {},
  key: string = randomUUID()
): Promise<Response> =>
  GENERATE_WARRANTY(
    new Request(`http://localhost/api/v1/deliveries/${deliveryId}/warranties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ deliveryId }) }
  );

const readWarranty = (warrantyId: string): Promise<Response> =>
  READ_WARRANTY(new Request(`http://localhost/api/v1/warranties/${warrantyId}`), {
    params: Promise.resolve({ warrantyId }),
  });

const auditTotalFor = (action: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM iam.audit_records WHERE action = $1`, [action]);

const outboxTotalFor = (eventType: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM shared.event_outbox WHERE event_type = $1`, [
    eventType,
  ]);

const warrantyRowsFor = (deliveryId: string): Promise<number> =>
  countRowsOf(
    `SELECT count(*)::text AS n FROM wty.warranty_records WHERE delivery_record_id = $1`,
    [deliveryId]
  );

/** Generates a warranty as `SAL_FULL`, failing loudly if the arrangement breaks. */
async function issuedWarranty(deliveryId: string): Promise<WarrantyBody> {
  authAs(SAL_FULL);
  const response = await generateWarranty(deliveryId, { policyId: POLICY_ACTIVE });
  if (response.status !== 201) {
    throw new Error(
      `fixture warranty for delivery ${deliveryId} failed with ${response.status}: ` +
        `${await response.text()}`
    );
  }
  return bodyOf<WarrantyBody>(response);
}

/**
 * Removes every comment, leaving only executable code.
 *
 * A single pass that tracks the three string contexts, so a `//` inside a quoted
 * string is not mistaken for a comment opener. The three files scanned below contain
 * no regex literal, and the structural test asserts a known code token survives the
 * strip — without that check a stripper that deleted everything would make the
 * "contains no claim" assertion vacuously true, which is the exact failure mode this
 * kind of test is prone to.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const character = source[i];
    const next = source[i + 1];
    if (character === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      out += ' ';
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      out += character;
      i += 1;
      while (i < source.length) {
        if (source[i] === '\\') {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === character) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += character;
    i += 1;
  }
  return out;
}

/** Every key in a JSON value, at any depth. */
function keysOf(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) keysOf(entry, into);
    return into;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      keysOf(child, into);
    }
  }
  return into;
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_22Fixtures(admin);
}, 180_000);

afterAll(async () => {
  await cleanP1_22Fixtures();
  await cleanBackendFixtures(admin);
  await admin.end();
});

afterEach(() => {
  __resetAuthenticatorForTests();
});

describe('wty.warranty-generate', () => {
  it('TC-P1-22-007 dates the warranty from the handover and makes the odometer limit absolute (success)', async () => {
    const delivery = await seedDeliveredDelivery('wty_success');
    expect(delivery.status).toBe('delivered');
    // Every expected term is derived by PostgreSQL from the delivery and the coverage
    // the record will cite — not restated here, and never computed in JavaScript.
    const expected = await expectedWarrantyTerms(delivery.deliveryId, COVERAGE_ACTIVE);

    authAs(SAL_FULL);
    const response = await generateWarranty(delivery.deliveryId, { policyId: POLICY_ACTIVE });
    expect(response.status).toBe(201);
    const warranty = await bodyOf<WarrantyBody>(response);

    expect(warranty.deliveryRecordId).toBe(delivery.deliveryId);
    expect(warranty.vehicleId).toBe(delivery.vehicleId);
    expect(warranty.workOrderId).toBe(delivery.workOrderId);
    // The only status this phase can create. `'claimed_against'` is in
    // `ck_warranty_records_status` and is unreachable from here by construction.
    expect(warranty.status).toBe('issued');
    expect(warranty.replayed).toBe(false);

    // The start date is the delivery's own calendar day, resolved on the database's
    // clock — the module deliberately passes `delivered_at` through unconverted so a
    // Node-side timezone cannot move the day.
    expect(warranty.startDate).toBe(expected.startDate);
    expect(warranty.startDate).toBe(delivery.deliveredOn);
    // ...and the expiry is that day plus the coverage's own duration.
    expect(warranty.expiryDate).toBe(expected.expiryDate);
    expect(warranty.coverage.durationMonths).toBe(COVERAGE_DURATION_MONTHS);

    // The odometer arithmetic, which is the assertion this test exists for. The
    // coverage's limit is RELATIVE (an allowance) and the record's is ABSOLUTE (the
    // reading at which cover lapses).
    expect(warranty.odometerAtIssue).toBe(DELIVERY_ODOMETER);
    expect(warranty.coverage.odometerAllowance).toBe(COVERAGE_ODOMETER_ALLOWANCE);
    expect(warranty.odometerLimit).toBe(expected.odometerLimit);
    // Stated independently of the SQL derivation, so both would have to be wrong the
    // same way for this to pass: 100000 at issue + a 20000 allowance = 120000.
    expect(warranty.odometerLimit).toBe('120000');
    expect(warranty.odometerLimit).not.toBe(COVERAGE_ODOMETER_ALLOWANCE);

    expect(warranty.policy.id).toBe(POLICY_ACTIVE);
    expect(warranty.policy.policyCode).toBe(POLICY_ACTIVE_CODE);
    expect(warranty.coverage.id).toBe(COVERAGE_ACTIVE);
    expect(warranty.coverage.coveredScope).toBe('all');
    // The work order created by reception's conversion carries no service line and no
    // required part, so a coverage of 'all' covers nothing on it. An empty item list is
    // a real outcome rather than a failure: listing lines the coverage does not pay for
    // would be worse.
    expect(warranty.items).toHaveLength(0);

    // One record, and the genesis history row the primitive writes in the same
    // statement.
    expect(await warrantyRowsFor(delivery.deliveryId)).toBe(1);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM wty.warranty_status_history
          WHERE warranty_record_id = $1 AND to_status = 'issued'`,
        [warranty.id]
      )
    ).toBe(1);
  });

  it('writes exactly one audit record and exactly one event (audit, outbox)', async () => {
    const delivery = await seedDeliveredDelivery('wty_evidence');
    const auditBefore = await auditTotalFor('wty.warranty.issued');
    const outboxBefore = await outboxTotalFor('warranty.issued');

    const warranty = await issuedWarranty(delivery.deliveryId);

    // DELTAS, because the fixture path itself writes audit and outbox rows.
    expect((await auditTotalFor('wty.warranty.issued')) - auditBefore).toBe(1);
    expect((await outboxTotalFor('warranty.issued')) - outboxBefore).toBe(1);
    // And the rows that moved belong to THIS record.
    expect(await auditCountFor('wty.warranty.issued', warranty.id)).toBe(1);
    expect(await outboxCountFor(`warranty.issued:${warranty.id}`)).toBe(1);
  });

  it('replays an idempotency key without issuing a second warranty (idempotency)', async () => {
    const delivery = await seedDeliveredDelivery('wty_replay');
    const key = randomUUID();
    const payload = { policyId: POLICY_ACTIVE };
    const auditBefore = await auditTotalFor('wty.warranty.issued');
    const outboxBefore = await outboxTotalFor('warranty.issued');

    authAs(SAL_FULL);
    const first = await generateWarranty(delivery.deliveryId, payload, key);
    expect(first.status).toBe(201);
    const original = await bodyOf<WarrantyBody>(first);

    authAs(SAL_FULL);
    const replay = await generateWarranty(delivery.deliveryId, payload, key);
    // 200 rather than 201, and the SAME record — a retrying client can tell it did not
    // issue a second warranty on the same handover.
    expect(replay.status).toBe(200);
    const replayed = await bodyOf<WarrantyBody>(replay);
    expect(replayed.id).toBe(original.id);
    expect(replayed.startDate).toBe(original.startDate);
    expect(replayed.expiryDate).toBe(original.expiryDate);

    // One record, one audit row, one event. A replay that produced a second audit row
    // would claim two warranties had been issued.
    expect(await warrantyRowsFor(delivery.deliveryId)).toBe(1);
    expect((await auditTotalFor('wty.warranty.issued')) - auditBefore).toBe(1);
    expect((await outboxTotalFor('warranty.issued')) - outboxBefore).toBe(1);
    expect(await auditCountFor('wty.warranty.issued', original.id)).toBe(1);
  });

  it('refuses the same idempotency key with a different policy (denial)', async () => {
    const delivery = await seedDeliveredDelivery('wty_key_conflict');
    const key = randomUUID();

    authAs(SAL_FULL);
    expect(
      (await generateWarranty(delivery.deliveryId, { policyId: POLICY_ACTIVE }, key)).status
    ).toBe(201);

    authAs(SAL_FULL);
    const conflicting = await generateWarranty(
      delivery.deliveryId,
      { policyId: POLICY_NO_COVERAGE },
      key
    );
    // A stable conflict rather than a silent replay of the first policy's warranty: the
    // key already issued a warranty under a DIFFERENT policy, and a warranty's policy
    // is its duration and its odometer allowance.
    expect(conflicting.status).toBe(409);
    expect((await bodyOf<ProblemBody>(conflicting)).code).toBe('ERR-INT-001');
    expect(await warrantyRowsFor(delivery.deliveryId)).toBe(1);
  });

  it('refuses a delivery that is not delivered (denial)', async () => {
    const delivery = await seedReadyDelivery('wty_not_delivered');
    expect(delivery.status).toBe('ready');
    // Not delivered means no `delivered_at` and no final odometer reading, so there is
    // nothing to date the warranty from and nothing to bind its limit to.
    expect(delivery.deliveredOn).toBeNull();
    expect(delivery.finalOdometerReadingId).toBeNull();

    authAs(SAL_FULL);
    const response = await generateWarranty(delivery.deliveryId, { policyId: POLICY_ACTIVE });
    // A controlled state refusal, not the bare `check_violation`
    // `wty.guard_warranty_record_coherence` would raise from inside the INSERT.
    expect(response.status).toBe(409);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-TRN-001');
    expect(await warrantyRowsFor(delivery.deliveryId)).toBe(0);
  });

  it('refuses an ARCHIVED policy that still carries active coverage (denial)', async () => {
    const delivery = await seedDeliveredDelivery('wty_archived_policy');

    authAs(SAL_FULL);
    const response = await generateWarranty(delivery.deliveryId, { policyId: POLICY_ARCHIVED });
    expect(response.status).toBe(409);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-TRN-001');
    expect(await warrantyRowsFor(delivery.deliveryId)).toBe(0);

    // The fixture is the state the DATABASE would happily issue against: the policy is
    // archived and its coverage row is still ACTIVE, and `wty.issue_warranty` filters
    // coverage on `status = 'active'` while never looking at
    // `wty.warranty_policies.status` at all.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM wty.warranty_coverage c
           JOIN wty.warranty_policies p ON p.id = c.policy_id
          WHERE c.policy_id = $1 AND c.status = 'active' AND p.status = 'archived'`,
        [POLICY_ARCHIVED]
      )
    ).toBe(1);

    // So the application is the ONLY defence, and the refusal says so. The message is
    // asserted on the domain rule directly, because a problem document carries the
    // catalog title rather than the failure's message — the reason has to be pinned
    // where it is written or it can be edited away silently.
    let refusal: unknown;
    try {
      assertPolicyActive('archived', POLICY_ARCHIVED_CODE);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(WarrantyRuleError);
    expect((refusal as Error).message).toContain(POLICY_ARCHIVED_CODE);
    expect((refusal as Error).message).toContain(
      'wty.issue_warranty checks the coverage status but not the policy status'
    );
  });

  it('refuses a policy with no coverage effective at the delivery date (denial)', async () => {
    const delivery = await seedDeliveredDelivery('wty_no_coverage');
    // The fixture policy is ACTIVE and has no coverage row at all, so this is a
    // configuration gap and not a state conflict: nothing the caller can send fixes it,
    // and the backend must not invent a duration to proceed.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM wty.warranty_coverage WHERE policy_id = $1`,
        [POLICY_NO_COVERAGE]
      )
    ).toBe(0);

    authAs(SAL_FULL);
    const response = await generateWarranty(delivery.deliveryId, {
      policyId: POLICY_NO_COVERAGE,
    });
    expect(response.status).toBe(404);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-RES-001');
    // The decisive assertion: NO warranty row was created, so no customer holds a
    // record with a duration nobody configured.
    expect(await warrantyRowsFor(delivery.deliveryId)).toBe(0);
  });

  it('refuses to infer a policy when the company has more than one active (denial)', async () => {
    const delivery = await seedDeliveredDelivery('wty_ambiguous_policy');
    authAs(SAL_FULL);
    const response = await generateWarranty(delivery.deliveryId, {});
    // Guessing "the newest" or "the first alphabetically" would silently bind a
    // customer to a duration nobody chose, so the caller must name the policy.
    expect(response.status).toBe(422);
    const problem = await bodyOf<ProblemBody>(response);
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations?.[0]?.path).toBe('body.policyId');
    expect(await warrantyRowsFor(delivery.deliveryId)).toBe(0);
  });

  it('refuses a caller lacking wty.warranty.issue (authorization)', async () => {
    const delivery = await seedDeliveredDelivery('wty_authz');
    authAs(SAL_READER);
    const response = await generateWarranty(delivery.deliveryId, { policyId: POLICY_ACTIVE });
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');
    expect(await warrantyRowsFor(delivery.deliveryId)).toBe(0);
  });

  it('refuses a branch the caller holds no warranty permission in (isolation)', async () => {
    const delivery = await seedDeliveredDelivery('wty_isolation');
    // BRANCH_A1 IS inside this principal's permission-blind `iam.allowed_branch_ids()`
    // union, because a SECOND grant carrying only `org.tenant.read` names it — so the
    // delivery is visible, RLS cannot answer 404, and the only thing that can refuse
    // this is the scoped permission evaluation against the delivery's own company and
    // branch (P1-18-A-01).
    authAs(SAL_PERMISSION_ELSEWHERE);
    const response = await generateWarranty(delivery.deliveryId, { policyId: POLICY_ACTIVE });
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');
    expect(await warrantyRowsFor(delivery.deliveryId)).toBe(0);
  });

  it('refuses a COMPANY-scoped caller acting in the other company (isolation, H6)', async () => {
    // The company-scope half of H6. This caller holds its warranty authority
    // COMPANY-scoped to COMPANY_A1 and holds only an unrelated permission BRANCH-scoped
    // to BRANCH_A9, so the A9 delivery is fully VISIBLE to it — A9 is in its company
    // union and its branch union — and `iam.has_permission_in_scope` still refuses,
    // because the company half names A1 and the branch half's grant carries no
    // `wty.warranty.issue`. A 403 rather than a 404 is what proves the scoped
    // permission check did the refusing.
    //
    // The INCOHERENT `(company, branch)` pair itself is not expressible on either
    // warranty route: both are addressed by id and read the pair off the row, so the
    // caller never names it. `POST /payments` is the one P1-22 operation where the pair
    // is caller-supplied, and the H6 pair assertion lives there
    // (`tests/backend/p1-22-payments.test.ts`).
    const delivery = await seedDeliveredDelivery('wty_h6', {
      companyId: COMPANY_A9,
      branchId: BRANCH_A9,
    });
    expect(delivery.companyId).toBe(COMPANY_A9);
    expect(delivery.branchId).toBe(BRANCH_A9);

    authAs(SAL_COMPANY_SCOPED);
    const response = await generateWarranty(delivery.deliveryId, { policyId: POLICY_ACTIVE });
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');
    expect(await warrantyRowsFor(delivery.deliveryId)).toBe(0);
  });

  it('cannot reach a tenant-A delivery from tenant B (cross-tenant)', async () => {
    const delivery = await seedDeliveredDelivery('wty_generate_cross_tenant');
    authAs(SAL_TENANT_B);
    // Tenant B holds `wty.warranty.issue` unrestricted IN ITS OWN TENANT, so this
    // refusal is the tenant boundary rather than a missing grant.
    const response = await generateWarranty(delivery.deliveryId, { policyId: POLICY_ACTIVE });
    expect(response.status).toBe(404);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-RES-001');
    expect(await warrantyRowsFor(delivery.deliveryId)).toBe(0);
  });
});

describe('wty.warranty-detail', () => {
  it('returns the record, its coverage terms and NO monetary field (success)', async () => {
    const delivery = await seedDeliveredDelivery('wty_detail');
    const issued = await issuedWarranty(delivery.deliveryId);

    authAs(SAL_FULL);
    const response = await readWarranty(issued.id);
    expect(response.status).toBe(200);
    const raw: unknown = await response.json();
    const warranty = raw as WarrantyBody;

    expect(warranty.id).toBe(issued.id);
    expect(warranty.deliveryRecordId).toBe(delivery.deliveryId);
    expect(warranty.status).toBe('issued');
    expect(warranty.startDate).toBe(issued.startDate);
    expect(warranty.expiryDate).toBe(issued.expiryDate);
    expect(warranty.odometerLimit).toBe(issued.odometerLimit);
    expect(warranty.policy.policyCode).toBe(POLICY_ACTIVE_CODE);
    expect(warranty.coverage.id).toBe(COVERAGE_ACTIVE);
    expect(Array.isArray(warranty.items)).toBe(true);

    // No monetary field of ANY kind, at any depth. `wty` has 80 columns and not one is
    // an amount, a currency or a cap in a unit of account — so a money field here
    // could only have been fabricated, and a caller would reasonably treat it as
    // authoritative.
    const keys = keysOf(raw);
    // The scan has to be able to see something, or the assertion below is vacuous.
    expect(keys.has('odometerLimit')).toBe(true);
    expect(keys.size).toBeGreaterThan(10);
    const monetary = [...keys].filter((key) => /amount|currency|price|cost|value/i.test(key));
    expect(monetary).toEqual([]);
  });

  it('refuses a malformed warranty id before reading anything (denial)', async () => {
    authAs(SAL_FULL);
    const response = await readWarranty('not-a-uuid');
    // The path schema is `schemas.uuid`, parsed INSIDE the handler, so this is the
    // operation's own validation refusal. A non-uuid reaching the repository would be a
    // `22P02` from PostgreSQL, which the error catalog has no honest mapping for.
    expect(response.status).toBe(422);
    const problem = await bodyOf<ProblemBody>(response);
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations?.[0]?.path).toBe('path.warrantyId');
  });

  it('refuses a caller lacking wty.warranty.issue (authorization)', async () => {
    const delivery = await seedDeliveredDelivery('wty_detail_authz');
    const issued = await issuedWarranty(delivery.deliveryId);
    // The catalogue contains no `wty.warranty.read`, so the read reuses the issue
    // authority rather than borrowing `wty.policy.manage` — which would hand coverage
    // administration to a caller who only needs to look at a record.
    authAs(SAL_READER);
    const response = await readWarranty(issued.id);
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');
  });

  it('refuses a caller scoped to another branch although the row is visible (isolation)', async () => {
    const delivery = await seedDeliveredDelivery('wty_detail_isolation');
    const issued = await issuedWarranty(delivery.deliveryId);

    authAs(SAL_PERMISSION_ELSEWHERE);
    const response = await readWarranty(issued.id);
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');

    // The record really is inside that caller's permission-blind branch union, so the
    // 403 above is the scoped permission check and not a 404 wearing a different code.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM wty.warranty_records
          WHERE id = $1 AND branch_id = ANY(
            SELECT s.branch_id FROM iam.grant_scopes s
              JOIN iam.role_grants g ON g.tenant_id = s.tenant_id AND g.id = s.grant_id
             WHERE g.user_id = $2 AND s.branch_id IS NOT NULL)`,
        [issued.id, SAL_PERMISSION_ELSEWHERE.userId]
      )
    ).toBe(1);
  });

  it('is unreachable from the other tenant (cross-tenant)', async () => {
    const delivery = await seedDeliveredDelivery('wty_detail_cross_tenant');
    const issued = await issuedWarranty(delivery.deliveryId);

    authAs(SAL_TENANT_B);
    const response = await readWarranty(issued.id);
    expect(response.status).toBe(404);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-RES-001');
    // An unknown id answers identically, so the code discloses nothing about whether
    // the record exists.
    authAs(SAL_TENANT_B);
    expect((await readWarranty(randomUUID())).status).toBe(404);
  });
});

/**
 * P1-22-L-01 — the warranty surface exposes nothing claim-shaped.
 *
 * No claim table exists in any schema under any name: `wty` is exactly five tables
 * and the entire trace of a claim across 119 migrations is the string
 * `'claimed_against'` in two CHECK vocabularies. There is no claim permission, no
 * claim event type and no claim audit action, and creating a table needs a migration
 * this phase forbids.
 *
 * That absence is currently protected only by prose in three file headers, and prose
 * about a test is not a test. This block pins it structurally so a future edit cannot
 * quietly add a claim route, a claim field or a claim operation and leave every other
 * assertion in this file green.
 */
describe('wty.warranty-detail and wty.warranty-generate expose no claim surface', () => {
  const FILES = [
    'src/modules/warranty/index.ts',
    'src/app/api/v1/warranties/[warrantyId]/route.ts',
    'src/app/api/v1/deliveries/[deliveryId]/warranties/route.ts',
  ];

  it('mentions "claim" in comments only, and never in code', () => {
    for (const relative of FILES) {
      const source = readFileSync(resolve(API_ROOT, relative), 'utf8');

      // 1. Every raw line that mentions a claim is a comment line. Checked first
      //    because it is transparent and needs no lexer.
      for (const line of source.split(/\r?\n/)) {
        if (!/claim/i.test(line)) continue;
        const trimmed = line.trim();
        expect(
          trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*'),
          `${relative}: "claim" appears outside a comment: ${trimmed}`
        ).toBe(true);
      }

      // 2. And with every comment removed, the code contains no claim at all — a
      //    second, independent check, because a `/* claim */` on a code line would
      //    pass the first one.
      const code = stripComments(source);
      // The stripper must have left real code behind, or this is vacuous.
      expect(code, `${relative} stripped to nothing`).toContain('export');
      expect(/claim/i.test(code), `${relative}: claim survives comment stripping`).toBe(false);
    }
  });

  it('registers no operation whose id, path or audit action mentions a claim', () => {
    // The two warranty routes are imported at the top of this file, so both are
    // registered by the time this runs.
    const registered = allOperations();
    expect(registered.some((operation) => operation.id === 'wty.warranty-generate')).toBe(true);
    expect(registered.some((operation) => operation.id === 'wty.warranty-detail')).toBe(true);

    for (const operation of registered) {
      expect(/claim/i.test(operation.id), `${operation.id}: id mentions a claim`).toBe(false);
      expect(/claim/i.test(operation.path), `${operation.id}: path mentions a claim`).toBe(false);
      expect(
        /claim/i.test(operation.auditAction ?? ''),
        `${operation.id}: audit action mentions a claim`
      ).toBe(false);
    }
  });

  it('never writes a warranty status this phase may not create', async () => {
    // `'claimed_against'`, `'active'`, `'expired'` and `'voided'` are all legal values
    // of `ck_warranty_records_status`. `assertWritableStatus` restricts P1-22 to
    // `'issued'`, and this is the ledger evidence that nothing in the two suites
    // produced anything else.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM wty.warranty_records WHERE status <> 'issued'`
      )
    ).toBe(0);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM wty.warranty_status_history WHERE to_status <> 'issued'`
      )
    ).toBe(0);
  });
});
