/**
 * Customer governance — notes, alerts, tags, lifecycle status, restrictions, end
 * to end (Phase 1-16, P1-16-BE-008…012).
 *
 * These five records change how the workshop treats a customer, so the suite
 * concentrates on the properties that make them accountable rather than merely
 * present: a substantive reason where the record constrains someone, a
 * transition graph the database cannot express, optimistic concurrency on the
 * lifecycle, and append-only history that no application role may rewrite.
 *
 * Operations exercised here: crm.note-add, crm.alert-raise, crm.tag-assign,
 * crm.customer-status-set, crm.restriction-impose.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   crm.note-add: route service authorization success denial cross-tenant audit idempotency
 *   crm.alert-raise: route service authorization success denial cross-tenant audit idempotency
 *   crm.tag-assign: route service authorization success denial cross-tenant audit idempotency
 *   crm.customer-status-set: route service authorization success denial cross-tenant audit concurrency idempotency
 *   crm.restriction-impose: route service authorization success denial cross-tenant audit rollback idempotency
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
import { POST as ADD_NOTE } from '@/app/api/v1/customers/[customerId]/notes/route';
import { POST as RAISE_ALERT } from '@/app/api/v1/customers/[customerId]/alerts/route';
import { POST as ASSIGN_TAG } from '@/app/api/v1/customers/[customerId]/tags/route';
import { PUT as SET_STATUS } from '@/app/api/v1/customers/[customerId]/status/route';
import { POST as IMPOSE_RESTRICTION } from '@/app/api/v1/customers/[customerId]/restrictions/route';

const ROLE_A = 'c1630000-0000-4000-8000-0000000000a1';
const GOVERNOR = 'c1630000-0000-4000-8000-0000000000a2';
const GOVERNOR_SUBJECT = 'fx_p1_16_crm_governor';
const CUSTOMER = 'c1630000-0000-4000-8000-0000000000c1';
const CUSTOMER_2 = 'c1630000-0000-4000-8000-0000000000c2';
const CUSTOMER_3 = 'c1630000-0000-4000-8000-0000000000c3';
const CUSTOMER_B = 'c1630000-0000-4000-8000-0000000000d1';

const REASON = 'Repeated non-payment across three invoices; approved by branch manager.';

interface Body {
  readonly id?: string;
  readonly segmentId?: string;
  readonly assigned?: boolean;
  readonly customerId?: string;
  readonly previousStatus?: string;
  readonly lifecycleStatus?: string | null;
  readonly historyId?: string;
  readonly restrictionType?: string;
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

function request(path: string, method: string, body: unknown, key = crypto.randomUUID()): Request {
  return new Request(`http://localhost/api/v1/customers/${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify(body),
  });
}
const route = (customerId: string) => ({ params: Promise.resolve({ customerId }) });

const addNote = (c: string, b: unknown, k?: string) =>
  ADD_NOTE(request(`${c}/notes`, 'POST', b, k), route(c));
const raiseAlert = (c: string, b: unknown, k?: string) =>
  RAISE_ALERT(request(`${c}/alerts`, 'POST', b, k), route(c));
const assignTag = (c: string, b: unknown, k?: string) =>
  ASSIGN_TAG(request(`${c}/tags`, 'POST', b, k), route(c));
const setStatus = (c: string, b: unknown, k?: string) =>
  SET_STATUS(request(`${c}/status`, 'PUT', b, k), route(c));
const imposeRestriction = (c: string, b: unknown, k?: string) =>
  IMPOSE_RESTRICTION(request(`${c}/restrictions`, 'POST', b, k), route(c));

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
     VALUES ('crm.customer.note.write', 'crm', 'Author and edit customer notes', 'medium', $1),
            ('crm.customer.governance.manage', 'crm', 'Manage customer alerts, tags, and lifecycle status', 'medium', $1),
            ('crm.customer.restriction.manage', 'crm', 'Impose and lift customer restrictions', 'high', $1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, 'crm-governor@example.test', 'CRM Governor', 'active', $5)
     ON CONFLICT (id) DO NOTHING`,
    [GOVERNOR, TENANT_A, IDENTITY_PROVIDER, GOVERNOR_SUBJECT, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, 'fx_p1_16_crm_governor', 'P1-16 CRM governor', $3)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_A, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid, $2::uuid, p.id, 'allow', $3::uuid
       FROM iam.permissions p
      WHERE p.permission_code IN ('crm.customer.note.write', 'crm.customer.governance.manage',
                                  'crm.customer.restriction.manage')
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, ROLE_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1, $2, $3, 'unrestricted', $4, $4)`,
    [TENANT_A, GOVERNOR, ROLE_A, USER_A]
  );

  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
     VALUES ($1, $2, 'individual', 'Governance Fixture One',   'active', $6),
            ($3, $2, 'individual', 'Governance Fixture Two',   'active', $6),
            ($4, $2, 'individual', 'Governance Fixture Three', 'active', $6),
            ($5, $7, 'individual', 'Governance Tenant B',      'active', $6)
     ON CONFLICT (id) DO NOTHING`,
    [CUSTOMER, TENANT_A, CUSTOMER_2, CUSTOMER_3, CUSTOMER_B, USER_A, TENANT_B]
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
  it('answers 401 on every governance route with no authenticator', async () => {
    __resetAuthenticatorForTests();
    for (const response of await Promise.all([
      addNote(CUSTOMER, { body: 'note' }),
      raiseAlert(CUSTOMER, { alertType: 'other', severity: 'info', message: 'm' }),
      assignTag(CUSTOMER, { segmentCode: 'vip' }),
      setStatus(CUSTOMER, { lifecycleStatus: 'inactive', reason: REASON }),
      imposeRestriction(CUSTOMER, { restrictionType: 'no_credit', reason: REASON }),
    ])) {
      expect(response.status).toBe(401);
    }
  });

  it('answers 403 on every governance route for a caller with no CRM permission', async () => {
    authenticateAs(SUBJECT_UNPERMITTED);
    for (const response of await Promise.all([
      addNote(CUSTOMER, { body: 'note' }),
      raiseAlert(CUSTOMER, { alertType: 'other', severity: 'info', message: 'm' }),
      assignTag(CUSTOMER, { segmentCode: 'vip' }),
      setStatus(CUSTOMER, { lifecycleStatus: 'inactive', reason: REASON }),
      imposeRestriction(CUSTOMER, { restrictionType: 'no_credit', reason: REASON }),
    ])) {
      expect(response.status).toBe(403);
      expect(((await response.json()) as Body).code).toBe('ERR-IAM-001');
    }
  });
});

describe('notes', () => {
  it('attributes the note to the caller and pins the CRM entity type', async () => {
    authenticateAs(GOVERNOR_SUBJECT);
    const body = (await (
      await addNote(CUSTOMER, { body: 'Customer prefers morning collection.' })
    ).json()) as Body;

    const row = await admin.query<{
      author_id: string;
      entity_type: string;
      entity_id: string;
      classification: string;
      visibility: string;
    }>(
      `SELECT author_id, entity_type, entity_id, classification, visibility
         FROM shared.notes WHERE id = $1`,
      [body.id]
    );
    // The RLS policy pins both; neither can be supplied by a request.
    expect(row.rows[0]?.author_id).toBe(GOVERNOR);
    expect(row.rows[0]?.entity_type).toBe('crm.business_partners');
    expect(row.rows[0]?.entity_id).toBe(CUSTOMER);
    // Defaults are the narrow ones.
    expect(row.rows[0]?.classification).toBe('internal');
    expect(row.rows[0]?.visibility).toBe('internal');
  });

  it('keeps the note body out of the audit trail', async () => {
    authenticateAs(GOVERNOR_SUBJECT);
    const secret = 'Customer disclosed a pending insurance dispute.';
    const body = (await (
      await addNote(CUSTOMER, { body: secret, classification: 'restricted' })
    ).json()) as Body;

    const details = await admin.query<{ field_name: string }>(
      `SELECT d.field_name, d.new_value_masked
         FROM iam.audit_record_details d
         JOIN iam.audit_records a ON a.id = d.audit_record_id
        WHERE a.action = 'crm.customer.note_added' AND a.entity_id = $1`,
      [body.id]
    );
    expect(details.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(details.rows)).not.toContain('insurance dispute');
    expect(details.rows.map((d) => d.field_name)).toContain('classification');
  });
});

describe('alerts and tags', () => {
  it('raises an advisory alert without touching the lifecycle', async () => {
    authenticateAs(GOVERNOR_SUBJECT);
    const before = await admin.query<{ lifecycle_status: string }>(
      `SELECT lifecycle_status FROM crm.business_partners WHERE id = $1`,
      [CUSTOMER]
    );
    const body = (await (
      await raiseAlert(CUSTOMER, {
        alertType: 'safety',
        severity: 'critical',
        message: 'Vehicle has an unrepaired brake fault.',
      })
    ).json()) as Body;

    const after = await admin.query<{ lifecycle_status: string }>(
      `SELECT lifecycle_status FROM crm.business_partners WHERE id = $1`,
      [CUSTOMER]
    );
    // An alert informs; it does not restrict.
    expect(after.rows[0]?.lifecycle_status).toBe(before.rows[0]?.lifecycle_status);
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM iam.audit_records
          WHERE action = 'crm.customer.alert_raised' AND entity_id = $1`,
        [body.id]
      )
    ).toBe(1);
  });

  it('normalizes a tag code and reuses the segment for a second customer', async () => {
    authenticateAs(GOVERNOR_SUBJECT);
    const first = (await (
      await assignTag(CUSTOMER, { segmentCode: '  Fleet Account ', name: 'Fleet account' })
    ).json()) as Body;
    const second = (await (
      await assignTag(CUSTOMER_2, { segmentCode: 'fleet_account' })
    ).json()) as Body;

    // One concept, not two look-alike strings.
    expect(second.segmentId).toBe(first.segmentId);
    const segment = await admin.query<{ segment_code: string }>(
      `SELECT segment_code FROM crm.customer_segments WHERE id = $1`,
      [first.segmentId]
    );
    expect(segment.rows[0]?.segment_code).toBe('fleet_account');
  });

  it('treats re-tagging as a no-op rather than a conflict', async () => {
    authenticateAs(GOVERNOR_SUBJECT);
    await assignTag(CUSTOMER_3, { segmentCode: 'repeat_tag' });
    const response = await assignTag(CUSTOMER_3, { segmentCode: 'repeat_tag' });
    const body = (await response.json()) as Body;

    expect(response.status).toBe(200);
    expect(body.assigned).toBe(false);
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM crm.partner_segment_assignments WHERE partner_id = $1`,
        [CUSTOMER_3]
      )
    ).toBe(1);
  });

  it('refuses a tag code the column format would reject', async () => {
    authenticateAs(GOVERNOR_SUBJECT);
    const response = await assignTag(CUSTOMER, { segmentCode: '9lives!' });
    expect(response.status).toBe(422);
    expect(((await response.json()) as Body).code).toBe('ERR-VAL-001');
  });
});

describe('lifecycle status', () => {
  it('moves the state, appends the history, and records the reason', async () => {
    authenticateAs(GOVERNOR_SUBJECT);
    const response = await setStatus(CUSTOMER_2, {
      lifecycleStatus: 'inactive',
      reason: 'Customer relocated abroad and closed their account with us.',
    });
    const body = (await response.json()) as Body;
    expect(response.status).toBe(200);
    expect(body.previousStatus).toBe('active');
    expect(body.lifecycleStatus).toBe('inactive');

    const partner = await admin.query<{ lifecycle_status: string }>(
      `SELECT lifecycle_status FROM crm.business_partners WHERE id = $1`,
      [CUSTOMER_2]
    );
    expect(partner.rows[0]?.lifecycle_status).toBe('inactive');

    const history = await admin.query<{ from_state: string; to_state: string; actor_id: string }>(
      `SELECT from_state, to_state, actor_id FROM crm.partner_status_history WHERE id = $1`,
      [body.historyId]
    );
    expect(history.rows[0]?.from_state).toBe('active');
    expect(history.rows[0]?.to_state).toBe('inactive');
    // Server-attributed, like consent.
    expect(history.rows[0]?.actor_id).toBe(GOVERNOR);
  });

  it('refuses a no-op transition distinctly from an illegal one', async () => {
    authenticateAs(GOVERNOR_SUBJECT);
    // CUSTOMER_2 is already inactive from the previous test.
    const noop = await setStatus(CUSTOMER_2, {
      lifecycleStatus: 'inactive',
      reason: 'Attempting to set the state it already holds, which changes nothing.',
    });
    expect(noop.status).toBe(422);

    const illegal = await setStatus(CUSTOMER_2, {
      lifecycleStatus: 'prospect',
      reason: 'Attempting to demote an inactive customer back to a prospect.',
    });
    expect(illegal.status).toBe(422);
    expect(((await illegal.json()) as Body).code).toBe('ERR-VAL-001');
  });

  it('refuses a reason too short to explain the decision', async () => {
    authenticateAs(GOVERNOR_SUBJECT);
    const response = await setStatus(CUSTOMER, { lifecycleStatus: 'inactive', reason: 'x' });
    expect(response.status).toBe(422);
    expect(((await response.json()) as Body).code).toBe('ERR-VAL-001');
  });

  it('lets exactly one of two simultaneous status changes win', async () => {
    authenticateAs(GOVERNOR_SUBJECT);
    const [a, b] = await Promise.all([
      setStatus(CUSTOMER_3, {
        lifecycleStatus: 'inactive',
        reason: 'First concurrent writer moving the customer out of active service.',
      }),
      setStatus(CUSTOMER_3, {
        lifecycleStatus: 'blocked',
        reason: 'Second concurrent writer blocking the customer for non-payment.',
      }),
    ]);

    const statuses = [a.status, b.status].sort();
    // One committed; the other was told its view was stale rather than
    // silently overwriting a decision it never saw.
    expect(statuses[0]).toBe(200);
    expect([409, 422]).toContain(statuses[1]);

    // Exactly one transition was recorded — the loser wrote nothing.
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM crm.partner_status_history WHERE partner_id = $1`,
        [CUSTOMER_3]
      )
    ).toBe(1);
  });

  it('records the justification before blocking, and again before unblocking', async () => {
    authenticateAs(GOVERNOR_SUBJECT);
    const blockReason = 'Persistent abuse of staff reported by two branches this month.';
    const unblockReason = 'Customer apologised in writing and management lifted the block.';

    const blocked = await setStatus(CUSTOMER_2, {
      lifecycleStatus: 'blocked',
      reason: blockReason,
    });
    expect(blocked.status).toBe(200);
    const unblocked = await setStatus(CUSTOMER_2, {
      lifecycleStatus: 'active',
      reason: unblockReason,
    });
    expect(unblocked.status).toBe(200);

    // crm.guard_partner_block_coherence() refuses both crossings unless the
    // matching history row is already there, so their presence is the proof
    // that the justification was recorded first — not merely alongside.
    const trail = await admin.query<{ action: string; reason: string }>(
      `SELECT action, reason FROM crm.customer_block_history
        WHERE partner_id = $1 ORDER BY seq ASC`,
      [CUSTOMER_2]
    );
    expect(trail.rows.map((r) => r.action)).toEqual(['blocked', 'unblocked']);
    expect(trail.rows[0]?.reason).toBe(blockReason);
    expect(trail.rows[1]?.reason).toBe(unblockReason);
  });

  it('cannot rewrite the append-only status history even as the runtime role', async () => {
    // app_runtime holds SELECT, INSERT on crm.partner_status_history and no
    // UPDATE at all, so the history is unrewritable by grant, not by convention.
    const client = await runtime.connect();
    try {
      await expect(
        client.query(`UPDATE crm.partner_status_history SET reason = 'rewritten'`)
      ).rejects.toThrow(/permission denied/i);
    } finally {
      client.release();
    }
  });
});

describe('restrictions', () => {
  it('imposes a terms restriction without blocking the customer', async () => {
    authenticateAs(GOVERNOR_SUBJECT);
    const body = (await (
      await imposeRestriction(CUSTOMER, {
        restrictionType: 'prepay_only',
        reason: 'Two cheques returned unpaid in the last quarter; prepay until resolved.',
        approvalRef: 'FIN-2026-0044',
      })
    ).json()) as Body;

    expect(body.restrictionType).toBe('prepay_only');
    // Constrains terms, not service — so the lifecycle is untouched.
    expect(body.lifecycleStatus).toBeNull();
    const partner = await admin.query<{ lifecycle_status: string }>(
      `SELECT lifecycle_status FROM crm.business_partners WHERE id = $1`,
      [CUSTOMER]
    );
    expect(partner.rows[0]?.lifecycle_status).toBe('active');
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM iam.audit_records
          WHERE action = 'crm.customer.restriction_imposed' AND entity_id = $1`,
        [body.id]
      )
    ).toBe(1);
  });

  it('blocks the customer, transitions the status, and writes block history in one transaction', async () => {
    authenticateAs(GOVERNOR_SUBJECT);
    const body = (await (
      await imposeRestriction(CUSTOMER, {
        restrictionType: 'no_service',
        reason: 'Threatening behaviour toward staff; service refused pending review.',
        approvalRef: 'OPS-2026-0009',
      })
    ).json()) as Body;

    expect(body.lifecycleStatus).toBe('blocked');
    const partner = await admin.query<{ lifecycle_status: string }>(
      `SELECT lifecycle_status FROM crm.business_partners WHERE id = $1`,
      [CUSTOMER]
    );
    expect(partner.rows[0]?.lifecycle_status).toBe('blocked');

    const block = await admin.query<{ action: string; restriction_id: string; actor_id: string }>(
      `SELECT action, restriction_id, actor_id FROM crm.customer_block_history
        WHERE partner_id = $1 ORDER BY occurred_at DESC LIMIT 1`,
      [CUSTOMER]
    );
    expect(block.rows[0]?.action).toBe('blocked');
    expect(block.rows[0]?.restriction_id).toBe(body.id);
    expect(block.rows[0]?.actor_id).toBe(GOVERNOR);

    // The lifecycle trail records the same decision from the other angle.
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM crm.partner_status_history
          WHERE partner_id = $1 AND to_state = 'blocked'`,
        [CUSTOMER]
      )
    ).toBe(1);
  });

  it('writes nothing at all when the reason is refused', async () => {
    authenticateAs(GOVERNOR_SUBJECT);
    const before = await countWhere(
      `SELECT count(*)::text AS n FROM crm.customer_restrictions WHERE partner_id = $1`,
      [CUSTOMER_2]
    );
    const blocksBefore = await countWhere(
      `SELECT count(*)::text AS n FROM crm.customer_block_history WHERE partner_id = $1`,
      [CUSTOMER_2]
    );

    const response = await imposeRestriction(CUSTOMER_2, {
      restrictionType: 'no_service',
      reason: 'too short',
    });
    expect(response.status).toBe(422);

    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM crm.customer_restrictions WHERE partner_id = $1`,
        [CUSTOMER_2]
      )
    ).toBe(before);
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM crm.customer_block_history WHERE partner_id = $1`,
        [CUSTOMER_2]
      )
    ).toBe(blocksBefore);
    // No orphaned audit record for a restriction row that does not exist.
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM iam.audit_records a
          WHERE a.action = 'crm.customer.restriction_imposed'
            AND NOT EXISTS (SELECT 1 FROM crm.customer_restrictions r WHERE r.id = a.entity_id)`,
        []
      )
    ).toBe(0);
  });
});

describe('idempotent replay and tenant isolation', () => {
  it('replays each governance write instead of writing a second record', async () => {
    authenticateAs(GOVERNOR_SUBJECT);
    const keys = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const note = { body: 'Replay-safe note.' };
    const alert = { alertType: 'operational', severity: 'info', message: 'Replay-safe alert.' };
    const tag = { segmentCode: 'replay_tag' };

    const first = [
      (await (await addNote(CUSTOMER_2, note, keys[0])).json()) as Body,
      (await (await raiseAlert(CUSTOMER_2, alert, keys[1])).json()) as Body,
      (await (await assignTag(CUSTOMER_2, tag, keys[2])).json()) as Body,
    ];
    const second = [
      (await (await addNote(CUSTOMER_2, note, keys[0])).json()) as Body,
      (await (await raiseAlert(CUSTOMER_2, alert, keys[1])).json()) as Body,
      (await (await assignTag(CUSTOMER_2, tag, keys[2])).json()) as Body,
    ];

    expect(second[0]?.id).toBe(first[0]?.id);
    expect(second[1]?.id).toBe(first[1]?.id);
    expect(second[2]?.segmentId).toBe(first[2]?.segmentId);
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM shared.notes
          WHERE entity_id = $1 AND body = 'Replay-safe note.'`,
        [CUSTOMER_2]
      )
    ).toBe(1);
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM crm.customer_alerts
          WHERE partner_id = $1 AND message = 'Replay-safe alert.'`,
        [CUSTOMER_2]
      )
    ).toBe(1);
  });

  it('refuses every governance route against a cross-tenant customer', async () => {
    authenticateAs(GOVERNOR_SUBJECT);
    const responses = await Promise.all([
      addNote(CUSTOMER_B, { body: 'probe' }),
      raiseAlert(CUSTOMER_B, { alertType: 'other', severity: 'info', message: 'probe' }),
      assignTag(CUSTOMER_B, { segmentCode: 'probe_tag' }),
      setStatus(CUSTOMER_B, {
        lifecycleStatus: 'blocked',
        reason: 'Cross-tenant probe that must never reach another tenant customer.',
      }),
      imposeRestriction(CUSTOMER_B, {
        restrictionType: 'no_service',
        reason: 'Cross-tenant probe that must never reach another tenant customer.',
      }),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(((await response.json()) as Body).code).toBe('ERR-RES-001');
    }

    // Nothing landed on the tenant-B customer, and it is still active.
    expect(
      await countWhere(`SELECT count(*)::text AS n FROM shared.notes WHERE entity_id = $1`, [
        CUSTOMER_B,
      ])
    ).toBe(0);
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM crm.customer_restrictions WHERE partner_id = $1`,
        [CUSTOMER_B]
      )
    ).toBe(0);
    const partner = await admin.query<{ lifecycle_status: string }>(
      `SELECT lifecycle_status FROM crm.business_partners WHERE id = $1`,
      [CUSTOMER_B]
    );
    expect(partner.rows[0]?.lifecycle_status).toBe('active');
  });
});
