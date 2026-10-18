import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useLayoutEffect, useRef, type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
  WorkingContextProvider,
  useUnsavedGuard,
  useWorkingContext,
} from '@/features/working-context/WorkingContextProvider';
import { WorkingBranchField } from '@/features/working-context/components/WorkingBranchField';
import { WorkingContextControl } from '@/features/working-context/components/WorkingContextControl';
import {
  ALL_BRANCHES,
  preferenceKeyFor,
} from '@/features/working-context/working-context-contract';
import { getMessages, translate } from '@/i18n/get-messages';
import { BranchSelector } from '@/features/working-context/mui/BranchSelector';
import { useEarlyChoice } from '@/features/working-context/use-early-choice';
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
 * ## On every arrival, in a select marked `autocomplete="off"`
 *
 * Measured once, on plain static pages (experiment 2026-10-18, Chromium 151):
 * a move through history without the back/forward cache put an earlier value
 * back into every select not marked `autocomplete="off"` and into none that
 * was; a reload put nothing back; a page restored from the back/forward cache
 * is the live page, so React does not hydrate again. Firefox and WebKit were
 * not verified. Both selects that take an early choice are marked (asserted
 * below; the chooser only since F-1), and the hook checks the mark. So in
 * them a value that differs from what the server drew is a choice however the
 * document was reached: a fresh navigation, a reload, a move through history,
 * a prerender, or an arrival the browser does not name. A select without the
 * mark keeps the earlier rule — adopted on a fresh navigation only — and has
 * its own cases at the end. The earlier rule, applied to both selects, lost
 * every branch chosen before load on a reload or a move through history
 * (runtime retest at 784322b1, F-1). jsdom has no navigation entry of its own,
 * so each case states how the page was reached (`arriveBy`), and the stub is
 * taken away afterwards. What a real browser restores, and when, is not
 * something this file can see.
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

/** How the browser says the document was reached; `null` when it has no entry to give. */
type Arrival = 'navigate' | 'reload' | 'back_forward' | 'prerender' | null;

const ownNavigationEntries = Object.getOwnPropertyDescriptor(performance, 'getEntriesByType');

function stubNavigationEntries(read: (kind: string) => readonly unknown[]): void {
  Object.defineProperty(performance, 'getEntriesByType', { configurable: true, value: read });
}

/** States how the page under test was reached, as `PerformanceNavigationTiming.type` would. */
function arriveBy(type: Arrival): void {
  stubNavigationEntries((kind) => (kind === 'navigation' && type !== null ? [{ type }] : []));
}

