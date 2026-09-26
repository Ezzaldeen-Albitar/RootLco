import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import {
  BranchSwitch,
  OTHER_BRANCH,
  TEST_BRANCH,
  TEST_COMPANY,
  branchSnapshot,
  inBranch,
  renderLtr,
  renderRtl,
} from './render';
import type { CatalogueResult } from '@/features/vehicles/catalogue-api';
import { dayIn, rangeOfDays } from '@/lib/branch-time';

/** A healthy make catalogue — see the note in `vehicle-screens.dom.test.tsx`. */
const CATALOGUE_OK: CatalogueResult = {
  status: 'ok',
  options: [],
  truncated: false,
  correlationId: null,
};

/**
 * "I have not searched yet" and "I searched and found nothing" are different
 * facts (`P1-27-FE-002`).
 *
 * ## The defect
 *
 * `DataTable` chose between them with `isNarrowed(request)`, which reads
 * `request.filters` and `request.search`. Both search screens keep their
 * criteria OUTSIDE `TableRequest` — deliberately, so a customer's name never
 * reaches the address bar — and mount the table with `INITIAL_REQUEST`. So
 * `isNarrowed` was permanently false, and a search that matched nothing
 * announced:
 *
 *     Nothing here yet · Once records exist they will be listed here
 *
 * That is a claim about the tenant's entire customer list, made on the evidence
 * of one query that excluded everything. On the customer search it appeared
 * directly above the screen's own correct sentence, in a larger iconed heading —
 * so the false statement was the prominent one.
 *
 * ## What is asserted
 *
 * The wrong sentence is absent, the right one present, and the offered action is
 * the one that helps: create the record that was not found, gated on the
 * permission to create it. In both locales, because a mistranslated empty state
 * is still a wrong empty state.
 *
 * ## The work-order board's search inputs (P1-32)
 *
 * The board gained a number box and a free-text box. They are exercised here,
 * beside the other two search screens, because the claims are the same kind:
 * nothing is read while typing, Enter submits exactly what was typed beside the
 * required branch target, a one-character search is refused before a request,
 * an empty result is a statement about the search, and a denial is a denial.
 */

const searchCustomers = vi.fn();
const searchVehicles = vi.fn();
const listWorkOrders = vi.fn();
const readWorkOrderCatalogue = vi.fn();
const readDashboardSummary = vi.fn();

vi.mock('@/lib/customers/directory-read', () => ({
  searchCustomerDirectoryCancellable: (...a: unknown[]) => searchCustomers(...a),
}));
vi.mock('@/features/vehicles/vehicle-search-read', () => ({
  searchVehiclesCancellable: (...a: unknown[]) => searchVehicles(...a),
}));
vi.mock('@/features/work-orders/api', () => ({
  readWorkOrderCatalogue: (...a: unknown[]) => readWorkOrderCatalogue(...a),
}));
vi.mock('@/features/work-orders/work-order-list-read', () => ({
  listWorkOrdersCancellable: (...a: unknown[]) => listWorkOrders(...a),
}));
vi.mock('@/features/overview/dashboard-summary-read', () => ({
  readDashboardSummaryCancellable: (...a: unknown[]) => readDashboardSummary(...a),
}));

/**
 * A tenant catalogue with a state this repository has never heard of.
 *
 * `awaiting_insurer` is the whole point: it is not one of the nine the platform
 * seeds, so a board that translated states from a list of its own would render
 * the code — or a message key — instead of the name the workshop gave it.
 */
const CATALOGUE_STATES = [
  {
    code: 'open',
    name: 'Open',
    isTerminal: false,
    isClosed: false,
    isCancellation: false,
  },
  {
    code: 'awaiting_insurer',
    name: 'Waiting for the insurer',
    isTerminal: false,
    isClosed: false,
    isCancellation: false,
  },
  {
    code: 'closed',
    name: 'Closed',
    isTerminal: true,
    isClosed: true,
    isCancellation: false,
  },
];

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

/**
 * The session the work-order ROUTE resolves, so the address cases below can
 * invoke it. Nothing else in this file reaches for a session.
 */
let PERMISSIONS: readonly string[] = [];
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({
    permissions: PERMISSIONS,
    email: 'operator@test.local',
    companyIds: [],
    branchIds: [],
  }),
}));

/** The props one element in a route's returned tree carries. */
function propsCarrying(node: unknown, prop: string): Record<string, unknown> | null {
  if (node === null || typeof node !== 'object') return null;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (props && typeof props === 'object' && prop in props) return props;
  const children = props?.['children'];
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = propsCarrying(child, prop);
    if (found) return found;
  }
  return null;
}

const { CustomerSearchScreen } =
  await import('@/features/crm/customers/components/CustomerSearchScreen');
const { VehicleSearchScreen } = await import('@/features/vehicles/components/VehicleSearchScreen');
const { WorkOrderQueueScreen } =
  await import('@/features/work-orders/components/WorkOrderQueueScreen');
