/**
 * Service catalog reads (Phase 1-20, P1-20-BE-001…003, P1-20-QA-003).
 *
 * The isolation cases are the point of this suite, not an appendix.
 *
 * `GET /api/v1/services` declares `scope: 'tenant'`, NOT `'branch'` — an earlier
 * version of this header said `'branch'` and reasoned from that, describing code the
 * route does not contain. The route explains the choice: the listing is legitimately
 * unfiltered, `requireScopedPermissions` fails closed on an empty target (the P1-19
 * hardening that closed P1-18-A-01), and declaring `'branch'` would therefore 403
 * every unfiltered listing, including an unrestricted principal's.
 *
 * What makes the branch filter safe is not the declaration but the handler: when
 * `availableAtBranchId` IS supplied it is authorized as a concrete scope target before
 * it is used as a filter. Without that step the narrowing would come from
 * `app.branch_ids` alone — the permission-blind union of every active grant — and a
 * principal granted an unrelated permission in A1 would read A1's availability.
 *
 * The `SVC_PERMISSION_ELSEWHERE` case is what proves it: that principal holds
 * `svc.service.read` scoped to A2 and an unrelated permission scoped to A1, so A1
 * IS in its allowed-branch union. A scope-blind implementation serves it A1's
 * catalog; a correct one refuses.
 *
 * ## The mutation surface (P1-20-G-01)
 *
 * The four write operations below were required by
 * `docs/phase-1/phase-1-10/p1-20-backend-contract.md` — service INSERT/UPDATE with an
 * immutable `service_code` and terminal `archived`, plus
 * `svc.publish_service_version` — and the phase originally shipped the read surface
 * only. Three audit actions had been registered for them and had no producer at all.
 *
 * Three of the four are TENANT-WIDE acts: `svc.services` and `svc.service_versions`
 * carry no `company_id` and no `branch_id`, so there is no scope target, and an empty
 * target makes the pre-handler check scope-blind whatever scope is declared
 * (P1-18-A-01). Each therefore demands `svc.service.manage` granted tenant-wide, and
 * `SVC_CATALOG_SCOPED_A2` — which holds that permission IN FULL through a
 * branch-scoped grant — is refused on every one of them while `SVC_CATALOG_MANAGER`
 * succeeds on the identical request. A refusal that discriminates between two
 * principals holding the same permission is the only kind that says anything about
 * scope.
 *
 * The fourth, `svc.branch-availability-set`, is genuinely `scope: 'branch'`, because
 * `svc.branch_service_availability` does carry both columns. Its isolation case is
 * the decisive one and is stated at the test.
 *
 * Operations exercised here: svc.service-list, svc.service-create, svc.service-update,
 * svc.service-version-publish, svc.branch-availability-set.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   svc.service-list: route service authorization success denial cross-tenant isolation
 *   svc.service-create: route service authorization success denial cross-tenant audit idempotency
 *   svc.service-update: route service authorization success denial cross-tenant audit idempotency stale-version
 *   svc.service-version-publish: route service authorization success denial cross-tenant audit outbox idempotency stale-version
 *   svc.branch-availability-set: route service authorization success denial cross-tenant audit idempotency isolation
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  BRANCH_A1,
  COMPANY_A1,
  TENANT_A,
  adminPool,
  cleanBackendFixtures,
  countRows,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { BRANCH_A2, BRANCH_B1, establishP1_19Fixtures } from './p1-19-helpers';
import {
  BRANCH_A2_OF_COMPANY_A2,
  CATEGORY_A,
  CATEGORY_B,
  COMPANY_A2,
  SERVICE_A,
  SERVICE_A_ALT,
  SERVICE_A_ARCHIVED,
  SERVICE_B,
  SVC_CATALOG_MANAGER,
  SVC_CATALOG_SCOPED_A2,
  SVC_CATALOG_TENANT_B,
  SVC_FULL,
  SVC_PERMISSION_ELSEWHERE,
  SVC_READER,
  SVC_SCOPED_A2,
  SVC_TENANT_B,
  SVC_UNPERMITTED,
  auditCountFor,
  authAs,
  availabilityRowOf,
  establishP1_20Fixtures,
  outboxCountFor,
  seedDraftServiceVersion,
  serviceRecordVersionOf,
  serviceRowOf,
  serviceVersionRowOf,
} from './p1-20-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as LIST, POST as CREATE } from '@/app/api/v1/services/route';
import { PATCH as UPDATE } from '@/app/api/v1/services/[serviceId]/route';
import { POST as SET_AVAILABILITY } from '@/app/api/v1/services/[serviceId]/branch-availability/route';
import { POST as PUBLISH } from '@/app/api/v1/services/[serviceId]/versions/[versionId]/publication/route';

let admin: Pool;
let runtime: Pool;

function list(query: Record<string, string> = {}): Promise<Response> {
  const url = new URL('http://localhost/api/v1/services');
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return LIST(new Request(url));
}

interface ServiceItem {
  readonly id: string;
  readonly serviceCode: string;
  readonly name: string;
  readonly categoryId: string;
  readonly lifecycleStatus: string;
  readonly recordVersion: number;
}
interface PageBody {
  readonly items: readonly ServiceItem[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

async function page(response: Response): Promise<PageBody> {
  return (await response.json()) as PageBody;
}

async function ids(response: Response): Promise<readonly string[]> {
  return (await page(response)).items.map((item) => item.id);
}

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

describe('svc.service-list — authorization', () => {
  it('401 without an authenticator and 403 without svc.service.read', async () => {
    __resetAuthenticatorForTests();
    expect((await list()).status).toBe(401);

    authAs(SVC_UNPERMITTED);
    const refused = await list();
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { code: string }).code).toBe('ERR-IAM-001');
  });

  it('serves the tenant catalog to a holder of svc.service.read', async () => {
    authAs(SVC_FULL);
    const response = await list();
    expect(response.status).toBe(200);
    const found = await ids(response);
    expect(found).toContain(SERVICE_A);
    expect(found).toContain(SERVICE_A_ALT);
  });
});

describe('svc.service-list — the projection carries no price', () => {
  it('returns no amount, currency, or price-rule field anywhere in the body', async () => {
    authAs(SVC_FULL);
    const raw = await (await list()).text();
    // A price would leak the whole price book to every catalog reader; resolution
    // is gated on svc.price.read and lives in the pricing module.
    for (const forbidden of [
      'unitPrice',
      'amount',
      'currency',
      'priceRule',
      'captured',
      'taxRate',
    ]) {
      expect(raw).not.toContain(forbidden);
    }
  });
});

describe('svc.service-list — isolation (P1-18-A-01)', () => {
  it('refuses a branch filter for a branch the caller has no grant in', async () => {
    authAs(SVC_SCOPED_A2);
    const refused = await list({ availableAtBranchId: BRANCH_A1 });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { code: string }).code).toBe('ERR-IAM-001');
  });

  it('serves the branch the caller IS granted in', async () => {
    authAs(SVC_SCOPED_A2);
    const response = await list({ availableAtBranchId: BRANCH_A2 });
    expect(response.status).toBe(200);
    const found = await ids(response);
    expect(found).toContain(SERVICE_A_ALT);
    // SERVICE_A is available in A1 only, so a correct branch filter excludes it.
    expect(found).not.toContain(SERVICE_A);
  });

  it('refuses A1 for a caller whose A1 grant carries an UNRELATED permission', async () => {
    // The decisive case. This principal's allowed-branch union CONTAINS A1, so RLS
    // alone would not refuse it; only a scoped permission check does.
    authAs(SVC_PERMISSION_ELSEWHERE);
    const refused = await list({ availableAtBranchId: BRANCH_A1 });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { code: string }).code).toBe('ERR-IAM-001');
  });

  it('still serves that caller the branch it holds the catalog permission in', async () => {
    authAs(SVC_PERMISSION_ELSEWHERE);
    const response = await list({ availableAtBranchId: BRANCH_A2 });
    expect(response.status).toBe(200);
    expect(await ids(response)).toContain(SERVICE_A_ALT);
  });
});

describe('svc.service-list — cross-tenant', () => {
  it("never shows a tenant-B caller tenant A's services, and vice versa", async () => {
    authAs(SVC_TENANT_B);
    const asB = await ids(await list());
    expect(asB).not.toContain(SERVICE_A);
    expect(asB).not.toContain(SERVICE_A_ALT);

    authAs(SVC_FULL);
    const asA = await ids(await list());
    // Tenant B's service is invisible even though the tenant-A caller is
    // unrestricted: RLS narrows on tenant before any filter applies.
    expect(asA).not.toContain('d2000000-0000-4000-8000-00000000010a');
  });

  it('yields an empty page for a tenant-B branch filter, disclosing nothing', async () => {
    authAs(SVC_TENANT_B);
    // BRANCH_B1 is this caller's own tenant, so the scope check passes; the point
    // is that a tenant-A service cannot appear under it.
    const response = await list({ availableAtBranchId: BRANCH_B1 });
    expect(response.status).toBe(200);
    expect(await ids(response)).not.toContain(SERVICE_A);
  });
});

describe('svc.service-list — filters', () => {
  it('filters by lifecycle status, excluding an archived service by default query', async () => {
    authAs(SVC_FULL);
    const active = await ids(await list({ lifecycleStatus: 'active' }));
    expect(active).toContain(SERVICE_A);
    expect(active).not.toContain(SERVICE_A_ARCHIVED);

    const archived = await ids(await list({ lifecycleStatus: 'archived' }));
    expect(archived).toContain(SERVICE_A_ARCHIVED);
    expect(archived).not.toContain(SERVICE_A);
  });

  it('filters by category', async () => {
    authAs(SVC_FULL);
    const response = await list({ categoryId: CATEGORY_A });
    expect(response.status).toBe(200);
    expect(await ids(response)).toContain(SERVICE_A);
  });

  it('filters by an effective date, using the half-open published range', async () => {
    authAs(SVC_FULL);
    // The fixture versions are published from 2020-01-01 with no end, so a later
    // date is covered and an earlier one is not.
    expect(await ids(await list({ effectiveOn: '2026-07-27' }))).toContain(SERVICE_A);
    expect(await ids(await list({ effectiveOn: '2019-12-31' }))).not.toContain(SERVICE_A);
  });

  it('matches a code or name prefix in search', async () => {
    authAs(SVC_FULL);
    const byCode = await ids(await list({ search: 'FX-P120-A' }));
    expect(byCode).toContain(SERVICE_A);
    expect(byCode).not.toContain(SERVICE_A_ALT);
  });

  it('treats LIKE metacharacters in search as literals, not wildcards', async () => {
    authAs(SVC_FULL);
    // Parameter binding stops injection but NOT pattern expansion, so the term is
    // escaped with ESCAPE '\'. Without that, '%' returns the whole catalog.
    expect(await ids(await list({ search: '%' }))).toHaveLength(0);
    expect(await ids(await list({ search: '_' }))).toHaveLength(0);
    // A real prefix still matches, so the escaping did not break ordinary search.
    expect(await ids(await list({ search: 'FX-P120-A' }))).toContain(SERVICE_A);
  });
});

describe('svc.service-list — denial and bounds', () => {
  it('refuses an unknown query parameter', async () => {
    authAs(SVC_FULL);
    const response = await list({ unexpected: 'x' });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-VAL-001');
  });

  it('refuses a page size above the platform maximum', async () => {
    authAs(SVC_FULL);
    expect((await list({ limit: '101' })).status).toBe(422);
  });

  it('refuses a malformed cursor with ERR-PAG-001 rather than a 500', async () => {
    authAs(SVC_FULL);
    const response = await list({ cursor: 'not-a-cursor' });
    // ERR-PAG-001 is a 400, not a 422: a cursor is an opaque token the server
    // minted, so a malformed one is a bad request rather than a field the caller
    // could have filled in correctly.
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-PAG-001');
  });

  it('refuses a timezone-carrying effectiveOn, because the column is a date', async () => {
    authAs(SVC_FULL);
    expect((await list({ effectiveOn: '2026-07-27T00:00:00Z' })).status).toBe(422);
  });

  it('refuses a non-uuid branch filter', async () => {
    authAs(SVC_FULL);
    expect((await list({ availableAtBranchId: 'not-a-uuid' })).status).toBe(422);
  });
});

describe('svc.service-list — ordering and paging', () => {
  it('orders by service_code ascending, a total order with id', async () => {
    authAs(SVC_FULL);
    const codes = (await page(await list())).items.map((item) => item.serviceCode);
    const sorted = [...codes].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(codes).toEqual(sorted);
  });

  it('pages deterministically with a stable cursor', async () => {
    authAs(SVC_FULL);
    const first = await page(await list({ limit: '1' }));
    expect(first.items).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    const second = await page(await list({ limit: '1', cursor: first.nextCursor as string }));
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });
});

// ---------------------------------------------------------------------------
// The mutation surface (P1-20-G-01)
// ---------------------------------------------------------------------------

let writeCodeSeq = 0;

/**
 * A fresh external service code.
 *
 * `service_code` is immutable and `uq_services_code` is tenant-unique where not
 * deleted, so every created service needs its own. The prefix is deliberately NOT
 * `FX-P120-`: the read suite above asserts that a search for `FX-P120-A` matches
 * `SERVICE_A` and not `SERVICE_A_ALT`, and a created service sharing that prefix would
 * silently break an assertion about the ESCAPING of LIKE metacharacters.
 */
