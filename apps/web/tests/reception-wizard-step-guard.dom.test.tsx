import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { inBranch, renderLtr, renderRtl } from './render';
import type {
  CheckInStepDefinition,
  CheckInStepProps,
} from '@/features/receptions/check-in/wizard';
import type {
  CaptureContract,
  ReceptionDetail,
  SignatureEntry,
} from '@/features/receptions/receptions-contract';
import { useUnsavedGuard, useUnsavedWork } from '@/features/working-context/WorkingContextProvider';

/**
 * The check-in wizard asks before a step change throws typed work away
 * (Owner decision of 2026-10-03, README question 19).
 *
 * Only the open step is mounted, so a step change unmounts it. These cases
 * drive the shell through every way the step changes — a numbered button, and
 * a step sending the operator on through `goToStep` — with work declared
 * through the same `useUnsavedGuard` every capture form uses, and once with
 * the real complaint form, the one the browser checkpoint lost words from,
 * the media step's waiver reason and the signature step's repudiation reason.
 *
 * A CHOSEN file is unsaved work too (the review of #508): the media capture
 * form and the signature capture form both declare a file picked and not yet
 * sent, so a step change, a confirmed discard and leaving the page treat it
 * exactly like typed words.
 *
 * The review of #511 added three more: a file chosen on one requirement row
 * survives another row's waiver re-reading the contract, and a send clears the
 * declaration (media and signature), so nothing is asked about once the file
 * has been handed over.
 *
 * Fix round 2 of #511 added two: while the contract re-reads, every row's
 * waiver (open and submit) is held back, and a re-read that FAILS keeps the
 * rows and the file chosen on another row, with the failure shown above them.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const readReception = vi.fn();
const recordConditionEvidence = vi.fn();
const listConditionEvidence = vi.fn();
const readCaptureContract = vi.fn();
const overrideCaptureRequirement = vi.fn();
const listPartyRoles = vi.fn();
const readSignatures = vi.fn();
const recordSignatureEvent = vi.fn();
vi.mock('@/features/receptions/api', () => ({
  listPartyRoles: (...args: unknown[]) => listPartyRoles(...args),
  readSignatures: (...args: unknown[]) => readSignatures(...args),
  recordSignatureEvent: (...args: unknown[]) => recordSignatureEvent(...args),
  readReception: (...args: unknown[]) => readReception(...args),
  recordConditionEvidence: (...args: unknown[]) => recordConditionEvidence(...args),
  listConditionEvidence: (...args: unknown[]) => listConditionEvidence(...args),
  readCaptureContract: (...args: unknown[]) => readCaptureContract(...args),
  overrideCaptureRequirement: (...args: unknown[]) => overrideCaptureRequirement(...args),
}));
// The media step's capture action and the identity read its panels import.
const captureRequirementEvidence = vi.fn();
vi.mock('@/features/receptions/evidence-capture', () => ({
  captureRequirementEvidence: (...args: unknown[]) => captureRequirementEvidence(...args),
  finalizeCapturedEvidence: vi.fn(),
}));
// The signature step's capture action.
const captureSignatureEvidence = vi.fn();
vi.mock('@/features/receptions/signature-capture', () => ({
  captureSignatureEvidence: (...args: unknown[]) => captureSignatureEvidence(...args),
}));
vi.mock('@/features/receptions/support-api', () => ({
  readUserIdentity: vi.fn(),
}));
const searchCustomerDirectory = vi.fn();
vi.mock('@/lib/customers/directory-read', () => ({
  searchCustomerDirectoryCancellable: (...args: unknown[]) => searchCustomerDirectory(...args),
}));

const { CheckInWizardShell } = await import('@/features/receptions/components/CheckInWizardShell');
const { ComplaintsStep } = await import('@/features/receptions/components/steps/ComplaintsStep');
const { MediaStep } = await import('@/features/receptions/components/steps/MediaStep');
const { SignatureStep } = await import('@/features/receptions/components/steps/SignatureStep');

/** A signature already made final on an accepted version, so it may be repudiated. */
const FINALIZED: SignatureEntry = {
  id: 'sig-1',
  signerRole: 'vehicle_owner',
  signerPartnerId: 'partner-1',
  captureMethod: 'uploaded',
  purpose: 'custody_acceptance',
  documentId: 'doc-1',
  documentVersionId: 'ver-1',
  documentVersionStatus: 'accepted',
  integritySha256: null,
  signedAt: '2026-08-13T08:15:00.000Z',
  actorId: 'user-1',
  replacesSignatureId: null,
  replacedBySignatureId: null,
  finalizedAt: '2026-08-13T08:20:00.000Z',
  repudiatedAt: null,
  repudiationReason: null,
  status: 'finalized',
};

