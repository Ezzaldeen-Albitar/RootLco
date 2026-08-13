import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import type { ReceptionDetail } from '@/features/receptions/receptions-contract';

/**
 * `P1-28-FE-017` — the media notice, rendered, and the ban proved in the DOM
 * (`TC-P1-28-REC-009`).
 *
 * The source twin (`p1-28-reception-media.test.ts`) proves no capture construct
 * exists in the tree. This file proves the other half, which source alone cannot
 * reach: that the screens an operator actually meets — the check-in start
 * screen, every registered wizard step, and the walk-in intake — put **no**
 * upload or camera affordance on the page, in either language, and that where a
 * photograph would have been attached there is instead a statement naming
 * `P1-OD-025`.
 *
 * ## Why both halves are needed
 *
 * A rendered-DOM sweep can only see the branch it rendered, so a control behind
 * an unrendered condition is invisible to it. A source sweep can only see text,
 * so a control assembled at runtime is invisible to that. Neither is sufficient;
 * the pair is.
 *
 * ## The sweep asserts it swept something
 *
 * Every sweep first asserts the page rendered controls at all. Without that, a
 * failed render would report "no upload affordance found" — a vacuous pass on
 * the one claim this wave exists to make.
 */

/* --- adapter mocks (the transport is not what is under test) --------------- */

const createReception = vi.fn();
const listReceptions = vi.fn();
const readReception = vi.fn();
const listPartyRoles = vi.fn();
const listAuthorizations = vi.fn();
const assignPartyRole = vi.fn();
const recordAuthorization = vi.fn();

vi.mock('@/features/receptions/api', () => ({
  createReception: (...args: unknown[]) => createReception(...args),
  listReceptions: (...args: unknown[]) => listReceptions(...args),
  readReception: (...args: unknown[]) => readReception(...args),
  listPartyRoles: (...args: unknown[]) => listPartyRoles(...args),
  listAuthorizations: (...args: unknown[]) => listAuthorizations(...args),
  assignPartyRole: (...args: unknown[]) => assignPartyRole(...args),
  recordAuthorization: (...args: unknown[]) => recordAuthorization(...args),
}));

const listConfirmedAppointments = vi.fn();
const listReceivingEmployeeCandidates = vi.fn();
const readCustomerSummary = vi.fn();
const readVehicleSummary = vi.fn();
const listVehicleRelationshipEntries = vi.fn();

vi.mock('@/features/receptions/support-api', () => ({
  listConfirmedAppointments: (...args: unknown[]) => listConfirmedAppointments(...args),
  listReceivingEmployeeCandidates: (...args: unknown[]) => listReceivingEmployeeCandidates(...args),
  readCustomerSummary: (...args: unknown[]) => readCustomerSummary(...args),
  readVehicleSummary: (...args: unknown[]) => readVehicleSummary(...args),
  listVehicleRelationshipEntries: (...args: unknown[]) => listVehicleRelationshipEntries(...args),
}));

const listCustomerVehicles = vi.fn();
vi.mock('@/lib/customers/vehicles', () => ({
  listCustomerVehicles: (...args: unknown[]) => listCustomerVehicles(...args),
}));

const searchCustomerDirectory = vi.fn();
vi.mock('@/lib/customers/directory', () => ({
  searchCustomerDirectory: (...args: unknown[]) => searchCustomerDirectory(...args),
}));

const createIndividualAction = vi.fn();
const createCompanyAction = vi.fn();
vi.mock('@/features/crm/customers/creation-actions', () => ({
  createIndividualAction: (...args: unknown[]) => createIndividualAction(...args),
  createCompanyAction: (...args: unknown[]) => createCompanyAction(...args),
}));

const searchVehicles = vi.fn();
const createVehicleAction = vi.fn();
vi.mock('@/features/vehicles/api', () => ({
  searchVehicles: (...args: unknown[]) => searchVehicles(...args),
  createVehicleAction: (...args: unknown[]) => createVehicleAction(...args),
}));

const linkCustomerAction = vi.fn();
vi.mock('@/features/vehicles/relations-api', () => ({
  linkCustomerAction: (...args: unknown[]) => linkCustomerAction(...args),
}));

