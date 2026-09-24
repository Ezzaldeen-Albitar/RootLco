'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { SelectField, TextField } from '@/components/forms/Field';
import { listServices } from '@/features/services/api';
import type { BranchOption, ServiceSummary } from '@/features/services/services-contract';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';

import { listBranches } from '../api';
import type { ActivationState, PriceListVersionState } from '../pricing-contract';

/**
 * Pieces the two pricing screens share (P1-30, `W2`).
 *
 * Nothing here touches money. A branch is a pair of identifiers the backend
 * re-authorizes; a service is an identifier the backend resolves. The branch
 * picker says which of six states it is in — not offered, still reading,
 * listed, listed but empty, or failed with or without a second attempt worth
 * making — because a refused list must never render as "there are none" and a
 * read in flight must never render as a refusal.
 */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PRIMARY_BUTTON =
  'rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover';
export const SECONDARY_BUTTON =
  'rounded-md border border-border bg-surface px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard';

/* ------------------------------------------------------------------ *
 * Branches
 * ------------------------------------------------------------------ */

/**
 * The branch list as one of six outcomes rather than three fields.
 *
 * The old shape (`items | null`, `refused`, `offered`) could not tell "the read
 * is in flight" from "the caller may not read branches" — `items` is `null` in
 * both — so the picker resolved the ambiguity toward the identifier fields and
 * a permitted operator met two free-text boxes on every first paint (P1-30
 * CC-15, the same defect in this copy of the picker). `[]` is not `null`
 * either, so an empty list rendered a select holding only its placeholder.
 *
 * A union rather than an added flag: a flag leaves `{ offered: true,
 * items: null, pending: false }` representable, and that combination IS the
 * defect.
 *
 * `retry` is `null` where a second attempt cannot help — a refusal and a dead
 * session both fail identically the second time, and offering the button
 * suggests otherwise (`components/party/CustomerSelector.tsx`).
 */
export type Branches =
  /** No `org.branch.read`, and no working context to fall back on. */
  | { readonly phase: 'not-offered' }
  /** Permitted, and `org.branch-list` has not answered. */
  | { readonly phase: 'loading' }
  /** Answered with at least one row. The only phase in which a pair can be named. */
  | { readonly phase: 'listed'; readonly items: readonly BranchOption[] }
  /** Answered with no row. There is nothing to choose, and the screen says so. */
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
 * Whether a pair can be named at all.
 *
 * Only `listed` says yes now. It used to be "anything but `loading`", because
 * every other phase mounted two boxes to type a reference into; with those gone
 * there is nothing to submit unless a branch can be chosen, and a submit left
 * enabled over an absent control is a button whose only outcome is a refusal.
 */
export function canNameBranch(branches: Branches): boolean {
  return branches.phase === 'listed';
}

/**
 * The working context, mapped onto the shape this picker already speaks.
 *
 * The layout reads `GET /auth/working-context` ONCE per request and publishes
 * the named, active branches this operator is authorized for. Where that answer
 * exists there is nothing for a second read of `org.branch-list` to add: it is
 * the same operator, the same workspace, the same moment — and issuing it
 * anyway is one request per screen for a fact the shell already holds, which is
 * what five separate branch hooks across inventory and pricing were each doing.
 *
 * `countryCode` is the one field the working context does not publish. It is
 * `null` rather than invented; nothing in these pickers reads it.
 */
function branchesFromContext(
  context: ReturnType<typeof useWorkingContext>
): readonly BranchOption[] | null {
  if (context.status !== 'ready' || context.branches.length === 0) return null;
  return context.branches.map((branch) => ({
    id: branch.id,
    companyId: branch.companyId,
    branchCode: branch.code,
    name: branch.name,
    city: branch.city,
    countryCode: null,
    timezoneName: branch.timezone,
    status: branch.status,
  }));
}

