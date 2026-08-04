/**
 * Customer read contracts — the customer and its eight components, end to end
 * (Phase 1-16 remediation, `P1-27-INT-001`).
 *
 * Before this remediation every customer sub-resource was write-only over HTTP
 * and there was no route module for a customer at all, so nothing in the
 * platform could return a customer or anything attached to one. These nine reads
 * close that, and this suite exists to prove the four things that are easy to get
 * wrong in a read and impossible to notice afterwards:
 *
 *  1. **Tombstones stay dead.** Contacts, addresses and notes are soft-deleted,
 *     and a read that ignored `deleted_at` would resurrect a phone number
 *     somebody deliberately removed — the failure mode that ends with a call to
 *     the wrong person.
 *  2. **"In force" means in force.** An alert can be stopped two independent
 *     ways (`active`, `effective_to`); reading one without the other shows a
 *     caution that was already turned off.
 *  3. **A `date` is a day, not an instant.** `pg` decodes OID 1082 into a JS
 *     `Date` at LOCAL midnight, so `toISOString().slice(0, 10)` moves the day
 *     back by one east of UTC. The date tests below run with `TZ=Asia/Riyadh`
 *     installed on the process, so they FAIL against a `Date`-based
 *     implementation rather than passing by accident on a UTC build agent.
 *  4. **A shorter list is not the same as a complete one.** `sel_notes_tenant`
 *     hides restricted notes silently; the flag that says so is part of the
 *     contract.
 *
 * Operations exercised here: crm.customer-read, crm.contact-list,
 * crm.address-list, crm.preference-list, crm.consent-list, crm.note-list,
 * crm.alert-list, crm.tag-list, crm.restriction-list.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   crm.customer-read: route service authorization success denial cross-tenant
 *   crm.contact-list: route service authorization success denial cross-tenant
 *   crm.address-list: route service authorization success denial cross-tenant
 *   crm.preference-list: route service authorization success denial cross-tenant
 *   crm.consent-list: route service authorization success denial cross-tenant
 *   crm.note-list: route service authorization success denial cross-tenant
 *   crm.alert-list: route service authorization success denial cross-tenant
 *   crm.tag-list: route service authorization success denial cross-tenant
 *   crm.restriction-list: route service authorization success denial cross-tenant
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
import { GET as READ_CUSTOMER } from '@/app/api/v1/customers/[customerId]/route';
import { GET as LIST_CONTACTS } from '@/app/api/v1/customers/[customerId]/contacts/route';
import { GET as LIST_ADDRESSES } from '@/app/api/v1/customers/[customerId]/addresses/route';
import { GET as LIST_PREFERENCES } from '@/app/api/v1/customers/[customerId]/preferences/route';
import { GET as LIST_CONSENTS } from '@/app/api/v1/customers/[customerId]/consents/route';
import { GET as LIST_NOTES } from '@/app/api/v1/customers/[customerId]/notes/route';
import { GET as LIST_ALERTS } from '@/app/api/v1/customers/[customerId]/alerts/route';
import { GET as LIST_TAGS } from '@/app/api/v1/customers/[customerId]/tags/route';
import { GET as LIST_RESTRICTIONS } from '@/app/api/v1/customers/[customerId]/restrictions/route';

const ROLE_READ = 'c1620000-0000-4000-8000-0000000000e1';
const ROLE_SENSITIVE = 'c1620000-0000-4000-8000-0000000000e2';
const USER_READER = 'c1620000-0000-4000-8000-0000000000e3';
const USER_SENSITIVE = 'c1620000-0000-4000-8000-0000000000e4';
const SUBJECT_READER = 'fx_p1_16_crm_reader';
const SUBJECT_SENSITIVE = 'fx_p1_16_crm_sensitive';

const PERSON = 'c1620000-0000-4000-8000-0000000000f1';
const COMPANY = 'c1620000-0000-4000-8000-0000000000f2';
const MERGED = 'c1620000-0000-4000-8000-0000000000f3';
const SURVIVOR = 'c1620000-0000-4000-8000-0000000000f4';
const OTHER_TENANT = 'c1620000-0000-4000-8000-0000000000f5';
const UNKNOWN = 'c1620000-0000-4000-8000-0000000000ff';

const SEGMENT_LIVE = 'c1620000-0000-4000-8000-00000000e001';
const SEGMENT_RETIRED = 'c1620000-0000-4000-8000-00000000e002';

/** The pilot deployment's zone. Nothing here is correct only in UTC. */
const EAST_OF_UTC = 'Asia/Riyadh';