const { MediaDecisionNotice } = await import('@/features/receptions/media/MediaDecisionNotice');
const { MEDIA_DECISION_ID, MEDIA_SURFACE_KEYS } =
  await import('@/features/receptions/media/media-decision');
const { CheckInStartScreen } = await import('@/features/receptions/components/CheckInStartScreen');
const { CheckInWizardShell } = await import('@/features/receptions/components/CheckInWizardShell');
const { CHECK_IN_STEPS } = await import('@/features/receptions/check-in/steps');
const { WalkInIntakeScreen } =
  await import('@/features/receptions/intake/components/WalkInIntakeScreen');

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

/* --- fixtures -------------------------------------------------------------- */

function page<Row>(rows: readonly Row[]) {
  return { status: 'ok' as const, rows, nextCursor: null, hasMore: false, correlationId: 'corr' };
}

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
};

function startProps(messages: typeof en) {
  return {
    locale: messages === en ? ('en' as const) : ('ar' as const),
    messages,
    sessionUserId: 'user-1',
    sessionUserName: 'Front Desk',
    companyIds: ['company-1'],
    branchIds: ['branch-1'],
    canCreate: true,
    canListAppointments: true,
    canPickEmployee: false,
    canSearchCustomers: true,
    fuelLevels: { status: 'ok' as const, options: [], truncated: false, correlationId: null },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listReceptions.mockResolvedValue(page([]));
  listConfirmedAppointments.mockResolvedValue(page([]));
  listCustomerVehicles.mockResolvedValue(page([]));
  listPartyRoles.mockResolvedValue(page([]));
  listAuthorizations.mockResolvedValue(page([]));
  listVehicleRelationshipEntries.mockResolvedValue(page([]));
  searchCustomerDirectory.mockResolvedValue(page([]));
  searchVehicles.mockResolvedValue(page([]));
  readReception.mockResolvedValue({ status: 'ok', data: DETAIL, correlationId: 'corr-read' });
  readCustomerSummary.mockResolvedValue({
    status: 'ok',
    data: {
      id: 'partner-1',
      displayNumber: 'C-0001',
      displayName: 'Layla Haddad',
      partyType: 'individual',
      lifecycleStatus: 'active',
    },
    correlationId: 'corr-cust',
  });
  readVehicleSummary.mockResolvedValue({
    status: 'ok',
    data: {
      id: 'veh-9',
      displayNumber: 'V-9',
      vin: '1HGCM82633A004352',
      makeName: 'Alpha',
      modelName: 'Runner',
      modelYear: 2021,
      color: 'White',
      lifecycleStatus: 'active',
      workshopStatus: 'none',
      mergedIntoId: null,
    },
    correlationId: 'corr-veh',
  });
});

/* --- the sweep ------------------------------------------------------------- */

/**
 * Every element that is, or carries, a way to hand a file to the application.
 *
 * `[accept]` and `[capture]` are attribute selectors rather than element ones on
 * purpose: a wrapper component that forwarded either onto a div would be an
 * upload affordance the `input[type="file"]` selector never sees.
 */
const CAPTURE_SELECTORS = [
  'input[type="file"]',
  'input[type="image"]',
  '[accept]',
  '[capture]',
  'video',
  'canvas',
  '[draggable="true"]',
] as const;

/**
 * Names that OFFER capture, in both languages.
 *
 * Deliberately verbs and devices, never subjects: the step is legitimately
 * called "Photographs and media" / "الصور والوسائط", and a pattern that banned
 * the noun would ban the notice's own signposting — which is the thing an
 * operator needs in order to find the statement at all.
 */
const OFFERS_CAPTURE =
  /upload|attach|browse|choose a file|take a photo|camera|scanner|رفع|إرفاق|مرفق|كاميرا|التقط/i;

