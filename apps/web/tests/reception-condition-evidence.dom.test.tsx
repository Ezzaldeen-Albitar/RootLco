import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import type { CheckInStepProps } from '@/features/receptions/check-in/wizard';
import type { ReceptionDetail } from '@/features/receptions/receptions-contract';

/**
 * The condition-evidence wizard steps, rendered (`P1-28-FE-010`, `FE-011`,
 * `FE-012`, `FE-015`, `FE-016`).
 *
 * Every adapter is a module mock: what is under test is the SCREEN — the
 * customer's-words distinction, the open-inspection gate, the coordinate
 * capture, the empty-catalogue statement, the currency pair rule, and the
 * read-back that honestly cannot return what was typed. The transport is held
 * by the QA-001 mirrors and `reception-evidence.test.ts`.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

/* --- adapter mocks -------------------------------------------------------- */

const recordConditionEvidence = vi.fn();
const listConditionEvidence = vi.fn();
const listPartyRoles = vi.fn();
const listAuthorizations = vi.fn();
const recordRefusal = vi.fn();

vi.mock('@/features/receptions/api', () => ({
  recordConditionEvidence: (...args: unknown[]) => recordConditionEvidence(...args),
  listConditionEvidence: (...args: unknown[]) => listConditionEvidence(...args),
  listPartyRoles: (...args: unknown[]) => listPartyRoles(...args),
  listAuthorizations: (...args: unknown[]) => listAuthorizations(...args),
  recordRefusal: (...args: unknown[]) => recordRefusal(...args),
}));

const listWarningLightCodes = vi.fn();
const listFuelLevels = vi.fn();
const listRefusalReasons = vi.fn();

vi.mock('@/features/receptions/catalogue-api', () => ({
  listWarningLightCodes: (...args: unknown[]) => listWarningLightCodes(...args),
  listFuelLevels: (...args: unknown[]) => listFuelLevels(...args),
  listRefusalReasons: (...args: unknown[]) => listRefusalReasons(...args),
}));

const searchCustomerDirectory = vi.fn();
vi.mock('@/lib/customers/directory', () => ({
  searchCustomerDirectory: (...args: unknown[]) => searchCustomerDirectory(...args),
}));

const { ComplaintsStep } = await import('@/features/receptions/components/steps/ComplaintsStep');
const { InspectionStep } = await import('@/features/receptions/components/steps/InspectionStep');
const { DamageMapStep } = await import('@/features/receptions/components/steps/DamageMapStep');
const { WarningLightsStep } =
  await import('@/features/receptions/components/steps/WarningLightsStep');
const { ContentsStep } = await import('@/features/receptions/components/steps/ContentsStep');

/* --- fixtures --------------------------------------------------------------- */

