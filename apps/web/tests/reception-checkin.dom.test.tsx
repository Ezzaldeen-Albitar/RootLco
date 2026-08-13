import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import type { CheckInStepProps } from '@/features/receptions/check-in/wizard';
import type { ReceptionDetail } from '@/features/receptions/receptions-contract';

/**
 * The check-in wizard, rendered (`P1-28-FE-007`/`FE-008`/`FE-009`).
 *
 * Every adapter is a module mock: what is under test is the SCREEN's
 * behaviour — the origin XOR, the resume offer, the non-guessing 409 copy, the
 * typed step interface, the re-read after a conflict, the union list that
 * renders refusals beside decisions — never the transport, which
 * `write-adapters-driven.test.ts` and the QA-001 mirrors already hold.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

/* --- adapter mocks -------------------------------------------------------- */

const createReception = vi.fn();
const listReceptions = vi.fn();
const readReception = vi.fn();
const listPartyRoles = vi.fn();
const listAuthorizations = vi.fn();
const assignPartyRole = vi.fn();
const recordAuthorization = vi.fn();

vi.mock('@/features/receptions/api', () => ({
  createReception: (...args: unknown[]) => createReception(...args),
  listReceptions: (...args: unknown[]) => listReceptions(...args),
  readReception: (...args: unknown[]) => readReception(...args),
  listPartyRoles: (...args: unknown[]) => listPartyRoles(...args),
  listAuthorizations: (...args: unknown[]) => listAuthorizations(...args),
  assignPartyRole: (...args: unknown[]) => assignPartyRole(...args),
  recordAuthorization: (...args: unknown[]) => recordAuthorization(...args),
}));

const listConfirmedAppointments = vi.fn();
const listReceivingEmployeeCandidates = vi.fn();
const readCustomerSummary = vi.fn();
const readVehicleSummary = vi.fn();
const listVehicleRelationshipEntries = vi.fn();

vi.mock('@/features/receptions/support-api', () => ({
  listConfirmedAppointments: (...args: unknown[]) => listConfirmedAppointments(...args),
  listReceivingEmployeeCandidates: (...args: unknown[]) => listReceivingEmployeeCandidates(...args),
  readCustomerSummary: (...args: unknown[]) => readCustomerSummary(...args),
  readVehicleSummary: (...args: unknown[]) => readVehicleSummary(...args),
  listVehicleRelationshipEntries: (...args: unknown[]) => listVehicleRelationshipEntries(...args),
}));

const listCustomerVehicles = vi.fn();
vi.mock('@/lib/customers/vehicles', () => ({
  listCustomerVehicles: (...args: unknown[]) => listCustomerVehicles(...args),
}));

const searchCustomerDirectory = vi.fn();
vi.mock('@/lib/customers/directory', () => ({
  searchCustomerDirectory: (...args: unknown[]) => searchCustomerDirectory(...args),
}));

const { CheckInStartScreen } = await import('@/features/receptions/components/CheckInStartScreen');
const { CheckInWizardShell } = await import('@/features/receptions/components/CheckInWizardShell');
const { ConfirmationStep } =
  await import('@/features/receptions/components/steps/ConfirmationStep');
const { PartiesStep } = await import('@/features/receptions/components/steps/PartiesStep');
const { CHECK_IN_STEPS } = await import('@/features/receptions/check-in/steps');

/* --- fixtures -------------------------------------------------------------- */

function page<Row>(rows: readonly Row[]) {
  return {
    status: 'ok' as const,
    rows,
    nextCursor: null,
    hasMore: false,
    correlationId: 'corr-page',
  };
}

const APPOINTMENT_ROW = {
  id: 'apt-1',
  displayNumber: 'A-0001',
  vehicleId: 'veh-9',
  vehicleDisplayNumber: 'V-9',
  requesterPartnerId: 'partner-1',
  requesterDisplayName: 'Layla Haddad',
  appointmentTypeName: 'Periodic service',
  confirmedFrom: '2026-08-13T09:00:00.000Z',
  confirmedTo: '2026-08-13T10:00:00.000Z',
};

const OPEN_VISIT_ROW = {
  id: 'rv-77',
  displayNumber: 'R-0077',
  receptionStatus: 'opened',
  origin: 'walk_in',
  vehicleId: 'veh-9',
  vehicleDisplayNumber: 'V-9',
  custodyAcceptedAt: '2026-08-13T07:00:00.000Z',
  custodyReleasedAt: null,
  recordVersion: 4,
};

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
  custodyAcceptedAt: '2026-08-13T07:00:00.000Z',
  custodyReleasedAt: null,
  recordVersion: 3,
  createdAt: '2026-08-13T07:00:00.000Z',
  updatedAt: null,
};

