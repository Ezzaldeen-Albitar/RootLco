import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import type { CatalogueResult } from '@/features/vehicles/catalogue-api';
import type { VehicleSearchHit } from '@/features/vehicles/contract';

/**
 * The vehicle screens, in a DOM (`P1-27-QA-001`).
 *
 * ## Why this file exists
 *
 * The CRM screens each had a `.dom` suite from Wave 2 onward. The vehicle
 * screens had **none** — seven screens across Waves 7–12 covered only by contract
 * and adapter tests. Those prove what the functions return; they cannot prove
 * that a screen calls the backend zero times before an operator asks, that a
 * merge affordance is absent from the rendered output, or that a denial reads as
 * a denial rather than as an empty list.
 *
 * `P1-27-QA-001` is "unit **and component** coverage", and the component half
 * was missing on an entire domain. This is that half.
 *
 * The Server Actions are mocked at the module boundary, because a component test
 * cannot call a `'use server'` module — and because what is under test here is
 * the screen's decision about *when* and *whether*, not the call itself.
 */

const searchVehicles = vi.fn();
const listVehicleDuplicates = vi.fn();
const reviewVehicleDuplicateAction = vi.fn();
const listAttributeHistory = vi.fn();

/**
 * The session-bound client factory, mocked so the REAL adapter can be driven.
 *
 * Every case above this line mocks `searchVehicles` itself and never reaches
 * here. The transport cases at the foot of the file do the opposite: they hand
 * the mock the actual adapter and supply a real `ApiClient` over a transport
 * they control, which is the only way a screen can be made to meet a timeout.
 *
 * `authorizedClient` is the one seam that allows it — it is the sole owner of
 * client construction (`server-client.ts`), so replacing it replaces the
 * transport for the whole adapter without the adapter knowing.
 */
const authorizedClient = vi.fn<() => Promise<unknown>>();
vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

