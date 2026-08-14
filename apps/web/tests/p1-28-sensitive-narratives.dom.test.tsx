import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import type { CheckInStepProps } from '@/features/receptions/check-in/wizard';
import type { ReceptionDetail } from '@/features/receptions/receptions-contract';

/**
 * The restricted narratives on screen — `P1-28-SEC-002`.
 *
 * `tests/p1-28-security.test.ts` holds the rules; this holds what an operator
 * actually meets. Three questions, and the third is the one the canonical plan
 * asks by name:
 *
 *   1. Without the sensitive-data capability, is the capture form withheld with
 *      the requirement stated — or offered as something that can only fail?
 *   2. When the DATABASE refuses (the application check having passed), does the
 *      operator get a permissions message with a reference to quote — never a
 *      crash and never a blank?
 *   3. The condition-evidence LIST deliberately never returns these narratives.
 *      Does the panel SAY so, or does it let a thin row read as data loss?
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

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

const searchCustomerDirectory = vi.fn();
vi.mock('@/lib/customers/directory', () => ({
  searchCustomerDirectory: (...args: unknown[]) => searchCustomerDirectory(...args),
}));

const { ComplaintsStep } = await import('@/features/receptions/components/steps/ComplaintsStep');
const { ContentsStep } = await import('@/features/receptions/components/steps/ContentsStep');

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

const HELD = {
  manageParties: true,
  verifyAuthorizations: true,
  readCustomers: true,
  readVehicles: true,
  manageEvidence: true,
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
    visitId: 'rv-1',
    recordVersion: 3,
    detail: DETAIL,
    capabilities: HELD,
    session: { userId: 'user-1', displayName: 'Front Desk' },
    writesLocked: false,
    refresh: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

function page<Row>(rows: readonly Row[]) {
  return { status: 'ok' as const, rows, nextCursor: null, hasMore: false, correlationId: 'c' };
}

beforeEach(() => {
  vi.clearAllMocks();
  listConditionEvidence.mockResolvedValue(page([]));
  searchCustomerDirectory.mockResolvedValue(page([]));
});

/* ------------------------------------------------------------------ *
 * 1 — withheld before, with the requirement stated
 * ------------------------------------------------------------------ */

const RESTRICTED_STEPS = [
  {
    name: 'the complaint step (FE-010)',
    Step: ComplaintsStep,
    formLabel: 'receptions.complaint.formLabel',
    submit: 'receptions.complaint.record',
    denialTestId: 'complaint-sensitive-denied',
  },
  {
    name: 'the contents step (FE-016)',
    Step: ContentsStep,
    formLabel: 'receptions.contents.formLabel',
    submit: 'receptions.contents.record',
    denialTestId: 'contents-sensitive-denied',
  },
] as const;