/** One requirement nothing has evidenced yet, so its waiver form is offered. */
const UNMET_VIN: CaptureContract = {
  receptionVisitId: 'rv-1',
  requirements: [
    {
      requirementCode: 'vin',
      minCount: 1,
      deviceCapturedAtRequired: false,
      source: 'baseline',
      finalizedCount: 0,
      recordedCount: 0,
      satisfied: false,
      overridden: false,
    },
  ],
  bindings: [],
  overrides: [],
  bindableTemplates: [],
  retiredPublishedTemplateCount: 0,
};

/** Two unmet requirements, so a file chosen on one can outlive the other's waiver. */
const UNMET_VIN_AND_DAMAGE: CaptureContract = {
  ...UNMET_VIN,
  requirements: [
    UNMET_VIN.requirements[0]!,
    { ...UNMET_VIN.requirements[0]!, requirementCode: 'damage' },
  ],
};

/** The same visit once the damage requirement has been waived. */
const DAMAGE_WAIVED: CaptureContract = {
  ...UNMET_VIN_AND_DAMAGE,
  requirements: [
    UNMET_VIN.requirements[0]!,
    {
      ...UNMET_VIN.requirements[0]!,
      requirementCode: 'damage',
      satisfied: true,
      overridden: true,
    },
  ],
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
  readCustomers: false,
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

/** A step holding one typed note, declared as unsaved work the way every form declares it. */
function NoteStep({ goToStep }: CheckInStepProps) {
  const [note, setNote] = useState('');
  useUnsavedGuard(note !== '', () => setNote(''));
  return (
    <div>
      <label>
        typed note
        <input value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <button type="button" onClick={() => goToStep('second')}>
        send me to the second step
      </button>
    </div>
  );
}

function SecondStep() {
  return <p>second step body</p>;
}

const STEPS: readonly CheckInStepDefinition[] = [
  {
    id: 'first',
    titleKey: 'receptions.steps.complaints.title',
    descriptionKey: 'receptions.steps.complaints.description',
    Component: NoteStep,
  },
  {
    id: 'second',
    titleKey: 'receptions.steps.readings.title',
    descriptionKey: 'receptions.steps.readings.description',
    Component: SecondStep,
  },
];

function renderShell(
  steps: readonly CheckInStepDefinition[] = STEPS,
  locale: 'en' | 'ar' = 'en',
  beside: ReactNode = null
) {
  const render = locale === 'en' ? renderLtr : renderRtl;
  return render(
    inBranch(
      <>
        <CheckInWizardShell
          locale={locale}
          messages={locale === 'en' ? en : ar}
          initialDetail={DETAIL}
          steps={steps}
          capabilities={CAPABILITIES}
          session={{ userId: 'user-1', displayName: 'Front Desk' }}
        />
        {beside}
      </>,
      { locale }
    )
  );
}

/**
 * The provider's own discard, pressed directly: what a confirmed branch switch
 * or page leave does to every dirty declaration, without leaving the step.
 */
function DiscardEverything() {
  const work = useUnsavedWork();
  return (
    <button type="button" onClick={() => work.discard()}>
      discard every declaration
    </button>
  );
}

/** Whether the browser would be told to ask before this page is left, now. */
function leavingIsQuestioned(): boolean {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

const MEDIA_STEP: CheckInStepDefinition = {
  id: 'media-and-photographs',
  titleKey: 'receptions.steps.media.title',
  descriptionKey: 'receptions.steps.media.description',
  Component: MediaStep,
};

const SIGNATURE_STEP: CheckInStepDefinition = {
  id: 'signature',
  titleKey: 'receptions.steps.signature.title',
  descriptionKey: 'receptions.steps.signature.description',
  Component: SignatureStep,
};

const photo = () => new File([new Uint8Array([1, 2, 3])], 'vin-plate.jpg', { type: 'image/jpeg' });

/*
 * `CaptureFileField` reads no bytes and makes no preview, so a chosen file has
 * no object URL to release. These cases install the two functions jsdom lacks
 * and hold the screen to that: a preview added later without its release would
 * fail here first.
 */
const createObjectURL = vi.fn(() => 'blob:preview');
const revokeObjectURL = vi.fn();
beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
});
afterEach(() => {
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
});

