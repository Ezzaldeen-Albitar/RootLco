import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import { renderLtr } from './render';

/**
 * The service detail, rendered (P1-30, `W1`, FE-001).
 *
 * The properties under test are the ones a detail screen gets wrong: sending a
 * write without the version it read, sending fields that did not change,
 * offering writes on a retired row, retiring without an acknowledgement, and
 * publishing a draft against the wrong version.
 *
 * Labels are matched ANCHORED: the field frame decorates a label, so an exact
 * match misses, and "Branch" as a bare substring would answer for the "Offered
 * at this branch" checkbox. The summary is addressed as a region because the
 * edit form offers the category label as an option too.
 */

const EN = en as Record<string, string>;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A label matcher anchored at the start of the label text. */
const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);

const updateService = vi.fn();
const setBranchAvailability = vi.fn();
const createServiceVersion = vi.fn();
const publishServiceVersion = vi.fn();
const listBranches = vi.fn();
const listServiceCategories = vi.fn();
vi.mock('@/features/services/api', () => ({
  updateService: (...args: unknown[]) => updateService(...args),
  setBranchAvailability: (...args: unknown[]) => setBranchAvailability(...args),
  createServiceVersion: (...args: unknown[]) => createServiceVersion(...args),
  publishServiceVersion: (...args: unknown[]) => publishServiceVersion(...args),
  listBranches: () => listBranches(),
  listServiceCategories: () => listServiceCategories(),
  // The catalogue module is imported for two shared pieces; its reads are
  // never called from the detail, but the module must resolve.
  listServices: vi.fn(),
  createService: vi.fn(),
  createServiceCategory: vi.fn(),
}));

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const notifyActionResult = vi.fn((..._args: unknown[]): boolean => true);
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: (...args: unknown[]) => notifyActionResult(...args),
}));

const { ServiceDetailScreen } = await import('@/features/services/components/ServiceDetailScreen');

const SERVICE_ID = '33333333-3333-4333-8333-333333333333';
const CATEGORY = '55555555-5555-4555-8555-555555555555';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const COMPANY = '11111111-1111-4111-8111-111111111111';

function service(over: Record<string, unknown> = {}) {
  return {
    id: SERVICE_ID,
    serviceCode: 'OIL-CHANGE',
    name: 'Oil change',
    description: 'Drain and refill',
    categoryId: CATEGORY,
    lifecycleStatus: 'active' as const,
    recordVersion: 3,
    ...over,
  };
}

const okRead = (data: unknown) => ({ status: 'ok' as const, data, correlationId: 'corr' });
const success = (messageKey: string) => ({ status: 'success' as const, messageKey, attempt: 1 });

function renderDetail(over: Record<string, unknown> = {}, svc = service()) {
  return renderLtr(
    <ServiceDetailScreen
      locale="en"
      messages={en}
      service={svc as never}
      canManage
      canReadBranches={false}
      {...over}
    />
  );
}

const saveButton = () => screen.getByRole('button', { name: EN['services.detail.save'] as string });

beforeEach(() => {
  vi.clearAllMocks();
  listServiceCategories.mockResolvedValue(
    okRead({
      items: [{ id: CATEGORY, code: 'engine', name: 'Engine', status: 'active' }],
      nextCursor: null,
      hasMore: false,
    })
  );
  listBranches.mockResolvedValue(
    okRead({ items: [{ id: BRANCH, companyId: COMPANY, branchCode: 'B1', name: 'Main' }] })
  );
  updateService.mockResolvedValue(success('services.update.success'));
  setBranchAvailability.mockResolvedValue(success('services.availability.success'));
});

describe('what is offered follows the row and the operator', () => {
  it('a retired service shows the retired note and offers no writes', () => {
    renderDetail({}, service({ lifecycleStatus: 'archived' }));
    expect(screen.getByText(EN['services.detail.retiredNote'] as string)).toBeVisible();
    expect(screen.queryByRole('button', { name: EN['services.detail.save'] as string })).toBeNull();
    expect(screen.queryByText(EN['services.availability.heading'] as string)).toBeNull();
    expect(screen.queryByText(EN['services.version.heading'] as string)).toBeNull();
  });

  it('without svc.service.manage, says so and offers no writes', () => {
    renderDetail({ canManage: false });
    expect(screen.getByText(EN['services.detail.noManagePermission'] as string)).toBeVisible();
    expect(screen.queryByRole('button', { name: EN['services.detail.save'] as string })).toBeNull();
  });

  it('shows the service’s own fields and the category name once the taxonomy loads', async () => {
    renderDetail();
    const summary = screen.getByRole('region', {
      name: EN['services.detail.summaryHeading'] as string,
    });
    expect(within(summary).getByText('OIL-CHANGE')).toBeVisible();
    expect(within(summary).getByText('Oil change')).toBeVisible();
    expect(await within(summary).findByText('engine — Engine')).toBeVisible();
  });
});

