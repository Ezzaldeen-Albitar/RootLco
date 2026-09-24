'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ConfirmDialog } from '@/components/overlays/Overlays';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { usePersistedPreference } from '@/lib/use-persisted-flag';
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

  const [pending, setPending] = useState<string | null>(null);

  // A Set, created once. The registry identity must be stable: every guard
  // registers against it in an effect keyed on that identity.
  const [guards] = useState<GuardRegistry>(() => new Set());

  const usable = preferenceKey.length > 0;

  const selection = useMemo<WorkingContextSelection | null>(
    () => deriveSelection(status, branches, usable ? stored : null),
    [status, branches, stored, usable]
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
    (next: string) => {
      if (usable) setStored(next);
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
    [usable, setStored, status, branches]
  );

  const select = useCallback(
    (next: string) => {
      const dirty = Array.from(guards).some((guard) => guard.dirty);
      if (dirty) {
        setPending(next);
        return;
      }
      apply(next);
    },
    [apply, guards]
  );

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
            const next = pending;
            setPending(null);
            if (next !== null) apply(next);
          }}
          title={translate(messages, 'workingContext.discard.title')}
          description={translate(messages, 'workingContext.discard.description')}
          confirmLabel={translate(messages, 'workingContext.discard.confirm')}
          messages={messages}
          destructive
        />
      </GuardRegistryValue.Provider>
    </WorkingContextValue.Provider>
  );
}
