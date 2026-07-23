/**
 * POST /api/v1/customers/individuals and /companies — customer creation, end to
 * end (Phase 1-16, FR-CRM-001, FR-CRM-002, P1-16-BE-002, P1-16-BE-003).
 *
 * Drives the real routes through the fixed pipeline against a real database on
 * the least-privilege `app_runtime` role. The claim under test is not "a row
 * appears" but "the partner row, its profile, the allocated customer number, the
 * audit record, and the outbox event are one atomic fact" — so the suite proves
 * both that all five land together and that an injected failure leaves none of
 * them, including the sequence counter.
 *
 * Operations exercised here: crm.individual-create, crm.company-create.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   crm.individual-create: route service authorization success denial cross-tenant audit outbox rollback idempotency
 *   crm.company-create: route service authorization success denial cross-tenant audit outbox idempotency
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
import { POST as CREATE_INDIVIDUAL } from '@/app/api/v1/customers/individuals/route';
import { POST as CREATE_COMPANY } from '@/app/api/v1/customers/companies/route';
import { GET as SEARCH } from '@/app/api/v1/customers/route';

const WRITER_ROLE_A = 'c1610000-0000-4000-8000-0000000000a1';
const WRITER_USER_A = 'c1610000-0000-4000-8000-0000000000a2';
const WRITER_SUBJECT_A = 'fx_p1_16_crm_writer_a';
const WRITER_ROLE_B = 'c1610000-0000-4000-8000-0000000000b1';
const WRITER_USER_B = 'c1610000-0000-4000-8000-0000000000b2';
const WRITER_SUBJECT_B = 'fx_p1_16_crm_writer_b';

const INDIVIDUALS = 'http://localhost/api/v1/customers/individuals';
const COMPANIES = 'http://localhost/api/v1/customers/companies';

interface CreatedBody {
  readonly customerId?: string;
  readonly displayNumber?: string | null;
  readonly partyType?: string;
  readonly lifecycleStatus?: string;
  readonly possibleDuplicates?: readonly { readonly id: string; readonly displayName: string }[];
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

/**
 * Both operations declare `idempotent: true`, so the pipeline requires an
 * `Idempotency-Key`. A fresh key per call is the normal case; passing one
 * explicitly is how the replay test sends the *same* request twice.
 */
function createIndividual(body: unknown, idempotencyKey = crypto.randomUUID()): Promise<Response> {
  return CREATE_INDIVIDUAL(
    new Request(INDIVIDUALS, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify(body),
    })
  );
}

function createCompany(body: unknown, idempotencyKey = crypto.randomUUID()): Promise<Response> {
  return CREATE_COMPANY(
    new Request(COMPANIES, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify(body),
    })
  );
}

/** Seeds a CRM writer/reader identity in `tenantId`, grant included. */
async function seedWriter(
  tenantId: string,
  roleId: string,
  userId: string,
  subject: string
): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, $4 || '@example.test', 'CRM Writer', 'active', $5)
     ON CONFLICT (id) DO NOTHING`,
    [userId, tenantId, IDENTITY_PROVIDER, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, $3, 'P1-16 CRM writer', $4)
     ON CONFLICT (id) DO NOTHING`,
    [roleId, tenantId, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid, $2::uuid, p.id, 'allow', $3::uuid
       FROM iam.permissions p
      WHERE p.permission_code IN ('crm.customer.create', 'crm.customer.read')
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [tenantId, roleId, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1, $2, $3, 'unrestricted', $4, $4)`,
    [tenantId, userId, roleId, USER_A]
  );
}

async function auditCount(customerId: string): Promise<number> {
  const result = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM iam.audit_records
      WHERE action = 'crm.customer.created' AND entity_id = $1`,
    [customerId]
  );
  return Number(result.rows[0]?.n ?? '0');
}