describe('editing sends what changed, with the version that was read', () => {
  it('sends only the changed name, guarded by recordVersion', async () => {
    const user = userEvent.setup();
    renderDetail();
    const name = screen.getByLabelText(labelled('services.create.name'));
    await user.clear(name);
    await user.type(name, 'Oil and filter');
    await user.click(saveButton());
    await waitFor(() => expect(updateService).toHaveBeenCalled());
    expect(updateService).toHaveBeenCalledWith(SERVICE_ID, { name: 'Oil and filter' }, 3);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('a blanked description is sent as null — cleared, not dropped', async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.clear(screen.getByLabelText(labelled('services.create.description')));
    await user.click(saveButton());
    await waitFor(() => expect(updateService).toHaveBeenCalled());
    expect(updateService.mock.calls[0]?.[1]).toEqual({ description: null });
  });

  it('with nothing changed, sends nothing and says so', async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.click(saveButton());
    expect(await screen.findByText(EN['services.detail.nothingChanged'] as string)).toBeVisible();
    expect(updateService).not.toHaveBeenCalled();
  });

  it('a conflict renders as a conflict, with the reference', async () => {
    updateService.mockResolvedValue({ status: 'conflict', correlationId: 'corr-9', attempt: 1 });
    const user = userEvent.setup();
    renderDetail();
    const name = screen.getByLabelText(labelled('services.create.name'));
    await user.clear(name);
    await user.type(name, 'Renamed');
    await user.click(saveButton());
    expect(await screen.findByText(EN['services.detail.conflict'] as string)).toBeVisible();
    expect(screen.getByText('corr-9')).toBeVisible();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('retiring needs an explicit acknowledgement, then sends the terminal state', async () => {
    const user = userEvent.setup();
    renderDetail();
    const retire = screen.getByRole('button', { name: EN['services.detail.retire'] as string });
    expect(retire).toBeDisabled();
    await user.click(screen.getByLabelText(labelled('services.detail.retireAcknowledge')));
    expect(retire).toBeEnabled();
    await user.click(retire);
    await waitFor(() => expect(updateService).toHaveBeenCalled());
    expect(updateService).toHaveBeenCalledWith(SERVICE_ID, { lifecycleStatus: 'archived' }, 3);
  });
});

describe('availability is a branch-scoped write', () => {
  it('without the branch list, takes both identifiers and sends the pair', async () => {
    const user = userEvent.setup();
    renderDetail({ canReadBranches: false });
    expect(listBranches).not.toHaveBeenCalled();
    await user.type(
      screen.getByLabelText(labelled('services.availability.companyIdField')),
      COMPANY
    );
    await user.type(screen.getByLabelText(labelled('services.availability.branchIdField')), BRANCH);
    await user.click(
      screen.getByRole('button', { name: EN['services.availability.submit'] as string })
    );
    await waitFor(() => expect(setBranchAvailability).toHaveBeenCalled());
    expect(setBranchAvailability).toHaveBeenCalledWith(SERVICE_ID, {
      companyId: COMPANY,
      branchId: BRANCH,
      isAvailable: true,
    });
  });

  it('with the branch list, derives the company from the chosen branch', async () => {
    const user = userEvent.setup();
    renderDetail({ canReadBranches: true });
    await waitFor(() => expect(listBranches).toHaveBeenCalled());
    await user.selectOptions(
      await screen.findByLabelText(labelled('services.availability.branch')),
      BRANCH
    );
    await user.click(screen.getByLabelText(labelled('services.availability.offered')));
    await user.click(
      screen.getByRole('button', { name: EN['services.availability.submit'] as string })
    );
    await waitFor(() => expect(setBranchAvailability).toHaveBeenCalled());
    expect(setBranchAvailability).toHaveBeenCalledWith(SERVICE_ID, {
      companyId: COMPANY,
      branchId: BRANCH,
      isAvailable: false,
    });
  });
});

describe('a draft is created, held, and published against the SERVICE version', () => {
  it('creates a draft, then publishes it with the service’s recordVersion', async () => {
    const draft = {
      id: 'v-draft',
      serviceId: SERVICE_ID,
      versionNo: 2,
      effectiveFrom: '2026-10-01',
      effectiveTo: null,
      status: 'draft',
      laborTimes: [],
    };
    createServiceVersion.mockResolvedValue({
      state: success('services.version.created'),
      created: draft,
    });
    publishServiceVersion.mockResolvedValue(success('services.version.published'));
    const user = userEvent.setup();
    renderDetail();

    fireEvent.change(screen.getByLabelText(labelled('services.version.effectiveFrom')), {
      target: { value: '2026-10-01' },
    });
    await user.click(
      screen.getByRole('button', { name: EN['services.version.createDraft'] as string })
    );
    await waitFor(() => expect(createServiceVersion).toHaveBeenCalled());
    expect(createServiceVersion).toHaveBeenCalledWith(SERVICE_ID, { effectiveFrom: '2026-10-01' });

    // The draft's id came back once; the screen holds it and offers publication.
    expect(await screen.findByText(EN['services.version.draftHeading'] as string)).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: EN['services.version.publish'] as string })
    );
    await waitFor(() => expect(publishServiceVersion).toHaveBeenCalled());
    expect(publishServiceVersion).toHaveBeenCalledWith(
      SERVICE_ID,
      'v-draft',
      { effectiveFrom: '2026-10-01' },
      3
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('refuses an end date that is not after the start date, before any request', async () => {
    const user = userEvent.setup();
    renderDetail();
    fireEvent.change(screen.getByLabelText(labelled('services.version.effectiveFrom')), {
      target: { value: '2026-10-01' },
    });
    fireEvent.change(screen.getByLabelText(labelled('services.version.effectiveTo')), {
      target: { value: '2026-10-01' },
    });
    await user.click(
      screen.getByRole('button', { name: EN['services.version.createDraft'] as string })
    );
    expect(await screen.findByText(EN['services.version.rangeOrder'] as string)).toBeVisible();
    expect(createServiceVersion).not.toHaveBeenCalled();
  });
});
