import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';

/**
 * The warranty screens, rendered (P1-31, FE-008 warranty record, FE-009 partial).
 *
 * The properties under test: both route pages decide before they read; the list asks
 * for nothing until a branch has been named, because the branch is the read's target
 * and not an assumption this screen may make; a refusal is drawn as a refusal and
 * never as a branch that has issued nothing; the record shows the terms it was issued
 * under and keeps the two odometer figures apart; the issue control is ABSENT without
 * the code the generation declares and is withheld while the vehicle is still in the
 * workshop; the missing transition ledger is stated rather than simulated; and every
 * word on screen comes from the catalogue in both reading directions.
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
vi.mock('@/features/warranty/warranty-api', () => ({
  listWarranties: (...args: unknown[]) => listWarranties(...args),
  readWarranty: (...args: unknown[]) => readWarranty(...args),
  listBranches: (...args: unknown[]) => listBranches(...args),
  generateWarranty: (...args: unknown[]) => generateWarranty(...args),
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
  listWarranties.mockResolvedValue(page([row]));
  readWarranty.mockResolvedValue({ status: 'ok', data: record, correlationId: 'corr-1' });
  listBranches.mockResolvedValue({ status: 'denied', correlationId: 'corr-9' });
  generateWarranty.mockResolvedValue({ status: 'success', created: record, attempt: 1 });
});

async function renderListPage(search: Record<string, string> = {}) {
  const tree = await WarrantyListPage({
    params: Promise.resolve({ locale: 'en' }),
    searchParams: Promise.resolve(search),
  });
  return renderLtr(tree as React.ReactElement);
}

async function renderRecordPage() {
  const tree = await WarrantyRecordPage({
    params: Promise.resolve({ locale: 'en', warrantyId: WARRANTY_ID }),
  });
  return renderLtr(tree as React.ReactElement);
}

/** Name a branch in the target form, which is what unblocks every read. */
async function nameBranch(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByRole('textbox', { name: labelled('warranty.common.companyIdField') }),
    COMPANY_ID
  );
  await user.type(
    screen.getByRole('textbox', { name: labelled('warranty.common.branchIdField') }),
    BRANCH_ID
  );
  await user.click(screen.getByRole('button', { name: EN['warranty.target.choose'] as string }));
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