async function outboxCount(customerId: string): Promise<number> {
  const result = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM shared.event_outbox
      WHERE event_type = 'business-partner.created' AND aggregate_id = $1`,
    [customerId]
  );
  return Number(result.rows[0]?.n ?? '0');
}

async function sequenceNextValue(): Promise<string | null> {
  const result = await admin.query<{ next_value: string }>(
    `SELECT next_value::text FROM shared.number_sequences
      WHERE tenant_id = $1 AND sequence_code = 'business_partner'
        AND company_id IS NULL AND branch_id IS NULL`,
    [TENANT_A]
  );
  return result.rows[0]?.next_value ?? null;
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);

  // Seeded platform codes (seed 04). Inserting them is a no-op wherever the seed
  // has run; it keeps this suite runnable on a dev database predating them.
  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ('crm.customer.create', 'crm', 'Create individual and company customers', 'medium', $1),
            ('crm.customer.read',   'crm', 'Search and read customers in the tenant', 'low',    $1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );
  await seedWriter(TENANT_A, WRITER_ROLE_A, WRITER_USER_A, WRITER_SUBJECT_A);
  await seedWriter(TENANT_B, WRITER_ROLE_B, WRITER_USER_B, WRITER_SUBJECT_B);

  // Provision the customer-number sequence for tenant A only, so the suite
  // covers both branches: an allocated number here, and `null` in tenant B
  // where no sequence is configured.
  await admin.query(
    `INSERT INTO shared.number_sequences
       (tenant_id, sequence_code, prefix_template, next_value, pad_width, created_by)
     VALUES ($1, 'business_partner', 'CUST-', 1, 6, $2)
     ON CONFLICT ON CONSTRAINT uq_number_sequences_scope DO NOTHING`,
    [TENANT_A, USER_A]
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
  it('answers 401 with no authenticator installed', async () => {
    __resetAuthenticatorForTests();
    const response = await createIndividual({ givenName: 'A', familyName: 'B' });
    expect(response.status).toBe(401);
    expect(((await response.json()) as CreatedBody).code).toBe('ERR-IAM-002');
  });

  it('answers 403 for an authenticated caller lacking crm.customer.create', async () => {
    authenticateAs(SUBJECT_UNPERMITTED);
    const response = await createIndividual({ givenName: 'Denied', familyName: 'Caller' });
    const body = (await response.json()) as CreatedBody;
    expect(response.status).toBe(403);
    expect(body.code).toBe('ERR-IAM-001');
    expect(body.customerId).toBeUndefined();
  });

  it('refuses the company route to the same unpermitted caller', async () => {
    authenticateAs(SUBJECT_UNPERMITTED);
    const response = await createCompany({ legalName: 'Denied Holdings' });
    expect(response.status).toBe(403);
    expect(((await response.json()) as CreatedBody).code).toBe('ERR-IAM-001');
  });
});

describe('individual creation writes one atomic fact', () => {
  it('creates the partner, its profile, an allocated number, an audit record, and an outbox event', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const before = await sequenceNextValue();

    const response = await createIndividual({
      givenName: '  Layla  ',
      familyName: 'Haddad',
      lifecycleStatus: 'active',
    });
    const body = (await response.json()) as CreatedBody;

    expect(response.status).toBe(201);
    const customerId = body.customerId ?? '';
    expect(customerId).not.toBe('');
    expect(body.partyType).toBe('individual');
    expect(body.lifecycleStatus).toBe('active');
    // Allocated in the same transaction from the provisioned sequence.
    expect(body.displayNumber).toBe('CUST-000001');
    expect(await sequenceNextValue()).not.toBe(before);

    const partner = await admin.query<{
      display_name: string;
      party_type: string;
      tenant_id: string;
    }>(`SELECT display_name, party_type, tenant_id FROM crm.business_partners WHERE id = $1`, [
      customerId,
    ]);
    // Whitespace was collapsed and the display name derived from the profile.
    expect(partner.rows[0]?.display_name).toBe('Layla Haddad');
    expect(partner.rows[0]?.party_type).toBe('individual');
    expect(partner.rows[0]?.tenant_id).toBe(TENANT_A);

    const profile = await admin.query<{ given_name: string; family_name: string }>(
      `SELECT given_name, family_name FROM crm.individual_profiles WHERE partner_id = $1`,
      [customerId]
    );
    expect(profile.rows).toHaveLength(1);
    expect(profile.rows[0]?.given_name).toBe('Layla');

    expect(await auditCount(customerId)).toBe(1);
    expect(await outboxCount(customerId)).toBe(1);
  });

  it('publishes an event carrying no personal data', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const body = (await (
      await createIndividual({ givenName: 'Omar', familyName: 'Nasser' })
    ).json()) as CreatedBody;
    const event = await admin.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM shared.event_outbox
        WHERE event_type = 'business-partner.created' AND aggregate_id = $1`,
      [body.customerId]
    );
    const payload = event.rows[0]?.payload ?? {};
    expect(Object.keys(payload).sort()).toEqual([
      'customerId',
      'hasDisplayNumber',
      'lifecycleStatus',
      'partyType',
    ]);
    expect(JSON.stringify(payload)).not.toContain('Omar');
    expect(JSON.stringify(payload)).not.toContain('Nasser');
  });

  it('reports an exact-name collision as advisory without refusing the creation', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const first = (await (
      await createIndividual({ givenName: 'Sami', familyName: 'Qasem' })
    ).json()) as CreatedBody;

    const response = await createIndividual({ givenName: 'sami', familyName: 'QASEM' });
    const second = (await response.json()) as CreatedBody;
    expect(response.status).toBe(201);
    expect(second.customerId).not.toBe(first.customerId);
    // Normalisation makes the collision visible across casing.
    expect((second.possibleDuplicates ?? []).map((d) => d.id)).toContain(first.customerId);
  });
});