vi.mock('@/features/vehicles/api', () => ({
  searchVehicles: (...args: unknown[]) => searchVehicles(...args),
}));
vi.mock('@/features/vehicles/duplicates-api', () => ({
  listVehicleDuplicates: (...args: unknown[]) => listVehicleDuplicates(...args),
  listAttributeHistory: (...args: unknown[]) => listAttributeHistory(...args),
  reviewVehicleDuplicateAction: (...args: unknown[]) => reviewVehicleDuplicateAction(...args),
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const { VehicleSearchScreen } = await import('@/features/vehicles/components/VehicleSearchScreen');
const { VehicleDuplicateReviewScreen } =
  await import('@/features/vehicles/components/VehicleDuplicateReviewScreen');
const { VehicleAttributeHistorySection } =
  await import('@/features/vehicles/components/VehicleAttributeHistorySection');

/**
 * The adapter this file mocks everywhere else, imported for real.
 *
 * `vi.importActual` bypasses the mock for THIS module only; its own imports
 * still resolve through the registry, so `@/lib/api/server-client` above is
 * still the mocked one. That is exactly the arrangement the transport cases
 * need: production adapter, production client, a transport under test control.
 */
const realVehicleApi =
  await vi.importActual<typeof import('@/features/vehicles/api')>('@/features/vehicles/api');
const { ApiClient } = await import('@/lib/api/client');

/**
 * A healthy make catalogue.
 *
 * `VehicleSearchScreen` takes the whole `CatalogueResult` rather than an options
 * array, because the Make column has to tell "the catalogue failed" apart from
 * "this id is not in the catalogue" — those were one indistinguishable `Map`
 * miss, and the column reported both as a permission denial.
 */
const CATALOGUE_OK: CatalogueResult = {
  status: 'ok',
  options: [
    { id: 'make-toyota', scope: 'platform', code: 'TOYOTA', name: 'Toyota', status: 'active' },
  ],
  truncated: false,
  correlationId: null,
};

/**
 * TYPED, and it was not.
 *
 * This fixture reached the screen through `vi.fn()` and a `readonly unknown[]`
 * page, so nothing checked it against `VehicleSearchHit`. It had drifted: it
 * carried `plateNumber`, which the contract does not publish, and omitted the
 * REQUIRED `workshopStatus` — which put a raw message key on screen in three
 * tests that were green the whole time.
 *
 * The annotation is the fix. `tsconfig.json` includes the test tree, so from
 * here the compiler owns this drift rather than a reviewer.
 */
const HIT: VehicleSearchHit = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  displayNumber: 'V-0001',
  vin: 'JH4KA7561PC008269',
  makeId: null,
  modelId: null,
  modelYear: 2019,
  lifecycleStatus: 'active',
  workshopStatus: 'none',
  powertrainCategory: 'ice',
  mergedIntoId: null,
  createdAt: '2026-08-04T10:00:00.000Z',
};

const CANDIDATE = {
  id: 'cand-1',
  vehicleIdA: 'a1b2c3d4-0000-4000-8000-000000000001',
  // The references the operation publishes. The queue names each side by these
  // rather than by its position in the pair (`P1-27-FE-028`).
  displayNumberA: 'V-0001',
  vehicleIdB: 'a1b2c3d4-0000-4000-8000-000000000002',
  displayNumberB: 'V-0002',
  matchScore: '0.930',
  /*
   * The REAL shape, from `scoreComparison` in
   * `apps/api/src/modules/vehicle/domain/vehicle-identity.ts`: a flat array of
   * `{ basis, classification, weight }`.
   *
   * This fixture used to be `{ signals: [{ signal: 'vin_collision', weight: 1 }] }`
   * — an object rather than an array, and carrying the CRM detector's `signal`
   * key rather than the vehicle detector's `basis` key. Neither shape the
   * backend produces. It went unnoticed because the assertion it fed only ran
   * `JSON.stringify` over it and looked for a substring, which any shape
   * containing that word would satisfy.
   */
  matchBasis: [
    { basis: 'vin_collision', classification: 'restricted', weight: 0.7 },
    { basis: 'make_model_year_similarity', classification: 'internal', weight: 0.2 },
  ],
  status: 'open',
  detectedAt: '2026-08-04T10:00:00.000Z',
  reviewedBy: null,
  reviewedAt: null,
};

function page(rows: readonly unknown[], overrides: Record<string, unknown> = {}) {
  return {
    status: 'ok',
    rows,
    nextCursor: null,
    hasMore: false,
    correlationId: 'fixed-correlation-id',
    ...overrides,
  };
}

beforeEach(() => {
  searchVehicles.mockReset();
  listVehicleDuplicates.mockReset();
  reviewVehicleDuplicateAction.mockReset();
  listAttributeHistory.mockReset();
  authorizedClient.mockReset();
  push.mockReset();
  searchVehicles.mockResolvedValue(page([HIT]));
  listVehicleDuplicates.mockResolvedValue(page([CANDIDATE]));
  listAttributeHistory.mockResolvedValue(page([]));
});

describe('vehicle search asks nothing until it is asked', () => {
  const render = (canCreate = false) =>
    renderLtr(
      <VehicleSearchScreen locale="en" messages={en} canCreate={canCreate} makes={CATALOGUE_OK} />
    );

  it('calls the backend zero times on mount', () => {
    render();
    // `expensive-read` is 30 requests per 60 seconds. An unasked query spends
    // one of them to say "here is everything", which is not what a search
    // screen should say before it has been used.
    expect(searchVehicles).not.toHaveBeenCalled();
    expect(screen.getByText(en['vehicles.search.idleTitle'])).toBeInTheDocument();
  });

  it('issues no request while the operator types a VIN', async () => {
    const user = userEvent.setup();
    render();
    await user.type(screen.getByLabelText(en['vehicles.search.vin']), 'JH4KA7561PC008269');
    // Seventeen keystrokes. Search-as-you-type would have spent 17 of 30.
    expect(searchVehicles).not.toHaveBeenCalled();
  });

  it('refuses to search on empty criteria and says why', async () => {
    const user = userEvent.setup();
    render();
    await user.click(screen.getByRole('button', { name: en['vehicles.search.submit'] }));
    expect(searchVehicles).not.toHaveBeenCalled();
    expect(screen.getByText(en['vehicles.search.needCriteria'])).toBeInTheDocument();
  });

  it('searches once the operator supplies a criterion', async () => {
    const user = userEvent.setup();
    render();
    await user.type(screen.getByLabelText(en['vehicles.search.plate']), '12-3456{Enter}');
    await waitFor(() => expect(searchVehicles).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('V-0001')).toBeInTheDocument();
  });

  it('offers the creation link only to an operator who may create', async () => {
    render(false);
    expect(screen.queryByText(en['vehicles.create.title'])).not.toBeInTheDocument();
  });

  /*
   * `P1-27-FE-017` — the Make column must not accuse the operator.
   *
   * The page reduced a five-state catalogue outcome to `status === 'ok' ?
   * options : []`, so a failed catalogue read and an id genuinely absent from a
   * healthy catalogue arrived as the same `Map` miss. The column then printed
   * its one fallback: "Make not available to you" — asserting a permission that
   * cannot be the cause, because `veh.catalogue-make-list` needs the same
   * capability the page already gated on. On a catalogue failure it said it on
   * every row at once.
   *
   * Three renders, three different sentences, from the same unresolved id.
   */
  async function searchWithCatalogue(makes: CatalogueResult) {
    const user = userEvent.setup();
    renderLtr(<VehicleSearchScreen locale="en" messages={en} canCreate={false} makes={makes} />);
    await user.type(screen.getByLabelText(en['vehicles.search.plate']), '12-3456{Enter}');
    await screen.findByText('V-0001');
  }

  const UNRESOLVED: VehicleSearchHit = { ...HIT, makeId: 'make-not-in-this-catalogue' };

  it('says the CATALOGUE failed when the catalogue failed', async () => {
    searchVehicles.mockResolvedValue(page([UNRESOLVED]));
    await searchWithCatalogue({ ...CATALOGUE_OK, status: 'unavailable', options: [] });
    expect(screen.getByText(en['vehicles.create.catalogueUnavailable'])).toBeInTheDocument();
    // The accusation must be gone, not merely joined by a second sentence.
    expect(screen.queryByText('Make not available to you')).not.toBeInTheDocument();
  });

  it('says the catalogue was CUT SHORT when it was truncated', async () => {
    searchVehicles.mockResolvedValue(page([UNRESOLVED]));
    await searchWithCatalogue({ ...CATALOGUE_OK, truncated: true });
    expect(screen.getByText(en['vehicles.create.catalogueTruncated'])).toBeInTheDocument();
  });

  it('says only that the make is UNRECOGNISED when the catalogue is healthy', async () => {
    searchVehicles.mockResolvedValue(page([UNRESOLVED]));
    await searchWithCatalogue(CATALOGUE_OK);
    expect(screen.getByText(en['vehicles.column.makeUnrecognised'])).toBeInTheDocument();
    // This is the only one of the three that is genuinely about the row, and
    // even it does not blame the reader.
    expect(en['vehicles.column.makeUnrecognised']).not.toMatch(/you|permission|access/i);
  });

  it('still resolves a make that IS in the catalogue', async () => {
    // The control. Without it the three cases above would pass against a column
    // that had simply stopped resolving anything.
    searchVehicles.mockResolvedValue(page([{ ...HIT, makeId: 'make-toyota' }]));
    await searchWithCatalogue(CATALOGUE_OK);
    expect(screen.getByText('Toyota')).toBeInTheDocument();
  });

  /*
   * `P1-27-FE-019`. This table listed vehicles and offered no way to open one.
   * The profile route existed and the ONLY links to it in the application were
   * on the duplicate-review queue, so plate assignment, odometer capture,
   * ownership transfer, the electric-drive profile, customer relationships,
   * documents and history were reachable only by an operator who happened to be
   * reviewing a suspected duplicate.
   *
   * The same shape as the unreachable writes, one level up: the screen was
   * built and nothing navigated to it.
   */
  it('opens a found vehicle', async () => {
    const user = userEvent.setup();
    render();
    await user.type(screen.getByLabelText(en['vehicles.search.plate']), '12-3456{Enter}');
    await screen.findByText('V-0001');

    await user.click(screen.getByRole('button', { name: en['vehicles.search.open'] }));
    expect(push).toHaveBeenCalledWith(`/en/vehicles/${HIT.id}`);
  });

  it('navigates by id, never by the reference an operator can read', async () => {
    const user = userEvent.setup();
    render();
    await user.type(screen.getByLabelText(en['vehicles.search.plate']), '12-3456{Enter}');
    await screen.findByText('V-0001');
    await user.click(screen.getByRole('button', { name: en['vehicles.search.open'] }));
    // `V-0001` is a display number, not a route key. Routing on it would 404 on
    // every vehicle whose reference has not been assigned yet.
    expect(push).not.toHaveBeenCalledWith(expect.stringContaining('V-0001'));
  });

  it('renders a denial as a denial, not as an empty result set', async () => {
    const user = userEvent.setup();
    searchVehicles.mockResolvedValue(page([], { status: 'denied' }));
    render();
    await user.type(screen.getByLabelText(en['vehicles.search.plate']), '12-3456{Enter}');
    // "No vehicles found" would tell an operator the record does not exist when
    // the truth is that they may not see it.
    expect(await screen.findByText(en['state.denied.title'])).toBeInTheDocument();
  });

  it('reads a rate limit as "try again shortly" rather than as a fault', async () => {
    // This test FAILED when written, and the code was wrong, not the test.
    // `useServerTable` collapsed every non-denied failure into `error`, so an
    // operator who merely searched faster than 30 times a minute was told the
    // system had broken — throwing away a distinction `STATUS_BY_KIND` computes
    // deliberately, one step before it reached anyone.
    const user = userEvent.setup();
    searchVehicles.mockResolvedValue(page([], { status: 'unavailable' }));
    render();
    await user.type(screen.getByLabelText(en['vehicles.search.plate']), '12-3456{Enter}');
    expect(await screen.findByText(en['state.unavailable.title'])).toBeInTheDocument();
    expect(screen.queryByText(en['state.error.title'])).not.toBeInTheDocument();
  });

  it('offers no Retry on an expired session, because retrying cannot work', async () => {
    const user = userEvent.setup();
    searchVehicles.mockResolvedValue(page([], { status: 'expired' }));
    render();
    await user.type(screen.getByLabelText(en['vehicles.search.plate']), '12-3456{Enter}');
    expect(await screen.findByText(en['state.expired.title'])).toBeInTheDocument();
    // Re-issuing the same request with the same dead session fails identically.
    expect(screen.queryByRole('button', { name: en['state.retry'] })).not.toBeInTheDocument();
  });

  it('shows the correlation reference on the failure an operator reports', async () => {
    // `P1-27-DO-002`. Splitting `unavailable` out of `error` in `QA-002`
    // silently dropped this: `ErrorState` carries a reference and the new
    // `BackendUnavailableState` did not, so the retryable failure — the one
    // somebody actually phones about — became the one with nothing to quote.
    const user = userEvent.setup();
    searchVehicles.mockResolvedValue(
      page([], { status: 'unavailable', correlationId: 'corr-quotable' })
    );
    render();
    await user.type(screen.getByLabelText(en['vehicles.search.plate']), '12-3456{Enter}');
    expect(await screen.findByText('corr-quotable')).toBeInTheDocument();
  });

  it('offers Retry on a transient failure, because retrying can work', async () => {
    const user = userEvent.setup();
    searchVehicles.mockResolvedValue(page([], { status: 'unavailable' }));
    render();
    await user.type(screen.getByLabelText(en['vehicles.search.plate']), '12-3456{Enter}');
    expect(await screen.findByRole('button', { name: en['state.retry'] })).toBeInTheDocument();
  });

  it('RECOVERS when Retry is pressed: it re-reads, and the rows arrive', async () => {
    /*
     * The `recovery` path of the canonical 18-path matrix (`canonical-plan.md`
     * §6), and until now the one path with no executable proof at all.
     *
     * Every other case about Retry asserts that the control is OFFERED or
     * WITHHELD. None pressed it. A button that renders and does nothing passes
     * every one of those assertions, which is precisely the shape this phase has
     * been finding — an affordance proved by its presence rather than its
     * effect.
     *
     * So this drives the whole path: a transient failure, the control, the
     * press, a second read, and the rows on screen. The second `mockResolvedValue`
     * is what makes it recovery rather than a retry that fails again.
     */
    const user = userEvent.setup();
    searchVehicles.mockResolvedValue(page([], { status: 'unavailable' }));
    render();
    await user.type(screen.getByLabelText(en['vehicles.search.plate']), '12-3456{Enter}');

    const retry = await screen.findByRole('button', { name: en['state.retry'] });
    const readsBeforeRetry = searchVehicles.mock.calls.length;

    searchVehicles.mockResolvedValue(page([HIT]));
    await user.click(retry);

    // It re-read. Without this the assertion below could be satisfied by a
    // render that never called the adapter again.
    await waitFor(() => expect(searchVehicles.mock.calls.length).toBeGreaterThan(readsBeforeRetry));
    // And the operator sees the result rather than the failure.
    // The literal, as the sibling cases use: `displayNumber` is `string | null` on
    // the contract, and a matcher cannot take null.
    expect(await screen.findByText('V-0001')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en['state.retry'] })).not.toBeInTheDocument();
  });
});

