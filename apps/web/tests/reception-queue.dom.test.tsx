import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { TEST_BRANCH, branchSnapshot, inBranch, renderLtr, renderRtl } from './render';
import { RECEPTION_STATUSES } from '@/features/receptions/receptions-contract';
import { receptionAffordances } from '@/features/receptions/check-in/closure';

/**
 * The branch reception queue, rendered (`P1-28-FE-001`, the queue half).
 *
 * The properties under test are the ones a board gets wrong: reading before it
 * was asked to, inventing a total the platform does not publish, and offering a
 * terminal exit on a row the transition graph forbids it on.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const listReceptions = vi.fn();
vi.mock('@/features/receptions/api', () => ({
  listReceptions: (...args: unknown[]) => listReceptions(...args),
}));

const { ReceptionQueueScreen } =
  await import('@/features/receptions/components/ReceptionQueueScreen');

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'rv-1',
    displayNumber: 'R-0001',
    receptionStatus: 'opened',
    origin: 'walk_in',
    vehicleId: 'veh-9',
    vehicleDisplayNumber: 'V-9',
    custodyAcceptedAt: '2026-08-13T07:00:00.000Z',
    custodyReleasedAt: null,
    recordVersion: 3,
    ...over,
  };
}

function page(rows: readonly unknown[], hasMore = false) {
  return {
    status: 'ok' as const,
    rows,
    nextCursor: hasMore ? 'c1' : null,
    hasMore,
    correlationId: 'corr',
  };
}

function renderQueue(
  over: Record<string, unknown> = {},
  snapshot = branchSnapshot()
) {
  // The branch is no longer a control on this form. It is the working context's
  // own named selection, so a test states it by standing the screen in a branch.
  return renderLtr(
    inBranch(<ReceptionQueueScreen locale="en" messages={en} canCreate {...over} />, { snapshot })
  );
}

async function show(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: EN['receptions.queue.show'] as string }));
  await waitFor(() => expect(listReceptions).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  listReceptions.mockResolvedValue(page([row()]));
});

describe('nothing is requested until a branch is named', () => {
  it('issues no read on first paint', () => {
    renderQueue();
    expect(listReceptions).not.toHaveBeenCalled();
    expect(screen.getByText(EN['receptions.queue.idleTitle'] as string)).toBeVisible();
  });

  it('refuses to submit until a branch is chosen, and still reads nothing', async () => {
    // Several branches are authorized and none is chosen yet, so the screen is
    // not addressed to one. It says which control answers that — the header —
    // and the button cannot be pressed. It used to render two free-text boxes
    // here and complain that a reference was required.
    const user = userEvent.setup();
    const second = { ...TEST_BRANCH, id: '55555555-5555-4555-8555-555555555555', name: 'Second' };
    renderQueue({}, branchSnapshot([TEST_BRANCH, second]));
    const show = screen.getByRole('button', { name: EN['receptions.queue.show'] as string });
    expect(show).toBeDisabled();
    expect(screen.getByTestId('requires-concrete-branch')).toHaveTextContent(
      EN['workingContext.chooseFirst'] as string
    );
    await user.click(show);
    expect(listReceptions).not.toHaveBeenCalled();
  });

  it('names the branch it is addressed to, instead of showing a reference', () => {
    renderQueue();
    expect(screen.getByTestId('working-branch-field')).toHaveTextContent(TEST_BRANCH.name);
    expect(screen.getByTestId('working-branch-field')).not.toHaveTextContent(TEST_BRANCH.id);
  });

  it('sends the branch target the operator named, as a resource selector', async () => {
    const user = userEvent.setup();
    renderQueue();
    await show(user);
    expect(listReceptions.mock.calls[0]?.[0]).toEqual({ companyId: COMPANY, branchId: BRANCH });
  });

  it('sends a status filter only once one is chosen', async () => {
    const user = userEvent.setup();
    renderQueue();
    await show(user);
    expect(listReceptions.mock.calls[0]?.[1]).toEqual({});

    listReceptions.mockClear();
    await user.selectOptions(
      screen.getByLabelText(EN['receptions.queue.statusFilter'] as string, { exact: false }),
      'authorized'
    );
    await user.click(screen.getByRole('button', { name: EN['receptions.queue.show'] as string }));
    await waitFor(() => expect(listReceptions).toHaveBeenCalled());
    expect(listReceptions.mock.calls[0]?.[1]).toEqual({ status: 'authorized' });
  });

  it('offers every status the frozen vocabulary carries, and no other', async () => {
    renderQueue();
    const select = screen.getByLabelText(EN['receptions.queue.statusFilter'] as string, {
      exact: false,
    });
    const values = within(select)
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value)
      .filter((value) => value !== '');
    expect(values).toEqual([...RECEPTION_STATUSES]);
  });
});

describe('the board is honest about what it holds', () => {
  it('says custody is still held when the vehicle has not been released', async () => {
    const user = userEvent.setup();
    renderQueue();
    await show(user);
    expect(await screen.findByText(EN['receptions.queue.custodyHeld'] as string)).toBeVisible();
  });

  it('states when the vehicle was released instead', async () => {
    listReceptions.mockResolvedValue(
      page([
        row({
          receptionStatus: 'closed_without_work',
          custodyReleasedAt: '2026-08-13T12:00:00.000Z',
        }),
      ])
    );
    const user = userEvent.setup();
    renderQueue();
    await show(user);
    expect(
      await screen.findByText(EN['receptions.queue.custodyReleased'] as string, { exact: false })
    ).toBeVisible();
  });

  it('invents no total, and offers Next only while the server says more exists', async () => {
    const user = userEvent.setup();
    renderQueue();
    await show(user);
    await screen.findByText('R-0001');
    expect(screen.getByRole('button', { name: EN['table.nextPage'] as string })).toBeDisabled();
    expect(screen.getByText(EN['receptions.queue.orderingNote'] as string)).toBeVisible();
  });

  it('enables Next when the page reports more', async () => {
    listReceptions.mockResolvedValue(page([row()], true));
    const user = userEvent.setup();
    renderQueue();
    await show(user);
    await screen.findByText('R-0001');
    expect(screen.getByRole('button', { name: EN['table.nextPage'] as string })).toBeEnabled();
  });

  it('states a zero-row answer about the FILTER, not about the branch', async () => {
    listReceptions.mockResolvedValue(page([]));
    const user = userEvent.setup();
    renderQueue();
    await show(user);
    expect(await screen.findByText(EN['receptions.queue.noneMatching'] as string)).toBeVisible();
    // The table's own "nothing here yet" would be a claim about the whole
    // branch on the evidence of one filter.
    expect(screen.queryByText(EN['state.empty.title'] as string)).toBeNull();
  });

  it('renders an unnumbered visit as unnumbered, never as its identifier', async () => {
    listReceptions.mockResolvedValue(page([row({ displayNumber: null })]));
    const user = userEvent.setup();
    const { container } = renderQueue();
    await show(user);
    expect(
      await screen.findByText(EN['receptions.queue.column.noReference'] as string)
    ).toBeVisible();
    expect(container.textContent).not.toContain('rv-1');
  });

  it('surfaces a read failure with its reference and a retry', async () => {
    listReceptions.mockResolvedValue({
      status: 'error',
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: 'corr-500',
    });
    const user = userEvent.setup();
    renderQueue();
    await show(user);
    expect(await screen.findByText('corr-500', { exact: false })).toBeVisible();
  });
});

describe('the terminal-exit affordance follows the transition graph', () => {
  it.each(RECEPTION_STATUSES.map((status) => [status] as const))(
    'offers the release affordance for %s exactly when the graph allows an exit',
    async (status) => {
      listReceptions.mockResolvedValue(page([row({ receptionStatus: status })]));
      const user = userEvent.setup();
      const { unmount } = renderQueue();
      await show(user);
      await screen.findByText('R-0001');

      const affordances = receptionAffordances(status);
      const offered =
        screen.queryByRole('link', { name: EN['receptions.queue.releaseVehicle'] as string }) !==
        null;
      expect(offered, status).toBe(affordances.closeWithoutWork || affordances.refuse);
      unmount();
    }
  );

  it('leads to the visit rather than closing from the board', async () => {
    // QA-004: a board row's version is a snapshot. The guarded close is taken
    // on the visit, against the version that visit's own read returns.
    const user = userEvent.setup();
    renderQueue();
    await show(user);
    const release = await screen.findByRole('link', {
      name: EN['receptions.queue.releaseVehicle'] as string,
    });
    expect(release).toHaveAttribute('href', '/en/receptions/check-in/rv-1');
  });

  it('is LABELLED as navigation, in both catalogues — it shares an href and performs no write', () => {
    /*
     * `F2`. The label read "End the visit and release the vehicle" while the
     * href was the row's own visit — the SAME destination as "Open the visit"
     * beside it. A link that names a write it cannot perform is the mislabelling
     * this phase rules out permanently, so the label is pinned here in both
     * languages rather than left to prose.
     */
    for (const catalogue of [EN, AR]) {
      const label = catalogue['receptions.queue.releaseVehicle'] as string;
      expect(label).toBeTruthy();
      for (const claim of ['release', 'الإفراج']) {
        expect(label.toLowerCase()).not.toContain(claim.toLowerCase());
      }
    }
    // The English label states navigation, not a command.
    expect(EN['receptions.queue.releaseVehicle']).toBe('Open the visit to end it');
    expect(AR['receptions.queue.releaseVehicle']).toBe('فتح الزيارة لإنهائها');
  });

  it('links every row to its visit and to its acknowledgement', async () => {
    const user = userEvent.setup();
    renderQueue();
    await show(user);
    expect(
      await screen.findByRole('link', { name: EN['receptions.queue.open'] as string })
    ).toHaveAttribute('href', '/en/receptions/check-in/rv-1');
    expect(
      screen.getByRole('link', { name: EN['receptions.queue.acknowledgement'] as string })
    ).toHaveAttribute('href', '/en/receptions/check-in/rv-1/acknowledgement');
  });

  it('offers the check-in link only to an operator who may open a visit', () => {
    renderQueue({ canCreate: false });
    expect(
      screen.queryByRole('link', { name: EN['receptions.queue.checkInVehicle'] as string })
    ).toBeNull();
    renderQueue({ canCreate: true });
    expect(
      screen.getAllByRole('link', { name: EN['receptions.queue.checkInVehicle'] as string }).length
    ).toBe(1);
  });
});

describe('both directions', () => {
  it('renders in Arabic, right to left', async () => {
    const user = userEvent.setup();
    renderRtl(
      inBranch(<ReceptionQueueScreen locale="ar" messages={ar} canCreate />, { locale: 'ar' })
    );
    expect(screen.getByText(AR['receptions.queue.idleTitle'] as string)).toBeVisible();
    await user.click(screen.getByRole('button', { name: AR['receptions.queue.show'] as string }));
    await waitFor(() => expect(listReceptions).toHaveBeenCalled());
    expect(await screen.findByText(AR['receptions.queue.custodyHeld'] as string)).toBeVisible();
    expect(document.documentElement.dir).toBe('rtl');
  });
});
