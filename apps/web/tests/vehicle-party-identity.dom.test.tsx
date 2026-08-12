import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';

/**
 * A customer is a person, not an identifier (`P1-27-INT-025`, defect D2).
 *
 * Two vehicle tables held a CRM partner id and printed it: the relationships
 * list under a heading that said "customer", and the ownership history under a
 * heading that said "owner". Both shipped through three Owner acceptance cycles
 * with a source comment explaining, reasonably enough, that the operation
 * published no name.
 *
 * The operation publishes one now. These tests are about the *rendering*, so
 * they render the real sections against the real message catalogues — a source
 * grep would pass on a screen that still printed the uuid somewhere else.
 *
 * ## The uuid assertion is the point
 *
 * Every case asserts the id is **absent from the rendered text**, not merely
 * that a name is present. A cell showing "Layla Haddad (a1b2…)" would satisfy a
 * presence check and still be the defect.
 *
 * ## Four ways to be unnameable, one safe sentence
 *
 * Soft-deleted, merged away, cross-tenant, and out-of-scope all arrive as
 * `partnerName: null` — the backend resolves identity under the caller's own
 * tenant predicate and simply omits what it cannot see. That the four are
 * indistinguishable is deliberate: distinguishing them would leak the existence
 * of a record the caller may not read. They are exercised separately here
 * because each is a different production cause, and all four must produce the
 * sentence rather than the id.
 */

const listRelationships = vi.fn();
const listOwnerships = vi.fn();

vi.mock('@/features/vehicles/relations-api', () => ({
  listRelationships: (...args: unknown[]) => listRelationships(...args),
  setEvProfileAction: vi.fn(),
}));
vi.mock('@/features/vehicles/history-api', () => ({
  listOwnerships: (...args: unknown[]) => listOwnerships(...args),
  listPlates: vi.fn(async () => EMPTY),
  listOdometerReadings: vi.fn(async () => EMPTY),
  assignPlateAction: vi.fn(),
  recordOdometerAction: vi.fn(),
}));

const { RelationshipsSection } =
  await import('@/features/vehicles/components/VehicleRelationsSections');
const { OwnershipSection } = await import('@/features/vehicles/components/VehicleHistorySections');
const { PartyLabel } = await import('@/components/party/PartyLabel');

/** A uuid an operator must never be shown. Distinctive enough to search for. */
const PARTNER_UUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

const EMPTY = {
  status: 'ok',
  rows: [],
  nextCursor: null,
  hasMore: false,
  correlationId: 'fixed-correlation-id',
};

function page(rows: readonly unknown[]) {
  return { ...EMPTY, rows };
}

