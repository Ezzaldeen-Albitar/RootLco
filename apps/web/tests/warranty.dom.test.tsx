import { act, screen, waitFor, within } from '@testing-library/react';
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

/**
 * The warranty screens, rendered (P1-31, FE-008 warranty record, FE-009 history).
 *
 * The properties under test: both route pages decide before they read; the list
 * reads the branch the operator is working in, on arrival, and asks for nothing at
 * all while no branch is chosen — the branch is the read's target and is the working
 * context's named selection, never a reference typed here; a refusal is drawn as a refusal and
 * never as a branch that has issued nothing; the record shows the terms it was issued
 * under and keeps the two odometer figures apart; the issue control is ABSENT without
 * the code the generation declares and is withheld while the vehicle is still in the
 * workshop; the transition ledger is READ, its oldest row is drawn as a beginning
 * rather than as a gap, and a refusal of it is neither an empty ledger nor a broken
 * record; and every word on screen comes from the catalogue in both reading
 * directions.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

/*
 * A required control's `<label>` carries a decorative asterisk, so its label text is
 * the catalogue string PLUS a character the catalogue does not hold. Anchoring at the
 * start matches the label without asserting the marker, which is a styling decision
 * rather than a property of these screens.
 */
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);

const listWarranties = vi.fn();
const readWarranty = vi.fn();
const listBranches = vi.fn();
const generateWarranty = vi.fn();
const listWarrantyPolicies = vi.fn();
const readWarrantyStatusHistory = vi.fn();
vi.mock('@/features/warranty/warranty-api', () => ({
  listWarranties: (...args: unknown[]) => listWarranties(...args),
  readWarranty: (...args: unknown[]) => readWarranty(...args),
  listBranches: (...args: unknown[]) => listBranches(...args),
  generateWarranty: (...args: unknown[]) => generateWarranty(...args),
  listWarrantyPolicies: (...args: unknown[]) => listWarrantyPolicies(...args),
  readWarrantyStatusHistory: (...args: unknown[]) => readWarrantyStatusHistory(...args),
}));