export function useBranches(canRead: boolean): Branches {
  const context = useWorkingContext();
  const fromContext = branchesFromContext(context);
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
    // Not read at all when the shell already holds the answer. This is the
    // request that stopped being made once per screen.
    if (!canRead || fromContext !== null) return;
    let live = true;
    void listBranches().then((state) => {
      if (!live) return;
      if (state.status === 'ok') {
        setItems(state.data.items);
        return;
      }
      // Three sentences, not one. `denied` keeps the wording this screen already
      // shipped; `expired` is a dead session and gets no retry; everything else
      // is a "not right now", the only kind a second attempt can clear.
      if (state.status === 'denied') {
        setFailure({ key: 'pricing.common.branchesRefused', retryable: false });
      } else if (state.status === 'expired') {
        setFailure({ key: 'state.expired.message', retryable: false });
      } else {
        setFailure({ key: 'pricing.common.branchesUnavailable', retryable: true });
      }
    });
    return () => {
      live = false;
    };
  }, [canRead, attempt, fromContext]);

  /*
   * Derived last and in this order: the working context, then permission, then
   * failure, then arrival, then emptiness. Nothing outside this function can
   * observe the raw fields.
   *
   * The context comes FIRST. It used to be tested after the permission, so an
   * operator without `org.branch.read` was reported as `not-offered` even
   * though the shell was holding their named branches — and with the identifier
   * boxes gone that would leave a price with nothing to be resolved for. The
   * directory read is an optimisation on top of the context, never the
   * authority over it: `GET /auth/working-context` publishes what this caller
   * may act in, and the server re-authorizes the pair on every request either
   * way. It is also tested before the failure branch, so a screen mounted during
   * an `org.branch-list` hiccup still lists names.
   */
  if (fromContext !== null) return { phase: 'listed', items: fromContext };
  if (!canRead) return NOT_OFFERED;
  if (failure !== null) {
    return { phase: 'failed', messageKey: failure.key, retry: failure.retryable ? retry : null };
  }
  if (items === null) return LOADING;
  if (items.length === 0) return NO_BRANCH;
  return { phase: 'listed', items };
}

/** A company/branch pair as the forms hold it; both empty means "not narrowed". */
export interface BranchPair {
  readonly companyId: string;
  readonly branchId: string;
}

export const EMPTY_PAIR: BranchPair = { companyId: '', branchId: '' };

/**
 * The company a price rule is narrowed to, NAMED from the working context
 * (Owner directive, `P1-32-PRE-OD-UX`).
 *
 * A rule may apply to one company and every one of its branches. The branch
 * picker names a company only by naming one of its branches, so before this a
 * company-only rule had no control at all — it was reachable only through the
 * reference boxes an earlier pass removed. The companies are the ones
 * `GET /auth/working-context` publishes for this operator, by name.
 *
 * Choosing a company that is not the chosen branch's own clears the branch,
 * because the pair the server receives must be coherent.
 */
export function CompanyPicker({
  messages,
  label,
  placeholder,
  value,
  onChange,
  error,
}: {
  readonly messages: Messages;
  readonly label: string;
  readonly placeholder: string;
  readonly value: BranchPair;
  readonly onChange: (next: BranchPair) => void;
  readonly error?: string | undefined;
}) {
  const context = useWorkingContext();
  if (context.companies.length === 0) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-label font-medium text-text-primary">{label}</span>
        <p className="text-supporting text-text-secondary">
          {translate(messages, 'pricing.rule.noCompanies')}
        </p>
      </div>
    );
  }
  return (
    <SelectField
      label={label}
      value={value.companyId}
      onChange={(event) => {
        const companyId = event.target.value;
        const keepsBranch =
          value.branchId !== '' && context.companyOf(value.branchId)?.id === companyId;
        onChange({ companyId, branchId: keepsBranch ? value.branchId : '' });
      }}
      options={context.companies.map((company) => ({
        value: company.id,
        label: company.code ? `${company.code} — ${company.name}` : company.name,
      }))}
      placeholder={placeholder}
      error={error}
    />
  );
}

