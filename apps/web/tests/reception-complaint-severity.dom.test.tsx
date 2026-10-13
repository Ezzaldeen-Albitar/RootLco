import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import type { CheckInStepProps } from '@/features/receptions/check-in/wizard';
import {
  COMPLAINT_SEVERITY_NOT_STATED,
  STORED_COMPLAINT_SEVERITIES,
  type ReceptionDetail,
} from '@/features/receptions/receptions-contract';

/**
 * A concern recorded without a severity is "not stated" (Owner decision of
 * 2026-10-03, README question 19; `20261004090000_rec_complaint_severity_not_stated.sql`).
 *
 * The form's blank severity choice says "Not stated" and sends no severity,
 * which the service stores as `not_stated`; the read-back renders that value
 * as "Not stated" in both languages and never as "Medium".
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const recordConditionEvidence = vi.fn();
const listConditionEvidence = vi.fn();
vi.mock('@/features/receptions/api', () => ({
  recordConditionEvidence: (...args: unknown[]) => recordConditionEvidence(...args),
  listConditionEvidence: (...args: unknown[]) => listConditionEvidence(...args),
}));

const { ComplaintsStep } = await import('@/features/receptions/components/steps/ComplaintsStep');

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

function stepProps(locale: 'en' | 'ar' = 'en'): CheckInStepProps {
  return {
    locale,
    messages: locale === 'en' ? en : ar,
    visitId: 'rv-1',
    recordVersion: 3,
    detail: DETAIL,
    capabilities: {
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
    },
    session: { userId: 'user-1', displayName: 'Front Desk' },
    writesLocked: false,
    refresh: vi.fn().mockResolvedValue(undefined),
    goToStep: vi.fn(),
  };
}

function readBack(severity: string) {
  listConditionEvidence.mockResolvedValue({
    status: 'ok',
    rows: [
      {
        kind: 'complaint',
        id: 'ev-9',
        recordedAt: '2026-08-13T08:00:00.000Z',
        evidenceDocumentId: null,
        category: 'noise',
        severity,
        reportedByPartnerId: null,
        reportedByPartnerDisplayName: null,
      },
    ],
    nextCursor: null,
    hasMore: false,
    correlationId: 'corr-page',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  readBack('high');
});

describe('a complaint severity the customer did not give is "Not stated"', () => {
  it('labels every severity a read can return, in both catalogues, and "not stated" as itself', () => {
    expect(STORED_COMPLAINT_SEVERITIES).toContain(COMPLAINT_SEVERITY_NOT_STATED);
    for (const value of STORED_COMPLAINT_SEVERITIES) {
      expect(EN[`receptions.complaintSeverity.${value}`]?.trim()).toBeTruthy();
      expect(AR[`receptions.complaintSeverity.${value}`]?.trim()).toBeTruthy();
    }
    expect(EN['receptions.complaintSeverity.not_stated']).not.toBe(
      EN['receptions.complaintSeverity.medium']
    );
    expect(AR['receptions.complaintSeverity.not_stated']).not.toBe(
      AR['receptions.complaintSeverity.medium']
    );
  });

  it('offers the blank choice as "Not stated", chosen until the operator picks a severity', async () => {
    const user = userEvent.setup();
    renderLtr(<ComplaintsStep {...stepProps()} />);
    const severity = screen.getByLabelText(new RegExp(EN['receptions.complaint.severity']!));

    expect(severity).toHaveDisplayValue(EN['receptions.complaintSeverity.not_stated']!);
    expect(
      within(severity).getByRole('option', { name: EN['receptions.complaintSeverity.not_stated']! })
    ).toHaveValue('');

    // Picked and put back: the blank choice is still an answer, not a gap.
    await user.selectOptions(severity, 'high');
    await user.selectOptions(severity, '');
    expect(severity).toHaveDisplayValue(EN['receptions.complaintSeverity.not_stated']!);
  });

  it('sends no severity for "Not stated", and the stated one when one is chosen', async () => {
    recordConditionEvidence.mockResolvedValue({
      status: 'success',
      correlationId: 'corr-write',
      attempt: 1,
      recorded: { receptionVisitId: 'rv-1', kind: 'complaint', evidenceId: 'ev-1' },
    });
    const user = userEvent.setup();
    renderLtr(<ComplaintsStep {...stepProps()} />);
    const fill = async (words: string) => {
      await user.selectOptions(
        screen.getByLabelText(new RegExp(EN['receptions.complaint.category']!)),
        'noise'
      );
      await user.type(screen.getByLabelText(new RegExp(EN['receptions.complaint.text']!)), words);
    };

    await fill('It squeaks');
    await user.click(screen.getByRole('button', { name: EN['receptions.complaint.record']! }));
    await waitFor(() => expect(recordConditionEvidence).toHaveBeenCalledTimes(1));
    expect(recordConditionEvidence.mock.calls[0]![1]).not.toHaveProperty('severity');

    await fill('It rattles');
    await user.selectOptions(
      screen.getByLabelText(new RegExp(EN['receptions.complaint.severity']!)),
      'low'
    );
    await user.click(screen.getByRole('button', { name: EN['receptions.complaint.record']! }));
    await waitFor(() => expect(recordConditionEvidence).toHaveBeenCalledTimes(2));
    expect(recordConditionEvidence.mock.calls[1]![1]).toMatchObject({ severity: 'low' });
  });

  it('reads a stored "not stated" back as "Not stated", never as "Medium"', async () => {
    readBack('not_stated');
    renderLtr(<ComplaintsStep {...stepProps()} />);
    const panel = await screen.findByRole('region', {
      name: EN['receptions.complaint.heading']!,
    });
    expect(
      await within(panel).findByText(EN['receptions.complaintSeverity.not_stated']!)
    ).toBeInTheDocument();
    expect(
      within(panel).queryByText(EN['receptions.complaintSeverity.medium']!)
    ).not.toBeInTheDocument();
  });

  it('says it in Arabic, right to left, in the form and in the read-back', async () => {
    readBack('not_stated');
    renderRtl(<ComplaintsStep {...stepProps('ar')} />);
    expect(document.documentElement.dir).toBe('rtl');

    const severity = screen.getByLabelText(new RegExp(AR['receptions.complaint.severity']!));
    expect(severity).toHaveDisplayValue(AR['receptions.complaintSeverity.not_stated']!);

    const panel = await screen.findByRole('region', {
      name: AR['receptions.complaint.heading']!,
    });
    expect(
      await within(panel).findByText(AR['receptions.complaintSeverity.not_stated']!)
    ).toBeInTheDocument();
    expect(
      within(panel).queryByText(AR['receptions.complaintSeverity.medium']!)
    ).not.toBeInTheDocument();
  });
});
