import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { formatDate, formatDateTime, formatInteger, intlLocale } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { BOTH_DIRECTIONS, renderLtr, renderRtl } from './render';

/**
 * The Platform Owner Console screens (P1-32-PRE-069).
 *
 * The properties under test:
 *
 *   - the organisation list sends the search term as `q` only when submitted,
 *     and pages by the server's cursor;
 *   - the detail shows usage against the plan, says "unlimited" when there is no
 *     limit and warns from 90%, and offers each action only to an operator whose
 *     platform authority could satisfy it;
 *   - the subscription dialog sends the act as `kind` and the term as a whole
 *     number of months;
 *   - billing shows the server's outstanding figure, submits money as a
 *     canonical decimal STRING, and reaches the charges behind the page by the
 *     server's own cursor under the status filter the operation publishes;
 *   - the overview labels the projected renewal value as an estimate, apart from
 *     the recorded amounts;
 *   - provisioning sends what was typed, offers a subscription only when the
 *     plan catalogue could be read, and offers activation only to an operator
 *     holding the lifecycle authority;
 *   - the plan catalogue sends a price as a decimal STRING, a term as whole
 *     months and a blank limit as no limit at all, and guards an edit by the
 *     version the operator was looking at;
 *   - the activity search opens on the window it was given and applies its
 *     criteria together.
 *   - the three list screens on Material UI — the organisations, the plan
 *     catalogue and the activity search — draw the rows the read returned, in
 *     English and in Arabic, with no code or reference cut without a sign; say
 *     an empty answer, a refusal and a failure each as itself; page by the
 *     server's cursor; and the activity search opens one entry whole, every
 *     field in words where there are words and as recorded beside them.
 *   - account and security validates each password field before it asks the
 *     server, reveals each field on its own, states what the server reported
 *     about the operator's other devices, and tells the two server refusals
 *     apart on screen.
 *
 * Every business value below is a test value invented for this file.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;
/** A catalogued English message, typed as present: a missing key fails the lookup visibly. */
const L = (key: string): string => EN[key] ?? `missing message ${key}`;

const apiGet = vi.fn();
vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: async () => ({ get: apiGet }),
}));

const refresh = vi.fn();
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => mockPathname,
  // The console shell's language switcher carries safe query parameters; an
  // empty set is the honest default for the one case that renders the shell.
  useSearchParams: () => new URLSearchParams(''),
}));

/*
 * The console stays outside tenant context, proven at RENDER level (route sweep
 * B3 review).
 *
 * A console operator has no working branch. A source scan for a direct import
 * of the working context misses a console screen that reaches it through a
 * shared component, so every working-context hook refuses in this file: each
 * console screen and the console shell below renders with no provider above it
 * and would throw here the moment any of them — directly or through anything
 * it renders — asked for a branch.
 */
vi.mock('@/features/working-context/WorkingContextProvider', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/working-context/WorkingContextProvider')>();
  const refuse = (name: string) => () => {
    throw new Error(`a console surface called ${name}; the console has no working context`);
  };
  return {
    ...actual,
    useWorkingContext: refuse('useWorkingContext'),
    useUnsavedGuard: refuse('useUnsavedGuard'),
    useWorkingContextChange: refuse('useWorkingContextChange'),
  };
});

const platformPermissions = vi.hoisted(() => ({ codes: [] as string[] }));
vi.mock('@/features/platform/api/session', () => ({
  requirePlatformSession: async () => ({ platformPermissions: platformPermissions.codes }),
}));

/**
 * The address the route boundaries read their language from.
 *
 * A constant here would have made the three boundary files untestable in the
 * only respect they exist for: `loading.tsx`, `error.tsx` and `not-found.tsx`
 * are given no props by Next, so the locale can only come from the path
 * (P1-26-F-059, P1-26-F-071). Every case resets it to the English console
 * address in `beforeEach`.
 */
let mockPathname = '/en/platform';

const assignSubscriptionAction = vi.fn();
const cancelSubscriptionAction = vi.fn();
const recordChargeAction = vi.fn();
const recordReceiptAction = vi.fn();
const voidChargeAction = vi.fn();
const changeOrganizationStatusAction = vi.fn();
const provisionOrganizationAction = vi.fn();
const createPlanAction = vi.fn();
const updatePlanAction = vi.fn();
const changeOwnPasswordAction = vi.fn();
vi.mock('@/features/platform/actions', () => ({
  /*
   * P1-32-PRE-068. This module holds only the writes, and every one is stood in
   * for. The organisation list and the activity search live in
   * `features/platform/table-reads.ts`, which is not replaced: this suite drives
   * their real implementation through the replaced HTTP client above.
   */
  assignSubscriptionAction: (...args: unknown[]) => assignSubscriptionAction(...args),
  cancelSubscriptionAction: (...args: unknown[]) => cancelSubscriptionAction(...args),
  recordChargeAction: (...args: unknown[]) => recordChargeAction(...args),
  recordReceiptAction: (...args: unknown[]) => recordReceiptAction(...args),
  voidChargeAction: (...args: unknown[]) => voidChargeAction(...args),
  changeOrganizationStatusAction: (...args: unknown[]) => changeOrganizationStatusAction(...args),
  provisionOrganizationAction: (...args: unknown[]) => provisionOrganizationAction(...args),
  createPlanAction: (...args: unknown[]) => createPlanAction(...args),
  updatePlanAction: (...args: unknown[]) => updatePlanAction(...args),
  changeOwnPasswordAction: (...args: unknown[]) => changeOwnPasswordAction(...args),
}));

const { OrganizationsScreen } = await import('@/features/platform/components/OrganizationsScreen');
const { OrganizationDetailScreen } =
  await import('@/features/platform/components/OrganizationDetailScreen');
const { BillingPanel } = await import('@/features/platform/components/BillingPanel');
const { PlatformOverview } = await import('@/features/platform/components/PlatformOverview');
const { ProvisionOrganizationScreen } =
  await import('@/features/platform/components/ProvisionOrganizationScreen');
const { PlansScreen } = await import('@/features/platform/components/PlansScreen');
const { PlatformAuditScreen } = await import('@/features/platform/components/PlatformAuditScreen');
const { AccountSecurityScreen } =
  await import('@/features/platform/components/AccountSecurityScreen');
const { getMessages } = await import('@/i18n/get-messages');

const messages = getMessages('en');

/**
 * Under the Material foundation, as the locale layout mounts it: the grid's and
 * the pickers' own texts come from the catalogue through it. It reads no
 * working context, so the refusal above still stands over everything rendered.
 */