describe('idempotent replay', () => {
  it('creates exactly one customer when the same request is retried with one key', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const key = crypto.randomUUID();
    const body = { givenName: 'Retry', familyName: 'Once' };

    const first = (await (await createIndividual(body, key)).json()) as CreatedBody;
    const second = (await (await createIndividual(body, key)).json()) as CreatedBody;

    // The retry replays the stored response rather than creating a second
    // customer — which is what makes a client-side retry safe after a timeout.
    expect(second.customerId).toBe(first.customerId);
    const rows = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM crm.business_partners
        WHERE tenant_id = $1 AND display_name = 'Retry Once'`,
      [TENANT_A]
    );
    expect(rows.rows[0]?.n).toBe('1');
    expect(await auditCount(first.customerId ?? '')).toBe(1);
    expect(await outboxCount(first.customerId ?? '')).toBe(1);
  });

  it('replays a repeated company creation without creating a second organization', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const key = crypto.randomUUID();
    const body = { legalName: 'Replay Holdings LLC' };

    const first = (await (await createCompany(body, key)).json()) as CreatedBody;
    const second = (await (await createCompany(body, key)).json()) as CreatedBody;

    expect(second.customerId).toBe(first.customerId);
    const rows = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM crm.business_partners
        WHERE tenant_id = $1 AND display_name = 'Replay Holdings LLC'`,
      [TENANT_A]
    );
    expect(rows.rows[0]?.n).toBe('1');
    // One company profile, one audit record, one event — not two of any.
    const profiles = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM crm.company_profiles WHERE partner_id = $1`,
      [first.customerId]
    );
    expect(profiles.rows[0]?.n).toBe('1');
    expect(await auditCount(first.customerId ?? '')).toBe(1);
    expect(await outboxCount(first.customerId ?? '')).toBe(1);
  });
});

describe('company creation', () => {
  it('creates the organization partner and its company profile', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const response = await createCompany({ legalName: 'Nadir Trading LLC', tradeName: 'Nadir' });
    const body = (await response.json()) as CreatedBody;

    expect(response.status).toBe(201);
    expect(body.partyType).toBe('organization');

    const partner = await admin.query<{ display_name: string; party_type: string }>(
      `SELECT display_name, party_type FROM crm.business_partners WHERE id = $1`,
      [body.customerId]
    );
    // The legal name is the identity; the trade name is stored but is not it.
    expect(partner.rows[0]?.display_name).toBe('Nadir Trading LLC');
    expect(partner.rows[0]?.party_type).toBe('organization');

    const profile = await admin.query<{ legal_name: string; trade_name: string | null }>(
      `SELECT legal_name, trade_name FROM crm.company_profiles WHERE partner_id = $1`,
      [body.customerId]
    );
    expect(profile.rows[0]?.trade_name).toBe('Nadir');
    // No individual profile was created — the party type came from the path.
    const individual = await admin.query(
      `SELECT 1 FROM crm.individual_profiles WHERE partner_id = $1`,
      [body.customerId]
    );
    expect(individual.rows).toHaveLength(0);

    expect(await auditCount(body.customerId ?? '')).toBe(1);
    expect(await outboxCount(body.customerId ?? '')).toBe(1);
  });

  it('creates without a number where the tenant has provisioned no sequence', async () => {
    authenticateAs(WRITER_SUBJECT_B, TENANT_B);
    const body = (await (
      await createCompany({ legalName: 'Tenant B Supplies' })
    ).json()) as CreatedBody;
    // Not an error: the customer exists, it simply has no number yet.
    expect(body.displayNumber).toBeNull();
  });
});

describe('tenant isolation', () => {
  it('never exposes a customer created in another tenant', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const mine = (await (
      await createCompany({ legalName: 'Isolation Probe A' })
    ).json()) as CreatedBody;

    authenticateAs(WRITER_SUBJECT_B, TENANT_B);
    const theirs = (await (
      await createCompany({ legalName: 'Isolation Probe B' })
    ).json()) as CreatedBody;

    // Tenant B searches: it sees its own and not tenant A's.
    const asB = (await (
      await SEARCH(
        new Request('http://localhost/api/v1/customers?name=isolation', { method: 'GET' })
      )
    ).json()) as { items?: readonly { id: string }[] };
    const idsB = (asB.items ?? []).map((h) => h.id);
    expect(idsB).toContain(theirs.customerId);
    expect(idsB).not.toContain(mine.customerId);

    authenticateAs(WRITER_SUBJECT_A);
    const asA = (await (
      await SEARCH(
        new Request('http://localhost/api/v1/customers?name=isolation', { method: 'GET' })
      )
    ).json()) as { items?: readonly { id: string }[] };
    const idsA = (asA.items ?? []).map((h) => h.id);
    expect(idsA).toContain(mine.customerId);
    expect(idsA).not.toContain(theirs.customerId);
  });
});

describe('validation and rollback', () => {
  it('rejects an unknown body field (strict schema — no mass assignment)', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const response = await createIndividual({
      givenName: 'Over',
      familyName: 'Poster',
      // A caller must not be able to choose the tenant, the actor, or the type.
      tenantId: TENANT_B,
      partyType: 'organization',
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as CreatedBody).code).toBe('ERR-VAL-001');
  });

  it('rejects a whitespace-only name the length check alone would accept', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const response = await createIndividual({ givenName: '   ', familyName: 'Ghost' });
    expect(response.status).toBe(422);
    expect(((await response.json()) as CreatedBody).code).toBe('ERR-VAL-001');
  });

  it('leaves no partner, profile, audit, outbox row, or burnt number when the transaction fails', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const sequenceBefore = await sequenceNextValue();
    const partnersBefore = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM crm.business_partners WHERE tenant_id = $1`,
      [TENANT_A]
    );

    // Passes the edge schema, then fails at the profile insert on the locale FK
    // — after the partner row was written and a number was allocated.
    const response = await createIndividual({
      givenName: 'Rolled',
      familyName: 'Back',
      preferredLocale: 'zz-ZZ',
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as CreatedBody).code).toBe('ERR-VAL-001');

    const partner = await admin.query(
      `SELECT id FROM crm.business_partners WHERE tenant_id = $1 AND display_name = 'Rolled Back'`,
      [TENANT_A]
    );
    expect(partner.rows).toHaveLength(0);

    const partnersAfter = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM crm.business_partners WHERE tenant_id = $1`,
      [TENANT_A]
    );
    expect(partnersAfter.rows[0]?.n).toBe(partnersBefore.rows[0]?.n);

    const orphanAudit = await admin.query(
      `SELECT 1 FROM iam.audit_records a
        WHERE a.action = 'crm.customer.created'
          AND NOT EXISTS (SELECT 1 FROM crm.business_partners p WHERE p.id = a.entity_id)`
    );
    expect(orphanAudit.rows).toHaveLength(0);

    const orphanEvent = await admin.query(
      `SELECT 1 FROM shared.event_outbox e
        WHERE e.event_type = 'business-partner.created'
          AND NOT EXISTS (SELECT 1 FROM crm.business_partners p WHERE p.id = e.aggregate_id)`
    );
    expect(orphanEvent.rows).toHaveLength(0);

    // The rolled-back attempt did not consume a customer number.
    expect(await sequenceNextValue()).toBe(sequenceBefore);
  });
});