const CAPABILITIES = {
  manageParties: true,
  verifyAuthorizations: true,
  readCustomers: true,
  readVehicles: true,
  // Wave E and Wave F/G capabilities. Present here so the shell cases keep
  // compiling against the widened contract; the evidence and closing steps have
  // their own suites.
  manageEvidence: true,
  // P1-28-SEC-002: the WF-27 second permission, held here so the existing
  // cases keep exercising the capture forms they were written against.
  viewSensitiveNarratives: true,
  manageSignatures: true,
  recordOdometer: true,
  approveReceptions: true,
  convertReceptions: true,
  closeReceptions: true,
  readWorkOrders: true,
};

const SESSION = { userId: 'user-1', displayName: 'Front Desk' };

function startProps(over: Record<string, unknown> = {}) {
  return {
    locale: 'en' as const,
    messages: en,
    sessionUserId: 'user-1',
    sessionUserName: 'Front Desk',
    companyIds: ['company-1'],
    branchIds: ['branch-1'],
    canCreate: true,
    canListAppointments: true,
    canPickEmployee: false,
    canSearchCustomers: true,
    fuelLevels: {
      status: 'ok' as const,
      options: [],
      truncated: false,
      correlationId: null,
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listReceptions.mockResolvedValue(page([]));
  listConfirmedAppointments.mockResolvedValue(page([APPOINTMENT_ROW]));
  listCustomerVehicles.mockResolvedValue(page([]));
  listPartyRoles.mockResolvedValue(page([]));
  listAuthorizations.mockResolvedValue(page([]));
  readReception.mockResolvedValue({ status: 'ok', data: DETAIL, correlationId: 'corr-read' });
  readCustomerSummary.mockResolvedValue({
    status: 'ok',
    data: {
      id: 'partner-1',
      displayNumber: 'C-0001',
      displayName: 'Layla Haddad',
      partyType: 'individual',
      lifecycleStatus: 'active',
    },
    correlationId: 'corr-cust',
  });
  readVehicleSummary.mockResolvedValue({
    status: 'ok',
    data: {
      id: 'veh-9',
      displayNumber: 'V-9',
      vin: '1HGCM82633A004352',
      makeName: 'Alpha',
      modelName: 'Runner',
      modelYear: 2021,
      color: 'White',
      lifecycleStatus: 'active',
      workshopStatus: 'none',
      mergedIntoId: null,
    },
    correlationId: 'corr-veh',
  });
  listVehicleRelationshipEntries.mockResolvedValue(page([]));
});

/* --- FE-007: the start screen ---------------------------------------------- */

describe('the start screen — origin XOR', () => {
  it('starts as a walk-in and shows the requester search, not the appointment picker', () => {
    renderLtr(<CheckInStartScreen {...startProps()} />);
    expect(screen.getByText(EN['receptions.checkIn.requester']!)).toBeInTheDocument();
    expect(screen.queryByText(EN['receptions.checkIn.loadAppointments']!)).not.toBeInTheDocument();
  });

  it('switching to appointment swaps the panels — one origin at a time, ever', async () => {
    const user = userEvent.setup();
    renderLtr(<CheckInStartScreen {...startProps()} />);

    await user.click(screen.getByRole('radio', { name: /Appointment/ }));
    expect(screen.getByText(EN['receptions.checkIn.loadAppointments']!)).toBeInTheDocument();
    expect(screen.queryByText(EN['receptions.checkIn.requester']!)).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Walk-in/ }));
    expect(screen.getByText(EN['receptions.checkIn.requester']!)).toBeInTheDocument();
    expect(screen.queryByText(EN['receptions.checkIn.loadAppointments']!)).not.toBeInTheDocument();
  });

  it('choosing an appointment surfaces the open visit of ITS vehicle, with a resume link', async () => {
    listReceptions.mockResolvedValue(page([OPEN_VISIT_ROW]));
    const user = userEvent.setup();
    renderLtr(<CheckInStartScreen {...startProps()} />);

    await user.click(screen.getByRole('radio', { name: /Appointment/ }));
    await user.click(screen.getByText(EN['receptions.checkIn.loadAppointments']!));
    await user.click(await screen.findByText(/Layla Haddad/));

    // The lookup is filtered by the appointment's OWN vehicle.
    await waitFor(() => {
      expect(listReceptions).toHaveBeenCalled();
    });
    const [, criteria] = listReceptions.mock.calls.at(-1)!;
    expect(criteria).toEqual({ vehicleId: 'veh-9' });

    expect(await screen.findByText(EN['receptions.checkIn.openVisitTitle']!)).toBeInTheDocument();
    const resume = screen.getByRole('link', { name: EN['receptions.checkIn.resume']! });
    expect(resume).toHaveAttribute('href', '/en/receptions/check-in/rv-77');
  });

  it('a 409 on create renders the copy that does NOT guess which rule refused', async () => {
    createReception.mockResolvedValue({
      status: 'conflict',
      messageKey: 'state.conflict.title',
      correlationId: 'corr-409',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(<CheckInStartScreen {...startProps()} />);

    await user.click(screen.getByRole('radio', { name: /Appointment/ }));
    await user.click(screen.getByText(EN['receptions.checkIn.loadAppointments']!));
    await user.click(await screen.findByText(/Layla Haddad/));
    await user.click(screen.getByRole('button', { name: EN['receptions.checkIn.submit']! }));

    // Both readings of ERR-RES-002 in one sentence, plus the reference.
    expect(await screen.findByText(EN['receptions.checkIn.conflictBody']!)).toBeInTheDocument();
    expect(screen.getByText('corr-409')).toBeInTheDocument();
  });

  it('a successful create offers the wizard, by the visit the backend named', async () => {
    createReception.mockResolvedValue({
      status: 'success',
      correlationId: 'corr-ok',
      attempt: 1,
      created: {
        receptionVisitId: 'rv-new',
        displayNumber: 'R-0100',
        receptionStatus: 'opened',
        origin: 'appointment',
        recordVersion: 1,
      },
    });
    const user = userEvent.setup();
    renderLtr(<CheckInStartScreen {...startProps()} />);

    await user.click(screen.getByRole('radio', { name: /Appointment/ }));
    await user.click(screen.getByText(EN['receptions.checkIn.loadAppointments']!));
    await user.click(await screen.findByText(/Layla Haddad/));
    await user.click(screen.getByRole('button', { name: EN['receptions.checkIn.submit']! }));

    expect(await screen.findByText(EN['receptions.checkIn.created']!)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: EN['receptions.checkIn.continue']! })).toHaveAttribute(
      'href',
      '/en/receptions/check-in/rv-new'
    );

    // The appointment-origin command carried the appointment's own identity.
    const [input] = createReception.mock.calls.at(-1)!;
    expect(input).toMatchObject({
      companyId: 'company-1',
      branchId: 'branch-1',
      vehicleId: 'veh-9',
      serviceRequesterPartnerId: 'partner-1',
      origin: { kind: 'appointment', appointmentId: 'apt-1' },
    });
  });

  it('defaults the receiving employee to the operator and states the G-EMP disposition', () => {
    renderLtr(<CheckInStartScreen {...startProps()} />);
    expect(
      screen.getByText(`${EN['receptions.checkIn.employeeSelf']} — Front Desk`)
    ).toBeInTheDocument();
    // The named open decision, on screen — not a name the platform cannot join.
    expect(screen.getByText(EN['receptions.checkIn.employeeHint']!)).toBeInTheDocument();
    // Without `iam.user.read` there is no picker to offer.
    expect(screen.queryByText(EN['receptions.checkIn.employeeChoose']!)).not.toBeInTheDocument();
  });

  it('without rec.reception.manage the create form is withdrawn, with the reason', () => {
    renderLtr(<CheckInStartScreen {...startProps({ canCreate: false })} />);
    expect(screen.getByText(EN['state.denied.title']!)).toBeInTheDocument();
    expect(screen.getByText(EN['receptions.checkIn.createDenied']!)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: EN['receptions.checkIn.submit']! })
    ).not.toBeInTheDocument();
  });

  it('renders in Arabic, RTL, from the same catalogue', () => {
    renderRtl(<CheckInStartScreen {...startProps({ messages: ar as typeof en })} />);
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByText(AR['receptions.checkIn.requester']!)).toBeInTheDocument();
    expect(screen.getByText(AR['receptions.checkIn.employeeHint']!)).toBeInTheDocument();
  });
});

