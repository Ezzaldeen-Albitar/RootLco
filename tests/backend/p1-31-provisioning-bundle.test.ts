/**
 * P1-31 prerequisite P-1 — the provisioning bundle carries the P1-31 codes.
 *
 * The P1-31 A0 preflight (`docs/phase-1/phase-1-31/a0-preflight.md`, "The
 * closure that sits above all sixteen") measured that the two roles
 * `platform.organization-provision` writes held ZERO of the nine codes P1-31
 * originally needed, and that `ins_role_permissions_delegable` admits a mapping only when
 * the acting administrator already holds the code being mapped. That is a
 * CLOSURE, not an inconvenience: no principal in an organisation created by the
 * shipped operation could hold a P1-31 code, or ever be granted one.
 *
 * EIGHT of the nine are added, and three more codes minted by later P1-31 slices
 * joined them (P-7, P-17). ONE of the original nine is deliberately EXCLUDED, and
 * the ground it is excluded on is not the ground the other two were:
 *
 *  - `rpt.export` — two shipped operations DO declare it. It is withheld on
 *    least-privilege grounds by an explicit Owner decision (P1-31 CC-04): it is
 *    the platform-wide export switch, and the bundle already holds every
 *    entitlement it pairs with, so carrying it would let a one-day-old
 *    administrator authorize bulk export of documents, outbound messages and
 *    branch data including sensitive fields.
 *
 * `wty.policy.manage` and `rpt.report.configure` were the other two, both
 * withheld because NOTHING declared them (CC-01, CC-02) — and both released on
 * 2026-09-09, by P1-31 prerequisite P-10 publishing five operations that declare
 * the first and prerequisite P-11 publishing seven that declare the second. CC-01
 * and CC-02 stated the rule this file now records the other side of — "the slice
 * that publishes them owns the widening" — so both codes moved out of the
 * exclusions and into the added set, and B1's register measurement is what proves
 * they moved for the stated reason rather than by preference. The undeclared
 * exclusion list is now EMPTY, which B1 asserts rather than leaves implied: an
 * empty list would otherwise make its "zero declarers" loop vacuous.
 *
 * The distinction is proved, not asserted: B1 reads the operation register and
 * requires ZERO declarers for the remaining undeclared exclusion, MORE THAN ZERO
 * for the by-decision one, and MORE THAN ZERO for every added code.
 * This suite proves the split on real rows rather than on the constant:
 *
 *   P31-B1  the bundle's delta is exactly `ADDED_ALL`, nothing else moved, every
 *           one of them is declared by a REGISTERED operation, the undeclared
 *           exclusion list is EMPTY, and the by-decision exclusion IS declared —
 *           so the two kinds cannot be confused with each other
 *   P31-B2  an organisation created by the SHIPPED provisioning operation gives
 *           its administrator role all eight, and neither exclusion
 *   P31-B3  the Owner of that organisation effectively holds all eight, holds no
 *           excluded code, and the role holds nothing beyond the bundle
 *   P31-B4  the Owner can MAP each added code onto a role it creates — the
 *           exact act `ins_role_permissions_delegable` refused before
 *   P31-B5  the ONE remaining EXCLUDED code is refused, with the registered
 *           refusal: 403 ERR-IAM-001, `requiredPermissions` naming the code
 *   P31-B6  delegation is still held-only — three codes outside the bundle that
 *           were refused before are refused now, by the same failure
 *   P31-B7  two shipped reads gated on added codes answer for the provisioned
 *           Owner, including the audit list the shipped Audit Log screen calls
 *   P31-B8  the SHIPPED export route refuses that same Owner with the registered
 *           refusal — the consequence CC-04 states, measured rather than assumed
 *   P31-B9  that same freshly provisioned Owner adds a second branch through
 *           `org.branch-create` (Owner directive 2026-09-16), and the branch
 *           receives its per-branch numbering runs
 *
 * ## The Owner directive of 2026-09-17: four capabilities that were shut
 *
 * A QA campaign exercising the product found four more codes the bundle never
 * carried — `wo.work_order.line.manage`, `crm.customer.profile.write`,
 * `inv.cost.view` and `rec.reception.evidence.manage`. The shape is the one this
 * file was written for: each is declared by shipped operations, none was ever in
 * the bundle, and `ins_role_permissions_delegable` therefore made the capability
 * unreachable for EVERYONE in every platform-provisioned organisation, not merely
 * for the first administrator.
 *
 * THREE of them are carried. `inv.cost.view` is not: its exclusion from this
 * bundle is an existing recorded decision (P1-30 change control CC-12, open —
 * "the `inv.cost.view` exclusion is deliberate"; register gap E-14), and reversing
 * a recorded decision is the Owner's act. So DEF-T-03 stays measured and open, and
 * B14 below measures the REFUSAL it names rather than a capability the bundle does
 * not confer. The cases below run in the organisation the shipped provisioning
 * operation created:
 *
 *   P31-B10 the three are in the bundle, none was in the 85-code bundle that
 *           preceded them, each is declared by a REGISTERED operation and each
 *           already existed in the catalogue seed — so nothing is minted; and
 *           `inv.cost.view` is declared too and is still absent, by CC-12
 *   P31-B11 the provisioned administrator effectively holds all three and can
 *           delegate each onto a role it creates
 *   P31-B12 it records a telephone contact on a customer it created
 *   P31-B13 it records a service line on a work order its own reception produced
 *   P31-B14 its goods receipt is REFUSED for a priced line and accepted without
 *           one — DEF-T-03 as it currently stands
 *   P31-B15 it binds an exact document version to a capture requirement
 *
 * ## The Owner decision on `sal.credit.manage`: credit notes
 *
 * The QA campaign measured that nobody in a platform-provisioned organisation could
 * read, request or approve a credit note (result matrix part 5 row 6.19, part 7 row
 * 5.9). The gap was a MISSING DEFAULT GRANT: the delegation rule treats the code like
 * every other, and nothing else restricts it. The Owner decided the standard tenant
 * administrator carries it, under the controls that already bind every credit note.
 *
 *   P31-B16 the code is in the bundle once, is declared by exactly the four
 *           credit-note operations (each branch-scoped, each with sal.finance.view),
 *           was already a catalogue row, and first_owner is untouched
 *   P31-B17 the provisioned administrator holds it and can delegate it
 *   P31-B18 it requests a credit note in its own branch — pending, crediting
 *           nothing, audited — is refused approving its own request, and a second
 *           person it delegated the code to approves it, audited
 *   P31-B19 another organisation's administrator, holding the same code, is
 *           refused this organisation's invoice (404, nothing written)
 *   P31-B20 a cashier role the administrator builds without the code is refused
 *           (403 ERR-IAM-001 naming the code, nothing written)
 *
 * Operations exercised: platform.organization-provision, iam.role-create,
 * iam.role-permission-add, iam.audit-event-list, rpt.report-catalogue,
 * shared.export-catalogue, org.branch-create, crm.individual-create,
 * crm.contact-add, inv.item-category-create, inv.uom-list, inv.item-create,
 * inv.stock-location-create, inv.goods-receipt-create,
 * rec.reception-convert-to-work-order, wo.service-line-record,
 * rec.reception-evidence-binding, iam.grant-issue, sal.credit-note-create,
 * sal.credit-note-list, sal.credit-note-approve.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TENANT_A,
  adminPool,
  cleanBackendFixtures,
  deleteTenantCascade,
  ensureBackendFixtures,
  ensureTestLogins,
  platformAppPool,
  runtimeAppPool,
} from './helpers';
import { __resetBackendConfigForTests } from '@/server/config/backend-config';
import { __setPlatformPoolForTests, __setPrimaryPoolForTests } from '@/server/db/pool';
import {
  StaticClaimsAuthenticator,
  __resetAuthenticatorForTests,
  setSessionAuthenticator,
} from '@/server/context/principal';
import {
  FIRST_OWNER_ROLE,
  FakeIdentityProvider,
  TENANT_ADMINISTRATOR_ROLE,
  setIdentityProvider,
} from '@/modules/iam';
import { __resetIdentityProviderForTests } from '@/modules/iam/provider/identity-provider';
import { REPOSITORY_ROOT } from '../../scripts/lib/repository-paths.mjs';
import { POST as organizationProvisionRoute } from '@/app/api/v1/platform/organizations/route';
import {
  BRANCH_CREATE_OPERATION,
  POST as branchCreateRoute,
} from '@/app/api/v1/org/branches/route';
import { ROLE_CREATE_OPERATION, POST as roleCreateRoute } from '@/app/api/v1/iam/roles/route';
import {
  ROLE_PERMISSION_ADD_OPERATION,
  POST as rolePermissionAddRoute,
} from '@/app/api/v1/iam/roles/[roleId]/permissions/route';
import {
  AUDIT_EVENT_LIST_OPERATION,
  GET as auditEventListRoute,
} from '@/app/api/v1/audit-events/route';
import {
  REPORT_CATALOGUE_OPERATION,
  GET as reportCatalogueRoute,
} from '@/app/api/v1/reports/route';
import {
  EXPORT_CATALOGUE_OPERATION,
  GET as exportCatalogueRoute,
} from '@/app/api/v1/exports/resources/route';
import { POST as individualCreateRoute } from '@/app/api/v1/customers/individuals/route';
import {
  CONTACT_ADD_OPERATION,
  POST as contactAddRoute,
} from '@/app/api/v1/customers/[customerId]/contacts/route';
import { POST as itemCategoryCreateRoute } from '@/app/api/v1/item-categories/route';
import { GET as unitOfMeasureListRoute } from '@/app/api/v1/units-of-measure/route';
import { POST as itemCreateRoute } from '@/app/api/v1/items/route';
import { POST as stockLocationCreateRoute } from '@/app/api/v1/stock-locations/route';
import {
  GOODS_RECEIPT_CREATE_OPERATION,
  POST as goodsReceiptCreateRoute,
} from '@/app/api/v1/goods-receipts/route';
import { POST as receptionConvertRoute } from '@/app/api/v1/receptions/[receptionId]/convert-to-work-order/route';
import {
  SERVICE_LINE_RECORD_OPERATION,
  POST as serviceLineRecordRoute,
} from '@/app/api/v1/work-orders/[workOrderId]/service-lines/route';
import {
  RECEPTION_EVIDENCE_BINDING_OPERATION,
  POST as evidenceBindingRoute,
} from '@/app/api/v1/receptions/[receptionId]/evidence-bindings/route';
import {
  CREDIT_NOTE_CREATE_OPERATION,
  POST as creditNoteCreateRoute,
} from '@/app/api/v1/invoices/[invoiceId]/credit-notes/route';
import {
  CREDIT_NOTE_APPROVE_OPERATION,
  POST as creditNoteApproveRoute,
} from '@/app/api/v1/credit-notes/[creditNoteId]/approval/route';
import {
  CREDIT_NOTE_LIST_OPERATION,
  GET as creditNoteListRoute,
} from '@/app/api/v1/credit-notes/route';
import { CREDIT_NOTE_DETAIL_OPERATION } from '@/app/api/v1/credit-notes/[creditNoteId]/route';
import { POST as grantIssueRoute } from '@/app/api/v1/iam/grants/route';

/**
 * The six codes prerequisite P-1 adds. Written out rather than derived from
 * the constant under test: a list computed from the thing it checks proves
 * nothing.
 */