const nextServiceCode = (): string => {
  writeCodeSeq += 1;
  return `FXW-${String(Date.now() % 100000)}-${writeCodeSeq}`;
};

interface ServiceBody {
  readonly id: string;
  readonly serviceCode: string;
  readonly name: string;
  readonly description: string | null;
  readonly categoryId: string;
  readonly lifecycleStatus: string;
  readonly recordVersion: number;
}
interface VersionBody {
  readonly id: string;
  readonly serviceId: string;
  readonly versionNo: number;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: string;
  readonly recordVersion: number;
}
interface AvailabilityBody {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly serviceId: string;
  readonly isAvailable: boolean;
  readonly status: string;
  readonly recordVersion: number;
}

const codeOf = async (response: Response): Promise<string> =>
  ((await response.json()) as { code: string }).code;

/** `key` is explicit only where a REPLAY is the thing under test; otherwise fresh. */
function createService(body: unknown, key: string = crypto.randomUUID()): Promise<Response> {
  return CREATE(
    new Request('http://localhost/api/v1/services', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify(body),
    })
  );
}

function updateService(
  serviceId: string,
  body: unknown,
  ifMatch: number | null
): Promise<Response> {
  return UPDATE(
    new Request(`http://localhost/api/v1/services/${serviceId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
        ...(ifMatch === null ? {} : { 'if-match': String(ifMatch) }),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ serviceId }) }
  );
}

function publishVersion(
  serviceId: string,
  versionId: string,
  body: unknown,
  ifMatch: number | null
): Promise<Response> {
  return PUBLISH(
    new Request(`http://localhost/api/v1/services/${serviceId}/versions/${versionId}/publication`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
        ...(ifMatch === null ? {} : { 'if-match': String(ifMatch) }),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ serviceId, versionId }) }
  );
}