/* --- the walk-in handoff arriving here (FE-006 → FE-007) -------------------- */

/**
 * The consuming end of the seam.
 *
 * The intake ends holding a `(customer, vehicle)` pair and links here carrying
 * it. For three waves nothing read that link: `parseWalkInHandoff` had zero
 * consumers outside the module declaring it, and the address it pointed at did
 * not exist. These cases are the round trip's second half — the first half is
 * `reception-walkin.dom.test.tsx` ("links to the wizard with the exact handoff
 * pair") and `reception-walkin-handoff.test.ts` (the address itself).
 */
describe('the start screen — the walk-in handoff', () => {
  const HANDED_OVER_VEHICLE = {
    id: 'link-9',
    vehicleId: 'veh-9',
    relationshipRole: 'owner',
    validFrom: '2026-08-01',
    validTo: null,
    active: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    vehicleDisplayNumber: 'V-9',
    vin: null,
    makeId: null,
    modelId: null,
    modelYear: null,
    color: null,
    vehicleLifecycleStatus: 'active',
  };

  const OTHER_VEHICLE = {
    ...HANDED_OVER_VEHICLE,
    id: 'link-8',
    vehicleId: 'veh-8',
    vehicleDisplayNumber: 'V-8',
  };

  const handoff = {
    requester: {
      id: 'partner-1',
      displayName: 'Layla Haddad',
      displayNumber: 'C-0001',
      partyType: 'individual',
    },
    vehicleId: 'veh-9',
  };

  /** Every row of the vehicle picker, once it has rendered. */
  async function vehicleChoices() {
    const group = await screen.findByRole('group', {
      name: EN['receptions.checkIn.vehicleLabel']!,
    });
    return within(group).getAllByRole('button');
  }

  const pressed = (buttons: readonly HTMLElement[]) =>
    buttons.filter((button) => button.getAttribute('aria-pressed') === 'true');

  /**
   * The chosen row, waited for.
   *
   * The pre-selection cannot happen before the vehicle list answers — the form
   * submits a ROW, not the identifier the handoff carried — so the picker
   * renders one tick before anything in it is pressed. Reading the rows and
   * asserting immediately passes alone and fails under a loaded suite, which is
   * a latent flake rather than a check.
   */
  async function chosenVehicles(): Promise<readonly HTMLElement[]> {
    let chosen: readonly HTMLElement[] = [];
    await waitFor(async () => {
      chosen = pressed(await vehicleChoices());
      expect(chosen).toHaveLength(1);
    });
    return chosen;
  }

  it('pre-selects the customer and the vehicle the intake just recorded', async () => {
    listCustomerVehicles.mockResolvedValue(page([OTHER_VEHICLE, HANDED_OVER_VEHICLE]));
    renderLtr(<CheckInStartScreen {...startProps({ walkInHandoff: handoff })} />);

    // The customer is already chosen — by NAME, never by identifier — so the
    // search controls are not what the operator is looking at.
    expect(screen.getByText('Layla Haddad')).toBeInTheDocument();
    expect(screen.getByTestId('customer-selector-value')).toHaveValue('partner-1');
    expect(screen.queryByText(EN['customerSelector.idle']!)).not.toBeInTheDocument();

    // The vehicle list is read for THAT customer, and the handed-over row is
    // the chosen one — not merely present in the list.
    await waitFor(() => expect(listCustomerVehicles).toHaveBeenCalled());
    expect(listCustomerVehicles.mock.calls.at(-1)![0]).toBe('partner-1');

    expect(await vehicleChoices()).toHaveLength(2);
    const chosen = await chosenVehicles();
    expect(within(chosen[0]!).getByText('V-9')).toBeInTheDocument();
    expect(
      within(chosen[0]!).getByText(EN['receptions.checkIn.vehicleChosen']!)
    ).toBeInTheDocument();

    // And the screen says why the form arrived filled in.
    expect(screen.getByTestId('walk-in-handoff-notice')).toHaveTextContent(
      EN['receptions.checkIn.handoffApplied']!
    );
  });

  it('submits the handed-over pair without the operator touching either control', async () => {
    listCustomerVehicles.mockResolvedValue(page([HANDED_OVER_VEHICLE]));
    createReception.mockResolvedValue({ status: 'success', correlationId: 'c', attempt: 1 });
    const user = userEvent.setup();
    renderLtr(<CheckInStartScreen {...startProps({ walkInHandoff: handoff })} />);

    await chosenVehicles();
    await user.click(screen.getByRole('button', { name: EN['receptions.checkIn.submit']! }));

    await waitFor(() => expect(createReception).toHaveBeenCalled());
    const [input] = createReception.mock.calls.at(-1)!;
    expect(input).toMatchObject({
      vehicleId: 'veh-9',
      serviceRequesterPartnerId: 'partner-1',
      origin: { kind: 'walk_in' },
    });
  });

  it('states it when the handed-over vehicle is not on that customer list', async () => {
    listCustomerVehicles.mockResolvedValue(page([OTHER_VEHICLE]));
    renderLtr(<CheckInStartScreen {...startProps({ walkInHandoff: handoff })} />);

    await waitFor(() =>
      expect(screen.getByTestId('walk-in-handoff-notice')).toHaveTextContent(
        EN['receptions.checkIn.handoffVehicleMissing']!
      )
    );
    // Nothing is pre-selected on a guess: the operator chooses.
    expect(pressed(await vehicleChoices())).toHaveLength(0);
  });

  it('starts empty when the page passes no handoff', () => {
    renderLtr(<CheckInStartScreen {...startProps()} />);
    expect(screen.queryByTestId('walk-in-handoff-notice')).not.toBeInTheDocument();
    expect(screen.getByText(EN['customerSelector.idle']!)).toBeInTheDocument();
  });

  it('is consumed once — switching origin drops it and switching back does not restore it', async () => {
    listCustomerVehicles.mockResolvedValue(page([HANDED_OVER_VEHICLE]));
    const user = userEvent.setup();
    renderLtr(<CheckInStartScreen {...startProps({ walkInHandoff: handoff })} />);
    await chosenVehicles();

    await user.click(screen.getByRole('radio', { name: /Appointment/ }));
    await user.click(screen.getByRole('radio', { name: /Walk-in/ }));

    // A pre-selection that comes back after the operator moved away from it is
    // the XOR being circumvented in state — the same rule the appointment side
    // already obeys. The requester itself survives an origin switch, as it
    // always has; what must not survive is the VEHICLE nobody re-chose.
    expect(screen.queryByTestId('walk-in-handoff-notice')).not.toBeInTheDocument();
    expect(pressed(await vehicleChoices())).toHaveLength(0);
  });

  it('renders the handoff notice in Arabic too', async () => {
    listCustomerVehicles.mockResolvedValue(page([HANDED_OVER_VEHICLE]));
    renderRtl(
      <CheckInStartScreen {...startProps({ messages: ar as typeof en, walkInHandoff: handoff })} />
    );
    expect(await screen.findByTestId('walk-in-handoff-notice')).toHaveTextContent(
      AR['receptions.checkIn.handoffApplied']!
    );
  });
});