const ADDED = Object.freeze([
  'sal.delivery.manage',
  'sal.delivery.view',
  'sal.delivery.complete',
  'wty.warranty.issue',
  'rpt.report.read',
  'iam.audit.view',
]);

/**
 * The ONE code prerequisite P-7 adds, on the slice that mints it.
 *
 * Kept apart from `ADDED` above rather than folded into it, because the two
 * widenings answer different questions and this file's narrative is P-1's. P-1
 * carried six codes the catalogue ALREADY held and minted nothing; P-7 mints
 * `wty.warranty.read` — the phase's only insert into `iam.permissions` — and
 * carries it because withholding it while re-pointing `wty.warranty-detail` off
 * `wty.warranty.issue` would REMOVE a capability this bundle already confers
 * (P1-31 CC-07). Its own proof is `tests/backend/p1-31-warranty-read-seam.test.ts`;
 * what this file owes is the arithmetic.
 */
const ADDED_BY_P7 = Object.freeze(['wty.warranty.read']);

/**
 * The ONE code prerequisite P-11 adds, on the slice that publishes its writers.
 *
 * Kept apart from both lists above for the same reason they are kept apart from
 * each other: this widening answers a third question. `rpt.report.configure` has
 * been a catalogue code since P1-08 that NO operation declared, and CC-02 withheld
 * it on exactly that ground while stating the rule for lifting it — the
 * `inv.item.manage` sequence, excluded while no route declared it and added by
 * #322 on the day three routes did. P-11 published seven operations that declare
 * it, so the ground is gone and the code is carried. Withholding it now would
 * leave a freshly provisioned administrator with an empty report catalogue it
 * could never fill, because both published report reads filter on
 * `status = 'published'` and no other code can set that value. Its own proof is
 * `tests/backend/p1-31-report-configuration-seam.test.ts`; what this file owes is
 * the arithmetic and the register measurement.
 */
const ADDED_BY_P11 = Object.freeze(['rpt.report.configure']);

/**
 * The ONE code prerequisite P-10 adds, on the slice that publishes its writers.
 *
 * Kept apart from both lists above for the same reason they are kept apart from
 * each other: this widening answers a third question. `wty.policy.manage` has been
 * a catalogue code since P1-08 that NO operation declared, and CC-01 withheld it on
 * exactly that ground while stating the rule for lifting it — the `inv.item.manage`
 * sequence, excluded while no route declared it and added by #322 on the day three
 * routes did. P-10 published five operations that declare it, so the ground is gone
 * and the code is carried. Withholding it now would leave a freshly provisioned
 * administrator unable to issue ANY warranty, because generation refuses a company
 * with no active policy and no other code can create one. Its own proof is
 * `tests/backend/p1-31-warranty-policy-seam.test.ts`; what this file owes is the
 * arithmetic and the register measurement.
 */
const ADDED_BY_P10 = Object.freeze(['wty.policy.manage']);

/**
 * The TWO codes prerequisite P-17 adds, on the slice that mints them.
 *
 * Kept apart from the four lists above for the reason they are kept apart from
 * each other: this widening answers a fifth question. `org.employee.read` and
 * `org.employee.manage` are the phase's second and third MINTED codes — new rows
 * in the catalogue seed, not pre-existing ones released from an exclusion — and
 * they are carried because the four operations that publish the employee
 * register declare them, which is the necessary condition P-1 states.
 *
 * The consequence of withholding is the sharpest of the five. P-17 also gives
 * `sal.delivery_records.delivering_employee_id` the foreign key it never had, so
 * `sal.delivery-create` now refuses an employee that does not exist and nothing
 * else in the product creates one. A freshly provisioned administrator without
 * these codes could not record a single handover. Their own proof is
 * `tests/backend/p1-31-delivering-employee-seam.test.ts`; what this file owes is
 * the arithmetic and the register measurement.
 */
const ADDED_BY_P17 = Object.freeze(['org.employee.read', 'org.employee.manage']);

/**
 * Owner directive 2026-09-16: `org.company-create` and `org.branch-create` declare
 * these two, and the Owner decided the first administrator holds them.
 */
const ADDED_BY_OWNER_DIRECTIVE = Object.freeze(['org.company.manage', 'org.branch.manage']);

/** Every code the five P1-31 widenings and the Owner directive added. */
const ADDED_ALL = Object.freeze([
  ...ADDED,
  ...ADDED_BY_P7,
  ...ADDED_BY_P10,
  ...ADDED_BY_P11,
  ...ADDED_BY_P17,
  ...ADDED_BY_OWNER_DIRECTIVE,
]);

/**
 * Withheld because NOTHING declares it — P1-31 CC-01 and CC-02. This list is now
 * EMPTY, and it is kept rather than deleted because the RULE it encodes is what
 * both codes left under.
 *
 * `wty.policy.manage` left on 2026-09-09 when P-10 published its writers, and
 * `rpt.report.configure` the same day when P-11 published its own. That is the
 * ONLY way a code may leave this list: B1 asserts zero declarers for everything
 * still in it and more than zero for everything in `ADDED_ALL`, so a code moved
 * for any other reason fails there. B1 also asserts the list is EMPTY, so that is
 * measured rather than silently making its loop vacuous.
 */
const EXCLUDED_UNDECLARED: readonly string[] = Object.freeze([]);

/**
 * Withheld although shipped operations DO declare it — P1-31 CC-04, an explicit
 * Owner decision of 2026-09-08 on least-privilege grounds. `rpt.export` is the
 * platform-wide export switch of P1-15, not a P1-31 code, and the bundle already
 * holds every entitlement it pairs with (`shared.document.read`,
 * `org.branch.read`, `iam.sensitive.view`).
 */
const EXCLUDED_BY_DECISION = Object.freeze(['rpt.export']);

/** Every withheld code, whatever the ground: the bundle must carry none of them. */
const EXCLUDED = Object.freeze([...EXCLUDED_UNDECLARED, ...EXCLUDED_BY_DECISION]);

/** The bundle before this slice: 48 → 65 (#321) → 67 (#322). Eleven added: 78; two more: 80. */
const BUNDLE_BEFORE = 67;

/**
 * The first widening AFTER P1-31: the five P1-32 material codes (P1-32-PRE-134),
 * carried once every reservation and issue for a work order had to draw on an
 * approved material requirement, so that an administrator can ask for, approve and
 * delegate one. Kept apart from `ADDED_ALL` because it answers a later question
 * than the five P1-31 widenings. 80 + 5 = 85.
 */
const ADDED_BY_P1_32_MATERIAL = Object.freeze([
  'inv.material.request',
  'inv.material.approve',
  'inv.material.exception.approve',
  'inv.unit_conversion.manage',
  'inv.specification.manage',
]);

/**
 * The second widening after P1-31: three of the four codes the QA campaign
 * measured as permanently closed in every platform-provisioned organisation
 * (Owner directive 2026-09-17; DEF-M-01, DEF-T-01, DEF-T-12/M-06).
 *
 * Kept apart again because the question is a third one: the closure was found by
 * exercising the product rather than by walking a phase's routes. All three
 * already exist in the permission catalogue seed, so nothing is minted; B1
 * measures their declarers in the register exactly as it does for every other
 * widening, and B10–B13 and B15 below measure the three capabilities on the
 * shipped routes. 85 + 3 = 88.
 */
const ADDED_BY_OD_QA_CAMPAIGN = Object.freeze([
  'wo.work_order.line.manage',
  'crm.customer.profile.write',
  'rec.reception.evidence.manage',
]);

