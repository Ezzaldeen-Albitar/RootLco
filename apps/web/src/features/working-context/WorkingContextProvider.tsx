'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
   */
  const [epoch, setEpoch] = useState<{
    readonly version: number;
    readonly controller: AbortController;
  }>(() => ({ version: 0, controller: new AbortController() }));
  const [pending, setPending] = useState<string | null>(null);

  // A Set, created once. The registry identity must be stable: every guard
  // registers against it in an effect keyed on that identity.
  const [guards] = useState<GuardRegistry>(() => new Set());

  const usable = preferenceKey.length > 0;

  const selection = useMemo<WorkingContextSelection | null>(() => {
    if (status !== 'ready') return null;
    // Exactly one: chosen for them, and never asked about.
    if (branches.length === 1) {
      const only = branches[0] as WorkingContextBranch;
      return { companyId: only.companyId, branchId: only.id, allBranches: false };
    }
    if (!usable || stored === null) return null;
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
    // Remembered, then revoked. Discarded rather than sent — see the effect below.
    if (match === undefined) return null;
    return { companyId: match.companyId, branchId: match.id, allBranches: false };
  }, [status, branches, stored, usable]);

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
      // The outstanding reads are superseded the moment the branch changes.
      epoch.controller.abort();
      setEpoch({ version: epoch.version + 1, controller: new AbortController() });
    },
    [usable, setStored, epoch]
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