let PERMISSIONS: readonly string[] = [];
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({ permissions: PERMISSIONS, email: 'advisor@test.local' }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

const { WarrantyListScreen } = await import('@/features/warranty/components/WarrantyListScreen');
const { WarrantyRecordScreen } =
  await import('@/features/warranty/components/WarrantyRecordScreen');
const { GenerateWarrantyPanel } =
  await import('@/features/warranty/components/GenerateWarrantyPanel');

type ListPage = (args: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => Promise<React.ReactNode>;
type RecordPage = (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>;

const WarrantyListPage = (await import('@/app/[locale]/(dashboard)/warranty/page'))
  .default as unknown as ListPage;
const WarrantyRecordPage = (await import('@/app/[locale]/(dashboard)/warranty/[warrantyId]/page'))
  .default as unknown as RecordPage;

const READ = 'wty.warranty.read';

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const WARRANTY_ID = '77777777-7777-4777-8777-777777777777';
const DELIVERY_ID = '33333333-3333-4333-8333-333333333333';
const WORK_ORDER_ID = '44444444-4444-4444-8444-444444444444';
const VEHICLE_ID = '55555555-5555-4555-8555-555555555555';
const JOB_ID = '99999999-9999-4999-8999-999999999999';

const policy = {
  id: '88888888-8888-4888-8888-888888888888',
  policyCode: 'STANDARD-12',
  name: 'Standard cover',
  status: 'active',
};

/** One row of `wty.warranty-policy-list` — the four fields above plus the two it adds. */
const policySummary = { ...policy, companyId: COMPANY_ID, recordVersion: 1 };

/** A plan belonging to ANOTHER company the same caller can reach. */
const otherCompanyPolicy = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  policyCode: 'OTHER-24',
  name: 'Other company cover',
  status: 'active',
  companyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  recordVersion: 1,
};

const row = {
  id: WARRANTY_ID,
  companyId: COMPANY_ID,
  branchId: BRANCH_ID,
  vehicleId: VEHICLE_ID,
  workOrderId: WORK_ORDER_ID,
  deliveryRecordId: DELIVERY_ID,
  status: 'issued',
  startDate: '2026-09-01',
  expiryDate: '2027-09-01',
  odometerAtIssue: '41250.0',
  odometerLimit: '61250.0',
  policy,
  recordVersion: 1,
};

const record = {
  ...row,
  coverage: {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    coveredScope: 'all',
    durationMonths: 12,
    odometerAllowance: '20000.0',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    status: 'active',
  },
  items: [
    {
      id: 'iiiiiiii-iiii-4iii-8iii-iiiiiiiiiiii',
      itemKind: 'service',
      sourceJobId: JOB_ID,
      sourcePartId: null,
      description: 'Brake overhaul',
    },
  ],
  replayed: false,
};

const page = (items: readonly unknown[], hasMore = false, nextCursor: string | null = null) => ({
  status: 'ok' as const,
  rows: items,
  nextCursor,
  hasMore,
  correlationId: 'corr-1',
});

/*
 * The transition ledger (FE-009), as `wty.warranty-status-history` publishes it.
 *
 * `ACTOR_ID` is deliberately a different reference from every other identifier in this
 * file: the actor is an employee and the rows around it are a vehicle, a job and a
 * handover, and a shared constant would let a panel render the wrong one and still
 * pass.
 */
const ACTOR_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

/**
 * The one transition every warranty carries today: the row that wrote it.
 *
 * Nothing in this phase advances a warranty's state, so the live service answers with
 * exactly this row and `hasMore` false. It has no previous state because there is none
 * — not because a value is missing.
 */
const originTransition = {
  id: 'a1111111-1111-4111-8111-111111111111',
  fromStatus: null,
  toStatus: 'issued',
  reason: null,
  actorId: ACTOR_ID,
  occurredAt: '2026-09-01T08:00:00.000Z',
};

/**
 * A second transition, which no writer produces today.
 *
 * It is a fixture and not a claim about the product: the ledger is append-only with no
 * ceiling in its schema, later writers are the subject of later work, and a panel that
 * had only ever been shown one row would be untested for the shape it exists to draw.
 */
const advanceTransition = {
  id: 'b2222222-2222-4222-8222-222222222222',
  fromStatus: 'issued',
  toStatus: 'active',
  reason: 'Cover started at the counter.',
  actorId: ACTOR_ID,
  occurredAt: '2026-09-02T09:30:00.000Z',
};

const ledger = (items: readonly unknown[], hasMore = false, nextCursor: string | null = null) => ({
  status: 'ok' as const,
  data: { warrantyId: WARRANTY_ID, transitions: { items, nextCursor, hasMore } },
  correlationId: 'corr-1',
});

/** The history panel by its own region, so nothing outside it can satisfy a case. */
const historyPanel = (catalogue: Record<string, string> = EN) =>
  screen.getByRole('region', { name: catalogue['warranty.history.heading'] as string });

const refusedList = (status: string) => ({
  status,
  rows: [],
  nextCursor: null,
  hasMore: false,
  correlationId: 'corr-9',
});

beforeEach(() => {
  PERMISSIONS = [READ];
  listWarranties.mockReset();
  readWarranty.mockReset();
  listBranches.mockReset();
  generateWarranty.mockReset();
  listWarrantyPolicies.mockReset();
  readWarrantyStatusHistory.mockReset();
  // The ledger the live service answers with today: one row, and no further page.
  readWarrantyStatusHistory.mockResolvedValue(ledger([originTransition]));
  listWarranties.mockResolvedValue(page([row]));
  readWarranty.mockResolvedValue({ status: 'ok', data: record, correlationId: 'corr-1' });
  listBranches.mockResolvedValue({ status: 'denied', correlationId: 'corr-9' });
  generateWarranty.mockResolvedValue({ status: 'success', created: record, attempt: 1 });
  listWarrantyPolicies.mockResolvedValue({
    status: 'ok',
    data: { policies: { items: [policySummary], nextCursor: null, hasMore: false } },
    correlationId: 'corr-1',
  });
});

/** The panel under its own props, so each case names only what it varies. */
function renderPanel(
  props: {
    readonly deliveryStatus?: string;
    readonly canReadPolicies?: boolean;
    readonly companyId?: string;
  } = {}
) {
  return renderLtr(
    <GenerateWarrantyPanel
      locale="en"
      messages={en as never}
      deliveryId={DELIVERY_ID}
      deliveryCompanyId={props.companyId ?? COMPANY_ID}
      deliveryStatus={props.deliveryStatus ?? 'delivered'}
      canReadPolicies={props.canReadPolicies ?? false}
    />
  );
}

const submit = () => screen.getByRole('button', { name: EN['warranty.generate.submit'] as string });

async function renderListPage(
  search: Record<string, string> = {},
  snapshot = branchSnapshot()
) {
  const tree = await WarrantyListPage({
    params: Promise.resolve({ locale: 'en' }),
    searchParams: Promise.resolve(search),
  });
  // The list is addressed by the working context now, so the page has to be
  // rendered inside one. Rendering it outside is a real state — an operator
  // whose branch list could not be read — and not the one most cases are about.
  return renderLtr(inBranch(tree as React.ReactElement, { snapshot }));
}

async function renderRecordPage() {
  const tree = await WarrantyRecordPage({
    params: Promise.resolve({ locale: 'en', warrantyId: WARRANTY_ID }),
  });
  return renderLtr(tree as React.ReactElement);
}



describe('both route pages decide before they read', () => {
  it('refuses the list without the read code, and asks the backend for nothing', async () => {
    PERMISSIONS = [];
    await renderListPage();
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeInTheDocument();
    expect(listWarranties).not.toHaveBeenCalled();
    // No reference is printed: nothing was logged, because nothing was asked.
    expect(screen.queryByText(EN['state.correlationId'] as string)).not.toBeInTheDocument();
  });

  it('refuses the record without the read code, and asks the backend for nothing', async () => {
    PERMISSIONS = [];
    await renderRecordPage();
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeInTheDocument();
    expect(readWarranty).not.toHaveBeenCalled();
  });

  it('renders the record once the read code is held', async () => {
    await renderRecordPage();
    expect(readWarranty).toHaveBeenCalledWith(WARRANTY_ID);
    expect(screen.getByText(EN['warranty.summary.heading'] as string)).toBeInTheDocument();
  });

  it('states a refusal the BACKEND made with the reference it logged', async () => {
    readWarranty.mockResolvedValue({ status: 'denied', correlationId: 'corr-9' });
    await renderRecordPage();
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeInTheDocument();
    expect(screen.getByText('corr-9')).toBeInTheDocument();
  });

  it('reports a record it could not resolve as missing, disclosing nothing', async () => {
    readWarranty.mockResolvedValue({ status: 'not-found', correlationId: 'corr-9' });
    await renderRecordPage();
    expect(screen.getByText(EN['state.notFound.title'] as string)).toBeInTheDocument();
    expect(screen.queryByText('corr-9')).not.toBeInTheDocument();
  });
});

describe('the list reads the branch the operator is working in, on arrival', () => {
  it('asks for nothing at all while no branch is chosen, and says which control answers', async () => {
    const second = { ...TEST_BRANCH, id: '77777777-7777-4777-8777-777777777777', name: 'Second' };
    await renderListPage({}, branchSnapshot([TEST_BRANCH, second]));
    expect(screen.getByTestId('warranty-list-blocked')).toHaveTextContent(
      EN['workingContext.chooseFirst'] as string
    );
    // Waited out rather than asserted synchronously, so a debounce cannot hide
    // a request that was made after the assertion.
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(listWarranties).not.toHaveBeenCalled();
  });

  it('reads the working branch on first paint, and shows its warranties', async () => {
    await renderListPage();
    await waitFor(() => expect(listWarranties).toHaveBeenCalled());
    expect(listWarranties.mock.calls[0]?.[0]).toEqual({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
    });
    expect(await screen.findByText(policy.name)).toBeInTheDocument();
    expect(screen.getByText(EN['warranty.status.issued'] as string)).toBeInTheDocument();
  });

  it('leaves the branch unnamed when the operator is reading all of them', async () => {
    const user = userEvent.setup();
    const tree = await WarrantyListPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to="all" label="use all" />
          {tree as React.ReactElement}
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'use all' }));
    // The company travels; the branch is deliberately omitted, which is what
    // asks the platform for every branch this operator may read.
    await waitFor(() =>
      expect(listWarranties.mock.calls.at(-1)?.[0]).toEqual({
        companyId: TEST_COMPANY.id,
        branchId: null,
      })
    );
  });

  it('carries a vehicle named in the address into the read, and says so in words', async () => {
    await renderListPage({ vehicleId: VEHICLE_ID });
    await waitFor(() => expect(listWarranties).toHaveBeenCalled());
    expect(listWarranties.mock.calls[0]?.[1]).toEqual({ vehicleId: VEHICLE_ID });
    // The reference is never printed at the operator; the filter is named.
    expect(screen.getByTestId('warranty-vehicle-filter')).toHaveTextContent(
      EN['warranty.filter.oneVehicleOnly'] as string
    );
  });

  it('drops a vehicle in the address that is not shaped like a reference', async () => {
    await renderListPage({ vehicleId: 'not-a-reference' });
    await waitFor(() => expect(listWarranties).toHaveBeenCalled());
    expect(listWarranties.mock.calls[0]?.[1]).toEqual({});
  });

  it('lifts the vehicle filter when the operator asks for every vehicle', async () => {
    const user = userEvent.setup();
    await renderListPage({ vehicleId: VEHICLE_ID });
    await waitFor(() => expect(listWarranties).toHaveBeenCalled());
    await user.click(
      screen.getByRole('button', { name: EN['warranty.filter.showAllVehicles'] as string })
    );
    await waitFor(() => expect(listWarranties.mock.calls.at(-1)?.[1]).toEqual({}));
  });

  it('sends a settled search term as typed', async () => {
    const user = userEvent.setup();
    await renderListPage();
    await waitFor(() => expect(listWarranties).toHaveBeenCalled());
    await user.type(
      screen.getByLabelText(EN['warranty.filter.searchLabel'] as string),
      'ABC-12'
    );
    await user.keyboard('{Enter}');
    await waitFor(() => expect(listWarranties.mock.calls.at(-1)?.[1]).toEqual({ q: 'ABC-12' }));
  });

  it('refuses a one-character term at the box and never sends it', async () => {
    const user = userEvent.setup();
    await renderListPage();
    await waitFor(() => expect(listWarranties).toHaveBeenCalled());
    await user.type(screen.getByLabelText(EN['warranty.filter.searchLabel'] as string), 'A');
    expect(
      await screen.findByText(EN['warranty.filter.searchTooShort'] as string)
    ).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 350));
    for (const call of listWarranties.mock.calls) {
      expect((call[1] as Record<string, unknown>)['q']).toBeUndefined();
    }
  });

  it('draws a branch that has issued none as empty, not as refused', async () => {
    listWarranties.mockResolvedValue(page([]));
    await renderListPage();
    expect(await screen.findByText(EN['state.noResults.title'] as string)).toBeInTheDocument();
    expect(screen.queryByText(EN['state.denied.title'] as string)).not.toBeInTheDocument();
  });

  it('draws a refusal as a refusal, not as an empty branch', async () => {
    listWarranties.mockResolvedValue(refusedList('denied'));
    await renderListPage();
    expect(await screen.findByText(EN['state.denied.title'] as string)).toBeInTheDocument();
    expect(screen.queryByText(EN['state.noResults.title'] as string)).not.toBeInTheDocument();
  });

  it('tells an ended session to sign in again, with no useless retry', async () => {
    /*
     * `SearchPhase` collapses an ended session into `failed`, whose shared arm
     * offers a Try again control that cannot work. The screen renders the
     * expired case itself from the finer status, so the sentence and the absent
     * button are both asserted here.
     */
    listWarranties.mockResolvedValue(refusedList('expired'));
    await renderListPage();
    expect(await screen.findByText(EN['state.expired.title'] as string)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: EN['state.retry'] as string })).toBeNull();
  });

  it('offers another page only when the SERVER says one exists', async () => {
    listWarranties.mockResolvedValue(page([row], true, 'next-cursor'));
    const user = userEvent.setup();
    await renderListPage();
    await screen.findByText(policy.name);
    const next = screen.getByRole('button', { name: EN['table.nextPage'] as string });
    expect(next).toBeEnabled();
    await user.click(next);
    // The cursor goes back exactly as the server minted it.
    await waitFor(() => expect(listWarranties.mock.calls.at(-1)?.[2]).toBe('next-cursor'));
  });

  it('closes the way forward when the server says the set has ended', async () => {
    listWarranties.mockResolvedValue(page([row]));
    await renderListPage();
    await screen.findByText(policy.name);
    expect(screen.getByRole('button', { name: EN['table.nextPage'] as string })).toBeDisabled();
  });
});