/**
 * The FOURTH code that campaign measured, and the one this widening does not
 * carry. `inv.cost.view` is declared (`inv.item-cost-history-read`) and is read as
 * a second permission by the receipt, adjustment and external-purchase services,
 * so DEF-T-03 is real: nobody in a platform-provisioned organisation can record a
 * unit cost, and an unheld code cannot be delegated to anyone either.
 *
 * It stays out because its exclusion is an EXISTING RECORDED DECISION —
 * `docs/phase-1/phase-1-30/change-control-2026-09-06.md` CC-12, still open, files
 * it as deliberate and carries it as register gap E-14 — and reversing a recorded
 * decision is the Owner's act, not this branch's. B10 measures the absence and B14
 * measures the refusal that follows from it.
 */
const WITHHELD_BY_CC12 = Object.freeze(['inv.cost.view']);

/**
 * The third widening after P1-31, and the first carried on an explicit Owner
 * decision about ONE code: `sal.credit.manage`. The QA campaign measured that no one
 * in a platform-provisioned organisation could read, request or approve a credit note
 * (result matrix part 5 row 6.19, part 7 row 5.9). The diagnosis was a missing
 * default grant — no delegation restriction singles the code out — so the repair is
 * one bundle entry. B16–B20 below measure it on the shipped routes. 88 + 1 = 89.
 */
const ADDED_BY_CREDIT_DECISION = Object.freeze(['sal.credit.manage']);

/** Every code carried after P1-31 closed. */
const ADDED_AFTER_P1_31 = Object.freeze([
  ...ADDED_BY_P1_32_MATERIAL,
  ...ADDED_BY_OD_QA_CAMPAIGN,
  ...ADDED_BY_CREDIT_DECISION,
]);

const IDENTITY_PROVIDER = 'test_harness';
const SUBJECT_HOLDER = 'fx_p131_platform_holder';
const USER_HOLDER = 'd3100000-0000-4000-8000-00000000001b';
const SYSTEM_ACTOR = '00000000-0000-4000-8000-000000000001';
/** Distinct from every sibling suite's prefix: they delete tenants by prefix. */
const RUN = Math.random().toString(36).slice(2, 8);
const TENANT_PREFIX = `p31b${RUN}`;

let admin: Pool;
let runtime: Pool;
let platform: Pool;

interface CallResult<T> {
  readonly status: number;
  readonly body: T;
}
type RouteHandler = (
  request: Request,
  route: { params: Promise<Record<string, string>> }
) => Promise<Response>;

async function call<T>(
  handler: unknown,
  input: {
    readonly path: string;
    readonly method?: string;
    readonly body?: unknown;
    readonly params?: Record<string, string>;
    readonly idempotencyKey?: string;
    readonly ifMatch?: number;
  }
): Promise<CallResult<T>> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (input.idempotencyKey !== undefined) headers['idempotency-key'] = input.idempotencyKey;
  if (input.ifMatch !== undefined) headers['if-match'] = String(input.ifMatch);
  const init: RequestInit = { method: input.method ?? 'POST', headers };
  if (input.body !== undefined) init.body = JSON.stringify(input.body);
  const request = new Request(`http://localhost/api/v1${input.path}`, init);
  const response = await (handler as RouteHandler)(request, {
    params: Promise.resolve(input.params ?? {}),
  });
  const text = await response.text();
  return { status: response.status, body: (text === '' ? null : JSON.parse(text)) as T };
}

/** The platform operator, in their own home tenant. */
function asHolder(): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: SUBJECT_HOLDER,
      tenantId: TENANT_A,
    })
  );
}

interface Provisioned {
  readonly tenantId: string;
  readonly ownerAccountId: string;
  readonly tenantAdministratorRoleId: string;
  readonly identityProvider: string;
  readonly providerSubject: string;
}

/** The Owner the bootstrap created, in the tenant it was created for. */
function asOwnerOf(tenant: Provisioned): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: tenant.identityProvider,
      providerSubject: tenant.providerSubject,
      tenantId: tenant.tenantId,
    })
  );
}

function spec(code: string): Record<string, unknown> {
  return {
    tenant: {
      code: `${TENANT_PREFIX}_${code}`,
      display_name: 'P1-31 bundle probe',
      locale: 'en',
      timezone: 'UTC',
    },
    company: { code: 'p31c', legal_name: 'P31 Ltd', base_currency: 'JOD' },
    branch: { code: 'main', name: 'Main', timezone: 'UTC' },
    owner: { email: `owner_${code}_${RUN}@fixture.test`, displayName: 'First Owner' },
    activate: true,
  };
}

async function provision(code: string): Promise<Provisioned> {
  asHolder();
  const result = await call<{
    tenantId: string;
    ownerAccountId: string;
    tenantAdministratorRoleId: string;
  }>(organizationProvisionRoute, {
    path: '/platform/organizations',
    body: spec(code),
    idempotencyKey: randomUUID(),
  });
  expect(result.status).toBe(201);
  const { rows } = await admin.query<{
    identity_provider: string;
    provider_subject: string;
  }>('SELECT identity_provider, provider_subject FROM iam.user_accounts WHERE id = $1', [
    result.body.ownerAccountId,
  ]);
  const row = rows[0];
  if (!row) throw new Error('provisioned owner account has no identity to act as');
  return {
    tenantId: result.body.tenantId,
    ownerAccountId: result.body.ownerAccountId,
    tenantAdministratorRoleId: result.body.tenantAdministratorRoleId,
    identityProvider: row.identity_provider,
    providerSubject: row.provider_subject,
  };
}

/** Allow-codes mapped onto one role, read back on the admin connection. */
async function codesOfRole(roleId: string): Promise<string[]> {
  const { rows } = await admin.query<{ permission_code: string }>(
    `SELECT p.permission_code
       FROM iam.role_permissions rp
       JOIN iam.permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = $1 AND rp.effect = 'allow'
      ORDER BY p.permission_code`,
    [roleId]
  );
  return rows.map((r) => r.permission_code);
}

/** What the Owner account effectively holds, through its active role grants. */
async function codesHeldBy(userId: string): Promise<string[]> {
  const { rows } = await admin.query<{ permission_code: string }>(
    `SELECT DISTINCT p.permission_code
       FROM iam.role_grants g
       JOIN iam.role_permissions rp ON rp.role_id = g.role_id AND rp.effect = 'allow'
       JOIN iam.permissions p ON p.id = rp.permission_id
      WHERE g.user_id = $1 AND g.status = 'active'
      ORDER BY p.permission_code`,
    [userId]
  );
  return rows.map((r) => r.permission_code);
}

/** A role the provisioned Owner creates, to delegate onto. */
async function newRole(tenant: Provisioned, code: string): Promise<string> {
  asOwnerOf(tenant);
  const role = await call<{ id: string }>(roleCreateRoute, {
    path: '/iam/roles',
    body: { roleCode: code, name: code, description: `P1-31 delegation probe ${code}` },
    idempotencyKey: randomUUID(),
  });
  expect(role.status).toBe(201);
  return role.body.id;
}

async function mapCode(
  tenant: Provisioned,
  roleId: string,
  permissionCode: string
): Promise<CallResult<{ code?: string; requiredPermissions?: string[] }>> {
  asOwnerOf(tenant);
  return call(rolePermissionAddRoute, {
    path: `/iam/roles/${roleId}/permissions`,
    params: { roleId },
    body: { permissionCode, effect: 'allow' },
    idempotencyKey: randomUUID(),
  });
}

/**
 * The company and the branch the provisioning operation created, in creation
 * order, so B9's second branch cannot be picked up by accident.
 */
async function scopeOf(tenant: Provisioned): Promise<{ companyId: string; branchId: string }> {
  const { rows } = await admin.query<{ company_id: string; branch_id: string }>(
    `SELECT c.id AS company_id, b.id AS branch_id
       FROM org.legal_companies c
       JOIN org.branches b ON b.tenant_id = c.tenant_id AND b.company_id = c.id
      WHERE c.tenant_id = $1
      ORDER BY b.created_at, b.branch_code
      LIMIT 1`,
    [tenant.tenantId]
  );
  const row = rows[0];
  if (row === undefined) throw new Error('provisioned organisation has no company and branch');
  return { companyId: row.company_id, branchId: row.branch_id };
}

/** 32 bytes of hex — `ck_document_versions_sha256_len`. */
const SHA_HEX = 'a'.repeat(64);

let vinSeq = 0;

interface SeededVisit {
  readonly visitId: string;
  readonly vehicleId: string;
  readonly recordVersion: number;
}

/**
 * A reception visit in the PROVISIONED organisation, built as admin.
 *
 * The frozen `rec.accept_check_in()` primitive performs the check-in, exactly as
 * `p1-19-helpers.ts` does for the seeded fixture tenant: hand-rolling the visit,
 * its service-requester role, the custody event and the first status row would
 * produce a shell the reception contract never admits. Everything this file is
 * MEASURING — the four capabilities below — still runs through the shipped
 * routes as the provisioned Owner.
 */
