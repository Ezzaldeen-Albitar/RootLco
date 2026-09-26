import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../src/i18n/messages/en.json';
import {
  WorkingContextProvider,
  useUnsavedGuard,
  useWorkingContext,
} from '@/features/working-context/WorkingContextProvider';
import { WorkingContextControl } from '@/features/working-context/components/WorkingContextControl';
import {
  DirectoryEmptyNotice,
  RequiresConcreteBranch,
  WorkingBranchField,
} from '@/features/working-context/components/WorkingBranchField';
import { ConcreteRouteGate } from '@/features/working-context/components/ConcreteRouteGate';
import {
  ALL_BRANCHES,
  preferenceKeyFor,
  type WorkingContextSnapshot,
} from '@/features/working-context/working-context-contract';
import { ROUTE_BRANCH_SCOPES } from '@/config/route-branch-scope';
import { getMessages } from '@/i18n/get-messages';
import { OTHER_BRANCH, TEST_BRANCH, TEST_COMPANY, branchSnapshot, renderLtr } from './render';

/**
 * The header's branch control, per route scope (Owner directive; Browser QA
 * part 7, rows 1b.5 and 1a.3).
 *
 * The rules, each asserted below in the direction that would catch its
 * regression:
 *
 *   - **union** routes offer "All my branches";
 *   - **concrete** routes do not, and arriving on one with it selected shows the
 *     ask with nothing chosen — the selection itself is left alone, so no branch
 *     is ever picked on the operator's behalf, and a union route visited next
 *     reads every branch again;
 *   - **none** routes draw no control at all;
 *   - the inline chooser a concrete screen offers is the working context's own
 *     guarded switch: it asks before discarding unsaved work, and it moves the
 *     version like any other switch;
 *   - an operator with one branch sees no selector anywhere.
 */

const EN = en as Record<string, string>;
const messages = getMessages('en');

