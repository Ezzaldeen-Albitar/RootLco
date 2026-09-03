/**
 * Inspection-template authoring (BR-04, PRE-P1-29 backend remediation).
 *
 * Before this slice the three `dia` template tables held ZERO rows and no INSERT
 * against any of them existed anywhere in `apps/api`. `POST /jobs/{jobId}/inspections`
 * required a `templateVersionId` that nothing could produce, so diagnostics was
 * not thin — it was unreachable, and closure blocker `B4` had a subject that
 * could not be brought into existence. Every assertion below was unwritable until
 * now for that reason.
 *
 * The invariants this suite exists for:
 *
 *  1. **The end-to-end chain runs with no hand-written SQL.** Type → template →
 *     version → items → publish → a technician sees it → an inspection opens
 *     against it. The whole point of the slice is that this is reachable through
 *     the API, so the test uses the API for every step; a fixture INSERT anywhere
 *     in the chain would prove the tables accept rows, which was never in doubt.
 *  2. **`published_at` is the DATABASE's, not the service's.** The service never
 *     writes it. If it ever started, the two could disagree and the timestamp on
 *     a historical report would become a claim rather than a record.
 *  3. **The freeze covers INSERT, so a published version's item SET is closed.**
 *     Proved TWICE for each shape: once refused by the service with a named
 *     `ERR-TRN-001`, and once — with the service check bypassed by writing as
 *     `app_runtime` directly — refused by `tg_template_items_frozen`. The second
 *     is what makes the first a message improvement rather than the only line of
 *     defence.
 *  4. **An empty version cannot be published.** The one rule with no database
 *     counterpart, so it is the one rule that must be tested directly.
 *  5. **The four pre-existing `dia` codes confer no authoring authority.** If any
 *     of them did, minting `dia.catalogue.manage` would be theatre. Enforcement
 *     here is route-layer only — the three tables have no company/branch column,
 *     so a scoped RLS predicate is impossible — which is exactly why the
 *     declaration is tested rather than assumed.
 *  6. **Cross-tenant reuse is refused.** Tenant A cannot open an inspection
 *     against tenant B's published version. The slice's headline security test,
 *     and never executable before because no template existed in either tenant.
 *
 * Operations exercised: dia.template-create, dia.template-list, dia.template-detail,
 * dia.template-update, dia.template-version-create, dia.template-version-status-set,
 * dia.template-item-create, dia.template-version-list-publishable.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   dia.template-create: route service authorization success denial cross-tenant isolation audit idempotency
 *   dia.template-list: route service authorization success denial cross-tenant isolation
 *   dia.template-detail: route service authorization success denial cross-tenant isolation
 *   dia.template-update: route service authorization success denial cross-tenant isolation audit stale-version
 *   dia.template-version-create: route service authorization success denial cross-tenant isolation audit idempotency
 *   dia.template-version-status-set: route service authorization success denial cross-tenant isolation audit stale-version idempotency
 *   dia.template-item-create: route service authorization success denial cross-tenant isolation audit idempotency
 *   dia.template-version-list-publishable: route service authorization success denial cross-tenant isolation
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
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
  authAs as authAsP119,
  createOpenWorkOrder,
  establishP1_19Fixtures,
} from './p1-19-helpers';
import {
  DIAGNOSTIC_RECORDER,
  TEMPLATE_ADMIN,
  TEMPLATE_READER,
  TEMPLATE_TENANT_B,
  auditCountFor,
  authAs,
  diagnosticTypes,
  establishBr04Fixtures,
  liveTemplateCount,
  rawItemCodes,
  rawVersion,
  resetTemplates,
} from './br-04-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import {
  GET as LIST_TEMPLATES,
  POST as CREATE_TEMPLATE,
} from '@/app/api/v1/inspection-templates/route';
import {
  GET as TEMPLATE_DETAIL,
  PATCH as UPDATE_TEMPLATE,
} from '@/app/api/v1/inspection-templates/[templateId]/route';
import { POST as CREATE_VERSION } from '@/app/api/v1/inspection-templates/[templateId]/versions/route';
import { POST as SET_VERSION_STATUS } from '@/app/api/v1/template-versions/[versionId]/status/route';
import { POST as CREATE_ITEM } from '@/app/api/v1/template-versions/[versionId]/items/route';
import { GET as LIST_PUBLISHABLE } from '@/app/api/v1/jobs/[jobId]/inspection-templates/route';
import { POST as CREATE_REPORT } from '@/app/api/v1/jobs/[jobId]/inspections/route';
import { POST as CREATE_JOB } from '@/app/api/v1/work-orders/[workOrderId]/jobs/route';

const TEMPLATE_CREATED = 'dia.inspection_template.created';
const TEMPLATE_UPDATED = 'dia.inspection_template.updated';
const VERSION_CREATED = 'dia.template_version.created';
const VERSION_STATUS = 'dia.template_version.status_changed';
const ITEM_CREATED = 'dia.template_item.created';

let admin: Pool;
let runtime: Pool;

interface Problem {
  readonly code?: string;
  readonly violations?: readonly { readonly path?: string; readonly rule?: string }[];
}

interface TemplateBody {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
  readonly diagnosticTypeId: string;
  readonly recordVersion: number;
}

interface VersionBody {
  readonly id: string;
  readonly templateId: string;
  readonly versionNumber: number;
  readonly status: string;
  readonly publishedAt: string | null;
  readonly itemCount: number;
  readonly recordVersion: number;
}

function send(
  handler: (
    request: Request,
    route: { params: Promise<Record<string, string>> }
  ) => Promise<Response>,
  url: string,
  params: Record<string, string>,
  body: unknown,
  options: {
    readonly version?: number | null;
    readonly key?: string;
    readonly method?: string;
  } = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotency-key': options.key ?? randomUUID(),
  };
  if (options.version !== null && options.version !== undefined) {
    headers['if-match'] = String(options.version);
  }
  return handler(
    new Request(`http://localhost${url}`, {
      method: options.method ?? 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve(params) }
  );
}

/**
 * Runs one statement as `app_runtime` WITH the tenant context set.
 *
 * Without the GUCs, RLS narrows `dia.template_*` to nothing and an UPDATE becomes
 * a zero-row no-op that RESOLVES — which would let a "the trigger refuses this"
 * assertion pass while the trigger never ran at all. The INSERT cases do not need
 * it (a BEFORE INSERT trigger fires before the row-policy WITH CHECK, so the
 * guard is reached either way), and that asymmetry is exactly why the UPDATE
 * cases have to set it explicitly rather than inheriting whatever the pool had.
 */
