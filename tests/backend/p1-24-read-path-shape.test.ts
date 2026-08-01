/**
 * P1-24 — read-path shape: query counts, pagination bounds and payload caps
 * (P1-24-BE-009, NFR-PERF-01).
 *
 * ===========================================================================
 * WHY THIS MEASURES SHAPE RATHER THAN MILLISECONDS
 * ===========================================================================
 * §20 of the phase brief is explicit: read the approved performance requirements
 * before testing, and do not invent thresholds. The approved requirement is
 * **`NFR-PERF-01`**, and the P1-12 traceability record states its status plainly —
 * "~1 ms median (**validation baseline**)", with `P1-OD-027` / `NFR-SCL` recorded as
 * UNRESOLVED. There is no approved production capacity figure. Asserting a wall-clock
 * budget here would therefore be asserting a number nobody has approved, on a
 * developer laptop, against a database sharing a machine with a test runner. It would
 * fail for reasons that have nothing to do with the code, and — worse — it would pass
 * for reasons that have nothing to do with the code.
 *
 * What CAN be asserted deterministically, and is what actually degrades under load,
 * is the SHAPE of a read:
 *
 *  - **the number of SQL statements must not grow with the number of rows.** That is
 *    the N+1 defect stated exactly. It is invisible on a two-row fixture and fatal on
 *    a real tenant, and no timing assertion on a small dataset can detect it.
 *  - **a page must be bounded.** An endpoint that will return every row it has is an
 *    export tool with a different name, and the failure arrives as memory rather than
 *    as latency.
 *
 * The honest wall-clock numbers are recorded separately, with their environment, in
 * `docs/phase-1/phase-1-24/evidence/performance-baseline.md`, and are labelled a
 * baseline rather than a pass.
 *
 * ===========================================================================
 * HOW THE COUNT IS TAKEN
 * ===========================================================================
 * The runtime pool is wrapped so every `query` a request issues is recorded. The
 * wrapper sits at the pool boundary — below the service, below the repository, below
 * the transaction helper — so it counts what PostgreSQL is actually asked, including
 * the `BEGIN`, the context setup and the `COMMIT`. Those fixed statements are part of
 * every request and are simply included in both measurements; what matters is the
 * DIFFERENCE between a small dataset and a larger one, and a constant cancels.
 *
 * The comparison is 1 row versus 12 — an N+1 would add eleven statements, which no
 * amount of connection noise can hide.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
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
import { __resetBackendConfigForTests } from '@/server/config/backend-config';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import {
  StaticClaimsAuthenticator,
  __resetAuthenticatorForTests,
  setSessionAuthenticator,
} from '@/server/context/principal';
import { MAX_PAGE_SIZE } from '@/server/db/pagination';
import { FakeIdentityProvider, iamModule, setIdentityProvider } from '@/modules/iam';
import { GET as USER_LIST } from '@/app/api/v1/iam/users/route';
import { GET as ROLE_LIST } from '@/app/api/v1/iam/roles/route';
import { GET as AUDIT_LIST } from '@/app/api/v1/audit-events/route';

let admin: Pool;
let runtime: Pool;

/** Tenant A caller holding the read permissions the three list routes declare. */
const U_PERF = 'd5000000-0000-4000-8000-000000000001';
const ROLE_PERF = 'd5100000-0000-4000-8000-000000000001';
const SUBJECT_PERF = 'fx_p24_perf_reader';

const PERMISSIONS = ['iam.user.read', 'iam.role.read', 'iam.audit.view', 'org.tenant.read'];

// ---------------------------------------------------------------------------
// Statement counting at the pool boundary
// ---------------------------------------------------------------------------

let statements: string[] = [];
let counting = false;
/** Clients are pooled and reused, so each is wrapped at most once. */
const wrapped = new WeakSet<PoolClient>();