describe('the list asks for nothing until a branch is named', () => {
  it('reads no warranty before a branch has been chosen', async () => {
    await renderListPage();
    expect(screen.getByText(EN['warranty.list.chooseBranchFirst'] as string)).toBeInTheDocument();
    expect(listWarranties).not.toHaveBeenCalled();
  });

  it('reads the chosen branch, and shows its warranties', async () => {
    const user = userEvent.setup();
    await renderListPage();
    await nameBranch(user);
    await waitFor(() => expect(listWarranties).toHaveBeenCalled());
    expect(listWarranties.mock.calls[0]?.[0]).toEqual({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
    });
    expect(await screen.findByText(policy.name)).toBeInTheDocument();
    expect(screen.getByText(EN['warranty.status.issued'] as string)).toBeInTheDocument();
  });

  it('carries a vehicle named in the address into the read', async () => {
    const user = userEvent.setup();
    await renderListPage({ vehicleId: VEHICLE_ID });
    await nameBranch(user);
    await waitFor(() => expect(listWarranties).toHaveBeenCalled());
    expect(listWarranties.mock.calls[0]?.[1]).toBe(VEHICLE_ID);
  });

  it('drops a vehicle in the address that is not shaped like a reference', async () => {
    const user = userEvent.setup();
    await renderListPage({ vehicleId: 'not-a-reference' });
    await nameBranch(user);
    await waitFor(() => expect(listWarranties).toHaveBeenCalled());
    expect(listWarranties.mock.calls[0]?.[1]).toBeNull();
  });

  it('draws a branch that has issued none as empty, not as refused', async () => {
    listWarranties.mockResolvedValue(page([]));
    const user = userEvent.setup();
    await renderListPage();
    await nameBranch(user);
    expect(await screen.findByText(EN['warranty.list.noneTitle'] as string)).toBeInTheDocument();
    expect(screen.queryByText(EN['state.denied.title'] as string)).not.toBeInTheDocument();
  });

  it('draws a refusal as a refusal, not as an empty branch', async () => {
    listWarranties.mockResolvedValue(refusedList('denied'));
    const user = userEvent.setup();
    await renderListPage();
    await nameBranch(user);
    expect(await screen.findByText(EN['state.denied.title'] as string)).toBeInTheDocument();
    expect(screen.queryByText(EN['warranty.list.noneTitle'] as string)).not.toBeInTheDocument();
  });

  it('offers another page only when the SERVER says one exists', async () => {
    listWarranties.mockResolvedValue(page([row], true, 'next-cursor'));
    const user = userEvent.setup();
    await renderListPage();
    await nameBranch(user);
    const more = await screen.findByRole('button', {
      name: EN['warranty.list.loadMore'] as string,
    });
    await user.click(more);
    await waitFor(() => expect(listWarranties.mock.calls.length).toBeGreaterThan(1));
    // The cursor goes back exactly as the server minted it.
    expect(listWarranties.mock.calls[1]?.[2]).toBe('next-cursor');
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

  it('says the transition ledger cannot be read yet instead of inventing one', () => {
    // FE-009 asked for a history. The table exists, no operation publishes it, and a
    // sequence assembled from the record's current state would be believed.
    renderLtr(
      <WarrantyRecordScreen locale="en" messages={en as never} warranty={record as never} />
    );
    expect(screen.getByText(EN['warranty.record.noHistoryYet'] as string)).toBeInTheDocument();
  });

  it('prints a state this build does not know as the word the backend sent', () => {
    const unknown = { ...record, status: 'under_review' };
    renderLtr(
      <WarrantyRecordScreen locale="en" messages={en as never} warranty={unknown as never} />
    );
    expect(screen.getByText('under_review')).toBeInTheDocument();
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
    renderLtr(
      <GenerateWarrantyPanel
        locale="en"
        messages={en as never}
        deliveryId={DELIVERY_ID}
        deliveryStatus="delivered"
      />
    );
    const button = screen.getByRole('button', { name: EN['warranty.generate.submit'] as string });
    expect(button).toBeEnabled();
  });

  it('is withheld while the vehicle has not been handed over', () => {
    renderLtr(
      <GenerateWarrantyPanel
        locale="en"
        messages={en as never}
        deliveryId={DELIVERY_ID}
        deliveryStatus="ready"
      />
    );
    expect(
      screen.getByRole('button', { name: EN['warranty.generate.submit'] as string })
    ).toBeDisabled();
    expect(screen.getByText(EN['warranty.generate.notHandedOver'] as string)).toBeInTheDocument();
  });

  it('sends no warranty term of its own, and links to what it created', async () => {
    const user = userEvent.setup();
    renderLtr(
      <GenerateWarrantyPanel
        locale="en"
        messages={en as never}
        deliveryId={DELIVERY_ID}
        deliveryStatus="delivered"
      />
    );
    await user.click(
      screen.getByRole('button', { name: EN['warranty.generate.submit'] as string })
    );
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
    renderLtr(
      <GenerateWarrantyPanel
        locale="en"
        messages={en as never}
        deliveryId={DELIVERY_ID}
        deliveryStatus="delivered"
      />
    );
    await user.click(
      screen.getByRole('button', { name: EN['warranty.generate.submit'] as string })
    );
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
    renderLtr(
      <GenerateWarrantyPanel
        locale="en"
        messages={en as never}
        deliveryId={DELIVERY_ID}
        deliveryStatus="delivered"
      />
    );
    await user.click(
      screen.getByRole('button', { name: EN['warranty.generate.submit'] as string })
    );
    expect(
      await screen.findByText(EN['warranty.generate.refusedNotConfigured'] as string, {
        exact: false,
      })
    ).toBeInTheDocument();
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

  it('shows the list in Arabic, including the state vocabulary', async () => {
    const user = userEvent.setup();
    renderRtl(
      <WarrantyListScreen
        locale="ar"
        messages={ar as never}
        initialVehicleId={null}
        canReadBranches={false}
      />
    );
    await user.type(
      screen.getByRole('textbox', {
        name: new RegExp(`^${escape(AR['warranty.common.companyIdField'] as string)}`),
      }),
      COMPANY_ID
    );
    await user.type(
      screen.getByRole('textbox', {
        name: new RegExp(`^${escape(AR['warranty.common.branchIdField'] as string)}`),
      }),
      BRANCH_ID
    );
    await user.click(screen.getByRole('button', { name: AR['warranty.target.choose'] as string }));
    expect(await screen.findByText(AR['warranty.status.issued'] as string)).toBeInTheDocument();
    expect(screen.getByText(AR['warranty.list.columnPolicy'] as string)).toBeInTheDocument();
  });
});

describe('the branch directory is asked for only when the code is held', () => {
  it('asks for no directory without the organisation read code', async () => {
    renderLtr(
      <WarrantyListScreen
        locale="en"
        messages={en as never}
        initialVehicleId={null}
        canReadBranches={false}
      />
    );
    await waitFor(() => expect(listBranches).not.toHaveBeenCalled());
    expect(
      screen.getByRole('textbox', { name: labelled('warranty.common.branchIdField') })
    ).toBeInTheDocument();
  });

  it('falls back to the typed pair when the directory is refused', async () => {
    renderLtr(
      <WarrantyListScreen
        locale="en"
        messages={en as never}
        initialVehicleId={null}
        canReadBranches={true}
      />
    );
    await waitFor(() => expect(listBranches).toHaveBeenCalled());
    expect(
      await screen.findByText(EN['warranty.common.branchesRefused'] as string)
    ).toBeInTheDocument();
  });

  it('offers a picker when the directory answers', async () => {
    listBranches.mockResolvedValue({
      status: 'ok',
      data: {
        items: [
          {
            id: BRANCH_ID,
            companyId: COMPANY_ID,
            branchCode: 'B-01',
            name: 'Main workshop',
            city: null,
            countryCode: null,
            timezoneName: 'UTC',
            status: 'active',
          },
        ],
      },
      correlationId: 'corr-1',
    });
    const user = userEvent.setup();
    renderLtr(
      <WarrantyListScreen
        locale="en"
        messages={en as never}
        initialVehicleId={null}
        canReadBranches={true}
      />
    );
    const picker = await screen.findByRole('combobox', {
      name: labelled('warranty.common.branchField'),
    });
    await user.selectOptions(picker, BRANCH_ID);
    await user.click(screen.getByRole('button', { name: EN['warranty.target.choose'] as string }));
    await waitFor(() => expect(listWarranties).toHaveBeenCalled());
    expect(listWarranties.mock.calls[0]?.[0]).toEqual({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
    });
  });
});
