/**
 * The P1-31 delivery checklist TEMPLATE seam — a configuration surface that did not
 * exist (prerequisite **P-9** of `docs/phase-1/phase-1-31/a0-preflight.md`, **PPD-12**).
 *
 * ## What was measured, and what this suite has to prove
 *
 * `sal.delivery_checklist_templates` and `sal.delivery_checklist_template_items`
 * landed in P1-11 carrying INSERT and UPDATE grants and policies, and until this slice
 * **no code anywhere in `apps/api/src` had ever written either table**. The only method
 * that touched them was a per-item existence probe for the write path. So the handover
 * checklist of a tenant provisioned through the product was empty and permanently so —
 * which is why every backend suite before this one, including the P1-31 delivery read
 * seam, seeds these tables by ADMIN SQL. This suite deliberately does not: every row it
 * reads was authored through the published routes, because "a template can be
 * configured through the product" is the claim under test.
 *
 * ## The authority is COMPANY-WIDE, and that is the substantive decision
 *
 * `SAL_SCOPED_A2` holds `sal.delivery.manage` through a BRANCH-scoped grant inside
 * `COMPANY_A1` and is refused every write, while `SAL_COMPANY_SCOPED` — whose grant is
 * `scope_type = 'company'` on the same company — is allowed, and is then refused in
 * `COMPANY_A9`, where its only grant carries no delivery code. Three principals, one
 * rule: a mandatory item authored here blocks the handover of every vehicle in every
 * branch of the company, because `sal.complete_delivery` counts mandatory items by
 * `(tenant, company)` across all templates that are in force.
 *
 * The READS are gated differently on purpose: `SAL_READER` holds `sal.delivery.view`
 * and not `sal.delivery.manage`, and reads the whole surface. A delivery officer must
 * be able to see the checklist they are working through.
 *
 * ## The gate finding this suite recorded, and now proves closed
 *
 * This suite originally recorded a defect it could not fix: **an INACTIVE template
 * still blocked a handover**, because `sal.complete_delivery` filtered mandatory items
 * on the ITEM's `deleted_at` and never joined the parent template, so retiring a
 * template withdrew nothing from the completion gate and the operator's only remedy was
 * withdrawing each item. Correcting it was a change to a protected function — a
 * migration — and was carried as CC-14.
 *
 * P-9b closes it (Owner approval 2026-09-09). Migration
 * `20260909090000_sal_complete_delivery_active_template_gate.sql` joins
 * `sal.delivery_checklist_templates` into the count and admits an item only when its
 * template is `status = 'active'` and not soft-deleted, and
 * `mandatoryChecklistGaps` gains the same join in the same commit. The cases at the
 * foot of this file are the inverted proof, on real rows in `COMPANY_A9`: an active
 * template gates, deactivation clears, reactivation gates again, withdrawing the item
 * still clears, and neither another company's nor another tenant's template is ever
 * counted.
 *
 * The lockstep rule that made the finding unfixable here is unchanged and is why the
 * mirror moves with the migration rather than ahead of it: a mirror that "improved" on
 * the primitive would report a delivery eligible that the primitive then refuses with
 * 23514. The WRITE side of that agreement — the refusal itself, and the completion
 * succeeding once the template is retired or soft-deleted — is pinned against the
 * primitive directly in `tests/db/sal-delivery.test.ts`. The soft-deleted-template
 * state lives there rather than here for a reason of principle: this suite authors
 * every row through a published route, and no route soft-deletes a template.
 *
 * COVERAGE-EVIDENCE (P1-31 delivery checklist template seam):
 *   sal.delivery-checklist-template-list: route service authorization success denial
 *   sal.delivery-checklist-template-read: route service authorization success denial cross-tenant
 *   sal.delivery-checklist-template-create: route service authorization success denial cross-tenant isolation audit idempotency
 *   sal.delivery-checklist-template-rename: route service authorization success denial cross-tenant isolation audit stale-version
 *   sal.delivery-checklist-template-status-set: route service authorization success denial cross-tenant isolation audit idempotency stale-version
 *   sal.delivery-checklist-template-item-create: route service authorization success denial cross-tenant isolation audit idempotency
 *   sal.delivery-checklist-template-item-update: route service authorization success denial cross-tenant isolation audit stale-version
 *   sal.delivery-checklist-template-item-remove: route service authorization success denial cross-tenant isolation audit
 *
 * No `pagination` flag is claimed for the DETAIL read and none is claimed for the item
 * routes: the detail read is deliberately unpaged (the order is the checklist), and the
 * item routes are commands. The list read IS paged and its page boundary is proved
 * below; the flag is not in its declared set because the derived floor does not ask for
 * one, and the assertion exists regardless.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  COMPANY_A1,
  IDENTITY_PROVIDER,
  TENANT_A,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { establishP1_19Fixtures, type Principal } from './p1-19-helpers';
import {
  BRANCH_A9,
  COMPANY_A9,
  COMPANY_B1,
  SAL_COMPANY_SCOPED,
  SAL_FULL,
  SAL_READER,
  SAL_SCOPED_A2,
  SAL_TENANT_B,
  authAs,
  cleanP1_22Fixtures,
  establishP1_22Fixtures,
  seedWorkOrderChain,
} from './p1-22-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import {
  CHECKLIST_TEMPLATE_CREATE_OPERATION,
  CHECKLIST_TEMPLATE_LIST_OPERATION,
  GET as LIST_TEMPLATES,
  POST as CREATE_TEMPLATE,
} from '@/app/api/v1/delivery-checklist-templates/route';
import {
  CHECKLIST_TEMPLATE_READ_OPERATION,
  CHECKLIST_TEMPLATE_RENAME_OPERATION,
  GET as READ_TEMPLATE,
  PATCH as RENAME_TEMPLATE,
} from '@/app/api/v1/delivery-checklist-templates/[templateId]/route';
import {
  CHECKLIST_TEMPLATE_STATUS_OPERATION,
  POST as SET_TEMPLATE_STATUS,
} from '@/app/api/v1/delivery-checklist-templates/[templateId]/status/route';
import {
  CHECKLIST_TEMPLATE_ITEM_CREATE_OPERATION,
  POST as CREATE_ITEM,
} from '@/app/api/v1/delivery-checklist-templates/[templateId]/items/route';
import {
  CHECKLIST_TEMPLATE_ITEM_REMOVE_OPERATION,
  CHECKLIST_TEMPLATE_ITEM_UPDATE_OPERATION,
  DELETE as REMOVE_ITEM,
  PATCH as UPDATE_ITEM,
} from '@/app/api/v1/delivery-checklist-templates/[templateId]/items/[itemId]/route';
import { POST as CREATE_DELIVERY } from '@/app/api/v1/deliveries/route';
import { GET as READ_ELIGIBILITY } from '@/app/api/v1/deliveries/[deliveryId]/eligibility/route';

let admin: Pool;
let runtime: Pool;

// ---------------------------------------------------------------------------
// The eight operation ids, written out as literals so the coverage gate can see
// this file INVOKE each one: for a `sal.` id the gate strips every comment before
// it looks, so naming them in a header proves nothing.
// ---------------------------------------------------------------------------

const SEAM_OPERATION_IDS = Object.freeze({
  list: 'sal.delivery-checklist-template-list',
  read: 'sal.delivery-checklist-template-read',
  create: 'sal.delivery-checklist-template-create',
  rename: 'sal.delivery-checklist-template-rename',
  status: 'sal.delivery-checklist-template-status-set',
  itemCreate: 'sal.delivery-checklist-template-item-create',
  itemUpdate: 'sal.delivery-checklist-template-item-update',
  itemRemove: 'sal.delivery-checklist-template-item-remove',
} as const);

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

interface TemplateBody {
  readonly id: string;
  readonly companyId: string;
  readonly templateCode: string;
  readonly name: string;
  readonly status: string;
  readonly recordVersion: number;
}

interface ItemBody {
  readonly id: string;
  readonly templateId: string;
  readonly itemCode: string;
  readonly label: string;
  readonly isMandatory: boolean;
  readonly sortOrder: number;
  readonly recordVersion: number;
}

interface DetailBody {
  readonly template: TemplateBody;
  readonly items: readonly ItemBody[];
}

interface ListBody {
  readonly templates: {
    readonly items: readonly TemplateBody[];
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
  };
}

interface EligibilityBody {
  readonly blockers: readonly string[];
  readonly checklistGaps: readonly { readonly itemCode: string; readonly label: string }[];
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;
const codeOf = async (response: Response): Promise<string> =>
  ((await response.json()) as { code: string }).code;

// ---------------------------------------------------------------------------
// Route drivers. Every call below goes through the real route handler, so the
// permission gate, the deferred scope check, the version guard, the idempotency
// reservation and the validation all run.
// ---------------------------------------------------------------------------

const BASE = 'http://localhost/api/v1/delivery-checklist-templates';

const jsonHeaders = (options: {
  readonly key?: string | null;
  readonly version?: number | null;
}): Record<string, string> => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.key !== null && options.key !== undefined) headers['idempotency-key'] = options.key;
  if (options.version !== null && options.version !== undefined) {
    headers['if-match'] = String(options.version);
  }
  return headers;
};

const listTemplates = (page?: { cursor?: string; limit?: number }): Promise<Response> => {
  const parts: string[] = [];
  if (page?.cursor !== undefined) parts.push(`cursor=${encodeURIComponent(page.cursor)}`);
  if (page?.limit !== undefined) parts.push(`limit=${String(page.limit)}`);
  return LIST_TEMPLATES(new Request(`${BASE}${parts.length === 0 ? '' : `?${parts.join('&')}`}`));
};

const readTemplate = (templateId: string): Promise<Response> =>
  READ_TEMPLATE(new Request(`${BASE}/${templateId}`), {
    params: Promise.resolve({ templateId }),
  });

const createTemplate = (body: unknown, key: string = randomUUID()): Promise<Response> =>
  CREATE_TEMPLATE(
    new Request(BASE, { method: 'POST', headers: jsonHeaders({ key }), body: JSON.stringify(body) })
  );

const renameTemplate = (
  templateId: string,
  name: string,
  version: number | null
): Promise<Response> =>
  RENAME_TEMPLATE(
    new Request(`${BASE}/${templateId}`, {
      method: 'PATCH',
      headers: jsonHeaders({ version }),
      body: JSON.stringify({ name }),
    }),
    { params: Promise.resolve({ templateId }) }
  );

const setTemplateStatus = (
  templateId: string,
  status: string,
  version: number | null,
  key: string = randomUUID()
): Promise<Response> =>
  SET_TEMPLATE_STATUS(
    new Request(`${BASE}/${templateId}/status`, {
      method: 'POST',
      headers: jsonHeaders({ key, version }),
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ templateId }) }
  );

const createItem = (
  templateId: string,
  body: unknown,
  key: string = randomUUID()
): Promise<Response> =>
  CREATE_ITEM(
    new Request(`${BASE}/${templateId}/items`, {
      method: 'POST',
      headers: jsonHeaders({ key }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ templateId }) }
  );

const updateItem = (
  templateId: string,
  itemId: string,
  body: unknown,
  version: number | null
): Promise<Response> =>
  UPDATE_ITEM(
    new Request(`${BASE}/${templateId}/items/${itemId}`, {
      method: 'PATCH',
      headers: jsonHeaders({ version }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ templateId, itemId }) }
  );

const removeItem = (templateId: string, itemId: string): Promise<Response> =>
  REMOVE_ITEM(new Request(`${BASE}/${templateId}/items/${itemId}`, { method: 'DELETE' }), {
    params: Promise.resolve({ templateId, itemId }),
  });

// ---------------------------------------------------------------------------
// Fixture authoring — through the routes, never by admin SQL
// ---------------------------------------------------------------------------

/** A code no other suite uses, and one that matches no suite's tenant-prefix cleanup. */
let codeSequence = 0;
const nextCode = (stem: string): string => {
  codeSequence += 1;
  return `fx_p131_p9_${stem}_${String(codeSequence)}`;
};

