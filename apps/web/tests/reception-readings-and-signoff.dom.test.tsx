import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import type { CheckInStepProps } from '@/features/receptions/check-in/wizard';
import type { ReceptionDetail, SignatureEntry } from '@/features/receptions/receptions-contract';

/**
 * Arrival readings, signatures and refusals, rendered (`P1-28-FE-013`,
 * `FE-014`, `FE-018`, `FE-019`).
 *
 * Four different honesty obligations, one per task:
 *
 *   - `FE-013` writes a VEHICLE operation from a Reception screen, and says
 *     where the reading lands;
 *   - `FE-014` reads facts that no operation can amend after check-in, and says
 *     so instead of rendering a control that would have to fail;
 *   - `FE-018` can complete its write now that `P1-OD-025` is resolved — a
 *     signature image becomes a document and an immutable version through a
 *     Server Action, and `rec.signatures` stores the reference rather than the
 *     bytes. The obligation moved with the capability: what the suite asserts is
 *     no longer an absence but the two rules that make the presence honest —
 *     a signature bound to a version that has not been ACCEPTED cannot be
 *     finalized, and nothing ever leaves the ledger, superseded or repudiated;
 *   - `FE-019` is genuinely wired, and must never be mistaken for the refuse
 *     EXIT command.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

/**
 * One Arabic letter, anywhere in a string.
 *
 * No `\b`: word boundaries in JavaScript are defined over `[A-Za-z0-9_]`, so a
 * boundary placed next to an Arabic letter can never match and an assertion
 * built on one passes by never firing. The range is the whole test. Its own
 * self-test lives in the Arabic case below, because a character class that
 * matched everything and a character class that matched nothing would both make
 * every `toMatch` around it vacuous, in opposite directions.
 */
const ARABIC_LETTER = /[؀-ۿ]/;

/* --- adapter mocks -------------------------------------------------------- */

const listPartyRoles = vi.fn();
const listAuthorizations = vi.fn();
const recordRefusal = vi.fn();
const readSignatures = vi.fn();
const recordSignatureEvent = vi.fn();

/*
 * A factory mock REPLACES the module, so every export a mounted step reaches
 * for has to be listed. A missing one is not a stub returning undefined — the
 * mock proxy throws on property access, from inside `useServerTable`'s effect,
 * as an unhandled rejection that fails the run while the table sits at
 * `loading` and the assertions above it go on passing against a skeleton.
 * `readSignatures` and `recordSignatureEvent` are what `FE-018` added.
 */
vi.mock('@/features/receptions/api', () => ({
  listPartyRoles: (...args: unknown[]) => listPartyRoles(...args),
  listAuthorizations: (...args: unknown[]) => listAuthorizations(...args),
  recordRefusal: (...args: unknown[]) => recordRefusal(...args),
  readSignatures: (...args: unknown[]) => readSignatures(...args),
  recordSignatureEvent: (...args: unknown[]) => recordSignatureEvent(...args),
}));

const captureSignatureEvidence = vi.fn();

/*
 * The signature capture is a Server Action, and a Server Action cannot run in
 * this tier: it registers a document, links it and records the signature
 * through four network calls, and the whole reason it exists is that the
 * browser never performs any of them. What is under test here is the CONSUMER —
 * which fields the form hands the action, and what the step does with the
 * answer it gets back — so the action is a boundary and is mocked as one. Its
 * own sequence is proved against the module, not through a component.
 */
