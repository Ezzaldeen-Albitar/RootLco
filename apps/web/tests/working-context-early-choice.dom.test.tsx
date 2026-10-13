import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
  WorkingContextProvider,
  useUnsavedGuard,
  useWorkingContext,
} from '@/features/working-context/WorkingContextProvider';
import { WorkingContextControl } from '@/features/working-context/components/WorkingContextControl';
import {
  ALL_BRANCHES,
  preferenceKeyFor,
} from '@/features/working-context/working-context-contract';
import { getMessages, translate } from '@/i18n/get-messages';
import { BranchSelector } from '@/features/working-context/mui/BranchSelector';
import { OTHER_BRANCH, TEST_BRANCH, TEST_COMPANY, branchSnapshot, renderLtr } from './render';

/**
 * A branch chosen in the header before the page is ready is kept
 * (P1-32-PRE-OD-UXQ, Q-1).
 *
 * ## What was seen
 *
 * With "All my branches" remembered, a screen that works in one branch was
 * opened and a branch was chosen in the header's select the moment it was
 * drawn. The select accepted the choice and then read "Choose your branch"
 * again; the remembered selection stayed "All my branches". The same choice
 * made a second later was kept.
 *
 * ## Why
 *
 * The header is in the server's HTML, so its select is drawn — enabled — before
 * React has hydrated it. A choice made then is lost in one of two ways:
 *
 *   - before React is on the page at all, the select changes and nobody is
 *     told. React leaves the select as it finds it while it hydrates, and the
 *     first render after that writes the value the provider holds back over it;
 *   - once React is on the page but has not hydrated yet, the choice itself
 *     makes React hydrate at once. Hydration is followed, in the same breath, by
 *     the render that restores the remembered selection (the provider's two
 *     stored-value reads force it), and that render puts the select back BEFORE
 *     the select's own handler is called — so the handler reads a select that
 *     holds no choice any more.
 *
 * No effect of the provider overwrites a choice React was told about: the cases
 * below make the choice at each moment after hydration and it was kept at every
 * one of them before the correction too.
 *
 * ## The correction
 *
 * The select is read once, in the commit that hydrates it, and a branch it
 * holds that it was not drawn with is taken as the choice it is
 * (`BranchSelector`). In the second way above the same choice then arrives
 * twice — read at hydration, and delivered as the event — and the provider
 * takes a request for the selection already remembered and in force as nothing
 * to do, so the version moves once.
 *
 * ## The moments, in order
 *
 *   1. before React hydrates the page (the defect);
 *   2. after `hydrateRoot` is called and before it has rendered — the choice
 *      itself makes React hydrate at once, and is then delivered to it;
 *   3. in the commit that hydrates, before any effect of the provider has run;
 *   4. among the effects of that commit, the remembered selection not yet read
 *      (a restore is pending);
 *   5. among the effects of the commit that restored the remembered selection,
 *      before the provider's own (between its first effect and its second);
 *   6. later, by hand.
 *
 * At every one the select, the provider and the remembered selection end on the
 * branch that was chosen, and the version moved exactly once for each selection
 * that came into force.
 */

const messages = getMessages('en');

