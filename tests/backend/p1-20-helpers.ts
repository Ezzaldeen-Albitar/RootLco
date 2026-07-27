/**
 * Phase 1-20 backend fixtures — service catalog, pricing, quotation.
 *
 * Builds the minimum protected-schema state the commercial surface needs, in
 * BOTH tenants and in two tenant-A branches, so cross-tenant and cross-branch
 * isolation can be asserted rather than assumed.
 *
 * Principals are seeded here rather than reused from `p1-19-helpers` because the
 * P1-19 roles carry no `svc.*`/`quo.*` permission, and widening them would change
 * what the P1-19 suites prove.
 *
 * The scoped principals are the point of the file:
 *
 *  - `SVC_SCOPED_A2` holds `svc.service.read` scoped to branch A2 **only**. It
 *    must not be able to read A1's availability.
 *  - `SVC_PERMISSION_ELSEWHERE` holds `svc.service.read` scoped to A2 *and* an
 *    unrelated permission scoped to A1. That second grant puts A1 into its
 *    `iam.allowed_branch_ids()` union without giving it catalog authority there —
 *    the only way to prove that a *scoped permission check*, and not RLS, is what
 *    refuses the read (P1-18-A-01).
 */
import type { Pool } from 'pg';
import { BRANCH_A1, COMPANY_A1, IDENTITY_PROVIDER, TENANT_A, TENANT_B, USER_A } from './helpers';
import { BRANCH_A2, BRANCH_B1, COMPANY_B1 } from './p1-19-helpers';
import { StaticClaimsAuthenticator, setSessionAuthenticator } from '@/server/context/principal';

/** An unrelated permission used only to widen a grant union. */
const WIDENING_PERMISSION = 'org.tenant.read';

export const SERVICE_READ = 'svc.service.read';
export const PRICE_READ = 'svc.price.read';
export const PRICE_MANAGE = 'svc.price.manage';
export const PRICE_PUBLISH = 'svc.price.publish';
export const QUOTATION_READ = 'quo.quotation.read';
export const QUOTATION_MANAGE = 'quo.quotation.manage';
export const DECISION_RECORD = 'quo.decision.record';

// ---- Catalog fixture ids ---------------------------------------------------

export const CATEGORY_A = 'd2000000-0000-4000-8000-000000000001';
export const SERVICE_A = 'd2000000-0000-4000-8000-00000000000a';
export const SERVICE_A_ALT = 'd2000000-0000-4000-8000-00000000000b';
/** Archived, so it must never appear in an `active` listing. */
export const SERVICE_A_ARCHIVED = 'd2000000-0000-4000-8000-00000000000c';
export const SERVICE_VERSION_A = 'd2000000-0000-4000-8000-0000000000a1';
export const SERVICE_VERSION_A_ALT = 'd2000000-0000-4000-8000-0000000000a2';

export const CATEGORY_B = 'd2000000-0000-4000-8000-000000000101';
export const SERVICE_B = 'd2000000-0000-4000-8000-00000000010a';
export const SERVICE_VERSION_B = 'd2000000-0000-4000-8000-0000000001a1';

/** A date every published fixture version covers. */
export const EFFECTIVE_FROM = '2020-01-01';

export interface Principal {
  readonly roleId: string;
  readonly userId: string;
  readonly subject: string;
  readonly tenantId: string;
  readonly permissions: readonly string[];
  readonly grantId?: string;
  readonly scope?: { readonly companyId: string; readonly branchId: string };
}

/** Every commercial permission, unrestricted, tenant A. */
export const SVC_FULL: Principal = {
  roleId: 'd2900000-0000-4000-8000-0000000000a1',
  userId: 'd2900000-0000-4000-8000-0000000000a2',
  subject: 'fx_p1_20_full',
  tenantId: TENANT_A,
  permissions: [
    SERVICE_READ,
    PRICE_READ,
    PRICE_MANAGE,
    PRICE_PUBLISH,
    QUOTATION_READ,
    QUOTATION_MANAGE,
    DECISION_RECORD,
  ],
};

/** Catalog read only — must not reach a price. */
export const SVC_READER: Principal = {
  roleId: 'd2900000-0000-4000-8000-0000000000b1',
  userId: 'd2900000-0000-4000-8000-0000000000b2',
  subject: 'fx_p1_20_reader',
  tenantId: TENANT_A,
  permissions: [SERVICE_READ],
};

/** Holds nothing this phase needs. */
export const SVC_UNPERMITTED: Principal = {
  roleId: 'd2900000-0000-4000-8000-0000000000c1',
  userId: 'd2900000-0000-4000-8000-0000000000c2',
  subject: 'fx_p1_20_unpermitted',
  tenantId: TENANT_A,
  permissions: [WIDENING_PERMISSION],
};