const WorkOrderQueuePage = (await import('@/app/[locale]/(dashboard)/work-orders/page'))
  .default as (args: {
  params: Promise<Record<string, string>>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) => Promise<unknown>;

const EMPTY_PAGE = {
  status: 'ok',
  rows: [],
  nextCursor: null,
  hasMore: false,
  correlationId: 'fixed-correlation-id',
};

beforeEach(() => {
  searchCustomers.mockReset();
  searchVehicles.mockReset();
  push.mockReset();
  searchCustomers.mockResolvedValue(EMPTY_PAGE);
  searchVehicles.mockResolvedValue(EMPTY_PAGE);
});

describe('the customer search distinguishes "not searched" from "no match"', () => {
  const render = (canCreate = true) =>
    renderLtr(<CustomerSearchScreen locale="en" messages={en} canCreate={canCreate} />);

  it('says nothing about results before a search is run', () => {
    const { container } = render();
    expect(screen.getByText(en['crm.customers.search.idleTitle'])).toBeInTheDocument();
    const text = container.textContent ?? '';
    expect(text).not.toContain(en['crm.customers.search.noMatch']);
    expect(text).not.toContain(en['state.noResults.title']);
  });

  it('does NOT claim the tenant has no customers after a search that matched none', async () => {
    const user = userEvent.setup();
    const { container } = render();
    await user.type(screen.getByLabelText(en['crm.customers.search.q']), 'Zzz{Enter}');
    await waitFor(() => expect(searchCustomers).toHaveBeenCalled());

    expect(await screen.findByText(en['crm.customers.search.noMatch'])).toBeInTheDocument();
    // The sentence that was wrong. "Nothing here yet · Once records exist they
    // will be listed here" describes an empty tenant, not an empty result.
    const text = container.textContent ?? '';
    expect(text).not.toContain(en['state.empty.title']);
    expect(text).not.toContain(en['state.empty.description']);
  });

  it('offers to create the customer that was not found', async () => {
    const user = userEvent.setup();
    render(true);
    await user.type(screen.getByLabelText(en['crm.customers.search.q']), 'Zzz{Enter}');
    await screen.findByText(en['crm.customers.search.noMatch']);
    expect(screen.getByTestId('add-individual-customer')).toBeInTheDocument();
    expect(screen.getByTestId('add-company-customer')).toBeInTheDocument();
  });

  it('offers nothing to an operator who may not create one', async () => {
    const user = userEvent.setup();
    render(false);
    await user.type(screen.getByLabelText(en['crm.customers.search.q']), 'Zzz{Enter}');
    await screen.findByText(en['crm.customers.search.noMatch']);
    // A control whose only outcome is a 403 is worse than no control.
    expect(screen.queryByTestId('add-individual-customer')).not.toBeInTheDocument();
  });

  it('says it in Arabic too', async () => {
    const user = userEvent.setup();
    const { container } = renderRtl(<CustomerSearchScreen locale="ar" messages={ar} canCreate />);
    await user.type(screen.getByLabelText(ar['crm.customers.search.q']), 'Zzz{Enter}');
    expect(await screen.findByText(ar['crm.customers.search.noMatch'])).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain(ar['state.empty.title']);
  });
});

describe('the vehicle search distinguishes them as well', () => {
  const render = (canCreate = true) =>
    renderLtr(
      <VehicleSearchScreen locale="en" messages={en} canCreate={canCreate} makes={CATALOGUE_OK} />
    );

  it('says nothing about results before a search is run', () => {
    const { container } = render();
    expect(screen.getByText(en['vehicles.search.idleTitle'])).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain(en['vehicles.search.noMatch']);
  });

  it('does NOT claim the tenant has no vehicles after a search that matched none', async () => {
    const user = userEvent.setup();
    const { container } = render();
    await user.type(screen.getByLabelText(en['vehicles.search.plate']), 'ZZ-9999{Enter}');
    await waitFor(() => expect(searchVehicles).toHaveBeenCalled());

    expect(await screen.findByText(en['vehicles.search.noMatch'])).toBeInTheDocument();
    const text = container.textContent ?? '';
    expect(text).not.toContain(en['state.empty.title']);
    expect(text).not.toContain(en['state.empty.description']);
  });

  it('offers to create the vehicle that was not found, when permitted', async () => {
    const user = userEvent.setup();
    render(true);
    await user.type(screen.getByLabelText(en['vehicles.search.plate']), 'ZZ-9999{Enter}');
    await screen.findByText(en['vehicles.search.noMatch']);
    expect(screen.getByTestId('create-vehicle-from-no-results')).toBeInTheDocument();
  });

  it('offers nothing to an operator who may not create one', async () => {
    const user = userEvent.setup();
    render(false);
    await user.type(screen.getByLabelText(en['vehicles.search.plate']), 'ZZ-9999{Enter}');
    await screen.findByText(en['vehicles.search.noMatch']);
    expect(screen.queryByTestId('create-vehicle-from-no-results')).not.toBeInTheDocument();
  });

  it('says it in Arabic too', async () => {
    const user = userEvent.setup();
    const { container } = renderRtl(
      <VehicleSearchScreen locale="ar" messages={ar} canCreate makes={CATALOGUE_OK} />
    );
    await user.type(screen.getByLabelText(ar['vehicles.search.plate']), 'ZZ-9999{Enter}');
    expect(await screen.findByText(ar['vehicles.search.noMatch'])).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain(ar['state.empty.title']);
  });
});

describe('the work-order board reads on arrival and narrows honestly', () => {
  /*
   * The board changed under the Owner directive (`P1-32-PRE-OD-UX`): the Show
   * button is gone, it reads the working branch on mount, the two search boxes
   * became one, and the quick views send exactly the flags the operation
   * publishes. The empty-state claims this file exists for are unchanged and
   * are asserted on the new shape.
   */
  const COMPANY = TEST_COMPANY.id;
  const BRANCH = TEST_BRANCH.id;
  const ROW = {
    id: '33333333-3333-4333-8333-333333333333',
    companyId: COMPANY,
    branchId: BRANCH,
    receptionVisitId: '44444444-4444-4444-8444-444444444444',
    vehicleId: '55555555-5555-4555-8555-555555555555',
    kind: 'ordinary',
    state: 'open',
    partsForwardState: 'none',
    displayNumber: 'WO-000123',
    openedAt: '2026-09-01T09:30:00.000Z',
    recordVersion: 1,
    customer: null,
    vehicle: {
      vehicleId: '55555555-5555-4555-8555-555555555555',
      registrationPlate: 'ABC-1234',
      makeModel: null,
    },
    assignedTechnician: null,
    completedAt: null,
    qualityState: null,
  };

  /** The scope and filters of the most recent read. */
  const lastCall = () => {
    const call = listWorkOrders.mock.calls.at(-1) as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    return { scope: call[0], filters: call[1] };
  };

  beforeEach(() => {
    listWorkOrders.mockReset();
    listWorkOrders.mockResolvedValue({ ...EMPTY_PAGE, rows: [ROW] });
    readWorkOrderCatalogue.mockReset();
    readWorkOrderCatalogue.mockResolvedValue({
      status: 'ok',
      data: { workOrderStates: CATALOGUE_STATES },
      correlationId: null,
    });
    readDashboardSummary.mockReset();
    readDashboardSummary.mockResolvedValue({ status: 'unavailable', correlationId: null });
    window.localStorage.clear();
  });

  const render = (canReachDelivery = false) =>
    renderLtr(
      inBranch(
        <WorkOrderQueueScreen locale="en" messages={en} canReachDelivery={canReachDelivery} />
      )
    );

  it('opens on the work that is still the problem of the workshop', async () => {
    /*
     * The GROUP, not a state code and not an unfiltered board. The route
     * resolves `active` from the tenant catalogue's own flags, so a workshop
     * that defines its own state is covered on the day it defines it.
     */
    render();
    await waitFor(() => expect(listWorkOrders).toHaveBeenCalledTimes(1));
    expect(lastCall().scope).toEqual({ companyId: COMPANY, branchId: BRANCH });
    expect(lastCall().filters).toEqual({ stateGroup: 'active' });
    expect(await screen.findByText('WO-000123')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: new RegExp(en['workOrders.queue.view.active'] as string) })
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('asks for everything only when the operator asks for everything', async () => {
    const user = userEvent.setup();
    render();
    await waitFor(() => expect(listWorkOrders).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: en['workOrders.queue.view.all'] }));
    await waitFor(() => expect(lastCall().filters).toEqual({}));
  });

  it('bounds "finished today" to the completion instant, not to the opened one', async () => {
    /*
     * A different question from "created today", and the platform records it
     * separately: either completion bound narrows the board to finished work by
     * construction, because an unfinished work order has no completion instant.
     */
    const user = userEvent.setup();
    render();
    await waitFor(() => expect(listWorkOrders).toHaveBeenCalledTimes(1));

    await user.click(
      screen.getByRole('button', {
        name: new RegExp(en['workOrders.queue.view.completedToday'] as string),
      })
    );
    const today = dayIn(TEST_BRANCH.timezone);
    const window = rangeOfDays(TEST_BRANCH.timezone, today, today);
    await waitFor(() =>
      expect(lastCall().filters).toEqual({
        completedFrom: window.from,
        completedTo: window.to,
      })
    );
  });

  it('never sends a state code beside a state group', async () => {
    /*
     * The route answers 422 `state_and_group_exclusive` rather than
     * intersecting them. The exclusion is structural: choosing a state moves the
     * view off the one that sends a group, and choosing that view clears the
     * state. So the refusal is unreachable rather than explained.
     */
    const user = userEvent.setup();
    render();
    await waitFor(() => expect(listWorkOrders).toHaveBeenCalledTimes(1));
    expect(lastCall().filters).toEqual({ stateGroup: 'active' });

    await user.selectOptions(
      await screen.findByLabelText(en['workOrders.queue.stateFilter'], { exact: false }),
      'open'
    );
    await waitFor(() => expect(lastCall().filters).toEqual({ state: 'open' }));

    // And back the other way: the view clears the code.
    await user.click(
      screen.getByRole('button', { name: new RegExp(en['workOrders.queue.view.active'] as string) })
    );
    await waitFor(() => expect(lastCall().filters).toEqual({ stateGroup: 'active' }));

    for (const call of listWorkOrders.mock.calls) {
      const filters = call[1] as Record<string, unknown>;
      expect(
        filters['state'] !== undefined && filters['stateGroup'] !== undefined,
        'a code and a group travelled together'
      ).toBe(false);
    }
  });

  it('issues no extra request while the operator is still typing', async () => {
    const user = userEvent.setup();
    render();
    await waitFor(() => expect(listWorkOrders).toHaveBeenCalledTimes(1));
    await user.type(screen.getByLabelText(en['workOrders.queue.searchLabel']), 'ABC');
    // The mount read, and nothing per keystroke.
    expect(listWorkOrders).toHaveBeenCalledTimes(1);
  });

  it('submits the term as typed on Enter, beside the branch scope', async () => {
    const user = userEvent.setup();
    render();
    await waitFor(() => expect(listWorkOrders).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText(en['workOrders.queue.searchLabel']), 'ABC{Enter}');
    // Beside the default view's own group: a search NARROWS the board it is
    // typed into, it does not replace it.
    await waitFor(() => expect(lastCall().filters).toEqual({ stateGroup: 'active', q: 'ABC' }));
    expect(lastCall().scope).toEqual({ companyId: COMPANY, branchId: BRANCH });
  });

  it('refuses a one-character term at the box and never sends it', async () => {
    const user = userEvent.setup();
    render();
    await waitFor(() => expect(listWorkOrders).toHaveBeenCalledTimes(1));
    await user.type(screen.getByLabelText(en['workOrders.queue.searchLabel']), 'A{Enter}');
    expect(await screen.findByText(en['workOrders.queue.searchTooShort'])).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 350));
    for (const call of listWorkOrders.mock.calls) {
      expect((call[1] as Record<string, unknown>)['q']).toBeUndefined();
    }
  });

  it('echoes digits typed on an Arabic keyboard and sends them as typed', async () => {
    const user = userEvent.setup();
    renderRtl(inBranch(<WorkOrderQueueScreen locale="ar" messages={ar} />, { locale: 'ar' }));
    await waitFor(() => expect(listWorkOrders).toHaveBeenCalledTimes(1));
    const box = screen.getByLabelText(ar['workOrders.queue.searchLabel']);
    await user.type(box, '١٢٣');
    expect(screen.getByTestId('digits-echo')).toHaveTextContent('123');
    await user.type(box, '{Enter}');
    await waitFor(() => expect(lastCall().filters['q']).toBe('١٢٣'));
  });

  it('sends exactly the flag a quick view names, and nothing else', async () => {
    const user = userEvent.setup();
    render();
    await waitFor(() => expect(listWorkOrders).toHaveBeenCalledTimes(1));

    for (const [view, flag] of [
      ['mine', 'assignedToMe'],
      ['awaitingApproval', 'awaitingApproval'],
      ['awaitingParts', 'awaitingParts'],
      ['awaitingQuality', 'awaitingQuality'],
      ['readyForDelivery', 'readyForDelivery'],
    ] as const) {
      await user.click(
        screen.getByRole('button', {
          name: new RegExp(en[`workOrders.queue.view.${view}`] as string),
        })
      );
      await waitFor(() => expect(lastCall().filters).toEqual({ [flag]: true }));
    }
  });

  it('bounds "created today" to the branch day rather than to the reader"s', async () => {
    const user = userEvent.setup();
    render();
    await waitFor(() => expect(listWorkOrders).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: en['workOrders.queue.view.openedToday'] }));
    const today = dayIn(TEST_BRANCH.timezone);
    const window = rangeOfDays(TEST_BRANCH.timezone, today, today);
    await waitFor(() =>
      expect(lastCall().filters).toEqual({ openedFrom: window.from, openedTo: window.to })
    );
    // The last instant of the branch's day, written to the microsecond with the
    // branch's offset (Asia/Riyadh, UTC+3 all year).
    expect(lastCall().filters['openedTo']).toBe(`${today}T23:59:59.999999+03:00`);
  });

  it('refuses an inverted opened range at the field and issues no read for it', async () => {
    const user = userEvent.setup();
    render();
    await waitFor(() => expect(listWorkOrders).toHaveBeenCalledTimes(1));
    const calls = listWorkOrders.mock.calls.length;

    const from = screen.getByLabelText(en['workOrders.queue.openedFrom'], { exact: false });
    const to = screen.getByLabelText(en['workOrders.queue.openedTo'], { exact: false });
    await user.type(from, '2026-09-10');
    await user.type(to, '2026-09-01');
    await user.click(screen.getByRole('button', { name: en['workOrders.queue.applyOpenedRange'] }));

    expect(await screen.findByText(en['workOrders.queue.invertedRange'])).toBeInTheDocument();
    expect(to).toHaveAttribute('aria-invalid', 'true');
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(listWorkOrders.mock.calls.length).toBe(calls);
  });

  it('labels a state from the live catalogue rather than from a list in the repository', async () => {
    listWorkOrders.mockResolvedValue({
      ...EMPTY_PAGE,
      rows: [{ ...ROW, state: 'awaiting_insurer' }],
    });
    render();
    // A code the platform does not define, named by the workshop that defined
    // it. A hard-coded table would have rendered the code, or a key. Scoped to
    // the table: the same name is also an option of the filter above it.
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Waiting for the insurer')).toBeInTheDocument();
    expect(within(table).queryByText('awaiting_insurer')).toBeNull();
  });

  it('groups the state filter by the catalogue"s own terminal flag', async () => {
    render();
    await waitFor(() => expect(listWorkOrders).toHaveBeenCalled());
    const select = await screen.findByLabelText(en['workOrders.queue.stateFilter'], {
      exact: false,
    });
    await waitFor(() => expect(within(select).getAllByRole('group').length).toBe(2));
    const groups = within(select).getAllByRole('group');
    expect(
      within(groups[0] as HTMLElement)
        .getAllByRole('option')
        .map((option) => (option as HTMLOptionElement).value)
    ).toEqual(['open', 'awaiting_insurer']);
    expect(
      within(groups[1] as HTMLElement)
        .getAllByRole('option')
        .map((option) => (option as HTMLOptionElement).value)
    ).toEqual(['closed']);
  });

  it('tells three different facts about who is on the car', async () => {
    listWorkOrders.mockResolvedValue({
      ...EMPTY_PAGE,
      rows: [
        { ...ROW, id: 'a', displayNumber: 'WO-1', assignedTechnician: null },
        {
          ...ROW,
          id: 'b',
          displayNumber: 'WO-2',
          assignedTechnician: { id: 't1', displayName: null },
        },
        {
          ...ROW,
          id: 'c',
          displayNumber: 'WO-3',
          assignedTechnician: { id: 't2', displayName: 'Foreman on duty' },
        },
      ],
    });
    render();
    expect(await screen.findByText(en['workOrders.queue.column.unassigned'])).toBeInTheDocument();
    expect(screen.getByText(en['workOrders.queue.column.technicianHidden'])).toBeInTheDocument();
    expect(screen.getByText('Foreman on duty')).toBeInTheDocument();
  });

  const summaryWith = (sections: Record<string, unknown>) => ({
    status: 'ok',
    correlationId: null,
    data: {
      period: { kind: 'today', from: '2026-09-22', to: '2026-09-22', timezone: 'Asia/Riyadh' },
      generatedAt: '2026-09-22T06:00:00.000Z',
      branchIds: [BRANCH],
      sections: {
        receptionsOpened: { status: 'ok', value: 2 },
        activeWorkOrders: { status: 'ok', value: 7 },
        awaitingApproval: { status: 'ok', value: 3 },
        awaitingParts: { status: 'ok', value: 5 },
        readyForDelivery: { status: 'ok', value: 1 },
        completedInPeriod: { status: 'ok', value: 4 },
        workOrdersByState: { status: 'unauthorized' },
        intakeCompletionTrend: { status: 'unauthorized' },
        technicianWorkload: { status: 'unauthorized' },
        lowStock: { status: 'unauthorized' },
        pendingApprovalsCount: { status: 'unauthorized' },
        overdue: { status: 'unavailable', reason: 'nothing to measure lateness against' },
        ...sections,
      },
    },
  });

  it('takes every figure from the aggregate, and names the clock the day was counted on', async () => {
    readDashboardSummary.mockResolvedValue(summaryWith({}));
    render();
    expect(await screen.findByTestId('figure-active')).toHaveTextContent('7');
    expect(screen.getByTestId('figure-completed')).toHaveTextContent('4');
    expect(screen.getByTestId('figure-awaitingApproval')).toHaveTextContent('3');
    expect(screen.getByTestId('figure-awaitingParts')).toHaveTextContent('5');
    expect(screen.getByTestId('figure-readyForDelivery')).toHaveTextContent('1');
    // The aggregate resolves the day on the branch's clock, and a figure headed
    // "finished today" is a claim about a boundary the reader cannot see.
    expect(screen.getByTestId('figure-zone')).toHaveTextContent('Asia/Riyadh');
  });

  it('prints a figure on a chip ONLY where the two count the same set', async () => {
    /*
     * The four that agree, and each agreement is a fact rather than a
     * resemblance: `active` is `!isTerminal` on both sides once
     * `ck_work_order_states_cancellation` is taken into account,
     * `readyForDelivery` is `isClosed && !isCancellation` on both, and
     * `awaitingParts` and `awaitingApproval` are each ONE shared SQL predicate
     * on the backend — the pairing `tests/backend/p1-31-report-engine-work-orders`
     * holds against the board route itself.
     *
     * And the five that do not: nothing publishes a total for `all` or `mine`,
     * the opened and completed figures are counted under a different definition
     * from the windows, and there is no quality section. A number that is not
     * the count of the rows beneath it is exactly the disagreement a chip figure
     * must not carry.
     */
    readDashboardSummary.mockResolvedValue(summaryWith({}));
    render();
    await screen.findByTestId('figure-awaitingParts');

    const catalogue = en as Record<string, string>;
    const label = (view: string) => catalogue[`workOrders.queue.view.${view}`] as string;
    const chip = (view: string) => screen.getByRole('button', { name: new RegExp(label(view)) });

    expect(chip('active')).toHaveTextContent('7');
    expect(chip('readyForDelivery')).toHaveTextContent('1');
    expect(chip('awaitingApproval')).toHaveTextContent('3');
    expect(chip('awaitingParts')).toHaveTextContent('5');

    for (const view of [
      'all',
      'openedToday',
      'completedToday',
      'mine',
      'awaitingQuality',
    ] as const) {
      expect(chip(view).textContent, view).toBe(label(view));
    }

    // The strip still carries every published figure, including the ones no
    // chip may claim, and says plainly what it is about.
    expect(screen.getByTestId('figure-awaitingParts')).toHaveTextContent('5');
    expect(screen.getByTestId('work-order-summary-strip')).toHaveTextContent(
      en['workOrders.queue.figure.note'] as string
    );
  });

  it('tells a withheld figure apart from one that cannot be worked out', async () => {
    readDashboardSummary.mockResolvedValue(
      summaryWith({
        // No permission for the section. A zero would be a false statement about
        // the workshop instead of a true one about the caller.
        awaitingParts: { status: 'unauthorized' },
        // Nothing in the platform the question could be asked of; no permission
        // would change it.
        readyForDelivery: { status: 'unavailable', reason: 'a sentence the server wrote' },
      })
    );
    render();
    expect(await screen.findByTestId('figure-awaitingParts')).toHaveTextContent(
      en['workOrders.queue.figure.withheld'] as string
    );
    expect(screen.getByTestId('figure-readyForDelivery')).toHaveTextContent(
      en['workOrders.queue.figure.unavailable'] as string
    );
    // Neither reads as nought, and the server's own sentence never reaches the
    // screen.
    const strip = screen.getByTestId('work-order-summary-strip');
    expect(strip.textContent ?? '').not.toContain('a sentence the server wrote');
    expect(screen.getByTestId('figure-active')).toHaveTextContent('7');
  });

  it('shows no figure strip at all when the aggregate could not be read', async () => {
    render();
    await waitFor(() => expect(listWorkOrders).toHaveBeenCalled());
    expect(screen.queryByTestId('work-order-summary-strip')).toBeNull();
  });

  it('names what can be done where the next action lands, per view', async () => {
    const user = userEvent.setup();
    render();
    expect(await screen.findByRole('link', { name: en['workOrders.queue.open'] })).toHaveAttribute(
      'href',
      `/en/work-orders/${ROW.id}`
    );

    await user.click(
      screen.getByRole('button', { name: en['workOrders.queue.view.awaitingApproval'] })
    );
    expect(
      await screen.findByRole('link', { name: en['workOrders.queue.openForApproval'] })
    ).toHaveAttribute('href', `/en/work-orders/${ROW.id}`);

    await user.click(
      screen.getByRole('button', { name: en['workOrders.queue.view.readyForDelivery'] })
    );
    expect(
      await screen.findByRole('link', { name: en['workOrders.queue.openForDelivery'] })
    ).toHaveAttribute('href', `/en/work-orders/${ROW.id}`);
  });

  /*
   * THE OFFER IS MADE ON THE DESTINATION'S OWN RULE.
   *
   * `/delivery` refuses an operator who is missing any of `sal.delivery.view`,
   * `wo.work_order.read` or `sal.finance.view` — its page decides before it
   * reads anything. A link offered to everyone on the ready-for-delivery view
   * therefore sent a receptionist holding only the work-order code to a page
   * that could tell them nothing but "you may not see this". The board takes
   * the whole set as one answer from the route that resolved the session, and
   * the two cases below are the two sides of it.
   */
  it('offers the delivery queue on the ready view when the operator may reach it', async () => {
    const user = userEvent.setup();
    render(true);
    await user.click(
      screen.getByRole('button', { name: en['workOrders.queue.view.readyForDelivery'] })
    );
    expect(
      await screen.findByRole('link', { name: en['workOrders.queue.deliveryQueue'] })
    ).toHaveAttribute('href', '/en/delivery');
  });

  it('offers no delivery link at all without the three codes that page requires', async () => {
    const user = userEvent.setup();
    render(false);
    await user.click(
      screen.getByRole('button', { name: en['workOrders.queue.view.readyForDelivery'] })
    );
    // The view itself still works: the rows are there, and only the way through
    // to a page that would refuse them is gone.
    expect(
      await screen.findByRole('link', { name: en['workOrders.queue.openForDelivery'] })
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: en['workOrders.queue.deliveryQueue'] })).toBeNull();
  });

  it('re-targets the board when the branch changes, keeping the filters', async () => {
    /*
     * The stale-branch defect, on the board: one branch's work must never be
     * rendered under another branch's name.
     */
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="use main" />
          <BranchSwitch to={OTHER_BRANCH.id} label="use second" />
          <WorkOrderQueueScreen locale="en" messages={en} />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'use main' }));
    await user.type(screen.getByLabelText(en['workOrders.queue.searchLabel']), 'ABC{Enter}');
    await waitFor(() => expect(lastCall().filters).toEqual({ stateGroup: 'active', q: 'ABC' }));
    expect(await screen.findByText('WO-000123')).toBeInTheDocument();

    listWorkOrders.mockResolvedValue({
      ...EMPTY_PAGE,
      rows: [{ ...ROW, id: 'other-row', displayNumber: 'WO-000999', branchId: OTHER_BRANCH.id }],
    });
    await user.click(screen.getByRole('button', { name: 'use second' }));

    await waitFor(() =>
      expect(lastCall().scope).toEqual({
        companyId: OTHER_BRANCH.companyId,
        branchId: OTHER_BRANCH.id,
      })
    );
    // The filter is what the operator asked for and is not about the branch.
    expect(lastCall().filters).toEqual({ stateGroup: 'active', q: 'ABC' });
    expect(await screen.findByText('WO-000999')).toBeInTheDocument();
    expect(screen.queryByText('WO-000123')).toBeNull();
  });

  it('issues NO read for the branch it just left', async () => {
    /*
     * The defect the hook's version handling closes.
     *
     * The criteria are derived from the working context during render, so they
     * are the new branch's the moment the header moves — but the key the hook
     * FETCHED was the debounced one, and `version` was not debounced. The
     * request that went out was therefore the previous branch's criteria at the
     * new version: a whole read issued for the branch the operator had just
     * left, answered, and rendered under the new branch's heading.
     *
     * Asserted over EVERY call rather than over the last one: a read for the old
     * branch that is later superseded still happened, still spent one of thirty
     * requests, and still showed rows under the wrong heading for as long as it
     * was the newest answer.
     */
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="use main" />
          <BranchSwitch to={OTHER_BRANCH.id} label="use second" />
          <WorkOrderQueueScreen locale="en" messages={en} />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'use main' }));
    await waitFor(() => expect(listWorkOrders).toHaveBeenCalled());

    listWorkOrders.mockClear();
    await user.click(screen.getByRole('button', { name: 'use second' }));
    await waitFor(() => expect(listWorkOrders).toHaveBeenCalled());
    // Waited well past the debounce, so a late read for the old branch would
    // have landed by now.
    await new Promise((resolve) => setTimeout(resolve, 400));

    const branches = listWorkOrders.mock.calls.map(
      (call) => (call[0] as { branchId: string | null }).branchId
    );
    expect(branches).not.toContain(TEST_BRANCH.id);
    expect(branches).toContain(OTHER_BRANCH.id);
  });

  it('asks for every branch of the company on "all my branches"', async () => {
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to="all" label="use all" />
          <WorkOrderQueueScreen locale="en" messages={en} />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'use all' }));
    await waitFor(() =>
      expect(lastCall().scope).toEqual({ companyId: TEST_COMPANY.id, branchId: null })
    );
  });

  it('names the set it lists under "all my branches", never the one-branch ask (QA 1b.4)', async () => {
    /*
     * Browser QA part 7, row 1b.4: listing both branches, the board's Branch
     * field read "Choose one branch in the header to continue" and the strip
     * said its figures covered "the whole branch". The read is a union the
     * server enforces, so the board says what it is showing.
     */
    listWorkOrders.mockResolvedValue({
      ...EMPTY_PAGE,
      rows: [
        ROW,
        { ...ROW, id: 'other-row', displayNumber: 'WO-000999', branchId: OTHER_BRANCH.id },
      ],
    });
    readDashboardSummary.mockResolvedValue(summaryWith({}));
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to="all" label="use all" />
          <WorkOrderQueueScreen locale="en" messages={en} />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'use all' }));

    expect(await screen.findByText('WO-000999')).toBeInTheDocument();
    expect(screen.getByText('WO-000123')).toBeInTheDocument();
    expect(screen.getByTestId('working-branch-field-all')).toHaveTextContent(
      `${en['workingContext.allBranches']} · ${TEST_COMPANY.name}`
    );
    expect(screen.queryByText(en['workingContext.needsOneBranch'])).toBeNull();
    expect(screen.queryByTestId('requires-concrete-branch')).toBeNull();
    expect(screen.queryByTestId('work-order-queue-blocked')).toBeNull();
    const strip = await screen.findByTestId('work-order-summary-strip');
    expect(strip).toHaveTextContent(en['workOrders.queue.figure.noteAllBranches']);
    expect(strip).not.toHaveTextContent(en['workOrders.queue.figure.note']);
  });

  it('names the one branch, and says the figures cover it, once one is chosen', async () => {
    readDashboardSummary.mockResolvedValue(summaryWith({}));
    render();
    const strip = await screen.findByTestId('work-order-summary-strip');
    expect(strip).toHaveTextContent(en['workOrders.queue.figure.note']);
    expect(screen.queryByTestId('working-branch-field-all')).toBeNull();
    expect(screen.getByTestId('working-branch-field')).toHaveTextContent(TEST_BRANCH.name);
  });

  it('says so, and reads nothing, when the branches span more than one company', async () => {
    /*
     * `companyId` is mandatory on this operation and "all my branches" across
     * two companies resolves to none. Picking one would put a board on screen
     * for a company nobody named, so the screen says which control answers it.
     */
    const OTHER_COMPANY_BRANCH = {
      ...OTHER_BRANCH,
      id: '66666666-6666-4666-8666-666666666666',
      companyId: '77777777-7777-4777-8777-777777777777',
      name: 'Another company branch',
    };
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to="all" label="use all" />
          <WorkOrderQueueScreen locale="en" messages={en} />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_COMPANY_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'use all' }));

    expect(await screen.findByTestId('work-order-queue-spans-companies')).toHaveTextContent(
      en['workingContext.spansCompanies'] as string
    );
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(listWorkOrders).not.toHaveBeenCalled();
  });

  it('states an empty result as a statement about the search', async () => {
    listWorkOrders.mockResolvedValue(EMPTY_PAGE);
    const { container } = render();
    expect(await screen.findByText(en['state.noResults.title'])).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain(en['state.empty.title']);
  });

  it('renders a denial as a denial, not as an empty board', async () => {
    listWorkOrders.mockResolvedValue({ ...EMPTY_PAGE, status: 'denied' });
    render();
    expect(await screen.findByText(en['state.denied.title'])).toBeInTheDocument();
  });

  it('renders an ENDED SESSION as itself, with the way back and no Try-again', async () => {
    /*
     * It used to arrive as the generic fault — "Something went wrong" over a
     * button that re-issued the same request with the same dead session, which
     * fails identically every time. It is its own phase now.
     */
    listWorkOrders.mockResolvedValue({ ...EMPTY_PAGE, status: 'expired' });
    render();
    expect(await screen.findByText(en['state.expired.title'])).toBeInTheDocument();
    expect(screen.queryByText(en['state.error.title'])).toBeNull();
    expect(screen.queryByRole('button', { name: en['state.retry'] })).toBeNull();
    expect(screen.getByRole('link', { name: en['auth.backToLogin'] })).toHaveAttribute(
      'href',
      '/en/login'
    );
  });
});