function withMui(ui: ReactElement, locale: 'en' | 'ar' = 'en'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(getMessages(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}

const escapeText = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A control whose label starts with these words (a required mark may follow). */
const labelledBy = (words: string) => new RegExp(`^${escapeText(words)}`);

/**
 * Types a day into a day picker, part by part: day, month, year, the order
 * both languages write one. The picker is a group of parts named by its label.
 *
 * Whatever the picker held is cleared first — every part selected, then
 * Backspace — so the digits are typed into blank parts. Typed straight over a
 * day already held, a first digit other than zero did not take in this
 * environment (`15` over a held day came out as `01`); cleared first, every
 * day does.
 */
async function typeDay(scope: HTMLElement, label: string, digits: string) {
  const user = userEvent.setup();
  const group = within(scope).getByRole('group', { name: labelledBy(label) });
  await user.click(within(group).getAllByRole('spinbutton')[0] as HTMLElement);
  await user.keyboard('{Control>}a{/Control}');
  await user.keyboard('{Backspace}');
  await user.keyboard(digits);
  return group;
}

/** Text with every run of white space as one space, so a formatted moment compares. */
const flat = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

/** The data rows of a grid: every row but the header's. */
function dataRows(grid: HTMLElement): HTMLElement[] {
  return within(grid)
    .getAllByRole('row')
    .filter((candidate) => candidate.hasAttribute('data-id'));
}

const TENANT = '11111111-1111-4111-8111-111111111111';
/** Two more organisations, for the expiry window cases on the overview. */
const OTHER_TENANT = '11111111-1111-4111-8111-111111111112';
const THIRD_TENANT = '11111111-1111-4111-8111-111111111113';
const SUBSCRIPTION = '22222222-2222-4222-8222-222222222222';
const PLAN = '33333333-3333-4333-8333-333333333333';
const CHARGE = '44444444-4444-4444-8444-444444444444';

const row = {
  id: TENANT,
  tenantCode: 'test_org_one',
  displayName: 'Test Organisation One',
  status: 'active',
  defaultLocale: 'ar',
  defaultTimezone: 'Asia/Riyadh',
  createdAt: '2026-09-01T08:00:00.000Z',
  activePlanCode: 'test_plan',
  activePlanEffectiveTo: '2027-08-31',
  activeCompanyCount: 1,
  activeBranchCount: 2,
  activeUserCount: 3,
};

const subscription = {
  id: SUBSCRIPTION,
  planId: PLAN,
  planCode: 'test_plan',
  planName: 'Test Plan',
  status: 'active',
  effectiveFrom: '2026-09-01',
  effectiveTo: '2027-08-31',
  recordVersion: 1,
};

const plan = {
  id: PLAN,
  planCode: 'test_plan',
  name: 'Test Plan',
  displayName: 'Test Plan',
  description: null,
  status: 'active',
  listPrice: '1200.0000',
  currencyCode: 'SAR',
  termMonths: 12,
  entitlementDocument: {},
  capacityLimits: { companies: 1, users: 10 },
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  recordVersion: 1,
};

const detail = {
  id: TENANT,
  tenantCode: 'test_org_one',
  displayName: 'Test Organisation One',
  status: 'active',
  defaultLocale: 'ar',
  defaultTimezone: 'Asia/Riyadh',
  createdAt: '2026-09-01T08:00:00.000Z',
  companies: [{ id: 'c1', code: 'test_company', legalName: 'Test Company', status: 'active' }],
  branches: [
    { id: 'b1', companyId: 'c1', code: 'test_branch', name: 'Test Branch', status: 'active' },
  ],
  userCountsByStatus: [{ status: 'active', count: 9 }],
  subscriptions: [subscription],
  subscriptionEvents: [],
  statusHistory: [],
  capacity: {
    companies: { used: 1, limit: 1 },
    branches: { used: 2, limit: null },
    users: { used: 5, limit: 10 },
  },
};

const charge = {
  id: CHARGE,
  subscriptionId: SUBSCRIPTION,
  amount: '1200.0000',
  currencyCode: 'SAR',
  dueOn: '2026-09-15',
  description: 'Test annual charge',
  status: 'open',
  voidReason: null,
  outstanding: '700.0000',
  recordVersion: 1,
  recordedAt: '2026-09-01T08:00:00.000Z',
  receipts: [
    {
      id: 'r1',
      chargeId: CHARGE,
      amount: '500.0000',
      currencyCode: 'SAR',
      receivedOn: '2026-09-05',
      reference: null,
      method: 'Bank transfer',
      notes: null,
      recordedAt: '2026-09-05T08:00:00.000Z',
    },
  ],
};

const ALL = {
  canChangeLifecycle: true,
  canManageOrganization: true,
  canManageSubscription: true,
  canReadBilling: true,
  canManageBilling: true,
  canReadAudit: true,
};
const NONE = {
  canChangeLifecycle: false,
  canManageOrganization: false,
  canManageSubscription: false,
  canReadBilling: false,
  canManageBilling: false,
  canReadAudit: false,
};

/**
 * What a list read can answer besides rows, and the state each is drawn as.
 * `retry` is whether trying again can change the answer.
 */
const READ_OUTCOMES = [
  {
    name: 'an empty answer',
    answer: {
      ok: true as const,
      data: { items: [], nextCursor: null, hasMore: false },
      correlationId: 'c-empty',
    },
    testId: 'state-empty',
    title: 'state.empty.title',
    retry: false,
  },
  {
    name: 'a refusal',
    answer: { ok: false as const, kind: 'forbidden', correlationId: 'c-refused' },
    testId: 'state-refused',
    title: 'state.denied.title',
    retry: false,
  },
  {
    name: 'a failure',
    answer: { ok: false as const, kind: 'server', correlationId: 'c-failed' },
    testId: 'state-error',
    title: 'state.error.title',
    retry: true,
  },
  {
    name: 'an outage',
    answer: { ok: false as const, kind: 'unavailable', correlationId: 'c-outage' },
    testId: 'state-unavailable',
    title: 'state.unavailable.title',
    retry: true,
  },
];

/** Every outcome, in both languages. */
const ORGANIZATION_READ_OUTCOMES = BOTH_DIRECTIONS.flatMap(([locale, paint]) =>
  READ_OUTCOMES.map((outcome) => ({ locale, paint, ...outcome }))
);

/** The outcomes that are failures, in both languages. */
const ACTIVITY_READ_FAILURES = ORGANIZATION_READ_OUTCOMES.filter((outcome) => !outcome.answer.ok);

beforeEach(() => {
  mockPathname = '/en/platform';
  apiGet.mockReset();
  refresh.mockReset();
  push.mockReset();
  assignSubscriptionAction.mockReset();
  cancelSubscriptionAction.mockReset();
  recordChargeAction.mockReset();
  recordReceiptAction.mockReset();
  voidChargeAction.mockReset();
  changeOrganizationStatusAction.mockReset();
  provisionOrganizationAction.mockReset();
  createPlanAction.mockReset();
  updatePlanAction.mockReset();
  changeOwnPasswordAction.mockReset();
  // The default answer for the account form: a change the server accepted and
  // whose other-device sign-out it reported. A case that needs another answer
  // replaces it before it renders.
  changeOwnPasswordAction.mockResolvedValue({
    status: 'success',
    messageKey: 'platform.account.done',
    attempt: 1,
  });
});

describe('the organisation list', () => {
  it('sends the search term as q only when it is submitted', async () => {
    apiGet.mockResolvedValue({
      ok: true,
      data: { items: [row], nextCursor: null, hasMore: false },
      correlationId: 'c',
    });
    renderLtr(
      withMui(<OrganizationsScreen locale="en" messages={messages} canProvision={false} />)
    );
    await screen.findByText('Test Organisation One');
    expect(String(apiGet.mock.calls[0]?.[0])).not.toContain('q=');

    const box = screen.getByRole('searchbox', {
      name: new RegExp(L('platform.organizations.search')),
    });
    await userEvent.type(box, 'garage');
    expect(apiGet).toHaveBeenCalledTimes(1);

    await userEvent.click(
      screen.getByRole('button', { name: L('platform.organizations.searchSubmit') })
    );
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    const path = String(apiGet.mock.calls[1]?.[0]);
    expect(path.startsWith('/api/v1/platform/organizations?')).toBe(true);
    expect(new URLSearchParams(path.split('?')[1]).get('q')).toBe('garage');
    expect(screen.queryByRole('link', { name: L('platform.organizations.new') })).toBeNull();
  });

  it('pages by the cursor the server returned', async () => {
    apiGet
      .mockResolvedValueOnce({
        ok: true,
        data: { items: [row], nextCursor: 'cursor-two', hasMore: true },
        correlationId: 'c',
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          items: [{ ...row, id: 'x2', displayName: 'Test Organisation Two' }],
          nextCursor: null,
          hasMore: false,
        },
        correlationId: 'c',
      });
    renderLtr(withMui(<OrganizationsScreen locale="en" messages={messages} canProvision />));
    await screen.findByText('Test Organisation One');
    expect(screen.getByRole('link', { name: L('platform.organizations.new') })).toHaveAttribute(
      'href',
      '/en/platform/organizations/new'
    );

    await userEvent.click(screen.getByRole('button', { name: L('table.nextPage') }));
    await screen.findByText('Test Organisation Two');
    const path = String(apiGet.mock.calls[1]?.[0]);
    expect(new URLSearchParams(path.split('?')[1]).get('cursor')).toBe('cursor-two');
  });

  /*
   * On Material UI. The rows are the page the read returned and nothing else:
   * one page is asked for, from the start, and every value of a row is on
   * screen in the reader's language. A code longer than its column is cut by
   * the cell's own ellipsis and keeps its whole text behind it.
   */
  it.each(BOTH_DIRECTIONS)(
    '%s: draws each organisation of the page it read, with its code and its plan code whole',
    async (locale, paint) => {
      const catalogue = getMessages(locale);
      const words = catalogue as Record<string, string>;
      const longCode = `test_org_${'x'.repeat(50)}`;
      const second = {
        ...row,
        id: OTHER_TENANT,
        tenantCode: longCode,
        displayName: 'Test Organisation Two',
        status: 'suspended',
        activePlanCode: null,
        activePlanEffectiveTo: null,
        activeCompanyCount: 4,
        activeBranchCount: 5,
        activeUserCount: 1234,
      };
      apiGet.mockResolvedValue({
        ok: true,
        data: { items: [row, second], nextCursor: null, hasMore: false },
        correlationId: 'c',
      });
      paint(
        withMui(
          <OrganizationsScreen locale={locale} messages={catalogue} canProvision={false} />,
          locale
        )
      );

      const grid = await screen.findByRole('grid', {
        name: words['platform.organizations.title'] as string,
      });
      await within(grid).findByText('Test Organisation One');
      expect(document.documentElement.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr');

      const asked = new URLSearchParams(String(apiGet.mock.calls[0]?.[0]).split('?')[1]);
      expect(asked.get('limit')).toBe('25');
      expect(asked.get('cursor')).toBeNull();
      expect(apiGet).toHaveBeenCalledTimes(1);

      for (const column of [
        'name',
        'code',
        'status',
        'plan',
        'ends',
        'companies',
        'branches',
        'users',
      ]) {
        expect(
          within(grid).getByRole('columnheader', {
            name: words[`platform.organizations.column.${column}`] as string,
          })
        ).toBeInTheDocument();
      }

      const rows = dataRows(grid);
      expect(rows).toHaveLength(2);
      const [first, other] = rows as [HTMLElement, HTMLElement];
      expect(within(first).getByRole('link', { name: 'Test Organisation One' })).toHaveAttribute(
        'href',
        `/${locale}/platform/organizations/${TENANT}`
      );
      expect(within(first).getByText('test_org_one')).toBeInTheDocument();
      expect(
        within(first).getByText(words['platform.status.active'] as string)
      ).toBeInTheDocument();
      expect(within(first).getByText('test_plan')).toBeInTheDocument();
      expect(within(first).getByText(formatDate('2027-08-31', locale))).toBeInTheDocument();

      // The long code is in the document whole, and the line that may cut it
      // on screen carries the whole of it.
      const code = within(other).getByText(longCode);
      expect(code.closest('[data-grid-line]')).toHaveAttribute('title', longCode);
      expect(
        within(other).getByText(words['platform.status.suspended'] as string)
      ).toBeInTheDocument();
      expect(
        within(other).getByText(words['platform.organizations.noPlan'] as string)
      ).toBeInTheDocument();
      expect(within(other).getByText(formatInteger(1234, locale))).toBeInTheDocument();
    }
  );

  /*
   * One state is never drawn as another: an empty answer, a refusal, a failure
   * and an outage each say what they are, in both languages. A refusal draws no
   * grid at all, and a retry is offered only where trying again can change the
   * answer.
   */
  it.each(ORGANIZATION_READ_OUTCOMES)(
    '$locale: says $name as itself when the organisations are read',
    async ({ locale, paint, answer, testId, title, retry }) => {
      const catalogue = getMessages(locale);
      const words = catalogue as Record<string, string>;
      apiGet.mockResolvedValue(answer);
      paint(
        withMui(
          <OrganizationsScreen locale={locale} messages={catalogue} canProvision={false} />,
          locale
        )
      );

      const state = await screen.findByTestId(testId);
      expect(within(state).getByRole('heading')).toHaveTextContent(words[title] as string);
      for (const outcome of READ_OUTCOMES) {
        if (outcome.testId !== testId) expect(screen.queryByTestId(outcome.testId)).toBeNull();
      }
      expect(screen.queryByRole('link', { name: 'Test Organisation One' })).toBeNull();
      if (!answer.ok) {
        expect(screen.queryByRole('grid')).toBeNull();
        expect(within(state).getByText(answer.correlationId)).toBeInTheDocument();
      }

      const again = within(state).queryByRole('button', { name: words['state.retry'] as string });
      if (!retry) {
        expect(again).toBeNull();
        return;
      }
      await userEvent.click(again as HTMLElement);
      await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    }
  );

  /*
   * An ended session is said as itself and offers no link to bare sign-in. The
   * console's own session check sends an ended session to the session-ended
   * route with the page it was on; a link from here would skip that, so the
   * list offers none, as the organisation page's billing read already does.
   */
  it.each(BOTH_DIRECTIONS)(
    '%s: says an ended session as itself when the organisations are read, with no sign-in link',
    async (locale, paint) => {
      const catalogue = getMessages(locale);
      const words = catalogue as Record<string, string>;
      apiGet.mockResolvedValue({ ok: false, kind: 'unauthenticated', correlationId: 'c-ended' });
      paint(
        withMui(
          <OrganizationsScreen locale={locale} messages={catalogue} canProvision={false} />,
          locale
        )
      );

      const state = await screen.findByTestId('state-expired');
      expect(within(state).getByRole('heading')).toHaveTextContent(
        words['state.expired.title'] as string
      );
      expect(within(state).queryByRole('link')).toBeNull();
      expect(screen.queryByRole('link', { name: words['auth.backToLogin'] as string })).toBeNull();
      expect(document.querySelector(`a[href^="/${locale}/login"]`)).toBeNull();
      expect(
        within(state).queryByRole('button', { name: words['state.retry'] as string })
      ).toBeNull();
      expect(screen.queryByRole('grid')).toBeNull();
    }
  );

  it('asks for a chosen status from the first page, says when none matches, and clears it', async () => {
    const page = (items: readonly unknown[]) => ({
      ok: true,
      data: { items, nextCursor: null, hasMore: false },
      correlationId: 'c',
    });
    apiGet
      .mockResolvedValueOnce(page([row]))
      .mockResolvedValueOnce(page([]))
      .mockResolvedValue(page([row]));
    renderLtr(
      withMui(<OrganizationsScreen locale="en" messages={messages} canProvision={false} />)
    );
    await screen.findByText('Test Organisation One');

    await userEvent.selectOptions(
      within(screen.getByRole('search')).getByLabelText(
        labelledBy(L('platform.organizations.column.status'))
      ),
      'suspended'
    );
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    const narrowed = new URLSearchParams(String(apiGet.mock.calls[1]?.[0]).split('?')[1]);
    expect(narrowed.get('status')).toBe('suspended');
    expect(narrowed.get('cursor')).toBeNull();

    // The filter is named in words, and a narrowed read that matched nothing
    // is "no matches", never "nothing here yet".
    expect(
      await screen.findByText(
        new RegExp(
          `${L('platform.organizations.column.status')}: ${L('platform.status.suspended')}`
        )
      )
    ).toBeInTheDocument();
    const none = await screen.findByTestId('state-no-results');
    expect(within(none).getByRole('heading')).toHaveTextContent(L('state.noResults.title'));
    expect(screen.queryByTestId('state-empty')).toBeNull();

    await userEvent.click(within(none).getByRole('button', { name: L('table.clearFilters') }));
    await screen.findByText('Test Organisation One');
    const cleared = new URLSearchParams(String(apiGet.mock.calls[2]?.[0]).split('?')[1]);
    expect(cleared.get('status')).toBeNull();
    expect(cleared.get('q')).toBeNull();
  });
});

describe('the organisation detail', () => {
  it('shows usage against the plan, unlimited where there is no limit, and warns from 90%', () => {
    renderLtr(
      <OrganizationDetailScreen
        locale="en"
        messages={messages}
        organization={detail}
        plans={[plan]}
        charges={null}
        capabilities={NONE}
        today="2026-09-16"
      />
    );
    const companies = screen.getByTestId('platform-usage-companies');
    expect(companies).toHaveAttribute('data-warning', 'true');
    expect(within(companies).getByText(L('platform.usage.warning'))).toBeInTheDocument();

    const branches = screen.getByTestId('platform-usage-branches');
    expect(branches).toHaveAttribute('data-warning', 'false');
    expect(
      within(branches).getByText(new RegExp(L('platform.usage.unlimited')))
    ).toBeInTheDocument();
    expect(within(branches).queryByRole('meter')).toBeNull();

    const users = screen.getByTestId('platform-usage-users');
    expect(users).toHaveAttribute('data-warning', 'false');
    expect(within(users).getByRole('meter')).toHaveAttribute('aria-valuenow', '5');
  });

  it('offers no action to an operator holding no write authority', () => {
    renderLtr(
      <OrganizationDetailScreen
        locale="en"
        messages={messages}
        organization={detail}
        plans={null}
        charges={{
          status: 'ok',
          data: { items: [charge], nextCursor: null, hasMore: false },
          correlationId: null,
        }}
        capabilities={NONE}
        today="2026-09-16"
      />
    );
    for (const key of [
      'platform.lifecycle.suspend',
      'platform.lifecycle.close',
      'platform.subscription.act.renewed',
      'platform.subscription.act.cancel',
      'platform.billing.recordCharge',
      'platform.detail.viewAudit',
    ]) {
      expect(screen.queryByRole('button', { name: L(key) }), key).toBeNull();
    }
    expect(screen.queryByText(L('platform.billing.title'))).toBeNull();
  });

  it('offers each action to an operator holding its authority', () => {
    renderLtr(
      withMui(
        <OrganizationDetailScreen
          locale="en"
          messages={messages}
          organization={detail}
          plans={[plan]}
          charges={{
            status: 'ok',
            data: { items: [charge], nextCursor: null, hasMore: false },
            correlationId: null,
          }}
          capabilities={ALL}
          today="2026-09-16"
        />
      )
    );
    for (const key of [
      'platform.lifecycle.suspend',
      'platform.lifecycle.close',
      'platform.subscription.act.renewed',
      'platform.subscription.act.upgraded',
      'platform.subscription.act.downgraded',
      'platform.subscription.act.cancel',
      'platform.billing.recordCharge',
    ]) {
      expect(screen.getByRole('button', { name: L(key) }), key).toBeInTheDocument();
    }
    // A charge's own acts are the billing table's row buttons, whose names
    // carry the charge they act on after the label (P1-32-PRE-OD-WP06B).
    for (const key of ['platform.billing.recordReceipt', 'platform.billing.void']) {
      expect(screen.getByRole('button', { name: labelledBy(L(key)) }), key).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: L('platform.lifecycle.reactivate') })).toBeNull();
    expect(screen.getByRole('link', { name: L('platform.detail.viewAudit') })).toHaveAttribute(
      'href',
      `/en/platform/audit?organization=${TENANT}`
    );
  });

  it('draws a refused billing read as a refusal, not as an organisation with no charges', async () => {
    renderLtr(
      <OrganizationDetailScreen
        locale="en"
        messages={messages}
        organization={detail}
        plans={null}
        charges={{ status: 'denied', correlationId: 'corr-9' }}
        capabilities={{ ...NONE, canReadBilling: true }}
        today="2026-09-16"
      />
    );
    // The section is still there — the operator may read billing — and it says
    // the read was refused. "No charges" would be a false statement about the
    // organisation rather than about the read.
    expect(screen.getByText(L('platform.billing.title'))).toBeInTheDocument();
    expect(screen.getByText(L('state.denied.title') as string)).toBeInTheDocument();
    expect(screen.queryByTestId('platform-charge')).toBeNull();
  });

  it('lists the status history, with the first entry arriving from no earlier state', () => {
    renderLtr(
      <OrganizationDetailScreen
        locale="en"
        messages={messages}
        organization={{
          ...detail,
          statusHistory: [
            {
              occurredAt: '2026-09-10T09:00:00.000Z',
              fromState: null,
              toState: 'active',
              reason: null,
            },
            {
              occurredAt: '2026-09-14T09:00:00.000Z',
              fromState: 'active',
              toState: 'suspended',
              reason: 'Payment overdue',
            },
          ],
        }}
        plans={null}
        charges={null}
        capabilities={NONE}
        today="2026-09-16"
      />
    );
    // The status history is the operational grid since P1-32-PRE-OD-WP06B.
    const history = screen.getByRole('grid', { name: L('platform.detail.statusHistory') });
    expect(within(history).getByText('Payment overdue')).toBeInTheDocument();
    expect(within(history).getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(within(history).getAllByText(L('platform.status.suspended')).length).toBe(1);
  });

  it('shows the server refusal of a lifecycle change inside the dialog', async () => {
    changeOrganizationStatusAction.mockResolvedValue({
      status: 'denied',
      messageKey: 'state.denied.title',
      correlationId: 'corr-1',
      attempt: 1,
    });
    renderLtr(
      <OrganizationDetailScreen
        locale="en"
        messages={messages}
        organization={detail}
        plans={null}
        charges={null}
        capabilities={{ ...NONE, canChangeLifecycle: true }}
        today="2026-09-16"
      />
    );
    await userEvent.click(screen.getByRole('button', { name: L('platform.lifecycle.suspend') }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Test reason');
    await userEvent.click(
      within(dialog).getByRole('button', { name: L('platform.lifecycle.suspend') })
    );
    await waitFor(() =>
      expect(changeOrganizationStatusAction).toHaveBeenCalledWith(
        TENANT,
        'suspended',
        'Test reason'
      )
    );
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      L('state.denied.title') as string
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('the subscription dialog', () => {
  it('sends the act as kind and the term as whole months', async () => {
    assignSubscriptionAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.subscription.done',
      attempt: 1,
    });
    renderLtr(
      withMui(
        <OrganizationDetailScreen
          locale="en"
          messages={messages}
          organization={detail}
          plans={[plan]}
          charges={null}
          capabilities={{ ...NONE, canManageSubscription: true }}
          today="2026-09-16"
        />
      )
    );
    await userEvent.click(
      screen.getByRole('button', { name: L('platform.subscription.act.upgraded') })
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.subscription.plan')}`)),
      'test_plan'
    );
    // A day picker since P1-32-PRE-OD-WP06B2, typed part by part.
    await typeDay(dialog, L('platform.subscription.starts'), '01102026');
    await userEvent.selectOptions(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.subscription.term')}$`)),
      '24'
    );
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.reason')}`)),
      'More branches'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));

    await waitFor(() => expect(assignSubscriptionAction).toHaveBeenCalledTimes(1));
    const [tenantId, input] = assignSubscriptionAction.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(tenantId).toBe(TENANT);
    expect(input).toEqual({
      planCode: 'test_plan',
      effectiveFrom: '2026-10-01',
      termMonths: 24,
      kind: 'upgraded',
      reason: 'More branches',
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  /**
   * Owner directive, user-facing errors. A subscription change that names the
   * plan already in force is a real mistake with a real cure, and the console
   * reported it as the generic 'this record cannot take that change'. The
   * service now names the rule beside the plan control, and the dialog renders
   * the sentence it selects, which says what to do instead — record a renewal.
   *
   * The mocked state is the one the wire actually produces, and nothing more.
   * The service files the rule under `body.planCode`, so `violationKeysOf`
   * routes it to the plan control and the banner keeps the generic conflict
   * sentence; an earlier version of this case also set `messageKey` to the
   * specific key and so asserted a state the pipeline cannot build. The
   * assertion is therefore on the plan control's own error line, which is the
   * place an operator would actually read it.
   */
  it('states why a plan change was refused, in words the operator can act on', async () => {
    assignSubscriptionAction.mockResolvedValue({
      status: 'conflict',
      messageKey: 'state.conflict.title',
      fieldErrors: { planCode: 'form.violation.platform_change_needs_different_plan' },
      correlationId: 'corr-same-plan',
      attempt: 1,
    });
    renderLtr(
      withMui(
        <OrganizationDetailScreen
          locale="en"
          messages={messages}
          organization={detail}
          plans={[plan]}
          charges={null}
          capabilities={{ ...NONE, canManageSubscription: true }}
          today="2026-09-16"
        />
      )
    );
    await userEvent.click(
      screen.getByRole('button', { name: L('platform.subscription.act.upgraded') })
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.subscription.plan')}`)),
      'test_plan'
    );
    await typeDay(dialog, L('platform.subscription.starts'), '01102026');
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.reason')}`)),
      'Wrong plan chosen'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));

    await waitFor(() => expect(assignSubscriptionAction).toHaveBeenCalledTimes(1));
    const select = within(dialog).getByLabelText(new RegExp(`^${L('platform.subscription.plan')}`));
    const said = await within(dialog).findByText(
      L('form.violation.platform_change_needs_different_plan') as string
    );
    expect(said).toBeVisible();
    // Tied to the control, not merely present somewhere in the dialog: the
    // error line is what the select points at, so a screen reader reaches it
    // from the field.
    expect(select.getAttribute('aria-describedby') ?? '').toContain(said.id);
    expect(select).toHaveAttribute('aria-invalid', 'true');
    // The rule name itself never reaches the screen; only its sentence does.
    expect(dialog.textContent).not.toContain('platform_change_needs_different_plan');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('accepts a free number of months', async () => {
    assignSubscriptionAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.subscription.done',
      attempt: 1,
    });
    renderLtr(
      withMui(
        <OrganizationDetailScreen
          locale="en"
          messages={messages}
          organization={detail}
          plans={[plan]}
          charges={null}
          capabilities={{ ...NONE, canManageSubscription: true }}
          today="2026-09-16"
        />
      )
    );
    await userEvent.click(
      screen.getByRole('button', { name: L('platform.subscription.act.renewed') })
    );
    const dialog = await screen.findByRole('dialog');
    await typeDay(dialog, L('platform.subscription.starts'), '01092027');
    await userEvent.selectOptions(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.subscription.term')}$`)),
      'other'
    );
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.subscription.termMonths')}`)),
      '18'
    );
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.reason')}`)),
      'Renewal'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));
    await waitFor(() => expect(assignSubscriptionAction).toHaveBeenCalledTimes(1));
    const input = assignSubscriptionAction.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(input).toMatchObject({ kind: 'renewed', termMonths: 18, planCode: 'test_plan' });
    expect(typeof input.termMonths).toBe('number');
    // The whole document, key for key, as the form sent it before Material UI.
    expect(input).toEqual({
      planCode: 'test_plan',
      effectiveFrom: '2027-09-01',
      termMonths: 18,
      kind: 'renewed',
      reason: 'Renewal',
    });
  });

  it('cancels the subscription the operator was looking at, on the date and reason given', async () => {
    cancelSubscriptionAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.subscription.cancelled',
      attempt: 1,
    });
    renderLtr(
      withMui(
        <OrganizationDetailScreen
          locale="en"
          messages={messages}
          organization={detail}
          plans={[plan]}
          charges={null}
          capabilities={{ ...NONE, canManageSubscription: true }}
          today="2026-09-16"
        />
      )
    );
    await userEvent.click(
      screen.getByRole('button', { name: L('platform.subscription.act.cancel') })
    );
    const dialog = await screen.findByRole('dialog');
    await typeDay(dialog, L('platform.subscription.ends'), '31122026');
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.reason')}`)),
      'Not renewing'
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: L('platform.subscription.act.cancel') })
    );

    await waitFor(() => expect(cancelSubscriptionAction).toHaveBeenCalledTimes(1));
    // The identifier comes from the subscription the panel was showing, never
    // from anything typed: there is no control here that could carry one.
    expect(cancelSubscriptionAction).toHaveBeenCalledWith(TENANT, SUBSCRIPTION, {
      effectiveTo: '2026-12-31',
      reason: 'Not renewing',
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe('billing', () => {
  it('shows the server outstanding figure and submits a receipt as a decimal string', async () => {
    recordReceiptAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.billing.receiptDone',
      attempt: 1,
    });
    renderLtr(
      withMui(
        <BillingPanel
          locale="en"
          messages={messages}
          tenantId={TENANT}
          charges={[charge]}
          hasMore={false}
          subscriptions={[subscription]}
          canManage
          defaultCurrency="SAR"
        />
      )
    );
    expect(screen.getByTestId('platform-outstanding')).toHaveTextContent('700.00 SAR');

    // A row action: its name carries the charge after the label.
    await userEvent.click(
      screen.getByRole('button', { name: labelledBy(L('platform.billing.recordReceipt')) })
    );
    const dialog = await screen.findByRole('dialog');
    const amount = within(dialog).getByLabelText(new RegExp(`^${L('platform.billing.amount')}`));
    await userEvent.type(amount, '150.5');
    fireEvent.blur(amount);
    // The Material money field keeps showing what was typed and reports the
    // canonical string upward (`FormMoneyField`, DF-6); the old field rewrote
    // the box. What is sent is the same canonical string, asserted below.
    expect(amount).toHaveValue('150.5');
    // A day picker since P1-32-PRE-OD-WP06B, typed part by part.
    await typeDay(dialog, L('platform.billing.receivedOn'), '16092026');
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.billing.method')}`)),
      'Bank transfer'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));

    await waitFor(() => expect(recordReceiptAction).toHaveBeenCalledTimes(1));
    const [tenantId, input] = recordReceiptAction.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(tenantId).toBe(TENANT);
    expect(input.amount).toBe('150.5000');
    expect(typeof input.amount).toBe('string');
    expect(input).toMatchObject({
      chargeId: CHARGE,
      currencyCode: 'SAR',
      receivedOn: '2026-09-16',
      method: 'Bank transfer',
    });
    // The whole document, and nothing beside it: what the form sent before it
    // moved onto Material UI, key for key — the blank reference and notes left out.
    expect(input).toEqual({
      chargeId: CHARGE,
      amount: '150.5000',
      currencyCode: 'SAR',
      receivedOn: '2026-09-16',
      method: 'Bank transfer',
    });
  });

  it('records a charge as a decimal string, in the currency typed, against the subscription chosen', async () => {
    recordChargeAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.billing.chargeDone',
      attempt: 1,
    });
    renderLtr(
      withMui(
        <BillingPanel
          locale="en"
          messages={messages}
          tenantId={TENANT}
          charges={[charge]}
          hasMore={false}
          subscriptions={[subscription]}
          canManage
          defaultCurrency="SAR"
        />
      )
    );
    await userEvent.click(screen.getByRole('button', { name: L('platform.billing.recordCharge') }));
    const dialog = await screen.findByRole('dialog');
    // The currency opens on the one the current plan is priced in, rather than
    // on nothing or on an invented default.
    expect(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.billing.currency')}`))
    ).toHaveValue('SAR');
    const amount = within(dialog).getByLabelText(new RegExp(`^${L('platform.billing.amount')}`));
    await userEvent.type(amount, '1200');
    fireEvent.blur(amount);
    // A day picker since P1-32-PRE-OD-WP06B, typed part by part.
    await typeDay(dialog, L('platform.billing.due'), '15102026');
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.billing.description')}`)),
      'Annual subscription'
    );
    await userEvent.selectOptions(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.billing.subscription')}`)),
      SUBSCRIPTION
    );
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));

    await waitFor(() => expect(recordChargeAction).toHaveBeenCalledTimes(1));
    const [tenantId, input] = recordChargeAction.mock.calls[0] as [string, Record<string, unknown>];
    expect(tenantId).toBe(TENANT);
    expect(input.amount).toBe('1200.0000');
    expect(typeof input.amount).toBe('string');
    expect(input).toMatchObject({
      currencyCode: 'SAR',
      dueOn: '2026-10-15',
      description: 'Annual subscription',
      subscriptionId: SUBSCRIPTION,
    });
    // The whole document, key for key, as the form sent it before Material UI.
    expect(input).toEqual({
      amount: '1200.0000',
      currencyCode: 'SAR',
      dueOn: '2026-10-15',
      description: 'Annual subscription',
      subscriptionId: SUBSCRIPTION,
    });
  });

  it('moves the cursor to a refused charge field and withdraws the complaint once it is edited (route sweep B3)', async () => {
    recordChargeAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.violation.invalid',
      fieldErrors: { dueOn: 'platform.error.required' },
      attempt: 1,
    });
    renderLtr(
      withMui(
        <BillingPanel
          locale="en"
          messages={messages}
          tenantId={TENANT}
          charges={[charge]}
          hasMore={false}
          subscriptions={[subscription]}
          canManage
          defaultCurrency="SAR"
        />
      )
    );
    await userEvent.click(screen.getByRole('button', { name: L('platform.billing.recordCharge') }));
    const dialog = await screen.findByRole('dialog');
    const amount = within(dialog).getByLabelText(new RegExp(`^${L('platform.billing.amount')}`));
    await userEvent.type(amount, '1200');
    fireEvent.blur(amount);
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));
    // A due day left blank is still sent as no day, as before, and the server's
    // refusal of it is said on its own box.
    await waitFor(() => expect(recordChargeAction).toHaveBeenCalledTimes(1));
    expect((recordChargeAction.mock.calls[0]?.[1] as Record<string, unknown>).dueOn).toBe('');
    // The due day is a day picker since P1-32-PRE-OD-WP06B: a group of parts,
    // and the cursor lands on its first part.
    const due = within(dialog).getByRole('group', { name: labelledBy(L('platform.billing.due')) });
    await waitFor(() => expect(due.contains(document.activeElement)).toBe(true));
    expect(due).toHaveAttribute('aria-invalid', 'true');
    await typeDay(dialog, L('platform.billing.due'), '15102026');
    await waitFor(() => expect(due).not.toHaveAttribute('aria-invalid', 'true'));
  });

  it('voids a charge under the reason given, and shows the server refusal in place', async () => {
    voidChargeAction.mockResolvedValue({
      status: 'denied',
      messageKey: 'state.denied.title',
      correlationId: 'corr-1',
      attempt: 1,
    });
    renderLtr(
      withMui(
        <BillingPanel
          locale="en"
          messages={messages}
          tenantId={TENANT}
          charges={[charge]}
          hasMore={false}
          subscriptions={[subscription]}
          canManage
          defaultCurrency="SAR"
        />
      )
    );
    // A row action: its name carries the charge after the label.
    await userEvent.click(
      screen.getByRole('button', { name: labelledBy(L('platform.billing.void')) })
    );
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Raised against the wrong term');
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.billing.void') }));

    await waitFor(() =>
      expect(voidChargeAction).toHaveBeenCalledWith(TENANT, CHARGE, 'Raised against the wrong term')
    );
    // A refusal keeps the dialog open and says so there, rather than closing as
    // though the charge had been voided.
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      L('state.denied.title') as string
    );
  });

  it('offers no write to a billing reader', () => {
    renderLtr(
      <BillingPanel
        locale="en"
        messages={messages}
        tenantId={TENANT}
        charges={[charge]}
        hasMore={false}
        subscriptions={[]}
        canManage={false}
        defaultCurrency=""
      />
    );
    expect(screen.queryByRole('button', { name: L('platform.billing.recordCharge') })).toBeNull();
    expect(screen.queryByRole('button', { name: L('platform.billing.void') })).toBeNull();
    expect(screen.getByText(/500\.00 SAR/)).toBeInTheDocument();
  });

  /*
   * The commercial model is the Owner's decision D-OD-04: the Platform Owner
   * enters each charge and each payment, and no payment provider exists in this
   * repository. A panel headed "Billing" that offers "Record payment" is read as
   * the front of a system collecting money unless it says otherwise, so the
   * sentence is asserted for its content and not merely for its presence.
   */
  it('states that every charge and payment is entered by hand, and that nothing collects itself', () => {
    renderLtr(
      <BillingPanel
        locale="en"
        messages={messages}
        tenantId={TENANT}
        charges={[charge]}
        hasMore={false}
        subscriptions={[]}
        canManage
        defaultCurrency="SAR"
      />
    );
    const note = screen.getByTestId('platform-billing-model');
    expect(note).toHaveTextContent(L('platform.billing.recordedNote'));
    expect(note.textContent ?? '').toMatch(/entered by the platform owner/i);
    expect(note.textContent ?? '').toMatch(/no subscription renews or charges itself/i);
  });

  it('says more charges exist behind the page when the server said so, and otherwise says nothing', () => {
    const { unmount } = renderLtr(
      <BillingPanel
        locale="en"
        messages={messages}
        tenantId={TENANT}
        charges={[charge]}
        hasMore={false}
        subscriptions={[]}
        canManage={false}
        defaultCurrency=""
      />
    );
    expect(screen.queryByTestId('platform-billing-more')).toBeNull();
    unmount();

    renderLtr(
      <BillingPanel
        locale="en"
        messages={messages}
        tenantId={TENANT}
        charges={[charge]}
        hasMore
        subscriptions={[]}
        canManage={false}
        defaultCurrency=""
      />
    );
    // The count is the rows actually drawn, so the sentence cannot claim to have
    // examined more than it did.
    expect(screen.getByTestId('platform-billing-more')).toHaveTextContent(
      'Charges shown on this page: 1.'
    );
  });

  /*
   * The sentence has to read correctly at EVERY count, in a catalogue with no
   * plural forms. "The first 1 charges are shown" was grammatical at two and
   * wrong at one, and a test pinning the wrong half would have made it
   * permanent — so both counts are read here, and in Arabic as well.
   */
  it('states the page count grammatically at one charge and at several, in both languages', () => {
    const second = { ...charge, id: '44444444-4444-4444-8444-444444444445' };
    const { unmount } = renderLtr(
      <BillingPanel
        locale="en"
        messages={messages}
        tenantId={TENANT}
        charges={[charge, second]}
        hasMore
        subscriptions={[]}
        canManage={false}
        defaultCurrency=""
      />
    );
    expect(screen.getByTestId('platform-billing-more')).toHaveTextContent(
      'Charges shown on this page: 2. More exist beyond them.'
    );
    unmount();

    renderRtl(
      <BillingPanel
        locale="ar"
        messages={getMessages('ar')}
        tenantId={TENANT}
        charges={[charge]}
        hasMore
        subscriptions={[]}
        canManage={false}
        defaultCurrency=""
      />
    );
    expect(document.documentElement.dir).toBe('rtl');
    // The digits are the locale's, so the words either side of the count are
    // what the sentence is recognised by.
    const arabic = screen.getByTestId('platform-billing-more').textContent ?? '';
    expect(arabic).toContain('الرسوم الظاهرة في هذه الصفحة');
    expect(arabic).toContain('توجد رسوم أخرى بعدها');
    expect(AR['platform.billing.morePages']).not.toBe(EN['platform.billing.morePages']);
    // The commercial sentence is new too, and an Arabic reader is the one most
    // likely to meet this console first.
    expect(screen.getByTestId('platform-billing-model')).toHaveTextContent(
      AR['platform.billing.recordedNote'] as string
    );
  });

  /*
   * P1-32-PRE-OD-CONSOLE-006. Saying that more charges exist was the whole of
   * the answer while there was no way to open them: the panel read one page and
   * offered no link to the next, so an organisation with more charges than a
   * page holds kept them out of reach. `platform.charge-list` pages by cursor
   * and filters by status, and these cases pin that the links carry the server's
   * own cursor and nothing invented.
   */
  it('offers the next page only with the cursor the server gave, and a way back to the first', () => {
    const { unmount } = renderLtr(
      <BillingPanel
        locale="en"
        messages={messages}
        tenantId={TENANT}
        charges={[charge]}
        hasMore
        nextCursor="cursor-2"
        subscriptions={[]}
        canManage={false}
        defaultCurrency=""
      />
    );
    expect(screen.getByTestId('platform-billing-next')).toHaveAttribute(
      'href',
      `/en/platform/organizations/${TENANT}?chargeCursor=cursor-2`
    );
    // The first page is where this reader already is, so nothing offers to
    // return to it.
    expect(screen.queryByTestId('platform-billing-first')).toBeNull();
    unmount();

    // A later page under a filter: back to the first page of the SAME filter,
    // and no next link at the end of the set even though a cursor came with it.
    renderLtr(
      <BillingPanel
        locale="en"
        messages={messages}
        tenantId={TENANT}
        charges={[charge]}
        hasMore={false}
        nextCursor="cursor-3"
        status="open"
        paged
        subscriptions={[]}
        canManage={false}
        defaultCurrency=""
      />
    );
    expect(screen.getByTestId('platform-billing-first')).toHaveAttribute(
      'href',
      `/en/platform/organizations/${TENANT}?chargeStatus=open`
    );
    expect(screen.queryByTestId('platform-billing-next')).toBeNull();
  });

  it('draws no pager at all on a single unfiltered page', () => {
    renderLtr(
      <BillingPanel
        locale="en"
        messages={messages}
        tenantId={TENANT}
        charges={[charge]}
        hasMore={false}
        subscriptions={[]}
        canManage={false}
        defaultCurrency=""
      />
    );
    expect(screen.queryByTestId('platform-billing-pager')).toBeNull();
  });

  it('asks for a chosen status from the first page, never with the previous set cursor', async () => {
    renderLtr(
      <BillingPanel
        locale="en"
        messages={messages}
        tenantId={TENANT}
        charges={[charge]}
        hasMore
        nextCursor="cursor-2"
        paged
        subscriptions={[]}
        canManage={false}
        defaultCurrency=""
      />
    );
    const filter = screen.getByLabelText(new RegExp(`^${L('platform.billing.filterStatus')}`));
    // Every status the operation accepts is offered, and nothing else.
    expect([...(filter as HTMLSelectElement).options].map((option) => option.value)).toEqual([
      '',
      'open',
      'settled',
      'void',
    ]);

    await userEvent.selectOptions(filter, 'settled');
    expect(push).toHaveBeenCalledWith(`/en/platform/organizations/${TENANT}?chargeStatus=settled`);
    // A cursor belongs to the ordering of the set it came from, so choosing a
    // status starts again rather than carrying it.
    expect(String(push.mock.calls[0]?.[0])).not.toContain('chargeCursor');
  });

  it('says that no charge carries the chosen status, rather than that none was ever recorded', () => {
    const { unmount } = renderLtr(
      <BillingPanel
        locale="en"
        messages={messages}
        tenantId={TENANT}
        charges={[]}
        hasMore={false}
        status="void"
        subscriptions={[]}
        canManage={false}
        defaultCurrency=""
      />
    );
    expect(screen.getByText(L('platform.billing.noneWithStatus'))).toBeInTheDocument();
    expect(screen.queryByText(L('platform.billing.none'))).toBeNull();
    unmount();

    renderLtr(
      <BillingPanel
        locale="en"
        messages={messages}
        tenantId={TENANT}
        charges={[]}
        hasMore={false}
        subscriptions={[]}
        canManage={false}
        defaultCurrency=""
      />
    );
    expect(screen.getByText(L('platform.billing.none'))).toBeInTheDocument();
  });
});