describe('the record shows the terms it was issued under', () => {
  it('states the cover window and both odometer figures under their own labels', () => {
    const { messages } = renderLtr(
      <WarrantyRecordScreen locale="en" messages={en as never} warranty={record as never} />
    );
    expect(messages).toBeDefined();
    expect(screen.getByText(EN['warranty.summary.odometerAtIssue'] as string)).toBeInTheDocument();
    expect(screen.getByText(EN['warranty.summary.odometerLimit'] as string)).toBeInTheDocument();
    // The coverage's RELATIVE allowance is a different label from the record's
    // ABSOLUTE ceiling. They are the same column name in two tables and showing them
    // under one label is how a warranty quietly becomes wrong.
    expect(
      screen.getByText(EN['warranty.coverage.odometerAllowance'] as string)
    ).toBeInTheDocument();
    expect(screen.getByText('41250.0')).toBeInTheDocument();
    expect(screen.getByText('61250.0')).toBeInTheDocument();
    expect(screen.getByText('20000.0')).toBeInTheDocument();
  });

  it('names the plan it was issued under, because the read carries it', () => {
    renderLtr(
      <WarrantyRecordScreen locale="en" messages={en as never} warranty={record as never} />
    );
    expect(screen.getByText(policy.name)).toBeInTheDocument();
    expect(screen.getByText(policy.policyCode)).toBeInTheDocument();
  });

  it('lists what the warranty covers', () => {
    renderLtr(
      <WarrantyRecordScreen locale="en" messages={en as never} warranty={record as never} />
    );
    expect(screen.getByText('Brake overhaul')).toBeInTheDocument();
    expect(screen.getByText(EN['warranty.itemKind.service'] as string)).toBeInTheDocument();
    expect(screen.getByText(JOB_ID)).toBeInTheDocument();
  });

  it('states an open-ended coverage window rather than inventing an end date', () => {
    renderLtr(
      <WarrantyRecordScreen locale="en" messages={en as never} warranty={record as never} />
    );
    expect(screen.getByText(EN['warranty.coverage.openEnded'] as string)).toBeInTheDocument();
  });

  it('states that an unlimited distance is unlimited', () => {
    const unlimited = {
      ...record,
      odometerLimit: null,
      coverage: { ...record.coverage, odometerAllowance: null },
    };
    renderLtr(
      <WarrantyRecordScreen locale="en" messages={en as never} warranty={unlimited as never} />
    );
    // Two different absences, worded apart: the record has no ceiling reading, and
    // the coverage grants no bounded allowance. Sharing one sentence would hide
    // which of the two figures is missing.
    expect(screen.getByText(EN['warranty.summary.noDistanceLimit'] as string)).toBeInTheDocument();
    expect(
      screen.getByText(EN['warranty.coverage.unlimitedDistance'] as string)
    ).toBeInTheDocument();
    expect(EN['warranty.summary.noDistanceLimit']).not.toBe(
      EN['warranty.coverage.unlimitedDistance']
    );
  });

  it('prints a state this build does not know as the word the backend sent', () => {
    const unknown = { ...record, status: 'under_review' };
    renderLtr(
      <WarrantyRecordScreen locale="en" messages={en as never} warranty={unknown as never} />
    );
    expect(screen.getByText('under_review')).toBeInTheDocument();
  });
});

