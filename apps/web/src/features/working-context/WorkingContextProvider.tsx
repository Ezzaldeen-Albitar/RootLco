'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ConfirmDialog } from '@/components/overlays/Overlays';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate } from '@/i18n/get-messages';
import { readPreference, usePersistedPreference } from '@/lib/use-persisted-flag';
import {
  ALL_BRANCHES,
  preferenceKeyFor,
  type WorkingContextBranch,
  type WorkingContextCompany,
  type WorkingContextSnapshot,
  type WorkingContextStatus,
} from './working-context-contract';

/**
 * Where the operator is working, held once for the whole shell.
 *
 * ## The problem it replaces
 *
 * Every branch-addressed screen used to ask the same question again, in its own
 * words, with its own controls: a select over raw references when the session
 * resolved some, a free-text box when it resolved none. Five separate branch
 * hooks existed across inventory and pricing alone. An operator who works in
 * one branch answered the question on every screen; an operator with several
 * answered it differently on each, and nothing on the page said which branch
 * the rows belonged to.
 *
 * The question is asked ONCE here, answered in the header, and every screen
 * reads the answer.
 *
 * ## The rules, and why each one is a rule
 *
 *   - **One authorized branch is never asked about.** There is no choice to
 *     make, and a required control with one option is a chore, not a decision.
 *   - **A remembered choice is honoured only if it is still authorized.** The
 *     list the server just published is the authority. A branch that has been
 *     taken away is discarded and the stored preference is removed, rather than
 *     being sent and refused.
 *   - **No valid remembered choice means no selection at all**, and the header
 *     asks once. The alternative — quietly picking the first branch — writes
 *     records against a branch the operator never named.
 *   - **"All my branches" exists only where there is more than one**, and it is
 *     a reading posture. A screen that must write against one branch refuses it
 *     and says so rather than guessing.
 *   - **Every change increments `version` and aborts the outstanding
 *     `signal`.** A list that is mid-read when the branch changes must not
 *     commit the old rows under the new heading.
 *
 * ## Why a switch can be blocked
 *
 * Changing branch while a half-filled form is open would silently re-address
 * that form's write. Screens declare their unsaved work with `useUnsavedGuard`,
 * and a switch with any guard dirty asks first. Nothing is discarded without an
 * answer, and nothing is switched behind the operator's back.
 */

export type WorkingContextSelection =
  /** One branch, named. The only selection a write may be addressed to. */
  | { readonly companyId: string; readonly branchId: string; readonly allBranches: false }
  /**
   * Every branch the operator is authorized for. `companyId` is filled only
   * when the whole selection sits inside a single company; with branches in
   * more than one it names none, because there is no single answer.
   */
  | { readonly companyId: string | null; readonly branchId: null; readonly allBranches: true };

export interface WorkingContext {
  readonly status: WorkingContextStatus;
  readonly unrestricted: boolean;
  readonly companies: readonly WorkingContextCompany[];
  readonly branches: readonly WorkingContextBranch[];
  /** Null means "not chosen yet" — the header asks. */
  readonly selection: WorkingContextSelection | null;
  /** Increments on every change. Mount a list under it and stale rows cannot show. */
  readonly version: number;
  /** Aborted on every change. Pass it to a read so a superseded answer is dropped. */
  readonly signal: AbortSignal;
  /** `branchId`, or `'all'`. Blocked by a dirty guard until the operator answers. */
  readonly select: (next: string) => void;
  readonly companyOf: (branchId: string) => WorkingContextCompany | null;
  readonly branchName: (branchId: string) => string | null;
  /** True while the discard question is open. Exposed so a screen can wait. */
  readonly switchPending: boolean;
  /**
   * Whether a provider is above this component at all.
   *
   * `status` cannot answer it. A component outside the provider and a component
   * whose directory read failed both report `unavailable`, and the right
   * behaviour differs: the first is a surface that simply has no working
   * context — the Platform Owner Console, a component under test on its own —
   * and must go on rendering exactly as it did; the second is a workspace
   * screen that genuinely could not name its branches and should say so rather
   * than fall back to asking for a typed reference.
   */
  readonly present: boolean;
}

/** One screen's declaration that it holds unsaved work. */
interface DirtyGuard {
  readonly dirty: boolean;
}

type GuardRegistry = Set<DirtyGuard>;

