/**
 * Intake configuration-catalogue MANAGEMENT, end to end (P1-27 remediation
 * executed by P1-18, `P1-27-INT-018`).
 *
 * PR #220 published the seven catalogue READS. It did not make the catalogues
 * usable: every one of the seven tables ships zero rows by the no-fake-data
 * policy and no operation anywhere could add one, so `appointmentTypeId` — a
 * REQUIRED uuid on `apt.appointment-create` — could never be satisfied and no
 * appointment could be booked at all. The database had permitted the write since
 * the tables were created (`GRANT SELECT, INSERT, UPDATE ... TO app_runtime`
 * with matching `ins_<t>_tenant` / `upd_<t>_tenant` policies); only the API
 * published nothing.
 *
 * These tests drive the real handlers on the `app_runtime` role, once per
 * catalogue, and prove the contract points that decide whether the remediation
 * actually works:
 *
 *   - a created entry is a TENANT row of the caller's tenant, whatever the
 *     request said, and appears in the picker read immediately — the end-to-end
 *     point of the whole change;
 *   - a caller holding the READ codes and not the manage code is refused, so the
 *     new authority is genuinely separate from booking and check-in;
 *   - another tenant's entry and an unknown id answer the same 404, so the
 *     endpoint is not an existence oracle;
 *   - a platform default is refused with an explanation rather than a zero-row
 *     update reported as a version conflict;
 *   - a duplicate code is a 409, and a RETIRED entry still holds its code —
 *     which is why retirement must be reversible;
 *   - a referenced entry cannot be hard-removed by anybody: `app_runtime` holds
 *     no DELETE grant and every referencing FK is ON DELETE RESTRICT, so
 *     retirement is the only withdrawal there is.
 *
 * No business row is seeded anywhere in this file. Every catalogue row it
 * creates is created THROUGH the API under test and deleted afterwards.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   apt.catalogue-appointment-type-create: route service authorization success denial idempotency audit
 *   apt.catalogue-appointment-type-update: route service authorization success denial cross-tenant stale-version audit
 *   apt.catalogue-appointment-type-status-set: route service authorization success denial cross-tenant idempotency stale-version audit
 *   apt.catalogue-source-channel-create: route service authorization success denial idempotency audit
 *   apt.catalogue-source-channel-update: route service authorization success denial cross-tenant stale-version audit
 *   apt.catalogue-source-channel-status-set: route service authorization success denial cross-tenant idempotency stale-version audit
 *   apt.catalogue-cancellation-reason-create: route service authorization success denial idempotency audit
 *   apt.catalogue-cancellation-reason-update: route service authorization success denial cross-tenant stale-version audit
 *   apt.catalogue-cancellation-reason-status-set: route service authorization success denial cross-tenant idempotency stale-version audit
 *   rec.catalogue-visit-reason-create: route service authorization success denial idempotency audit
 *   rec.catalogue-visit-reason-update: route service authorization success denial cross-tenant stale-version audit
 *   rec.catalogue-visit-reason-status-set: route service authorization success denial cross-tenant idempotency stale-version audit
 *   rec.catalogue-fuel-level-create: route service authorization success denial idempotency audit
 *   rec.catalogue-fuel-level-update: route service authorization success denial cross-tenant stale-version audit
 *   rec.catalogue-fuel-level-status-set: route service authorization success denial cross-tenant idempotency stale-version audit
 *   rec.catalogue-warning-light-code-create: route service authorization success denial idempotency audit
 *   rec.catalogue-warning-light-code-update: route service authorization success denial cross-tenant stale-version audit
 *   rec.catalogue-warning-light-code-status-set: route service authorization success denial cross-tenant idempotency stale-version audit
 *   rec.catalogue-refusal-reason-create: route service authorization success denial idempotency audit
 *   rec.catalogue-refusal-reason-update: route service authorization success denial cross-tenant stale-version audit
 *   rec.catalogue-refusal-reason-status-set: route service authorization success denial cross-tenant idempotency stale-version audit
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  BRANCH_A1,
  COMPANY_A1,
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
  POST as CREATE_APPOINTMENT_TYPE,
  APPOINTMENT_TYPE_CREATE_OPERATION,
} from '@/app/api/v1/appointment-catalogue/appointment-types/route';
import {
  PATCH as UPDATE_APPOINTMENT_TYPE,
  APPOINTMENT_TYPE_UPDATE_OPERATION,
} from '@/app/api/v1/appointment-catalogue/appointment-types/[appointmentTypeId]/route';
import {
  POST as STATUS_APPOINTMENT_TYPE,
  APPOINTMENT_TYPE_STATUS_OPERATION,
} from '@/app/api/v1/appointment-catalogue/appointment-types/[appointmentTypeId]/status/route';
import {
  GET as LIST_SOURCE_CHANNELS,
  POST as CREATE_SOURCE_CHANNEL,
  SOURCE_CHANNEL_CREATE_OPERATION,
} from '@/app/api/v1/appointment-catalogue/source-channels/route';
import {
  PATCH as UPDATE_SOURCE_CHANNEL,
  SOURCE_CHANNEL_UPDATE_OPERATION,
} from '@/app/api/v1/appointment-catalogue/source-channels/[sourceChannelId]/route';
import {
  POST as STATUS_SOURCE_CHANNEL,
  SOURCE_CHANNEL_STATUS_OPERATION,
} from '@/app/api/v1/appointment-catalogue/source-channels/[sourceChannelId]/status/route';
import {
  GET as LIST_CANCELLATION_REASONS,
  POST as CREATE_CANCELLATION_REASON,
  CANCELLATION_REASON_CREATE_OPERATION,
} from '@/app/api/v1/appointment-catalogue/cancellation-reasons/route';
import {
  PATCH as UPDATE_CANCELLATION_REASON,
  CANCELLATION_REASON_UPDATE_OPERATION,
} from '@/app/api/v1/appointment-catalogue/cancellation-reasons/[cancellationReasonId]/route';
import {
  POST as STATUS_CANCELLATION_REASON,
  CANCELLATION_REASON_STATUS_OPERATION,
} from '@/app/api/v1/appointment-catalogue/cancellation-reasons/[cancellationReasonId]/status/route';
import {
  GET as LIST_VISIT_REASONS,
  POST as CREATE_VISIT_REASON,
  VISIT_REASON_CREATE_OPERATION,
} from '@/app/api/v1/reception-catalogue/visit-reasons/route';
import {
  PATCH as UPDATE_VISIT_REASON,
  VISIT_REASON_UPDATE_OPERATION,
} from '@/app/api/v1/reception-catalogue/visit-reasons/[visitReasonId]/route';
import {
  POST as STATUS_VISIT_REASON,
  VISIT_REASON_STATUS_OPERATION,
} from '@/app/api/v1/reception-catalogue/visit-reasons/[visitReasonId]/status/route';
import {
  GET as LIST_FUEL_LEVELS,
  POST as CREATE_FUEL_LEVEL,
  FUEL_LEVEL_CREATE_OPERATION,
} from '@/app/api/v1/reception-catalogue/fuel-levels/route';
import {
  PATCH as UPDATE_FUEL_LEVEL,
  FUEL_LEVEL_UPDATE_OPERATION,
} from '@/app/api/v1/reception-catalogue/fuel-levels/[fuelLevelId]/route';
import {
  POST as STATUS_FUEL_LEVEL,
  FUEL_LEVEL_STATUS_OPERATION,
} from '@/app/api/v1/reception-catalogue/fuel-levels/[fuelLevelId]/status/route';
import {
  GET as LIST_WARNING_LIGHT_CODES,
  POST as CREATE_WARNING_LIGHT_CODE,
  WARNING_LIGHT_CODE_CREATE_OPERATION,
} from '@/app/api/v1/reception-catalogue/warning-light-codes/route';
import {
  PATCH as UPDATE_WARNING_LIGHT_CODE,
  WARNING_LIGHT_CODE_UPDATE_OPERATION,
} from '@/app/api/v1/reception-catalogue/warning-light-codes/[warningLightCodeId]/route';
import {
  POST as STATUS_WARNING_LIGHT_CODE,
  WARNING_LIGHT_CODE_STATUS_OPERATION,
} from '@/app/api/v1/reception-catalogue/warning-light-codes/[warningLightCodeId]/status/route';
import {
  GET as LIST_REFUSAL_REASONS,
  POST as CREATE_REFUSAL_REASON,
  REFUSAL_REASON_CREATE_OPERATION,
} from '@/app/api/v1/reception-catalogue/refusal-reasons/route';
import {
  PATCH as UPDATE_REFUSAL_REASON,
  REFUSAL_REASON_UPDATE_OPERATION,
} from '@/app/api/v1/reception-catalogue/refusal-reasons/[refusalReasonId]/route';
import {
  POST as STATUS_REFUSAL_REASON,
  REFUSAL_REASON_STATUS_OPERATION,
} from '@/app/api/v1/reception-catalogue/refusal-reasons/[refusalReasonId]/status/route';
import { POST as CREATE_RECEPTION } from '@/app/api/v1/receptions/route';

const ROLE_MANAGER = 'c1180000-0000-4000-8000-00000000f001';
const USER_MANAGER = 'c1180000-0000-4000-8000-00000000f002';
const SUBJ_MANAGER = 'fx_p1_18_cat_manager';

/** Holds both READ codes and neither manage code — the sharp denial case. */
const ROLE_READER = 'c1180000-0000-4000-8000-00000000f003';
const USER_READER = 'c1180000-0000-4000-8000-00000000f004';
const SUBJ_READER = 'fx_p1_18_cat_reader';