describe('this file is not vacuous', () => {
  it('asserts against the exact sentences the defect produced', () => {
    // If these keys ever disappear the `not.toContain` assertions above would
    // pass against `undefined` and prove nothing.
    for (const key of ['state.empty.title', 'state.empty.description', 'state.noResults.title']) {
      expect(Object.keys(en), key).toContain(key);
      expect(Object.keys(ar), key).toContain(key);
    }
    expect(en['state.empty.title']).not.toBe(en['crm.customers.search.noMatch']);
  });
});

/* -------------------------------------------------------------------------- *
 * Where the board opens when a figure sent the reader here
 * (Owner directive, `P1-32-PRE-OD-UX`)
 * -------------------------------------------------------------------------- */

describe('the work-order board opens where the address says, or says it could not', () => {
  const COMPANY = TEST_COMPANY.id;
  const BRANCH = TEST_BRANCH.id;

  const firstFilters = () =>
    (listWorkOrders.mock.calls.at(0) as [Record<string, unknown>, Record<string, unknown>])[1];

  beforeEach(() => {
    listWorkOrders.mockReset();
    listWorkOrders.mockResolvedValue({ ...EMPTY_PAGE });
    readWorkOrderCatalogue.mockReset();
    readWorkOrderCatalogue.mockResolvedValue({
      status: 'ok',
      data: { workOrderStates: CATALOGUE_STATES },
      correlationId: null,
    });
    readDashboardSummary.mockReset();
    readDashboardSummary.mockResolvedValue({ status: 'unavailable', correlationId: null });
    window.localStorage.clear();
    PERMISSIONS = ['wo.work_order.read'];
  });

  /** The props the ROUTE hands the board, for one address. */
  async function routeProps(query: Record<string, string | string[]>) {
    const tree = await WorkOrderQueuePage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve(query),
    });
    const props = propsCarrying(tree, 'initialView');
    expect(props, 'the route did not render the board').not.toBeNull();
    return props as Record<string, unknown>;
  }

  it('passes a declared view and a well-shaped code through', async () => {
    const props = await routeProps({ view: 'awaitingParts', state: 'awaiting_insurer' });
    expect(props['initialView']).toBe('awaitingParts');
    expect(props['initialState']).toBe('awaiting_insurer');
  });

  it('drops a view it does not declare, and opens the default board', async () => {
    for (const view of ['completedInPeriod', 'ALL', 'nonsense']) {
      expect((await routeProps({ view }))['initialView']).toBe('active');
    }
    expect((await routeProps({}))['initialView']).toBe('active');
  });

  it('drops a state that is not shaped like a code', async () => {
    for (const state of ['In Progress', 'a', '../../etc', '1open']) {
      expect((await routeProps({ state }))['initialState']).toBe('');
    }
  });

  it('reads one value from a repeated parameter rather than a list', async () => {
    const props = await routeProps({
      view: ['awaitingParts', 'mine'],
      state: ['open', 'closed'],
    });
    expect(props['initialView']).toBe('awaitingParts');
    expect(props['initialState']).toBe('open');
  });

  it('sends the arriving view on the first read', async () => {
    renderLtr(
      inBranch(<WorkOrderQueueScreen locale="en" messages={en} initialView="awaitingParts" />)
    );
    await waitFor(() => expect(listWorkOrders).toHaveBeenCalledTimes(1));
    expect(firstFilters()).toEqual({ awaitingParts: true });
  });

  it('asks for nothing while the catalogue has not answered', async () => {
    // A code matching the operation's SHAPE is not thereby a state this
    // workshop keeps. Reading first would show the whole branch for a frame
    // under an address that promised one state.
    readWorkOrderCatalogue.mockReturnValue(new Promise(() => undefined));
    renderLtr(
      inBranch(<WorkOrderQueueScreen locale="en" messages={en} initialState="awaiting_insurer" />)
    );
    await waitFor(() => expect(readWorkOrderCatalogue).toHaveBeenCalled());
    expect(listWorkOrders).not.toHaveBeenCalled();
  });

  it('carries a code the catalogue names, and shows it in the picker', async () => {
    renderLtr(
      inBranch(<WorkOrderQueueScreen locale="en" messages={en} initialState="awaiting_insurer" />)
    );
    await waitFor(() => expect(listWorkOrders).toHaveBeenCalledTimes(1));
    expect(firstFilters()).toEqual({ state: 'awaiting_insurer' });
    expect(
      (screen.getByLabelText(en['workOrders.queue.stateFilter']) as HTMLSelectElement).value
    ).toBe('awaiting_insurer');
    expect(screen.queryByTestId('work-order-queue-state-unknown')).toBeNull();
  });

  it('drops a well-shaped code this workshop does not keep, and says so', async () => {
    renderLtr(
      inBranch(<WorkOrderQueueScreen locale="en" messages={en} initialState="awaiting_dealer" />)
    );
    await waitFor(() => expect(listWorkOrders).toHaveBeenCalledTimes(1));

    // The read carries no state at all — not the code, and not a guess.
    expect(firstFilters()).toEqual({});
    expect(await screen.findByTestId('work-order-queue-state-unknown')).toHaveTextContent(
      en['workOrders.queue.stateNotRecognised'] as string
    );
    expect(
      (screen.getByLabelText(en['workOrders.queue.stateFilter']) as HTMLSelectElement).value
    ).toBe('');
  });

  it('moves an accepted code off the default view, which sends a group', async () => {
    // The list operation refuses a state code and a state group together, so a
    // code arriving with `view=active` opens on every state instead.
    renderLtr(
      inBranch(
        <WorkOrderQueueScreen
          locale="en"
          messages={en}
          initialView="active"
          initialState="awaiting_insurer"
        />
      )
    );
    await waitFor(() => expect(listWorkOrders).toHaveBeenCalledTimes(1));
    expect(firstFilters()).toEqual({ state: 'awaiting_insurer' });
  });

  it('drops the code when the catalogue itself could not be read, and says why', async () => {
    // Unreadable and unknown lead to the same DECISION — nothing established
    // that the workshop keeps this state, so the board must not claim to be
    // filtered by it — but not to the same SENTENCE. Nobody checked the state
    // against the workshop, so "not one this workshop uses" would be false; what
    // is true is that the list could not be loaded and the state was not applied.
    readWorkOrderCatalogue.mockResolvedValue({ status: 'unavailable', correlationId: 'c' });
    renderLtr(
      inBranch(<WorkOrderQueueScreen locale="en" messages={en} initialState="awaiting_insurer" />)
    );
    await waitFor(() => expect(listWorkOrders).toHaveBeenCalledTimes(1));
    expect(firstFilters()).toEqual({});
    expect(await screen.findByTestId('work-order-queue-state-unapplied')).toHaveTextContent(
      en['workOrders.queue.stateListUnavailable'] as string
    );
    expect(screen.queryByTestId('work-order-queue-state-unknown')).toBeNull();
    expect(screen.queryByText(en['workOrders.queue.stateNotRecognised'] as string)).toBeNull();
  });

  it('says the same thing in Arabic when the catalogue could not be read', async () => {
    readWorkOrderCatalogue.mockResolvedValue({ status: 'unavailable', correlationId: 'c' });
    renderRtl(
      inBranch(<WorkOrderQueueScreen locale="ar" messages={ar} initialState="awaiting_insurer" />, {
        locale: 'ar',
      })
    );
    expect(await screen.findByTestId('work-order-queue-state-unapplied')).toHaveTextContent(
      ar['workOrders.queue.stateListUnavailable'] as string
    );
  });

  it('addresses the read to the working branch however it arrived', async () => {
    renderLtr(
      inBranch(<WorkOrderQueueScreen locale="en" messages={en} initialView="awaitingApproval" />)
    );
    await waitFor(() => expect(listWorkOrders).toHaveBeenCalledTimes(1));
    const scope = (listWorkOrders.mock.calls.at(0) as [Record<string, unknown>])[0];
    expect(scope).toEqual({ companyId: COMPANY, branchId: BRANCH });
  });
});