async function seedVisit(
  tenant: Provisioned,
  scope: { companyId: string; branchId: string },
  partnerId: string,
  options: { readonly authorize?: boolean } = {}
): Promise<SeededVisit> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [tenant.ownerAccountId, tenant.tenantId]
    );
    const vin = `P31B${String(++vinSeq).padStart(13, '0')}`;
    const vehicle = await client.query<{ id: string }>(
      `INSERT INTO veh.vehicles (tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
       VALUES ($1,$2,'ice','active',$3) RETURNING id`,
      [tenant.tenantId, vin, tenant.ownerAccountId]
    );
    const vehicleId = vehicle.rows[0]?.id ?? '';
    const walkIn = await client.query<{ id: string }>(
      `INSERT INTO rec.walk_in_references
         (tenant_id, company_id, branch_id, vehicle_id, requester_partner_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        tenant.tenantId,
        scope.companyId,
        scope.branchId,
        vehicleId,
        partnerId,
        tenant.ownerAccountId,
      ]
    );
    const visit = await client.query<{ id: string }>(
      `SELECT rec.accept_check_in($1::uuid,$2::uuid,$3::uuid,NULL::uuid,$4::uuid,$5::uuid,$6::uuid) AS id`,
      [
        scope.companyId,
        scope.branchId,
        vehicleId,
        walkIn.rows[0]?.id ?? '',
        tenant.ownerAccountId,
        partnerId,
      ]
    );
    const visitId = visit.rows[0]?.id ?? '';
    if (options.authorize === true) {
      await client.query(
        `INSERT INTO rec.authorizations
           (tenant_id, company_id, branch_id, reception_visit_id, authorizing_role,
            partner_id, decision, channel, created_by)
         VALUES ($1,$2,$3,$4,'service_requester',$5,'approved','in_person',$6)`,
        [
          tenant.tenantId,
          scope.companyId,
          scope.branchId,
          visitId,
          partnerId,
          tenant.ownerAccountId,
        ]
      );
      await client.query(
        `UPDATE rec.reception_visits SET reception_status = 'inspecting' WHERE id = $1`,
        [visitId]
      );
      await client.query(
        `UPDATE rec.reception_visits SET reception_status = 'authorized' WHERE id = $1`,
        [visitId]
      );
    }
    const current = await client.query<{ record_version: number }>(
      `SELECT record_version FROM rec.reception_visits WHERE id = $1`,
      [visitId]
    );
    await client.query('COMMIT');
    return { visitId, vehicleId, recordVersion: current.rows[0]?.record_version ?? 0 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * A document, one version and the link that makes it reachable, in the
 * provisioned organisation. Admin-built because the product's writer for the
 * BYTES is the presigned-storage path, which has no place in a backend suite;
 * the binding itself is the shipped route.
 */
async function seedEvidenceDocument(
  tenant: Provisioned,
  visitId: string
): Promise<{ documentId: string; versionId: string }> {
  const { rows } = await admin.query<{ id: string; purpose: string }>(
    `SELECT id, business_link_purpose AS purpose FROM shared.document_categories
      WHERE category_code = 'reception_exterior' AND deleted_at IS NULL
      ORDER BY (tenant_id IS NOT NULL) DESC LIMIT 1`
  );
  const category = rows[0];
  if (category === undefined) {
    throw new Error('the reception_exterior document category is absent from the platform seed');
  }
  const documentId = randomUUID();
  const versionId = randomUUID();
  await admin.query(
    `INSERT INTO shared.documents
       (id, tenant_id, category_id, title, classification, retention_class, status, created_by)
     VALUES ($1,$2,$3,'Reception exterior capture','internal','evidence-audit','pending',$4)`,
    [documentId, tenant.tenantId, category.id, tenant.ownerAccountId]
  );
  await admin.query(
    `INSERT INTO shared.document_versions
       (id, tenant_id, document_id, version_number, storage_key, content_type,
        size_bytes, sha256, uploaded_by, created_by)
     VALUES ($1,$2,$3,1,$4,'image/jpeg',2048, decode($5,'hex'), $6, $6)`,
    [versionId, tenant.tenantId, documentId, `p31b/${documentId}`, SHA_HEX, tenant.ownerAccountId]
  );
  await admin.query(
    `INSERT INTO shared.document_links
       (tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
     VALUES ($1,$2,'rec.reception_visits',$3,$4,$5,$5)`,
    [tenant.tenantId, documentId, visitId, category.purpose, tenant.ownerAccountId]
  );
  return { documentId, versionId };
}

let probe: Provisioned;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  process.env.AUTH_REDIRECT_ALLOWLIST = 'https://app.test/welcome';
  __resetBackendConfigForTests();
  setIdentityProvider(
    new FakeIdentityProvider({
      secret: 'p1-31-bundle-secret-not-real',
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
     VALUES ($1, $2, $3, $4, $5, 'P1-31 bundle fixture', 'active', $6)
     ON CONFLICT (id) DO NOTHING`,
    [
      USER_HOLDER,
      TENANT_A,
      IDENTITY_PROVIDER,
      SUBJECT_HOLDER,
      `${SUBJECT_HOLDER}@fixture.test`,
      SYSTEM_ACTOR,
    ]
  );
  for (const code of [
    'platform.organization.provision',
    'platform.organization.lifecycle',
    'platform.organization.read',
  ]) {
    await admin.query(
      `INSERT INTO iam.platform_grants (account_id, permission_code, granted_by, created_by)
       VALUES ($1, $2, $3, $3) ON CONFLICT DO NOTHING`,
      [USER_HOLDER, code, SYSTEM_ACTOR]
    );
  }
  runtime = runtimeAppPool(6);
  platform = platformAppPool(6);
  __setPrimaryPoolForTests(runtime);
  __setPlatformPoolForTests(platform);

  probe = await provision('a');
}, 180_000);

afterAll(async () => {
  __resetAuthenticatorForTests();
  __resetIdentityProviderForTests();
  __setPrimaryPoolForTests(undefined);
  __setPlatformPoolForTests(undefined);
  await runtime.end();
  await platform.end();
  const provisioned = await admin.query<{ id: string }>(
    'SELECT id FROM org.tenants WHERE tenant_code LIKE $1',
    [`${TENANT_PREFIX}%`]
  );
  // B18's issued invoice first, in ONE transaction: the invoice reconciliation
  // trigger is deferred to commit, so a header and its line amounts deleted in two
  // autocommit statements would be refused in between — the way
  // `cleanP1_22Fixtures` removes the same tables.
  const financial = await admin.connect();
  try {
    await financial.query('BEGIN');
    for (const table of [
      'sal.financial_events',
      'sal.credit_notes',
      'sal.invoice_status_history',
      'sal.invoice_line_amounts',
      'sal.invoice_lines',
      'sal.invoice_amounts',
      'sal.invoices',
    ]) {
      await financial.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [
        provisioned.rows.map((row) => row.id),
      ]);
    }
    await financial.query('COMMIT');
  } catch (error) {
    await financial.query('ROLLBACK');
    throw error;
  } finally {
    financial.release();
  }
  await deleteTenantCascade(
    admin,
    provisioned.rows.map((row) => row.id)
  );
  await admin.query(
    "DELETE FROM shared.idempotency_keys WHERE operation IN ('org_provisioning','platform_organization_provision')"
  );
  await admin.query('DELETE FROM iam.platform_grants WHERE account_id = $1', [USER_HOLDER]);
  await cleanBackendFixtures(admin);
  await admin.end();
}, 60_000);

describe('P1-31 P-1 — the derivation', () => {
  it('P31-B1 the delta is exactly the six of P-1, the one P-7 mints and the two P-10 and P-11 unblock, each declared by a registered operation, with the undeclared exclusion list empty and the by-decision exclusion declared by some', () => {
    const bundle = [...TENANT_ADMINISTRATOR_ROLE.permissionCodes];

    // The delta, stated two ways so neither can drift alone.
    expect(bundle).toHaveLength(BUNDLE_BEFORE + ADDED_ALL.length + ADDED_AFTER_P1_31.length);
    expect(
      bundle.filter((code) => !ADDED_ALL.includes(code) && !ADDED_AFTER_P1_31.includes(code))
    ).toHaveLength(BUNDLE_BEFORE);
    for (const code of [...ADDED_ALL, ...ADDED_AFTER_P1_31]) {
      expect(bundle.filter((c) => c === code)).toHaveLength(1);
    }
    for (const code of EXCLUDED) expect(bundle).not.toContain(code);
    expect(new Set(bundle).size).toBe(bundle.length);
    expect(bundle.some((c) => c.includes('*'))).toBe(false);
    expect(bundle.some((c) => c.startsWith('platform.'))).toBe(false);

    // DERIVED, not chosen. The P1-24 operation register is the generated,
    // gate-validated inventory of every registered operation's declared
    // permissions; the split falls out of it rather than out of a judgement.
    const register = JSON.parse(
      readFileSync(
        join(REPOSITORY_ROOT, 'docs/phase-1/phase-1-24/evidence/operation-register.json'),
        'utf8'
      )
    ) as { operations: Array<{ id: string; permissions: string[] }> };
    expect(register.operations.length).toBeGreaterThan(300);
    const declarersOf = (code: string): string[] =>
      register.operations.filter((op) => op.permissions.includes(code)).map((op) => op.id);

    for (const code of ADDED_ALL) expect(declarersOf(code).length).toBeGreaterThan(0);
    for (const code of ADDED_AFTER_P1_31) expect(declarersOf(code).length).toBeGreaterThan(0);

    // CC-01 and CC-02: withheld BECAUSE nothing declared them. Both were released
    // on 2026-09-09 by the slices that published their writers, so the list is
    // empty and the loop below has nothing to iterate. The emptiness is therefore
    // asserted FIRST: without it the loop would pass vacuously and would go on
    // passing if a code were quietly returned to the list.
    expect(EXCLUDED_UNDECLARED).toEqual([]);
    for (const code of EXCLUDED_UNDECLARED) expect(declarersOf(code)).toEqual([]);

    // CC-04 is the opposite measurement, and the reason the two kinds are kept
    // apart: `rpt.export` IS declared by shipped operations and is withheld
    // anyway, on least-privilege grounds by Owner decision. Asserting the
    // declarers by NAME means the day the export contract arrives and the set
    // changes, this case makes the Owner look at the exclusion again.
    for (const code of EXCLUDED_BY_DECISION) {
      expect(declarersOf(code).length).toBeGreaterThan(0);
    }
    expect(declarersOf('rpt.export').sort()).toEqual([
      // P-12 adds a separately authorized report disclosure; CC-04 still excludes
      // this permission from the administrator bundle. No bundle grant is added.
      'rpt.report-export',
      'shared.export-authorize',
      'shared.export-catalogue',
    ]);

    // The routes the added codes are held FOR, by id, so a rename cannot
    // quietly leave the bundle carrying a code nothing declares.
    expect(AUDIT_EVENT_LIST_OPERATION.permissions).toContain('iam.audit.view');
    expect(REPORT_CATALOGUE_OPERATION.permissions).toContain('rpt.report.read');
    expect(ROLE_PERMISSION_ADD_OPERATION.id).toBe('iam.role-permission-add');
    expect(ROLE_CREATE_OPERATION.id).toBe('iam.role-create');

    // The withheld code's own route, by id and by declared permission: the
    // refusal B8 measures is this operation's, not an incidental 403.
    expect(EXPORT_CATALOGUE_OPERATION.id).toBe('shared.export-catalogue');
    expect(EXPORT_CATALOGUE_OPERATION.permissions).toEqual(['rpt.export']);
  });
});

