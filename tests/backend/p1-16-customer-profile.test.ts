/**
 * Customer profile components — contacts, addresses, preferences, consents, end
 * to end (Phase 1-16, FR-CRM-002, FR-CRM-004, BR-CRM-002, P1-16-BE-004…007).
 *
 * These four routes are the module's IDOR and re-parenting surface: each takes a
 * customer id from the path and writes a child row under it. The suite's central
 * claims are that the parent always comes from the path, that a customer in
 * another tenant is indistinguishable from one that does not exist, and that a
 * preference can never manufacture a consent.
 *
 * Operations exercised here: crm.contact-add, crm.address-add,
 * crm.preference-set, crm.consent-record.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   crm.contact-add: route service authorization success denial cross-tenant audit idempotency
 *   crm.address-add: route service authorization success denial cross-tenant audit idempotency
 *   crm.preference-set: route service authorization success denial cross-tenant audit idempotency
 *   crm.consent-record: route service authorization success denial cross-tenant audit outbox rollback idempotency
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
import { POST as ADD_CONTACT } from '@/app/api/v1/customers/[customerId]/contacts/route';
import { POST as ADD_ADDRESS } from '@/app/api/v1/customers/[customerId]/addresses/route';
import { PUT as SET_PREFERENCE } from '@/app/api/v1/customers/[customerId]/preferences/route';
import { POST as RECORD_CONSENT } from '@/app/api/v1/customers/[customerId]/consents/route';

const ROLE_A = 'c1620000-0000-4000-8000-0000000000a1';
const USER_PROFILE_A = 'c1620000-0000-4000-8000-0000000000a2';
const SUBJECT_A = 'fx_p1_16_crm_profile_a';
const CUSTOMER_A = 'c1620000-0000-4000-8000-0000000000c1';
const CUSTOMER_A2 = 'c1620000-0000-4000-8000-0000000000c2';
const CUSTOMER_B = 'c1620000-0000-4000-8000-0000000000d1';

interface Body {
  readonly id?: string;
  readonly customerId?: string;
  readonly status?: string;
  readonly previousStatus?: string | null;
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

/** All four operations declare `idempotent: true`, so a key is mandatory. */
function request(path: string, method: string, body: unknown, key = crypto.randomUUID()): Request {
  return new Request(`http://localhost/api/v1/customers/${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify(body),
  });
}

const route = (customerId: string) => ({ params: Promise.resolve({ customerId }) });

function addContact(customerId: string, body: unknown, key?: string): Promise<Response> {
  return ADD_CONTACT(request(`${customerId}/contacts`, 'POST', body, key), route(customerId));
}
function addAddress(customerId: string, body: unknown, key?: string): Promise<Response> {
  return ADD_ADDRESS(request(`${customerId}/addresses`, 'POST', body, key), route(customerId));
}
function setPreference(customerId: string, body: unknown, key?: string): Promise<Response> {
  return SET_PREFERENCE(request(`${customerId}/preferences`, 'PUT', body, key), route(customerId));
}
function recordConsent(customerId: string, body: unknown, key?: string): Promise<Response> {
  return RECORD_CONSENT(request(`${customerId}/consents`, 'POST', body, key), route(customerId));
}

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
     VALUES ('crm.customer.profile.write', 'crm', 'Maintain customer contacts, addresses, and preferences', 'medium', $1),
            ('crm.customer.consent.write', 'crm', 'Record customer consent decisions', 'high', $1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, 'crm-profile@example.test', 'CRM Profile', 'active', $5)
     ON CONFLICT (id) DO NOTHING`,
    [USER_PROFILE_A, TENANT_A, IDENTITY_PROVIDER, SUBJECT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, 'fx_p1_16_crm_profile', 'P1-16 CRM profile', $3)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_A, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid, $2::uuid, p.id, 'allow', $3::uuid
       FROM iam.permissions p
      WHERE p.permission_code IN ('crm.customer.profile.write', 'crm.customer.consent.write')
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, ROLE_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1, $2, $3, 'unrestricted', $4, $4)`,
    [TENANT_A, USER_PROFILE_A, ROLE_A, USER_A]
  );

  // Two customers in tenant A, one in tenant B as the cross-tenant probe.
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
     VALUES ($1, $2, 'individual', 'Profile Fixture One', 'active', $5),
            ($3, $2, 'individual', 'Profile Fixture Two', 'active', $5),
            ($4, $6, 'individual', 'Tenant B Fixture', 'active', $5)
     ON CONFLICT (id) DO NOTHING`,
    [CUSTOMER_A, TENANT_A, CUSTOMER_A2, CUSTOMER_B, USER_A, TENANT_B]
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
  it('answers 401 on every route with no authenticator installed', async () => {
    __resetAuthenticatorForTests();
    for (const response of await Promise.all([
      addContact(CUSTOMER_A, { channel: 'email', value: 'a@b.test' }),
      addAddress(CUSTOMER_A, { addressType: 'billing', line1: 'A street' }),
      setPreference(CUSTOMER_A, { channel: 'email', purpose: 'reminder', preferred: true }),
      recordConsent(CUSTOMER_A, {
        consentKind: 'marketing',
        channel: 'email',
        purpose: 'marketing',
        status: 'granted',
      }),
    ])) {
      expect(response.status).toBe(401);
    }
  });

  it('answers 403 on every route for a caller holding neither CRM permission', async () => {
    authenticateAs(SUBJECT_UNPERMITTED);
    for (const response of await Promise.all([
      addContact(CUSTOMER_A, { channel: 'email', value: 'a@b.test' }),
      addAddress(CUSTOMER_A, { addressType: 'billing', line1: 'A street' }),
      setPreference(CUSTOMER_A, { channel: 'email', purpose: 'reminder', preferred: true }),
      recordConsent(CUSTOMER_A, {
        consentKind: 'marketing',
        channel: 'email',
        purpose: 'marketing',
        status: 'granted',
      }),
    ])) {
      expect(response.status).toBe(403);
      expect(((await response.json()) as Body).code).toBe('ERR-IAM-001');
    }
  });
});