function sweep(where: string): void {
  for (const selector of CAPTURE_SELECTORS) {
    expect(document.body.querySelectorAll(selector).length, `${where} renders ${selector}`).toBe(0);
  }

  const controls = Array.from(
    document.body.querySelectorAll(
      'button, a, label, input, select, textarea, [role="button"], [role="link"]'
    )
  );
  expect(
    controls.length,
    `${where} rendered no control at all — this sweep measured nothing`
  ).toBeGreaterThan(0);

  for (const control of controls) {
    const name = [
      control.textContent ?? '',
      control.getAttribute('aria-label') ?? '',
      control.getAttribute('title') ?? '',
      control.getAttribute('placeholder') ?? '',
      control.getAttribute('name') ?? '',
    ].join(' ');
    expect(name, `${where} offers capture: ${control.outerHTML.slice(0, 140)}`).not.toMatch(
      OFFERS_CAPTURE
    );
  }
}

/* ------------------------------------------------------------------ *
 * The notice itself
 * ------------------------------------------------------------------ */

describe('P1-28-FE-017 — the named-open-decision notice', () => {
  it('states the block, names P1-OD-025, and says what the Owner must decide (English)', () => {
    renderLtr(
      <MediaDecisionNotice
        locale="en"
        messages={en}
        surface="reception-evidence"
        headingId="notice-heading"
      />
    );

    expect(screen.getByRole('note', { name: EN['receptions.media.heading']! })).toBeInTheDocument();
    expect(screen.getByText(EN['receptions.media.blocked']!)).toBeInTheDocument();
    // The decision identifier itself, not a paraphrase of it.
    expect(screen.getByText(MEDIA_DECISION_ID)).toBeInTheDocument();
    expect(screen.getByText(MEDIA_DECISION_ID)).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText(EN['receptions.media.decideHeading']!)).toBeInTheDocument();
    for (const key of [
      'receptions.media.decide.set',
      'receptions.media.decide.formats',
      'receptions.media.decide.storage',
      'receptions.media.decide.enforcement',
    ]) {
      expect(screen.getByText(EN[key]!), key).toBeInTheDocument();
    }
    // What will exist once decided, and the honest ceiling of the chain.
    expect(screen.getByText(EN['receptions.media.afterDecision']!)).toBeInTheDocument();
    expect(screen.getByText(EN['receptions.media.ceiling']!)).toBeInTheDocument();
  });

  it('renders in Arabic, right-to-left, with the identifier still left-to-right', () => {
    renderRtl(
      <MediaDecisionNotice
        locale="ar"
        messages={ar}
        surface="reception-evidence"
        headingId="notice-heading"
      />
    );

    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('note', { name: AR['receptions.media.heading']! })).toBeInTheDocument();
    expect(screen.getByText(AR['receptions.media.blocked']!)).toBeInTheDocument();
    expect(screen.getByText(AR['receptions.media.ceiling']!)).toBeInTheDocument();
    // A reference reads the same way in every locale, so it is pinned LTR.
    expect(screen.getByText(MEDIA_DECISION_ID)).toHaveAttribute('dir', 'ltr');
  });

  it('says what specifically is blocked on each of the three surfaces', () => {
    /*
     * One decision, three surfaces: the evidence area (`FE-017`), the damage-map
     * template document (`FE-012`) and the signature image (`FE-018`). Each
     * states its own block, and states only its own — a shared component that
     * said the same sentence three times would leave two waves explaining
     * themselves in prose nobody reads.
     */
    for (const [surface, key] of Object.entries(MEDIA_SURFACE_KEYS)) {
      const { unmount } = renderLtr(
        <MediaDecisionNotice
          locale="en"
          messages={en}
          surface={surface as keyof typeof MEDIA_SURFACE_KEYS}
          headingId="notice-heading"
        />
      );
      expect(screen.getByText(EN[key]!), surface).toBeInTheDocument();
      for (const other of Object.values(MEDIA_SURFACE_KEYS)) {
        if (other === key) continue;
        expect(screen.queryByText(EN[other]!), `${surface} also claims ${other}`).toBeNull();
      }
      unmount();
    }
  });

  it('has no critical or serious accessibility violation, in both directions', async () => {
    for (const [render, messages, locale] of [
      [renderLtr, en, 'en'],
      [renderRtl, ar, 'ar'],
    ] as const) {
      const { container, unmount } = render(
        <MediaDecisionNotice
          locale={locale}
          messages={messages}
          surface="reception-evidence"
          headingId="notice-heading"
        />
      );
      const results = (await axe(container, {
        runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
      } as never)) as unknown as {
        violations: readonly { id: string; impact: string | null }[];
      };
      expect(
        results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious'),
        locale
      ).toEqual([]);
      unmount();
    }
  });
});

