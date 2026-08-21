import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import type { CheckInStepProps } from '@/features/receptions/check-in/wizard';
import {
  CAPTURE_REQUIREMENTS,
  MAX_OVERRIDE_REASON,
  type CaptureBindingEntry,
  type CaptureContract,
  type CaptureOverrideEntry,
  type CaptureRequirement,
  type CaptureRequirementState,
  type ReceptionDetail,
} from '@/features/receptions/receptions-contract';

/**
 * `P1-28-FE-017` — the reception evidence area, rendered (`TC-P1-28-REC-009`).
 *
 * ## What this file used to be, and why none of it survived
 *
 * It was the DOM half of a BAN. `P1-OD-025` was an open Owner decision, so the
 * step rendered a statement instead of a capability, and this suite swept the
 * check-in start screen, every wizard step and the walk-in intake asserting that
 * nothing on any of them could hand a file to the application.
 *
 * The decision is resolved. The private versioned model exists (Document →
 * immutable Version → business link, `pending → scanning → accepted`), a real
 * S3-compatible store is configured for the acceptance environment, the seven
 * platform `reception_*` categories are seeded, and capture runs through a
 * Server Action so the browser never holds storage credentials or an object key.
 * A sweep for the absence of capture would now be a sweep for the absence of the
 * feature, so it is gone rather than softened — and what replaces it is the
 * proof that the capability an operator meets behaves as the contract says.
 *
 * ## What is proved here, and what deliberately is not
 *
 * The subject is `components/steps/MediaStep.tsx` and only that. Every adapter is
 * a module mock, because what is under test is the SCREEN: which of the four
 * per-requirement states it chooses, what its count means, which authority the
 * waiver costs, what the operator is told after a capture, and which controls a
 * terminal visit withdraws. The transport is held by `tests/support/p1-28-drives
 * .ts` and by the source twin `p1-28-reception-media.test.ts`; the Server Action
 * chain itself — category resolution, registration, link, bind, finalize — is
 * held by `reception-evidence.test.ts`. Asserting any of that from here would be
 * asserting a mock.
 *
 * ## Non-vacuity
 *
 * A DOM assertion about a row that never rendered is a pass that measured
 * nothing, and this repository has been bitten by that shape repeatedly. So
 * every case that speaks about requirement rows first asserts the rows are
 * there, by requirement code, through `rowsRendered()`; the case that counts
 * file inputs also asserts the count is non-zero on the surface it expects them;
 * the four outcome sentences are asserted DISTINCT before any of them is used to
 * identify a branch; and the Arabic case runs its script matcher in both
 * directions so a matcher that could never fire cannot pass as a translation
 * check.
 */

/* --- adapter mocks (the transport is not what is under test) --------------- */

const readCaptureContract = vi.fn();
const overrideCaptureRequirement = vi.fn();
/**
 * Not called by this step — and mocked anyway.
 *
 * `steps/EvidencePanels.tsx` imports it at module scope for the read-back
 * helpers the condition-evidence steps share, and `MediaStep` imports that
 * module for `EvidenceStates` and the two button classes. A factory mock
 * REPLACES the module, so an export the graph imports and this factory omits is
 * not a stub returning `undefined` — it throws on access, which is how a suite
 * ends up red for a reason that has nothing to do with what it tests.
 */
const listConditionEvidence = vi.fn();

vi.mock('@/features/receptions/api', () => ({
  readCaptureContract: (...args: unknown[]) => readCaptureContract(...args),
  overrideCaptureRequirement: (...args: unknown[]) => overrideCaptureRequirement(...args),
  listConditionEvidence: (...args: unknown[]) => listConditionEvidence(...args),
}));

/**
 * The capture Server Action, mocked so its OUTCOMES can be driven.
 *
 * The four sentences the step can print are a function of what this returns —
 * the stage reached and whether a scanner could read the object back — and
 * nothing else on the screen can produce them. Driving the branches from here is
 * therefore driving the branch selector, not simulating it.
 */
const captureRequirementEvidence = vi.fn();
/*
 * The retry is a SECOND export of the same module, not the chain step it ends
 * in: a component that named `finalizeEvidenceBinding` would be driving the
 * sequence from the browser, which `p1-28-reception-media.test.ts` forbids by
 * name. That the action really finalizes is proved statically there; what is
 * driven here is what the SCREEN does with its answer.
 */
const finalizeCapturedEvidence = vi.fn();
vi.mock('@/features/receptions/evidence-capture', () => ({
  captureRequirementEvidence: (...args: unknown[]) => captureRequirementEvidence(...args),
  finalizeCapturedEvidence: (...args: unknown[]) => finalizeCapturedEvidence(...args),
}));

/** `EvidencePanels` resolves account identifiers to names through this one. */
const readUserIdentity = vi.fn();
vi.mock('@/features/receptions/support-api', () => ({
  readUserIdentity: (...args: unknown[]) => readUserIdentity(...args),
}));

const { MediaStep } = await import('@/features/receptions/components/steps/MediaStep');
/**
 * The real component, NOT a mock.
 *
 * One case renders it standalone and compares the element it produces with the
 * one the step rendered, which is the only way to prove the input in the capture
 * form came from the single approved path rather than from a second
 * `<input type="file">` that happens to look like it.
 */
const { CaptureFileField } = await import('@/features/receptions/components/CaptureFileField');

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

/* --- fixtures -------------------------------------------------------------- */

const VISIT = 'rv-1';