function page<Row>(rows: readonly Row[], hasMore = false) {
  return {
    status: 'ok' as const,
    rows,
    nextCursor: null,
    hasMore,
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

/** Routes the one list operation by the kind it was asked for. */
function evidenceByKind(rows: Partial<Record<string, readonly unknown[]>>) {
  listConditionEvidence.mockImplementation((_visitId: string, kind: string) =>
    Promise.resolve(page(rows[kind] ?? []))
  );
}

function recorded(evidenceId: string, kind: string) {
  return {
    status: 'success' as const,
    correlationId: 'corr-write',
    attempt: 1,
    recorded: { receptionVisitId: 'rv-1', kind, evidenceId },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  evidenceByKind({});
  listPartyRoles.mockResolvedValue(page([]));
  listAuthorizations.mockResolvedValue(page([]));
  listWarningLightCodes.mockResolvedValue(EMPTY_CATALOGUE);
  listFuelLevels.mockResolvedValue(EMPTY_CATALOGUE);
  listRefusalReasons.mockResolvedValue(EMPTY_CATALOGUE);
  searchCustomerDirectory.mockResolvedValue(page([]));
});

/* --- FE-010: customer complaints ------------------------------------------- */

describe('the complaints step (FE-010)', () => {
  it("labels the record as the customer's words and as not yet technically verified", async () => {
    renderLtr(<ComplaintsStep {...stepProps()} />);
    // The permanent, Owner-mandated distinction — in the panel that holds the
    // customer's words, not buried in a docblock.
    expect(screen.getByTestId('complaint-unverified')).toHaveTextContent(
      EN['receptions.evidence.notTechnicallyVerified']!
    );
    expect(
      await screen.findByText(EN['receptions.complaint.customerWordsNote']!)
    ).toBeInTheDocument();
  });

  it('records the complaint in the contract shape, omitting an untouched severity', async () => {
    recordConditionEvidence.mockResolvedValue(recorded('ev-1', 'complaint'));
    const refresh = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderLtr(<ComplaintsStep {...stepProps({ refresh })} />);

    await user.selectOptions(
      screen.getByLabelText(new RegExp(EN['receptions.complaint.category']!)),
      'noise'
    );
    await user.type(
      screen.getByLabelText(new RegExp(EN['receptions.complaint.text']!)),
      '  It squeaks when braking  '
    );
    await user.click(screen.getByRole('button', { name: EN['receptions.complaint.record']! }));

    await waitFor(() => expect(recordConditionEvidence).toHaveBeenCalled());
    const [visitId, input] = recordConditionEvidence.mock.calls.at(-1)!;
    expect(visitId).toBe('rv-1');
    expect(input).toEqual({
      kind: 'complaint',
      category: 'noise',
      complaintText: 'It squeaks when braking',
    });
    // `severity` is optional on a `.strict()` schema: an untouched control must
    // leave the key OFF the body, not send an empty string.
    expect('severity' in (input as object)).toBe(false);
    // And the shell's detail is re-read, so the version a guarded command will
    // need next is never left stale (QA-004).
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('keeps the typed words visible and says the read cannot return them', async () => {
    recordConditionEvidence.mockResolvedValue(recorded('ev-1', 'complaint'));
    const user = userEvent.setup();
    renderLtr(<ComplaintsStep {...stepProps()} />);

    await user.selectOptions(
      screen.getByLabelText(new RegExp(EN['receptions.complaint.category']!)),
      'noise'
    );
    await user.type(
      screen.getByLabelText(new RegExp(EN['receptions.complaint.text']!)),
      'It squeaks'
    );
    await user.click(screen.getByRole('button', { name: EN['receptions.complaint.record']! }));

    // The session list is the ONLY place the words survive: the list operation
    // never selects `rec.complaint_details`.
    expect(await screen.findByText('It squeaks')).toBeInTheDocument();
    expect(screen.getByText(EN['receptions.evidence.sessionNote']!)).toBeInTheDocument();
    // The read-back re-runs after the write, so the restricted statement comes
    // back with the reloaded panel rather than being asserted mid-flight.
    expect(
      await screen.findByText(EN['receptions.evidence.restrictedReadBack']!)
    ).toBeInTheDocument();
  });

  it('does not double-list an idempotent REPLAY of the same write', async () => {
    // Both submissions answer with the SAME `evidenceId`, which is what a replay
    // of an `idempotent: true` operation returns for ONE stored row.
    recordConditionEvidence.mockResolvedValue(recorded('ev-same', 'complaint'));
    const user = userEvent.setup();
    renderLtr(<ComplaintsStep {...stepProps()} />);

    for (const words of ['First words', 'Second words']) {
      await user.selectOptions(
        screen.getByLabelText(new RegExp(EN['receptions.complaint.category']!)),
        'noise'
      );
      await user.type(screen.getByLabelText(new RegExp(EN['receptions.complaint.text']!)), words);
      await user.click(screen.getByRole('button', { name: EN['receptions.complaint.record']! }));
      await waitFor(() => expect(recordConditionEvidence).toHaveBeenCalled());
    }

    const session = await screen.findByRole('region', {
      name: EN['receptions.evidence.sessionHeading']!,
    });
    expect(within(session).getAllByRole('listitem')).toHaveLength(1);
  });

  it('renders the published read-back fields, and never the withheld text', async () => {
    evidenceByKind({
      complaint: [
        {
          kind: 'complaint',
          id: 'ev-9',
          recordedAt: '2026-08-13T08:00:00.000Z',
          evidenceDocumentId: null,
          category: 'noise',
          severity: 'high',
          reportedByPartnerId: 'partner-1',
          reportedByPartnerDisplayName: 'Layla Haddad',
        },
      ],
    });
    renderLtr(<ComplaintsStep {...stepProps()} />);

    // Scoped to the read-back panel: the same severity vocabulary also appears
    // among the capture form's options, and an unscoped query would count those.
    const panel = await screen.findByRole('region', {
      name: EN['receptions.complaint.heading']!,
    });
    expect(within(panel).getByText(EN['receptions.complaintCategory.noise']!)).toBeInTheDocument();
    expect(within(panel).getByText(EN['receptions.complaintSeverity.high']!)).toBeInTheDocument();
    expect(within(panel).getByText('Layla Haddad')).toBeInTheDocument();
    // The customer's own words are NOT in the read-back — the list never
    // selects `rec.complaint_details`.
    expect(
      within(panel).getByText(EN['receptions.evidence.restrictedReadBack']!)
    ).toBeInTheDocument();
  });

  it('withdraws the form without the evidence permission, and on a terminal visit', async () => {
    const { unmount } = renderLtr(
      <ComplaintsStep
        {...stepProps({ capabilities: { ...CAPABILITIES, manageEvidence: false } })}
      />
    );
    expect(await screen.findByText(EN['receptions.evidence.readOnly']!)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: EN['receptions.complaint.record']! })
    ).not.toBeInTheDocument();
    unmount();

    renderLtr(<ComplaintsStep {...stepProps({ writesLocked: true })} />);
    expect(await screen.findByText(EN['receptions.evidence.lockedNote']!)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: EN['receptions.complaint.record']! })
    ).not.toBeInTheDocument();
  });

  it('renders in Arabic, RTL, from the same catalogue', async () => {
    renderRtl(<ComplaintsStep {...stepProps({ locale: 'ar', messages: ar as typeof en })} />);
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByTestId('complaint-unverified')).toHaveTextContent(
      AR['receptions.evidence.notTechnicallyVerified']!
    );
    expect(
      await screen.findByText(AR['receptions.complaint.customerWordsNote']!)
    ).toBeInTheDocument();
  });
});

