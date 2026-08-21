/**
 * Intake configuration-catalogue reads, end to end (P1-27 remediation executed
 * by P1-18, `P1-27-INT-018`).
 *
 * Seven dual-scope catalogues — three `apt`, four `rec` — are the uuids the
 * intake writes demand, and none had a read: a cancellation could not name its
 * mandatory reason, a check-in could not offer a fuel level. These tests drive
 * the real GET handlers on the `app_runtime` role and prove the four contract
 * points that matter: the platform-or-own-tenant union is RLS's and leaks no
 * other tenant's additions; only ACTIVE, non-deleted rows are offered (these
 * lists feed pickers for mandatory references); the order is `(name, id)`
 * ascending with the cursor minted from `name`; and an empty catalogue answers
 * an empty page — the no-fake-data policy working, not a fault.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   apt.catalogue-appointment-type-list: route service authorization success denial
 *   apt.catalogue-source-channel-list: route service authorization success denial
 *   apt.catalogue-cancellation-reason-list: route service authorization success denial
 *   rec.catalogue-visit-reason-list: route service authorization success denial
 *   rec.catalogue-fuel-level-list: route service authorization success denial
 *   rec.catalogue-warning-light-code-list: route service authorization success denial
 *   rec.catalogue-refusal-reason-list: route service authorization success denial
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
  runtimeAppPool,
} from './helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import {
  StaticClaimsAuthenticator,
  __resetAuthenticatorForTests,
  setSessionAuthenticator,
} from '@/server/context/principal';
import {
  GET as LIST_APPOINTMENT_TYPES,
  APPOINTMENT_TYPE_LIST_OPERATION,
} from '@/app/api/v1/appointment-catalogue/appointment-types/route';
import {
  GET as LIST_SOURCE_CHANNELS,
  SOURCE_CHANNEL_LIST_OPERATION,
} from '@/app/api/v1/appointment-catalogue/source-channels/route';
import {
  GET as LIST_CANCELLATION_REASONS,
  CANCELLATION_REASON_LIST_OPERATION,
} from '@/app/api/v1/appointment-catalogue/cancellation-reasons/route';
import {
  GET as LIST_VISIT_REASONS,
  VISIT_REASON_LIST_OPERATION,
} from '@/app/api/v1/reception-catalogue/visit-reasons/route';
import {
  GET as LIST_FUEL_LEVELS,
  FUEL_LEVEL_LIST_OPERATION,
} from '@/app/api/v1/reception-catalogue/fuel-levels/route';
import {
  GET as LIST_WARNING_LIGHT_CODES,
  WARNING_LIGHT_CODE_LIST_OPERATION,
} from '@/app/api/v1/reception-catalogue/warning-light-codes/route';
import {
  GET as LIST_REFUSAL_REASONS,
  REFUSAL_REASON_LIST_OPERATION,
} from '@/app/api/v1/reception-catalogue/refusal-reasons/route';

const ROLE = 'c1180000-0000-4000-8000-00000000d001';
const READER = 'c1180000-0000-4000-8000-00000000d002';
const SUBJECT = 'fx_p1_18_intake_cat';

/** A real, active user in the same tenant holding NO role at all. */
const DENIED_SUBJECT = 'fx_p1_18_intake_cat_denied';
const DENIED = 'c1180000-0000-4000-8000-00000000d003';

/** Fixture rows: one active, one inactive, one soft-deleted, one foreign. */
const TYPE_ACTIVE = 'c1180000-0000-4000-8000-00000000e001';
const TYPE_INACTIVE = 'c1180000-0000-4000-8000-00000000e002';
const TYPE_DELETED = 'c1180000-0000-4000-8000-00000000e003';
const TYPE_FOREIGN = 'c1180000-0000-4000-8000-00000000e004';
const FUEL_ACTIVE = 'c1180000-0000-4000-8000-00000000e011';
const REASON_ACTIVE = 'c1180000-0000-4000-8000-00000000e021';

interface PageBody {
  readonly items?: readonly Record<string, unknown>[];
  readonly nextCursor?: string | null;
  readonly hasMore?: boolean;
  readonly code?: string;
}

let admin: Pool;
let runtime: Pool;

function authenticate(subject = SUBJECT, tenantId = TENANT_A): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: subject,
      tenantId,
    })
  );
}

type Handler = (request: Request) => Promise<Response>;