const ROLE_TENANT_B = 'c1180000-0000-4000-8000-00000000f005';
const USER_TENANT_B = 'c1180000-0000-4000-8000-00000000f006';
const SUBJ_TENANT_B = 'fx_p1_18_cat_tenant_b';

const PARTNER_A = 'c1180000-0000-4000-8000-00000000f0c1';

const MANAGE_PERMISSIONS = [
  'apt.catalogue.manage',
  'rec.catalogue.manage',
  'apt.appointment.read',
  'rec.reception.read',
  'rec.reception.manage',
];
const READ_ONLY_PERMISSIONS = ['apt.appointment.read', 'rec.reception.read'];

/** Every code this file creates starts here, so cleanup can find all of them. */
const CODE_PREFIX = 'zz_mgmt_';
/**
 * A per-RUN token in every code, and not for tidiness.
 *
 * The PLATFORM rows this file inserts carry `tenant_id NULL`, so
 * `cleanBackendFixtures` — which works by tenant cascade — cannot reach them;
 * only this suite's own `afterAll` sweep can. A run that is interrupted before
 * `afterAll` therefore leaves them behind, and with a purely sequential counter
 * the next run regenerates the same `zz_mgmt_0001` and dies on
 * `uq_<t>_platform_code` — permanently, on every subsequent run, until somebody
 * cleans the database by hand. The token makes each run's codes disjoint, so a
 * crashed predecessor cannot poison a successor.
 *
 * `ck_<t>_code_format` is `^[a-z][a-z0-9_]{1,62}$`, so the token is lowercase
 * hex and the whole code stays well inside 63 characters.
 */