/* --- FE-011: inspection, findings and leaks -------------------------------- */

const OPEN_INSPECTION = {
  kind: 'inspection',
  id: 'insp-1',
  recordedAt: '2026-08-13T08:00:00.000Z',
  evidenceDocumentId: null,
  inspectorId: 'user-1',
  inspectionStatus: 'in_progress',
  startedAt: '2026-08-13T08:00:00.000Z',
  completedAt: null,
};

describe('the inspection step (FE-011)', () => {
  it('opens an inspection with the signed-in operator, and states the G-EMP disposition', async () => {
    recordConditionEvidence.mockResolvedValue(recorded('insp-new', 'inspection'));
    const user = userEvent.setup();
    renderLtr(<InspectionStep {...stepProps()} />);

    expect(
      await screen.findByText(`${EN['receptions.inspection.inspectorIs']} Front Desk`)
    ).toBeInTheDocument();
    expect(screen.getByText(EN['receptions.inspection.inspectorNote']!)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: EN['receptions.inspection.open']! }));
    await waitFor(() => expect(recordConditionEvidence).toHaveBeenCalled());
    expect(recordConditionEvidence.mock.calls.at(-1)![1]).toEqual({
      kind: 'inspection',
      inspectorId: 'user-1',
    });
  });

  it('withholds the finding form until an OPEN inspection exists, and says why', async () => {
    // A completed header cannot take a new finding — `rec.guard_condition_item_open`
    // refuses it — so it is not offered as a choice at all.
    evidenceByKind({
      inspection: [{ ...OPEN_INSPECTION, inspectionStatus: 'completed', completedAt: 'x' }],
    });
    renderLtr(<InspectionStep {...stepProps()} />);

    expect(await screen.findByTestId('evidence-notice-condition_item')).toHaveTextContent(
      EN['receptions.evidence.inspectionRequired']!
    );
    expect(
      screen.queryByRole('button', { name: EN['receptions.finding.record']! })
    ).not.toBeInTheDocument();
  });

  it('records a finding against the chosen open inspection', async () => {
    evidenceByKind({ inspection: [OPEN_INSPECTION] });
    recordConditionEvidence.mockResolvedValue(recorded('ci-1', 'condition_item'));
    const user = userEvent.setup();
    renderLtr(<InspectionStep {...stepProps()} />);

    // Scoped to the form. Every panel is a named `section`, which is a `region`
    // with an accessible name — and `getByLabelText` matches `aria-labelledby`
    // too, so an unscoped `/Inspection/` matches the "Inspections" SECTION
    // rather than the select inside the form.
    const form = await screen.findByRole('form', { name: EN['receptions.finding.formLabel']! });
    await user.selectOptions(
      within(form).getByLabelText(new RegExp(EN['receptions.finding.inspection']!)),
      'insp-1'
    );
    await user.selectOptions(
      within(form).getByLabelText(new RegExp(EN['receptions.finding.category']!)),
      'dent'
    );
    await user.type(
      within(form).getByLabelText(new RegExp(EN['receptions.finding.zone']!)),
      '  front left door  '
    );
    await user.click(within(form).getByRole('button', { name: EN['receptions.finding.record']! }));

    await waitFor(() => expect(recordConditionEvidence).toHaveBeenCalled());
    expect(recordConditionEvidence.mock.calls.at(-1)![1]).toEqual({
      kind: 'condition_item',
      inspectionId: 'insp-1',
      findingCategory: 'dent',
      vehicleZone: 'front left door',
    });
  });

  it('records a leak as a free-text type — no vocabulary is invented for it', async () => {
    recordConditionEvidence.mockResolvedValue(recorded('leak-1', 'leak'));
    const user = userEvent.setup();
    renderLtr(<InspectionStep {...stepProps()} />);

    const leakForm = await screen.findByRole('form', { name: EN['receptions.leak.formLabel']! });
    // `leak_type` is a BOUNDED STRING on the wire; membership belongs to the
    // database CHECK, so this must be a text box and not a select.
    const typeField = within(leakForm).getByLabelText(new RegExp(EN['receptions.leak.type']!));
    expect(typeField.tagName).toBe('INPUT');
    await user.type(typeField, 'engine oil');
    await user.type(
      within(leakForm).getByLabelText(new RegExp(EN['receptions.finding.zone']!)),
      'under engine bay'
    );
    await user.click(within(leakForm).getByRole('button', { name: EN['receptions.leak.record']! }));

    await waitFor(() => expect(recordConditionEvidence).toHaveBeenCalled());
    expect(recordConditionEvidence.mock.calls.at(-1)![1]).toEqual({
      kind: 'leak',
      leakType: 'engine oil',
      vehicleZone: 'under engine bay',
    });
  });

  it('states that road test is absent, and offers no control claiming to be one', async () => {
    renderLtr(<InspectionStep {...stepProps()} />);
    expect(await screen.findByTestId('road-test-absent')).toHaveTextContent(
      EN['receptions.inspection.roadTestAbsent']!
    );
    // `WF-10` is open and no contract exists: nothing may be LABELLED a road test.
    expect(screen.queryByRole('button', { name: /road test/i })).not.toBeInTheDocument();
  });

  it('keeps staff findings and customer concerns as different records', async () => {
    renderLtr(<InspectionStep {...stepProps()} />);
    expect(
      await screen.findByText(EN['receptions.finding.staffObservationNote']!)
    ).toBeInTheDocument();
  });

  it('renders in Arabic, RTL', async () => {
    renderRtl(<InspectionStep {...stepProps({ locale: 'ar', messages: ar as typeof en })} />);
    expect(document.documentElement.dir).toBe('rtl');
    expect(await screen.findByText(AR['receptions.leak.observationNote']!)).toBeInTheDocument();
  });
});