/**
 * The `timeout` and `cancellation` paths of the canonical 18-path matrix
 * (`canonical-plan.md` §6), driven through the PRODUCTION adapter into a
 * rendered screen.
 *
 * ## Why the matrix carried both as `PARTIAL`
 *
 * "Proved in the shared client, on no screen." `tests/api-client.test.ts` proves
 * `ApiClient` classifies its own deadline as `timeout` and an abort it did not
 * cause as `cancelled`; nothing anywhere proved either classification survives
 * the two translations between the catch block and an operator's eyes —
 * `STATUS_BY_KIND` on the way out of the adapter, then `TableStatus` on the way
 * into `DataTable`. Both of those have already lost a distinction the client
 * computed: `P1-27-QA-002` found every non-denied failure collapsing to `error`,
 * so a rate-limited operator was told the system had broken. A classification
 * proved only at the client is proved one layer below the layer that has the
 * history of dropping it.
 *
 * ## Why these cases mock nothing between the screen and the transport
 *
 * Every other case in this file replaces `searchVehicles` with a resolved
 * `ServerPage`, which means the mapping under test is supplied by the test.
 * These two hand the mock the REAL adapter and replace only `fetch`, so the
 * chain that runs is the shipped one: `VehicleSearchScreen` → `useServerTable` →
 * `searchVehicles` → `ApiClient.#request` → the catch block → `STATUS_BY_KIND` →
 * `DataTable` → the English catalogue. Nothing in it is a fixture except the
 * transport, and the transport is where a timeout comes from in production too.
 *
 * ## What cancellation means on THIS screen, said exactly
 *
 * No P1-27 screen offers a Cancel control and no P1-27 adapter accepts an
 * `AbortSignal` — `searchVehicles` takes `(criteria, request, cursor)` and
 * nothing else. So the cancellation an operator can actually cause here is the
 * one the client's own comment names second: navigating away, which tears down
 * the in-flight request and rejects it with an `AbortError` the client did not
 * raise. That is what the second case drives. It is NOT a proof that a Cancel
 * button behaves, because there is no such button to prove.
 */
