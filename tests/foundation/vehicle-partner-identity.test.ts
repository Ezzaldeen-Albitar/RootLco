import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Naming the parties a vehicle page shows (`P1-27-INT-025`).
 *
 * ## Why this file exists at all
 *
 * These seven API source files shipped inside the P1-27 **Frontend** branch with
 * no Backend test of any kind. `check-phase-ownership` caught the riding change
 * and the remedy it prescribes — a Backend remediation — is this branch. A
 * Backend change reviewed as Backend needs Backend evidence, and "the Frontend
 * suite is green" is not that: every web test mocks the adapter, so the whole
 * resolution path could return an empty map and 1144 web tests would still pass.
 *
 * ## Why the UNIT tier and not `tests/backend`
 *
 * `vitest.config.backend.ts` states the rule: that tier is for behaviour that
 * only exists once a real PostgreSQL is attached, and "anything measurable
 * without a database belongs to the unit tier's include list, not here."
 * `namePartners` is a pure fold over a map the CRM module returns. The SQL
 * behind `findDisplayIdentities` is database-bound and is not what this file
 * claims to cover.
 *
 * ## The three properties worth pinning
 *
 * 1. **One statement per page, not one per row.** The whole page's ids go in a
 *    single call. Resolving singly would be an N+1 against a bucket sized for
 *    one read per page.
 * 2. **An unresolved partner is three nulls, never the uuid.** A row may point
 *    at a partner this caller cannot see — soft-deleted, merged away, out of
 *    scope, or beyond their CRM entitlement. Falling back to the identifier is
 *    the defect the whole change exists to remove.
 * 3. **`Named<T>` adds fields and preserves the rest.** The page's cursor and
 *    `hasMore` must survive, or naming a page silently truncates it.
 */

const resolveDisplayIdentities = vi.fn();

vi.mock('@/modules/crm', () => ({
  crmModule: () => ({
    customerRead: {
      resolveDisplayIdentities: (...args: unknown[]) => resolveDisplayIdentities(...args),
    },
  }),
}));

const { namePartners } = await import('@api/modules/vehicle/application/partner-identity');
// NOT mocked — the block at the foot of this file drives the real service with a
// fake repository, which is the only way to execute the entitlement check.
const { CustomerReadService } = await import('@api/modules/crm/application/customer-read-service');

const DB = {} as never;

const ALPHA = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const BETA = 'c1780000-0000-4000-8000-0000000000a2';

function page<T>(items: readonly T[], nextCursor: string | null = 'cursor-2', hasMore = true) {
  return { items, nextCursor, hasMore };
}

beforeEach(() => {
  resolveDisplayIdentities.mockReset();
  resolveDisplayIdentities.mockResolvedValue(new Map());
});

describe('a page of parties is resolved in one statement', () => {
  it('sends every partner id on the page in a single call', async () => {
    await namePartners(DB, page([{ partnerId: ALPHA }, { partnerId: BETA }]));
    expect(resolveDisplayIdentities).toHaveBeenCalledTimes(1);
    const [, ids] = resolveDisplayIdentities.mock.calls[0] as [unknown, string[]];
    expect(ids).toEqual([ALPHA, BETA]);
  });

  it('still asks once for an empty page, and returns it unchanged', async () => {
    // The CRM service short-circuits an empty id list itself; what matters here
    // is that an empty page does not become an error or a lost cursor.
    const result = await namePartners(DB, page<{ partnerId: string }>([], null, false));
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
    expect(result.hasMore).toBe(false);
  });
});

describe('an unresolvable party is a sentence, never an identifier', () => {
  it('returns three nulls for a partner the caller cannot see', async () => {
    resolveDisplayIdentities.mockResolvedValue(new Map());
    const result = await namePartners(DB, page([{ partnerId: ALPHA }]));
    expect(result.items[0]).toEqual({
      partnerId: ALPHA,
      partnerName: null,
      partnerNumber: null,
      partnerType: null,
    });
  });

  it('never substitutes the uuid for the missing name', async () => {
    resolveDisplayIdentities.mockResolvedValue(new Map());
    const result = await namePartners(DB, page([{ partnerId: ALPHA }]));
    const named = result.items[0] as Record<string, unknown>;
    expect(named.partnerName).not.toBe(ALPHA);
    expect(named.partnerNumber).not.toBe(ALPHA);
  });

  it('names the resolvable rows and leaves the rest as nulls, in the same page', async () => {
    // The alternative designs are both wrong: failing the whole list hides six
    // good rows because of one, and falling back to the uuid reintroduces the
    // defect precisely where the caller has least right to the identifier.
    resolveDisplayIdentities.mockResolvedValue(
      new Map([
        [
          ALPHA,
          { displayName: 'Layla Haddad', displayNumber: 'C-000482', partyType: 'individual' },
        ],
      ])
    );
    const result = await namePartners(DB, page([{ partnerId: ALPHA }, { partnerId: BETA }]));
    expect(result.items[0]).toMatchObject({
      partnerName: 'Layla Haddad',
      partnerNumber: 'C-000482',
    });
    expect(result.items[1]).toMatchObject({ partnerName: null, partnerNumber: null });
  });

  it('treats a resolved identity with no number or type as partially known', async () => {
    resolveDisplayIdentities.mockResolvedValue(
      new Map([
        [ALPHA, { displayName: 'Al-Rashid Transport Co.', displayNumber: null, partyType: null }],
      ])
    );
    const result = await namePartners(DB, page([{ partnerId: ALPHA }]));
    expect(result.items[0]).toMatchObject({
      partnerName: 'Al-Rashid Transport Co.',
      partnerNumber: null,
      partnerType: null,
    });
  });
});

