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
/** Needed to READ the work order a quotation is raised against. */
export const WORK_ORDER_READ = 'wo.work_order.read';
/** P1-19 permissions the additional-work linking path needs. */
export const ADDITIONAL_WORK_REQUEST = 'wo.additional_work.request';
export const ADDITIONAL_WORK_APPROVE = 'wo.additional_work.approve';
export const JOB_MANAGE = 'wo.job.manage';

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

/**
 * A SECOND tenant-A company, and a branch in it.
 *
 * The shared fixtures give tenant A exactly one company, which makes one class of
 * authorization defect untestable: an `iam.approval_limits` row is per
 * `(role, company)`, so "this role's ceiling in a company my grant of it does not
 * reach" needs two companies in one tenant to express at all. With a single company
 * every branch-scoped grant reaches it through `org.branches` and the distinction
 * collapses.
 *
 * Seeded here rather than in the shared helpers so no other suite's fixture surface
 * changes; `deleteTenantCascade` removes it with the tenant.
 */
export const COMPANY_A2 = 'a1000000-0000-4000-8000-0000000000f1';
export const BRANCH_A2_OF_COMPANY_A2 = 'a1100000-0000-4000-8000-0000000000f1';

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
    WORK_ORDER_READ,
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

/**
 * May create a quotation, but holds NO discount approval ceiling.
 *
 * Exists to prove the fail-closed path: with no `iam.approval_limits` row, any
 * non-zero discount is refused. Deliberately NOT given a ceiling anywhere.
 */