describe('contacts', () => {
  it('stores the normalized value alongside what the customer actually gave us', async () => {
    authenticateAs(SUBJECT_A);
    const response = await addContact(CUSTOMER_A, {
      channel: 'email',
      value: '  Layla.Haddad@Example.TEST ',
      label: 'work',
    });
    const body = (await response.json()) as Body;
    expect(response.status).toBe(201);

    const row = await admin.query<{
      normalized_value: string;
      raw_value: string;
      partner_id: string;
    }>(`SELECT normalized_value, raw_value, partner_id FROM crm.contact_points WHERE id = $1`, [
      body.id,
    ]);
    expect(row.rows[0]?.normalized_value).toBe('layla.haddad@example.test');
    expect(row.rows[0]?.raw_value).toBe('Layla.Haddad@Example.TEST');
    // The parent is the path segment, not anything the body could influence.
    expect(row.rows[0]?.partner_id).toBe(CUSTOMER_A);

    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM iam.audit_records
          WHERE action = 'crm.customer.contact_added' AND entity_id = $1`,
        [body.id]
      )
    ).toBe(1);
  });

  it('does not copy the contact value into the audit trail', async () => {
    authenticateAs(SUBJECT_A);
    const body = (await (
      await addContact(CUSTOMER_A, { channel: 'mobile', value: '+962 79 555 1234' })
    ).json()) as Body;
    const details = await admin.query<{
      field_name: string;
      old_value_masked: string | null;
      new_value_masked: string | null;
    }>(
      `SELECT d.field_name, d.old_value_masked, d.new_value_masked
         FROM iam.audit_record_details d
         JOIN iam.audit_records a ON a.id = d.audit_record_id
        WHERE a.action = 'crm.customer.contact_added' AND a.entity_id = $1`,
      [body.id]
    );
    expect(details.rows.length).toBeGreaterThan(0);
    // The channel and primacy are recorded; the number itself never is.
    expect(JSON.stringify(details.rows)).not.toContain('5551234');
    expect(JSON.stringify(details.rows)).not.toContain('962');
    expect(details.rows.map((d) => d.field_name)).toContain('channel');
  });

  it('promotes a new primary by demoting the old one in the same transaction', async () => {
    authenticateAs(SUBJECT_A);
    await addContact(CUSTOMER_A2, {
      channel: 'email',
      value: 'first@example.test',
      isPrimary: true,
    });
    const second = (await (
      await addContact(CUSTOMER_A2, {
        channel: 'email',
        value: 'second@example.test',
        isPrimary: true,
      })
    ).json()) as Body;

    // `uq_contact_points_primary_active` allows exactly one; the second request
    // succeeded, so the first must have been demoted rather than conflicting.
    const primaries = await admin.query<{ id: string }>(
      `SELECT id FROM crm.contact_points
        WHERE partner_id = $1 AND channel = 'email' AND is_primary AND deleted_at IS NULL`,
      [CUSTOMER_A2]
    );
    expect(primaries.rows).toHaveLength(1);
    expect(primaries.rows[0]?.id).toBe(second.id);
  });

  it('refuses a value the platform cannot normalize', async () => {
    authenticateAs(SUBJECT_A);
    const response = await addContact(CUSTOMER_A, { channel: 'email', value: 'not-an-email' });
    expect(response.status).toBe(422);
    expect(((await response.json()) as Body).code).toBe('ERR-VAL-001');
  });

  it('rejects a body that tries to name its own parent', async () => {
    authenticateAs(SUBJECT_A);
    const response = await addContact(CUSTOMER_A, {
      channel: 'email',
      value: 'x@example.test',
      partnerId: CUSTOMER_A2,
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as Body).code).toBe('ERR-VAL-001');
  });
});

describe('addresses', () => {
  it('creates an address under the path customer and audits it', async () => {
    authenticateAs(SUBJECT_A);
    const body = (await (
      await addAddress(CUSTOMER_A, {
        addressType: 'billing',
        line1: '12 Rainbow Street',
        city: 'Amman',
        countryCode: 'jo',
      })
    ).json()) as Body;

    const row = await admin.query<{ partner_id: string; country_code: string }>(
      `SELECT partner_id, country_code FROM crm.addresses WHERE id = $1`,
      [body.id]
    );
    expect(row.rows[0]?.partner_id).toBe(CUSTOMER_A);
    // Upper-cased to the column's format contract rather than refused.
    expect(row.rows[0]?.country_code).toBe('JO');
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM iam.audit_records
          WHERE action = 'crm.customer.address_added' AND entity_id = $1`,
        [body.id]
      )
    ).toBe(1);
  });

  it('refuses a country code that is not two letters', async () => {
    authenticateAs(SUBJECT_A);
    const response = await addAddress(CUSTOMER_A, {
      addressType: 'billing',
      line1: 'A street',
      countryCode: '12',
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as Body).code).toBe('ERR-VAL-001');
  });
});