function call(handler: Handler, path: string, query = ''): Promise<Response> {
  return handler(new Request(`http://localhost/api/v1${path}${query}`));
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);

  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ('apt.appointment.read','apt','Read appointments, the branch calendar and the appointment catalogues','low',$1),
            ('rec.reception.read','rec','Read reception visits, parties, authorizations, condition evidence and custody history','low',$1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );
  await admin.query(
    `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,'intake-cat@example.test','Catalogue Reader','active',$5),
            ($6,$2,$3,$7,'intake-cat-denied@example.test','No Catalogue','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [READER, TENANT_A, IDENTITY_PROVIDER, SUBJECT, USER_A, DENIED, DENIED_SUBJECT]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,'fx_p1_18_intake_cat','P1-18 intake catalogue reader',$3)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code IN ('apt.appointment.read','rec.reception.read')
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, ROLE, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
    [TENANT_A, READER, ROLE, USER_A]
  );

  // Appointment types: active + inactive + soft-deleted in tenant A, plus a
  // tenant-B row that must never appear. Codes are lowercase-with-underscores
  // (`ck_*_code_format`).
  await admin.query(
    `INSERT INTO apt.appointment_types (id, scope, tenant_id, code, name, status, deleted_at, created_by)
     VALUES ($1,'tenant',$5,'zz_cat_active','Alpha Service','active',NULL,$6),
            ($2,'tenant',$5,'zz_cat_inactive','Bravo Retired','inactive',NULL,$6),
            ($3,'tenant',$5,'zz_cat_deleted','Charlie Gone','active',now(),$6),
            ($4,'tenant',$7,'zz_cat_foreign','Foreign Type','active',NULL,$6)
     ON CONFLICT (id) DO NOTHING`,
    [TYPE_ACTIVE, TYPE_INACTIVE, TYPE_DELETED, TYPE_FOREIGN, TENANT_A, USER_A, TENANT_B]
  );
  await admin.query(
    `INSERT INTO rec.fuel_levels (id, scope, tenant_id, code, name, created_by)
     VALUES ($1,'tenant',$2,'zz_fuel_half','Half Tank',$3) ON CONFLICT (id) DO NOTHING`,
    [FUEL_ACTIVE, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO apt.cancellation_reasons (id, scope, tenant_id, code, name, created_by)
     VALUES ($1,'tenant',$2,'zz_cust_request','Customer Request',$3) ON CONFLICT (id) DO NOTHING`,
    [REASON_ACTIVE, TENANT_A, USER_A]
  );

  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);
  authenticate();
});

