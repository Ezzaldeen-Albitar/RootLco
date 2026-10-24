'use client';

import { useEffect, useState } from 'react';
import type { FormSelectOption } from '@/components/forms/mui/FormSelectField';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import type { BranchTarget, ReadFailureStatus, ReadState } from '@/lib/api/read-operation';
import { technicianName } from './components/roster-parts';
import { listTechnicians } from './roster-api';
import type { TechnicianRosterEntry, TechnicianRosterPage } from './roster-types';

/**
 * Choosing a technician from a branch's roster (`P1-32-PRE-OD-TECH1`).
 *
 * Job assignment and rework sign-off both name a technician PROFILE. Until this
 * slice each took the profile's reference typed by hand; both now offer the
 * branch's roster as a choice, read through `tech.technician-list`.
 *
 * ## Why the walk is three pages of a hundred
 *
 * A hundred is the most one page of that route may ask for. Three pages is the
 * budget because `tech.technician-list` sits on the `expensive-read` rate-limit
 * policy — thirty requests a minute per operation, tenant and user — and the
 * roster screen spends from the same allowance. A larger walk would let one
 * opened job eat the minute's budget for every other roster read the person
 * makes. A branch with more than three hundred technicians is told so, and the
 * reference is typed instead (`truncated` below): a partial list with no way to
 * reach the rest would hide the very person being looked for.
 *
 * ## The client decides nothing
 *
 * Every profile the read returns is offered, inactive ones included and marked,
 * in the server's order. Whether the person qualifies for the job, is active, or
 * is independent of the rework is the platform's to refuse, and a refusal lands
 * on the field that holds the choice.
 */

/** The largest page `tech.technician-list` accepts. */
const ROSTER_PAGE_SIZE = 100;

/** How many pages one walk may spend; see the docblock for why it is small. */
const ROSTER_PAGE_BUDGET = 3;

/** One walk of the roster: the profiles in the server's order, or why there are none. */
export type BranchRosterRead =
  | {
      readonly status: 'ok';
      readonly items: readonly TechnicianRosterEntry[];
      /** The walk stopped before the server said there was no more. */
      readonly truncated: boolean;
    }
  | { readonly status: ReadFailureStatus };

/**
 * Every page of one branch's roster, up to the budget.
 *
 * Starts with no cursor and follows `nextCursor` while `hasMore` holds. It stops
 * — and says `truncated` rather than pretending the list is whole — when a
 * cursor repeats or the budget is spent. A failed page fails the whole read,
 * and a page that throws is `unavailable`, the way the roster screen reads it.
 * `isCurrent` lets the caller abandon a walk it no longer wants; an abandoned
 * walk answers `null`.
 */
export async function readBranchRoster(
  target: BranchTarget,
  isCurrent: () => boolean = () => true
): Promise<BranchRosterRead | null> {
  const items: TechnicianRosterEntry[] = [];
  const ids = new Set<string>();
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let pages = 1; ; pages += 1) {
    let state: ReadState<TechnicianRosterPage>;
    try {
      state = await listTechnicians(target, {
        isActive: null,
        cursor,
        limit: ROSTER_PAGE_SIZE,
      });
    } catch {
      state = { status: 'unavailable', correlationId: null };
    }
    if (!isCurrent()) return null;
    if (state.status !== 'ok') return { status: state.status };
    // A profile a later page repeats is offered once: an option is one id.
    for (const entry of state.data.items) {
      if (ids.has(entry.id)) continue;
      ids.add(entry.id);
      items.push(entry);
    }
    const next = state.data.nextCursor;
    if (!state.data.hasMore || next === null) return { status: 'ok', items, truncated: false };
    if (seen.has(next) || pages >= ROSTER_PAGE_BUDGET) {
      return { status: 'ok', items, truncated: true };
    }
    seen.add(next);
    cursor = next;
  }
}

/**
 * Where a picker stands.
 *
 * - `off` — nothing is asked: the permission is not held, the branch is not
 *   known, or the form that would use it is not on screen;
 * - `loading` — the walk is out;
 * - `listed` — the whole roster arrived and has someone on it;
 * - `truncated` — the roster is longer than the budget;
 * - `empty` — the roster lists nobody;
 * - `failed` — the read was refused or did not answer, in a sentence.
 *
 * Everything except `listed` and `loading` keeps the typed field, so every
 * write path that worked before the picker still works.
 */