/* --- FE-012: damage map and marks ------------------------------------------ */

const DAMAGE_MAP = {
  kind: 'damage_map',
  id: 'map-1',
  recordedAt: '2026-08-13T08:00:00.000Z',
  evidenceDocumentId: null,
  documentId: 'doc-1',
  documentVersionId: 'ver-1',
  mapType: 'sedan-plan',
  perspective: 'top',
};

describe('the damage step (FE-012)', () => {
  it('states the blocked map, where the control to open one would have been', async () => {
    renderLtr(<DamageMapStep {...stepProps()} />);
    expect(await screen.findByTestId('evidence-notice-damage_map')).toHaveTextContent(
      EN['receptions.evidence.damageMapBlocked']!
    );
    // No uuid boxes standing in for a document that cannot be registered.
    expect(screen.queryByLabelText(/document/i)).not.toBeInTheDocument();
  });

  it('withholds the mark form with no map, and says why', async () => {
    renderLtr(<DamageMapStep {...stepProps()} />);
    expect(await screen.findByTestId('evidence-notice-damage_mark')).toHaveTextContent(
      EN['receptions.evidence.damageMapRequired']!
    );
    expect(
      screen.queryByRole('button', { name: EN['receptions.damage.record']! })
    ).not.toBeInTheDocument();
  });

  it('records a mark against an existing map, with 0..1 coordinates', async () => {
    evidenceByKind({ damage_map: [DAMAGE_MAP] });
    recordConditionEvidence.mockResolvedValue(recorded('mark-1', 'damage_mark'));
    const user = userEvent.setup();
    renderLtr(<DamageMapStep {...stepProps()} />);

    // Scoped, for the same reason as the finding form: "Damage maps" is a named
    // section, and `getByLabelText` matches its `aria-labelledby` too.
    const form = await screen.findByRole('form', { name: EN['receptions.damage.formLabel']! });
    await user.selectOptions(
      within(form).getByLabelText(new RegExp(EN['receptions.damage.map']!)),
      'map-1'
    );
    await user.selectOptions(
      within(form).getByLabelText(new RegExp(EN['receptions.damage.markType']!)),
      'dent'
    );
    await user.type(
      within(form).getByLabelText(new RegExp(EN['receptions.finding.zone']!)),
      'rear bumper'
    );
    await user.click(within(form).getByRole('button', { name: EN['receptions.damage.record']! }));

    await waitFor(() => expect(recordConditionEvidence).toHaveBeenCalled());
    const input = recordConditionEvidence.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect(input).toMatchObject({
      kind: 'damage_mark',
      damageMapId: 'map-1',
      markType: 'dent',
      vehicleZone: 'rear bumper',
    });
    // FRACTIONS of the map, not pixels — which is why a mark survives a resize.
    // The centre is the documented default, asserted EXACTLY: a bounds check
    // alone cannot fail, because every value the form can hold is in bounds.
    expect(input['coordX']).toBe(0.5);
    expect(input['coordY']).toBe(0.5);
  });

  it('submits the coordinate the operator TYPED, to the digit — `0.125` is not `0.13`', async () => {
    /*
     * `W-E-01`, a silent wrong write. The two fields rendered
     * `formatCoordinate(value)` as their own `value`, so a controlled input
     * rewrote `0.125` to `0.13` under the operator's cursor while the draft
     * carried `0.125` — the screen and the record disagreeing about where the
     * damage is, on a document a customer signs.
     *
     * The contract bounds the RANGE (`0..1`), never the scale, so the assertion
     * is on the exact number: a bounds check passes for both readings and is
     * therefore incapable of catching this.
     */
    evidenceByKind({ damage_map: [DAMAGE_MAP] });
    recordConditionEvidence.mockResolvedValue(recorded('mark-2', 'damage_mark'));
    const user = userEvent.setup();
    renderLtr(<DamageMapStep {...stepProps()} />);

    const form = await screen.findByRole('form', { name: EN['receptions.damage.formLabel']! });
    await user.selectOptions(
      within(form).getByLabelText(new RegExp(EN['receptions.damage.map']!)),
      'map-1'
    );
    await user.selectOptions(
      within(form).getByLabelText(new RegExp(EN['receptions.damage.markType']!)),
      'dent'
    );
    await user.type(
      within(form).getByLabelText(new RegExp(EN['receptions.finding.zone']!)),
      'rear bumper'
    );

    const xField = within(form).getByLabelText(new RegExp(EN['receptions.damage.coordX']!));
    const yField = within(form).getByLabelText(new RegExp(EN['receptions.damage.coordY']!));
    await user.clear(xField);
    await user.type(xField, '0.125');
    await user.clear(yField);
    await user.type(yField, '0.3333');

    // What the operator sees is their own text, not a rounded copy of it.
    expect(xField).toHaveValue(0.125);
    expect(yField).toHaveValue(0.3333);

    await user.click(within(form).getByRole('button', { name: EN['receptions.damage.record']! }));

    await waitFor(() => expect(recordConditionEvidence).toHaveBeenCalled());
    const typed = recordConditionEvidence.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect(typed['coordX']).toBe(0.125);
    expect(typed['coordY']).toBe(0.3333);
  });

  it('keeps an out-of-range keystroke on screen, and refuses a blank coordinate BY NAME', async () => {
    /*
     * The old field swallowed anything `parseCoordinate` rejected: the operator
     * typed `5`, the box reverted to the previous number, and nothing said why.
     * The text is theirs now, so `5` stays visible — `min`/`max` are on the
     * control, so the browser itself refuses that one.
     *
     * A blank coordinate is the case no native constraint covers (`required` is
     * announced via `aria-required`, not enforced), so the client guard is what
     * answers, and it answers by NAME rather than by sending an incomplete mark.
     */
    evidenceByKind({ damage_map: [DAMAGE_MAP] });
    const user = userEvent.setup();
    renderLtr(<DamageMapStep {...stepProps()} />);

    const form = await screen.findByRole('form', { name: EN['receptions.damage.formLabel']! });
    await user.selectOptions(
      within(form).getByLabelText(new RegExp(EN['receptions.damage.map']!)),
      'map-1'
    );
    await user.selectOptions(
      within(form).getByLabelText(new RegExp(EN['receptions.damage.markType']!)),
      'dent'
    );
    await user.type(
      within(form).getByLabelText(new RegExp(EN['receptions.finding.zone']!)),
      'rear bumper'
    );

    const xField = within(form).getByLabelText(new RegExp(EN['receptions.damage.coordX']!));
    await user.clear(xField);
    await user.type(xField, '5');
    expect(xField).toHaveValue(5);
    expect((xField as HTMLInputElement).validity.rangeOverflow).toBe(true);

    await user.clear(xField);
    await user.click(within(form).getByRole('button', { name: EN['receptions.damage.record']! }));

    expect(recordConditionEvidence).not.toHaveBeenCalled();
    expect(
      await within(form).findByText(EN['receptions.damage.error.coordRange']!)
    ).toBeInTheDocument();
  });

  it('places the mark from the KEYBOARD, so the diagram is not a pointer-only input', async () => {
    evidenceByKind({ damage_map: [DAMAGE_MAP] });
    const user = userEvent.setup();
    renderLtr(<DamageMapStep {...stepProps()} />);

    const diagram = await screen.findByTestId('damage-diagram');
    diagram.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowDown}');

    // The two number fields and the diagram hold ONE value, so the keyboard
    // move is visible in both.
    expect(screen.getByTestId('damage-diagram-position')).toHaveTextContent('0.60 / 0.55');
    expect(screen.getByLabelText(new RegExp(EN['receptions.damage.coordX']!))).toHaveValue(0.6);
    expect(screen.getByLabelText(new RegExp(EN['receptions.damage.coordY']!))).toHaveValue(0.55);
  });

  it('clamps a keyboard move at the contract bounds instead of leaving the map', async () => {
    evidenceByKind({ damage_map: [DAMAGE_MAP] });
    const user = userEvent.setup();
    renderLtr(<DamageMapStep {...stepProps()} />);

    const diagram = await screen.findByTestId('damage-diagram');
    diagram.focus();
    await user.keyboard('{ArrowLeft>20/}');
    expect(screen.getByTestId('damage-diagram-position')).toHaveTextContent('0.00 / 0.50');
  });
});