/*
 * P1-32-PRE-OD-WP06B. The organisation page — its detail, its billing panel and
 * the reason dialogs — on Material UI, in both languages: the rows the reads
 * returned, each empty part and each failed read said as itself, the address
 * the pager and the filter lead to, and every write sending the document it
 * sent before, whole.
 */
describe.each(BOTH_DIRECTIONS)('%s: the organisation page on Material UI', (locale, paint) => {
  const catalogue = locale === 'ar' ? AR : EN;
  const M = (key: string): string => catalogue[key] ?? `missing message ${key}`;
  const words = getMessages(locale);
  const money = (amount: string) =>
    flat(formatMoney({ amount, currency: 'SAR' }, intlLocale(locale)));
  const show = (ui: ReactElement) => paint(withMui(ui, locale));
  const page = (
    organization: Parameters<typeof OrganizationDetailScreen>[0]['organization'],
    capabilities: typeof NONE,
    charges: Parameters<typeof OrganizationDetailScreen>[0]['charges'] = null
  ) =>
    show(
      <OrganizationDetailScreen
        locale={locale}
        messages={words}
        organization={organization}
        plans={[plan]}
        charges={charges}
        capabilities={capabilities}
        today="2026-09-16"
      />
    );
  const panel = (props: Partial<Parameters<typeof BillingPanel>[0]> = {}) =>
    show(
      <BillingPanel
        locale={locale}
        messages={words}
        tenantId={TENANT}
        charges={[charge]}
        hasMore={false}
        subscriptions={[subscription]}
        canManage
        defaultCurrency="SAR"
        {...props}
      />
    );

  const LONG_CODE = 'test_company_code_long_enough_to_outrun_its_column';
  const LONG_REASON =
    'Test reason long enough to run past the end of its column in either language';

  it('draws the companies, the branches and the status history as grids, codes whole', () => {
    page(
      {
        ...detail,
        companies: [{ id: 'c1', code: LONG_CODE, legalName: 'Test Company', status: 'active' }],
        statusHistory: [
          {
            occurredAt: '2026-09-10T09:00:00.000Z',
            fromState: null,
            toState: 'active',
            reason: null,
          },
          {
            occurredAt: '2026-09-14T09:00:00.000Z',
            fromState: 'active',
            toState: 'suspended',
            reason: LONG_REASON,
          },
        ],
      },
      NONE
    );
    const companies = screen.getByRole('grid', { name: M('platform.detail.companies') });
    const [company] = dataRows(companies);
    expect(dataRows(companies)).toHaveLength(1);
    // The code, left to right and whole; a narrower column ends it in an
    // ellipsis and keeps the whole value behind it.
    const code = within(company as HTMLElement).getByText(LONG_CODE);
    expect(code).toHaveAttribute('dir', 'ltr');
    expect(code.closest('[data-grid-line]')).toHaveAttribute('title', LONG_CODE);
    // Named by the name the read carries, beside the code.
    expect(within(company as HTMLElement).getByText('Test Company')).toBeInTheDocument();
    expect(within(company as HTMLElement).getByText(M('platform.status.active'))).toBeVisible();

    const branches = screen.getByRole('grid', { name: M('platform.detail.branches') });
    const [branch] = dataRows(branches);
    expect(within(branch as HTMLElement).getByText('test_branch')).toHaveAttribute('dir', 'ltr');
    expect(within(branch as HTMLElement).getByText('Test Branch')).toBeInTheDocument();

    const history = dataRows(
      screen.getByRole('grid', { name: M('platform.detail.statusHistory') })
    );
    expect(history).toHaveLength(2);
    const [first, second] = history as [HTMLElement, HTMLElement];
    expect(flat(first.textContent)).toContain(
      flat(formatDateTime('2026-09-10T09:00:00.000Z', locale))
    );
    // The first entry arrives from no earlier state, and gives no reason.
    expect(within(first).getAllByText('—')).toHaveLength(2);
    expect(within(second).getByText(M('platform.status.suspended'))).toBeInTheDocument();
    // A long reason keeps to its line and carries its whole text.
    expect(within(second).getByText(LONG_REASON).closest('[data-grid-line]')).toHaveAttribute(
      'title',
      LONG_REASON
    );
  });

  it('says each empty part of the organisation in its own words', () => {
    page(
      { ...detail, companies: [], branches: [], statusHistory: [], userCountsByStatus: [] },
      NONE
    );
    for (const [testId, key, grid] of [
      ['platform-companies-empty', 'platform.detail.noCompanies', 'platform.detail.companies'],
      ['platform-branches-empty', 'platform.detail.noBranches', 'platform.detail.branches'],
      ['platform-history-empty', 'platform.detail.noHistory', 'platform.detail.statusHistory'],
    ] as const) {
      expect(screen.getByTestId(testId), key).toHaveTextContent(M(key));
      expect(dataRows(screen.getByRole('grid', { name: M(grid) })), grid).toHaveLength(0);
    }
    expect(screen.getByTestId('platform-users-empty')).toHaveTextContent(
      M('platform.detail.noUsers')
    );
  });

  it('keeps the usage meters in their words: unlimited, near the limit and against it', () => {
    page(detail, NONE);
    const companies = screen.getByTestId('platform-usage-companies');
    expect(companies).toHaveAttribute('data-warning', 'true');
    expect(within(companies).getByText(M('platform.usage.warning'))).toBeInTheDocument();
    const branches = screen.getByTestId('platform-usage-branches');
    expect(branches.textContent).toContain(M('platform.usage.unlimited'));
    expect(within(branches).queryByRole('meter')).toBeNull();
    const users = screen.getByTestId('platform-usage-users');
    expect(within(users).getByRole('meter')).toHaveAttribute('aria-valuenow', '5');
    expect(users.textContent).toContain(
      `${formatInteger(5, locale)} / ${formatInteger(10, locale)}`
    );
    expect(screen.getAllByRole('heading', { name: M('platform.usage.title') })).toHaveLength(1);
  });

  it('changes the lifecycle under the reason given, trimmed, and links to the activity', async () => {
    changeOrganizationStatusAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.lifecycle.done',
      attempt: 1,
    });
    page(detail, { ...NONE, canChangeLifecycle: true, canReadAudit: true });
    expect(screen.getByRole('link', { name: M('platform.detail.viewAudit') })).toHaveAttribute(
      'href',
      `/${locale}/platform/audit?organization=${TENANT}`
    );
    expect(screen.queryByRole('button', { name: M('platform.lifecycle.reactivate') })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: M('platform.lifecycle.suspend') }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('heading')).toHaveTextContent(
      M('platform.lifecycle.suspendTitle')
    );
    const confirm = within(dialog).getByRole('button', { name: M('platform.lifecycle.suspend') });
    // Nothing is sent without a reason.
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox'), '  Test reason  ');
    await userEvent.click(confirm);
    await waitFor(() => expect(changeOrganizationStatusAction).toHaveBeenCalledTimes(1));
    expect(changeOrganizationStatusAction.mock.calls[0]).toEqual([
      TENANT,
      'suspended',
      'Test reason',
    ]);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(refresh).toHaveBeenCalled();
  });

  it('draws a billing read that failed as that failure, never as no charges', () => {
    for (const [status, testId, title, reference] of [
      ['denied', 'state-refused', 'state.denied.title', true],
      ['error', 'state-error', 'state.error.title', true],
      ['unavailable', 'state-unavailable', 'state.unavailable.title', true],
      ['expired', 'state-expired', 'state.expired.title', false],
      ['not-found', 'state-not-found', 'state.notFound.title', false],
    ] as const) {
      const { unmount } = page(
        detail,
        { ...NONE, canReadBilling: true },
        {
          status,
          correlationId: `corr-${status}`,
        }
      );
      const billing = screen
        .getByRole('heading', { name: M('platform.billing.title') })
        .closest('section') as HTMLElement;
      const state = within(billing).getByTestId(testId);
      expect(within(state).getByRole('heading'), status).toHaveTextContent(M(title));
      if (reference) expect(state, status).toHaveTextContent(`corr-${status}`);
      // As before: the page is read on the server, and no retry is offered here.
      expect(within(billing).queryByRole('button'), status).toBeNull();
      // As before: an ended session is offered no link. A link to bare sign-in
      // would skip the session-ended route the console's session check uses.
      expect(within(billing).queryByRole('link'), status).toBeNull();
      expect(screen.queryByRole('table', { name: M('platform.billing.title') }), status).toBeNull();
      expect(screen.queryByTestId('platform-charge'), status).toBeNull();
      expect(screen.queryByTestId('platform-billing-empty'), status).toBeNull();
      unmount();
    }
  });

  it('draws each charge with its money, every payment in full and what is outstanding', () => {
    const voided = {
      ...charge,
      id: '44444444-4444-4444-8444-444444444445',
      description: 'Test voided charge',
      status: 'void',
      voidReason: 'Raised against the wrong term',
      outstanding: '0.0000',
      receipts: [],
    };
    const second = {
      ...charge.receipts[0]!,
      id: 'r2',
      amount: '200.0000',
      receivedOn: '2026-09-09',
      method: 'Cash',
      reference: 'TEST-REF-2',
    };
    const third = {
      ...charge.receipts[0]!,
      id: 'r3',
      amount: '50.0000',
      receivedOn: '2026-09-12',
      method: 'Test transfer with a method name long enough to wrap in its cell',
      reference: 'TEST-REFERENCE-THREE-LONG',
    };
    const paid = { ...charge, receipts: [...charge.receipts, second, third] };
    panel({ charges: [paid, voided], canManage: false });
    const table = screen.getByRole('table', { name: M('platform.billing.title') });
    const rows = within(table).getAllByTestId('platform-charge');
    expect(rows).toHaveLength(2);
    const [open, gone] = rows as [HTMLElement, HTMLElement];
    expect(within(open).getByText(money('1200.0000'))).toBeInTheDocument();
    expect(within(open).getByTestId('platform-outstanding')).toHaveTextContent(money('700.0000'));
    // Every payment, each written whole as it was before: amount · day · method · reference.
    const lines = within(open).getAllByTestId('platform-receipt');
    expect(lines.map((line) => flat(line.textContent))).toEqual([
      `${money('500.0000')} · ${flat(formatDate('2026-09-05', locale))} · Bank transfer`,
      `${money('200.0000')} · ${flat(formatDate('2026-09-09', locale))} · Cash · TEST-REF-2`,
      `${money('50.0000')} · ${flat(formatDate('2026-09-12', locale))} · ${third.method} · TEST-REFERENCE-THREE-LONG`,
    ]);
    expect(within(gone).getByText('Test voided charge')).toBeInTheDocument();
    expect(within(gone).getByText('Raised against the wrong term')).toBeInTheDocument();
    expect(within(gone).getByText(M('platform.billing.noReceipts'))).toBeInTheDocument();
    expect(within(gone).getByText(M('platform.status.void'))).toBeInTheDocument();
    // A reader is offered no write.
    expect(within(table).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('button', { name: M('platform.billing.recordCharge') })).toBeNull();
  });

  it('names each charge button by the charge it acts on: its description and its due day', () => {
    panel();
    const table = screen.getByRole('table', { name: M('platform.billing.title') });
    const line = within(table).getByTestId('platform-charge');
    const about = `${charge.description}, ${formatDate(charge.dueOn, locale)}`;
    for (const key of ['platform.billing.recordReceipt', 'platform.billing.void']) {
      expect(
        within(line).getByRole('button', { name: labelledBy(M(key)) }),
        key
      ).toHaveAccessibleName(`${M(key)} ${about}`);
    }
  });

  it('says that no charge was recorded, or none with the chosen status, in its own words', () => {
    const { unmount } = panel({ charges: [], status: 'void' });
    expect(screen.getByTestId('platform-billing-empty')).toHaveTextContent(
      M('platform.billing.noneWithStatus')
    );
    expect(screen.queryByTestId('platform-charge')).toBeNull();
    unmount();
    panel({ charges: [] });
    expect(screen.getByTestId('platform-billing-empty')).toHaveTextContent(
      M('platform.billing.none')
    );
  });

  /*
   * The detail read answers every company in one reply, and the grid is told
   * it is not paged. A grid still holds a page size of its own; were it to
   * page the rows it was handed, the companies past the first page would be
   * drawn nowhere and reached by no control.
   */
  it('draws every company the read holds, past any page size', () => {
    const many = Array.from({ length: 130 }, (_, index) => ({
      id: `c${String(index).padStart(3, '0')}`,
      code: `test_company_${String(index).padStart(3, '0')}`,
      legalName: `Test Company ${index}`,
      status: 'active',
    }));
    page({ ...detail, companies: many }, NONE);
    const grid = screen.getByRole('grid', { name: M('platform.detail.companies') });
    const rows = dataRows(grid);
    expect(rows).toHaveLength(130);
    expect(within(rows[129] as HTMLElement).getByText('test_company_129')).toBeInTheDocument();
    expect(within(grid).queryByRole('navigation')).toBeNull();
  });

  it('pages and filters by the address, in the language of the page', async () => {
    panel({ hasMore: true, nextCursor: 'cursor-2', status: 'open', paged: true });
    const pager = screen.getByRole('navigation', { name: M('platform.billing.pager') });
    expect(
      within(pager).getByRole('link', { name: M('platform.billing.firstPage') })
    ).toHaveAttribute('href', `/${locale}/platform/organizations/${TENANT}?chargeStatus=open`);
    expect(
      within(pager).getByRole('link', { name: M('platform.billing.nextPage') })
    ).toHaveAttribute(
      'href',
      `/${locale}/platform/organizations/${TENANT}?chargeStatus=open&chargeCursor=cursor-2`
    );
    const filter = screen.getByLabelText(labelledBy(M('platform.billing.filterStatus')));
    await userEvent.selectOptions(filter, 'settled');
    await userEvent.selectOptions(filter, '');
    expect(push.mock.calls).toEqual([
      [`/${locale}/platform/organizations/${TENANT}?chargeStatus=settled`],
      [`/${locale}/platform/organizations/${TENANT}`],
    ]);
  });

  it('records a charge and a payment with the same documents as before', async () => {
    recordChargeAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.billing.chargeDone',
      attempt: 1,
    });
    recordReceiptAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.billing.receiptDone',
      attempt: 1,
    });
    panel({ defaultCurrency: '' });
    await userEvent.click(screen.getByRole('button', { name: M('platform.billing.recordCharge') }));
    const chargeDialog = await screen.findByRole('dialog');
    expect(within(chargeDialog).getByRole('heading')).toHaveTextContent(
      M('platform.billing.recordCharge')
    );
    await userEvent.type(
      within(chargeDialog).getByLabelText(labelledBy(M('platform.billing.currency'))),
      'sar'
    );
    const amount = within(chargeDialog).getByLabelText(labelledBy(M('platform.billing.amount')));
    await userEvent.type(amount, '1200.5');
    fireEvent.blur(amount);
    await typeDay(chargeDialog, M('platform.billing.due'), '15102026');
    await userEvent.type(
      within(chargeDialog).getByLabelText(labelledBy(M('platform.billing.description'))),
      'Annual subscription'
    );
    await userEvent.selectOptions(
      within(chargeDialog).getByLabelText(labelledBy(M('platform.billing.subscription'))),
      SUBSCRIPTION
    );
    await userEvent.click(within(chargeDialog).getByRole('button', { name: M('platform.save') }));
    await waitFor(() => expect(recordChargeAction).toHaveBeenCalledTimes(1));
    expect(recordChargeAction.mock.calls[0]).toEqual([
      TENANT,
      {
        amount: '1200.5000',
        currencyCode: 'SAR',
        dueOn: '2026-10-15',
        description: 'Annual subscription',
        subscriptionId: SUBSCRIPTION,
      },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await userEvent.click(
      screen.getByRole('button', { name: labelledBy(M('platform.billing.recordReceipt')) })
    );
    const receiptDialog = await screen.findByRole('dialog');
    const paid = within(receiptDialog).getByLabelText(labelledBy(M('platform.billing.amount')));
    await userEvent.type(paid, '150.5');
    fireEvent.blur(paid);
    await typeDay(receiptDialog, M('platform.billing.receivedOn'), '16092026');
    await userEvent.type(
      within(receiptDialog).getByLabelText(labelledBy(M('platform.billing.method'))),
      'Bank transfer'
    );
    await userEvent.type(
      within(receiptDialog).getByLabelText(labelledBy(M('platform.billing.reference'))),
      'TEST-REF-1'
    );
    await userEvent.type(
      within(receiptDialog).getByLabelText(labelledBy(M('platform.billing.notes'))),
      'Test note'
    );
    await userEvent.click(within(receiptDialog).getByRole('button', { name: M('platform.save') }));
    await waitFor(() => expect(recordReceiptAction).toHaveBeenCalledTimes(1));
    expect(recordReceiptAction.mock.calls[0]).toEqual([
      TENANT,
      {
        chargeId: CHARGE,
        amount: '150.5000',
        currencyCode: 'SAR',
        receivedOn: '2026-09-16',
        method: 'Bank transfer',
        reference: 'TEST-REF-1',
        notes: 'Test note',
      },
    ]);
  });

  /*
   * The behaviour that differs from the old screens, pinned: a native date box
   * handed back no value for a day half typed, and the form sent the date
   * empty. The picker reports the day unfinished, and the form refuses it on
   * its own box before anything is sent — the same rule as the plan form.
   */
  it('refuses a due day or a received day only partly typed, on its own box', async () => {
    const user = userEvent.setup();
    recordChargeAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.billing.chargeDone',
      attempt: 1,
    });
    panel();
    await user.click(screen.getByRole('button', { name: M('platform.billing.recordCharge') }));
    const chargeDialog = await screen.findByRole('dialog');
    const amount = within(chargeDialog).getByLabelText(labelledBy(M('platform.billing.amount')));
    await user.type(amount, '10');
    fireEvent.blur(amount);
    // The day and the month, and no year.
    const due = await typeDay(chargeDialog, M('platform.billing.due'), '1510');
    await user.click(within(chargeDialog).getByRole('button', { name: M('platform.save') }));
    expect(await within(chargeDialog).findByText(M('platform.error.date'))).toBeVisible();
    expect(due).toHaveAttribute('aria-invalid', 'true');
    expect(recordChargeAction).not.toHaveBeenCalled();
    await user.click(within(due).getAllByRole('spinbutton')[2] as HTMLElement);
    await user.keyboard('2026');
    await waitFor(() =>
      expect(within(chargeDialog).queryByText(M('platform.error.date'))).toBeNull()
    );
    await user.click(within(chargeDialog).getByRole('button', { name: M('overlay.cancel') }));
    expect(recordChargeAction).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole('button', { name: labelledBy(M('platform.billing.recordReceipt')) })
    );
    const receiptDialog = await screen.findByRole('dialog');
    const received = await typeDay(receiptDialog, M('platform.billing.receivedOn'), '16');
    await user.click(within(receiptDialog).getByRole('button', { name: M('platform.save') }));
    expect(await within(receiptDialog).findByText(M('platform.error.date'))).toBeVisible();
    expect(received).toHaveAttribute('aria-invalid', 'true');
    expect(recordReceiptAction).not.toHaveBeenCalled();
  });

  /*
   * The money field reads ASCII digits only — the old one did too: both parse
   * through `parseMoneyInput`. Arabic-Indic digits are refused on the box in
   * the catalogue's words, and the form sends what was typed as it did before,
   * for the server to refuse; nothing converts or invents an amount.
   */
  it('refuses Arabic-Indic digits in an amount as the old field did, sending what was typed', async () => {
    recordChargeAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.violation.invalid',
      fieldErrors: { amount: 'money.error.notDecimal' },
      attempt: 1,
    });
    panel();
    await userEvent.click(screen.getByRole('button', { name: M('platform.billing.recordCharge') }));
    const dialog = await screen.findByRole('dialog');
    const amount = within(dialog).getByLabelText(labelledBy(M('platform.billing.amount')));
    await userEvent.type(amount, '١٢٠٠');
    fireEvent.blur(amount);
    expect(await within(dialog).findByText(M('money.error.notDecimal'))).toBeVisible();
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    await typeDay(dialog, M('platform.billing.due'), '15102026');
    await userEvent.type(
      within(dialog).getByLabelText(labelledBy(M('platform.billing.description'))),
      'Annual subscription'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: M('platform.save') }));
    await waitFor(() => expect(recordChargeAction).toHaveBeenCalledTimes(1));
    expect(recordChargeAction.mock.calls[0]).toEqual([
      TENANT,
      {
        amount: '١٢٠٠',
        currencyCode: 'SAR',
        dueOn: '2026-10-15',
        description: 'Annual subscription',
      },
    ]);
  });

  it('voids a charge under the reason given, trimmed, and keeps the dialog on a refusal', async () => {
    voidChargeAction.mockResolvedValue({
      status: 'denied',
      messageKey: 'state.denied.title',
      correlationId: 'corr-void',
      attempt: 1,
    });
    panel();
    await userEvent.click(
      screen.getByRole('button', { name: labelledBy(M('platform.billing.void')) })
    );
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('heading')).toHaveTextContent(M('platform.billing.voidTitle'));
    expect(dialog).toHaveTextContent(M('platform.billing.voidBody'));
    const confirm = within(dialog).getByRole('button', { name: M('platform.billing.void') });
    expect(confirm).toBeDisabled();
    // A destructive act: Cancel holds the cursor when the dialog opens.
    expect(within(dialog).getByRole('button', { name: M('overlay.cancel') })).toHaveFocus();
    await userEvent.type(within(dialog).getByRole('textbox'), '  Raised in error  ');
    await userEvent.click(confirm);
    await waitFor(() => expect(voidChargeAction).toHaveBeenCalledTimes(1));
    expect(voidChargeAction.mock.calls[0]).toEqual([TENANT, CHARGE, 'Raised in error']);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(M('state.denied.title'));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});