const RUN_TOKEN = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
let codeCounter = 0;
const nextCode = (): string => {
  codeCounter += 1;
  return `${CODE_PREFIX}${RUN_TOKEN}_${String(codeCounter).padStart(4, '0')}`;
};

interface EntryBody {
  readonly id?: string;
  readonly code?: string;
  readonly name?: string;
  readonly status?: string;
  readonly recordVersion?: number;
  readonly code_?: string;
}
interface ProblemBody {
  readonly code?: string;
  readonly detail?: string;
}
interface PageBody {
  readonly items?: readonly { readonly id: string; readonly code: string }[];
}

type ListHandler = (request: Request) => Promise<Response>;
type CreateHandler = (request: Request) => Promise<Response>;
type IdHandler = (request: Request, id: string) => Promise<Response>;

interface CatalogueUnderTest {
  readonly key: string;
  readonly relation: string;
  readonly listPath: string;
  readonly permission: string;
  readonly createId: string;
  readonly updateId: string;
  readonly statusId: string;
  readonly createdAction: string;
  readonly renamedAction: string;
  readonly statusAction: string;
  readonly list: ListHandler;
  readonly create: CreateHandler;
  readonly update: IdHandler;
  readonly status: IdHandler;
}

/**
 * The seven catalogues, each bound to its REAL handlers.
 *
 * The id-addressed handlers are wrapped rather than cast: every route declares
 * its own path-parameter name (`appointmentTypeId`, `fuelLevelId`, …), and a
 * cast to a common shape would let a wrong name compile and fail at runtime as
 * a 422 that looks like a validation test passing.
 */
const CATALOGUES: readonly CatalogueUnderTest[] = [
  {
    key: 'appointment_types',
    relation: 'apt.appointment_types',
    listPath: '/appointment-catalogue/appointment-types',
    permission: 'apt.catalogue.manage',
    createId: 'apt.catalogue-appointment-type-create',
    updateId: 'apt.catalogue-appointment-type-update',
    statusId: 'apt.catalogue-appointment-type-status-set',
    createdAction: 'apt.appointment_type.created',
    renamedAction: 'apt.appointment_type.renamed',
    statusAction: 'apt.appointment_type.status_changed',
    list: LIST_APPOINTMENT_TYPES,
    create: CREATE_APPOINTMENT_TYPE,
    update: (request, id) =>
      UPDATE_APPOINTMENT_TYPE(request, { params: Promise.resolve({ appointmentTypeId: id }) }),
    status: (request, id) =>
      STATUS_APPOINTMENT_TYPE(request, { params: Promise.resolve({ appointmentTypeId: id }) }),
  },
  {
    key: 'source_channels',
    relation: 'apt.source_channels',
    listPath: '/appointment-catalogue/source-channels',
    permission: 'apt.catalogue.manage',
    createId: 'apt.catalogue-source-channel-create',
    updateId: 'apt.catalogue-source-channel-update',
    statusId: 'apt.catalogue-source-channel-status-set',
    createdAction: 'apt.source_channel.created',
    renamedAction: 'apt.source_channel.renamed',
    statusAction: 'apt.source_channel.status_changed',
    list: LIST_SOURCE_CHANNELS,
    create: CREATE_SOURCE_CHANNEL,
    update: (request, id) =>
      UPDATE_SOURCE_CHANNEL(request, { params: Promise.resolve({ sourceChannelId: id }) }),
    status: (request, id) =>
      STATUS_SOURCE_CHANNEL(request, { params: Promise.resolve({ sourceChannelId: id }) }),
  },
  {
    key: 'cancellation_reasons',
    relation: 'apt.cancellation_reasons',
    listPath: '/appointment-catalogue/cancellation-reasons',
    permission: 'apt.catalogue.manage',
    createId: 'apt.catalogue-cancellation-reason-create',
    updateId: 'apt.catalogue-cancellation-reason-update',
    statusId: 'apt.catalogue-cancellation-reason-status-set',
    createdAction: 'apt.cancellation_reason.created',
    renamedAction: 'apt.cancellation_reason.renamed',
    statusAction: 'apt.cancellation_reason.status_changed',
    list: LIST_CANCELLATION_REASONS,
    create: CREATE_CANCELLATION_REASON,
    update: (request, id) =>
      UPDATE_CANCELLATION_REASON(request, {
        params: Promise.resolve({ cancellationReasonId: id }),
      }),
    status: (request, id) =>
      STATUS_CANCELLATION_REASON(request, {
        params: Promise.resolve({ cancellationReasonId: id }),
      }),
  },
  {
    key: 'visit_reasons',
    relation: 'rec.visit_reasons',
    listPath: '/reception-catalogue/visit-reasons',
    permission: 'rec.catalogue.manage',
    createId: 'rec.catalogue-visit-reason-create',
    updateId: 'rec.catalogue-visit-reason-update',
    statusId: 'rec.catalogue-visit-reason-status-set',
    createdAction: 'rec.visit_reason.created',
    renamedAction: 'rec.visit_reason.renamed',
    statusAction: 'rec.visit_reason.status_changed',
    list: LIST_VISIT_REASONS,
    create: CREATE_VISIT_REASON,
    update: (request, id) =>
      UPDATE_VISIT_REASON(request, { params: Promise.resolve({ visitReasonId: id }) }),
    status: (request, id) =>
      STATUS_VISIT_REASON(request, { params: Promise.resolve({ visitReasonId: id }) }),
  },
  {
    key: 'fuel_levels',
    relation: 'rec.fuel_levels',
    listPath: '/reception-catalogue/fuel-levels',
    permission: 'rec.catalogue.manage',
    createId: 'rec.catalogue-fuel-level-create',
    updateId: 'rec.catalogue-fuel-level-update',
    statusId: 'rec.catalogue-fuel-level-status-set',
    createdAction: 'rec.fuel_level.created',
    renamedAction: 'rec.fuel_level.renamed',
    statusAction: 'rec.fuel_level.status_changed',
    list: LIST_FUEL_LEVELS,
    create: CREATE_FUEL_LEVEL,
    update: (request, id) =>
      UPDATE_FUEL_LEVEL(request, { params: Promise.resolve({ fuelLevelId: id }) }),
    status: (request, id) =>
      STATUS_FUEL_LEVEL(request, { params: Promise.resolve({ fuelLevelId: id }) }),
  },
  {
    key: 'warning_light_codes',
    relation: 'rec.warning_light_codes',
    listPath: '/reception-catalogue/warning-light-codes',
    permission: 'rec.catalogue.manage',
    createId: 'rec.catalogue-warning-light-code-create',
    updateId: 'rec.catalogue-warning-light-code-update',
    statusId: 'rec.catalogue-warning-light-code-status-set',
    createdAction: 'rec.warning_light_code.created',
    renamedAction: 'rec.warning_light_code.renamed',
    statusAction: 'rec.warning_light_code.status_changed',
    list: LIST_WARNING_LIGHT_CODES,
    create: CREATE_WARNING_LIGHT_CODE,
    update: (request, id) =>
      UPDATE_WARNING_LIGHT_CODE(request, {
        params: Promise.resolve({ warningLightCodeId: id }),
      }),
    status: (request, id) =>
      STATUS_WARNING_LIGHT_CODE(request, {
        params: Promise.resolve({ warningLightCodeId: id }),
      }),
  },
  {
    key: 'refusal_reasons',
    relation: 'rec.refusal_reasons',
    listPath: '/reception-catalogue/refusal-reasons',
    permission: 'rec.catalogue.manage',
    createId: 'rec.catalogue-refusal-reason-create',
    updateId: 'rec.catalogue-refusal-reason-update',
    statusId: 'rec.catalogue-refusal-reason-status-set',
    createdAction: 'rec.refusal_reason.created',
    renamedAction: 'rec.refusal_reason.renamed',
    statusAction: 'rec.refusal_reason.status_changed',
    list: LIST_REFUSAL_REASONS,
    create: CREATE_REFUSAL_REASON,
    update: (request, id) =>
      UPDATE_REFUSAL_REASON(request, { params: Promise.resolve({ refusalReasonId: id }) }),
    status: (request, id) =>
      STATUS_REFUSAL_REASON(request, { params: Promise.resolve({ refusalReasonId: id }) }),
  },
];

