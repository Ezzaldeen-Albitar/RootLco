import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import { AcknowledgementDocument } from '@/features/receptions/components/AcknowledgementDocument';
import type { ReceptionDetail } from '@/features/receptions/receptions-contract';

/**
 * The reception acknowledgement document, rendered (`P1-28-FE-021`).
 *
 * It is a print SHEET, so the cases are about what reaches paper: the print
 * frame P1-27 shipped rather than a second one, real table markup so a header
 * repeats across a page break, no storage keys, no upload claim, and no
 * verification the workshop has not performed.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const MEDIA_REFERENCE = '11111111-1111-4111-8111-111111111111';

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
  fuelLevelId: 'fuel-1',
  fuelLevelName: 'Half',
  evSocPercent: '42.50',
  receivingEmployeeId: 'user-77',
  custodyAcceptedAt: '2026-08-13T07:00:00.000Z',
  custodyReleasedAt: null,
  recordVersion: 7,
  createdAt: '2026-08-13T07:00:00.000Z',
  updatedAt: null,
};

const PARTY = {
  id: 'pr-1',
  partnerId: 'partner-1',
  partnerDisplayName: 'Layla Haddad',
  partnerDisplayNumber: 'C-0001',
  relationshipRole: 'service_requester',
  validFrom: '2026-08-13T07:00:00.000Z',
  validTo: null,
  assignmentSource: 'front desk',
  recordVersion: 1,
};

const AUTHORIZATION = {
  kind: 'authorization' as const,
  id: 'au-1',
  partnerId: 'partner-1',
  partnerDisplayName: 'Layla Haddad',
  authorizingRole: 'service_requester',
  decision: 'approved' as const,
  channel: 'in_person',
  authorizedScope: null,
  evidenceDocumentId: null,
  occurredAt: '2026-08-13T07:30:00.000Z',
  isStanding: true,
};

const COMPLAINT = {
  kind: 'complaint',
  id: 'e-1',
  recordedAt: '2026-08-13T07:10:00.000Z',
  evidenceDocumentId: MEDIA_REFERENCE,
  category: 'noise',
  severity: 'high',
};

const FINDING = {
  kind: 'condition_item',
  id: 'e-2',
  recordedAt: '2026-08-13T07:20:00.000Z',
  evidenceDocumentId: null,
  findingCategory: 'scratch',
  vehicleZone: 'front-left',
};

/** One section as a SUCCEEDED read. Overrides go per section, not per field. */
function ok(rows: readonly unknown[], hasMore = false) {
  return { status: 'ok' as const, rows, hasMore, correlationId: null };
}

/** One section as a FAILED read: no rows, and a reference to chase. */
function failed(status: 'denied' | 'expired' | 'unavailable' | 'error', correlationId: string) {
  return { status, rows: [], hasMore: false, correlationId };
}

function sections(over: Record<string, unknown> = {}) {
  return {
    parties: ok([PARTY]),
    authorizations: ok([AUTHORIZATION]),
    evidence: ok([COMPLAINT, FINDING]),
    ...over,
  } as Parameters<typeof AcknowledgementDocument>[0]['sections'];
}

function renderSheet(over: Record<string, unknown> = {}) {
  return renderLtr(
    <AcknowledgementDocument locale="en" messages={en} detail={DETAIL} sections={sections(over)} />
  );
}

describe('the sheet uses the print foundation rather than a second one', () => {
  it('renders inside the shared print document frame', () => {
    const { container } = renderSheet();
    // `data-print="document"` is `PrintDocument`'s own marker. Asserting it is
    // what makes "uses the existing foundation" a measurement.
    expect(container.querySelector('[data-print="document"]')).not.toBeNull();
  });

  it('names the visit in its title', () => {
    renderSheet();
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: `${EN['receptions.acknowledgement.title']} — R-0001`,
      })
    ).toBeVisible();
  });

  it('uses REAL table markup, so a header repeats across a page break', () => {
    const { container } = renderSheet();
    const tables = Array.from(container.querySelectorAll('table'));
    // Three sections carry rows in this fixture; a grid of divs would repeat no
    // header on page two, which is the defect `PrintTable` exists to prevent.
    expect(tables.length).toBe(3);
    for (const table of tables) {
      expect(table.querySelector('thead')).not.toBeNull();
      expect(table.querySelector('tbody')).not.toBeNull();
      expect(within(table).getAllByRole('columnheader').length).toBeGreaterThan(1);
    }
  });

  it('generates no file: no download, no blob, no PDF claim', () => {
    const { container } = renderSheet();
    expect(container.querySelector('[download]')).toBeNull();
    expect(container.querySelector('a[href^="blob:"]')).toBeNull();
    expect(container.querySelector('a[href^="data:"]')).toBeNull();
  });
});