function instrument(pool: Pool): void {
  const connect = pool.connect.bind(pool) as () => Promise<PoolClient>;
  const patched = async (): Promise<PoolClient> => {
    const client = await connect();
    if (!wrapped.has(client)) {
      wrapped.add(client);
      // `query` is heavily overloaded in pg's types and the wrapper must forward
      // verbatim, so it is typed through `unknown` rather than `any`: the point is
      // that this function does not interpret its arguments, only counts the call.
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
    return client;
  };
  (pool as unknown as { connect: unknown }).connect = patched;
}

/**
 * Runs the request ONCE and discards it, so the measurement that follows is of a
 * warm connection.
 *
 * A cold pool client issues session-setup statements a reused one does not — the
 * audit-list case measured 25 on the first call and 20 on the next, which looked
 * exactly like a read that got cheaper as the dataset grew. Comparing a cold call to
 * a warm one measures the pool, not the query.
 */
async function warm(run: () => Promise<Response>): Promise<void> {
  await run().then((response) => response.text());
}

async function measure(run: () => Promise<Response>): Promise<{
  readonly status: number;
  readonly body: unknown;
  readonly statements: readonly string[];
}> {
  statements = [];
  counting = true;
  try {
    const response = await run();
    const text = await response.text();
    return {
      status: response.status,
      body: text === '' ? null : JSON.parse(text),
      statements: [...statements],
    };
  } finally {
    counting = false;
  }
}

function authenticate(): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: SUBJECT_PERF,
      tenantId: TENANT_A,
    })
  );
}

const listUsers = (query: string): Promise<Response> => {
  authenticate();
  return USER_LIST(new Request(`http://localhost/api/v1/iam/users?${query}`));
};

const listRoles = (query: string): Promise<Response> => {
  authenticate();
  return ROLE_LIST(new Request(`http://localhost/api/v1/iam/roles?${query}`));
};

const listAudit = (query: string): Promise<Response> => {
  authenticate();
  return AUDIT_LIST(new Request(`http://localhost/api/v1/audit-events?${query}`));
};

/** Adds `count` extra tenant-A accounts. Fixture rows, removed with the tenant. */
async function addUsers(count: number): Promise<void> {
  for (let index = 0; index < count; index++) {
    await admin.query(
      `INSERT INTO iam.user_accounts
         (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'active', $6)`,
      [
        TENANT_A,
        IDENTITY_PROVIDER,
        `fx_p24_perf_${randomUUID()}`,
        `fx-p24-perf-${randomUUID()}@example.test`,
        'P1-24 perf fixture',
        USER_A,
      ]
    );
  }
}

async function addRoles(count: number): Promise<void> {
  for (let index = 0; index < count; index++) {
    await admin.query(
      `INSERT INTO iam.roles (tenant_id, role_code, name, created_by)
       VALUES ($1, $2, 'P1-24 perf role', $3)`,
      [TENANT_A, `fx_p24_perf_${randomUUID().replace(/-/g, '').slice(0, 16)}`, USER_A]
    );
  }
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  __resetBackendConfigForTests();

  // Installed before the composition root is touched: `installIamRuntime()` reads
  // Supabase credentials only when no provider is present (ADR-019).
  setIdentityProvider(
    new FakeIdentityProvider({
      secret: 'p1-24-read-path-secret-not-real',
      issuer: 'https://auth.test.local/auth/v1',
      audience: 'authenticated',
    })
  );

  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);

  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, 'fx-p24-perf-reader@example.test', 'P1-24 Perf Reader', 'active', $5)
     ON CONFLICT (id) DO NOTHING`,
    [U_PERF, TENANT_A, IDENTITY_PROVIDER, SUBJECT_PERF, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, 'fx_p24_perf_reader', 'P1-24 perf reader', $3)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_PERF, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, id, 'allow', $3 FROM iam.permissions WHERE permission_code = ANY($4::text[])
     ON CONFLICT DO NOTHING`,
    [TENANT_A, ROLE_PERF, USER_A, PERMISSIONS]
  );
  await admin.query('DELETE FROM iam.role_grants WHERE user_id = $1', [U_PERF]);
  await admin.query(
    `INSERT INTO iam.role_grants
       (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
     VALUES ($1, $2, $3, 'unrestricted', 'active', $4, $4)`,
    [TENANT_A, U_PERF, ROLE_PERF, USER_A]
  );

  runtime = runtimeAppPool(4);
  instrument(runtime);
  __setPrimaryPoolForTests(runtime);
  // Compose the module now: `installIamRuntime()` replaces the session
  // authenticator on first use, and doing that mid-measurement would add
  // statements that belong to composition rather than to the read.
  iamModule();
}, 180_000);

afterEach(() => {
  __resetAuthenticatorForTests();
});

afterAll(async () => {
  __resetAuthenticatorForTests();
  __setPrimaryPoolForTests(undefined);
  await runtime?.end();
  await cleanBackendFixtures(admin);
  await admin?.end();
});