interface PageBody<T> {
  readonly items?: readonly T[];
  readonly nextCursor?: string | null;
  readonly hasMore?: boolean;
  readonly includesRestricted?: boolean;
  readonly code?: string;
}

interface CustomerBody {
  readonly id?: string;
  readonly displayName?: string;
  readonly partyType?: string;
  readonly recordVersion?: number;
  readonly givenName?: string | null;
  readonly familyName?: string | null;
  readonly legalName?: string | null;
  readonly tradeName?: string | null;
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

const route = (customerId: string) => ({ params: Promise.resolve({ customerId }) });

/** Reads never carry an idempotency key; declaring one would be a lie. */
function get(path: string, query = ''): Request {
  return new Request(`http://localhost/api/v1/customers/${path}${query}`, { method: 'GET' });
}

type Handler = (
  request: Request,
  route: { params: Promise<{ customerId: string }> }
) => Promise<Response>;

/**
 * Every read, keyed by its REGISTERED OPERATION ID.
 *
 * The id rather than a friendly label, for two reasons. It is what a failing
 * sweep should name, because "crm.tag-list answered 200" is actionable and
 * "tags answered 200" is a guess. And the coverage ratchet in
 * `tests/foundation/operation-coverage-gate.test.ts` strips comments before
 * looking for the id, so an id that lives only in a COVERAGE-EVIDENCE header is
 * counted as debt — correctly, since a comment cannot exercise anything. Here
 * the ids are executable.
 */
const READS: readonly {
  readonly id: string;
  readonly segment: string;
  readonly handler: Handler;
}[] = [
  { id: 'crm.customer-read', segment: '', handler: READ_CUSTOMER },
  { id: 'crm.contact-list', segment: '/contacts', handler: LIST_CONTACTS },
  { id: 'crm.address-list', segment: '/addresses', handler: LIST_ADDRESSES },
  { id: 'crm.preference-list', segment: '/preferences', handler: LIST_PREFERENCES },
  { id: 'crm.consent-list', segment: '/consents', handler: LIST_CONSENTS },
  { id: 'crm.note-list', segment: '/notes', handler: LIST_NOTES },
  { id: 'crm.alert-list', segment: '/alerts', handler: LIST_ALERTS },
  { id: 'crm.tag-list', segment: '/tags', handler: LIST_TAGS },
  { id: 'crm.restriction-list', segment: '/restrictions', handler: LIST_RESTRICTIONS },
];

function call(read: (typeof READS)[number], customerId: string, query = ''): Promise<Response> {
  return read.handler(get(`${customerId}${read.segment}`, query), route(customerId));
}

/**
 * Runs `body` with the process clock east of UTC, then restores.
 *
 * Node re-reads `process.env.TZ` on each `Date` construction, and `pg`'s `date`
 * decoder builds a local-midnight `Date` — so this is what turns the
 * `date`-fidelity assertions into real tests instead of ones that pass on a UTC
 * agent whatever the implementation does.
 */
async function withEasternClock<T>(body: () => Promise<T>): Promise<T> {
  const previous = process.env.TZ;
  process.env.TZ = EAST_OF_UTC;
  try {
    return await body();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);

  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ('crm.customer.read', 'crm', 'Search and read customers in the tenant', 'low', $1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $3, $4, $5, 'crm-reader@example.test', 'CRM Reader', 'active', $7),
            ($2, $3, $4, $6, 'crm-sensitive@example.test', 'CRM Sensitive', 'active', $7)
     ON CONFLICT (id) DO NOTHING`,
    [
      USER_READER,
      USER_SENSITIVE,
      TENANT_A,
      IDENTITY_PROVIDER,
      SUBJECT_READER,
      SUBJECT_SENSITIVE,
      USER_A,
    ]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $3, 'fx_p1_16_crm_read', 'P1-16 CRM read', $4),
            ($2, $3, 'fx_p1_16_crm_sensitive', 'P1-16 CRM read + sensitive', $4)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_READ, ROLE_SENSITIVE, TENANT_A, USER_A]
  );
  // One role reads customers. The other reads customers AND holds
  // iam.sensitive.view — the capability sel_notes_tenant gates restricted notes
  // on. Two roles, because the whole point is to observe the difference.
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid, $2::uuid, p.id, 'allow', $3::uuid
       FROM iam.permissions p WHERE p.permission_code = 'crm.customer.read'
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, ROLE_READ, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid, $2::uuid, p.id, 'allow', $3::uuid
       FROM iam.permissions p
      WHERE p.permission_code IN ('crm.customer.read', 'iam.sensitive.view')
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, ROLE_SENSITIVE, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1, $2, $4, 'unrestricted', $6, $6),
            ($1, $3, $5, 'unrestricted', $6, $6)`,
    [TENANT_A, USER_READER, USER_SENSITIVE, ROLE_READ, ROLE_SENSITIVE, USER_A]
  );

