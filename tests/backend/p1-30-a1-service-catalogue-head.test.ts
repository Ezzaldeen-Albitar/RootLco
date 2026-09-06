/**
 * P1-30 A1 — the service-catalogue dependency head (seams S-02, S-03, S-04).
 *
 * The A0 preflight measured a commercial chain that could not be started through
 * the product at all: `svc.service_categories`, `svc.service_versions` and
 * `svc.price_list_assignments` had NO in-product writer, so on a tenant created
 * through the API there was no category to file a service under, no draft to
 * publish, and no assignment for `svc.resolve_price` to find. `GET /prices`
 * answered `ERR-VAL-001` for every input, and every quotation line was refused.
 *
 * The load-bearing fact this suite exists to prove is the last one: **a quotation
 * line requires a sellable service**, and A1 is what makes a service sellable.
 * The chain test at the bottom is therefore not a convenience — it is the only
 * assertion that proves the seam actually closed, and it is written as the whole
 * four-operation chain because no single operation closes it alone.
 *
 * ## Why the price-list-assignment conflict has its own describe block
 *
 * `uq_price_list_assignments_signature` keys on
 * `(tenant_id, company_id, branch_id, customer_class, priority)` and NOT on
 * `price_list_id`. Two different books therefore cannot both claim one context at
 * one priority — which means a create can be refused by a row the caller cannot
 * see. That is the reason the route is the top-level `/price-list-assignments`,
 * and the test proves the refusal happens ACROSS price lists and that the message
 * does not pretend the conflict is scoped to the one in the request.
 *
 * ## Why `svc.service-version-create` sends no If-Match
 *
 * It is `versionGuarded: false`. Creating a draft does not mutate the service and
 * there is no prior version of the created thing to guard. The test that sends no
 * `If-Match` and expects 201 is what pins that decision: were the flag flipped,
 * the route would answer `ERR-CON-002` and that test would go red.
 *
 * ## Falsifiability, and one honest negative result
 *
 * Each proof class was checked by breaking the fact it rests on and requiring the
 * test to go red:
 *
 *  - removing the tenant-wide authority check from `svc.service-category-create`
 *    -> "requires the permission TENANT-WIDE" goes RED;
 *  - restoring `versionGuarded: true` on `svc.service-version-create`
 *    -> "creates a DRAFT with NO If-Match" goes RED;
 *  - removing the wildcard tenant-wide guard from the assignment route
 *    -> "refuses a wildcard assignment from a branch-scoped holder" goes RED.
 *
 * The fourth did NOT behave that way, and the result is recorded rather than
 * dressed up. Neutralising the `tenant_id` predicate in `listServiceCategories`
 * leaves the cross-tenant test GREEN: `sel_service_categories_tenant` absorbs it.
 * (A first attempt appeared to go red, but only because the mutated SQL failed
 * type inference - a red for the wrong reason, which is not evidence of anything.)
 *
 * So the cross-tenant case here proves that isolation HOLDS; it does not prove
 * which layer holds it. RLS is the guarantee, and the application predicate is
 * intent and index shape - exactly what the repository's own header claims, now
 * measured rather than asserted.
 *
 * Operations exercised here: svc.service-category-list, svc.service-category-create,
 * svc.service-version-create, svc.price-list-assignment-create.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   svc.service-category-list: route service authorization success denial cross-tenant
 *   svc.service-category-create: route service authorization success denial cross-tenant audit idempotency
 *   svc.service-version-create: route service authorization success denial cross-tenant audit idempotency
 *   svc.price-list-assignment-create: route service authorization success denial cross-tenant audit idempotency isolation
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  BRANCH_A1,
  COMPANY_A1,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { BRANCH_A2, establishP1_19Fixtures } from './p1-19-helpers';
import {
  BRANCH_A2_OF_COMPANY_A2,
  CATEGORY_A,
  COMPANY_A2,
  SERVICE_A,
  SERVICE_A_ARCHIVED,
  SERVICE_B,
  SVC_CATALOG_MANAGER,
  SVC_CATALOG_SCOPED_A2,
  SVC_CATALOG_TENANT_B,
  SVC_FULL,
  SVC_PRICE_SCOPED_A2,
  SVC_READER,
  SVC_TENANT_B_FULL,
  SVC_UNPERMITTED,
  auditCountFor,
  authAs,
  establishP1_20Fixtures,
  priceListVersionOf,
  serviceRecordVersionOf,
} from './p1-20-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import {
  GET as CATEGORY_LIST,
  POST as CATEGORY_CREATE,
} from '@/app/api/v1/service-categories/route';
import { POST as VERSION_CREATE } from '@/app/api/v1/services/[serviceId]/versions/route';
import { POST as ASSIGNMENT_CREATE } from '@/app/api/v1/price-list-assignments/route';
import { POST as PRICE_LIST_CREATE } from '@/app/api/v1/price-lists/route';
import { POST as SERVICE_CREATE } from '@/app/api/v1/services/route';
import { POST as SERVICE_VERSION_PUBLISH } from '@/app/api/v1/services/[serviceId]/versions/[versionId]/publication/route';
import { POST as PRICE_LIST_VERSION_CREATE } from '@/app/api/v1/price-lists/[priceListId]/versions/route';
import { POST as PRICE_RULE_RECORD } from '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/rules/route';
import { POST as PRICE_LIST_PUBLISH } from '@/app/api/v1/price-lists/[priceListId]/versions/[versionId]/publication/route';
import { GET as PRICE_RESOLVE } from '@/app/api/v1/prices/route';

let admin: Pool;
let runtime: Pool;

const codeOf = async (response: Response): Promise<string> =>
  ((await response.json()) as { code: string }).code;

let codeSeq = 0;
/** Lower-snake, unique per call — `ck_service_categories_code_format`. */
const nextCategoryCode = (): string => `a1_cat_${Date.now().toString(36)}_${(codeSeq += 1)}`;
const nextListCode = (): string => `A1PL-${Date.now().toString(36)}-${(codeSeq += 1)}`;

