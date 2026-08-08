import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr } from './render';
import { severityRank, SEVERITY_RANK } from '@/features/crm/customers/profile-contract';
import {
  NO_WRITES,
  permittedWrites,
  WRITE_PERMISSIONS,
} from '@/features/crm/customers/governance-contract';
import type { CustomerDetail } from '@/features/crm/customers/profile-contract';

/**
 * The six customer component sections (`FE-009`…`FE-014`).
 *
 * These sections are all "a table of rows", so the tests worth writing are not
 * about tables. They are about the four places where a generic table would be
 * quietly wrong:
 *
 *   - a notes list that is shorter than the record and does not say so,
 *   - a severity column sorted or coloured by spelling rather than meaning,
 *   - a denied restrictions list that leaks the existence of restrictions,
 *   - a `date` reformatted through a JS `Date` and shifted a day.
 */

const listPreferences = vi.fn();
const listConsents = vi.fn();
const listNotes = vi.fn();
const listAlerts = vi.fn();
const listTags = vi.fn();
const listRestrictions = vi.fn();

vi.mock('@/features/crm/customers/profile-api', () => ({
  readCustomer: vi.fn(),
  listContacts: vi.fn(async () => page([])),
  listAddresses: vi.fn(async () => page([])),
  listPreferences: (...a: unknown[]) => listPreferences(...a),
  listConsents: (...a: unknown[]) => listConsents(...a),
  listNotes: (...a: unknown[]) => listNotes(...a),
  listAlerts: (...a: unknown[]) => listAlerts(...a),
  listTags: (...a: unknown[]) => listTags(...a),
  listRestrictions: (...a: unknown[]) => listRestrictions(...a),
}));

// The timeline adapter lives in its own module. Unmocked it reaches the real
// `authorizedClient` and calls `cookies()` outside a request scope.
vi.mock('@/features/crm/customers/identity-api', () => ({
  listTimeline: async () => page([]),
  listDuplicates: async () => page([]),
  reviewDuplicateAction: vi.fn(),
}));

const { CustomerProfileScreen } =
  await import('@/features/crm/customers/components/CustomerProfileScreen');

function page(rows: readonly unknown[], overrides: Record<string, unknown> = {}) {
  return {
    status: 'ok',
    rows,
    nextCursor: null,
    hasMore: false,
    correlationId: 'fixed-correlation-id',
    ...overrides,
  };
}

const CUSTOMER: CustomerDetail = {
  id: '2f1e0f6a-5c2d-4a5b-8f2c-1a2b3c4d5e6f',
  displayNumber: 'C-0001',
  displayName: 'Nadia Khoury',
  partyType: 'individual',
  lifecycleStatus: 'active',
  commercialStatus: 'normal',
  recordVersion: 3,
  createdAt: '2026-08-04T10:00:00.000Z',
  updatedAt: null,
  givenName: 'Nadia',
  familyName: 'Khoury',
  preferredLocale: 'ar',
  legalName: null,
  tradeName: null,
};

/**
 * Opens one section by its tab label and waits for the first read.
 *
 * `writes` defaults to nothing, which is what these fail-closed cases want. The
 * one case that asserts a form IS offered passes the capability explicitly,
 * because since `P1-27-SEC-001` a successful read is necessary and no longer
 * sufficient — the caller must also hold the write.
 */
async function open(section: RegExp, writes = NO_WRITES) {
  const user = userEvent.setup();
  renderLtr(
    <CustomerProfileScreen locale="en" messages={en} customer={CUSTOMER} writes={writes} />
  );
  await user.click(screen.getByRole('button', { name: section }));
}

beforeEach(() => {
  for (const fn of [
    listPreferences,
    listConsents,
    listNotes,
    listAlerts,
    listTags,
    listRestrictions,
  ]) {
    fn.mockReset();
    fn.mockResolvedValue(page([]));
  }
  listNotes.mockResolvedValue({ ...page([]), includesRestricted: true });
});