describe('P1-31 P-1 — an organisation created by the shipped provisioning operation', () => {
  it('P31-B2 its administrator role holds every added code, and not the excluded one', async () => {
    const codes = await codesOfRole(probe.tenantAdministratorRoleId);
    for (const code of ADDED_ALL) expect(codes).toContain(code);
    for (const code of EXCLUDED) expect(codes).not.toContain(code);
  });

  it('P31-B3 the Owner effectively holds every added code, no excluded code, and the role holds nothing beyond the bundle', async () => {
    const held = await codesHeldBy(probe.ownerAccountId);
    for (const code of ADDED_ALL) expect(held).toContain(code);
    for (const code of EXCLUDED) expect(held).not.toContain(code);

    // Nothing was permitted BEYOND the added set: the role's rows are exactly the
    // server-owned bundle, so a code that is not in the constant is not held.
    expect(await codesOfRole(probe.tenantAdministratorRoleId)).toEqual(
      [...TENANT_ADMINISTRATOR_ROLE.permissionCodes].sort()
    );
  });

  it('P31-B4 the Owner can map each added code onto a role it creates', async () => {
    const roleId = await newRole(probe, 'delivery_officer');
    for (const permissionCode of ADDED_ALL) {
      const mapped = await mapCode(probe, roleId, permissionCode);
      expect({ permissionCode, status: mapped.status }).toEqual({ permissionCode, status: 201 });
    }
    const codes = await codesOfRole(roleId);
    for (const code of ADDED_ALL) expect(codes).toContain(code);
  });

  it('P31-B5 the deliberately excluded code is refused, with the registered refusal', async () => {
    const roleId = await newRole(probe, 'warranty_clerk');
    for (const permissionCode of EXCLUDED) {
      const refused = await mapCode(probe, roleId, permissionCode);
      expect({ permissionCode, status: refused.status }).toEqual({ permissionCode, status: 403 });
      expect(refused.body.code).toBe('ERR-IAM-001');
      expect(refused.body.requiredPermissions).toEqual([permissionCode]);
    }
    expect(await codesOfRole(roleId)).toEqual([]);
  });

  it('P31-B6 delegation is still held-only — codes outside the bundle are refused as before', async () => {
    const roleId = await newRole(probe, 'escalation_probe');
    // Three real exclusions, each recorded with its own reason in
    // `bootstrap-roles.ts`: an organisation write, an IAM read, and a platform
    // code that is never a tenant code at all.
    for (const permissionCode of [
      'org.settings.manage',
      'iam.login.view_all',
      'platform.organization.provision',
    ]) {
      const refused = await mapCode(probe, roleId, permissionCode);
      expect(refused.status).not.toBe(201);
      expect([403, 422]).toContain(refused.status);
    }
    expect(await codesOfRole(roleId)).toEqual([]);
  });

  it('P31-B7 two shipped reads gated on the added codes answer for the provisioned Owner', async () => {
    asOwnerOf(probe);
    const audit = await call<{ items: unknown[] }>(auditEventListRoute, {
      path: `/audit-events?from=${encodeURIComponent(
        new Date(Date.now() - 86_400_000).toISOString()
      )}&to=${encodeURIComponent(new Date().toISOString())}&limit=1`,
      method: 'GET',
    });
    expect(audit.status).toBe(200);

    asOwnerOf(probe);
    const reports = await call<{ items: unknown[] }>(reportCatalogueRoute, {
      path: '/reports?limit=1',
      method: 'GET',
    });
    expect(reports.status).toBe(200);
  });

  it('P31-B8 the shipped export route refuses the provisioned Owner — rpt.export is neither held nor delegable (CC-04)', async () => {
    // NOT HELD. Read from the rows the shipped provisioning operation wrote,
    // both at the role and through the Owner's active grants, so this is a
    // measurement of the organisation rather than of the constant.
    const roleCodes = await codesOfRole(probe.tenantAdministratorRoleId);
    const heldCodes = await codesHeldBy(probe.ownerAccountId);
    for (const code of EXCLUDED_BY_DECISION) {
      expect(roleCodes).not.toContain(code);
      expect(heldCodes).not.toContain(code);
    }

    // THE RESULTING REFUSAL IS THE REGISTERED ONE. `shared.export-catalogue` is
    // a route that already ships and whose only declared permission is the
    // withheld code, so the consequence CC-04 accepts is observed here on the
    // real route rather than reasoned about: 403, ERR-IAM-001, and the required
    // permission named — the same shape B5 proves for the same code.
    asOwnerOf(probe);
    const exports = await call<{ code?: string; requiredPermissions?: string[] }>(
      exportCatalogueRoute,
      { path: '/exports/resources', method: 'GET' }
    );
    expect(exports.status).toBe(403);
    expect(exports.body.code).toBe('ERR-IAM-001');
    expect(exports.body.requiredPermissions).toEqual(EXPORT_CATALOGUE_OPERATION.permissions);
    expect(exports.body.requiredPermissions).toEqual(['rpt.export']);
  });
  it('P31-B9 a freshly provisioned Owner adds a second branch through org.branch-create', async () => {
    // The Owner directive of 2026-09-16 carried org.branch.manage in the bundle.
    // This is the consequence measured on the shipped route: without the code, the
    // first administrator of a new organisation would be refused here, and so
    // would everyone else in it.
    expect(BRANCH_CREATE_OPERATION.id).toBe('org.branch-create');
    expect(await codesHeldBy(probe.ownerAccountId)).toContain('org.branch.manage');

    const { rows } = await admin.query<{ id: string }>(
      'SELECT id FROM org.legal_companies WHERE tenant_id = $1',
      [probe.tenantId]
    );
    const companyId = rows[0]?.id;
    if (companyId === undefined) throw new Error('provisioned organisation has no company');

    asOwnerOf(probe);
    const created = await call<{ branch?: { id: string; companyId: string } }>(branchCreateRoute, {
      path: '/org/branches',
      body: { companyId, code: 'second', name: 'Second Workshop', timezone: 'UTC' },
      idempotencyKey: randomUUID(),
    });
    expect(created.status).toBe(201);
    expect(created.body.branch?.companyId).toBe(companyId);

    const sequences = await admin.query<{ sequence_code: string }>(
      `SELECT sequence_code FROM shared.number_sequences
        WHERE tenant_id = $1 AND branch_id = $2 ORDER BY sequence_code`,
      [probe.tenantId, created.body.branch?.id]
    );
    expect(sequences.rows.map((row) => row.sequence_code)).toEqual([
      'invoice',
      'quotation',
      'receipt',
    ]);
  });
});