let admin: Pool;
let runtime: Pool;

function authAs(subject: string, tenantId = TENANT_A): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: subject,
      tenantId,
    })
  );
}

function post(
  catalogue: CatalogueUnderTest,
  body: unknown,
  key = crypto.randomUUID()
): Promise<Response> {
  return catalogue.create(
    new Request(`http://localhost/api/v1${catalogue.listPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    })
  );
}

function patch(
  catalogue: CatalogueUnderTest,
  id: string,
  body: unknown,
  version: number | null
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (version !== null) headers['if-match'] = String(version);
  return catalogue.update(
    new Request(`http://localhost/api/v1${catalogue.listPath}/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    }),
    id
  );
}

function setStatus(
  catalogue: CatalogueUnderTest,
  id: string,
  status: string,
  version: number | null,
  key = crypto.randomUUID()
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotency-key': key,
  };
  if (version !== null) headers['if-match'] = String(version);
  return catalogue.status(
    new Request(`http://localhost/api/v1${catalogue.listPath}/${id}/status`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ status }),
    }),
    id
  );
}

/** Creates an entry through the API under test and returns its identity. */
async function addEntry(
  catalogue: CatalogueUnderTest,
  code = nextCode()
): Promise<{ id: string; code: string; version: number }> {
  const response = await post(catalogue, { code, name: `Managed ${code}` });
  expect(response.status, `${catalogue.createId} create`).toBe(201);
  const body = (await response.json()) as EntryBody;
  return { id: body.id ?? '', code, version: body.recordVersion ?? 0 };
}

/**
 * Removes every `zz_mgmt_%` row from all seven relations, PLATFORM rows included.
 *
 * Runs from both `beforeAll` and `afterAll`. `cleanBackendFixtures` cascades by
 * tenant and a platform row has no tenant, so this is the only thing that clears
 * them — and clearing them on the way IN is what keeps an interrupted run from
 * blocking every run after it on `uq_<t>_platform_code`.
 *
 * Deletes by prefix rather than by this run's token, so it also collects debris
 * left by an earlier crashed run.
 */
async function sweepPlatformCatalogueRows(pool: Pool): Promise<void> {
  for (const catalogue of CATALOGUES) {
    await pool.query(`DELETE FROM ${catalogue.relation} WHERE code LIKE $1`, [`${CODE_PREFIX}%`]);
  }
}

async function scalar(sql: string, values: readonly unknown[]): Promise<string | null> {
  const result = await admin.query<{ value: string | null }>(sql, [...values]);
  return result.rows[0]?.value ?? null;
}