function setAvailability(serviceId: string, body: unknown): Promise<Response> {
  return SET_AVAILABILITY(
    new Request(`http://localhost/api/v1/services/${serviceId}/branch-availability`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ serviceId }) }
  );
}

/** The same request, minus the `Idempotency-Key` header. */
const withoutKey = (
  url: string,
  method: 'POST' | 'PATCH',
  body: unknown,
  ifMatch?: number
): Request =>
  new Request(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(ifMatch === undefined ? {} : { 'if-match': String(ifMatch) }),
    },
    body: JSON.stringify(body),
  });

/** Creates a service as the unrestricted catalog manager and returns its body. */
async function managedService(overrides: Record<string, unknown> = {}): Promise<ServiceBody> {
  authAs(SVC_CATALOG_MANAGER);
  const response = await createService({
    serviceCategoryId: CATEGORY_A,
    serviceCode: nextServiceCode(),
    name: 'Write-surface fixture',
    ...overrides,
  });
  expect(response.status).toBe(201);
  return (await response.json()) as ServiceBody;
}

describe('svc.service-create', () => {
  it('401 unauthenticated, and 403 for a caller holding only svc.service.read', async () => {
    __resetAuthenticatorForTests();
    const anonymous = await createService({
      serviceCategoryId: CATEGORY_A,
      serviceCode: nextServiceCode(),
      name: 'x',
    });
    expect(anonymous.status).toBe(401);

    // SVC_READER holds svc.service.read and nothing else, in the right tenant through an
    // unrestricted grant — so this 403 is the missing WRITE permission and nothing else.
    authAs(SVC_READER);
    const refused = await createService({
      serviceCategoryId: CATEGORY_A,
      serviceCode: nextServiceCode(),
      name: 'x',
    });
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
  });

  it('creates an active service and writes one svc.service.updated audit record', async () => {
    const code = nextServiceCode();
    const created = await managedService({ serviceCode: code, description: 'Fixture description' });
    expect(created.serviceCode).toBe(code);
    expect(created.lifecycleStatus).toBe('active');
    expect(created.categoryId).toBe(CATEGORY_A);
    expect(created.recordVersion).toBe(1);
    // The action sat in the controlled catalog with NO producer for the whole phase.
    // This assertion is what makes it a producer.
    expect(await auditCountFor('svc.service.updated', created.id)).toBe(1);

    // And it is visible through the read surface, so the write reached the same table
    // the catalog is served from.
    authAs(SVC_FULL);
    expect(await ids(await list({ search: code }))).toContain(created.id);
  });

  it('refuses a duplicate service code as a conflict, not a 500', async () => {
    const code = nextServiceCode();
    await managedService({ serviceCode: code });
    authAs(SVC_CATALOG_MANAGER);
    const duplicate = await createService({
      serviceCategoryId: CATEGORY_A,
      serviceCode: code,
      name: 'Second',
    });
    // uq_services_code. The code is immutable once written, so a duplicate is not a
    // problem a later update can repair — the caller must choose another now.
    expect(duplicate.status).toBe(409);
    expect(await codeOf(duplicate)).toBe('ERR-CON-001');
  });

  it('refuses an unknown category, a malformed code, and any field it does not accept', async () => {
    authAs(SVC_CATALOG_MANAGER);
    const unknownCategory = await createService({
      serviceCategoryId: '00000000-0000-4000-8000-0000000000ff',
      serviceCode: nextServiceCode(),
      name: 'x',
    });
    expect(unknownCategory.status).toBe(422);
    expect(await codeOf(unknownCategory)).toBe('ERR-VAL-001');

    // ck_services_code_format.
    for (const bad of ['', 'a', '-leading', 'has space', 'x'.repeat(64)]) {
      const response = await createService({
        serviceCategoryId: CATEGORY_A,
        serviceCode: bad,
        name: 'x',
      });
      expect(response.status, `code ${JSON.stringify(bad)}`).toBe(422);
    }

    /**
     * `.strict()` refuses a lifecycle at creation.
     *
     * Not tidiness: `ck_services_archived_at` ties `archived` to a non-null
     * `archived_at` that only `svc.guard_service_lifecycle` writes, so a service created
     * archived is not a state this schema can express. A permissive schema would accept
     * the field, ignore it, and leave the caller believing otherwise.
     */
    for (const extra of [
      { lifecycleStatus: 'archived' },
      { id: crypto.randomUUID() },
      { amount: '1' },
    ]) {
      const response = await createService({
        serviceCategoryId: CATEGORY_A,
        serviceCode: nextServiceCode(),
        name: 'x',
        ...extra,
      });
      expect(response.status, `extra ${Object.keys(extra)[0] ?? ''}`).toBe(422);
    }
  });

  it('refuses a command with no Idempotency-Key', async () => {
    authAs(SVC_CATALOG_MANAGER);
    const response = await CREATE(
      withoutKey('http://localhost/api/v1/services', 'POST', {
        serviceCategoryId: CATEGORY_A,
        serviceCode: nextServiceCode(),
        name: 'No key',
      })
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await codeOf(response)).toBe('ERR-INT-002');
  });

  it('never lets a tenant-B caller build on a tenant-A category', async () => {
    /**
     * The cross-tenant case, with a principal that HOLDS `svc.service.manage`
     * unrestricted in tenant B — so the refusal cannot be a missing permission.
     * `CATEGORY_A` belongs to tenant A and RLS makes it invisible here, so the request
     * fails on the category it named and no row lands in either tenant.
     */
    authAs(SVC_CATALOG_TENANT_B);
    const code = nextServiceCode();
    const refused = await createService({
      serviceCategoryId: CATEGORY_A,
      serviceCode: code,
      name: 'Tenant B attempt',
    });
    expect(refused.status).toBe(422);
    expect(await codeOf(refused)).toBe('ERR-VAL-001');
    expect(await countRows(admin, 'svc.services', 'service_code = $1', [code])).toBe(0);

    // The positive half: the same caller CAN create against its own tenant's category,
    // so the refusal above is the tenant boundary and not a broken endpoint.
    const own = await createService({
      serviceCategoryId: CATEGORY_B,
      serviceCode: nextServiceCode(),
      name: 'Tenant B service',
    });
    expect(own.status).toBe(201);
  });

  it('refuses a branch-scoped holder of svc.service.manage, and allows an unrestricted one', async () => {
    /**
     * The tenant-wide authority case.
     *
     * `SVC_CATALOG_SCOPED_A2` holds `svc.service.manage` IN FULL — this operation's own
     * permission — through a grant scoped to branch A2. `svc.services` has no company
     * and no branch, so there is no target to authorize and `requiresScopedEvaluation`
     * returns false on an empty one whatever the declared scope: the pre-handler check
     * degrades to the scope-blind `iam.has_permission` and would ALLOW this. Only
     * `callerHoldsPermissionTenantWide` refuses it.
     *
     * `SVC_CATALOG_MANAGER` holds the same permission through an unrestricted grant and
     * succeeds on the identical request, so the refusal is the grant's SCOPE MODE and
     * not the request, the permission, or the category.
     */
    const body = {
      serviceCategoryId: CATEGORY_A,
      serviceCode: nextServiceCode(),
      name: 'Scope discrimination',
    };

    authAs(SVC_CATALOG_SCOPED_A2);
    const refused = await createService(body);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
    expect(await countRows(admin, 'svc.services', 'service_code = $1', [body.serviceCode])).toBe(0);

    authAs(SVC_CATALOG_MANAGER);
    expect((await createService(body)).status).toBe(201);
  });

  it('replays one Idempotency-Key to one service, not two', async () => {
    /**
     * The replay half of the idempotency floor. Refusing a missing key only proves the
     * header is mandatory; this proves it does what it is mandatory FOR.
     *
     * It matters more here than on most commands: `service_code` is immutable and
     * `uq_services_code` is tenant-unique, so a retried create that executed twice would
     * consume the code on the first attempt and then answer the retry with a 409 for a
     * service the caller had in fact successfully created.
     */
    authAs(SVC_CATALOG_MANAGER);
    const key = crypto.randomUUID();
    const body = {
      serviceCategoryId: CATEGORY_A,
      serviceCode: nextServiceCode(),
      name: 'Replayed once',
    };

    const first = await createService(body, key);
    expect(first.status).toBe(201);
    const second = await createService(body, key);

    /**
     * The replay answers **200**, not the 201 the first attempt answered.
     *
     * `route-handler.ts` stores `value.body` alone — `serialize` is `(value) => value.body`
     * — so a replay is reconstructed as `{ body }` with no status and falls back to the
     * handler default. That is platform behaviour shared by every idempotent operation
     * since P1-15, not something this route chose, and it is asserted rather than papered
     * over: a test that expected 201 here would be asserting a contract the platform does
     * not implement. Recorded as `P1-20-A-10` in `evidence/open-decisions.md`.
     */
    expect(second.status).toBe(200);

    // The same id, from the stored response document rather than a second execution.
    expect(((await second.json()) as ServiceBody).id).toBe(
      ((await first.json()) as ServiceBody).id
    );
    expect(await countRows(admin, 'svc.services', 'service_code = $1', [body.serviceCode])).toBe(1);
  });
});