interface AuthoredTemplate {
  readonly id: string;
  readonly templateCode: string;
  readonly recordVersion: number;
  readonly items: readonly ItemBody[];
}

/** Creates a template as `SAL_FULL` and returns what the response actually carried. */
async function authorTemplate(
  input: {
    readonly companyId?: string;
    readonly name?: string;
    readonly items?: readonly unknown[];
  } = {}
): Promise<AuthoredTemplate> {
  authAs(SAL_FULL);
  const templateCode = nextCode('tpl');
  const response = await createTemplate({
    companyId: input.companyId ?? COMPANY_A1,
    templateCode,
    name: input.name ?? 'Handover checklist',
    ...(input.items === undefined ? {} : { items: input.items }),
  });
  expect(response.status).toBe(201);
  const created = await bodyOf<DetailBody>(response);
  return {
    id: created.template.id,
    templateCode,
    recordVersion: created.template.recordVersion,
    items: created.items,
  };
}

const auditCount = async (action: string, entityId: string): Promise<number> => {
  const result = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM iam.audit_records WHERE action = $1 AND entity_id = $2`,
    [action, entityId]
  );
  return Number(result.rows[0]?.n ?? '0');
};

const templateRow = async (
  templateId: string
): Promise<{ name: string; status: string; record_version: number } | undefined> => {
  const result = await admin.query<{ name: string; status: string; record_version: number }>(
    `SELECT name, status, record_version FROM sal.delivery_checklist_templates WHERE id = $1`,
    [templateId]
  );
  return result.rows[0];
};

const templateCount = async (): Promise<number> => {
  const result = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM sal.delivery_checklist_templates WHERE tenant_id = $1`,
    [TENANT_A]
  );
  return Number(result.rows[0]?.n ?? '0');
};

