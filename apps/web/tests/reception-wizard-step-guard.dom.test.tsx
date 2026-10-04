import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';

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
 * Known limitation, recorded rather than guarded: a CHOSEN file (the media
 * capture form, the signature capture form) is not typed input and is not
 * declared as unsaved work, so a step change drops it without asking.
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
vi.mock('@/features/receptions/evidence-capture', () => ({
  captureRequirementEvidence: vi.fn(),
  finalizeCapturedEvidence: vi.fn(),
}));
// The signature step's capture action.
vi.mock('@/features/receptions/signature-capture', () => ({
  captureSignatureEvidence: vi.fn(),
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

function renderShell(steps: readonly CheckInStepDefinition[] = STEPS, locale: 'en' | 'ar' = 'en') {
  const render = locale === 'en' ? renderLtr : renderRtl;
  return render(
    inBranch(
      <CheckInWizardShell
        locale={locale}
        messages={locale === 'en' ? en : ar}
        initialDetail={DETAIL}
        steps={steps}
        capabilities={CAPABILITIES}
        session={{ userId: 'user-1', displayName: 'Front Desk' }}
      />,
      { locale }
    )
  );
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