function listCategories(query: Record<string, string> = {}): Promise<Response> {
  const url = new URL('http://localhost/api/v1/service-categories');
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return CATEGORY_LIST(new Request(url));
}

function createCategory(body: unknown, key: string = crypto.randomUUID()): Promise<Response> {
  return CATEGORY_CREATE(
    new Request('http://localhost/api/v1/service-categories', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    })
  );
}

/** No `If-Match` header anywhere: the operation is deliberately not version-guarded. */
function createVersion(
  serviceId: string,
  body: unknown,
  key: string = crypto.randomUUID()
): Promise<Response> {
  return VERSION_CREATE(
    new Request(`http://localhost/api/v1/services/${serviceId}/versions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ serviceId }) }
  );
}

function createAssignment(body: unknown, key: string = crypto.randomUUID()): Promise<Response> {
  return ASSIGNMENT_CREATE(
    new Request('http://localhost/api/v1/price-list-assignments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    })
  );
}

async function createPriceList(): Promise<string> {
  const response = await PRICE_LIST_CREATE(
    new Request('http://localhost/api/v1/price-lists', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({
        priceListCode: nextListCode(),
        name: 'A1 fixture book',
        currency: 'JOD',
      }),
    })
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

interface CategoryItem {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly parentCategoryId: string | null;
  readonly sortOrder: number | null;
  readonly status: string;
  readonly recordVersion: number;
}
interface CategoryPage {
  readonly items: readonly CategoryItem[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

const pageOf = async (response: Response): Promise<CategoryPage> =>
  (await response.json()) as CategoryPage;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_20Fixtures(admin);
  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);
});

afterEach(() => __resetAuthenticatorForTests());
afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

// ---------------------------------------------------------------------------
// S-02 read half
// ---------------------------------------------------------------------------

describe('svc.service-category-list', () => {
  it('401 unauthenticated, 403 without svc.service.read', async () => {
    __resetAuthenticatorForTests();
    expect((await listCategories()).status).toBe(401);

    authAs(SVC_UNPERMITTED);
    const refused = await listCategories();
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
  });

  it('serves the tenant taxonomy to a holder of svc.service.read', async () => {
    authAs(SVC_FULL);
    const response = await listCategories();
    expect(response.status).toBe(200);
    const body = await pageOf(response);
    expect(body.items.map((c) => c.id)).toContain(CATEGORY_A);
  });

  it('projects status, and carries no money field of any kind', async () => {
    authAs(SVC_FULL);
    const body = await pageOf(await listCategories());
    const found = body.items.find((c) => c.id === CATEGORY_A);
    expect(found).toBeDefined();
    // `status` must be published: svc.service-create refuses an inactive category,
    // so a picker that cannot see it offers choices the next call rejects.
    expect(found?.status).toBe('active');
    // `sortOrder` is `integer`. It is a NUMBER or null, never a decimal string —
    // the table has no `numeric` column, so the money rule has nothing to bite on.
    expect(['number', 'object']).toContain(typeof found?.sortOrder);
    const raw = JSON.stringify(found);
    for (const forbidden of ['amount', 'price', 'currency', 'unitPrice']) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it('is cross-tenant isolated: tenant B sees none of tenant A taxonomy', async () => {
    authAs(SVC_CATALOG_TENANT_B);
    const response = await listCategories();
    expect(response.status).toBe(200);
    const found = (await pageOf(response)).items.map((c) => c.id);
    expect(found).not.toContain(CATEGORY_A);
  });

  it('refuses an unknown query parameter and an out-of-bounds limit', async () => {
    authAs(SVC_FULL);
    const unknown = await listCategories({ categoryId: CATEGORY_A });
    expect(unknown.status).toBe(422);
    expect(await codeOf(unknown)).toBe('ERR-VAL-001');

    const tooLarge = await listCategories({ limit: '101' });
    expect(tooLarge.status).toBe(422);
    expect(await codeOf(tooLarge)).toBe('ERR-VAL-001');
  });

  it('pages by keyset, and the cursor it issues is accepted', async () => {
    authAs(SVC_CATALOG_MANAGER);
    // Two more categories so a one-row page certainly has a successor.
    for (let i = 0; i < 2; i += 1) {
      expect((await createCategory({ code: nextCategoryCode(), name: `Page ${i}` })).status).toBe(
        201
      );
    }
    authAs(SVC_FULL);
    const first = await pageOf(await listCategories({ limit: '1' }));
    expect(first.items).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    const second = await pageOf(
      await listCategories({ limit: '1', cursor: String(first.nextCursor) })
    );
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });
});

// ---------------------------------------------------------------------------
// S-02 write half
// ---------------------------------------------------------------------------

describe('svc.service-category-create', () => {
  it('401 unauthenticated, and 403 for a caller holding only svc.service.read', async () => {
    __resetAuthenticatorForTests();
    expect((await createCategory({ code: nextCategoryCode(), name: 'x' })).status).toBe(401);

    authAs(SVC_READER);
    const refused = await createCategory({ code: nextCategoryCode(), name: 'x' });
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
  });

  it('creates an active category, audits it, and the read surface then shows it', async () => {
    authAs(SVC_CATALOG_MANAGER);
    const code = nextCategoryCode();
    const response = await createCategory({ code, name: 'Brake service', sortOrder: 10 });
    expect(response.status).toBe(201);
    const created = (await response.json()) as CategoryItem;
    expect(created.code).toBe(code);
    expect(created.status).toBe('active');
    expect(created.sortOrder).toBe(10);
    expect(created.recordVersion).toBe(1);
    expect(await auditCountFor('svc.service_category.updated', created.id)).toBe(1);

    // The write reached the same table the list is served from.
    authAs(SVC_FULL);
    const found = (await pageOf(await listCategories({ limit: '100' }))).items.map((c) => c.id);
    expect(found).toContain(created.id);
  });

  it('is cross-tenant bound: a category created in tenant B never appears in tenant A', async () => {
    // SVC_CATALOG_TENANT_B holds svc.service.manage UNRESTRICTED, in tenant B. That is
    // what makes this a tenant proof rather than a permission proof: the write
    // succeeds, so nothing was refused, and the row still cannot cross.
    authAs(SVC_CATALOG_TENANT_B);
    const code = nextCategoryCode();
    const response = await createCategory({ code, name: 'Tenant B category' });
    expect(response.status).toBe(201);
    const foreign = (await response.json()) as CategoryItem;

    authAs(SVC_FULL);
    const visible = (await pageOf(await listCategories({ limit: '100' }))).items;
    expect(visible.map((c) => c.id)).not.toContain(foreign.id);
    expect(visible.map((c) => c.code)).not.toContain(code);
  });

  it('requires the permission TENANT-WIDE, not merely held somewhere', async () => {
    // SVC_CATALOG_SCOPED_A2 holds svc.service.manage IN FULL, through a branch-scoped
    // grant. A refusal that discriminates between two principals holding the same
    // permission is the only kind that says anything about scope.
    authAs(SVC_CATALOG_SCOPED_A2);
    const refused = await createCategory({ code: nextCategoryCode(), name: 'Scoped' });
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');

    authAs(SVC_CATALOG_MANAGER);
    expect((await createCategory({ code: nextCategoryCode(), name: 'Unrestricted' })).status).toBe(
      201
    );
  });

  it('refuses a duplicate code as a conflict, not a 500', async () => {
    authAs(SVC_CATALOG_MANAGER);
    const code = nextCategoryCode();
    expect((await createCategory({ code, name: 'First' })).status).toBe(201);
    const duplicate = await createCategory({ code, name: 'Second' });
    expect(duplicate.status).toBe(409);
    expect(await codeOf(duplicate)).toBe('ERR-CON-001');
  });

  it('refuses an unknown parent, a malformed code, and any field it does not accept', async () => {
    authAs(SVC_CATALOG_MANAGER);
    const unknownParent = await createCategory({
      code: nextCategoryCode(),
      name: 'Orphan',
      parentCategoryId: '00000000-0000-4000-8000-0000000000ff',
    });
    expect(unknownParent.status).toBe(422);
    expect(await codeOf(unknownParent)).toBe('ERR-VAL-001');

    // Upper case is refused: the category code is the LOWER-snake internal form,
    // unlike the mixed-case external `service_code`.
    const malformed = await createCategory({ code: 'Brake_Service', name: 'x' });
    expect(malformed.status).toBe(422);

    // `.strict()` — a caller must not be able to create an inactive category, which
    // is one nothing may be filed under.
    const extra = await createCategory({ code: nextCategoryCode(), name: 'x', status: 'inactive' });
    expect(extra.status).toBe(422);
  });

  it('accepts a parent that exists, and nests under it', async () => {
    authAs(SVC_CATALOG_MANAGER);
    const parent = (await (
      await createCategory({ code: nextCategoryCode(), name: 'Parent' })
    ).json()) as CategoryItem;
    const child = await createCategory({
      code: nextCategoryCode(),
      name: 'Child',
      parentCategoryId: parent.id,
    });
    expect(child.status).toBe(201);
    expect(((await child.json()) as CategoryItem).parentCategoryId).toBe(parent.id);
  });

  it('replays an idempotent create without inserting twice', async () => {
    authAs(SVC_CATALOG_MANAGER);
    const key = crypto.randomUUID();
    const body = { code: nextCategoryCode(), name: 'Replayed' };
    const first = await createCategory(body, key);
    expect(first.status).toBe(201);
    const created = (await first.json()) as CategoryItem;

    const replay = await createCategory(body, key);
    // The replay is reconstructed from the stored body, which carries no status —
    // the handler default applies, so 200 rather than 201 (P1-20-A-10).
    expect([200, 201]).toContain(replay.status);
    expect(((await replay.json()) as CategoryItem).id).toBe(created.id);
    expect(await auditCountFor('svc.service_category.updated', created.id)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// S-03
// ---------------------------------------------------------------------------

describe('svc.service-version-create', () => {
  it('401 unauthenticated, and 403 for a caller holding only svc.service.read', async () => {
    __resetAuthenticatorForTests();
    expect((await createVersion(SERVICE_A, { effectiveFrom: '2031-01-01' })).status).toBe(401);

    authAs(SVC_READER);
    const refused = await createVersion(SERVICE_A, { effectiveFrom: '2031-01-01' });
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
  });

  it('creates a DRAFT with NO If-Match — the operation is not version-guarded', async () => {
    authAs(SVC_CATALOG_MANAGER);
    // `createVersion` sends no `If-Match`. Were `versionGuarded: true` restored, the
    // route would answer ERR-CON-002 here and this assertion would fail. That is the
    // point of the case.
    const response = await createVersion(SERVICE_A, {
      effectiveFrom: '2031-01-01',
      notes: 'A1 draft',
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as {
      id: string;
      status: string;
      versionNo: number;
      effectiveFrom: string;
    };
    expect(created.status).toBe('draft');
    expect(created.versionNo).toBeGreaterThan(0);
    expect(created.effectiveFrom).toBe('2031-01-01');
    expect(await auditCountFor('svc.service_version.drafted', created.id)).toBe(1);
  });

  it('numbers versions forward, and lets drafts overlap freely', async () => {
    authAs(SVC_CATALOG_MANAGER);
    const first = (await (
      await createVersion(SERVICE_A, { effectiveFrom: '2032-01-01' })
    ).json()) as { versionNo: number };
    // The SAME effective date again: the gist EXCLUDE is `WHERE status = 'published'`,
    // so two drafts may overlap. If this 409s, the exclusion has been widened.
    const second = await createVersion(SERVICE_A, { effectiveFrom: '2032-01-01' });
    expect(second.status).toBe(201);
    expect(((await second.json()) as { versionNo: number }).versionNo).toBe(first.versionNo + 1);
  });

  it('refuses an archived service, an inverted range, and an unknown service', async () => {
    authAs(SVC_CATALOG_MANAGER);
    const archived = await createVersion(SERVICE_A_ARCHIVED, { effectiveFrom: '2031-01-01' });
    expect(archived.status).toBe(409);
    expect(await codeOf(archived)).toBe('ERR-TRN-001');

    const inverted = await createVersion(SERVICE_A, {
      effectiveFrom: '2031-06-01',
      effectiveTo: '2031-01-01',
    });
    expect(inverted.status).toBe(422);
    expect(await codeOf(inverted)).toBe('ERR-VAL-001');

    const unknown = await createVersion('00000000-0000-4000-8000-0000000000ff', {
      effectiveFrom: '2031-01-01',
    });
    expect(unknown.status).toBe(404);
    expect(await codeOf(unknown)).toBe('ERR-RES-001');
  });

  it('is cross-tenant isolated: a tenant-B service is not visible to tenant A', async () => {
    authAs(SVC_CATALOG_MANAGER);
    const foreign = await createVersion(SERVICE_B, { effectiveFrom: '2031-01-01' });
    expect(foreign.status).toBe(404);
    expect(await codeOf(foreign)).toBe('ERR-RES-001');
  });

  it('requires the permission TENANT-WIDE', async () => {
    authAs(SVC_CATALOG_SCOPED_A2);
    const refused = await createVersion(SERVICE_A, { effectiveFrom: '2033-01-01' });
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
  });

  it('replays an idempotent create without inserting twice', async () => {
    authAs(SVC_CATALOG_MANAGER);
    const key = crypto.randomUUID();
    const body = { effectiveFrom: '2034-01-01' };
    const first = await createVersion(SERVICE_A, body, key);
    expect(first.status).toBe(201);
    const created = (await first.json()) as { id: string };
    const replay = await createVersion(SERVICE_A, body, key);
    expect([200, 201]).toContain(replay.status);
    expect(((await replay.json()) as { id: string }).id).toBe(created.id);
    expect(await auditCountFor('svc.service_version.drafted', created.id)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// S-04
// ---------------------------------------------------------------------------

describe('svc.price-list-assignment-create', () => {
  it('401 unauthenticated, and 403 without svc.price.manage', async () => {
    __resetAuthenticatorForTests();
    expect(
      (
        await createAssignment({
          priceListId: '00000000-0000-4000-8000-000000000001',
          effectiveFrom: '2031-01-01',
        })
      ).status
    ).toBe(401);

    authAs(SVC_READER);
    const refused = await createAssignment({
      priceListId: '00000000-0000-4000-8000-000000000001',
      effectiveFrom: '2031-01-01',
    });
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
  });

  it('assigns a price list to a company/branch context and audits it', async () => {
    authAs(SVC_FULL);
    const priceListId = await createPriceList();
    const response = await createAssignment({
      priceListId,
      companyId: COMPANY_A2,
      branchId: BRANCH_A2_OF_COMPANY_A2,
      priority: 5,
      effectiveFrom: '2031-01-01',
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as {
      id: string;
      priceListId: string;
      priority: number;
      status: string;
    };
    expect(created.priceListId).toBe(priceListId);
    expect(created.priority).toBe(5);
    expect(created.status).toBe('active');
    expect(await auditCountFor('svc.price_list_assignment.created', created.id)).toBe(1);
  });

  it('THE CONFLICT CROSSES PRICE LISTS — and the message does not pretend otherwise', async () => {
    authAs(SVC_FULL);
    const bookOne = await createPriceList();
    const bookTwo = await createPriceList();
    const context = {
      companyId: COMPANY_A2,
      branchId: BRANCH_A2_OF_COMPANY_A2,
      priority: 77,
      effectiveFrom: '2031-01-01',
    };

    expect((await createAssignment({ priceListId: bookOne, ...context })).status).toBe(201);

    // A DIFFERENT price list, the same context and priority. The unique index does not
    // include price_list_id, so this must be refused — and the caller has no route
    // that would let them see the row that refused it.
    const collision = await createAssignment({ priceListId: bookTwo, ...context });
    expect(collision.status).toBe(409);
    const body = (await collision.json()) as {
      code: string;
      violations?: readonly { path: string; rule: string }[];
    };
    expect(body.code).toBe('ERR-CON-001');

    /**
     * The refusal must be understandable even though the book differs — and the
     * channel that carries it to a caller is `violations`, NOT a message.
     * `problemFor` builds the response from the error CATALOG (`type`, `title`,
     * `status`, `code`, `correlationId`) plus `safeDetails`; the `message` passed
     * to `AppFailure` is server-side only and never crosses the wire. A test
     * asserting on a message would be asserting on something no client can read.
     *
     * `context_already_assigned` is the whole point: it says the CONTEXT is taken,
     * not that this price list is. And the body must not name either book, because
     * the row that refused this write may belong to one the caller cannot see.
     */
    expect(body.violations).toEqual([{ path: 'body.priority', rule: 'context_already_assigned' }]);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(bookOne);
    expect(raw).not.toContain(bookTwo);
  });

  it('refuses a branch that does not belong to the named company', async () => {
    authAs(SVC_FULL);
    const priceListId = await createPriceList();
    const mismatched = await createAssignment({
      priceListId,
      companyId: COMPANY_A2,
      // A branch of a different company.
      branchId: '00000000-0000-4000-8000-0000000000fe',
      effectiveFrom: '2031-01-01',
    });
    expect(mismatched.status).toBe(422);
    expect(await codeOf(mismatched)).toBe('ERR-VAL-001');
  });

  it('refuses a wildcard assignment from a branch-scoped holder', async () => {
    // A wildcard names no company and no branch: it is the tenant default book. A
    // branch-scoped grant must not reach it, and `authorizeScope({})` cannot express
    // that — it fails closed on an empty target — so the route checks tenant-wide.
    authAs(SVC_FULL);
    const priceListId = await createPriceList();

    authAs(SVC_PRICE_SCOPED_A2);
    const refused = await createAssignment({ priceListId, effectiveFrom: '2031-01-01' });
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
  });

  it('is cross-tenant isolated: tenant B cannot assign a tenant-A price list', async () => {
    authAs(SVC_FULL);
    const priceListId = await createPriceList();

    // SVC_TENANT_B_FULL holds svc.price.manage UNRESTRICTED, in tenant B. Its refusal
    // is therefore the tenant boundary and not a missing permission — the distinction
    // the p1-20 helpers insist on, because a test that cannot tell the two apart
    // proves the weaker one.
    authAs(SVC_TENANT_B_FULL);
    const foreign = await createAssignment({
      priceListId,
      companyId: COMPANY_A1,
      priority: 41,
      effectiveFrom: '2031-01-01',
    });
    expect(foreign.status).not.toBe(201);
    expect([403, 404]).toContain(foreign.status);
  });

  it('lets a branch-scoped holder assign WITHIN its own scope', async () => {
    // The counterpart to the wildcard refusal above. A principal that is refused
    // everywhere proves nothing about scope; this one holds svc.price.manage on
    // (COMPANY_A1, BRANCH_A2) and must succeed there on the identical shape of
    // request that is refused when it names no scope at all.
    authAs(SVC_FULL);
    const priceListId = await createPriceList();

    authAs(SVC_PRICE_SCOPED_A2);
    const allowed = await createAssignment({
      priceListId,
      companyId: COMPANY_A1,
      branchId: BRANCH_A2,
      priority: 31,
      effectiveFrom: '2031-01-01',
    });
    expect(allowed.status).toBe(201);
  });

  it('refuses an unknown price list and any field it does not accept', async () => {
    authAs(SVC_FULL);
    const unknown = await createAssignment({
      priceListId: '00000000-0000-4000-8000-0000000000ff',
      effectiveFrom: '2031-01-01',
    });
    expect([404, 422]).toContain(unknown.status);

    const priceListId = await createPriceList();
    const extra = await createAssignment({
      priceListId,
      effectiveFrom: '2031-01-01',
      status: 'inactive',
    });
    expect(extra.status).toBe(422);
  });

  it('replays an idempotent assignment without inserting twice', async () => {
    authAs(SVC_FULL);
    const priceListId = await createPriceList();
    const key = crypto.randomUUID();
    const body = { priceListId, customerClass: 'a1_replay_class', effectiveFrom: '2031-01-01' };
    const first = await createAssignment(body, key);
    expect(first.status).toBe(201);
    const created = (await first.json()) as { id: string };
    const replay = await createAssignment(body, key);
    expect([200, 201]).toContain(replay.status);
    expect(((await replay.json()) as { id: string }).id).toBe(created.id);
    expect(await auditCountFor('svc.price_list_assignment.created', created.id)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// THE SELLABILITY CHAIN — the only assertion that proves the seam actually closed
// ---------------------------------------------------------------------------

/**
 * A quotation line requires a SELLABLE service, and a service is sellable only
 * when it has a published version AND a price the resolver can find. Before A1
 * neither could be produced through the product: no writer existed for
 * `svc.service_categories`, `svc.service_versions` or
 * `svc.price_list_assignments`.
 *
 * The existing P1-20 pricing suite passes only because its `publishedListFor`
 * fixture calls `assignPriceList`, which INSERTS THROUGH THE ADMIN POOL and
 * bypasses RLS. That is precisely what hid F-02: every pricing test was green
 * over a product that could not price anything. This test uses the shipped
 * routes for all eight steps, and the negative case below is what makes the
 * positive one mean something.
 */
describe('the commercial chain, end to end, through shipped routes only', () => {
  it('a service created through the API becomes priceable — and is NOT priceable until the assignment exists', async () => {
    // 1. category — A1 svc.service-category-create
    authAs(SVC_CATALOG_MANAGER);
    const category = (await (
      await createCategory({ code: nextCategoryCode(), name: 'Chain category' })
    ).json()) as CategoryItem;

    // 2. service under it — existing svc.service-create, which could not be called
    //    at all before step 1 had a writer
    const serviceCode = `CHAIN-${Date.now().toString(36)}`;
    const serviceResponse = await SERVICE_CREATE(
      new Request('http://localhost/api/v1/services', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          serviceCategoryId: category.id,
          serviceCode,
          name: 'Chain service',
        }),
      })
    );
    expect(serviceResponse.status).toBe(201);
    const service = (await serviceResponse.json()) as { id: string; recordVersion: number };

    // 3. draft version — A1 svc.service-version-create
    const draft = (await (
      await createVersion(service.id, { effectiveFrom: '2020-01-01' })
    ).json()) as { id: string; status: string };
    expect(draft.status).toBe('draft');

    // 4. publish it — existing route, which had no draft to act on before A1
    const published = await SERVICE_VERSION_PUBLISH(
      new Request(
        `http://localhost/api/v1/services/${service.id}/versions/${draft.id}/publication`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': crypto.randomUUID(),
            'if-match': String(await serviceRecordVersionOf(service.id)),
          },
          body: JSON.stringify({ effectiveFrom: '2020-01-01' }),
        }
      ),
      { params: Promise.resolve({ serviceId: service.id, versionId: draft.id }) }
    );
    expect(published.status).toBe(200);

    // 5-8. a published price list carrying a rule for this service
    authAs(SVC_FULL);
    const priceListId = await createPriceList();
    const listVersion = (await (
      await PRICE_LIST_VERSION_CREATE(
        new Request(`http://localhost/api/v1/price-lists/${priceListId}/versions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': crypto.randomUUID(),
            'if-match': String(await priceListVersionOf(priceListId)),
          },
          body: JSON.stringify({ effectiveFrom: '2020-01-01' }),
        }),
        { params: Promise.resolve({ priceListId }) }
      )
    ).json()) as { id: string };

    const rule = await PRICE_RULE_RECORD(
      new Request(
        `http://localhost/api/v1/price-lists/${priceListId}/versions/${listVersion.id}/rules`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
          body: JSON.stringify({ serviceId: service.id, amount: '250.0000' }),
        }
      ),
      { params: Promise.resolve({ priceListId, versionId: listVersion.id }) }
    );
    expect(rule.status).toBe(201);

    const listPublished = await PRICE_LIST_PUBLISH(
      new Request(
        `http://localhost/api/v1/price-lists/${priceListId}/versions/${listVersion.id}/publication`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': crypto.randomUUID(),
            'if-match': String(await priceListVersionOf(priceListId)),
          },
          body: JSON.stringify({ effectiveFrom: '2020-01-01' }),
        }
      ),
      { params: Promise.resolve({ priceListId, versionId: listVersion.id }) }
    );
    expect(listPublished.status).toBe(200);

    const priceQuery = new URL('http://localhost/api/v1/prices');
    priceQuery.searchParams.set('serviceId', service.id);
    priceQuery.searchParams.set('companyId', COMPANY_A1);
    priceQuery.searchParams.set('branchId', BRANCH_A1);

    // THE NEGATIVE. Everything above is published and correct, and the price still
    // cannot be resolved, because `svc.resolve_price` requires an ACTIVE assignment
    // row covering the context and nothing has written one. This is the state every
    // API-created tenant was permanently in before A1.
    const beforeAssignment = await PRICE_RESOLVE(new Request(priceQuery));
    expect(beforeAssignment.status).not.toBe(200);

    // 9. THE ASSIGNMENT — A1 svc.price-list-assignment-create, through the route,
    //    NOT through the admin-pool fixture the P1-20 suite uses.
    const assigned = await createAssignment({
      priceListId,
      companyId: COMPANY_A1,
      priority: 900,
      effectiveFrom: '2020-01-01',
    });
    expect(assigned.status).toBe(201);

    // 10. and now the same query answers a price.
    const afterAssignment = await PRICE_RESOLVE(new Request(priceQuery));
    expect(afterAssignment.status).toBe(200);
    const resolved = (await afterAssignment.json()) as {
      unitPrice: unknown;
      currency: string;
    };
    // Money crosses the wire as a decimal STRING, computed by PostgreSQL. A number
    // here would mean something in the path cast it through IEEE-754.
    expect(typeof resolved.unitPrice).toBe('string');
    expect(resolved.unitPrice).toBe('250.0000');
    expect(resolved.currency).toBe('JOD');
  });
});