describe('severity is ranked by meaning, not by spelling', () => {
  it('ranks critical above warning above info', () => {
    // The trap: `severity` is `text` with a CHECK, not an enum. Sorted
    // alphabetically that is critical, info, warning — which puts `info` ABOVE
    // `warning`. This assertion fails the moment anyone reaches for `.sort()`.
    expect(severityRank('critical')).toBeLessThan(severityRank('warning'));
    expect(severityRank('warning')).toBeLessThan(severityRank('info'));
  });

  it('disagrees with alphabetical order, which is the whole point', () => {
    const byRank = ['info', 'warning', 'critical'].sort(
      (a, b) => severityRank(a) - severityRank(b)
    );
    const byLabel = ['info', 'warning', 'critical'].slice().sort();
    expect(byRank).toEqual(['critical', 'warning', 'info']);
    expect(byRank).not.toEqual(byLabel);
  });

  it('sorts an unknown severity last, never first', () => {
    // A value this build has not heard of must not outrank a `critical` it
    // understands. Defaulting an unknown to 0 would do exactly that.
    expect(severityRank('catastrophic')).toBeGreaterThan(severityRank('info'));
  });

  it('covers every value the CHECK constraint admits', () => {
    // `ck_customer_alerts_severity CHECK (severity IN ('info','warning','critical'))`.
    // A rank table missing one of these would silently demote a real severity to
    // "unknown" and rank it below every other row.
    expect(Object.keys(SEVERITY_RANK).sort()).toEqual(['critical', 'info', 'warning']);
  });
});

describe('notes say whether the list is complete', () => {
  const NOTE = {
    id: 'n1',
    body: 'Called about the invoice.',
    classification: 'internal',
    visibility: 'internal',
    authorId: 'u1',
    editedAt: null,
    createdAt: '2026-08-04T10:00:00.000Z',
  };

  it('states that restricted notes are hidden when the caller cannot see them', async () => {
    listNotes.mockResolvedValue({ ...page([NOTE]), includesRestricted: false });
    await open(/Notes/);
    // Without this the screen presents a filtered list as the whole record.
    // `sel_notes_tenant` removes rows SILENTLY — nothing in the rows themselves
    // reveals that anything is missing.
    expect(await screen.findByText(en['crm.customers.notes.restrictedHidden'])).toBeInTheDocument();
    expect(screen.queryByText(en['crm.customers.notes.includesRestricted'])).toBeNull();
  });

  it('confirms completeness only when the backend says so', async () => {
    listNotes.mockResolvedValue({ ...page([NOTE]), includesRestricted: true });
    await open(/Notes/);
    expect(
      await screen.findByText(en['crm.customers.notes.includesRestricted'])
    ).toBeInTheDocument();
  });

  it('claims nothing at all when the read failed', async () => {
    listNotes.mockResolvedValue({ ...page([], { status: 'error' }), includesRestricted: false });
    await open(/Notes/);
    await screen.findByText(en['state.error.title']);
    // A failed read must not produce "restricted notes are hidden" either —
    // that would be asserting something about the caller's permissions on the
    // strength of a transport failure.
    expect(screen.queryByText(en['crm.customers.notes.restrictedHidden'])).toBeNull();
    expect(screen.queryByText(en['crm.customers.notes.includesRestricted'])).toBeNull();
  });
});

describe('restrictions fail closed', () => {
  it('reveals nothing about restrictions when the read is denied', async () => {
    listRestrictions.mockResolvedValue(page([], { status: 'denied' }));
    await open(/Restrictions/);
    expect(await screen.findByText(en['state.denied.title'])).toBeInTheDocument();
    // The disclosure this guards against is not the reason text — it is the
    // COUNT. "3 restrictions hidden" has already told the operator that this
    // customer is restricted, which is the fact the permission protects.
    //
    // Scoped to the section: the profile header legitimately carries the
    // customer number, and an unscoped digit search would match that instead
    // and pass for the wrong reason.
    const section = document.querySelector('section[aria-labelledby="crm-restrictions-heading"]');
    expect(section).not.toBeNull();
    expect(section?.textContent ?? '').not.toMatch(/\d/);
  });

  it('does not offer the write form when the read was denied', async () => {
    listRestrictions.mockResolvedValue(page([], { status: 'denied' }));
    await open(/Restrictions/);
    await screen.findByText(en['state.denied.title']);
    // Every section needs `crm.customer.read` to list and a STRONGER capability
    // to write, so a caller denied the list certainly cannot write. Rendering
    // the form would invite an action guaranteed to fail AND disclose the
    // vocabulary — the options name `no_credit` and `contact_restriction`
    // whether or not a row was ever returned.
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(
      screen.queryByRole('button', { name: en['crm.customers.restrictions.impose'] })
    ).toBeNull();
  });

  it('does offer the write form when the read succeeded and the caller may write', async () => {
    listRestrictions.mockResolvedValue(page([]));
    await open(/Restrictions/, permittedWrites([WRITE_PERMISSIONS.restriction]));
    // The inverse. Without it, a screen that never rendered any form would
    // satisfy the assertion above — and after `P1-27-SEC-001` added the second
    // condition, this is the case that proves the gate did not simply close on
    // everybody.
    expect(
      await screen.findByRole('button', { name: en['crm.customers.restrictions.impose'] })
    ).toBeInTheDocument();
  });

  it('does not render a reason or approval reference on a denial', async () => {
    listRestrictions.mockResolvedValue(
      // A backend that leaked rows alongside a denial must still show nothing.
      page([{ id: 'r1', restrictionType: 'no_credit', reason: 'Fraud investigation' }], {
        status: 'denied',
      })
    );
    await open(/Restrictions/);
    await screen.findByText(en['state.denied.title']);
    expect(screen.queryByText(/Fraud investigation/)).toBeNull();
    expect(screen.queryByText(en['crm.restrictionType.no_credit'])).toBeNull();
  });
});