describe('the transition ledger is read, and the oldest row is a beginning', () => {
  /*
   * FE-009. The table has existed since `20260724095000_wty_warranty.sql`; until P-18
   * published `wty.warranty-status-history` nothing could read it, and this screen said
   * so rather than composing a sequence from the record's current state (CC-31). These
   * cases are about the panel that now reads it.
   */

  const renderRecord = (locale: 'en' | 'ar' = 'en') =>
    locale === 'ar'
      ? renderRtl(
          <WarrantyRecordScreen locale="ar" messages={ar as never} warranty={record as never} />
        )
      : renderLtr(
          <WarrantyRecordScreen locale="en" messages={en as never} warranty={record as never} />
        );

  /** Wait for the panel's own read, so no case asserts against a loading state. */
  const settled = async () => {
    await waitFor(() => expect(readWarrantyStatusHistory).toHaveBeenCalledWith(WARRANTY_ID));
    await screen.findByRole('region', { name: EN['warranty.history.heading'] as string });
  };

  it('reads the ledger of the record it is showing, and nothing else', async () => {
    renderRecord();
    await settled();
    expect(readWarrantyStatusHistory).toHaveBeenCalledTimes(1);
    expect(readWarrantyStatusHistory).toHaveBeenCalledWith(WARRANTY_ID);
  });

  it('draws the one row every warranty carries today as a beginning, not as a gap', async () => {
    renderRecord();
    await settled();
    const region = historyPanel();
    // The state name sits in the same sentence as the wording around it, so the
    // assertion is on the sentence rather than on a bare label node.
    const origin = within(region).getByText(
      new RegExp(escape(EN['warranty.history.origin'] as string))
    );
    expect(origin).toHaveTextContent(EN['warranty.status.issued'] as string);
    // Nothing synthetic above it. The genesis row has no previous state, so no
    // "moved from" is drawn and no earlier row is invented.
    expect(
      within(region).queryByText(new RegExp(escape(EN['warranty.history.movedFrom'] as string)))
    ).toBeNull();
    expect(within(region).getAllByRole('listitem')).toHaveLength(1);
  });

  it('draws a one-row ledger as a ledger and never as an empty one', async () => {
    // The distinction this case exists for: today the service can only answer with one
    // row, and reporting that as "no history yet" would tell an operator the workshop
    // has recorded nothing when it has recorded everything there is.
    renderRecord();
    await settled();
    const region = historyPanel();
    expect(within(region).queryByText(EN['warranty.history.noneTitle'] as string)).toBeNull();
    expect(within(region).queryByText(EN['state.error.title'] as string)).toBeNull();
  });

  it('reads the same origin row in Arabic, with no English left in it', async () => {
    renderRecord('ar');
    await waitFor(() => expect(readWarrantyStatusHistory).toHaveBeenCalledWith(WARRANTY_ID));
    const region = await screen.findByRole('region', {
      name: AR['warranty.history.heading'] as string,
    });
    const origin = within(region).getByText(
      new RegExp(escape(AR['warranty.history.origin'] as string))
    );
    expect(origin).toHaveTextContent(AR['warranty.status.issued'] as string);
    expect(within(region).queryByText(EN['warranty.history.origin'] as string)).toBeNull();
    expect(within(region).queryByText(EN['warranty.status.issued'] as string)).toBeNull();
  });

  it('keeps the order the server sent, newest first, with the state it moved from', async () => {
    readWarrantyStatusHistory.mockResolvedValue(ledger([advanceTransition, originTransition]));
    renderRecord();
    await settled();
    const rows = within(historyPanel()).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    // Newest first is the SERVER's order and nothing here re-sorts it: a ledger sorted
    // on this side would disagree with the cursor the next page is asked for.
    expect(rows[0]).toHaveTextContent(EN['warranty.history.movedFrom'] as string);
    expect(rows[0]).toHaveTextContent(EN['warranty.status.active'] as string);
    expect(rows[1]).toHaveTextContent(EN['warranty.history.origin'] as string);
    expect(rows[1]).not.toHaveTextContent(EN['warranty.history.movedFrom'] as string);
  });

  it('shows the reason a transition carried, and nothing where it carried none', async () => {
    readWarrantyStatusHistory.mockResolvedValue(ledger([advanceTransition, originTransition]));
    renderRecord();
    await settled();
    const rows = within(historyPanel()).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Cover started at the counter.');
    expect(rows[1]).not.toHaveTextContent('Cover started at the counter.');
  });

  it('shows the actor as the labelled reference it is, never as bare text', async () => {
    // No warranty read resolves an employee to a name, so the identifier is presented
    // as a reference with a label saying what it references — the convention this
    // product already uses for the vehicle above and for the handover ledger. What is
    // asserted is that no identifier reaches the page unlabelled.
    renderRecord();
    await settled();
    const region = historyPanel();
    expect(within(region).getByText(EN['warranty.history.actor'] as string)).toBeInTheDocument();
    const actor = within(region).getByText(ACTOR_ID);
    expect(actor.tagName).toBe('CODE');
    // An identifier is not language: it reads left-to-right in both directions.
    expect(actor).toHaveAttribute('dir', 'ltr');
    // The envelope names the warranty it answers for; the panel shows the ledger and
    // not the subject, which the screen around it already states.
    expect(within(region).queryByText(WARRANTY_ID)).toBeNull();
  });

  it('keeps the actor reference left-to-right inside a right-to-left screen', async () => {
    renderRecord('ar');
    await waitFor(() => expect(readWarrantyStatusHistory).toHaveBeenCalled());
    const region = await screen.findByRole('region', {
      name: AR['warranty.history.heading'] as string,
    });
    expect(within(region).getByText(ACTOR_ID)).toHaveAttribute('dir', 'ltr');
  });

  it('offers another page only when the SERVER says one exists', async () => {
    readWarrantyStatusHistory.mockResolvedValue(ledger([originTransition], true, 'next-cursor'));
    const user = userEvent.setup();
    renderRecord();
    await settled();
    const more = within(historyPanel()).getByRole('button', {
      name: EN['warranty.history.loadMore'] as string,
    });
    await user.click(more);
    await waitFor(() => expect(readWarrantyStatusHistory.mock.calls.length).toBeGreaterThan(1));
    // The cursor goes back exactly as the server minted it, and is never parsed here.
    expect(readWarrantyStatusHistory.mock.calls[1]?.[1]).toEqual({ cursor: 'next-cursor' });
  });

  it('offers no further page when the server has declared the end of the set', async () => {
    renderRecord();
    await settled();
    expect(
      within(historyPanel()).queryByRole('button', {
        name: EN['warranty.history.loadMore'] as string,
      })
    ).toBeNull();
  });

  it('draws a refusal of the ledger as a refusal, not as a warranty without history', async () => {
    readWarrantyStatusHistory.mockResolvedValue({ status: 'denied', correlationId: 'corr-9' });
    renderRecord();
    await settled();
    const region = historyPanel();
    expect(within(region).getByText(EN['state.denied.title'] as string)).toBeInTheDocument();
    expect(within(region).getByText('corr-9')).toBeInTheDocument();
    expect(within(region).queryByText(EN['warranty.history.noneTitle'] as string)).toBeNull();
    // The panel reads its own subresource, so its failure keeps everything above it.
    expect(screen.getByText(EN['warranty.summary.heading'] as string)).toBeInTheDocument();
  });

  it('reports a ledger the backend would not resolve as missing, disclosing nothing', async () => {
    readWarrantyStatusHistory.mockResolvedValue({ status: 'not-found', correlationId: 'corr-9' });
    renderRecord();
    await settled();
    const region = historyPanel();
    expect(within(region).getByText(EN['state.notFound.title'] as string)).toBeInTheDocument();
    expect(within(region).queryByText('corr-9')).toBeNull();
  });

  it('states an unreachable backend as unavailable, with the reference it logged', async () => {
    readWarrantyStatusHistory.mockResolvedValue({ status: 'unavailable', correlationId: 'corr-9' });
    renderRecord();
    await settled();
    const region = historyPanel();
    expect(within(region).getByText(EN['state.unavailable.title'] as string)).toBeInTheDocument();
    expect(within(region).getByText('corr-9')).toBeInTheDocument();
  });

  it('says an empty page is empty rather than drawing a ledger with no rows', async () => {
    /*
     * The live service cannot produce this today: every warranty carries its genesis
     * transition, so the first page always holds at least one row. It is asserted
     * anyway because the panel has to distinguish THREE things — a refusal, an empty
     * page and a page of rows — and a branch that is never exercised is a branch that
     * would be written wrong on the day a later writer makes it reachable.
     */
    readWarrantyStatusHistory.mockResolvedValue(ledger([]));
    renderRecord();
    await settled();
    const region = historyPanel();
    expect(
      within(region).getByText(EN['warranty.history.noneTitle'] as string)
    ).toBeInTheDocument();
    expect(within(region).queryAllByRole('listitem')).toHaveLength(0);
    expect(within(region).queryByText(EN['state.denied.title'] as string)).toBeNull();
  });

  it('prints a state this build does not know as the word the backend sent', async () => {
    readWarrantyStatusHistory.mockResolvedValue(
      ledger([{ ...originTransition, toStatus: 'under_review' }])
    );
    renderRecord();
    await settled();
    expect(within(historyPanel()).getByText('under_review')).toBeInTheDocument();
  });

  it('sends an ended session to sign in again rather than reporting a fault', async () => {
    readWarrantyStatusHistory.mockResolvedValue({ status: 'expired', correlationId: null });
    renderRecord();
    await settled();
    const region = historyPanel();
    expect(within(region).getByText(EN['state.expired.title'] as string)).toBeInTheDocument();
    // Nothing was logged for a session that had already ended, so no reference is drawn.
    expect(within(region).queryByText(EN['state.correlationId'] as string)).toBeNull();
  });

  it('falls back to the shared failure wording for anything else', async () => {
    readWarrantyStatusHistory.mockResolvedValue({ status: 'error', correlationId: 'corr-9' });
    renderRecord();
    await settled();
    const region = historyPanel();
    expect(within(region).getByText(EN['state.error.title'] as string)).toBeInTheDocument();
    expect(within(region).getByText('corr-9')).toBeInTheDocument();
  });

  /*
   * A FURTHER page that fails, one case per outcome.
   *
   * Each is its own case because the five are told apart only by the status the read
   * answered with, and a single case would leave four mappings unmeasured. The
   * regression each of them guards is one the panel actually shipped with: the failure
   * used to be rendered by composing `state.${status}.title`, which is a catalogue key
   * for four of the five and NOT a key for `not-found` — `state.not-found.title` is
   * not in either catalogue, and a missing key renders AS the key, so an operator whose
   * second page could not be resolved was shown that dotted string. Every case below
   * therefore asserts the localised sentence AND the absence of a composed key.
   */
  const FURTHER_PAGE_OUTCOMES = [
    ['denied', 'state.denied.title'],
    ['not-found', 'state.notFound.title'],
    ['unavailable', 'state.unavailable.title'],
    ['expired', 'state.expired.title'],
    ['error', 'state.error.title'],
  ] as const;

  /** Load a first page that offers another, then fail the page it asks for. */
  const failFurtherPage = async (status: string) => {
    readWarrantyStatusHistory
      .mockResolvedValueOnce(ledger([originTransition], true, 'next-cursor'))
      .mockResolvedValueOnce({ status, correlationId: 'corr-9' });
    const user = userEvent.setup();
    renderRecord();
    await settled();
    await user.click(
      within(historyPanel()).getByRole('button', {
        name: EN['warranty.history.loadMore'] as string,
      })
    );
    await waitFor(() => expect(readWarrantyStatusHistory).toHaveBeenCalledTimes(2));
    return historyPanel();
  };

  for (const [status, titleKey] of FURTHER_PAGE_OUTCOMES) {
    it(`states a further page refused as ${status} in the operator's own language`, async () => {
      const region = await failFurtherPage(status);
      expect(await within(region).findByText(EN[titleKey] as string)).toBeInTheDocument();
      // The defect this case exists for: a key composed from the status.
      expect(within(region).queryByText(`state.${status}.title`)).toBeNull();
    });
  }

  it('keeps the rows already on screen when a further page fails', async () => {
    // The operator keeps their place. Wiping the ledger to report a transient fault
    // loses what they were reading for no benefit.
    const region = await failFurtherPage('unavailable');
    expect(await within(region).findByText(EN['state.unavailable.title'] as string)).toBeVisible();
    expect(within(region).getAllByRole('listitem')).toHaveLength(1);
    expect(
      within(region).getByText(EN['warranty.history.origin'] as string, { exact: false })
    ).toBeInTheDocument();
  });

  it('prints the reference the backend logged for a further page it refused', async () => {
    const region = await failFurtherPage('denied');
    expect(await within(region).findByText('corr-9')).toBeInTheDocument();
  });

  it('offers nothing clickable when the server claims a page it publishes no cursor for', async () => {
    /*
     * A response that says another page exists and names no cursor describes a page
     * that cannot be asked for. The control is drawn from whether a request can be
     * MADE, not from the claim alone: a button whose only possible outcome is nothing
     * happening teaches an operator that the screen is broken.
     */
    readWarrantyStatusHistory.mockResolvedValue(ledger([originTransition], true, null));
    renderRecord();
    await settled();
    const region = historyPanel();
    expect(
      within(region).queryByRole('button', { name: EN['warranty.history.loadMore'] as string })
    ).toBeNull();
    // The rows it did answer with are still shown; only the control is withheld.
    expect(within(region).getAllByRole('listitem')).toHaveLength(1);
  });

  it('does not append a page read for one warranty to another warranty ledger', async () => {
    /*
     * The stale-view guard inside the updater, which the render-time comparison does
     * not cover: a further page already in flight when the screen moves to another
     * warranty would otherwise land on THAT warranty's ledger and be believed. The
     * second read is held open deliberately so the move happens while it is pending,
     * which is the only moment the guard is reachable.
     */
    const OTHER_WARRANTY_ID = '66666666-6666-4666-8666-666666666666';
    let releaseSecondPage: ((value: unknown) => void) | null = null;
    readWarrantyStatusHistory
      .mockResolvedValueOnce(ledger([originTransition], true, 'next-cursor'))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseSecondPage = resolve;
          })
      );

    const user = userEvent.setup();
    const view = renderLtr(
      <WarrantyRecordScreen locale="en" messages={en as never} warranty={record as never} />
    );
    await settled();
    await user.click(
      within(historyPanel()).getByRole('button', {
        name: EN['warranty.history.loadMore'] as string,
      })
    );

    // The screen moves to another warranty while that page is still in flight.
    view.rerender(
      <WarrantyRecordScreen
        locale="en"
        messages={en as never}
        warranty={{ ...record, id: OTHER_WARRANTY_ID } as never}
      />
    );
    await waitFor(() => expect(readWarrantyStatusHistory).toHaveBeenCalledWith(OTHER_WARRANTY_ID));

    // Now the first warranty's page lands.
    await act(async () => {
      (releaseSecondPage as unknown as (value: unknown) => void)(ledger([advanceTransition]));
    });

    const region = historyPanel();
    // The second warranty's own ledger, and only that: one row, and not the row the
    // first warranty's further page carried.
    expect(within(region).getAllByRole('listitem')).toHaveLength(1);
    expect(within(region).queryByText('Cover started at the counter.')).toBeNull();
    expect(within(region).queryByText(EN['warranty.status.active'] as string)).toBeNull();
  });
});