/*
 * P1-32-PRE-OD-WP06B2. The subscription panel and the overview on Material UI,
 * in both languages. The panel is on the plan-assignment path (CC-OD-24), so it
 * is held to presentation only: the same acts, the same plans offered in the
 * same order under the same names, the same term choices, the same documents
 * sent — whole — and the same sentences, "no subscription" among them.
 */
describe.each(BOTH_DIRECTIONS)('%s: the subscription panel on Material UI', (locale, paint) => {
  const catalogue = locale === 'ar' ? AR : EN;
  const M = (key: string): string => catalogue[key] ?? `missing message ${key}`;
  const words = getMessages(locale);
  const LONG_REASON =
    'Test reason long enough to run past the end of its column in either language, kept whole';
  const page = (
    organization: Parameters<typeof OrganizationDetailScreen>[0]['organization'],
    plans: Parameters<typeof OrganizationDetailScreen>[0]['plans'] = [plan],
    canManageSubscription = true
  ) =>
    paint(
      withMui(
        <OrganizationDetailScreen
          locale={locale}
          messages={words}
          organization={organization}
          plans={plans}
          charges={null}
          capabilities={{ ...NONE, canManageSubscription }}
          today="2026-09-16"
        />,
        locale
      )
    );
  const panel = () =>
    screen
      .getByRole('heading', { name: M('platform.subscription.title') })
      .closest('section') as HTMLElement;

  it('shows the plan in force, the history and every change whole, with the acts named', () => {
    page({
      ...detail,
      subscriptions: [
        subscription,
        {
          ...subscription,
          id: '22222222-2222-4222-8222-222222222223',
          planName: 'Test Plan Earlier',
          status: 'cancelled',
          effectiveFrom: '2025-09-01',
          effectiveTo: '2026-08-31',
        },
      ],
      subscriptionEvents: [
        {
          id: 'e1',
          subscriptionId: SUBSCRIPTION,
          eventKind: 'upgraded',
          effectiveFrom: '2026-09-01',
          effectiveTo: null,
          occurredAt: '2026-09-01T08:00:00.000Z',
          fromPlanCode: 'test_plan_small',
          toPlanCode: 'test_plan',
          reason: LONG_REASON,
        },
      ],
    });
    const section = panel();
    const summary = within(section).getByTestId('platform-current-plan');
    expect(summary).toHaveTextContent('Test Plan');
    expect(summary).toHaveTextContent(flat(formatDate('2026-09-01', locale)));
    expect(flat(summary.textContent)).toContain(flat(formatDate('2027-08-31', locale)));

    const history = within(section).getByRole('table', {
      name: M('platform.subscription.history'),
    });
    expect(
      within(history)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
    ).toEqual([
      M('platform.subscription.plan'),
      M('platform.subscription.status'),
      M('platform.subscription.starts'),
      M('platform.subscription.ends'),
    ]);
    const [, current, earlier] = within(history).getAllByRole('row') as HTMLElement[];
    expect(within(current as HTMLElement).getByText(M('platform.status.active'))).toBeVisible();
    expect(earlier).toHaveTextContent('Test Plan Earlier');
    expect(earlier).toHaveTextContent(M('platform.status.cancelled'));

    const events = within(section).getByRole('table', {
      name: M('platform.subscription.events'),
    });
    expect(
      within(events)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
    ).toEqual([
      M('platform.subscription.when'),
      M('platform.subscription.act'),
      M('platform.subscription.change'),
      M('platform.subscription.reason'),
    ]);
    const [, change] = within(events).getAllByRole('row') as HTMLElement[];
    expect(change).toHaveTextContent(M('platform.subscription.event.upgraded'));
    expect(change).toHaveTextContent('test_plan_small → test_plan');
    // The reason is in the cell whole, on screen — not cut, not behind a title.
    const reason = within(change as HTMLElement).getByText(LONG_REASON);
    expect(reason).toBeVisible();
    expect(reason.closest('[title]')).toBeNull();

    // Every act the panel offers, by its accessible name, in order, and no other.
    const acts = within(section).getAllByRole('button');
    expect(acts).toHaveLength(4);
    [
      'platform.subscription.act.renewed',
      'platform.subscription.act.upgraded',
      'platform.subscription.act.downgraded',
      'platform.subscription.act.cancel',
    ].forEach((key, index) => expect(acts[index], key).toHaveAccessibleName(M(key)));
  });

  it('says the organisation has no subscription, in the same words, and offers only Assign', () => {
    page({ ...detail, subscriptions: [], subscriptionEvents: [] });
    const section = panel();
    expect(within(section).getByTestId('platform-no-subscription')).toHaveTextContent(
      M('platform.subscription.none')
    );
    const history = within(section).getByRole('table', {
      name: M('platform.subscription.history'),
    });
    expect(within(history).getAllByRole('row')[1]).toHaveTextContent(
      M('platform.subscription.none')
    );
    const events = within(section).getByRole('table', {
      name: M('platform.subscription.events'),
    });
    expect(within(events).getAllByRole('row')[1]).toHaveTextContent(
      M('platform.subscription.noEvents')
    );
    // Assign is the one act offered, and it is named for itself.
    const acts = within(section).getAllByRole('button');
    expect(acts).toHaveLength(1);
    expect(acts[0]).toHaveAccessibleName(M('platform.subscription.act.assigned'));
  });

  it('offers no act without the authority, or when the plan catalogue could not be read', () => {
    const { unmount } = page(detail, [plan], false);
    expect(within(panel()).queryByRole('button')).toBeNull();
    unmount();
    page(detail, null, true);
    expect(within(panel()).queryByRole('button')).toBeNull();
  });

  it('assigns a plan from the same choices, in the same order, sending the same document', async () => {
    assignSubscriptionAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.subscription.done',
      attempt: 1,
    });
    const nameOnly = {
      ...plan,
      id: '33333333-3333-4333-8333-333333333334',
      planCode: 'test_plan_name_only',
      displayName: null,
      name: 'Test Plan Name Only',
    };
    const retired = { ...plan, id: 'retired', planCode: 'test_plan_retired', status: 'retired' };
    const draft = { ...plan, id: 'draft', planCode: 'test_plan_draft', status: 'draft' };
    page({ ...detail, subscriptions: [] }, [plan, retired, nameOnly, draft]);
    await userEvent.click(
      screen.getByRole('button', { name: M('platform.subscription.act.assigned') })
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading')).toHaveTextContent(
      M('platform.subscription.act.assigned')
    );
    const select = within(dialog).getByLabelText(labelledBy(M('platform.subscription.plan')));
    // The active plans only, in the catalogue's order, by name.
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => [option.getAttribute('value'), option.textContent])
    ).toEqual([
      ['', M('platform.provision.choose')],
      ['test_plan', 'Test Plan'],
      ['test_plan_name_only', 'Test Plan Name Only'],
    ]);
    const term = within(dialog).getByLabelText(new RegExp(`^${M('platform.subscription.term')}$`));
    expect(term).toHaveValue('12');
    expect(
      within(term)
        .getAllByRole('option')
        .map((option) => [option.getAttribute('value'), option.textContent])
    ).toEqual([
      ['12', `12 ${M('platform.subscription.months')}`],
      ['24', `24 ${M('platform.subscription.months')}`],
      ['36', `36 ${M('platform.subscription.months')}`],
      ['other', M('platform.subscription.otherTerm')],
    ]);
    await userEvent.selectOptions(select, 'test_plan_name_only');
    await typeDay(dialog, M('platform.subscription.starts'), '01102026');
    await userEvent.selectOptions(term, '36');
    await userEvent.type(
      within(dialog).getByLabelText(labelledBy(M('platform.reason'))),
      'First plan'
    );
    // No over-capacity block before the server refused anything.
    expect(within(dialog).queryByTestId('platform-over-capacity')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: M('platform.save') }));
    await waitFor(() => expect(assignSubscriptionAction).toHaveBeenCalledTimes(1));
    expect(assignSubscriptionAction.mock.calls[0]).toEqual([
      TENANT,
      {
        planCode: 'test_plan_name_only',
        effectiveFrom: '2026-10-01',
        termMonths: 36,
        kind: 'assigned',
        reason: 'First plan',
      },
    ]);
  });

  it('renews the plan in force for a free number of months, sending the same document', async () => {
    assignSubscriptionAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.subscription.done',
      attempt: 1,
    });
    page(detail);
    await userEvent.click(
      screen.getByRole('button', { name: M('platform.subscription.act.renewed') })
    );
    const dialog = await screen.findByRole('dialog');
    // A renewal opens on the plan in force.
    expect(within(dialog).getByLabelText(labelledBy(M('platform.subscription.plan')))).toHaveValue(
      'test_plan'
    );
    await typeDay(dialog, M('platform.subscription.starts'), '01092027');
    await userEvent.selectOptions(
      within(dialog).getByLabelText(new RegExp(`^${M('platform.subscription.term')}$`)),
      'other'
    );
    await userEvent.type(
      within(dialog).getByLabelText(labelledBy(M('platform.subscription.termMonths'))),
      '18'
    );
    await userEvent.type(
      within(dialog).getByLabelText(labelledBy(M('platform.reason'))),
      'Renewal'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: M('platform.save') }));
    await waitFor(() => expect(assignSubscriptionAction).toHaveBeenCalledTimes(1));
    expect(assignSubscriptionAction.mock.calls[0]).toEqual([
      TENANT,
      {
        planCode: 'test_plan',
        effectiveFrom: '2027-09-01',
        termMonths: 18,
        kind: 'renewed',
        reason: 'Renewal',
      },
    ]);
  });

  it('sends a start day left blank as before, and refuses one only partly typed on its box', async () => {
    const user = userEvent.setup();
    assignSubscriptionAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.violation.invalid',
      fieldErrors: { effectiveFrom: 'platform.error.required' },
      attempt: 1,
    });
    page(detail);
    await user.click(screen.getByRole('button', { name: M('platform.subscription.act.upgraded') }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(
      within(dialog).getByLabelText(labelledBy(M('platform.subscription.plan'))),
      'test_plan'
    );
    await user.type(within(dialog).getByLabelText(labelledBy(M('platform.reason'))), 'More');
    await user.click(within(dialog).getByRole('button', { name: M('platform.save') }));
    await waitFor(() => expect(assignSubscriptionAction).toHaveBeenCalledTimes(1));
    expect(assignSubscriptionAction.mock.calls[0]).toEqual([
      TENANT,
      {
        planCode: 'test_plan',
        effectiveFrom: '',
        termMonths: 12,
        kind: 'upgraded',
        reason: 'More',
      },
    ]);
    const starts = within(dialog).getByRole('group', {
      name: labelledBy(M('platform.subscription.starts')),
    });
    await waitFor(() => expect(starts).toHaveAttribute('aria-invalid', 'true'));

    // The day and the month, and no year: refused here, nothing sent.
    await typeDay(dialog, M('platform.subscription.starts'), '0110');
    await user.click(within(dialog).getByRole('button', { name: M('platform.save') }));
    expect(await within(dialog).findByText(M('platform.error.date'))).toBeVisible();
    expect(assignSubscriptionAction).toHaveBeenCalledTimes(1);
  });

  /*
   * The behaviour that differs, pinned (the same open Owner question as the
   * plan form and the billing forms): the old native date box sent a day such
   * as 2100-01-01, which the action and the API both accept. The picker's range
   * ends on 2099-12-31, so a later day is refused on its own box and nothing
   * is sent.
   */
  it('refuses a start day after 2099-12-31 on its own box, and sends nothing', async () => {
    const user = userEvent.setup();
    page(detail);
    await user.click(screen.getByRole('button', { name: M('platform.subscription.act.upgraded') }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(
      within(dialog).getByLabelText(labelledBy(M('platform.subscription.plan'))),
      'test_plan'
    );
    const starts = await typeDay(dialog, M('platform.subscription.starts'), '01012100');
    // The year box holds the year typed, whole, so the refusal below is of
    // 2100 itself and not of a year the picker cut short.
    expect(within(starts).getByRole('spinbutton', { name: M('mui.pickers.year') })).toHaveAttribute(
      'aria-valuenow',
      '2100'
    );
    await user.type(within(dialog).getByLabelText(labelledBy(M('platform.reason'))), 'Later');
    await user.click(within(dialog).getByRole('button', { name: M('platform.save') }));
    expect(await within(dialog).findByText(M('platform.error.date'))).toBeVisible();
    expect(starts).toHaveAttribute('aria-invalid', 'true');
    expect(assignSubscriptionAction).not.toHaveBeenCalled();
  });

  it('cancels the subscription in force on the day and reason given, as before', async () => {
    const user = userEvent.setup();
    cancelSubscriptionAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.subscription.cancelled',
      attempt: 1,
    });
    page(detail);
    await user.click(screen.getByRole('button', { name: M('platform.subscription.act.cancel') }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading')).toHaveTextContent(
      M('platform.subscription.act.cancel')
    );
    expect(dialog).toHaveTextContent(M('platform.subscription.cancelHint'));
    // Unfinished: refused on its box, nothing sent.
    const ends = await typeDay(dialog, M('platform.subscription.ends'), '3112');
    await user.type(
      within(dialog).getByLabelText(labelledBy(M('platform.reason'))),
      'Not renewing'
    );
    const confirm = within(dialog).getByRole('button', {
      name: M('platform.subscription.act.cancel'),
    });
    await user.click(confirm);
    expect(await within(dialog).findByText(M('platform.error.date'))).toBeVisible();
    expect(ends).toHaveAttribute('aria-invalid', 'true');
    expect(cancelSubscriptionAction).not.toHaveBeenCalled();
    await user.click(within(ends).getAllByRole('spinbutton')[2] as HTMLElement);
    await user.keyboard('2026');
    await waitFor(() => expect(within(dialog).queryByText(M('platform.error.date'))).toBeNull());
    await user.click(confirm);
    await waitFor(() => expect(cancelSubscriptionAction).toHaveBeenCalledTimes(1));
    expect(cancelSubscriptionAction.mock.calls[0]).toEqual([
      TENANT,
      SUBSCRIPTION,
      { effectiveTo: '2026-12-31', reason: 'Not renewing' },
    ]);
  });
});