const EMPTY_GUARDS: GuardRegistry = new Set();

/**
 * The default. A component rendered outside the provider — the Platform Owner
 * Console shell, or a component under test on its own — reports `unavailable`
 * rather than throwing, because "there is no working context here" is an
 * ordinary state for a surface that has none.
 */
const FALLBACK_CONTEXT: WorkingContext = {
  status: 'unavailable',
  unrestricted: false,
  companies: [],
  branches: [],
  selection: null,
  version: 0,
  signal: new AbortController().signal,
  select: () => undefined,
  companyOf: () => null,
  branchName: () => null,
  switchPending: false,
  present: false,
};

const WorkingContextValue = createContext<WorkingContext>(FALLBACK_CONTEXT);
const GuardRegistryValue = createContext<GuardRegistry>(EMPTY_GUARDS);

export function useWorkingContext(): WorkingContext {
  return useContext(WorkingContextValue);
}

/**
 * Declares that this screen holds work an operator would lose.
 *
 * Registered with the provider for as long as the component is mounted, so a
 * branch switch asks before it discards. Unregistered on unmount, which is what
 * stops a closed form blocking every later switch.
 */
export function useUnsavedGuard(isDirty: boolean): void {
  const registry = useContext(GuardRegistryValue);
  useEffect(() => {
    const entry: DirtyGuard = { dirty: isDirty };
    registry.add(entry);
    return () => {
      registry.delete(entry);
    };
  }, [registry, isDirty]);
}

/**
 * Runs `onChange` after every change of the working context, and never on the
 * first render.
 *
 * For state a screen seeds FROM the working branch and then holds itself — a
 * lookup's branch, a job found in the branch's list. Seeding once on mount
 * leaves that state naming the previous branch after a switch, so the screen
 * shows one branch in the header and asks about another. The callback is read
 * from the latest render, so it sees the selection the change produced.
 */
export function useWorkingContextChange(onChange: () => void): void {
  const { version } = useContext(WorkingContextValue);
  const seen = useRef(version);
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  useEffect(() => {
    if (seen.current === version) return;
    seen.current = version;
    latest.current();
  }, [version]);
}

interface Epoch {
  readonly version: number;
  readonly controller: AbortController;
  /** The effective selection this epoch was issued for — see `keyOf`. */
  readonly key: string;
}

/**
 * The selection a snapshot and a remembered choice produce. Pure, so the
 * provider and `apply` derive the same answer from the same inputs.
 */
function deriveSelection(
  status: WorkingContextStatus,
  branches: readonly WorkingContextBranch[],
  stored: string | null
): WorkingContextSelection | null {
  if (status !== 'ready') return null;
  // Exactly one: chosen for them, and never asked about.
  if (branches.length === 1) {
    const only = branches[0] as WorkingContextBranch;
    return { companyId: only.companyId, branchId: only.id, allBranches: false };
  }
  if (stored === null) return null;
  if (stored === ALL_BRANCHES) {
    const spans = new Set(branches.map((branch) => branch.companyId));
    return {
      companyId:
        spans.size === 1 ? ((branches[0] as WorkingContextBranch).companyId ?? null) : null,
      branchId: null,
      allBranches: true,
    };
  }
  const match = branches.find((branch) => branch.id === stored);
  // Remembered, then revoked. Discarded rather than sent — see the provider.
  if (match === undefined) return null;
  return { companyId: match.companyId, branchId: match.id, allBranches: false };
}

/** One string per effective selection: none, every branch, or one branch. */
function keyOf(selection: WorkingContextSelection | null): string {
  if (selection === null) return '';
  return selection.allBranches ? ALL_BRANCHES : selection.branchId;
}