describe('svc.service-update', () => {
  it('401 unauthenticated, and 403 for a caller holding only svc.service.read', async () => {
    const service = await managedService();
    const version = await serviceRecordVersionOf(service.id);

    __resetAuthenticatorForTests();
    expect((await updateService(service.id, { name: 'Anonymous' }, version)).status).toBe(401);

    authAs(SVC_READER);
    const refused = await updateService(service.id, { name: 'Reader' }, version);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');

    // Neither attempt moved the row, so both refusals happened before any write.
    expect((await serviceRowOf(service.id))?.name).toBe(service.name);
  });

  it('applies a partial edit, bumps record_version, and audits the columns that moved', async () => {
    const service = await managedService({ description: 'Before' });
    authAs(SVC_CATALOG_MANAGER);

    const response = await updateService(
      service.id,
      { name: 'After', description: null },
      service.recordVersion
    );
    expect(response.status).toBe(200);
    const updated = (await response.json()) as ServiceBody;
    expect(updated.name).toBe('After');
    expect(updated.description).toBeNull();
    // `serviceCategoryId` was not named, so it is untouched — a partial edit, not a
    // replacement of the row.
    expect(updated.categoryId).toBe(CATEGORY_A);
    expect(updated.recordVersion).toBe(service.recordVersion + 1);

    // Two records for this service: the creation and this edit. Both are
    // `svc.service.updated`, which is the only catalog action the controlled catalog
    // defines for a service row — the `change` detail is what separates them.
    expect(await auditCountFor('svc.service.updated', service.id)).toBe(2);
  });

  it('refuses serviceCode with a 422 rather than silently discarding it', async () => {
    /**
     * The immutability promise, made at the boundary.
     *
     * `tg_services_immutable` freezes `service_code`, so the database is safe either
     * way — but a permissive schema would strip the field, return 200, and leave the
     * caller believing the code changed until some later read contradicted them. The
     * `.strict()` schema is what turns that silence into an answer.
     */
    const service = await managedService();
    authAs(SVC_CATALOG_MANAGER);
    const response = await updateService(
      service.id,
      { serviceCode: nextServiceCode(), name: 'Renamed' },
      service.recordVersion
    );
    expect(response.status).toBe(422);
    expect(await codeOf(response)).toBe('ERR-VAL-001');

    // Nothing moved — not the code, and not the name that shared the request with it.
    const row = await serviceRowOf(service.id);
    expect(row?.serviceCode).toBe(service.serviceCode);
    expect(row?.name).toBe(service.name);
  });

  it('treats archived as terminal: no reactivation, and no edit afterwards', async () => {
    const service = await managedService();
    authAs(SVC_CATALOG_MANAGER);

    const archived = await updateService(
      service.id,
      { lifecycleStatus: 'archived' },
      service.recordVersion
    );
    expect(archived.status).toBe(200);
    expect(((await archived.json()) as ServiceBody).lifecycleStatus).toBe('archived');

    /**
     * `'active'` is expressible at the boundary on purpose: the enum accepts both states
     * the CHECK constraint allows, so the refusal arrives as `ERR-TRN-001` naming the
     * terminal state rather than as a validation error about an enum member. A caller
     * needs to learn that archiving cannot be undone, not that they mistyped.
     */
    const current = await serviceRecordVersionOf(service.id);
    const reactivate = await updateService(service.id, { lifecycleStatus: 'active' }, current);
    expect(reactivate.status).toBe(409);
    expect(await codeOf(reactivate)).toBe('ERR-TRN-001');

    /**
     * And an ordinary rename is refused too, which the database alone would NOT do:
     * `svc.guard_service_lifecycle` refuses only the transition out of `archived`, so a
     * rename of an archived row passes every trigger on the table. The application check
     * is doing work the schema does not.
     */
    const rename = await updateService(service.id, { name: 'Renamed after archive' }, current);
    expect(rename.status).toBe(409);
    expect(await codeOf(rename)).toBe('ERR-TRN-001');

    const row = await serviceRowOf(service.id);
    expect(row?.lifecycleStatus).toBe('archived');
    expect(row?.name).toBe(service.name);

    // The fixture's pre-archived service behaves identically, so this is a property of
    // the state and not of the path that reached it.
    const preArchived = await serviceRecordVersionOf(SERVICE_A_ARCHIVED);
    const fixture = await updateService(
      SERVICE_A_ARCHIVED,
      { lifecycleStatus: 'active' },
      preArchived
    );
    expect(fixture.status).toBe(409);
    expect(await codeOf(fixture)).toBe('ERR-TRN-001');
  });

  it('requires If-Match, refuses a wrong one, and refuses an empty patch', async () => {
    const service = await managedService();
    authAs(SVC_CATALOG_MANAGER);

    const missing = await updateService(service.id, { name: 'No header' }, null);
    expect(missing.status).toBe(428);
    expect(await codeOf(missing)).toBe('ERR-CON-002');

    // `versionGuarded` means two things — the header is mandatory, and a WRONG value is
    // refused. Only the first is proved by the case above.
    const stale = await updateService(service.id, { name: 'Stale' }, 999);
    expect(stale.status).toBe(409);
    expect(await codeOf(stale)).toBe('ERR-CON-001');
    expect((await serviceRowOf(service.id))?.name).toBe(service.name);

    const empty = await updateService(service.id, {}, service.recordVersion);
    expect(empty.status).toBe(422);
    expect(await codeOf(empty)).toBe('ERR-VAL-001');
    // Refused before any write, so an empty patch costs no version bump and no audit
    // record — which is what makes `record_version` a meaningful concurrency token.
    expect(await serviceRecordVersionOf(service.id)).toBe(service.recordVersion);
  });

  it('refuses an unknown service, an inactive-category move, and no Idempotency-Key', async () => {
    const service = await managedService();
    authAs(SVC_CATALOG_MANAGER);

    const unknown = await updateService(
      '00000000-0000-4000-8000-0000000000fe',
      { name: 'Ghost' },
      1
    );
    expect(unknown.status).toBe(404);
    expect(await codeOf(unknown)).toBe('ERR-RES-001');

    // CATEGORY_B belongs to tenant B, so RLS makes it invisible — an unknown category
    // rather than a cross-tenant move, which is the point.
    const foreignCategory = await updateService(
      service.id,
      { serviceCategoryId: CATEGORY_B },
      service.recordVersion
    );
    expect(foreignCategory.status).toBe(422);
    expect(await codeOf(foreignCategory)).toBe('ERR-VAL-001');

    const noKey = await UPDATE(
      withoutKey(
        `http://localhost/api/v1/services/${service.id}`,
        'PATCH',
        { name: 'No key' },
        service.recordVersion
      ),
      { params: Promise.resolve({ serviceId: service.id }) }
    );
    expect(noKey.status).toBe(400);
    expect(await codeOf(noKey)).toBe('ERR-INT-002');
  });

  it('never lets a tenant-B caller edit a tenant-A service', async () => {
    /**
     * `SVC_CATALOG_TENANT_B` holds `svc.service.manage` unrestricted in tenant B, so the
     * refusal below cannot be a missing permission — `svc.services` is narrowed by RLS
     * to `iam.current_tenant_id()`, so the row is simply not there.
     */
    const service = await managedService();
    authAs(SVC_CATALOG_TENANT_B);
    const refused = await updateService(
      service.id,
      { name: 'Tenant B rename' },
      service.recordVersion
    );
    expect(refused.status).toBe(404);
    expect(await codeOf(refused)).toBe('ERR-RES-001');
    expect((await serviceRowOf(service.id))?.name).toBe(service.name);

    // The positive half: the same caller CAN edit its own tenant's service, so the
    // refusal above is the tenant boundary and not a broken endpoint.
    const own = await updateService(
      SERVICE_B,
      { name: 'Tenant B service, renamed' },
      await serviceRecordVersionOf(SERVICE_B)
    );
    expect(own.status).toBe(200);
  });

  it('refuses a branch-scoped holder of svc.service.manage, and allows an unrestricted one', async () => {
    /**
     * Same discrimination as the create case, restated because the two routes check it
     * independently. `SVC_CATALOG_SCOPED_A2` holds this operation's own permission IN
     * FULL through a grant scoped to branch A2; `svc.services` carries no company and no
     * branch, so `requiresScopedEvaluation` sees an empty target and the pre-handler
     * check degrades to the scope-blind `iam.has_permission` (P1-18-A-01), which would
     * ALLOW this. Only `callerHoldsPermissionTenantWide` refuses it, and
     * `SVC_CATALOG_MANAGER` — same permission, unrestricted grant — succeeds on the
     * identical request one line later.
     */
    const service = await managedService();
    const patch = { name: 'Scope discrimination on update' };

    authAs(SVC_CATALOG_SCOPED_A2);
    const refused = await updateService(service.id, patch, service.recordVersion);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
    expect((await serviceRowOf(service.id))?.name).toBe(service.name);

    authAs(SVC_CATALOG_MANAGER);
    expect((await updateService(service.id, patch, service.recordVersion)).status).toBe(200);
  });
});

