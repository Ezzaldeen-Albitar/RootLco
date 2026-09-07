'use client';

import { useCallback, useEffect, useState } from 'react';

import { SelectField, TextField } from '@/components/forms/Field';
import type { BranchOption } from '@/features/services/services-contract';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';

import { listBranches, listItemCategories, listLocations } from '../api';
import type {
  ItemCategory,
  LocationType,
  ReservationState,
  StockLocation,
  StockTarget,
} from '../inventory-contract';

/**
 * Pieces the inventory screen shares (P1-30, `W4`).
 *
 * A branch is a pair of identifiers the backend re-authorizes as the target of
 * every stock read. The picker says which of six states it is in — not offered,
 * still reading, listed, listed but empty, or failed with or without a second
 * attempt worth making — because a read in flight is a WAIT, never a refusal,
 * and the two used to render identically. Quantities are decimal strings and
 * are rendered as such.
 */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PRIMARY_BUTTON =
  'rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover';
export const SECONDARY_BUTTON =
  'rounded-md border border-border bg-surface px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard';

/**
 * The branch list as one of six outcomes rather than three fields.
 *
 * The old shape (`items | null`, `refused`, `offered`) could not tell "the read
 * is in flight" from "the caller may not read branches" — `items` is `null` in
 * both — so the picker resolved the ambiguity toward the identifier fields and
 * a permitted operator met two free-text boxes on every first paint (P1-30
 * CC-15). It could not tell "no branch is listed" from "a branch is listed"
 * either, because `[]` is not `null`, and it flattened all five
 * `ReadFailureStatus` values into one sentence.
 *
 * A union rather than an added flag: a flag leaves `{ offered: true,
 * items: null, pending: false }` representable, and that combination IS the
 * defect.
 *
 * `retry` is `null` where a second attempt cannot help. That is not a taste:
 * `components/party/CustomerSelector.tsx` decided it for the identical problem
 * — re-issuing the same request on the same dead session fails identically, and
 * offering the button suggests otherwise — and a refusal is the same shape.
 */
export type Branches =
  /** No `org.branch.read`. Identifier fields are the DESIGN, not a fallback. */
  | { readonly phase: 'not-offered' }
  /** Permitted, and `org.branch-list` has not answered. The only phase with no field. */
  | { readonly phase: 'loading' }
  /** Answered with at least one row. */
  | { readonly phase: 'listed'; readonly items: readonly BranchOption[] }
  /** Answered with no row. Identifiers are still offered — the server re-authorizes the pair. */
  | { readonly phase: 'none' }
  /** Did not answer. `retry` is null for a refusal and for a dead session. */
  | {
      readonly phase: 'failed';
      readonly messageKey: string;
      readonly retry: (() => void) | null;
    };

const NOT_OFFERED: Branches = { phase: 'not-offered' };
const LOADING: Branches = { phase: 'loading' };
const NO_BRANCH: Branches = { phase: 'none' };

/**
 * Whether a pair can be named at all. ONLY `loading` says no: every other phase
 * mounts either the select or the two identifier fields.
 */
export function canNameBranch(branches: Branches): boolean {
  return branches.phase !== 'loading';
}

export function useBranches(canRead: boolean): Branches {
  const [items, setItems] = useState<readonly BranchOption[] | null>(null);
  const [failure, setFailure] = useState<{ key: string; retryable: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);

  // A retry is a NEW attempt, so both outcome fields are cleared first. Leaving
  // `failure` set would hold the picker in its failed state while the second
  // read is in flight and the operator would see nothing happen at all.
  const retry = useCallback(() => {
    setItems(null);
    setFailure(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!canRead) return;
    let live = true;
    void listBranches().then((state) => {
      if (!live) return;
      if (state.status === 'ok') {
        setItems(state.data.items);
        return;
      }
      // Three sentences, not one. `denied` keeps the wording this screen already
      // shipped. `expired` is a dead session: its own sentence and NO retry.
      // Everything else — 429, timeout, network, server, conflict — is a "not
      // right now", which is the only kind a second attempt can clear.
      if (state.status === 'denied') {
        setFailure({ key: 'inventory.common.branchesRefused', retryable: false });
      } else if (state.status === 'expired') {
        setFailure({ key: 'state.expired.title', retryable: false });
      } else {
        setFailure({ key: 'inventory.common.branchesUnavailable', retryable: true });
      }
    });
    return () => {
      live = false;
    };
  }, [canRead, attempt]);

  // Derived last and in this order: permission, then failure, then arrival, then
  // emptiness. Nothing outside this function can observe the raw fields, so no
  // caller can read `null` as "denied" again.
  if (!canRead) return NOT_OFFERED;
  if (failure !== null) {
    return { phase: 'failed', messageKey: failure.key, retry: failure.retryable ? retry : null };
  }
  if (items === null) return LOADING;
  if (items.length === 0) return NO_BRANCH;
  return { phase: 'listed', items };
}

