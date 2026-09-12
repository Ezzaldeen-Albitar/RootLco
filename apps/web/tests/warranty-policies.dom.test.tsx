import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';

/**
 * The warranty plan administration screens, rendered (P1-31, FE-008).
 *
 * The properties under test: both route pages decide before they read and both are
 * gated on the READ code rather than on the administration one; every control that
 * changes a plan is absent without `wty.policy.manage`, and its absence is measured
 * rather than assumed; a refusal is drawn as a refusal and never as an empty list; a
 * write sends the record version off the row it is acting on, and the window's version
 * is never the plan's; a mutation re-reads and the screen shows what came back; a stale
 * view offers a reload and an overlap does not, because only one of the two is cleared
 * by reading again; the distance allowance stays an exact string with no arithmetic
 * anywhere near it; and every word on screen comes from the catalogue in both reading
 * directions.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

/*
 * A required control's `<label>` carries a decorative asterisk, so its label text is
 * the catalogue string PLUS a character the catalogue does not hold. Anchoring at the
 * start matches the label without asserting the marker, which is a styling decision
 * rather than a property of these screens.
 */
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);

const listWarrantyPolicies = vi.fn();
const readWarrantyPolicy = vi.fn();
const listBranches = vi.fn();
const createWarrantyPolicy = vi.fn();
const renameWarrantyPolicy = vi.fn();
const setWarrantyPolicyStatus = vi.fn();
const createCoverageWindow = vi.fn();
const setCoverageWindowStatus = vi.fn();
vi.mock('@/features/warranty/warranty-api', () => ({
  listWarrantyPolicies: (...args: unknown[]) => listWarrantyPolicies(...args),
  readWarrantyPolicy: (...args: unknown[]) => readWarrantyPolicy(...args),
  listBranches: (...args: unknown[]) => listBranches(...args),
  createWarrantyPolicy: (...args: unknown[]) => createWarrantyPolicy(...args),
  renameWarrantyPolicy: (...args: unknown[]) => renameWarrantyPolicy(...args),
  setWarrantyPolicyStatus: (...args: unknown[]) => setWarrantyPolicyStatus(...args),
  createCoverageWindow: (...args: unknown[]) => createCoverageWindow(...args),
  setCoverageWindowStatus: (...args: unknown[]) => setCoverageWindowStatus(...args),
}));

