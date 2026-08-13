import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import type { CheckInStepProps } from '@/features/receptions/check-in/wizard';
import type { ReceptionDetail } from '@/features/receptions/receptions-contract';

/**
 * Arrival readings, signatures and refusals, rendered (`P1-28-FE-013`,
 * `FE-014`, `FE-018`, `FE-019`).
 *
 * Three different honesty obligations, one per task:
 *
 *   - `FE-013` writes a VEHICLE operation from a Reception screen, and says
 *     where the reading lands;
 *   - `FE-014` reads facts that no operation can amend after check-in, and says
 *     so instead of rendering a control that would have to fail;
 *   - `FE-018` cannot complete its write at all while `P1-OD-025` is open, and
 *     states that where the control would have been — the suite asserts the
 *     absence of a submit control, which is what makes the SEC-004 entry's
 *     `NOT_YET_WIRED` classification true rather than convenient;
 *   - `FE-019` is genuinely wired, and must never be mistaken for the refuse
 *     EXIT command.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

/* --- adapter mocks -------------------------------------------------------- */

const listPartyRoles = vi.fn();
const listAuthorizations = vi.fn();
const recordRefusal = vi.fn();

vi.mock('@/features/receptions/api', () => ({
  listPartyRoles: (...args: unknown[]) => listPartyRoles(...args),
  listAuthorizations: (...args: unknown[]) => listAuthorizations(...args),
  recordRefusal: (...args: unknown[]) => recordRefusal(...args),
}));

const listFuelLevels = vi.fn();
const listRefusalReasons = vi.fn();

vi.mock('@/features/receptions/catalogue-api', () => ({
  listFuelLevels: (...args: unknown[]) => listFuelLevels(...args),
  listRefusalReasons: (...args: unknown[]) => listRefusalReasons(...args),
}));

const listOdometerReadings = vi.fn();
const recordOdometerAction = vi.fn();

vi.mock('@/features/vehicles/history-api', () => ({
  listOdometerReadings: (...args: unknown[]) => listOdometerReadings(...args),
  recordOdometerAction: (...args: unknown[]) => recordOdometerAction(...args),
}));

const searchCustomerDirectory = vi.fn();
vi.mock('@/lib/customers/directory', () => ({
  searchCustomerDirectory: (...args: unknown[]) => searchCustomerDirectory(...args),
}));

const { ReadingsStep } = await import('@/features/receptions/components/steps/ReadingsStep');
const { SignatureStep } = await import('@/features/receptions/components/steps/SignatureStep');
const { RefusalStep } = await import('@/features/receptions/components/steps/RefusalStep');

/* --- fixtures --------------------------------------------------------------- */

function page<Row>(rows: readonly Row[]) {
  return {
    status: 'ok' as const,
    rows,
    nextCursor: null,
    hasMore: false,
    correlationId: 'corr-page',
  };
}

const EMPTY_CATALOGUE = {
  status: 'ok' as const,
  options: [],
  truncated: false,
  correlationId: 'corr-cat',
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
  manageEvidence: true,
  // P1-28-SEC-002: the WF-27 second permission, held here so the existing
  // cases keep exercising the capture forms they were written against.
  viewSensitiveNarratives: true,
  manageSignatures: true,
  recordOdometer: true,
  // Wave F/G widened the contract; the closing steps hold their own suite.
  approveReceptions: true,
  convertReceptions: true,
  closeReceptions: true,
  readWorkOrders: true,
};