function mockSignatureReads() {
  listPartyRoles.mockResolvedValue({
    status: 'ok',
    rows: [],
    nextCursor: null,
    hasMore: false,
    correlationId: 'corr-parties',
  });
  readSignatures.mockResolvedValue({
    status: 'ok',
    data: { receptionVisitId: 'rv-1', signatures: [] },
    correlationId: 'corr-sig',
  });
}

const stepButton = (index: number, titleKey: string, catalogue = EN) =>
  screen.getByRole('button', { name: `${index}. ${catalogue[titleKey]}` });

beforeEach(() => {
  vi.clearAllMocks();
  listConditionEvidence.mockResolvedValue({
    status: 'ok',
    rows: [],
    nextCursor: null,
    hasMore: false,
    correlationId: 'corr-page',
  });
});

describe('the check-in wizard asks before a step change discards typed work', () => {
  it('moves at once when the open step holds nothing unsaved', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(stepButton(2, 'receptions.steps.readings.title'));

    expect(screen.getByText('second step body')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(stepButton(2, 'receptions.steps.readings.title')).toHaveAttribute(
      'aria-current',
      'step'
    );
  });

  it('asks first, and "Stay on this step" keeps the input, the step and the cursor', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.type(screen.getByLabelText('typed note'), 'Front left tyre');

    const target = stepButton(2, 'receptions.steps.readings.title');
    await user.click(target);

    const dialog = screen.getByRole('alertdialog', {
      name: EN['receptions.wizard.discard.title']!,
    });
    expect(dialog).toHaveAccessibleDescription(EN['receptions.wizard.discard.description']!);
    // Nothing moved behind the question.
    expect(screen.queryByText('second step body')).not.toBeInTheDocument();

    await user.click(
      within(dialog).getByRole('button', { name: EN['receptions.wizard.discard.stay']! })
    );

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('typed note')).toHaveValue('Front left tyre');
    expect(stepButton(1, 'receptions.steps.complaints.title')).toHaveAttribute(
      'aria-current',
      'step'
    );
    await waitFor(() => expect(target).toHaveFocus());
  });

  it('Escape is the same "stay" answer, by the keyboard', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.type(screen.getByLabelText('typed note'), 'Wipers');
    stepButton(2, 'receptions.steps.readings.title').focus();
    await user.keyboard('{Enter}');

    const dialog = screen.getByRole('alertdialog');
    // Cancel, never the destructive answer, holds the cursor when it opens.
    expect(
      within(dialog).getByRole('button', { name: EN['receptions.wizard.discard.stay']! })
    ).toHaveFocus();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('typed note')).toHaveValue('Wipers');
  });

  it('"Discard and change step" moves, and the step comes back empty without asking again', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.type(screen.getByLabelText('typed note'), 'Scratch on bumper');

    await user.click(stepButton(2, 'receptions.steps.readings.title'));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: EN['receptions.wizard.discard.confirm']!,
      })
    );

    expect(screen.getByText('second step body')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    await user.click(stepButton(1, 'receptions.steps.complaints.title'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('typed note')).toHaveValue('');
  });

  it('guards a step that sends the operator on (goToStep) the same way', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.type(screen.getByLabelText('typed note'), 'Seat cover');

    await user.click(screen.getByRole('button', { name: 'send me to the second step' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.queryByText('second step body')).not.toBeInTheDocument();
  });

  it('asks nothing when the operator chooses the step already open', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.type(screen.getByLabelText('typed note'), 'Mirror');

    await user.click(stepButton(1, 'receptions.steps.complaints.title'));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('typed note')).toHaveValue('Mirror');
  });

  it('keeps the words typed into the real complaint form until the operator agrees to lose them', async () => {
    const user = userEvent.setup();
    renderShell([
      {
        id: 'condition-complaints',
        titleKey: 'receptions.steps.complaints.title',
        descriptionKey: 'receptions.steps.complaints.description',
        Component: ComplaintsStep,
      },
      STEPS[1]!,
    ]);
    const words = screen.getByLabelText(new RegExp(EN['receptions.complaint.text']!));
    await user.type(words, 'Grinding when braking');

    await user.click(stepButton(2, 'receptions.steps.readings.title'));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: EN['receptions.wizard.discard.stay']!,
      })
    );

    expect(screen.getByLabelText(new RegExp(EN['receptions.complaint.text']!))).toHaveValue(
      'Grinding when braking'
    );
    expect(recordConditionEvidence).not.toHaveBeenCalled();
  });

  it('treats a typed waiver reason in the media step as unsaved work', async () => {
    readCaptureContract.mockResolvedValue({
      status: 'ok',
      data: UNMET_VIN,
      correlationId: 'corr-capture',
    });
    const user = userEvent.setup();
    renderShell([
      {
        id: 'media-and-photographs',
        titleKey: 'receptions.steps.media.title',
        descriptionKey: 'receptions.steps.media.description',
        Component: MediaStep,
      },
      STEPS[1]!,
    ]);

    await user.click(await screen.findByTestId('capture-override-open-vin'));
    // An opened, empty waiver form holds nothing to lose.
    await user.click(stepButton(2, 'receptions.steps.readings.title'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await user.click(stepButton(1, 'receptions.steps.media.title'));

    await user.click(await screen.findByTestId('capture-override-open-vin'));
    await user.type(
      screen.getByRole('textbox', { name: EN['receptions.capture.overrideReason']! }),
      'The bay is flooded'
    );
    await user.click(stepButton(2, 'receptions.steps.readings.title'));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: EN['receptions.wizard.discard.stay']!,
      })
    );
    expect(
      screen.getByRole('textbox', { name: EN['receptions.capture.overrideReason']! })
    ).toHaveValue('The bay is flooded');
    expect(overrideCaptureRequirement).not.toHaveBeenCalled();
  });

  it('treats a typed repudiation reason in the signature step as unsaved work', async () => {
    listPartyRoles.mockResolvedValue({
      status: 'ok',
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: 'corr-parties',
    });
    readSignatures.mockResolvedValue({
      status: 'ok',
      data: { receptionVisitId: 'rv-1', signatures: [FINALIZED] },
      correlationId: 'corr-sig',
    });
    const user = userEvent.setup();
    renderShell([
      {
        id: 'signature',
        titleKey: 'receptions.steps.signature.title',
        descriptionKey: 'receptions.steps.signature.description',
        Component: SignatureStep,
      },
      STEPS[1]!,
    ]);
    const reasonBox = () =>
      screen.getByRole('textbox', { name: EN['receptions.signature.repudiateReason']! });

    await user.click(await screen.findByTestId('signature-repudiate-open-sig-1'));
    // An opened, empty repudiation form holds nothing to lose.
    await user.click(stepButton(2, 'receptions.steps.readings.title'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await user.click(stepButton(1, 'receptions.steps.signature.title'));

    await user.click(await screen.findByTestId('signature-repudiate-open-sig-1'));
    await user.type(reasonBox(), 'Signed by the wrong party');
    await user.click(stepButton(2, 'receptions.steps.readings.title'));

    // Stay keeps the reason, the step and the open form.
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: EN['receptions.wizard.discard.stay']!,
      })
    );
    expect(screen.queryByText('second step body')).not.toBeInTheDocument();
    expect(reasonBox()).toHaveValue('Signed by the wrong party');

    // Discard moves on, and the step comes back with the form closed and empty.
    await user.click(stepButton(2, 'receptions.steps.readings.title'));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: EN['receptions.wizard.discard.confirm']!,
      })
    );
    expect(screen.getByText('second step body')).toBeInTheDocument();
    await user.click(stepButton(1, 'receptions.steps.signature.title'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await user.click(await screen.findByTestId('signature-repudiate-open-sig-1'));
    expect(reasonBox()).toHaveValue('');
    expect(recordSignatureEvent).not.toHaveBeenCalled();
  });

  it('treats a chosen media file as unsaved work: Stay keeps it, Discard clears it', async () => {
    readCaptureContract.mockResolvedValue({
      status: 'ok',
      data: UNMET_VIN,
      correlationId: 'corr-capture',
    });
    const user = userEvent.setup();
    renderShell([MEDIA_STEP, STEPS[1]!], 'en', <DiscardEverything />);
    const fileControl = () =>
      screen.getByLabelText<HTMLInputElement>(EN['receptions.capture.chooseFile']!);

    await user.upload(await waitFor(fileControl), photo());
    expect(fileControl().files).toHaveLength(1);
    // Leaving the page asks too.
    expect(leavingIsQuestioned()).toBe(true);

    await user.click(stepButton(2, 'receptions.steps.readings.title'));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: EN['receptions.wizard.discard.stay']!,
      })
    );
    // Stay keeps the step and the chosen file.
    expect(screen.queryByText('second step body')).not.toBeInTheDocument();
    expect(fileControl().files).toHaveLength(1);
    expect(fileControl().files?.[0]?.name).toBe('vin-plate.jpg');

    // A confirmed discard empties the control where it stands.
    await user.click(screen.getByRole('button', { name: 'discard every declaration' }));
    expect(fileControl()).toHaveValue('');
    expect(fileControl().files ?? []).toHaveLength(0);
    expect(leavingIsQuestioned()).toBe(false);
    await user.click(stepButton(2, 'receptions.steps.readings.title'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText('second step body')).toBeInTheDocument();

    // Discard from the step question moves on, and the step comes back empty.
    await user.click(stepButton(1, 'receptions.steps.media.title'));
    await user.upload(await waitFor(fileControl), photo());
    await user.click(stepButton(2, 'receptions.steps.readings.title'));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: EN['receptions.wizard.discard.confirm']!,
      })
    );
    expect(screen.getByText('second step body')).toBeInTheDocument();
    await user.click(stepButton(1, 'receptions.steps.media.title'));
    expect(await waitFor(fileControl)).toHaveValue('');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('treats a chosen signature file as unsaved work: Stay keeps it, Discard clears it', async () => {
    mockSignatureReads();
    const user = userEvent.setup();
    renderShell([SIGNATURE_STEP, STEPS[1]!], 'en', <DiscardEverything />);
    const fileControl = () =>
      screen.getByLabelText<HTMLInputElement>(EN['receptions.signature.chooseFile']!);

    // Nothing chosen and nothing selected: nothing to ask about.
    await waitFor(fileControl);
    expect(leavingIsQuestioned()).toBe(false);

    await user.upload(fileControl(), photo());
    expect(leavingIsQuestioned()).toBe(true);
    await user.click(stepButton(2, 'receptions.steps.readings.title'));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: EN['receptions.wizard.discard.stay']!,
      })
    );
    expect(screen.queryByText('second step body')).not.toBeInTheDocument();
    expect(fileControl().files).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'discard every declaration' }));
    expect(fileControl()).toHaveValue('');
    expect(fileControl().files ?? []).toHaveLength(0);
    expect(leavingIsQuestioned()).toBe(false);
    await user.click(stepButton(2, 'receptions.steps.readings.title'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText('second step body')).toBeInTheDocument();

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('closes the waiver form empty on Cancel, so reopening it shows no old reason', async () => {
    readCaptureContract.mockResolvedValue({
      status: 'ok',
      data: UNMET_VIN,
      correlationId: 'corr-capture',
    });
    const user = userEvent.setup();
    renderShell([MEDIA_STEP, STEPS[1]!]);
    const reasonBox = () =>
      screen.getByRole('textbox', { name: EN['receptions.capture.overrideReason']! });

    await user.click(await screen.findByTestId('capture-override-open-vin'));
    await user.type(reasonBox(), 'The bay is flooded');
    expect(leavingIsQuestioned()).toBe(true);

    await user.click(screen.getByRole('button', { name: EN['form.cancel']! }));
    expect(
      screen.queryByRole('textbox', { name: EN['receptions.capture.overrideReason']! })
    ).not.toBeInTheDocument();
    expect(leavingIsQuestioned()).toBe(false);

    await user.click(screen.getByTestId('capture-override-open-vin'));
    expect(reasonBox()).toHaveValue('');
    expect(overrideCaptureRequirement).not.toHaveBeenCalled();
  });

  it('asks about a chosen file in Arabic, right to left', async () => {
    readCaptureContract.mockResolvedValue({
      status: 'ok',
      data: UNMET_VIN,
      correlationId: 'corr-capture',
    });
    const user = userEvent.setup();
    renderShell([MEDIA_STEP, STEPS[1]!], 'ar');
    const fileControl = () =>
      screen.getByLabelText<HTMLInputElement>(AR['receptions.capture.chooseFile']!);

    await user.upload(await waitFor(fileControl), photo());
    await user.click(stepButton(2, 'receptions.steps.readings.title', AR));

    const dialog = screen.getByRole('alertdialog', {
      name: AR['receptions.wizard.discard.title']!,
    });
    expect(dialog.closest('[dir]')?.getAttribute('dir') ?? document.documentElement.dir).toBe(
      'rtl'
    );
    await user.click(
      within(dialog).getByRole('button', { name: AR['receptions.wizard.discard.stay']! })
    );
    expect(fileControl().files).toHaveLength(1);
  });

  it("keeps a file chosen on one row while another row's waiver re-reads the contract", async () => {
    let answerReread: (value: unknown) => void = () => undefined;
    readCaptureContract
      .mockResolvedValueOnce({ status: 'ok', data: UNMET_VIN_AND_DAMAGE, correlationId: 'c-1' })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerReread = resolve;
          })
      );
    overrideCaptureRequirement.mockResolvedValue({
      status: 'success',
      correlationId: 'corr-waiver',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderShell([MEDIA_STEP, STEPS[1]!]);
    const vinFile = () =>
      within(screen.getByTestId('capture-vin')).getByLabelText<HTMLInputElement>(
        EN['receptions.capture.chooseFile']!
      );

    await user.upload(await waitFor(vinFile), photo());
    await user.click(screen.getByTestId('capture-override-open-damage'));
    await user.type(
      screen.getByRole('textbox', { name: EN['receptions.capture.overrideReason']! }),
      'The damage bay is closed'
    );
    await user.click(
      screen.getByRole('button', { name: EN['receptions.capture.overrideSubmit']! })
    );

    // The waiver landed and the contract is being read again: the rows stay.
    await waitFor(() => expect(readCaptureContract).toHaveBeenCalledTimes(2));
    expect(vinFile().files).toHaveLength(1);
    answerReread({ status: 'ok', data: DAMAGE_WAIVED, correlationId: 'c-2' });

    expect(await screen.findByTestId('capture-state-damage')).toHaveTextContent(
      EN['receptions.capture.state.overridden']!
    );
    // The VIN file is still chosen, and still counts as unsaved work.
    expect(vinFile().files).toHaveLength(1);
    expect(vinFile().files?.[0]?.name).toBe('vin-plate.jpg');
    expect(leavingIsQuestioned()).toBe(true);
    await user.click(stepButton(2, 'receptions.steps.readings.title'));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it("holds every row's waiver while another row's waiver re-reads the contract", async () => {
    let answerReread: (value: unknown) => void = () => undefined;
    readCaptureContract
      .mockResolvedValueOnce({ status: 'ok', data: UNMET_VIN_AND_DAMAGE, correlationId: 'c-1' })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerReread = resolve;
          })
      );
    overrideCaptureRequirement.mockResolvedValue({
      status: 'success',
      correlationId: 'corr-waiver',
      attempt: 1,
    });
    // A disabled control is not clickable in a browser; the check is turned off
    // so the click below reaches the control and proves nothing is sent.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderShell([MEDIA_STEP, STEPS[1]!]);
    const row = (code: string) => within(screen.getByTestId(`capture-${code}`));
    const waiverSubmit = (code: string) =>
      row(code).getByRole('button', { name: EN['receptions.capture.overrideSubmit']! });

    for (const [code, words] of [
      ['vin', 'The plate is behind the bumper'],
      ['damage', 'The damage bay is closed'],
    ] as const) {
      await user.click(await waitFor(() => row(code).getByTestId(`capture-override-open-${code}`)));
      await user.type(
        row(code).getByRole('textbox', { name: EN['receptions.capture.overrideReason']! }),
        words
      );
    }
    await user.click(waiverSubmit('damage'));

    // The damage waiver landed and the contract is being read again: the VIN
    // waiver, typed against the contract read before, is held back.
    await waitFor(() => expect(readCaptureContract).toHaveBeenCalledTimes(2));
    expect(waiverSubmit('vin')).toBeDisabled();
    expect(row('damage').getByTestId('capture-override-open-damage')).toBeDisabled();
    await user.click(waiverSubmit('vin'));
    expect(overrideCaptureRequirement).toHaveBeenCalledTimes(1);
    expect(readCaptureContract).toHaveBeenCalledTimes(2);

    answerReread({ status: 'ok', data: DAMAGE_WAIVED, correlationId: 'c-2' });
    expect(await screen.findByTestId('capture-state-damage')).toHaveTextContent(
      EN['receptions.capture.state.overridden']!
    );
    // The fresh contract has landed: the VIN reason is still typed, and sendable.
    await waitFor(() => expect(waiverSubmit('vin')).toBeEnabled());
    expect(
      row('vin').getByRole('textbox', { name: EN['receptions.capture.overrideReason']! })
    ).toHaveValue('The plate is behind the bumper');
  });

  it('keeps a file chosen on one row when the re-read after another row fails', async () => {
    readCaptureContract
      .mockResolvedValueOnce({ status: 'ok', data: UNMET_VIN_AND_DAMAGE, correlationId: 'c-1' })
      .mockResolvedValueOnce({ status: 'unavailable', correlationId: 'c-2' });
    overrideCaptureRequirement.mockResolvedValue({
      status: 'success',
      correlationId: 'corr-waiver',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderShell([MEDIA_STEP, STEPS[1]!]);
    const row = (code: string) => within(screen.getByTestId(`capture-${code}`));
    const vinFile = () =>
      row('vin').getByLabelText<HTMLInputElement>(EN['receptions.capture.chooseFile']!);

    await user.upload(await waitFor(vinFile), photo());
    await user.click(row('damage').getByTestId('capture-override-open-damage'));
    await user.type(
      row('damage').getByRole('textbox', { name: EN['receptions.capture.overrideReason']! }),
      'The damage bay is closed'
    );
    await user.click(
      row('damage').getByRole('button', { name: EN['receptions.capture.overrideSubmit']! })
    );

    // The re-read failed: its state and retry are shown, ABOVE the rows.
    expect(await screen.findByTestId('state-unavailable')).toBeInTheDocument();
    expect(readCaptureContract).toHaveBeenCalledTimes(2);
    // The VIN row is still there, still holds its file, and its send is held.
    expect(vinFile().files).toHaveLength(1);
    expect(vinFile().files?.[0]?.name).toBe('vin-plate.jpg');
    expect(
      row('vin').getByRole('button', { name: EN['receptions.capture.submit']! })
    ).toBeDisabled();
    // …and the chosen file is still unsaved work: leaving and a step change ask.
    expect(leavingIsQuestioned()).toBe(true);
    await user.click(stepButton(2, 'receptions.steps.readings.title'));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('asks nothing about a media file once it has been sent, even when nothing was recorded', async () => {
    readCaptureContract.mockResolvedValue({
      status: 'ok',
      data: UNMET_VIN,
      correlationId: 'corr-capture',
    });
    // No stage: nothing reached the visit, so the contract is not read again
    // and the row is not remounted.
    captureRequirementEvidence.mockResolvedValue({
      status: 'unavailable',
      messageKey: 'state.unavailable.message',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderShell([MEDIA_STEP, STEPS[1]!]);
    const fileControl = () =>
      screen.getByLabelText<HTMLInputElement>(EN['receptions.capture.chooseFile']!);

    await user.upload(await waitFor(fileControl), photo());
    expect(leavingIsQuestioned()).toBe(true);
    await user.click(screen.getByRole('button', { name: EN['receptions.capture.submit']! }));

    await waitFor(() => expect(captureRequirementEvidence).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('capture-outcome')).toHaveTextContent(
      EN['receptions.capture.failed']!
    );
    expect(readCaptureContract).toHaveBeenCalledTimes(1);
    expect(leavingIsQuestioned()).toBe(false);
    await user.click(stepButton(2, 'receptions.steps.readings.title'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText('second step body')).toBeInTheDocument();
  });

  it('asks nothing about a signature file once it has been captured', async () => {
    mockSignatureReads();
    readReception.mockResolvedValue({ status: 'ok', data: DETAIL, correlationId: 'corr-detail' });
    captureSignatureEvidence.mockResolvedValue({
      status: 'success',
      correlationId: 'corr-capture',
      attempt: 1,
      stage: 'recorded',
      documentId: 'doc-1',
      versionId: 'ver-1',
      signatureId: 'sig-1',
      versionStatus: 'pending',
      scannerAvailable: true,
    });
    const user = userEvent.setup();
    renderShell([SIGNATURE_STEP, STEPS[1]!]);
    const form = await screen.findByTestId('signature-capture-form');

    await user.selectOptions(
      within(form).getByLabelText(new RegExp(`^${EN['receptions.signature.signerLabel']}`)),
      'vehicle_owner'
    );
    await user.selectOptions(
      within(form).getByLabelText(new RegExp(`^${EN['receptions.signature.purposeLabel']}`)),
      'custody_acceptance'
    );
    await user.upload(
      within(form).getByLabelText<HTMLInputElement>(EN['receptions.signature.chooseFile']!),
      photo()
    );
    expect(leavingIsQuestioned()).toBe(true);
    await user.click(
      within(form).getByRole('button', { name: EN['receptions.signature.submit']! })
    );

    await waitFor(() => expect(captureSignatureEvidence).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(readReception).toHaveBeenCalled());
    // The choices were emptied by the capture, and the file was handed over.
    await waitFor(() => expect(leavingIsQuestioned()).toBe(false));
    await user.click(stepButton(2, 'receptions.steps.readings.title'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText('second step body')).toBeInTheDocument();
  });

  it('asks in Arabic, right to left, from the same catalogue', async () => {
    const user = userEvent.setup();
    renderShell(STEPS, 'ar');
    await user.type(screen.getByLabelText('typed note'), 'ملاحظة');

    await user.click(stepButton(2, 'receptions.steps.readings.title', AR));

    const dialog = screen.getByRole('alertdialog', {
      name: AR['receptions.wizard.discard.title']!,
    });
    expect(dialog).toHaveAccessibleDescription(AR['receptions.wizard.discard.description']!);
    expect(
      within(dialog).getByRole('button', { name: AR['receptions.wizard.discard.confirm']! })
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: AR['receptions.wizard.discard.stay']! })
    ).toBeInTheDocument();
    // The dialog is portalled to the body; its direction is the document's.
    expect(dialog.closest('[dir]')?.getAttribute('dir') ?? document.documentElement.dir).toBe(
      'rtl'
    );
  });
});