/** A relationship row, as the operation publishes it after resolution. */
function relationship(over: Record<string, unknown> = {}) {
  return {
    id: 'rel-1',
    partnerId: PARTNER_UUID,
    partnerName: 'Layla Haddad',
    partnerNumber: 'C-000482',
    partnerType: 'individual',
    relationshipRole: 'owner',
    validFrom: '2026-01-01',
    validTo: null,
    active: true,
    allowedActions: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function ownership(over: Record<string, unknown> = {}) {
  return {
    id: 'own-1',
    partnerId: PARTNER_UUID,
    partnerName: 'Layla Haddad',
    partnerNumber: 'C-000482',
    partnerType: 'individual',
    ownershipKind: 'registered_owner',
    validFrom: '2026-01-01',
    validTo: null,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

/** The party a caller cannot resolve: all three display fields are null. */
const UNRESOLVED = { partnerName: null, partnerNumber: null, partnerType: null };

const relationships = () =>
  renderLtr(
    <RelationshipsSection
      locale="en"
      messages={en}
      vehicleId="v1"
      today="2026-08-08"
      canManage={false}
    />
  );

const ownerships = () =>
  renderLtr(<OwnershipSection locale="en" messages={en} vehicleId="v1" today="2026-08-08" />);

beforeEach(() => {
  listRelationships.mockReset();
  listOwnerships.mockReset();
  listRelationships.mockResolvedValue(page([relationship()]));
  listOwnerships.mockResolvedValue(page([ownership()]));
});

describe('PartyLabel on its own, because the rule lives in one component', () => {
  /*
   * The three sections below exercise `PartyLabel` transitively, which is enough
   * to make it WORK and not enough for the QA-001 inventory to see it: nothing
   * imported it, so its name appeared in the test corpus only inside comments,
   * and a substring sweep counted that as coverage.
   *
   * It also has partial states no section fixture produces — a name with no
   * reference, a name with no type — and those are the ones where a careless
   * edit would print `null` or fall back to an id.
   */
  const NAMED = {
    partnerName: 'Layla Haddad',
    partnerNumber: 'C-000482',
    partnerType: 'individual',
  };

  it('renders name, reference and type when all three are known', () => {
    renderLtr(<PartyLabel messages={en} party={NAMED} />);
    expect(screen.getByText('Layla Haddad')).toBeInTheDocument();
    expect(screen.getByText('C-000482')).toBeInTheDocument();
    expect(screen.getByText(en['crm.partyType.individual'])).toBeInTheDocument();
  });

  it('keeps the reference left-to-right so a code does not reorder in Arabic', () => {
    renderRtl(<PartyLabel messages={ar} party={NAMED} />);
    expect(screen.getByText('C-000482')).toHaveAttribute('dir', 'ltr');
  });

  it('says the sentence when the party cannot be resolved', () => {
    const { container } = renderLtr(<PartyLabel messages={en} party={UNRESOLVED} />);
    expect(screen.getByTestId('party-unavailable')).toBeInTheDocument();
    expect(screen.getByText(en['party.unavailable'])).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain('null');
  });

  it('says the same sentence when the field is ABSENT, not merely null', () => {
    /*
     * The type requires all three fields, but the row arrives from the network
     * as a typed CAST rather than a parse — so a backend that does not publish
     * them yet sends `undefined`. A `=== null` check would fall through to the
     * named branch and render an EMPTY cell, which says nothing at all.
     *
     * This is a real window, not a hypothetical: the Backend half of
     * `P1-27-INT-025` is a separate pull request, so if the FRONTEND merges
     * first this is exactly the shape that arrives. (Backend-first has its own
     * window — `develop` renders the raw uuid until the Frontend lands — which
     * is why the guard matters whichever order is chosen.)
     */
    const absent = {} as unknown as Parameters<typeof PartyLabel>[0]['party'];
    renderLtr(<PartyLabel messages={en} party={absent} />);
    expect(screen.getByTestId('party-unavailable')).toBeInTheDocument();
    expect(screen.getByText(en['party.unavailable'])).toBeInTheDocument();
  });

  it('renders a name with no reference and no type without printing null', () => {
    const { container } = renderLtr(
      <PartyLabel
        messages={en}
        party={{ partnerName: 'Layla Haddad', partnerNumber: null, partnerType: null }}
      />
    );
    expect(screen.getByText('Layla Haddad')).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain('null');
    expect(container.textContent?.trim()).toBe('Layla Haddad');
  });

  it('renders a name with a reference but no type', () => {
    const { container } = renderLtr(
      <PartyLabel
        messages={en}
        party={{ partnerName: 'Layla Haddad', partnerNumber: 'C-000482', partnerType: null }}
      />
    );
    expect(screen.getByText('C-000482')).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain('crm.partyType');
  });
});

describe('the relationships table names the customer', () => {
  it('shows an individual by name, reference and type', async () => {
    const { container } = relationships();
    await waitFor(() => expect(listRelationships).toHaveBeenCalled());

    expect(await screen.findByText('Layla Haddad')).toBeInTheDocument();
    expect(screen.getByText('C-000482')).toBeInTheDocument();
    expect(screen.getByText(en['crm.partyType.individual'])).toBeInTheDocument();
    // The assertion that makes the rest mean something.
    expect(container.textContent ?? '').not.toContain(PARTNER_UUID);
  });

  it('shows a company by its name, not by its type alone', async () => {
    listOwnerships.mockResolvedValue(page([]));
    listRelationships.mockResolvedValue(
      page([
        relationship({
          partnerName: 'Al-Rashid Transport Co.',
          partnerNumber: 'C-000900',
          partnerType: 'organization',
        }),
      ])
    );
    const { container } = relationships();

    expect(await screen.findByText('Al-Rashid Transport Co.')).toBeInTheDocument();
    expect(screen.getByText(en['crm.partyType.organization'])).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain(PARTNER_UUID);
  });

  it('says "Customer unavailable" rather than printing the identifier', async () => {
    listRelationships.mockResolvedValue(page([relationship(UNRESOLVED)]));
    const { container } = relationships();

    expect(await screen.findByText(en['party.unavailable'])).toBeInTheDocument();
    // The single most important assertion in this file: the one row the
    // operator has no permission to open is the one that used to print an
    // internal identifier at them.
    expect(container.textContent ?? '').not.toContain(PARTNER_UUID);
  });

  it('renders the row itself — an unnameable party hides nothing else', async () => {
    listRelationships.mockResolvedValue(page([relationship(UNRESOLVED)]));
    relationships();
    await screen.findByText(en['party.unavailable']);
    // Dropping the row, or failing the whole list, would hide a relationship
    // that exists. The role and the dates are still the caller's to see.
    expect(screen.getByText(en['vehicles.role.owner'])).toBeInTheDocument();
    expect(screen.getByText('2026-01-01')).toBeInTheDocument();
  });

  it('names the resolvable parties even when one on the page is not', async () => {
    listRelationships.mockResolvedValue(
      page([
        relationship({ id: 'rel-1' }),
        relationship({ id: 'rel-2', partnerId: 'deleted-party', ...UNRESOLVED }),
        relationship({ id: 'rel-3', partnerName: 'Nadia Kanaan', partnerNumber: 'C-000501' }),
      ])
    );
    const { container } = relationships();

    expect(await screen.findByText('Layla Haddad')).toBeInTheDocument();
    expect(screen.getByText('Nadia Kanaan')).toBeInTheDocument();
    expect(screen.getByText(en['party.unavailable'])).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain('deleted-party');
  });
});

describe('the ownership table names the owner', () => {
  it('shows the owner by name rather than by identifier', async () => {
    const { container } = ownerships();
    await waitFor(() => expect(listOwnerships).toHaveBeenCalled());

    expect(await screen.findByText('Layla Haddad')).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain(PARTNER_UUID);
  });

  it('heads the column "Owner", not "Owner reference"', async () => {
    ownerships();
    await screen.findByText('Layla Haddad');
    // The heading was honest about what the cell held. Now that the cell holds
    // a person, a heading promising a reference would be the false one.
    expect(screen.getByText(en['vehicles.ownership.owner'])).toBeInTheDocument();
    expect(en['vehicles.ownership.owner']).not.toMatch(/reference/i);
  });

  it('states a former owner nobody can name, and keeps the interval', async () => {
    listOwnerships.mockResolvedValue(
      page([
        ownership({ validFrom: '2024-03-01', validTo: '2026-01-01', active: false, ...UNRESOLVED }),
      ])
    );
    const { container } = ownerships();

    expect(await screen.findByText(en['party.unavailable'])).toBeInTheDocument();
    // "Who owned it before" stays answerable as a date range even when the
    // party has since been merged away.
    expect(screen.getByText('2024-03-01')).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain(PARTNER_UUID);
  });
});

describe('four different reasons, one safe sentence', () => {
  /*
   * Each of these is a distinct production cause that reaches the screen as the
   * same three nulls. Enumerated so a future change that started distinguishing
   * them — and therefore leaking which records exist — fails here.
   */
  const causes = ['soft-deleted', 'merged away', 'another tenant', 'out of scope'];

  it.each(causes)('renders %s as the same safe phrase and never an id', async (cause) => {
    listRelationships.mockResolvedValue(
      page([relationship({ partnerId: `party-${cause.replace(/\s/g, '-')}`, ...UNRESOLVED })])
    );
    const { container } = relationships();

    expect(await screen.findByText(en['party.unavailable'])).toBeInTheDocument();
    expect(container.textContent ?? '', cause).not.toContain('party-');
  });
});

describe('the same rule in Arabic', () => {
  it('names the customer in an RTL layout', async () => {
    const { container } = renderRtl(
      <RelationshipsSection
        locale="ar"
        messages={ar}
        vehicleId="v1"
        today="2026-08-08"
        canManage={false}
      />
    );
    await waitFor(() => expect(listRelationships).toHaveBeenCalled());

    expect(document.documentElement.dir).toBe('rtl');
    expect(await screen.findByText('Layla Haddad')).toBeInTheDocument();
    expect(screen.getByText(ar['crm.partyType.individual'])).toBeInTheDocument();
    // The customer reference is latin text inside an Arabic row; without an
    // explicit LTR direction "C-000482" reorders on screen.
    expect(screen.getByText('C-000482').closest('[dir="ltr"]')).not.toBeNull();
    expect(container.textContent ?? '').not.toContain(PARTNER_UUID);
  });

  it('says "customer unavailable" in Arabic, not in English and not as an id', async () => {
    listRelationships.mockResolvedValue(page([relationship(UNRESOLVED)]));
    const { container } = renderRtl(
      <RelationshipsSection
        locale="ar"
        messages={ar}
        vehicleId="v1"
        today="2026-08-08"
        canManage={false}
      />
    );

    expect(await screen.findByText(ar['party.unavailable'])).toBeInTheDocument();
    const text = container.textContent ?? '';
    expect(text).not.toContain(en['party.unavailable']);
    expect(text).not.toContain(PARTNER_UUID);
  });
});

describe('this file is not vacuous', () => {
  it('asserts against a catalogue that really carries the phrase', () => {
    // `getByText(undefined)` throws rather than passes, but a catalogue that
    // lost the key should fail with a sentence rather than a stack trace.
    expect(Object.keys(en)).toContain('party.unavailable');
    expect(Object.keys(ar)).toContain('party.unavailable');
    expect(en['party.unavailable']).not.toBe(ar['party.unavailable']);
  });

  it('uses a fixture id long enough that "absent" means something', () => {
    // A one-character id would be a substring of half the rendered output and
    // the `not.toContain` assertions would fail for the wrong reason — or, if
    // it were absent by luck, pass for the wrong reason.
    expect(PARTNER_UUID).toMatch(/^[0-9a-f-]{36}$/);
  });
});