describe('Owner directive 2026-09-17 — the codes the QA campaign found closed', () => {
  it('P31-B10 three are added, none was in the 85-code bundle, each is declared by a registered operation and each already existed in the catalogue seed; inv.cost.view is declared and still withheld by CC-12', () => {
    const bundle = [...TENANT_ADMINISTRATOR_ROLE.permissionCodes];

    // The arithmetic, restated for THIS widening so it cannot drift alone:
    // 67 + 13 (P1-31 and the 2026-09-16 directive) + 5 (P1-32 material) = 85,
    // the bundle every organisation provisioned before 2026-09-17 was given.
    const before = BUNDLE_BEFORE + ADDED_ALL.length + ADDED_BY_P1_32_MATERIAL.length;
    expect(before).toBe(85);
    expect(before + ADDED_BY_OD_QA_CAMPAIGN.length).toBe(88);
    // 89 since the Owner's credit-note decision; B16 owns that arithmetic.
    expect(bundle).toHaveLength(
      before + ADDED_BY_OD_QA_CAMPAIGN.length + ADDED_BY_CREDIT_DECISION.length
    );
    expect(ADDED_BY_OD_QA_CAMPAIGN).toHaveLength(3);

    // None of the three appears in any earlier widening, so "it was absent
    // before" is measured against the lists this file already holds rather than
    // against a reverted constant.
    for (const code of ADDED_BY_OD_QA_CAMPAIGN) {
      expect(ADDED_ALL).not.toContain(code);
      expect(ADDED_BY_P1_32_MATERIAL).not.toContain(code);
      expect(EXCLUDED).not.toContain(code);
      expect(bundle.filter((c) => c === code)).toHaveLength(1);
    }

    // NOTHING IS MINTED: every one is already a row in the catalogue seed, so
    // this widening adds no migration and no permission.
    const seed = readFileSync(
      join(REPOSITORY_ROOT, 'supabase/seeds/04_iam_permission_catalog.sql'),
      'utf8'
    );
    for (const code of ADDED_BY_OD_QA_CAMPAIGN) expect(seed).toContain(`('${code}'`);
    for (const code of WITHHELD_BY_CC12) expect(seed).toContain(`('${code}'`);

    // DECLARED by shipped operations — the necessary condition P-1 states, read
    // from the generated operation register exactly as B1 reads it.
    const register = JSON.parse(
      readFileSync(
        join(REPOSITORY_ROOT, 'docs/phase-1/phase-1-24/evidence/operation-register.json'),
        'utf8'
      )
    ) as { operations: Array<{ id: string; permissions: string[] }> };
    const declarersOf = (code: string): string[] =>
      register.operations.filter((op) => op.permissions.includes(code)).map((op) => op.id);
    expect(declarersOf('wo.work_order.line.manage').sort()).toEqual([
      'wo.required-part-record',
      'wo.service-line-record',
    ]);
    expect(declarersOf('crm.customer.profile.write').sort()).toEqual([
      'crm.address-add',
      'crm.contact-add',
      'crm.preference-set',
    ]);
    expect(declarersOf('rec.reception.evidence.manage').sort()).toEqual([
      'rec.reception-condition-evidence',
      'rec.reception-evidence-binding',
      'rec.reception-evidence-binding-finalize',
    ]);

    // DECLARATION IS NECESSARY, NOT SUFFICIENT — the rule CC-04 added and CC-12
    // applies here. `inv.cost.view` clears the declaration test and is withheld
    // anyway, on a decision recorded before this directive. Asserting the
    // declarer by NAME means the day that set changes, this case makes the Owner
    // look at the exclusion again.
    expect(declarersOf('inv.cost.view').sort()).toEqual(['inv.item-cost-history-read']);
    for (const code of WITHHELD_BY_CC12) expect(bundle).not.toContain(code);
  });

  it('P31-B11 the provisioned administrator effectively holds all three, and can delegate each onto a role it creates', async () => {
    const held = await codesHeldBy(probe.ownerAccountId);
    for (const code of ADDED_BY_OD_QA_CAMPAIGN) expect(held).toContain(code);
    // The withheld one, measured on the organisation rather than on the constant.
    for (const code of WITHHELD_BY_CC12) expect(held).not.toContain(code);

    const roleId = await newRole(probe, 'workshop_controller');
    for (const permissionCode of ADDED_BY_OD_QA_CAMPAIGN) {
      const mapped = await mapCode(probe, roleId, permissionCode);
      expect({ permissionCode, status: mapped.status }).toEqual({ permissionCode, status: 201 });
    }
  });

  it('P31-B12 it records a telephone contact on a customer it created (DEF-T-01)', async () => {
    expect(CONTACT_ADD_OPERATION.permissions).toEqual(['crm.customer.profile.write']);

    asOwnerOf(probe);
    const customer = await call<{ customerId: string }>(individualCreateRoute, {
      path: '/customers/individuals',
      body: { givenName: 'Contact', familyName: 'Probe' },
      idempotencyKey: randomUUID(),
    });
    expect(customer.status).toBe(201);
    const customerId = customer.body.customerId;

    asOwnerOf(probe);
    const contact = await call<{ contactId?: string }>(contactAddRoute, {
      path: `/customers/${customerId}/contacts`,
      params: { customerId },
      body: { channel: 'phone', value: '+962700000000', isPrimary: true },
      idempotencyKey: randomUUID(),
    });
    expect(contact.status).toBe(201);

    const { rows } = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM crm.contact_points
        WHERE tenant_id = $1 AND partner_id = $2 AND channel = 'phone' AND deleted_at IS NULL`,
      [probe.tenantId, customerId]
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('P31-B13 it records a service line on a work order its own reception produced (DEF-M-01)', async () => {
    expect(SERVICE_LINE_RECORD_OPERATION.permissions).toEqual(['wo.work_order.line.manage']);
    const scope = await scopeOf(probe);

    asOwnerOf(probe);
    const customer = await call<{ customerId: string }>(individualCreateRoute, {
      path: '/customers/individuals',
      body: { givenName: 'Service', familyName: 'Requester' },
      idempotencyKey: randomUUID(),
    });
    expect(customer.status).toBe(201);

    const visit = await seedVisit(probe, scope, customer.body.customerId, { authorize: true });

    asOwnerOf(probe);
    const converted = await call<{ workOrderId?: string }>(receptionConvertRoute, {
      path: `/receptions/${visit.visitId}/convert-to-work-order`,
      params: { receptionId: visit.visitId },
      body: {},
      idempotencyKey: randomUUID(),
      ifMatch: visit.recordVersion,
    });
    expect(converted.status).toBe(200);
    const workOrderId = converted.body.workOrderId ?? '';
    expect(workOrderId).not.toBe('');

    asOwnerOf(probe);
    const line = await call<{ lineId?: string }>(serviceLineRecordRoute, {
      path: `/work-orders/${workOrderId}/service-lines`,
      params: { workOrderId },
      body: { description: 'Brake fluid replacement', quantity: '1.000', unit: 'job' },
      idempotencyKey: randomUUID(),
    });
    expect(line.status).toBe(201);

    const { rows } = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM wo.work_order_service_lines
        WHERE tenant_id = $1 AND work_order_id = $2`,
      [probe.tenantId, workOrderId]
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('P31-B14 its priced goods receipt is refused for want of inv.cost.view, and the same receipt without a cost is accepted (DEF-T-03, open under CC-12)', async () => {
    // The operation declares the stock code, which the bundle carries; the SECOND
    // permission the service reads before it will accept a priced line is
    // `inv.cost.view`, which CC-12 keeps out of the bundle. This case measures the
    // consequence as it CURRENTLY stands rather than a capability the first
    // administrator does not have.
    expect(GOODS_RECEIPT_CREATE_OPERATION.permissions).toEqual(['inv.stock.operate']);
    const scope = await scopeOf(probe);

    asOwnerOf(probe);
    const category = await call<{ id: string }>(itemCategoryCreateRoute, {
      path: '/item-categories',
      body: { code: 'brake_parts', name: 'Brake parts' },
      idempotencyKey: randomUUID(),
    });
    expect(category.status).toBe(201);
    const itemCategoryId = category.body.id;

    asOwnerOf(probe);
    const uoms = await call<{ items: Array<{ id: string; code?: string }> }>(
      unitOfMeasureListRoute,
      { path: '/units-of-measure', method: 'GET' }
    );
    expect(uoms.status).toBe(200);
    const uomId = uoms.body.items[0]?.id ?? '';
    expect(uomId).not.toBe('');

    asOwnerOf(probe);
    const item = await call<{ id: string }>(itemCreateRoute, {
      path: '/items',
      body: {
        itemCategoryId,
        sku: 'P31B-BRAKE-PAD',
        name: 'Brake pad set',
        uomId,
        itemType: 'part',
        isStockTracked: true,
      },
      idempotencyKey: randomUUID(),
    });
    expect(item.status).toBe(201);
    const itemId = item.body.id;

    asOwnerOf(probe);
    const location = await call<{ id: string }>(stockLocationCreateRoute, {
      path: '/stock-locations',
      body: {
        companyId: scope.companyId,
        branchId: scope.branchId,
        locationCode: 'MAIN-STORE',
        name: 'Main store',
        locationType: 'warehouse',
      },
      idempotencyKey: randomUUID(),
    });
    expect(location.status).toBe(201);
    const locationId = location.body.id;

    // THE REFUSAL. The first administrator of the organisation the shipped
    // provisioning operation created cannot record a unit cost, and cannot
    // delegate the authority to anyone, because nobody in the organisation holds
    // the code. 422, the validation code, and the violation names the priced line.
    asOwnerOf(probe);
    const priced = await call<{
      code?: string;
      violations?: Array<{ path: string; rule: string }>;
    }>(goodsReceiptCreateRoute, {
      path: '/goods-receipts',
      body: {
        companyId: scope.companyId,
        branchId: scope.branchId,
        receivedOn: '2026-09-17',
        lines: [
          { itemId, locationId, quantity: '4.000', unitCost: '12.5000', currencyCode: 'JOD' },
        ],
      },
      idempotencyKey: randomUUID(),
    });
    expect(priced.status).toBe(422);
    expect(priced.body.code).toBe('ERR-VAL-001');
    expect(priced.body.violations?.map((violation) => violation.path)).toEqual([
      'body.lines.0.unitCost',
    ]);

    // Nothing was written: the refusal is a refusal and not a receipt accepted
    // with the cost silently dropped.
    const { rows: refused } = await admin.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM inv.goods_receipt_lines WHERE tenant_id = $1 AND item_id = $2',
      [probe.tenantId, itemId]
    );
    expect(refused[0]?.n).toBe(0);

    // THE COST IS THE WHOLE REASON. The identical receipt without a unit cost is
    // accepted, so the 422 above is attributable to `inv.cost.view` and not to
    // anything else about the request or the organisation.
    asOwnerOf(probe);
    const unpriced = await call<{ id: string }>(goodsReceiptCreateRoute, {
      path: '/goods-receipts',
      body: {
        companyId: scope.companyId,
        branchId: scope.branchId,
        receivedOn: '2026-09-17',
        lines: [{ itemId, locationId, quantity: '4.000' }],
      },
      idempotencyKey: randomUUID(),
    });
    expect(unpriced.status).toBe(201);

    const { rows } = await admin.query<{ unit_cost: string | null }>(
      `SELECT unit_cost::text AS unit_cost FROM inv.goods_receipt_lines
        WHERE tenant_id = $1 AND receipt_id = $2`,
      [probe.tenantId, unpriced.body.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.unit_cost).toBeNull();
  });

  it('P31-B15 it binds an exact document version to a capture requirement of a reception visit (DEF-T-12 / DEF-M-06)', async () => {
    expect(RECEPTION_EVIDENCE_BINDING_OPERATION.permissions).toEqual([
      'rec.reception.evidence.manage',
    ]);
    const scope = await scopeOf(probe);

    asOwnerOf(probe);
    const customer = await call<{ customerId: string }>(individualCreateRoute, {
      path: '/customers/individuals',
      body: { givenName: 'Evidence', familyName: 'Requester' },
      idempotencyKey: randomUUID(),
    });
    expect(customer.status).toBe(201);

    const visit = await seedVisit(probe, scope, customer.body.customerId);
    const document = await seedEvidenceDocument(probe, visit.visitId);

    asOwnerOf(probe);
    const bound = await call<{ bindingId?: string }>(evidenceBindingRoute, {
      path: `/receptions/${visit.visitId}/evidence-bindings`,
      params: { receptionId: visit.visitId },
      body: {
        requirementCode: 'exterior',
        documentId: document.documentId,
        documentVersionId: document.versionId,
      },
      idempotencyKey: randomUUID(),
    });
    expect(bound.status).toBe(201);

    const { rows } = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM rec.reception_evidence_bindings
        WHERE tenant_id = $1 AND reception_visit_id = $2 AND requirement_code = 'exterior'`,
      [probe.tenantId, visit.visitId]
    );
    expect(rows[0]?.n).toBe(1);
  });
});

/** An account of a provisioned organisation that is NOT its first administrator. */
async function seedMember(
  tenant: Provisioned,
  label: string
): Promise<{ userId: string; subject: string }> {
  const userId = randomUUID();
  const subject = `fx_p31b_${label}_${RUN}`;
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)`,
    [
      userId,
      tenant.tenantId,
      IDENTITY_PROVIDER,
      subject,
      `${subject}@fixture.test`,
      `P31 ${label}`,
      tenant.ownerAccountId,
    ]
  );
  return { userId, subject };
}

function asMember(tenant: Provisioned, subject: string): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: subject,
      tenantId: tenant.tenantId,
    })
  );
}