const DETAIL: ReceptionDetail = {
  id: VISIT,
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
  viewSensitiveNarratives: true,
  manageSignatures: true,
  recordOdometer: true,
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
    visitId: VISIT,
    recordVersion: 3,
    detail: DETAIL,
    capabilities: CAPABILITIES,
    session: { userId: 'user-1', displayName: 'Front Desk' },
    writesLocked: false,
    refresh: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

function requirement(
  code: CaptureRequirement,
  over: Partial<CaptureRequirementState> = {}
): CaptureRequirementState {
  return {
    requirementCode: code,
    minCount: 1,
    deviceCapturedAtRequired: false,
    source: 'baseline',
    finalizedCount: 0,
    recordedCount: 0,
    satisfied: false,
    overridden: false,
    ...over,
  };
}

function binding(
  id: string,
  code: CaptureRequirement,
  status: string,
  finalizedAt: string | null
): CaptureBindingEntry {
  return {
    id,
    requirementCode: code,
    documentId: `doc-${id}`,
    documentVersionId: `ver-${id}`,
    documentVersionStatus: status,
    integritySha256: finalizedAt === null ? null : 'a'.repeat(64),
    deviceCapturedAt: null,
    qualityStatus: 'readable',
    finalizedAt,
    finalizedBy: finalizedAt === null ? null : 'user-1',
    createdAt: '2026-08-13T08:00:00.000Z',
    createdBy: 'user-1',
  };
}

const WAIVER: CaptureOverrideEntry = {
  id: 'ovr-1',
  requirementCode: 'ev_soc',
  reason: 'The vehicle is not electric.',
  actorId: 'user-1',
  occurredAt: '2026-08-13T08:10:00.000Z',
};

/**
 * FIVE requirements for five states, one each.
 *
 * A branch resolved to the same value twice cannot be told apart by a case that
 * only asserts each row's own copy — the wrong-state row would be masked by a
 * sibling that happens to be right — so each state is published exactly once and
 * the five rendered sentences are then asserted distinct.
 *
 * `vin` is the state this suite used to have no fixture for and, worse, used to
 * assert the contradiction of: one accepted photograph counted out of the two
 * the requirement asks for. It is PARTLY met. The screen printed "Recorded but
 * not counted — nothing here has been accepted yet." above a line reading
 * "Accepted · counted", and this file asserted that sentence by key, so the
 * contradiction was pinned rather than caught. `warning_lamp` is what that
 * sentence is actually for: two versions bound, neither of them counting.
 *
 * `ev_soc` is deliberately BOTH `satisfied` and `overridden`, which is what
 * `rec.reception-evidence-binding-list` answers for a waived requirement, since
 * an override is one of the two ways a requirement is satisfied. It is the only
 * fixture that can prove the precedence: a screen that read `satisfied` first
 * would print "Met." over a requirement nobody evidenced.
 */
const PUBLISHED: readonly CaptureRequirement[] = [
  'exterior',
  'vin',
  'warning_lamp',
  'damage',
  'ev_soc',
];

const CONTRACT: CaptureContract = {
  receptionVisitId: VISIT,
  requirements: [
    requirement('exterior', { minCount: 2, finalizedCount: 2, recordedCount: 2, satisfied: true }),
    // Three files bound, one of them counted: partly met, and the case the whole
    // "finalized only" rule exists for.
    requirement('vin', { minCount: 2, finalizedCount: 1, recordedCount: 3 }),
    /*
     * Two bound, neither counted — and one of them ACCEPTED but never
     * finalized, which is where the capture's sixth call leaves a binding when
     * it does not answer. The requirement is not met by it and the operator can
     * still count it, so this one fixture carries both halves.
     */
    requirement('warning_lamp', { minCount: 1, finalizedCount: 0, recordedCount: 2 }),
    requirement('damage'),
    requirement('ev_soc', { satisfied: true, overridden: true }),
  ],
  bindings: [
    binding('ex-1', 'exterior', 'accepted', '2026-08-13T08:05:00.000Z'),
    binding('ex-2', 'exterior', 'accepted', '2026-08-13T08:06:00.000Z'),
    binding('vin-1', 'vin', 'accepted', '2026-08-13T08:07:00.000Z'),
    binding('vin-2', 'vin', 'pending', null),
    binding('vin-3', 'vin', 'scanning', null),
    binding('lamp-1', 'warning_lamp', 'pending', null),
    binding('lamp-2', 'warning_lamp', 'accepted', null),
  ],
  overrides: [WAIVER],
  bindableTemplates: [],
  // No diagram published and none retired — the NEVER-PUBLISHED state.
  retiredPublishedTemplateCount: 0,
};

/**
 * The SHIPPED DEFAULT, on its own, because it is not an edge case.
 *
 * `rec.capture_policy_rules` ships empty, so the read model falls back to its
 * baseline and `exterior` asks for SEVEN photographs. Three taken, accepted and
 * counted is therefore what every visit looks like partway through its first
 * requirement — and it is the exact shape the old branch mis-read, because
 * `recordedCount > finalizedCount` is FALSE when every recorded photograph has
 * been counted, so the row fell through to "Nothing recorded yet." above three
 * counted lines.
 */
const BASELINE_EXTERIOR: CaptureContract = {
  receptionVisitId: VISIT,
  requirements: [
    requirement('exterior', {
      minCount: 7,
      deviceCapturedAtRequired: true,
      finalizedCount: 3,
      recordedCount: 3,
    }),
  ],
  bindings: [
    binding('base-1', 'exterior', 'accepted', '2026-08-13T08:01:00.000Z'),
    binding('base-2', 'exterior', 'accepted', '2026-08-13T08:02:00.000Z'),
    binding('base-3', 'exterior', 'accepted', '2026-08-13T08:03:00.000Z'),
  ],
  overrides: [],
  bindableTemplates: [],
  // No diagram published and none retired — the NEVER-PUBLISHED state.
  retiredPublishedTemplateCount: 0,
};

function contractRead(contract: CaptureContract = CONTRACT) {
  return { status: 'ok' as const, data: contract, correlationId: 'corr-capture' };
}

/** A write that succeeded, in the shape `overrideCaptureRequirement` returns. */
function waiverRecorded(code: CaptureRequirement) {
  return {
    status: 'success' as const,
    correlationId: 'corr-waiver',
    attempt: 1,
    recorded: { receptionVisitId: VISIT, overrideId: 'ovr-new', requirementCode: code },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  readCaptureContract.mockResolvedValue(contractRead());
  /*
   * A `CaptureOutcome`, which is what the action returns — not the adapter's
   * `EvidenceFinalizeState`. `stage` is the field the outcome line reads, so a
   * stub shaped like the layer underneath would print the sentence for a
   * capture that never finalized.
   */
  finalizeCapturedEvidence.mockResolvedValue({
    status: 'success' as const,
    attempt: 1,
    correlationId: 'corr-finalize',
    stage: 'finalized' as const,
    bindingId: 'lamp-2',
  });
  listConditionEvidence.mockResolvedValue({
    status: 'ok',
    rows: [],
    nextCursor: null,
    hasMore: false,
    correlationId: 'corr-page',
  });
  readUserIdentity.mockResolvedValue({
    status: 'ok',
    data: { id: 'user-1', displayName: 'Front Desk' },
    correlationId: 'corr-user',
  });
});

/* --- the non-vacuity guard every case below runs first ---------------------- */

/**
 * The requirement rows, once they are on the page.
 *
 * Nothing in this file asserts anything about a row's content, its count, its
 * controls or its copy without having gone through here first: the step renders
 * a skeleton until the contract read answers, so an assertion made too early —
 * or after a read that failed — would be an assertion about an empty document,
 * and "no waiver control was found" is exactly as true of a step that never
 * rendered as of one that withheld it.
 */
async function rowsRendered(
  codes: readonly CaptureRequirement[] = PUBLISHED
): Promise<Map<CaptureRequirement, HTMLElement>> {
  const rows = new Map<CaptureRequirement, HTMLElement>();
  for (const code of codes) {
    rows.set(code, await screen.findByTestId(`capture-${code}`));
  }
  expect(rows.size, 'the step rendered no requirement row — this case measured nothing').toBe(
    codes.length
  );
  return rows;
}

/* ------------------------------------------------------------------ *
 * The rows, and the state each one is in
 * ------------------------------------------------------------------ */

describe('P1-28-FE-017 — one row per requirement the contract published', () => {
  it('renders the published requirements, and nothing for the rest of the vocabulary', async () => {
    renderLtr(<MediaStep {...stepProps()} />);
    const rows = await rowsRendered();

    for (const code of PUBLISHED) {
      expect(
        within(rows.get(code)!).getByText(EN[`receptions.capture.requirement.${code}`]!),
        code
      ).toBeInTheDocument();
    }

    /*
     * The other direction, and it is not decoration: the resolved policy for a
     * branch is a SUBSET of the vocabulary, so a step that rendered
     * `CAPTURE_REQUIREMENTS` instead of `contract.requirements` would ask an
     * operator for captures their branch does not require and would report them
     * outstanding for ever.
     */
    const unpublished = CAPTURE_REQUIREMENTS.filter((code) => !PUBLISHED.includes(code));
    expect(unpublished.length, 'every requirement is published — the absence proves nothing').toBe(
      1
    );
    for (const code of unpublished) {
      expect(screen.queryByTestId(`capture-${code}`), code).toBeNull();
    }
  });

  it('chooses a different state for each of the five, and the five are distinct', async () => {
    renderLtr(<MediaStep {...stepProps()} />);
    const rows = await rowsRendered();

    const expected: Record<string, string> = {
      exterior: EN['receptions.capture.state.satisfied']!,
      // One of the two counted. The count says `1/2` and this says what that
      // means: some of this requirement is evidenced and some of it is not.
      vin: EN['receptions.capture.state.partiallyMet']!,
      // Two bound, neither counted — which is a different fact from `vin`'s and
      // from `damage`'s, and the only one of the three an operator can resolve
      // by waiting.
      warning_lamp: EN['receptions.capture.state.recordedNotCounted']!,
      damage: EN['receptions.capture.state.outstanding']!,
      ev_soc: EN['receptions.capture.state.overridden']!,
    };

    for (const code of PUBLISHED) {
      const state = within(rows.get(code)!).getByTestId(`capture-state-${code}`);
      expect(state.textContent, code).toBe(expected[code]);
    }

    // Five rows saying five things. A catalogue in which two of these sentences
    // were identical would make the five assertions above pass over four
    // states, so the distinctness is asserted rather than assumed.
    expect(new Set(Object.values(expected)).size).toBe(5);
  });

  it('reads the waiver ahead of the tick, so a waived requirement never reads as met', async () => {
    renderLtr(<MediaStep {...stepProps()} />);
    const row = (await rowsRendered()).get('ev_soc')!;

    // `ev_soc` arrives satisfied AND overridden. Only one of those is the truth
    // an operator needs at a handover.
    expect(within(row).getByTestId('capture-state-ev_soc').textContent).toBe(
      EN['receptions.capture.state.overridden']
    );
    expect(within(row).queryByText(EN['receptions.capture.state.satisfied']!)).toBeNull();
    // …and the recorded reason is on the row, not only in an audit table.
    expect(within(row).getByTestId('capture-override-ev_soc')).toHaveTextContent(WAIVER.reason);
  });

  it('counts FINALIZED bindings only — three recorded files do not move 1/2', async () => {
    renderLtr(<MediaStep {...stepProps()} />);
    const row = (await rowsRendered()).get('vin')!;

    /*
     * `finalizedCount/minCount`, exactly. Asserted as an equality rather than
     * with a substring matcher because the number this must NOT show is
     * `recordedCount`, and "3/2" contains a "2" just as "1/2" does.
     */
    const count = within(row).getByTestId('capture-count-vin');
    expect(count.textContent).toBe('1/2');

    // The three bound versions are listed by their VERSION STATE — the only
    // thing that decides whether a file is evidence — and exactly one of them
    // carries the counted marker.
    const versions = within(row).getAllByRole('listitem');
    expect(versions).toHaveLength(3);
    const lines = versions.map((entry) => entry.textContent ?? '');
    expect(lines.some((line) => line.includes(EN['receptions.capture.version.accepted']!))).toBe(
      true
    );
    expect(lines.some((line) => line.includes(EN['receptions.capture.version.pending']!))).toBe(
      true
    );
    expect(lines.some((line) => line.includes(EN['receptions.capture.version.scanning']!))).toBe(
      true
    );
    expect(lines.filter((line) => line.includes(EN['receptions.capture.counted']!))).toHaveLength(
      1
    );

    /*
     * …and the sentence above those lines does not deny them.
     *
     * This is where the suite used to pin a contradiction: it asserted
     * `recordedNotCounted` — "nothing here has been accepted yet" — on the row
     * it had just proved carries an "Accepted · counted" line. A screen may say
     * one or the other of those things about a requirement, never both, so both
     * of the sentences that would deny the counted line are refused by name.
     */
    const state = within(row).getByTestId('capture-state-vin').textContent;
    expect(state).toBe(EN['receptions.capture.state.partiallyMet']);
    expect(state).not.toBe(EN['receptions.capture.state.recordedNotCounted']);
    expect(state).not.toBe(EN['receptions.capture.state.outstanding']);
  });

  it('reports the SHIPPED DEFAULT honestly — three of seven photographs is not nothing', async () => {
    /*
     * The reachability of this is the whole finding. `rec.capture_policy_rules`
     * ships empty, so `exterior` resolves to the baseline's SEVEN, and a visit
     * whose first three photographs have all been taken, accepted and counted
     * was told "Nothing recorded yet." — printed directly above the three
     * "Accepted · counted" lines it was denying. This is photographs one to six
     * of every single visit, not a contrived fixture.
     */
    readCaptureContract.mockResolvedValue(contractRead(BASELINE_EXTERIOR));
    renderLtr(<MediaStep {...stepProps()} />);
    const row = (await rowsRendered(['exterior'])).get('exterior')!;

    const counted = within(row)
      .getAllByRole('listitem')
      .map((entry) => entry.textContent ?? '')
      .filter((line) => line.includes(EN['receptions.capture.counted']!));
    expect(counted, 'nothing was counted — this case would prove nothing').toHaveLength(3);
    expect(within(row).getByTestId('capture-count-exterior').textContent).toBe('3/7');

    const state = within(row).getByTestId('capture-state-exterior').textContent;
    expect(state).toBe(EN['receptions.capture.state.partiallyMet']);
    // The sentence that was printed, named so a regression fails as itself.
    expect(state, 'three counted photographs are being reported as nothing').not.toBe(
      EN['receptions.capture.state.outstanding']
    );
    // …and partly met is not met: the tick still belongs to seven of seven.
    expect(state).not.toBe(EN['receptions.capture.state.satisfied']);
  });

  it('separates the LAST outstanding photograph from the finished set — 6/7 then 7/7', async () => {
    /*
     * The boundary the floor comparison is decided on, driven from both sides.
     *
     * `partiallyMet` and `satisfied` differ by exactly one finalized binding
     * here, so an off-by-one in the comparison — `>` for `>=`, or the reverse —
     * is invisible to every other case in this file: three of seven and none of
     * seven are both far enough from the floor to survive either mistake. At the
     * boundary one of the two directions declares a visit complete a photograph
     * early, which is the expensive one: the vehicle leaves with its condition
     * under-evidenced and the screen showing a tick.
     */
    const exteriorAt = (finalized: number): CaptureContract => ({
      receptionVisitId: VISIT,
      requirements: [
        requirement('exterior', {
          minCount: 7,
          deviceCapturedAtRequired: true,
          finalizedCount: finalized,
          recordedCount: finalized,
          /*
           * Satisfaction is the SERVER's judgement, carried on the row, and the
           * screen does not recompute it from the two counts. That is the right
           * division — `rec.capture_policy_rules` and the baseline behind it are
           * branch policy, and a comparison done here would be a second opinion
           * that disagrees the moment the policy gains a rule this tree has
           * never heard of. So the fixture supplies what the API would.
           */
          satisfied: finalized >= 7,
        }),
      ],
      bindings: Array.from({ length: finalized }, (_unused, index) =>
        binding(`edge-${index + 1}`, 'exterior', 'accepted', '2026-08-13T08:0' + index + ':00.000Z')
      ),
      overrides: [],
      bindableTemplates: [],
      // No diagram published and none retired — the NEVER-PUBLISHED state.
      retiredPublishedTemplateCount: 0,
    });

    // Six of seven: one short, and NOT met.
    readCaptureContract.mockResolvedValue(contractRead(exteriorAt(6)));
    const six = renderLtr(<MediaStep {...stepProps()} />);
    const sixRow = (await rowsRendered(['exterior'])).get('exterior')!;
    expect(within(sixRow).getByTestId('capture-count-exterior').textContent).toBe('6/7');
    expect(within(sixRow).getByTestId('capture-state-exterior').textContent).toBe(
      EN['receptions.capture.state.partiallyMet']
    );
    expect(
      within(sixRow).getByTestId('capture-state-exterior').textContent,
      'a visit one photograph short is being reported as met'
    ).not.toBe(EN['receptions.capture.state.satisfied']);
    six.unmount();

    // Seven of seven: met, and the ONLY one of the five states that is a tick.
    readCaptureContract.mockResolvedValue(contractRead(exteriorAt(7)));
    renderLtr(<MediaStep {...stepProps()} />);
    const sevenRow = (await rowsRendered(['exterior'])).get('exterior')!;
    expect(within(sevenRow).getByTestId('capture-count-exterior').textContent).toBe('7/7');
    expect(within(sevenRow).getByTestId('capture-state-exterior').textContent).toBe(
      EN['receptions.capture.state.satisfied']
    );
  });

  it('states the failed read, with its correlation id and a retry — never an empty area', async () => {
    /*
     * The premise of every case above is that the rows on screen are what the
     * contract answered. A read that failed has answered nothing, and rendering
     * the step's empty frame would tell an operator this visit owes no evidence.
     */
    readCaptureContract.mockResolvedValue({ status: 'error', correlationId: 'corr-500' });
    renderLtr(<MediaStep {...stepProps()} />);

    expect(await screen.findByText('corr-500')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: EN['state.retry']! })).toBeInTheDocument();
    for (const code of PUBLISHED) {
      expect(screen.queryByTestId(`capture-${code}`), code).toBeNull();
    }
  });
});