function stepProps(over: Partial<CheckInStepProps> = {}): CheckInStepProps {
  return {
    locale: 'en',
    messages: en,
    visitId: 'rv-1',
    recordVersion: 3,
    detail: DETAIL,
    capabilities: CAPABILITIES,
    session: { userId: 'user-1', displayName: 'Front Desk' },
    writesLocked: false,
    refresh: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

const READING = {
  id: 'od-1',
  value: '120000',
  unit: 'km',
  valueKm: '120000',
  observedAt: '2026-08-13T08:00:00.000Z',
  captureMethod: 'manual',
  anomalyFlag: false,
  correctionOf: null,
  correctionReason: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  listPartyRoles.mockResolvedValue(page([]));
  listAuthorizations.mockResolvedValue(page([]));
  listFuelLevels.mockResolvedValue(EMPTY_CATALOGUE);
  listRefusalReasons.mockResolvedValue(EMPTY_CATALOGUE);
  listOdometerReadings.mockResolvedValue(page([]));
  recordOdometerAction.mockResolvedValue({ status: 'success', attempt: 1 });
  searchCustomerDirectory.mockResolvedValue(page([]));
});

/* --- FE-013: odometer ------------------------------------------------------- */

describe('the readings step — odometer (FE-013)', () => {
  it('reads the VEHICLE history for the visit vehicle, and says where a reading lands', async () => {
    listOdometerReadings.mockResolvedValue(page([READING]));
    renderLtr(<ReadingsStep {...stepProps()} />);

    await waitFor(() => expect(listOdometerReadings).toHaveBeenCalled());
    // A cross-domain read: the operation is `veh.vehicle-odometer-history` and
    // the id is the VISIT'S vehicle, not the visit.
    expect(listOdometerReadings.mock.calls.at(-1)![0]).toBe('veh-9');
    expect(await screen.findByText('120000 km')).toBeInTheDocument();
    expect(screen.getByText(EN['receptions.odometer.vehicleScopeNote']!)).toBeInTheDocument();
  });

  it('states the visit reference as not recorded when the visit carries none', async () => {
    // `odometerReadingId` travels only on `rec.reception-create`; no `rec.*`
    // operation amends it, so its absence is a fact and not a missing feature.
    renderLtr(<ReadingsStep {...stepProps()} />);
    const panel = await screen.findByRole('region', { name: EN['receptions.odometer.heading']! });
    expect(panel).toHaveTextContent(EN['receptions.odometer.visitReference']!);
    expect(panel).toHaveTextContent(EN['receptions.evidence.notRecorded']!);
  });

  it('records a reading through the vehicle operation, bound to the visit vehicle', async () => {
    const user = userEvent.setup();
    renderLtr(<ReadingsStep {...stepProps()} />);

    // `RecordForm` has no accessible name, so it is not exposed as `role="form"`.
    // The submit control is the anchor, and its own form is the scope.
    const submit = await screen.findByRole('button', { name: EN['receptions.odometer.record']! });
    const form = submit.closest('form') as HTMLElement;
    // Anchored, not exact: a required field's label carries a trailing asterisk
    // that `getByLabelText` sees (it does not honour `aria-hidden`).
    await user.type(
      within(form).getByLabelText(new RegExp(`^${EN['vehicles.odometer.reading']}`)),
      '120500'
    );
    await user.selectOptions(
      within(form).getByLabelText(new RegExp(`^${EN['vehicles.odometer.unit']}`)),
      'km'
    );
    await user.type(
      within(form).getByLabelText(new RegExp(`^${EN['vehicles.odometer.observedAt']}`)),
      '2026-08-13T09:30'
    );
    await user.click(submit);

    await waitFor(() => expect(recordOdometerAction).toHaveBeenCalled());
    // The adapter is bound to the vehicle id, so the reception screen cannot
    // write a reading against any other vehicle.
    expect(recordOdometerAction.mock.calls.at(-1)![0]).toBe('veh-9');
  });

  it('withdraws the form without veh.vehicle.odometer.record, saying why', async () => {
    renderLtr(
      <ReadingsStep {...stepProps({ capabilities: { ...CAPABILITIES, recordOdometer: false } })} />
    );
    expect(await screen.findByText(EN['receptions.odometer.readOnly']!)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: EN['receptions.odometer.record']! })
    ).not.toBeInTheDocument();
  });

  it('states the missing vehicle-read permission instead of an empty history', async () => {
    renderLtr(
      <ReadingsStep {...stepProps({ capabilities: { ...CAPABILITIES, readVehicles: false } })} />
    );
    expect(
      await screen.findByText(EN['receptions.odometer.needsVehicleRead']!)
    ).toBeInTheDocument();
  });

  it('surfaces a failed history read with its reference and a retry', async () => {
    listOdometerReadings.mockResolvedValue({
      status: 'error',
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: 'corr-500',
    });
    renderLtr(<ReadingsStep {...stepProps()} />);
    expect(await screen.findByText('corr-500')).toBeInTheDocument();
  });

  it('locks the write on a terminal visit', async () => {
    renderLtr(<ReadingsStep {...stepProps({ writesLocked: true })} />);
    expect(await screen.findByText(EN['receptions.evidence.lockedNote']!)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: EN['receptions.odometer.record']! })
    ).not.toBeInTheDocument();
  });
});

