/**
 * Service catalog reads (Phase 1-20, P1-20-BE-001…003, P1-20-QA-003).
 *
 * The isolation cases are the point of this suite, not an appendix.
 * `GET /api/v1/services` declares `scope: 'branch'` but its path names no branch,
 * so the only thing that makes that declaration real is the service authorizing
 * `availableAtBranchId` as a scope target BEFORE using it as a filter. Without
 * that, `requiresScopedEvaluation` returns false on an empty target whatever the
 * declared scope says, the check degrades to scope-blind `iam.has_permission`, and
 * `app.branch_ids` — the permission-blind union of every active grant — becomes
 * the only narrowing (P1-18-A-01).
 *
 * The `SVC_PERMISSION_ELSEWHERE` case is what proves it: that principal holds
 * `svc.service.read` scoped to A2 and an unrelated permission scoped to A1, so A1
 * IS in its allowed-branch union. A scope-blind implementation serves it A1's
 * catalog; a correct one refuses.
 *
 * Operations exercised here: svc.service-list.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   svc.service-list: route service authorization success denial cross-tenant isolation
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  BRANCH_A1,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { BRANCH_A2, BRANCH_B1, establishP1_19Fixtures } from './p1-19-helpers';
import {
  CATEGORY_A,
  SERVICE_A,
  SERVICE_A_ALT,
  SERVICE_A_ARCHIVED,
  SVC_FULL,
  SVC_PERMISSION_ELSEWHERE,
  SVC_SCOPED_A2,
  SVC_TENANT_B,
  SVC_UNPERMITTED,
  authAs,
  establishP1_20Fixtures,
} from './p1-20-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as LIST } from '@/app/api/v1/services/route';

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