describe('the issue control is gated on the code its own operation declares', () => {
  /*
   * That the control is ABSENT without `wty.warranty.issue` is a property of the
   * handover screen that renders it, and it is measured there —
   * `delivery.dom.test.tsx` holds the mocks that screen's six panels need. What is
   * measured here is everything the panel itself decides.
   */

  it('is offered on a completed handover', () => {
    renderPanel();
    expect(submit()).toBeEnabled();
  });

  it('is withheld while the vehicle has not been handed over', () => {
    renderPanel({ deliveryStatus: 'ready' });
    expect(submit()).toBeDisabled();
    expect(screen.getByText(EN['warranty.generate.notHandedOver'] as string)).toBeInTheDocument();
  });

  it('sends no warranty term of its own, and links to what it created', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(submit());
    await waitFor(() => expect(generateWarranty).toHaveBeenCalled());
    expect(generateWarranty.mock.calls[0]?.[0]).toBe(DELIVERY_ID);
    expect(generateWarranty.mock.calls[0]?.[1]).toEqual({});
    const link = await screen.findByRole('link', {
      name: EN['warranty.generate.openRecord'] as string,
    });
    expect(link).toHaveAttribute('href', `/en/warranty/${WARRANTY_ID}`);
  });

  it('states an already-covered vehicle in those words, not as a bare conflict', async () => {
    generateWarranty.mockResolvedValue({
      status: 'conflict',
      code: 'ERR-CON-001',
      correlationId: 'corr-9',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderPanel();
    await user.click(submit());
    expect(
      await screen.findByText(EN['warranty.generate.refusedAlreadyCovered'] as string, {
        exact: false,
      })
    ).toBeInTheDocument();
  });

  it('states an unconfigured workshop as configuration, not as a fault', async () => {
    generateWarranty.mockResolvedValue({
      status: 'error',
      code: 'ERR-RES-001',
      correlationId: 'corr-9',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderPanel();
    await user.click(submit());
    expect(
      await screen.findByText(EN['warranty.generate.refusedNotConfigured'] as string, {
        exact: false,
      })
    ).toBeInTheDocument();
  });

  /*
   * The remaining three codes the panel branches on. Each arrives as a bare kind —
   * a validation failure, a denial, a conflict — and only the catalogue code tells
   * them apart, so each needs its own case or the branch is untested and a wrong
   * mapping would read as the shared "the action failed" sentence.
   */

  it('states an incomplete handover as the precondition it is', async () => {
    generateWarranty.mockResolvedValue({
      status: 'error',
      code: 'ERR-TRN-001',
      correlationId: 'corr-9',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderPanel();
    await user.click(submit());
    expect(
      await screen.findByText(EN['warranty.generate.refusedPrecondition'] as string, {
        exact: false,
      })
    ).toBeInTheDocument();
  });

  it('states a denial the BACKEND made in its own words, with the reference it logged', async () => {
    generateWarranty.mockResolvedValue({
      status: 'denied',
      code: 'ERR-IAM-001',
      correlationId: 'corr-9',
      requiredPermissions: ['a.b.c'],
      attempt: 1,
    });
    const user = userEvent.setup();
    renderPanel();
    await user.click(submit());
    expect(
      await screen.findByText(EN['warranty.generate.refusedDenied'] as string, { exact: false })
    ).toBeInTheDocument();
    expect(screen.getByText('corr-9')).toBeInTheDocument();
  });

  it('tells an operator a repeated request was already recorded, not that it failed', async () => {
    generateWarranty.mockResolvedValue({
      status: 'conflict',
      code: 'ERR-INT-001',
      correlationId: 'corr-9',
      attempt: 2,
    });
    const user = userEvent.setup();
    renderPanel();
    await user.click(submit());
    expect(
      await screen.findByText(EN['warranty.generate.refusedAlreadyRecorded'] as string, {
        exact: false,
      })
    ).toBeInTheDocument();
    // The shared wording would send the operator to try again, which is the one
    // thing they must not do with a request the backend has already recorded.
    expect(screen.queryByText(EN['action.failed'] as string)).not.toBeInTheDocument();
  });
});

describe('the warranty plan is picked from the published list, never typed', () => {
  it('asks for no plan without the read code, and still submits', async () => {
    // `wty.warranty.issue` does not imply `wty.warranty.read`. Without the read code
    // nothing is asked for, and the form is still usable: an unnamed plan is what
    // resolves the company's single active one.
    const user = userEvent.setup();
    renderPanel({ canReadPolicies: false });
    await waitFor(() => expect(listWarrantyPolicies).not.toHaveBeenCalled());
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(
      screen.getByText(EN['warranty.generate.policyNotOffered'] as string)
    ).toBeInTheDocument();
    await user.click(submit());
    await waitFor(() => expect(generateWarranty).toHaveBeenCalled());
    expect(generateWarranty.mock.calls[0]?.[1]).toEqual({});
  });

  it('offers the plans the list published, asking only for the issuable state', async () => {
    renderPanel({ canReadPolicies: true });
    const picker = await screen.findByRole('combobox', {
      name: labelled('warranty.generate.policyField'),
    });
    expect(listWarrantyPolicies).toHaveBeenCalledWith({ status: 'active' });
    // The plan is named, not referenced: an operator cannot discover an identifier.
    expect(
      screen.getByRole('option', { name: `${policy.policyCode} — ${policy.name}` })
    ).toBeInTheDocument();
    // Leaving it unchosen stays an explicit, named choice, because the route accepts
    // a request that names no plan.
    expect(
      screen.getByRole('option', { name: EN['warranty.generate.policyPlaceholder'] as string })
    ).toBeInTheDocument();
    expect(picker).toHaveValue('');
  });

  it('sends the plan the operator chose', async () => {
    const user = userEvent.setup();
    renderPanel({ canReadPolicies: true });
    const picker = await screen.findByRole('combobox', {
      name: labelled('warranty.generate.policyField'),
    });
    await user.selectOptions(picker, policy.id);
    await user.click(submit());
    await waitFor(() => expect(generateWarranty).toHaveBeenCalled());
    expect(generateWarranty.mock.calls[0]?.[1]).toEqual({ policyId: policy.id });
  });

  it('offers no plan belonging to another company', async () => {
    // The read is tenant-wide and answers for every company the caller reaches. A plan
    // from another company would be refused, so it is never offered.
    listWarrantyPolicies.mockResolvedValue({
      status: 'ok',
      data: {
        policies: { items: [policySummary, otherCompanyPolicy], nextCursor: null, hasMore: false },
      },
      correlationId: 'corr-1',
    });
    renderPanel({ canReadPolicies: true });
    await screen.findByRole('option', { name: `${policy.policyCode} — ${policy.name}` });
    expect(screen.queryByRole('option', { name: /Other company cover/ })).toBeNull();
  });

  it('hides the picker when the plan list is refused, and says so', async () => {
    listWarrantyPolicies.mockResolvedValue({ status: 'denied', correlationId: 'corr-9' });
    renderPanel({ canReadPolicies: true });
    expect(
      await screen.findByText(EN['warranty.generate.policiesRefused'] as string)
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    // A refused list is not a blocked handover: the request that names no plan is
    // still the one that resolves the company's single active plan.
    expect(submit()).toBeEnabled();
  });

  it('draws no empty picker when the company has no active plan', async () => {
    listWarrantyPolicies.mockResolvedValue({
      status: 'ok',
      data: { policies: { items: [], nextCursor: null, hasMore: false } },
      correlationId: 'corr-1',
    });
    renderPanel({ canReadPolicies: true });
    await waitFor(() => expect(listWarrantyPolicies).toHaveBeenCalled());
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(
      await screen.findByText(EN['warranty.generate.policyNotOffered'] as string)
    ).toBeInTheDocument();
  });
});

describe('the record page draws every outcome its read can return', () => {
  it('sends an ended session to sign in again rather than reporting a fault', async () => {
    readWarranty.mockResolvedValue({ status: 'expired', correlationId: null });
    await renderRecordPage();
    expect(screen.getByText(EN['state.expired.title'] as string)).toBeInTheDocument();
  });

  it('states an unreachable backend as unavailable, with the reference it logged', async () => {
    readWarranty.mockResolvedValue({ status: 'unavailable', correlationId: 'corr-9' });
    await renderRecordPage();
    expect(screen.getByText(EN['state.unavailable.title'] as string)).toBeInTheDocument();
    expect(screen.getByText('corr-9')).toBeInTheDocument();
  });

  it('falls back to the shared failure wording for anything else', async () => {
    readWarranty.mockResolvedValue({ status: 'error', correlationId: 'corr-9' });
    await renderRecordPage();
    expect(screen.getByText(EN['state.error.title'] as string)).toBeInTheDocument();
    expect(screen.getByText('corr-9')).toBeInTheDocument();
  });
});

describe('the words are the catalogue’s, in both reading directions', () => {
  it('reads in Arabic as Arabic', () => {
    renderRtl(
      <WarrantyRecordScreen locale="ar" messages={ar as never} warranty={record as never} />
    );
    expect(screen.getByText(AR['warranty.summary.heading'] as string)).toBeInTheDocument();
    expect(screen.getByText(AR['warranty.coverage.heading'] as string)).toBeInTheDocument();
    expect(screen.getByText(AR['warranty.status.issued'] as string)).toBeInTheDocument();
    expect(screen.getByText(AR['warranty.coveredScope.all'] as string)).toBeInTheDocument();
    // The record is an Arabic screen, so none of the English wording may leak into it.
    expect(screen.queryByText(EN['warranty.summary.heading'] as string)).not.toBeInTheDocument();
  });

  it('keeps a reference left-to-right inside a right-to-left screen', () => {
    renderRtl(
      <WarrantyRecordScreen locale="ar" messages={ar as never} warranty={record as never} />
    );
    // An identifier is not language: reversing it would make it unreadable and
    // untypable, and it is the only thing an operator can quote to support.
    expect(screen.getByText(VEHICLE_ID)).toHaveAttribute('dir', 'ltr');
  });

  it('shows the list in Arabic, including the state vocabulary, and reads on arrival', async () => {
    renderRtl(
      inBranch(
        <WarrantyListScreen locale="ar" messages={ar as never} initialVehicleId={null} />,
        { locale: 'ar' }
      )
    );
    expect(await screen.findByText(AR['warranty.status.issued'] as string)).toBeInTheDocument();
    expect(screen.getByText(AR['warranty.list.columnPolicy'] as string)).toBeInTheDocument();
    // The branch is named, in Arabic, by the context rather than typed here.
    expect(screen.getByTestId('warranty-branch-target')).toHaveTextContent(TEST_BRANCH.name);
  });
});

describe('the branch is the header\u2019s choice, and nothing here asks for one', () => {
  it('asks for no branch directory at all', async () => {
    /*
     * The screen used to read `org.branch-list` to populate a target picker, and
     * to fall back to two boxes asking an operator to paste a company reference
     * and a branch reference when that read was refused \u2014 which was exactly the
     * operator whose grant is not narrowed. Both are gone: the working context
     * publishes the named branches this caller is authorized for.
     */
    renderLtr(
      inBranch(<WarrantyListScreen locale="en" messages={en as never} initialVehicleId={null} />)
    );
    await waitFor(() => expect(listWarranties).toHaveBeenCalled());
    expect(listBranches).not.toHaveBeenCalled();
  });

  it('offers nothing to type, in either half of the pair', async () => {
    renderLtr(
      inBranch(<WarrantyListScreen locale="en" messages={en as never} initialVehicleId={null} />)
    );
    await waitFor(() => expect(listWarranties).toHaveBeenCalled());
    // One box on this screen, and it is the search box.
    const boxes = screen.getAllByRole('searchbox');
    expect(boxes).toHaveLength(1);
    expect(screen.queryAllByRole('textbox')).toEqual([]);
  });

  it('re-targets the list when the branch changes in the header', async () => {
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="use main" />
          <BranchSwitch to={OTHER_BRANCH.id} label="use second" />
          <WarrantyListScreen locale="en" messages={en as never} initialVehicleId={null} />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'use main' }));
    await waitFor(() =>
      expect(listWarranties.mock.calls.at(-1)?.[0]).toEqual({
        companyId: TEST_COMPANY.id,
        branchId: TEST_BRANCH.id,
      })
    );
    await user.click(screen.getByRole('button', { name: 'use second' }));
    await waitFor(() =>
      expect(listWarranties.mock.calls.at(-1)?.[0]).toEqual({
        companyId: TEST_COMPANY.id,
        branchId: OTHER_BRANCH.id,
      })
    );
  });
});