describe('a transport outcome an operator can actually meet, end to end', () => {
  /**
   * Short enough that the deadline is what ends the test, rather than the test
   * runner's own patience. The production default is 15 seconds.
   */
  const TIMEOUT_MS = 10;

  /** A transport that never answers, and rejects only when it is aborted. */
  function silent(): typeof fetch {
    return vi.fn((_input: unknown, init?: { signal?: AbortSignal | null }) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        // Spec behaviour: an aborted fetch rejects with the signal's REASON,
        // which here is the `TimeoutError` the client itself constructed. A stub
        // that invented a plain `AbortError` would be testing an easier case
        // than the one the client is written against.
        signal.addEventListener('abort', () => reject(signal.reason as Error), { once: true });
      });
    }) as unknown as typeof fetch;
  }

  /**
   * A transport aborted from OUTSIDE the client — the browser tearing the
   * request down on navigation. Nothing the client did caused it, which is the
   * whole point: `timedOutHere` is false and the reason is an ordinary
   * `AbortError`.
   */
  function abortedElsewhere(): typeof fetch {
    return vi.fn(() =>
      Promise.reject(new DOMException('The user aborted a request.', 'AbortError'))
    ) as unknown as typeof fetch;
  }

  function renderSearchOver(fetchImpl: typeof fetch) {
    searchVehicles.mockImplementation(realVehicleApi.searchVehicles);
    authorizedClient.mockResolvedValue(
      new ApiClient({
        baseUrl: 'https://api.invalid',
        fetchImpl,
        timeoutMs: TIMEOUT_MS,
        // Fixed so the reference the operator is shown can be asserted to be
        // the one this request carried, rather than merely "some text".
        newCorrelationId: () => 'corr-transport',
      })
    );
    return renderLtr(
      <VehicleSearchScreen locale="en" messages={en} canCreate={false} makes={CATALOGUE_OK} />
    );
  }

  async function search() {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(en['vehicles.search.plate']), '12-3456{Enter}');
  }

  it('shows a TIMEOUT as "service unavailable", with the reference to quote', async () => {
    const wire = silent();
    renderSearchOver(wire);
    await search();

    // The copy the operator reads, from the catalogue, not a key.
    expect(await screen.findByText(en['state.unavailable.title'])).toBeInTheDocument();
    // And the reference that ties their phone call to the API's own log. It can
    // only be here if a real client failure produced this state.
    expect(screen.getByText('corr-transport')).toBeInTheDocument();
    // Not "something broke" — a timeout is retryable and says so.
    expect(screen.queryByText(en['state.error.title'])).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: en['state.retry'] })).toBeInTheDocument();

    // The request was genuinely issued and genuinely abandoned by the deadline.
    // Without this the assertions above would also pass against a screen that
    // never called the transport at all. ONE attempt: search is `expensive-read`
    // and the adapter sends `retries: 0`, so a timeout must not become two.
    expect(wire).toHaveBeenCalledTimes(1);
  });

  it('does NOT report a CANCELLED request as a backend outage', async () => {
    const wire = abortedElsewhere();
    renderSearchOver(wire);
    await search();

    // The decisive assertion, and the one the client's catch block exists for:
    // an abort the client did not cause must not put a service-unavailable state
    // on screen. Nothing failed. Telling an operator the backend is down because
    // they navigated away is a false incident, and it is the one they report.
    await waitFor(() =>
      expect(screen.queryByText(en['vehicles.search.idleTitle'])).not.toBeInTheDocument()
    );
    expect(screen.queryByText(en['state.unavailable.title'])).not.toBeInTheDocument();
    // What it IS: `STATUS_BY_KIND` maps `cancelled` to `error`, so the screen
    // settles rather than spinning for ever on a request that will never answer.
    expect(screen.getByText(en['state.error.title'])).toBeInTheDocument();
    expect(wire).toHaveBeenCalledTimes(1);
  });

  it('tells the two apart, which is the only thing that makes either case mean anything', () => {
    // Both cases render a real failure state, so each on its own could be
    // satisfied by a client that classified every abort identically. The two
    // sentences differ, and this asserts the catalogue keeps them different —
    // if these two strings were ever made equal, neither case above could fail.
    expect(en['state.unavailable.title']).not.toBe(en['state.error.title']);
  });
});

