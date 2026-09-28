import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import type { CheckInStepProps } from '@/features/receptions/check-in/wizard';
import type { ReceptionDetail, ReceptionStatus } from '@/features/receptions/receptions-contract';
import {
  MAX_CLOSURE_REASON,
  RECEPTION_STATUSES,
  TERMINAL_RECEPTION_STATUSES,
} from '@/features/receptions/receptions-contract';
import { receptionAffordances } from '@/features/receptions/check-in/closure';

/**
 * The reception summary, approval, terminal exits and conversion, rendered
 * (`P1-28-FE-020` and `P1-28-FE-022`).
 *
 * Every adapter is a module mock: what is under test is the SCREEN — which
 * controls exist for which status, which version is presented back, and how the
 * three replay shapes are told apart — never the transport, which the QA-001
 * mirrors already hold.
 *
 * ## The affordance cases are driven by the frozen vocabulary
 *
 * The status loop iterates `RECEPTION_STATUSES` and compares what is rendered
 * against `receptionAffordances`, which reads the transition graph. No case here
 * names a status by hand, so a status added to the CHECK constraint arrives in
 * this suite the day it is added rather than the day somebody remembers.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

/* --- adapter mocks -------------------------------------------------------- */

const listPartyRoles = vi.fn();
const listAuthorizations = vi.fn();
const listConditionEvidence = vi.fn();
const approveReception = vi.fn();
const closeReceptionWithoutWork = vi.fn();
const refuseReception = vi.fn();
const convertReceptionToWorkOrder = vi.fn();

vi.mock('@/features/receptions/api', () => ({
  listPartyRoles: (...args: unknown[]) => listPartyRoles(...args),
  listAuthorizations: (...args: unknown[]) => listAuthorizations(...args),
  listConditionEvidence: (...args: unknown[]) => listConditionEvidence(...args),
  approveReception: (...args: unknown[]) => approveReception(...args),
  closeReceptionWithoutWork: (...args: unknown[]) => closeReceptionWithoutWork(...args),
  refuseReception: (...args: unknown[]) => refuseReception(...args),
  convertReceptionToWorkOrder: (...args: unknown[]) => convertReceptionToWorkOrder(...args),
}));

const readConvertedWorkOrder = vi.fn();
vi.mock('@/features/receptions/work-order-api', () => ({
  readConvertedWorkOrder: (...args: unknown[]) => readConvertedWorkOrder(...args),
}));

const notify = vi.fn();
vi.mock('@/components/notifications/notification-store', () => ({
  notify: (...args: unknown[]) => notify(...args),
}));

const { SummaryStep } = await import('@/features/receptions/components/steps/SummaryStep');
const { ConversionStep } = await import('@/features/receptions/components/steps/ConversionStep');

/* --- fixtures ------------------------------------------------------------- */

function page<Row>(rows: readonly Row[], hasMore = false) {
  return { status: 'ok' as const, rows, nextCursor: null, hasMore, correlationId: 'corr-page' };
}

const DETAIL: ReceptionDetail = {
  id: 'rv-1',
  displayNumber: 'R-0001',
  receptionStatus: 'opened',
  origin: 'walk_in',
  appointmentId: null,
  walkInId: 'walk-1',
  companyId: 'company-1',
  branchId: 'branch-1',
  vehicleId: 'veh-9',
  vehicleDisplayNumber: 'V-9',
  odometerReadingId: null,
  fuelLevelId: null,
  fuelLevelName: null,
  evSocPercent: null,
  receivingEmployeeId: 'user-77',
  receivingEmployeeDisplayName: 'Dana Receiver',
  custodyAcceptedAt: '2026-08-13T07:00:00.000Z',
  custodyReleasedAt: null,
  recordVersion: 7,
  createdAt: '2026-08-13T07:00:00.000Z',
  updatedAt: null,
};

const CAPABILITIES = {
  manageParties: true,
  verifyAuthorizations: true,
  readCustomers: true,
  readVehicles: true,
  // Wave E widened the contract; the evidence steps hold their own suites.
  manageEvidence: true,
  overrideEvidence: true,
  // P1-28-SEC-002: the WF-27 second permission, held here so the existing
  // cases keep exercising the capture forms they were written against.
  viewSensitiveNarratives: true,
  manageSignatures: true,
  recordOdometer: true,
  approveReceptions: true,
  convertReceptions: true,
  closeReceptions: true,
  readWorkOrders: true,
  readStaffDirectory: true,
};

const refresh = vi.fn(async () => {});
/** The shell's step navigation, which a refusal may use (DEF-T-10). */
const goToStep = vi.fn();

/**
 * The step props, with `visitId` and `recordVersion` DERIVED from the detail.
 *
 * The shell hands a step exactly one truth and three views of it; a fixture that
 * let them disagree could green a screen that reads the version from the wrong
 * place, which is the QA-004 defect these cases exist to catch.
 */
function stepProps(over: Partial<CheckInStepProps> = {}): CheckInStepProps {
  const { detail: overriddenDetail, ...rest } = over;
  const detail = { ...DETAIL, ...(overriddenDetail ?? {}) };
  return {
    locale: 'en',
    messages: en,
    capabilities: CAPABILITIES,
    writesLocked: false,
    refresh,
    goToStep,
    ...rest,
    detail,
    visitId: detail.id,
    recordVersion: detail.recordVersion,
  } as CheckInStepProps;
}

/**
 * Holds the NEXT `refresh()` open until the returned release is called: the
 * re-read after a command is the slow part on a slow network, and the command
 * must stay busy through it (the version it sent is spent, and only the re-read
 * brings the next one).
 */
function holdNextRefresh(): () => void {
  let release: () => void = () => {};
  refresh.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  return () => release();
}