vi.mock('@/features/receptions/signature-capture', () => ({
  captureSignatureEvidence: (...args: unknown[]) => captureSignatureEvidence(...args),
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
  receivingEmployeeDisplayName: 'Dana Receiver',
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
  overrideEvidence: true,
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
  readStaffDirectory: true,
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

/**
 * One row of `rec.reception-signature-list`, complete.
 *
 * Every field is spelled out because `SignatureEntry` declares no optional
 * member: the operation always sends `replacedBySignatureId`, `finalizedAt` and
 * `repudiationReason`, and a fixture that omitted one would hand the step
 * `undefined` where a value always arrives. "Not replaced" and "we never looked"
 * are different facts and only the first one is ever true of this read.
 */
function signature(over: Partial<SignatureEntry> = {}): SignatureEntry {
  return {
    id: 'sig-1',
    signerRole: 'vehicle_owner',
    signerPartnerId: 'partner-1',
    // The one method true of a surface that takes a file; the capture fixes it.
    captureMethod: 'uploaded',
    purpose: 'custody_acceptance',
    documentId: 'doc-1',
    documentVersionId: 'ver-1',
    documentVersionStatus: 'pending',
    integritySha256: null,
    signedAt: '2026-08-13T08:15:00.000Z',
    actorId: 'user-1',
    replacesSignatureId: null,
    replacedBySignatureId: null,
    finalizedAt: null,
    repudiatedAt: null,
    repudiationReason: null,
    status: 'draft',
    ...over,
  };
}

/** What `readSignatures` answers — a `ReadState`, not a table page. */
function ledgerOf(signatures: readonly SignatureEntry[]) {
  return {
    status: 'ok' as const,
    data: { receptionVisitId: 'rv-1', signatures },
    correlationId: 'corr-sig',
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
  // A visit nobody has signed yet: the read SUCCEEDED and returned nothing,
  // which is the only state the "no signature" sentence belongs to.
  readSignatures.mockResolvedValue(ledgerOf([]));
  recordSignatureEvent.mockResolvedValue({
    status: 'success',
    correlationId: 'corr-event',
    attempt: 1,
    recorded: {
      receptionVisitId: 'rv-1',
      signatureId: 'sig-1',
      eventId: 'evt-1',
      eventType: 'finalized',
    },
  });
  captureSignatureEvidence.mockResolvedValue({
    status: 'success',
    correlationId: 'corr-capture',
    attempt: 1,
    stage: 'recorded',
    documentId: 'doc-1',
    versionId: 'ver-1',
    signatureId: 'sig-1',
    // A capture never finalizes, so the version it reports is the one the
    // registration produced — pending until a scanner says otherwise.
    versionStatus: 'pending',
    scannerAvailable: true,
  });
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

/**
 * The signature step, now that it has a write (`P1-28-FE-018`, `P1-OD-025`).
 *
 * These cases used to assert an absence: no form, no submit, no read-back, and
 * a sentence saying why. That was the honest screen for a world in which
 * `rec.reception-signature` demanded a registered document and an exact version
 * that nothing could produce. The Owner resolved the decision, `P1-15` built the
 * registration chain, and the absence stopped being true.
 *
 * An inverted suite would be the wrong replacement — swapping "blocked" for
 * "available" proves the copy changed and nothing else. What is asserted instead
 * is the behaviour of the workflow that replaced the notice. Two of these are
 * rules the DATABASE holds as well — finalization against an accepted version,
 * and a repudiation that carries a reason — and a screen that drifted from
 * either would be offering an operator a control that can only be refused:
 *
 *   - the ledger is a READ, and it renders what the read returned;
 *   - nothing ever leaves it — a superseded signature stays and points forward,
 *     a repudiated one stays and carries its reason;
 *   - the bound VERSION's state is shown per entry, because that state is what
 *     decides whether a signature can become final;
 *   - finalization is offered against an ACCEPTED version and against nothing
 *     else (`rec.guard_signature_event()`);
 *   - a repudiation carries a reason, and cannot be sent without one;
 *   - a read that was REFUSED is not an empty ledger.
 *
 * Each rule is driven in both directions in the same case wherever a single
 * render can hold both, so a pass means the assertion discriminated rather than
 * that the branch it names was never reached.
 */
describe('the signature step (FE-018)', () => {
  it('renders every signature the ledger read returns, in the operator language', async () => {
    readSignatures.mockResolvedValue(
      ledgerOf([
        signature({ id: 'sig-1', signerRole: 'vehicle_owner', purpose: 'custody_acceptance' }),
        signature({
          id: 'sig-2',
          signerRole: 'payer',
          purpose: 'authorization',
          status: 'finalized',
          documentVersionStatus: 'accepted',
          finalizedAt: '2026-08-13T09:00:00.000Z',
        }),
      ])
    );
    renderLtr(<SignatureStep {...stepProps()} />);

    const list = await screen.findByTestId('signature-ledger');
    await waitFor(() => expect(readSignatures).toHaveBeenCalledWith('rv-1'));
    // The guard on every claim below: a list that rendered one row of two would
    // satisfy each `toHaveTextContent` and still be hiding a signature.
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);

    const first = screen.getByTestId('signature-sig-1');
    expect(first).toHaveTextContent(EN['receptions.signerRole.vehicle_owner']!);
    expect(first).toHaveTextContent(EN['receptions.signaturePurpose.custody_acceptance']!);
    const second = screen.getByTestId('signature-sig-2');
    expect(second).toHaveTextContent(EN['receptions.signerRole.payer']!);
    expect(second).toHaveTextContent(EN['receptions.signaturePurpose.authorization']!);

    /*
     * `translateDynamic` renders a key it cannot resolve AS the key, so a
     * namespace that does not exist reaches the operator as
     * `receptions.signature.role.vehicle_owner` on screen and passes every
     * assertion that only checks a row is present. Both halves are asserted:
     * no key text anywhere, and no raw enum member either.
     */
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('receptions.signerRole.');
    expect(body).not.toContain('receptions.signaturePurpose.');
    expect(body).not.toContain('vehicle_owner');
    expect(screen.queryByTestId('signature-none')).not.toBeInTheDocument();
  });

  it('keeps a superseded signature on the ledger, pointing at the one that replaced it', async () => {
    readSignatures.mockResolvedValue(
      ledgerOf([
        signature({
          id: 'sig-1',
          status: 'finalized',
          documentVersionStatus: 'accepted',
          finalizedAt: '2026-08-13T08:30:00.000Z',
          replacedBySignatureId: 'sig-2',
        }),
        signature({ id: 'sig-2', replacesSignatureId: 'sig-1' }),
      ])
    );
    renderLtr(<SignatureStep {...stepProps()} />);

    /*
     * A replacement is a NEW ROW that points at the old one. The temptation a
     * screen faces here is to show the current signature and drop its
     * predecessor, which is the overwrite the Owner decision forbids achieved
     * through a filter instead of an UPDATE — and it would be invisible, because
     * the remaining row looks exactly right.
     */
    const older = await screen.findByTestId('signature-sig-1');
    expect(older).toBeInTheDocument();
    expect(screen.getByTestId('signature-sig-2')).toBeInTheDocument();
    const olderStatus = screen.getByTestId('signature-status-sig-1');
    expect(olderStatus).toHaveTextContent(EN['receptions.signature.status.finalized']!);
    expect(olderStatus).toHaveTextContent(EN['receptions.signature.superseded']!);

    // The other half of the same rule: only the entry that CARRIES the pointer
    // is labelled, so the label is reporting the field rather than the position.
    expect(screen.getByTestId('signature-status-sig-2')).not.toHaveTextContent(
      EN['receptions.signature.superseded']!
    );
    expect(screen.getAllByText(new RegExp(EN['receptions.signature.superseded']!))).toHaveLength(1);
  });

  it('keeps a repudiated signature on the ledger, with the reason it was withdrawn', async () => {
    const REASON = 'The owner states they did not sign for the recorded condition.';
    readSignatures.mockResolvedValue(
      ledgerOf([
        signature({
          id: 'sig-1',
          status: 'repudiated',
          documentVersionStatus: 'accepted',
          finalizedAt: '2026-08-13T08:30:00.000Z',
          repudiatedAt: '2026-08-13T09:30:00.000Z',
          repudiationReason: REASON,
        }),
      ])
    );
    renderLtr(<SignatureStep {...stepProps()} />);

    const row = await screen.findByTestId('signature-sig-1');
    expect(screen.getByTestId('signature-status-sig-1')).toHaveTextContent(
      EN['receptions.signature.status.repudiated']!
    );
    // Withdrawn is not deleted. The row keeps saying who signed and what for,
    // and the reason travels with it — a repudiation with no stated reason is
    // refused by `rec.guard_signature_event()` and would be unaccountable here.
    expect(row).toHaveTextContent(REASON);
    expect(row).toHaveTextContent(EN['receptions.signerRole.vehicle_owner']!);
    // And there is nothing left to do to it: a repudiation is terminal.
    expect(screen.queryByTestId('signature-repudiate-open-sig-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('signature-finalize-sig-1')).not.toBeInTheDocument();
  });

  it('states the exact bound version state on each entry, and on no other', async () => {
    const STATES = ['pending', 'scanning', 'accepted', 'quarantined', 'rejected'] as const;
    readSignatures.mockResolvedValue(
      ledgerOf(
        STATES.map((state, index) =>
          signature({ id: `sig-${index + 1}`, documentVersionStatus: state })
        )
      )
    );
    renderLtr(<SignatureStep {...stepProps()} />);
    await screen.findByTestId('signature-ledger');

    // The sweep asserts it swept: five entries in, five version lines out.
    expect(screen.getAllByTestId(/^signature-version-/)).toHaveLength(STATES.length);
    STATES.forEach((state, index) => {
      expect(screen.getByTestId(`signature-version-sig-${index + 1}`)).toHaveTextContent(
        EN[`receptions.capture.version.${state}`]!
      );
    });

    /*
     * The state shown is the entry's own, not a summary of the visit. Exactly
     * one of the five versions was accepted, so "Accepted" appears exactly once
     * — a screen that reported the best state it found, or the newest, would
     * print it more often than that and would be telling an operator that
     * evidence exists for a signature that has none.
     */
    expect(screen.getAllByText(EN['receptions.capture.version.accepted']!)).toHaveLength(1);
    expect(screen.getAllByText(EN['receptions.capture.version.pending']!)).toHaveLength(1);
  });

  it('offers no way to finalize against a version that has not been accepted', async () => {
    readSignatures.mockResolvedValue(
      ledgerOf([
        signature({ id: 'sig-1', documentVersionStatus: 'pending' }),
        signature({ id: 'sig-2', documentVersionStatus: 'scanning' }),
      ])
    );
    renderLtr(<SignatureStep {...stepProps()} />);
    await screen.findByTestId('signature-ledger');

    /*
     * The operator holds `rec.reception.signature.manage` in these props, so the
     * absence below is about the VERSION and nothing else. `guard_signature_event`
     * refuses a finalization whose bound version is not accepted; a control that
     * can only be refused is worse than no control, so what stands in its place
     * is the reason.
     */
    for (const id of ['sig-1', 'sig-2']) {
      expect(screen.queryByTestId(`signature-finalize-${id}`)).not.toBeInTheDocument();
      expect(screen.getByTestId(`signature-finalize-blocked-${id}`)).toHaveTextContent(
        EN['receptions.signature.finalizeBlocked']!
      );
    }
    expect(screen.getAllByTestId(/^signature-finalize-blocked-/)).toHaveLength(2);
    expect(recordSignatureEvent).not.toHaveBeenCalled();
  });

  it('finalizes against an ACCEPTED version, and sends no reason with it', async () => {
    readSignatures.mockResolvedValue(
      ledgerOf([
        signature({ id: 'sig-1', documentVersionStatus: 'accepted' }),
        signature({ id: 'sig-2', documentVersionStatus: 'pending' }),
      ])
    );
    const user = userEvent.setup();
    renderLtr(<SignatureStep {...stepProps()} />);

    const finalize = await screen.findByTestId('signature-finalize-sig-1');
    // Same render, same permission, same `draft` status: the version is the only
    // difference between the two rows, which is what makes this the version's
    // rule rather than a permission's.
    expect(screen.queryByTestId('signature-finalize-sig-2')).not.toBeInTheDocument();
    expect(screen.getByTestId('signature-finalize-blocked-sig-2')).toBeInTheDocument();
    expect(screen.queryByTestId('signature-finalize-blocked-sig-1')).not.toBeInTheDocument();

    await user.click(finalize);
    await waitFor(() => expect(recordSignatureEvent).toHaveBeenCalled());
    /*
     * `toStrictEqual`, not `toEqual`: an undefined-valued `reason` key compares
     * equal to an absent one under `toEqual`, and "carries no reason" is the
     * whole assertion — the adapter and `rec.guard_signature_event()` both
     * refuse a finalization that carries one.
     */
    expect(recordSignatureEvent.mock.calls.at(-1)).toStrictEqual([
      'rv-1',
      'sig-1',
      { eventType: 'finalized' },
    ]);
  });

  it('will not repudiate without a reason, and sends the one that was typed', async () => {
    readSignatures.mockResolvedValue(
      ledgerOf([
        signature({
          id: 'sig-1',
          status: 'finalized',
          documentVersionStatus: 'accepted',
          finalizedAt: '2026-08-13T08:30:00.000Z',
        }),
        signature({ id: 'sig-2', documentVersionStatus: 'accepted' }),
      ])
    );
    const user = userEvent.setup();
    renderLtr(<SignatureStep {...stepProps()} />);

    /*
     * A repudiation withdraws a FINALIZATION, so it is offered against the
     * finalized row and against the draft beside it — same permission, same
     * accepted version — it is not. `rec.guard_signature_event()` refuses to
     * repudiate what was never made final.
     */
    const open = await screen.findByTestId('signature-repudiate-open-sig-1');
    expect(screen.queryByTestId('signature-repudiate-open-sig-2')).not.toBeInTheDocument();
    await user.click(open);
    const submit = screen.getByTestId('signature-repudiate-submit-sig-1');
    const reason = screen.getByLabelText(EN['receptions.signature.repudiateReason']!);
    expect(submit).toBeDisabled();

    // Whitespace is not a reason — the check is `trim()`, and a form that only
    // tested for emptiness would send three spaces to a column that must say
    // why a recorded act was withdrawn.
    await user.type(reason, '   ');
    expect(submit).toBeDisabled();

    await user.clear(reason);
    await user.type(reason, 'Signed by the wrong party.');
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(recordSignatureEvent).toHaveBeenCalled());
    expect(recordSignatureEvent.mock.calls.at(-1)).toStrictEqual([
      'rv-1',
      'sig-1',
      { eventType: 'repudiated', reason: 'Signed by the wrong party.' },
    ]);
  });

  it('does not report a ledger it could not read as a ledger with nothing on it', async () => {
    readSignatures.mockResolvedValue({ status: 'denied', correlationId: 'corr-403' });
    const denied = renderLtr(<SignatureStep {...stepProps()} />);

    /*
     * "Nobody may read this" and "nothing has been signed" are different facts
     * about a visit, and rendering the first as the second tells an operator a
     * signature does not exist when in truth the screen could not look — on the
     * one screen whose subject is whether somebody signed.
     */
    expect(await screen.findByText(EN['state.denied.title']!)).toBeInTheDocument();
    expect(screen.getByText('corr-403')).toBeInTheDocument();
    expect(screen.queryByTestId('signature-none')).not.toBeInTheDocument();
    expect(screen.queryByTestId('signature-ledger')).not.toBeInTheDocument();
    denied.unmount();

    // The other half, driven rather than assumed: a read that SUCCEEDED and
    // returned nothing is the one case the sentence belongs to.
    readSignatures.mockResolvedValue(ledgerOf([]));
    renderLtr(<SignatureStep {...stepProps()} />);
    expect(await screen.findByTestId('signature-none')).toHaveTextContent(
      EN['receptions.signature.none']!
    );
    expect(screen.queryByText(EN['state.denied.title']!)).not.toBeInTheDocument();
  });

  it('captures a signature through the Server Action, then reads the ledger back', async () => {
    const RECORDED = signature({
      id: 'sig-1',
      signerRole: 'authorized_receiver',
      purpose: 'reception_acknowledgement',
      documentVersionStatus: 'pending',
    });
    // The first read is the visit before anything was signed; every read after
    // the capture is the visit after it.
    readSignatures.mockResolvedValueOnce(ledgerOf([]));
    readSignatures.mockResolvedValue(ledgerOf([RECORDED]));
    const refresh = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderLtr(<SignatureStep {...stepProps({ refresh })} />);

    expect(await screen.findByTestId('signature-none')).toBeInTheDocument();
    const form = screen.getByTestId('signature-capture-form');
    await user.selectOptions(
      within(form).getByLabelText(new RegExp(`^${EN['receptions.signature.signerLabel']}`)),
      'authorized_receiver'
    );
    await user.selectOptions(
      within(form).getByLabelText(new RegExp(`^${EN['receptions.signature.purposeLabel']}`)),
      'reception_acknowledgement'
    );
    const chooser = within(form).getByLabelText(
      EN['receptions.signature.chooseFile']!
    ) as HTMLInputElement;
    await user.upload(chooser, new File(['signature'], 'signature.png', { type: 'image/png' }));
    // The operator's choice landed in the ONE approved file input, which is the
    // only place in this product a file can be chosen at all.
    expect(chooser.files?.[0]?.name).toBe('signature.png');
    await user.click(
      within(form).getByRole('button', { name: EN['receptions.signature.submit']! })
    );

    await waitFor(() => expect(captureSignatureEvidence).toHaveBeenCalled());
    const [visitId, formData] = captureSignatureEvidence.mock.calls.at(-1)! as [string, FormData];
    expect(visitId).toBe('rv-1');
    expect(formData.get('signerRole')).toBe('authorized_receiver');
    expect(formData.get('purpose')).toBe('reception_acknowledgement');

    /*
     * The file entry is asserted by NAME and by KIND, and deliberately not by
     * its contents. `user-event` installs a `files` getter on the element
     * wrapper, while jsdom builds `FormData` from the element's internal state,
     * so the chosen bytes are visible to the DOM — the assertion above — and
     * reach the action as the empty file a browser sends for an untouched
     * input. Claiming more than that here would be asserting a jsdom artefact.
     *
     * What remains provable is the half that actually breaks: the field is
     * submitted under the exact key the Server Action reads back
     * (`signatureFile`), and it is submitted as a FILE rather than as text —
     * a rename on either side would leave the action taking `null` and
     * answering `attachments.capture.empty` for every signature. That the bytes
     * reach a store is proved where they can be, against a real one
     * (`tests/acceptance/storage-round-trip.test.ts`).
     */
    expect(formData.getAll('signatureFile')).toHaveLength(1);
    expect(formData.get('signatureFile')).toBeInstanceOf(File);
    // `signerPartnerId` was left alone and travels as the empty value the
    // placeholder carries; the action drops it rather than attributing the
    // signature to somebody who did not give it.
    expect(formData.get('signerPartnerId')).toBe('');

    /*
     * The other half of the same act, and the reason this case does not stop at
     * the call: a capture that posted correctly and left the screen showing "no
     * signature has been recorded" would be indistinguishable, to the operator,
     * from one that failed silently. The ledger is re-read and the new signature
     * is on it — as a DRAFT, because its version is pending.
     */
    expect(await screen.findByTestId('signature-sig-1')).toBeInTheDocument();
    expect(screen.queryByTestId('signature-none')).not.toBeInTheDocument();
    expect(screen.getByTestId('signature-version-sig-1')).toHaveTextContent(
      EN['receptions.capture.version.pending']!
    );
    expect(screen.getByTestId('signature-status-sig-1')).toHaveTextContent(
      EN['receptions.signature.status.draft']!
    );
    // And the operator is told the same thing in a sentence: recorded, not final.
    expect(screen.getByTestId('signature-outcome')).toHaveTextContent(
      EN['receptions.signature.recordedPending']!
    );
    expect(readSignatures).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('withdraws the capture form without the permission, and on a terminal visit', async () => {
    // A signature that COULD be finalized, so the withdrawals below are about
    // the operator rather than about the state of the evidence.
    readSignatures.mockResolvedValue(
      ledgerOf([signature({ id: 'sig-1', documentVersionStatus: 'accepted' })])
    );

    const withheld = renderLtr(
      <SignatureStep
        {...stepProps({ capabilities: { ...CAPABILITIES, manageSignatures: false } })}
      />
    );
    expect(await screen.findByTestId('signature-capture-withheld')).toHaveTextContent(
      EN['receptions.signature.captureWithheld']!
    );
    expect(screen.queryByTestId('signature-capture-form')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(EN['receptions.signature.chooseFile']!)).not.toBeInTheDocument();
    expect(screen.queryByTestId('signature-finalize-sig-1')).not.toBeInTheDocument();
    // The READ is not withdrawn with the write: an operator who may not sign may
    // still see what was signed, and the ledger is what a handover is read from.
    expect(await screen.findByTestId('signature-sig-1')).toBeInTheDocument();
    withheld.unmount();

    // A terminal visit is a different absence and says so — nothing further can
    // be recorded against it, permission or not.
    const locked = renderLtr(<SignatureStep {...stepProps({ writesLocked: true })} />);
    expect(await screen.findByTestId('signature-capture-withheld')).toHaveTextContent(
      EN['receptions.evidence.lockedNote']!
    );
    expect(screen.queryByTestId('signature-capture-form')).not.toBeInTheDocument();
    locked.unmount();

    // The control: with the permission and an open visit, both are there.
    renderLtr(<SignatureStep {...stepProps()} />);
    expect(await screen.findByTestId('signature-capture-form')).toBeInTheDocument();
    expect(screen.getByLabelText(EN['receptions.signature.chooseFile']!)).toBeInTheDocument();
    expect(await screen.findByTestId('signature-finalize-sig-1')).toBeInTheDocument();
    expect(screen.queryByTestId('signature-capture-withheld')).not.toBeInTheDocument();
  });

  it('offers the parties a signature can be attributed to, from the party-role read', async () => {
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
        {
          id: 'role-2',
          // A party this operator may not name. The row still exists.
          partnerId: 'partner-2',
          partnerDisplayName: null,
          partnerDisplayNumber: null,
          relationshipRole: 'payer',
          validFrom: '2026-08-13T07:00:00.000Z',
          validTo: null,
          assignmentSource: null,
          recordVersion: 1,
        },
      ])
    );
    renderLtr(<SignatureStep {...stepProps()} />);

    // One read, two places: who is on the visit, and who a signature may be
    // attributed to. They cannot disagree because there is nothing to disagree.
    const parties = await screen.findByRole('region', {
      name: EN['receptions.signature.partiesHeading']!,
    });
    expect(within(parties).getByText('Layla Haddad')).toBeInTheDocument();
    const form = screen.getByTestId('signature-capture-form');
    expect(within(form).getByRole('option', { name: 'Layla Haddad' })).toBeInTheDocument();

    /*
     * The unnameable party is still offered — WHO signed is a fact the signature
     * must carry whether or not this screen may print their name — and what
     * stands in for the name is a sentence, never the uuid. Both surfaces are
     * asserted, because the two render through different components.
     */
    expect(
      within(form).getByRole('option', { name: EN['receptions.parties.nameWithheld']! })
    ).toBeInTheDocument();
    expect(within(parties).getByTestId('party-unavailable')).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toContain('partner-2');

    // Only the ACTIVE roles: a party whose interval has closed is not somebody
    // the visit can ask to sign.
    expect(listPartyRoles.mock.calls.at(-1)![1]).toBe('active');
  });

  it('renders in Arabic, RTL', async () => {
    // A draft against an accepted version, so both a read and a control are on
    // screen in Arabic — the two halves are translated by different paths.
    readSignatures.mockResolvedValue(
      ledgerOf([signature({ id: 'sig-1', documentVersionStatus: 'accepted' })])
    );
    renderRtl(<SignatureStep {...stepProps({ locale: 'ar', messages: ar as typeof en })} />);
    expect(document.documentElement.dir).toBe('rtl');

    const row = await screen.findByTestId('signature-sig-1');
    expect(row).toHaveTextContent(AR['receptions.signerRole.vehicle_owner']!);
    expect(screen.getByTestId('signature-status-sig-1')).toHaveTextContent(
      AR['receptions.signature.status.draft']!
    );
    expect(screen.getByTestId('signature-version-sig-1')).toHaveTextContent(
      AR['receptions.capture.version.accepted']!
    );
    // The write is offered in Arabic too — a step that renders its read
    // translated and its controls in English is half-translated in the half the
    // operator has to act in.
    expect(
      screen.getByRole('button', { name: AR['receptions.signature.submit']! })
    ).toBeInTheDocument();
    expect(screen.getByTestId('signature-finalize-sig-1')).toHaveTextContent(
      AR['receptions.signature.finalize']!
    );

    /*
     * Real Arabic, not the English catalogue leaking through and not a key. The
     * matcher's own self-test comes with it: a character class that matched
     * everything and one that matched nothing would both make the line above
     * vacuous, in opposite directions, and `\b` beside an Arabic letter is how
     * that happens by accident.
     */
    expect(ARABIC_LETTER.test(AR['receptions.signature.heading']!)).toBe(true);
    expect(ARABIC_LETTER.test(EN['receptions.signature.heading']!)).toBe(false);
    expect(row.textContent ?? '').toMatch(ARABIC_LETTER);
    expect(row).not.toHaveTextContent(EN['receptions.signerRole.vehicle_owner']!);
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

/* --- F1/F8: what a truncated read may say, and who the inspector is --------- */

describe('F1 — the refusal read-back never reports an unread page as an absence', () => {
  const DECISION_ROW = {
    kind: 'authorization' as const,
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
  };

  const REFUSAL_ROW = {
    kind: 'refusal' as const,
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
  };

  function truncated<Row>(rows: readonly Row[]) {
    return { ...page(rows), nextCursor: 'cursor-2', hasMore: true };
  }

  it('states the absence when the read covered the whole union', async () => {
    // The control: a complete read holding decisions only. `receptions.refusal.empty`
    // had ZERO assertions anywhere before this case.
    listAuthorizations.mockResolvedValue(page([DECISION_ROW]));
    renderLtr(<RefusalStep {...stepProps()} />);

    await waitFor(() =>
      expect(screen.getByTestId('refusal-read-back')).toHaveTextContent(
        EN['receptions.refusal.empty']!
      )
    );
  });

  it('does not claim no refusal was recorded when the union was only partly read', async () => {
    /*
     * The defect. `listAuthorizations` pages a two-table UNION and this step's
     * `kind === 'refusal'` filter runs AFTER the paging, so a page of decisions
     * hid every refusal — while the screen printed "No refusal of an
     * authorization has been recorded for this visit" about a visit whose
     * standing refusal is what blocks approve and convert.
     */
    listAuthorizations.mockResolvedValue(truncated([DECISION_ROW]));
    renderLtr(<RefusalStep {...stepProps()} />);

    await waitFor(() =>
      expect(screen.getByTestId('refusal-read-back')).toHaveTextContent(
        EN['receptions.refusal.emptyTruncated']!
      )
    );
    expect(screen.getByTestId('refusal-read-back')).not.toHaveTextContent(
      EN['receptions.refusal.empty']!
    );
  });

  it('reaches the refusal on the next page rather than only announcing it', async () => {
    listAuthorizations.mockResolvedValue(truncated([DECISION_ROW]));
    const user = userEvent.setup();
    renderLtr(<RefusalStep {...stepProps()} />);
    await screen.findByTestId('refusal-read-back');

    const pager = screen.getByRole('navigation', { name: EN['receptions.refusal.pagerLabel']! });
    listAuthorizations.mockResolvedValue(page([REFUSAL_ROW]));
    await user.click(within(pager).getByRole('button', { name: EN['table.nextPage']! }));

    await waitFor(() =>
      expect(screen.getByText(EN['receptions.authorization.standing']!)).toBeInTheDocument()
    );
    expect(screen.queryByTestId('refusal-read-back')).not.toBeInTheDocument();
  });

  it('says more may exist even when this page DID hold a refusal', async () => {
    // A visible refusal is not proof there is only one, and the standing one
    // that blocks approval may be the one still unread.
    listAuthorizations.mockResolvedValue(truncated([REFUSAL_ROW]));
    renderLtr(<RefusalStep {...stepProps()} />);

    expect(await screen.findByTestId('refusal-more-pages')).toHaveTextContent(
      EN['receptions.refusal.morePages']!
    );
  });

  it('offers no pager and no notice when the read covered the union', async () => {
    listAuthorizations.mockResolvedValue(page([REFUSAL_ROW]));
    renderLtr(<RefusalStep {...stepProps()} />);
    await screen.findByText(EN['receptions.authorization.standing']!);

    expect(screen.queryByTestId('refusal-more-pages')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: EN['receptions.refusal.pagerLabel']! })
    ).not.toBeInTheDocument();
  });

  it('renders the truncated sentence in Arabic, not as a key', async () => {
    listAuthorizations.mockResolvedValue(truncated([DECISION_ROW]));
    renderRtl(<RefusalStep {...stepProps({ messages: ar })} />);

    await waitFor(() =>
      expect(screen.getByTestId('refusal-read-back')).toHaveTextContent(
        AR['receptions.refusal.emptyTruncated']!
      )
    );
  });
});