/* --- FE-015: warning lights ------------------------------------------------- */

describe('the warning-lights step (FE-015)', () => {
  it('states that the catalogue is not configured, and invents no codes', async () => {
    renderLtr(<WarningLightsStep {...stepProps()} />);

    expect(await screen.findByTestId('evidence-notice-warning_light')).toHaveTextContent(
      EN['receptions.evidence.warningCatalogueEmpty']!
    );
    expect(screen.getByText(EN['receptions.warning.noManagementRoute']!)).toBeInTheDocument();
    // No picker, no submit, and nothing offered that the foreign key would refuse.
    expect(
      screen.queryByLabelText(new RegExp(EN['receptions.warning.code']!))
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: EN['receptions.warning.record']! })
    ).not.toBeInTheDocument();
  });

  it('records a lamp the moment the catalogue has one', async () => {
    listWarningLightCodes.mockResolvedValue({
      status: 'ok',
      options: [{ id: 'wl-1', scope: 'platform', code: 'ENG', name: 'Engine' }],
      truncated: false,
      correlationId: 'corr-cat',
    });
    recordConditionEvidence.mockResolvedValue(recorded('wl-ev-1', 'warning_light'));
    const user = userEvent.setup();
    renderLtr(<WarningLightsStep {...stepProps()} />);

    await user.selectOptions(
      await screen.findByLabelText(new RegExp(EN['receptions.warning.code']!)),
      'wl-1'
    );
    /*
     * `flashing`, not "steady".
     *
     * This case used to type the free text "steady" and assert it on the wire,
     * and it passed for the same reason every mocked tier passes: the mock was
     * asked what it had been told to return. Against the real database that
     * write is refused — `ck_warning_light_observations_state` admits `on`,
     * `flashing` and `intermittent` and nothing else, so the assertion was
     * pinning a body the platform 422s. The control is now a choice over those
     * three, and this asserts the chosen one travels.
     */
    await user.selectOptions(
      screen.getByLabelText(new RegExp(EN['receptions.warning.observedState']!)),
      'flashing'
    );
    await user.click(screen.getByRole('button', { name: EN['receptions.warning.record']! }));

    await waitFor(() => expect(recordConditionEvidence).toHaveBeenCalled());
    expect(recordConditionEvidence.mock.calls.at(-1)![1]).toEqual({
      kind: 'warning_light',
      warningLightCodeId: 'wl-1',
      observedState: 'flashing',
    });
  });

  it('an untouched state is ABSENT from the body, not sent blank', async () => {
    /*
     * The optional's own rule, and it is not decoration: the column has a
     * database default and the route is `.strict()` with `min(1)`, so a blank
     * string is a 422 rather than "no opinion". A select whose placeholder value
     * reached the wire would refuse every lamp recorded without a state.
     */
    listWarningLightCodes.mockResolvedValue({
      status: 'ok',
      options: [{ id: 'wl-1', scope: 'tenant', code: 'engine', name: 'Engine management' }],
      truncated: false,
      correlationId: 'corr-cat',
    });
    recordConditionEvidence.mockResolvedValue(recorded('wl-ev-2', 'warning_light'));
    const user = userEvent.setup();
    renderLtr(<WarningLightsStep {...stepProps()} />);

    await user.selectOptions(
      await screen.findByLabelText(new RegExp(EN['receptions.warning.code']!)),
      'wl-1'
    );
    await user.click(screen.getByRole('button', { name: EN['receptions.warning.record']! }));

    await waitFor(() => expect(recordConditionEvidence).toHaveBeenCalled());
    expect(recordConditionEvidence.mock.calls.at(-1)![1]).toEqual({
      kind: 'warning_light',
      warningLightCodeId: 'wl-1',
    });
  });

  it('an unreadable catalogue is an ERROR with retry, never "not configured"', async () => {
    listWarningLightCodes.mockResolvedValue({
      status: 'error',
      options: [],
      truncated: false,
      correlationId: 'corr-503',
    });
    renderLtr(<WarningLightsStep {...stepProps()} />);

    // The distinction that matters: an empty catalogue is the catalogue
    // working; a failed read is not, and must not be reported as emptiness.
    expect(await screen.findByText('corr-503')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: EN['state.retry']! }).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('evidence-notice-warning_light')).not.toBeInTheDocument();
  });

  it('renders in Arabic, RTL', async () => {
    renderRtl(<WarningLightsStep {...stepProps({ locale: 'ar', messages: ar as typeof en })} />);
    expect(document.documentElement.dir).toBe('rtl');
    expect(await screen.findByTestId('evidence-notice-warning_light')).toHaveTextContent(
      AR['receptions.evidence.warningCatalogueEmpty']!
    );
  });
});