describe('preferences', () => {
  it('is an upsert keyed by channel and purpose, not an append', async () => {
    authenticateAs(SUBJECT_A);
    const first = (await (
      await setPreference(CUSTOMER_A, { channel: 'email', purpose: 'marketing', preferred: true })
    ).json()) as Body;
    const second = (await (
      await setPreference(CUSTOMER_A, { channel: 'email', purpose: 'marketing', preferred: false })
    ).json()) as Body;

    expect(second.id).toBe(first.id);
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM crm.communication_preferences
          WHERE partner_id = $1 AND channel = 'email' AND purpose = 'marketing'`,
        [CUSTOMER_A]
      )
    ).toBe(1);

    const row = await admin.query<{ preferred: boolean }>(
      `SELECT preferred FROM crm.communication_preferences WHERE id = $1`,
      [first.id]
    );
    expect(row.rows[0]?.preferred).toBe(false);
    // Two audited changes against one row: the state moved twice.
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM iam.audit_records
          WHERE action = 'crm.customer.preference_changed' AND entity_id = $1`,
        [first.id]
      )
    ).toBe(2);
  });

  it('never writes consent history — a preference is not a permission', async () => {
    authenticateAs(SUBJECT_A);
    const before = await countWhere(
      `SELECT count(*)::text AS n FROM crm.consent_history WHERE partner_id = $1`,
      [CUSTOMER_A2]
    );
    await setPreference(CUSTOMER_A2, { channel: 'email', purpose: 'marketing', preferred: true });
    const after = await countWhere(
      `SELECT count(*)::text AS n FROM crm.consent_history WHERE partner_id = $1`,
      [CUSTOMER_A2]
    );
    expect(after).toBe(before);
  });
});