describe('date columns are printed as stored', () => {
  it('does not shift an alert date by a timezone', async () => {
    listAlerts.mockResolvedValue(
      page([
        {
          id: 'al1',
          alertType: 'financial',
          severity: 'critical',
          message: 'Account on hold.',
          // A `date` read as `::text`. Parsing this into a JS `Date` and
          // reformatting it renders 2026-08-03 anywhere west of UTC — that is
          // the defect class `P1-27-INT-006` was raised for.
          effectiveFrom: '2026-08-04',
          effectiveTo: null,
          acknowledgedBy: null,
          acknowledgedAt: null,
        },
      ])
    );
    await open(/Alerts/);
    expect(await screen.findByText('2026-08-04')).toBeInTheDocument();
    expect(screen.queryByText('2026-08-03')).toBeNull();
    expect(screen.queryByText('2026-08-05')).toBeNull();
  });

  it('says "no end date" rather than leaving an open-ended alert blank', async () => {
    listAlerts.mockResolvedValue(
      page([
        {
          id: 'al2',
          alertType: 'safety',
          severity: 'warning',
          message: 'Airbag recall outstanding.',
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          acknowledgedBy: null,
          acknowledgedAt: null,
        },
      ])
    );
    await open(/Alerts/);
    // An empty cell reads as missing data. This one means "still in force".
    expect(await screen.findByText(en['crm.customers.alerts.openEnded'])).toBeInTheDocument();
  });

  it('marks the alert list as active-only', async () => {
    await open(/Alerts/);
    // Otherwise an empty list reads as "this customer has never had a problem".
    expect(await screen.findByText(en['crm.customers.alerts.activeOnlyNote'])).toBeInTheDocument();
  });
});

describe('preferences', () => {
  it('renders a recorded "no" as a word, not as an empty cell', async () => {
    listPreferences.mockResolvedValue(
      page([
        {
          id: 'p1',
          channel: 'email',
          purpose: 'marketing',
          preferred: false,
          preferredLocale: null,
          quietHoursNote: null,
          recordVersion: 1,
          createdAt: '2026-08-04T10:00:00.000Z',
        },
      ])
    );
    await open(/Preferences/);
    // `preferred: false` is a recorded decision NOT to use a channel. A blank
    // cell would read as "nobody has decided", which is a different fact and
    // the one that gets a customer marketed at.
    expect(await screen.findByText(en['crm.customers.profile.no'])).toBeInTheDocument();
  });

  it('says that quiet hours cannot be edited here', async () => {
    await open(/Preferences/);
    // `quiet_hours_note` is a column no write operation can set (`P1-16-A-01`).
    // Showing the field silently sends an operator hunting for a control that
    // does not exist anywhere in the product.
    expect(
      await screen.findByText(en['crm.customers.preferences.quietHoursReadOnly'])
    ).toBeInTheDocument();
  });
});