function restoreNavigationEntries(): void {
  if (ownNavigationEntries !== undefined) {
    Object.defineProperty(performance, 'getEntriesByType', ownNavigationEntries);
  } else {
    delete (performance as { getEntriesByType?: unknown }).getEntriesByType;
  }
}

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
function choose(branchId: string, selector: string = SELECT): void {
  const select = document.querySelector(selector) as HTMLSelectElement;
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
function serverPage(
  build: (moment?: Moment) => ReactElement = tree,
  selector: string = SELECT
): Page {
  const container = document.createElement('div');
  container.innerHTML = renderToString(build());
  document.body.appendChild(container);
  const recoverable = vi.fn<(error: unknown) => void>();
  open = { root: null, container };
  const text = (id: string) =>
    container.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;
  return {
    container,
    select: () => container.querySelector(selector) as HTMLSelectElement,
    selection: () => text('probe-selection'),
    version: () => text('probe-version'),
    recoverable,
    hydrate: async (moment) => {
      await act(async () => {
        (open as { root: Root | null }).root = hydrateRoot(container, build(moment), {
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
  // A link, a typed address, a bookmark — unless a case says otherwise.
  arriveBy('navigate');
});

afterEach(() => {
  restoreNavigationEntries();
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
    // Chromium 151 did not put an earlier page's value back into a select so
    // marked in our experiment (Firefox and WebKit not verified), which is why
    // what it holds is taken as a choice on every arrival: see below.
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

/**
 * F-1 (runtime retest at 784322b1, 2026-10-18): on a reload or a move through
 * history, a branch chosen in the header or in the chooser before the page had
 * finished loading showed for a moment and was then replaced by the remembered
 * "All my branches" — 18 of 18 such choices. The shape here is that one: the
 * person's `input` and `change` are dispatched before `hydrateRoot` is called,
 * so when React hydrates the select holds the choice and no event is in flight.
 */
describe('a branch chosen before React hydrates is kept on a reload or a move through history (F-1)', () => {
  const CHOOSER = '[data-testid="concrete-branch-chooser"]';

  /** What a browser does when a person picks an option: the value, then `input`, then `change`. */
  function chooseAsABrowser(branchId: string, selector: string): void {
    const select = document.querySelector(selector) as HTMLSelectElement;
    select.value = branchId;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const bothTree = () => (
    <WorkingContextProvider snapshot={TWO} messages={messages}>
      <header>
        <WorkingContextControl messages={messages} />
      </header>
      <main>
        <WorkingBranchField messages={messages} />
      </main>
      <Probe />
    </WorkingContextProvider>
  );

  it.each([
    ['reload', '"All my branches"', ALL_BRANCHES],
    ['back_forward', '"All my branches"', ALL_BRANCHES],
    ['reload', 'another branch', OTHER_BRANCH.id],
    ['back_forward', 'nothing', null],
  ] as const)(
    'reached by %s with %s remembered, chosen in the header: the choice is kept',
    async (arrival, _name, remembered) => {
      arriveBy(arrival);
      if (remembered !== null) window.localStorage.setItem(KEY, remembered);
      const page = serverPage();
      chooseAsABrowser(TEST_BRANCH.id, SELECT);
      expect(page.select().value).toBe(TEST_BRANCH.id);
      // Hydration begins with no event being dispatched.
      expect(window.event).toBeUndefined();
      await page.hydrate();
      expect(page.recoverable).not.toHaveBeenCalled();
      expect(window.localStorage.getItem(KEY)).toBe(TEST_BRANCH.id);
      expect(page.selection()).toBe(TEST_BRANCH.id);
      expect(page.select().value).toBe(TEST_BRANCH.id);
      expect(seen).toEqual(['0:', `1:${TEST_BRANCH.id}`]);
    }
  );

  it.each([
    ['reload', '"All my branches"', ALL_BRANCHES],
    ['back_forward', '"All my branches"', ALL_BRANCHES],
    ['reload', 'another branch', OTHER_BRANCH.id],
    ['back_forward', 'nothing', null],
  ] as const)(
    'reached by %s with %s remembered, chosen in the chooser: the choice is kept',
    async (arrival, _name, remembered) => {
      arriveBy(arrival);
      if (remembered !== null) window.localStorage.setItem(KEY, remembered);
      const page = serverPage(bothTree, CHOOSER);
      chooseAsABrowser(TEST_BRANCH.id, CHOOSER);
      expect(page.select().value).toBe(TEST_BRANCH.id);
      expect(window.event).toBeUndefined();
      await page.hydrate();
      expect(page.recoverable).not.toHaveBeenCalled();
      expect(window.localStorage.getItem(KEY)).toBe(TEST_BRANCH.id);
      expect(page.selection()).toBe(TEST_BRANCH.id);
      // The screen has its branch, so the chooser is gone, and the header names it.
      expect(page.select()).toBeNull();
      expect((page.container.querySelector(SELECT) as HTMLSelectElement).value).toBe(
        TEST_BRANCH.id
      );
      expect(seen).toEqual(['0:', `1:${TEST_BRANCH.id}`]);
    }
  );
});

/**
 * Both selects are marked `autocomplete="off"`, and in Chromium 151 a select
 * so marked was not put back on a move through history, nor anything on a
 * reload (experiment 2026-10-18; Firefox and WebKit not verified). So a value
 * the select holds that it was not drawn with, when React hydrates it, is taken
 * as the operator's on every arrival — a reload, a move through history, a prerender,
 * or one the browser does not name — and it is adopted, whether or not an
 * event is being dispatched and whichever element that event is aimed at.
 * (These cases replace the #581 ones that put such a value back on every
 * arrival but a fresh navigation; a select without the mark still is, below.)
 */
describe('what the select holds beyond what it was drawn with is a choice on every arrival', () => {
  /** A value in the select, and no event says so. */
  function heldWithoutAnEvent(page: Page, branchId: string): void {
    page.select().value = branchId;
    expect(page.select().value).toBe(branchId);
  }

  it.each(['navigate', 'reload', 'back_forward', 'prerender', null] as const)(
    'reached by %s, with a branch remembered: the held branch is adopted',
    async (arrival) => {
      arriveBy(arrival);
      window.localStorage.setItem(KEY, OTHER_BRANCH.id);
      const page = serverPage();
      heldWithoutAnEvent(page, TEST_BRANCH.id);
      await page.hydrate();
      expect(page.recoverable).not.toHaveBeenCalled();
      expect(window.localStorage.getItem(KEY)).toBe(TEST_BRANCH.id);
      expect(page.selection()).toBe(TEST_BRANCH.id);
      expect(page.select().value).toBe(TEST_BRANCH.id);
      // The remembered branch never came into force.
      expect(seen).toEqual(['0:', `1:${TEST_BRANCH.id}`]);
    }
  );

  it.each(['reload', 'back_forward'] as const)(
    'reached by %s with nothing remembered: the held branch is adopted',
    async (arrival) => {
      arriveBy(arrival);
      const page = serverPage();
      heldWithoutAnEvent(page, TEST_BRANCH.id);
      await page.hydrate();
      expect(window.localStorage.getItem(KEY)).toBe(TEST_BRANCH.id);
      expect(page.selection()).toBe(TEST_BRANCH.id);
      expect(page.select().value).toBe(TEST_BRANCH.id);
      expect(seen).toEqual(['0:', `1:${TEST_BRANCH.id}`]);
    }
  );

  it('the browser cannot be asked how the page was reached: the held branch is adopted', async () => {
    stubNavigationEntries(() => {
      throw new Error('not supported here');
    });
    window.localStorage.setItem(KEY, OTHER_BRANCH.id);
    const page = serverPage();
    heldWithoutAnEvent(page, TEST_BRANCH.id);
    await page.hydrate();
    expect(window.localStorage.getItem(KEY)).toBe(TEST_BRANCH.id);
    expect(page.select().value).toBe(TEST_BRANCH.id);
    expect(seen).toEqual(['0:', `1:${TEST_BRANCH.id}`]);
  });

  it('reached by reload, hydrated by a click aimed elsewhere: the held branch is still adopted', async () => {
    arriveBy('reload');
    window.localStorage.setItem(KEY, OTHER_BRANCH.id);
    const page = serverPage();
    heldWithoutAnEvent(page, TEST_BRANCH.id);
    const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined };
    const before = environment.IS_REACT_ACT_ENVIRONMENT;
    environment.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      (open as { root: Root | null }).root = hydrateRoot(page.container, tree(), {
        onRecoverableError: page.recoverable,
      });
      // A click somewhere else on the page makes React hydrate at once. It is
      // not what makes the held branch a choice, and it does not stop it being one.
      const elsewhere = page.container.querySelector(
        '[data-testid="probe-version"]'
      ) as HTMLElement;
      elsewhere.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await waitFor(() => expect(page.selection()).toBe(TEST_BRANCH.id));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      environment.IS_REACT_ACT_ENVIRONMENT = before;
    }
    expect(page.recoverable).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(KEY)).toBe(TEST_BRANCH.id);
    expect(page.select().value).toBe(TEST_BRANCH.id);
    expect(seen).toEqual(['0:', `1:${TEST_BRANCH.id}`]);
  });

  it('reached by reload, hydrated by a click aimed elsewhere, nothing held: nothing is adopted', async () => {
    arriveBy('reload');
    window.localStorage.setItem(KEY, OTHER_BRANCH.id);
    const page = serverPage();
    const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined };
    const before = environment.IS_REACT_ACT_ENVIRONMENT;
    environment.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      (open as { root: Root | null }).root = hydrateRoot(page.container, tree(), {
        onRecoverableError: page.recoverable,
      });
      const elsewhere = page.container.querySelector(
        '[data-testid="probe-version"]'
      ) as HTMLElement;
      elsewhere.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await waitFor(() => expect(page.selection()).toBe(OTHER_BRANCH.id));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      environment.IS_REACT_ACT_ENVIRONMENT = before;
    }
    expect(page.recoverable).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(KEY)).toBe(OTHER_BRANCH.id);
    expect(page.select().value).toBe(OTHER_BRANCH.id);
    expect(seen).toEqual(['0:', `1:${OTHER_BRANCH.id}`]);
  });

  it.each(['reload', 'back_forward'] as const)(
    'reached by %s, the ask left as it was drawn: nothing is adopted',
    async (arrival) => {
      arriveBy(arrival);
      window.localStorage.setItem(KEY, OTHER_BRANCH.id);
      const page = serverPage();
      heldWithoutAnEvent(page, '');
      await page.hydrate();
      expect(window.localStorage.getItem(KEY)).toBe(OTHER_BRANCH.id);
      expect(page.selection()).toBe(OTHER_BRANCH.id);
      expect(seen).toEqual(['0:', `1:${OTHER_BRANCH.id}`]);
    }
  );
});

describe('a value the select was never given to offer is not read as a choice', () => {
  const NOT_PUBLISHED = '99999999-9999-4999-8999-999999999999';

  /** An option edited in the document to name a branch the server did not publish, and chosen. */
  function tampered(page: Page): void {
    const option = [...page.select().options].find(
      (candidate) => candidate.value === TEST_BRANCH.id
    ) as HTMLOptionElement;
    option.value = NOT_PUBLISHED;
    page.select().value = NOT_PUBLISHED;
    expect(page.select().value).toBe(NOT_PUBLISHED);
  }

  it('with a branch remembered: nothing is written and the version moves for the restore alone', async () => {
    window.localStorage.setItem(KEY, OTHER_BRANCH.id);
    const page = serverPage();
    tampered(page);
    // React reports the edited option when it hydrates; that is the tampering.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await page.hydrate();
    } finally {
      errors.mockRestore();
    }
    // The remembered selection was never replaced, not even for a moment.
    expect(window.localStorage.getItem(KEY)).toBe(OTHER_BRANCH.id);
    expect(page.selection()).toBe(OTHER_BRANCH.id);
    expect(seen).toEqual(['0:', `1:${OTHER_BRANCH.id}`]);
  });

  it('with nothing remembered: nothing is written and the version does not move', async () => {
    const page = serverPage();
    tampered(page);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await page.hydrate();
    } finally {
      errors.mockRestore();
    }
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(page.selection()).toBe('');
    expect(seen).toEqual(['0:']);
  });

  it('"All my branches" is not adopted on a screen that does not offer it', async () => {
    // This screen needs one branch, so the select was not given the option.
    window.localStorage.setItem(KEY, OTHER_BRANCH.id);
    const page = serverPage();
    const option = [...page.select().options].find(
      (candidate) => candidate.value === TEST_BRANCH.id
    ) as HTMLOptionElement;
    option.value = ALL_BRANCHES;
    page.select().value = ALL_BRANCHES;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await page.hydrate();
    } finally {
      errors.mockRestore();
    }
    expect(window.localStorage.getItem(KEY)).toBe(OTHER_BRANCH.id);
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

  /*
   * The same choice on a reload or a move through history. Putting the select
   * back to the drawn value before that event reached the select's handler left
   * the handler reading the ask, and the remembered "All my branches" stood
   * (runtime retest 2026-10-18: a branch chosen about a quarter of a second
   * after the select was drawn, on a reload, was lost). The select is no longer
   * put back on any arrival; these cases keep pinning the choice delivered as
   * React hydrates.
   */
  it.each(['reload', 'back_forward'] as const)(
    'reached by %s, after hydration is asked for and before it has rendered: the choice is kept',
    async (arrival) => {
      arriveBy(arrival);
      window.localStorage.setItem(KEY, ALL_BRANCHES);
      const page = serverPage();
      const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined };
      const before = environment.IS_REACT_ACT_ENVIRONMENT;
      environment.IS_REACT_ACT_ENVIRONMENT = false;
      try {
        (open as { root: Root | null }).root = hydrateRoot(page.container, tree(), {
          onRecoverableError: page.recoverable,
        });
        expect(page.version()).toBe('0');
        choose(TEST_BRANCH.id);
        await waitFor(() => expect(page.selection()).toBe(TEST_BRANCH.id));
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
      } finally {
        environment.IS_REACT_ACT_ENVIRONMENT = before;
      }
      expect(page.recoverable).not.toHaveBeenCalled();
      expect(page.select().value).toBe(TEST_BRANCH.id);
      expect(window.localStorage.getItem(KEY)).toBe(TEST_BRANCH.id);
      expect(page.version()).toBe('1');
      expect(seen).toEqual(['0:', `1:${TEST_BRANCH.id}`]);
    }
  );

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

/**
 * The chooser a screen offers beside its branch ask (`ConcreteBranchChooser`).
 *
 * It is a second select that writes the working context, and it is in the
 * server's HTML wherever a screen is drawn before a branch is known — the
 * boards that read every branch, for an operator with several. It takes an
 * early choice through the same hook as the header's select, and carries the
 * same `autocomplete="off"`, so the cases mirror the header's: adopted on
 * every arrival, and never a value it was not given to offer.
 */
describe("the chooser beside a screen's branch ask keeps an early choice the same way", () => {
  const CHOOSER = '[data-testid="concrete-branch-chooser"]';
  const screenTree = () => (
    <WorkingContextProvider snapshot={TWO} messages={messages}>
      <main>
        <WorkingBranchField messages={messages} />
      </main>
      <Probe />
    </WorkingContextProvider>
  );
  const screenPage = () => serverPage(screenTree, CHOOSER);

  it("is in the server's HTML, enabled, with nothing selected and the branches by name", () => {
    window.localStorage.setItem(KEY, OTHER_BRANCH.id);
    const page = screenPage();
    expect(page.select().disabled).toBe(false);
    // Like the header's: a select Chromium 151 did not put back from history
    // in our experiment (Firefox and WebKit not verified).
    expect(page.select()).toHaveAttribute('autocomplete', 'off');
    expect([...page.select().options].map((option) => option.value)).toEqual([
      '',
      TEST_BRANCH.id,
      OTHER_BRANCH.id,
    ]);
  });

  it.each([
    ['"All my branches"', ALL_BRANCHES],
    ['another branch', OTHER_BRANCH.id],
    ['nothing', null],
  ] as const)(
    'on a fresh navigation, with %s remembered: the choice is kept',
    async (_name, remembered) => {
      if (remembered !== null) window.localStorage.setItem(KEY, remembered);
      const page = screenPage();
      choose(TEST_BRANCH.id, CHOOSER);
      await page.hydrate();
      expect(page.recoverable).not.toHaveBeenCalled();
      expect(window.localStorage.getItem(KEY)).toBe(TEST_BRANCH.id);
      expect(page.selection()).toBe(TEST_BRANCH.id);
      expect(seen).toEqual(['0:', `1:${TEST_BRANCH.id}`]);
      // The screen has its branch, so it no longer asks.
      expect(page.select()).toBeNull();
    }
  );

  it('chosen while React is taking the page over: heard once, not twice', async () => {
    window.localStorage.setItem(KEY, ALL_BRANCHES);
    const page = screenPage();
    const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined };
    const before = environment.IS_REACT_ACT_ENVIRONMENT;
    environment.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      (open as { root: Root | null }).root = hydrateRoot(page.container, screenTree(), {
        onRecoverableError: page.recoverable,
      });
      choose(TEST_BRANCH.id, CHOOSER);
      await waitFor(() => expect(page.selection()).toBe(TEST_BRANCH.id));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      environment.IS_REACT_ACT_ENVIRONMENT = before;
    }
    expect(window.localStorage.getItem(KEY)).toBe(TEST_BRANCH.id);
    expect(page.version()).toBe('1');
    expect(seen).toEqual(['0:', `1:${TEST_BRANCH.id}`]);
  });

  it.each(['reload', 'back_forward'] as const)(
    'reached by %s, chosen while React is taking the page over: the choice is kept',
    async (arrival) => {
      arriveBy(arrival);
      window.localStorage.setItem(KEY, ALL_BRANCHES);
      const page = screenPage();
      const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined };
      const before = environment.IS_REACT_ACT_ENVIRONMENT;
      environment.IS_REACT_ACT_ENVIRONMENT = false;
      try {
        (open as { root: Root | null }).root = hydrateRoot(page.container, screenTree(), {
          onRecoverableError: page.recoverable,
        });
        choose(TEST_BRANCH.id, CHOOSER);
        await waitFor(() => expect(page.selection()).toBe(TEST_BRANCH.id));
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
      } finally {
        environment.IS_REACT_ACT_ENVIRONMENT = before;
      }
      expect(page.recoverable).not.toHaveBeenCalled();
      expect(window.localStorage.getItem(KEY)).toBe(TEST_BRANCH.id);
      expect(page.version()).toBe('1');
      expect(seen).toEqual(['0:', `1:${TEST_BRANCH.id}`]);
      // The screen has its branch, so the chooser is gone rather than left naming it.
      expect(page.select()).toBeNull();
    }
  );

  it.each(['reload', 'back_forward', 'prerender', null] as const)(
    'reached by %s, a branch held with no event: it is adopted',
    async (arrival) => {
      arriveBy(arrival);
      window.localStorage.setItem(KEY, OTHER_BRANCH.id);
      const page = screenPage();
      // A value, and no event. Chromium 151 did not put one back into a select
      // marked `autocomplete="off"` in our experiment (Firefox and WebKit not
      // verified), so it is taken as chosen.
      page.select().value = TEST_BRANCH.id;
      await page.hydrate();
      expect(window.localStorage.getItem(KEY)).toBe(TEST_BRANCH.id);
      expect(page.selection()).toBe(TEST_BRANCH.id);
      expect(seen).toEqual(['0:', `1:${TEST_BRANCH.id}`]);
      expect(page.select()).toBeNull();
    }
  );

  it.each(['reload', 'back_forward'] as const)(
    'reached by %s with nothing remembered, a branch held with no event: it is adopted',
    async (arrival) => {
      arriveBy(arrival);
      const page = screenPage();
      page.select().value = TEST_BRANCH.id;
      await page.hydrate();
      expect(window.localStorage.getItem(KEY)).toBe(TEST_BRANCH.id);
      expect(page.selection()).toBe(TEST_BRANCH.id);
      expect(seen).toEqual(['0:', `1:${TEST_BRANCH.id}`]);
      expect(page.select()).toBeNull();
    }
  );

  it('reached by reload, a value it was never given to offer is not a choice', async () => {
    arriveBy('reload');
    window.localStorage.setItem(KEY, ALL_BRANCHES);
    const page = screenPage();
    const option = [...page.select().options].find(
      (candidate) => candidate.value === TEST_BRANCH.id
    ) as HTMLOptionElement;
    option.value = '99999999-9999-4999-8999-999999999999';
    page.select().value = option.value;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await page.hydrate();
    } finally {
      errors.mockRestore();
    }
    expect(window.localStorage.getItem(KEY)).toBe(ALL_BRANCHES);
    expect(page.selection()).toBe('all');
    expect(seen).toEqual(['0:', '1:all']);
    // Put back to the ask, not left naming a branch nobody was published.
    expect(page.select().value).toBe('');
  });

  it('a value it was never given to offer is not a choice', async () => {
    window.localStorage.setItem(KEY, ALL_BRANCHES);
    const page = screenPage();
    const option = [...page.select().options].find(
      (candidate) => candidate.value === TEST_BRANCH.id
    ) as HTMLOptionElement;
    option.value = '99999999-9999-4999-8999-999999999999';
    page.select().value = option.value;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await page.hydrate();
    } finally {
      errors.mockRestore();
    }
    expect(window.localStorage.getItem(KEY)).toBe(ALL_BRANCHES);
    expect(page.selection()).toBe('all');
    expect(seen).toEqual(['0:', '1:all']);
  });
});