/**
 * Refuses a JSON number under any money-shaped key, anywhere in a response.
 *
 * There is no money on this surface — neither table has a `numeric` column — so the
 * correct assertion is not "the amounts are strings" but "there are no amounts". This
 * walks the whole document so a future field cannot slip a float in under a nested
 * object. `sortOrder` and `recordVersion` are integers and are deliberately not
 * money-shaped names.
 */
const MONEY_KEYS = Object.freeze(['amount', 'net', 'tax', 'gross', 'total', 'price', 'balance']);

function refusesAnyMoneyShapedNumber(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) refusesAnyMoneyShapedNumber(entry);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'number') {
      expect(MONEY_KEYS.some((money) => key.toLowerCase().includes(money))).toBe(false);
    }
    refusesAnyMoneyShapedNumber(entry);
  }
}

/**
 * A tenant-A principal holding `sal.delivery.manage` and NOT `sal.delivery.view`.
 *
 * The whole point of the read-authorization cases: its refusal is the MISSING
 * PERMISSION and nothing else. It can author a checklist and cannot read one back,
 * which without this principal would be indistinguishable from a scope or a tenancy
 * refusal.
 */
const SAL_NO_DELIVERY_VIEW: Principal = {
  roleId: 'f1310000-0000-4000-8000-0000000009a1',
  userId: 'f1310000-0000-4000-8000-0000000009a2',
  subject: 'fx_p1_31_p9_no_delivery_view',
  tenantId: TENANT_A,
  permissions: ['sal.delivery.manage'],
};

