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
vi.mock('@/features/receptions/evidence-capture', () => ({
  captureRequirementEvidence: (...args: unknown[]) => captureRequirementEvidence(...args),
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
 * FOUR requirements for four states, one each.
 *
 * A branch resolved to the same value twice cannot be told apart by a case that
 * only asserts each row's own copy — the wrong-state row would be masked by a
 * sibling that happens to be right — so each state is published exactly once and
 * the four rendered sentences are then asserted distinct.
 *
 * `ev_soc` is deliberately BOTH `satisfied` and `overridden`, which is what
 * `rec.reception-evidence-binding-list` answers for a waived requirement, since
 * an override is one of the two ways a requirement is satisfied. It is the only
 * fixture that can prove the precedence: a screen that read `satisfied` first
 * would print "Met." over a requirement nobody evidenced.
 */
const PUBLISHED: readonly CaptureRequirement[] = ['exterior', 'vin', 'damage', 'ev_soc'];

const CONTRACT: CaptureContract = {
  receptionVisitId: VISIT,
  requirements: [
    requirement('exterior', { minCount: 2, finalizedCount: 2, recordedCount: 2, satisfied: true }),
    // Three files bound, one accepted: the case the whole "finalized only" rule
    // exists for.
    requirement('vin', { minCount: 2, finalizedCount: 1, recordedCount: 3 }),
    requirement('damage'),
    requirement('ev_soc', { satisfied: true, overridden: true }),
  ],
  bindings: [
    binding('ex-1', 'exterior', 'accepted', '2026-08-13T08:05:00.000Z'),
    binding('ex-2', 'exterior', 'accepted', '2026-08-13T08:06:00.000Z'),
    binding('vin-1', 'vin', 'accepted', '2026-08-13T08:07:00.000Z'),
    binding('vin-2', 'vin', 'pending', null),
    binding('vin-3', 'vin', 'scanning', null),
  ],
  overrides: [WAIVER],
  bindableTemplates: [],
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
      2
    );
    for (const code of unpublished) {
      expect(screen.queryByTestId(`capture-${code}`), code).toBeNull();
    }
  });

  it('chooses a different state for each of the four, and the four are distinct', async () => {
    renderLtr(<MediaStep {...stepProps()} />);
    const rows = await rowsRendered();

    const expected: Record<string, string> = {
      exterior: EN['receptions.capture.state.satisfied']!,
      // Bound, not accepted. The count says `1/2` and this says why.
      vin: EN['receptions.capture.state.recordedNotCounted']!,
      damage: EN['receptions.capture.state.outstanding']!,
      ev_soc: EN['receptions.capture.state.overridden']!,
    };

    for (const code of PUBLISHED) {
      const state = within(rows.get(code)!).getByTestId(`capture-state-${code}`);
      expect(state.textContent, code).toBe(expected[code]);
    }

    // Four rows saying four things. A catalogue in which two of these sentences
    // were identical would make the four assertions above pass over three
    // states, so the distinctness is asserted rather than assumed.
    expect(new Set(Object.values(expected)).size).toBe(4);
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
     * Three forms, not four: a requirement whose waiver stands is not offered a
     * capture control, because recording evidence against a waived requirement
     * is not a thing the operator was asked for. `exterior` IS offered one
     * despite being satisfied — a second exterior photograph is always legal.
     */
    const inputs = container.querySelectorAll('input[type="file"]');
    expect(inputs.length, 'the step offered no capture control at all').toBe(3);
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
 * What the operator is told after a capture
 * ------------------------------------------------------------------ */

/**
 * The four outcomes, and the sentence each one earns.
 *
 * Three of them are a SUCCESS that did not satisfy the requirement, and the
 * distinction between them is the whole point: "the scan has not concluded" and
 * "nothing in this environment can scan it" are different facts about whether
 * waiting will help, and neither is an error.
 */
const OUTCOME_BRANCHES = [
  {
    name: 'a finalized capture',
    outcome: { status: 'success', attempt: 1, stage: 'finalized', scannerAvailable: true },
    key: 'receptions.capture.finalized',
  },
  {
    name: 'a bound version still being checked',
    outcome: { status: 'success', attempt: 1, stage: 'bound', scannerAvailable: true },
    key: 'receptions.capture.boundPending',
  },
  {
    name: 'a bound version nothing can check here',
    outcome: { status: 'success', attempt: 1, stage: 'bound', scannerAvailable: false },
    key: 'receptions.capture.boundNoScanner',
  },
  {
    name: 'a capture that recorded nothing',
    outcome: { status: 'error', attempt: 1, messageKey: 'attachments.capture.storeUnavailable' },
    key: 'receptions.capture.failed',
  },
] as const;

describe('P1-28-FE-017 — the outcome line', () => {
  it('has four sentences to choose between, and they are four', () => {
    // Without this the four cases below could all be asserting the same string,
    // and a step that printed one sentence for every outcome would pass every one
    // of them. A missing key is caught here too: it would arrive as `undefined`
    // through the non-null assertions the cases below use.
    const sentences = OUTCOME_BRANCHES.map((branch) => EN[branch.key]);
    expect(sentences.every((sentence) => typeof sentence === 'string' && sentence !== '')).toBe(
      true
    );
    expect(new Set(sentences).size).toBe(4);
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
