import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import { renderLtr } from './render';

/**
 * One price list, rendered (P1-30, `W2`, FE-002).
 *
 * The properties under test: the guarded writes send the LIST's record
 * version (from the detail), never a version's own; a rule's amount and
 * specificity render as the server sent them; a published version's rules
 * are frozen and offer no form; the writes are withheld from an inactive
 * list and from an operator without the code; and what has no read
 * (assignments) is said, not faked.
 */

const EN = en as Record<string, string>;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);

const listPriceRules = vi.fn();
const createPriceListVersion = vi.fn();
const publishPriceListVersion = vi.fn();
const recordPriceRule = vi.fn();
const createPriceListAssignment = vi.fn();
const listBranches = vi.fn();
vi.mock('@/features/pricing/api', () => ({
  listPriceRules: (...args: unknown[]) => listPriceRules(...args),
  createPriceListVersion: (...args: unknown[]) => createPriceListVersion(...args),
  publishPriceListVersion: (...args: unknown[]) => publishPriceListVersion(...args),
  recordPriceRule: (...args: unknown[]) => recordPriceRule(...args),
  createPriceListAssignment: (...args: unknown[]) => createPriceListAssignment(...args),
  listBranches: () => listBranches(),
  listPriceLists: vi.fn(),
  readPriceList: vi.fn(),
  createPriceList: vi.fn(),
  resolvePrice: vi.fn(),
}));

const listServices = vi.fn();
vi.mock('@/features/services/api', () => ({
  listServices: (...args: unknown[]) => listServices(...args),
}));

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const notifyActionResult = vi.fn((..._args: unknown[]): boolean => true);
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: (...args: unknown[]) => notifyActionResult(...args),
}));

const { PriceListDetailScreen } =
  await import('@/features/pricing/components/PriceListDetailScreen');

const LIST_ID = '33333333-3333-4333-8333-333333333333';
const PUBLISHED_ID = '44444444-4444-4444-8444-444444444444';
const DRAFT_ID = '66666666-6666-4666-8666-666666666666';
const SERVICE_ID = '55555555-5555-4555-8555-555555555555';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const COMPANY = '11111111-1111-4111-8111-111111111111';

const published = {
  id: PUBLISHED_ID,
  priceListId: LIST_ID,
  versionNo: 2,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  status: 'published',
  notes: null,
  recordVersion: 1,
};
const draft = {
  id: DRAFT_ID,
  priceListId: LIST_ID,
  versionNo: 3,
  effectiveFrom: '2026-10-01',
  effectiveTo: null,
  status: 'draft',
  notes: 'Winter',
  recordVersion: 1,
};

function priceList(over: Record<string, unknown> = {}) {
  return {
    id: LIST_ID,
    priceListCode: 'RETAIL',
    name: 'Retail',
    currency: 'JOD',
    description: 'Walk-in prices',
    status: 'active',
    recordVersion: 3,
    versions: [draft, published],
    versionsTruncated: false,
    ...over,
  };
}

const rule = {
  id: 'rule-1',
  priceListVersionId: PUBLISHED_ID,
  service: { id: SERVICE_ID, serviceCode: 'OIL-CHANGE', name: 'Oil change' },
  appliesTo: { companyId: null, branchId: null, customerClass: null },
  amount: '77.5000',
  currency: 'JOD',
  taxClassId: null,
  priority: 0,
  specificity: 0,
  status: 'active',
  recordVersion: 1,
};

const okRead = (data: unknown) => ({ status: 'ok' as const, data, correlationId: 'corr' });
const success = (messageKey: string) => ({ status: 'success' as const, messageKey, attempt: 1 });

function rulesOf(versionId: string, rules: readonly unknown[]) {
  return okRead({
    priceListId: LIST_ID,
    versionId,
    versionNo: versionId === DRAFT_ID ? 3 : 2,
    versionStatus: versionId === DRAFT_ID ? 'draft' : 'published',
    currency: 'JOD',
    rules,
    truncated: false,
  });
}