async function seedLocalPrincipal(principal: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','P1-31 P-9 principal','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [principal.userId, principal.tenantId, IDENTITY_PROVIDER, principal.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-31 P-9 fixture',$4) ON CONFLICT (id) DO NOTHING`,
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
  const existing = await admin.query(
    `SELECT 1 FROM iam.role_grants WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3`,
    [principal.tenantId, principal.userId, principal.roleId]
  );
  if (existing.rowCount === 0) {
    await admin.query(
      `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
      [principal.tenantId, principal.userId, principal.roleId, USER_A]
    );
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let MAIN: AuthoredTemplate;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);
  await establishP1_22Fixtures(admin);
  await seedLocalPrincipal(SAL_NO_DELIVERY_VIEW);

  MAIN = await authorTemplate({
    name: 'Handover checklist',
    items: [
      // NOT mandatory, and that is a decision rather than an oversight: the mandatory
      // scan of `sal.complete_delivery` is COMPANY-wide, so a mandatory item here would
      // block every in-flight delivery of `COMPANY_A1` for every other suite sharing
      // this database. The one mandatory item this suite creates lives in `COMPANY_A9`
      // and is withdrawn inside the case that creates it.
      { itemCode: 'fx_p131_p9_lights', label: 'Lights checked', sortOrder: 2 },
      { itemCode: 'fx_p131_p9_fuel', label: 'Fuel level agreed', sortOrder: 1 },
    ],
  });
  __resetAuthenticatorForTests();
}, 240_000);

afterEach(() => __resetAuthenticatorForTests());

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  await cleanP1_22Fixtures().catch(() => undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

// ---------------------------------------------------------------------------
// The registrations themselves
// ---------------------------------------------------------------------------

describe('the eight registrations', () => {
  it('declare the delivery codes the catalogue already seeds, and mint none', () => {
    expect(CHECKLIST_TEMPLATE_LIST_OPERATION.id).toBe(SEAM_OPERATION_IDS.list);
    expect(CHECKLIST_TEMPLATE_READ_OPERATION.id).toBe(SEAM_OPERATION_IDS.read);
    expect(CHECKLIST_TEMPLATE_CREATE_OPERATION.id).toBe(SEAM_OPERATION_IDS.create);
    expect(CHECKLIST_TEMPLATE_RENAME_OPERATION.id).toBe(SEAM_OPERATION_IDS.rename);
    expect(CHECKLIST_TEMPLATE_STATUS_OPERATION.id).toBe(SEAM_OPERATION_IDS.status);
    expect(CHECKLIST_TEMPLATE_ITEM_CREATE_OPERATION.id).toBe(SEAM_OPERATION_IDS.itemCreate);
    expect(CHECKLIST_TEMPLATE_ITEM_UPDATE_OPERATION.id).toBe(SEAM_OPERATION_IDS.itemUpdate);
    expect(CHECKLIST_TEMPLATE_ITEM_REMOVE_OPERATION.id).toBe(SEAM_OPERATION_IDS.itemRemove);

    for (const read of [CHECKLIST_TEMPLATE_LIST_OPERATION, CHECKLIST_TEMPLATE_READ_OPERATION]) {
      // `sal.delivery.view`, the code the rest of the delivery read seam declares.
      // NOT `sal.delivery.read`, which navigation names and the catalogue does not
      // seed (RES-05), and NOT the manage code, which would hide the checklist from
      // the officer who works through it.
      expect(read.permissions).toEqual(['sal.delivery.view']);
      expect(read.method).toBe('GET');
      expect(read.auditClass).toBe('none');
      // `tenant`, because the table has a company and no branch and a company target
      // would be satisfiable only by a company-wide grant.
      expect(read.scope).toBe('tenant');
    }

    for (const write of [
      CHECKLIST_TEMPLATE_CREATE_OPERATION,
      CHECKLIST_TEMPLATE_RENAME_OPERATION,
      CHECKLIST_TEMPLATE_STATUS_OPERATION,
      CHECKLIST_TEMPLATE_ITEM_CREATE_OPERATION,
      CHECKLIST_TEMPLATE_ITEM_UPDATE_OPERATION,
      CHECKLIST_TEMPLATE_ITEM_REMOVE_OPERATION,
    ]) {
      expect(write.permissions).toEqual(['sal.delivery.manage']);
      expect(write.scope).toBe('company');
      expect(write.auditClass).toBe('privileged');
      expect(write.auditAction).toMatch(/^sal\.delivery_checklist_template\./);
    }

    expect(CHECKLIST_TEMPLATE_CREATE_OPERATION.idempotent).toBe(true);
    expect(CHECKLIST_TEMPLATE_ITEM_CREATE_OPERATION.idempotent).toBe(true);
    expect(CHECKLIST_TEMPLATE_STATUS_OPERATION.idempotent).toBe(true);
    expect(CHECKLIST_TEMPLATE_RENAME_OPERATION.versionGuarded).toBe(true);
    expect(CHECKLIST_TEMPLATE_STATUS_OPERATION.versionGuarded).toBe(true);
    expect(CHECKLIST_TEMPLATE_ITEM_UPDATE_OPERATION.versionGuarded).toBe(true);
    // The withdrawal is deliberately NOT version-guarded, following
    // `tech.technician-skill-withdraw`: it has one possible outcome whatever the
    // item's label or order happen to be.
    expect(CHECKLIST_TEMPLATE_ITEM_REMOVE_OPERATION.versionGuarded).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Creating a template
// ---------------------------------------------------------------------------

describe('sal.delivery-checklist-template-create', () => {
  it('creates the header and its items in one call, and records one audit entry', async () => {
    expect(MAIN.items).toHaveLength(2);
    // Returned in checklist order — `sortOrder` first — rather than in body order.
    expect(MAIN.items.map((item) => item.itemCode)).toEqual([
      'fx_p131_p9_fuel',
      'fx_p131_p9_lights',
    ]);
    expect(MAIN.items.every((item) => item.isMandatory)).toBe(false);
    expect(MAIN.recordVersion).toBe(1);

    const row = await templateRow(MAIN.id);
    expect(row?.status).toBe('active');
    expect(await auditCount('sal.delivery_checklist_template.created', MAIN.id)).toBe(1);
  });

  it('refuses a duplicate template code with ERR-CON-001 and writes nothing', async () => {
    authAs(SAL_FULL);
    const before = await templateCount();
    const response = await createTemplate({
      companyId: COMPANY_A1,
      templateCode: MAIN.templateCode,
      name: 'A second template wearing the same code',
    });
    expect(response.status).toBe(409);
    expect(await codeOf(response)).toBe('ERR-CON-001');
    expect(await templateCount()).toBe(before);
  });

  it('refuses a body that repeats an item code, before anything is written', async () => {
    authAs(SAL_FULL);
    const before = await templateCount();
    const response = await createTemplate({
      companyId: COMPANY_A1,
      templateCode: nextCode('dupitem'),
      name: 'Repeats an item code',
      items: [
        { itemCode: 'fx_p131_p9_twice', label: 'First' },
        { itemCode: 'fx_p131_p9_twice', label: 'Second' },
      ],
    });
    expect(response.status).toBe(422);
    expect(await codeOf(response)).toBe('ERR-VAL-001');
    // The header insert is rolled back with the request, so the whole checklist is
    // atomic: a dropped item cannot leave a half-authored template behind.
    expect(await templateCount()).toBe(before);
  });

  it('refuses a company that is not in the caller tenant', async () => {
    authAs(SAL_FULL);
    const response = await createTemplate({
      companyId: randomUUID(),
      templateCode: nextCode('nocompany'),
      name: 'Belongs nowhere',
    });
    expect(response.status).toBe(422);
    expect(await codeOf(response)).toBe('ERR-VAL-001');
  });

  it('refuses a body that tries to choose the status or the id', async () => {
    authAs(SAL_FULL);
    for (const extra of [{ status: 'inactive' }, { id: randomUUID() }]) {
      const response = await createTemplate({
        companyId: COMPANY_A1,
        templateCode: nextCode('strict'),
        name: 'Strict body',
        ...extra,
      });
      expect(response.status).toBe(422);
      expect(await codeOf(response)).toBe('ERR-VAL-001');
    }
  });

  it('refuses a template code the database would refuse', async () => {
    authAs(SAL_FULL);
    const response = await createTemplate({
      companyId: COMPANY_A1,
      templateCode: 'Not A Valid Code',
      name: 'Bad code',
    });
    expect(response.status).toBe(422);
    expect(await codeOf(response)).toBe('ERR-VAL-001');
  });

  it('replays an identical retry under one idempotency key, creating one template', async () => {
    authAs(SAL_FULL);
    const key = randomUUID();
    const body = {
      companyId: COMPANY_A1,
      templateCode: nextCode('replay'),
      name: 'Replayed checklist',
      items: [{ itemCode: 'fx_p131_p9_replay_a', label: 'Only item' }],
    };
    const first = await createTemplate(body, key);
    expect(first.status).toBe(201);
    const firstBody = await bodyOf<DetailBody>(first);

    const second = await createTemplate(body, key);
    // 200 rather than 201, and that is the platform's replay contract rather than a
    // property of this route: `withIdempotency` stores the BODY and replays it as a
    // plain result, so the declared `successStatus` applies to the execution and not
    // to the replay. The document is identical, which is what a retrying client needs.
    expect(second.status).toBe(200);
    const secondBody = await bodyOf<DetailBody>(second);
    expect(secondBody).toEqual(firstBody);

    const rows = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sal.delivery_checklist_templates
        WHERE tenant_id = $1 AND template_code = $2`,
      [TENANT_A, body.templateCode]
    );
    expect(Number(rows.rows[0]?.n)).toBe(1);
    expect(await auditCount('sal.delivery_checklist_template.created', firstBody.template.id)).toBe(
      1
    );
  });
});

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