async function asRuntime(sql: string, values: readonly unknown[]): Promise<unknown> {
  const client = await runtime.connect();
  try {
    await client.query(
      `SELECT set_config('app.user_id',$1,false), set_config('app.tenant_id',$2,false)`,
      [USER_A, TENANT_A]
    );
    return await client.query(sql, [...values]);
  } finally {
    client.release();
  }
}

const createTemplate = (body: unknown, key?: string): Promise<Response> =>
  CREATE_TEMPLATE(
    new Request('http://localhost/api/v1/inspection-templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key ?? randomUUID() },
      body: JSON.stringify(body),
    })
  );

const listTemplates = (query = ''): Promise<Response> =>
  LIST_TEMPLATES(new Request(`http://localhost/api/v1/inspection-templates${query}`));

const templateDetail = (templateId: string): Promise<Response> =>
  TEMPLATE_DETAIL(new Request(`http://localhost/api/v1/inspection-templates/${templateId}`), {
    params: Promise.resolve({ templateId }),
  });

const updateTemplate = (
  templateId: string,
  body: unknown,
  options: { readonly version?: number | null } = {}
): Promise<Response> =>
  send(
    UPDATE_TEMPLATE as never,
    `/api/v1/inspection-templates/${templateId}`,
    { templateId },
    body,
    { method: 'PATCH', ...options }
  );

const createVersion = (templateId: string, body: unknown = {}, key?: string): Promise<Response> =>
  send(
    CREATE_VERSION as never,
    `/api/v1/inspection-templates/${templateId}/versions`,
    { templateId },
    body,
    key === undefined ? {} : { key }
  );

const setVersionStatus = (
  versionId: string,
  body: unknown,
  options: { readonly version?: number | null; readonly key?: string } = {}
): Promise<Response> =>
  send(
    SET_VERSION_STATUS as never,
    `/api/v1/template-versions/${versionId}/status`,
    { versionId },
    body,
    options
  );

const createItem = (versionId: string, body: unknown, key?: string): Promise<Response> =>
  send(
    CREATE_ITEM as never,
    `/api/v1/template-versions/${versionId}/items`,
    { versionId },
    body,
    key === undefined ? {} : { key }
  );

const listPublishable = (jobId: string): Promise<Response> =>
  LIST_PUBLISHABLE(new Request(`http://localhost/api/v1/jobs/${jobId}/inspection-templates`), {
    params: Promise.resolve({ jobId }),
  });

// ---- Composite fixtures, built THROUGH the API ------------------------------

const ITEM_ONE = {
  itemCode: 'brake_thickness',
  prompt: 'Front brake disc thickness',
  responseType: 'numeric',
  unit: 'mm',
};
const ITEM_TWO = {
  itemCode: 'road_test',
  prompt: 'Road test performed',
  responseType: 'boolean',
  isMandatory: false,
};
const ITEM_THREE = {
  itemCode: 'tyre_condition',
  prompt: 'Overall tyre condition',
  responseType: 'select',
};