/* ------------------------------------------------------------------ *
 * The capture form, and the one approved input
 * ------------------------------------------------------------------ */

describe('P1-28-FE-017 — the capture form', () => {
  it('renders exactly one file input per offered requirement, and it is CaptureFileField', async () => {
    const { container } = renderLtr(<MediaStep {...stepProps()} />);
    const rows = await rowsRendered();

    /*
     * Four forms, not five: a requirement whose waiver stands is not offered a
     * capture control, because recording evidence against a waived requirement
     * is not a thing the operator was asked for. `exterior` IS offered one
     * despite being satisfied — a second exterior photograph is always legal.
     */
    const inputs = container.querySelectorAll('input[type="file"]');
    expect(inputs.length, 'the step offered no capture control at all').toBe(4);
    expect(within(rows.get('ev_soc')!).queryByLabelText(EN['receptions.capture.chooseFile']!)).toBe(
      null
    );

    const inRow = rows.get('vin')!.querySelectorAll('input[type="file"]');
    expect(inRow).toHaveLength(1);

    /*
     * PROVENANCE, not resemblance.
     *
     * `no-unapproved-file-input` allows a file input in exactly one path, and the
     * allowance is worth nothing if a second input elsewhere can look like this
     * one. The reference is rendered from the approved component with the props
     * the step passes, and the two elements are compared as markup — so an input
     * assembled in the step, or the shared component quietly gaining an `accept`
     * list this tree invented, fails here.
     */
    const reference = renderLtr(
      <CaptureFileField name="evidenceFile" label={EN['receptions.capture.chooseFile']!} />
    );
    expect(inRow[0]!.outerHTML).toBe(reference.container.firstElementChild!.outerHTML);
    expect(inRow[0]!.hasAttribute('accept')).toBe(false);
  });

  it('carries the chosen file on the approved input, and submits it under the name the action reads', async () => {
    /*
     * Two halves of one contract, and they are asserted separately because jsdom
     * can only be trusted with one of them.
     *
     * The FIELD NAME is a contract between two files: `evidence-capture.ts`
     * reads `formData.get('evidenceFile')` and answers `attachments.capture
     * .empty` for anything else. A rename on either side leaves a form that
     * submits, a screen that reports a refusal, and nothing that says why — so
     * the submitted key set is asserted on the wire, exactly, rather than the
     * markup being read for a `name` attribute.
     *
     * The BYTES cannot be asserted through that `FormData`. jsdom builds it from
     * each control's INTERNAL state, and `user-event` selects a file by defining
     * a `files` property on the element — which every reader sees and jsdom's own
     * serialiser does not — so the entry arrives as jsdom's empty-selection stand-
     * in whatever was chosen. Claiming the file crossed would therefore be
     * claiming something this environment cannot show. What it can show is that
     * the operator's file is held by the ONE approved input, which is asserted
     * off the element; that the browser then serialises it is the platform's job,
     * and the Server Action's own refusal of an empty field is
     * `reception-evidence.test.ts`'s.
     */
    captureRequirementEvidence.mockResolvedValue({
      status: 'success',
      attempt: 1,
      stage: 'finalized',
    });
    const user = userEvent.setup();
    renderLtr(<MediaStep {...stepProps()} />);
    const row = (await rowsRendered()).get('vin')!;

    const chosen = new File([new Uint8Array([1, 2, 3])], 'vin-plate.jpg', { type: 'image/jpeg' });
    const field = within(row).getByLabelText(EN['receptions.capture.chooseFile']!);
    await user.upload(field, chosen);
    expect((field as HTMLInputElement).files?.[0]?.name).toBe('vin-plate.jpg');

    await user.click(within(row).getByRole('button', { name: EN['receptions.capture.submit']! }));

    await waitFor(() => expect(captureRequirementEvidence).toHaveBeenCalled());
    const [visitId, code, formData] = captureRequirementEvidence.mock.calls.at(-1)!;
    expect(visitId).toBe(VISIT);
    // The requirement is the ROW's, never a value the operator chose: there is
    // exactly one document category that can satisfy each requirement, so a
    // picker here would be a way to be refused.
    expect(code).toBe('vin');
    /*
     * Exactly one field, and it is that one. An equality rather than a `has`,
     * because the second thing this proves is a negative: nothing else rides
     * along — no company or branch the client asserted, no accepted-type list
     * this tree invented, no requirement code smuggled into the body where the
     * argument already carries it.
     */
    expect([...(formData as FormData).keys()]).toEqual(['evidenceFile']);
  });

  it('re-reads the contract after a capture, so the count is the server’s, not the form’s', async () => {
    captureRequirementEvidence.mockResolvedValue({
      status: 'success',
      attempt: 1,
      stage: 'bound',
      scannerAvailable: true,
    });
    const user = userEvent.setup();
    renderLtr(<MediaStep {...stepProps()} />);
    const row = (await rowsRendered()).get('damage')!;

    expect(readCaptureContract).toHaveBeenCalledTimes(1);
    await user.click(within(row).getByRole('button', { name: EN['receptions.capture.submit']! }));

    // The step never increments a count of its own: it asks again. A screen that
    // added one locally would show `1/1` for a version that is still `pending`.
    await waitFor(() => expect(readCaptureContract.mock.calls.length).toBeGreaterThan(1));
  });
});

