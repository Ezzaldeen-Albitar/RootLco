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

vi.mock('@/features/crm/customers/api', () => ({
  searchCustomers: (...a: unknown[]) => searchCustomers(...a),
}));
vi.mock('@/features/vehicles/api', () => ({
  searchVehicles: (...a: unknown[]) => searchVehicles(...a),
}));
vi.mock('@/features/work-orders/api', () => ({
  listWorkOrders: (...a: unknown[]) => listWorkOrders(...a),
  readWorkOrderCatalogue: (...a: unknown[]) => readWorkOrderCatalogue(...a),
}));
vi.mock('@/features/overview/api', () => ({
  readDashboardSummary: (...a: unknown[]) => readDashboardSummary(...a),
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

const { CustomerSearchScreen } =
  await import('@/features/crm/customers/components/CustomerSearchScreen');
const { VehicleSearchScreen } = await import('@/features/vehicles/components/VehicleSearchScreen');
const { WorkOrderQueueScreen } =
  await import('@/features/work-orders/components/WorkOrderQueueScreen');

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

  const render = () => renderLtr(inBranch(<WorkOrderQueueScreen locale="en" messages={en} />));

  it('reads the working branch on arrival, with no filter nobody chose', async () => {
    render();
    await waitFor(() => expect(listWorkOrders).toHaveBeenCalledTimes(1));
    expect(lastCall().scope).toEqual({ companyId: COMPANY, branchId: BRANCH });
    expect(lastCall().filters).toEqual({});
    expect(await screen.findByText('WO-000123')).toBeInTheDocument();
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
    await waitFor(() => expect(lastCall().filters).toEqual({ q: 'ABC' }));
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
      await user.click(screen.getByRole('button', { name: en[`workOrders.queue.view.${view}`] }));
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

  it('takes its counts from the aggregate, and shows none for a section it may not read', async () => {
    readDashboardSummary.mockResolvedValue({
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
          awaitingParts: { status: 'unauthorized' },
          readyForDelivery: { status: 'ok', value: 1 },
          completedInPeriod: { status: 'ok', value: 4 },
          workOrdersByState: { status: 'unauthorized' },
          intakeCompletionTrend: { status: 'unauthorized' },
          technicianWorkload: { status: 'unauthorized' },
          lowStock: { status: 'unauthorized' },
          pendingApprovalsCount: { status: 'unauthorized' },
          overdue: { status: 'unauthorized' },
        },
      },
    });
    render();
    const approval = await screen.findByRole('button', {
      name: new RegExp(en['workOrders.queue.view.awaitingApproval']),
    });
    expect(approval).toHaveTextContent('3');
    // Withheld for want of a permission. A zero here would be a false statement
    // about the workshop instead of a true one about the caller.
    const parts = screen.getByRole('button', {
      name: new RegExp(en['workOrders.queue.view.awaitingParts']),
    });
    expect(parts.textContent).toBe(en['workOrders.queue.view.awaitingParts']);

    expect(screen.getByTestId('figure-active')).toHaveTextContent('7');
    expect(screen.getByTestId('figure-completed')).toHaveTextContent('4');
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
    expect(
      screen.getByRole('link', { name: en['workOrders.queue.deliveryQueue'] })
    ).toHaveAttribute('href', '/en/delivery');
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
    await waitFor(() => expect(lastCall().filters).toEqual({ q: 'ABC' }));
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
    expect(lastCall().filters).toEqual({ q: 'ABC' });
    expect(await screen.findByText('WO-000999')).toBeInTheDocument();
    expect(screen.queryByText('WO-000123')).toBeNull();
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