/* --- FE-014: fuel level and state of charge -------------------------------- */

describe('the readings step — fuel and charge (FE-014)', () => {
  it('renders what check-in recorded, and says neither can be amended', async () => {
    renderLtr(
      <ReadingsStep
        {...stepProps({
          detail: { ...DETAIL, fuelLevelName: 'Half', evSocPercent: '62.50' },
        })}
      />
    );

    expect(await screen.findByText('Half')).toBeInTheDocument();
    // `numeric(5,2)` travels as a STRING and is rendered as received — never
    // parsed into a float and re-printed.
    expect(screen.getByText('62.50%')).toBeInTheDocument();
    expect(screen.getByTestId('fuel-not-editable')).toHaveTextContent(
      EN['receptions.fuel.notEditable']!
    );
  });

  it('states an empty fuel catalogue as NOT CONFIGURED, never as an error', async () => {
    renderLtr(<ReadingsStep {...stepProps()} />);
    expect(await screen.findByTestId('fuel-catalogue-empty')).toHaveTextContent(
      EN['receptions.fuel.notConfigured']!
    );
    // Zero rows is the catalogue working. Nothing is invented to fill it.
    expect(screen.queryByText(/^Half$/)).not.toBeInTheDocument();
  });

  it('a failed catalogue read is an ERROR with its reference, not emptiness', async () => {
    listFuelLevels.mockResolvedValue({
      status: 'error',
      options: [],
      truncated: false,
      correlationId: 'corr-cat-500',
    });
    renderLtr(<ReadingsStep {...stepProps()} />);
    expect(await screen.findByText('corr-cat-500')).toBeInTheDocument();
    expect(screen.queryByTestId('fuel-catalogue-empty')).not.toBeInTheDocument();
  });

  it('renders the configured levels when a tenant has any', async () => {
    listFuelLevels.mockResolvedValue({
      status: 'ok',
      options: [{ id: 'f-1', scope: 'tenant', code: 'HALF', name: 'Half' }],
      truncated: false,
      correlationId: 'corr-cat',
    });
    renderLtr(<ReadingsStep {...stepProps()} />);
    expect(await screen.findByText('Half')).toBeInTheDocument();
    expect(screen.queryByTestId('fuel-catalogue-empty')).not.toBeInTheDocument();
  });

  it('renders in Arabic, RTL', async () => {
    renderRtl(<ReadingsStep {...stepProps({ locale: 'ar', messages: ar as typeof en })} />);
    expect(document.documentElement.dir).toBe('rtl');
    expect(await screen.findByTestId('fuel-not-editable')).toHaveTextContent(
      AR['receptions.fuel.notEditable']!
    );
  });
});

/* --- FE-018: signatures ----------------------------------------------------- */

