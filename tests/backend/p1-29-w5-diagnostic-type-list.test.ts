/**
 * P1-29 `W5` — `dia.diagnostic-type-list`, the diagnostic-type vocabulary read.
 *
 * `dia.diagnostic_types` has been read by the diagnostics module since P1-19
 * and published by nothing. The canonical plan named this operation PLANNED and
 * the record gate verified its absence; this suite is the proof that lands with
 * its presence.
 *
 * The cases, in order of how badly they would be missed:
 *
 *  1. **P2 — tenant SHADOWS platform.** Dual-scope catalogue rows resolve by
 *     `DISTINCT ON (code)` with the tenant row first, exactly as
 *     `diagnosticTypeByCode` resolves a code before a template is created. A
 *     list that showed both rows would offer a choice the write path does not
 *     honour; a list that showed only the platform row would name the wrong
 *     thing.
 *  2. **P3 — both statuses come back, each row saying which.** A report typed
 *     against a retired type still needs its name. The active-only decision
 *     belongs to the write path, and stays there.
 *  3. **P1 — the empty set is the truth.** The platform seeds no diagnostic
 *     type; approved vocabulary is an Owner input. A fresh tenant answers
 *     `200 { items: [] }`, not a 404 and not an invented default.
 *  4. **S1 — another tenant's row is invisible**, and the shadowing is per
 *     tenant: tenant B still sees the platform row tenant A overrode.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   dia.diagnostic-type-list: route service authorization success denial cross-tenant isolation
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
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
import {
  FULL,
  READER,
  TENANT_B_FULL,
  authAs,
  authAsSubject,
  establishP1_19Fixtures,
} from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as LIST } from '@/app/api/v1/diagnostic-types/route';

let admin: Pool;
let runtime: Pool;

interface TypeRow {
  readonly id: string;
  readonly scope: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
  readonly recordVersion: number;
}
interface Items {
  readonly items: readonly TypeRow[];
}
interface Problem {
  readonly code?: string;
}

const list = (query = ''): Promise<Response> =>
  LIST(new Request(`http://localhost/api/v1/diagnostic-types${query ? `?${query}` : ''}`));

const json = <T>(response: Response): Promise<T> => response.json() as Promise<T>;

/** Every row this file seeds carries this prefix, so the cleanup is by name. */
const PREFIX = 'w5_';

/** A catalogue row, seeded as admin: operator configuration with no write route. */
async function seedType(input: {
  readonly scope: 'platform' | 'tenant';
  readonly tenantId?: string;
  readonly code: string;
  readonly name: string;
  readonly status?: 'active' | 'inactive';
}): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, input.tenantId ?? TENANT_A]
    );
    await client.query(
      `INSERT INTO dia.diagnostic_types (scope, tenant_id, code, name, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        input.scope,
        input.scope === 'platform' ? null : (input.tenantId ?? TENANT_A),
        input.code,
        input.name,
        input.status ?? 'active',
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

async function removeSeededTypes(): Promise<void> {
  await admin.query(`DELETE FROM dia.diagnostic_types WHERE code LIKE $1`, [`${PREFIX}%`]);
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await removeSeededTypes();
  runtime = runtimeAppPool(4);
  __setPrimaryPoolForTests(runtime);
});

afterEach(async () => {
  __resetAuthenticatorForTests();
  await removeSeededTypes();
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await removeSeededTypes();
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

describe('dia.diagnostic-type-list — the vocabulary, published at last', () => {
  it('P1 — a tenant with no configured type answers the EMPTY set, not an invention', async () => {
    authAs(FULL);
    const response = await list();
    expect(response.status).toBe(200);
    const body = await json<Items & Record<string, unknown>>(response);
    // No platform seed exists: the truthful answer for a fresh tenant is nothing.
    expect(body.items.filter((row) => row.code.startsWith(PREFIX))).toEqual([]);
    // `{ items }` and nothing else — no cursor, because the read is unpaged.
    expect(Object.keys(body)).toEqual(['items']);
  });

  it('P2 — a tenant row SHADOWS the platform row it overrides, and the shape is named', async () => {
    await seedType({ scope: 'platform', code: `${PREFIX}engine`, name: 'Engine (platform)' });
    await seedType({ scope: 'tenant', code: `${PREFIX}engine`, name: 'Engine (tenant A)' });

    authAs(FULL);
    const body = await json<Items>(await list());
    const engine = body.items.filter((row) => row.code === `${PREFIX}engine`);
    // Exactly one row for the code — the override REPLACES rather than joins.
    expect(engine).toHaveLength(1);
    expect(engine[0]?.name).toBe('Engine (tenant A)');
    expect(engine[0]?.scope).toBe('tenant');
    expect(Object.keys(engine[0] as object).sort()).toEqual(
      ['code', 'id', 'name', 'recordVersion', 'scope', 'status'].sort()
    );
  });

  it('P3 — both statuses come back, each row saying which; the order is by code', async () => {
    await seedType({
      scope: 'tenant',
      code: `${PREFIX}b_retired`,
      name: 'Retired',
      status: 'inactive',
    });
    await seedType({ scope: 'tenant', code: `${PREFIX}a_live`, name: 'Live' });

    authAs(FULL);
    const body = await json<Items>(await list());
    const mine = body.items.filter((row) => row.code.startsWith(PREFIX));
    expect(mine.map((row) => row.code)).toEqual([`${PREFIX}a_live`, `${PREFIX}b_retired`]);
    expect(mine.map((row) => row.status)).toEqual(['active', 'inactive']);
  });

  it('N1 — an unknown query parameter is a 422, not a silent ignore', async () => {
    authAs(FULL);
    const response = await list('status=active');
    expect(response.status).toBe(422);
    expect((await json<Problem>(response)).code).toBe('ERR-VAL-001');
  });
});

describe('dia.diagnostic-type-list — authorization and tenancy', () => {
  it('N2 — a principal without dia.diagnostic.read is refused, and one with no grant at all', async () => {
    authAs(READER); // wo.work_order.read only
    expect((await list()).status).toBe(403);
    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await list()).status).toBe(403);
  });

  it('S1 — another tenant’s row is invisible, and the shadow is per tenant', async () => {
    await seedType({ scope: 'platform', code: `${PREFIX}shared`, name: 'Shared (platform)' });
    await seedType({ scope: 'tenant', code: `${PREFIX}shared`, name: 'Shared (tenant A)' });
    await seedType({
      scope: 'tenant',
      tenantId: TENANT_B,
      code: `${PREFIX}b_only`,
      name: 'Tenant B only',
    });

    authAs(FULL);
    const a = (await json<Items>(await list())).items.filter((row) => row.code.startsWith(PREFIX));
    expect(a.map((row) => row.code)).not.toContain(`${PREFIX}b_only`);
    expect(a.find((row) => row.code === `${PREFIX}shared`)?.name).toBe('Shared (tenant A)');

    authAs(TENANT_B_FULL);
    const b = (await json<Items>(await list())).items.filter((row) => row.code.startsWith(PREFIX));
    expect(b.map((row) => row.code)).toContain(`${PREFIX}b_only`);
    // Tenant A's override is tenant A's: B still sees the platform row.
    expect(b.find((row) => row.code === `${PREFIX}shared`)?.name).toBe('Shared (platform)');
    expect(b.find((row) => row.code === `${PREFIX}shared`)?.scope).toBe('platform');
  });
});