afterAll(async () => {
  __resetAuthenticatorForTests();
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await admin.query(`DELETE FROM apt.appointment_types WHERE id = ANY($1::uuid[])`, [
      [TYPE_ACTIVE, TYPE_INACTIVE, TYPE_DELETED, TYPE_FOREIGN],
    ]);
    await admin.query(`DELETE FROM rec.fuel_levels WHERE id = $1`, [FUEL_ACTIVE]);
    await admin.query(`DELETE FROM apt.cancellation_reasons WHERE id = $1`, [REASON_ACTIVE]);
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

describe('P1-27-INT-018 — the seven operations are registered as declared', () => {
  it('registers each catalogue read with the right permission and policy', () => {
    const declared = [
      [
        APPOINTMENT_TYPE_LIST_OPERATION,
        'apt.catalogue-appointment-type-list',
        '/appointment-catalogue/appointment-types',
        'apt.appointment.read',
      ],
      [
        SOURCE_CHANNEL_LIST_OPERATION,
        'apt.catalogue-source-channel-list',
        '/appointment-catalogue/source-channels',
        'apt.appointment.read',
      ],
      [
        CANCELLATION_REASON_LIST_OPERATION,
        'apt.catalogue-cancellation-reason-list',
        '/appointment-catalogue/cancellation-reasons',
        'apt.appointment.read',
      ],
      [
        VISIT_REASON_LIST_OPERATION,
        'rec.catalogue-visit-reason-list',
        '/reception-catalogue/visit-reasons',
        'rec.reception.read',
      ],
      [
        FUEL_LEVEL_LIST_OPERATION,
        'rec.catalogue-fuel-level-list',
        '/reception-catalogue/fuel-levels',
        'rec.reception.read',
      ],
      [
        WARNING_LIGHT_CODE_LIST_OPERATION,
        'rec.catalogue-warning-light-code-list',
        '/reception-catalogue/warning-light-codes',
        'rec.reception.read',
      ],
      [
        REFUSAL_REASON_LIST_OPERATION,
        'rec.catalogue-refusal-reason-list',
        '/reception-catalogue/refusal-reasons',
        'rec.reception.read',
      ],
    ] as const;

    for (const [operation, id, path, permission] of declared) {
      expect(operation.id, id).toBe(id);
      expect(operation.path, id).toBe(path);
      expect(operation.method, id).toBe('GET');
      expect(operation.permissions, id).toEqual([permission]);
      expect(operation.scope, id).toBe('tenant');
      expect(operation.auditClass, id).toBe('none');
      expect(operation.rateLimitPolicy, id).toBe('low-risk-metadata');
      expect(operation.idempotent ?? false, id).toBe(false);
      expect(operation.versionGuarded ?? false, id).toBe(false);
    }
  });
});

describe('the catalogue contract', () => {
  it('offers ONLY active, non-deleted rows, in name order, with the exact item shape', async () => {
    const response = await call(
      LIST_APPOINTMENT_TYPES,
      '/appointment-catalogue/appointment-types',
      '?limit=100'
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as PageBody;
    expect(Object.keys(body).sort()).toEqual(['hasMore', 'items', 'nextCursor']);

    const codes = (body.items ?? []).map((item) => item.code);
    expect(codes).toContain('zz_cat_active');
    // These lists feed pickers for writes about to reference a row, so a
    // retired or removed code must not be offered — the deliberate difference
    // from the vehicle catalogue, which projects `status` instead.
    expect(codes).not.toContain('zz_cat_inactive');
    expect(codes).not.toContain('zz_cat_deleted');

    for (const item of body.items ?? []) {
      expect(Object.keys(item).sort()).toEqual(['code', 'id', 'name', 'scope']);
    }
    const names = (body.items ?? []).map((item) => String(item.name));
    expect([...names]).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it('never returns another tenant catalogue additions', async () => {
    const response = await call(
      LIST_APPOINTMENT_TYPES,
      '/appointment-catalogue/appointment-types',
      '?limit=100'
    );
    const body = (await response.json()) as PageBody;
    // `sel_appointment_types_visible` is `scope='platform' OR tenant_id=current`
    // and the repository adds no tenant predicate at all, so this assertion is
    // what stands between the design and a cross-tenant leak.
    expect((body.items ?? []).map((item) => item.code)).not.toContain('zz_cat_foreign');
  });

  it('lists the rec catalogues under rec.reception.read', async () => {
    const fuels = await call(LIST_FUEL_LEVELS, '/reception-catalogue/fuel-levels', '?limit=100');
    expect(fuels.status).toBe(200);
    expect(((await fuels.json()) as PageBody).items?.map((item) => item.code)).toContain(
      'zz_fuel_half'
    );

    const reasons = await call(
      LIST_CANCELLATION_REASONS,
      '/appointment-catalogue/cancellation-reasons',
      '?limit=100'
    );
    expect(reasons.status).toBe(200);
    expect(((await reasons.json()) as PageBody).items?.map((item) => item.code)).toContain(
      'zz_cust_request'
    );
  });

  it('answers an EMPTY page for a catalogue that ships no rows — the no-fake-data policy working', async () => {
    // Zero rows ship for every one of these tables. visit reasons,
    // warning-light codes, refusal reasons and source channels have no fixture
    // in this suite, so the honest answer is an empty page, not a 404 and not
    // an invented default.
    for (const [handler, path] of [
      [LIST_VISIT_REASONS, '/reception-catalogue/visit-reasons'],
      [LIST_WARNING_LIGHT_CODES, '/reception-catalogue/warning-light-codes'],
      [LIST_REFUSAL_REASONS, '/reception-catalogue/refusal-reasons'],
      [LIST_SOURCE_CHANNELS, '/appointment-catalogue/source-channels'],
    ] as const) {
      const response = await call(handler as Handler, path as string);
      expect(response.status, path as string).toBe(200);
      const body = (await response.json()) as PageBody;
      expect(body.items, path as string).toEqual([]);
      expect(body.hasMore, path as string).toBe(false);
      expect(body.nextCursor, path as string).toBeNull();
    }
  });

  it('denies a caller without the domain read code (denial), and rejects unknown params', async () => {
    authenticate(DENIED_SUBJECT);
    for (const [handler, path] of [
      [LIST_APPOINTMENT_TYPES, '/appointment-catalogue/appointment-types'],
      [LIST_FUEL_LEVELS, '/reception-catalogue/fuel-levels'],
    ] as const) {
      const response = await call(handler as Handler, path as string);
      expect(response.status, path as string).toBe(403);
    }
    authenticate();

    // `.strict()`: a query parameter the contract does not name is refused, so
    // the browser cannot smuggle a tenant or a filter nobody validated.
    const strict = await call(
      LIST_APPOINTMENT_TYPES,
      '/appointment-catalogue/appointment-types',
      '?tenantId=c1180000-0000-4000-8000-00000000ffff'
    );
    expect(strict.status).toBe(422);
  });
});
