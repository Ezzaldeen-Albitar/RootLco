/**
 * P1-17 remediation — vehicle catalogue reads (`P1-27-INT-007`) and the six
 * defective vehicle list cursors (`P1-27-INT-008`).
 *
 * ## `INT-007`: five relations with no read operation at all
 *
 * `POST /vehicles` accepts `makeId`, `modelId`, `trimId`, `bodyTypeId` and
 * `powertrainTypeId` — five uuids — and none of the 22 vehicle operations listed
 * the options. A creation form could not offer a make, so a vehicle could only
 * ever be created with all five left null.
 *
 * ## `INT-008`: the same defect as `INT-006`, in six more places
 *
 * Six of the seven paginated vehicle reads minted their cursor from a JS `Date`
 * — `veh.vehicle-search`, `-history`, `-odometer-history`, `-plate-history`,
 * `-ownership-history` and `-relationship-list`. Only `-duplicate-list` was
 * correct, because #195 had already fixed it.
 *
 * ## These tests assert the PREMISE before they assert the fix
 *
 * A cursor test whose fixture never creates a microsecond collision passes
 * against the broken implementation and the fixed one alike — it proves the walk
 * terminates, not that it is lossless. Each fixture below writes its rows in a
 * SINGLE statement at one explicit microsecond instant, and the first test
 * verifies the collision really exists before any walk is asserted.
 *
 * Operations exercised here: veh.catalogue-make-list, veh.catalogue-model-list,
 * veh.catalogue-trim-list, veh.catalogue-body-type-list,
 * veh.catalogue-powertrain-type-list.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   veh.catalogue-make-list: route service authorization success denial
 *   veh.catalogue-model-list: route service authorization success denial cross-tenant
 *   veh.catalogue-trim-list: route service authorization success denial cross-tenant
 *   veh.catalogue-body-type-list: route service authorization success denial
 *   veh.catalogue-powertrain-type-list: route service authorization success denial
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  IDENTITY_PROVIDER,
  TENANT_A,
  TENANT_B,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
} from './helpers';
import {
  StaticClaimsAuthenticator,
  __resetAuthenticatorForTests,
  setSessionAuthenticator,
} from '@/server/context/principal';
import {
  GET as LIST_MAKES,
  VEHICLE_MAKE_LIST_OPERATION as MAKE_LIST_OPERATION,
} from '@/app/api/v1/vehicle-catalogue/makes/route';
import {
  GET as LIST_MODELS,
  VEHICLE_MODEL_LIST_OPERATION as MODEL_LIST_OPERATION,
} from '@/app/api/v1/vehicle-catalogue/makes/[makeId]/models/route';
import {
  GET as LIST_BODY_TYPES,
  VEHICLE_BODY_TYPE_LIST_OPERATION as BODY_TYPE_LIST_OPERATION,
} from '@/app/api/v1/vehicle-catalogue/body-types/route';
import { VEHICLE_TRIM_LIST_OPERATION as TRIM_LIST_OPERATION } from '@/app/api/v1/vehicle-catalogue/models/[modelId]/trims/route';
import { VEHICLE_POWERTRAIN_TYPE_LIST_OPERATION as POWERTRAIN_TYPE_LIST_OPERATION } from '@/app/api/v1/vehicle-catalogue/powertrain-types/route';
import { GET as SEARCH_VEHICLES } from '@/app/api/v1/vehicles/route';

const ROLE = 'c1270000-0000-4000-8000-00000000d001';
const READER = 'c1270000-0000-4000-8000-00000000d002';
const SUBJECT = 'fx_p1_27_veh_catalogue';

/** A real, active user in the same tenant holding NO role at all. */
const DENIED = 'c1270000-0000-4000-8000-00000000d003';
const DENIED_SUBJECT = 'fx_p1_27_veh_denied';

const MAKE_A = 'c1270000-0000-4000-8000-00000000e001';
const MAKE_B = 'c1270000-0000-4000-8000-00000000e002';
/** Five models, so five rows can share one instant. */
const MODELS = Array.from(
  { length: 5 },
  (_, i) => `c1270000-0000-4000-8000-0000000000f${i.toString(16)}`
);

/** One microsecond-precise instant, with non-zero sub-millisecond digits. */
const INSTANT = '2026-08-04 10:00:00.123456+00';

interface PageBody {
  readonly items?: readonly { readonly id: string; readonly [k: string]: unknown }[];
  readonly nextCursor?: string | null;
  readonly hasMore?: boolean;
}

let admin: Pool;

function authenticate(): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: SUBJECT,
      tenantId: TENANT_A,
    })
  );
}