/* --- FE-016: vehicle contents ----------------------------------------------- */

describe('the contents step (FE-016)', () => {
  it('declares an item with its quantity, location, value and currency', async () => {
    recordConditionEvidence.mockResolvedValue(recorded('vc-1', 'contents'));
    const user = userEvent.setup();
    renderLtr(<ContentsStep {...stepProps()} />);

    await user.type(
      screen.getByLabelText(new RegExp(EN['receptions.contents.item']!)),
      'Sunglasses'
    );
    await user.type(screen.getByLabelText(new RegExp(EN['receptions.contents.quantity']!)), '2');
    await user.type(
      screen.getByLabelText(new RegExp(EN['receptions.contents.location']!)),
      'glovebox'
    );
    await user.type(
      screen.getByLabelText(new RegExp(EN['receptions.contents.declaredValue']!)),
      '40'
    );
    await user.type(
      screen.getByLabelText(new RegExp(EN['receptions.contents.declaredCurrency']!)),
      'jod'
    );
    await user.click(screen.getByRole('button', { name: EN['receptions.contents.record']! }));

    await waitFor(() => expect(recordConditionEvidence).toHaveBeenCalled());
    expect(recordConditionEvidence.mock.calls.at(-1)![1]).toEqual({
      kind: 'contents',
      itemDescription: 'Sunglasses',
      quantity: 2,
      location: 'glovebox',
      declaredValue: 40,
      declaredCurrency: 'JOD',
    });
  });

  it('refuses a currency with no value BESIDE THE CURRENCY, before spending a request', async () => {
    const user = userEvent.setup();
    renderLtr(<ContentsStep {...stepProps()} />);

    await user.type(screen.getByLabelText(new RegExp(EN['receptions.contents.item']!)), 'Wallet');
    await user.type(
      screen.getByLabelText(new RegExp(EN['receptions.contents.declaredCurrency']!)),
      'JOD'
    );
    await user.click(screen.getByRole('button', { name: EN['receptions.contents.record']! }));

    // `ck_vehicle_content_details_currency`, mirrored on the control the
    // operator can actually clear.
    expect(
      await screen.findByText(EN['receptions.contents.error.currencyWithoutValue']!)
    ).toBeInTheDocument();
    expect(recordConditionEvidence).not.toHaveBeenCalled();
  });

  it('sends the signed-in operator as the witness only when asked', async () => {
    recordConditionEvidence.mockResolvedValue(recorded('vc-2', 'contents'));
    const user = userEvent.setup();
    renderLtr(<ContentsStep {...stepProps()} />);

    await user.type(screen.getByLabelText(new RegExp(EN['receptions.contents.item']!)), 'Laptop');
    await user.click(screen.getByLabelText(new RegExp(EN['receptions.contents.witnessed']!)));
    await user.click(screen.getByRole('button', { name: EN['receptions.contents.record']! }));

    await waitFor(() => expect(recordConditionEvidence).toHaveBeenCalled());
    expect(recordConditionEvidence.mock.calls.at(-1)![1]).toMatchObject({
      witnessedByEmployeeId: 'user-1',
    });
  });

  it('reads back only the quantity and the location, and says the rest is restricted', async () => {
    evidenceByKind({
      contents: [
        {
          kind: 'contents',
          id: 'vc-9',
          recordedAt: '2026-08-13T08:00:00.000Z',
          evidenceDocumentId: null,
          quantity: 2,
          location: 'boot',
        },
      ],
    });
    renderLtr(<ContentsStep {...stepProps()} />);

    expect(await screen.findByText('boot')).toBeInTheDocument();
    expect(screen.getByText(EN['receptions.evidence.restrictedReadBack']!)).toBeInTheDocument();
  });

  it('renders in Arabic, RTL', async () => {
    renderRtl(<ContentsStep {...stepProps({ locale: 'ar', messages: ar as typeof en })} />);
    expect(document.documentElement.dir).toBe('rtl');
    expect(
      await screen.findByText(AR['receptions.evidence.restrictedReadBack']!)
    ).toBeInTheDocument();
  });
});