async function auditCount(entityId: string, action: string): Promise<number> {
  return Number(
    (await scalar(
      `SELECT count(*)::text AS value FROM iam.audit_records WHERE action = $2 AND entity_id = $1`,
      [entityId, action]
    )) ?? '0'
  );
}

async function seedPrincipal(
  tenantId: string,
  roleId: string,
  userId: string,
  subject: string,
  permissions: readonly string[]
): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','Catalogue Principal','active',$5) ON CONFLICT (id) DO NOTHING`,
    [userId, tenantId, IDENTITY_PROVIDER, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-18 catalogue principal',$4) ON CONFLICT (id) DO NOTHING`,
    [roleId, tenantId, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code = ANY($4::text[])
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [tenantId, roleId, USER_A, [...permissions]]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
    [tenantId, userId, roleId, USER_A]
  );
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  // `cleanBackendFixtures` cascades by TENANT, so it cannot see the platform
  // rows (tenant_id NULL) the platform-default refusal test inserts. Swept here
  // as well as in `afterAll` because a run killed before its own teardown would
  // otherwise leave debris that no later run can clear — and the platform unique
  // index is on `code` alone, so that debris blocks the insert rather than
  // merely accumulating.
  await sweepPlatformCatalogueRows(admin);
  await ensureBackendFixtures(admin);

  // The two new codes plus the ones the reads and reception writes already use.
  // Seeded here for the same reason the read suite seeds its own: a permission
  // that does not exist cannot be held, so every denial test would pass
  // vacuously against a catalog missing the code.
  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ('apt.catalogue.manage','apt','Manage the tenant appointment configuration catalogues','high',$1),
            ('rec.catalogue.manage','rec','Manage the tenant reception configuration catalogues','high',$1),
            ('apt.appointment.read','apt','Read appointments, the branch calendar and the appointment catalogues','low',$1),
            ('rec.reception.read','rec','Read reception visits, parties, authorizations, condition evidence and custody history','low',$1),
            ('rec.reception.manage','rec','Open a reception visit and accept vehicle custody','medium',$1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );

  await seedPrincipal(TENANT_A, ROLE_MANAGER, USER_MANAGER, SUBJ_MANAGER, MANAGE_PERMISSIONS);
  await seedPrincipal(TENANT_A, ROLE_READER, USER_READER, SUBJ_READER, READ_ONLY_PERMISSIONS);
  await seedPrincipal(TENANT_B, ROLE_TENANT_B, USER_TENANT_B, SUBJ_TENANT_B, MANAGE_PERMISSIONS);

  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );
    await client.query(
      `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
       VALUES ($1,$2,'organization','Catalogue Requester A','active',$3) ON CONFLICT (id) DO NOTHING`,
      [PARTNER_A, TENANT_A, USER_A]
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

afterEach(() => __resetAuthenticatorForTests());

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    // Order matters, and not for tidiness. The tenant cascade removes every
    // TENANT-scoped row this file created — the catalogue entries and the
    // reception visit that references one — in an order that respects
    // `fk_reception_visits_fuel_level` being ON DELETE RESTRICT, which is the
    // property the suite proves. Deleting the fuel level first would fail on
    // exactly that constraint.
    await cleanBackendFixtures(admin);
    // What the tenant cascade cannot reach: the PLATFORM rows (tenant_id NULL)
    // the platform-default refusal test inserts. Nothing references them.
    await sweepPlatformCatalogueRows(admin);
    await admin.end();
  }
});

describe('P1-27-INT-018 — the twenty-one management operations are registered as declared', () => {
  it('declares each command with its own permission, audit action and guards', () => {
    const declared = [
      [APPOINTMENT_TYPE_CREATE_OPERATION, 'apt.catalogue-appointment-type-create', 'POST'],
      [APPOINTMENT_TYPE_UPDATE_OPERATION, 'apt.catalogue-appointment-type-update', 'PATCH'],
      [APPOINTMENT_TYPE_STATUS_OPERATION, 'apt.catalogue-appointment-type-status-set', 'POST'],
      [SOURCE_CHANNEL_CREATE_OPERATION, 'apt.catalogue-source-channel-create', 'POST'],
      [SOURCE_CHANNEL_UPDATE_OPERATION, 'apt.catalogue-source-channel-update', 'PATCH'],
      [SOURCE_CHANNEL_STATUS_OPERATION, 'apt.catalogue-source-channel-status-set', 'POST'],
      [CANCELLATION_REASON_CREATE_OPERATION, 'apt.catalogue-cancellation-reason-create', 'POST'],
      [CANCELLATION_REASON_UPDATE_OPERATION, 'apt.catalogue-cancellation-reason-update', 'PATCH'],
      [
        CANCELLATION_REASON_STATUS_OPERATION,
        'apt.catalogue-cancellation-reason-status-set',
        'POST',
      ],
      [VISIT_REASON_CREATE_OPERATION, 'rec.catalogue-visit-reason-create', 'POST'],
      [VISIT_REASON_UPDATE_OPERATION, 'rec.catalogue-visit-reason-update', 'PATCH'],
      [VISIT_REASON_STATUS_OPERATION, 'rec.catalogue-visit-reason-status-set', 'POST'],
      [FUEL_LEVEL_CREATE_OPERATION, 'rec.catalogue-fuel-level-create', 'POST'],
      [FUEL_LEVEL_UPDATE_OPERATION, 'rec.catalogue-fuel-level-update', 'PATCH'],
      [FUEL_LEVEL_STATUS_OPERATION, 'rec.catalogue-fuel-level-status-set', 'POST'],
      [WARNING_LIGHT_CODE_CREATE_OPERATION, 'rec.catalogue-warning-light-code-create', 'POST'],
      [WARNING_LIGHT_CODE_UPDATE_OPERATION, 'rec.catalogue-warning-light-code-update', 'PATCH'],
      [WARNING_LIGHT_CODE_STATUS_OPERATION, 'rec.catalogue-warning-light-code-status-set', 'POST'],
      [REFUSAL_REASON_CREATE_OPERATION, 'rec.catalogue-refusal-reason-create', 'POST'],
      [REFUSAL_REASON_UPDATE_OPERATION, 'rec.catalogue-refusal-reason-update', 'PATCH'],
      [REFUSAL_REASON_STATUS_OPERATION, 'rec.catalogue-refusal-reason-status-set', 'POST'],
    ] as const;

    expect(declared).toHaveLength(21);

    for (const [operation, id, method] of declared) {
      const namespace = id.startsWith('apt.') ? 'apt' : 'rec';
      expect(operation.id, id).toBe(id);
      expect(operation.method, id).toBe(method);
      expect(operation.module, id).toBe('reception');
      expect(operation.scope, id).toBe('tenant');
      // The whole point of the new codes: management is NOT implied by the read
      // codes the pickers use, nor by the booking/check-in write codes.
      expect(operation.permissions, id).toEqual([`${namespace}.catalogue.manage`]);
      expect(operation.auditClass, id).toBe('privileged');
      expect(operation.rateLimitPolicy, id).toBe('standard-command');
      expect(operation.cacheCategory, id).toBe('never');

      if (id.endsWith('-create')) {
        expect(operation.idempotent, id).toBe(true);
        expect(operation.versionGuarded ?? false, id).toBe(false);
      } else if (id.endsWith('-update')) {
        expect(operation.idempotent ?? false, id).toBe(false);
        expect(operation.versionGuarded, id).toBe(true);
      } else {
        expect(operation.idempotent, id).toBe(true);
        expect(operation.versionGuarded, id).toBe(true);
      }
    }
  });
});