describe('consents', () => {
  it('appends the decision, server-stamps the actor, audits it, and publishes an event', async () => {
    authenticateAs(SUBJECT_A);
    const body = (await (
      await recordConsent(CUSTOMER_A, {
        consentKind: 'marketing',
        channel: 'email',
        purpose: 'marketing',
        status: 'granted',
        source: 'signed form',
      })
    ).json()) as Body;

    const row = await admin.query<{ recorded_by: string; status: string; effective_at: Date }>(
      `SELECT recorded_by, status, effective_at FROM crm.consent_history WHERE id = $1`,
      [body.id]
    );
    // Attributed to the authenticated caller, not to anything the body said.
    expect(row.rows[0]?.recorded_by).toBe(USER_PROFILE_A);
    expect(row.rows[0]?.status).toBe('granted');
    expect(body.previousStatus).toBeNull();

    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM iam.audit_records
          WHERE action = 'crm.customer.consent_changed' AND entity_id = $1`,
        [body.id]
      )
    ).toBe(1);
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM shared.event_outbox
          WHERE event_type = 'consent.changed' AND aggregate_id = $1`,
        [CUSTOMER_A]
      )
    ).toBe(1);
  });

  it('preserves the withdrawal history instead of overwriting the grant', async () => {
    authenticateAs(SUBJECT_A);
    await recordConsent(CUSTOMER_A2, {
      consentKind: 'privacy',
      channel: 'mobile',
      purpose: 'transactional',
      status: 'granted',
    });
    const withdrawal = (await (
      await recordConsent(CUSTOMER_A2, {
        consentKind: 'privacy',
        channel: 'mobile',
        purpose: 'transactional',
        status: 'withdrawn',
      })
    ).json()) as Body;

    // The event and the response both carry the transition, not just the state.
    expect(withdrawal.previousStatus).toBe('granted');
    expect(withdrawal.status).toBe('withdrawn');
    // Both decisions survive: the trail is the record.
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM crm.consent_history
          WHERE partner_id = $1 AND consent_kind = 'privacy'`,
        [CUSTOMER_A2]
      )
    ).toBe(2);
  });

  it('refuses "expired" — expiry happens, it is not asserted', async () => {
    authenticateAs(SUBJECT_A);
    const response = await recordConsent(CUSTOMER_A, {
      consentKind: 'marketing',
      channel: 'email',
      purpose: 'marketing',
      status: 'expired',
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as Body).code).toBe('ERR-VAL-001');
  });

  it('leaves no consent row, audit record, or event when the contact point is not this customer’s', async () => {
    authenticateAs(SUBJECT_A);
    // A real contact point — but it belongs to a different customer.
    const foreign = (await (
      await addContact(CUSTOMER_A2, { channel: 'email', value: 'foreign@example.test' })
    ).json()) as Body;

    const consentsBefore = await countWhere(
      `SELECT count(*)::text AS n FROM crm.consent_history WHERE partner_id = $1`,
      [CUSTOMER_A]
    );
    const eventsBefore = await countWhere(
      `SELECT count(*)::text AS n FROM shared.event_outbox
        WHERE event_type = 'consent.changed' AND aggregate_id = $1`,
      [CUSTOMER_A]
    );

    const response = await recordConsent(CUSTOMER_A, {
      consentKind: 'marketing',
      channel: 'email',
      purpose: 'marketing',
      status: 'granted',
      contactPointId: foreign.id,
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as Body).code).toBe('ERR-VAL-001');

    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM crm.consent_history WHERE partner_id = $1`,
        [CUSTOMER_A]
      )
    ).toBe(consentsBefore);
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM shared.event_outbox
          WHERE event_type = 'consent.changed' AND aggregate_id = $1`,
        [CUSTOMER_A]
      )
    ).toBe(eventsBefore);
    // No orphaned audit record survived the rolled-back transaction.
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM iam.audit_records a
          WHERE a.action = 'crm.customer.consent_changed'
            AND NOT EXISTS (SELECT 1 FROM crm.consent_history c WHERE c.id = a.entity_id)`,
        []
      )
    ).toBe(0);
  });
});