describe('P1-24-BE-009 — a read issues the same number of statements whatever the row count', () => {
  it('iam.user-list does not add a statement per user', async () => {
    await addUsers(1);
    await warm(() => listUsers('limit=50'));
    const small = await measure(() => listUsers('limit=50'));
    expect(small.status).toBe(200);
    const smallItems = (small.body as { items: unknown[] }).items.length;

    await addUsers(11);
    const larger = await measure(() => listUsers('limit=50'));
    expect(larger.status).toBe(200);
    const largerItems = (larger.body as { items: unknown[] }).items.length;

    // The measurement is only meaningful if the second read really saw more rows.
    // Without this the assertion below would hold trivially against a broken query
    // that returned nothing.
    expect(largerItems).toBe(smallItems + 11);
    expect(larger.statements.length).toBe(small.statements.length);
  });

  it('iam.role-list does not add a statement per role', async () => {
    await addRoles(1);
    await warm(() => listRoles('limit=50'));
    const small = await measure(() => listRoles('limit=50'));
    expect(small.status).toBe(200);
    const smallItems = (small.body as { items: unknown[] }).items.length;

    await addRoles(11);
    const larger = await measure(() => listRoles('limit=50'));
    expect(larger.status).toBe(200);
    expect((larger.body as { items: unknown[] }).items.length).toBe(smallItems + 11);
    expect(larger.statements.length).toBe(small.statements.length);
  });

  it('iam.audit-event-list does not add a statement per record', async () => {
    const window = {
      from: new Date(Date.now() - 86_400_000).toISOString(),
      to: new Date(Date.now() + 86_400_000).toISOString(),
    };
    // Reading the audit trail is itself audited, so each call adds a record and the
    // NEXT call sees more — the dataset grows without any fixture help, which is
    // exactly the condition an N+1 would show up under.
    await warm(() => listAudit(`from=${window.from}&to=${window.to}&limit=50`));
    const first = await measure(() => listAudit(`from=${window.from}&to=${window.to}&limit=50`));
    expect(first.status).toBe(200);
    const firstItems = (first.body as { items: unknown[] }).items.length;

    for (let index = 0; index < 8; index++) {
      await listAudit(`from=${window.from}&to=${window.to}&limit=50`).then((r) => r.text());
    }

    const later = await measure(() => listAudit(`from=${window.from}&to=${window.to}&limit=50`));
    expect(later.status).toBe(200);
    expect((later.body as { items: unknown[] }).items.length).toBeGreaterThan(firstItems);
    expect(later.statements.length).toBe(first.statements.length);
  });
});

describe('P1-24-BE-009 — an honest wall-clock baseline, asserted as a measurement', () => {
  /**
   * Records p50/p95/p99 for the hot read paths and asserts NOTHING about the numbers.
   *
   * That is the whole point. `NFR-PERF-01` carries no approved production figure —
   * the P1-12 record labels its own number a validation baseline and leaves
   * `NFR-SCL` unresolved under `P1-OD-027`. A threshold invented here would be a
   * number this phase made up, and a green tick against it would be worse than no
   * tick at all.
   *
   * The single assertion is that the measurement RAN and produced finite, positive
   * numbers — which is what stops this becoming a test that reports nothing while
   * appearing to measure. The figures themselves, and the machine they came from, are
   * recorded in `docs/phase-1/phase-1-24/evidence/performance-baseline.md`.
   */
  /**
   * Deliberately small, and different for the audit path.
   *
   * `iam.audit-event-list` carries the `expensive-read` policy — 30 requests per
   * minute per user per tenant. A 25-iteration sample of it would trip the control
   * and measure the throttle rather than the query, which is how a benchmark comes
   * to report the cost of being refused. The throttle is proved on purpose at the
   * end of this file instead.
   */
  const ITERATIONS = 25;
  const THROTTLED_ITERATIONS = 8;

  const percentile = (values: readonly number[], p: number): number => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
  };

  it('records p50/p95/p99 for the hot read paths without claiming a threshold', async () => {
    const scenarios: [string, () => Promise<Response>][] = [
      ['iam.user-list', () => listUsers('limit=50')],
      ['iam.role-list', () => listRoles('limit=50')],
      [
        'iam.audit-event-list',
        () =>
          listAudit(
            `from=${new Date(Date.now() - 86_400_000).toISOString()}` +
              `&to=${new Date(Date.now() + 86_400_000).toISOString()}&limit=50`
          ),
      ],
    ];

    const report: Record<string, { p50: number; p95: number; p99: number }> = {};
    for (const [name, call] of scenarios) {
      await warm(call);
      const iterations = name === 'iam.audit-event-list' ? THROTTLED_ITERATIONS : ITERATIONS;
      const timings: number[] = [];
      for (let index = 0; index < iterations; index++) {
        const started = process.hrtime.bigint();
        const response = await call();
        await response.text();
        timings.push(Number(process.hrtime.bigint() - started) / 1e6);
      }
      report[name] = {
        p50: Number(percentile(timings, 50).toFixed(3)),
        p95: Number(percentile(timings, 95).toFixed(3)),
        p99: Number(percentile(timings, 99).toFixed(3)),
      };
    }

    // Printed so a CI run carries the figures in its log rather than only in a file
    // somebody has to remember to regenerate.
    console.log(
      `P1-24 read-path baseline (${ITERATIONS} iterations, ${THROTTLED_ITERATIONS} for the ` +
        'throttled audit read; no threshold applied):'
    );
    console.log(JSON.stringify(report, null, 2));

    for (const measurement of Object.values(report)) {
      expect(Number.isFinite(measurement.p50)).toBe(true);
      expect(measurement.p50).toBeGreaterThan(0);
      expect(measurement.p99).toBeGreaterThanOrEqual(measurement.p50);
    }
  }, 120_000);
});