describe('the vehicle duplicate queue', () => {
  const render = () => renderLtr(<VehicleDuplicateReviewScreen locale="en" messages={en} />);

  it('lists the outstanding pairs', async () => {
    render();
    await waitFor(() => expect(listVehicleDuplicates).toHaveBeenCalled());
    expect(await screen.findByText('93%')).toBeInTheDocument();
  });

  it('renders NO merge control anywhere, and states why', async () => {
    render();
    await screen.findByText('93%');
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: en['crm.duplicates.review'] }));

    // The decisive assertion. `P1-OD-017` is open, the plan requires the
    // affordance to be ABSENT rather than disabled, and an earlier revision of
    // the CRM panel shipped a working merge form. No control — enabled,
    // disabled or hidden — may exist here.
    for (const element of screen.getAllByRole('button')) {
      expect(element.textContent ?? '').not.toMatch(/merge/i);
    }
    expect(screen.queryByRole('button', { name: /merge/i })).not.toBeInTheDocument();
    expect(
      await screen.findByText(en['vehicles.duplicates.mergePendingDecision'], { exact: false })
    ).toBeInTheDocument();
    expect(screen.getByText('P1-OD-017')).toBeInTheDocument();
  });

  it('offers no rescan control, and says the queue is not refreshed by scanning', async () => {
    render();
    await screen.findByText('93%');
    // `veh.vehicle-duplicate-scan` is a privileged audited write throttled at
    // 30/min. A button here would write audit history on every click.
    for (const element of screen.getAllByRole('button')) {
      expect(element.textContent ?? '').not.toMatch(/scan|rescan/i);
    }
    expect(screen.getByText(en['vehicles.duplicates.scanNote'])).toBeInTheDocument();
  });

  it('offers a decision control only on an open candidate', async () => {
    listVehicleDuplicates.mockResolvedValue(
      page([{ ...CANDIDATE, status: 'dismissed', reviewedAt: '2026-08-04T11:00:00.000Z' }])
    );
    render();
    await screen.findByText('93%');
    // A settled pair cannot be re-decided. The backend refuses, but the control
    // should never have been offered.
    expect(
      screen.queryByRole('button', { name: en['crm.duplicates.review'] })
    ).not.toBeInTheDocument();
  });

  it('closes the open panel when the status filter changes', async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText('93%');
    await user.click(screen.getByRole('button', { name: en['crm.duplicates.review'] }));
    expect(screen.getByText(en['crm.duplicates.dismissHeading'])).toBeInTheDocument();

    // Scoped by label: the table has its own page-size combobox, and
    // `getByRole('combobox')` would find both.
    await user.selectOptions(
      screen.getByLabelText(en['crm.customers.column.status']),
      en['vehicles.duplicateStatus.dismissed']
    );
    // The panel belonged to a row that may not survive the filter. Leaving it
    // open would let a decision land on a candidate no longer on screen.
    await waitFor(() =>
      expect(screen.queryByText(en['crm.duplicates.dismissHeading'])).not.toBeInTheDocument()
    );
  });

  it('RE-READS the queue with the chosen status, not just closes the panel', async () => {
    /*
     * The case above passed while the filter did nothing at all.
     *
     * It asserted only that the decision panel closed — which is `setSelected(null)`
     * in the same `onChange` handler and happens whether or not a read is issued.
     * Meanwhile the status never reached the request: `useServerTable` keys its
     * effect on `TableRequest` plus `loadKey` and deliberately excludes `load`
     * from the dependency array, and `status` is not a `TableRequest` field, so
     * rebuilding `load` moved nothing the effect watches. Two of the select's
     * three options were unreachable — choosing "dismissed" or "merged"
     * re-rendered the same open pairs.
     *
     * So this asserts the FIRST ARGUMENT the adapter is called with, which is
     * the only thing that distinguishes a live filter from a decorative one.
     */
    const user = userEvent.setup();
    render();
    await screen.findByText('93%');

    // The mount read. Asserted so "called with dismissed" cannot pass by the
    // component simply never having read anything.
    expect(listVehicleDuplicates).toHaveBeenCalled();
    expect(listVehicleDuplicates.mock.calls[0]?.[0]).toBe('open');

    await user.selectOptions(
      screen.getByLabelText(en['crm.customers.column.status']),
      en['vehicles.duplicateStatus.dismissed']
    );

    await waitFor(() =>
      expect(
        listVehicleDuplicates.mock.calls.map((call) => call[0]),
        'the status filter issued no read with the chosen status'
      ).toContain('dismissed')
    );
  });

  it('reaches the THIRD state too, and writes nothing while filtering', async () => {
    /*
     * `VEHICLE_DUPLICATE_STATUSES` is `['open', 'dismissed', 'merged']`. The case
     * above proves the second; a filter can be live for one option and dead for
     * another if the select's value is mapped rather than passed, so the third
     * is asserted rather than assumed. It reads "Combined" here and "Merged" in
     * the CRM queue — different words, one state.
     *
     * The second half is the property that makes this queue safe to look at.
     * `veh.vehicle-duplicate-scan` is a privileged audited WRITE that creates
     * candidate rows: a queue that "refreshed" by scanning would write audit
     * history every time somebody changed a filter, and the audit log would fill
     * with people looking rather than people deciding. Opening the queue is
     * already covered; CHANGING THE FILTER was not, and it is the interaction an
     * operator repeats.
     */
    const user = userEvent.setup();
    render();
    await screen.findByText('93%');

    await user.selectOptions(
      screen.getByLabelText(en['crm.customers.column.status']),
      en['vehicles.duplicateStatus.merged']
    );

    await waitFor(() =>
      expect(
        listVehicleDuplicates.mock.calls.map((call) => call[0]),
        'the third status option is decorative'
      ).toContain('merged')
    );
    expect(
      reviewVehicleDuplicateAction,
      'filtering the queue performed a privileged write'
    ).not.toHaveBeenCalled();
  });

  it('returns to page one when the filter changes, so the pager is not left offset', async () => {
    /*
     * `FE-028-01` — introduced by the `loadKey` fix itself.
     *
     * `table-state.ts` states the invariant for the whole module: "Sorting or
     * filtering resets to page one, because staying on page seven of a result
     * set that just changed shape shows the operator an arbitrary window of
     * different data." Every in-request transition honours it.
     *
     * `loadKey` is filter state living OUTSIDE `TableRequest`, and it took only
     * half of that guarantee — `useCursorPages` reset the stack while
     * `request.page` stayed put. `cursorFor(2)` on a one-element stack returns
     * null, so the STALE page number went out with the START cursor and the
     * pager stayed permanently out by one for that filter: "page 2" showing
     * page 1, and Previous to page 1 showing the same rows again.
     *
     * The assertion is the `page` the adapter is CALLED with, because that is
     * the only thing that distinguishes a real reset from a re-render.
     */
    const user = userEvent.setup();
    listVehicleDuplicates.mockResolvedValue(page([CANDIDATE], { hasMore: true }));
    render();
    await screen.findByText('93%');

    await user.click(screen.getByRole('button', { name: en['table.nextPage'] }));
    await waitFor(() =>
      expect(
        listVehicleDuplicates.mock.calls.some(
          (call) => (call[1] as { page?: number } | undefined)?.page === 2
        ),
        'the pager never reached page two, so the case below would prove nothing'
      ).toBe(true)
    );

    await user.selectOptions(
      screen.getByLabelText(en['crm.customers.column.status']),
      en['vehicles.duplicateStatus.dismissed']
    );

    await waitFor(() => {
      const dismissed = listVehicleDuplicates.mock.calls.filter((call) => call[0] === 'dismissed');
      expect(dismissed.length, 'the filter issued no read').toBeGreaterThan(0);
      expect(
        dismissed.every((call) => (call[1] as { page?: number } | undefined)?.page === 1),
        'the new filter was read at a stale page number, so the pager is offset'
      ).toBe(true);
    });
  });

  /**
   * Owner acceptance reversed this test's premise.
   *
   * It used to assert that the panel printed `vin_collision` — the stored
   * evidence, rendered as JSON. The Product Owner's finding: "Duplicate-review
   * screens do not explain, in normal business language, why records may be
   * duplicates." So the requirement is now the opposite, and it is asserted in
   * both directions: the sentence must be there AND the signal name must not.
   */
  it('explains the match in business language', async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText('93%');
    await user.click(screen.getByRole('button', { name: en['crm.duplicates.review'] }));

    expect(screen.getByText(en['vehicles.duplicates.reason.vin'])).toBeInTheDocument();
    expect(screen.getByText(en['vehicles.duplicates.reason.makeModelYear'])).toBeInTheDocument();
    // The system warns; a person decides. The most important sentence here.
    expect(screen.getByText(en['duplicates.warningNotDecision'])).toBeInTheDocument();
  });

  it('renders no internal signal name and no evidence JSON', async () => {
    const user = userEvent.setup();
    const { container } = render();
    await screen.findByText('93%');
    await user.click(screen.getByRole('button', { name: en['crm.duplicates.review'] }));

    const text = container.textContent ?? '';
    for (const signal of [
      'vin_collision',
      'plate_collision',
      'make_model_year_similarity',
      'classification',
      'restricted',
      'weight',
    ]) {
      expect(text, `${signal} reached the screen`).not.toContain(signal);
    }
    // A `<pre>` is how the evidence used to arrive. Nothing renders one now.
    expect(container.querySelector('pre')).toBeNull();
  });

  it('names a confidence band a workshop employee can act on', async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText('93%');
    await user.click(screen.getByRole('button', { name: en['crm.duplicates.review'] }));
    // 0.93 is at or above the vehicle strong band (90).
    expect(screen.getByTestId('match-confidence')).toHaveTextContent(
      en['duplicates.confidence.strong']
    );
  });
});