function renderDetail(over: Record<string, unknown> = {}, list = priceList()) {
  return renderLtr(
    <PriceListDetailScreen
      locale="en"
      messages={en}
      priceList={list as never}
      canManage
      canPublish={false}
      canReadBranches={false}
      canReadServices={false}
      {...over}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listPriceRules.mockImplementation((_listId: string, versionId: string) =>
    Promise.resolve(rulesOf(versionId, versionId === PUBLISHED_ID ? [rule] : []))
  );
  listBranches.mockResolvedValue(
    okRead({ items: [{ id: BRANCH, companyId: COMPANY, branchCode: 'B1', name: 'Main' }] })
  );
  createPriceListVersion.mockResolvedValue({
    state: success('pricing.version.created'),
    created: { ...draft, id: 'v-new', versionNo: 4 },
  });
  publishPriceListVersion.mockResolvedValue(success('pricing.version.published'));
  recordPriceRule.mockResolvedValue({
    state: success('pricing.rule.success'),
    created: { id: 'rule-new', amount: '12.5000', currency: 'JOD', recordVersion: 1 },
  });
  createPriceListAssignment.mockResolvedValue({
    state: success('pricing.assignment.success'),
    created: { id: 'assignment-1', priceListId: LIST_ID },
  });
});

const rulesRegion = () =>
  screen.getByRole('region', {
    name: new RegExp(`^${escape(EN['pricing.rules.heading'] as string)}`),
  });

describe('the detail shows the list and its versions as returned', () => {
  it('renders the summary and every version with its status', () => {
    renderDetail();
    const summary = screen.getByRole('region', {
      name: EN['pricing.detail.summaryHeading'] as string,
    });
    expect(within(summary).getByText('RETAIL')).toBeVisible();
    expect(within(summary).getByText('Walk-in prices')).toBeVisible();
    const versions = screen.getByRole('table', { name: EN['pricing.versions.caption'] as string });
    expect(
      within(versions).getByText(EN['pricing.versionStatus.published'] as string)
    ).toBeVisible();
    expect(within(versions).getByText(EN['pricing.versionStatus.draft'] as string)).toBeVisible();
    expect(within(versions).getByText('Winter')).toBeVisible();
  });

  it('discloses a truncated version list', () => {
    renderDetail({}, priceList({ versionsTruncated: true }));
    expect(screen.getByText(EN['pricing.versions.truncated'] as string)).toBeVisible();
  });

  it('reads the rules of the first (newest) version on mount, and the chosen one on request', async () => {
    const user = userEvent.setup();
    renderDetail();
    await waitFor(() => expect(listPriceRules).toHaveBeenCalledWith(LIST_ID, DRAFT_ID));
    expect(
      await within(rulesRegion()).findByText(EN['pricing.rules.none'] as string)
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: `${EN['pricing.versions.showRules']} 2` }));
    await waitFor(() => expect(listPriceRules).toHaveBeenCalledWith(LIST_ID, PUBLISHED_ID));
    const region = rulesRegion();
    expect(await within(region).findByText('OIL-CHANGE')).toBeVisible();
    // The amount is the server's string rendered with its ISO code; specificity is the server's number.
    expect(within(region).getByText(/77\.5/)).toBeVisible();
    expect(within(region).getByText(EN['pricing.rules.any'] as string)).toBeVisible();
    const cells = within(region)
      .getAllByRole('cell')
      .map((cell) => cell.textContent);
    expect(cells).toContain('0');
    // Published: frozen, and no rule form.
    expect(within(region).getByText(EN['pricing.rules.frozen'] as string)).toBeVisible();
    expect(
      within(region).queryByRole('form', { name: EN['pricing.rule.heading'] as string })
    ).toBeNull();
  });

  it('renders a refused rules read as refused', async () => {
    listPriceRules.mockResolvedValue({ status: 'denied', correlationId: 'corr-2' });
    renderDetail();
    expect(await screen.findByText(EN['pricing.rules.refused'] as string)).toBeVisible();
  });
});