describe('P1-24-BE-009 — no list route will return an unbounded page', () => {
  const oversized = String(MAX_PAGE_SIZE + 1);

  for (const [name, call] of [
    ['iam.user-list', (q: string) => listUsers(q)],
    ['iam.role-list', (q: string) => listRoles(q)],
  ] as const) {
    it(`${name} refuses a page larger than MAX_PAGE_SIZE`, async () => {
      const response = await call(`limit=${oversized}`);
      // Refused, not silently clamped. A clamp is defensible in principle, but it
      // would mean a client asking for 1000 and receiving 100 has no way to know the
      // page was truncated — which is how a caller comes to believe it has read
      // everything. The catalog carries ERR-PAG-001 for exactly this.
      expect(response.status).toBe(422);
      const problem = (await response.json()) as { code?: string };
      expect(problem.code).toMatch(/^ERR-(VAL|PAG)-001$/);
    });
  }

  it('MAX_PAGE_SIZE is a real bound, not an unset default', () => {
    expect(MAX_PAGE_SIZE).toBeGreaterThan(0);
    expect(MAX_PAGE_SIZE).toBeLessThanOrEqual(200);
  });

  it('iam.audit-event-list refuses an unbounded date range', async () => {
    // The page size is not the only unbounded dimension on this endpoint: an
    // arbitrarily wide window with cursor paging is a full export with extra steps.
    const response = await listAudit(
      `from=2000-01-01T00:00:00.000Z&to=${new Date(Date.now() + 86_400_000).toISOString()}`
    );
    expect(response.status).toBe(422);
    const problem = (await response.json()) as { code?: string };
    expect(problem.code).toBe('ERR-VAL-001');
  });
});

describe('P1-24-BE-009 — the expensive-read throttle is a real control', () => {
  /**
   * Last in the file, and deliberately so: it EXHAUSTS the bucket.
   *
   * `iam.audit-event-list` declares `rateLimitPolicy: 'expensive-read'` — 30 per
   * minute, keyed by operation, tenant and user. This was discovered rather than
   * planned: an earlier draft measured 25 iterations here and the NEXT test in the
   * file answered 429, which looked like a defect and was the control working. A
   * declaration is not a control until something proves it fires, so the accident is
   * now the assertion.
   *
   * The loop is longer than the limit on purpose, so the outcome does not depend on
   * what the rest of the suite already spent.
   */
  it('refuses with ERR-RTE-001 once the window is spent', async () => {
    const window = {
      from: new Date(Date.now() - 86_400_000).toISOString(),
      to: new Date(Date.now() + 86_400_000).toISOString(),
    };

    let throttled = 0;
    let lastCode: string | undefined;
    for (let index = 0; index < 40; index++) {
      const response = await listAudit(`from=${window.from}&to=${window.to}&limit=5`);
      const body = (await response.json()) as { code?: string };
      if (response.status === 429) {
        throttled += 1;
        lastCode = body.code;
      }
    }

    expect(throttled).toBeGreaterThan(0);
    expect(lastCode).toBe('ERR-RTE-001');
  }, 120_000);
});