/* ------------------------------------------------------------------ *
 * The finalization, where the capture's own attempt did not answer
 * ------------------------------------------------------------------ */

/**
 * An accepted binding that was never counted, and the way out of it.
 *
 * `evidence-capture.ts` attempts the finalization once and reports stage `bound`
 * when it fails — an expired session, a transport failure, a refusal. The
 * version is accepted, the binding is real, and nothing else on this screen can
 * make it count: capturing the file again would leave a second document
 * standing for the same panel and the first one uncounted for ever. `lamp-2` is
 * that binding.
 *
 * The control is derived from the ENTRY, not from the requirement, because the
 * database refuses on the entry's own two facts — the RLS policy admits the
 * update only while `finalized_at IS NULL`, and the binding guard refuses a
 * version that is not accepted — so a control offered anywhere else could only
 * fail.
 */
/**
 * The outcome line — what the operator is told an act DID.
 *
 * Three of these states were unreachable by any fixture in this file, which is
 * how each of them shipped saying something false:
 *
 *   - a capture whose finalization was refused comes back as
 *     `{ status: 'denied', stage: 'bound' }`, and the reporter read the status
 *     first, so it announced "Nothing was recorded." over a document that had
 *     been registered, linked AND bound;
 *   - a successful WAIVER was cast to a capture outcome, so it fell through to
 *     the last branch and told an operator who had waived a requirement that
 *     "the file is still being checked" — there is no file;
 *   - a refused waiver reported nothing at all, leaving whatever sentence was
 *     on screen before it standing as though it still applied.
 */