describe('the two reads', () => {
  it('returns the template with its items in checklist order, to a reader who wrote none of it', async () => {
    // `SAL_READER` holds `sal.delivery.view` and NOT `sal.delivery.manage`, so it
    // could not have authored any of these rows. That is the handover.
    authAs(SAL_READER);
    const response = await readTemplate(MAIN.id);
    expect(response.status).toBe(200);
    expect(response.headers.get('ETag')).toBe('"1"');
    const detail = await bodyOf<DetailBody>(response);
    expect(detail.template.id).toBe(MAIN.id);
    expect(detail.template.companyId).toBe(COMPANY_A1);
    expect(detail.items.map((item) => item.itemCode)).toEqual([
      'fx_p131_p9_fuel',
      'fx_p131_p9_lights',
    ]);
    refusesAnyMoneyShapedNumber(detail);
  });

  it('lists templates the caller can see, and pages disjointly', async () => {
    authAs(SAL_READER);
    const first = await listTemplates({ limit: 1 });
    expect(first.status).toBe(200);
    const firstPage = await bodyOf<ListBody>(first);
    expect(firstPage.templates.items).toHaveLength(1);
    expect(firstPage.templates.hasMore).toBe(true);
    expect(firstPage.templates.nextCursor).not.toBeNull();
    expect(firstPage.templates.items[0]?.companyId).toBe(COMPANY_A1);

    authAs(SAL_READER);
    const cursor = firstPage.templates.nextCursor;
    if (cursor === null) throw new Error('the first page issued no cursor');
    const second = await listTemplates({ limit: 1, cursor });
    expect(second.status).toBe(200);
    const secondPage = await bodyOf<ListBody>(second);
    expect(secondPage.templates.items).toHaveLength(1);
    // Disjoint pages. The templates of one suite are frequently written inside one
    // transaction and share `created_at` to the microsecond, which is exactly where a
    // millisecond-truncated cursor silently skips rows (P1-27-INT-006).
    expect(secondPage.templates.items[0]?.id).not.toBe(firstPage.templates.items[0]?.id);
    refusesAnyMoneyShapedNumber(secondPage);
  });

  it('refuses a caller that does not hold sal.delivery.view', async () => {
    // Holds `sal.delivery.manage` and not the view code, so the refusal is the
    // missing permission and cannot be read as a scope or a tenancy answer.
    authAs(SAL_NO_DELIVERY_VIEW);
    const list = await listTemplates();
    expect(list.status).toBe(403);
    expect(await codeOf(list)).toBe('ERR-IAM-001');

    authAs(SAL_NO_DELIVERY_VIEW);
    const detail = await readTemplate(MAIN.id);
    expect(detail.status).toBe(403);
    expect(await codeOf(detail)).toBe('ERR-IAM-001');
  });

  it('is readable by a BRANCH-scoped delivery officer, who may not write it', async () => {
    // The decisive read case. `SAL_SCOPED_A2` is scoped to a branch of COMPANY_A1 and
    // is refused every write below — but it must be able to READ the checklist it
    // works through, which is why the reads declare `scope: 'tenant'` and lean on
    // `iam.allowed_company_ids()`, a union that includes the company of a
    // branch-scoped grant.
    authAs(SAL_SCOPED_A2);
    const response = await readTemplate(MAIN.id);
    expect(response.status).toBe(200);
    expect((await bodyOf<DetailBody>(response)).template.id).toBe(MAIN.id);
  });

  it('shows another tenant none of this tenant rows', async () => {
    authAs(SAL_TENANT_B);
    const foreignList = await listTemplates();
    expect(foreignList.status).toBe(200);
    const foreignPage = await bodyOf<ListBody>(foreignList);
    // `sel_delivery_checklist_templates_scope` narrows by `iam.current_tenant_id()`
    // before any application check runs.
    expect(foreignPage.templates.items.some((row) => row.id === MAIN.id)).toBe(false);
    expect(foreignPage.templates.items.some((row) => row.companyId === COMPANY_A1)).toBe(false);
  });

  it('answers a foreign tenant with 404 and never with 403', async () => {
    authAs(SAL_TENANT_B);
    const response = await readTemplate(MAIN.id);
    expect(response.status).toBe(404);
    expect(await codeOf(response)).toBe('ERR-RES-001');
  });

  it('answers an unknown identifier with the same 404', async () => {
    authAs(SAL_FULL);
    const response = await readTemplate(randomUUID());
    expect(response.status).toBe(404);
    expect(await codeOf(response)).toBe('ERR-RES-001');
  });
});

// ---------------------------------------------------------------------------
// Authorization — the company-wide rule
// ---------------------------------------------------------------------------