describe.each(CATALOGUES.map((c) => [c.key, c] as const))(
  'the %s management contract',
  (_key, catalogue) => {
    it('creates a TENANT row of the caller tenant and the picker offers it immediately', async () => {
      authAs(SUBJ_MANAGER);
      const code = nextCode();
      const response = await post(catalogue, { code, name: `Managed ${code}` });

      expect(response.status).toBe(201);
      const body = (await response.json()) as EntryBody;
      expect(body.code).toBe(code);
      expect(body.name).toBe(`Managed ${code}`);
      expect(body.status).toBe('active');
      expect(body.recordVersion).toBe(1);
      expect(response.headers.get('etag')).toBe('"1"');

      // Scope and tenant come from the principal, never the request.
      const row = await admin.query<{ scope: string; tenant_id: string; created_by: string }>(
        `SELECT scope, tenant_id, created_by FROM ${catalogue.relation} WHERE id = $1`,
        [body.id]
      );
      expect(row.rows[0]?.scope).toBe('tenant');
      expect(row.rows[0]?.tenant_id).toBe(TENANT_A);
      expect(row.rows[0]?.created_by).toBe(USER_MANAGER);

      // The end-to-end point: the read that feeds the mandatory picker now has
      // something to return, and it came from the API rather than a seed.
      authAs(SUBJ_READER);
      const list = await catalogue.list(
        new Request(`http://localhost/api/v1${catalogue.listPath}?limit=100`)
      );
      expect(list.status).toBe(200);
      const page = (await list.json()) as PageBody;
      expect(page.items?.some((item) => item.id === body.id)).toBe(true);

      expect(await auditCount(body.id ?? '', catalogue.createdAction)).toBe(1);
    });

    it('refuses a caller holding both READ codes and neither manage code', async () => {
      authAs(SUBJ_READER);
      const code = nextCode();

      const created = await post(catalogue, { code, name: 'Should not exist' });
      expect(created.status).toBe(403);

      // Nothing was written, so a denial cannot be mistaken for a silent success.
      const count = await scalar(
        `SELECT count(*)::text AS value FROM ${catalogue.relation} WHERE code = $1`,
        [code]
      );
      expect(count).toBe('0');

      // The same principal may READ the catalogue — which is what makes this a
      // proof that the manage code decides, not authentication.
      const list = await catalogue.list(
        new Request(`http://localhost/api/v1${catalogue.listPath}`)
      );
      expect(list.status).toBe(200);
    });

    it('refuses an unauthenticated caller before any authorization runs', async () => {
      __resetAuthenticatorForTests();
      const response = await post(catalogue, { code: nextCode(), name: 'Anonymous' });
      expect(response.status).toBe(401);
    });

    it('answers the same 404 for an unknown id and for another tenant’s entry', async () => {
      authAs(SUBJ_TENANT_B, TENANT_B);
      const foreign = await addEntry(catalogue);

      authAs(SUBJ_MANAGER);
      const unknown = crypto.randomUUID();

      const unknownUpdate = await patch(catalogue, unknown, { name: 'Nope' }, 1);
      const foreignUpdate = await patch(catalogue, foreign.id, { name: 'Nope' }, 1);
      expect(unknownUpdate.status).toBe(404);
      expect(foreignUpdate.status).toBe(404);
      expect(((await foreignUpdate.json()) as ProblemBody).code).toBe('ERR-RES-001');

      const foreignStatus = await setStatus(catalogue, foreign.id, 'inactive', 1);
      expect(foreignStatus.status).toBe(404);

      // Tenant B's row is untouched by tenant A's attempts.
      const still = await scalar(
        `SELECT status AS value FROM ${catalogue.relation} WHERE id = $1`,
        [foreign.id]
      );
      expect(still).toBe('active');
    });

    it('refuses to edit a PLATFORM default, with an explanation rather than a version conflict', async () => {
      const platformId = crypto.randomUUID();
      const code = nextCode();
      await admin.query(
        `INSERT INTO ${catalogue.relation} (id, scope, tenant_id, code, name, created_by)
         VALUES ($1,'platform',NULL,$2,'Shared Default',$3)`,
        [platformId, code, USER_A]
      );

      authAs(SUBJ_MANAGER);
      const renamed = await patch(catalogue, platformId, { name: 'Mine now' }, 1);
      expect(renamed.status).toBe(403);
      expect(((await renamed.json()) as ProblemBody).code).toBe('ERR-IAM-001');

      const retired = await setStatus(catalogue, platformId, 'inactive', 1);
      expect(retired.status).toBe(403);

      const untouched = await scalar(
        `SELECT name AS value FROM ${catalogue.relation} WHERE id = $1`,
        [platformId]
      );
      expect(untouched).toBe('Shared Default');
    });

    it('refuses a duplicate code with 409, and a RETIRED entry still holds its code', async () => {
      authAs(SUBJ_MANAGER);
      const first = await addEntry(catalogue);

      const duplicate = await post(catalogue, { code: first.code, name: 'Second' });
      expect(duplicate.status).toBe(409);
      expect(((await duplicate.json()) as ProblemBody).code).toBe('ERR-RES-002');

      // Retire it, then try the code again. The unique index predicate is
      // `deleted_at IS NULL` and says nothing about status, so the code is STILL
      // taken — this is precisely why the lifecycle command restores as well as
      // retires, and a retire-only design would burn the code permanently.
      const retired = await setStatus(catalogue, first.id, 'inactive', first.version);
      expect(retired.status).toBe(200);

      const afterRetirement = await post(catalogue, { code: first.code, name: 'Third' });
      expect(afterRetirement.status).toBe(409);

      // Restoring brings it back to the picker, which is the way out.
      const restored = await setStatus(catalogue, first.id, 'active', first.version + 1);
      expect(restored.status).toBe(200);
      expect(((await restored.json()) as EntryBody).status).toBe('active');
    });

    it('retires an entry out of the picker and restores it back in', async () => {
      authAs(SUBJ_MANAGER);
      const entry = await addEntry(catalogue);

      const offered = async (): Promise<boolean> => {
        const list = await catalogue.list(
          new Request(`http://localhost/api/v1${catalogue.listPath}?limit=100`)
        );
        const page = (await list.json()) as PageBody;
        return page.items?.some((item) => item.id === entry.id) ?? false;
      };

      expect(await offered()).toBe(true);

      expect((await setStatus(catalogue, entry.id, 'inactive', entry.version)).status).toBe(200);
      expect(await offered()).toBe(false);

      // The row is still there — retirement is not a deletion.
      expect(
        await scalar(`SELECT status AS value FROM ${catalogue.relation} WHERE id = $1`, [entry.id])
      ).toBe('inactive');

      expect((await setStatus(catalogue, entry.id, 'active', entry.version + 1)).status).toBe(200);
      expect(await offered()).toBe(true);

      expect(await auditCount(entry.id, catalogue.statusAction)).toBe(2);
    });

    it('renames under If-Match, refusing a missing version with 428 and a stale one with 409', async () => {
      authAs(SUBJ_MANAGER);
      const entry = await addEntry(catalogue);

      const missing = await patch(catalogue, entry.id, { name: 'No version' }, null);
      expect(missing.status).toBe(428);
      expect(((await missing.json()) as ProblemBody).code).toBe('ERR-CON-002');

      const stale = await patch(catalogue, entry.id, { name: 'Stale' }, entry.version + 5);
      expect(stale.status).toBe(409);
      expect(((await stale.json()) as ProblemBody).code).toBe('ERR-CON-001');

      const renamed = await patch(catalogue, entry.id, { name: 'Corrected Label' }, entry.version);
      expect(renamed.status).toBe(200);
      const body = (await renamed.json()) as EntryBody;
      expect(body.name).toBe('Corrected Label');
      expect(body.recordVersion).toBe(entry.version + 1);
      expect(body.code).toBe(entry.code);

      // The published version is the ROW's, not `expectedVersion + 1` inferred
      // from the request: this number is what the client sends back as its next
      // `If-Match`, so a value the database did not produce would desynchronize
      // the whole optimistic-concurrency chain the moment the touch trigger
      // changed. Asserted against the stored row and the ETag together.
      const stored = await scalar(
        `SELECT record_version::text AS value FROM ${catalogue.relation} WHERE id = $1`,
        [entry.id]
      );
      expect(stored).toBe(String(body.recordVersion));
      expect(renamed.headers.get('etag')).toBe(`"${body.recordVersion}"`);

      expect(await auditCount(entry.id, catalogue.renamedAction)).toBe(1);
    });

    it('refuses to change the immutable code, and refuses a malformed one outright', async () => {
      authAs(SUBJ_MANAGER);
      const entry = await addEntry(catalogue);

      // `code` is not in the PATCH body at all — a strict schema, so offering it
      // is a 422 rather than a silently ignored field.
      const recode = await patch(
        catalogue,
        entry.id,
        { name: 'Fine', code: 'zz_mgmt_recoded' },
        entry.version
      );
      expect(recode.status).toBe(422);
      expect(
        await scalar(`SELECT code AS value FROM ${catalogue.relation} WHERE id = $1`, [entry.id])
      ).toBe(entry.code);

      // The create schema mirrors `ck_<t>_code_format`, so these never reach the
      // database.
      expect((await post(catalogue, { code: 'Not Valid', name: 'x' })).status).toBe(422);
      expect((await post(catalogue, { code: '9leading', name: 'x' })).status).toBe(422);
      expect((await post(catalogue, { code: nextCode(), name: '   ' })).status).toBe(422);
      expect((await post(catalogue, { code: nextCode() })).status).toBe(422);
    });

    it('replays a create and a status change on the same key without writing twice', async () => {
      authAs(SUBJ_MANAGER);
      const code = nextCode();
      const key = crypto.randomUUID();

      const first = await post(catalogue, { code, name: `Managed ${code}` }, key);
      expect(first.status).toBe(201);
      const created = (await first.json()) as EntryBody;

      // A replay returns the STORED response as 200 — the platform's documented
      // replay shape — carrying the same entry, not a second one.
      const replay = await post(catalogue, { code, name: `Managed ${code}` }, key);
      expect(replay.status).toBe(200);
      expect(((await replay.json()) as EntryBody).id).toBe(created.id);

      // One row, one audit record — not two of either.
      expect(
        await scalar(`SELECT count(*)::text AS value FROM ${catalogue.relation} WHERE code = $1`, [
          code,
        ])
      ).toBe('1');
      expect(await auditCount(created.id ?? '', catalogue.createdAction)).toBe(1);

      const statusKey = crypto.randomUUID();
      const retired = await setStatus(catalogue, created.id ?? '', 'inactive', 1, statusKey);
      expect(retired.status).toBe(200);
      const retiredReplay = await setStatus(catalogue, created.id ?? '', 'inactive', 1, statusKey);
      expect(retiredReplay.status).toBe(200);
      expect(await auditCount(created.id ?? '', catalogue.statusAction)).toBe(1);
    });
  }
);