describe('what the sheet refuses to print', () => {
  it('prints no storage key and no document reference', () => {
    const { container } = renderSheet();
    expect(container.textContent).not.toContain(MEDIA_REFERENCE);
    // The STATE is what prints instead.
    expect(screen.getAllByText(EN['receptions.summary.mediaRegistered'] as string).length).toBe(1);
  });

  it('prints "registered, pending" and never claims an upload', () => {
    const { container } = renderSheet();
    expect(container.textContent).toContain(EN['receptions.summary.mediaRegistered']);
    expect(container.textContent?.toLowerCase()).not.toContain('uploaded');
  });

  it('says nothing on the sheet has been verified by a technician', () => {
    renderSheet();
    expect(screen.getByText(EN['receptions.summary.notVerified'] as string)).toBeVisible();
  });

  it('distinguishes the customer’s report from what staff observed', () => {
    renderSheet();
    expect(screen.getByText(EN['receptions.summary.customerReported'] as string)).toBeVisible();
    expect(screen.getByText(EN['receptions.summary.staffObserved'] as string)).toBeVisible();
  });

  it('states that the customer’s wording is on the restricted record', () => {
    renderSheet();
    expect(
      screen.getByText(EN['receptions.summary.complaintWordsRestricted'] as string)
    ).toBeVisible();
  });

  it('states the receiving employee is an identifier with no register behind it', () => {
    renderSheet();
    expect(screen.getByText('user-77')).toBeVisible();
    expect(screen.getByText(EN['receptions.wizard.receivingEmployeeNote'] as string)).toBeVisible();
  });

  it('says it is not a diagnosis and not a quotation', () => {
    renderSheet();
    expect(screen.getByText(EN['receptions.acknowledgement.footerNote'] as string)).toBeVisible();
  });
});

describe('what the sheet says when a section is empty, unreadable or clipped', () => {
  it('states an empty section rather than printing a blank block', () => {
    renderSheet({ parties: ok([]), authorizations: ok([]), evidence: ok([]) });
    expect(screen.getByText(EN['receptions.summary.partiesEmpty'] as string)).toBeVisible();
    expect(screen.getByText(EN['receptions.summary.authorizationsEmpty'] as string)).toBeVisible();
    expect(screen.getByText(EN['receptions.summary.evidenceEmpty'] as string)).toBeVisible();
  });

  it('prints a FAILED read as a failed read, never as an empty section (`F1`)', () => {
    /*
     * The defect this replaces: a section read that failed answers `rows: []`,
     * the sheet took that for an empty section, and a customer handover document
     * asserted *no records are recorded on this visit* about records nobody had
     * been able to look at.
     *
     * Each failed section must therefore say it could not be read AND carry its
     * correlation reference, and must NOT print the empty-section sentence.
     */
    renderSheet({
      parties: failed('unavailable', 'corr-parties'),
      authorizations: failed('error', 'corr-auth'),
      evidence: failed('denied', 'corr-evidence'),
    });

    expect(
      screen.getAllByText(EN['receptions.acknowledgement.sectionUnreadable'] as string).length
    ).toBe(3);
    for (const reference of ['corr-parties', 'corr-auth', 'corr-evidence']) {
      expect(screen.getByText(reference)).toBeVisible();
    }

    // The false absence itself, asserted gone.
    expect(screen.queryByText(EN['receptions.summary.partiesEmpty'] as string)).toBeNull();
    expect(screen.queryByText(EN['receptions.summary.authorizationsEmpty'] as string)).toBeNull();
    expect(screen.queryByText(EN['receptions.summary.evidenceEmpty'] as string)).toBeNull();
  });

  it('withholds the truncation note on a failed read — `hasMore: false` is not an answer', () => {
    renderSheet({ evidence: failed('unavailable', 'corr-evidence') });
    expect(
      screen.getByText(EN['receptions.acknowledgement.sectionUnreadable'] as string)
    ).toBeVisible();
    expect(screen.queryByText(EN['receptions.acknowledgement.truncated'] as string)).toBeNull();
  });

  it('says so when one printed page is not the whole section', () => {
    renderSheet({ evidence: ok([COMPLAINT, FINDING], true) });
    expect(screen.getByText(EN['receptions.acknowledgement.truncated'] as string)).toBeVisible();
  });

  it('says nothing about truncation when nothing was clipped', () => {
    renderSheet();
    expect(screen.queryByText(EN['receptions.acknowledgement.truncated'] as string)).toBeNull();
  });

  it('prints the EV charge exactly as the wire carried it', () => {
    // `numeric(5,2)` travels as a STRING; reformatting it as a float would
    // change the value the record holds.
    renderSheet();
    expect(screen.getByText('42.50%')).toBeVisible();
  });
});

describe('both directions', () => {
  it('renders in Arabic, right to left, with no English fallback', () => {
    const { container } = renderRtl(
      <AcknowledgementDocument locale="ar" messages={ar} detail={DETAIL} sections={sections()} />
    );
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByText(AR['receptions.summary.notVerified'] as string)).toBeVisible();
    expect(screen.getByText(AR['receptions.acknowledgement.footerNote'] as string)).toBeVisible();
    // The document inherits `dir` from the root rather than declaring its own —
    // one layout, two directions.
    expect(container.querySelector('[data-print="document"]')?.getAttribute('dir')).toBeNull();
  });
});