/* --- the shell and its typed step interface -------------------------------- */

describe('the wizard shell', () => {
  it('hands every registered step exactly the typed contract, and refresh re-sources the version', async () => {
    const seen: CheckInStepProps[] = [];
    const FakeStep = (props: CheckInStepProps) => {
      seen.push(props);
      return (
        <button type="button" onClick={() => void props.refresh()}>
          fake-step-refresh
        </button>
      );
    };
    readReception.mockResolvedValue({
      status: 'ok',
      data: { ...DETAIL, recordVersion: 9 },
      correlationId: 'corr-reread',
    });

    const user = userEvent.setup();
    renderLtr(
      <CheckInWizardShell
        locale="en"
        messages={en}
        initialDetail={DETAIL}
        steps={[
          {
            id: 'fake',
            titleKey: 'receptions.steps.confirm.title',
            descriptionKey: 'receptions.steps.confirm.description',
            Component: FakeStep,
          },
        ]}
        capabilities={CAPABILITIES}
        session={SESSION}
      />
    );

    expect(seen.at(-1)).toMatchObject({
      visitId: 'rv-1',
      recordVersion: 3,
      writesLocked: false,
    });

    // The 409/412 discipline: a step that hits a conflict calls refresh, the
    // shell re-reads `rec.reception-detail`, and every step re-renders with
    // the CURRENT version — never a cached guess (QA-004).
    await user.click(screen.getByText('fake-step-refresh'));
    await waitFor(() => {
      expect(seen.at(-1)?.recordVersion).toBe(9);
    });
    expect(readReception).toHaveBeenCalledWith('rv-1');
  });

  it('renders the registry steps as a step navigation and switches on choice', async () => {
    const user = userEvent.setup();
    renderLtr(
      <CheckInWizardShell
        locale="en"
        messages={en}
        initialDetail={DETAIL}
        steps={CHECK_IN_STEPS}
        capabilities={CAPABILITIES}
        session={SESSION}
      />
    );

    const first = screen.getByRole('button', {
      name: `1. ${EN['receptions.steps.confirm.title']}`,
    });
    expect(first).toHaveAttribute('aria-current', 'step');

    await user.click(
      screen.getByRole('button', { name: `2. ${EN['receptions.steps.parties.title']}` })
    );
    expect(await screen.findByText(EN['receptions.parties.rolesHeading']!)).toBeInTheDocument();
  });

  it('states a terminal visit and locks every step', () => {
    const seen: CheckInStepProps[] = [];
    const FakeStep = (props: CheckInStepProps) => {
      seen.push(props);
      return null;
    };
    renderLtr(
      <CheckInWizardShell
        locale="en"
        messages={en}
        initialDetail={{ ...DETAIL, receptionStatus: 'converted' }}
        steps={[
          {
            id: 'fake',
            titleKey: 'receptions.steps.confirm.title',
            descriptionKey: 'receptions.steps.confirm.description',
            Component: FakeStep,
          },
        ]}
        capabilities={CAPABILITIES}
        session={SESSION}
      />
    );
    // The status name appears in the header AND in the banner — scope to the
    // banner so the assertion is about the terminal statement itself.
    const banner = screen.getByRole('status');
    expect(within(banner).getByText(EN['receptions.wizard.terminal']!)).toBeInTheDocument();
    expect(within(banner).getByText(EN['receptions.status.converted']!)).toBeInTheDocument();
    expect(seen.at(-1)?.writesLocked).toBe(true);
  });

  it('shows the receiving employee as an identifier with the G-EMP note', () => {
    renderLtr(
      <CheckInWizardShell
        locale="en"
        messages={en}
        initialDetail={DETAIL}
        steps={CHECK_IN_STEPS}
        capabilities={CAPABILITIES}
        session={SESSION}
      />
    );
    expect(screen.getByText('user-77')).toBeInTheDocument();
    expect(screen.getByText(EN['receptions.wizard.receivingEmployeeNote']!)).toBeInTheDocument();
  });
});