describe('the attribute-change ledger', () => {
  const entry = (over: Record<string, unknown>) => ({
    id: 'h1',
    fieldCode: 'color',
    oldValue: 'Silver',
    newValue: 'Blue',
    occurredAt: '2026-08-04T10:00:00.000Z',
    actorId: 'u1',
    ...over,
  });

  const render = () =>
    renderLtr(<VehicleAttributeHistorySection locale="en" messages={en} vehicleId="v1" />);

  it('never prints the word null to a reader', async () => {
    listAttributeHistory.mockResolvedValue(
      page([
        entry({ id: 'h1', oldValue: null }),
        entry({ id: 'h2', newValue: null }),
        entry({ id: 'h3', oldValue: null, newValue: null }),
      ])
    );
    const { container } = render();
    await waitFor(() => expect(listAttributeHistory).toHaveBeenCalled());
    await screen.findByText(en['vehicles.history.noDetail']);
    expect(container.textContent ?? '').not.toContain('null');
  });

  it('reads a creation as "set to", not as a change from nothing', async () => {
    listAttributeHistory.mockResolvedValue(page([entry({ oldValue: null })]));
    render();
    expect(
      await screen.findByText(en['vehicles.history.set'], { exact: false })
    ).toBeInTheDocument();
  });

  it('says this is the vehicle’s own details, not a unified timeline', async () => {
    render();
    expect(screen.getByText(en['vehicles.history.scopeNote'])).toBeInTheDocument();
  });

  /*
   * `P1-27-INT-026` (D3). The ledger stores an `actor_id` and the column headed
   * "Changed by" printed that uuid.
   *
   * The producer has since merged (PR #212, head `76e37f0`), so
   * `veh.vehicle-history` now publishes `actorName` and `FE-029` is closed.
   * These cases are UNCHANGED by that, and deliberately so: they drive the
   * CONSUMER through both worlds directly, which is why they passed while the
   * producer was still pending and why they keep their value now. The point was
   * never "a name arrives" — it is that no merge order, in either direction,
   * can put a uuid back on screen.
   *
   * The absent-field case is therefore not dead weight after the merge. A
   * rollback of the producer, an older API in a mixed deployment, or a caller
   * without `iam.user.read` all still produce it.
   *
   * The three cases below are the whole contract: a name is shown when there is
   * one, and the SAME safe sentence when there is not — whether that is because
   * this caller may not be told (`null`) or because the API predates the
   * identity surface (absent). Neither is a licence to print the identifier.
   */
  const ACTOR_UUID = 'c1780000-0000-4000-8000-0000000000a2';

  it('names the person who made the change', async () => {
    listAttributeHistory.mockResolvedValue(
      page([entry({ actorId: ACTOR_UUID, actorName: 'Layla Haddad' })])
    );
    const { container } = render();
    expect(await screen.findByText('Layla Haddad')).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain(ACTOR_UUID);
  });

  it('says "User unavailable" when this caller may not be told', async () => {
    listAttributeHistory.mockResolvedValue(page([entry({ actorId: ACTOR_UUID, actorName: null })]));
    const { container } = render();
    // `null` means the caller lacks `iam.user.read`. The row still renders —
    // one unnameable actor must not hide what happened to the vehicle.
    expect(await screen.findByText(en['vehicles.history.actorUnavailable'])).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain(ACTOR_UUID);
  });

  it('says the same when the field is absent entirely', async () => {
    // An API that predates the identity surface publishes no `actorName` at
    // all. `undefined` must read exactly like `null`, or the fix would print a
    // uuid for the whole window between the two deployments.
    listAttributeHistory.mockResolvedValue(page([entry({ actorId: ACTOR_UUID })]));
    const { container } = render();
    expect(await screen.findByText(en['vehicles.history.actorUnavailable'])).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain(ACTOR_UUID);
  });
});