export const SVC_NO_CEILING: Principal = {
  roleId: 'd2900000-0000-4000-8000-000000000111',
  userId: 'd2900000-0000-4000-8000-000000000112',
  subject: 'fx_p1_20_no_ceiling',
  tenantId: TENANT_A,
  permissions: [SERVICE_READ, PRICE_READ, PRICE_MANAGE, QUOTATION_MANAGE, WORK_ORDER_READ],
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

/**
 * Tenant B holding EVERY commercial write permission, unrestricted.
 *
 * `SVC_TENANT_B` deliberately lacks `svc.price.manage`, `svc.price.publish` and
 * `quo.decision.record`, because two existing cases use it to prove a *permission*
 * refusal. That makes it useless for a cross-tenant proof on the write surface: a
 * 403 there would be ambiguous, and a test that cannot distinguish "wrong tenant"
 * from "missing permission" proves the weaker of the two. This principal removes the
 * ambiguity — every refusal it collects is the tenant boundary and nothing else.
 */
export const SVC_TENANT_B_FULL: Principal = {
  roleId: 'd2900000-0000-4000-8000-000000000121',
  userId: 'd2900000-0000-4000-8000-000000000122',
  subject: 'fx_p1_20_tenant_b_full',
  tenantId: TENANT_B,
  permissions: [
    SERVICE_READ,
    PRICE_READ,
    PRICE_MANAGE,
    PRICE_PUBLISH,
    QUOTATION_READ,
    QUOTATION_MANAGE,
    DECISION_RECORD,
    WORK_ORDER_READ,
  ],
};

/**
 * Every price permission, scoped to branch A2 ONLY (P1-20-SEC-001).
 *
 * The isolation counterpart for the pricing write surface: it holds
 * `svc.price.manage` in full, so a refusal on an A1-targeted price rule is the
 * resolved scope and not a missing permission.
 */
export const SVC_PRICE_SCOPED_A2: Principal = {
  roleId: 'd2900000-0000-4000-8000-000000000131',
  userId: 'd2900000-0000-4000-8000-000000000132',
  subject: 'fx_p1_20_price_scoped_a2',
  tenantId: TENANT_A,
  permissions: [SERVICE_READ, PRICE_READ, PRICE_MANAGE, PRICE_PUBLISH],
  grantId: 'd2900000-0000-4000-8000-000000000133',
  scope: { companyId: COMPANY_A1, branchId: BRANCH_A2 },
};

/**
 * Every quotation permission, scoped to branch A2 ONLY (P1-20-SEC-001).
 *
 * Quotations are addressed by id and take their scope from the work order they
 * belong to, never from a request field. This principal proves that: it holds
 * `quo.quotation.manage` and `quo.decision.record` unreservedly, and is still
 * refused on a quotation whose work order sits in branch A1.
 */
export const SVC_QUO_SCOPED_A2: Principal = {
  roleId: 'd2900000-0000-4000-8000-000000000141',
  userId: 'd2900000-0000-4000-8000-000000000142',
  subject: 'fx_p1_20_quo_scoped_a2',
  tenantId: TENANT_A,
  permissions: [
    SERVICE_READ,
    PRICE_READ,
    QUOTATION_READ,
    QUOTATION_MANAGE,
    DECISION_RECORD,
    WORK_ORDER_READ,
  ],
  grantId: 'd2900000-0000-4000-8000-000000000143',
  scope: { companyId: COMPANY_A1, branchId: BRANCH_A2 },
};

/**
 * May approve additional work AND cite a quotation revision (P1-20-BE-013).
 *
 * Citing a revision on a `wo.additional-work-approval` requires `quo.quotation.read`,
 * checked inside `assertLinkableQuotationRevision` rather than declared on the
 * operation — the declaration is a CONJUNCTION, and every P1-19 caller recording an
 * approval without a quotation would otherwise need a commercial permission it has no
 * business holding.
 *
 * P1-19's own `FULL` principal is therefore not sufficient for the linking path and is
 * deliberately left alone: widening it would change what the P1-19 suites prove. This
 * principal is `FULL`'s approval permissions plus the one commercial read, which is
 * also what makes the refusal case meaningful — the same caller minus
 * `quo.quotation.read` is refused.
 */
export const WO_APPROVER_WITH_QUOTATION_READ: Principal = {
  roleId: 'd2900000-0000-4000-8000-000000000151',
  userId: 'd2900000-0000-4000-8000-000000000152',
  subject: 'fx_p1_20_wo_approver_quo_read',
  tenantId: TENANT_A,
  permissions: [
    WORK_ORDER_READ,
    ADDITIONAL_WORK_REQUEST,
    ADDITIONAL_WORK_APPROVE,
    JOB_MANAGE,
    QUOTATION_READ,
  ],
};

/**
 * The same approval authority WITHOUT `quo.quotation.read`.
 *
 * One permission apart from the principal above, so a refusal on the linking path can
 * only be that permission.
 */
export const WO_APPROVER_NO_QUOTATION_READ: Principal = {
  roleId: 'd2900000-0000-4000-8000-000000000161',
  userId: 'd2900000-0000-4000-8000-000000000162',
  subject: 'fx_p1_20_wo_approver_no_quo_read',
  tenantId: TENANT_A,
  permissions: [WORK_ORDER_READ, ADDITIONAL_WORK_REQUEST, ADDITIONAL_WORK_APPROVE, JOB_MANAGE],
};

export const P1_20_PRINCIPALS: readonly Principal[] = [
  SVC_FULL,
  SVC_READER,
  SVC_UNPERMITTED,
  SVC_SCOPED_A2,
  SVC_PERMISSION_ELSEWHERE,
  SVC_NO_CEILING,
  SVC_PRICE_SCOPED_A2,
  SVC_QUO_SCOPED_A2,
  SVC_TENANT_B,
  SVC_TENANT_B_FULL,
  WO_APPROVER_WITH_QUOTATION_READ,
  WO_APPROVER_NO_QUOTATION_READ,
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

export const TAX_CLASS_A = 'd2000000-0000-4000-8000-000000000201';
export const TAX_CLASS_A_UNRATED = 'd2000000-0000-4000-8000-000000000202';
/** `numeric(9,6)` FRACTION, not a percentage. Deliberately not a real jurisdiction. */
export const TAX_RATE_FRACTION = '0.100000';
/** Tenant B needs its OWN class ids: pk_tax_classes is on id alone. */
export const TAX_CLASS_B = 'd2000000-0000-4000-8000-000000000211';
export const TAX_CLASS_B_UNRATED = 'd2000000-0000-4000-8000-000000000212';

/**
 * Seeds a tax class with an effective rate, and a second class with NO rate.
 *
 * The unrated class exists to prove the refusal: a price rule naming a class with
 * no effective rate must fail, not silently price the line at 0% tax. The rate
 * itself is an arbitrary `0.100000` — no jurisdiction, country or statutory figure
 * is hard-coded anywhere in this fixture or in the code under test.
 */
async function seedTax(
  tenantId: string,
  companyId: string,
  ratedClassId: string,
  unratedClassId: string
): Promise<void> {
  // The class ids are PARAMETERS, not the module constants, because each tenant
  // needs its own rows: `pk_tax_classes` is on `id` alone, so reusing one id
  // across tenants makes the second insert a silent no-op under
  // `ON CONFLICT (id) DO NOTHING` — and the rate that follows then has no parent
  // and fails on `fk_tax_rates_tax_class`, far from the actual mistake.
  await admin.query(
    `INSERT INTO org.tax_classes (id, tenant_id, company_id, tax_class_code, name, status, created_by)
     VALUES ($1,$2,$3,'fx_p1_20_standard','P1-20 fixture class','active',$5),
            ($4,$2,$3,'fx_p1_20_unrated','P1-20 fixture class with no rate','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [ratedClassId, tenantId, companyId, unratedClassId, USER_A]
  );
  // A NOT EXISTS guard rather than `ON CONFLICT DO NOTHING`: the table carries
  // `ex_tax_rates_no_active_overlap`, a gist EXCLUDE, and `ON CONFLICT` covers
  // unique indexes only — an exclusion violation would still abort the fixture on
  // the second run.
  await admin.query(
    `INSERT INTO org.tax_rates
       (tenant_id, company_id, tax_class_id, rate, status, effective_from, created_by)
     SELECT $1,$2,$3,$4::numeric(9,6),'active',$5::date,$6
      WHERE NOT EXISTS (
        SELECT 1 FROM org.tax_rates
         WHERE tenant_id = $1 AND company_id = $2 AND tax_class_id = $3)`,
    [tenantId, companyId, ratedClassId, TAX_RATE_FRACTION, EFFECTIVE_FROM, USER_A]
  );
}

/** Establishes every P1-20 fixture. Idempotent. */
export async function establishP1_20Fixtures(pool: Pool): Promise<void> {
  admin = pool;

  for (const principal of P1_20_PRINCIPALS) await seedPrincipal(principal);

  /**
   * The widening grants: a SECOND role carrying an UNRELATED permission scoped to
   * BRANCH_A1, given to every principal whose real permissions are scoped to A2.
   *
   * This is what makes an isolation refusal mean something. Without it, an A2-scoped
   * principal has A1 outside `iam.allowed_branch_ids()`, so an A1 row is invisible to
   * RLS and the request fails whether or not the permission check consults scope at
   * all — the test would pass against a scope-blind implementation. With A1 in the
   * union the row is readable, so the ONLY thing that can refuse the request is the
   * scoped permission check, which is the control P1-18-A-01 is about.
   *
   * The permission is deliberately unrelated (`org.tenant.read`): it widens the union
   * without conferring any authority the operation under test asks for.
   */
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
  const WIDENED: readonly { readonly userId: string; readonly grantId: string }[] = [
    { userId: SVC_PERMISSION_ELSEWHERE.userId, grantId: 'd2900000-0000-4000-8000-0000000000f2' },
    { userId: SVC_PRICE_SCOPED_A2.userId, grantId: 'd2900000-0000-4000-8000-0000000000f3' },
    { userId: SVC_QUO_SCOPED_A2.userId, grantId: 'd2900000-0000-4000-8000-0000000000f4' },
  ];
  for (const target of WIDENED) {
    const widening = await admin.connect();
    try {
      await widening.query('BEGIN');
      const existing = await widening.query(`SELECT 1 FROM iam.role_grants WHERE id = $1`, [
        target.grantId,
      ]);
      if (existing.rowCount === 0) {
        await widening.query(
          `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
           VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
          [target.grantId, TENANT_A, target.userId, WIDENING_ROLE, USER_A]
        );
        await widening.query(
          `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
           VALUES ($1,$2,'branch',$3,$4,$5)`,
          [TENANT_A, target.grantId, COMPANY_A1, BRANCH_A1, USER_A]
        );
      }
      await widening.query('COMMIT');
    } catch (error) {
      await widening.query('ROLLBACK');
      throw error;
    } finally {
      widening.release();
    }
  }

  // The second tenant-A company and its branch. See COMPANY_A2 above.
  await admin.query(
    `INSERT INTO org.legal_companies
       (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1,$2,'fx_p120_company_a2','P1-20 Fixture Company A2','JOD',$3)
     ON CONFLICT (id) DO NOTHING`,
    [COMPANY_A2, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO org.branches
       (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'fx_p120_branch_a2c2','P1-20 Fixture Branch (company A2)','UTC',$4)
     ON CONFLICT (id) DO NOTHING`,
    [BRANCH_A2_OF_COMPANY_A2, TENANT_A, COMPANY_A2, USER_A]
  );

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

  await seedTax(TENANT_A, COMPANY_A1, TAX_CLASS_A, TAX_CLASS_A_UNRATED);
  await seedTax(TENANT_B, COMPANY_B1, TAX_CLASS_B, TAX_CLASS_B_UNRATED);
  await seedQuotationSequence(TENANT_A, COMPANY_A1, BRANCH_A1);
  await seedQuotationSequence(TENANT_A, COMPANY_A1, BRANCH_A2);
  await seedQuotationSequence(TENANT_B, COMPANY_B1, BRANCH_B1);
}

/**
 * The `quotation` number sequence, per company and branch.
 *
 * Required, not optional: `quo.quotations.quotation_number` is NOT NULL and comes
 * from `sharedServicesModule().numbers.allocate`, which maps an unconfigured
 * sequence to `ERR-RES-001`. Without this row a quotation create fails with a 404
 * that reads exactly like a missing work order — which is how it presented before
 * this fixture existed, and it cost real time to attribute correctly.
 *
 * The sequence is registered in `shared-services/domain/sequence-registry.ts` with
 * code `quotation`; this only creates the per-scope counter row.
 */
async function seedQuotationSequence(
  tenantId: string,
  companyId: string,
  branchId: string
): Promise<void> {
  await admin.query(
    `INSERT INTO shared.number_sequences
       (tenant_id, company_id, branch_id, sequence_code, prefix_template, next_value,
        pad_width, period_reset_rule, created_by)
     SELECT $1,$2,$3,'quotation','QUO-',1,6,'never',$4
      WHERE NOT EXISTS (
        SELECT 1 FROM shared.number_sequences
         WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3
           AND sequence_code = 'quotation')`,
    [tenantId, companyId, branchId, USER_A]
  );
}

/**
 * Binds a price list to a scope so `svc.resolve_price` can find it.
 *
 * Separate from the catalog fixture because a test that is about price-list
 * *creation* must not already have an assignment, while a test about *resolution*
 * needs one. `priority` is a parameter so the ambiguity case can create two
 * assignments that tie.
 */
export async function assignPriceList(input: {
  tenantId: string;
  priceListId: string;
  companyId: string | null;
  branchId: string | null;
  customerClass: string | null;
  priority: number;
}): Promise<void> {
  await admin.query(
    `INSERT INTO svc.price_list_assignments
       (tenant_id, price_list_id, company_id, branch_id, customer_class, priority,
        effective_from, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::date,'active',$8)
     ON CONFLICT DO NOTHING`,
    [
      input.tenantId,
      input.priceListId,
      input.companyId,
      input.branchId,
      input.customerClass,
      input.priority,
      EFFECTIVE_FROM,
      USER_A,
    ]
  );
}

/**
 * Grants one principal a discount approval ceiling.
 *
 * Needed because the discount path FAILS CLOSED: with no
 * `svc.pricing_approval_policies` row the threshold is zero, so any non-zero
 * discount demands both the elevated permission and a ceiling in
 * `iam.approval_limits` — and no ceiling means no authority, never unlimited.
 * A caller without one is refused with 403, which is the designed behaviour and is
 * asserted separately rather than papered over by seeding every principal.
 *
 * `role_id` rather than `user_id`, so the union-of-roles path is the one exercised:
 * a ceiling reaching an actor through a role they hold is the ordinary case.
 */
/**
 * A `svc.pricing_approval_policies` row, so a NON-ZERO discount threshold exists.
 *
 * Without a policy row the threshold is zero and every non-zero discount is already
 * elevated — which makes the discount-splitting case impossible to express, because
 * splitting is only interesting when each individual line sits *under* the threshold.
 * Seeding a real policy is the only way to write that test.
 *
 * `maker_approver_distinct` defaults to `true` in the schema; it is set explicitly to
 * `false` here so the splitting test measures the aggregate control and not the
 * maker/approver control, which has its own cases.
 */
export async function seedDiscountPolicy(input: {
  readonly tenantId: string;
  readonly companyId: string;
  readonly thresholdKind: 'amount' | 'percentage';
  readonly thresholdValue: string;
  readonly currencyCode: string | null;
  readonly requiredPermissionCode?: string;
  readonly makerApproverDistinct?: boolean;
}): Promise<void> {
  await admin.query(
    `INSERT INTO svc.pricing_approval_policies
       (tenant_id, company_id, policy_type, threshold_kind, threshold_value, currency_code,
        required_permission_code, maker_approver_distinct, effective_from, status, created_by)
     SELECT $1,$2,'discount',$3,$4::numeric(18,4),$5,$6,$7,$8::date,'active',$9
      WHERE NOT EXISTS (
        SELECT 1 FROM svc.pricing_approval_policies
         WHERE tenant_id = $1 AND company_id = $2 AND policy_type = 'discount'
           AND deleted_at IS NULL)`,
    [
      input.tenantId,
      input.companyId,
      input.thresholdKind,
      input.thresholdValue,
      input.currencyCode,
      input.requiredPermissionCode ?? PRICE_MANAGE,
      input.makerApproverDistinct ?? false,
      EFFECTIVE_FROM,
      USER_A,
    ]
  );
}

/** Removes the discount policy, so a suite can go back to the threshold-zero default. */
export async function clearDiscountPolicy(tenantId: string): Promise<void> {
  await admin.query(
    `DELETE FROM svc.pricing_approval_policies WHERE tenant_id = $1 AND policy_type = 'discount'`,
    [tenantId]
  );
}

export async function seedDiscountCeiling(input: {
  tenantId: string;
  companyId: string;
  roleId: string;
  amount: string;
  currencyCode: string;
}): Promise<void> {
  await admin.query(
    `INSERT INTO iam.approval_limits
       (tenant_id, company_id, role_id, limit_type, amount, currency_code, effective_from, created_by)
     SELECT $1,$2,$3,'discount',$4::numeric(18,4),$5,$6::date,$7
      WHERE NOT EXISTS (
        SELECT 1 FROM iam.approval_limits
         WHERE tenant_id = $1 AND company_id = $2 AND role_id = $3 AND limit_type = 'discount')`,
    [
      input.tenantId,
      input.companyId,
      input.roleId,
      input.amount,
      input.currencyCode,
      EFFECTIVE_FROM,
      USER_A,
    ]
  );
}

/** Reads a price list's current `record_version`, for an `If-Match` header. */
export async function priceListVersionOf(priceListId: string): Promise<number> {
  const result = await admin.query<{ record_version: number }>(
    `SELECT record_version FROM svc.price_lists WHERE id = $1`,
    [priceListId]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`price list ${priceListId} not found`);
  return row.record_version;
}

/** Counts audit records for an action, to prove one was written. */
export async function auditCountFor(action: string, entityId: string): Promise<number> {
  const result = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM iam.audit_records
      WHERE action = $1 AND entity_id = $2`,
    [action, entityId]
  );
  return Number.parseInt(result.rows[0]?.n ?? '0', 10);
}

/** Counts outbox rows for an event key, to prove exactly one was published. */
export async function outboxCountFor(eventKey: string): Promise<number> {
  const result = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM shared.event_outbox WHERE event_key = $1`,
    [eventKey]
  );
  return Number.parseInt(result.rows[0]?.n ?? '0', 10);
}