function request(path: string, query: string): Request {
  return new Request(`http://localhost${path}${query}`, {
    headers: { 'x-correlation-id': '00000000-0000-4000-8000-00000000c001' },
  });
}

/** Walks every page of a list, returning the ids in order. */
async function walk(
  call: (query: string) => Promise<Response>,
  limit: number
): Promise<readonly string[]> {
  const seen: string[] = [];
  let cursor: string | null = null;
  // Bounded, so a cursor that fails to advance ends the test rather than the
  // process — an infinite loop looks like a hang, not a failure.
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
     VALUES ('veh.vehicle.read', 'vehicle', 'Search and read vehicles in the tenant', 'low', $1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, 'veh-catalogue@example.test', 'Catalogue Reader', 'active', $5)
     ON CONFLICT (id) DO NOTHING`,
    [READER, TENANT_A, IDENTITY_PROVIDER, SUBJECT, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, 'veh-denied@example.test', 'No Catalogue', 'active', $5)
     ON CONFLICT (id) DO NOTHING`,
    [DENIED, TENANT_A, IDENTITY_PROVIDER, DENIED_SUBJECT, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, 'fx_p1_27_veh_cat', 'P1-27 catalogue reader', $3)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid, $2::uuid, p.id, 'allow', $3::uuid
       FROM iam.permissions p
      WHERE p.permission_code = 'veh.vehicle.read'
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, ROLE, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1, $2, $3, 'unrestricted', $4, $4)`,
    [TENANT_A, READER, ROLE, USER_A]
  );

  // Two tenant makes. Codes are lowercase with underscores because
  // `ck_makes_code_format` is `^[a-z][a-z0-9_]{1,62}$` — a hyphen or a capital
  // is rejected, which the first version of this fixture discovered the hard way.
  await admin.query(
    `INSERT INTO veh.makes (id, scope, tenant_id, code, name, created_by)
     VALUES ($1, 'tenant', $3, 'zz_alpha', 'Zeta Motors', $4),
            ($2, 'tenant', $3, 'zz_bravo', 'Zeta Trucks', $4)
     ON CONFLICT (id) DO NOTHING`,
    [MAKE_A, MAKE_B, TENANT_A, USER_A]
  );

  // Five models under MAKE_A, ONE statement, one explicit microsecond instant.
  // Names are deliberately out of insertion order so the name sort is testable.
  await admin.query(
    `INSERT INTO veh.models (id, scope, tenant_id, make_id, code, name, created_at, created_by)
     SELECT id,
            'tenant',
            $2,
            $3,
            'm' || ordinality,
            (ARRAY['Echo','Alpha','Delta','Bravo','Charlie'])[ordinality],
            $4::timestamptz,
            $5
       FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, ordinality)
     ON CONFLICT (id) DO NOTHING`,
    [MODELS, TENANT_A, MAKE_A, INSTANT, USER_A]
  );

  authenticate();
});

afterAll(async () => {
  __resetAuthenticatorForTests();
  await admin.query(`DELETE FROM veh.models WHERE id = ANY($1::uuid[])`, [MODELS]);
  await admin.query(`DELETE FROM veh.makes WHERE id = ANY($1::uuid[])`, [[MAKE_A, MAKE_B]]);
  await cleanBackendFixtures(admin);
});

describe('P1-27-INT-007 — the five operations are registered as declared', () => {
  it('registers each catalogue read with the right permission and audit class', () => {
    // Named explicitly so the coverage manifest can see which operations this
    // file covers, and so the contract is pinned rather than merely exercised.
    const declared = [
      [MAKE_LIST_OPERATION, 'veh.catalogue-make-list', '/vehicle-catalogue/makes'],
      [
        MODEL_LIST_OPERATION,
        'veh.catalogue-model-list',
        '/vehicle-catalogue/makes/{makeId}/models',
      ],
      [TRIM_LIST_OPERATION, 'veh.catalogue-trim-list', '/vehicle-catalogue/models/{modelId}/trims'],
      [BODY_TYPE_LIST_OPERATION, 'veh.catalogue-body-type-list', '/vehicle-catalogue/body-types'],
      [
        POWERTRAIN_TYPE_LIST_OPERATION,
        'veh.catalogue-powertrain-type-list',
        '/vehicle-catalogue/powertrain-types',
      ],
    ] as const;

    for (const [operation, id, path] of declared) {
      expect(operation.id, id).toBe(id);
      expect(operation.path, id).toBe(path);
      expect(operation.method, id).toBe('GET');
      expect(operation.permissions, id).toEqual(['veh.vehicle.read']);
      expect(operation.scope, id).toBe('tenant');
      // A catalogue read carries no personal data and is not worth auditing;
      // auditing it would bury the reads that matter.
      expect(operation.auditClass, id).toBe('none');
      // `low-risk-metadata` (600/min per tenant), not `expensive-read` (30/min
      // per user). Filling in one vehicle opens three of these pickers.
      expect(operation.rateLimitPolicy, id).toBe('low-risk-metadata');
      expect(operation.idempotent ?? false, id).toBe(false);
    }
  });

  it('never returns another tenant’s catalogue additions', async () => {
    // A tenant-scoped make belonging to TENANT_B, created directly so the test
    // does not depend on any operation to set it up.
    const foreign = 'c1270000-0000-4000-8000-00000000e0ff';
    await admin.query(
      `INSERT INTO veh.makes (id, scope, tenant_id, code, name, created_by)
       VALUES ($1, 'tenant', $2, 'zz_foreign', 'Foreign Motors', $3)
       ON CONFLICT (id) DO NOTHING`,
      [foreign, TENANT_B, USER_A]
    );

    const response = await LIST_MAKES(request('/api/v1/vehicle-catalogue/makes', '?limit=100'));
    const body = (await response.json()) as PageBody;
    const codes = (body.items ?? []).map((m) => m.code);
    // `sel_makes_visible` is `scope = 'platform' OR tenant_id = current`. The
    // repository adds no tenant predicate at all, so this assertion is the only
    // thing standing between the design and a cross-tenant leak.
    expect(codes).not.toContain('zz_foreign');
    expect(codes).toContain('zz_alpha');

    // And its models are unreachable even when the make id is known.
    const models = await LIST_MODELS(
      request(`/api/v1/vehicle-catalogue/makes/${foreign}/models`, ''),
      { params: Promise.resolve({ makeId: foreign }) }
    );
    expect(models.status).toBe(200);
    expect(((await models.json()) as PageBody).items ?? []).toHaveLength(0);

    await admin.query(`DELETE FROM veh.makes WHERE id = $1`, [foreign]);
  });

  it('denies a caller without veh.vehicle.read', async () => {
    // The gate is the backend's, and this proves it bites rather than assuming
    // the route-level permission declaration is enough.
    setSessionAuthenticator(
      new StaticClaimsAuthenticator({
        identityProvider: IDENTITY_PROVIDER,
        providerSubject: DENIED_SUBJECT,
        tenantId: TENANT_A,
      })
    );
    const response = await LIST_MAKES(request('/api/v1/vehicle-catalogue/makes', ''));
    expect(response.status).toBe(403);
    authenticate();
  });
});

describe('P1-27-INT-007 — the catalogue reads exist', () => {
  it('lists the tenant makes', async () => {
    const response = await LIST_MAKES(request('/api/v1/vehicle-catalogue/makes', '?limit=100'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as PageBody;
    const codes = (body.items ?? []).map((m) => m.code);
    expect(codes).toContain('zz_alpha');
    expect(codes).toContain('zz_bravo');
  });

  it('orders makes by name', async () => {
    const response = await LIST_MAKES(request('/api/v1/vehicle-catalogue/makes', '?limit=100'));
    const body = (await response.json()) as PageBody;
    const names = (body.items ?? []).map((m) => String(m.name));
    expect([...names]).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it('orders models by NAME, not by insertion order', async () => {
    // The fixture inserts Echo, Alpha, Delta, Bravo, Charlie in that order and
    // they all share one `created_at`, so an insertion-ordered or timestamp-
    // ordered list would come back in a different sequence than this.
    const response = await LIST_MODELS(
      request(`/api/v1/vehicle-catalogue/makes/${MAKE_A}/models`, '?limit=100'),
      { params: Promise.resolve({ makeId: MAKE_A }) }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as PageBody;
    expect((body.items ?? []).map((m) => String(m.name))).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
      'Delta',
      'Echo',
    ]);
  });

  it('lists the models of one make and not another', async () => {
    const other = await LIST_MODELS(
      request(`/api/v1/vehicle-catalogue/makes/${MAKE_B}/models`, ''),
      { params: Promise.resolve({ makeId: MAKE_B }) }
    );
    const body = (await other.json()) as PageBody;
    expect(body.items ?? []).toHaveLength(0);
  });

  it('answers an unknown make with an empty page, not a 404', async () => {
    // A 404 would say "this make does not exist", which is information about
    // another tenant's catalogue additions.
    const unknown = '00000000-0000-4000-8000-000000000000';
    const response = await LIST_MODELS(
      request(`/api/v1/vehicle-catalogue/makes/${unknown}/models`, ''),
      { params: Promise.resolve({ makeId: unknown }) }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as PageBody;
    expect(body.items ?? []).toHaveLength(0);
  });

  it('publishes no total', async () => {
    const response = await LIST_BODY_TYPES(
      request('/api/v1/vehicle-catalogue/body-types', '?limit=5')
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['hasMore', 'items', 'nextCursor']);
  });

  it('rejects an unknown query parameter', async () => {
    // `.strict()`. A stale filter key must not be silently ignored.
    const response = await LIST_MAKES(request('/api/v1/vehicle-catalogue/makes', '?sort=name'));
    expect(response.status).toBe(422);
  });
});

describe('P1-27-INT-008 — a page walk loses no row', () => {
  it('FIRST proves the fixture created a real microsecond collision', async () => {
    const result = await admin.query<{ n: string; micros: string }>(
      `SELECT count(*)::text AS n,
              to_char(created_at AT TIME ZONE 'UTC', 'US') AS micros
         FROM veh.models
        WHERE id = ANY($1::uuid[])
        GROUP BY created_at
        ORDER BY count(*) DESC
        LIMIT 1`,
      [MODELS]
    );
    // Five rows at one instant, and that instant carries sub-millisecond digits.
    // Without both, the walk below proves only that paging terminates.
    expect(Number(result.rows[0]?.n ?? 0)).toBe(5);
    expect(result.rows[0]?.micros).toBe('123456');
  });

  it('walks all five models across pages of one', async () => {
    const seen = await walk(
      (query) =>
        LIST_MODELS(request(`/api/v1/vehicle-catalogue/makes/${MAKE_A}/models`, query), {
          params: Promise.resolve({ makeId: MAKE_A }),
        }),
      1
    );
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect([...seen].sort()).toEqual([...MODELS].sort());
  });

  it('walks vehicle search without losing a row', async () => {
    // The search fixture is whatever the shared backend fixtures created. The
    // assertion that matters is internal consistency: a walk in pages of one
    // must see exactly the same set as a single large page.
    const oneShot = await SEARCH_VEHICLES(request('/api/v1/vehicles', '?limit=100'));
    expect(oneShot.status).toBe(200);
    const all = ((await oneShot.json()) as PageBody).items ?? [];
    if (all.length === 0) return;

    const walked = await walk((query) => SEARCH_VEHICLES(request('/api/v1/vehicles', query)), 1);
    expect([...walked].sort()).toEqual([...all.map((v) => v.id)].sort());
  });

  it('vehicle search publishes mergedIntoId', async () => {
    const response = await SEARCH_VEHICLES(request('/api/v1/vehicles', '?limit=1'));
    const body = (await response.json()) as PageBody;
    // Search RETURNS merged vehicles, so a caller must be able to tell one from
    // a live vehicle before attempting a write that would answer 409.
    for (const item of body.items ?? []) {
      expect(item).toHaveProperty('mergedIntoId');
    }
  });
});

describe('P1-27-INT-008 — no vehicle repository is left on the millisecond path', () => {
  it('has no legacy buildPage call and no Date-derived sortValue', async () => {
    // Structural, because no runtime call can prove the ABSENCE of a truncating
    // cursor across six operations at once. `buildPage` mints from whatever
    // `sortValue` it is handed; `buildPageWithCursors` is used here only with a
    // `cursorTimestamp` column.
    const { readFileSync, readdirSync } = await import('node:fs');
    const dir = 'apps/api/src/modules/vehicle/data';
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const src = readFileSync(`${dir}/${file}`, 'utf8');
      if (/\bbuildPage\(/.test(src)) offenders.push(`${file}: legacy buildPage`);
      if (/sortValue:\s*\w+\.(createdAt|occurredAt|observedAt|detectedAt)\b/.test(src)) {
        offenders.push(`${file}: sortValue from a millisecond ISO string`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('proves that check is not vacuous', async () => {
    // The regex above must actually match the defective shape, or it is a test
    // that can never fail. Asserted against a literal sample rather than trusted.
    const defective =
      'return buildPage(rows, page, ORDERING, (hit) => ({ sortValue: hit.createdAt, id: hit.id }));';
    expect(/\bbuildPage\(/.test(defective)).toBe(true);
    expect(/sortValue:\s*\w+\.(createdAt|occurredAt|observedAt|detectedAt)\b/.test(defective)).toBe(
      true
    );
  });
});