describe('naming a page does not change the page', () => {
  it('preserves the cursor and hasMore', async () => {
    const result = await namePartners(DB, page([{ partnerId: ALPHA }], 'cursor-9', true));
    expect(result.nextCursor).toBe('cursor-9');
    expect(result.hasMore).toBe(true);
  });

  it('preserves every field the row already carried', async () => {
    resolveDisplayIdentities.mockResolvedValue(new Map());
    const result = await namePartners(
      DB,
      page([{ partnerId: ALPHA, ownershipKind: 'registered_owner', validFrom: '2026-01-01' }])
    );
    expect(result.items[0]).toMatchObject({
      ownershipKind: 'registered_owner',
      validFrom: '2026-01-01',
    });
  });

  it('keeps the rows in the order the repository returned them', async () => {
    // The ordering is the keyset ordering. Rebuilding the page from a map would
    // silently reorder it, which on an ownership HISTORY is a change of meaning.
    resolveDisplayIdentities.mockResolvedValue(new Map());
    const result = await namePartners(DB, page([{ partnerId: BETA }, { partnerId: ALPHA }]));
    expect(result.items.map((row) => row.partnerId)).toEqual([BETA, ALPHA]);
  });
});

describe('this file is not vacuous', () => {
  it('drives the real helper, not a stub of it', async () => {
    // If the mock ever replaced `namePartners` itself rather than the CRM module
    // beneath it, every case above would pass against nothing.
    expect(typeof namePartners).toBe('function');
    resolveDisplayIdentities.mockResolvedValue(new Map());
    await namePartners(DB, page([{ partnerId: ALPHA }]));
    expect(resolveDisplayIdentities).toHaveBeenCalled();
  });
});

describe('the resolver itself — the entitlement check the fold cannot reach', () => {
  /*
   * The block above mocks `@/modules/crm` at the module boundary, so it proves
   * the FOLD and never executes `resolveDisplayIdentities`. That matters more
   * than it sounds: the security argument this whole change rests on lives
   * inside that method, in one line.
   *
   * `veh-ownership-visibility-matrix.md:49` grants a caller holding
   * `veh.vehicle.read` the ownership partner UUID and DENIES them the CRM
   * columns beside it, and `:36-37` reserves widening to the Owner. Both calling
   * operations are guarded by `veh.vehicle.read`, not `crm.customer.read`. So
   * resolving unconditionally would hand a name to a caller the matrix gives an
   * opaque identifier — a widening, dressed as a bug fix.
   *
   * ~20 lines of docblock argue that. Until this block, ZERO tests executed the
   * line that implements it: the guard could have been deleted and the whole
   * root tier stayed green. The service takes its repository by constructor, so
   * reaching it needs no database.
   */
  const NAMED = {
    displayName: 'Layla Haddad',
    displayNumber: 'C-000482',
    partyType: 'individual',
  };

  function serviceWith(mayRead: boolean) {
    const findDisplayIdentities = vi.fn(async () => new Map([[ALPHA, NAMED]]));
    const mayReadCustomers = vi.fn(async () => mayRead);
    const service = new CustomerReadService({
      mayReadCustomers,
      findDisplayIdentities,
    } as never);
    return { service, findDisplayIdentities, mayReadCustomers };
  }

  it('resolves names for a caller who holds the CRM read', async () => {
    const { service, findDisplayIdentities } = serviceWith(true);
    const map = await service.resolveDisplayIdentities(DB, [ALPHA]);
    expect(findDisplayIdentities).toHaveBeenCalledTimes(1);
    expect(map.get(ALPHA)).toEqual(NAMED);
  });

  it('returns an EMPTY map to a caller who does not, and never queries', async () => {
    // The narrowing. An unentitled caller now sees "Customer unavailable" where
    // they used to see a uuid — strictly less information, and the matrix is
    // untouched. `findDisplayIdentities` must not run at all: issuing the query
    // and discarding the rows would be the same widening with extra steps.
    const { service, findDisplayIdentities, mayReadCustomers } = serviceWith(false);
    const map = await service.resolveDisplayIdentities(DB, [ALPHA]);
    expect(mayReadCustomers).toHaveBeenCalledTimes(1);
    expect(findDisplayIdentities).not.toHaveBeenCalled();
    expect(map.size).toBe(0);
  });

  it('asks nothing at all for an empty id list', async () => {
    // One extra statement per page, and only when there is something to resolve.
    const { service, findDisplayIdentities, mayReadCustomers } = serviceWith(true);
    const map = await service.resolveDisplayIdentities(DB, []);
    expect(map.size).toBe(0);
    expect(mayReadCustomers).not.toHaveBeenCalled();
    expect(findDisplayIdentities).not.toHaveBeenCalled();
  });

  it('does not throw for an id it cannot resolve', async () => {
    // Unlike `readCustomer`, which 404s. A relationship may reference a partner
    // the caller cannot see, and that is a sentence for the screen to say — not
    // a request to fail, which would hide six good rows because of one.
    const { service } = serviceWith(true);
    await expect(service.resolveDisplayIdentities(DB, [BETA])).resolves.toBeInstanceOf(Map);
  });
});