/**
 * A branch as a list — choosing a branch fills its company too — and a sentence
 * saying why in every case where this screen has no list to narrow to. A read
 * in flight is a WAIT, not a refusal.
 */
export function BranchPairPicker({
  messages,
  branches,
  label,
  placeholder,
  value,
  onChange,
  required,
  errors,
}: {
  readonly messages: Messages;
  readonly branches: Branches;
  readonly label: string;
  readonly placeholder: string;
  readonly value: BranchPair;
  readonly onChange: (next: BranchPair) => void;
  readonly required?: boolean;
  readonly errors?: Readonly<Record<string, string | undefined>>;
}) {
  /*
   * DECLARED BEFORE EVERY RETURN — a hook after an early return is a
   * `react-hooks/rules-of-hooks` failure.
   *
   * What it closes: identifiers typed into the fallback fields survive in the
   * consumer's pair, the list then arrives, and the select at `value.branchId`
   * finds no matching option. React leaves the control blank while the form
   * still holds — and would still send — the typed pair. Clearing only when a
   * list has arrived that cannot contain the pair is the narrowest fix.
   */
  const workingContext = useWorkingContext();
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
     * Deliberately NOT a disabled SelectField: `FieldFrame` binds its label to a
     * control with `htmlFor` and there is no control yet, and a disabled combo
     * box would satisfy a suite's `findByRole('combobox')` before its options
     * exist. `role="status"` appears in no other phase of this picker.
     */
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-label font-medium text-text-primary">{label}</p>
        <p role="status" aria-live="polite" className="text-supporting text-text-muted">
          {translate(messages, 'pricing.common.branchesLoading')}
        </p>
      </div>
    );
  }

  if (branches.phase === 'listed') {
    const { items } = branches;
    return (
      <SelectField
        label={label}
        {...(required ? { required: true } : {})}
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
        // EITHER half's complaint lands here: there is one control for the pair,
        // and a company refusal with no company field would render nowhere.
        error={errors?.['branchId'] ?? errors?.['companyId']}
      />
    );
  }

  /*
   * Everything that is not a list: `not-offered`, `none`, `failed`, and a
   * working context that could not be read at all.
   *
   * All four used to render two free-text boxes asking the operator to paste a
   * company reference and a branch reference. The argument was that
   * `org.branch-list` lists what a caller may REACH, that an empty list says
   * nothing about what they may operate on, and that the server re-authorizes
   * the pair anyway — all true, and none of it made a reference something
   * anybody could look up. The operator most likely to meet those boxes was the
   * one whose directory read had just been refused (Owner directive,
   * `P1-32-PRE-OD-UX`).
   *
   * `present` rather than `status` decides the context case, because a
   * component rendered with no provider above it reports `unavailable` too.
   */
  const contextFailed = workingContext.present && workingContext.status === 'unavailable';
  const sentence = contextFailed
    ? translate(messages, 'workingContext.unavailable')
    : branches.phase === 'failed'
      ? translateDynamic(messages, branches.messageKey)
      : branches.phase === 'none'
        ? translate(messages, 'pricing.common.branchesNone')
        : translate(messages, 'pricing.common.branchesNotOffered');
  const retry = branches.phase === 'failed' ? branches.retry : null;

  return (
    <div className="flex flex-col gap-1.5 sm:col-span-2">
      <p className="text-label font-medium text-text-primary">{label}</p>
      <p
        role="status"
        data-testid="pricing-branch-unavailable"
        className="text-supporting text-text-secondary"
      >
        {sentence}
      </p>
      {retry === null ? (
        <p className="text-supporting text-text-muted">
          {translate(messages, 'workingContext.retryInHeader')}
        </p>
      ) : (
        // `type="button"`: every caller renders this picker inside a form.
        <div>
          <button type="button" onClick={retry} className={SECONDARY_BUTTON}>
            {translate(messages, 'state.retry')}
          </button>
        </div>
      )}
    </div>
  );
}