/**
 * A role the provisioned administrator BUILDS out of codes it holds, granted by it to
 * one member and confined to one branch — the only way anybody but the administrator
 * comes to hold a code in such an organisation.
 */
async function grantBranchRole(
  tenant: Provisioned,
  roleCode: string,
  codes: readonly string[],
  userId: string,
  scope: { companyId: string; branchId: string }
): Promise<string> {
  const roleId = await newRole(tenant, roleCode);
  for (const permissionCode of codes) {
    const mapped = await mapCode(tenant, roleId, permissionCode);
    expect({ permissionCode, status: mapped.status }).toEqual({ permissionCode, status: 201 });
  }
  asOwnerOf(tenant);
  const grant = await call<{ id?: string }>(grantIssueRoute, {
    path: '/iam/grants',
    body: {
      userId,
      roleId,
      scopes: [{ scopeType: 'branch', companyId: scope.companyId, branchId: scope.branchId }],
    },
    idempotencyKey: randomUUID(),
  });
  expect(grant.status).toBe(201);
  return roleId;
}

interface CreditInvoice {
  readonly invoiceId: string;
  readonly companyId: string;
  readonly branchId: string;
}

let creditInvoice: Promise<CreditInvoice> | undefined;

/**
 * ONE issued invoice in the provisioned organisation, shared by B18–B20.
 *
 * The work order is the organisation's own, produced through the shipped reception
 * conversion exactly as B13 produces one. The invoice is built on the admin
 * connection the way `p1-22-helpers.ts` `seedIssuedInvoice` builds one — a draft
 * header, a line, its restricted line amount, then `sal.issue_invoice` — because
 * pricing a work order through quotations is not what these cases measure. What
 * they MEASURE, the credit note, runs through the shipped routes only.
 */
function issuedInvoice(): Promise<CreditInvoice> {
  creditInvoice ??= (async () => {
    const scope = await scopeOf(probe);
    asOwnerOf(probe);
    const customer = await call<{ customerId: string }>(individualCreateRoute, {
      path: '/customers/individuals',
      body: { givenName: 'Credit', familyName: 'Customer' },
      idempotencyKey: randomUUID(),
    });
    expect(customer.status).toBe(201);
    const visit = await seedVisit(probe, scope, customer.body.customerId, { authorize: true });
    asOwnerOf(probe);
    const converted = await call<{ workOrderId?: string }>(receptionConvertRoute, {
      path: `/receptions/${visit.visitId}/convert-to-work-order`,
      params: { receptionId: visit.visitId },
      body: {},
      idempotencyKey: randomUUID(),
      ifMatch: visit.recordVersion,
    });
    expect(converted.status).toBe(200);
    const workOrderId = converted.body.workOrderId ?? '';
    expect(workOrderId).not.toBe('');

    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [probe.ownerAccountId, probe.tenantId]
      );
      const invoice = await client.query<{ id: string }>(
        `INSERT INTO sal.invoices
           (tenant_id, company_id, branch_id, work_order_id, payer_partner_id, currency_code,
            idempotency_key, created_by)
         VALUES ($1,$2,$3,$4,$5,'JOD',$6,$7) RETURNING id`,
        [
          probe.tenantId,
          scope.companyId,
          scope.branchId,
          workOrderId,
          customer.body.customerId,
          `fx-p31b-credit-invoice-${RUN}`,
          probe.ownerAccountId,
        ]
      );
      const invoiceId = invoice.rows[0]?.id ?? '';
      const line = await client.query<{ id: string }>(
        `INSERT INTO sal.invoice_lines
           (tenant_id, company_id, branch_id, invoice_id, line_number, line_type, quantity,
            currency_code, created_by)
         VALUES ($1,$2,$3,$4,1,'service',1,'JOD',$5) RETURNING id`,
        [probe.tenantId, scope.companyId, scope.branchId, invoiceId, probe.ownerAccountId]
      );
      await client.query(
        `INSERT INTO sal.invoice_line_amounts
           (tenant_id, company_id, branch_id, invoice_line_id, invoice_id, unit_price,
            net_amount, tax_amount, gross_amount, customer_pay_amount, warranty_pay_amount,
            created_by)
         VALUES ($1,$2,$3,$4,$5,'100.0000','100.0000','0.0000','100.0000','100.0000',0,$6)`,
        [
          probe.tenantId,
          scope.companyId,
          scope.branchId,
          line.rows[0]?.id ?? '',
          invoiceId,
          probe.ownerAccountId,
        ]
      );
      await client.query('SELECT sal.issue_invoice($1,NULL)', [invoiceId]);
      await client.query('COMMIT');
      return { invoiceId, companyId: scope.companyId, branchId: scope.branchId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  })();
  return creditInvoice;
}

async function openReceivable(invoiceId: string): Promise<string> {
  const { rows } = await admin.query<{ open: string }>(
    'SELECT sal.invoice_open_receivable($1)::text AS open',
    [invoiceId]
  );
  return rows[0]?.open ?? '';
}

async function creditNotesOn(invoiceId: string): Promise<number> {
  const { rows } = await admin.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM sal.credit_notes WHERE invoice_id = $1',
    [invoiceId]
  );
  return rows[0]?.n ?? 0;
}