  await admin.query(
    `INSERT INTO crm.business_partners
       (id, tenant_id, party_type, display_name, display_number, lifecycle_status, created_by)
     VALUES ($1, $6, 'individual',   'Layla Haddad',   'C-0001', 'active', $7),
            ($2, $6, 'organization', 'Cedar Motors',   'C-0002', 'active', $7),
            ($3, $6, 'individual',   'Merged Away',    'C-0003', 'active', $7),
            ($4, $6, 'individual',   'The Survivor',   'C-0004', 'active', $7),
            ($5, $8, 'individual',   'Tenant B Person','C-0005', 'active', $7)
     ON CONFLICT (id) DO NOTHING`,
    [PERSON, COMPANY, MERGED, SURVIVOR, OTHER_TENANT, TENANT_A, USER_A, TENANT_B]
  );
  await admin.query(
    `INSERT INTO crm.individual_profiles
       (tenant_id, partner_id, party_type, given_name, family_name, preferred_locale, created_by)
     VALUES ($1, $2, 'individual', 'Layla', 'Haddad', 'ar', $3)
     ON CONFLICT DO NOTHING`,
    [TENANT_A, PERSON, USER_A]
  );
  await admin.query(
    `INSERT INTO crm.company_profiles
       (tenant_id, partner_id, party_type, legal_name, trade_name, created_by)
     VALUES ($1, $2, 'organization', 'Cedar Motors LLC', 'Cedar', $3)
     ON CONFLICT DO NOTHING`,
    [TENANT_A, COMPANY, USER_A]
  );
  // Both columns together: `ck_business_partners_merged_coherent` makes
  // `lifecycle_status = 'merged'` and a non-null `merged_into_id` the same fact,
  // so a fixture that set only one would not be a merged customer at all.
  await admin.query(
    `UPDATE crm.business_partners
        SET merged_into_id = $2, lifecycle_status = 'merged'
      WHERE id = $1`,
    [MERGED, SURVIVOR]
  );

  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);
});