export function WorkingContextProvider({
  snapshot,
  messages,
  children,
}: {
  readonly snapshot: WorkingContextSnapshot;
  readonly messages: Messages;
  readonly children: ReactNode;
}) {
  const { status, tenantId, accountId, unrestricted, companies, branches } = snapshot;

  /*
   * The key is `null` when there is nobody and nowhere to key it to. That is
   * not a fallback key — a shared machine must not hand one operator's
   * remembered branch to the next, so the absence of either half means nothing
   * is read and nothing is written.
   */
  const preferenceKey =
    tenantId !== null && accountId !== null ? preferenceKeyFor(tenantId, accountId) : '';
  const [stored, setStored] = usePersistedPreference(preferenceKey);

  /*
   * The switch waiting on the discard question. Wrapped, because "switch to no
   * branch at all" is a real answer when it is another tab's change being taken
   * (see `held`), and a bare `null` already means "nothing is waiting".
   */
  const [pending, setPending] = useState<{ readonly next: string | null } | null>(null);

  // A Set, created once. The registry identity must be stable: every guard
  // registers against it in an effect keyed on that identity.
  const [guards] = useState<GuardRegistry>(() => new Set());

  const usable = preferenceKey.length > 0;

  /*
   * ## A change from another tab does not re-address unsaved work either
   *
   * The header's select asks before it discards (`select`, below). Another tab
   * writing the remembered branch did not pass through `select` at all: the
   * storage notification re-read the preference, the selection moved, and every
   * picker holding a chosen record in a half-filled form cleared it without a
   * word (route sweep B3 review).
   *
   * So an outside write that would change this tab's branch while any screen
   * holds unsaved work is HELD: this tab keeps the value it was using, and a
   * notice offers the two answers — switch now (through the same guarded
   * question the header asks) or stay. With nothing unsaved it is applied at
   * once, exactly as before, so tabs still follow each other.
   *
   * `seenStored` is the stored value this tab last rendered with. `apply`
   * advances it together with its own write, so the only difference left for
   * the render below to find is a write this tab did not make.
   */
  const [seenStored, setSeenStored] = useState<string | null>(stored);
  const [held, setHeld] = useState<{ readonly value: string | null } | null>(null);
  /** The outside value the operator chose to stay against — asked about once. */
  const [declined, setDeclined] = useState<{ readonly value: string | null } | null>(null);

  let heldNow = held;
  if (stored !== seenStored) {
    setSeenStored(stored);
    const anyDirty = Array.from(guards).some((guard) => guard.dirty);
    if (heldNow === null) {
      const before = keyOf(deriveSelection(status, branches, usable ? seenStored : null));
      const after = keyOf(deriveSelection(status, branches, usable ? stored : null));
      if (anyDirty && before !== after) heldNow = { value: seenStored };
    } else if (stored === heldNow.value || !anyDirty) {
      // The other tab came back to this one's branch, or the work was saved
      // since: nothing is at stake any more, so the tabs agree again.
      heldNow = null;
    }
    if (heldNow !== held) {
      setHeld(heldNow);
      setDeclined(null);
    }
  }
  const effectiveStored = heldNow !== null ? heldNow.value : stored;

  const selection = useMemo<WorkingContextSelection | null>(
    () => deriveSelection(status, branches, usable ? effectiveStored : null),
    [status, branches, effectiveStored, usable]
  );
  const selectionKey = keyOf(selection);

  /*
   * The version and the controller move TOGETHER, as one value.
   *
   * They were two pieces of state, and that is a bug waiting to happen: a
   * reader that saw the new version with the old signal, or the reverse, would
   * either drop a live read or commit a superseded one. One object means there
   * is no intermediate state in which they disagree.
   *
   * It is state rather than a ref because the signal is READ during render —
   * every consumer takes it off the context value — and a ref read during
   * render is not guaranteed to be the value the render is about.
   *
   * `key` is the effective selection the epoch was issued for. See below.
   */
  const [epoch, setEpoch] = useState<Epoch>(() => ({
    version: 0,
    controller: new AbortController(),
    key: selectionKey,
  }));

  /*
   * EVERY change of the effective selection moves the epoch, whoever made it.
   *
   * The header's own select goes through `apply`, which moves it at once. Two
   * other paths change the selection without passing through `apply`: another
   * tab writing the preference (the storage notification re-reads it), and a
   * reload whose remembered branch arrives after hydration, when the server
   * snapshot (nothing chosen) gives way to the stored one. Both used to change
   * the selection with the version and the signal untouched, so a screen that
   * seeds state from the branch through `useWorkingContextChange` kept naming
   * the previous branch, and a read in flight was never aborted.
   *
   * The adjustment is made DURING render — React's pattern for state that
   * follows a value — so no child ever renders the new selection under the old
   * version. The updater is pure; the retired controller is aborted after the
   * commit, below.
   */
  if (epoch.key !== selectionKey) {
    setEpoch((previous) =>
      previous.key === selectionKey
        ? previous
        : { version: previous.version + 1, controller: new AbortController(), key: selectionKey }
    );
  }

  /*
   * The controller a render-time adjustment retired is aborted once the new
   * epoch commits. `apply` aborts its own synchronously, and a second `abort()`
   * on the same controller does nothing. Tracked by a ref rather than by an
   * effect cleanup, so a Strict Mode re-run cannot abort the controller in use.
   */
  const retired = useRef(epoch.controller);
  useEffect(() => {
    if (retired.current === epoch.controller) return;
    retired.current.abort();
    retired.current = epoch.controller;
  }, [epoch.controller]);

  /*
   * A stored choice the server no longer publishes is REMOVED, not merely
   * ignored.
   *
   * Leaving it would make the prompt reappear on every page load for ever,
   * because the derivation above would keep rejecting the same value. Only a
   * `ready` snapshot clears it: `unavailable` means the directory could not be
   * read, and deleting a good preference because of a brief outage would lose
   * the operator's choice for a reason that has nothing to do with them.
   */
  useEffect(() => {
    if (!usable || status !== 'ready' || stored === null) return;
    if (stored === ALL_BRANCHES) {
      if (branches.length > 1) return;
    } else if (branches.some((branch) => branch.id === stored)) {
      return;
    }
    setStored(null);
  }, [usable, status, stored, branches, setStored]);

  const apply = useCallback(
    (next: string | null) => {
      // This tab's own write, marked as seen in the same batch as it lands so
      // it is never mistaken for another tab's, and whatever was held is
      // answered by it. What is marked is what storage now holds — a blocked
      // store keeps the old value, and that is not an outside change either.
      setHeld(null);
      setDeclined(null);
      if (usable) {
        setStored(next);
        setSeenStored(readPreference(preferenceKey));
      }
      /*
       * FUNCTIONAL, and the abort happens INSIDE the update.
       *
       * Reading `epoch` from the closure looked equivalent and was not. Two
       * calls in one tick — a cross-tab storage event landing while the
       * operator uses the select, or two guards resolving together — both saw
       * the same `epoch`, so both computed the same next version and both
       * aborted the same controller: one increment was lost, and the
       * controller created by the losing call was handed to nobody while the
       * one it replaced was never aborted. A superseded read then had a live
       * signal and a version that had not moved.
       *
       * Taking `previous` from React guarantees each call sees the result of
       * the one before it, so every change increments exactly once and every
       * controller it retires is the one actually in use.
       *
       * The updater is not pure, which is deliberate and is the narrow case
       * where it is safe: `abort()` on an already-aborted controller does
       * nothing, so a Strict Mode double invocation retires the same controller
       * twice with no second effect. The spare controller the discarded call
       * creates is never handed out.
       */
      /*
       * The epoch is issued for the selection `next` produces, so the
       * render-time adjustment above finds nothing left to do and a switch
       * made here moves the version exactly once.
       */
      const nextKey = keyOf(deriveSelection(status, branches, usable ? next : null));
      setEpoch((previous) => {
        previous.controller.abort();
        return { version: previous.version + 1, controller: new AbortController(), key: nextKey };
      });
    },
    [usable, setStored, preferenceKey, status, branches]
  );

  /** The one guarded path: every switch this tab makes, whoever proposed it. */
  const requestSwitch = useCallback(
    (next: string | null) => {
      const dirty = Array.from(guards).some((guard) => guard.dirty);
      if (dirty) {
        setPending({ next });
        return;
      }
      apply(next);
    },
    [apply, guards]
  );

  const select = useCallback((next: string) => requestSwitch(next), [requestSwitch]);

  /*
   * The notice for a held change: shown while another tab's value differs from
   * the one this tab stayed on, until the operator answers it. "Stay" is an
   * answer for THAT value; a later, different change from the other tab asks
   * again.
   */
  const outside =
    heldNow !== null &&
    stored !== heldNow.value &&
    !(declined !== null && declined.value === stored)
      ? { value: stored }
      : null;

  const value = useMemo<WorkingContext>(() => {
    return {
      status,
      unrestricted,
      companies,
      branches,
      selection,
      version: epoch.version,
      signal: epoch.controller.signal,
      select,
      companyOf: (branchId) => {
        const branch = branches.find((entry) => entry.id === branchId);
        if (branch === undefined) return null;
        return companies.find((entry) => entry.id === branch.companyId) ?? null;
      },
      branchName: (branchId) => branches.find((entry) => entry.id === branchId)?.name ?? null,
      switchPending: pending !== null,
      present: true,
    };
  }, [status, unrestricted, companies, branches, selection, epoch, select, pending]);

  return (
    <WorkingContextValue.Provider value={value}>
      <GuardRegistryValue.Provider value={guards}>
        {children}
        <ConfirmDialog
          open={pending !== null}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const waiting = pending;
            setPending(null);
            if (waiting !== null) apply(waiting.next);
          }}
          title={translate(messages, 'workingContext.discard.title')}
          description={translate(messages, 'workingContext.discard.description')}
          confirmLabel={translate(messages, 'workingContext.discard.confirm')}
          messages={messages}
          destructive
        />
        <CrossTabNotice
          messages={messages}
          current={labelFor(selection, branches, messages)}
          incoming={
            outside === null
              ? null
              : labelFor(
                  deriveSelection(status, branches, usable ? outside.value : null),
                  branches,
                  messages
                )
          }
          open={outside !== null}
          onSwitch={() => {
            if (outside !== null) requestSwitch(outside.value);
          }}
          onStay={() => {
            if (outside !== null) setDeclined({ value: outside.value });
          }}
        />
      </GuardRegistryValue.Provider>
    </WorkingContextValue.Provider>
  );
}