function withStatus(status: ReceptionStatus, over: Partial<CheckInStepProps> = {}) {
  return stepProps({
    ...over,
    detail: { ...DETAIL, ...(over.detail ?? {}), receptionStatus: status },
    writesLocked: TERMINAL_RECEPTION_STATUSES.includes(status),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  listPartyRoles.mockResolvedValue(page([]));
  listAuthorizations.mockResolvedValue(page([]));
  listConditionEvidence.mockResolvedValue(page([]));
});

/* --- FE-020: what is on record -------------------------------------------- */

describe('the summary reads what the decision is about', () => {
  it('issues the three per-visit reads for the visit it was handed', async () => {
    renderLtr(<SummaryStep {...stepProps()} />);
    await waitFor(() => expect(listConditionEvidence).toHaveBeenCalled());
    expect(listPartyRoles.mock.calls[0]?.[0]).toBe('rv-1');
    // Active roles only: an ended role is history, not who is here now.
    expect(listPartyRoles.mock.calls[0]?.[1]).toBe('active');
    expect(listAuthorizations.mock.calls[0]?.[0]).toBe('rv-1');
    expect(listConditionEvidence.mock.calls[0]?.[0]).toBe('rv-1');
  });

  it('states each section as empty rather than as a failure', async () => {
    renderLtr(<SummaryStep {...stepProps()} />);
    expect(await screen.findByText(EN['receptions.summary.partiesEmpty'] as string)).toBeVisible();
    expect(screen.getByText(EN['receptions.summary.authorizationsEmpty'] as string)).toBeVisible();
    expect(screen.getByText(EN['receptions.summary.evidenceEmpty'] as string)).toBeVisible();
  });

  it('offers a retry when a section read fails, with its reference', async () => {
    listConditionEvidence.mockResolvedValue({
      status: 'error',
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: 'corr-broken',
    });
    renderLtr(<SummaryStep {...stepProps()} />);
    expect(await screen.findByText('corr-broken', { exact: false })).toBeVisible();
    expect(
      screen.getAllByRole('button', { name: EN['state.retry'] as string }).length
    ).toBeGreaterThan(0);
  });

  it('renders a denied section as a denial, never as an empty list', async () => {
    listAuthorizations.mockResolvedValue({
      status: 'denied',
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: 'corr-403',
    });
    renderLtr(<SummaryStep {...stepProps()} />);
    expect(await screen.findByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(screen.queryByText(EN['receptions.summary.authorizationsEmpty'] as string)).toBeNull();
  });

  it('says a truncated evidence page is one page', async () => {
    listConditionEvidence.mockResolvedValue(
      page(
        [
          {
            kind: 'leak',
            id: 'e-1',
            recordedAt: '2026-08-13T08:00:00.000Z',
            evidenceDocumentId: null,
          },
        ],
        true
      )
    );
    renderLtr(<SummaryStep {...stepProps()} />);
    expect(
      await screen.findByText(EN['receptions.summary.evidenceTruncated'] as string)
    ).toBeVisible();
  });
});

describe('a customer’s concern stays distinguishable from a technical fact', () => {
  const COMPLAINT = {
    kind: 'complaint',
    id: 'e-complaint',
    recordedAt: '2026-08-13T08:00:00.000Z',
    evidenceDocumentId: '11111111-1111-4111-8111-111111111111',
    category: 'noise',
    severity: 'high',
  };
  const FINDING = {
    kind: 'condition_item',
    id: 'e-finding',
    recordedAt: '2026-08-13T08:05:00.000Z',
    evidenceDocumentId: null,
    findingCategory: 'scratch',
    vehicleZone: 'front-left',
  };

  it('labels the complaint as the customer’s report and the finding as staff’s', async () => {
    listConditionEvidence.mockResolvedValue(page([COMPLAINT, FINDING]));
    renderLtr(<SummaryStep {...stepProps()} />);
    expect(
      await screen.findByText(EN['receptions.summary.customerReported'] as string)
    ).toBeVisible();
    expect(screen.getByText(EN['receptions.summary.staffObserved'] as string)).toBeVisible();
  });

  it('says nothing on the sheet has been verified by a technician', async () => {
    listConditionEvidence.mockResolvedValue(page([COMPLAINT, FINDING]));
    renderLtr(<SummaryStep {...stepProps()} />);
    expect(await screen.findByText(EN['receptions.summary.notVerified'] as string)).toBeVisible();
  });

  it('says the customer’s wording is on the restricted record and prints none of it', async () => {
    // `rec.complaint_details` is excluded from the read, so there is no wording
    // to render — and the screen says that instead of paraphrasing.
    listConditionEvidence.mockResolvedValue(page([COMPLAINT]));
    renderLtr(<SummaryStep {...stepProps()} />);
    expect(
      await screen.findByText(EN['receptions.summary.complaintWordsRestricted'] as string)
    ).toBeVisible();
  });

  it('reports media as registered and pending, and never renders the reference', async () => {
    listConditionEvidence.mockResolvedValue(page([COMPLAINT]));
    const { container } = renderLtr(<SummaryStep {...stepProps()} />);
    expect(
      await screen.findByText(EN['receptions.summary.mediaRegistered'] as string)
    ).toBeVisible();
    expect(container.textContent).not.toContain('11111111-1111-4111-8111-111111111111');
  });
});

/* --- FE-020: the affordances ---------------------------------------------- */

describe('which commands are offered comes from the transition graph', () => {
  it.each(RECEPTION_STATUSES.map((status) => [status] as const))(
    'renders exactly the graph’s affordances for %s',
    async (status) => {
      const { unmount } = renderLtr(<SummaryStep {...withStatus(status)} />);
      await screen.findByRole('heading', {
        name: EN['receptions.summary.decisionHeading'] as string,
      });

      const expected = receptionAffordances(status);
      const approve = screen.queryByRole('button', {
        name: EN['receptions.summary.approve'] as string,
      });
      const close = screen.queryByRole('button', {
        name: EN['receptions.closure.closeSubmit'] as string,
      });
      const refuse = screen.queryByRole('button', {
        name: EN['receptions.closure.refuseSubmit'] as string,
      });

      expect(approve !== null, `approve for ${status}`).toBe(expected.approve);
      expect(close !== null, `close for ${status}`).toBe(expected.closeWithoutWork);
      expect(refuse !== null, `refuse for ${status}`).toBe(expected.refuse);
      unmount();
    }
  );

  it('states why a terminal visit has no decision to take', async () => {
    renderLtr(<SummaryStep {...withStatus('converted')} />);
    expect(
      await screen.findByText(EN['receptions.summary.decisionClosed'] as string)
    ).toBeVisible();
  });

  it('withdraws each command for the permission it needs, and says which', async () => {
    renderLtr(
      <SummaryStep
        {...stepProps({
          capabilities: { ...CAPABILITIES, approveReceptions: false, closeReceptions: false },
        })}
      />
    );
    expect(await screen.findByText(EN['receptions.summary.approveDenied'] as string)).toBeVisible();
    expect(screen.getByText(EN['receptions.summary.closeDenied'] as string)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: EN['receptions.summary.approve'] as string })
    ).toBeNull();
  });

  it('offers approval to a holder of the approval permission alone', async () => {
    renderLtr(
      <SummaryStep {...stepProps({ capabilities: { ...CAPABILITIES, closeReceptions: false } })} />
    );
    expect(
      await screen.findByRole('button', { name: EN['receptions.summary.approve'] as string })
    ).toBeVisible();
    expect(screen.getByText(EN['receptions.summary.closeDenied'] as string)).toBeVisible();
  });
});