/* ------------------------------------------------------------------ *
 * The ban, in the DOM the operator actually gets
 * ------------------------------------------------------------------ */

describe('P1-28-FE-017 — no upload affordance anywhere on the reception surface', () => {
  it('the sweep is capable of failing — a planted affordance is caught', () => {
    /*
     * The control case. Without it every assertion below reduces to "the sweep
     * found nothing", which is equally true of a sweep that looks at nothing.
     */
    renderLtr(
      <div>
        <button type="button">Choose</button>
        <input type="file" aria-label="Upload a photograph" />
      </div>
    );
    expect(() => sweep('planted')).toThrow();
  });

  it('offers none on the check-in start screen, in either language', async () => {
    for (const [render, messages, label] of [
      [renderLtr, en, 'check-in start (en)'],
      [renderRtl, ar, 'check-in start (ar)'],
    ] as const) {
      const { unmount } = render(<CheckInStartScreen {...startProps(messages)} />);
      sweep(label);
      unmount();
    }
    await Promise.resolve();
  });

  it('offers none on ANY registered wizard step — every step is visited', async () => {
    const user = userEvent.setup();
    renderLtr(
      <CheckInWizardShell
        locale="en"
        messages={en}
        initialDetail={DETAIL}
        steps={CHECK_IN_STEPS}
        capabilities={CAPABILITIES}
      />
    );

    // Guards the walk: a registry that shrank to nothing would make the loop
    // below sweep a single step and report the whole wizard clean.
    expect(CHECK_IN_STEPS.length).toBeGreaterThanOrEqual(3);

    for (const step of CHECK_IN_STEPS) {
      await user.click(screen.getByRole('button', { name: new RegExp(EN[step.titleKey]!) }));
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: EN[step.titleKey]! })).toBeInTheDocument();
      });
      sweep(`wizard step ${step.id}`);
    }
  });

  it('offers none on the walk-in intake screen', () => {
    renderLtr(
      <WalkInIntakeScreen
        locale="en"
        messages={en}
        canCreateCustomer
        canSearchVehicles
        canCreateVehicle
        canLinkVehicle
        checkInAvailable={false}
      />
    );
    sweep('walk-in intake');
  });

  it('puts the notice where the photographs would have gone, and nothing else', async () => {
    const user = userEvent.setup();
    renderLtr(
      <CheckInWizardShell
        locale="en"
        messages={en}
        initialDetail={DETAIL}
        steps={CHECK_IN_STEPS}
        capabilities={CAPABILITIES}
      />
    );

    await user.click(
      screen.getByRole('button', { name: new RegExp(EN['receptions.steps.media.title']!) })
    );
    const notice = await screen.findByRole('note', { name: EN['receptions.media.heading']! });
    expect(notice).toBeInTheDocument();
    expect(screen.getByText(MEDIA_DECISION_ID)).toBeInTheDocument();
    // Inside the notice: no control at all, not even a disabled one.
    expect(
      notice.querySelectorAll('button, input, form, a, select, textarea, [role="button"]').length
    ).toBe(0);
  });

  it('shows the same notice on a terminal visit — the block is the release, not the state', async () => {
    /*
     * `converted` withdraws every write control in the wizard. It must not
     * withdraw this statement: an operator reading a converted visit is owed the
     * same account of why there are no photographs as one reading an open visit.
     */
    const user = userEvent.setup();
    renderLtr(
      <CheckInWizardShell
        locale="en"
        messages={en}
        initialDetail={{ ...DETAIL, receptionStatus: 'converted' }}
        steps={CHECK_IN_STEPS}
        capabilities={CAPABILITIES}
      />
    );

    await user.click(
      screen.getByRole('button', { name: new RegExp(EN['receptions.steps.media.title']!) })
    );
    expect(
      await screen.findByRole('note', { name: EN['receptions.media.heading']! })
    ).toBeInTheDocument();
    expect(screen.getByText(EN['receptions.media.blocked']!)).toBeInTheDocument();
    sweep('wizard media step on a terminal visit');
  });
});