const nav = vi.hoisted(() => ({ pathname: '/en' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

/*
 * The discount threshold screen reads its company through the working branch;
 * its two adapters are replaced so a case can prove neither is reached.
 */
const thresholdReads = vi.hoisted(() => ({
  readDiscountThreshold: vi.fn(),
  setDiscountThreshold: vi.fn(),
}));
vi.mock('@/features/pricing/api', () => ({
  readDiscountThreshold: (...args: unknown[]) => thresholdReads.readDiscountThreshold(...args),
  setDiscountThreshold: (...args: unknown[]) => thresholdReads.setDiscountThreshold(...args),
}));

const { DiscountThresholdScreen } =
  await import('@/features/pricing/components/DiscountThresholdScreen');

const TWO = branchSnapshot([TEST_BRANCH, OTHER_BRANCH]);
const KEY = preferenceKeyFor(TWO.tenantId as string, TWO.accountId as string);

/** What the provider holds, as text: `''`, `all` or a branch id, and the version. */
function Probe() {
  const { selection, version } = useWorkingContext();
  const text = selection === null ? '' : selection.allBranches ? 'all' : selection.branchId;
  return (
    <>
      <output data-testid="probe-selection">{text}</output>
      <output data-testid="probe-version">{version}</output>
    </>
  );
}

function Dirty({ onDiscard }: { readonly onDiscard: () => void }) {
  useUnsavedGuard(true, onDiscard);
  return null;
}

/**
 * The header control and a screen's branch section under one provider, with
 * the address set first. `rerender` re-renders at a new address, which is how
 * a client-side navigation looks to the shell: the provider stays mounted.
 */
function renderAt(pathname: string, snapshot: WorkingContextSnapshot = TWO, page?: ReactNode) {
  nav.pathname = pathname;
  const tree = (content?: ReactNode) => (
    <WorkingContextProvider snapshot={snapshot} messages={messages}>
      <header>
        <WorkingContextControl messages={messages} />
      </header>
      <main>{content}</main>
      <Probe />
    </WorkingContextProvider>
  );
  const result = renderLtr(tree(page));
  return {
    ...result,
    navigate: (next: string, nextPage?: ReactNode) => {
      nav.pathname = next;
      result.rerender(tree(nextPage));
    },
  };
}

const headerSelect = () =>
  screen.queryByTestId('working-context-select') as HTMLSelectElement | null;
const optionNames = (select: HTMLSelectElement) =>
  within(select)
    .getAllByRole('option')
    .map((option) => option.textContent);

beforeEach(() => {
  window.localStorage.clear();
  nav.pathname = '/en';
});

describe('the header offers "All my branches" only where the read is a server union (QA 1b.5)', () => {
  it('offers it on a union route and shows it as the current choice', () => {
    window.localStorage.setItem(KEY, ALL_BRANCHES);
    renderAt('/en/work-orders');
    const select = headerSelect();
    expect(select).not.toBeNull();
    expect(optionNames(select as HTMLSelectElement)).toContain(EN['workingContext.allBranches']);
    expect((select as HTMLSelectElement).value).toBe(ALL_BRANCHES);
    expect(screen.queryByTestId('working-context-prompt')).toBeNull();
  });

  it('does not offer it on a concrete route, and asks for one branch when it is current', () => {
    window.localStorage.setItem(KEY, ALL_BRANCHES);
    renderAt('/en/receptions/check-in');
    const select = headerSelect() as HTMLSelectElement;
    expect(optionNames(select)).not.toContain(EN['workingContext.allBranches']);
    // Nothing chosen is shown as nothing chosen — not as the first branch,
    // which a native select would draw for a value it does not offer.
    expect(select.value).toBe('');
    expect(optionNames(select)).toContain(EN['workingContext.choose']);
    const prompt = screen.getByTestId('working-context-prompt');
    expect(prompt).toHaveTextContent(EN['workingContext.promptOneBranch'] as string);
    expect(prompt).toHaveAttribute('role', 'status');
    // And nothing was chosen on the operator's behalf.
    expect(screen.getByTestId('probe-selection')).toHaveTextContent('all');
  });

  it('shows a named branch on a concrete route without asking', () => {
    window.localStorage.setItem(KEY, OTHER_BRANCH.id);
    renderAt('/en/inventory/adjustments');
    const select = headerSelect() as HTMLSelectElement;
    expect(select.value).toBe(OTHER_BRANCH.id);
    expect(optionNames(select)).not.toContain(EN['workingContext.allBranches']);
    expect(screen.queryByTestId('working-context-prompt')).toBeNull();
  });

  it('draws nothing on a route that is not about a branch', () => {
    window.localStorage.setItem(KEY, ALL_BRANCHES);
    renderAt('/en/administration/users');
    expect(headerSelect()).toBeNull();
    expect(screen.queryByTestId('working-context-single')).toBeNull();
    expect(screen.queryByTestId('working-context-prompt')).toBeNull();
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
  });

  it('never offers it on an address the table does not know', () => {
    renderAt('/en/no-such-screen');
    expect(optionNames(headerSelect() as HTMLSelectElement)).not.toContain(
      EN['workingContext.allBranches']
    );
  });

  it('follows the table for every declared route (falsification: one table, one answer)', () => {
    for (const declaration of ROUTE_BRANCH_SCOPES) {
      window.localStorage.setItem(KEY, ALL_BRANCHES);
      const path = `/en${declaration.pattern.replace(/\[[^\]]+\]/g, 'x')}`.replace(/\/$/, '');
      const { unmount } = renderAt(path);
      const select = headerSelect();
      if (declaration.scope === 'none') {
        expect(select, path).toBeNull();
      } else {
        const offered = optionNames(select as HTMLSelectElement).includes(
          EN['workingContext.allBranches'] as string
        );
        expect(offered, path).toBe(declaration.scope === 'union');
      }
      unmount();
    }
  });
});

describe('moving from a union screen to a concrete one never picks a branch', () => {
  it('keeps "All my branches", asks on the concrete screen, and reads every branch again on the way back', () => {
    window.localStorage.setItem(KEY, ALL_BRANCHES);
    const page = <WorkingBranchField messages={messages} />;
    const view = renderAt('/en/work-orders', TWO, page);
    expect(headerSelect()?.value).toBe(ALL_BRANCHES);
    const versionBefore = screen.getByTestId('probe-version').textContent;

    act(() => view.navigate('/en/inventory/adjustments', page));
    expect(headerSelect()?.value).toBe('');
    expect(screen.getByTestId('working-context-prompt')).toBeInTheDocument();
    expect(screen.getByTestId('requires-concrete-branch')).toHaveTextContent(
      EN['workingContext.chooseBranchHere'] as string
    );
    const chooser = screen.getByTestId('concrete-branch-chooser') as HTMLSelectElement;
    expect(chooser.value).toBe('');
    // No silent pick: the selection and its version did not move.
    expect(screen.getByTestId('probe-selection')).toHaveTextContent('all');
    expect(screen.getByTestId('probe-version').textContent).toBe(versionBefore);

    act(() => view.navigate('/en/work-orders', page));
    expect(headerSelect()?.value).toBe(ALL_BRANCHES);
  });

  it('takes a branch named in the inline chooser as the working branch, moving the version', async () => {
    window.localStorage.setItem(KEY, ALL_BRANCHES);
    const user = userEvent.setup();
    renderAt('/en/inventory/adjustments', TWO, <WorkingBranchField messages={messages} />);
    const versionBefore = Number(screen.getByTestId('probe-version').textContent);

    await user.selectOptions(screen.getByTestId('concrete-branch-chooser'), OTHER_BRANCH.id);

    expect(screen.getByTestId('probe-selection')).toHaveTextContent(OTHER_BRANCH.id);
    expect(Number(screen.getByTestId('probe-version').textContent)).toBe(versionBefore + 1);
    expect(headerSelect()?.value).toBe(OTHER_BRANCH.id);
    expect(window.localStorage.getItem(KEY)).toBe(OTHER_BRANCH.id);
    expect(screen.queryByTestId('concrete-branch-chooser')).toBeNull();
  });

  it('asks before the inline chooser discards unsaved work, and discards only on confirmation', async () => {
    window.localStorage.setItem(KEY, ALL_BRANCHES);
    const onDiscard = vi.fn();
    const user = userEvent.setup();
    renderAt(
      '/en/inventory/adjustments',
      TWO,
      <>
        <Dirty onDiscard={onDiscard} />
        <WorkingBranchField messages={messages} />
      </>
    );

    await user.selectOptions(screen.getByTestId('concrete-branch-chooser'), OTHER_BRANCH.id);
    let dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: EN['overlay.cancel'] as string }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByTestId('probe-selection')).toHaveTextContent('all');
    expect(onDiscard).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByTestId('concrete-branch-chooser'), OTHER_BRANCH.id);
    dialog = await screen.findByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', {
        name: EN['workingContext.discard.confirm'] as string,
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId('probe-selection')).toHaveTextContent(OTHER_BRANCH.id)
    );
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('offers the inline chooser only where the branch is named, not beside every refusal', () => {
    window.localStorage.setItem(KEY, ALL_BRANCHES);
    renderAt(
      '/en/inventory/adjustments',
      TWO,
      <>
        <WorkingBranchField messages={messages} />
        <RequiresConcreteBranch messages={messages} testId="beside-submit" />
      </>
    );
    expect(screen.getAllByTestId('concrete-branch-chooser')).toHaveLength(1);
    expect(screen.getByTestId('beside-submit')).toHaveTextContent(
      EN['workingContext.needsOneBranch'] as string
    );
  });
});