/* --- FE-008: the confirmation step ----------------------------------------- */

function stepProps(over: Partial<CheckInStepProps> = {}): CheckInStepProps {
  return {
    locale: 'en',
    messages: en,
    visitId: 'rv-1',
    recordVersion: 3,
    detail: DETAIL,
    capabilities: CAPABILITIES,
    session: SESSION,
    writesLocked: false,
    refresh: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe('the confirmation step', () => {
  it('presents the requester from the active service_requester role and reads the customer', async () => {
    listPartyRoles.mockResolvedValue(
      page([
        {
          id: 'role-1',
          partnerId: 'partner-1',
          partnerDisplayName: 'Layla Haddad',
          partnerDisplayNumber: 'C-0001',
          relationshipRole: 'service_requester',
          validFrom: '2026-08-13T07:00:00.000Z',
          validTo: null,
          assignmentSource: null,
          recordVersion: 1,
        },
      ])
    );
    renderLtr(<ConfirmationStep {...stepProps()} />);

    expect(await screen.findByText('Layla Haddad')).toBeInTheDocument();
    await waitFor(() => {
      expect(readCustomerSummary).toHaveBeenCalledWith('partner-1');
    });
    expect(await screen.findByText(EN['crm.partyType.individual']!)).toBeInTheDocument();
  });

  it('renders a MERGED vehicle honestly — a fact with a link, never a 404', async () => {
    readVehicleSummary.mockResolvedValue({
      status: 'ok',
      data: {
        id: 'veh-9',
        displayNumber: 'V-9',
        vin: null,
        makeName: null,
        modelName: null,
        modelYear: null,
        color: null,
        lifecycleStatus: 'merged',
        workshopStatus: 'none',
        mergedIntoId: 'veh-surviving',
      },
      correlationId: 'corr-merged',
    });
    renderLtr(<ConfirmationStep {...stepProps()} />);

    expect(await screen.findByText(EN['receptions.confirm.vehicleMerged']!)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: EN['receptions.confirm.vehicleMergedLink']! })
    ).toHaveAttribute('href', '/en/vehicles/veh-surviving');
    expect(screen.queryByText(EN['state.notFound.title']!)).not.toBeInTheDocument();
  });

  it('states the recorded link in both directions — and its absence as a fact, not an error', async () => {
    listPartyRoles.mockResolvedValue(
      page([
        {
          id: 'role-1',
          partnerId: 'partner-1',
          partnerDisplayName: 'Layla Haddad',
          partnerDisplayNumber: null,
          relationshipRole: 'service_requester',
          validFrom: '2026-08-13T07:00:00.000Z',
          validTo: null,
          assignmentSource: null,
          recordVersion: 1,
        },
      ])
    );
    listCustomerVehicles.mockResolvedValue(
      page([
        {
          id: 'link-1',
          vehicleId: 'veh-OTHER',
          relationshipRole: 'owner',
          validFrom: '2026-01-01',
          validTo: null,
          active: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          vehicleDisplayNumber: null,
          vin: null,
          makeId: null,
          modelId: null,
          modelYear: null,
          color: null,
          vehicleLifecycleStatus: null,
        },
      ])
    );
    renderLtr(<ConfirmationStep {...stepProps()} />);

    expect(await screen.findByText(EN['receptions.confirm.linkAbsent']!)).toBeInTheDocument();
  });

  it('a denied identity panel says so, with the backend reference', async () => {
    listPartyRoles.mockResolvedValue(
      page([
        {
          id: 'role-1',
          partnerId: 'partner-1',
          partnerDisplayName: 'Layla Haddad',
          partnerDisplayNumber: null,
          relationshipRole: 'service_requester',
          validFrom: '2026-08-13T07:00:00.000Z',
          validTo: null,
          assignmentSource: null,
          recordVersion: 1,
        },
      ])
    );
    readCustomerSummary.mockResolvedValue({ status: 'denied', correlationId: 'corr-403' });
    renderLtr(<ConfirmationStep {...stepProps()} />);

    expect((await screen.findAllByText(EN['state.denied.title']!)).length).toBeGreaterThan(0);
    expect(await screen.findByText('corr-403')).toBeInTheDocument();
  });

  it('offers NO control labelled Confirm — nothing implements one', async () => {
    renderLtr(<ConfirmationStep {...stepProps()} />);
    await screen.findByText(EN['receptions.confirm.proceedNote']!);
    // Truthful labelling: no rec.* operation records a confirmation, so no
    // button may claim to.
    expect(screen.queryByRole('button', { name: /^confirm/i })).not.toBeInTheDocument();
  });
});