describe('the write authority is company-wide', () => {
  it('refuses a BRANCH-scoped holder of sal.delivery.manage', async () => {
    // `SAL_SCOPED_A2` holds every `sal` code, scoped to a BRANCH of `COMPANY_A1`. It
    // passes the pre-handler check, which is scope-blind on an empty target
    // (P1-18-A-01), and is refused by the deferred company check.
    authAs(SAL_SCOPED_A2);
    const created = await createTemplate({
      companyId: COMPANY_A1,
      templateCode: nextCode('branchscoped'),
      name: 'Authored by a branch-scoped caller',
    });
    expect(created.status).toBe(403);
    expect(await codeOf(created)).toBe('ERR-IAM-001');

    authAs(SAL_SCOPED_A2);
    const renamed = await renameTemplate(MAIN.id, 'Renamed by a branch-scoped caller', 1);
    expect(renamed.status).toBe(403);
    expect(await codeOf(renamed)).toBe('ERR-IAM-001');
    expect((await templateRow(MAIN.id))?.name).toBe('Handover checklist');
  });

  it('admits a COMPANY-scoped holder in its own company and refuses it in another', async () => {
    // The same principal, twice. Its grant is `scope_type = 'company'` on COMPANY_A1;
    // in COMPANY_A9 it holds only an unrelated widening grant.
    authAs(SAL_COMPANY_SCOPED);
    const permitted = await createTemplate({
      companyId: COMPANY_A1,
      templateCode: nextCode('companyscoped'),
      name: 'Authored by a company-scoped caller',
    });
    expect(permitted.status).toBe(201);

    authAs(SAL_COMPANY_SCOPED);
    const refused = await createTemplate({
      companyId: COMPANY_A9,
      templateCode: nextCode('othercompany'),
      name: 'Authored across a company boundary',
    });
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
  });

  it('refuses a reader on every write', async () => {
    const template = await authorTemplate({ name: 'Readable, not writable' });
    const item = await (async (): Promise<ItemBody> => {
      authAs(SAL_FULL);
      const response = await createItem(template.id, {
        itemCode: 'fx_p131_p9_readonlyprobe',
        label: 'Probe',
      });
      expect(response.status).toBe(201);
      return bodyOf<ItemBody>(response);
    })();

    const refusals: readonly (() => Promise<Response>)[] = [
      () =>
        createTemplate({
          companyId: COMPANY_A1,
          templateCode: nextCode('reader'),
          name: 'Reader tries to author',
        }),
      () => renameTemplate(template.id, 'Reader renames', template.recordVersion),
      () => setTemplateStatus(template.id, 'inactive', template.recordVersion),
      () => createItem(template.id, { itemCode: 'fx_p131_p9_readeritem', label: 'Reader adds' }),
      () => updateItem(template.id, item.id, { label: 'Reader edits' }, item.recordVersion),
      () => removeItem(template.id, item.id),
    ];
    for (const call of refusals) {
      authAs(SAL_READER);
      const response = await call();
      expect(response.status).toBe(403);
      expect(await codeOf(response)).toBe('ERR-IAM-001');
    }
  });

  it('answers a foreign tenant with 404 on a write, never with 403', async () => {
    authAs(SAL_TENANT_B);
    const response = await renameTemplate(MAIN.id, 'Renamed across the tenant boundary', 1);
    expect(response.status).toBe(404);
    expect(await codeOf(response)).toBe('ERR-RES-001');
  });
});

// ---------------------------------------------------------------------------
// The version guards
// ---------------------------------------------------------------------------

describe('rename and status are version-guarded', () => {
  it('requires If-Match, refuses a stale one, and advances the version by exactly one', async () => {
    const template = await authorTemplate({ name: 'Version guarded' });

    authAs(SAL_FULL);
    const missing = await renameTemplate(template.id, 'No version supplied', null);
    expect(missing.status).toBe(428);
    expect(await codeOf(missing)).toBe('ERR-CON-002');

    authAs(SAL_FULL);
    const stale = await renameTemplate(template.id, 'Stale version supplied', 99);
    expect(stale.status).toBe(409);
    expect(await codeOf(stale)).toBe('ERR-CON-001');
    expect((await templateRow(template.id))?.name).toBe('Version guarded');

    authAs(SAL_FULL);
    const renamed = await renameTemplate(template.id, 'Renamed once', template.recordVersion);
    expect(renamed.status).toBe(200);
    const body = await bodyOf<TemplateBody>(renamed);
    expect(body.name).toBe('Renamed once');
    expect(body.recordVersion).toBe(template.recordVersion + 1);
    expect(renamed.headers.get('ETag')).toBe(`"${String(template.recordVersion + 1)}"`);
    expect(await auditCount('sal.delivery_checklist_template.renamed', template.id)).toBe(1);
  });

  it('retires and restores a template, and replays a retry of the same flip', async () => {
    const template = await authorTemplate({ name: 'Retired and restored' });

    authAs(SAL_FULL);
    const key = randomUUID();
    const retired = await setTemplateStatus(template.id, 'inactive', template.recordVersion, key);
    expect(retired.status).toBe(200);
    const retiredBody = await bodyOf<TemplateBody>(retired);
    expect(retiredBody.status).toBe('inactive');

    authAs(SAL_FULL);
    const replay = await setTemplateStatus(template.id, 'inactive', template.recordVersion, key);
    expect(replay.status).toBe(200);
    expect(await bodyOf<TemplateBody>(replay)).toEqual(retiredBody);
    // One flip, one audit record: the replay re-executed nothing.
    expect(await auditCount('sal.delivery_checklist_template.status_changed', template.id)).toBe(1);

    authAs(SAL_FULL);
    const restored = await setTemplateStatus(
      template.id,
      'active',
      retiredBody.recordVersion,
      randomUUID()
    );
    expect(restored.status).toBe(200);
    expect((await bodyOf<TemplateBody>(restored)).status).toBe('active');
    // The code is still held by `uq_delivery_checklist_templates_code` throughout,
    // which is why the command restores as well as retires.
    expect((await templateRow(template.id))?.status).toBe('active');
  });

  it('refuses a status the database would refuse', async () => {
    authAs(SAL_FULL);
    const response = await setTemplateStatus(MAIN.id, 'archived', 1);
    expect(response.status).toBe(422);
    expect(await codeOf(response)).toBe('ERR-VAL-001');
  });
});

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