describe('a union screen names the set it is reading (QA 1b.4)', () => {
  it('states "All my branches" and its company instead of asking for one branch', () => {
    window.localStorage.setItem(KEY, ALL_BRANCHES);
    renderAt('/en/work-orders', TWO, <WorkingBranchField messages={messages} acceptsAllBranches />);
    expect(screen.getByTestId('working-branch-field-all')).toHaveTextContent(
      `${EN['workingContext.allBranches']} · ${TEST_COMPANY.name}`
    );
    expect(screen.queryByTestId('requires-concrete-branch')).toBeNull();
    expect(screen.queryByTestId('concrete-branch-chooser')).toBeNull();
  });

  it('names no company when the branches span more than one', () => {
    const elsewhere = {
      ...OTHER_BRANCH,
      id: '66666666-6666-4666-8666-666666666666',
      companyId: '77777777-7777-4777-8777-777777777777',
    };
    const snapshot = branchSnapshot([TEST_BRANCH, elsewhere]);
    window.localStorage.setItem(
      preferenceKeyFor(snapshot.tenantId as string, snapshot.accountId as string),
      ALL_BRANCHES
    );
    renderAt(
      '/en/work-orders',
      snapshot,
      <WorkingBranchField messages={messages} acceptsAllBranches />
    );
    expect(screen.getByTestId('working-branch-field-all').textContent).toBe(
      EN['workingContext.allBranches']
    );
  });

  it('still asks, with the chooser, on a screen that does not accept the set (falsification)', () => {
    window.localStorage.setItem(KEY, ALL_BRANCHES);
    renderAt('/en/work-orders', TWO, <WorkingBranchField messages={messages} />);
    expect(screen.queryByTestId('working-branch-field-all')).toBeNull();
    expect(screen.getByTestId('requires-concrete-branch')).toBeInTheDocument();
    expect(screen.getByTestId('concrete-branch-chooser')).toBeInTheDocument();
  });
});