describe.each(BOTH_DIRECTIONS)('%s: the overview on Material UI', (locale, paint) => {
  const catalogue = locale === 'ar' ? AR : EN;
  const M = (key: string): string => catalogue[key] ?? `missing message ${key}`;
  const words = getMessages(locale);
  const money = (amount: string) =>
    flat(formatMoney({ amount, currency: 'SAR' }, intlLocale(locale)));
  const statistics = {
    generatedAt: '2026-09-16T09:00:00.000Z',
    asOf: '2026-09-16T09:00:00.000Z',
    tenantsByStatus: [{ key: 'active', count: 4 }],
    activeCompanies: 5,
    activeBranches: 7,
    activeUserAccounts: 30,
    subscriptions: {
      active: 4,
      expiringWithin30Days: 1,
      expiringWithin60Days: 2,
      expiringWithin90Days: 3,
      expired: 0,
    },
    capacityAlerts: [],
    revenueByCurrency: [
      {
        currencyCode: 'SAR',
        contracted: '4800.0000',
        received: '1200.0000',
        outstanding: '3600.0000',
        projectedRenewalValue: '6000.0000',
      },
    ],
    health: {
      readiness: 'ready',
      readinessChecks: [],
      outbox: { reachable: true, undelivered: 2, deadLettered: 0, oldestPendingAgeSeconds: 5 },
    },
  };
  const LONG_NAME = 'Test Organisation With A Name Long Enough To Wrap In Its Column';
  const organizationRow = {
    id: TENANT,
    tenantCode: 'test_org_one',
    displayName: LONG_NAME,
    status: 'active',
    defaultLocale: 'en',
    defaultTimezone: 'Asia/Riyadh',
    createdAt: '2026-01-01T00:00:00.000Z',
    activePlanCode: 'test_plan_one',
    activePlanEffectiveTo: '2026-10-01T00:00:00.000Z',
    activeCompanyCount: 1,
    activeBranchCount: 2,
    activeUserCount: 9,
  };
  const show = (
    organizations: Parameters<typeof PlatformOverview>[0]['organizations'],
    overrides: Partial<typeof statistics> = {}
  ) =>
    paint(
      withMui(
        <PlatformOverview
          locale={locale}
          messages={words}
          statistics={{ ...statistics, ...overrides } as never}
          canReadOrganizations
          organizations={organizations}
        />,
        locale
      )
    );
  const read = (rows: readonly unknown[], hasMore: boolean) =>
    ({
      status: 'ok',
      data: { items: rows, nextCursor: null, hasMore },
      correlationId: 'cid-organizations',
    }) as never;

  it('draws the revenue by currency and the organisations ending soon, names whole', () => {
    show(read([organizationRow], false));
    const revenue = screen.getByRole('table', { name: M('platform.overview.revenue') });
    expect(
      within(revenue)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
    ).toEqual([
      M('platform.overview.currency'),
      M('platform.overview.contracted'),
      M('platform.overview.received'),
      M('platform.overview.outstanding'),
      M('platform.overview.projectedRenewal'),
    ]);
    const [, sar] = within(revenue).getAllByRole('row') as HTMLElement[];
    expect(within(sar as HTMLElement).getByText('SAR')).toHaveAttribute('dir', 'ltr');
    for (const amount of ['4800.0000', '1200.0000', '3600.0000']) {
      expect(within(sar as HTMLElement).getByText(money(amount))).toBeInTheDocument();
    }
    expect(within(sar as HTMLElement).getByTestId('platform-projection')).toHaveTextContent(
      money('6000.0000')
    );
    const expiring = screen.getByRole('table', {
      name: M('platform.overview.expiringOrganizations'),
    });
    expect(
      within(expiring)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
    ).toEqual([
      M('platform.overview.organization'),
      M('platform.overview.plan'),
      M('platform.overview.endsOn'),
      M('platform.overview.remaining'),
    ]);
    const [, row] = within(expiring).getAllByRole('row') as HTMLElement[];
    const link = within(row as HTMLElement).getByRole('link', { name: LONG_NAME });
    expect(link).toHaveAttribute('href', `/${locale}/platform/organizations/${TENANT}`);
    expect(link.closest('[title]')).toBeNull();
    expect(within(row as HTMLElement).getByText('test_plan_one')).toHaveAttribute('dir', 'ltr');
    // Nothing beyond the page was offered, so nothing is said of it.
    expect(screen.getByTestId('platform-expiring-scope')).toHaveTextContent(
      M('platform.overview.expiringScope').replace('{count}', formatInteger(1, locale))
    );
    expect(screen.getByTestId('platform-expiring-scope')).not.toHaveTextContent(
      M('platform.overview.expiringMore')
    );
  });

  it('says that more organisations exist beyond the one page it examined, and offers no pager', () => {
    show(read([organizationRow], true));
    expect(screen.getByTestId('platform-expiring-scope')).toHaveTextContent(
      M('platform.overview.expiringMore')
    );
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says no revenue and no organisation ending soon, each in its own words', () => {
    show(read([{ ...organizationRow, activePlanEffectiveTo: '2028-01-01T00:00:00.000Z' }], false), {
      revenueByCurrency: [],
    });
    const revenue = screen.getByRole('table', { name: M('platform.overview.revenue') });
    expect(within(revenue).getAllByRole('row')[1]).toHaveTextContent(
      M('platform.overview.noRevenue')
    );
    const expiring = screen.getByRole('table', {
      name: M('platform.overview.expiringOrganizations'),
    });
    expect(within(expiring).getAllByRole('row')[1]).toHaveTextContent(
      M('platform.overview.noExpiring')
    );
  });

  it('says the organisations could not be read, whatever failed, with the reference', () => {
    for (const status of ['denied', 'error', 'unavailable', 'expired', 'not-found'] as const) {
      const { unmount } = show({ status, correlationId: `cid-${status}` });
      const alert = screen.getByRole('alert');
      expect(alert, status).toHaveTextContent(M('platform.overview.expiringUnavailable'));
      expect(alert, status).toHaveTextContent(`cid-${status}`);
      expect(
        screen.queryByRole('table', { name: M('platform.overview.expiringOrganizations') }),
        status
      ).toBeNull();
      expect(screen.queryByText(M('platform.overview.noExpiring')), status).toBeNull();
      // The revenue was read separately and still stands.
      expect(
        screen.getByRole('table', { name: M('platform.overview.revenue') }),
        status
      ).toBeVisible();
      unmount();
    }
  });
});