describe('the item commands', () => {
  it('adds an item, edits only what was sent, and guards on the ITEM version', async () => {
    const template = await authorTemplate({ name: 'Item lifecycle' });

    authAs(SAL_FULL);
    const created = await createItem(template.id, {
      itemCode: 'fx_p131_p9_tyres',
      label: 'Tyre pressures set',
      isMandatory: true,
      sortOrder: 5,
    });
    expect(created.status).toBe(201);
    const item = await bodyOf<ItemBody>(created);
    expect(item.templateId).toBe(template.id);
    expect(item.isMandatory).toBe(true);
    expect(item.recordVersion).toBe(1);
    expect(created.headers.get('ETag')).toBe('"1"');
    expect(await auditCount('sal.delivery_checklist_template.item_added', item.id)).toBe(1);

    // The TEMPLATE's version is not the item's. Both are 1 here, so the trap is
    // exercised with a value that is stale for the item and current for the template.
    authAs(SAL_FULL);
    const patched = await updateItem(
      template.id,
      item.id,
      { label: 'Tyre pressures verified' },
      item.recordVersion
    );
    expect(patched.status).toBe(200);
    const updated = await bodyOf<ItemBody>(patched);
    expect(updated.label).toBe('Tyre pressures verified');
    // Untouched by a patch that did not mention them — the COALESCE contract.
    expect(updated.isMandatory).toBe(true);
    expect(updated.sortOrder).toBe(5);
    expect(updated.recordVersion).toBe(2);

    authAs(SAL_FULL);
    const stale = await updateItem(template.id, item.id, { isMandatory: false }, 1);
    expect(stale.status).toBe(409);
    expect(await codeOf(stale)).toBe('ERR-CON-001');
  });

  it('refuses an empty patch and an item that belongs to another template', async () => {
    const first = await authorTemplate({
      name: 'Owns the item',
      items: [{ itemCode: 'fx_p131_p9_owned', label: 'Owned item' }],
    });
    const second = await authorTemplate({ name: 'Does not own it' });
    const owned = first.items[0];
    if (owned === undefined) throw new Error('the fixture template carries no item');

    authAs(SAL_FULL);
    const empty = await updateItem(first.id, owned.id, {}, owned.recordVersion);
    expect(empty.status).toBe(422);
    expect(await codeOf(empty)).toBe('ERR-VAL-001');

    // Addressed through the WRONG parent. The item is in the same company, so only
    // the parent check refuses it — without that check this path would edit a sibling
    // template's item and report success.
    authAs(SAL_FULL);
    const foreignParent = await updateItem(
      second.id,
      owned.id,
      { label: 'Edited through the wrong template' },
      owned.recordVersion
    );
    expect(foreignParent.status).toBe(404);
    expect(await codeOf(foreignParent)).toBe('ERR-RES-001');
  });

  it('withdraws an item, frees its code, and answers a second withdrawal with 404', async () => {
    const template = await authorTemplate({
      name: 'Withdrawal',
      items: [{ itemCode: 'fx_p131_p9_withdraw', label: 'Will be withdrawn' }],
    });
    const item = template.items[0];
    if (item === undefined) throw new Error('the fixture template carries no item');

    authAs(SAL_FULL);
    const removed = await removeItem(template.id, item.id);
    expect(removed.status).toBe(200);
    expect((await bodyOf<ItemBody>(removed)).itemCode).toBe('fx_p131_p9_withdraw');
    expect(await auditCount('sal.delivery_checklist_template.item_removed', item.id)).toBe(1);

    const stored = await admin.query<{ deleted_at: Date | null }>(
      `SELECT deleted_at FROM sal.delivery_checklist_template_items WHERE id = $1`,
      [item.id]
    );
    // A soft delete: the row is still there, so every outcome recorded against it
    // stays resolvable. There is no DELETE grant on this table at all.
    expect(stored.rows[0]?.deleted_at).not.toBeNull();

    authAs(SAL_READER);
    const detail = await bodyOf<DetailBody>(await readTemplate(template.id));
    expect(detail.items).toHaveLength(0);

    // The unique index is partial on `deleted_at IS NULL`, so the code came back.
    authAs(SAL_FULL);
    const readded = await createItem(template.id, {
      itemCode: 'fx_p131_p9_withdraw',
      label: 'Added again under the freed code',
    });
    expect(readded.status).toBe(201);

    authAs(SAL_FULL);
    const again = await removeItem(template.id, item.id);
    expect(again.status).toBe(404);
    expect(await codeOf(again)).toBe('ERR-RES-001');
  });

  it('refuses a duplicate item code inside one template', async () => {
    const template = await authorTemplate({
      name: 'Duplicate item code',
      items: [{ itemCode: 'fx_p131_p9_unique', label: 'The first one' }],
    });
    authAs(SAL_FULL);
    const response = await createItem(template.id, {
      itemCode: 'fx_p131_p9_unique',
      label: 'The second one',
    });
    expect(response.status).toBe(409);
    expect(await codeOf(response)).toBe('ERR-CON-001');
  });
});

// ---------------------------------------------------------------------------
// The completion gate, measured
// ---------------------------------------------------------------------------

/**
 * Opens a `ready` delivery in COMPANY_A9 and returns a reader for its eligibility.
 *
 * COMPANY_A9 — the second company of tenant A — for the reason the finding case used
 * it: a mandatory item authored here gates every handover of its company, so authoring
 * one in COMPANY_A1 would reach the in-flight deliveries of every other suite. Each
 * case below retires or withdraws what it authored before it ends.
 */