describe('a referenced entry cannot be hard-removed by anybody', () => {
  it('holds no DELETE grant for app_runtime on any of the seven relations', async () => {
    const { rows } = await admin.query<{ relation: string }>(
      `SELECT table_schema || '.' || table_name AS relation
         FROM information_schema.role_table_grants
        WHERE grantee = 'app_runtime' AND privilege_type = 'DELETE'
          AND table_schema || '.' || table_name = ANY($1::text[])`,
      [CATALOGUES.map((c) => c.relation)]
    );
    expect(rows).toEqual([]);
  });

  it('refuses a DELETE from the runtime role even for an unreferenced entry', async () => {
    authAs(SUBJ_MANAGER);
    const catalogue = CATALOGUES.find((c) => c.key === 'fuel_levels');
    if (!catalogue) throw new Error('fuel_levels catalogue missing');
    const entry = await addEntry(catalogue);

    // Not a hypothetical: this is the statement a delete route would have to
    // issue, run on the role a request actually runs as.
    await expect(
      runtime.query(`DELETE FROM ${catalogue.relation} WHERE id = $1`, [entry.id])
    ).rejects.toMatchObject({ code: '42501' });

    expect(
      await scalar(`SELECT status AS value FROM ${catalogue.relation} WHERE id = $1`, [entry.id])
    ).toBe('active');
  });

  it('refuses a hard delete of an entry a reception visit references, and retires it instead', async () => {
    authAs(SUBJ_MANAGER);
    const catalogue = CATALOGUES.find((c) => c.key === 'fuel_levels');
    if (!catalogue) throw new Error('fuel_levels catalogue missing');
    const entry = await addEntry(catalogue);

    // A vehicle, then a real reception visit that references the fuel level this
    // suite just created through the API. This is the remediation working end to
    // end: a catalogue populated by an operator is immediately usable by the
    // intake write that demanded it.
    const client = await admin.connect();
    let vehicleId = '';
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [USER_A, TENANT_A]
      );
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO veh.vehicles (tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
         VALUES ($1,'P118CATMGMT00001','ice','active',$2) RETURNING id`,
        [TENANT_A, USER_A]
      );
      vehicleId = inserted.rows[0]?.id ?? '';
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const reception = await CREATE_RECEPTION(
      new Request('http://localhost/api/v1/receptions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          companyId: COMPANY_A1,
          branchId: BRANCH_A1,
          vehicleId,
          receivingEmployeeId: USER_A,
          serviceRequesterPartnerId: PARTNER_A,
          fuelLevelId: entry.id,
          origin: { kind: 'walk_in' },
        }),
      })
    );
    expect(reception.status).toBe(201);

    // Even the ADMIN role cannot remove it: fk_reception_visits_fuel_level is
    // ON DELETE RESTRICT. The row a live visit points at cannot vanish.
    await expect(
      admin.query(`DELETE FROM ${catalogue.relation} WHERE id = $1`, [entry.id])
    ).rejects.toMatchObject({ code: '23503' });

    // Retirement is the withdrawal that IS available, and it leaves the
    // reference intact.
    expect((await setStatus(catalogue, entry.id, 'inactive', entry.version)).status).toBe(200);
    expect(
      await scalar(
        `SELECT f.status AS value
           FROM rec.reception_visits v JOIN rec.fuel_levels f ON f.id = v.fuel_level_id
          WHERE v.fuel_level_id = $1 LIMIT 1`,
        [entry.id]
      )
    ).toBe('inactive');
  });
});