describe('the overview', () => {
  const statistics = {
    generatedAt: '2026-09-16T09:00:00.000Z',
    asOf: '2026-09-16T09:00:00.000Z',
    tenantsByStatus: [
      { key: 'active', count: 4 },
      { key: 'suspended', count: 1 },
    ],
    activeCompanies: 5,
    activeBranches: 7,
    activeUserAccounts: 30,
    subscriptions: {
      active: 4,
      expiringWithin30Days: 1,
      expiringWithin60Days: 2,
      expiringWithin90Days: 3,
      expired: 0,
    },
    capacityAlerts: [
      {
        tenantId: TENANT,
        tenantCode: 'test_org_one',
        displayName: 'Test Organisation One',
        kind: 'users',
        used: 10,
        limit: 10,
        severity: 'at-limit',
      },
    ],
    revenueByCurrency: [
      {
        currencyCode: 'SAR',
        contracted: '4800.0000',
        received: '1200.0000',
        outstanding: '3600.0000',
        projectedRenewalValue: '6000.0000',
      },
    ],
    health: {
      readiness: 'ready',
      readinessChecks: [],
      outbox: { reachable: true, undelivered: 2, deadLettered: 0, oldestPendingAgeSeconds: 5 },
    },
  };

  it('labels the projected renewal value as an estimate, apart from recorded amounts', () => {
    renderLtr(
      <PlatformOverview
        locale="en"
        messages={messages}
        statistics={statistics}
        canReadOrganizations
        organizations={null}
      />
    );
    const revenue = screen.getByRole('table', { name: L('platform.overview.revenue') as string });
    const headers = within(revenue)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(headers).toEqual([
      L('platform.overview.currency'),
      L('platform.overview.contracted'),
      L('platform.overview.received'),
      L('platform.overview.outstanding'),
      L('platform.overview.projectedRenewal'),
    ]);
    expect(L('platform.overview.projectedRenewal')).toMatch(/estimate/i);
    expect(screen.getByText(L('platform.overview.projectionNote'))).toBeInTheDocument();
    expect(screen.getByTestId('platform-projection')).toHaveTextContent('6,000.00 SAR');
    expect(screen.getByText('3,600.00 SAR')).toBeInTheDocument();
  });

  it('shows the tiles, the freshness line, the alert link and service health', () => {
    renderLtr(
      <PlatformOverview
        locale="en"
        messages={messages}
        statistics={statistics}
        canReadOrganizations
        organizations={null}
      />
    );
    expect(screen.getByTestId('platform-tile-active')).toHaveTextContent('4');
    expect(screen.getByTestId('platform-tile-suspended')).toHaveTextContent('1');
    expect(screen.getByTestId('platform-tile-expiring90')).toHaveTextContent('3');
    expect(screen.getByTestId('platform-freshness')).toHaveTextContent(
      L('platform.overview.generatedAt') as string
    );
    expect(screen.getByRole('link', { name: 'Test Organisation One' })).toHaveAttribute(
      'href',
      `/en/platform/organizations/${TENANT}`
    );
    expect(screen.getByTestId('platform-readiness')).toHaveTextContent(
      L('platform.readiness.ready') as string
    );
  });

  it('draws an organisation past its ceiling as the most severe state, not the mildest', () => {
    renderLtr(
      <PlatformOverview
        locale="en"
        messages={messages}
        statistics={{
          ...statistics,
          capacityAlerts: [
            {
              tenantId: TENANT,
              tenantCode: 'test_org_one',
              displayName: 'Test Organisation One',
              kind: 'branches',
              used: 4,
              limit: 3,
              severity: 'over-limit',
            },
          ],
        }}
        canReadOrganizations={false}
        organizations={null}
      />
    );
    const line = screen.getByText(new RegExp(`${L('platform.capacity.overLimit')}$`));
    expect(line).toHaveTextContent('4 / 3');
    expect(line.textContent).not.toContain(L('platform.capacity.nearLimit'));
    const frame = line.closest('li');
    expect(frame?.className).toContain('bg-error-subtle');
    expect(frame?.className).not.toContain('bg-warning-subtle');
  });

  /*
   * The expiry TILES publish counts; these cases are about the organisations
   * behind them. A count an operator cannot act on is a number, not a warning,
   * so each organisation inside the window is named and linked to its detail —
   * and the three states of that read (not offered, failed, answered) are three
   * different sentences rather than one empty table.
   */
  const organizationRow = (over: Record<string, unknown> = {}) => ({
    id: TENANT,
    tenantCode: 'test_org_one',
    displayName: 'Test Organisation One',
    status: 'active',
    defaultLocale: 'en',
    defaultTimezone: 'Asia/Riyadh',
    createdAt: '2026-01-01T00:00:00.000Z',
    activePlanCode: 'test_plan_one',
    activePlanEffectiveTo: '2026-10-01T00:00:00.000Z',
    activeCompanyCount: 1,
    activeBranchCount: 2,
    activeUserCount: 9,
    ...over,
  });

  const organizationsRead = (rows: readonly unknown[], hasMore = false) =>
    ({
      status: 'ok',
      data: { items: rows, nextCursor: null, hasMore },
      correlationId: 'cid-organizations',
    }) as never;

  it('names each organisation whose subscription ends inside the window, and links to it', () => {
    renderLtr(
      <PlatformOverview
        locale="en"
        messages={messages}
        statistics={statistics}
        canReadOrganizations
        organizations={organizationsRead([
          organizationRow(),
          organizationRow({
            id: OTHER_TENANT,
            displayName: 'Test Organisation Two',
            activePlanEffectiveTo: '2027-06-01T00:00:00.000Z',
          }),
          organizationRow({
            id: THIRD_TENANT,
            displayName: 'Test Organisation Three',
            activePlanEffectiveTo: '2026-09-01T00:00:00.000Z',
          }),
        ])}
      />
    );

    const table = screen.getByRole('table', {
      name: L('platform.overview.expiringOrganizations'),
    });
    const rows = within(table).getAllByRole('row').slice(1);
    // The one beyond ninety days is absent; the one already past is present and
    // says so rather than counting down into a negative number.
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Test Organisation Three');
    expect(rows[0]?.textContent).toContain(L('platform.overview.alreadyEnded'));
    expect(rows[1]?.textContent).toContain('Test Organisation One');
    expect(within(table).queryByText('Test Organisation Two')).toBeNull();
    expect(within(table).getByRole('link', { name: 'Test Organisation One' })).toHaveAttribute(
      'href',
      `/en/platform/organizations/${TENANT}`
    );
  });

  it('states what it examined, and says when more organisations exist behind the page', () => {
    renderLtr(
      <PlatformOverview
        locale="en"
        messages={messages}
        statistics={statistics}
        canReadOrganizations
        organizations={organizationsRead([organizationRow()], true)}
      />
    );
    expect(screen.getByText(/The first 1 organisations were examined/)).toHaveTextContent(
      L('platform.overview.expiringMore')
    );
  });

  it('says the organisations could not be read rather than showing none expiring', () => {
    renderLtr(
      <PlatformOverview
        locale="en"
        messages={messages}
        statistics={statistics}
        canReadOrganizations
        organizations={{ status: 'unavailable', correlationId: 'cid-organizations' }}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent(L('platform.overview.expiringUnavailable'));
    expect(screen.getByRole('alert')).toHaveTextContent('cid-organizations');
    expect(screen.queryByText(L('platform.overview.noExpiring'))).toBeNull();
  });

  it('says the list was never asked for when the operator holds no organisation code', () => {
    renderLtr(
      <PlatformOverview
        locale="en"
        messages={messages}
        statistics={statistics}
        canReadOrganizations={false}
        organizations={null}
      />
    );
    expect(screen.getByText(L('platform.overview.expiringNotOffered'))).toBeInTheDocument();
    expect(screen.queryByText(L('platform.overview.noExpiring'))).toBeNull();
  });

  it('reports an empty window as empty, once the page was actually read', () => {
    renderLtr(
      <PlatformOverview
        locale="en"
        messages={messages}
        statistics={statistics}
        canReadOrganizations
        organizations={organizationsRead([organizationRow({ activePlanEffectiveTo: null })])}
      />
    );
    expect(screen.getByText(L('platform.overview.noExpiring'))).toBeInTheDocument();
  });

  it('renders in Arabic, right to left', () => {
    const { container } = renderRtl(
      <PlatformOverview
        locale="ar"
        messages={getMessages('ar')}
        statistics={statistics}
        canReadOrganizations={false}
        organizations={null}
      />
    );
    expect(document.documentElement.dir).toBe('rtl');
    expect(container.textContent).toContain(
      getMessages('ar')['platform.overview.projectedRenewal']
    );
    expect(screen.queryByRole('link')).toBeNull();
  });
});

/** The fields of one section of the provisioning form, by its heading. */
function section(heading: string): HTMLElement {
  const element = screen.getByRole('heading', { name: heading }).closest('section');
  if (!element) throw new Error(`no section under the heading ${heading}`);
  return element as HTMLElement;
}

function fill(heading: string, label: string, value: string): void {
  fireEvent.change(within(section(heading)).getByLabelText(new RegExp(`^${label}`)), {
    target: { value },
  });
}

describe('provisioning an organisation', () => {
  const retired = { ...plan, id: 'retired-plan', planCode: 'test_plan_retired', status: 'retired' };
  /**
   * The choices the screen is given, as platform.reference-values-read answers
   * them. Supplied by the test, never assumed: the screen must offer exactly
   * these and nothing it was not given.
   */
  const references = {
    currencies: [
      { code: 'JOD', name: 'Jordanian Dinar', minorUnit: 3 },
      { code: 'USD', name: 'US Dollar', minorUnit: 2 },
      { code: 'EUR', name: 'Euro', minorUnit: 2 },
    ],
    timezones: [{ zoneName: 'Asia/Amman' }, { zoneName: 'UTC' }],
    languages: [
      { localeCode: 'ar', name: 'Arabic', direction: 'rtl' },
      { localeCode: 'en', name: 'English', direction: 'ltr' },
    ],
  };

  function optionsOf(heading: string, label: string): (string | null)[] {
    const select = within(section(heading)).getByLabelText(new RegExp(`^${label}`));
    return within(select)
      .getAllByRole('option')
      .map((option) => option.getAttribute('value'));
  }

  function fillTheRequiredFields(): void {
    fill(L('platform.provision.organization'), L('platform.provision.code'), 'test_org_two');
    fill(
      L('platform.provision.organization'),
      L('platform.provision.name'),
      'Test Organisation Two'
    );
    fill(L('platform.provision.organization'), L('platform.provision.language'), 'ar');
    fill(L('platform.provision.organization'), L('platform.provision.timeZone'), 'Asia/Amman');
    fill(L('platform.provision.company'), L('platform.provision.code'), 'test_company_two');
    fill(L('platform.provision.company'), L('platform.provision.legalName'), 'Test Company Two');
    fill(L('platform.provision.company'), L('platform.provision.baseCurrency'), 'JOD');
    fill(L('platform.provision.branch'), L('platform.provision.code'), 'test_branch_two');
    fill(L('platform.provision.branch'), L('platform.provision.name'), 'Test Branch Two');
    fill(L('platform.provision.branch'), L('platform.provision.timeZone'), 'Asia/Amman');
    fill(
      L('platform.provision.administrator'),
      L('platform.provision.email'),
      'operator@test.invalid'
    );
    fill(
      L('platform.provision.administrator'),
      L('platform.provision.displayName'),
      'Test Operator'
    );
  }

  it('offers only a plan that is available, and sends what was typed', async () => {
    provisionOrganizationAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.provision.done',
      attempt: 1,
      tenantId: TENANT,
    });
    renderLtr(
      <ProvisionOrganizationScreen
        locale="en"
        messages={messages}
        plans={[plan, retired]}
        referenceValues={references}
        canActivate
      />
    );

    const planSelect = within(section(L('platform.provision.subscription'))).getByLabelText(
      new RegExp(`^${L('platform.provision.plan')}`)
    );
    expect(
      within(planSelect)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual([L('platform.provision.noSubscription'), 'Test Plan']);

    fillTheRequiredFields();
    fill(L('platform.provision.subscription'), L('platform.provision.plan'), 'test_plan');
    fill(L('platform.provision.subscription'), L('platform.provision.startDate'), '2026-10-01');
    await userEvent.click(
      screen.getByRole('checkbox', { name: new RegExp(L('platform.provision.activate')) })
    );
    await userEvent.click(screen.getByRole('button', { name: L('platform.provision.submit') }));

    await waitFor(() => expect(provisionOrganizationAction).toHaveBeenCalledTimes(1));
    const form = provisionOrganizationAction.mock.calls[0]?.[1] as FormData;
    expect(form.get('tenantCode')).toBe('test_org_two');
    expect(form.get('tenantName')).toBe('Test Organisation Two');
    expect(form.get('tenantLocale')).toBe('ar');
    expect(form.get('companyCode')).toBe('test_company_two');
    expect(form.get('companyCurrency')).toBe('JOD');
    expect(form.get('tenantTimezone')).toBe('Asia/Amman');
    expect(form.get('branchTimezone')).toBe('Asia/Amman');
    expect(form.get('branchName')).toBe('Test Branch Two');
    expect(form.get('ownerEmail')).toBe('operator@test.invalid');
    expect(form.get('planCode')).toBe('test_plan');
    expect(form.get('subscriptionStart')).toBe('2026-10-01');
    expect(form.get('activate')).toBe('on');
  });

  it('states that the administrator is emailed, and opens the organisation it created', async () => {
    provisionOrganizationAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.provision.done',
      attempt: 1,
      tenantId: TENANT,
    });
    renderLtr(
      <ProvisionOrganizationScreen
        locale="en"
        messages={messages}
        plans={[plan]}
        referenceValues={references}
        canActivate={false}
      />
    );
    fillTheRequiredFields();
    await userEvent.click(screen.getByRole('button', { name: L('platform.provision.submit') }));

    expect(await screen.findByRole('status')).toHaveTextContent(L('platform.provision.done'));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/en/platform/organizations/${TENANT}`));
  });

  it('keeps what was typed and shows the server refusal against its own field', async () => {
    provisionOrganizationAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.invalid',
      attempt: 1,
      fieldErrors: { tenantCode: 'platform.error.planCode' },
    });
    renderLtr(
      <ProvisionOrganizationScreen
        locale="en"
        messages={messages}
        plans={null}
        referenceValues={references}
        canActivate={false}
      />
    );
    fillTheRequiredFields();
    await userEvent.click(screen.getByRole('button', { name: L('platform.provision.submit') }));

    expect(
      await within(section(L('platform.provision.organization'))).findByRole('alert')
    ).toHaveTextContent(L('platform.error.planCode'));
    expect(
      within(section(L('platform.provision.organization'))).getByLabelText(
        new RegExp(`^${L('platform.provision.name')}`)
      )
    ).toHaveValue('Test Organisation Two');
  });

  it('says a currency the platform does not hold under Base currency, not in the generic banner', async () => {
    provisionOrganizationAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.formError',
      attempt: 1,
      correlationId: 'corr-reference',
      fieldErrors: { companyCurrency: 'form.violation.unknown_reference' },
    });
    renderLtr(
      <ProvisionOrganizationScreen
        locale="en"
        messages={messages}
        plans={null}
        referenceValues={references}
        canActivate={false}
      />
    );
    fillTheRequiredFields();
    await userEvent.click(screen.getByRole('button', { name: L('platform.provision.submit') }));

    const company = section(L('platform.provision.company'));
    expect(await within(company).findByRole('alert')).toHaveTextContent(
      L('form.violation.unknown_reference')
    );
    expect(
      within(company).getByLabelText(new RegExp(`^${L('platform.provision.baseCurrency')}`))
    ).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText(L('state.error.message'))).toBeNull();
  });

  it('offers no subscription when the plan catalogue could not be read, and no activation without the authority', () => {
    renderLtr(
      <ProvisionOrganizationScreen
        locale="en"
        messages={messages}
        plans={null}
        referenceValues={references}
        canActivate={false}
      />
    );
    expect(
      screen.queryByRole('heading', { name: L('platform.provision.subscription') })
    ).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText(L('platform.provision.administratorHint'))).toBeInTheDocument();
  });

  it('offers exactly the currencies, time zones and languages it was given, and nothing typed', () => {
    renderLtr(
      <ProvisionOrganizationScreen
        locale="en"
        messages={messages}
        plans={null}
        referenceValues={references}
        canActivate={false}
      />
    );
    const organization = L('platform.provision.organization');
    expect(
      optionsOf(L('platform.provision.company'), L('platform.provision.baseCurrency'))
    ).toEqual(['', 'JOD', 'USD', 'EUR']);
    expect(optionsOf(organization, L('platform.provision.timeZone'))).toEqual([
      '',
      'Asia/Amman',
      'UTC',
    ]);
    expect(optionsOf(L('platform.provision.branch'), L('platform.provision.timeZone'))).toEqual([
      '',
      'Asia/Amman',
      'UTC',
    ]);
    expect(optionsOf(organization, L('platform.provision.language'))).toEqual(['', 'ar', 'en']);
    // A currency reads as its name with its code beside it (D-1, never the bare
    // code); a code it was not given cannot be chosen.
    const currency = within(section(L('platform.provision.company'))).getByLabelText(
      new RegExp(`^${L('platform.provision.baseCurrency')}`)
    );
    expect(within(currency).getByRole('option', { name: 'Jordanian Dinar (JOD)' })).toHaveValue(
      'JOD'
    );
    expect(within(currency).queryByRole('option', { name: 'JOD' })).toBeNull();
    const zone = within(section(L('platform.provision.branch'))).getByLabelText(
      new RegExp(`^${L('platform.provision.timeZone')}`)
    );
    expect(within(zone).getByRole('option', { name: /\(Asia\/Amman\)$/ })).toHaveValue(
      'Asia/Amman'
    );
    fireEvent.change(currency, { target: { value: 'SAR' } });
    expect((currency as HTMLSelectElement).value).toBe('');
    expect(currency).not.toBeDisabled();
    expect(screen.queryByText(L('platform.provision.referenceUnavailable'))).toBeNull();
  });

  it('offers a language only when the interface can also be shown in it', () => {
    renderLtr(
      <ProvisionOrganizationScreen
        locale="en"
        messages={messages}
        plans={null}
        referenceValues={{
          ...references,
          languages: [
            ...references.languages,
            { localeCode: 'fr', name: 'French', direction: 'ltr' },
          ],
        }}
        canActivate={false}
      />
    );
    expect(
      optionsOf(L('platform.provision.organization'), L('platform.provision.language'))
    ).toEqual(['', 'ar', 'en']);
  });

  it('says to choose a currency under Base currency when none was chosen', async () => {
    provisionOrganizationAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.invalid',
      attempt: 1,
      fieldErrors: { companyCurrency: 'platform.error.chooseCurrency' },
    });
    renderLtr(
      <ProvisionOrganizationScreen
        locale="en"
        messages={messages}
        plans={null}
        referenceValues={references}
        canActivate={false}
      />
    );
    fillTheRequiredFields();
    fill(L('platform.provision.company'), L('platform.provision.baseCurrency'), '');
    await userEvent.click(screen.getByRole('button', { name: L('platform.provision.submit') }));

    const form = provisionOrganizationAction.mock.calls[0]?.[1] as FormData;
    expect(form.get('companyCurrency')).toBe('');
    expect(
      await within(section(L('platform.provision.company'))).findByRole('alert')
    ).toHaveTextContent(L('platform.error.chooseCurrency'));
  });

  /*
   * P1-32-PRE-OD-QAF, item B. The list is read on the server, so a failed read
   * arrives as `null`. Each of the four selects says so on itself and offers Try
   * again (a page refresh), and the form refuses to send, marking all four and
   * putting the cursor on the first — it never sends an empty choice that looked
   * finished. In both languages.
   */
  it.each([
    ['en', renderLtr, EN],
    ['ar', renderRtl, AR],
  ] as const)(
    '%s: says the four lists could not be loaded, retries, and refuses to send',
    async (locale, paint, catalogue) => {
      const M = (key: string): string => catalogue[key] ?? `missing message ${key}`;
      paint(
        <ProvisionOrganizationScreen
          locale={locale}
          messages={getMessages(locale)}
          plans={null}
          referenceValues={null}
          canActivate={false}
        />
      );
      const organization = section(M('platform.provision.organization'));
      const controls = [
        within(organization).getByLabelText(new RegExp(`^${M('platform.provision.language')}`)),
        within(organization).getByLabelText(new RegExp(`^${M('platform.provision.timeZone')}`)),
        within(section(M('platform.provision.company'))).getByLabelText(
          new RegExp(`^${M('platform.provision.baseCurrency')}`)
        ),
        within(section(M('platform.provision.branch'))).getByLabelText(
          new RegExp(`^${M('platform.provision.timeZone')}`)
        ),
      ];
      for (const control of controls) {
        expect(control.tagName).toBe('SELECT');
        // Focusable, so the cursor can be taken to it when the form refuses.
        expect(control).not.toBeDisabled();
      }
      expect(screen.getAllByText(M('platform.provision.referenceUnavailable'))).toHaveLength(4);
      // Nothing falls back to free text: the only text boxes are the ones that
      // were always text.
      expect(within(organization).queryByRole('textbox', { name: /time zone/i })).toBeNull();

      const retries = screen.getAllByRole('button', { name: M('form.retry') });
      expect(retries).toHaveLength(4);
      await userEvent.click(retries[2] as HTMLElement);
      expect(refresh).toHaveBeenCalledTimes(1);

      await userEvent.click(screen.getByRole('button', { name: M('platform.provision.submit') }));
      expect(await screen.findAllByText(M('form.referenceList.blocked'))).toHaveLength(4);
      for (const control of controls) expect(control).toHaveAttribute('aria-invalid', 'true');
      expect(controls[0]).toHaveFocus();
      expect(provisionOrganizationAction).not.toHaveBeenCalled();
    }
  );

  it('ar: reads a currency and a zone by name in Arabic, with the code beside it', () => {
    renderRtl(
      <ProvisionOrganizationScreen
        locale="ar"
        messages={getMessages('ar')}
        plans={null}
        referenceValues={references}
        canActivate={false}
      />
    );
    const M = (key: string): string => AR[key] ?? `missing message ${key}`;
    const currency = within(section(M('platform.provision.company'))).getByLabelText(
      new RegExp(`^${M('platform.provision.baseCurrency')}`)
    );
    const jod = within(currency).getByRole('option', { name: /\(JOD\)$/ });
    expect(jod).toHaveValue('JOD');
    expect(jod.textContent).toMatch(/[؀-ۿ]/);
    expect(currency).not.toHaveAttribute('dir', 'ltr');
    expect(screen.queryAllByRole('button', { name: M('form.retry') })).toHaveLength(0);
  });
});

describe('the plan catalogue', () => {
  const unlimited = {
    ...plan,
    id: '55555555-5555-4555-8555-555555555555',
    planCode: 'test_plan_open',
    name: 'Test Plan Open',
    displayName: 'Test Plan Open',
    listPrice: null,
    currencyCode: null,
    termMonths: null,
    capacityLimits: {},
    status: 'draft',
  };

  it('shows the price, the term and an absent limit as unlimited', () => {
    renderLtr(withMui(<PlansScreen locale="en" messages={messages} plans={[plan, unlimited]} />));
    const rows = dataRows(screen.getByTestId('platform-plans-grid'));
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText('1,200.00 SAR')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText(/12 months/)).toBeInTheDocument();
    expect(
      within(rows[1] as HTMLElement).getByText(L('platform.plans.noPrice'))
    ).toBeInTheDocument();
    expect(
      within(rows[1] as HTMLElement).getAllByText(new RegExp(`${L('platform.usage.unlimited')}$`))
    ).toHaveLength(3);
  });

  it('sends a new plan with its price as a decimal string and a blank limit as no limit', async () => {
    createPlanAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.plans.created',
      attempt: 1,
    });
    renderLtr(withMui(<PlansScreen locale="en" messages={messages} plans={[plan]} />));
    await userEvent.click(screen.getByRole('button', { name: L('platform.plans.new') }));
    const dialog = await screen.findByRole('dialog');

    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.plans.code')}`)),
      'test_plan_two'
    );
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.plans.name')}`)),
      'Test Plan Two'
    );
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.billing.currency')}`)),
      'sar'
    );
    const price = within(dialog).getByLabelText(new RegExp(`^${L('platform.plans.price')}`));
    await userEvent.type(price, '2400');
    fireEvent.blur(price);
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.subscription.termMonths')}`)),
      '24'
    );
    await typeDay(dialog, L('platform.plans.from'), '01012027');
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.capacity.companies')}`)),
      '5'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));

    await waitFor(() => expect(createPlanAction).toHaveBeenCalledTimes(1));
    const input = createPlanAction.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input.listPrice).toBe('2400.0000');
    expect(typeof input.listPrice).toBe('string');
    expect(input).toMatchObject({
      planCode: 'test_plan_two',
      displayName: 'Test Plan Two',
      currencyCode: 'SAR',
      termMonths: 24,
      capacityLimits: { companies: 5 },
      status: 'draft',
      effectiveFrom: '2027-01-01',
    });
    expect(Object.keys(input.capacityLimits as object)).toEqual(['companies']);
    expect(typeof input.termMonths).toBe('number');
    // The whole document, and nothing beside it: what the form sent before it
    // moved onto Material UI, key for key.
    expect(input).toEqual({
      planCode: 'test_plan_two',
      displayName: 'Test Plan Two',
      listPrice: '2400.0000',
      currencyCode: 'SAR',
      termMonths: 24,
      capacityLimits: { companies: 5 },
      entitlementDocument: {},
      status: 'draft',
      effectiveFrom: '2027-01-01',
    });
  });

  /*
   * `plan_document` — `platform/application/subscription-service.ts:566`,
   * against `body`. It names no control because it cannot: the refusal is the
   * plan document as a whole, an entitlement naming a feature that is not one
   * the platform has or a limit outside the range its column admits. A
   * whole-request violation travels to the banner, which this dialog draws.
   */
  it('shows the whole-plan refusal in the dialog banner, with what was typed still there', async () => {
    createPlanAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.violation.plan_document',
      correlationId: 'c-plan',
      attempt: 1,
    });
    renderLtr(withMui(<PlansScreen locale="en" messages={messages} plans={[plan]} />));
    await userEvent.click(screen.getByRole('button', { name: L('platform.plans.new') }));
    const dialog = await screen.findByRole('dialog');

    const code = within(dialog).getByLabelText(new RegExp(`^${L('platform.plans.code')}`));
    await userEvent.type(code, 'test_plan_three');
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.plans.name')}`)),
      'Test Plan Three'
    );
    await typeDay(dialog, L('platform.plans.from'), '01012027');
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));

    expect(await within(dialog).findByText(L('form.violation.plan_document'))).toBeVisible();
    expect(code).toHaveValue('test_plan_three');
  });

  it('edits under the version the operator was looking at, and freezes the code', async () => {
    updatePlanAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.plans.updated',
      attempt: 1,
    });
    renderLtr(withMui(<PlansScreen locale="en" messages={messages} plans={[plan]} />));
    // The row's action is named for its plan as well, so ten rows of "Edit" are
    // ten different controls: the name starts with the word and goes on.
    await userEvent.click(
      screen.getAllByRole('button', { name: labelledBy(L('platform.plans.edit')) })[0]!
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.plans.code')}`))
    ).toHaveAttribute('readonly');

    const name = within(dialog).getByLabelText(new RegExp(`^${L('platform.plans.name')}`));
    await userEvent.clear(name);
    await userEvent.type(name, 'Test Plan Renamed');
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));

    await waitFor(() => expect(updatePlanAction).toHaveBeenCalledTimes(1));
    const [planId, version, input] = updatePlanAction.mock.calls[0] as [
      string,
      number,
      Record<string, unknown>,
    ];
    expect(planId).toBe(PLAN);
    expect(version).toBe(1);
    expect(input).toMatchObject({ planCode: 'test_plan', displayName: 'Test Plan Renamed' });
    // The whole document the edit carries, as it did before the move.
    expect(input).toEqual({
      planCode: 'test_plan',
      displayName: 'Test Plan Renamed',
      listPrice: '1200.0000',
      currencyCode: 'SAR',
      termMonths: 12,
      capacityLimits: { companies: 1, users: 10 },
      entitlementDocument: {},
      status: 'active',
      effectiveFrom: '2026-01-01',
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  /*
   * `platform.plan-list` answers the whole catalogue in one reply: no limit, no
   * cursor. So the grid draws every plan it was handed and no pager — a
   * catalogue longer than a table page must not lose its tail, and a control
   * that pages nothing must not be offered.
   */
  it.each(BOTH_DIRECTIONS)(
    '%s: lists every plan of a catalogue longer than one page, with no pager',
    async (locale, paint) => {
      const catalogue = getMessages(locale);
      const words = catalogue as Record<string, string>;
      const many = Array.from({ length: 30 }, (_, index) => ({
        ...plan,
        id: `55555555-5555-4555-8555-${String(index).padStart(12, '0')}`,
        planCode: `test_plan_${index}`,
        name: `Test Plan ${index}`,
        displayName: `Test Plan ${index}`,
      }));
      paint(withMui(<PlansScreen locale={locale} messages={catalogue} plans={many} />, locale));

      const grid = await screen.findByRole('grid', {
        name: words['platform.plans.title'] as string,
      });
      await within(grid).findByText('test_plan_0');
      expect(document.documentElement.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      const rows = dataRows(grid);
      expect(rows).toHaveLength(30);
      expect(within(rows[29] as HTMLElement).getByText('test_plan_29')).toBeInTheDocument();
      expect(
        screen.queryByRole('navigation', { name: words['table.pagination'] as string })
      ).toBeNull();
      expect(screen.queryByRole('button', { name: words['table.nextPage'] as string })).toBeNull();
      expect(screen.queryByTestId('platform-plans-empty')).toBeNull();

      // Each limit under a heading of its own, and a row's values in the
      // reader's language.
      for (const kind of ['companies', 'branches', 'users']) {
        expect(
          within(grid).getByRole('columnheader', {
            name: words[`platform.plans.limit.${kind}`] as string,
          })
        ).toBeInTheDocument();
      }
      const first = rows[0] as HTMLElement;
      expect(within(first).getByText('Test Plan 0')).toBeInTheDocument();
      expect(
        within(first).getByText(words['platform.status.active'] as string)
      ).toBeInTheDocument();
      expect(flat(first.textContent)).toContain(
        flat(formatMoney({ amount: '1200.0000', currency: 'SAR' }, intlLocale(locale)))
      );
      expect(flat(first.textContent)).toContain(
        flat(`${formatInteger(12, locale)} ${words['platform.subscription.months']}`)
      );
      expect(
        within(first).getByText(words['platform.usage.unlimited'] as string)
      ).toBeInTheDocument();
      // The row's one edit button, named by the plan and its first day after
      // the visible label: the hidden text is part of the name.
      expect(
        within(first).getByRole('button', {
          name: labelledBy(words['platform.plans.edit'] as string),
        })
      ).toHaveAccessibleName(
        `${words['platform.plans.edit']} Test Plan 0, ${formatDate('2026-01-01', locale)}`
      );
    }
  );

  it.each(BOTH_DIRECTIONS)(
    '%s: says in its own sentence that no plan exists yet',
    (locale, paint) => {
      const catalogue = getMessages(locale);
      const words = catalogue as Record<string, string>;
      paint(withMui(<PlansScreen locale={locale} messages={catalogue} plans={[]} />, locale));

      const empty = screen.getByTestId('platform-plans-empty');
      expect(empty).toHaveAttribute('role', 'status');
      expect(empty).toHaveTextContent(words['platform.plans.none'] as string);
      expect(dataRows(screen.getByTestId('platform-plans-grid'))).toHaveLength(0);
      expect(
        screen.getByRole('button', { name: words['platform.plans.new'] as string })
      ).toBeEnabled();
    }
  );

  it('ar: sends the same plan document from the Arabic form, right to left', async () => {
    const arabic = getMessages('ar');
    const A = (key: string) => AR[key] as string;
    createPlanAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.plans.created',
      attempt: 1,
    });
    renderRtl(withMui(<PlansScreen locale="ar" messages={arabic} plans={[plan]} />, 'ar'));
    expect(document.documentElement.dir).toBe('rtl');
    await userEvent.click(screen.getByRole('button', { name: A('platform.plans.new') }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading')).toHaveTextContent(A('platform.plans.newTitle'));

    await userEvent.type(
      within(dialog).getByLabelText(labelledBy(A('platform.plans.code'))),
      'test_plan_two'
    );
    await userEvent.type(
      within(dialog).getByLabelText(labelledBy(A('platform.plans.name'))),
      'Test Plan Two'
    );
    await userEvent.type(
      within(dialog).getByLabelText(labelledBy(A('platform.billing.currency'))),
      'sar'
    );
    const price = within(dialog).getByLabelText(labelledBy(A('platform.plans.price')));
    await userEvent.type(price, '2400');
    fireEvent.blur(price);
    await userEvent.type(
      within(dialog).getByLabelText(labelledBy(A('platform.subscription.termMonths'))),
      '24'
    );
    await typeDay(dialog, A('platform.plans.from'), '01012027');
    await typeDay(dialog, A('platform.plans.to'), '31122027');
    await userEvent.type(
      within(dialog).getByLabelText(labelledBy(A('platform.plans.descriptionLabel'))),
      'Test description'
    );
    await userEvent.type(
      within(dialog).getByLabelText(labelledBy(A('platform.capacity.companies'))),
      '5'
    );
    // A module no plan names yet is added by its code, and arrives ticked.
    await userEvent.type(
      within(dialog).getByLabelText(labelledBy(A('platform.plans.addModule'))),
      'test_module'
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: A('platform.plans.addModuleSubmit') })
    );
    expect(within(dialog).getByRole('checkbox', { name: 'test_module' })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: A('platform.save') }));

    await waitFor(() => expect(createPlanAction).toHaveBeenCalledTimes(1));
    expect(createPlanAction.mock.calls[0]?.[0]).toEqual({
      planCode: 'test_plan_two',
      displayName: 'Test Plan Two',
      description: 'Test description',
      listPrice: '2400.0000',
      currencyCode: 'SAR',
      termMonths: 24,
      capacityLimits: { companies: 5 },
      entitlementDocument: { test_module: true },
      status: 'draft',
      effectiveFrom: '2027-01-01',
      effectiveTo: '2027-12-31',
    });
  });

  /*
   * A day only partly typed holds no day, and the picker hands back the same
   * empty value as a box nobody touched. Sent as it stood, the plan would be
   * saved with no end day at all while the box showed most of one.
   */
  it('refuses an end day only partly typed on its own box, and sends nothing until it is finished', async () => {
    const user = userEvent.setup();
    createPlanAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.plans.created',
      attempt: 1,
    });
    renderLtr(withMui(<PlansScreen locale="en" messages={messages} plans={[plan]} />));
    await user.click(screen.getByRole('button', { name: L('platform.plans.new') }));
    const dialog = await screen.findByRole('dialog');
    await user.type(
      within(dialog).getByLabelText(labelledBy(L('platform.plans.code'))),
      'test_plan_four'
    );
    await user.type(
      within(dialog).getByLabelText(labelledBy(L('platform.plans.name'))),
      'Test Plan Four'
    );
    await typeDay(dialog, L('platform.plans.from'), '01012027');
    // The day and the month, and no year.
    const until = await typeDay(dialog, L('platform.plans.to'), '3112');
    await user.click(within(dialog).getByRole('button', { name: L('platform.save') }));

    expect(await within(dialog).findByText(L('platform.error.date'))).toBeVisible();
    expect(until).toHaveAttribute('aria-invalid', 'true');
    expect(createPlanAction).not.toHaveBeenCalled();

    await user.click(within(until).getAllByRole('spinbutton')[2] as HTMLElement);
    await user.keyboard('2027');
    await waitFor(() => expect(within(dialog).queryByText(L('platform.error.date'))).toBeNull());
    await user.click(within(dialog).getByRole('button', { name: L('platform.save') }));
    await waitFor(() => expect(createPlanAction).toHaveBeenCalledTimes(1));
    expect(createPlanAction.mock.calls[0]?.[0]).toMatchObject({
      effectiveFrom: '2027-01-01',
      effectiveTo: '2027-12-31',
    });
  });
});