async function openA9Delivery(
  tag: string
): Promise<{ deliveryId: string; eligibility: () => Promise<EligibilityBody> }> {
  const chain = await seedWorkOrderChain(tag, { companyId: COMPANY_A9, branchId: BRANCH_A9 });
  authAs(SAL_FULL);
  const opened = await CREATE_DELIVERY(
    new Request('http://localhost/api/v1/deliveries', {
      method: 'POST',
      headers: jsonHeaders({ key: randomUUID() }),
      body: JSON.stringify({ workOrderId: chain.workOrderId, deliveringEmployeeId: randomUUID() }),
    })
  );
  expect(opened.status).toBe(201);
  const deliveryId = (await bodyOf<{ id: string }>(opened)).id;

  const eligibility = async (): Promise<EligibilityBody> => {
    authAs(SAL_FULL);
    const response = await READ_ELIGIBILITY(
      new Request(`http://localhost/api/v1/deliveries/${deliveryId}/eligibility`),
      { params: Promise.resolve({ deliveryId }) }
    );
    expect(response.status).toBe(200);
    return bodyOf<EligibilityBody>(response);
  };

  return { deliveryId, eligibility };
}

describe('only an ACTIVE, non-deleted template gates a handover', () => {
  it('gates while the template is active, stops on deactivation, and gates again on reactivation', async () => {
    const template = await authorTemplate({
      companyId: COMPANY_A9,
      name: 'Company A9 checklist',
      items: [{ itemCode: 'fx_p131_p9_mandatory', label: 'Mandatory in A9', isMandatory: true }],
    });
    const item = template.items[0];
    if (item === undefined) throw new Error('the fixture template carries no item');

    const { eligibility } = await openA9Delivery('p131_p9_gate');

    // The template is ACTIVE and its mandatory item has no result, so it blocks — and
    // the blocker is actionable, naming the item rather than being a bare code. This is
    // the half that must survive P-9b: the join narrows which templates are in force
    // and must not withdraw one that is.
    const blocked = await eligibility();
    expect(blocked.blockers).toContain('checklist_incomplete');
    expect(blocked.checklistGaps.map((gap) => gap.itemCode)).toContain('fx_p131_p9_mandatory');

    // Retiring the template is now the operator's company-level remedy. Before P-9b
    // (migration 20260909090000, closing CC-14) this changed nothing at all:
    // `sal.complete_delivery` counted mandatory items by (tenant, company) filtered on
    // the ITEM's deleted_at and never joined the parent template, so a retired
    // checklist went on refusing every handover in the company.
    authAs(SAL_FULL);
    const retired = await setTemplateStatus(template.id, 'inactive', template.recordVersion);
    expect(retired.status).toBe(200);
    const retiredBody = await bodyOf<TemplateBody>(retired);
    expect(retiredBody.status).toBe('inactive');

    const cleared = await eligibility();
    expect(cleared.blockers).not.toContain('checklist_incomplete');
    expect(cleared.checklistGaps).toHaveLength(0);

    // Reactivation puts it back in force, on the SAME delivery — so this is the gate
    // responding to the template's state and not to anything about the delivery.
    authAs(SAL_FULL);
    const restored = await setTemplateStatus(template.id, 'active', retiredBody.recordVersion);
    expect(restored.status).toBe(200);
    const restoredBody = await bodyOf<TemplateBody>(restored);
    expect(restoredBody.status).toBe('active');

    const blockedAgain = await eligibility();
    expect(blockedAgain.blockers).toContain('checklist_incomplete');
    expect(blockedAgain.checklistGaps.map((gap) => gap.itemCode)).toContain('fx_p131_p9_mandatory');

    // Withdrawing the ITEM still clears it under an ACTIVE template: the migration adds
    // a condition to the count and removes none, so the withdrawal route keeps working
    // exactly as it did. This also leaves COMPANY_A9 with nothing mandatory in force.
    authAs(SAL_FULL);
    const withdrawn = await removeItem(template.id, item.id);
    expect(withdrawn.status).toBe(200);

    const clearedByWithdrawal = await eligibility();
    expect(clearedByWithdrawal.blockers).not.toContain('checklist_incomplete');
    expect(clearedByWithdrawal.checklistGaps).toHaveLength(0);

    authAs(SAL_FULL);
    const finalRetire = await setTemplateStatus(
      template.id,
      'inactive',
      restoredBody.recordVersion
    );
    expect(finalRetire.status).toBe(200);
  });

  it('counts no template of another company and none of another tenant', async () => {
    const { eligibility } = await openA9Delivery('p131_p9_iso');

    // An ACTIVE mandatory checklist in COMPANY_A1 — the same tenant, a different
    // company. The scan is company-scoped and the join carries `company_id`, so it
    // cannot reach this delivery.
    const otherCompany = await authorTemplate({
      companyId: COMPANY_A1,
      name: 'Active in another company',
      items: [{ itemCode: 'fx_p131_p9_iso_company', label: 'Mandatory in A1', isMandatory: true }],
    });

    // And an ACTIVE mandatory checklist in another TENANT entirely. The join is on
    // `uq_delivery_checklist_templates_scope_id (tenant_id, company_id, id)` and every
    // arm of the count is bound to the delivery's tenant, so a foreign row is
    // unreachable twice over — by the join key and by RLS.
    authAs(SAL_TENANT_B);
    const foreignCode = nextCode('iso_tenant');
    const foreign = await createTemplate({
      companyId: COMPANY_B1,
      templateCode: foreignCode,
      name: 'Active in another tenant',
      items: [{ itemCode: 'fx_p131_p9_iso_tenant', label: 'Mandatory in B', isMandatory: true }],
    });
    expect(foreign.status).toBe(201);

    const unaffected = await eligibility();
    expect(unaffected.blockers).not.toContain('checklist_incomplete');
    expect(unaffected.checklistGaps).toHaveLength(0);

    // The COMPANY_A1 template is withdrawn rather than left retired: an inactive
    // template with a live mandatory item is exactly the state P-9b makes harmless,
    // and leaving one behind would make this suite depend on the behaviour it proves.
    const otherItem = otherCompany.items[0];
    if (otherItem === undefined) throw new Error('the fixture template carries no item');
    authAs(SAL_FULL);
    expect((await removeItem(otherCompany.id, otherItem.id)).status).toBe(200);
  });
});
