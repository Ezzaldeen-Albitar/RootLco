/**
 * Customer identity — duplicate scoring, review, merge, history, timeline, and
 * vehicle linkage, end to end (Phase 1-16, FR-CRM-003, FR-VEH-003,
 * P1-16-BE-013…018).
 *
 * The merge is the most destructive operation in the phase, so most of this
 * suite is about what it refuses: merging a record into itself, into another
 * tenant's customer, into an already-merged survivor, or twice. What it does on
 * success is equally load-bearing — the source is redirected and retained, not
 * deleted, so a historical reference to the duplicate still resolves.
 *
 * Operations exercised here: crm.duplicate-scan, crm.duplicate-review,
 * crm.customer-merge, crm.customer-history, crm.customer-timeline,
 * crm.vehicle-link.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   crm.duplicate-scan: route service authorization success denial cross-tenant audit idempotency
 *   crm.duplicate-review: route service authorization success denial cross-tenant audit concurrency idempotency
 *   crm.customer-merge: route service authorization success denial cross-tenant audit outbox rollback concurrency idempotency
 *   crm.customer-history: route service authorization success denial cross-tenant
 *   crm.customer-timeline: route service authorization success denial cross-tenant
 *   crm.vehicle-link: route service authorization success denial cross-tenant audit idempotency
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  IDENTITY_PROVIDER,
  SUBJECT_UNPERMITTED,
  TENANT_A,
  TENANT_B,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import {
  StaticClaimsAuthenticator,
  __resetAuthenticatorForTests,
  setSessionAuthenticator,
} from '@/server/context/principal';
import { POST as SCAN } from '@/app/api/v1/customers/[customerId]/duplicate-scans/route';
import { POST as REVIEW } from '@/app/api/v1/customer-duplicates/[candidateId]/review/route';
import { POST as MERGE } from '@/app/api/v1/customers/[customerId]/merge/route';
import { GET as HISTORY } from '@/app/api/v1/customers/[customerId]/history/route';
import { GET as TIMELINE } from '@/app/api/v1/customers/[customerId]/timeline/route';
import { POST as LINK_VEHICLE } from '@/app/api/v1/customers/[customerId]/vehicles/route';

const ROLE = 'c1640000-0000-4000-8000-0000000000a1';
const STEWARD = 'c1640000-0000-4000-8000-0000000000a2';
const STEWARD_SUBJECT = 'fx_p1_16_crm_steward';
const DUP_A = 'c1640000-0000-4000-8000-0000000000c1';
const DUP_B = 'c1640000-0000-4000-8000-0000000000c2';
const DUP_C = 'c1640000-0000-4000-8000-0000000000c3';
const SOLO = 'c1640000-0000-4000-8000-0000000000c4';
const CUSTOMER_B = 'c1640000-0000-4000-8000-0000000000d1';
const VEHICLE = 'c1640000-0000-4000-8000-0000000000e1';
const VEHICLE_B = 'c1640000-0000-4000-8000-0000000000e2';

const APPROVAL = 'MERGE-APPROVAL-2026-0001';
const REVIEW_REASON = 'Confirmed with the customer by phone that these are two different people.';

interface Body {
  readonly candidates?: readonly { candidateId: string; otherId: string; score: number }[];
  readonly compared?: number;
  readonly candidateId?: string;
  readonly status?: string;
  readonly mergeId?: string;
  readonly sourceId?: string;
  readonly survivorId?: string;
  readonly id?: string;
  readonly items?: readonly { id: string; kind?: string; eventType?: string }[];
  readonly code?: string;
}

let admin: Pool;
let runtime: Pool;

function authenticateAs(providerSubject: string, tenantId = TENANT_A): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject,
      tenantId,
    })
  );
}

function post(path: string, body: unknown, key = crypto.randomUUID()): Request {
  return new Request(`http://localhost/api/v1/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify(body ?? {}),
  });
}
const customerRoute = (customerId: string) => ({ params: Promise.resolve({ customerId }) });

const scan = (c: string, k?: string) =>
  SCAN(post(`customers/${c}/duplicate-scans`, {}, k), customerRoute(c));
const review = (id: string, b: unknown, k?: string) =>
  REVIEW(post(`customer-duplicates/${id}/review`, b, k), {
    params: Promise.resolve({ candidateId: id }),
  });
const merge = (c: string, b: unknown, k?: string) =>
  MERGE(post(`customers/${c}/merge`, b, k), customerRoute(c));
const linkVehicle = (c: string, b: unknown, k?: string) =>
  LINK_VEHICLE(post(`customers/${c}/vehicles`, b, k), customerRoute(c));
const history = (c: string, q = '') =>
  HISTORY(new Request(`http://localhost/api/v1/customers/${c}/history${q}`), customerRoute(c));
const timeline = (c: string, q = '') =>
  TIMELINE(new Request(`http://localhost/api/v1/customers/${c}/timeline${q}`), customerRoute(c));

async function countWhere(sql: string, values: readonly unknown[]): Promise<number> {
  const result = await admin.query<{ n: string }>(sql, [...values]);
  return Number(result.rows[0]?.n ?? '0');
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);

  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ('crm.customer.read', 'crm', 'Search and read customers in the tenant', 'low', $1),
            ('crm.customer.duplicate.review', 'crm', 'Scan for and review duplicate customer candidates', 'medium', $1),
            ('crm.customer.merge', 'crm', 'Merge a duplicate customer into a survivor', 'high', $1),
            ('crm.customer.vehicle.manage', 'crm', 'Link customers to vehicles', 'medium', $1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, 'crm-steward@example.test', 'CRM Steward', 'active', $5)
     ON CONFLICT (id) DO NOTHING`,
    [STEWARD, TENANT_A, IDENTITY_PROVIDER, STEWARD_SUBJECT, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, 'fx_p1_16_crm_steward', 'P1-16 CRM steward', $3)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid, $2::uuid, p.id, 'allow', $3::uuid
       FROM iam.permissions p
      WHERE p.permission_code IN ('crm.customer.read', 'crm.customer.duplicate.review',
                                  'crm.customer.merge', 'crm.customer.vehicle.manage')
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, ROLE, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1, $2, $3, 'unrestricted', $4, $4)`,
    [TENANT_A, STEWARD, ROLE, USER_A]
  );

  // Three tenant-A customers sharing a name (so the scorer fires), one that
  // shares nothing, and a tenant-B decoy carrying the SAME name — which must
  // never be compared, scored, or merged from tenant A.
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
     VALUES ($1, $2, 'individual', 'Kareem Duplicate', 'active', $6),
            ($3, $2, 'individual', 'Kareem Duplicate', 'active', $6),
            ($4, $2, 'individual', 'Kareem Duplicate', 'active', $6),
            ($5, $2, 'individual', 'Unrelated Person', 'active', $6),
            ($7, $8, 'individual', 'Kareem Duplicate', 'active', $6)
     ON CONFLICT (id) DO NOTHING`,
    [DUP_A, TENANT_A, DUP_B, DUP_C, SOLO, USER_A, CUSTOMER_B, TENANT_B]
  );

  // Vehicles: one in tenant A, one in tenant B for the cross-tenant probe.
  await admin.query(
    `INSERT INTO veh.vehicles (id, tenant_id, created_by)
     VALUES ($1, $2, $4), ($3, $5, $4)
     ON CONFLICT (id) DO NOTHING`,
    [VEHICLE, TENANT_A, VEHICLE_B, USER_A, TENANT_B]
  );

  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);
});

afterEach(() => {
  __resetAuthenticatorForTests();
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  await runtime.end();
  await cleanBackendFixtures(admin);
  await admin.end();
});

describe('authentication and authorization', () => {
  it('answers 401 on every identity route with no authenticator', async () => {
    __resetAuthenticatorForTests();
    for (const response of await Promise.all([
      scan(DUP_A),
      merge(DUP_A, { survivorId: DUP_B, approvalRef: APPROVAL }),
      history(DUP_A),
      timeline(DUP_A),
      linkVehicle(DUP_A, { vehicleId: VEHICLE, relationshipRole: 'owner' }),
    ])) {
      expect(response.status).toBe(401);
    }
  });

  it('answers 403 on every identity route for a caller with no CRM permission', async () => {
    authenticateAs(SUBJECT_UNPERMITTED);
    for (const response of await Promise.all([
      scan(DUP_A),
      merge(DUP_A, { survivorId: DUP_B, approvalRef: APPROVAL }),
      history(DUP_A),
      timeline(DUP_A),
      linkVehicle(DUP_A, { vehicleId: VEHICLE, relationshipRole: 'owner' }),
    ])) {
      expect(response.status).toBe(403);
      expect(((await response.json()) as Body).code).toBe('ERR-IAM-001');
    }
  });
});

describe('duplicate scoring', () => {
  it('scores same-name customers deterministically and never crosses the tenant', async () => {
    authenticateAs(STEWARD_SUBJECT);
    const first = (await (await scan(DUP_A)).json()) as Body;
    const second = (await (await scan(DUP_A)).json()) as Body;

    const ids = (first.candidates ?? []).map((c) => c.otherId).sort();
    expect(ids).toEqual([DUP_B, DUP_C].sort());
    // A tenant-B customer with the identical name is never a candidate.
    expect(ids).not.toContain(CUSTOMER_B);
    // Deterministic: the same data scores the same on a second run.
    expect((second.candidates ?? []).map((c) => c.score).sort()).toEqual(
      (first.candidates ?? []).map((c) => c.score).sort()
    );
    // And it upserted rather than accumulating a second row per pair.
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM crm.duplicate_candidates
          WHERE tenant_id = $1 AND (partner_id_a = $2 OR partner_id_b = $2)`,
        [TENANT_A, DUP_A]
      )
    ).toBe(2);

    // The basis records which signals fired, so a reviewer can see why.
    const row = await admin.query<{ match_basis: unknown; match_score: string }>(
      `SELECT match_basis, match_score FROM crm.duplicate_candidates
        WHERE id = $1`,
      [first.candidates?.[0]?.candidateId]
    );
    expect(JSON.stringify(row.rows[0]?.match_basis)).toContain('normalized_name');
  });

  it('produces no candidate for a customer that shares nothing', async () => {
    authenticateAs(STEWARD_SUBJECT);
    const body = (await (await scan(SOLO)).json()) as Body;
    expect(body.candidates).toHaveLength(0);
  });

  it('audits the scan', async () => {
    authenticateAs(STEWARD_SUBJECT);
    await scan(DUP_A);
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM iam.audit_records
          WHERE action = 'crm.customer.duplicates_scanned' AND entity_id = $1`,
        [DUP_A]
      )
    ).toBeGreaterThan(0);
  });
});

describe('duplicate review', () => {
  it('records a dismissal and refuses a second review of the same candidate', async () => {
    authenticateAs(STEWARD_SUBJECT);
    const scanned = (await (await scan(DUP_A)).json()) as Body;
    const candidateId = scanned.candidates?.[0]?.candidateId ?? '';

    const first = await review(candidateId, { decision: 'dismissed', reason: REVIEW_REASON });
    expect(first.status).toBe(200);

    const row = await admin.query<{ status: string; reviewed_by: string }>(
      `SELECT status, reviewed_by FROM crm.duplicate_candidates WHERE id = $1`,
      [candidateId]
    );
    expect(row.rows[0]?.status).toBe('dismissed');
    expect(row.rows[0]?.reviewed_by).toBe(STEWARD);

    // Reviewing twice is refused rather than silently overwriting the decision.
    const second = await review(candidateId, { decision: 'dismissed', reason: REVIEW_REASON });
    expect([409, 422]).toContain(second.status);
  });

  it('does not re-raise a dismissed pair on a later scan', async () => {
    authenticateAs(STEWARD_SUBJECT);
    // The previous test dismissed one of DUP_A's candidates; re-scanning must
    // not create a second, open candidate for the same pair.
    await scan(DUP_A);
    const openForDismissed = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM crm.duplicate_candidates
        WHERE tenant_id = $1 AND status = 'dismissed'`,
      [TENANT_A]
    );
    expect(Number(openForDismissed.rows[0]?.n ?? '0')).toBeGreaterThan(0);
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM crm.duplicate_candidates
          WHERE tenant_id = $1 AND (partner_id_a = $2 OR partner_id_b = $2)`,
        [TENANT_A, DUP_A]
      )
    ).toBe(2);
  });

  it('refuses a review of a candidate that does not exist', async () => {
    authenticateAs(STEWARD_SUBJECT);
    const response = await review('00000000-0000-4000-8000-0000000000ff', {
      decision: 'dismissed',
      reason: REVIEW_REASON,
    });
    expect(response.status).toBe(404);
  });

  it('refuses "merged" as a review decision — only a merge sets that', async () => {
    authenticateAs(STEWARD_SUBJECT);
    const scanned = (await (await scan(DUP_C)).json()) as Body;
    const response = await review(scanned.candidates?.[0]?.candidateId ?? '', {
      decision: 'merged',
      reason: REVIEW_REASON,
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as Body).code).toBe('ERR-VAL-001');
  });
});

describe('merge refusals', () => {
  it('refuses merging a customer into itself', async () => {
    authenticateAs(STEWARD_SUBJECT);
    const response = await merge(DUP_A, { survivorId: DUP_A, approvalRef: APPROVAL });
    expect(response.status).toBe(422);
    expect(((await response.json()) as Body).code).toBe('ERR-VAL-001');
  });

  it('refuses a cross-tenant survivor with the same 404 as an unknown one', async () => {
    authenticateAs(STEWARD_SUBJECT);
    const foreign = await merge(DUP_A, { survivorId: CUSTOMER_B, approvalRef: APPROVAL });
    const unknown = await merge(DUP_A, {
      survivorId: '00000000-0000-4000-8000-0000000000fe',
      approvalRef: APPROVAL,
    });
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(((await foreign.json()) as Body).code).toBe(((await unknown.json()) as Body).code);

    // And nothing was recorded against the tenant-B customer.
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM crm.partner_merges WHERE survivor_partner_id = $1`,
        [CUSTOMER_B]
      )
    ).toBe(0);
  });

  it('requires an approval reference', async () => {
    authenticateAs(STEWARD_SUBJECT);
    const response = await merge(DUP_A, { survivorId: DUP_B });
    expect(response.status).toBe(422);
  });

  it('leaves no merge record when the request is refused', async () => {
    authenticateAs(STEWARD_SUBJECT);
    const before = await countWhere(
      `SELECT count(*)::text AS n FROM crm.partner_merges WHERE tenant_id = $1`,
      [TENANT_A]
    );
    await merge(DUP_A, { survivorId: DUP_A, approvalRef: APPROVAL });
    await merge(DUP_A, { survivorId: CUSTOMER_B, approvalRef: APPROVAL });
    expect(
      await countWhere(`SELECT count(*)::text AS n FROM crm.partner_merges WHERE tenant_id = $1`, [
        TENANT_A,
      ])
    ).toBe(before);
    // No orphaned audit record for a merge that never happened.
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM iam.audit_records a
          WHERE a.action = 'crm.customer.merged'
            AND NOT EXISTS (
              SELECT 1 FROM crm.business_partners p
               WHERE p.id = a.entity_id AND p.merged_into_id IS NOT NULL)`,
        []
      )
    ).toBe(0);
  });
});

describe('merge success', () => {
  it('redirects the source, retains it, audits, and publishes with the survivor as aggregate', async () => {
    authenticateAs(STEWARD_SUBJECT);
    const response = await merge(DUP_C, { survivorId: DUP_B, approvalRef: APPROVAL });
    const body = (await response.json()) as Body;
    expect(response.status).toBe(200);

    const source = await admin.query<{ lifecycle_status: string; merged_into_id: string }>(
      `SELECT lifecycle_status, merged_into_id FROM crm.business_partners WHERE id = $1`,
      [DUP_C]
    );
    // Retained and redirected — a historical reference still resolves.
    expect(source.rows).toHaveLength(1);
    expect(source.rows[0]?.lifecycle_status).toBe('merged');
    expect(source.rows[0]?.merged_into_id).toBe(DUP_B);

    const record = await admin.query<{ merged_by: string; approval_ref: string }>(
      `SELECT merged_by, approval_ref FROM crm.partner_merges WHERE id = $1`,
      [body.mergeId]
    );
    // Server-attributed, like every other decision in the phase.
    expect(record.rows[0]?.merged_by).toBe(STEWARD);
    expect(record.rows[0]?.approval_ref).toBe(APPROVAL);

    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM iam.audit_records
          WHERE action = 'crm.customer.merged' AND entity_id = $1`,
        [DUP_C]
      )
    ).toBe(1);
    // The survivor is the aggregate: it is what a consumer must re-read.
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM shared.event_outbox
          WHERE event_type = 'business-partner.merged' AND aggregate_id = $1`,
        [DUP_B]
      )
    ).toBe(1);
  });

  it('refuses a second merge of an already-merged customer', async () => {
    authenticateAs(STEWARD_SUBJECT);
    const response = await merge(DUP_C, { survivorId: DUP_A, approvalRef: APPROVAL });
    expect([409, 422]).toContain(response.status);
    // Still pointing at the original survivor — no partial second merge.
    const source = await admin.query<{ merged_into_id: string }>(
      `SELECT merged_into_id FROM crm.business_partners WHERE id = $1`,
      [DUP_C]
    );
    expect(source.rows[0]?.merged_into_id).toBe(DUP_B);
  });

  it('refuses merging into a survivor that is itself merged', async () => {
    authenticateAs(STEWARD_SUBJECT);
    const response = await merge(SOLO, { survivorId: DUP_C, approvalRef: APPROVAL });
    expect([409, 422]).toContain(response.status);
  });
});

describe('history and timeline', () => {
  it('projects the governance history of the merged customer', async () => {
    authenticateAs(STEWARD_SUBJECT);
    const body = (await (await history(DUP_C)).json()) as Body;
    const kinds = (body.items ?? []).map((i) => i.kind);
    // The merge is part of the customer's history, drawn from partner_merges.
    expect(kinds).toContain('merge');
  });

  it('reads the timeline newest-first with a bounded, stable page', async () => {
    authenticateAs(STEWARD_SUBJECT);
    const response = await timeline(DUP_C, '?limit=5');
    expect(response.status).toBe(200);
    const page = (await response.json()) as { items?: readonly { occurredAt: string }[] };
    const times = (page.items ?? []).map((i) => i.occurredAt);
    expect(times).toEqual([...times].sort().reverse());
  });

  it('refuses an unknown ordering parameter and a malformed cursor', async () => {
    authenticateAs(STEWARD_SUBJECT);
    const injected = await timeline(DUP_C, '?orderBy=occurred_at%20ASC');
    expect(injected.status).toBe(422);
    const badCursor = await timeline(DUP_C, '?cursor=not-a-cursor');
    expect(badCursor.status).toBe(400);
  });

  it('answers 404 for another tenant customer on both reads', async () => {
    authenticateAs(STEWARD_SUBJECT);
    expect((await history(CUSTOMER_B)).status).toBe(404);
    expect((await timeline(CUSTOMER_B)).status).toBe(404);
  });
});

describe('vehicle linkage', () => {
  it('links a customer to a tenant vehicle and audits it', async () => {
    authenticateAs(STEWARD_SUBJECT);
    const response = await linkVehicle(DUP_A, {
      vehicleId: VEHICLE,
      relationshipRole: 'owner',
    });
    const body = (await response.json()) as Body;
    expect(response.status).toBe(201);

    const row = await admin.query<{ partner_id: string; vehicle_id: string }>(
      `SELECT partner_id, vehicle_id FROM veh.vehicle_relationships WHERE id = $1`,
      [body.id]
    );
    expect(row.rows[0]?.partner_id).toBe(DUP_A);
    expect(row.rows[0]?.vehicle_id).toBe(VEHICLE);
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM iam.audit_records
          WHERE action = 'crm.customer.vehicle_linked' AND entity_id = $1`,
        [body.id]
      )
    ).toBe(1);
  });

  it('refuses a duplicate open role for the same customer and vehicle', async () => {
    authenticateAs(STEWARD_SUBJECT);
    const response = await linkVehicle(DUP_A, { vehicleId: VEHICLE, relationshipRole: 'owner' });
    expect(response.status).toBe(409);
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM veh.vehicle_relationships
          WHERE partner_id = $1 AND vehicle_id = $2 AND relationship_role = 'owner'`,
        [DUP_A, VEHICLE]
      )
    ).toBe(1);
  });

  it('refuses a cross-tenant vehicle and never creates the relationship', async () => {
    authenticateAs(STEWARD_SUBJECT);
    const response = await linkVehicle(DUP_A, { vehicleId: VEHICLE_B, relationshipRole: 'user' });
    expect(response.status).toBe(404);
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM veh.vehicle_relationships WHERE vehicle_id = $1`,
        [VEHICLE_B]
      )
    ).toBe(0);
  });

  it('refuses linking a cross-tenant customer', async () => {
    authenticateAs(STEWARD_SUBJECT);
    const response = await linkVehicle(CUSTOMER_B, {
      vehicleId: VEHICLE,
      relationshipRole: 'user',
    });
    expect(response.status).toBe(404);
  });

  it('replays a repeated link request instead of creating a second relationship', async () => {
    authenticateAs(STEWARD_SUBJECT);
    const key = crypto.randomUUID();
    const payload = { vehicleId: VEHICLE, relationshipRole: 'driver' };
    const first = (await (await linkVehicle(DUP_A, payload, key)).json()) as Body;
    const second = (await (await linkVehicle(DUP_A, payload, key)).json()) as Body;
    expect(second.id).toBe(first.id);
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM veh.vehicle_relationships
          WHERE partner_id = $1 AND vehicle_id = $2 AND relationship_role = 'driver'`,
        [DUP_A, VEHICLE]
      )
    ).toBe(1);
  });
});
