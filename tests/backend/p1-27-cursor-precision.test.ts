/**
 * Keyset cursors must carry a `timestamptz` column's full precision
 * (`P1-27-INT-006`).
 *
 * ## The defect
 *
 * `pg` decodes `timestamptz` into a JS `Date`, which holds milliseconds;
 * PostgreSQL stores microseconds. The decoder computes
 * `1000 * parseFloat('.123456')` = `123.456` and `Date.UTC` truncates toward
 * zero, so `.toISOString()` is STRICTLY EARLIER than the stored value whenever
 * the sub-millisecond digits are non-zero.
 *
 * Put that in a cursor and the descending predicate `(sort, id) < ($v, $i)`
 * compares `.123456 > .123000` on its FIRST element. It is false, the `id`
 * tie-break is never consulted, and every row sharing the boundary's
 * millisecond at a higher microsecond is **silently skipped** — not duplicated.
 * Skipped, which is the mode nobody notices.
 *
 * ## Why these relations and not a synthetic one
 *
 * A batch written in ONE transaction shares `transaction_timestamp()` to the
 * microsecond by construction. A duplicate scan and a multi-row consent write
 * are the two places this codebase does exactly that, so for them the collision
 * is a certainty rather than a race — which is what makes this suite a
 * regression test and not a probability argument.
 *
 * Every fixture below therefore writes its rows in a SINGLE statement.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  IDENTITY_PROVIDER,
  TENANT_A,
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
import { cursorTimestamp } from '@/server/db/pagination';
import { GET as LIST_CUSTOMER_DUPLICATES } from '@/app/api/v1/customer-duplicates/route';
import { GET as LIST_CONSENTS } from '@/app/api/v1/customers/[customerId]/consents/route';

const ROLE = 'c1270000-0000-4000-8000-00000000a001';
const READER = 'c1270000-0000-4000-8000-00000000a002';
const SUBJECT = 'fx_p1_27_cursor_reader';

const CUSTOMER = 'c1270000-0000-4000-8000-00000000b001';
/** Ten partners, so ten distinct candidate PAIRS can share one instant. */
const PARTNERS = Array.from(
  { length: 10 },
  (_, index) => `c1270000-0000-4000-8000-0000000000${(0xc0 + index).toString(16)}`
);

/** One microsecond-precise instant, with non-zero sub-millisecond digits. */
const INSTANT = '2026-08-04 10:00:00.123456+00';

interface PageBody {
  readonly items?: readonly { readonly id: string }[];
  readonly nextCursor?: string | null;
  readonly hasMore?: boolean;
}

let admin: Pool;
let runtime: Pool;

function authenticate(): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: SUBJECT,
      tenantId: TENANT_A,
    })
  );
}