let PERMISSIONS: readonly string[] = [];
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({ permissions: PERMISSIONS, email: 'advisor@test.local' }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

type ListPage = (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
type DetailPage = (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>;

const PolicyListPage = (await import('@/app/[locale]/(dashboard)/warranty/policies/page'))
  .default as unknown as ListPage;
const PolicyDetailPage = (
  await import('@/app/[locale]/(dashboard)/warranty/policies/[policyId]/page')
).default as unknown as DetailPage;

const READ = 'wty.warranty.read';
const MANAGE = 'wty.policy.manage';

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const POLICY_ID = '88888888-8888-4888-8888-888888888888';
const COVERAGE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RETIRED_COVERAGE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** The plan's own version. Four, so a one-off cannot pass by coincidence. */
const POLICY_VERSION = 4;
/** The window's own version, deliberately different from the plan's. */
const COVERAGE_VERSION = 9;

const policy = {
  id: POLICY_ID,
  companyId: COMPANY_ID,
  policyCode: 'standard_12',
  name: 'Standard cover',
  status: 'active',
  recordVersion: POLICY_VERSION,
};

const coverage = {
  id: COVERAGE_ID,
  policyId: POLICY_ID,
  coveredScope: 'all',
  durationMonths: 12,
  // An exact decimal string, as the wire carries it. Nothing on these screens turns
  // it into a number, so the trailing precision must survive the render.
  odometerAllowance: '20000.0',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  status: 'active',
  recordVersion: COVERAGE_VERSION,
};

const retiredCoverage = {
  ...coverage,
  id: RETIRED_COVERAGE_ID,
  coveredScope: 'part',
  odometerAllowance: null,
  effectiveFrom: '2025-01-01',
  effectiveTo: '2026-01-01',
  status: 'archived',
  recordVersion: 2,
};

const detail = { policy, coverage: [coverage, retiredCoverage] };

const policyPage = (items: readonly unknown[], hasMore = false, nextCursor: string | null = null) =>
  ({
    status: 'ok' as const,
    data: { policies: { items, nextCursor, hasMore } },
    correlationId: 'corr-1',
  }) as unknown;

const refusedRead = (status: string) => ({ status, correlationId: 'corr-9' }) as unknown;

const succeeded = (messageKey: string) => ({ status: 'success', messageKey, attempt: 1 });

beforeEach(() => {
  PERMISSIONS = [READ];
  listWarrantyPolicies.mockReset();
  readWarrantyPolicy.mockReset();
  listBranches.mockReset();
  createWarrantyPolicy.mockReset();
  renameWarrantyPolicy.mockReset();
  setWarrantyPolicyStatus.mockReset();
  createCoverageWindow.mockReset();
  setCoverageWindowStatus.mockReset();

  listWarrantyPolicies.mockResolvedValue(policyPage([policy]));
  readWarrantyPolicy.mockResolvedValue({ status: 'ok', data: detail, correlationId: 'corr-1' });
  listBranches.mockResolvedValue({ status: 'denied', correlationId: 'corr-9' });
  createWarrantyPolicy.mockResolvedValue({
    ...succeeded('warranty.policies.created'),
    policy,
  });
  renameWarrantyPolicy.mockResolvedValue(succeeded('warranty.policies.renamed'));
  setWarrantyPolicyStatus.mockResolvedValue(succeeded('warranty.policies.statusChanged'));
  createCoverageWindow.mockResolvedValue(succeeded('warranty.policies.coverageAdded'));
  setCoverageWindowStatus.mockResolvedValue(succeeded('warranty.policies.coverageStatusChanged'));
});

async function renderListPage(locale = 'en') {
  const tree = await PolicyListPage({ params: Promise.resolve({ locale }) });
  return locale === 'ar'
    ? renderRtl(tree as React.ReactElement)
    : renderLtr(tree as React.ReactElement);
}

async function renderDetailPage(locale = 'en') {
  const tree = await PolicyDetailPage({
    params: Promise.resolve({ locale, policyId: POLICY_ID }),
  });
  return locale === 'ar'
    ? renderRtl(tree as React.ReactElement)
    : renderLtr(tree as React.ReactElement);
}

describe('both route pages decide before they read', () => {
  it('refuses the plan list without the read code, and asks the backend for nothing', async () => {
    PERMISSIONS = [];
    await renderListPage();
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeInTheDocument();
    expect(listWarrantyPolicies).not.toHaveBeenCalled();
  });

  it('refuses one plan without the read code, and never reads it', async () => {
    PERMISSIONS = [];
    await renderDetailPage();
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeInTheDocument();
    expect(readWarrantyPolicy).not.toHaveBeenCalled();
  });

  it('admits a reader who holds no administration code at all', async () => {
    // The page is gated on the READ code because the two plan reads are. Gating it on
    // the administration code would hide from a warranty clerk a list the backend is
    // willing to show them.
    PERMISSIONS = [READ];
    await renderDetailPage();
    await waitFor(() => expect(readWarrantyPolicy).toHaveBeenCalledWith(POLICY_ID));
    expect(screen.getByText('Standard cover')).toBeInTheDocument();
  });
});

describe('the plan list', () => {
  it('names each plan, its reference, its state and its company', async () => {
    await renderListPage();
    await waitFor(() => expect(listWarrantyPolicies).toHaveBeenCalled());
    expect(screen.getByRole('link', { name: 'Standard cover' })).toHaveAttribute(
      'href',
      `/en/warranty/policies/${POLICY_ID}`
    );
    // Scoped to the table: the state vocabulary also fills the filter control above
    // it, and a bare text query would pass on the control while the row said nothing.
    const rows = within(screen.getByRole('table'));
    expect(rows.getByText('standard_12')).toBeInTheDocument();
    expect(rows.getByText(EN['warranty.configurationStatus.active'] as string)).toBeInTheDocument();
    expect(rows.getByText(COMPANY_ID)).toBeInTheDocument();
  });

  it('asks for every plan by default, retired ones included', async () => {
    // A retired plan keeps its reference and restoring it is a command this surface
    // offers, so an administration list that hid them could not reach it.
    await renderListPage();
    await waitFor(() => expect(listWarrantyPolicies).toHaveBeenCalled());
    expect(listWarrantyPolicies.mock.calls[0]?.[0]).toEqual({});
  });

  it('narrows to one state through the filter the route publishes', async () => {
    const user = userEvent.setup();
    await renderListPage();
    await waitFor(() => expect(listWarrantyPolicies).toHaveBeenCalled());
    await user.selectOptions(
      screen.getByRole('combobox', { name: EN['warranty.policies.stateField'] as string }),
      'archived'
    );
    await waitFor(() => expect(listWarrantyPolicies).toHaveBeenCalledWith({ status: 'archived' }));
  });

  it('draws a refused list as a refusal rather than as no plans at all', async () => {
    // The single most misleading thing a permission-gated list can do is render
    // "you may not see these" exactly like "there are none".
    listWarrantyPolicies.mockResolvedValue(refusedRead('denied'));
    await renderListPage();
    await waitFor(() =>
      expect(screen.getByText(EN['state.denied.title'] as string)).toBeInTheDocument()
    );
    expect(screen.queryByText(EN['warranty.policies.noneTitle'] as string)).toBeNull();
  });

  it('says the set is empty when it really is', async () => {
    listWarrantyPolicies.mockResolvedValue(policyPage([]));
    await renderListPage();
    await waitFor(() =>
      expect(screen.getByText(EN['warranty.policies.noneTitle'] as string)).toBeInTheDocument()
    );
  });
});

describe('creating a plan is drawn on the administration code and on nothing else', () => {
  it('offers no form to a reader who cannot manage plans', async () => {
    PERMISSIONS = [READ];
    await renderListPage();
    await waitFor(() => expect(listWarrantyPolicies).toHaveBeenCalled());
    expect(
      screen.queryByRole('form', { name: EN['warranty.policies.createFormLabel'] as string })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: EN['warranty.policies.createSubmit'] as string })
    ).toBeNull();
  });

  it('sends the company, the reference and the name, and nothing else', async () => {
    PERMISSIONS = [READ, MANAGE];
    const user = userEvent.setup();
    await renderListPage();
    await user.type(
      screen.getByRole('textbox', { name: labelled('warranty.common.companyIdField') }),
      COMPANY_ID
    );
    await user.type(
      screen.getByRole('textbox', { name: labelled('warranty.policies.codeField') }),
      'standard_12'
    );
    await user.type(
      screen.getByRole('textbox', { name: labelled('warranty.policies.nameField') }),
      'Standard cover'
    );
    await user.click(
      screen.getByRole('button', { name: EN['warranty.policies.createSubmit'] as string })
    );
    await waitFor(() => expect(createWarrantyPolicy).toHaveBeenCalled());
    expect(createWarrantyPolicy.mock.calls[0]?.[0]).toEqual({
      companyId: COMPANY_ID,
      policyCode: 'standard_12',
      name: 'Standard cover',
    });
  });

  it('refuses a malformed reference in the control rather than in a request', async () => {
    PERMISSIONS = [READ, MANAGE];
    const user = userEvent.setup();
    await renderListPage();
    await user.type(
      screen.getByRole('textbox', { name: labelled('warranty.common.companyIdField') }),
      COMPANY_ID
    );
    await user.type(
      screen.getByRole('textbox', { name: labelled('warranty.policies.codeField') }),
      'Not A Code'
    );
    await user.type(
      screen.getByRole('textbox', { name: labelled('warranty.policies.nameField') }),
      'Standard cover'
    );
    await user.click(
      screen.getByRole('button', { name: EN['warranty.policies.createSubmit'] as string })
    );
    expect(
      await screen.findByText(EN['warranty.policies.codeFormat'] as string)
    ).toBeInTheDocument();
    expect(createWarrantyPolicy).not.toHaveBeenCalled();
  });

  it('reads the list again after a plan is created, and links to what came back', async () => {
    // Nothing is inserted into the rows on screen from the request that was sent.
    PERMISSIONS = [READ, MANAGE];
    const user = userEvent.setup();
    await renderListPage();
    await waitFor(() => expect(listWarrantyPolicies).toHaveBeenCalledTimes(1));
    await user.type(
      screen.getByRole('textbox', { name: labelled('warranty.common.companyIdField') }),
      COMPANY_ID
    );
    await user.type(
      screen.getByRole('textbox', { name: labelled('warranty.policies.codeField') }),
      'standard_12'
    );
    await user.type(
      screen.getByRole('textbox', { name: labelled('warranty.policies.nameField') }),
      'Standard cover'
    );
    await user.click(
      screen.getByRole('button', { name: EN['warranty.policies.createSubmit'] as string })
    );
    await waitFor(() => expect(listWarrantyPolicies).toHaveBeenCalledTimes(2));
    expect(
      screen.getByRole('link', { name: EN['warranty.policies.openCreated'] as string })
    ).toHaveAttribute('href', `/en/warranty/policies/${POLICY_ID}`);
  });

  it('reports a refused creation with the sentence its cause earned', async () => {
    PERMISSIONS = [READ, MANAGE];
    createWarrantyPolicy.mockResolvedValue({
      status: 'conflict',
      code: 'ERR-CON-001',
      rule: 'duplicate_code',
      attempt: 1,
    });
    const user = userEvent.setup();
    await renderListPage();
    await user.type(
      screen.getByRole('textbox', { name: labelled('warranty.common.companyIdField') }),
      COMPANY_ID
    );
    await user.type(
      screen.getByRole('textbox', { name: labelled('warranty.policies.codeField') }),
      'standard_12'
    );
    await user.type(
      screen.getByRole('textbox', { name: labelled('warranty.policies.nameField') }),
      'Standard cover'
    );
    await user.click(
      screen.getByRole('button', { name: EN['warranty.policies.createSubmit'] as string })
    );
    expect(
      await screen.findByText(EN['warranty.policies.refusedDuplicateCode'] as string)
    ).toBeInTheDocument();
  });
});

describe('one plan, and the controls over it', () => {
  it('shows the terms exactly as the server stated them', async () => {
    await renderDetailPage();
    await waitFor(() => expect(readWarrantyPolicy).toHaveBeenCalled());
    // The exact decimal string, trailing precision intact. A number would print
    // 20000 and nothing on screen would say a digit had been dropped.
    expect(screen.getByText('20000.0')).toBeInTheDocument();
    expect(screen.getByText(EN['warranty.coveredScope.all'] as string)).toBeInTheDocument();
    expect(
      screen.getByText(EN['warranty.coverage.unlimitedDistance'] as string)
    ).toBeInTheDocument();
    expect(screen.getByText(EN['warranty.coverage.openEnded'] as string)).toBeInTheDocument();
  });

  it('draws no control that changes anything without the administration code', async () => {
    PERMISSIONS = [READ];
    await renderDetailPage();
    await waitFor(() => expect(readWarrantyPolicy).toHaveBeenCalled());
    expect(
      screen.queryByRole('button', { name: EN['warranty.policies.renameSubmit'] as string })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: EN['warranty.policies.retirePlan'] as string })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: EN['warranty.policies.addCoverageSubmit'] as string })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: EN['warranty.policies.retireWindow'] as string })
    ).toBeNull();
  });

  it('renames against the plan version it was rendered from, and reads again', async () => {
    PERMISSIONS = [READ, MANAGE];
    const user = userEvent.setup();
    await renderDetailPage();
    await waitFor(() => expect(readWarrantyPolicy).toHaveBeenCalledTimes(1));
    const field = screen.getByRole('textbox', { name: labelled('warranty.policies.nameField') });
    await user.clear(field);
    await user.type(field, 'Extended cover');
    await user.click(
      screen.getByRole('button', { name: EN['warranty.policies.renameSubmit'] as string })
    );
    await waitFor(() => expect(renameWarrantyPolicy).toHaveBeenCalled());
    expect(renameWarrantyPolicy.mock.calls[0]).toEqual([
      POLICY_ID,
      { name: 'Extended cover' },
      POLICY_VERSION,
    ]);
    // Every mutation re-reads, so what is shown afterwards is the server's answer and
    // the next command gets a version nobody inferred.
    await waitFor(() => expect(readWarrantyPolicy).toHaveBeenCalledTimes(2));
  });

  it('offers a reload for a stale view, because that is the refusal reading again clears', async () => {
    PERMISSIONS = [READ, MANAGE];
    renameWarrantyPolicy.mockResolvedValue({
      status: 'conflict',
      code: 'ERR-CON-001',
      attempt: 1,
    });
    const user = userEvent.setup();
    await renderDetailPage();
    await waitFor(() => expect(readWarrantyPolicy).toHaveBeenCalledTimes(1));
    await user.click(
      screen.getByRole('button', { name: EN['warranty.policies.renameSubmit'] as string })
    );
    expect(
      await screen.findByText(EN['warranty.policies.refusedStale'] as string)
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: EN['warranty.policies.reload'] as string })
    );
    await waitFor(() => expect(readWarrantyPolicy).toHaveBeenCalledTimes(2));
  });

  it('offers no reload for an overlap, because reading again would not clear it', async () => {
    PERMISSIONS = [READ, MANAGE];
    setCoverageWindowStatus.mockResolvedValue({
      status: 'conflict',
      code: 'ERR-CON-001',
      rule: 'overlapping_coverage',
      attempt: 1,
    });
    const user = userEvent.setup();
    await renderDetailPage();
    await waitFor(() => expect(readWarrantyPolicy).toHaveBeenCalled());
    await user.click(
      screen.getAllByRole('button', {
        name: EN['warranty.policies.retireWindow'] as string,
      })[0] as HTMLElement
    );
    expect(
      await screen.findByText(EN['warranty.policies.refusedOverlap'] as string)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: EN['warranty.policies.reload'] as string })
    ).toBeNull();
  });

  it('retires the plan against the plan version, and reads again', async () => {
    PERMISSIONS = [READ, MANAGE];
    const user = userEvent.setup();
    await renderDetailPage();
    await waitFor(() => expect(readWarrantyPolicy).toHaveBeenCalledTimes(1));
    await user.click(
      screen.getByRole('button', { name: EN['warranty.policies.retirePlan'] as string })
    );
    await waitFor(() => expect(setWarrantyPolicyStatus).toHaveBeenCalled());
    expect(setWarrantyPolicyStatus.mock.calls[0]).toEqual([
      POLICY_ID,
      { status: 'archived' },
      POLICY_VERSION,
    ]);
    // The handler that spends the version renews it: the plan is read again before
    // anything else can be commanded against the version this one just consumed.
    await waitFor(() => expect(readWarrantyPolicy).toHaveBeenCalledTimes(2));
  });

  it('sends a window state against THAT window version, and reads again', async () => {
    PERMISSIONS = [READ, MANAGE];
    const user = userEvent.setup();
    await renderDetailPage();
    await waitFor(() => expect(readWarrantyPolicy).toHaveBeenCalledTimes(1));
    await user.click(
      screen.getAllByRole('button', {
        name: EN['warranty.policies.retireWindow'] as string,
      })[0] as HTMLElement
    );
    await waitFor(() => expect(setCoverageWindowStatus).toHaveBeenCalled());
    expect(setCoverageWindowStatus.mock.calls[0]).toEqual([
      POLICY_ID,
      COVERAGE_ID,
      { status: 'archived' },
      COVERAGE_VERSION,
    ]);
    // The window version this handler spent is renewed the same way, and off the
    // same read: the plan is read whole and every row on it comes back with it.
    await waitFor(() => expect(readWarrantyPolicy).toHaveBeenCalledTimes(2));
  });

  it('offers the retired window a restore rather than a second retirement', async () => {
    PERMISSIONS = [READ, MANAGE];
    const user = userEvent.setup();
    await renderDetailPage();
    await waitFor(() => expect(readWarrantyPolicy).toHaveBeenCalled());
    await user.click(
      screen.getByRole('button', { name: EN['warranty.policies.restoreWindow'] as string })
    );
    await waitFor(() => expect(setCoverageWindowStatus).toHaveBeenCalled());
    expect(setCoverageWindowStatus.mock.calls[0]).toEqual([
      POLICY_ID,
      RETIRED_COVERAGE_ID,
      { status: 'active' },
      2,
    ]);
  });

  it('adds a window and keeps the distance a string, with no arithmetic on the way', async () => {
    PERMISSIONS = [READ, MANAGE];
    const user = userEvent.setup();
    await renderDetailPage();
    await waitFor(() => expect(readWarrantyPolicy).toHaveBeenCalled());

    await user.type(
      screen.getByRole('textbox', { name: labelled('warranty.coverage.durationMonths') }),
      '24'
    );
    await user.type(
      screen.getByRole('textbox', { name: labelled('warranty.coverage.odometerAllowance') }),
      '30000'
    );
    fireEvent.change(screen.getByLabelText(labelled('warranty.coverage.effectiveFrom')), {
      target: { value: '2026-02-01' },
    });
    await user.click(
      screen.getByRole('button', { name: EN['warranty.policies.addCoverageSubmit'] as string })
    );
    await waitFor(() => expect(createCoverageWindow).toHaveBeenCalled());
    const body = createCoverageWindow.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body['odometerAllowance']).toBe('30000');
    expect(typeof body['odometerAllowance']).toBe('string');
    // A count of months is not a measurement, and the route takes it as a whole number.
    expect(body['durationMonths']).toBe(24);
    expect(body['effectiveFrom']).toBe('2026-02-01');
    // Omitted rather than sent empty: an absent end date is what "still in force" means.
    expect(body).not.toHaveProperty('effectiveTo');
    // And this handler re-reads too, so the window that came back is the server’s row
    // rather than the one this side sent.
    await waitFor(() => expect(readWarrantyPolicy).toHaveBeenCalledTimes(2));
  });

  it('refuses an inverted window in the control, the way the database refuses it', async () => {
    PERMISSIONS = [READ, MANAGE];
    const user = userEvent.setup();
    await renderDetailPage();
    await waitFor(() => expect(readWarrantyPolicy).toHaveBeenCalled());
    await user.type(
      screen.getByRole('textbox', { name: labelled('warranty.coverage.durationMonths') }),
      '24'
    );
    fireEvent.change(screen.getByLabelText(labelled('warranty.coverage.effectiveFrom')), {
      target: { value: '2026-02-01' },
    });
    fireEvent.change(screen.getByLabelText(labelled('warranty.coverage.effectiveTo')), {
      target: { value: '2026-01-01' },
    });
    await user.click(
      screen.getByRole('button', { name: EN['warranty.policies.addCoverageSubmit'] as string })
    );
    expect(
      await screen.findByText(EN['warranty.policies.endAfterStart'] as string)
    ).toBeInTheDocument();
    expect(createCoverageWindow).not.toHaveBeenCalled();
  });

  it('refuses a distance that is not a whole number, without parsing it', async () => {
    PERMISSIONS = [READ, MANAGE];
    const user = userEvent.setup();
    await renderDetailPage();
    await waitFor(() => expect(readWarrantyPolicy).toHaveBeenCalled());
    await user.type(
      screen.getByRole('textbox', { name: labelled('warranty.coverage.durationMonths') }),
      '24'
    );
    await user.type(
      screen.getByRole('textbox', { name: labelled('warranty.coverage.odometerAllowance') }),
      '30000.5'
    );
    fireEvent.change(screen.getByLabelText(labelled('warranty.coverage.effectiveFrom')), {
      target: { value: '2026-02-01' },
    });
    await user.click(
      screen.getByRole('button', { name: EN['warranty.policies.addCoverageSubmit'] as string })
    );
    expect(
      await screen.findByText(EN['warranty.policies.distanceRange'] as string)
    ).toBeInTheDocument();
    expect(createCoverageWindow).not.toHaveBeenCalled();
  });

  it('reports a read that failed after a write instead of blanking the plan', async () => {
    PERMISSIONS = [READ, MANAGE];
    const user = userEvent.setup();
    await renderDetailPage();
    await waitFor(() => expect(readWarrantyPolicy).toHaveBeenCalledTimes(1));
    readWarrantyPolicy.mockResolvedValue(refusedRead('unavailable'));
    await user.click(
      screen.getByRole('button', { name: EN['warranty.policies.retirePlan'] as string })
    );
    expect(
      await screen.findByText(EN['warranty.policies.rereadFailed'] as string, { exact: false })
    ).toBeInTheDocument();
    // The write may well have succeeded, so the plan already read stays on screen.
    expect(screen.getByText('Standard cover')).toBeInTheDocument();
  });
});

describe('every word comes from the catalogue, in both reading directions', () => {
  it('names the plan list in Arabic', async () => {
    await renderListPage('ar');
    await waitFor(() => expect(listWarrantyPolicies).toHaveBeenCalled());
    expect(screen.getByText(AR['warranty.policies.listHeading'] as string)).toBeInTheDocument();
    expect(
      within(screen.getByRole('table')).getByText(
        AR['warranty.configurationStatus.active'] as string
      )
    ).toBeInTheDocument();
  });

  it('names one plan and its terms in Arabic', async () => {
    PERMISSIONS = [READ, MANAGE];
    await renderDetailPage('ar');
    await waitFor(() => expect(readWarrantyPolicy).toHaveBeenCalled());
    expect(screen.getByText(AR['warranty.policies.coverageHeading'] as string)).toBeInTheDocument();
    expect(
      within(screen.getByRole('table')).getByText(AR['warranty.coveredScope.all'] as string)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: AR['warranty.policies.retirePlan'] as string })
    ).toBeInTheDocument();
    // The identifier and the distance are not language and stay as they are.
    expect(screen.getByText('20000.0')).toBeInTheDocument();
  });
});