describe('consents', () => {
  const CONSENT = {
    id: 'c1',
    consentKind: 'marketing',
    channel: 'email',
    purpose: 'marketing',
    status: 'withdrawn',
    source: 'in-branch tablet, ref 88213',
    effectiveAt: '2026-08-04T10:00:00.000Z',
    contactPointId: null,
    evidenceDocumentId: null,
    recordedBy: 'u1',
    seq: '9007199254740993',
  };

  it('renders an unconstrained source exactly as stored', async () => {
    listConsents.mockResolvedValue(page([CONSENT]));
    await open(/Consents/);
    // `crm.consent_history.source` is `text` with NO check constraint, so its
    // values are open. Translating it would print `crm.consentSource.in-branch
    // tablet, ref 88213` on screen.
    expect(await screen.findByText('in-branch tablet, ref 88213')).toBeInTheDocument();
    expect(screen.queryByText(/crm\.consentSource/)).toBeNull();
  });

  it('states that the history is append-only', async () => {
    listConsents.mockResolvedValue(page([CONSENT]));
    await open(/Consents/);
    // Presenting a lawful append-only record as a current-state list implies it
    // can be corrected in place. It cannot.
    expect(
      await screen.findByText(en['crm.customers.consents.appendOnlyNote'])
    ).toBeInTheDocument();
  });

  it('translates the constrained columns', async () => {
    listConsents.mockResolvedValue(page([CONSENT]));
    await open(/Consents/);
    // Scoped to the TABLE. The record form legitimately repeats these same
    // labels in its `<option>` list, so an unscoped query matches twice and
    // fails for a reason that has nothing to do with the column.
    const table = await screen.findByRole('table');
    expect(within(table).getByText(en['crm.consentStatus.withdrawn'])).toBeInTheDocument();
    expect(within(table).getByText(en['crm.consentKind.marketing'])).toBeInTheDocument();
  });
});

describe('tags', () => {
  it('shows the tenant-configured segment name without translating it', async () => {
    listTags.mockResolvedValue(
      page([
        {
          id: 't1',
          segmentId: 's1',
          segmentCode: 'FLEET',
          name: 'Fleet operators',
          validFrom: '2026-01-01',
          validTo: null,
          assignedAt: '2026-08-04T10:00:00.000Z',
          assignedBy: 'u1',
        },
      ])
    );
    await open(/Tags/);
    // Segment names are tenant data. Deriving a translation key from them would
    // render a raw key the moment a tenant adds a segment.
    expect(await screen.findByText('Fleet operators')).toBeInTheDocument();
    expect(screen.getByText('FLEET')).toBeInTheDocument();
  });
});

describe('every section is reachable and none is marked planned any more', () => {
  it('leaves only vehicles planned', async () => {
    renderLtr(<CustomerProfileScreen locale="en" messages={en} customer={CUSTOMER} />);
    const nav = screen.getByRole('navigation', { name: en['crm.customers.profile.sections'] });
    const plannedLabels = Array.from(nav.querySelectorAll('button'))
      .filter((b) => b.textContent?.includes(en['nav.planned']))
      .map((b) => b.textContent ?? '');

    // Asserting WHICH section remains, not how many. A count passes whenever
    // any one section is planned, so it would not notice a later wave building
    // Vehicles while accidentally reverting Timeline to planned.
    expect(plannedLabels).toHaveLength(1);
    expect(plannedLabels[0]).toContain('Vehicles');
  });

  it('does not mark timeline planned, now that Wave 6 built it', () => {
    renderLtr(<CustomerProfileScreen locale="en" messages={en} customer={CUSTOMER} />);
    const timeline = screen.getByRole('button', { name: /Timeline/ });
    expect(timeline.textContent).not.toContain(en['nav.planned']);
  });
});

describe('Arabic', () => {
  it('has an Arabic string for every vocabulary key the constraints admit', () => {
    // A missing Arabic key renders the raw key to an Arabic-speaking operator.
    // Enumerated from the CHECK constraints, not from the en.json file, so a
    // key missing from BOTH locales still fails here.
    const required = [
      ...['transactional', 'marketing', 'reminder'].map((v) => `crm.purpose.${v}`),
      ...['privacy', 'marketing'].map((v) => `crm.consentKind.${v}`),
      ...['granted', 'withdrawn', 'expired'].map((v) => `crm.consentStatus.${v}`),
      ...['public', 'internal', 'restricted', 'secret'].map((v) => `crm.noteClassification.${v}`),
      ...['info', 'warning', 'critical'].map((v) => `crm.severity.${v}`),
      ...['operational', 'financial', 'safety', 'other'].map((v) => `crm.alertType.${v}`),
      ...['no_credit', 'prepay_only', 'no_service', 'contact_restriction', 'other'].map(
        (v) => `crm.restrictionType.${v}`
      ),
    ];
    const missing = required.filter((k) => !(k in ar) || !(k in en));
    expect(missing).toEqual([]);
  });
});