afterEach(() => {
  __resetAuthenticatorForTests();
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  // Guarded, so a `beforeAll` that failed before the pools existed reports its
  // own error rather than being masked by a TypeError in teardown.
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

describe('authentication and authorization', () => {
  it('answers 401 on all nine reads with no authenticator installed', async () => {
    __resetAuthenticatorForTests();
    for (const read of READS) {
      const response = await call(read, PERSON);
      expect(response.status, read.id).toBe(401);
    }
  });

  it('answers 403 on all nine reads for a caller without crm.customer.read', async () => {
    authenticateAs(SUBJECT_UNPERMITTED);
    for (const read of READS) {
      const response = await call(read, PERSON);
      expect(response.status, read.id).toBe(403);
      expect(((await response.json()) as CustomerBody).code, read.id).toBe('ERR-IAM-001');
    }
  });

  it('lets a plain reader see restrictions, which only the manage role can impose', async () => {
    await admin.query(
      `INSERT INTO crm.customer_restrictions
         (tenant_id, partner_id, restriction_type, reason, imposed_by, effective_from, created_by)
       VALUES ($1, $2, 'no_service', 'Repeated abusive conduct toward staff', $3, current_date, $3)`,
      [TENANT_A, PERSON, USER_A]
    );
    authenticateAs(SUBJECT_READER);
    const body = (await (await call(READS[8]!, PERSON)).json()) as PageBody<{ reason: string }>;
    // A restriction nobody at the counter can see does not restrict anything.
    expect(body.items?.length).toBe(1);
    expect(body.items?.[0]?.reason).toContain('abusive');
  });
});

describe('the parent is resolved first, on every read', () => {
  /**
   * The central IDOR claim, swept across all nine operations rather than spot-
   * checked on one: a customer in another tenant, a customer that was merged
   * away, and an id that never existed must be indistinguishable.
   *
   * Merged is in the list deliberately. It is the one of the three that a naive
   * `tenant_id = $1 AND id = $2` lookup would let through, because the row is
   * still there — it was redirected, not deleted.
   */
  it.each([
    ['a customer in another tenant', OTHER_TENANT],
    ['a customer merged into another', MERGED],
    ['an id that never existed', UNKNOWN],
  ])('answers the same 404 for %s', async (_label, customerId) => {
    authenticateAs(SUBJECT_READER);
    for (const read of READS) {
      const response = await call(read, customerId);
      expect(response.status, read.id).toBe(404);
      expect(((await response.json()) as CustomerBody).code, read.id).toBe('ERR-RES-001');
    }
  });

  /**
   * A malformed id never reaches the database.
   *
   * Asserted as a THROW, not as a 422, and that is not a concession — it is the
   * shape all 141 route modules in this platform have carried since P1-13:
   * `parseOrFail` on the path runs BEFORE `handleOperation`, so it rejects
   * outside the block that turns an `AppFailure` into a problem document.
   *
   * Whether the framework converts that into an RFC 9457 response or a bare 500
   * is a foundation question this remediation does not answer and must not
   * silently change (`P1-16-A-02`). What is in scope, and is what this asserts,
   * is that no non-uuid ever becomes a query parameter.
   */
  it('rejects a malformed id before it reaches the database', async () => {
    authenticateAs(SUBJECT_READER);
    await expect(READ_CUSTOMER(get('not-a-uuid'), route('not-a-uuid'))).rejects.toMatchObject({
      code: 'ERR-VAL-001',
    });
  });
});

describe('the customer itself', () => {
  it('returns the individual profile and publishes the concurrency token', async () => {
    authenticateAs(SUBJECT_READER);
    const response = await call(READS[0]!, PERSON);
    const body = (await response.json()) as CustomerBody;

    expect(response.status).toBe(200);
    expect(body.displayName).toBe('Layla Haddad');
    expect(body.partyType).toBe('individual');
    expect(body.givenName).toBe('Layla');
    expect(body.familyName).toBe('Haddad');
    // Null, not absent: the shape does not change with the party type.
    expect(body.legalName).toBeNull();

    // record_version has always existed and was never published, so every write
    // was a last-writer-wins race with no way for a client to send If-Match.
    expect(typeof body.recordVersion).toBe('number');
    expect(response.headers.get('ETag')).not.toBeNull();
  });

  it('returns the company profile for an organization', async () => {
    authenticateAs(SUBJECT_READER);
    const body = (await (await call(READS[0]!, COMPANY)).json()) as CustomerBody;
    expect(body.legalName).toBe('Cedar Motors LLC');
    expect(body.tradeName).toBe('Cedar');
    expect(body.givenName).toBeNull();
  });
});

describe('soft-deleted rows never come back', () => {
  it('omits a deleted contact point while keeping the live ones', async () => {
    const live = 'c1620000-0000-4000-8000-00000000a101';
    const dead = 'c1620000-0000-4000-8000-00000000a102';
    await admin.query(
      `INSERT INTO crm.contact_points
         (id, tenant_id, partner_id, channel, normalized_value, raw_value, is_primary, created_by)
       VALUES ($1, $3, $4, 'email', 'live@example.test', 'live@example.test', true, $5),
              ($2, $3, $4, 'email', 'gone@example.test', 'gone@example.test', false, $5)`,
      [live, dead, TENANT_A, PERSON, USER_A]
    );
    await admin.query(`UPDATE crm.contact_points SET deleted_at = now() WHERE id = $1`, [dead]);

    authenticateAs(SUBJECT_READER);
    const body = (await (await call(READS[1]!, PERSON)).json()) as PageBody<{
      id: string;
      isPrimary: boolean;
    }>;
    expect(body.items?.map((row) => row.id)).toEqual([live]);
    // The field the screen ranks by travels with the row, because the SQL
    // ordering is the one a cursor can guarantee and nothing more.
    expect(body.items?.[0]?.isPrimary).toBe(true);
  });

  it('omits a deleted address', async () => {
    const dead = 'c1620000-0000-4000-8000-00000000a201';
    await admin.query(
      `INSERT INTO crm.addresses
         (id, tenant_id, partner_id, address_type, line1, country_code, created_by)
       VALUES ($1, $2, $3, 'billing', 'Deleted Street', 'SA', $4)`,
      [dead, TENANT_A, PERSON, USER_A]
    );
    await admin.query(`UPDATE crm.addresses SET deleted_at = now() WHERE id = $1`, [dead]);

    authenticateAs(SUBJECT_READER);
    const body = (await (await call(READS[2]!, PERSON)).json()) as PageBody<{ line1: string }>;
    expect(body.items?.some((row) => row.line1 === 'Deleted Street')).toBe(false);
  });

  it('omits a retired note', async () => {
    const dead = 'c1620000-0000-4000-8000-00000000a301';
    await admin.query(
      `INSERT INTO shared.notes
         (id, tenant_id, entity_type, entity_id, author_id, body, classification, visibility, created_by)
       VALUES ($1, $2, 'crm.business_partners', $3, $4, 'Withdrawn note', 'internal', 'internal', $4)`,
      [dead, TENANT_A, PERSON, USER_READER]
    );
    await admin.query(`UPDATE shared.notes SET deleted_at = now() WHERE id = $1`, [dead]);

    authenticateAs(SUBJECT_READER);
    const body = (await (await call(READS[5]!, PERSON)).json()) as PageBody<{ body: string }>;
    // The policy grants UPDATE on deleted_at and no DELETE, so retiring a note is
    // a soft delete — and a read that ignored it would resurrect one.
    expect(body.items?.some((row) => row.body === 'Withdrawn note')).toBe(false);
  });
});

describe('alerts in force', () => {
  const inForce = 'c1620000-0000-4000-8000-00000000b101';
  const switchedOff = 'c1620000-0000-4000-8000-00000000b102';
  const expired = 'c1620000-0000-4000-8000-00000000b103';

  beforeAll(async () => {
    await admin.query(
      `INSERT INTO crm.customer_alerts
         (id, tenant_id, partner_id, alert_type, severity, message, active, effective_from, effective_to, created_by)
       VALUES ($1, $4, $5, 'safety',      'critical', 'Airbag recall outstanding', true,  DATE '2026-08-04', NULL,              $6),
              ($2, $4, $5, 'operational', 'info',     'Turned off by a manager',   false, DATE '2026-08-04', NULL,              $6),
              ($3, $4, $5, 'financial',   'warning',  'Ended last year',           true,  DATE '2025-01-01', DATE '2025-06-01', $6)`,
      [inForce, switchedOff, expired, TENANT_A, COMPANY, USER_A]
    );
  });

  it('excludes an alert stopped either way, and shows the one that is live', async () => {
    authenticateAs(SUBJECT_READER);
    const body = (await (await call(READS[6]!, COMPANY)).json()) as PageBody<{
      id: string;
      severity: string;
    }>;
    // Both conditions, because the table carries two independent ways to stop an
    // alert. Reading one without the other shows a caution already turned off,
    // and a false alert costs trust in every true one after it.
    expect(body.items?.map((row) => row.id)).toEqual([inForce]);
    expect(body.items?.[0]?.severity).toBe('critical');
    expect(body.items?.some((row) => row.id === switchedOff)).toBe(false);
    expect(body.items?.some((row) => row.id === expired)).toBe(false);
  });

  it('publishes the effective date as the day it is, east of UTC', async () => {
    await withEasternClock(async () => {
      authenticateAs(SUBJECT_READER);
      const body = (await (await call(READS[6]!, COMPANY)).json()) as PageBody<{
        effectiveFrom: string;
      }>;
      // The stored value is DATE '2026-08-04'. `pg` decodes a date into a JS Date
      // at LOCAL midnight, so an implementation that called `.toISOString()` on
      // it would answer '2026-08-03' here — a day early, silently, only for
      // deployments east of UTC. Reading the column as ::text has no timezone in
      // the path at all.
      expect(body.items?.[0]?.effectiveFrom).toBe('2026-08-04');
    });
  });
});

describe('notes and what a caller is not shown', () => {
  const plain = 'c1620000-0000-4000-8000-00000000c101';
  const restricted = 'c1620000-0000-4000-8000-00000000c102';

  beforeAll(async () => {
    await admin.query(
      `INSERT INTO shared.notes
         (id, tenant_id, entity_type, entity_id, author_id, body, classification, visibility, created_by)
       VALUES ($1, $3, 'crm.business_partners', $4, $5, 'Routine note',   'internal',   'internal', $5),
              ($2, $3, 'crm.business_partners', $4, $5, 'Sensitive note', 'restricted', 'internal', $5)`,
      // `fk_notes_author` is composite — (tenant_id, author_id) into
      // iam.user_accounts — and USER_A is the bootstrap actor id used for
      // `created_by`, not a user row. The author has to be a real account in
      // this tenant, so it is the reader fixture.
      [plain, restricted, TENANT_A, COMPANY, USER_READER]
    );
  });

  it('hides a restricted note from a plain reader and says the list may be short', async () => {
    authenticateAs(SUBJECT_READER);
    const body = (await (await call(READS[5]!, COMPANY)).json()) as PageBody<{ id: string }>;
    expect(body.items?.map((row) => row.id)).toEqual([plain]);
    // Without this flag the screen would state "this customer has one note" and
    // be wrong. It says whether the caller holds the capability — never how many
    // notes were withheld, because that count is itself information about
    // restricted material.
    expect(body.includesRestricted).toBe(false);
  });

  it('shows both to a caller holding iam.sensitive.view', async () => {
    authenticateAs(SUBJECT_SENSITIVE);
    const body = (await (await call(READS[5]!, COMPANY)).json()) as PageBody<{ id: string }>;
    expect(body.items?.length).toBe(2);
    expect(body.includesRestricted).toBe(true);
  });

  it('does not return a note attached to a different entity type', async () => {
    // The read is scoped by the same (entity_type, entity_id) discriminator the
    // write policy pins. A note filed against a vehicle with the same uuid must
    // not surface on a customer.
    await admin.query(
      `INSERT INTO shared.notes
         (tenant_id, entity_type, entity_id, author_id, body, classification, visibility, created_by)
       VALUES ($1, 'veh.vehicles', $2, $3, 'Belongs to a vehicle', 'internal', 'internal', $3)`,
      [TENANT_A, COMPANY, USER_READER]
    );
    authenticateAs(SUBJECT_SENSITIVE);
    const body = (await (await call(READS[5]!, COMPANY)).json()) as PageBody<{ body: string }>;
    expect(body.items?.some((row) => row.body === 'Belongs to a vehicle')).toBe(false);
  });
});

describe('tags', () => {
  beforeAll(async () => {
    await admin.query(
      `INSERT INTO crm.customer_segments (id, tenant_id, segment_code, name, created_by)
       VALUES ($1, $3, 'fx_vip',     'VIP',             $4),
              ($2, $3, 'fx_retired', 'Retired concept', $4)`,
      [SEGMENT_LIVE, SEGMENT_RETIRED, TENANT_A, USER_A]
    );
    await admin.query(`UPDATE crm.customer_segments SET deleted_at = now() WHERE id = $1`, [
      SEGMENT_RETIRED,
    ]);
    await admin.query(
      `INSERT INTO crm.partner_segment_assignments
         (tenant_id, partner_id, segment_id, assigned_by, valid_from, valid_to, created_by)
       VALUES ($1, $2, $3, $6, DATE '2026-01-01', NULL,              $6),
              ($1, $2, $4, $6, DATE '2026-01-01', NULL,              $6),
              ($1, $5, $3, $6, DATE '2025-01-01', DATE '2025-02-01', $6)`,
      [TENANT_A, PERSON, SEGMENT_LIVE, SEGMENT_RETIRED, SURVIVOR, USER_A]
    );
  });

  it('names the segment, and drops assignments to a retired one', async () => {
    authenticateAs(SUBJECT_READER);
    const body = (await (await call(READS[7]!, PERSON)).json()) as PageBody<{
      segmentCode: string;
      name: string;
      validFrom: string;
    }>;
    expect(body.items?.map((row) => row.segmentCode)).toEqual(['fx_vip']);
    // Joined rather than returning a bare id: two staff typing "VIP" get one
    // concept, and the screen needs the label the tenant defined.
    expect(body.items?.[0]?.name).toBe('VIP');
  });

  it('drops an assignment whose validity has ended', async () => {
    authenticateAs(SUBJECT_READER);
    const body = (await (await call(READS[7]!, SURVIVOR)).json()) as PageBody<unknown>;
    expect(body.items).toEqual([]);
    expect(body.hasMore).toBe(false);
  });

  it('publishes valid_from as a day, east of UTC', async () => {
    await withEasternClock(async () => {
      authenticateAs(SUBJECT_READER);
      const body = (await (await call(READS[7]!, PERSON)).json()) as PageBody<{
        validFrom: string;
      }>;
      expect(body.items?.[0]?.validFrom).toBe('2026-01-01');
    });
  });
});

describe('consent history', () => {
  beforeAll(async () => {
    // Two decisions about the same dimension tuple, written in ONE statement so
    // they share `effective_at` to the microsecond. That is the case `seq` exists
    // for, and the case an id tie-break would order arbitrarily. Two POSTs could
    // not produce it: `now()` is transaction time, so separate requests always
    // get separate timestamps and the tie would never arise.
    //
    // `crm.guard_consent_insert()` refuses a row with no actor in the session,
    // and it is right to — it is what stops a consent being attributed to
    // nobody. So the actor is set on this connection for the fixture, in a
    // transaction, rather than the guard being worked around.
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [USER_READER]);
      await client.query(
        `INSERT INTO crm.consent_history
           (tenant_id, partner_id, consent_kind, channel, purpose, status, source, effective_at, recorded_by)
         VALUES ($1, $2, 'marketing', 'email', 'marketing', 'granted',   'signed form', now(), $3),
                ($1, $2, 'marketing', 'email', 'marketing', 'withdrawn', 'phone call',  now(), $3)`,
        [TENANT_A, PERSON, USER_READER]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  it('returns the whole history, not a collapsed current answer', async () => {
    authenticateAs(SUBJECT_READER);
    const body = (await (await call(READS[4]!, PERSON)).json()) as PageBody<{
      status: string;
      seq: string;
      recordedBy: string;
    }>;
    const statuses = body.items?.map((row) => row.status) ?? [];
    // Both rows: collapsing the trail in the API would throw away the evidence
    // that makes a consent defensible.
    expect(statuses).toContain('granted');
    expect(statuses).toContain('withdrawn');

    // `seq` is bigint. It stays a string on the wire rather than being narrowed
    // to a JS number, and it is the only field that says which decision came
    // second when two share a timestamp.
    const seqs = body.items?.map((row) => row.seq) ?? [];
    expect(seqs.every((value) => typeof value === 'string')).toBe(true);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(body.items?.[0]?.recordedBy).toBe(USER_READER);
  });
});

describe('preferences', () => {
  beforeAll(async () => {
    await admin.query(
      `INSERT INTO crm.communication_preferences
         (tenant_id, partner_id, channel, purpose, preferred, preferred_locale, created_by)
       VALUES ($1, $2, 'email', 'reminder', true, 'ar', $3)`,
      [TENANT_A, PERSON, USER_A]
    );
  });

  it('publishes the record version each row would need for If-Match', async () => {
    authenticateAs(SUBJECT_READER);
    const body = (await (await call(READS[3]!, PERSON)).json()) as PageBody<{
      channel: string;
      recordVersion: number;
    }>;
    expect(body.items?.[0]?.channel).toBe('email');
    // Without this the preferences PUT is a last-writer-wins race that no client
    // can detect, because no operation published the value to put in If-Match.
    expect(typeof body.items?.[0]?.recordVersion).toBe('number');
  });
});

describe('pagination', () => {
  const many = 'c1620000-0000-4000-8000-00000000d001';

  beforeAll(async () => {
    await admin.query(
      `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
       VALUES ($1, $2, 'individual', 'Paginated Person', 'active', $3)
       ON CONFLICT (id) DO NOTHING`,
      [many, TENANT_A, USER_A]
    );
    // Distinct created_at values, so the keyset order is total and the page
    // boundary is a fact rather than a coincidence of insert order.
    for (let index = 0; index < 3; index += 1) {
      await admin.query(
        `INSERT INTO crm.contact_points
           (tenant_id, partner_id, channel, normalized_value, raw_value, created_at, created_by)
         VALUES ($1, $2, 'email', $3, $3, now() - ($4 || ' minutes')::interval, $5)`,
        [TENANT_A, many, `page${index}@example.test`, String(index), USER_A]
      );
    }
  });

  it('walks a bounded page and its continuation without a gap or a repeat', async () => {
    authenticateAs(SUBJECT_READER);
    const first = (await (await call(READS[1]!, many, '?limit=2')).json()) as PageBody<{
      id: string;
    }>;
    expect(first.items?.length).toBe(2);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBeTruthy();

    const second = (await (
      await call(READS[1]!, many, `?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`)
    ).json()) as PageBody<{ id: string }>;
    expect(second.items?.length).toBe(1);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();

    const seen = [...(first.items ?? []), ...(second.items ?? [])].map((row) => row.id);
    expect(new Set(seen).size).toBe(3);
  });

  it('refuses a cursor issued for a different list', async () => {
    authenticateAs(SUBJECT_READER);
    const contacts = (await (await call(READS[1]!, many, '?limit=1')).json()) as PageBody<unknown>;
    // Each list declares its own ordering contract key, so replaying a contacts
    // cursor against addresses fails loudly instead of producing a plausible
    // wrong page.
    const response = await call(
      READS[2]!,
      many,
      `?cursor=${encodeURIComponent(contacts.nextCursor ?? '')}`
    );
    // 400, not 422: a cursor is not caller-authored input to validate, it is a
    // token this API issued, and `ERR-PAG-001` says the token does not belong
    // here. The distinction is the error catalog's, not this test's.
    expect(response.status).toBe(400);
    expect(((await response.json()) as PageBody<unknown>).code).toBe('ERR-PAG-001');
  });

  it('refuses an unknown query parameter', async () => {
    authenticateAs(SUBJECT_READER);
    const response = await call(READS[1]!, many, '?limit=2&sort=name');
    expect(response.status).toBe(422);
  });
});