/** `svc.service.read` scoped to branch A2 only. */
export const SVC_SCOPED_A2: Principal = {
  roleId: 'd2900000-0000-4000-8000-0000000000d1',
  userId: 'd2900000-0000-4000-8000-0000000000d2',
  subject: 'fx_p1_20_scoped_a2',
  tenantId: TENANT_A,
  permissions: [SERVICE_READ],
  grantId: 'd2900000-0000-4000-8000-0000000000d3',
  scope: { companyId: COMPANY_A1, branchId: BRANCH_A2 },
};

/**
 * `svc.service.read` scoped to A2, plus an unrelated permission scoped to A1.
 *
 * The A1 grant widens `iam.allowed_branch_ids()` without conferring catalog
 * authority in A1, so a scope-blind check would wrongly serve A1's availability.
 */
export const SVC_PERMISSION_ELSEWHERE: Principal = {
  roleId: 'd2900000-0000-4000-8000-0000000000e1',
  userId: 'd2900000-0000-4000-8000-0000000000e2',
  subject: 'fx_p1_20_permission_elsewhere',
  tenantId: TENANT_A,
  permissions: [SERVICE_READ],
  grantId: 'd2900000-0000-4000-8000-0000000000e3',
  scope: { companyId: COMPANY_A1, branchId: BRANCH_A2 },
};

const WIDENING_ROLE = 'd2900000-0000-4000-8000-0000000000f1';

/** Tenant B, everything — proves a tenant boundary, not a permission one. */
export const SVC_TENANT_B: Principal = {
  roleId: 'd2900000-0000-4000-8000-000000000101',
  userId: 'd2900000-0000-4000-8000-000000000102',
  subject: 'fx_p1_20_tenant_b',
  tenantId: TENANT_B,
  permissions: [SERVICE_READ, PRICE_READ, QUOTATION_READ, QUOTATION_MANAGE],
};

export const P1_20_PRINCIPALS: readonly Principal[] = [
  SVC_FULL,
  SVC_READER,
  SVC_UNPERMITTED,
  SVC_SCOPED_A2,
  SVC_PERMISSION_ELSEWHERE,
  SVC_TENANT_B,
];

let admin: Pool;

/** Installs a fake authenticator resolving to `principal`. */
export function authAs(principal: Principal): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: principal.subject,
      tenantId: principal.tenantId,
    })
  );
}