export interface BranchPair {
  readonly companyId: string;
  readonly branchId: string;
}
export const EMPTY_PAIR: BranchPair = { companyId: '', branchId: '' };

/**
 * A branch as a list when it may be read — choosing one fills its company — and
 * as two identifier fields in every case where this screen has no list to
 * narrow to. A read in flight is a WAIT, not a refusal, and is the one phase
 * with no field to type into.
 */
export function BranchPairPicker({
  messages,
  branches,
  label,
  placeholder,
  value,
  onChange,
  errors,
}: {
  readonly messages: Messages;
  readonly branches: Branches;
  readonly label: string;
  readonly placeholder: string;
  readonly value: BranchPair;
  readonly onChange: (next: BranchPair) => void;
  readonly errors?: Readonly<Record<string, string | undefined>>;
}) {
  /*
   * DECLARED BEFORE EVERY RETURN. The branches below return early, and a hook
   * after one of them is a `react-hooks/rules-of-hooks` failure.
   *
   * What it closes: identifiers typed into the fallback fields survive in the
   * consumer's pair (the consumer owns it), the list then arrives, and the
   * select at `value.branchId` finds no matching option. React leaves the
   * control blank while the form still holds — and would still submit — the
   * typed pair. Clearing HERE, when a list has actually arrived that cannot
   * contain the pair, is the narrowest possible fix: it discards nothing on a
   * retry that fails, and it cannot fire in any other phase.
   */
  const listedItems = branches.phase === 'listed' ? branches.items : null;
  const stale =
    listedItems !== null &&
    value.branchId !== '' &&
    !listedItems.some((branch) => branch.id === value.branchId);
  useEffect(() => {
    if (stale) onChange({ ...EMPTY_PAIR });
  }, [stale, onChange]);

  if (branches.phase === 'loading') {
    /*
     * Deliberately NOT a disabled SelectField. `FieldFrame` binds its label to a
     * control with `htmlFor` and there is no control here yet; worse, a disabled
     * combo box satisfies every suite's `findByRole('combobox')` before its
     * options exist, so a `chooseBranch` helper would resolve and the following
     * `selectOptions` would throw. A heading and a polite status line say the
     * same thing and are honest about there being no control. `role="status"`
     * appears in NO other phase of this picker, which is what keeps the
     * screen-wide status assertions of the sibling suites untouched.
     *
     * `components/states/States.tsx` already ships a `LoadingState`, and it is
     * deliberately not used: it is page-sized (`px-6 py-6`, six skeleton rows)
     * and would blow out a grid cell holding one field.
     */
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-label font-medium text-text-primary">{label}</p>
        <p role="status" aria-live="polite" className="text-supporting text-text-muted">
          {translate(messages, 'inventory.common.branchesLoading')}
        </p>
      </div>
    );
  }

  if (branches.phase === 'listed') {
    const { items } = branches;
    return (
      <SelectField
        label={label}
        required
        value={stale ? '' : value.branchId}
        onChange={(event) => {
          const chosen = items.find((branch) => branch.id === event.target.value);
          onChange(
            chosen ? { companyId: chosen.companyId, branchId: chosen.id } : { ...EMPTY_PAIR }
          );
        }}
        options={items.map((branch) => ({
          value: branch.id,
          label: `${branch.branchCode} — ${branch.name}`,
        }))}
        placeholder={placeholder}
        error={errors?.['branchId']}
      />
    );
  }

  /*
   * `not-offered`, `none` and `failed`. All three take the pair as identifiers,
   * because in all three the operator may still be authorised for a branch this
   * screen cannot name — `org.branch-list` is tenant-scoped and lists what the
   * caller may REACH; nothing says reachability for listing equals reachability
   * for operating, and the server re-authorizes the pair on every read
   * regardless. An empty list is therefore a SENTENCE, never a blocked form.
   */
  const description =
    branches.phase === 'failed'
      ? translateDynamic(messages, branches.messageKey)
      : branches.phase === 'none'
        ? translate(messages, 'inventory.common.branchesNone')
        : translate(messages, 'inventory.common.identifierHelp');

  return (
    <>
      <TextField
        label={translate(messages, 'inventory.common.companyIdField')}
        description={description}
        required
        spellCheck={false}
        dir="ltr"
        value={value.companyId}
        onChange={(event) => onChange({ ...value, companyId: event.target.value })}
        error={errors?.['companyId']}
      />
      <TextField
        label={translate(messages, 'inventory.common.branchIdField')}
        required
        spellCheck={false}
        dir="ltr"
        value={value.branchId}
        onChange={(event) => onChange({ ...value, branchId: event.target.value })}
        error={errors?.['branchId']}
      />
      {branches.phase === 'failed' && branches.retry !== null ? (
        <div>
          {/*
            `type="button"`. Every caller renders this picker inside a <form> and
            a bare <button> there submits it.

            The pair is NOT cleared. A retry that fails again must not cost the
            operator what they typed; a retry that succeeds is handled by the
            reconciliation effect above, which clears only when a list has
            arrived that cannot contain the pair.
          */}
          <button type="button" onClick={branches.retry} className={SECONDARY_BUTTON}>
            {translate(messages, 'state.retry')}
          </button>
        </div>
      ) : null}
    </>
  );
}