describe('the same screens in Arabic and RTL', () => {
  it('renders the duplicate queue right-to-left with Arabic copy', async () => {
    renderRtl(<VehicleDuplicateReviewScreen locale="ar" messages={ar} />);
    await waitFor(() => expect(listVehicleDuplicates).toHaveBeenCalled());
    // `dir` lives on `<html>` in the application, and `renderRtl` puts it there
    // rather than on the container — a component asserting its own `dir` would
    // be asserting something the layout, not the component, is responsible for.
    expect(document.documentElement.dir).toBe('rtl');
    // The intro, not the title: the title belongs to the route's `PageHeader`,
    // and this screen printing it too gave the queue two `<h1>`s.
    expect(await screen.findByText(ar['vehicles.duplicates.intro'])).toBeInTheDocument();
    // The score keeps LTR direction inside an RTL row, or "93%" reorders.
    const score = await screen.findByText('93%');
    expect(score.closest('[dir="ltr"]')).not.toBeNull();
  });

  it('renders vehicle search right-to-left with Arabic copy', () => {
    renderRtl(
      <VehicleSearchScreen locale="ar" messages={ar} canCreate={false} makes={CATALOGUE_OK} />
    );
    expect(screen.getByText(ar['vehicles.search.idleTitle'])).toBeInTheDocument();
    // A VIN field must stay LTR even in an RTL layout, or the characters
    // reorder and the operator cannot check what they typed.
    const vin = screen.getByLabelText(ar['vehicles.search.vin']);
    expect(vin.getAttribute('dir')).toBe('ltr');
  });
});

describe('this file is not vacuous', () => {
  it('rendered real screens with real message catalogues', () => {
    // Every assertion above indexes `en`/`ar` by key. A missing key would make
    // `getByText(undefined)` throw rather than pass, but the count is asserted
    // here so a catalogue that lost these entries fails loudly.
    for (const key of [
      'vehicles.search.idleTitle',
      'vehicles.search.needCriteria',
      'vehicles.duplicates.mergePendingDecision',
      'vehicles.duplicates.scanNote',
      'vehicles.history.noDetail',
      'vehicles.history.scopeNote',
    ]) {
      expect(Object.keys(en), key).toContain(key);
      expect(Object.keys(ar), key).toContain(key);
    }
  });
});