describe('idempotent replay', () => {
  it('replays each of the four operations instead of writing a second child row', async () => {
    authenticateAs(SUBJECT_A);
    const keys = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    const contact = { channel: 'email', value: 'replay@example.test' };
    const address = { addressType: 'service', line1: 'Replay Street 9' };
    const preference = { channel: 'other', purpose: 'reminder', preferred: true };
    const consent = {
      consentKind: 'marketing',
      channel: 'other',
      purpose: 'reminder',
      status: 'granted',
    };

    const first = [
      (await (await addContact(CUSTOMER_A2, contact, keys[0])).json()) as Body,
      (await (await addAddress(CUSTOMER_A2, address, keys[1])).json()) as Body,
      (await (await setPreference(CUSTOMER_A2, preference, keys[2])).json()) as Body,
      (await (await recordConsent(CUSTOMER_A2, consent, keys[3])).json()) as Body,
    ];
    const second = [
      (await (await addContact(CUSTOMER_A2, contact, keys[0])).json()) as Body,
      (await (await addAddress(CUSTOMER_A2, address, keys[1])).json()) as Body,
      (await (await setPreference(CUSTOMER_A2, preference, keys[2])).json()) as Body,
      (await (await recordConsent(CUSTOMER_A2, consent, keys[3])).json()) as Body,
    ];

    // Same stored response, so the retry created nothing new.
    for (const [index, replayed] of second.entries()) {
      expect(replayed.id).toBe(first[index]?.id);
    }
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM crm.contact_points
          WHERE partner_id = $1 AND normalized_value = 'replay@example.test'`,
        [CUSTOMER_A2]
      )
    ).toBe(1);
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM crm.addresses
          WHERE partner_id = $1 AND line1 = 'Replay Street 9'`,
        [CUSTOMER_A2]
      )
    ).toBe(1);
    // Consent is append-only, so a replay that was not deduplicated would leave
    // a second decision behind — the one place a lost idempotency guarantee
    // would corrupt a legal record rather than merely duplicate a row.
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM crm.consent_history
          WHERE partner_id = $1 AND consent_kind = 'marketing' AND channel = 'other'`,
        [CUSTOMER_A2]
      )
    ).toBe(1);
    // Scoped to *this* consent's event key rather than the customer: the same
    // customer legitimately has other consent events from earlier decisions, and
    // the claim under test is that the replay published nothing extra.
    expect(
      await countWhere(`SELECT count(*)::text AS n FROM shared.event_outbox WHERE event_key = $1`, [
        `consent.changed:${first[3]?.id ?? ''}`,
      ])
    ).toBe(1);
  });
});

describe('tenant isolation and existence leakage', () => {
  it('answers the same 404 for another tenant’s customer as for one that never existed', async () => {
    authenticateAs(SUBJECT_A);
    const unknown = '00000000-0000-4000-8000-00000000ffff';

    const foreignResponse = await addContact(CUSTOMER_B, {
      channel: 'email',
      value: 'probe@example.test',
    });
    const unknownResponse = await addContact(unknown, {
      channel: 'email',
      value: 'probe@example.test',
    });

    const foreign = (await foreignResponse.json()) as Body;
    const missing = (await unknownResponse.json()) as Body;
    // Identical status and identical code: the route is not an oracle for
    // "does this id exist in some other tenant".
    expect(foreignResponse.status).toBe(404);
    expect(unknownResponse.status).toBe(404);
    expect(foreign.code).toBe('ERR-RES-001');
    expect(missing.code).toBe(foreign.code);

    // And nothing was written to the tenant-B customer.
    expect(
      await countWhere(`SELECT count(*)::text AS n FROM crm.contact_points WHERE partner_id = $1`, [
        CUSTOMER_B,
      ])
    ).toBe(0);
  });

  it('refuses every other route against a cross-tenant customer too', async () => {
    authenticateAs(SUBJECT_A);
    const responses = await Promise.all([
      addAddress(CUSTOMER_B, { addressType: 'billing', line1: 'Probe street' }),
      setPreference(CUSTOMER_B, { channel: 'email', purpose: 'reminder', preferred: true }),
      recordConsent(CUSTOMER_B, {
        consentKind: 'marketing',
        channel: 'email',
        purpose: 'marketing',
        status: 'granted',
      }),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(404);
    }
    expect(
      await countWhere(`SELECT count(*)::text AS n FROM crm.addresses WHERE partner_id = $1`, [
        CUSTOMER_B,
      ])
    ).toBe(0);
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM crm.consent_history WHERE partner_id = $1`,
        [CUSTOMER_B]
      )
    ).toBe(0);
  });
});