/**
 * The choice React is hydrating to deliver, on a reload or a move through
 * history (#591).
 *
 * A browser choosing an option fires `input` and then `change` on the select,
 * and React hydrates on the first of them; `choose` above fires `change`
 * alone, so the cases here fire both, in that order. Which element the event
 * is aimed at no longer decides anything: a select adopts what it holds beyond
 * what it was drawn with, and a select that still holds what it was drawn with
 * adopts nothing, whichever select the person changed.
 */
describe('on a reload, a choice made as React hydrates is kept in the select it was made in', () => {
  const CHOOSER = '[data-testid="concrete-branch-chooser"]';

  /** What a browser does when a person picks an option: the value, then `input`, then `change`. */
  function chooseAsABrowser(branchId: string, selector: string): void {
    const select = document.querySelector(selector) as HTMLSelectElement;
    select.value = branchId;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** Hydrates outside `act`, as in a browser, makes the choice, and lets everything scheduled land. */
  async function hydrateThenChoose(
    page: Page,
    build: () => ReactElement,
    act_: () => void,
    settled: () => void
  ): Promise<void> {
    const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined };
    const before = environment.IS_REACT_ACT_ENVIRONMENT;
    environment.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      (open as { root: Root | null }).root = hydrateRoot(page.container, build(), {
        onRecoverableError: page.recoverable,
      });
      act_();
      await waitFor(settled);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      environment.IS_REACT_ACT_ENVIRONMENT = before;
    }
  }

  const screenTree = () => (
    <WorkingContextProvider snapshot={TWO} messages={messages}>
      <main>
        <WorkingBranchField messages={messages} />
      </main>
      <Probe />
    </WorkingContextProvider>
  );

  const bothTree = () => (
    <WorkingContextProvider snapshot={TWO} messages={messages}>
      <header>
        <WorkingContextControl messages={messages} />
      </header>
      <main>
        <WorkingBranchField messages={messages} />
      </main>
      <Probe />
    </WorkingContextProvider>
  );

  it.each(['reload', 'back_forward'] as const)(
    'reached by %s, the header chosen as a browser does (input, then change): the choice is kept',
    async (arrival) => {
      arriveBy(arrival);
      window.localStorage.setItem(KEY, ALL_BRANCHES);
      const page = serverPage();
      await hydrateThenChoose(
        page,
        tree,
        () => chooseAsABrowser(TEST_BRANCH.id, SELECT),
        () => expect(page.selection()).toBe(TEST_BRANCH.id)
      );
      expect(page.recoverable).not.toHaveBeenCalled();
      expect(page.select().value).toBe(TEST_BRANCH.id);
      expect(window.localStorage.getItem(KEY)).toBe(TEST_BRANCH.id);
      expect(page.version()).toBe('1');
      expect(seen).toEqual(['0:', `1:${TEST_BRANCH.id}`]);
    }
  );

  it.each(['reload', 'back_forward'] as const)(
    'reached by %s, the chooser chosen as a browser does (input, then change): the choice is kept',
    async (arrival) => {
      arriveBy(arrival);
      window.localStorage.setItem(KEY, ALL_BRANCHES);
      const page = serverPage(screenTree, CHOOSER);
      await hydrateThenChoose(
        page,
        screenTree,
        () => chooseAsABrowser(TEST_BRANCH.id, CHOOSER),
        () => expect(page.selection()).toBe(TEST_BRANCH.id)
      );
      expect(page.recoverable).not.toHaveBeenCalled();
      expect(window.localStorage.getItem(KEY)).toBe(TEST_BRANCH.id);
      expect(page.version()).toBe('1');
      expect(seen).toEqual(['0:', `1:${TEST_BRANCH.id}`]);
      expect(page.select()).toBeNull();
    }
  );

  it('the header left as it was drawn, a branch chosen in the chooser: only the chooser chose', async () => {
    arriveBy('reload');
    window.localStorage.setItem(KEY, ALL_BRANCHES);
    const page = serverPage(bothTree, SELECT);
    // The header holds what it was drawn with: nothing in it to adopt.
    expect(page.select().value).toBe('');
    // A person picks a branch in the chooser, and that makes React hydrate.
    await hydrateThenChoose(
      page,
      bothTree,
      () => chooseAsABrowser(TEST_BRANCH.id, CHOOSER),
      () => expect(page.selection()).toBe(TEST_BRANCH.id)
    );
    expect(page.recoverable).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(KEY)).toBe(TEST_BRANCH.id);
    expect(page.selection()).toBe(TEST_BRANCH.id);
    // The header now shows the branch in force.
    expect(page.select().value).toBe(TEST_BRANCH.id);
    // One selection came into force, once: the header's untouched ask was not one.
    expect(seen).toEqual(['0:', `1:${TEST_BRANCH.id}`]);
  });

  /*
   * Both selects hold a different early branch when React hydrates. Each is
   * the operator's, and the order they were chosen in cannot be read. The
   * result is pinned so that a change to it is seen: each select adopts its
   * own branch in the commit that hydrates it, the header first (it comes
   * first in the tree) and then the chooser, so the chooser's branch is the
   * one in force — two writes of the remembered selection, the version moved
   * twice.
   */
  it('reached by reload, the header and the chooser both hold a branch: both adopted, the chooser last', async () => {
    arriveBy('reload');
    window.localStorage.setItem(KEY, ALL_BRANCHES);
    const page = serverPage(bothTree, SELECT);
    chooseAsABrowser(OTHER_BRANCH.id, SELECT);
    chooseAsABrowser(TEST_BRANCH.id, CHOOSER);
    const writes: string[] = [];
    const original = Storage.prototype.setItem;
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      if (key === KEY) writes.push(value);
      original.call(this, key, value);
    });
    try {
      await page.hydrate();
    } finally {
      setItem.mockRestore();
    }
    expect(page.recoverable).not.toHaveBeenCalled();
    expect(writes).toEqual([OTHER_BRANCH.id, TEST_BRANCH.id]);
    expect(window.localStorage.getItem(KEY)).toBe(TEST_BRANCH.id);
    expect(page.selection()).toBe(TEST_BRANCH.id);
    expect(page.select().value).toBe(TEST_BRANCH.id);
    expect(page.version()).toBe('2');
    expect(seen).toEqual(['0:', `2:${TEST_BRANCH.id}`]);
  });
});