/** A label lookup for a branch identifier — the code and name when the list holds it. */
export function branchLabel(branches: Branches, branchId: string): string | null {
  if (branches.phase !== 'listed') return null;
  const found = branches.items.find((branch) => branch.id === branchId);
  return found ? `${found.branchCode} — ${found.name}` : null;
}

/* ------------------------------------------------------------------ *
 * Services
 * ------------------------------------------------------------------ */

/**
 * A service, found by the beginning of its code or name through
 * `svc.service-list` when the operator holds `svc.service.read`, and named by
 * identifier when they do not. The search is explicit — a button, never a
 * keystroke — and asks for one page.
 */
export function ServicePicker({
  messages,
  canRead,
  label,
  value,
  onChange,
  error,
  unavailableId,
}: {
  readonly messages: Messages;
  readonly canRead: boolean;
  readonly label: string;
  readonly value: string;
  readonly onChange: (serviceId: string) => void;
  readonly error?: string | undefined;
  /**
   * The id given to the sentence shown without `svc.service.read`, so the
   * caller can describe its held submit with it.
   */
  readonly unavailableId?: string | undefined;
}) {
  const [term, setTerm] = useState('');
  const [found, setFound] = useState<readonly ServiceSummary[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    const needle = term.trim();
    setBusy(true);
    const page = await listServices(needle ? { search: needle } : {}, INITIAL_REQUEST, null);
    setBusy(false);
    if (page.status === 'ok') {
      setFound(page.rows);
      setNote(page.rows.length === 0 ? 'pricing.picker.noServices' : null);
    } else {
      setFound(null);
      setNote(
        page.status === 'denied' ? 'pricing.picker.servicesRefused' : 'pricing.picker.searchFailed'
      );
    }
  };

  const options = useMemo(
    () =>
      (found ?? []).map((service) => ({
        value: service.id,
        label: `${service.serviceCode} — ${service.name}`,
      })),
    [found]
  );

  /*
   * Without the catalogue read there is nothing to choose from, and a box asking
   * for a service reference is not a way to choose one: nobody holds that
   * reference except by copying it out of a screen they may not open (Owner
   * directive, `P1-32-PRE-OD-UX`). No narrower read publishes services, so the
   * picker says why and the caller holds its submit, described by this sentence.
   */
  if (!canRead) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-label font-medium text-text-primary">{label}</span>
        <p id={unavailableId} role="status" className="text-supporting text-text-secondary">
          {translate(messages, 'pricing.picker.servicesNotReadable')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <div className="grow">
          <TextField
            label={translate(messages, 'pricing.picker.serviceSearch')}
            description={translate(messages, 'pricing.picker.serviceSearchHelp')}
            spellCheck={false}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
        </div>
        <button
          type="button"
          className={SECONDARY_BUTTON}
          disabled={busy}
          onClick={() => {
            void search();
          }}
        >
          {translate(messages, 'pricing.picker.search')}
        </button>
      </div>
      <SelectField
        label={label}
        required
        {...(note ? { description: translateDynamic(messages, note) } : {})}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        options={options}
        placeholder={translate(messages, 'pricing.picker.chooseService')}
        error={error}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Badges and notes
 * ------------------------------------------------------------------ */

export function ActivationBadge({
  messages,
  status,
}: {
  readonly messages: Messages;
  readonly status: ActivationState;
}) {
  const label = translateDynamic(messages, `pricing.status.${status}`);
  if (status === 'inactive') {
    return (
      <span className="rounded-md border border-border px-2 py-0.5 text-caption text-text-secondary">
        {label}
      </span>
    );
  }
  return <span className="text-body">{label}</span>;
}

export function VersionStatusBadge({
  messages,
  status,
}: {
  readonly messages: Messages;
  readonly status: PriceListVersionState;
}) {
  const label = translateDynamic(messages, `pricing.versionStatus.${status}`);
  if (status === 'published') {
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

/** A `dt`/`dd` pair for a read-only figure. */
export function Figure({
  label,
  wide,
  children,
}: {
  readonly label: string;
  readonly wide?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="text-body text-text-primary">{children}</dd>
    </div>
  );
}