describe('an operator with one branch sees no selector anywhere (QA 1a.3)', () => {
  const ONE = branchSnapshot([TEST_BRANCH]);

  it.each(['/en', '/en/work-orders', '/en/receptions/check-in', '/en/attention'])(
    'names the branch on %s and offers no control',
    (path) => {
      // A stale "all" from before the grant narrowed is not a choice any more.
      window.localStorage.setItem(
        preferenceKeyFor(ONE.tenantId as string, ONE.accountId as string),
        ALL_BRANCHES
      );
      renderAt(
        path,
        ONE,
        <>
          <WorkingBranchField messages={messages} />
          <WorkingBranchField messages={messages} testId="union-field" acceptsAllBranches />
        </>
      );
      expect(screen.getByTestId('working-context-single')).toHaveTextContent(TEST_BRANCH.name);
      expect(screen.queryAllByRole('combobox')).toHaveLength(0);
      expect(screen.queryByTestId('concrete-branch-chooser')).toBeNull();
    }
  );

  it('draws nothing at all on a route that is not about a branch', () => {
    renderAt('/en/crm/customers', ONE);
    expect(screen.queryByTestId('working-context-single')).toBeNull();
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
  });
});

/** A screen that reports each mount, the way a list read on arrival would. */
function Screen({ onMount }: { readonly onMount: () => void }) {
  useEffect(() => {
    onMount();
  }, [onMount]);
  return <p data-testid="gated-screen">the screen</p>;
}