describe('P1-28-FE-017 — the outcome line reports what the act really did', () => {
  const requirementRow = async (code: CaptureRequirement) => (await rowsRendered()).get(code)!;

  it('says what was recorded when the finalization is REFUSED, not that nothing was', async () => {
    /*
     * The exact shape `evidence-capture.ts` returns when the sixth call does
     * not answer: the failure spread over the stage it had reached. `bindingId`
     * is real — the binding exists on the visit — so "Nothing was recorded." is
     * false about every part of it.
     */
    captureRequirementEvidence.mockResolvedValue({
      status: 'denied' as const,
      attempt: 1,
      messageKey: 'state.denied.title',
      correlationId: 'corr-403',
      stage: 'bound' as const,
      documentId: 'doc-9',
      versionId: 'ver-9',
      bindingId: 'bind-9',
      versionStatus: 'accepted',
      scannerAvailable: true,
    });

    const user = userEvent.setup();
    renderLtr(<MediaStep {...stepProps()} />);
    const row = await requirementRow('vin');

    const input = within(row).getByLabelText(EN['receptions.capture.chooseFile']!);
    await user.upload(input, new File(['x'], 'vin.jpg', { type: 'image/jpeg' }));
    await user.click(within(row).getByRole('button', { name: EN['receptions.capture.submit']! }));

    const outcome = await screen.findByTestId('capture-outcome');
    await waitFor(() =>
      expect(outcome.textContent).toBe(EN['receptions.capture.boundNotCounted']!)
    );
    // The sentence that used to be printed, named so a regression fails as itself.
    expect(outcome.textContent, 'a bound capture is reported as nothing recorded').not.toBe(
      EN['receptions.capture.failed']!
    );
  });

  it('reports a WAIVER as a waiver, in both scripts', async () => {
    overrideCaptureRequirement.mockResolvedValue({
      status: 'success' as const,
      correlationId: 'corr-waiver',
      attempt: 1,
      recorded: { receptionVisitId: VISIT, overrideId: 'ovr-1', requirementCode: 'vin' },
    });

    const user = userEvent.setup();
    const ltr = renderLtr(<MediaStep {...stepProps()} />);
    const row = await requirementRow('vin');

    await user.click(within(row).getByTestId('capture-override-open-vin'));
    await user.type(
      within(row).getByLabelText(EN['receptions.capture.overrideReason']!),
      'The bay is flooded'
    );
    await user.click(
      within(row).getByRole('button', { name: EN['receptions.capture.overrideSubmit']! })
    );

    const outcome = await screen.findByTestId('capture-outcome');
    await waitFor(() =>
      expect(outcome.textContent).toBe(EN['receptions.capture.overrideRecorded']!)
    );
    /*
     * And explicitly NOT the capture vocabulary. A waiver is a statement that
     * no file will be taken, so every sentence about a file is wrong here —
     * checked against the whole ladder rather than against one member of it,
     * since the member this used to name has since been deleted for having no
     * producer, and a negative assertion against a missing key asserts nothing.
     */
    for (const key of [
      'receptions.capture.finalized',
      'receptions.capture.finalizedPartial',
      'receptions.capture.boundNoScanner',
      'receptions.capture.boundNotCounted',
      'receptions.capture.capturedNotBound',
      'receptions.capture.capturedStored',
      'receptions.capture.capturedTerminal',
      'receptions.capture.failed',
    ]) {
      expect(EN[key], key).toBeDefined();
      expect(outcome.textContent, key).not.toBe(EN[key]!);
    }
    ltr.unmount();

    // The Arabic half, because the defect was a wrong SENTENCE and a catalogue
    // that carried it in one script only would ship it in the other.
    const rtl = renderRtl(
      <MediaStep {...stepProps({ locale: 'ar', messages: ar as typeof en })} />
    );
    const arRow = await requirementRow('vin');
    await user.click(within(arRow).getByTestId('capture-override-open-vin'));
    await user.type(
      within(arRow).getByLabelText(AR['receptions.capture.overrideReason']!),
      'الساحة مغمورة'
    );
    await user.click(
      within(arRow).getByRole('button', { name: AR['receptions.capture.overrideSubmit']! })
    );
    const arOutcome = await screen.findByTestId('capture-outcome');
    await waitFor(() =>
      expect(arOutcome.textContent).toBe(AR['receptions.capture.overrideRecorded']!)
    );
    rtl.unmount();
  });

  it('reports a REFUSED waiver, and keeps the reason it is asking about', async () => {
    overrideCaptureRequirement.mockResolvedValue({
      status: 'denied' as const,
      attempt: 1,
      messageKey: 'state.denied.title',
      correlationId: 'corr-403',
    });

    const user = userEvent.setup();
    renderLtr(<MediaStep {...stepProps()} />);
    const row = await requirementRow('vin');

    await user.click(within(row).getByTestId('capture-override-open-vin'));
    const reason = within(row).getByLabelText(EN['receptions.capture.overrideReason']!);
    await user.type(reason, 'The bay is flooded');
    await user.click(
      within(row).getByRole('button', { name: EN['receptions.capture.overrideSubmit']! })
    );

    const outcome = await screen.findByTestId('capture-outcome');
    await waitFor(() => expect(outcome.textContent).toBe(EN['receptions.capture.overrideFailed']!));
    // Reporting the refusal must not cost the operator the text it is about:
    // the row is NOT re-read, so the form and its reason survive.
    expect(reason).toHaveValue('The bay is flooded');
    expect(readCaptureContract).toHaveBeenCalledTimes(1);
  });
});
describe('P1-28-FE-017 — an accepted binding that missed its finalization', () => {
  it('offers the finalization on that binding, and on no other', async () => {
    renderLtr(<MediaStep {...stepProps()} />);
    const rows = await rowsRendered();

    expect(
      within(rows.get('warning_lamp')!).getByTestId('capture-finalize-lamp-2')
    ).toHaveTextContent(EN['receptions.capture.finalize']!);

    /*
     * And nowhere else, which is the half that makes the control a statement
     * rather than a button. Every other binding in the contract is either not
     * accepted — `lamp-1` pending, `vin-2` pending, `vin-3` scanning, which the
     * guard would refuse — or already counted, which the RLS policy would.
     */
    for (const id of ['lamp-1', 'vin-1', 'vin-2', 'vin-3', 'ex-1', 'ex-2']) {
      expect(screen.queryByTestId(`capture-finalize-${id}`), id).toBeNull();
    }
  });

  it('counts it through the sanctioned action, then re-reads and says so', async () => {
    /*
     * The re-read answers what a re-read really would: `warning_lamp` asks for
     * one, and counting `lamp-2` is the one. Before this the fixture returned
     * the SAME contract afterwards — `finalizedCount: 0`, unsatisfied — and the
     * case still expected "this requirement is now met", which passed only
     * while the sentence was derived from the stage and ignored the server.
     */
    readCaptureContract.mockResolvedValueOnce(contractRead()).mockResolvedValue(
      contractRead({
        ...CONTRACT,
        requirements: CONTRACT.requirements.map((entry) =>
          entry.requirementCode === 'warning_lamp'
            ? { ...entry, finalizedCount: 1, satisfied: true }
            : entry
        ),
      })
    );
    const user = userEvent.setup();
    renderLtr(<MediaStep {...stepProps()} />);
    const row = (await rowsRendered()).get('warning_lamp')!;

    expect(readCaptureContract).toHaveBeenCalledTimes(1);
    await user.click(within(row).getByTestId('capture-finalize-lamp-2'));

    await waitFor(() => expect(finalizeCapturedEvidence).toHaveBeenCalled());
    // The visit and the BINDING — not the requirement, which the operation's
    // path does not carry and which could not identify one version of three.
    expect(finalizeCapturedEvidence.mock.calls.at(-1)).toEqual([VISIT, 'lamp-2']);

    // The count is the server's afterwards, exactly as it is after a capture:
    // this screen adds nothing locally, it asks again.
    await waitFor(() => expect(readCaptureContract.mock.calls.length).toBeGreaterThan(1));

    /*
     * And the sentence is the one a completed capture earns, because that is
     * what the visit now holds AND what the re-read reports about the
     * requirement. A version that has been accepted and counted must not be
     * described as still being checked, and a requirement the server calls
     * satisfied must not be described as needing more.
     */
    const outcome = await screen.findByTestId('capture-outcome');
    await waitFor(() => expect(outcome.textContent).toBe(EN['receptions.capture.finalized']!));
    expect(screen.queryByText(EN['receptions.capture.finalizedPartial']!)).toBeNull();
    expect(screen.queryByText(EN['receptions.capture.boundNoScanner']!)).toBeNull();
  });

  it('keeps the binding uncounted when the finalization is refused', async () => {
    /*
     * A refusal is not a count. The screen must not report the requirement
     * moved, and — since it re-reads rather than incrementing — the way to prove
     * that is that no re-read was even asked for and no outcome was claimed.
     */
    finalizeCapturedEvidence.mockResolvedValue({
      status: 'denied',
      attempt: 1,
      messageKey: 'state.denied.title',
      correlationId: 'corr-403',
    });
    const user = userEvent.setup();
    renderLtr(<MediaStep {...stepProps()} />);
    const row = (await rowsRendered()).get('warning_lamp')!;

    await user.click(within(row).getByTestId('capture-finalize-lamp-2'));

    await waitFor(() => expect(finalizeCapturedEvidence).toHaveBeenCalled());
    expect(screen.queryByTestId('capture-outcome')).toBeNull();
    expect(readCaptureContract).toHaveBeenCalledTimes(1);
    // The control stays, so the operator can try again rather than re-capture.
    expect(within(row).getByTestId('capture-finalize-lamp-2')).toBeInTheDocument();
  });

  it('costs the capture permission, and is withdrawn with it and on a locked visit', async () => {
    /*
     * `rec.reception-evidence-binding-finalize` is registered against
     * `rec.reception.evidence.manage` — the capture code, not the waiver's.
     * Declaring a photograph that was taken sufficient is the second half of
     * taking it, so an operator who may not capture may not count either, and
     * holding the WAIVER code alone buys nothing here.
     */
    const withoutManage = renderLtr(
      <MediaStep {...stepProps({ capabilities: { ...CAPABILITIES, manageEvidence: false } })} />
    );
    let rows = await rowsRendered();
    expect(within(rows.get('warning_lamp')!).queryByTestId('capture-finalize-lamp-2')).toBeNull();
    // …while the waiver code this operator does hold is still spending itself
    // on its own control, so the absence above is about the right permission.
    expect(
      within(rows.get('warning_lamp')!).getByTestId('capture-override-open-warning_lamp')
    ).toBeInTheDocument();
    withoutManage.unmount();

    const locked = renderLtr(<MediaStep {...stepProps({ writesLocked: true })} />);
    rows = await rowsRendered();
    expect(within(rows.get('warning_lamp')!).queryByTestId('capture-finalize-lamp-2')).toBeNull();
    // The record itself stays: a converted visit still reports what it holds.
    expect(within(rows.get('warning_lamp')!).getAllByRole('listitem')).toHaveLength(2);
    locked.unmount();

    // The positive control. Without it the three absences above are equally
    // true of a screen that never renders this control at all.
    renderLtr(<MediaStep {...stepProps()} />);
    rows = await rowsRendered();
    expect(
      within(rows.get('warning_lamp')!).getByTestId('capture-finalize-lamp-2')
    ).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ *
 * What the operator is told after a capture
 * ------------------------------------------------------------------ */

/**
 * Every outcome the chain can reach, and the sentence each one earns.
 *
 * This table used to hold FOUR rows and the guard beside it asserted four, so
 * the count agreed with itself and with nothing else. It spent one of the four
 * on `boundPending`, a state the chain provably cannot return, and had no row at
 * all for the `captured` stage — the only new state the live acceptance database
 * actually produced, and the one where a permanent scan refusal and a retryable
 * link failure printed the same provisional sentence.
 *
 * Each row is a REACHABLE combination, and the comment on each says how it is
 * reached, because a fixture nobody can trace back to the chain is a fixture
 * that can drift away from it silently.
 */
const OUTCOME_BRANCHES = [
  {
    name: 'a capture that recorded nothing',
    // `captureDocument` failed: no document, no version, nothing on the visit.
    outcome: { status: 'error', attempt: 1, messageKey: 'attachments.capture.storeUnavailable' },
    key: 'receptions.capture.failed',
  },
  {
    name: 'a file the scan refused',
    /*
     * TERMINAL. `registerVersionAndScan` scans synchronously and returns
     * `quarantined`; `rec.guard_reception_evidence_binding` admits only
     * `pending` and `accepted`, so the bind is refused and the chain stops at
     * `captured`. `shared.guard_document_version_transition` admits no way out
     * of a terminal status, so trying the same file again cannot help.
     */
    outcome: {
      status: 'error',
      attempt: 1,
      stage: 'captured',
      versionStatus: 'quarantined',
      scannerAvailable: true,
    },
    key: 'receptions.capture.capturedTerminal',
  },
  {
    name: 'a stored file the link call left unattached',
    // Stored, unchecked, unattached: the store could not be read, so the version
    // stayed `pending`, and the link or bind call then failed. Retryable.
    outcome: {
      status: 'unavailable',
      attempt: 1,
      stage: 'captured',
      versionStatus: 'pending',
      scannerAvailable: false,
    },
    key: 'receptions.capture.capturedStored',
  },
  {
    name: 'an accepted file the bind call left unattached',
    // Accepted and real, and the bind did not answer. The same file, again, works.
    outcome: {
      status: 'unavailable',
      attempt: 1,
      stage: 'captured',
      versionStatus: 'accepted',
      scannerAvailable: true,
    },
    key: 'receptions.capture.capturedNotBound',
  },
  {
    name: 'a bound version nothing in this environment can check',
    // The one way a bound version is not accepted: `pending`, from the branch
    // that reports `scannerAvailable: false`. It will never count here.
    outcome: {
      status: 'success',
      attempt: 1,
      stage: 'bound',
      versionStatus: 'pending',
      scannerAvailable: false,
    },
    key: 'receptions.capture.boundNoScanner',
  },
  {
    name: 'a bound, accepted version whose finalization did not answer',
    // The only outcome with a control the operator can press, named in its own
    // sentence: "Count this evidence" on the entry below.
    outcome: {
      status: 'denied',
      attempt: 1,
      stage: 'bound',
      versionStatus: 'accepted',
      scannerAvailable: true,
      bindingId: 'bind-1',
    },
    key: 'receptions.capture.boundNotCounted',
  },
] as const;

describe('P1-28-FE-017 — the outcome line', () => {
  it('has a distinct sentence for every reachable state, and they are distinct', () => {
    /*
     * Without this the cases below could all be asserting the same string, and a
     * step that printed one sentence for every outcome would pass every one of
     * them. A missing key is caught here too: it would arrive as `undefined`
     * through the non-null assertions the cases use.
     *
     * The two finalized sentences are asserted with them, since they are part of
     * the same ladder and are driven by their own cases below.
     */
    const sentences = [
      ...OUTCOME_BRANCHES.map((branch) => EN[branch.key]),
      EN['receptions.capture.finalized'],
      EN['receptions.capture.finalizedPartial'],
    ];
    expect(sentences.every((sentence) => typeof sentence === 'string' && sentence !== '')).toBe(
      true
    );
    expect(new Set(sentences).size).toBe(OUTCOME_BRANCHES.length + 2);
  });

  for (const branch of OUTCOME_BRANCHES) {
    it(`says what happened for ${branch.name}`, async () => {
      captureRequirementEvidence.mockResolvedValue(branch.outcome);
      const user = userEvent.setup();
      renderLtr(<MediaStep {...stepProps()} />);
      const row = (await rowsRendered()).get('damage')!;

      await user.click(within(row).getByRole('button', { name: EN['receptions.capture.submit']! }));

      const outcome = await screen.findByTestId('capture-outcome');
      await waitFor(() => expect(outcome.textContent).toBe(EN[branch.key]!));
      // …and only that one. Each sentence is the answer to a different question
      // an operator is about to ask, so two of them at once is no answer.
      for (const other of OUTCOME_BRANCHES) {
        if (other.key === branch.key) continue;
        expect(screen.queryByText(EN[other.key]!), other.key).toBeNull();
      }
    });
  }

  /*
   * The last rung is not the stage at all: it is whether the SERVER now
   * considers the requirement met. The chain cannot know that — finalizing the
   * second of seven photographs succeeds exactly as the seventh does — so it is
   * read from the contract the step re-reads afterwards.
   */
  const FINALIZED = {
    status: 'success',
    attempt: 1,
    stage: 'finalized',
    versionStatus: 'accepted',
    scannerAvailable: true,
  } as const;

  async function captureDamage() {
    const user = userEvent.setup();
    renderLtr(<MediaStep {...stepProps()} />);
    const row = (await rowsRendered()).get('damage')!;
    await user.click(within(row).getByRole('button', { name: EN['receptions.capture.submit']! }));
    await waitFor(() => expect(readCaptureContract.mock.calls.length).toBeGreaterThan(1));
  }

  it('says the requirement is MET when the re-read says so', async () => {
    captureRequirementEvidence.mockResolvedValue(FINALIZED);
    readCaptureContract.mockResolvedValueOnce(contractRead()).mockResolvedValue(
      contractRead({
        ...CONTRACT,
        requirements: CONTRACT.requirements.map((entry) =>
          entry.requirementCode === 'damage'
            ? { ...entry, finalizedCount: 1, recordedCount: 1, satisfied: true }
            : entry
        ),
      })
    );

    await captureDamage();
    const outcome = await screen.findByTestId('capture-outcome');
    await waitFor(() => expect(outcome.textContent).toBe(EN['receptions.capture.finalized']!));
  });

  it('says more is still needed when the re-read says the floor is not reached', async () => {
    /*
     * The ordinary case, not the edge one: `exterior` asks for seven, so
     * photographs one to six of every visit land here. Telling an operator "this
     * requirement is now met" after the second of seven is the same class of
     * false statement the rest of this file exists to remove.
     */
    captureRequirementEvidence.mockResolvedValue(FINALIZED);
    readCaptureContract.mockResolvedValueOnce(contractRead()).mockResolvedValue(
      contractRead({
        ...CONTRACT,
        requirements: CONTRACT.requirements.map((entry) =>
          entry.requirementCode === 'damage'
            ? { ...entry, minCount: 4, finalizedCount: 1, recordedCount: 1, satisfied: false }
            : entry
        ),
      })
    );

    await captureDamage();
    const outcome = await screen.findByTestId('capture-outcome');
    await waitFor(() =>
      expect(outcome.textContent).toBe(EN['receptions.capture.finalizedPartial']!)
    );
  });
});

/* ------------------------------------------------------------------ *
 * The waiver — a different authority, stated as one
 * ------------------------------------------------------------------ */

describe('P1-28-FE-017 — the override is a separate permission', () => {
  it('offers the waiver control to an operator who holds the code', async () => {
    renderLtr(<MediaStep {...stepProps()} />);
    const rows = await rowsRendered();

    for (const code of ['vin', 'damage'] as const) {
      expect(
        within(rows.get(code)!).getByTestId(`capture-override-open-${code}`)
      ).toHaveTextContent(EN['receptions.capture.overrideOpen']!);
      expect(within(rows.get(code)!).queryByTestId(`capture-override-withheld-${code}`)).toBeNull();
    }

    // A satisfied requirement is offered no waiver either way: there is nothing
    // left to waive, and the control's absence there is not about permission.
    expect(
      within(rows.get('exterior')!).queryByTestId('capture-override-open-exterior')
    ).toBeNull();
    expect(
      within(rows.get('exterior')!).queryByTestId('capture-override-withheld-exterior')
    ).toBeNull();
  });

  it('withdraws it, with the reason stated, without rec.reception.evidence.override', async () => {
    /*
     * `manageEvidence` stays TRUE here. That is the whole separation: an
     * operator who may photograph a vehicle must not thereby be able to record
     * that no photograph was needed, so the capture forms below are still
     * offered while the waiver is not.
     */
    renderLtr(
      <MediaStep {...stepProps({ capabilities: { ...CAPABILITIES, overrideEvidence: false } })} />
    );
    const rows = await rowsRendered();

    for (const code of ['vin', 'damage'] as const) {
      expect(
        within(rows.get(code)!).getByTestId(`capture-override-withheld-${code}`)
      ).toHaveTextContent(EN['receptions.capture.overrideWithheld']!);
      expect(within(rows.get(code)!).queryByTestId(`capture-override-open-${code}`)).toBeNull();
    }
    // Withdrawn, not greyed out — there is no disabled waiver control anywhere.
    expect(
      screen.queryByRole('button', { name: EN['receptions.capture.overrideOpen']! })
    ).toBeNull();
    // …and the capture forms the other permission pays for are untouched.
    expect(
      within(rows.get('damage')!).getByLabelText(EN['receptions.capture.chooseFile']!)
    ).toBeInTheDocument();
  });

  it('sends the typed reason through overrideCaptureRequirement', async () => {
    overrideCaptureRequirement.mockResolvedValue(waiverRecorded('damage'));
    const user = userEvent.setup();
    renderLtr(<MediaStep {...stepProps()} />);
    const row = (await rowsRendered()).get('damage')!;

    await user.click(within(row).getByTestId('capture-override-open-damage'));

    const reason = within(row).getByLabelText(new RegExp(EN['receptions.capture.overrideReason']!));
    // The column's own ceiling, mirrored on the control rather than discovered
    // as a 422 after the operator has typed six hundred characters.
    expect(reason).toHaveAttribute('maxlength', String(MAX_OVERRIDE_REASON));

    const submit = within(row).getByRole('button', {
      name: EN['receptions.capture.overrideSubmit']!,
    });
    // An unattributed waiver is indistinguishable afterwards from a requirement
    // nobody noticed, so a blank reason cannot be submitted at all.
    expect(submit).toBeDisabled();

    await user.type(reason, '  The panel is behind a locked gate  ');
    await user.click(submit);

    await waitFor(() => expect(overrideCaptureRequirement).toHaveBeenCalled());
    const [visitId, input] = overrideCaptureRequirement.mock.calls.at(-1)!;
    expect(visitId).toBe(VISIT);
    expect(input).toEqual({
      requirementCode: 'damage',
      reason: '  The panel is behind a locked gate  ',
    });

    // The form closes on success and the contract is re-read, so the waiver the
    // server now holds is what the row reports.
    await waitFor(() =>
      expect(
        within(row).queryByLabelText(new RegExp(EN['receptions.capture.overrideReason']!))
      ).toBeNull()
    );
    await waitFor(() => expect(readCaptureContract.mock.calls.length).toBeGreaterThan(1));
  });

  it('keeps the typed reason on screen when the waiver is refused', async () => {
    /*
     * A refusal that cleared the box would cost the operator their sentence and
     * teach them to write a shorter one. The form stays open, holding what they
     * wrote, so the retry is a click rather than a re-typing.
     */
    overrideCaptureRequirement.mockResolvedValue({
      status: 'denied',
      attempt: 1,
      messageKey: 'state.denied.title',
      correlationId: 'corr-403',
    });
    const user = userEvent.setup();
    renderLtr(<MediaStep {...stepProps()} />);
    const row = (await rowsRendered()).get('damage')!;

    await user.click(within(row).getByTestId('capture-override-open-damage'));
    const reason = within(row).getByLabelText(new RegExp(EN['receptions.capture.overrideReason']!));
    await user.type(reason, 'The bay is flooded');
    await user.click(
      within(row).getByRole('button', { name: EN['receptions.capture.overrideSubmit']! })
    );

    await waitFor(() => expect(overrideCaptureRequirement).toHaveBeenCalled());
    expect(reason).toHaveValue('The bay is flooded');
    expect(reason).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ *
 * A terminal visit, and the permission that pays for capture
 * ------------------------------------------------------------------ */

describe('P1-28-FE-017 — when writes are gone, the facts stay', () => {
  it('withdraws every capture form on a locked visit and still reports what is held', async () => {
    const { container } = renderLtr(<MediaStep {...stepProps({ writesLocked: true })} />);
    const rows = await rowsRendered();

    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: EN['receptions.capture.submit']! })).toBeNull();
    expect(
      screen.queryByRole('button', { name: EN['receptions.capture.overrideOpen']! })
    ).toBeNull();

    // The record itself is not withdrawn: a converted visit is read by people
    // who need to know what it was evidenced with.
    expect(within(rows.get('vin')!).getByTestId('capture-count-vin').textContent).toBe('1/2');
    expect(within(rows.get('ev_soc')!).getByTestId('capture-override-ev_soc')).toHaveTextContent(
      WAIVER.reason
    );
  });

  it('withdraws the capture form without rec.reception.evidence.manage', async () => {
    const { container } = renderLtr(
      <MediaStep {...stepProps({ capabilities: { ...CAPABILITIES, manageEvidence: false } })} />
    );
    const rows = await rowsRendered();

    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(0);
    // The waiver rides on the OTHER code, which this operator still holds, so it
    // is still offered — the two permissions are not a single "may write" flag.
    expect(
      within(rows.get('damage')!).getByTestId('capture-override-open-damage')
    ).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ *
 * Arabic
 * ------------------------------------------------------------------ */

/**
 * Arabic script, matched WITHOUT `\b`.
 *
 * `\b` in JavaScript is defined over ASCII word characters, so a boundary placed
 * next to an Arabic letter can never match and a pattern carrying one silently
 * matches nothing at all — a matcher that always passes because it never fires.
 *
 * This one carries no boundary. It is the Unicode script property, which names
 * the script rather than a code-point range copied by hand, and the case below
 * runs it in BOTH directions: it must accept the Arabic sentence and refuse the
 * English one, so a matcher incapable of firing cannot pass as a proof that the
 * Arabic catalogue was the one that rendered.
 */
const ARABIC_SCRIPT = /\p{Script=Arabic}/u;

describe('P1-28-FE-017 — Arabic', () => {
  it('renders right to left, in real Arabic copy, with the count still left to right', async () => {
    renderRtl(<MediaStep {...stepProps({ locale: 'ar', messages: ar as typeof en })} />);
    const rows = await rowsRendered();

    expect(document.documentElement.dir).toBe('rtl');

    // The matcher, proved capable of both answers before anything rests on it.
    expect(ARABIC_SCRIPT.test(AR['receptions.capture.state.outstanding']!)).toBe(true);
    expect(ARABIC_SCRIPT.test(EN['receptions.capture.state.outstanding']!)).toBe(false);

    const state = within(rows.get('damage')!).getByTestId('capture-state-damage');
    expect(state.textContent).toBe(AR['receptions.capture.state.outstanding']);
    expect(ARABIC_SCRIPT.test(state.textContent ?? '')).toBe(true);

    expect(
      within(rows.get('vin')!).getByText(AR['receptions.capture.requirement.vin']!)
    ).toBeInTheDocument();
    // The one approved input carries the translated name too — it is labelled by
    // `aria-label`, which has no visible text to fall back on.
    expect(
      within(rows.get('vin')!).getByLabelText(AR['receptions.capture.chooseFile']!)
    ).toBeInTheDocument();

    /*
     * `1/2` is a pair of numerals with a solidus between them and it means
     * "one of two" in both languages. Left to the paragraph direction it renders
     * as `2/1`, which is a different claim about how much of this requirement is
     * evidenced.
     */
    expect(within(rows.get('vin')!).getByTestId('capture-count-vin')).toHaveAttribute('dir', 'ltr');
  });

  it('states the waiver control and its withholding in Arabic', async () => {
    const withheld = renderRtl(
      <MediaStep
        {...stepProps({
          locale: 'ar',
          messages: ar as typeof en,
          capabilities: { ...CAPABILITIES, overrideEvidence: false },
        })}
      />
    );
    let rows = await rowsRendered();
    expect(
      within(rows.get('damage')!).getByTestId('capture-override-withheld-damage').textContent
    ).toBe(AR['receptions.capture.overrideWithheld']);
    withheld.unmount();

    renderRtl(<MediaStep {...stepProps({ locale: 'ar', messages: ar as typeof en })} />);
    rows = await rowsRendered();
    expect(
      within(rows.get('damage')!).getByTestId('capture-override-open-damage').textContent
    ).toBe(AR['receptions.capture.overrideOpen']);
  });
});