describe('the signature step (FE-018)', () => {
  it('states the block and offers NO control that could not work', async () => {
    renderLtr(<SignatureStep {...stepProps()} />);

    expect(await screen.findByTestId('signature-blocked')).toHaveTextContent(
      EN['receptions.signature.blocked']!
    );
    // No submit, and no uuid boxes standing in for a document that cannot be
    // registered. This absence is what makes the SEC-004 `NOT_YET_WIRED` entry
    // for `rec.reception-signature` true.
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/document/i)).not.toBeInTheDocument();
  });

  it('describes media as registered and pending — never as uploaded', async () => {
    renderLtr(<SignatureStep {...stepProps()} />);
    const blocked = await screen.findByTestId('signature-blocked');
    expect(blocked).toHaveTextContent(EN['receptions.signature.mediaState']!);
    // The permanent wording rule while `P1-OD-025` is open, asserted over the
    // rendered text rather than trusted to review.
    expect(document.body.textContent ?? '').not.toMatch(/uploaded/i);
  });

  it('says there is no signature read either, rather than showing an empty list', async () => {
    renderLtr(<SignatureStep {...stepProps()} />);
    expect(await screen.findByText(EN['receptions.signature.noReadBack']!)).toBeInTheDocument();
  });

  it('shows the parties a signature would be attributed to, from the party-role read', async () => {
    listPartyRoles.mockResolvedValue(
      page([
        {
          id: 'role-1',
          partnerId: 'partner-1',
          partnerDisplayName: 'Layla Haddad',
          partnerDisplayNumber: 'C-0001',
          relationshipRole: 'vehicle_owner',
          validFrom: '2026-08-13T07:00:00.000Z',
          validTo: null,
          assignmentSource: null,
          recordVersion: 1,
        },
      ])
    );
    renderLtr(<SignatureStep {...stepProps()} />);

    expect(await screen.findByText('Layla Haddad')).toBeInTheDocument();
    // Only the ACTIVE roles: a party whose interval has closed is not somebody
    // the visit can ask to sign.
    expect(listPartyRoles.mock.calls.at(-1)![1]).toBe('active');
  });

  it('renders in Arabic, RTL', async () => {
    renderRtl(<SignatureStep {...stepProps({ locale: 'ar', messages: ar as typeof en })} />);
    expect(document.documentElement.dir).toBe('rtl');
    expect(await screen.findByTestId('signature-blocked')).toHaveTextContent(
      AR['receptions.signature.blocked']!
    );
  });
});

/* --- FE-019: refusals -------------------------------------------------------- */