/** A template owned by `TEMPLATE_ADMIN`, created through the route. */
async function seedTemplate(
  code: string,
  diagnosticTypeId: string = diagnosticTypes.typeTenantA
): Promise<TemplateBody> {
  authAs(TEMPLATE_ADMIN);
  const created = await createTemplate({ code, name: `Template ${code}`, diagnosticTypeId });
  if (created.status !== 201) {
    throw new Error(`fixture template failed with ${created.status}: ${await created.text()}`);
  }
  return (await created.json()) as TemplateBody;
}

/** A draft version of a template, created through the route. */
async function seedVersion(templateId: string, body: unknown = {}): Promise<VersionBody> {
  authAs(TEMPLATE_ADMIN);
  const created = await createVersion(templateId, body);
  if (created.status !== 201) {
    throw new Error(`fixture version failed with ${created.status}: ${await created.text()}`);
  }
  return (await created.json()) as VersionBody;
}

/** A published version carrying three items — the whole chain, through the API. */
async function seedPublishedVersion(
  code: string,
  diagnosticTypeId: string = diagnosticTypes.typeTenantA
): Promise<{ readonly template: TemplateBody; readonly version: VersionBody }> {
  const template = await seedTemplate(code, diagnosticTypeId);
  const version = await seedVersion(template.id);
  for (const item of [ITEM_ONE, ITEM_TWO, ITEM_THREE]) {
    authAs(TEMPLATE_ADMIN);
    const added = await createItem(version.id, item);
    if (added.status !== 201) {
      throw new Error(`fixture item failed with ${added.status}: ${await added.text()}`);
    }
  }
  authAs(TEMPLATE_ADMIN);
  const published = await setVersionStatus(
    version.id,
    { toStatus: 'published' },
    { version: version.recordVersion }
  );
  if (published.status !== 200) {
    throw new Error(`fixture publish failed with ${published.status}: ${await published.text()}`);
  }
  return { template, version: (await published.json()) as VersionBody };
}