/**
 * The mark is checked by the hook, not assumed of its callers.
 *
 * A select drawn through `useEarlyChoice` WITHOUT `autocomplete="off"` may be
 * put back by the browser on a move through history (measured in Chromium
 * 151, experiment 2026-10-18), so for it the earlier rule stands: what it
 * holds is adopted on a fresh navigation only, and on any other arrival the
 * select is put back to the value it was drawn with. Both real callers are
 * marked, so these cases draw a bare select of their own.
 */
describe('a select without autocomplete="off" is adopted from on a fresh navigation only', () => {
  const PLAIN = '[data-testid="plain-select"]';
  const OFFERED: readonly string[] = [TEST_BRANCH.id, OTHER_BRANCH.id];

  function PlainSelect({
    mark,
    adopt,
  }: {
    readonly mark: string | null;
    readonly adopt: (chosen: string) => void;
  }) {
    const ref = useRef<HTMLSelectElement | null>(null);
    useEarlyChoice(ref, '', OFFERED, adopt);
    return (
      <select
        ref={ref}
        data-testid="plain-select"
        value=""
        onChange={() => undefined}
        autoComplete={mark ?? undefined}
      >
        <option value="">ask</option>
        {OFFERED.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
    );
  }

  function plainPage(mark: string | null) {
    const adopt = vi.fn<(chosen: string) => void>();
    const page = serverPage(() => <PlainSelect mark={mark} adopt={adopt} />, PLAIN);
    return { page, adopt };
  }

  it.each(['reload', 'back_forward', 'prerender', null] as const)(
    'unmarked, reached by %s, a branch held with no event: not adopted, and put back',
    async (arrival) => {
      arriveBy(arrival);
      const { page, adopt } = plainPage(null);
      expect(page.select()).not.toHaveAttribute('autocomplete');
      page.select().value = TEST_BRANCH.id;
      await page.hydrate();
      expect(page.recoverable).not.toHaveBeenCalled();
      expect(adopt).not.toHaveBeenCalled();
      expect(page.select().value).toBe('');
    }
  );

  it('unmarked, reached by a fresh navigation: the held branch is adopted', async () => {
    arriveBy('navigate');
    const { page, adopt } = plainPage(null);
    page.select().value = TEST_BRANCH.id;
    await page.hydrate();
    expect(adopt).toHaveBeenCalledTimes(1);
    expect(adopt).toHaveBeenCalledWith(TEST_BRANCH.id);
  });

  it.each([
    ['reload', 'off'],
    ['back_forward', 'off'],
    ['prerender', 'off'],
    [null, 'off'],
    ['reload', 'OFF'],
    ['reload', ' off '],
    ['back_forward', ' off '],
  ] as const)(
    'marked, reached by %s (autocomplete="%s"): the held branch is adopted',
    async (arrival, mark) => {
      arriveBy(arrival);
      const { page, adopt } = plainPage(mark);
      page.select().value = TEST_BRANCH.id;
      await page.hydrate();
      expect(adopt).toHaveBeenCalledTimes(1);
      expect(adopt).toHaveBeenCalledWith(TEST_BRANCH.id);
    }
  );

  /*
   * An `autocomplete` that is present but is not "off" is not the mark: such a
   * select may be put back (it was not measured), so it follows the
   * fresh-navigation-only rule.
   */
  it.each([
    ['nope', 'reload'],
    ['nope', 'back_forward'],
    ['new-password', 'reload'],
    ['new-password', 'back_forward'],
    ['on', 'reload'],
    ['on', 'back_forward'],
  ] as const)(
    'autocomplete="%s", reached by %s: not adopted, and put back',
    async (mark, arrival) => {
      arriveBy(arrival);
      const { page, adopt } = plainPage(mark);
      expect(page.select()).toHaveAttribute('autocomplete', mark);
      page.select().value = TEST_BRANCH.id;
      await page.hydrate();
      expect(page.recoverable).not.toHaveBeenCalled();
      expect(adopt).not.toHaveBeenCalled();
      expect(page.select().value).toBe('');
    }
  );

  it.each(['nope', 'new-password', 'on'] as const)(
    'autocomplete="%s", reached by a fresh navigation: the held branch is adopted',
    async (mark) => {
      arriveBy('navigate');
      const { page, adopt } = plainPage(mark);
      page.select().value = TEST_BRANCH.id;
      await page.hydrate();
      expect(adopt).toHaveBeenCalledTimes(1);
      expect(adopt).toHaveBeenCalledWith(TEST_BRANCH.id);
    }
  );
});