describe('P1-28-SEC-002 — a form that could only be refused is not offered', () => {
  for (const step of RESTRICTED_STEPS) {
    it(`${step.name} withholds capture without the sensitive-data capability, and says why`, async () => {
      const { Step } = step;
      renderLtr(
        <Step {...stepProps({ capabilities: { ...HELD, viewSensitiveNarratives: false } })} />
      );

      // No form and no submit control: an operator cannot spend four thousand
      // characters on a write the database will refuse.
      expect(screen.queryByRole('form', { name: EN[step.formLabel] as string })).toBeNull();
      expect(screen.queryByRole('button', { name: EN[step.submit] as string })).toBeNull();

      // And the reason is on screen, not implied by an absence.
      expect(screen.getByText(EN['receptions.evidence.sensitiveRequired'] as string)).toBeTruthy();
      // Not the generic read-only sentence, which would name the wrong cause and
      // send an operator to ask for a capability they already hold.
      expect(screen.queryByText(EN['receptions.evidence.readOnly'] as string)).toBeNull();
    });

    it(`${step.name} offers capture once the capability is held`, async () => {
      // The positive control. Without it the case above is satisfied by a step
      // that never renders a form at all.
      const { Step } = step;
      renderLtr(<Step {...stepProps()} />);
      expect(screen.getByRole('button', { name: EN[step.submit] as string })).toBeTruthy();
      expect(screen.queryByText(EN['receptions.evidence.sensitiveRequired'] as string)).toBeNull();
    });

    it(`${step.name} states the requirement in Arabic too`, () => {
      const { Step } = step;
      renderRtl(
        <Step
          {...stepProps({
            locale: 'ar',
            messages: ar,
            capabilities: { ...HELD, viewSensitiveNarratives: false },
          })}
        />
      );
      expect(screen.getByText(AR['receptions.evidence.sensitiveRequired'] as string)).toBeTruthy();
    });
  }

  it('an ENDED visit still says the visit ended, not the permission', () => {
    // Ordering: what is most true wins. A locked visit refuses every write
    // whatever anybody holds, and blaming a permission there would be wrong.
    renderLtr(
      <ComplaintsStep
        {...stepProps({
          writesLocked: true,
          capabilities: { ...HELD, viewSensitiveNarratives: false },
        })}
      />
    );
    expect(screen.getByText(EN['receptions.evidence.lockedNote'] as string)).toBeTruthy();
    expect(screen.queryByText(EN['receptions.evidence.sensitiveRequired'] as string)).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 2 — the WF-27 refusal, as an operator meets it
 * ------------------------------------------------------------------ */

describe('P1-28-SEC-002 — the database refusal surfaces as a permissions message', () => {
  it('renders the denial, a reference to quote, and the pair — and keeps the form', async () => {
    /*
     * WF-27 as it reaches a screen: the operator holds `iam.sensitive.view`, so
     * the form was correctly offered; the grant does not reach this visit's
     * branch, so `iam.has_permission` refuses inside the transaction and the
     * service maps `42501` to `ERR-IAM-001` — a 403.
     *
     * What must NOT happen: a crash, a blank panel, or a success message for a
     * write that did not happen.
     */
    recordConditionEvidence.mockResolvedValue({
      status: 'denied',
      messageKey: 'state.denied.title',
      correlationId: 'corr-403-wf27',
      attempt: 1,
    });

    const user = userEvent.setup();
    renderLtr(<ComplaintsStep {...stepProps()} />);

    await user.selectOptions(
      screen.getByLabelText(EN['receptions.complaint.category'] as string, { exact: false }),
      'noise'
    );
    await user.type(
      screen.getByLabelText(EN['receptions.complaint.text'] as string, { exact: false }),
      'A knocking sound from the front left when braking.'
    );
    await user.click(
      screen.getByRole('button', { name: EN['receptions.complaint.record'] as string })
    );

    await waitFor(() => expect(recordConditionEvidence).toHaveBeenCalledTimes(1));

    // The permissions message itself, rendered in the step's alert.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(EN['state.denied.title']);
    // A reference an operator can quote, or the denial cannot be traced.
    expect(alert.textContent).toContain('corr-403-wf27');

    // The supplement that NAMES the pair — and refuses to say which half failed.
    const supplement = screen.getByTestId('complaint-sensitive-denied');
    expect(supplement.textContent).toBe(EN['receptions.evidence.sensitiveDenied']);

    // Never a success sentence for a write that did not happen, and the form is
    // still there so the operator can act on what they were told.
    //
    // `findByRole`, not `getByRole`: the submit control carries the pending
    // label while the transition is in flight and takes its own name back when
    // it settles. Asserting synchronously passes on an idle machine and fails
    // under a loaded one — a flake that would eventually be "fixed" by deleting
    // the assertion that noticed.
    expect(
      await screen.findByRole('button', { name: EN['receptions.complaint.record'] as string })
    ).toBeTruthy();
    expect(
      screen.getByLabelText(EN['receptions.complaint.text'] as string, { exact: false })
    ).toBeTruthy();
  });

  it('does not blame a permission for a refusal that is not one', async () => {
    /*
     * The control. Without it, "the pair is named on a denial" is equally
     * consistent with a step that names it on every failure — which would send
     * an operator to an administrator over a conflict they could simply retry.
     */
    recordConditionEvidence.mockResolvedValue({
      status: 'conflict',
      messageKey: 'state.conflict.title',
      correlationId: 'corr-409',
      attempt: 1,
    });

    const user = userEvent.setup();
    renderLtr(<ComplaintsStep {...stepProps()} />);
    await user.selectOptions(
      screen.getByLabelText(EN['receptions.complaint.category'] as string, { exact: false }),
      'noise'
    );
    await user.type(
      screen.getByLabelText(EN['receptions.complaint.text'] as string, { exact: false }),
      'A rattle over speed bumps.'
    );
    await user.click(
      screen.getByRole('button', { name: EN['receptions.complaint.record'] as string })
    );

    await waitFor(() => expect(recordConditionEvidence).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('complaint-sensitive-denied')).toBeNull();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(EN['receptions.evidence.conflict']);
  });
});

/* ------------------------------------------------------------------ *
 * 3 — the list that deliberately returns no narrative
 * ------------------------------------------------------------------ */

describe('P1-28-SEC-002 — the read-back states what it cannot return', () => {
  it('says so on an EMPTY list, so emptiness is not read as the whole truth', async () => {
    renderLtr(<ComplaintsStep {...stepProps()} />);
    await waitFor(() => expect(listConditionEvidence).toHaveBeenCalled());
    expect(
      await screen.findByText(EN['receptions.evidence.restrictedReadBack'] as string)
    ).toBeTruthy();
    expect(screen.getByText(EN['receptions.evidence.readBackEmpty'] as string)).toBeTruthy();
  });

  it('says so on a POPULATED list, where a thin row would otherwise read as data loss', async () => {
    listConditionEvidence.mockResolvedValue(
      page([
        {
          id: 'ev-1',
          kind: 'complaint',
          recordedAt: '2026-08-13T08:30:00.000Z',
          category: 'noise',
          severity: 'medium',
          reportedByPartnerDisplayName: 'A customer',
        },
      ])
    );
    renderLtr(<ComplaintsStep {...stepProps()} />);

    expect(
      await screen.findByText(EN['receptions.evidence.restrictedReadBack'] as string)
    ).toBeTruthy();
    // The envelope reads back — the reporter's resolved name, which appears
    // nowhere else on the step, so this is the READ-BACK and not a form label.
    expect(screen.getByText('A customer')).toBeTruthy();
    // … and the emptiness sentence is gone, so the statement above is about the
    // NARRATIVE and not about an empty panel.
    expect(screen.queryByText(EN['receptions.evidence.readBackEmpty'] as string)).toBeNull();
  });

  it('shows the contents envelope without the description, value or currency', async () => {
    listConditionEvidence.mockResolvedValue(
      page([
        {
          id: 'ev-2',
          kind: 'contents',
          recordedAt: '2026-08-13T08:40:00.000Z',
          quantity: 2,
          location: 'Boot',
          // The union does not publish these; a renderer that showed them would
          // be inventing fields. Present here on purpose: if the panel ever
          // started rendering unknown keys, this case would catch it.
          itemDescription: 'A leather briefcase',
          declaredValue: '500.00',
          declaredCurrency: 'JOD',
        },
      ])
    );
    renderLtr(<ContentsStep {...stepProps()} />);

    expect(
      await screen.findByText(EN['receptions.evidence.restrictedReadBack'] as string)
    ).toBeTruthy();
    expect(screen.getByText('Boot')).toBeTruthy();
    // The narrative is NOT rendered, even when the payload carries it.
    expect(screen.queryByText('A leather briefcase')).toBeNull();
    expect(screen.queryByText('500.00')).toBeNull();
  });
});