/** What a person calls a selection: a branch's name, every branch, or nothing. */
function labelFor(
  selection: WorkingContextSelection | null,
  branches: readonly WorkingContextBranch[],
  messages: Messages
): string | null {
  if (selection === null) return null;
  if (selection.allBranches) return translate(messages, 'workingContext.allBranches');
  return branches.find((branch) => branch.id === selection.branchId)?.name ?? null;
}

/**
 * Says that another tab changed the working branch, and asks what this one
 * should do, while a screen here holds unsaved work.
 *
 * Not a dialog: nothing is lost by leaving it open, and this tab keeps working
 * on the branch it was on. The polite live region around it is rendered
 * whether or not there is anything to say, because a region born with its
 * content is not announced; it carries no role of its own, so an empty one is
 * not a second status on every page. The notice inside it is the status.
 * "Switch now" goes through the same discard question the header asks, so the
 * answer that loses work is still given on purpose.
 */
function CrossTabNotice({
  messages,
  current,
  incoming,
  open,
  onSwitch,
  onStay,
}: {
  readonly messages: Messages;
  readonly current: string | null;
  readonly incoming: string | null;
  readonly open: boolean;
  readonly onSwitch: () => void;
  readonly onStay: () => void;
}) {
  const titleId = useId();
  return (
    <div
      aria-live="polite"
      data-testid="working-context-cross-tab-live"
      className="pointer-events-none fixed bottom-4 end-4 z-toast flex max-w-[calc(100vw-2rem)] flex-col items-end"
    >
      {open ? (
        <div
          role="status"
          aria-labelledby={titleId}
          data-testid="working-context-cross-tab"
          className="pointer-events-auto flex w-full max-w-md flex-col gap-3 break-words rounded-md border border-border bg-surface p-3 shadow-md"
        >
          <div className="flex flex-col gap-1">
            <p id={titleId} className="text-body font-medium text-text-primary">
              {translate(messages, 'workingContext.crossTab.title')}
            </p>
            {incoming !== null ? (
              <p className="text-supporting text-text-secondary">
                {formatMessage(translate(messages, 'workingContext.crossTab.description'), {
                  branch: incoming,
                })}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={onStay}
              className="rounded-md border border-border bg-surface px-4 py-2 text-button text-text-secondary hover:bg-surface-subtle"
            >
              {current !== null
                ? formatMessage(translate(messages, 'workingContext.crossTab.stay'), {
                    branch: current,
                  })
                : translate(messages, 'workingContext.crossTab.stayHere')}
            </button>
            <button
              type="button"
              onClick={onSwitch}
              className="rounded-md bg-primary px-4 py-2 text-button font-medium text-text-inverse transition-colors duration-fast ease-standard hover:bg-primary-hover"
            >
              {translate(messages, 'workingContext.crossTab.switch')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