export type BranchRoster =
  | { readonly phase: 'off' }
  | { readonly phase: 'loading' }
  | { readonly phase: 'listed'; readonly items: readonly TechnicianRosterEntry[] }
  | { readonly phase: 'truncated' }
  | { readonly phase: 'empty' }
  | { readonly phase: 'failed'; readonly messageKey: string };

const OFF: BranchRoster = { phase: 'off' };
const LOADING: BranchRoster = { phase: 'loading' };
const TRUNCATED: BranchRoster = { phase: 'truncated' };
const EMPTY: BranchRoster = { phase: 'empty' };

/**
 * The sentence for a failed read. The catalogue has no `not-found` title, and a
 * list cannot be "not found", so that answer is said as a fault.
 */
function failureKey(status: ReadFailureStatus): string {
  return status === 'not-found' ? 'state.error.title' : `state.${status}.title`;
}

/**
 * One branch's roster for a screen, read once.
 *
 * The outcome is TAGGED with the branch it answers, as the delivery panel's
 * staff picker does, so a result for another branch is never shown under this
 * one. The effect is keyed on the two strings, never on a record object, so a
 * re-read of the record after a write does not read the roster again; a held
 * answer for the same branch is not asked for twice either, so turning the
 * picker off and on again costs nothing. The phase is derived last and in a
 * fixed order: whether to ask, then arrival, then failure, then length.
 */
export function useBranchRoster(
  enabled: boolean,
  companyId: string | null,
  branchId: string | null
): BranchRoster {
  const [held, setHeld] = useState<{
    readonly key: string;
    readonly read: BranchRosterRead;
  } | null>(null);
  const key = companyId === null || branchId === null ? null : `${companyId}|${branchId}`;
  const answered = held !== null && held.key === key;

  useEffect(() => {
    if (!enabled || companyId === null || branchId === null || answered) return;
    const asked = `${companyId}|${branchId}`;
    let live = true;
    void readBranchRoster({ companyId, branchId }, () => live).then((read) => {
      if (!live || read === null) return;
      setHeld({ key: asked, read });
    });
    return () => {
      live = false;
    };
  }, [enabled, companyId, branchId, answered]);

  if (!enabled || key === null) return OFF;
  if (held === null || held.key !== key) return LOADING;
  const read = held.read;
  if (read.status !== 'ok') return { phase: 'failed', messageKey: failureKey(read.status) };
  if (read.truncated) return TRUNCATED;
  if (read.items.length === 0) return EMPTY;
  return { phase: 'listed', items: read.items };
}

/**
 * The roster as options: the profile id is the value, and the label is the
 * person's name (or why it is not shown), then the trade, the employment
 * reference and "Inactive", each only when it applies.
 *
 * The employment reference is there so two people with one name can be told
 * apart; it is an opaque reference the roster screen already shows. When two
 * labels still match — names withheld, no trade, no reference — each carries its
 * profile id as well, so no two options read alike. The server's order is kept.
 */
export function rosterOptions(
  messages: Messages,
  items: readonly TechnicianRosterEntry[]
): readonly FormSelectOption[] {
  const labelled = items.map((entry) => {
    const parts = [technicianName(messages, entry)];
    if (entry.trade !== null && entry.trade.length > 0) parts.push(entry.trade);
    if (entry.employmentRef !== null && entry.employmentRef.length > 0) {
      parts.push(entry.employmentRef);
    }
    if (!entry.isActive) parts.push(translate(messages, 'technicians.roster.state.inactive'));
    return { entry, label: parts.join(' — ') };
  });
  const uses = new Map<string, number>();
  for (const { label } of labelled) uses.set(label, (uses.get(label) ?? 0) + 1);
  return labelled.map(({ entry, label }) => ({
    value: entry.id,
    label: (uses.get(label) ?? 0) > 1 ? `${label} — ${entry.id}` : label,
  }));
}