describe('svc.service-version-publish', () => {
  /** A service with a draft version at `effectiveFrom`, ready to publish. */
  async function withDraft(
    versionNo: number,
    effectiveFrom: string
  ): Promise<{ service: ServiceBody; versionId: string }> {
    const service = await managedService();
    const versionId = await seedDraftServiceVersion({
      tenantId: TENANT_A,
      serviceId: service.id,
      versionNo,
      effectiveFrom,
    });
    return { service, versionId };
  }

  it('401 unauthenticated, and 403 for a caller holding only svc.service.read', async () => {
    const { service, versionId } = await withDraft(1, '2024-01-01');

    __resetAuthenticatorForTests();
    const anonymous = await publishVersion(
      service.id,
      versionId,
      { effectiveFrom: '2024-02-01' },
      service.recordVersion
    );
    expect(anonymous.status).toBe(401);

    authAs(SVC_READER);
    const refused = await publishVersion(
      service.id,
      versionId,
      { effectiveFrom: '2024-02-01' },
      service.recordVersion
    );
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
    expect((await serviceVersionRowOf(versionId))?.status).toBe('draft');
  });

  it('publishes through svc.publish_service_version, audits it, and emits exactly one event', async () => {
    const { service, versionId } = await withDraft(1, '2024-01-01');
    authAs(SVC_CATALOG_MANAGER);

    const response = await publishVersion(
      service.id,
      versionId,
      { effectiveFrom: '2024-06-01' },
      service.recordVersion
    );
    expect(response.status).toBe(200);
    const published = (await response.json()) as VersionBody;
    expect(published.status).toBe('published');
    expect(published.versionNo).toBe(1);
    // The function OVERWRITES `effective_from` with the date given at publication, so
    // the response carries what the database decided rather than what the draft held.
    expect(published.effectiveFrom).toBe('2024-06-01');
    expect(published.effectiveTo).toBeNull();

    const stored = await serviceVersionRowOf(versionId);
    expect(stored?.status).toBe('published');
    expect(stored?.effectiveFrom).toBe('2024-06-01');

    expect(await auditCountFor('svc.service_version.published', versionId)).toBe(1);
    // `service.published` sat in EVENT_CATALOG with `implementedIn: null` for the whole
    // phase. This assertion is what makes it implemented.
    expect(await outboxCountFor(`service.published:${versionId}`)).toBe(1);
  });

  it('succeeds forward only, and closes the prior version at the new boundary', async () => {
    /**
     * Succession is `svc.publish_service_version`'s, not this backend's. What is asserted
     * here is that the protected function's decisions reach the caller intact: an
     * `effective_from` at or before the currently open published version's own start is
     * refused, and a later one closes that version's `effective_to` at the boundary.
     *
     * Reimplementing either would create a second definition of succession that can
     * disagree with the one that actually runs — and that disagreement surfaces as a
     * service quietly effective on the wrong day, not as an error.
     */
    const { service, versionId: first } = await withDraft(1, '2024-01-01');
    authAs(SVC_CATALOG_MANAGER);
    expect(
      (
        await publishVersion(
          service.id,
          first,
          { effectiveFrom: '2024-06-01' },
          service.recordVersion
        )
      ).status
    ).toBe(200);

    const second = await seedDraftServiceVersion({
      tenantId: TENANT_A,
      serviceId: service.id,
      versionNo: 2,
      effectiveFrom: '2024-01-01',
    });

    // Backwards, and exactly on the boundary: both refused, because succession is
    // strictly forward-only.
    for (const backwards of ['2024-03-01', '2024-06-01']) {
      const refused = await publishVersion(
        service.id,
        second,
        { effectiveFrom: backwards },
        await serviceRecordVersionOf(service.id)
      );
      expect(refused.status, backwards).toBe(422);
      expect(await codeOf(refused)).toBe('ERR-VAL-001');
      expect((await serviceVersionRowOf(second))?.status).toBe('draft');
    }

    expect(
      (
        await publishVersion(
          service.id,
          second,
          { effectiveFrom: '2025-01-01' },
          await serviceRecordVersionOf(service.id)
        )
      ).status
    ).toBe(200);

    // The first version is now closed AT the second's start — the `[)` daterange the
    // gist EXCLUDE indexes, so the two abut without overlapping.
    expect(await serviceVersionRowOf(first)).toEqual({
      status: 'published',
      effectiveFrom: '2024-06-01',
      effectiveTo: '2025-01-01',
    });
  });

  it('refuses a non-draft version, and a version belonging to another service', async () => {
    const { service, versionId } = await withDraft(1, '2024-01-01');
    authAs(SVC_CATALOG_MANAGER);
    expect(
      (
        await publishVersion(
          service.id,
          versionId,
          { effectiveFrom: '2024-06-01' },
          service.recordVersion
        )
      ).status
    ).toBe(200);

    // Already published — `svc.guard_service_version_freeze` permits only
    // `published → archived`, so there is nothing left to publish.
    const again = await publishVersion(
      service.id,
      versionId,
      { effectiveFrom: '2024-07-01' },
      await serviceRecordVersionOf(service.id)
    );
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe('ERR-TRN-001');

    /**
     * A version id belonging to a DIFFERENT service, offered under this service's path.
     * Checked before the function is called: reaching it would take the wrong service's
     * lock and return a foreign-key error that reads like missing data.
     */
    const other = await withDraft(1, '2024-01-01');
    const mismatched = await publishVersion(
      service.id,
      other.versionId,
      { effectiveFrom: '2026-01-01' },
      await serviceRecordVersionOf(service.id)
    );
    expect(mismatched.status).toBe(404);
    expect(await codeOf(mismatched)).toBe('ERR-RES-001');
    expect((await serviceVersionRowOf(other.versionId))?.status).toBe('draft');
  });

  it('refuses an archived service, a malformed date, and no Idempotency-Key', async () => {
    const { service, versionId } = await withDraft(1, '2024-01-01');
    authAs(SVC_CATALOG_MANAGER);

    // A timestamp, not a date: `svc.service_versions.effective_from` is a `date` and the
    // gist EXCLUDE ranges over `daterange`, so accepting one would imply a precision the
    // column does not have.
    const timestamped = await publishVersion(
      service.id,
      versionId,
      { effectiveFrom: '2024-06-01T00:00:00Z' },
      service.recordVersion
    );
    expect(timestamped.status).toBe(422);
    expect(await codeOf(timestamped)).toBe('ERR-VAL-001');

    const noKey = await PUBLISH(
      withoutKey(
        `http://localhost/api/v1/services/${service.id}/versions/${versionId}/publication`,
        'POST',
        { effectiveFrom: '2024-06-01' },
        service.recordVersion
      ),
      { params: Promise.resolve({ serviceId: service.id, versionId }) }
    );
    expect(noKey.status).toBe(400);
    expect(await codeOf(noKey)).toBe('ERR-INT-002');

    // Archived is terminal for publication too: an archived service gets no new
    // effective definition, which the trigger set alone does not refuse.
    expect(
      (await updateService(service.id, { lifecycleStatus: 'archived' }, service.recordVersion))
        .status
    ).toBe(200);
    const archived = await publishVersion(
      service.id,
      versionId,
      { effectiveFrom: '2024-06-01' },
      await serviceRecordVersionOf(service.id)
    );
    expect(archived.status).toBe(409);
    expect(await codeOf(archived)).toBe('ERR-TRN-001');
    expect((await serviceVersionRowOf(versionId))?.status).toBe('draft');
  });

  it('requires If-Match on the SERVICE and refuses a stale one', async () => {
    /**
     * `If-Match` carries the SERVICE's `record_version`, not the version's. The service
     * is the row a concurrent editor moves, and it is the row `svc.publish_service_version`
     * locks first — so guarding it is what makes "publish the version of the service I
     * was looking at" mean anything. A published version has no editable state left to
     * guard.
     */
    const { service, versionId } = await withDraft(1, '2024-01-01');
    authAs(SVC_CATALOG_MANAGER);

    const missing = await publishVersion(
      service.id,
      versionId,
      { effectiveFrom: '2024-06-01' },
      null
    );
    expect(missing.status).toBe(428);
    expect(await codeOf(missing)).toBe('ERR-CON-002');

    const stale = await publishVersion(service.id, versionId, { effectiveFrom: '2024-06-01' }, 999);
    expect(stale.status).toBe(409);
    expect(await codeOf(stale)).toBe('ERR-CON-001');

    expect((await serviceVersionRowOf(versionId))?.status).toBe('draft');
    expect(await outboxCountFor(`service.published:${versionId}`)).toBe(0);
  });

  it('never lets a tenant-B caller publish a tenant-A version, nor a branch-scoped holder', async () => {
    const { service, versionId } = await withDraft(1, '2024-01-01');

    // Holds `svc.service.manage` unrestricted — in the other tenant. RLS hides the
    // service, so the refusal is the tenant boundary and not a missing permission.
    authAs(SVC_CATALOG_TENANT_B);
    const asB = await publishVersion(
      service.id,
      versionId,
      { effectiveFrom: '2024-06-01' },
      service.recordVersion
    );
    expect(asB.status).toBe(404);
    expect(await codeOf(asB)).toBe('ERR-RES-001');

    /**
     * Holds the permission IN FULL, scoped to branch A2. Publication changes what every
     * branch in the tenant may sell from a date and is effectively irreversible, so the
     * authority to commit it must not be narrower than its effect — and the declared
     * `scope: 'tenant'` cannot enforce that on its own, because an empty scope target
     * degrades the pre-handler check to the scope-blind `iam.has_permission`.
     */
    authAs(SVC_CATALOG_SCOPED_A2);
    const scoped = await publishVersion(
      service.id,
      versionId,
      { effectiveFrom: '2024-06-01' },
      service.recordVersion
    );
    expect(scoped.status).toBe(403);
    expect(await codeOf(scoped)).toBe('ERR-IAM-001');

    expect((await serviceVersionRowOf(versionId))?.status).toBe('draft');
    expect(await outboxCountFor(`service.published:${versionId}`)).toBe(0);

    // And the unrestricted manager publishes the identical request, so every refusal
    // above is about the caller.
    authAs(SVC_CATALOG_MANAGER);
    expect(
      (
        await publishVersion(
          service.id,
          versionId,
          { effectiveFrom: '2024-06-01' },
          service.recordVersion
        )
      ).status
    ).toBe(200);
  });
});