const nav = vi.hoisted(() => ({ pathname: '/en/inventory/parts' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const TWO = branchSnapshot([TEST_BRANCH, OTHER_BRANCH]);
const KEY = preferenceKeyFor(TWO.tenantId as string, TWO.accountId as string);
const SELECT = '[data-testid="working-context-select"]';

/** Every selection the provider put in force, with the version it carried. */
const seen: string[] = [];

function Probe() {
  const { selection, version } = useWorkingContext();
  const text = selection === null ? '' : selection.allBranches ? 'all' : selection.branchId;
  useEffect(() => {
    const entry = `${version}:${text}`;
    if (seen[seen.length - 1] !== entry) seen.push(entry);
  }, [version, text]);
  return (
    <>
      <output data-testid="probe-selection">{text}</output>
      <output data-testid="probe-version">{version}</output>
    </>
  );
}

/** What a person does: the select takes the option, and says so. */
function choose(branchId: string): void {
  const select = document.querySelector(SELECT) as HTMLSelectElement;
  select.value = branchId;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

type Moment = 'hydrating-commit' | 'restore-pending' | 'restored';

/**
 * Makes the choice at one named moment of the page's start. It renders nothing
 * on either side, so it cannot disturb hydration, and it stands AFTER the
 * header in the tree, so its effects run after the header's and before the
 * provider's own (a parent's effects run after its children's).
 */
function ChoosesAt({ moment, branchId }: { readonly moment: Moment; readonly branchId: string }) {
  const { version } = useWorkingContext();
  const done = useRef(false);
  useLayoutEffect(() => {
    if (moment !== 'hydrating-commit' || done.current) return;
    done.current = true;
    choose(branchId);
  }, [moment, branchId]);
  useEffect(() => {
    if (moment !== 'restore-pending' || done.current) return;
    done.current = true;
    choose(branchId);
  }, [moment, branchId]);
  useEffect(() => {
    // The remembered selection has just come into force: version one.
    if (moment !== 'restored' || version !== 1 || done.current) return;
    done.current = true;
    choose(branchId);
  }, [moment, branchId, version]);
  return null;
}

const tree = (moment?: Moment) => (
  <WorkingContextProvider snapshot={TWO} messages={messages}>
    <header>
      <WorkingContextControl messages={messages} />
    </header>
    {moment === undefined ? null : <ChoosesAt moment={moment} branchId={TEST_BRANCH.id} />}
    <Probe />
  </WorkingContextProvider>
);

interface Page {
  readonly container: HTMLElement;
  readonly select: () => HTMLSelectElement;
  readonly selection: () => string | null;
  readonly version: () => string | null;
  readonly recoverable: Mock<(error: unknown) => void>;
  readonly hydrate: (moment?: Moment) => Promise<void>;
}

let open: { root: Root | null; container: HTMLElement } | null = null;

/** The server's HTML for the page, in the document, not yet hydrated. */
function serverPage(): Page {
  const container = document.createElement('div');
  container.innerHTML = renderToString(tree());
  document.body.appendChild(container);
  const recoverable = vi.fn<(error: unknown) => void>();
  open = { root: null, container };
  const text = (id: string) =>
    container.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;
  return {
    container,
    select: () => container.querySelector(SELECT) as HTMLSelectElement,
    selection: () => text('probe-selection'),
    version: () => text('probe-version'),
    recoverable,
    hydrate: async (moment) => {
      await act(async () => {
        (open as { root: Root | null }).root = hydrateRoot(container, tree(moment), {
          onRecoverableError: recoverable,
        });
      });
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  nav.pathname = '/en/inventory/parts';
  seen.length = 0;
});

afterEach(() => {
  if (open !== null) {
    const { root, container } = open;
    act(() => root?.unmount());
    container.remove();
    open = null;
  }
});

describe('the server draws the select before anything is remembered', () => {
  it('is enabled, shows the ask and offers the branches by name', () => {
    window.localStorage.setItem(KEY, ALL_BRANCHES);
    const page = serverPage();
    expect(page.select().disabled).toBe(false);
    expect(page.select().value).toBe('');
    // A browser must not put an earlier page's value back into it on a reload:
    // it would be read at hydration as a choice nobody made.
    expect(page.select()).toHaveAttribute('autocomplete', 'off');
    expect([...page.select().options].map((option) => option.value)).toEqual([
      '',
      TEST_BRANCH.id,
      OTHER_BRANCH.id,
    ]);
  });
});

describe('a select nobody touched restores what is remembered', () => {
  it('restores a remembered branch, moving the version once', async () => {
    window.localStorage.setItem(KEY, OTHER_BRANCH.id);
    const page = serverPage();
    await page.hydrate();
    expect(page.recoverable).not.toHaveBeenCalled();
    expect(page.select().value).toBe(OTHER_BRANCH.id);
    expect(page.selection()).toBe(OTHER_BRANCH.id);
    expect(window.localStorage.getItem(KEY)).toBe(OTHER_BRANCH.id);
    expect(seen).toEqual(['0:', `1:${OTHER_BRANCH.id}`]);
  });

  it('restores "All my branches", which this screen shows as the ask', async () => {
    window.localStorage.setItem(KEY, ALL_BRANCHES);
    const page = serverPage();
    await page.hydrate();
    expect(page.select().value).toBe('');
    expect(page.selection()).toBe('all');
    expect(window.localStorage.getItem(KEY)).toBe(ALL_BRANCHES);
    expect(seen).toEqual(['0:', '1:all']);
  });

  it('leaves nothing chosen when nothing is remembered', async () => {
    const page = serverPage();
    await page.hydrate();
    expect(page.select().value).toBe('');
    expect(page.selection()).toBe('');
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(seen).toEqual(['0:']);
  });
});

describe('a branch chosen before React hydrates the page is kept (the defect)', () => {
  it.each([
    ['"All my branches"', ALL_BRANCHES],
    ['another branch', OTHER_BRANCH.id],
    ['nothing', null],
  ] as const)('with %s remembered', async (_name, remembered) => {
    if (remembered !== null) window.localStorage.setItem(KEY, remembered);
    const page = serverPage();
    // Nothing is listening yet: the select changes and nobody is told.
    choose(TEST_BRANCH.id);
    expect(page.select().value).toBe(TEST_BRANCH.id);
    await page.hydrate();
    expect(page.recoverable).not.toHaveBeenCalled();
    expect(page.select().value).toBe(TEST_BRANCH.id);
    expect(page.selection()).toBe(TEST_BRANCH.id);
    // The remembered selection is the operator's choice, not the one before it.
    expect(window.localStorage.getItem(KEY)).toBe(TEST_BRANCH.id);
    // One selection came into force, once: what was remembered never did.
    expect(seen).toEqual(['0:', `1:${TEST_BRANCH.id}`]);
  });

  it('the branch that was remembered, chosen early, comes into force once', async () => {
    window.localStorage.setItem(KEY, TEST_BRANCH.id);
    const page = serverPage();
    choose(TEST_BRANCH.id);
    await page.hydrate();
    expect(page.select().value).toBe(TEST_BRANCH.id);
    expect(page.selection()).toBe(TEST_BRANCH.id);
    expect(seen).toEqual(['0:', `1:${TEST_BRANCH.id}`]);
  });

  it('the ask, left as it was drawn, is not a choice', async () => {
    window.localStorage.setItem(KEY, OTHER_BRANCH.id);
    const page = serverPage();
    choose('');
    await page.hydrate();
    expect(page.selection()).toBe(OTHER_BRANCH.id);
    expect(seen).toEqual(['0:', `1:${OTHER_BRANCH.id}`]);
  });
});

describe('a branch chosen while React is taking the page over is kept', () => {
  it('after hydration is asked for and before it has rendered: heard once, not twice', async () => {
    window.localStorage.setItem(KEY, ALL_BRANCHES);
    const page = serverPage();
    const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined };
    const before = environment.IS_REACT_ACT_ENVIRONMENT;
    // Outside `act`, as in a browser: hydration is scheduled, not yet done.
    environment.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      (open as { root: Root | null }).root = hydrateRoot(page.container, tree(), {
        onRecoverableError: page.recoverable,
      });
      expect(page.version()).toBe('0');
      choose(TEST_BRANCH.id);
      await waitFor(() => expect(page.selection()).toBe(TEST_BRANCH.id));
      // Let anything still scheduled land before the count is read.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      environment.IS_REACT_ACT_ENVIRONMENT = before;
    }
    expect(page.select().value).toBe(TEST_BRANCH.id);
    expect(window.localStorage.getItem(KEY)).toBe(TEST_BRANCH.id);
    expect(page.version()).toBe('1');
    expect(seen).toEqual(['0:', `1:${TEST_BRANCH.id}`]);
  });

  it.each([
    ['in the commit that hydrates, before any effect of the provider', 'hydrating-commit'],
    ['among the first effects, the remembered selection not yet read', 'restore-pending'],
  ] as const)('%s', async (_name, moment) => {
    window.localStorage.setItem(KEY, ALL_BRANCHES);
    const page = serverPage();
    await page.hydrate(moment);
    expect(page.recoverable).not.toHaveBeenCalled();
    expect(page.select().value).toBe(TEST_BRANCH.id);
    expect(page.selection()).toBe(TEST_BRANCH.id);
    expect(window.localStorage.getItem(KEY)).toBe(TEST_BRANCH.id);
    // The restore never applied: the operator had chosen since the page began.
    expect(seen).toEqual(['0:', `1:${TEST_BRANCH.id}`]);
  });

  it('between the restore and the effects that follow it: the restore, then the choice', async () => {
    window.localStorage.setItem(KEY, ALL_BRANCHES);
    const page = serverPage();
    await page.hydrate('restored');
    expect(page.select().value).toBe(TEST_BRANCH.id);
    expect(page.selection()).toBe(TEST_BRANCH.id);
    expect(window.localStorage.getItem(KEY)).toBe(TEST_BRANCH.id);
    expect(seen).toEqual(['0:', '1:all', `2:${TEST_BRANCH.id}`]);
  });
});

describe('the selection already in force, asked for again, moves nothing', () => {
  it('keeps the version and the remembered selection where they were', async () => {
    window.localStorage.setItem(KEY, OTHER_BRANCH.id);
    const page = serverPage();
    await page.hydrate();
    expect(seen).toEqual(['0:', `1:${OTHER_BRANCH.id}`]);
    act(() => choose(OTHER_BRANCH.id));
    expect(page.select().value).toBe(OTHER_BRANCH.id);
    expect(page.version()).toBe('1');
    expect(window.localStorage.getItem(KEY)).toBe(OTHER_BRANCH.id);
    expect(seen).toEqual(['0:', `1:${OTHER_BRANCH.id}`]);
  });
});

describe('a change held from another tab is still answered from the header', () => {
  function Unsaved() {
    useUnsavedGuard(true);
    return null;
  }

  it('choosing the branch the other tab chose is a real switch, and asks first', async () => {
    window.localStorage.setItem(KEY, TEST_BRANCH.id);
    renderLtr(
      <WorkingContextProvider snapshot={TWO} messages={messages}>
        <header>
          <WorkingContextControl messages={messages} />
        </header>
        <Unsaved />
        <Probe />
      </WorkingContextProvider>
    );
    expect(seen).toEqual([`0:${TEST_BRANCH.id}`]);

    // Another tab remembers the other branch; this one holds unsaved work, so
    // it stays where it was and storage now names a branch it is not on.
    act(() => {
      window.localStorage.setItem(KEY, OTHER_BRANCH.id);
      window.dispatchEvent(new Event('storage'));
    });
    expect(await screen.findByTestId('working-context-cross-tab')).toBeInTheDocument();
    expect(screen.getByTestId('probe-selection')).toHaveTextContent(TEST_BRANCH.id);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByTestId('working-context-select'), OTHER_BRANCH.id);
    await user.click(
      await screen.findByRole('button', {
        name: translate(messages, 'workingContext.discard.confirm'),
      })
    );
    expect(screen.getByTestId('probe-selection')).toHaveTextContent(OTHER_BRANCH.id);
    expect(seen).toEqual([`0:${TEST_BRANCH.id}`, `1:${OTHER_BRANCH.id}`]);
  });
});

describe('a select React rendered itself is never read as a choice', () => {
  const drawn = (value: string, onSelect: (next: string) => void) => (
    <BranchSelector
      messages={messages}
      status="ready"
      companies={[TEST_COMPANY]}
      branches={[TEST_BRANCH, OTHER_BRANCH]}
      value={value}
      onSelect={onSelect}
      onRetry={() => undefined}
      offerAllBranches={false}
    />
  );

  it.each([
    ['nothing chosen', ''],
    ['a branch', OTHER_BRANCH.id],
  ] as const)('drawn with %s, it asks for nothing', (_name, value) => {
    const onSelect = vi.fn();
    const { rerender } = renderLtr(drawn(value, onSelect));
    expect((screen.getByTestId('working-context-select') as HTMLSelectElement).value).toBe(value);
    rerender(drawn(value, vi.fn()));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('a value it does not offer shows the first branch, and that is not a choice', () => {
    const onSelect = vi.fn();
    // "All my branches" is not offered here, so the browser shows the first
    // option. Nobody chose it.
    renderLtr(drawn(ALL_BRANCHES, onSelect));
    expect((screen.getByTestId('working-context-select') as HTMLSelectElement).value).toBe(
      TEST_BRANCH.id
    );
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('a branch chosen later is kept, as before', () => {
  it('moves the version once more and is remembered', async () => {
    window.localStorage.setItem(KEY, ALL_BRANCHES);
    const page = serverPage();
    await page.hydrate();
    expect(seen).toEqual(['0:', '1:all']);
    await userEvent.selectOptions(screen.getByTestId('working-context-select'), TEST_BRANCH.id);
    expect(page.select().value).toBe(TEST_BRANCH.id);
    expect(page.selection()).toBe(TEST_BRANCH.id);
    expect(window.localStorage.getItem(KEY)).toBe(TEST_BRANCH.id);
    expect(seen).toEqual(['0:', '1:all', `2:${TEST_BRANCH.id}`]);
  });
});
