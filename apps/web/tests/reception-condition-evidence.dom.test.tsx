import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import type { CheckInStepProps } from '@/features/receptions/check-in/wizard';
import { LEAK_TYPES } from '@/features/receptions/receptions-contract';
import type {
  BindableTemplateEntry,
  ReceptionDetail,
} from '@/features/receptions/receptions-contract';

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
/*
 * `readCaptureContract` is FE-012's template read, and its absence from this
 * factory was not a quiet gap.
 *
 * A `vi.mock` factory is exhaustive: a property it does not define THROWS on
 * access rather than returning undefined. `DamageMapStep` reads the contract
 * inside `useServerTable`'s async effect, so the throw became an unhandled
 * rejection — reported by Vitest at file level, attributed to whichever case
 * happened to be running, and fatal to nothing. Every damage case therefore ran
 * against a template read that never resolved: `templateTable.status` stayed
 * `'loading'`, the write slot rendered `null`, and fifteen assertions about
 * what is NOT on screen passed against a panel that had rendered nothing at all.
 */
const readCaptureContract = vi.fn();

vi.mock('@/features/receptions/api', () => ({
  recordConditionEvidence: (...args: unknown[]) => recordConditionEvidence(...args),
  listConditionEvidence: (...args: unknown[]) => listConditionEvidence(...args),
  listPartyRoles: (...args: unknown[]) => listPartyRoles(...args),
  listAuthorizations: (...args: unknown[]) => listAuthorizations(...args),
  recordRefusal: (...args: unknown[]) => recordRefusal(...args),
  readCaptureContract: (...args: unknown[]) => readCaptureContract(...args),
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

/*
 * The staff directory read (`F8`).
 *
 * The inspection read-back turns `inspectorId` into a NAME through
 * `iam.user-detail`, so this suite now reaches a Server Action. Unmocked it
 * throws `cookies was called outside a request scope` from inside an effect —
 * an unhandled rejection Vitest reports at file level, which is a failing suite
 * whose individual cases all pass.
 */
const readUserIdentity = vi.fn();
vi.mock('@/features/receptions/support-api', () => ({
  readUserIdentity: (...args: unknown[]) => readUserIdentity(...args),
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

/**
 * One damage-map template revision this branch may bind to.
 *
 * A template is a SLOT — a map type, an optional perspective and a lifecycle —
 * and the geometry lives in the revision it publishes. The four revision fields
 * are therefore set independently of `status` rather than derived from it,
 * because the two states the step must keep apart are exactly a live slot with
 * no published revision and a retired slot that still has one.
 */
function template(over: Partial<BindableTemplateEntry> = {}): BindableTemplateEntry {
  return {
    id: 'tpl-1',
    scope: 'branch',
    companyId: 'company-1',
    branchId: 'branch-1',
    // One of the four `ck_damage_map_templates_type` admits. A map type this
    // suite invented would pin a screen the database cannot produce, which is
    // the defect the leak and warning-light cases below already record twice.
    mapType: 'exterior',
    perspective: null,
    status: 'active',
    recordVersion: 1,
    activeVersionId: 'tv-1',
    activeVersionNumber: 4,
    documentId: 'doc-1',
    documentVersionId: 'ver-1',
    ...over,
  };
}

/** The visit's own capture contract — the only place bindable templates arrive from. */
function captureContract(bindableTemplates: readonly BindableTemplateEntry[]) {
  return {
    status: 'ok' as const,
    data: {
      receptionVisitId: 'rv-1',
      requirements: [],
      bindings: [],
      overrides: [],
      bindableTemplates,
    },
    correlationId: 'corr-capture',
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
  /*
   * A branch that HAS published a diagram, by default.
   *
   * The alternative default — an empty contract — would leave every damage case
   * facing `damage-map-none`, and the mark-side notice ("A mark is placed on a
   * damage map, and this visit has none. Open one above first.") would be
   * telling the operator to use a control the same screen was withholding. The
   * three configuration states each have their own case below, driven
   * explicitly.
   */
  readCaptureContract.mockResolvedValue(captureContract([template()]));
  readUserIdentity.mockResolvedValue({
    status: 'ok',
    data: { id: 'user-77', displayName: 'Nadia Suleiman' },
    correlationId: 'corr-user',
  });
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

  it('records a leak as one of the seven types the database admits', async () => {
    /*
     * `oil`, chosen from a list — not "engine oil", typed.
     *
     * This case used to type free text and assert it on the wire, and it passed
     * for the reason every mocked tier passes: the mock returned what it had
     * been told to return. Against the real database that write is refused —
     * `ck_leak_observations_type` admits seven values and nothing else — and the
     * field is REQUIRED, so the assertion was pinning a body the platform 422s
     * for every leak an operator could describe. The control is now a choice
     * over the database's own list, and this asserts the chosen member travels.
     */
    recordConditionEvidence.mockResolvedValue(recorded('leak-1', 'leak'));
    const user = userEvent.setup();
    renderLtr(<InspectionStep {...stepProps()} />);

    const leakForm = await screen.findByRole('form', { name: EN['receptions.leak.formLabel']! });
    const typeField = within(leakForm).getByLabelText(new RegExp(EN['receptions.leak.type']!));
    expect(typeField.tagName, 'a free-text box offers only values the database refuses').toBe(
      'SELECT'
    );
    await user.selectOptions(typeField, 'oil');
    await user.type(
      within(leakForm).getByLabelText(new RegExp(EN['receptions.finding.zone']!)),
      'under engine bay'
    );
    await user.click(within(leakForm).getByRole('button', { name: EN['receptions.leak.record']! }));

    await waitFor(() => expect(recordConditionEvidence).toHaveBeenCalled());
    expect(recordConditionEvidence.mock.calls.at(-1)![1]).toEqual({
      kind: 'leak',
      leakType: 'oil',
      vehicleZone: 'under engine bay',
    });
  });

  it('offers exactly the seven types, translated, and nothing the database refuses', async () => {
    /*
     * The other direction. The case above would still pass over a select that
     * offered one option, or eight, or the stored tokens as labels — and a
     * missing member is a leak an operator cannot record at all, which is the
     * defect this fix exists for wearing different clothes.
     */
    renderLtr(<InspectionStep {...stepProps()} />);

    const leakForm = await screen.findByRole('form', { name: EN['receptions.leak.formLabel']! });
    const typeField = within(leakForm).getByLabelText(new RegExp(EN['receptions.leak.type']!));
    const offered = within(typeField as HTMLSelectElement)
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value)
      .filter((value) => value !== '');
    expect(offered).toEqual([...LEAK_TYPES]);

    for (const type of LEAK_TYPES) {
      // The LABEL is the translated one, so no operator is shown `brake_fluid`.
      expect(
        within(typeField as HTMLSelectElement).getByRole('option', {
          name: EN[`receptions.leakType.${type}`]!,
        }),
        type
      ).toBeInTheDocument();
    }
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

/**
 * A damage map already recorded against this visit.
 *
 * `mapType` is one of the four `ck_damage_maps_type` admits. It was `sedan-plan`
 * — a value the database refuses — which is the third appearance in this file of
 * one defect: a fixture the platform could not produce, pinning a screen no
 * operator will ever see. The leak and warning-light cases below record the
 * other two.
 */
const DAMAGE_MAP = {
  kind: 'damage_map',
  id: 'map-1',
  recordedAt: '2026-08-13T08:00:00.000Z',
  evidenceDocumentId: null,
  documentId: 'doc-1',
  documentVersionId: 'ver-1',
  mapType: 'exterior',
  perspective: 'top',
};

/** The step's two panels, each a `section` named by its own heading. */
const mapsPanel = (catalogue: Record<string, string> = EN) =>
  screen.getByRole('region', { name: catalogue['receptions.damage.mapHeading']! });
const marksPanel = (catalogue: Record<string, string> = EN) =>
  screen.getByRole('region', { name: catalogue['receptions.damage.markHeading']! });

/**
 * The values a chooser offers, in order.
 *
 * Guarded: a select that offered nothing would satisfy every "does not contain
 * the retired one" assertion below without proving anything, which is the shape
 * of sweep this phase has shipped four of.
 */
function offered(select: HTMLElement): string[] {
  const options = within(select).getAllByRole('option');
  expect(
    options.length,
    'the chooser offered nothing, so the comparison is vacuous'
  ).toBeGreaterThan(0);
  return options.map((option) => (option as HTMLOptionElement).value);
}

/**
 * Every control the step offers, by accessible name and in document order.
 *
 * An ENUMERATION rather than a keyword sweep. A sweep that matches nothing reads
 * exactly like a sweep that has stopped looking, whereas an exact list fails the
 * moment a control is added — including one whose name nobody thought to ban.
 * The count guard refuses an empty walk; the administration case below also
 * plants a violation to prove its own matcher can still fire.
 */
function controlNames(): string[] {
  const controls = [...screen.queryAllByRole('button'), ...screen.queryAllByRole('link')];
  expect(controls.length, 'no control was scanned, so the enumeration is vacuous').toBeGreaterThan(
    0
  );
  return controls.map((control) => control.getAttribute('aria-label') ?? control.textContent ?? '');
}

/**
 * A read that did not answer.
 *
 * It reports `hasMore: false` exactly like a complete empty page, because every
 * adapter's failure branch does — which is the whole reason a gate may not read
 * "no rows" as "there are none".
 */
function failedPage(
  status: 'denied' | 'expired' | 'unavailable' | 'error' | 'not-found',
  correlationId: string
) {
  return { status, rows: [], nextCursor: null, hasMore: false, correlationId };
}

/** Routes only the DAMAGE-MAP read, so the mark read-back is never the variable. */
function mapsRead(answer: () => Promise<unknown>) {
  listConditionEvidence.mockImplementation((_visitId: string, kind: string) =>
    kind === 'damage_map' ? answer() : Promise.resolve(page([]))
  );
}

/**
 * What the mark panel's write slot is showing, as ONE comparable value.
 *
 * A signature, not a boolean. "The empty-visit notice is absent" is satisfied by
 * a skeleton, by a blank slot and by any other sentence, so a suite built out of
 * absence checks cannot tell a state that was handled from a state that rendered
 * nothing at all — which is precisely how a read failure went on being printed
 * as an established absence here.
 */
function markSlot(): string {
  if (screen.queryByRole('form', { name: EN['receptions.damage.formLabel']! }) !== null) {
    return 'form';
  }
  for (const id of ['damage-mark-denied', 'damage-mark-unread', 'evidence-notice-damage_mark']) {
    const node = screen.queryByTestId(id);
    if (node !== null) return `${id}: ${node.textContent ?? ''}`;
  }
  return 'nothing';
}

describe('the damage step (FE-012)', () => {
  it('reads the bindable diagrams from the VISIT, and calls no catalogue', async () => {
    /*
     * The permission split, asserted where it shows.
     *
     * Deciding what the whole workshop draws on costs `rec.catalogue.manage`,
     * which no receptionist holds; the set THIS branch may bind to travels with
     * the visit's own capture read behind `rec.reception.read`. Proven by moving
     * the contract's answer and watching the offered diagrams move with it — a
     * step that reached for a catalogue would be unmoved by that — and by the
     * three catalogue adapters this feature has staying untouched throughout.
     */
    readCaptureContract.mockResolvedValue(
      captureContract([template({ id: 'tpl-1' }), template({ id: 'tpl-2', mapType: 'interior' })])
    );
    const first = renderLtr(<DamageMapStep {...stepProps()} />);
    expect(
      offered(
        await within(mapsPanel()).findByLabelText(
          new RegExp(EN['receptions.damage.templateLabel']!)
        )
      )
    ).toEqual(['tpl-1', 'tpl-2']);
    expect(readCaptureContract).toHaveBeenCalledWith('rv-1');
    first.unmount();

    readCaptureContract.mockResolvedValue(
      captureContract([template({ id: 'tpl-3', mapType: 'other' })])
    );
    renderLtr(<DamageMapStep {...stepProps()} />);
    expect(
      offered(
        await within(mapsPanel()).findByLabelText(
          new RegExp(EN['receptions.damage.templateLabel']!)
        )
      )
    ).toEqual(['tpl-3']);

    for (const catalogue of [listWarningLightCodes, listFuelLevels, listRefusalReasons]) {
      expect(catalogue, 'a catalogue read was spent on the reception desk').not.toHaveBeenCalled();
    }
  });

  it('binds the EXACT revision of the diagram chosen, and asks for no identifier', async () => {
    /*
     * `documentId` AND `documentVersionId`, and both belonging to the chosen
     * template rather than to the first one offered.
     *
     * `rec.guard_damage_map_version()` refuses a version that does not belong to
     * the named document, and `rec.damage_maps` holds both as NOT NULL: a map is
     * anchored to the DRAWING it was made on, so a template revised tomorrow
     * must not move every mark already placed onto a different diagram. The pair
     * travels with the choice, which is why nothing here is typed.
     */
    readCaptureContract.mockResolvedValue(
      captureContract([
        template({ id: 'tpl-1', documentId: 'doc-1', documentVersionId: 'ver-1' }),
        template({
          id: 'tpl-2',
          mapType: 'interior',
          perspective: 'front',
          documentId: 'doc-2',
          documentVersionId: 'ver-2',
          activeVersionNumber: 7,
        }),
      ])
    );
    recordConditionEvidence.mockResolvedValue(recorded('map-new', 'damage_map'));
    const refresh = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderLtr(<DamageMapStep {...stepProps({ refresh })} />);

    const panel = mapsPanel();
    await user.selectOptions(
      await within(panel).findByLabelText(new RegExp(EN['receptions.damage.templateLabel']!)),
      'tpl-2'
    );
    // The revision is NAMED beside the chooser rather than left implied, so the
    // operator can see which drawing the marks will be anchored to.
    expect(within(panel).getByText('7')).toBeInTheDocument();

    await user.click(
      within(panel).getByRole('button', { name: EN['receptions.damage.templateSubmit']! })
    );

    await waitFor(() => expect(recordConditionEvidence).toHaveBeenCalled());
    const [visitId, input] = recordConditionEvidence.mock.calls.at(-1)!;
    expect(visitId).toBe('rv-1');
    expect(input).toEqual({
      kind: 'damage_map',
      documentId: 'doc-2',
      documentVersionId: 'ver-2',
      mapType: 'interior',
      perspective: 'front',
    });
    // The chosen revision, not the default one — an assertion the equality above
    // would also satisfy if the two templates shared a document.
    expect((input as Record<string, unknown>)['documentId']).not.toBe('doc-1');

    // No uuid box anywhere: the panel holds ONE control and it is a chooser.
    expect(within(panel).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(panel).queryAllByRole('spinbutton')).toHaveLength(0);
    expect(within(panel).getAllByRole('combobox')).toHaveLength(1);

    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('omits the perspective a diagram does not have, rather than sending it empty', async () => {
    // `perspective` is nullable and the route is `.strict()`: an untouched slot
    // must leave the key OFF the body, exactly as the complaint step's severity
    // does. Nothing on this screen can clear it, so the omission is structural.
    readCaptureContract.mockResolvedValue(captureContract([template({ perspective: null })]));
    recordConditionEvidence.mockResolvedValue(recorded('map-new', 'damage_map'));
    const user = userEvent.setup();
    renderLtr(<DamageMapStep {...stepProps()} />);

    await user.click(
      await within(mapsPanel()).findByRole('button', {
        name: EN['receptions.damage.templateSubmit']!,
      })
    );

    await waitFor(() => expect(recordConditionEvidence).toHaveBeenCalled());
    const input = recordConditionEvidence.mock.calls.at(-1)![1] as object;
    expect(input).toEqual({
      kind: 'damage_map',
      documentId: 'doc-1',
      documentVersionId: 'ver-1',
      mapType: 'exterior',
    });
    expect('perspective' in input).toBe(false);
  });

  it('shows the map it just opened, so a mark can be placed without a reload', async () => {
    /*
     * The half a "was the write sent?" assertion cannot see.
     *
     * `mapChoices` is derived from the damage-map READ-BACK, so a map the panel
     * does not re-read is a map no mark can hang off: the operator opens one, is
     * told it worked, and the section below still says this visit has none.
     * Nothing else would have brought it back — `refresh()` re-reads the visit's
     * own detail, and recording a child row does not move `recordVersion`.
     *
     * Observed by the RESULT changing rather than by counting calls on a spy: it
     * is the write that makes the next read return the row.
     */
    let mapRows: readonly unknown[] = [];
    listConditionEvidence.mockImplementation((_visitId: string, kind: string) =>
      Promise.resolve(page(kind === 'damage_map' ? mapRows : []))
    );
    recordConditionEvidence.mockImplementation(() => {
      mapRows = [DAMAGE_MAP];
      return Promise.resolve(recorded('map-1', 'damage_map'));
    });
    const user = userEvent.setup();
    renderLtr(<DamageMapStep {...stepProps()} />);

    // Before: no map, so the mark form is withheld and says why.
    expect(await screen.findByTestId('evidence-notice-damage_mark')).toHaveTextContent(
      EN['receptions.evidence.damageMapRequired']!
    );

    await user.click(
      within(mapsPanel()).getByRole('button', { name: EN['receptions.damage.templateSubmit']! })
    );

    // After: the map is on screen and the mark form is offered against it.
    const form = await screen.findByRole('form', { name: EN['receptions.damage.formLabel']! });
    expect(screen.queryByTestId('evidence-notice-damage_mark')).not.toBeInTheDocument();
    expect(
      offered(within(form).getByLabelText(new RegExp(EN['receptions.damage.map']!)))
    ).toContain('map-1');
  });

  it('does not offer a RETIRED diagram for a new map, and says the old ones stay readable', async () => {
    readCaptureContract.mockResolvedValue(
      captureContract([
        template({ id: 'tpl-live' }),
        template({
          id: 'tpl-old',
          mapType: 'interior',
          status: 'retired',
          documentId: 'doc-old',
          documentVersionId: 'ver-old',
        }),
      ])
    );
    recordConditionEvidence.mockResolvedValue(recorded('map-new', 'damage_map'));
    const user = userEvent.setup();
    renderLtr(<DamageMapStep {...stepProps()} />);

    const panel = mapsPanel();
    expect(await within(panel).findByTestId('damage-map-retired')).toHaveTextContent(
      EN['receptions.damage.templateRetired']!
    );
    expect(
      offered(within(panel).getByLabelText(new RegExp(EN['receptions.damage.templateLabel']!)))
    ).toEqual(['tpl-live']);

    // Absent from the chooser is not enough on its own: the submit path must
    // also be incapable of reaching it, which is what a `find` fallback to
    // `templates[0]` would have quietly broken.
    await user.click(
      within(panel).getByRole('button', { name: EN['receptions.damage.templateSubmit']! })
    );
    await waitFor(() => expect(recordConditionEvidence).toHaveBeenCalled());
    expect(recordConditionEvidence.mock.calls.at(-1)![1]).toEqual({
      kind: 'damage_map',
      documentId: 'doc-1',
      documentVersionId: 'ver-1',
      mapType: 'exterior',
    });
  });

  it('keeps a visit drawn on a retired diagram readable, and still markable', async () => {
    /*
     * Retirement is forward-looking. A map already drawn carries the exact
     * revision it was made on, so retiring the slot must not make the visit
     * unreadable or freeze the marks that belong to it — only stop a NEW map
     * being opened on a drawing nobody maintains.
     */
    evidenceByKind({ damage_map: [DAMAGE_MAP] });
    readCaptureContract.mockResolvedValue(
      captureContract([template({ id: 'tpl-old', status: 'retired' })])
    );
    renderLtr(<DamageMapStep {...stepProps()} />);

    const panel = mapsPanel();
    // The map itself reads back — the record does not depend on the template's
    // lifecycle, which is the whole reason both uuids are stored on the row.
    expect(await within(panel).findByText('top')).toBeInTheDocument();
    expect(within(panel).getByTestId('damage-map-retired')).toBeInTheDocument();
    // …and no new one can be opened, stated as the configuration state it is.
    expect(within(panel).getByTestId('damage-map-none')).toHaveTextContent(
      EN['receptions.damage.templateNone']!
    );
    expect(
      within(panel).queryByRole('button', { name: EN['receptions.damage.templateSubmit']! })
    ).not.toBeInTheDocument();

    // The map that exists still takes marks.
    const form = await screen.findByRole('form', { name: EN['receptions.damage.formLabel']! });
    expect(
      offered(within(form).getByLabelText(new RegExp(EN['receptions.damage.map']!)))
    ).toContain('map-1');
  });

  it('states a diagram slot with no published revision as configuration, not as failure', async () => {
    // `status: 'active'` and no revision: the slot exists, the geometry does
    // not. Selecting it would send two nulls into NOT NULL columns, so it is
    // filtered out — and the sentence names the missing publication rather than
    // reporting a read that worked as one that did not.
    readCaptureContract.mockResolvedValue(
      captureContract([
        template({
          activeVersionId: null,
          activeVersionNumber: null,
          documentId: null,
          documentVersionId: null,
        }),
      ])
    );
    renderLtr(<DamageMapStep {...stepProps()} />);

    const panel = mapsPanel();
    expect(await within(panel).findByTestId('damage-map-none')).toHaveTextContent(
      EN['receptions.damage.templateNone']!
    );
    expect(within(panel).queryByTestId('damage-map-unread')).not.toBeInTheDocument();
    expect(within(panel).queryByTestId('damage-map-retired')).not.toBeInTheDocument();
    expect(
      within(panel).queryByRole('button', { name: EN['receptions.damage.templateSubmit']! })
    ).not.toBeInTheDocument();
  });

  it('tells a pending read, an empty one and a failed one apart', async () => {
    /*
     * Three answers that collapse into one sentence unless the step keeps them
     * apart, and the collapse is always in the same direction: "this branch has
     * published nothing" is a claim about CONFIGURATION, and making it off a
     * read that has not answered — or off one that failed — sends an operator to
     * an administrator to fix something that is not broken.
     */
    let settle: (value: unknown) => void = () => {};
    readCaptureContract.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        })
    );
    const pending = renderLtr(<DamageMapStep {...stepProps()} />);
    // Both read-backs beside it have answered, so this is a rendered step with
    // an unanswered TEMPLATE read — not a step that has not mounted.
    expect(await screen.findAllByText(EN['receptions.evidence.readBackEmpty']!)).toHaveLength(2);
    expect(screen.queryByTestId('damage-map-none')).not.toBeInTheDocument();
    expect(screen.queryByTestId('damage-map-unread')).not.toBeInTheDocument();

    settle(captureContract([]));
    expect(await screen.findByTestId('damage-map-none')).toHaveTextContent(
      EN['receptions.damage.templateNone']!
    );
    expect(screen.queryByTestId('damage-map-unread')).not.toBeInTheDocument();
    pending.unmount();

    // Every way the read can fail, including the one that answers `ok` with no
    // contract at all — which is a broken answer, not an empty branch.
    const failures = [
      { status: 'error', correlationId: 'corr-500' },
      { status: 'denied', correlationId: 'corr-403' },
      { status: 'unavailable', correlationId: 'corr-429' },
      { status: 'expired', correlationId: 'corr-401' },
      { status: 'not-found', correlationId: 'corr-404' },
      { status: 'ok', data: null, correlationId: 'corr-empty' },
    ];
    expect(failures).toHaveLength(6);
    for (const failure of failures) {
      readCaptureContract.mockResolvedValue(failure);
      const failed = renderLtr(<DamageMapStep {...stepProps()} />);
      expect(await screen.findByTestId('damage-map-unread'), failure.status).toHaveTextContent(
        EN['receptions.damage.templateUnread']!
      );
      expect(screen.queryByTestId('damage-map-none'), failure.status).not.toBeInTheDocument();
      expect(
        screen.queryByText(EN['receptions.damage.templateNone']!),
        failure.status
      ).not.toBeInTheDocument();
      failed.unmount();
    }
  });

  it('offers no way to create, revise, publish or retire a diagram', async () => {
    /*
     * `rec.catalogue.manage` is not the reception desk's, and an absence is only
     * a guarantee if something checks it. The enumeration is exact, so a control
     * added tomorrow fails here whatever it is called; the matcher beside it
     * states the rule in words and is proved against a planted violation, since
     * a regular expression that has stopped matching reports a clean screen in
     * exactly the same way as one that is working.
     */
    evidenceByKind({ damage_map: [DAMAGE_MAP] });
    renderLtr(<DamageMapStep {...stepProps()} />);
    await screen.findByRole('form', { name: EN['receptions.damage.formLabel']! });

    const names = controlNames();
    expect(names).toEqual([
      EN['receptions.damage.templateSubmit']!,
      EN['receptions.damage.diagramLabel']!,
      EN['receptions.damage.record']!,
    ]);

    const ADMINISTRATION =
      /\b(create|new|add|revise|publish|retire|delete|manage|configure|edit)\b/i;
    expect(names.filter((name) => ADMINISTRATION.test(name))).toEqual([]);
    // The self-test. English only, and deliberately: `\b` is ASCII-only, so this
    // matcher can never fire beside Arabic script and running it over the RTL
    // render would pass by construction. The Arabic case below enumerates
    // instead, which needs no word boundary.
    expect(ADMINISTRATION.test('Publish a new diagram revision'), 'the matcher is asleep').toBe(
      true
    );
    expect(ADMINISTRATION.test(EN['receptions.damage.templateSubmit']!)).toBe(false);
    expect(ADMINISTRATION.test(EN['receptions.damage.record']!)).toBe(false);
  });

  it('withholds the mark form with no map, and says why', async () => {
    renderLtr(<DamageMapStep {...stepProps()} />);
    expect(await screen.findByTestId('evidence-notice-damage_mark')).toHaveTextContent(
      EN['receptions.evidence.damageMapRequired']!
    );
    expect(
      screen.queryByRole('button', { name: EN['receptions.damage.record']! })
    ).not.toBeInTheDocument();
    // The sentence says "Open one above first", so the control it points at has
    // to be above it. That instruction was advice nobody could follow for as
    // long as this step rendered no map form at all.
    expect(
      within(mapsPanel()).getByRole('button', { name: EN['receptions.damage.templateSubmit']! })
    ).toBeInTheDocument();
  });

  it('never renders an unfinished or refused map read as a visit with no map', async () => {
    /*
     * The mark gate, driven through every answer its read can give.
     *
     * `mapChoices.length === 0` was the whole gate, and six of the seven states
     * a `useServerTable` can be in leave that list empty — so a denial, an
     * expired session, a rate limit, a transport failure, a not-found and a read
     * still in flight all printed "A mark is placed on a damage map, and this
     * visit has none. Open one above first." The sentence is an OBSERVATION, and
     * making it off a read nobody answered sends an operator to open a second
     * map on a visit that may already carry one.
     *
     * Asserted by SIGNATURE rather than by "the empty message is absent": a
     * skeleton, a blank slot and a different sentence all satisfy an absence
     * check, which is how this class survived here before. Comparing the
     * signatures makes "two of these states look the same" a failure.
     */
    const slots = new Map<string, string>();

    // 1 — the read has not answered. Only the MAPS read is held open, so the
    // mark read-back beside it settles and proves the step is mounted: a slot
    // that is empty because nothing rendered would pass every assertion here.
    mapsRead(() => new Promise(() => {}));
    const pending = renderLtr(<DamageMapStep {...stepProps()} />);
    expect(await screen.findByText(EN['receptions.evidence.readBackEmpty']!)).toBeInTheDocument();
    expect(screen.queryByTestId('evidence-notice-damage_mark')).not.toBeInTheDocument();
    slots.set('pending', markSlot());
    pending.unmount();

    // 2 — refused. The panel above states the refusal; the gate below must not
    // contradict it with an absence, and must not invite a retry that cannot
    // work.
    mapsRead(() => Promise.resolve(failedPage('denied', 'corr-403')));
    const denied = renderLtr(<DamageMapStep {...stepProps()} />);
    expect(await screen.findByTestId('damage-mark-denied')).toHaveTextContent(
      EN['receptions.damage.markMapsDenied']!
    );
    // The two panels agree about one read: the refusal is named where the rows
    // would have been, and the gate says what follows from it.
    expect(screen.getByText(EN['state.denied.title']!)).toBeInTheDocument();
    slots.set('denied', markSlot());
    denied.unmount();

    // 3 — every other way the read can fail to establish anything, including a
    // page the server itself says is not the whole set.
    const unestablished = [
      failedPage('expired', 'corr-401'),
      failedPage('unavailable', 'corr-429'),
      failedPage('error', 'corr-500'),
      failedPage('not-found', 'corr-404'),
      page([], true),
    ];
    expect(unestablished).toHaveLength(5);
    for (const answer of unestablished) {
      mapsRead(() => Promise.resolve(answer));
      const failed = renderLtr(<DamageMapStep {...stepProps()} />);
      expect(await screen.findByTestId('damage-mark-unread'), answer.status).toHaveTextContent(
        EN['receptions.damage.markMapsUnknown']!
      );
      slots.set(`unknown:${answer.status}:${answer.hasMore}`, markSlot());
      failed.unmount();
    }

    // 4 — the control, and the only state entitled to the coverage notice: the
    // read covered the set and this visit genuinely holds no map.
    mapsRead(() => Promise.resolve(page([])));
    const none = renderLtr(<DamageMapStep {...stepProps()} />);
    expect(await screen.findByTestId('evidence-notice-damage_mark')).toHaveTextContent(
      EN['receptions.evidence.damageMapRequired']!
    );
    slots.set('none', markSlot());
    none.unmount();

    // The claim itself: the coverage notice is reached by ONE of the eight
    // answers, and no two distinguishable facts render alike.
    const claimed = [...slots.entries()].filter(([, slot]) =>
      slot.includes(EN['receptions.evidence.damageMapRequired']!)
    );
    expect(claimed.map(([state]) => state)).toEqual(['none']);
    // The four failing statuses share one sentence, deliberately — the panel
    // above names which — so the distinct renderings are the four FACTS.
    expect(new Set(slots.values()).size).toBe(4);
    expect(slots.get('pending')).toBe('nothing');
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
    // A mark is structured data of its own and names the MAP it sits on, never
    // the drawing: the document pair belongs to `rec.damage_maps`, and a mark
    // that carried its own copy could disagree with the map it hangs off the
    // moment the template is revised.
    expect(input).not.toHaveProperty('documentId');
    expect(input).not.toHaveProperty('documentVersionId');
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

  it('re-reads after a successful mark and renders the STORED coordinate, unrounded', async () => {
    /*
     * PERSISTENCE, which none of the cases above reach: they stop at what was
     * SENT. `0.125` surviving the request proves the form; it does not prove
     * that what comes back is shown as what was stored.
     *
     * `rec.reception-condition-evidence-list` publishes `coordX`/`coordY`
     * `::text` precisely because the column is `numeric(6,5)` and a JS float
     * would not be it — so the round trip returns `0.12500`, five decimals, and
     * `EVIDENCE_ROW_FIELDS` renders both as `identifier`: a token printed as it
     * arrived, never reformatted. A renderer that put `formatCoordinate` on the
     * READ side would show `0.13` here while the record held `0.125`, which is
     * the same disagreement `W-E-01` produced on the write side and is invisible
     * to every assertion that only inspects the request.
     */
    const STORED_MARK = {
      kind: 'damage_mark',
      id: 'mark-9',
      recordedAt: '2026-08-13T09:00:00.000Z',
      damageMapId: 'map-1',
      markType: 'chip',
      vehicleZone: 'rear bumper',
      coordX: '0.12500',
      coordY: '0.33330',
      note: null,
    };
    let markRows: readonly unknown[] = [];
    listConditionEvidence.mockImplementation((_visitId: string, kind: string) =>
      Promise.resolve(
        page(kind === 'damage_map' ? [DAMAGE_MAP] : kind === 'damage_mark' ? markRows : [])
      )
    );
    // The write is what makes the next read return the row — so the re-read is
    // observed by its RESULT changing, not by counting calls on a spy.
    recordConditionEvidence.mockImplementation(() => {
      markRows = [STORED_MARK];
      return Promise.resolve(recorded('mark-9', 'damage_mark'));
    });

    const user = userEvent.setup();
    renderLtr(<DamageMapStep {...stepProps()} />);

    const form = await screen.findByRole('form', { name: EN['receptions.damage.formLabel']! });
    await user.selectOptions(
      within(form).getByLabelText(new RegExp(EN['receptions.damage.map']!)),
      'map-1'
    );
    await user.selectOptions(
      within(form).getByLabelText(new RegExp(EN['receptions.damage.markType']!)),
      'chip'
    );
    await user.type(
      within(form).getByLabelText(new RegExp(EN['receptions.finding.zone']!)),
      'rear bumper'
    );
    const xField = within(form).getByLabelText(new RegExp(EN['receptions.damage.coordX']!));
    await user.clear(xField);
    await user.type(xField, '0.125');
    const yField = within(form).getByLabelText(new RegExp(EN['receptions.damage.coordY']!));
    await user.clear(yField);
    await user.type(yField, '0.3333');
    await user.click(within(form).getByRole('button', { name: EN['receptions.damage.record']! }));

    // The stored value, at the database's own scale, re-rendered from the read.
    expect(await screen.findByText('0.12500')).toBeInTheDocument();
    expect(screen.getByText('0.33330')).toBeInTheDocument();
    // …and not a two-decimal copy of it anywhere on the step.
    expect(screen.queryByText('0.13')).not.toBeInTheDocument();
    expect(screen.queryByText('0.33')).not.toBeInTheDocument();
  });

  it('withdraws BOTH write controls for a stated REASON, never as a configuration gate', async () => {
    /*
     * Three absences that read identically unless the copy separates them: "this
     * branch has published no diagram" (configuration), "no map exists to hang a
     * mark off" (data), and "you may not record one" (permission, or a visit
     * that has ended). A published diagram AND a map both exist in each half
     * below, so a step that fell back to either gate would be sending the
     * operator to fix something that is not wrong — and, worse, telling a reader
     * their branch is misconfigured when what they actually lack is a
     * permission.
     *
     * Each panel states its own withdrawal where its own control would have
     * been, so the sentence is expected TWICE and asserted by section. A
     * single-match `findByText` would refuse the second, correct, statement.
     */
    evidenceByKind({ damage_map: [DAMAGE_MAP] });

    for (const withdrawn of [
      {
        props: { capabilities: { ...CAPABILITIES, manageEvidence: false } },
        key: 'receptions.evidence.readOnly',
      },
      { props: { writesLocked: true }, key: 'receptions.evidence.lockedNote' },
    ]) {
      const view = renderLtr(<DamageMapStep {...stepProps(withdrawn.props)} />);

      expect(await screen.findAllByText(EN[withdrawn.key]!), withdrawn.key).toHaveLength(2);
      for (const panel of [mapsPanel(), marksPanel()]) {
        expect(within(panel).getByText(EN[withdrawn.key]!), withdrawn.key).toBeInTheDocument();
      }

      // Neither write is offered, and neither gate is borrowed to explain a
      // permission the operator can do nothing about.
      for (const button of ['receptions.damage.record', 'receptions.damage.templateSubmit']) {
        expect(
          screen.queryByRole('button', { name: EN[button]! }),
          `${withdrawn.key} · ${button}`
        ).not.toBeInTheDocument();
      }
      for (const gate of ['evidence-notice-damage_mark', 'damage-map-none', 'damage-map-unread']) {
        expect(screen.queryByTestId(gate), `${withdrawn.key} · ${gate}`).not.toBeInTheDocument();
      }

      // The read-back is untouched by any of it: a reader still reads.
      expect(within(mapsPanel()).getByText('top'), withdrawn.key).toBeInTheDocument();
      view.unmount();
    }
  });

  it('renders in Arabic, RTL — and the map surface itself stays LTR so no mark is mirrored', async () => {
    /*
     * The one RTL rule this step has that no other step has: a coordinate is a
     * FRACTION OF THE MAP, so `coordX = 0` must be the same physical place in
     * Arabic as in English. Mirroring the surface for RTL would mirror every
     * mark already stored against every map ever drawn — the single thing a
     * damage map must never do — and nothing outside this case would notice,
     * because the value submitted would still be a legal `0..1` fraction.
     */
    evidenceByKind({ damage_map: [DAMAGE_MAP] });
    renderRtl(<DamageMapStep {...stepProps({ locale: 'ar', messages: ar as typeof en })} />);

    expect(document.documentElement.dir).toBe('rtl');
    const form = await screen.findByRole('form', { name: AR['receptions.damage.formLabel']! });
    expect(within(form).getByText(AR['receptions.damage.record']!)).toBeInTheDocument();

    // The map type is a CLOSED four-value database vocabulary, so it is offered
    // translated rather than as the stored token: `exterior` on an Arabic screen
    // is an internal name reaching an operator, which is the same defect as a
    // raw message key wearing different clothes.
    expect(
      within(
        within(mapsPanel(AR)).getByLabelText(new RegExp(AR['receptions.damage.templateLabel']!))
      ).getByRole('option', { name: AR['receptions.damage.mapType.exterior']! })
    ).toBeInTheDocument();

    // The administration absence, enumerated rather than matched — an Arabic
    // keyword sweep written with `\b` could never fire (rule: `\b` is
    // ASCII-only), so the same guarantee is stated here as an exact list.
    expect(controlNames()).toEqual([
      AR['receptions.damage.templateSubmit']!,
      AR['receptions.damage.diagramLabel']!,
      AR['receptions.damage.record']!,
    ]);

    // The surface, and the two authoritative inputs, opt OUT of the direction.
    expect(screen.getByTestId('damage-diagram')).toHaveAttribute('dir', 'ltr');
    expect(
      within(form).getByLabelText(new RegExp(AR['receptions.damage.coordX']!))
    ).toHaveAttribute('dir', 'ltr');
    expect(
      within(form).getByLabelText(new RegExp(AR['receptions.damage.coordY']!))
    ).toHaveAttribute('dir', 'ltr');
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

/* --- F1: the inspection read-back is one page, and says so ------------------ */

describe('F1 — an unread page is never "this visit has none"', () => {
  /**
   * Every fixture in this block used to ignore the `cursor` argument, so page one
   * and page two answered identically and `hasMore` could not change across a page
   * move. The four completeness values were therefore only ever driven at
   * `request.page === 1` — the one page where `hasMore: false` really does mean
   * the whole set. The block certified a guarantee it could not test, and the
   * corner it could not reach was the corner that was broken.
   *
   * `evidenceWalk` takes the cursor and hands page two a DIFFERENT payload,
   * which is what makes a page move observable at all.
   */
  function evidenceTruncated(rows: Partial<Record<string, readonly unknown[]>>) {
    listConditionEvidence.mockImplementation((_visitId: string, kind: string) =>
      Promise.resolve(page(rows[kind] ?? [], true))
    );
  }

  /** Page one, then the page the cursor opens — each with its own `hasMore`. */
  function evidenceWalk(
    first: readonly unknown[],
    second: readonly unknown[],
    moreOnFirst: boolean,
    moreOnSecond: boolean
  ) {
    listConditionEvidence.mockImplementation(
      (_visitId: string, kind: string, _request: unknown, cursor: string | null) =>
        Promise.resolve(
          kind !== 'inspection'
            ? page([])
            : cursor === null
              ? // A cursor MUST come back, or `useCursorPages` remembers nothing and
                // page two re-sends `null` — which is how a page-two fixture can
                // silently re-read page one and look like it proved something.
                { ...page(first, moreOnFirst), nextCursor: 'cur-2' }
              : { ...page(second, moreOnSecond), nextCursor: moreOnSecond ? 'cur-3' : null }
        )
    );
  }

  /** Walks to page two through the pager the step renders. */
  async function toPageTwo(user: ReturnType<typeof userEvent.setup>) {
    const pager = await screen.findByRole('navigation', {
      name: EN['receptions.inspection.pagerLabel']!,
    });
    await user.click(within(pager).getByRole('button', { name: EN['table.nextPage']! }));
    await waitFor(() => expect(listConditionEvidence.mock.calls.length).toBeGreaterThan(2));
  }

  function evidenceUnreadable() {
    listConditionEvidence.mockImplementation(() =>
      Promise.resolve({
        status: 'error' as const,
        rows: [],
        nextCursor: null,
        hasMore: false,
        correlationId: 'corr-500',
      })
    );
  }

  /** Holds the `inspection` read open so it never settles. */
  function evidenceInFlight() {
    listConditionEvidence.mockImplementation((_visit: string, kind: string) =>
      kind === 'inspection'
        ? new Promise(() => {})
        : Promise.resolve({
            status: 'ok' as const,
            rows: [],
            nextCursor: null,
            hasMore: false,
            correlationId: 'corr',
          })
    );
  }

  it('says nothing about the visit while the read is still in flight', async () => {
    /*
     * The fourth value, and the one this block did not assert.
     * `readCompleteness` publishes `'pending' | 'complete' | 'truncated' | 'unreadable'`,
     * and the step consumed two of them: `'complete'` took the coverage notice
     * and EVERYTHING else fell to a ternary asking only `=== 'truncated'`, so a
     * read that had not answered printed "The inspections for this visit could
     * not be read". That is a conclusion about a question still in flight, and
     * it rendered on every mount before the read settled.
     *
     * The three cases below are named for the three values they drive, which
     * is what made the fourth look accounted for.
     */
    evidenceInFlight();
    renderLtr(<InspectionStep {...stepProps()} />);

    const pending = await screen.findByTestId('finding-inspections-pending');
    expect(pending).toHaveTextContent(EN['receptions.finding.inspectionsLoading']!);

    // Neither conclusion may be on screen: not the failure, not the absence.
    expect(screen.queryByTestId('finding-inspections-unknown')).not.toBeInTheDocument();
    expect(screen.queryByTestId('evidence-notice-condition_item')).not.toBeInTheDocument();
  });

  it('moves from in flight to the established absence once the read answers', async () => {
    /*
     * The transition, driven rather than asserted from two separate mounts: a
     * loading sentence that never becomes a conclusion is its own defect.
     */
    let settle: (value: unknown) => void = () => {};
    listConditionEvidence.mockImplementation((_visit: string, kind: string) =>
      kind === 'inspection'
        ? new Promise((resolve) => {
            settle = resolve;
          })
        : Promise.resolve({
            status: 'ok' as const,
            rows: [],
            nextCursor: null,
            hasMore: false,
            correlationId: 'corr',
          })
    );

    renderLtr(<InspectionStep {...stepProps()} />);
    await screen.findByTestId('finding-inspections-pending');

    await act(async () => {
      settle({
        status: 'ok' as const,
        rows: [{ ...OPEN_INSPECTION, inspectionStatus: 'completed', completedAt: 'x' }],
        nextCursor: null,
        hasMore: false,
        correlationId: 'corr',
      });
    });

    expect(await screen.findByTestId('evidence-notice-condition_item')).toBeInTheDocument();
    expect(screen.queryByTestId('finding-inspections-pending')).not.toBeInTheDocument();
  });

  it('offers a retry on a FAILED read, and the retry re-reads', async () => {
    evidenceUnreadable();
    const user = userEvent.setup();
    renderLtr(<InspectionStep {...stepProps()} />);

    await screen.findByTestId('finding-inspections-unknown');
    const before = listConditionEvidence.mock.calls.length;

    await user.click(screen.getByTestId('finding-inspections-retry'));
    await waitFor(() => expect(listConditionEvidence.mock.calls.length).toBeGreaterThan(before));
  });
  it('says none is open only when the read covered this visit', async () => {
    // The control, unchanged: a complete read holding one completed header.
    evidenceByKind({
      inspection: [{ ...OPEN_INSPECTION, inspectionStatus: 'completed', completedAt: 'x' }],
    });
    renderLtr(<InspectionStep {...stepProps()} />);

    expect(await screen.findByTestId('evidence-notice-condition_item')).toHaveTextContent(
      EN['receptions.evidence.inspectionRequired']!
    );
    expect(screen.queryByTestId('finding-inspections-unknown')).not.toBeInTheDocument();
  });

  it('does not claim none is open when the read stopped at a page boundary', async () => {
    /*
     * The coverage sentence is "A finding is recorded against an open
     * inspection, and this visit has none." — a claim about the VISIT, made off
     * one keyset page with the `in_progress` filter applied after it. An open
     * inspection on page two made that sentence false.
     */
    evidenceTruncated({
      inspection: [{ ...OPEN_INSPECTION, inspectionStatus: 'completed', completedAt: 'x' }],
    });
    renderLtr(<InspectionStep {...stepProps()} />);

    expect(await screen.findByTestId('finding-inspections-unknown')).toHaveTextContent(
      EN['receptions.finding.inspectionsTruncated']!
    );
    expect(screen.queryByTestId('evidence-notice-condition_item')).not.toBeInTheDocument();
  });

  it('does not claim none is open when the read failed', async () => {
    evidenceUnreadable();
    renderLtr(<InspectionStep {...stepProps()} />);

    expect(await screen.findByTestId('finding-inspections-unknown')).toHaveTextContent(
      EN['receptions.finding.inspectionsUnreadable']!
    );
    expect(screen.queryByTestId('evidence-notice-condition_item')).not.toBeInTheDocument();
  });

  it('reaches the open inspection on the next page and offers the finding form', async () => {
    evidenceTruncated({
      inspection: [{ ...OPEN_INSPECTION, inspectionStatus: 'completed', completedAt: 'x' }],
    });
    const user = userEvent.setup();
    renderLtr(<InspectionStep {...stepProps()} />);
    await screen.findByTestId('finding-inspections-unknown');

    const pager = screen.getByRole('navigation', {
      name: EN['receptions.inspection.pagerLabel']!,
    });
    evidenceByKind({ inspection: [OPEN_INSPECTION] });
    await user.click(within(pager).getByRole('button', { name: EN['table.nextPage']! }));

    expect(
      await screen.findByRole('button', { name: EN['receptions.finding.record']! })
    ).toBeInTheDocument();
  });

  it('does not say the visit has none once the walk has left page one', async () => {
    /*
     * The defect this whole block exists for, restored by one click of the
     * pager the block itself drives two cases above.
     *
     * Page one holds the open inspection and reports more exists. Page two is
     * the tail — a completed header, `hasMore: false` — and the first form of
     * `readCompleteness` called that `'complete'`. So the step printed the coverage
     * notice for a visit whose open inspection sat on the page the operator had
     * just left, and the finding form was withdrawn with it.
     */
    const COMPLETED = { ...OPEN_INSPECTION, inspectionStatus: 'completed', completedAt: 'x' };
    evidenceWalk([OPEN_INSPECTION], [COMPLETED], true, false);
    const user = userEvent.setup();
    renderLtr(<InspectionStep {...stepProps()} />);

    // Page one: the open inspection is here, so the form is offered.
    expect(
      await screen.findByRole('button', { name: EN['receptions.finding.record']! })
    ).toBeInTheDocument();

    await toPageTwo(user);

    /*
     * On page two the open inspection is out of view. That is a WINDOW, not an
     * observation, so the step may say it does not know — and may not print the
     * coverage notice, which is a claim about the whole visit.
     */
    expect(await screen.findByTestId('finding-inspections-unknown')).toHaveTextContent(
      EN['receptions.finding.inspectionsTruncated']!
    );
    expect(screen.queryByTestId('evidence-notice-condition_item')).not.toBeInTheDocument();
  });

  it('states the coverage notice ONLY from page one with nothing further', async () => {
    /*
     * The one corner entitled to conclude, kept beside the three that are not,
     * so the block cannot drift back to certifying page one alone.
     */
    evidenceWalk([], [], false, false);
    renderLtr(<InspectionStep {...stepProps()} />);

    expect(await screen.findByTestId('evidence-notice-condition_item')).toBeInTheDocument();
    expect(screen.queryByTestId('finding-inspections-unknown')).not.toBeInTheDocument();
    // Nothing further exists, so there is no pager to leave page one with.
    expect(
      screen.queryByRole('navigation', { name: EN['receptions.inspection.pagerLabel']! })
    ).not.toBeInTheDocument();
  });

  it('refuses the coverage notice on page two even when page two ends the walk', async () => {
    // page 2 + hasMore false — the corner no fixture in this block could reach.
    evidenceWalk([], [], true, false);
    const user = userEvent.setup();
    renderLtr(<InspectionStep {...stepProps()} />);
    await screen.findByTestId('finding-inspections-unknown');

    await toPageTwo(user);

    expect(await screen.findByTestId('finding-inspections-unknown')).toHaveTextContent(
      EN['receptions.finding.inspectionsTruncated']!
    );
    expect(screen.queryByTestId('evidence-notice-condition_item')).not.toBeInTheDocument();
  });

  it('refuses it on page two when more still lies ahead', async () => {
    // page 2 + hasMore true — unread in both directions.
    evidenceWalk([], [], true, true);
    const user = userEvent.setup();
    renderLtr(<InspectionStep {...stepProps()} />);
    await screen.findByTestId('finding-inspections-unknown');

    await toPageTwo(user);

    expect(await screen.findByTestId('finding-inspections-unknown')).toHaveTextContent(
      EN['receptions.finding.inspectionsTruncated']!
    );
    expect(screen.queryByTestId('evidence-notice-condition_item')).not.toBeInTheDocument();
  });
  it('renders the truncated sentence in Arabic, not as a key', async () => {
    evidenceTruncated({
      inspection: [{ ...OPEN_INSPECTION, inspectionStatus: 'completed', completedAt: 'x' }],
    });
    renderRtl(<InspectionStep {...stepProps({ messages: ar })} />);

    expect(await screen.findByTestId('finding-inspections-unknown')).toHaveTextContent(
      AR['receptions.finding.inspectionsTruncated']!
    );
  });
});

/* --- F8: the inspector is a person, shown by name --------------------------- */

describe('F8 — the inspection read-back shows a name, never an account identifier', () => {
  const INSPECTOR_ID = '6f4d1b3e-6a2c-4a1e-9f2b-6d4c1b3e6a2c';
  const INSPECTION_ROW = { ...OPEN_INSPECTION, inspectorId: INSPECTOR_ID };

  /** The read-back list, scoped away from the form beside it. */
  async function readBack(): Promise<HTMLElement> {
    return within(
      await screen.findByRole('region', { name: EN['receptions.inspection.heading']! })
    ).findByRole('list');
  }

  it('resolves the account and renders the name', async () => {
    readUserIdentity.mockResolvedValue({
      status: 'ok',
      data: { id: INSPECTOR_ID, displayName: 'Nadia Suleiman' },
      correlationId: 'corr-user',
    });
    evidenceByKind({ inspection: [INSPECTION_ROW] });
    renderLtr(<InspectionStep {...stepProps()} />);

    expect(await screen.findByText('Nadia Suleiman')).toBeInTheDocument();
    // The identifier is nowhere on the surface, in any element.
    expect(screen.queryByText(INSPECTOR_ID)).not.toBeInTheDocument();
    await waitFor(() => expect(readUserIdentity).toHaveBeenCalledWith(INSPECTOR_ID));
  });

  it('reads each distinct account once, however many rows carry it', async () => {
    readUserIdentity.mockResolvedValue({
      status: 'ok',
      data: { id: INSPECTOR_ID, displayName: 'Nadia Suleiman' },
      correlationId: 'corr-user',
    });
    evidenceByKind({
      inspection: [
        INSPECTION_ROW,
        { ...INSPECTION_ROW, id: 'insp-2' },
        { ...INSPECTION_ROW, id: 'insp-3' },
      ],
    });
    renderLtr(<InspectionStep {...stepProps()} />);

    await waitFor(() => expect(readUserIdentity).toHaveBeenCalled());
    // The list operation is `expensive-read`; three rows by one person are one
    // directory read, not three.
    expect(readUserIdentity.mock.calls).toHaveLength(1);
  });

  it('says the identifier names nobody rather than printing it, on a 404', async () => {
    // `inspector_id` has NO foreign key (G-EMP), so this is a state the database
    // permits — and the one case where showing the value would read as a person.
    readUserIdentity.mockResolvedValue({
      status: 'not-found',
      data: null,
      correlationId: 'corr-404',
    });
    evidenceByKind({ inspection: [INSPECTION_ROW] });
    renderLtr(<InspectionStep {...stepProps()} />);

    const list = await readBack();
    await waitFor(() =>
      expect(list).toHaveTextContent(EN['receptions.wizard.receivingEmployeeUnresolved']!)
    );
    expect(screen.queryByText(INSPECTOR_ID)).not.toBeInTheDocument();
  });

  it('says the read did not answer rather than printing the identifier', async () => {
    readUserIdentity.mockResolvedValue({
      status: 'error',
      data: null,
      correlationId: 'corr-500',
    });
    evidenceByKind({ inspection: [INSPECTION_ROW] });
    renderLtr(<InspectionStep {...stepProps()} />);

    const list = await readBack();
    await waitFor(() =>
      expect(list).toHaveTextContent(EN['receptions.wizard.receivingEmployeeUnavailable']!)
    );
    expect(screen.queryByText(INSPECTOR_ID)).not.toBeInTheDocument();
  });

  it('spends no directory request without the permission, and still shows no identifier', async () => {
    evidenceByKind({ inspection: [INSPECTION_ROW] });
    renderLtr(
      <InspectionStep
        {...stepProps({ capabilities: { ...CAPABILITIES, readStaffDirectory: false } })}
      />
    );

    const list = await readBack();
    await waitFor(() =>
      expect(list).toHaveTextContent(EN['receptions.wizard.receivingEmployeeUnavailable']!)
    );
    expect(readUserIdentity).not.toHaveBeenCalled();
    expect(screen.queryByText(INSPECTOR_ID)).not.toBeInTheDocument();
  });

  it('states the disposition without claiming no name can be resolved', async () => {
    // The note beside the control used to end "no other name can be resolved for
    // this field", which the list above it now contradicts.
    evidenceByKind({ inspection: [INSPECTION_ROW] });
    renderLtr(<InspectionStep {...stepProps()} />);

    const note = await screen.findByText(EN['receptions.inspection.inspectorNote']!);
    expect(note).toBeInTheDocument();
    expect(note.textContent).not.toMatch(/no other name can be resolved/i);
  });
});