async function seedPrincipal(principal: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','P1-20 Principal','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [principal.userId, principal.tenantId, IDENTITY_PROVIDER, principal.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-20 fixture',$4) ON CONFLICT (id) DO NOTHING`,
    [principal.roleId, principal.tenantId, principal.subject, USER_A]
  );
  for (const code of principal.permissions) {
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
        WHERE p.permission_code = $4
       ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
      [principal.tenantId, principal.roleId, USER_A, code]
    );
  }

  if (principal.scope === undefined) {
    await admin.query(
      `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
      [principal.tenantId, principal.userId, principal.roleId, USER_A]
    );
    return;
  }
  // A scoped active grant must carry at least one scope, enforced by a DEFERRABLE
  // constraint trigger — so the grant and its scope land in one transaction.
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
      [principal.grantId, principal.tenantId, principal.userId, principal.roleId, USER_A]
    );
    await client.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
       VALUES ($1,$2,'branch',$3,$4,$5)`,
      [
        principal.tenantId,
        principal.grantId,
        principal.scope.companyId,
        principal.scope.branchId,
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

/**
 * Seeds the catalog for one tenant: a category, services, published versions and
 * branch availability.
 *
 * `svc.publish_service_version` is not used here — it resolves the tenant from
 * `iam.current_tenant_id()`, which an admin-pool fixture does not set. The rows
 * are inserted directly as `published`, which the gist EXCLUDE still validates,
 * so the fixture cannot create an overlapping published range.
 */
async function seedCatalog(input: {
  tenantId: string;
  categoryId: string;
  services: readonly { id: string; code: string; name: string; lifecycle: string }[];
  versions: readonly { id: string; serviceId: string }[];
  availability: readonly { companyId: string; branchId: string; serviceId: string }[];
}): Promise<void> {
  await admin.query(
    `INSERT INTO svc.service_categories (id, tenant_id, code, name, created_by)
     VALUES ($1,$2,$3,'P1-20 fixture category',$4) ON CONFLICT (id) DO NOTHING`,
    [input.categoryId, input.tenantId, `fx_p1_20_cat_${input.tenantId.slice(0, 4)}`, USER_A]
  );
  for (const service of input.services) {
    await admin.query(
      `INSERT INTO svc.services
         (id, tenant_id, service_category_id, service_code, name, lifecycle_status, archived_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,
               CASE WHEN $6 = 'archived' THEN now() ELSE NULL END, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        service.id,
        input.tenantId,
        input.categoryId,
        service.code,
        service.name,
        service.lifecycle,
        USER_A,
      ]
    );
  }
  for (const version of input.versions) {
    await admin.query(
      `INSERT INTO svc.service_versions
         (id, tenant_id, service_id, version_no, effective_from, status, created_by)
       VALUES ($1,$2,$3,1,$4::date,'published',$5) ON CONFLICT (id) DO NOTHING`,
      [version.id, input.tenantId, version.serviceId, EFFECTIVE_FROM, USER_A]
    );
  }
  for (const row of input.availability) {
    await admin.query(
      `INSERT INTO svc.branch_service_availability
         (tenant_id, company_id, branch_id, service_id, is_available, status, created_by)
       VALUES ($1,$2,$3,$4,true,'active',$5)
       ON CONFLICT DO NOTHING`,
      [input.tenantId, row.companyId, row.branchId, row.serviceId, USER_A]
    );
  }
}

/** Establishes every P1-20 fixture. Idempotent. */
export async function establishP1_20Fixtures(pool: Pool): Promise<void> {
  admin = pool;

  for (const principal of P1_20_PRINCIPALS) await seedPrincipal(principal);

  // The widening grant: a SECOND role for SVC_PERMISSION_ELSEWHERE carrying an
  // unrelated permission scoped to BRANCH_A1. It places A1 in that user's
  // allowed-branch union without any catalog authority there.
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,'fx_p1_20_widening','P1-20 widening',$3) ON CONFLICT (id) DO NOTHING`,
    [WIDENING_ROLE, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code = $4
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, WIDENING_ROLE, USER_A, WIDENING_PERMISSION]
  );
  const widening = await admin.connect();
  const wideningGrant = 'd2900000-0000-4000-8000-0000000000f2';
  try {
    await widening.query('BEGIN');
    const existing = await widening.query(`SELECT 1 FROM iam.role_grants WHERE id = $1`, [
      wideningGrant,
    ]);
    if (existing.rowCount === 0) {
      await widening.query(
        `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
         VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
        [wideningGrant, TENANT_A, SVC_PERMISSION_ELSEWHERE.userId, WIDENING_ROLE, USER_A]
      );
      await widening.query(
        `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
         VALUES ($1,$2,'branch',$3,$4,$5)`,
        [TENANT_A, wideningGrant, COMPANY_A1, BRANCH_A1, USER_A]
      );
    }
    await widening.query('COMMIT');
  } catch (error) {
    await widening.query('ROLLBACK');
    throw error;
  } finally {
    widening.release();
  }

  await seedCatalog({
    tenantId: TENANT_A,
    categoryId: CATEGORY_A,
    services: [
      { id: SERVICE_A, code: 'FX-P120-A', name: 'Fixture brake service', lifecycle: 'active' },
      { id: SERVICE_A_ALT, code: 'FX-P120-B', name: 'Fixture oil service', lifecycle: 'active' },
      {
        id: SERVICE_A_ARCHIVED,
        code: 'FX-P120-Z',
        name: 'Fixture retired service',
        lifecycle: 'archived',
      },
    ],
    versions: [
      { id: SERVICE_VERSION_A, serviceId: SERVICE_A },
      { id: SERVICE_VERSION_A_ALT, serviceId: SERVICE_A_ALT },
    ],
    availability: [
      // SERVICE_A is available in A1 only; SERVICE_A_ALT in A2 only. That
      // asymmetry is what makes a branch filter's answer meaningful.
      { companyId: COMPANY_A1, branchId: BRANCH_A1, serviceId: SERVICE_A },
      { companyId: COMPANY_A1, branchId: BRANCH_A2, serviceId: SERVICE_A_ALT },
    ],
  });

  await seedCatalog({
    tenantId: TENANT_B,
    categoryId: CATEGORY_B,
    services: [
      { id: SERVICE_B, code: 'FX-P120-TB', name: 'Tenant B service', lifecycle: 'active' },
    ],
    versions: [{ id: SERVICE_VERSION_B, serviceId: SERVICE_B }],
    availability: [{ companyId: COMPANY_B1, branchId: BRANCH_B1, serviceId: SERVICE_B }],
  });
}