describe('the refusal step (FE-019)', () => {
  it('states that recording a refusal is NOT the command that ends the visit', async () => {
    renderLtr(<RefusalStep {...stepProps()} />);
    expect(await screen.findByTestId('refusal-not-exit')).toHaveTextContent(
      EN['receptions.refusal.notTheExit']!
    );
    // `rec.reception-refuse` is a different, version-guarded command and is not
    // on this screen. Nothing here may be labelled as ending anything.
    expect(screen.queryByRole('button', { name: /end (the )?visit/i })).not.toBeInTheDocument();
  });

  it('records a refusal with only what the operator set', async () => {
    recordRefusal.mockResolvedValue({
      status: 'success',
      correlationId: 'corr-ref',
      attempt: 1,
      recorded: { receptionVisitId: 'rv-1', refusalId: 'ref-1', refusalType: 'signature' },
    });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderLtr(<RefusalStep {...stepProps({ refresh })} />);

    const form = await screen.findByRole('form', { name: EN['receptions.refusal.formLabel']! });
    await user.selectOptions(
      within(form).getByLabelText(new RegExp(EN['receptions.refusal.type']!)),
      'signature'
    );
    await user.click(within(form).getByRole('button', { name: EN['receptions.refusal.record']! }));

    await waitFor(() => expect(recordRefusal).toHaveBeenCalled());
    const [visitId, input] = recordRefusal.mock.calls.at(-1)!;
    expect(visitId).toBe('rv-1');
    // Every optional field is `optional()` on a `.strict()` schema: an untouched
    // control leaves the key OFF the body rather than sending a null.
    expect(input).toEqual({ refusalType: 'signature' });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('refuses an AUTHORIZATION refusal with no party, beside the field, before sending', async () => {
    const user = userEvent.setup();
    renderLtr(<RefusalStep {...stepProps()} />);

    const form = await screen.findByRole('form', { name: EN['receptions.refusal.formLabel']! });
    await user.selectOptions(
      within(form).getByLabelText(new RegExp(EN['receptions.refusal.type']!)),
      'authorization'
    );
    await user.click(within(form).getByRole('button', { name: EN['receptions.refusal.record']! }));

    // The mirror of `assertRefusalAttributable`: the refusal becomes that
    // party's STANDING decision, so it must name the party.
    expect(
      await screen.findByText(EN['receptions.refusal.error.partnerRequired']!)
    ).toBeInTheDocument();
    expect(recordRefusal).not.toHaveBeenCalled();
  });

  it('states the empty reason catalogue as NOT CONFIGURED, and still records', async () => {
    recordRefusal.mockResolvedValue({ status: 'success', correlationId: 'c', attempt: 1 });
    const user = userEvent.setup();
    renderLtr(<RefusalStep {...stepProps()} />);

    expect(await screen.findByTestId('refusal-reasons-empty')).toHaveTextContent(
      EN['receptions.refusal.reasonsNotConfigured']!
    );
    const form = screen.getByRole('form', { name: EN['receptions.refusal.formLabel']! });
    await user.selectOptions(
      within(form).getByLabelText(new RegExp(EN['receptions.refusal.type']!)),
      'intake_step'
    );
    await user.click(within(form).getByRole('button', { name: EN['receptions.refusal.record']! }));

    // The reason is `optional()` precisely because the catalogue ships empty —
    // the write still works, and no reason is invented for it.
    await waitFor(() => expect(recordRefusal).toHaveBeenCalled());
    expect(recordRefusal.mock.calls.at(-1)![1]).toEqual({ refusalType: 'intake_step' });
  });

  it('sends the signed-in operator as the witness only when asked', async () => {
    recordRefusal.mockResolvedValue({ status: 'success', correlationId: 'c', attempt: 1 });
    const user = userEvent.setup();
    renderLtr(<RefusalStep {...stepProps()} />);

    const form = await screen.findByRole('form', { name: EN['receptions.refusal.formLabel']! });
    await user.selectOptions(
      within(form).getByLabelText(new RegExp(EN['receptions.refusal.type']!)),
      'other'
    );
    await user.click(within(form).getByLabelText(new RegExp(EN['receptions.refusal.witness']!)));
    await user.click(within(form).getByRole('button', { name: EN['receptions.refusal.record']! }));

    await waitFor(() => expect(recordRefusal).toHaveBeenCalled());
    expect(recordRefusal.mock.calls.at(-1)![1]).toEqual({
      refusalType: 'other',
      witnessEmployeeId: 'user-1',
    });
  });

  it('reads back only the authorization refusals the union returns, and says so', async () => {
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
          id: 'ref-9',
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
    renderLtr(<RefusalStep {...stepProps()} />);

    // Only the refusal arm of the union belongs to this step; the authorization
    // decision beside it is the parties step's business.
    expect(await screen.findByText('Omar Nasser')).toBeInTheDocument();
    expect(screen.queryByText('Layla Haddad')).not.toBeInTheDocument();
    // And the limit of that read is stated: other refusal types are recorded
    // and are returned by nothing.
    expect(screen.getByText(EN['receptions.refusal.readBackLimits']!)).toBeInTheDocument();
  });

  it('renders the non-guessing conflict copy and re-reads after it', async () => {
    recordRefusal.mockResolvedValue({
      status: 'conflict',
      messageKey: 'state.conflict.title',
      correlationId: 'corr-409',
      attempt: 1,
    });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderLtr(<RefusalStep {...stepProps({ refresh })} />);

    const form = await screen.findByRole('form', { name: EN['receptions.refusal.formLabel']! });
    await user.selectOptions(
      within(form).getByLabelText(new RegExp(EN['receptions.refusal.type']!)),
      'signature'
    );
    await user.click(within(form).getByRole('button', { name: EN['receptions.refusal.record']! }));

    expect(await screen.findByText(EN['receptions.evidence.conflict']!)).toBeInTheDocument();
    expect(screen.getByText('corr-409')).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('withdraws the form without the signature permission, and on a terminal visit', async () => {
    const { unmount } = renderLtr(
      <RefusalStep {...stepProps({ capabilities: { ...CAPABILITIES, manageSignatures: false } })} />
    );
    expect(await screen.findByText(EN['receptions.refusal.readOnly']!)).toBeInTheDocument();
    unmount();

    renderLtr(<RefusalStep {...stepProps({ writesLocked: true })} />);
    expect(await screen.findByText(EN['receptions.evidence.lockedNote']!)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: EN['receptions.refusal.record']! })
    ).not.toBeInTheDocument();
  });

  it('renders in Arabic, RTL', async () => {
    renderRtl(<RefusalStep {...stepProps({ locale: 'ar', messages: ar as typeof en })} />);
    expect(document.documentElement.dir).toBe('rtl');
    expect(await screen.findByTestId('refusal-not-exit')).toHaveTextContent(
      AR['receptions.refusal.notTheExit']!
    );
  });
});