describe('the activity search', () => {
  const event = {
    id: '66666666-6666-4666-8666-666666666666',
    action: 'org.tenant.provisioned',
    entityType: 'org.tenant',
    entityId: TENANT,
    actorId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    actorKind: 'user',
    correlationId: null,
    targetTenantId: TENANT,
    occurredAt: '2026-09-16T09:00:00.000Z',
  };

  function renderScreen() {
    renderLtr(
      withMui(
        <PlatformAuditScreen
          locale="en"
          messages={messages}
          initialFrom="2026-08-17"
          initialTo="2026-09-16"
          initialOrganizationId=""
          organizations={[row]}
        />
      )
    );
  }

  /** The criteria form: the two days, the two choices and the button. */
  const criteria = () => screen.getByTestId('platform-audit-criteria');
  const page = (items: readonly unknown[], nextCursor: string | null = null) => ({
    ok: true,
    data: { items, nextCursor, hasMore: nextCursor !== null },
    correlationId: 'c',
  });

  it('opens on the window it was given and names the change and the organisation', async () => {
    apiGet.mockResolvedValue({
      ok: true,
      data: { items: [event], nextCursor: null, hasMore: false },
      correlationId: 'c',
    });
    renderScreen();

    expect(await screen.findByText(L('platform.audit.action.0'))).toBeInTheDocument();
    const first = new URLSearchParams(String(apiGet.mock.calls[0]?.[0]).split('?')[1]);
    expect(first.get('from')).toBe('2026-08-17T00:00:00.000Z');
    expect(first.get('to')).toBe('2026-09-16T23:59:59.999Z');
    expect(first.get('action')).toBeNull();
    expect(first.get('targetTenantId')).toBeNull();
    const table = screen.getByRole('grid', { name: L('platform.audit.title') });
    expect(within(table).getByText('Test Organisation One')).toBeInTheDocument();
    expect(within(table).getByText(L('platform.audit.actor.user'))).toBeInTheDocument();
  });

  it('applies the criteria together, and only when they are asked for', async () => {
    apiGet.mockResolvedValue({
      ok: true,
      data: { items: [event], nextCursor: null, hasMore: false },
      correlationId: 'c',
    });
    renderScreen();
    await screen.findByText(L('platform.audit.action.0'));

    // The grid's headings carry the same words, so the controls are looked for
    // in the criteria form they belong to.
    await userEvent.selectOptions(
      within(criteria()).getByLabelText(labelledBy(L('platform.audit.column.action'))),
      'org.subscription_charge.recorded'
    );
    await userEvent.selectOptions(
      within(criteria()).getByLabelText(labelledBy(L('platform.audit.column.organization'))),
      TENANT
    );
    await typeDay(criteria(), L('platform.audit.from'), '01092026');
    expect(apiGet).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: L('platform.audit.apply') }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    const applied = new URLSearchParams(String(apiGet.mock.calls[1]?.[0]).split('?')[1]);
    expect(applied.get('from')).toBe('2026-09-01T00:00:00.000Z');
    expect(applied.get('action')).toBe('org.subscription_charge.recorded');
    expect(applied.get('targetTenantId')).toBe(TENANT);
  });

  /*
   * The server caps the window at 92 days and refuses a wider one as a
   * validation failure. A refused read reaches the table as the undifferentiated
   * error state — "something went wrong" over a Retry that can only be refused
   * again — so the screen names the limit before it spends the request.
   */
  it('refuses a window wider than the server accepts, naming the limit, and asks for nothing', async () => {
    apiGet.mockResolvedValue({
      ok: true,
      data: { items: [event], nextCursor: null, hasMore: false },
      correlationId: 'c',
    });
    renderScreen();
    await screen.findByText(L('platform.audit.action.0'));

    await typeDay(criteria(), L('platform.audit.from'), '01012026');
    await userEvent.click(screen.getByRole('button', { name: L('platform.audit.apply') }));

    expect(await screen.findByText('Choose a range of 92 days or fewer.')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it('refuses an end date before the start date, and withdraws the complaint on an edit', async () => {
    apiGet.mockResolvedValue({
      ok: true,
      data: { items: [event], nextCursor: null, hasMore: false },
      correlationId: 'c',
    });
    renderScreen();
    await screen.findByText(L('platform.audit.action.0'));

    const until = await typeDay(criteria(), L('platform.audit.to'), '01082026');
    await userEvent.click(screen.getByRole('button', { name: L('platform.audit.apply') }));
    expect(await screen.findByText(L('platform.audit.error.range'))).toBeInTheDocument();
    // The complaint is the end day's own: its box is the one marked.
    expect(until).toHaveAttribute('aria-invalid', 'true');
    expect(apiGet).toHaveBeenCalledTimes(1);

    await typeDay(criteria(), L('platform.audit.to'), '15092026');
    await waitFor(() => expect(screen.queryByText(L('platform.audit.error.range'))).toBeNull());

    await userEvent.click(screen.getByRole('button', { name: L('platform.audit.apply') }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    const applied = new URLSearchParams(String(apiGet.mock.calls[1]?.[0]).split('?')[1]);
    expect(applied.get('to')).toBe('2026-09-15T23:59:59.999Z');
  });

  /*
   * The criteria are held outside the table request on purpose, so the table
   * cannot tell a narrowed search from an empty trail. Left to itself it said
   * "Nothing here yet" — a claim about every change ever made from this console
   * — on the evidence of one window that held none.
   */
  it('says no change matches the criteria, rather than that the record is empty', async () => {
    apiGet.mockResolvedValue({
      ok: true,
      data: { items: [], nextCursor: null, hasMore: false },
      correlationId: 'c',
    });
    renderScreen();

    const empty = await screen.findByTestId('platform-audit-empty');
    expect(empty).toHaveTextContent(L('platform.audit.noMatches'));
    expect(screen.queryByText(L('state.empty.title'))).toBeNull();
    /*
     * ANNOUNCED, not merely printed. The rows disappear on a search that
     * matched nothing; a bare paragraph in their place leaves an operator who
     * cannot see the table with no announcement and no heading to land on, so
     * the sentence is carried by the shared state shell.
     */
    const announced = within(empty).getByRole('status');
    expect(within(announced).getByRole('heading')).toHaveTextContent(L('state.noResults.title'));
  });

  /*
   * Arabic, right to left, and by keyboard alone — the three things the English
   * mouse-driven cases above cannot show. Both refusals and the zero-row
   * sentence are the screen's own new words, so all three are read in Arabic.
   */
  it('refuses the window and states the empty result in Arabic, right to left', async () => {
    const arabic = getMessages('ar');
    apiGet.mockResolvedValue({
      ok: true,
      data: { items: [], nextCursor: null, hasMore: false },
      correlationId: 'c',
    });
    renderRtl(
      withMui(
        <PlatformAuditScreen
          locale="ar"
          messages={arabic}
          initialFrom="2026-08-17"
          initialTo="2026-09-16"
          initialOrganizationId=""
          organizations={[row]}
        />,
        'ar'
      )
    );

    expect(document.documentElement.dir).toBe('rtl');
    const empty = await screen.findByTestId('platform-audit-empty');
    expect(empty).toHaveTextContent(AR['platform.audit.noMatches'] as string);
    // Real Arabic, not an English string sitting in the Arabic catalogue.
    expect(AR['platform.audit.noMatches']).not.toBe(EN['platform.audit.noMatches']);

    await typeDay(criteria(), AR['platform.audit.from'] as string, '01012026');
    await userEvent.click(
      screen.getByRole('button', { name: AR['platform.audit.apply'] as string })
    );
    // The day count is formatted in the locale's own digits, so the sentence is
    // recognised by its words rather than by a hard-coded numeral.
    expect(await screen.findByText(/اختر مدة لا تتجاوز/)).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it('applies the criteria from the keyboard alone', async () => {
    apiGet.mockResolvedValue({
      ok: true,
      data: { items: [event], nextCursor: null, hasMore: false },
      correlationId: 'c',
    });
    renderScreen();
    await screen.findByText(L('platform.audit.action.0'));

    await typeDay(criteria(), L('platform.audit.from'), '01092026');
    const apply = screen.getByRole('button', { name: L('platform.audit.apply') });
    apply.focus();
    expect(apply).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    const applied = new URLSearchParams(String(apiGet.mock.calls[1]?.[0]).split('?')[1]);
    expect(applied.get('from')).toBe('2026-09-01T00:00:00.000Z');
  });

  /*
   * One entry, whole. The search read already carries every field of an entry,
   * so opening one reads nothing; and nothing is left out or rewritten: where
   * the screen has words for a value the words are shown AND the value as it
   * was recorded, and a reference with no words is shown under a label that
   * says what it is. The fields are taken from the entry itself, so a field
   * added to the read with no row in the drawer fails here.
   */
  it.each(BOTH_DIRECTIONS)(
    '%s: opens one entry and shows every field it holds, in words and as recorded',
    async (locale, paint) => {
      const catalogue = getMessages(locale);
      const words = catalogue as Record<string, string>;
      const whole = { ...event, correlationId: 'corr-test-0001' };
      apiGet.mockResolvedValue(page([whole]));
      paint(
        withMui(
          <PlatformAuditScreen
            locale={locale}
            messages={catalogue}
            initialFrom="2026-08-17"
            initialTo="2026-09-16"
            initialOrganizationId=""
            organizations={[row]}
          />,
          locale
        )
      );

      const grid = await screen.findByRole('grid', {
        name: words['platform.audit.title'] as string,
      });
      await within(grid).findByText(words['platform.audit.action.0'] as string);
      expect(document.documentElement.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      // In the grid the account is its whole reference, never the start of it.
      const account = within(within(grid).getByTestId('platform-audit-actor')).getByText(
        whole.actorId
      );
      expect(account.closest('[data-grid-line]')).toHaveAttribute('title', whole.actorId);

      const open = within(grid).getByRole('button', {
        name: labelledBy(words['platform.audit.detail.open'] as string),
      });
      // Named by the change and its moment after the visible label.
      expect(open).toHaveAccessibleName(
        `${words['platform.audit.detail.open']} ${words['platform.audit.action.0']}, ${formatDateTime(whole.occurredAt, locale)}`
      );
      await userEvent.click(open);
      const drawer = await screen.findByTestId('platform-audit-detail');
      expect(drawer).toHaveAttribute('role', 'dialog');
      expect(within(drawer).getByRole('heading')).toHaveTextContent(
        words['platform.audit.detail.title'] as string
      );
      // Opening an entry asked the server for nothing.
      expect(apiGet).toHaveBeenCalledTimes(1);

      const fields = within(drawer).getAllByTestId('platform-audit-field');
      const field = (name: string) =>
        fields.find((candidate) => candidate.getAttribute('data-field') === name) as HTMLElement;
      expect(fields.map((candidate) => candidate.getAttribute('data-field')).sort()).toEqual(
        Object.keys(whole).sort()
      );
      for (const [name, value] of Object.entries(whole)) {
        const recorded = field(name).querySelectorAll('[data-audit-verbatim]');
        expect(recorded, name).toHaveLength(1);
        expect(recorded[0]?.textContent, name).toBe(value);
        expect(recorded[0], name).toHaveAttribute('dir', 'ltr');
      }

      // The words beside each value that has them, and the label of each that
      // has none.
      expect(field('action')).toHaveTextContent(words['platform.audit.action.0'] as string);
      expect(flat(field('occurredAt').textContent)).toContain(
        flat(formatDateTime(whole.occurredAt, locale))
      );
      expect(field('actorKind')).toHaveTextContent(words['platform.audit.actor.user'] as string);
      expect(field('targetTenantId')).toHaveTextContent('Test Organisation One');
      expect(field('entityType')).toHaveTextContent(
        words['platform.audit.entity.organization'] as string
      );
      for (const [name, label] of [
        ['action', 'platform.audit.column.action'],
        ['occurredAt', 'platform.audit.column.time'],
        ['actorKind', 'platform.audit.column.actor'],
        ['actorId', 'platform.audit.detail.accountReference'],
        ['targetTenantId', 'platform.audit.column.organization'],
        ['entityType', 'platform.audit.column.summary'],
        ['entityId', 'platform.audit.detail.recordReference'],
        ['correlationId', 'platform.audit.detail.supportReference'],
        ['id', 'platform.audit.detail.entryReference'],
      ] as const) {
        expect(within(field(name)).getByRole('term')).toHaveTextContent(words[label] as string);
      }

      await userEvent.click(
        within(drawer).getByRole('button', { name: words['overlay.close'] as string })
      );
      await waitFor(() => expect(screen.queryByTestId('platform-audit-detail')).toBeNull());
    }
  );

  it('shows an entry it has no words for by its codes, and a field the entry does not hold as not recorded', async () => {
    const bare = {
      id: '77777777-7777-4777-8777-777777777777',
      action: 'test.area.something_done',
      entityType: 'test.area_record',
      entityId: null,
      actorId: null,
      actorKind: 'system',
      correlationId: null,
      // Not among the organisations the page read for its choices.
      targetTenantId: THIRD_TENANT,
      occurredAt: '2026-09-15T22:30:00.000Z',
    };
    apiGet.mockResolvedValue(page([bare]));
    renderScreen();

    const grid = await screen.findByRole('grid', { name: L('platform.audit.title') });
    await within(grid).findByText(L('platform.audit.action.other'));
    const line = dataRows(grid)[0] as HTMLElement;
    // The neutral words, and the code or reference beneath each.
    expect(within(line).getByText('test.area.something_done')).toBeInTheDocument();
    expect(within(line).getByText(L('platform.audit.entity.other'))).toBeInTheDocument();
    expect(within(line).getByText('test.area_record')).toBeInTheDocument();
    expect(within(line).getByText(L('platform.audit.unknownOrganization'))).toBeInTheDocument();
    expect(within(line).getByText(THIRD_TENANT)).toBeInTheDocument();
    expect(within(line).getByText(L('platform.audit.actor.system'))).toBeInTheDocument();

    const open = within(line).getByRole('button', {
      name: labelledBy(L('platform.audit.detail.open')),
    });
    // An entry with no words of its own is named by the neutral words.
    expect(open).toHaveAccessibleName(
      `${L('platform.audit.detail.open')} ${L('platform.audit.action.other')}, ${formatDateTime(bare.occurredAt, 'en')}`
    );
    await userEvent.click(open);
    const drawer = await screen.findByTestId('platform-audit-detail');
    const field = (name: string) =>
      within(drawer)
        .getAllByTestId('platform-audit-field')
        .find((candidate) => candidate.getAttribute('data-field') === name) as HTMLElement;
    for (const name of ['actorId', 'entityId', 'correlationId']) {
      expect(field(name), name).toHaveTextContent(L('platform.audit.detail.notRecorded'));
      expect(field(name).querySelector('[data-audit-verbatim]'), name).toBeNull();
    }
    expect(field('action')).toHaveTextContent(L('platform.audit.action.other'));
    expect(field('action').querySelector('[data-audit-verbatim]')?.textContent).toBe(
      'test.area.something_done'
    );
    expect(field('entityType').querySelector('[data-audit-verbatim]')?.textContent).toBe(
      'test.area_record'
    );
    expect(field('targetTenantId')).toHaveTextContent(L('platform.audit.unknownOrganization'));
    expect(field('targetTenantId').querySelector('[data-audit-verbatim]')?.textContent).toBe(
      THIRD_TENANT
    );
    expect(field('actorKind').querySelector('[data-audit-verbatim]')?.textContent).toBe('system');
  });

  /*
   * A refusal, a failure and an outage are not a search that matched nothing:
   * each is said as itself, in both languages, and the screen's own "no change
   * matches" sentence stays away.
   */
  it.each(ACTIVITY_READ_FAILURES)(
    '$locale: says $name as itself when the activity is read, not as a search with no match',
    async ({ locale, paint, answer, testId, title }) => {
      const catalogue = getMessages(locale);
      const words = catalogue as Record<string, string>;
      apiGet.mockResolvedValue(answer);
      paint(
        withMui(
          <PlatformAuditScreen
            locale={locale}
            messages={catalogue}
            initialFrom="2026-08-17"
            initialTo="2026-09-16"
            initialOrganizationId=""
            organizations={[row]}
          />,
          locale
        )
      );

      const state = await screen.findByTestId(testId);
      expect(within(state).getByRole('heading')).toHaveTextContent(words[title] as string);
      expect(within(state).getByText(answer.correlationId)).toBeInTheDocument();
      expect(screen.queryByTestId('platform-audit-empty')).toBeNull();
      expect(screen.queryByRole('grid')).toBeNull();
      // The criteria stay, so the window can still be changed.
      expect(
        screen.getByRole('button', { name: words['platform.audit.apply'] as string })
      ).toBeEnabled();
    }
  );

  /*
   * An ended session is said as itself and offers no link to bare sign-in, as
   * on the organisation list: the console's own session check is what sends an
   * ended session on, with the page it was on.
   */
  it.each(BOTH_DIRECTIONS)(
    '%s: says an ended session as itself when the activity is read, with no sign-in link',
    async (locale, paint) => {
      const catalogue = getMessages(locale);
      const words = catalogue as Record<string, string>;
      apiGet.mockResolvedValue({ ok: false, kind: 'unauthenticated', correlationId: 'c-ended' });
      paint(
        withMui(
          <PlatformAuditScreen
            locale={locale}
            messages={catalogue}
            initialFrom="2026-08-17"
            initialTo="2026-09-16"
            initialOrganizationId=""
            organizations={[row]}
          />,
          locale
        )
      );

      const state = await screen.findByTestId('state-expired');
      expect(within(state).getByRole('heading')).toHaveTextContent(
        words['state.expired.title'] as string
      );
      expect(within(state).queryByRole('link')).toBeNull();
      expect(screen.queryByRole('link', { name: words['auth.backToLogin'] as string })).toBeNull();
      expect(document.querySelector(`a[href^="/${locale}/login"]`)).toBeNull();
      expect(screen.queryByTestId('platform-audit-empty')).toBeNull();
      expect(screen.queryByRole('grid')).toBeNull();
    }
  );

  it('pages the trail by the cursor the server returned, under the window it was opened on', async () => {
    apiGet.mockResolvedValueOnce(page([event], 'cursor-two')).mockResolvedValueOnce(
      page([
        {
          ...event,
          id: '66666666-6666-4666-8666-666666666667',
          action: 'org.subscription_plan.created',
        },
      ])
    );
    renderScreen();
    await screen.findByText(L('platform.audit.action.0'));
    const first = new URLSearchParams(String(apiGet.mock.calls[0]?.[0]).split('?')[1]);
    expect(first.get('limit')).toBe('25');
    expect(first.get('cursor')).toBeNull();
    const label = screen.getByTestId('platform-audit-grid-page');
    expect(label).toHaveTextContent(L('mui.pagination.page').replace('{page}', '1'));

    const grid = screen.getByRole('grid', { name: L('platform.audit.title') });
    await userEvent.click(screen.getByRole('button', { name: L('table.nextPage') }));
    await within(grid).findByText(L('platform.audit.action.2'));
    const second = new URLSearchParams(String(apiGet.mock.calls[1]?.[0]).split('?')[1]);
    expect(second.get('cursor')).toBe('cursor-two');
    expect(second.get('from')).toBe('2026-08-17T00:00:00.000Z');
    expect(second.get('to')).toBe('2026-09-16T23:59:59.999Z');
    expect(label).toHaveTextContent(L('mui.pagination.page').replace('{page}', '2'));
    // The page in hand says nothing follows it, so nothing more is offered.
    expect(screen.getByRole('button', { name: L('table.nextPage') })).toBeDisabled();
    expect(within(grid).queryByText(L('platform.audit.action.0'))).toBeNull();
  });

  /*
   * A day with a part missing holds no day, and a request built from no day is
   * refused by the server as the general error state. It is said on the box
   * that is not finished, and nothing is asked.
   */
  it('refuses a day left unfinished on its own box, and asks for nothing', async () => {
    const user = userEvent.setup();
    apiGet.mockResolvedValue(page([event]));
    renderScreen();
    await screen.findByText(L('platform.audit.action.0'));

    const since = within(criteria()).getByRole('group', {
      name: labelledBy(L('platform.audit.from')),
    });
    await user.click(within(since).getAllByRole('spinbutton')[2] as HTMLElement);
    await user.keyboard('{Backspace}');
    await user.click(screen.getByRole('button', { name: L('platform.audit.apply') }));

    expect(await within(criteria()).findByText(L('platform.error.date'))).toBeVisible();
    expect(since).toHaveAttribute('aria-invalid', 'true');
    expect(apiGet).toHaveBeenCalledTimes(1);

    await typeDay(criteria(), L('platform.audit.from'), '01092026');
    await waitFor(() =>
      expect(within(criteria()).queryByText(L('platform.error.date'))).toBeNull()
    );
    await user.click(screen.getByRole('button', { name: L('platform.audit.apply') }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    const applied = new URLSearchParams(String(apiGet.mock.calls[1]?.[0]).split('?')[1]);
    expect(applied.get('from')).toBe('2026-09-01T00:00:00.000Z');
  });
});

// --- account and security ------------------------------------------------------
//
// Folded into this file rather than given its own, because the P1-27 evidence
// seal digests a stated count of web test FILES: a new file moves a sealed
// record, and these cases belong to the same console the rest of this file
// covers. Names are prefixed so nothing here can collide with the console
// fixtures above.

const ACCOUNT_SESSION = {
  userId: '22222222-2222-4222-8222-222222222222',
  homeTenantId: TENANT,
  platformPermissions: ['platform.organization.read', 'platform.statistics.read'],
} as const;

const ACCOUNT_CURRENT = 'the-current-password';
const ACCOUNT_NEXT = 'a-different-password';

function renderAccount(locale: 'en' | 'ar' = 'en') {
  const catalogue = getMessages(locale);
  const paint = locale === 'en' ? renderLtr : renderRtl;
  return paint(<AccountSecurityScreen messages={catalogue} session={ACCOUNT_SESSION} />);
}

/** The three password inputs, in the order the form declares them. */
function accountFields(): HTMLInputElement[] {
  return [
    document.querySelector<HTMLInputElement>('input[name="currentPassword"]'),
    document.querySelector<HTMLInputElement>('input[name="newPassword"]'),
    document.querySelector<HTMLInputElement>('input[name="confirmPassword"]'),
  ].map((element, index) => {
    if (!element) throw new Error(`password field ${index} is not rendered`);
    return element;
  });
}

async function fillAccount(values: readonly [string, string, string]) {
  const user = userEvent.setup();
  const inputs = accountFields();
  for (const [index, value] of values.entries()) {
    const input = inputs[index] as HTMLInputElement;
    await user.clear(input);
    await user.type(input, value);
  }
  return user;
}

describe('the account screen shows the identity the console session carries', () => {
  it('names the operator, its home organisation and every authority code it holds', () => {
    renderAccount();
    expect(screen.getByTestId('account-operator-id')).toHaveTextContent(ACCOUNT_SESSION.userId);
    expect(screen.getByTestId('account-home-tenant')).toHaveTextContent(
      ACCOUNT_SESSION.homeTenantId
    );
    for (const code of ACCOUNT_SESSION.platformPermissions) {
      expect(screen.getByText(code)).toBeInTheDocument();
    }
  });

  it('offers a change-password form with three fields and no address field', () => {
    renderAccount();
    expect(accountFields()).toHaveLength(3);
    expect(document.querySelector('input[name="email"]')).toBeNull();
    expect(screen.getByRole('button', { name: L('platform.account.submit') })).toBeEnabled();
  });
});

describe('the form validates before it asks the server', () => {
  it('refuses an empty form and sends nothing', async () => {
    const user = userEvent.setup();
    renderAccount();
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));
    // One complaint per field, and nothing asked of the server.
    await waitFor(() => expect(screen.getAllByText(L('platform.error.required'))).toHaveLength(3));
    expect(changeOwnPasswordAction).not.toHaveBeenCalled();
    for (const field of accountFields()) expect(field).toHaveAttribute('aria-invalid', 'true');
  });

  it('refuses a confirmation that does not match, and marks only that field', async () => {
    renderAccount();
    const user = await fillAccount([ACCOUNT_CURRENT, ACCOUNT_NEXT, 'something-else-entirely']);
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));

    await screen.findByText(L('platform.account.error.mismatch'));
    expect(changeOwnPasswordAction).not.toHaveBeenCalled();
    const [current, next, confirm] = accountFields();
    expect(confirm).toHaveAttribute('aria-invalid', 'true');
    expect(current).not.toHaveAttribute('aria-invalid');
    expect(next).not.toHaveAttribute('aria-invalid');
  });

  it('refuses a new password equal to the current one, and withdraws the complaint on an edit', async () => {
    renderAccount();
    const user = await fillAccount([ACCOUNT_CURRENT, ACCOUNT_CURRENT, ACCOUNT_CURRENT]);
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));

    await screen.findByText(L('platform.account.error.unchanged'));
    expect(changeOwnPasswordAction).not.toHaveBeenCalled();

    await user.type(accountFields()[1] as HTMLInputElement, '-and-more');
    await waitFor(() =>
      expect(screen.queryByText(L('platform.account.error.unchanged'))).toBeNull()
    );
  });

  it('carries the three values, and only those three, to the one server function', async () => {
    renderAccount();
    const user = await fillAccount([ACCOUNT_CURRENT, ACCOUNT_NEXT, ACCOUNT_NEXT]);
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));

    await waitFor(() => expect(changeOwnPasswordAction).toHaveBeenCalledTimes(1));
    const [sent] = changeOwnPasswordAction.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(sent).sort()).toEqual(['confirmPassword', 'currentPassword', 'newPassword']);
  });
});