describe('svc.branch-availability-set', () => {
  it('401 unauthenticated, and 403 for a caller holding only svc.service.read', async () => {
    const service = await managedService();

    __resetAuthenticatorForTests();
    expect(
      (
        await setAvailability(service.id, {
          companyId: COMPANY_A1,
          branchId: BRANCH_A1,
          isAvailable: true,
        })
      ).status
    ).toBe(401);

    authAs(SVC_READER);
    const refused = await setAvailability(service.id, {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      isAvailable: true,
    });
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('ERR-IAM-001');
    expect(await availabilityRowOf(COMPANY_A1, BRANCH_A1, service.id)).toBeNull();
  });

  it('creates then changes the single row for a triple, auditing the transition', async () => {
    const service = await managedService();
    authAs(SVC_CATALOG_MANAGER);

    const first = await setAvailability(service.id, {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      isAvailable: true,
    });
    expect(first.status).toBe(200);
    const created = (await first.json()) as AvailabilityBody;
    expect(created.isAvailable).toBe(true);
    expect(created.status).toBe('active');
    expect(await availabilityRowOf(COMPANY_A1, BRANCH_A1, service.id)).toEqual({
      isAvailable: true,
      status: 'active',
    });

    const second = await setAvailability(service.id, {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      isAvailable: false,
      status: 'inactive',
    });
    expect(second.status).toBe(200);
    const changed = (await second.json()) as AvailabilityBody;
    // The SAME row. `uq_branch_service_availability_service` permits exactly one live
    // row per triple, so this is a state change and not an append to a history — the
    // transition survives only in the audit detail's `previousValue`.
    expect(changed.id).toBe(created.id);
    expect(changed.isAvailable).toBe(false);
    expect(changed.recordVersion).toBe(created.recordVersion + 1);
    expect(await auditCountFor('svc.branch_availability.changed', created.id)).toBe(2);

    // A second branch of the same company gets its own row, so the uniqueness is per
    // triple rather than per service.
    const other = await setAvailability(service.id, {
      companyId: COMPANY_A1,
      branchId: BRANCH_A2,
      isAvailable: true,
    });
    expect(other.status).toBe(200);
    expect(((await other.json()) as AvailabilityBody).id).not.toBe(created.id);
  });

  it('refuses a branch that belongs to another company, and an unknown service', async () => {
    /**
     * `BRANCH_A2_OF_COMPANY_A2` is a real branch of a real company in this tenant, named
     * with `COMPANY_A1`'s id. `iam.has_permission_in_scope` is DISJUNCTIVE across grant
     * rows, so an unrestricted caller — and a scoped one holding either half — passes the
     * scope check on the branch row alone; `fk_branch_service_availability_branch` would
     * refuse the write afterwards, but only after the request was authorized and as a
     * driver error rather than a field-level refusal.
     */
    const service = await managedService();
    authAs(SVC_CATALOG_MANAGER);

    const mismatched = await setAvailability(service.id, {
      companyId: COMPANY_A1,
      branchId: BRANCH_A2_OF_COMPANY_A2,
      isAvailable: true,
    });
    expect(mismatched.status).toBe(422);
    expect(await codeOf(mismatched)).toBe('ERR-VAL-001');
    expect(
      await countRows(admin, 'svc.branch_service_availability', 'service_id = $1', [service.id])
    ).toBe(0);

    // The coherent pair for the same branch is accepted, so the refusal was the pairing
    // and not the branch.
    expect(
      (
        await setAvailability(service.id, {
          companyId: COMPANY_A2,
          branchId: BRANCH_A2_OF_COMPANY_A2,
          isAvailable: true,
        })
      ).status
    ).toBe(200);

    const unknown = await setAvailability('00000000-0000-4000-8000-0000000000fd', {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      isAvailable: true,
    });
    expect(unknown.status).toBe(404);
    expect(await codeOf(unknown)).toBe('ERR-RES-001');
  });

  it('refuses making an archived service available, but allows withdrawing it', async () => {
    const service = await managedService();
    authAs(SVC_CATALOG_MANAGER);
    expect(
      (
        await setAvailability(service.id, {
          companyId: COMPANY_A1,
          branchId: BRANCH_A1,
          isAvailable: true,
        })
      ).status
    ).toBe(200);
    expect(
      (await updateService(service.id, { lifecycleStatus: 'archived' }, service.recordVersion))
        .status
    ).toBe(200);

    // `svc.guard_branch_availability_service_active` refuses exactly this, and the
    // application mirrors it so the caller learns WHICH of the two inputs is the problem.
    const offered = await setAvailability(service.id, {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      isAvailable: true,
    });
    expect(offered.status).toBe(409);
    expect(await codeOf(offered)).toBe('ERR-TRN-001');

    // Withdrawal stays possible — the operation an operator retiring a service actually
    // needs, and the one the trigger deliberately still permits.
    const withdrawn = await setAvailability(service.id, {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      isAvailable: false,
    });
    expect(withdrawn.status).toBe(200);
    expect(await availabilityRowOf(COMPANY_A1, BRANCH_A1, service.id)).toEqual({
      isAvailable: false,
      status: 'active',
    });
  });

  it('refuses a command with no Idempotency-Key, and an unaccepted field', async () => {
    const service = await managedService();
    authAs(SVC_CATALOG_MANAGER);

    const noKey = await SET_AVAILABILITY(
      withoutKey(`http://localhost/api/v1/services/${service.id}/branch-availability`, 'POST', {
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        isAvailable: true,
      }),
      { params: Promise.resolve({ serviceId: service.id }) }
    );
    expect(noKey.status).toBe(400);
    expect(await codeOf(noKey)).toBe('ERR-INT-002');

    // `.strict()` — `serviceId` is a path parameter and naming it in the body would let
    // a caller believe they had redirected the write.
    const extra = await setAvailability(service.id, {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      isAvailable: true,
      serviceId: SERVICE_A,
    });
    expect(extra.status).toBe(422);
    expect(await codeOf(extra)).toBe('ERR-VAL-001');
  });

  it('never lets a tenant-B caller set availability on a tenant-A service', async () => {
    const service = await managedService();

    // Holds `svc.service.manage` unrestricted in tenant B, so the refusal is the tenant
    // boundary. `COMPANY_A1`/`BRANCH_A1` are tenant A's, so nothing in this request is
    // visible to that principal.
    authAs(SVC_CATALOG_TENANT_B);
    const refused = await setAvailability(service.id, {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      isAvailable: true,
    });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(refused.status).toBeLessThan(500);
    expect(
      await countRows(admin, 'svc.branch_service_availability', 'service_id = $1', [service.id])
    ).toBe(0);
  });

  it('isolation: refuses branch A1 for a principal holding svc.service.manage IN FULL in A2', async () => {
    /**
     * The decisive scope case for this phase, and the shape matters more than the result.
     *
     * `SVC_CATALOG_SCOPED_A2` holds `svc.service.manage` — this operation's own and only
     * permission — completely, through a grant scoped to `(COMPANY_A1, BRANCH_A2)`. It
     * also carries the widening grant, an UNRELATED permission scoped to `BRANCH_A1`, so
     * `iam.allowed_branch_ids()` contains A1 and the A1 row below is READABLE and
     * WRITABLE as far as RLS is concerned.
     *
     * That is what makes the refusal informative. A 403 from a MISSING permission proves
     * nothing about scope — a scope-blind implementation returns exactly the same 403 —
     * and a refusal caused by RLS hiding the row proves only that the row was hidden.
     * Here the permission is held and the row is reachable, so the ONLY control left that
     * can refuse an A1-targeted write is `authorizeScope` consulting the grant's scope
     * (P1-18-A-01). Delete that call, or let it fall back to the scope-blind
     * `iam.has_permission`, and this test fails while every other case in this describe
     * still passes.
     *
     * The A2 half is not decoration either: without it the refusal could be a principal
     * that cannot use this endpoint at all.
     */
    const service = await managedService();

    authAs(SVC_CATALOG_MANAGER);
    expect(
      (
        await setAvailability(service.id, {
          companyId: COMPANY_A1,
          branchId: BRANCH_A1,
          isAvailable: true,
        })
      ).status
    ).toBe(200);

    authAs(SVC_CATALOG_SCOPED_A2);
    const outOfScope = await setAvailability(service.id, {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      isAvailable: false,
    });
    expect(outOfScope.status).toBe(403);
    expect(await codeOf(outOfScope)).toBe('ERR-IAM-001');
    // The A1 row still says what the manager left it saying.
    expect(await availabilityRowOf(COMPANY_A1, BRANCH_A1, service.id)).toEqual({
      isAvailable: true,
      status: 'active',
    });

    // In its OWN branch the same principal succeeds, on the same endpoint, with the same
    // permission — so the refusal above is the grant's scope and nothing else.
    const inScope = await setAvailability(service.id, {
      companyId: COMPANY_A1,
      branchId: BRANCH_A2,
      isAvailable: true,
    });
    expect(inScope.status).toBe(200);
    expect(await availabilityRowOf(COMPANY_A1, BRANCH_A2, service.id)).toEqual({
      isAvailable: true,
      status: 'active',
    });
  });
});