describe('a screen that needs one branch waits for one (PR #467 review)', () => {
  const gated = (onMount: () => void) => (
    <ConcreteRouteGate messages={messages}>
      <Screen onMount={onMount} />
    </ConcreteRouteGate>
  );

  it('on a concrete route under "All my branches", mounts nothing until a branch is named', async () => {
    window.localStorage.setItem(KEY, ALL_BRANCHES);
    const onMount = vi.fn();
    const user = userEvent.setup();
    renderAt('/en/invoices', TWO, gated(onMount));

    expect(screen.queryByTestId('gated-screen')).toBeNull();
    expect(onMount).not.toHaveBeenCalled();
    const prompt = screen.getByTestId('concrete-route-gate-prompt');
    expect(prompt).toHaveTextContent(EN['workingContext.chooseBranchHere'] as string);
    // The chooser is right there, so the sentence does not send anyone to the header.
    expect(prompt).not.toHaveTextContent(EN['workingContext.needsOneBranch'] as string);
    const chooser = screen.getByTestId('concrete-branch-chooser') as HTMLSelectElement;
    expect(chooser.value).toBe('');
    expect(screen.getByTestId('probe-selection')).toHaveTextContent('all');

    await user.selectOptions(chooser, TEST_BRANCH.id);
    expect(await screen.findByTestId('gated-screen')).toBeInTheDocument();
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('probe-selection')).toHaveTextContent(TEST_BRANCH.id);
  });

  it('asks the same way before any branch is chosen', () => {
    const onMount = vi.fn();
    renderAt('/en/inventory/adjustments', TWO, gated(onMount));
    expect(screen.getByTestId('concrete-route-gate')).toBeInTheDocument();
    expect(onMount).not.toHaveBeenCalled();
  });

  it.each([
    ['a union route', '/en/work-orders'],
    ['a route that is not about a branch', '/en/crm/customers'],
  ])('lets the screen through on %s, even under "All my branches"', (_label, path) => {
    window.localStorage.setItem(KEY, ALL_BRANCHES);
    const onMount = vi.fn();
    renderAt(path, TWO, gated(onMount));
    expect(screen.getByTestId('gated-screen')).toBeInTheDocument();
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it('lets the screen through once a branch is named, and for an operator with one branch', () => {
    window.localStorage.setItem(KEY, OTHER_BRANCH.id);
    const first = vi.fn();
    const { unmount } = renderAt('/en/invoices', TWO, gated(first));
    expect(first).toHaveBeenCalledTimes(1);
    unmount();
    const second = vi.fn();
    renderAt('/en/invoices', branchSnapshot([TEST_BRANCH]), gated(second));
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('leaves "no branch assigned" to the screen, which says it in its own words', () => {
    const onMount = vi.fn();
    renderAt('/en/invoices', branchSnapshot([], 'none'), gated(onMount));
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('concrete-route-gate')).toBeNull();
  });
});

describe('the discount threshold is written for one named branch only (PR #467 review)', () => {
  it('reads nothing under "All my branches", and asks for one branch with the chooser', async () => {
    window.localStorage.setItem(KEY, ALL_BRANCHES);
    thresholdReads.readDiscountThreshold.mockReset();
    thresholdReads.readDiscountThreshold.mockResolvedValue({
      status: 'denied',
      correlationId: null,
    });
    const user = userEvent.setup();
    renderAt(
      '/en/administration/discount-threshold',
      TWO,
      <DiscountThresholdScreen locale="en" messages={messages} canManage />
    );
    expect(screen.getByTestId('discount-threshold-needs-branch')).toHaveTextContent(
      EN['workingContext.chooseBranchHere'] as string
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(thresholdReads.readDiscountThreshold).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByTestId('concrete-branch-chooser'), OTHER_BRANCH.id);
    await waitFor(() =>
      expect(thresholdReads.readDiscountThreshold).toHaveBeenCalledWith(TEST_COMPANY.id)
    );
  });
});

describe('a list the working context supplies says why it is empty in its own words', () => {
  it('never sends the operator to the header on a route that draws no branch control', () => {
    window.localStorage.setItem(KEY, ALL_BRANCHES);
    renderAt(
      '/en/administration/organization',
      TWO,
      <DirectoryEmptyNotice messages={messages} fallbackKey="workingContext.noCompany" />
    );
    expect(headerSelect()).toBeNull();
    const notice = screen.getByTestId('directory-empty');
    expect(notice).toHaveTextContent(EN['workingContext.noCompany'] as string);
    expect(notice).not.toHaveTextContent(EN['workingContext.needsOneBranch'] as string);
  });

  it('says the directory could not be read when it could not', () => {
    renderAt(
      '/en/administration/organization',
      branchSnapshot([], 'unavailable'),
      <DirectoryEmptyNotice messages={messages} fallbackKey="workingContext.noCompany" />
    );
    expect(screen.getByTestId('directory-empty')).toHaveTextContent(
      EN['workingContext.unavailable'] as string
    );
  });
});