describe('every password field can be revealed on its own', () => {
  it('starts hidden, reveals the field its toggle controls, and leaves the others hidden', async () => {
    const user = userEvent.setup();
    renderAccount();
    const [current, next, confirm] = accountFields();
    expect([current?.type, next?.type, confirm?.type]).toEqual([
      'password',
      'password',
      'password',
    ]);

    const toggles = screen.getAllByTestId('password-reveal-toggle');
    expect(toggles).toHaveLength(3);

    await user.click(toggles[1] as HTMLElement);
    expect(accountFields().map((field) => field.type)).toEqual(['password', 'text', 'password']);
    expect(toggles[1]).toHaveAttribute('aria-pressed', 'true');

    await user.click(toggles[1] as HTMLElement);
    expect(accountFields().map((field) => field.type)).toEqual([
      'password',
      'password',
      'password',
    ]);
  });

  it('is reachable from the keyboard', async () => {
    const user = userEvent.setup();
    renderAccount();
    const [current] = accountFields();
    current?.focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getAllByTestId('password-reveal-toggle')[0]);
  });
});

describe('a success states what happened, and clears the fields', () => {
  it('announces the change, says the other devices stay signed in, and empties the form', async () => {
    renderAccount();
    const user = await fillAccount([ACCOUNT_CURRENT, ACCOUNT_NEXT, ACCOUNT_NEXT]);
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));

    const done = await screen.findByTestId('account-password-done');
    expect(done).toHaveTextContent(L('platform.account.doneTitle'));
    expect(done).toHaveTextContent(L('platform.account.done'));
    expect(accountFields().map((field) => field.value)).toEqual(['', '', '']);
  });

  /**
   * DEF-T-11. The sentence used to read "Other devices were signed out", and a
   * session signed in elsewhere answered 200 for the whole measured window
   * afterwards. Both success sentences, and the hint shown before the change,
   * are asserted here against the words rather than the key: a key can be
   * renamed while the claim survives, and the claim is what was wrong.
   */
  it('claims no sign-out in either success sentence, or in the hint beside the form', () => {
    for (const key of [
      'platform.account.done',
      'platform.account.doneSessionsKept',
      'platform.account.passwordHint',
    ] as const) {
      expect(L(key)).not.toMatch(/were signed out|are signed out|have been signed out/i);
    }
    // And both languages say what does happen instead.
    expect(L('platform.account.done')).toMatch(/stays signed in/i);
    expect(L('platform.account.passwordHint')).toMatch(/does not sign out/i);
    expect(AR['platform.account.done'] as string).toContain('يبقى');
    expect(AR['platform.account.passwordHint'] as string).toContain('يبقى');
  });

  it('says the other devices were NOT signed out when that is what the server reported', async () => {
    changeOwnPasswordAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.account.doneSessionsKept',
      attempt: 1,
    });
    renderAccount();
    const user = await fillAccount([ACCOUNT_CURRENT, ACCOUNT_NEXT, ACCOUNT_NEXT]);
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));

    const done = await screen.findByTestId('account-password-done');
    expect(done).toHaveTextContent(L('platform.account.doneSessionsKept'));
    expect(done).not.toHaveTextContent(L('platform.account.done'));
  });
});

describe('the two refusals are distinct, and mark different fields', () => {
  it('marks the current password when the identity provider would not verify it', async () => {
    changeOwnPasswordAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'platform.account.error.currentPassword',
      fieldErrors: { currentPassword: 'platform.account.error.currentPassword' },
      correlationId: 'c-1',
      attempt: 1,
    });
    renderAccount();
    const user = await fillAccount(['not-the-current-one', ACCOUNT_NEXT, ACCOUNT_NEXT]);
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));

    // Once in the banner and once against the field the operator must correct.
    await waitFor(() =>
      expect(
        screen.getAllByText(L('platform.account.error.currentPassword')).length
      ).toBeGreaterThan(0)
    );
    expect(screen.queryByTestId('account-password-done')).toBeNull();
    const [current, next] = accountFields();
    expect(current).toHaveAttribute('aria-invalid', 'true');
    expect(next).not.toHaveAttribute('aria-invalid');
  });

  it('marks the new password when the identity provider refused it, with a different sentence', async () => {
    changeOwnPasswordAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'platform.account.error.refused',
      fieldErrors: { newPassword: 'platform.account.error.refused' },
      correlationId: 'c-2',
      attempt: 1,
    });
    renderAccount();
    const user = await fillAccount([ACCOUNT_CURRENT, 'short', 'short']);
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));

    await waitFor(() =>
      expect(screen.getAllByText(L('platform.account.error.refused')).length).toBeGreaterThan(0)
    );
    expect(L('platform.account.error.refused')).not.toBe(
      L('platform.account.error.currentPassword')
    );
    const [current, next] = accountFields();
    expect(next).toHaveAttribute('aria-invalid', 'true');
    expect(current).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByTestId('account-password-done')).toBeNull();
  });
});

describe('a ceiling the identity provider never sees', () => {
  /*
   * `too_long` — `iam/domain/credential-policy.ts:85`, against
   * `body.newPassword`. The API bounds a new password from ABOVE only, because
   * an unbounded secret is an unbounded input to the provider's hashing routine;
   * strength stays the provider's decision. The sentence says only that what was
   * entered is longer than allowed, which is true at every place the token is
   * published and tells nobody anything about the rule's limit.
   */
  it('marks the new password, says it is too long, and leaves the other fields alone', async () => {
    changeOwnPasswordAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.formError',
      fieldErrors: { newPassword: 'form.violation.too_long' },
      correlationId: 'c-3',
      attempt: 1,
    });
    renderAccount();
    const user = await fillAccount([ACCOUNT_CURRENT, ACCOUNT_NEXT, ACCOUNT_NEXT]);
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));

    await waitFor(() =>
      expect(screen.getAllByText(L('form.violation.too_long')).length).toBeGreaterThan(0)
    );
    const [current, next] = accountFields();
    expect(next).toHaveAttribute('aria-invalid', 'true');
    expect(current).not.toHaveAttribute('aria-invalid');
    // Nothing the operator typed is thrown away by a refusal they can correct.
    expect(current?.value).toBe(ACCOUNT_CURRENT);
    expect(next?.value).toBe(ACCOUNT_NEXT);
  });

  it('says it in Arabic on an Arabic screen', async () => {
    changeOwnPasswordAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.formError',
      fieldErrors: { newPassword: 'form.violation.too_long' },
      correlationId: 'c-4',
      attempt: 1,
    });
    renderAccount('ar');
    const user = await fillAccount([ACCOUNT_CURRENT, ACCOUNT_NEXT, ACCOUNT_NEXT]);
    await user.click(screen.getByRole('button', { name: AR['platform.account.submit'] as string }));

    const arabic = AR['form.violation.too_long'] as string;
    await waitFor(() => expect(screen.getAllByText(arabic).length).toBeGreaterThan(0));
    expect(arabic).toMatch(/[؀-ۿ]/);
    expect(arabic).not.toBe(L('form.violation.too_long'));
  });
});

describe('the account form on Material UI (P1-32-PRE-OD-AUTHA)', () => {
  it('submits on Enter from the last box', async () => {
    renderAccount();
    const user = await fillAccount([ACCOUNT_CURRENT, ACCOUNT_NEXT, ACCOUNT_NEXT]);
    await user.type(accountFields()[2] as HTMLInputElement, '{Enter}');
    await waitFor(() => expect(changeOwnPasswordAction).toHaveBeenCalledTimes(1));
  });

  it('sends one change for two presses inside one act, and says it is working', async () => {
    let answer: (value: unknown) => void = () => undefined;
    changeOwnPasswordAction.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    renderAccount();
    await fillAccount([ACCOUNT_CURRENT, ACCOUNT_NEXT, ACCOUNT_NEXT]);
    const button = screen.getByRole('button', { name: L('platform.account.submit') });
    await act(() => {
      button.click();
      button.click();
    });
    expect(changeOwnPasswordAction).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: L('platform.account.submitting') })).toBeDisabled()
    );

    await act(async () => {
      answer({ status: 'success', messageKey: 'platform.account.done', attempt: 1 });
    });
    expect(await screen.findByTestId('account-password-done')).toBeInTheDocument();
    expect(changeOwnPasswordAction).toHaveBeenCalledTimes(1);
  });

  it('puts the cursor on the first refused field, before and after the server answers', async () => {
    const user = userEvent.setup();
    renderAccount();
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));
    await waitFor(() => expect(accountFields()[0]).toHaveFocus());

    changeOwnPasswordAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'platform.account.error.refused',
      fieldErrors: { newPassword: 'platform.account.error.refused' },
      attempt: 1,
    });
    await fillAccount([ACCOUNT_CURRENT, ACCOUNT_NEXT, ACCOUNT_NEXT]);
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));
    await waitFor(() => expect(accountFields()[1]).toHaveFocus());
  });

  it('keeps every reveal control inside its own box, at the logical end, in both directions', () => {
    /*
     * jsdom has no layout, so the logical end is asserted as what produces it:
     * the control is Material's END adornment and comes AFTER its box in the
     * document, inside a flex row that inherits the page direction — so it is
     * drawn at the right in English and at the left in Arabic with nothing
     * overriding it. The drawn position is held by the browser smoke.
     */
    for (const locale of ['en', 'ar'] as const) {
      const { unmount } = renderAccount(locale);
      expect(document.documentElement.dir).toBe(locale === 'en' ? 'ltr' : 'rtl');
      const fields = accountFields();
      const toggles = screen.getAllByTestId('password-reveal-toggle');
      expect(toggles).toHaveLength(fields.length);
      fields.forEach((field, index) => {
        const toggle = toggles[index] as HTMLElement;
        expect(field.parentElement?.contains(toggle)).toBe(true);
        expect(toggle).toHaveAttribute('type', 'button');
        expect(toggle).toHaveAttribute('aria-controls', field.id);
        expect(field.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
          0
        );
        expect(toggle.closest('.MuiInputAdornment-positionEnd')).not.toBeNull();
        expect(toggle.closest('.MuiInputAdornment-positionStart')).toBeNull();
        expect(field.parentElement?.getAttribute('dir')).toBeNull();
        expect(field.parentElement?.style.direction).toBe('');
      });
      unmount();
    }
  });
});

describe('the account form takes what its boxes already hold (P1-32-PRE-OD-AUTHB-04)', () => {
  /*
   * This form sends its STATE. A value a browser put in a box before the page's
   * script ran is in the box and not in the state, so the change was refused as
   * a blank box and the box was then emptied. The server's markup is filled the
   * way a browser fills it (the value set on the element, no event) and only
   * then hydrated; a hydration that gave up and drew new, empty boxes would
   * prove nothing, so it is refused.
   */
  it('sends what the three boxes held before the page hydrated, and a success empties them for good', async () => {
    const user = userEvent.setup();
    let answer: (value: unknown) => void = () => undefined;
    const answered = new Promise((resolve) => (answer = resolve));
    changeOwnPasswordAction.mockReturnValue(answered);

    const tree = <AccountSecurityScreen messages={messages} session={ACCOUNT_SESSION} />;
    const container = document.createElement('div');
    container.innerHTML = renderToString(tree);
    document.body.appendChild(container);
    const filled = [ACCOUNT_CURRENT, ACCOUNT_NEXT, ACCOUNT_NEXT];
    const boxes = accountFields();
    boxes.forEach((box, index) => {
      box.value = filled[index] as string;
    });
    const onRecoverableError = vi.fn();
    renderLtr(tree, { container, hydrate: true, onRecoverableError });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(accountFields()).toEqual(boxes);

    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));
    await waitFor(() => expect(changeOwnPasswordAction).toHaveBeenCalledTimes(1));
    expect(changeOwnPasswordAction).toHaveBeenCalledWith({
      currentPassword: ACCOUNT_CURRENT,
      newPassword: ACCOUNT_NEXT,
      confirmPassword: ACCOUNT_NEXT,
    });
    expect(screen.queryByText(L('platform.error.required'))).toBeNull();
    expect(boxes.map((box) => box.value)).toEqual(filled);

    /*
     * The answer, and then focus, a press and a key in a box in the same turn,
     * before React has drawn the emptied boxes: the boxes still show the old
     * values at that moment, and taking them then would put all three back.
     */
    await act(async () => {
      answer({ status: 'success', messageKey: 'platform.account.done', attempt: 1 });
      await answered;
      for (const box of boxes) {
        fireEvent.focusIn(box);
        fireEvent.pointerDown(box);
        fireEvent.keyDown(box, { key: 'Shift' });
      }
    });
    expect(await screen.findByTestId('account-password-done')).toBeInTheDocument();
    expect(accountFields()).toEqual(boxes);
    expect(boxes.map((box) => box.value)).toEqual(['', '', '']);
    // And nothing done in the form afterwards brings them back.
    for (const box of boxes) {
      fireEvent.focusIn(box);
      fireEvent.pointerDown(box);
      fireEvent.keyDown(box, { key: 'Shift' });
    }
    expect(boxes.map((box) => box.value)).toEqual(['', '', '']);
  });
});

describe('Arabic', () => {
  it('renders the screen right to left with catalogued Arabic', async () => {
    renderAccount('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByText(AR['platform.account.passwordTitle'] as string)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: AR['platform.account.submit'] as string })
    ).toBeInTheDocument();
    // Real Arabic, not an English string sitting in the Arabic catalogue.
    expect(AR['platform.account.title']).not.toBe(EN['platform.account.title']);
    expect(AR['platform.account.title']).toMatch(/[؀-ۿ]/);
  });

  it('keeps the reveal control on every field in Arabic too', async () => {
    const user = userEvent.setup();
    renderAccount('ar');
    const toggles = screen.getAllByTestId('password-reveal-toggle');
    expect(toggles).toHaveLength(3);
    await user.click(toggles[0] as HTMLElement);
    expect(accountFields()[0]?.type).toBe('text');
  });
});

// --- the console route group's own boundaries ----------------------------------
//
// Every console page is a Server Component that awaits at least one
// control-plane read, and each of those reads is rated `expensive-read`. The
// group carried no `loading.tsx`, `error.tsx` or `not-found.tsx` at all, so a
// slow read looked like a console that had stopped responding and a render that
// threw took the shell, the navigation and the language down with it. These
// three files are the workspace group's, written for this group.

const PlatformLoading = (await import('@/app/[locale]/(platform)/loading')).default;
const PlatformError = (await import('@/app/[locale]/(platform)/error')).default;
const PlatformNotFound = (await import('@/app/[locale]/(platform)/not-found')).default;

describe('the console route group draws its own waiting, failure and not-found screens', () => {
  it('says it is loading, in the language of the address', () => {
    renderLtr(<PlatformLoading />);
    expect(screen.getByText(L('state.loading'))).toBeInTheDocument();
  });

  it('says the page could not be found', () => {
    renderLtr(<PlatformNotFound />);
    expect(screen.getByText(L('state.notFound.title'))).toBeInTheDocument();
  });

  it('shows the failure reference and retries, and publishes nothing from the error itself', async () => {
    const reset = vi.fn();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = Object.assign(new Error('connect ECONNREFUSED /var/secret/socket'), {
      digest: 'digest-9',
    });

    renderLtr(<PlatformError error={failure} reset={reset} />);

    expect(screen.getByText(L('state.error.title'))).toBeInTheDocument();
    expect(screen.getByText('digest-9')).toBeInTheDocument();
    // The message and the path inside it stay off the screen and out of the log
    // line: a Next.js error message routinely carries both.
    expect(document.body.textContent ?? '').not.toContain('ECONNREFUSED');
    for (const call of logged.mock.calls) {
      expect(String(call[0])).not.toContain('ECONNREFUSED');
    }

    await userEvent.click(screen.getByRole('button', { name: L('state.retry') }));
    expect(reset).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });

  /*
   * The three files exist BECAUSE the language has to come from the address:
   * Next gives a boundary no props, so reading the default locale instead would
   * announce an Arabic waiting state to an English reader, and an English
   * failure inside an Arabic document (P1-26-F-059, P1-26-F-071). An English
   * address is the only one the cases above ever visit, which is exactly the
   * half that cannot fail — so each boundary is visited in Arabic too.
   */
  it('speaks Arabic on an Arabic address, in all three boundaries', async () => {
    mockPathname = '/ar/platform';

    const loading = renderRtl(<PlatformLoading />);
    expect(document.documentElement.dir).toBe('rtl');
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(AR['state.loading'] as string);
    expect(status).not.toHaveTextContent(L('state.loading'));
    loading.unmount();

    const missing = renderRtl(<PlatformNotFound />);
    expect(screen.getByText(AR['state.notFound.title'] as string)).toBeInTheDocument();
    missing.unmount();

    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderRtl(<PlatformError error={new Error('boom')} reset={vi.fn()} />);
    expect(screen.getByText(AR['state.error.title'] as string)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: AR['state.retry'] as string })).toBeInTheDocument();
    logged.mockRestore();
  });

  it('falls back to the default language when the address carries none', () => {
    // Not hypothetical: `usePathname` returns `/` during a transition, and what
    // happens then must be a decision rather than a crash.
    mockPathname = '/';
    renderRtl(<PlatformLoading />);
    expect(screen.getByRole('status')).toHaveTextContent(AR['state.loading'] as string);
  });

  it('lets the keyboard reach and press the retry control', async () => {
    const reset = vi.fn();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderLtr(<PlatformError error={new Error('boom')} reset={reset} />);

    const retry = screen.getByRole('button', { name: L('state.retry') });
    await userEvent.tab();
    expect(retry).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(reset).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });
});

describe('the console renders with no working context (route sweep B3)', () => {
  it('refuses every working-context hook in this file, so the screens above prove it', async () => {
    // The guard is live: were it not, every console case above would pass
    // whether or not a console surface read the working branch.
    const context = await import('@/features/working-context/WorkingContextProvider');
    expect(() => context.useWorkingContext()).toThrow(/no working context/);
    expect(() => context.useUnsavedGuard(true)).toThrow(/no working context/);
    expect(() => context.useWorkingContextChange(() => undefined)).toThrow(/no working context/);
  });

  it('draws the console shell and a console page with no provider and no branch control', async () => {
    const { PLATFORM_PERMISSIONS } = await import('@/features/platform/permissions');
    platformPermissions.codes = Object.values(PLATFORM_PERMISSIONS);
    const PlatformLayout = (await import('@/app/[locale]/(platform)/layout')).default;
    apiGet.mockResolvedValue({ ok: true, data: { items: [], nextCursor: null, hasMore: false } });
    const shell = await PlatformLayout({
      params: Promise.resolve({ locale: 'en' }),
      children: <OrganizationsScreen locale="en" messages={messages} canProvision={false} />,
    });
    renderLtr(shell as React.ReactElement);
    expect(screen.getByText(L('platform.console.title'))).toBeInTheDocument();
    expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0);
    // No branch selector, no branch prompt, no branch notice.
    expect(document.querySelector('[data-testid^="working-context"]')).toBeNull();
    expect(screen.queryByLabelText(L('workingContext.label'))).toBeNull();
  });
});