/* --- FE-020: approve, and the version it answers with ---------------------- */

describe('approve sends the read’s version and presents the answer’s', () => {
  it('guards the command with the version the shell read', async () => {
    approveReception.mockResolvedValue({
      status: 'success',
      approved: {
        receptionVisitId: 'rv-1',
        receptionStatus: 'authorized',
        appliedTransitions: ['inspecting', 'authorized'],
        recordVersion: 9,
      },
      correlationId: 'corr-ok',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(<SummaryStep {...stepProps()} />);
    await user.click(
      await screen.findByRole('button', { name: EN['receptions.summary.approve'] as string })
    );
    await waitFor(() => expect(approveReception).toHaveBeenCalled());
    // `If-Match` is the DETAIL's version, not a guess and not a cached one.
    expect(approveReception.mock.calls[0]?.[1]).toBe(7);
  });

  it('presents sent + 2 when the command applied two edges', async () => {
    approveReception.mockResolvedValue({
      status: 'success',
      approved: {
        receptionVisitId: 'rv-1',
        receptionStatus: 'authorized',
        appliedTransitions: ['inspecting', 'authorized'],
        recordVersion: 9,
      },
      correlationId: 'corr-ok',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(<SummaryStep {...stepProps()} />);
    await user.click(
      await screen.findByRole('button', { name: EN['receptions.summary.approve'] as string })
    );
    expect(await screen.findByTestId('approved-record-version')).toHaveTextContent('9');
    expect(screen.getByText(EN['receptions.summary.approvedTwoEdges'] as string)).toBeVisible();
  });

  it('presents sent + 1 when the command applied one, from the SAME code path', async () => {
    // The pair is what proves nothing is computed: one screen, two answers, and
    // the number rendered follows the response both times.
    approveReception.mockResolvedValue({
      status: 'success',
      approved: {
        receptionVisitId: 'rv-1',
        receptionStatus: 'authorized',
        appliedTransitions: ['authorized'],
        recordVersion: 8,
      },
      correlationId: 'corr-ok',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(<SummaryStep {...withStatus('inspecting')} />);
    await user.click(
      await screen.findByRole('button', { name: EN['receptions.summary.approve'] as string })
    );
    expect(await screen.findByTestId('approved-record-version')).toHaveTextContent('8');
    expect(screen.getByText(EN['receptions.summary.approvedOneEdge'] as string)).toBeVisible();
  });

  it('re-reads after success, so the next command’s version comes from a read', async () => {
    approveReception.mockResolvedValue({
      status: 'success',
      approved: {
        receptionVisitId: 'rv-1',
        receptionStatus: 'authorized',
        appliedTransitions: ['inspecting', 'authorized'],
        recordVersion: 9,
      },
      correlationId: 'corr-ok',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(<SummaryStep {...stepProps()} />);
    await user.click(
      await screen.findByRole('button', { name: EN['receptions.summary.approve'] as string })
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('stays busy until the re-read after a success lands, so the spent version is never sent twice', async () => {
    approveReception.mockResolvedValue({
      status: 'success',
      approved: {
        receptionVisitId: 'rv-1',
        receptionStatus: 'authorized',
        appliedTransitions: ['inspecting', 'authorized'],
        recordVersion: 9,
      },
      correlationId: 'corr-ok',
      attempt: 1,
    });
    const release = holdNextRefresh();
    const user = userEvent.setup();
    renderLtr(<SummaryStep {...stepProps()} />);
    const approve = await screen.findByRole('button', {
      name: EN['receptions.summary.approve'] as string,
    });
    await user.click(approve);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('approved-record-version')).toHaveTextContent('9');
    // The approval landed but the re-read has not: the button is still busy.
    expect(approve).toBeDisabled();
    expect(approve).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(approve);
    expect(approveReception).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(approve).toBeEnabled());
    // The success stays said; no stale-version conflict replaced it.
    expect(screen.getByTestId('approved-record-version')).toHaveTextContent('9');
    expect(screen.queryByText(EN['receptions.command.conflictStale'] as string)).toBeNull();
  });
});

describe('the two conflicts a guarded command meets are told apart', () => {
  it('says a re-run on an authorized visit is refused by the STATE (ERR-TRN-001)', async () => {
    // The approve replay shape: 409, and re-reading does not cure it.
    approveReception.mockResolvedValue({
      status: 'conflict',
      messageKey: 'state.conflict.blocked.title',
      correlationId: 'corr-409',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(<SummaryStep {...stepProps()} />);
    await user.click(
      await screen.findByRole('button', { name: EN['receptions.summary.approve'] as string })
    );
    expect(
      await screen.findByText(EN['receptions.command.conflictBlocked'] as string)
    ).toBeVisible();
    expect(screen.queryByText(EN['receptions.command.conflictStale'] as string)).toBeNull();
    expect(screen.getByText('corr-409', { exact: false })).toBeVisible();
  });

  /**
   * DEF-T-10. Approving a visit whose authorization had never been verified
   * printed the generic blocked sentence, which named nothing and pointed
   * nowhere. The API now publishes a rule token for that precondition, so the
   * banner says what is missing and offers the step that records it.
   */
  it('names the missing authorization instead of the generic refusal, and offers the step', async () => {
    approveReception.mockResolvedValue({
      status: 'conflict',
      messageKey: 'form.violation.authorization_missing',
      correlationId: 'corr-auth',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(<SummaryStep {...stepProps()} />);
    await user.click(
      await screen.findByRole('button', { name: EN['receptions.summary.approve'] as string })
    );

    expect(
      await screen.findByText(EN['form.violation.authorization_missing'] as string)
    ).toBeVisible();
    expect(screen.queryByText(EN['receptions.command.conflictBlocked'] as string)).toBeNull();

    await user.click(
      screen.getByRole('button', {
        name: EN['receptions.command.goToAuthorization'] as string,
      })
    );
    expect(goToStep).toHaveBeenCalledWith('parties-and-authorization');
  });

  it('names a withdrawn authorization, and keeps the generic sentence for a reason it was never told', async () => {
    approveReception.mockResolvedValue({
      status: 'conflict',
      messageKey: 'form.violation.authorization_withdrawn',
      correlationId: 'corr-withdrawn',
      attempt: 1,
    });
    const user = userEvent.setup();
    const { unmount } = renderLtr(<SummaryStep {...stepProps()} />);
    await user.click(
      await screen.findByRole('button', { name: EN['receptions.summary.approve'] as string })
    );
    expect(
      await screen.findByText(EN['form.violation.authorization_withdrawn'] as string)
    ).toBeVisible();
    unmount();

    // A rule this screen has never been told about is NOT dressed up as one it
    // understands: the generic sentence stands, and no step is offered.
    approveReception.mockResolvedValue({
      status: 'conflict',
      messageKey: 'form.violation.unregistered_aggregate',
      correlationId: 'corr-unknown',
      attempt: 1,
    });
    renderLtr(<SummaryStep {...stepProps()} />);
    await user.click(
      await screen.findByRole('button', { name: EN['receptions.summary.approve'] as string })
    );
    expect(
      await screen.findByText(EN['receptions.command.conflictBlocked'] as string)
    ).toBeVisible();
    expect(
      screen.queryByRole('button', {
        name: EN['receptions.command.goToAuthorization'] as string,
      })
    ).toBeNull();
  });

  /**
   * The two refusals that are not cured by filling anything in offer no step:
   * the visit has moved on, and sending the operator to a form would invite
   * work that changes nothing.
   */
  it('names an already-approved visit without offering a step', async () => {
    approveReception.mockResolvedValue({
      status: 'conflict',
      messageKey: 'form.violation.already_authorized',
      correlationId: 'corr-already',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(<SummaryStep {...stepProps()} />);
    await user.click(
      await screen.findByRole('button', { name: EN['receptions.summary.approve'] as string })
    );
    expect(
      await screen.findByText(EN['form.violation.already_authorized'] as string)
    ).toBeVisible();
    expect(
      screen.queryByRole('button', {
        name: EN['receptions.command.goToAuthorization'] as string,
      })
    ).toBeNull();
  });

  it('says a version conflict is cured by the re-read it has just done', async () => {
    approveReception.mockResolvedValue({
      status: 'conflict',
      messageKey: 'state.conflict.title',
      correlationId: 'corr-412',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(<SummaryStep {...stepProps()} />);
    await user.click(
      await screen.findByRole('button', { name: EN['receptions.summary.approve'] as string })
    );
    expect(await screen.findByText(EN['receptions.command.conflictStale'] as string)).toBeVisible();
    expect(screen.queryByText(EN['receptions.command.conflictBlocked'] as string)).toBeNull();
  });

  it('re-reads after a conflict as well as after a success', async () => {
    approveReception.mockResolvedValue({
      status: 'conflict',
      messageKey: 'state.conflict.blocked.title',
      correlationId: 'corr-409',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(<SummaryStep {...stepProps()} />);
    await user.click(
      await screen.findByRole('button', { name: EN['receptions.summary.approve'] as string })
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

/* --- FE-020: the two terminal exits --------------------------------------- */

describe('the terminal exits release the vehicle, and both demand a reason', () => {
  /*
   * Both exits are terminal and irreversible, so each asks in `ReasonDialog`:
   * the panel's button opens an alert dialog with the reason box, Cancel is
   * focused, and the dialog's own button sends — never the panel's.
   */
  async function openExit(
    user: ReturnType<typeof userEvent.setup>,
    submitKey: 'receptions.closure.closeSubmit' | 'receptions.closure.refuseSubmit'
  ) {
    await user.click(await screen.findByRole('button', { name: EN[submitKey] as string }));
    return screen.findByRole('alertdialog');
  }

  const reasonBox = (dialog: HTMLElement) =>
    within(dialog).getByRole('textbox', { name: EN['receptions.closure.reason'] as string });

  it('refuses an empty reason beside the field and sends nothing', async () => {
    const user = userEvent.setup();
    renderLtr(<SummaryStep {...stepProps()} />);
    const dialog = await openExit(user, 'receptions.closure.closeSubmit');
    const confirm = within(dialog).getByRole('button', {
      name: EN['receptions.closure.closeSubmit'] as string,
    });
    // Nothing to send while the box is empty, and leaving it says why, on it.
    expect(confirm).toBeDisabled();
    await user.click(reasonBox(dialog));
    await user.tab();
    expect(reasonBox(dialog)).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByText(EN['overlay.reasonRequired'] as string)).toBeVisible();
    expect(closeReceptionWithoutWork).not.toHaveBeenCalled();
  });

  it('asks with Cancel focused, and Cancel sends nothing', async () => {
    const user = userEvent.setup();
    renderLtr(<SummaryStep {...stepProps()} />);
    const dialog = await openExit(user, 'receptions.closure.refuseSubmit');
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: EN['overlay.cancel'] as string })
      ).toHaveFocus()
    );
    await user.click(within(dialog).getByRole('button', { name: EN['overlay.cancel'] as string }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(refuseReception).not.toHaveBeenCalled();
  });

  it('sends close-without-work with the version and the trimmed reason', async () => {
    closeReceptionWithoutWork.mockResolvedValue({
      status: 'success',
      closed: {
        receptionVisitId: 'rv-1',
        receptionStatus: 'closed_without_work',
        recordVersion: 8,
      },
      correlationId: 'corr-ok',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(<SummaryStep {...stepProps()} />);
    const dialog = await openExit(user, 'receptions.closure.closeSubmit');
    await user.type(reasonBox(dialog), '  customer took the car away  ');
    await user.click(
      within(dialog).getByRole('button', { name: EN['receptions.closure.closeSubmit'] as string })
    );
    await waitFor(() => expect(closeReceptionWithoutWork).toHaveBeenCalled());
    expect(closeReceptionWithoutWork.mock.calls[0]?.[1]).toBe(7);
    expect(closeReceptionWithoutWork.mock.calls[0]?.[2]).toEqual({
      reason: 'customer took the car away',
    });
    // The exits are separate commands, and one dialog must never fire the other.
    expect(refuseReception).not.toHaveBeenCalled();
  });

  it('sends refuse from its own dialog, and only that one', async () => {
    refuseReception.mockResolvedValue({
      status: 'success',
      closed: { receptionVisitId: 'rv-1', receptionStatus: 'refused', recordVersion: 8 },
      correlationId: 'corr-ok',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(<SummaryStep {...stepProps()} />);
    const dialog = await openExit(user, 'receptions.closure.refuseSubmit');
    await user.type(reasonBox(dialog), 'the workshop cannot take this vehicle');
    await user.click(
      within(dialog).getByRole('button', { name: EN['receptions.closure.refuseSubmit'] as string })
    );
    await waitFor(() => expect(refuseReception).toHaveBeenCalled());
    expect(refuseReception.mock.calls[0]?.[2]).toEqual({
      reason: 'the workshop cannot take this vehicle',
    });
    expect(closeReceptionWithoutWork).not.toHaveBeenCalled();
  });

  it('bounds the reason field at the route’s own limit', async () => {
    const user = userEvent.setup();
    renderLtr(<SummaryStep {...stepProps()} />);
    const dialog = await openExit(user, 'receptions.closure.closeSubmit');
    expect(reasonBox(dialog)).toHaveAttribute('maxlength', String(MAX_CLOSURE_REASON));
  });

  it('re-reads after a close, so the wizard sees the terminal status', async () => {
    closeReceptionWithoutWork.mockResolvedValue({
      status: 'success',
      closed: {
        receptionVisitId: 'rv-1',
        receptionStatus: 'closed_without_work',
        recordVersion: 8,
      },
      correlationId: 'corr-ok',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(<SummaryStep {...stepProps()} />);
    const dialog = await openExit(user, 'receptions.closure.closeSubmit');
    await user.type(reasonBox(dialog), 'abandoned');
    await user.click(
      within(dialog).getByRole('button', { name: EN['receptions.closure.closeSubmit'] as string })
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('keeps the exit busy until the re-read after it lands', async () => {
    closeReceptionWithoutWork.mockResolvedValue({
      status: 'success',
      closed: {
        receptionVisitId: 'rv-1',
        receptionStatus: 'closed_without_work',
        recordVersion: 8,
      },
      correlationId: 'corr-ok',
      attempt: 1,
    });
    const release = holdNextRefresh();
    const user = userEvent.setup();
    renderLtr(<SummaryStep {...stepProps()} />);
    const dialog = await openExit(user, 'receptions.closure.closeSubmit');
    await user.type(reasonBox(dialog), 'abandoned');
    await user.click(
      within(dialog).getByRole('button', { name: EN['receptions.closure.closeSubmit'] as string })
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    // The dialog is gone, but the exit that opens it again stays busy until
    // the re-read has brought the visit's new state and version.
    const exit = screen.getByRole('button', {
      name: EN['receptions.closure.closeSubmit'] as string,
    });
    expect(exit).toBeDisabled();
    release();
    await waitFor(() => expect(exit).toBeEnabled());
    expect(closeReceptionWithoutWork).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog and the reason when the answer never arrives, and says so', async () => {
    // A rejected Server Action (the connection dropped): not a pending button
    // for ever, not an unhandled rejection — the dialog stays with the reason.
    closeReceptionWithoutWork.mockRejectedValue(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    renderLtr(<SummaryStep {...stepProps()} />);
    const dialog = await openExit(user, 'receptions.closure.closeSubmit');
    await user.type(reasonBox(dialog), 'abandoned');
    await user.click(
      within(dialog).getByRole('button', { name: EN['receptions.closure.closeSubmit'] as string })
    );
    expect(
      await within(dialog).findByText(EN['state.unavailable.message'] as string)
    ).toBeVisible();
    expect(reasonBox(dialog)).toHaveValue('abandoned');
    expect(
      within(dialog).getByRole('button', { name: EN['receptions.closure.closeSubmit'] as string })
    ).toBeEnabled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

/* --- FE-022: conversion, and the replay that is a success ----------------- */

describe('conversion to a work order', () => {
  it('sends the read’s version and names the work order it created', async () => {
    convertReceptionToWorkOrder.mockResolvedValue({
      status: 'success',
      converted: {
        receptionVisitId: 'rv-1',
        workOrderId: 'wo-1',
        displayNumber: 'WO-0001',
        state: 'opened',
        alreadyConverted: false,
      },
      correlationId: 'corr-ok',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(<ConversionStep {...withStatus('authorized')} />);
    await user.click(
      await screen.findByRole('button', { name: EN['receptions.convert.submit'] as string })
    );
    await waitFor(() => expect(convertReceptionToWorkOrder).toHaveBeenCalled());
    expect(convertReceptionToWorkOrder.mock.calls[0]?.[1]).toBe(7);
    expect(await screen.findByText('WO-0001')).toBeVisible();
    expect(screen.getByText(EN['receptions.convert.done'] as string)).toBeVisible();
  });

  it('renders a REPLAY as success, never as an error', async () => {
    // The contract fact this case exists for: a re-run answers 200 with
    // `alreadyConverted: true`. A screen that treated it as a failure would
    // send an operator hunting for the work order the answer just named.
    convertReceptionToWorkOrder.mockResolvedValue({
      status: 'success',
      converted: {
        receptionVisitId: 'rv-1',
        workOrderId: 'wo-1',
        displayNumber: 'WO-0001',
        state: 'opened',
        alreadyConverted: true,
      },
      correlationId: 'corr-replay',
      attempt: 2,
    });
    const user = userEvent.setup();
    renderLtr(<ConversionStep {...withStatus('authorized')} />);
    await user.click(
      await screen.findByRole('button', { name: EN['receptions.convert.submit'] as string })
    );
    expect(await screen.findByText(EN['receptions.convert.replayed'] as string)).toBeVisible();
    expect(screen.getByText('WO-0001')).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders a state outside the platform vocabulary as its code, never as a composed key', async () => {
    convertReceptionToWorkOrder.mockResolvedValue({
      status: 'success',
      converted: {
        receptionVisitId: 'rv-1',
        workOrderId: 'wo-1',
        displayNumber: null,
        state: 'tenant_specific_state',
        alreadyConverted: false,
      },
      correlationId: 'corr-ok',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(<ConversionStep {...withStatus('authorized')} />);
    await user.click(
      await screen.findByRole('button', { name: EN['receptions.convert.submit'] as string })
    );
    expect(await screen.findByText('tenant_specific_state')).toBeVisible();
    expect(document.body.textContent).not.toContain('workOrders.state.');
    // No number is not "no work order": it is a tenant without a sequence.
    expect(screen.getByText(EN['receptions.convert.unnumbered'] as string)).toBeVisible();
  });

  it('offers conversion only where the graph has the edge', async () => {
    for (const status of RECEPTION_STATUSES) {
      const { unmount } = renderLtr(<ConversionStep {...withStatus(status)} />);
      const button = screen.queryByRole('button', {
        name: EN['receptions.convert.submit'] as string,
      });
      expect(button !== null, `convert for ${status}`).toBe(receptionAffordances(status).convert);
      unmount();
    }
  });

  it('states a conflict without inviting a retry the state would refuse', async () => {
    convertReceptionToWorkOrder.mockResolvedValue({
      status: 'conflict',
      messageKey: 'state.conflict.blocked.title',
      correlationId: 'corr-409',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(<ConversionStep {...withStatus('authorized')} />);
    await user.click(
      await screen.findByRole('button', { name: EN['receptions.convert.submit'] as string })
    );
    expect(
      await screen.findByText(EN['receptions.command.conflictBlocked'] as string)
    ).toBeVisible();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('stays busy after a conflict until the re-read lands, so the stale version is not sent again', async () => {
    convertReceptionToWorkOrder.mockResolvedValue({
      status: 'conflict',
      messageKey: 'state.conflict.title',
      correlationId: 'corr-412',
      attempt: 1,
    });
    const release = holdNextRefresh();
    const user = userEvent.setup();
    renderLtr(<ConversionStep {...withStatus('authorized')} />);
    const convert = await screen.findByRole('button', {
      name: EN['receptions.convert.submit'] as string,
    });
    await user.click(convert);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(convert).toBeDisabled();
    expect(convert).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(convert);
    expect(convertReceptionToWorkOrder).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(convert).toBeEnabled());
    expect(convertReceptionToWorkOrder).toHaveBeenCalledTimes(1);
  });

  /**
   * DEF-T-10 reaches this step too, because the API guards conversion with the
   * SAME standing-authorization rule as approval: a withdrawn authorization
   * refuses both commands with the same token. So the sentence has to read
   * correctly under this button — it names the precondition and the step, never
   * the command — and the step has to be reachable from here, which it was not
   * until this screen was handed the wizard's navigation.
   */
  it('names a missing authorization on the conversion refusal too, and offers the same step', async () => {
    convertReceptionToWorkOrder.mockResolvedValue({
      status: 'conflict',
      messageKey: 'form.violation.authorization_withdrawn',
      correlationId: 'corr-conv-auth',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(<ConversionStep {...withStatus('authorized')} />);
    await user.click(
      await screen.findByRole('button', { name: EN['receptions.convert.submit'] as string })
    );
    expect(
      await screen.findByText(EN['form.violation.authorization_withdrawn'] as string)
    ).toBeVisible();
    expect(screen.queryByText(EN['receptions.command.conflictBlocked'] as string)).toBeNull();

    await user.click(
      screen.getByRole('button', { name: EN['receptions.command.goToAuthorization'] as string })
    );
    expect(goToStep).toHaveBeenCalledWith('parties-and-authorization');
  });

  it('reads the work order on intent, and shows its jobs', async () => {
    convertReceptionToWorkOrder.mockResolvedValue({
      status: 'success',
      converted: {
        receptionVisitId: 'rv-1',
        workOrderId: 'wo-1',
        displayNumber: 'WO-0001',
        state: 'opened',
        alreadyConverted: false,
      },
      correlationId: 'corr-ok',
      attempt: 1,
    });
    readConvertedWorkOrder.mockResolvedValue({
      status: 'ok',
      data: {
        workOrder: {
          id: 'wo-1',
          displayNumber: 'WO-0001',
          state: 'opened',
          kind: 'repair',
          receptionVisitId: 'rv-1',
          vehicleId: 'veh-9',
          openedAt: '2026-08-13T09:00:00.000Z',
          recordVersion: 1,
        },
        jobs: [{ id: 'job-1', title: 'Initial inspection', state: 'planned' }],
      },
      correlationId: 'corr-wo',
    });
    const user = userEvent.setup();
    renderLtr(<ConversionStep {...withStatus('authorized')} />);
    await user.click(
      await screen.findByRole('button', { name: EN['receptions.convert.submit'] as string })
    );
    // Not read automatically: the conversion answer already names the order.
    expect(readConvertedWorkOrder).not.toHaveBeenCalled();
    await user.click(
      await screen.findByRole('button', { name: EN['receptions.convert.loadWorkOrder'] as string })
    );
    expect(await screen.findByText('Initial inspection')).toBeVisible();
    expect(readConvertedWorkOrder).toHaveBeenCalledWith('wo-1');
  });

  it('says the work order exists when the operator may not read work orders', async () => {
    convertReceptionToWorkOrder.mockResolvedValue({
      status: 'success',
      converted: {
        receptionVisitId: 'rv-1',
        workOrderId: 'wo-1',
        displayNumber: 'WO-0001',
        state: 'opened',
        alreadyConverted: false,
      },
      correlationId: 'corr-ok',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(
      <ConversionStep
        {...withStatus('authorized', {
          capabilities: { ...CAPABILITIES, readWorkOrders: false },
        })}
      />
    );
    await user.click(
      await screen.findByRole('button', { name: EN['receptions.convert.submit'] as string })
    );
    expect(await screen.findByText(EN['receptions.convert.readDenied'] as string)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: EN['receptions.convert.loadWorkOrder'] as string })
    ).toBeNull();
    // The conversion still succeeded, and says so.
    expect(screen.getByText('WO-0001')).toBeVisible();
  });

  it('links to the NEW work order and says its state in words (Browser QA part 7, row 5.3)', async () => {
    for (const [locale, catalogue, render] of [
      ['en', en, renderLtr],
      ['ar', ar, renderRtl],
    ] as const) {
      convertReceptionToWorkOrder.mockResolvedValue({
        status: 'success',
        converted: {
          receptionVisitId: 'rv-1',
          workOrderId: 'wo-new-7',
          displayNumber: 'WO-0007',
          state: 'draft',
          alreadyConverted: false,
        },
        correlationId: 'corr-ok',
        attempt: 1,
      });
      const words = catalogue as Record<string, string>;
      const user = userEvent.setup();
      const { unmount } = render(
        <ConversionStep {...withStatus('authorized', { locale, messages: catalogue })} />
      );
      await user.click(
        await screen.findByRole('button', { name: words['receptions.convert.submit'] as string })
      );
      const link = await screen.findByRole('link', {
        name: words['receptions.convert.openWorkOrder'] as string,
      });
      expect(link.getAttribute('href')).toBe(`/${locale}/work-orders/wo-new-7`);
      expect(screen.getByText(words['workOrders.state.draft'] as string)).toBeVisible();
      // The raw code is not what the operator reads.
      expect(screen.queryByText('draft')).toBeNull();
      unmount();
    }
  });

  it('offers no link to a work order the operator may not open', async () => {
    convertReceptionToWorkOrder.mockResolvedValue({
      status: 'success',
      converted: {
        receptionVisitId: 'rv-1',
        workOrderId: 'wo-new-7',
        displayNumber: 'WO-0007',
        state: 'draft',
        alreadyConverted: false,
      },
      correlationId: 'corr-ok',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(
      <ConversionStep
        {...withStatus('authorized', {
          capabilities: { ...CAPABILITIES, readWorkOrders: false },
        })}
      />
    );
    await user.click(
      await screen.findByRole('button', { name: EN['receptions.convert.submit'] as string })
    );
    expect(await screen.findByText('WO-0007')).toBeVisible();
    expect(
      screen.queryByRole('link', { name: EN['receptions.convert.openWorkOrder'] as string })
    ).toBeNull();
  });

  /*
   * Browser QA part 7, row 5.3, REVISITED: a visit converted earlier said
   * "already converted" and nothing else, because the conversion's answer was
   * the only thing that named the work order. The visit read now publishes it.
   */
  it('links a visit converted EARLIER to its work order, by number (row 5.3, revisited)', async () => {
    for (const [locale, catalogue, render] of [
      ['en', en, renderLtr],
      ['ar', ar, renderRtl],
    ] as const) {
      const words = catalogue as Record<string, string>;
      const { unmount } = render(
        <ConversionStep
          {...withStatus('converted', {
            locale,
            messages: catalogue,
            detail: {
              ...DETAIL,
              receptionStatus: 'converted',
              workOrderId: 'wo-earlier-3',
              workOrderDisplayNumber: 'WO-0003',
            },
          })}
        />
      );
      expect(
        await screen.findByText(words['receptions.convert.alreadyDone'] as string)
      ).toBeVisible();
      expect(screen.getByText('WO-0003')).toBeVisible();
      const link = screen.getByRole('link', {
        name: words['receptions.convert.openWorkOrder'] as string,
      });
      expect(link.getAttribute('href')).toBe(`/${locale}/work-orders/wo-earlier-3`);
      // Nothing may convert it again.
      expect(
        screen.queryByRole('button', { name: words['receptions.convert.submit'] as string })
      ).toBeNull();
      unmount();
    }
  });

  it('names no work order, and links none, when the visit read publishes none', async () => {
    // A reply that predates the field, or a work order that is gone: the
    // sentence stands alone rather than linking to nothing.
    renderLtr(<ConversionStep {...withStatus('converted')} />);
    expect(await screen.findByText(EN['receptions.convert.alreadyDone'] as string)).toBeVisible();
    expect(
      screen.queryByRole('link', { name: EN['receptions.convert.openWorkOrder'] as string })
    ).toBeNull();
  });

  it('withholds the earlier work order link from an operator who may not open it', async () => {
    renderLtr(
      <ConversionStep
        {...withStatus('converted', {
          capabilities: { ...CAPABILITIES, readWorkOrders: false },
          detail: {
            ...DETAIL,
            receptionStatus: 'converted',
            workOrderId: 'wo-earlier-3',
            workOrderDisplayNumber: 'WO-0003',
          },
        })}
      />
    );
    expect(await screen.findByText('WO-0003')).toBeVisible();
    expect(
      screen.queryByRole('link', { name: EN['receptions.convert.openWorkOrder'] as string })
    ).toBeNull();
    expect(screen.getByText(EN['receptions.convert.readDenied'] as string)).toBeVisible();
  });

  it('says a conversion whose answer never arrived is unavailable, and frees the button', async () => {
    convertReceptionToWorkOrder.mockRejectedValue(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    renderLtr(<ConversionStep {...withStatus('authorized')} />);
    await user.click(
      await screen.findByRole('button', { name: EN['receptions.convert.submit'] as string })
    );
    expect(await screen.findByText(EN['state.unavailable.message'] as string)).toBeVisible();
    expect(
      screen.getByRole('button', { name: EN['receptions.convert.submit'] as string })
    ).toBeEnabled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('withdraws the command from an operator without the conversion permission', async () => {
    renderLtr(
      <ConversionStep
        {...withStatus('authorized', {
          capabilities: { ...CAPABILITIES, convertReceptions: false },
        })}
      />
    );
    expect(await screen.findByText(EN['receptions.convert.denied'] as string)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: EN['receptions.convert.submit'] as string })
    ).toBeNull();
  });
});

/* --- both directions ------------------------------------------------------ */

describe('both directions', () => {
  it('renders the decision surface in Arabic, right to left', async () => {
    renderRtl(<SummaryStep {...stepProps({ locale: 'ar', messages: ar })} />);
    expect(
      await screen.findByRole('heading', {
        name: AR['receptions.summary.decisionHeading'] as string,
      })
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: AR['receptions.summary.approve'] as string })
    ).toBeVisible();
    expect(screen.getByText(AR['receptions.summary.notVerified'] as string)).toBeVisible();
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('renders the conversion replay in Arabic', async () => {
    convertReceptionToWorkOrder.mockResolvedValue({
      status: 'success',
      converted: {
        receptionVisitId: 'rv-1',
        workOrderId: 'wo-1',
        displayNumber: 'WO-0001',
        state: 'opened',
        alreadyConverted: true,
      },
      correlationId: 'corr-replay',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderRtl(<ConversionStep {...withStatus('authorized', { locale: 'ar', messages: ar })} />);
    await user.click(
      await screen.findByRole('button', { name: AR['receptions.convert.submit'] as string })
    );
    expect(await screen.findByText(AR['receptions.convert.replayed'] as string)).toBeVisible();
  });

  /**
   * Owner directive, user-facing errors. Conversion had two refusals of its own
   * and neither had ever been published: a visit that was never approved and a
   * visit that had already been converted both reached the operator as the
   * generic blocked sentence. The first is curable and points at the step that
   * cures it; the second is not, and offers nothing.
   */
  it('names an unapproved visit on conversion, and offers the step that approves it', async () => {
    convertReceptionToWorkOrder.mockResolvedValue({
      status: 'conflict',
      messageKey: 'form.violation.reception_not_authorised',
      correlationId: 'corr-conv-unapproved',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(<ConversionStep {...withStatus('authorized')} />);
    await user.click(
      await screen.findByRole('button', { name: EN['receptions.convert.submit'] as string })
    );
    expect(
      await screen.findByText(EN['form.violation.reception_not_authorised'] as string)
    ).toBeVisible();
    expect(screen.queryByText(EN['receptions.command.conflictBlocked'] as string)).toBeNull();

    await user.click(
      screen.getByRole('button', { name: EN['receptions.command.goToAuthorization'] as string })
    );
    expect(goToStep).toHaveBeenCalledWith('parties-and-authorization');
  });

  it('names an unapproved visit in Arabic too, in Arabic words and not the English ones', async () => {
    convertReceptionToWorkOrder.mockResolvedValue({
      status: 'conflict',
      messageKey: 'form.violation.reception_not_authorised',
      correlationId: 'corr-conv-unapproved-ar',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderRtl(<ConversionStep {...withStatus('authorized', { locale: 'ar', messages: ar })} />);
    await user.click(
      await screen.findByRole('button', { name: AR['receptions.convert.submit'] as string })
    );
    expect(
      await screen.findByText(AR['form.violation.reception_not_authorised'] as string)
    ).toBeVisible();
    // The Arabic catalogue is not the English one wearing an Arabic key.
    expect(screen.queryByText(EN['form.violation.reception_not_authorised'] as string)).toBeNull();
  });

  it('names an already-converted visit without offering a step', async () => {
    convertReceptionToWorkOrder.mockResolvedValue({
      status: 'conflict',
      messageKey: 'form.violation.reception_already_converted',
      correlationId: 'corr-conv-twice',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(<ConversionStep {...withStatus('authorized')} />);
    await user.click(
      await screen.findByRole('button', { name: EN['receptions.convert.submit'] as string })
    );
    expect(
      await screen.findByText(EN['form.violation.reception_already_converted'] as string)
    ).toBeVisible();
    expect(
      screen.queryByRole('button', {
        name: EN['receptions.command.goToAuthorization'] as string,
      })
    ).toBeNull();
  });
});