async function auditRecordsFor(
  tenantId: string,
  action: string,
  entityId: string
): Promise<number> {
  const { rows } = await admin.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM iam.audit_records
      WHERE tenant_id = $1 AND action = $2 AND entity_id = $3`,
    [tenantId, action, entityId]
  );
  return rows[0]?.n ?? 0;
}

interface CreditNoteReply {
  readonly creditNote?: {
    readonly id: string;
    readonly branchId: string;
    readonly approvalState: string;
    readonly requestedBy: string;
    readonly approvedBy: string | null;
    readonly amount: { readonly amount: string; readonly currency: string };
  };
  readonly code?: string;
  readonly requiredPermissions?: string[];
}

describe('Owner decision — sal.credit.manage: credit notes in a provisioned organisation', () => {
  it('P31-B16 the bundle carries sal.credit.manage and nothing else moved; the four credit-note operations declare it with sal.finance.view; it was already a catalogue row; first_owner is untouched', () => {
    const bundle = [...TENANT_ADMINISTRATOR_ROLE.permissionCodes];
    expect(bundle).toHaveLength(89);
    for (const code of ADDED_BY_CREDIT_DECISION) {
      expect(bundle.filter((c) => c === code)).toHaveLength(1);
      expect(ADDED_ALL).not.toContain(code);
      expect(ADDED_BY_P1_32_MATERIAL).not.toContain(code);
      expect(ADDED_BY_OD_QA_CAMPAIGN).not.toContain(code);
    }
    // Its companion read code is already carried, so the four operations are
    // reachable on the bundle alone.
    expect(bundle).toContain('sal.finance.view');

    // NOTHING IS MINTED: a catalogue row already.
    const seed = readFileSync(
      join(REPOSITORY_ROOT, 'supabase/seeds/04_iam_permission_catalog.sql'),
      'utf8'
    );
    expect(seed).toContain("('sal.credit.manage'");

    // DECLARED by exactly the four credit-note operations, read from the register.
    const register = JSON.parse(
      readFileSync(
        join(REPOSITORY_ROOT, 'docs/phase-1/phase-1-24/evidence/operation-register.json'),
        'utf8'
      )
    ) as { operations: Array<{ id: string; permissions: string[] }> };
    expect(
      register.operations
        .filter((op) => op.permissions.includes('sal.credit.manage'))
        .map((op) => op.id)
        .sort()
    ).toEqual([
      'sal.credit-note-approve',
      'sal.credit-note-create',
      'sal.credit-note-detail',
      'sal.credit-note-list',
    ]);

    // The existing controls, by declaration: every one is branch-scoped and needs both
    // codes, and the two writes are audited under their own actions and classes.
    for (const operation of [
      CREDIT_NOTE_CREATE_OPERATION,
      CREDIT_NOTE_APPROVE_OPERATION,
      CREDIT_NOTE_LIST_OPERATION,
      CREDIT_NOTE_DETAIL_OPERATION,
    ]) {
      expect(operation.permissions).toEqual(['sal.credit.manage', 'sal.finance.view']);
      expect(operation.scope).toBe('branch');
    }
    expect(CREDIT_NOTE_CREATE_OPERATION.auditAction).toBe('sal.credit_note.requested');
    expect(CREDIT_NOTE_CREATE_OPERATION.auditClass).toBe('financial');
    expect(CREDIT_NOTE_APPROVE_OPERATION.auditAction).toBe('sal.credit_note.approved');
    expect(CREDIT_NOTE_APPROVE_OPERATION.auditClass).toBe('approval');

    // Carried here and nowhere else: the frozen bootstrap role gains nothing.
    expect([...FIRST_OWNER_ROLE.permissionCodes]).toEqual([
      'iam.user.manage',
      'iam.role.manage',
      'iam.grant.manage',
    ]);
  });

  it('P31-B17 the provisioned administrator effectively holds it, and can delegate it onto a role it creates', async () => {
    expect(await codesOfRole(probe.tenantAdministratorRoleId)).toContain('sal.credit.manage');
    expect(await codesHeldBy(probe.ownerAccountId)).toContain('sal.credit.manage');

    // The act `ins_role_permissions_delegable` refused to everybody before: no
    // delegation restriction singles this code out, so holding it is enough.
    const roleId = await newRole(probe, 'credit_delegation_probe');
    const mapped = await mapCode(probe, roleId, 'sal.credit.manage');
    expect(mapped.status).toBe(201);
    expect(await codesOfRole(roleId)).toEqual(['sal.credit.manage']);
  });

  it('P31-B18 it requests a credit note in its own branch (pending, crediting nothing, audited), cannot approve its own request, and a second person it delegated the code to approves it', async () => {
    const invoice = await issuedInvoice();
    expect(await openReceivable(invoice.invoiceId)).toBe('100.0000');

    asOwnerOf(probe);
    const requested = await call<CreditNoteReply>(creditNoteCreateRoute, {
      path: `/invoices/${invoice.invoiceId}/credit-notes`,
      params: { invoiceId: invoice.invoiceId },
      body: { amount: '40.000', reason: 'A part was billed twice on the same job' },
      idempotencyKey: randomUUID(),
    });
    expect(requested.status).toBe(201);
    const note = requested.body.creditNote;
    if (note === undefined) throw new Error('the credit-note request answered no credit note');
    expect(note.branchId).toBe(invoice.branchId);
    expect(note.approvalState).toBe('pending');
    expect(note.requestedBy).toBe(probe.ownerAccountId);
    expect(note.approvedBy).toBeNull();
    expect(note.amount).toEqual({ amount: '40.0000', currency: 'JOD' });
    // Audited once, in this organisation's own trail.
    expect(await auditRecordsFor(probe.tenantId, 'sal.credit_note.requested', note.id)).toBe(1);
    // A request credits nothing.
    expect(await openReceivable(invoice.invoiceId)).toBe('100.0000');

    // The administrator reads it back through the list the navigation entry opens.
    asOwnerOf(probe);
    const listed = await call<{ items: Array<{ id: string }> }>(creditNoteListRoute, {
      path: `/credit-notes?companyId=${invoice.companyId}&branchId=${invoice.branchId}`,
      method: 'GET',
    });
    expect(listed.status).toBe(200);
    expect(listed.body.items.map((item) => item.id)).toContain(note.id);

    // DUAL CONTROL IS UNCHANGED: holding the code does not let the requester approve.
    asOwnerOf(probe);
    const selfApproval = await call<{ code?: string }>(creditNoteApproveRoute, {
      path: `/credit-notes/${note.id}/approval`,
      params: { creditNoteId: note.id },
      idempotencyKey: randomUUID(),
    });
    expect(selfApproval.status).toBe(409);
    expect(selfApproval.body.code).toBe('ERR-TRN-001');
    expect(await openReceivable(invoice.invoiceId)).toBe('100.0000');
    expect(await auditRecordsFor(probe.tenantId, 'sal.credit_note.approved', note.id)).toBe(0);

    // The second person: a member the administrator gives a finance-approver role it
    // builds from the two codes it holds, confined to the invoice's branch.
    const approver = await seedMember(probe, 'approver');
    await grantBranchRole(
      probe,
      'finance_approver',
      ['sal.credit.manage', 'sal.finance.view'],
      approver.userId,
      invoice
    );
    asMember(probe, approver.subject);
    const approved = await call<CreditNoteReply>(creditNoteApproveRoute, {
      path: `/credit-notes/${note.id}/approval`,
      params: { creditNoteId: note.id },
      idempotencyKey: randomUUID(),
    });
    expect(approved.status).toBe(200);
    expect(approved.body.creditNote?.approvalState).toBe('approved');
    expect(approved.body.creditNote?.approvedBy).toBe(approver.userId);
    expect(await auditRecordsFor(probe.tenantId, 'sal.credit_note.approved', note.id)).toBe(1);
    // 100.0000 minus 40.0000, as exact decimal strings.
    expect(await openReceivable(invoice.invoiceId)).toBe('60.0000');
  });

  it('P31-B19 the administrator of ANOTHER organisation, holding the same code, cannot credit this organisation invoice', async () => {
    const invoice = await issuedInvoice();
    const other = await provision('crn_other');
    // It holds the code in its own organisation, so the refusal below is isolation and
    // not a missing grant.
    expect(await codesHeldBy(other.ownerAccountId)).toContain('sal.credit.manage');
    const before = await creditNotesOn(invoice.invoiceId);

    asOwnerOf(other);
    const refused = await call<{ code?: string }>(creditNoteCreateRoute, {
      path: `/invoices/${invoice.invoiceId}/credit-notes`,
      params: { invoiceId: invoice.invoiceId },
      body: { amount: '10.000', reason: 'Another organisation' },
      idempotencyKey: randomUUID(),
    });
    expect(refused.status).toBe(404);
    expect(refused.body.code).toBe('ERR-RES-001');
    expect(await creditNotesOn(invoice.invoiceId)).toBe(before);
  });

  it('P31-B20 a cashier the administrator builds WITHOUT the code is refused, with the registered refusal, and nothing is written', async () => {
    const invoice = await issuedInvoice();
    const cashier = await seedMember(probe, 'cashier');
    const roleId = await grantBranchRole(
      probe,
      'cashier',
      ['sal.invoice.manage', 'sal.finance.view', 'sal.payment.record'],
      cashier.userId,
      invoice
    );
    // The cashier role is exactly what the administrator built: the bundle change gave
    // it nothing.
    expect(await codesOfRole(roleId)).toEqual([
      'sal.finance.view',
      'sal.invoice.manage',
      'sal.payment.record',
    ]);
    const before = await creditNotesOn(invoice.invoiceId);

    asMember(probe, cashier.subject);
    const refused = await call<{ code?: string; requiredPermissions?: string[] }>(
      creditNoteCreateRoute,
      {
        path: `/invoices/${invoice.invoiceId}/credit-notes`,
        params: { invoiceId: invoice.invoiceId },
        body: { amount: '10.000', reason: 'A cashier trying' },
        idempotencyKey: randomUUID(),
      }
    );
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('ERR-IAM-001');
    expect(refused.body.requiredPermissions).toContain('sal.credit.manage');
    expect(await creditNotesOn(invoice.invoiceId)).toBe(before);
  });
});