/** A decimal quantity string, as the server stated it. */
export function Qty({ value }: { readonly value: string }) {
  return (
    <code className="font-mono" dir="ltr">
      {value}
    </code>
  );
}

export function ReservationStatusBadge({
  messages,
  status,
}: {
  readonly messages: Messages;
  readonly status: ReservationState;
}) {
  const label = translateDynamic(messages, `inventory.reservationStatus.${status}`);
  if (status === 'active') {
    return (
      <span className="rounded-md bg-primary px-2 py-0.5 text-caption font-medium text-on-primary">
        {label}
      </span>
    );
  }
  return (
    <span className="rounded-md border border-border px-2 py-0.5 text-caption text-text-secondary">
      {label}
    </span>
  );
}

export function LocationTypeLabel({
  messages,
  type,
}: {
  readonly messages: Messages;
  readonly type: LocationType;
}) {
  return <span>{translateDynamic(messages, `inventory.locationType.${type}`)}</span>;
}

/** A failed outcome beside the form that caused it, with its reference. */
export function OutcomeNote({
  messages,
  outcome,
}: {
  readonly messages: Messages;
  readonly outcome: ActionState | null;
}) {
  if (!outcome || outcome.status === 'idle' || outcome.status === 'success') return null;
  const key = outcome.messageKey ?? 'action.failed';
  return (
    <p role="alert" className="text-body text-error">
      {translateDynamic(messages, key)}
      {outcome.correlationId ? (
        <>
          {' '}
          <span className="text-caption text-text-muted">
            {translate(messages, 'state.correlationId')}{' '}
            <code className="font-mono" dir="ltr">
              {outcome.correlationId}
            </code>
          </span>
        </>
      ) : null}
    </p>
  );
}

/* ------------------------------------------------------------------ *
 * The locations of a branch, for the pickers (shared by W4 and W5)
 * ------------------------------------------------------------------ */

export interface Locations {
  readonly items: readonly StockLocation[] | null;
  readonly refused: string | null;
  readonly truncated: boolean;
}

export function useLocations(target: StockTarget | null): Locations {
  const [items, setItems] = useState<readonly StockLocation[] | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const companyId = target?.companyId ?? null;
  const branchId = target?.branchId ?? null;
  useEffect(() => {
    if (companyId === null || branchId === null) return;
    const target = { companyId, branchId };
    let live = true;
    void listLocations(target).then((state) => {
      if (!live) return;
      if (state.status === 'ok') {
        setItems(state.data.items);
        setTruncated(state.data.hasMore);
      } else {
        setRefused(
          state.status === 'denied'
            ? 'inventory.locations.refused'
            : 'inventory.locations.unavailable'
        );
      }
    });
    return () => {
      live = false;
    };
    // Keyed on the pair's VALUES, never the object: a caller that rebuilds its
    // target per render must not re-read the locations without end.
  }, [companyId, branchId]);
  return { items, refused, truncated };
}