/** Walks every page of a list, returning the ids in order. */
async function walk(
  call: (query: string) => Promise<Response>,
  limit: number
): Promise<readonly string[]> {
  const seen: string[] = [];
  let cursor: string | null = null;
  // Bounded so a cursor that fails to advance ends the test rather than the
  // process — an infinite loop would look like a hang, not a failure.
  for (let page = 0; page < 20; page += 1) {
    const query: string = cursor
      ? `?limit=${limit}&cursor=${encodeURIComponent(cursor)}`
      : `?limit=${limit}`;
    const response = await call(query);
    expect(response.status, `page ${page}`).toBe(200);
    const body = (await response.json()) as PageBody;
    seen.push(...(body.items ?? []).map((item) => item.id));
    if (!body.hasMore || !body.nextCursor) return seen;
    cursor = body.nextCursor;
  }
  throw new Error('cursor did not terminate within 20 pages');
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);

  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ('crm.customer.duplicate.review', 'crm', 'Scan for and review duplicate customer candidates', 'medium', $1),
            ('crm.customer.read', 'crm', 'Search and read customers in the tenant', 'low', $1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, 'cursor-reader@example.test', 'Cursor Reader', 'active', $5)
     ON CONFLICT (id) DO NOTHING`,
    [READER, TENANT_A, IDENTITY_PROVIDER, SUBJECT, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, 'fx_p1_27_cursor', 'P1-27 cursor reader', $3)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid, $2::uuid, p.id, 'allow', $3::uuid
       FROM iam.permissions p
      WHERE p.permission_code IN ('crm.customer.duplicate.review', 'crm.customer.read')
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, ROLE, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1, $2, $3, 'unrestricted', $4, $4)`,
    [TENANT_A, READER, ROLE, USER_A]
  );

  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
     SELECT id, $2, 'individual', 'Cursor Fixture ' || ordinality, 'active', $3
       FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, ordinality)
     ON CONFLICT (id) DO NOTHING`,
    [[CUSTOMER, ...PARTNERS], TENANT_A, USER_A]
  );

  // Ten candidate pairs, ONE statement, one explicit microsecond instant. Each
  // pair is (CUSTOMER, partner) ordered to satisfy ck_duplicate_candidates_order.
  await admin.query(
    `INSERT INTO crm.duplicate_candidates
       (tenant_id, partner_id_a, partner_id_b, match_score, match_basis, detected_at, created_by)
     SELECT $1,
            least($2::uuid, p),
            greatest($2::uuid, p),
            0.9000,
            '[{"signal":"name","weight":50}]'::jsonb,
            $4::timestamptz,
            $5
       FROM unnest($3::uuid[]) AS p`,
    [TENANT_A, CUSTOMER, PARTNERS, INSTANT, USER_A]
  );

  // Ten consent rows at the same instant. `crm.guard_consent_insert` demands an
  // actor, so the fixture supplies one rather than the guard being bypassed.
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [READER]);
    await client.query(
      `INSERT INTO crm.consent_history
         (tenant_id, partner_id, consent_kind, channel, purpose, status, effective_at, recorded_by)
       SELECT $1, $2, 'marketing', 'email', 'marketing', 'granted', $3::timestamptz, $4
         FROM generate_series(1, 10)`,
      [TENANT_A, CUSTOMER, INSTANT, READER]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);
});

afterEach(() => {
  __resetAuthenticatorForTests();
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

describe('the premise: the rows really do share one microsecond', () => {
  it('stores ten candidates and ten consents at one instant, and pg truncates it', async () => {
    // Without this the suite could pass because the fixture failed to create the
    // collision, which would make every assertion below vacuous.
    const candidates = await admin.query<{ n: string; at: string }>(
      `SELECT count(*)::text AS n, max(detected_at::text) AS at
         FROM crm.duplicate_candidates WHERE tenant_id = $1`,
      [TENANT_A]
    );
    expect(candidates.rows[0]?.n).toBe('10');
    expect(candidates.rows[0]?.at).toContain('.123456');

    const consents = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM crm.consent_history
        WHERE tenant_id = $1 AND effective_at = $2::timestamptz`,
      [TENANT_A, INSTANT]
    );
    expect(consents.rows[0]?.n).toBe('10');

    // And the truncation itself, measured rather than assumed: the JS Date pg
    // hands back renders .123, strictly below the stored .123456.
    const decoded = await admin.query<{ at: Date }>(
      `SELECT detected_at AS at FROM crm.duplicate_candidates WHERE tenant_id = $1 LIMIT 1`,
      [TENANT_A]
    );
    expect(decoded.rows[0]?.at.toISOString()).toBe('2026-08-04T10:00:00.123Z');
  });

  it('renders a cursor value that round-trips to the exact stored instant', async () => {
    const rendered = await admin.query<{ v: string; exact: boolean }>(
      `SELECT ${cursorTimestamp('detected_at')} AS v,
              (${cursorTimestamp('detected_at')}::timestamptz = detected_at) AS exact
         FROM crm.duplicate_candidates WHERE tenant_id = $1 LIMIT 1`,
      [TENANT_A]
    );
    expect(rendered.rows[0]?.v).toBe('2026-08-04T10:00:00.123456Z');
    // The property the whole fix rests on. A rendering that did not round-trip
    // would move the boundary instead of preserving it.
    expect(rendered.rows[0]?.exact).toBe(true);
    // And it is still a timestamp any client can parse.
    expect(Number.isNaN(new Date(rendered.rows[0]?.v ?? '').getTime())).toBe(false);
  });
});

describe('paging a batch written at one instant loses nothing', () => {
  it('walks all ten duplicate candidates across pages of three', async () => {
    authenticate();
    const ids = await walk(
      (query) =>
        LIST_CUSTOMER_DUPLICATES(
          new Request(`http://localhost/api/v1/customer-duplicates${query}`, { method: 'GET' })
        ),
      3
    );
    // Against a millisecond cursor this returns 3, not 10: page 2's predicate is
    // false for every remaining row because .123456 > .123000.
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size, 'no row returned twice').toBe(10);
  });

  it('walks all ten consent rows across pages of four', async () => {
    authenticate();
    const ids = await walk(
      (query) =>
        LIST_CONSENTS(
          new Request(`http://localhost/api/v1/customers/${CUSTOMER}/consents${query}`, {
            method: 'GET',
          }),
          { params: Promise.resolve({ customerId: CUSTOMER }) }
        ),
      4
    );
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size, 'no row returned twice').toBe(10);
  });

  it('terminates rather than repeating a page forever', async () => {
    // The other way a broken cursor fails: one that never advances would serve
    // the same page indefinitely. `walk` throws past 20 pages, so reaching this
    // assertion at all is the proof.
    authenticate();
    const ids = await walk(
      (query) =>
        LIST_CUSTOMER_DUPLICATES(
          new Request(`http://localhost/api/v1/customer-duplicates${query}`, { method: 'GET' })
        ),
      1
    );
    expect(ids).toHaveLength(10);
  });
});