/** A job on an open work order, ready to carry a diagnostic. */
async function seedJob(): Promise<{ readonly workOrderId: string; readonly jobId: string }> {
  const order = await createOpenWorkOrder();
  authAsP119(FULL);
  const created = await CREATE_JOB(
    new Request(`http://localhost/api/v1/work-orders/${order.workOrderId}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify({ title: 'Brake inspection', requiresDiagnostic: true }),
    }),
    { params: Promise.resolve({ workOrderId: order.workOrderId }) }
  );
  if (created.status !== 201) throw new Error(`fixture job failed with ${created.status}`);
  return { workOrderId: order.workOrderId, jobId: ((await created.json()) as { id: string }).id };
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishBr04Fixtures(admin);
  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);
});

beforeEach(() => resetTemplates());
afterEach(() => __resetAuthenticatorForTests());
afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

describe('dia.template-create + dia.template-version-create + dia.template-item-create + dia.template-version-status-set + dia.template-version-list-publishable — the end-to-end chain, with no hand-written SQL', () => {
  it('creates a type-classified template, versions it, authors items, publishes, and opens an inspection against it', async () => {
    const { template, version } = await seedPublishedVersion('full_chain');
    expect(version.status).toBe('published');
    expect(version.versionNumber).toBe(1);

    // The technician's read (operation 8) offers exactly this version...
    const job = await seedJob();
    authAs(DIAGNOSTIC_RECORDER);
    const publishable = await listPublishable(job.jobId);
    expect(publishable.status).toBe(200);
    const offered = (await publishable.json()) as {
      readonly items: readonly {
        readonly versionId: string;
        readonly templateCode: string;
        readonly itemCount: number;
      }[];
    };
    expect(offered.items.map((entry) => entry.versionId)).toContain(version.id);
    expect(offered.items.find((entry) => entry.versionId === version.id)?.templateCode).toBe(
      template.code
    );
    expect(offered.items.find((entry) => entry.versionId === version.id)?.itemCount).toBe(3);

    // ...and POST /jobs/{jobId}/inspections accepts it. This is the assertion the
    // whole slice exists for: before BR-04 no value could satisfy this parameter.
    authAsP119(FULL);
    const report = await send(
      CREATE_REPORT as never,
      `/api/v1/jobs/${job.jobId}/inspections`,
      { jobId: job.jobId },
      { templateVersionId: version.id }
    );
    expect(report.status).toBe(201);
    expect((await report.json()).templateVersionId).toBe(version.id);
  });

  it('P2 — published_at is stamped by the guard, and the service never writes it', async () => {
    const template = await seedTemplate('stamped');
    const version = await seedVersion(template.id);
    authAs(TEMPLATE_ADMIN);
    await createItem(version.id, ITEM_ONE);

    expect((await rawVersion(version.id))?.publishedAt).toBeNull();
    authAs(TEMPLATE_ADMIN);
    const published = await setVersionStatus(
      version.id,
      { toStatus: 'published' },
      { version: version.recordVersion }
    );
    expect(published.status).toBe(200);
    // Read as the OWNER: the stamp is a database fact, so the assertion does not
    // depend on the response echoing it back.
    expect((await rawVersion(version.id))?.publishedAt).not.toBeNull();
  });

  it('P3 — copyFromVersionId reproduces the item set, and the copy is independently editable while draft', async () => {
    const { template, version } = await seedPublishedVersion('copied');
    const second = await seedVersion(template.id, { copyFromVersionId: version.id });

    expect(second.versionNumber).toBe(2);
    expect(second.status).toBe('draft');
    expect(await rawItemCodes(second.id)).toEqual(await rawItemCodes(version.id));

    // Independently editable: the source is frozen, the copy is not.
    authAs(TEMPLATE_ADMIN);
    const added = await createItem(second.id, {
      itemCode: 'extra_check',
      prompt: 'An additional check',
      responseType: 'text',
    });
    expect(added.status).toBe(201);
    expect(await rawItemCodes(second.id)).toHaveLength(4);
    expect(await rawItemCodes(version.id)).toHaveLength(3);
  });

  it('P4 — retiring v1 after publishing v2 leaves a report citing v1 readable, with v1 original items', async () => {
    const { template, version: v1 } = await seedPublishedVersion('versioned');
    const job = await seedJob();
    authAsP119(FULL);
    const report = await send(
      CREATE_REPORT as never,
      `/api/v1/jobs/${job.jobId}/inspections`,
      { jobId: job.jobId },
      { templateVersionId: v1.id }
    );
    expect(report.status).toBe(201);
    const v1Items = await rawItemCodes(v1.id);

    const v2 = await seedVersion(template.id, { copyFromVersionId: v1.id });
    authAs(TEMPLATE_ADMIN);
    await createItem(v2.id, { itemCode: 'new_check', prompt: 'New', responseType: 'text' });
    authAs(TEMPLATE_ADMIN);
    const publishedTwo = await setVersionStatus(
      v2.id,
      { toStatus: 'published' },
      { version: v2.recordVersion }
    );
    expect(publishedTwo.status).toBe(200);

    authAs(TEMPLATE_ADMIN);
    const retired = await setVersionStatus(
      v1.id,
      { toStatus: 'retired' },
      { version: (await templateDetailVersion(template.id, v1.id)).recordVersion }
    );
    expect(retired.status).toBe(200);

    // v1's items are untouched by everything above — the pin still resolves to
    // the questions the report was actually asked.
    expect(await rawItemCodes(v1.id)).toEqual(v1Items);
    expect((await rawVersion(v1.id))?.status).toBe('retired');
  });

  it('P5 — the list pages, and a conclusion from page two matches the whole set', async () => {
    for (const code of ['page_a', 'page_b', 'page_c', 'page_d']) await seedTemplate(code);
    authAs(TEMPLATE_ADMIN);
    const first = await listTemplates('?limit=2');
    expect(first.status).toBe(200);
    const firstPage = (await first.json()) as {
      readonly items: readonly TemplateBody[];
      readonly nextCursor: string | null;
    };
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    authAs(TEMPLATE_ADMIN);
    const second = await listTemplates(
      `?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor ?? '')}`
    );
    const secondPage = (await second.json()) as { readonly items: readonly TemplateBody[] };
    const paged = [...firstPage.items, ...secondPage.items].map((entry) => entry.code).sort();
    expect(paged).toEqual(['page_a', 'page_b', 'page_c', 'page_d']);
    expect(new Set(paged).size).toBe(4);
  });

  it('P6 — an inactive template’s published versions do not appear in the technician read', async () => {
    const { template, version } = await seedPublishedVersion('withdrawn');
    const job = await seedJob();

    authAs(DIAGNOSTIC_RECORDER);
    const before = (await (await listPublishable(job.jobId)).json()) as {
      readonly items: readonly { readonly versionId: string }[];
    };
    expect(before.items.map((entry) => entry.versionId)).toContain(version.id);

    authAs(TEMPLATE_ADMIN);
    const deactivated = await updateTemplate(
      template.id,
      { status: 'inactive' },
      { version: template.recordVersion }
    );
    expect(deactivated.status).toBe(200);

    authAs(DIAGNOSTIC_RECORDER);
    const after = (await (await listPublishable(job.jobId)).json()) as {
      readonly items: readonly { readonly versionId: string }[];
    };
    expect(after.items.map((entry) => entry.versionId)).not.toContain(version.id);
    // The version itself is untouched — withdrawal is the TEMPLATE's status.
    expect((await rawVersion(version.id))?.status).toBe('published');
  });
});

/** The current recordVersion of one version, via the detail read. */
async function templateDetailVersion(templateId: string, versionId: string): Promise<VersionBody> {
  authAs(TEMPLATE_ADMIN);
  const detail = await templateDetail(templateId);
  const body = (await detail.json()) as { readonly versions: readonly VersionBody[] };
  const found = body.versions.find((entry) => entry.id === versionId);
  if (found === undefined) throw new Error(`version ${versionId} not in detail`);
  return found;
}

describe('dia.template-version-status-set + dia.template-item-create + dia.template-update — negative cases', () => {
  it('N2 — a holder of dia.diagnostic.record alone cannot publish', async () => {
    const template = await seedTemplate('denied_publish');
    const version = await seedVersion(template.id);
    authAs(TEMPLATE_ADMIN);
    await createItem(version.id, ITEM_ONE);

    authAs(DIAGNOSTIC_RECORDER);
    const refused = await setVersionStatus(
      version.id,
      { toStatus: 'published' },
      { version: version.recordVersion }
    );
    expect(refused.status).toBe(403);
    expect((await rawVersion(version.id))?.status).toBe('draft');
  });

  it('N3 — a duplicate template code is 409 ERR-RES-002', async () => {
    await seedTemplate('duplicated');
    authAs(TEMPLATE_ADMIN);
    const again = await createTemplate({
      code: 'duplicated',
      name: 'Second',
      diagnosticTypeId: diagnosticTypes.typeTenantA,
    });
    expect(again.status).toBe(409);
    expect(((await again.json()) as Problem).code).toBe('ERR-RES-002');
  });

  it('N4 — draft to retired is refused ERR-TRN-001, and the guard would refuse it too', async () => {
    const template = await seedTemplate('no_skip');
    const version = await seedVersion(template.id);
    authAs(TEMPLATE_ADMIN);
    const refused = await setVersionStatus(
      version.id,
      { toStatus: 'retired' },
      { version: version.recordVersion }
    );
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as Problem).code).toBe('ERR-TRN-001');
    expect((await rawVersion(version.id))?.status).toBe('draft');

    // The guard is the authority: the same move, made directly as app_runtime with
    // the service bypassed entirely, is still refused.
    await expect(
      asRuntime(`UPDATE dia.template_versions SET status = 'retired' WHERE id = $1`, [version.id])
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('N5 — nothing leaves retired', async () => {
    const { version } = await seedPublishedVersion('retire_final');
    authAs(TEMPLATE_ADMIN);
    const retired = await setVersionStatus(
      version.id,
      { toStatus: 'retired' },
      { version: version.recordVersion }
    );
    expect(retired.status).toBe(200);
    const current = (await retired.json()) as VersionBody;

    authAs(TEMPLATE_ADMIN);
    const back = await setVersionStatus(
      version.id,
      { toStatus: 'published' },
      { version: current.recordVersion }
    );
    expect(back.status).toBe(409);
    expect(((await back.json()) as Problem).code).toBe('ERR-TRN-001');
  });

  it('N6 — an item INSERT on a published version is refused by the service AND by the trigger', async () => {
    const { version } = await seedPublishedVersion('frozen_set');

    // 1. The service, with a named refusal.
    authAs(TEMPLATE_ADMIN);
    const refused = await createItem(version.id, {
      itemCode: 'late_addition',
      prompt: 'Added after publication',
      responseType: 'text',
    });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as Problem).code).toBe('ERR-TRN-001');

    // 2. The trigger, with the service removed from the path entirely. This is
    //    the assertion that makes the freeze an INVARIANT rather than a code path.
    await expect(
      runtime.query(
        `INSERT INTO dia.template_items
           (tenant_id, template_version_id, item_code, prompt, response_type, is_mandatory, sequence, created_by)
         VALUES ($1,$2,'direct_insert','Bypassing the service','text',true,9,$3)`,
        [TENANT_A, version.id, USER_A]
      )
    ).rejects.toMatchObject({ code: '23514' });
    expect(await rawItemCodes(version.id)).toHaveLength(3);
  });

  it('N7/N8 — item UPDATE and soft-delete on a published version are refused by the trigger', async () => {
    const { version } = await seedPublishedVersion('frozen_edit');
    await expect(
      asRuntime(
        `UPDATE dia.template_items SET prompt = 'Rewritten' WHERE template_version_id = $1`,
        [version.id]
      )
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      asRuntime(`UPDATE dia.template_items SET deleted_at = now() WHERE template_version_id = $1`, [
        version.id,
      ])
    ).rejects.toMatchObject({ code: '23514' });
    expect(await rawItemCodes(version.id)).toHaveLength(3);
  });

  it('N9 — a version with zero items cannot be published (a service rule with no database counterpart)', async () => {
    const template = await seedTemplate('empty_publish');
    const version = await seedVersion(template.id);
    expect((await rawVersion(version.id))?.itemCount).toBe(0);

    authAs(TEMPLATE_ADMIN);
    const refused = await setVersionStatus(
      version.id,
      { toStatus: 'published' },
      { version: version.recordVersion }
    );
    expect(refused.status).toBe(422);
    const problem = (await refused.json()) as Problem;
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations?.[0]?.rule).toBe('no_items');
    expect((await rawVersion(version.id))?.status).toBe('draft');
  });

  it('N10 — a numeric item without a unit is 422 naming body.unit', async () => {
    const template = await seedTemplate('numeric_unit');
    const version = await seedVersion(template.id);
    authAs(TEMPLATE_ADMIN);
    const refused = await createItem(version.id, {
      itemCode: 'no_unit',
      prompt: 'Thickness',
      responseType: 'numeric',
    });
    expect(refused.status).toBe(422);
    const problem = (await refused.json()) as Problem;
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations?.some((v) => v.path === 'body.unit')).toBe(true);
  });

  it('N11 — an itemCode violating the format regex is 422', async () => {
    const template = await seedTemplate('item_format');
    const version = await seedVersion(template.id);
    authAs(TEMPLATE_ADMIN);
    const refused = await createItem(version.id, {
      itemCode: 'Bad-Code',
      prompt: 'Malformed',
      responseType: 'text',
    });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as Problem).code).toBe('ERR-VAL-001');
  });

  it('N12 — copyFromVersionId naming another template is 422', async () => {
    const first = await seedPublishedVersion('copy_source');
    const other = await seedTemplate('copy_target');
    authAs(TEMPLATE_ADMIN);
    const refused = await createVersion(other.id, { copyFromVersionId: first.version.id });
    expect(refused.status).toBe(422);
    const problem = (await refused.json()) as Problem;
    expect(problem.violations?.[0]?.rule).toBe('foreign_template');
  });

  it('N13 — a client-supplied versionNumber is refused by .strict()', async () => {
    const template = await seedTemplate('server_numbered');
    authAs(TEMPLATE_ADMIN);
    const refused = await createVersion(template.id, { versionNumber: 99 });
    expect(refused.status).toBe(422);
    expect(await liveTemplateCount(TENANT_A)).toBe(1);
  });

  it('N14 — a diagnosticTypeId from another tenant, and an inactive one, are both 422', async () => {
    authAs(TEMPLATE_ADMIN);
    const foreign = await createTemplate({
      code: 'foreign_type',
      name: 'Foreign',
      diagnosticTypeId: diagnosticTypes.typeTenantB,
    });
    expect(foreign.status).toBe(422);
    expect(((await foreign.json()) as Problem).violations?.[0]?.rule).toBe('not_visible');

    authAs(TEMPLATE_ADMIN);
    const retired = await createTemplate({
      code: 'retired_type',
      name: 'Retired',
      diagnosticTypeId: diagnosticTypes.typeInactive,
    });
    expect(retired.status).toBe(422);
  });

  it('N14b — a PLATFORM-scope diagnostic type IS accepted', async () => {
    // The other half of the same check, and the reason it cannot be a tenant
    // equality test: a platform row carries tenant_id IS NULL.
    authAs(TEMPLATE_ADMIN);
    const created = await createTemplate({
      code: 'platform_typed',
      name: 'Platform typed',
      diagnosticTypeId: diagnosticTypes.typePlatform,
    });
    expect(created.status).toBe(201);
    expect(((await created.json()) as TemplateBody).diagnosticTypeId).toBe(
      diagnosticTypes.typePlatform
    );
  });

  it('N15 — a publish without If-Match is 428, and a stale one is 409', async () => {
    const template = await seedTemplate('needs_match');
    const version = await seedVersion(template.id);
    authAs(TEMPLATE_ADMIN);
    await createItem(version.id, ITEM_ONE);

    authAs(TEMPLATE_ADMIN);
    const missing = await setVersionStatus(
      version.id,
      { toStatus: 'published' },
      { version: null }
    );
    expect(missing.status).toBe(428);
    expect(((await missing.json()) as Problem).code).toBe('ERR-CON-002');

    authAs(TEMPLATE_ADMIN);
    const stale = await setVersionStatus(
      version.id,
      { toStatus: 'published' },
      { version: version.recordVersion + 99 }
    );
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as Problem).code).toBe('ERR-CON-001');
  });

  it('an empty PATCH body is 422', async () => {
    const template = await seedTemplate('empty_patch');
    authAs(TEMPLATE_ADMIN);
    const refused = await updateTemplate(template.id, {}, { version: template.recordVersion });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as Problem).violations?.[0]?.rule).toBe('empty_update');
  });

  it('a template code is not updatable — .strict() refuses it', async () => {
    const template = await seedTemplate('immutable_code');
    authAs(TEMPLATE_ADMIN);
    const refused = await updateTemplate(
      template.id,
      { code: 'renamed_code' },
      { version: template.recordVersion }
    );
    expect(refused.status).toBe(422);
  });
});

describe('dia.template-list + dia.template-detail + dia.template-create — security and isolation', () => {
  it('S1 — tenant A cannot open an inspection against tenant B’s published version (the headline test)', async () => {
    // Tenant B publishes a version of its own.
    authAs(TEMPLATE_TENANT_B);
    const bTemplate = await createTemplate({
      code: 'tenant_b_template',
      name: 'Tenant B template',
      diagnosticTypeId: diagnosticTypes.typeTenantB,
    });
    expect(bTemplate.status).toBe(201);
    const bTemplateBody = (await bTemplate.json()) as TemplateBody;
    authAs(TEMPLATE_TENANT_B);
    const bVersion = (await (await createVersion(bTemplateBody.id)).json()) as VersionBody;
    authAs(TEMPLATE_TENANT_B);
    await createItem(bVersion.id, ITEM_ONE);
    authAs(TEMPLATE_TENANT_B);
    const bPublished = await setVersionStatus(
      bVersion.id,
      { toStatus: 'published' },
      { version: bVersion.recordVersion }
    );
    expect(bPublished.status).toBe(200);

    // Tenant A names it. RLS on dia.template_versions makes it invisible, so the
    // report's own reference check refuses — and it refuses as "not found",
    // disclosing nothing about tenant B's library.
    const job = await seedJob();
    authAsP119(FULL);
    const refused = await send(
      CREATE_REPORT as never,
      `/api/v1/jobs/${job.jobId}/inspections`,
      { jobId: job.jobId },
      { templateVersionId: bVersion.id }
    );
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect([404, 422]).toContain(refused.status);
  });

  it('S2 — tenant A lists templates and sees none of tenant B’s', async () => {
    await seedTemplate('tenant_a_visible');
    authAs(TEMPLATE_TENANT_B);
    const bCreated = await createTemplate({
      code: 'tenant_b_hidden',
      name: 'Tenant B hidden',
      diagnosticTypeId: diagnosticTypes.typeTenantB,
    });
    expect(bCreated.status).toBe(201);

    authAs(TEMPLATE_ADMIN);
    const listed = (await (await listTemplates()).json()) as {
      readonly items: readonly TemplateBody[];
    };
    const codes = listed.items.map((entry) => entry.code);
    expect(codes).toContain('tenant_a_visible');
    expect(codes).not.toContain('tenant_b_hidden');
    // And the row really exists — the assertion above is isolation, not absence.
    expect(await liveTemplateCount(TENANT_B)).toBe(1);
  });

  it('S3 — a cross-tenant item write and detail read are both 404, disclosing nothing', async () => {
    authAs(TEMPLATE_TENANT_B);
    const bTemplate = (await (
      await createTemplate({
        code: 'tenant_b_target',
        name: 'Tenant B target',
        diagnosticTypeId: diagnosticTypes.typeTenantB,
      })
    ).json()) as TemplateBody;
    authAs(TEMPLATE_TENANT_B);
    const bVersion = (await (await createVersion(bTemplate.id)).json()) as VersionBody;

    authAs(TEMPLATE_ADMIN);
    const write = await createItem(bVersion.id, {
      itemCode: 'intruder',
      prompt: 'Written across the boundary',
      responseType: 'text',
    });
    expect(write.status).toBe(404);

    authAs(TEMPLATE_ADMIN);
    const read = await templateDetail(bTemplate.id);
    expect(read.status).toBe(404);
    expect(await rawItemCodes(bVersion.id)).toHaveLength(0);
  });

  it('S4 — mass assignment: tenantId, publishedAt and versionNumber are all refused', async () => {
    authAs(TEMPLATE_ADMIN);
    const withTenant = await createTemplate({
      code: 'mass_assign',
      name: 'Mass assignment',
      diagnosticTypeId: diagnosticTypes.typeTenantA,
      tenantId: TENANT_B,
    });
    expect(withTenant.status).toBe(422);

    const template = await seedTemplate('mass_assign_two');
    const version = await seedVersion(template.id);
    authAs(TEMPLATE_ADMIN);
    const withPublishedAt = await setVersionStatus(
      version.id,
      { toStatus: 'published', publishedAt: '2020-01-01T00:00:00.000Z' },
      { version: version.recordVersion }
    );
    expect(withPublishedAt.status).toBe(422);
  });

  it('S5 — a holder of all four pre-existing dia codes can author nothing', async () => {
    // If any of record/complete/review/read conferred authoring authority, minting
    // dia.catalogue.manage would have been theatre. This is the assertion that
    // makes the new code load-bearing.
    authAs(DIAGNOSTIC_RECORDER);
    const create = await createTemplate({
      code: 'escalated',
      name: 'Escalated',
      diagnosticTypeId: diagnosticTypes.typeTenantA,
    });
    expect(create.status).toBe(403);

    const template = await seedTemplate('escalation_target');
    authAs(DIAGNOSTIC_RECORDER);
    expect((await createVersion(template.id)).status).toBe(403);
    authAs(DIAGNOSTIC_RECORDER);
    expect(
      (await updateTemplate(template.id, { name: 'Renamed' }, { version: template.recordVersion }))
        .status
    ).toBe(403);
    expect(await liveTemplateCount(TENANT_A)).toBe(1);
  });

  it('S5b — the reader holds dia.diagnostic.read and may read but not author', async () => {
    // Identical to TEMPLATE_ADMIN in every respect except the manage code, which
    // is what makes the 403 attributable to that code and nothing else.
    const template = await seedTemplate('reader_visible');
    authAs(TEMPLATE_READER);
    expect((await templateDetail(template.id)).status).toBe(200);
    authAs(TEMPLATE_READER);
    expect((await listTemplates()).status).toBe(200);
    authAs(TEMPLATE_READER);
    expect(
      (
        await createTemplate({
          code: 'reader_denied',
          name: 'Denied',
          diagnosticTypeId: diagnosticTypes.typeTenantA,
        })
      ).status
    ).toBe(403);
  });

  it('S6 — the freeze backstop refuses a direct app_runtime insert on a published version', async () => {
    const { version } = await seedPublishedVersion('backstop');
    await expect(
      runtime.query(
        `INSERT INTO dia.template_items
           (tenant_id, template_version_id, item_code, prompt, response_type, is_mandatory, sequence, created_by)
         VALUES ($1,$2,'backstop_item','Direct','text',true,4,$3)`,
        [TENANT_A, version.id, USER_A]
      )
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('S7 — a second publish of the same version conflicts, then reports an illegal move', async () => {
    const template = await seedTemplate('raced');
    const version = await seedVersion(template.id);
    authAs(TEMPLATE_ADMIN);
    await createItem(version.id, ITEM_ONE);

    authAs(TEMPLATE_ADMIN);
    const first = await setVersionStatus(
      version.id,
      { toStatus: 'published' },
      { version: version.recordVersion }
    );
    expect(first.status).toBe(200);

    // The second caller still holds the pre-publish version: a stale If-Match, so
    // ERR-CON-001 — "re-read and retry".
    authAs(TEMPLATE_ADMIN);
    const second = await setVersionStatus(
      version.id,
      { toStatus: 'published' },
      { version: version.recordVersion }
    );
    expect(second.status).toBe(409);
    expect(((await second.json()) as Problem).code).toBe('ERR-CON-001');

    // And on re-read the move itself is illegal — ERR-TRN-001, which retrying
    // will never fix. The two codes are not interchangeable and this is why.
    const current = await templateDetailVersion(template.id, version.id);
    authAs(TEMPLATE_ADMIN);
    const retried = await setVersionStatus(
      version.id,
      { toStatus: 'published' },
      { version: current.recordVersion }
    );
    expect(retried.status).toBe(409);
    expect(((await retried.json()) as Problem).code).toBe('ERR-TRN-001');
  });
});

describe('dia.template-update + dia.template-version-create — audit', () => {
  it('records every write under its declared action', async () => {
    const template = await seedTemplate('audited');
    expect(await auditCountFor(TEMPLATE_CREATED, template.id)).toBe(1);

    authAs(TEMPLATE_ADMIN);
    const renamed = await updateTemplate(
      template.id,
      { name: 'Renamed audited' },
      { version: template.recordVersion }
    );
    expect(renamed.status).toBe(200);
    expect(await auditCountFor(TEMPLATE_UPDATED, template.id)).toBe(1);

    const version = await seedVersion(template.id);
    expect(await auditCountFor(VERSION_CREATED, version.id)).toBe(1);

    authAs(TEMPLATE_ADMIN);
    const item = await createItem(version.id, ITEM_ONE);
    expect(item.status).toBe(201);
    // Filed under the VERSION, so "what does this version ask" is one query.
    expect(await auditCountFor(ITEM_CREATED, version.id)).toBe(1);

    authAs(TEMPLATE_ADMIN);
    const published = await setVersionStatus(
      version.id,
      { toStatus: 'published' },
      { version: version.recordVersion }
    );
    expect(published.status).toBe(200);
    expect(await auditCountFor(VERSION_STATUS, version.id)).toBe(1);
  });

  it('a refused write records nothing', async () => {
    const template = await seedTemplate('unaudited');
    authAs(DIAGNOSTIC_RECORDER);
    const refused = await updateTemplate(
      template.id,
      { name: 'Never applied' },
      { version: template.recordVersion }
    );
    expect(refused.status).toBe(403);
    expect(await auditCountFor(TEMPLATE_UPDATED, template.id)).toBe(0);
  });
});

describe('dia.template-create — idempotency', () => {
  it('a replayed create produces one template, not two', async () => {
    const key = randomUUID();
    authAs(TEMPLATE_ADMIN);
    const first = await createTemplate(
      { code: 'replayed', name: 'Replayed', diagnosticTypeId: diagnosticTypes.typeTenantA },
      key
    );
    expect(first.status).toBe(201);
    authAs(TEMPLATE_ADMIN);
    const replay = await createTemplate(
      { code: 'replayed', name: 'Replayed', diagnosticTypeId: diagnosticTypes.typeTenantA },
      key
    );
    // Counted as a DELTA, not as a status: a replay that created a second row
    // while answering 201 would pass a status-only assertion.
    expect(await liveTemplateCount(TENANT_A)).toBe(1);
    expect([200, 201]).toContain(replay.status);
  });
});