export function LocationPicker({
  messages,
  locations,
  label,
  placeholder,
  value,
  onChange,
  required,
  error,
}: {
  readonly messages: Messages;
  readonly locations: Locations;
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly required?: boolean;
  readonly error?: string | undefined;
}) {
  const note = locations.refused
    ? translateDynamic(messages, locations.refused)
    : locations.truncated
      ? translate(messages, 'inventory.locations.truncated')
      : undefined;
  return (
    <SelectField
      label={label}
      {...(required ? { required: true } : {})}
      {...(note ? { description: note } : {})}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      options={(locations.items ?? []).map((location) => ({
        value: location.id,
        label: `${location.locationCode} — ${location.name}`,
      }))}
      placeholder={placeholder}
      error={error}
    />
  );
}

/* ------------------------------------------------------------------ *
 * The tenant's item categories (W10's list, W4's filter) — CC-16
 * ------------------------------------------------------------------ */

export interface Categories {
  readonly items: readonly ItemCategory[] | null;
  readonly refused: string | null;
  readonly truncated: boolean;
  readonly add: (category: ItemCategory) => void;
}

/**
 * `inv.item-category-list` — `inv.item.read`, tenant-scoped: the same code and
 * the same scope-blind evaluation as `inv.item-search`, so an operator who
 * reached a screen gated on `inv.item.read` cannot be DENIED this list. It can
 * still fail — an expired session, a rate limit, a 5xx — so the caller states
 * what it had to say beside a picker that offers nothing, rather than losing
 * the search the picker decorates.
 *
 * Moved here verbatim from `SetupScreen`: same two message keys, same
 * `truncated`, same `add`. A created category must keep appearing in the parent
 * picker, and nothing in the setup suite would notice if it stopped.
 */
export function useItemCategories(): Categories {
  const [items, setItems] = useState<readonly ItemCategory[] | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    let live = true;
    void listItemCategories().then((state) => {
      if (!live) return;
      if (state.status === 'ok') {
        setItems(state.data.items);
        setTruncated(state.data.hasMore);
      } else {
        setRefused(
          state.status === 'denied'
            ? 'inventory.setup.categories.refused'
            : 'inventory.setup.categories.unavailable'
        );
      }
    });
    return () => {
      live = false;
    };
  }, []);
  return {
    items,
    refused,
    truncated,
    add: (category) => setItems((current) => [...(current ?? []), category]),
  };
}

/**
 * A category as a list, `code — name`.
 *
 * An INACTIVE category is labelled as one. The list is unfiltered by status —
 * the adapter sends none — and filtering a search by an inactive category is
 * legitimate, so the row is offered rather than hidden; what is not acceptable
 * is offering it unmarked. The label vocabulary is the setup table's own.
 *
 * The description is additive: a refusal REPLACES the caller's help because
 * there is nothing left to explain, but truncation is stated ALONGSIDE it — the
 * tenant that has more than a page of categories is exactly the tenant that
 * still needs to be told where categories come from.
 */
export function CategoryPicker({
  messages,
  categories,
  label,
  placeholder,
  help,
  value,
  onChange,
  required,
  error,
}: {
  readonly messages: Messages;
  readonly categories: Categories;
  readonly label: string;
  readonly placeholder: string;
  /** What the field says when the read had nothing to add; the caller owns the wording. */
  readonly help?: string | undefined;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly required?: boolean;
  readonly error?: string | undefined;
}) {
  const truncated = categories.truncated
    ? translate(messages, 'inventory.setup.categories.truncated')
    : undefined;
  const note = categories.refused
    ? translateDynamic(messages, categories.refused)
    : [truncated, help].filter(Boolean).join(' ') || undefined;
  return (
    <SelectField
      label={label}
      {...(required ? { required: true } : {})}
      {...(note ? { description: note } : {})}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      options={(categories.items ?? []).map((category) => ({
        value: category.id,
        label:
          category.status === 'active'
            ? `${category.code} — ${category.name}`
            : `${category.code} — ${category.name} (${translate(
                messages,
                'inventory.setup.status.inactive'
              )})`,
      }))}
      placeholder={placeholder}
      error={error}
    />
  );
}