describe('what is offered follows the row and the operator', () => {
  it('without svc.price.manage, says so and offers no writes', () => {
    renderDetail({ canManage: false });
    expect(screen.getByText(EN['pricing.detail.noManagePermission'] as string)).toBeVisible();
    expect(screen.queryByText(EN['pricing.version.createHeading'] as string)).toBeNull();
    expect(screen.queryByText(EN['pricing.assignment.heading'] as string)).toBeNull();
  });

  it('an inactive list offers no writes and says why', () => {
    renderDetail({ canPublish: true }, priceList({ status: 'inactive' }));
    expect(screen.getByText(EN['pricing.detail.inactiveNote'] as string)).toBeVisible();
    expect(screen.queryByText(EN['pricing.version.createHeading'] as string)).toBeNull();
    expect(screen.queryByText(EN['pricing.publish.heading'] as string)).toBeNull();
  });

  it('publication is offered only with svc.price.publish', () => {
    renderDetail({ canPublish: false });
    expect(screen.queryByText(EN['pricing.publish.heading'] as string)).toBeNull();
  });
});

describe('guarded writes send the LIST version and renew it', () => {
  it('creates a draft with the detail’s recordVersion, then refreshes', async () => {
    const user = userEvent.setup();
    renderDetail();
    const form = screen.getByRole('form', { name: EN['pricing.version.createHeading'] as string });
    fireEvent.change(within(form).getByLabelText(labelled('pricing.version.effectiveFrom')), {
      target: { value: '2026-11-01' },
    });
    await user.type(within(form).getByLabelText(labelled('pricing.version.notes')), 'Spring');
    await user.click(
      within(form).getByRole('button', { name: EN['pricing.version.createDraft'] as string })
    );
    await waitFor(() => expect(createPriceListVersion).toHaveBeenCalled());
    // The LIST's version (3), never the draft's own (1).
    expect(createPriceListVersion).toHaveBeenCalledWith(
      LIST_ID,
      { effectiveFrom: '2026-11-01', notes: 'Spring' },
      3
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('publishes the chosen draft with the detail’s recordVersion', async () => {
    const user = userEvent.setup();
    renderDetail({ canPublish: true });
    const form = screen.getByRole('form', { name: EN['pricing.publish.heading'] as string });
    await user.selectOptions(
      within(form).getByLabelText(labelled('pricing.publish.version')),
      DRAFT_ID
    );
    fireEvent.change(within(form).getByLabelText(labelled('pricing.publish.effectiveFrom')), {
      target: { value: '2026-11-01' },
    });
    await user.click(
      within(form).getByRole('button', { name: EN['pricing.publish.submit'] as string })
    );
    await waitFor(() => expect(publishPriceListVersion).toHaveBeenCalled());
    expect(publishPriceListVersion).toHaveBeenCalledWith(
      LIST_ID,
      DRAFT_ID,
      { effectiveFrom: '2026-11-01' },
      3
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('a conflict renders as a conflict and does not refresh', async () => {
    publishPriceListVersion.mockResolvedValue({
      status: 'conflict',
      correlationId: 'corr-9',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderDetail({ canPublish: true });
    const form = screen.getByRole('form', { name: EN['pricing.publish.heading'] as string });
    await user.selectOptions(
      within(form).getByLabelText(labelled('pricing.publish.version')),
      DRAFT_ID
    );
    fireEvent.change(within(form).getByLabelText(labelled('pricing.publish.effectiveFrom')), {
      target: { value: '2026-11-01' },
    });
    await user.click(
      within(form).getByRole('button', { name: EN['pricing.publish.submit'] as string })
    );
    expect(await within(form).findByText(EN['pricing.detail.conflict'] as string)).toBeVisible();
    expect(within(form).getByText('corr-9')).toBeVisible();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('offers no publication when there is no draft', () => {
    renderDetail({ canPublish: true }, priceList({ versions: [published] }));
    expect(screen.getByText(EN['pricing.publish.noDraft'] as string)).toBeVisible();
  });
});

describe('a rule on a draft carries the canonical amount string', () => {
  it('sends the service, the amount as a string, and the narrowing, then reloads the rules', async () => {
    const user = userEvent.setup();
    renderDetail();
    const region = rulesRegion();
    const form = await within(region).findByRole('form', {
      name: EN['pricing.rule.heading'] as string,
    });
    await user.type(
      within(form).getByLabelText(labelled('pricing.picker.serviceIdField')),
      SERVICE_ID
    );
    await user.type(within(form).getByLabelText(labelled('pricing.rule.amount')), '12.5');
    await user.type(
      within(form).getByLabelText(labelled('pricing.common.companyIdField')),
      COMPANY
    );
    await user.type(within(form).getByLabelText(labelled('pricing.rule.priority')), '5');
    listPriceRules.mockClear();
    await user.click(
      within(form).getByRole('button', { name: EN['pricing.rule.submit'] as string })
    );
    await waitFor(() => expect(recordPriceRule).toHaveBeenCalled());
    const [listId, versionId, body] = recordPriceRule.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(listId).toBe(LIST_ID);
    expect(versionId).toBe(DRAFT_ID);
    expect(body['serviceId']).toBe(SERVICE_ID);
    expect(typeof body['amount']).toBe('string');
    expect(body['amount']).toMatch(/^12\.5(000)?$/);
    expect(body['companyId']).toBe(COMPANY);
    expect(body['priority']).toBe(5);
    expect(body).not.toHaveProperty('branchId');
    await waitFor(() => expect(listPriceRules).toHaveBeenCalledWith(LIST_ID, DRAFT_ID));
  });

  it('refuses a branch without its company before any request', async () => {
    const user = userEvent.setup();
    renderDetail();
    const region = rulesRegion();
    const form = await within(region).findByRole('form', {
      name: EN['pricing.rule.heading'] as string,
    });
    await user.type(
      within(form).getByLabelText(labelled('pricing.picker.serviceIdField')),
      SERVICE_ID
    );
    await user.type(within(form).getByLabelText(labelled('pricing.rule.amount')), '12.5');
    await user.type(within(form).getByLabelText(labelled('pricing.common.branchIdField')), BRANCH);
    await user.click(
      within(form).getByRole('button', { name: EN['pricing.rule.submit'] as string })
    );
    expect(
      await within(form).findByText(EN['pricing.rule.branchNeedsCompany'] as string)
    ).toBeVisible();
    expect(recordPriceRule).not.toHaveBeenCalled();
  });
});

describe('an assignment is recorded, and the absence of a read is said', () => {
  it('says assignments cannot be listed, and records one with the branch pair', async () => {
    const user = userEvent.setup();
    renderDetail({ canReadBranches: true });
    await waitFor(() => expect(listBranches).toHaveBeenCalled());
    expect(screen.getByText(EN['pricing.assignment.noRead'] as string)).toBeVisible();
    const form = screen.getByRole('form', { name: EN['pricing.assignment.heading'] as string });
    await user.selectOptions(
      await within(form).findByLabelText(labelled('pricing.rule.branch')),
      BRANCH
    );
    fireEvent.change(within(form).getByLabelText(labelled('pricing.assignment.effectiveFrom')), {
      target: { value: '2026-10-01' },
    });
    await user.click(
      within(form).getByRole('button', { name: EN['pricing.assignment.submit'] as string })
    );
    await waitFor(() => expect(createPriceListAssignment).toHaveBeenCalled());
    expect(createPriceListAssignment).toHaveBeenCalledWith({
      priceListId: LIST_ID,
      companyId: COMPANY,
      branchId: BRANCH,
      effectiveFrom: '2026-10-01',
    });
    expect(await within(form).findByText('assignment-1')).toBeVisible();
  });

  it('refuses an end date that is not after the start, before any request', async () => {
    const user = userEvent.setup();
    renderDetail();
    const form = screen.getByRole('form', { name: EN['pricing.assignment.heading'] as string });
    fireEvent.change(within(form).getByLabelText(labelled('pricing.assignment.effectiveFrom')), {
      target: { value: '2026-10-01' },
    });
    fireEvent.change(within(form).getByLabelText(labelled('pricing.assignment.effectiveTo')), {
      target: { value: '2026-10-01' },
    });
    await user.click(
      within(form).getByRole('button', { name: EN['pricing.assignment.submit'] as string })
    );
    expect(
      await within(form).findByText(EN['pricing.assignment.rangeOrder'] as string)
    ).toBeVisible();
    expect(createPriceListAssignment).not.toHaveBeenCalled();
  });
});