/* --- FE-009: parties and authorization -------------------------------------- */

describe('the parties step', () => {
  it('renders the authorization UNION: decisions AND refusals, each attributed and marked', async () => {
    listAuthorizations.mockResolvedValue(
      page([
        {
          kind: 'authorization',
          id: 'auth-1',
          partnerId: 'partner-1',
          partnerDisplayName: 'Layla Haddad',
          authorizingRole: 'vehicle_owner',
          decision: 'approved',
          channel: 'in_person',
          authorizedScope: null,
          evidenceDocumentId: null,
          occurredAt: '2026-08-13T08:30:00.000Z',
          isStanding: false,
        },
        {
          kind: 'refusal',
          id: 'ref-1',
          partnerId: 'partner-2',
          partnerDisplayName: 'Omar Nasser',
          authorizingRole: null,
          decision: 'declined',
          channel: null,
          authorizedScope: null,
          evidenceDocumentId: null,
          occurredAt: '2026-08-13T08:45:00.000Z',
          isStanding: true,
        },
      ])
    );
    renderLtr(<PartiesStep {...stepProps()} />);

    // Each row is judged INSIDE its own list item: the decision vocabulary
    // also appears among the form's options, and an unscoped query would
    // count those.
    const refusalRow = (await screen.findByText('Omar Nasser')).closest('li') as HTMLElement;
    // A refusal row is labelled refusal EVIDENCE, never dressed as a declined
    // authorization — the two are different operations.
    expect(
      within(refusalRow).getByText(EN['receptions.authorization.kindRefusal']!)
    ).toBeInTheDocument();
    expect(
      within(refusalRow).getByText(EN['receptions.authorization.declined']!)
    ).toBeInTheDocument();
    // `isStanding` marks the partner's CURRENT decision — here the refusal.
    expect(
      within(refusalRow).getByText(EN['receptions.authorization.standing']!)
    ).toBeInTheDocument();

    const authRow = screen.getByText('Layla Haddad').closest('li') as HTMLElement;
    expect(
      within(authRow).getByText(EN['receptions.authorization.kindAuthorization']!)
    ).toBeInTheDocument();
    expect(within(authRow).getByText(EN['receptions.authorization.approved']!)).toBeInTheDocument();
    expect(
      within(authRow).queryByText(EN['receptions.authorization.standing']!)
    ).not.toBeInTheDocument();
  });

  it('records a party role and re-reads: list, and the shell detail, after success', async () => {
    searchCustomerDirectory.mockResolvedValue(
      page([
        {
          id: 'partner-3',
          displayName: 'Huda Salem',
          displayNumber: 'C-0003',
          partyType: 'individual',
          lifecycleStatus: 'active',
        },
      ])
    );
    assignPartyRole.mockResolvedValue({
      status: 'success',
      correlationId: 'corr-role',
      attempt: 1,
      assigned: {
        receptionVisitId: 'rv-1',
        partyRoleId: 'role-9',
        relationshipRole: 'payer',
        superseded: false,
      },
    });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderLtr(<PartiesStep {...stepProps({ refresh })} />);

    // Choose the partner through the shared selector.
    const form = await screen.findByRole('form', {
      name: EN['receptions.parties.formLabel']!,
    });
    const nameBoxes = screen.getAllByLabelText(EN['crm.customers.column.name']!);
    await user.type(nameBoxes[0]!, 'Huda');
    await user.click(screen.getAllByRole('button', { name: EN['customerSelector.search']! })[0]!);
    await user.click(await screen.findByText('Huda Salem'));

    await user.selectOptions(
      screen.getByLabelText(new RegExp(EN['receptions.parties.role']!)),
      'payer'
    );
    await user.click(screen.getByRole('button', { name: EN['receptions.parties.assign']! }));

    await waitFor(() => {
      expect(assignPartyRole).toHaveBeenCalled();
    });
    const [visitId, input] = assignPartyRole.mock.calls.at(-1)!;
    expect(visitId).toBe('rv-1');
    expect(input).toMatchObject({
      partnerId: 'partner-3',
      relationshipRole: 'payer',
      supersede: false,
    });
    // Success re-reads the shell's detail — the version the guarded commands
    // will need next is never left stale.
    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
    expect(form).toBeInTheDocument();
  });

  it('a 409 verdict renders the non-guessing copy AND triggers the re-read', async () => {
    searchCustomerDirectory.mockResolvedValue(
      page([
        {
          id: 'partner-3',
          displayName: 'Huda Salem',
          displayNumber: 'C-0003',
          partyType: 'individual',
          lifecycleStatus: 'active',
        },
      ])
    );
    recordAuthorization.mockResolvedValue({
      status: 'conflict',
      messageKey: 'state.conflict.title',
      correlationId: 'corr-trn',
      attempt: 1,
    });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderLtr(<PartiesStep {...stepProps({ refresh })} />);

    await screen.findByRole('form', { name: EN['receptions.authorization.formLabel']! });
    const nameBoxes = screen.getAllByLabelText(EN['crm.customers.column.name']!);
    await user.type(nameBoxes.at(-1)!, 'Huda');
    await user.click(
      screen.getAllByRole('button', { name: EN['customerSelector.search']! }).at(-1)!
    );
    await user.click(await screen.findByText('Huda Salem'));

    await user.selectOptions(
      screen.getByLabelText(new RegExp(EN['receptions.authorization.role']!)),
      'vehicle_owner'
    );
    await user.selectOptions(
      screen.getByLabelText(new RegExp(`^${EN['receptions.authorization.decision']!}`)),
      'declined'
    );
    await user.click(screen.getByRole('button', { name: EN['receptions.authorization.record']! }));

    // Role-not-held and the state guard answer the SAME non-disclosing 409
    // `ERR-TRN-001` (anti-probing) — the copy must not guess which.
    expect(await screen.findByText(EN['receptions.authorization.conflict']!)).toBeInTheDocument();
    // And the truth is re-read rather than left where the race lost (QA-004).
    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
  });

  it('withdraws the write forms without their permissions, saying why', async () => {
    renderLtr(
      <PartiesStep
        {...stepProps({
          capabilities: { ...CAPABILITIES, manageParties: false, verifyAuthorizations: false },
        })}
      />
    );
    expect(await screen.findByText(EN['receptions.parties.rolesReadOnly']!)).toBeInTheDocument();
    expect(screen.getByText(EN['receptions.authorization.readOnly']!)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: EN['receptions.parties.assign']! })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: EN['receptions.authorization.record']! })
    ).not.toBeInTheDocument();
  });

  it('locks every write on a terminal visit', async () => {
    renderLtr(<PartiesStep {...stepProps({ writesLocked: true })} />);
    expect(await screen.findByText(EN['receptions.parties.rolesHeading']!)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: EN['receptions.parties.assign']! })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: EN['receptions.authorization.record']! })
    ).not.toBeInTheDocument();
  });

  it('renders in Arabic, RTL', async () => {
    renderRtl(<PartiesStep {...stepProps({ locale: 'ar', messages: ar as typeof en })} />);
    expect(document.documentElement.dir).toBe('rtl');
    expect(await screen.findByText(AR['receptions.parties.rolesHeading']!)).toBeInTheDocument();
    expect(screen.getByText(AR['receptions.authorization.heading']!)).toBeInTheDocument();
  });
});
