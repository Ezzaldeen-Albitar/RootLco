'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Button from '@mui/material/Button';

import { OperationalGrid, type OperationalColumn } from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import type { ServerTable } from '@/components/data-table/use-server-table';
import { FilterToolbar } from '@/components/filters/FilterToolbar';
import { DateField, type DayProblem } from '@/components/forms/mui/DateField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { TreePicker, type TreePickerItem } from '@/components/pickers/TreePicker';
import {
  MuiEmptyState,
  MuiSearchStates,
  type NoResultsReason,
} from '@/components/states/MuiStates';
import {
  useUnsavedGuard,
  useWorkingContext,
} from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { CursorPage, ReadState } from '@/lib/api/read-operation';
import { useSearchRequest } from '@/lib/api/use-search-request';
import type { ActionState } from '@/lib/forms/action-result';
import { useLocalRefusal } from '@/lib/forms/use-local-refusal';

import {
  createService,
  createServiceCategory,
  listBranches,
  listServiceCategories,
  listServices,
} from '../api';
import {
  EXTERNAL_CODE,
  INTERNAL_CODE,
  MAX_DESCRIPTION,
  MAX_NAME,
  SERVICE_LIFECYCLE_STATES,
  type BranchOption,
  type ServiceCategory,
  type ServiceLifecycleState,
  type ServiceListCriteria,
  type ServiceSummary,
} from '../services-contract';

/**
 * The service catalogue (P1-30, `W1`, FE-001) — `svc.service-list` rendered as
 * what the workshop offers, by code, with the writes A1 opened beside it. On
 * the shared Material UI wrappers since `P1-32-PRE-OD-MUISP` (ADR-022).
 *
 * ## Tenant-wide, so it reads on first paint
 *
 * `svc.service-list` is `scope: 'tenant'`: there is no branch to name before
 * the first request, so the results mount immediately with no filter. The
 * work-order board's "no request before intent" rule exists because that read
 * takes a branch TARGET; this one does not.
 *
 * ## The filters ask as they change
 *
 * The box is `FilterToolbar`'s search: the term goes to the server as typed —
 * Arabic-Indic digits included, echoed as Latin under the box — after the read
 * hook's pause, or at once on Enter; Escape clears; nothing reaches the address
 * bar. The status is a chip filter; the category a tree (the taxonomy names a
 * parent, so it is a genuine hierarchy); the branch a select; the date a
 * `DateField`. Each change is a new request through `useSearchRequest`, which
 * drops a superseded answer and keys on the working-context version. A date
 * only partly typed is refused on its field and the list keeps the day that
 * was last whole, so a half-typed date never widens or narrows the list.
 *
 * ## Retired services stay listed, and say so
 *
 * The backend applies `lifecycleStatus` only when the filter is sent, so an
 * unfiltered page holds archived services beside active ones. That is the
 * catalogue's truth: a retired service still exists, work orders may still cite
 * it, and hiding it would make those references dangle. It renders as
 * "Retired", and the filter lets an operator narrow to either.
 *
 * ## Availability is a filter, because there is no availability read
 *
 * The backend records which branches offer a service and publishes no list of
 * it; the only way to observe availability is `availableAtBranchId`. The
 * branches offered are the working context's own named branches, or the
 * branch list when the shell holds none — and a refused list is said, never
 * drawn as "this tenant has no branches".
 *
 * ## Categories are a label lookup, not a join the client invents
 *
 * A service carries `categoryId`. The taxonomy is read once and the name is
 * looked up for DISPLAY; a service whose category is not in the loaded page —
 * the taxonomy is capped at one page of a hundred — says so in words and never
 * prints the identifier.
 *
 * ## States
 *
 * The rows are `OperationalGrid` over the search's table (server mode, no
 * count, the cursor footer). Every state other than an answer is
 * `MuiSearchStates` — a throttled or unanswered read is "unavailable, try
 * again", never an empty catalogue — and an empty answer with nothing
 * narrowing it is `MuiEmptyState`.
 *
 * No money crosses this screen. There is no price on a catalogue row.
 */

/** A branch filter value only counts while the list in hand can contain it. */
function chosenBranch(branches: Branches, branchId: string): string {
  if (branches.phase !== 'listed' || branchId === '') return '';
  return branches.items.some((branch) => branch.id === branchId) ? branchId : '';
}

export function ServiceCatalogueScreen({
  locale,
  messages,
  canManage,
  canReadBranches,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** `svc.service.manage` — decides whether the create forms are offered. */
  readonly canManage: boolean;
  /** `org.branch.read` — decides whether a branch list is even requested. */
  readonly canReadBranches: boolean;
}) {
  const context = useWorkingContext();
  const [term, setTerm] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [lifecycleStatus, setLifecycleStatus] = useState<'' | ServiceLifecycleState>('');
  const [branchId, setBranchId] = useState('');
  const [effectiveOn, setEffectiveOn] = useState('');
  const [dayProblem, setDayProblem] = useState<DayProblem>(null);
  /*
   * The day the list is read on: the last WHOLE entry. While the field holds a
   * day only partly typed it reports `''` — before it reports the problem —
   * which would otherwise drop the filter; the list keeps the day in force
   * instead and the field says what is wrong. The filter goes only when the
   * field is emptied and says nothing is wrong any more.
   */
  const [appliedDay, setAppliedDay] = useState('');
  const [creating, setCreating] = useState(false);

  const taxonomy = useTaxonomy();
  const branches = useBranches(canReadBranches);
  const branchFilter = chosenBranch(branches, branchId);

  const trimmed = term.trim();
  const criteria: ServiceListCriteria = {
    ...(trimmed ? { search: trimmed } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(lifecycleStatus ? { lifecycleStatus } : {}),
    ...(branchFilter ? { availableAtBranchId: branchFilter } : {}),
    ...(appliedDay ? { effectiveOn: appliedDay } : {}),
  };

  const load = useCallback(
    async (
      asked: ServiceListCriteria,
      cursor: string | null
    ): Promise<ReadState<CursorPage<ServiceSummary>>> => {
      const page = await listServices(asked, INITIAL_REQUEST, cursor);
      if (page.status !== 'ok') return { status: page.status, correlationId: page.correlationId };
      return {
        status: 'ok',
        data: { items: page.rows, nextCursor: page.nextCursor, hasMore: page.hasMore },
        correlationId: page.correlationId,
      };
    },
    []
  );

  const search = useSearchRequest<ServiceSummary, ServiceListCriteria>({
    criteria,
    load,
    version: context.version,
    // The catalogue as it is, with nothing narrowing it, is "nothing here yet"
    // when empty — never "no matches".
    narrows: (asked) => Object.keys(asked).length > 0,
  });

  const clearFilters = () => {
    setTerm('');
    setCategoryId('');
    setLifecycleStatus('');
    setBranchId('');
    setEffectiveOn('');
    setAppliedDay('');
    setDayProblem(null);
  };

  const lifecycleOptions = useMemo(
    () =>
      SERVICE_LIFECYCLE_STATES.map((state) => ({
        value: state,
        label: translateDynamic(messages, `services.lifecycle.${state}`),
      })),
    [messages]
  );

  const emptyReason: NoResultsReason = trimmed ? 'search' : 'filters';

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <FilterToolbar
        messages={messages}
        label={translate(messages, 'services.catalogue.formLabel')}
        testId="service-catalogue-toolbar"
        search={{
          label: translate(messages, 'services.catalogue.search'),
          placeholder: translate(messages, 'services.catalogue.searchPlaceholder'),
          example: translate(messages, 'services.catalogue.searchExample'),
          value: term,
          onChange: setTerm,
          onSubmit: search.submit,
          busy: search.phase === 'loading',
          maxLength: MAX_NAME,
          echoDigits: true,
        }}
        filters={[
          {
            kind: 'chips',
            key: 'lifecycle',
            label: translate(messages, 'services.catalogue.lifecycle'),
            options: lifecycleOptions,
            value: lifecycleStatus,
            onChange: (next) => setLifecycleStatus(next as '' | ServiceLifecycleState),
          },
        ]}
        actions={
          canManage ? (
            <Button
              type="button"
              variant="outlined"
              aria-expanded={creating}
              onClick={() => setCreating((open) => !open)}
            >
              {translate(messages, 'services.catalogue.create')}
            </Button>
          ) : undefined
        }
      />

      <section
        aria-label={translate(messages, 'services.catalogue.moreFilters')}
        className="grid gap-4 rounded-lg border border-border bg-surface p-4 lg:grid-cols-3"
      >
        <CategoryPicker
          messages={messages}
          taxonomy={taxonomy}
          label={translate(messages, 'services.catalogue.category')}
          noneLabel={translate(messages, 'services.catalogue.anyCategory')}
          help={translate(messages, 'services.catalogue.categoryHelp')}
          value={categoryId}
          onChange={setCategoryId}
        />
        <BranchPicker
          messages={messages}
          branches={branches}
          label={translate(messages, 'services.catalogue.availableAtBranch')}
          placeholder={translate(messages, 'services.catalogue.anyBranch')}
          value={branchFilter}
          onChange={setBranchId}
        />
        <DateField
          label={translate(messages, 'services.catalogue.effectiveOn')}
          description={translate(messages, 'services.catalogue.effectiveOnHelp')}
          value={effectiveOn}
          onChange={(next) => {
            setEffectiveOn(next);
            if (next !== '') setAppliedDay(next);
          }}
          onProblem={(problem) => {
            setDayProblem(problem);
            if (problem === null && effectiveOn === '') setAppliedDay('');
          }}
          error={
            dayProblem === null ? undefined : translate(messages, 'services.catalogue.dateFormat')
          }
          testId="service-catalogue-effective-on"
        />
      </section>

      {canManage && creating ? (
        <CreatePanel
          locale={locale}
          messages={messages}
          taxonomy={taxonomy}
          onClose={() => setCreating(false)}
        />
      ) : null}

      <section aria-labelledby="service-catalogue-heading" className="flex min-h-0 flex-col gap-2">
        <h2 id="service-catalogue-heading" className="sr-only">
          {translate(messages, 'services.catalogue.resultsHeading')}
        </h2>
        {search.phase === 'empty' && search.table.narrowed !== true ? (
          <MuiEmptyState messages={messages} testId="service-catalogue-empty" />
        ) : (
          <MuiSearchStates
            messages={messages}
            locale={locale}
            phase={search.phase}
            correlationId={search.correlationId}
            emptyReason={emptyReason}
            onRetry={search.submit}
            onClearFilters={
              search.phase === 'empty' ? (
                <Button type="button" variant="outlined" size="small" onClick={clearFilters}>
                  {translate(messages, 'table.clearFilters')}
                </Button>
              ) : undefined
            }
          />
        )}
        {search.phase === 'ready' ? (
          <CatalogueGrid
            locale={locale}
            messages={messages}
            taxonomy={taxonomy}
            table={search.table}
          />
        ) : null}
        <p className="text-caption text-text-muted" lang={locale}>
          {translate(messages, 'services.catalogue.orderingNote')}
        </p>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Reference data the screen loads once
 * ------------------------------------------------------------------ */

export interface Taxonomy {
  /** `null` while loading, or when the read was refused. */
  readonly categories: readonly ServiceCategory[] | null;
  /** A message key when the read was refused or failed, else `null`. */
  readonly refused: string | null;
  /** The taxonomy did not fit in one page; the picker is incomplete. */
  readonly truncated: boolean;
  readonly add: (category: ServiceCategory) => void;
}

export function useTaxonomy(): Taxonomy {
  const [categories, setCategories] = useState<readonly ServiceCategory[] | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    let live = true;
    void listServiceCategories().then((state) => {
      if (!live) return;
      if (state.status === 'ok') {
        setCategories(state.data.items);
        setTruncated(state.data.hasMore);
      } else {
        setRefused(
          state.status === 'denied'
            ? 'services.catalogue.categoriesRefused'
            : 'services.catalogue.categoriesUnavailable'
        );
      }
    });
    return () => {
      live = false;
    };
  }, []);
  const add = useCallback((category: ServiceCategory) => {
    setCategories((current) => [category, ...(current ?? [])]);
  }, []);
  return { categories, refused, truncated, add };
}

/** The taxonomy as tree rows: each category under its parent, by name. */
export function categoryTreeItems(
  categories: readonly ServiceCategory[] | null
): readonly TreePickerItem[] {
  return (categories ?? []).map((category) => ({
    id: category.id,
    parentId: category.parentCategoryId ?? null,
    label: category.name,
  }));
}

/**
 * The branch list as one of six outcomes rather than three fields.
 *
 * The old shape (`items | null`, `refused`, `offered`) could not tell "the read
 * is in flight" from "the caller may not read branches" — `items` is `null` in
 * both — so the picker resolved the ambiguity toward the free-text identifier
 * field and a permitted operator met a text box on every first paint (P1-30
 * CC-15, the same defect in this copy of the picker). `[]` is not `null`
 * either, so an empty list rendered a select holding only its placeholder.
 *
 * `retry` is `null` where a second attempt cannot help — a refusal and a dead
 * session both fail identically the second time.
 */
type Branches =
  /** No `org.branch.read`, and no working context to answer instead. */
  | { readonly phase: 'not-offered' }
  /** Permitted, and `org.branch-list` has not answered. */
  | { readonly phase: 'loading' }
  /** Answered with at least one row. The only phase that offers a choice. */
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
 * The working context, mapped onto the shape this picker already speaks.
 *
 * The layout reads `GET /auth/working-context` ONCE per request and publishes
 * the named, active branches this operator is authorized for. Where that answer
 * exists there is nothing for a second read of `org.branch-list` to add: same
 * operator, same workspace, same moment.
 *
 * `countryCode` is the one field the working context does not publish. It is
 * `null` rather than invented; nothing in this picker reads it.
 */
export function branchesFromContext(
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

function useBranches(canRead: boolean): Branches {
  const context = useWorkingContext();
  const fromContext = branchesFromContext(context);
  const [items, setItems] = useState<readonly BranchOption[] | null>(null);
  const [failure, setFailure] = useState<{ key: string; retryable: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);

  // A retry is a NEW attempt, so both outcome fields are cleared first: leaving
  // `failure` set would hold the picker in its failed state while the second
  // read is in flight.
  const retry = useCallback(() => {
    setItems(null);
    setFailure(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    // Not read at all when the shell already holds the answer.
    if (!canRead || fromContext !== null) return;
    let live = true;
    void listBranches().then((state) => {
      if (!live) return;
      if (state.status === 'ok') {
        setItems(state.data.items);
        return;
      }
      if (state.status === 'denied') {
        setFailure({ key: 'services.catalogue.branchesRefused', retryable: false });
      } else if (state.status === 'expired') {
        setFailure({ key: 'state.expired.message', retryable: false });
      } else {
        setFailure({ key: 'services.catalogue.branchesUnavailable', retryable: true });
      }
    });
    return () => {
      live = false;
    };
  }, [canRead, attempt, fromContext]);

  /*
   * The working context comes FIRST, before the permission.
   *
   * It used to be absent here entirely, so an operator without
   * `org.branch.read` was reported as having no branch. `GET
   * /auth/working-context` is gated on `iam.user.read`, which anyone who can
   * read a session holds, and it publishes what this caller may ACT in;
   * `org.branch-list` publishes what they may administer.
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

/**
 * The category, as a tree of the taxonomy by name. A refused or failed
 * taxonomy read is said under the tree; the "none" row stays, so a filter can
 * always be lifted.
 */
function CategoryPicker({
  messages,
  taxonomy,
  label,
  noneLabel,
  help,
  value,
  onChange,
  required,
  error,
  onEdit,
  testId,
}: {
  readonly messages: Messages;
  readonly taxonomy: Taxonomy;
  readonly label: string;
  readonly noneLabel?: string | undefined;
  readonly help?: string | undefined;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly required?: boolean;
  readonly error?: string | undefined;
  readonly onEdit?: (() => void) | undefined;
  readonly testId?: string | undefined;
}) {
  const items = useMemo(() => categoryTreeItems(taxonomy.categories), [taxonomy.categories]);
  const note = taxonomy.refused
    ? translateDynamic(messages, taxonomy.refused)
    : taxonomy.truncated
      ? translate(messages, 'services.catalogue.categoriesTruncated')
      : undefined;
  const description = [help, note].filter(Boolean).join(' ') || undefined;
  return (
    <TreePicker
      label={label}
      description={description}
      required={required}
      items={items}
      value={value}
      onChange={onChange}
      noneLabel={noneLabel}
      error={error}
      onEdit={onEdit}
      testId={testId}
    />
  );
}

/**
 * A branch, as a list when the operator may read one, and a sentence in every
 * case where this screen has no list to narrow to. A read in flight is a WAIT,
 * not a refusal, and is the one phase with no control at all.
 */
function BranchPicker({
  messages,
  branches,
  label,
  placeholder,
  value,
  onChange,
}: {
  readonly messages: Messages;
  readonly branches: Branches;
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
}) {
  const workingContext = useWorkingContext();

  if (branches.phase === 'loading') {
    // No control yet, so nothing for a label to name; `role="status"` appears
    // in no other phase of this picker.
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-label font-medium text-text-primary">{label}</p>
        <p role="status" aria-live="polite" className="text-supporting text-text-muted">
          {translate(messages, 'services.catalogue.branchesLoading')}
        </p>
      </div>
    );
  }

  if (branches.phase === 'listed') {
    return (
      <FormSelectField
        label={label}
        value={value}
        onChange={onChange}
        options={branches.items.map((branch) => ({
          value: branch.id,
          label: `${branch.branchCode} — ${branch.name}`,
        }))}
        placeholder={placeholder}
        testId="service-branch-filter"
      />
    );
  }

  /*
   * `not-offered`, `none` and `failed`: there is no branch to filter by, and
   * the screen says which of the three it is. This filter is OPTIONAL, so its
   * absence narrows nothing: the catalogue is simply read unfiltered (Owner
   * directive, `P1-32-PRE-OD-UX`).
   */
  const sentence =
    workingContext.present && workingContext.status === 'unavailable'
      ? translate(messages, 'workingContext.unavailable')
      : branches.phase === 'failed'
        ? translateDynamic(messages, branches.messageKey)
        : branches.phase === 'none'
          ? translate(messages, 'services.catalogue.branchesNone')
          : translate(messages, 'services.catalogue.branchesNotOffered');

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-label font-medium text-text-primary">{label}</p>
      <p
        role="status"
        data-testid="service-branch-filter-absent"
        className="text-supporting text-text-secondary"
      >
        {sentence}
      </p>
      {branches.phase === 'failed' && branches.retry !== null ? (
        <div>
          <Button type="button" variant="outlined" size="small" onClick={branches.retry}>
            {translate(messages, 'state.retry')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The results
 * ------------------------------------------------------------------ */

function CatalogueGrid({
  locale,
  messages,
  taxonomy,
  table,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly taxonomy: Taxonomy;
  readonly table: ServerTable<ServiceSummary>;
}) {
  const categoryName = useMemo(() => {
    const names = new Map<string, string>();
    for (const category of taxonomy.categories ?? []) names.set(category.id, category.name);
    return names;
  }, [taxonomy.categories]);

  const columns = useMemo<readonly OperationalColumn<ServiceSummary>[]>(
    () => [
      {
        id: 'serviceCode',
        headerKey: 'services.catalogue.column.code',
        cell: (row) => (
          <Link
            href={`/${locale}/services/${row.id}`}
            className="font-mono text-caption text-primary underline-offset-2 hover:underline"
            dir="ltr"
          >
            {row.serviceCode}
          </Link>
        ),
      },
      {
        id: 'name',
        headerKey: 'services.catalogue.column.name',
        flex: 1.4,
        cell: (row) => <bdi>{row.name}</bdi>,
      },
      {
        id: 'category',
        headerKey: 'services.catalogue.column.category',
        cell: (row) => {
          const name = categoryName.get(row.categoryId);
          // Said in words when the loaded taxonomy cannot name it — never the
          // identifier, which would be a second thing to look up.
          return name !== undefined ? (
            <bdi>{name}</bdi>
          ) : (
            <span className="text-caption text-text-muted">
              {translate(messages, 'services.catalogue.unknownCategory')}
            </span>
          );
        },
      },
      {
        id: 'lifecycleStatus',
        headerKey: 'services.catalogue.column.status',
        cell: (row) => <LifecycleBadge messages={messages} status={row.lifecycleStatus} />,
      },
    ],
    [categoryName, locale, messages]
  );

  return (
    <OperationalGrid<ServiceSummary>
      messages={messages}
      locale={locale}
      label={translate(messages, 'services.catalogue.caption')}
      columns={columns}
      rowId={(row) => row.id}
      table={table}
      // The filters live outside the table request; the states above say what
      // an empty answer means.
      suppressEmptyState
      testId="service-catalogue-grid"
    />
  );
}

/** `active` and `archived` are the whole closed vocabulary; `archived` reads as retired. */
export function LifecycleBadge({
  messages,
  status,
}: {
  readonly messages: Messages;
  readonly status: ServiceLifecycleState;
}) {
  const label = translateDynamic(messages, `services.lifecycle.${status}`);
  if (status === 'archived') {
    return (
      <span className="rounded-md border border-border px-2 py-0.5 text-caption text-text-secondary">
        {label}
      </span>
    );
  }
  return <span className="text-body">{label}</span>;
}

/* ------------------------------------------------------------------ *
 * Creating — a category first, because nothing can be filed without one
 * ------------------------------------------------------------------ */

function CreatePanel({
  locale,
  messages,
  taxonomy,
  onClose,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly taxonomy: Taxonomy;
  readonly onClose: () => void;
}) {
  const hasCategories = (taxonomy.categories?.length ?? 0) > 0;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ServiceForm
        locale={locale}
        messages={messages}
        taxonomy={taxonomy}
        disabled={!hasCategories}
        onClose={onClose}
      />
      <CategoryForm messages={messages} taxonomy={taxonomy} />
    </div>
  );
}

const EMPTY_SERVICE = { categoryId: '', serviceCode: '', name: '', description: '' };

function ServiceForm({
  locale,
  messages,
  taxonomy,
  disabled,
  onClose,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly taxonomy: Taxonomy;
  /** True while the taxonomy is empty: a service must be filed under a category. */
  readonly disabled: boolean;
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY_SERVICE);
  const { errorKey, formRef, refuse } = useLocalRefusal(form);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  // Typed and not created is unsaved work: a branch switch or leaving the page
  // asks first, and "discard" empties the form.
  const dirty = Object.values(form).some((field) => field.trim().length > 0);
  useUnsavedGuard(dirty, () => {
    setForm(EMPTY_SERVICE);
    setOutcome(null);
  });

  const errorFor = (...names: readonly string[]): string | undefined => {
    for (const name of names) {
      const key = errorKey(name) ?? outcome?.fieldErrors?.[name];
      if (key) return translateDynamic(messages, key);
    }
    return undefined;
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    if (!form.categoryId) found['categoryId'] = 'field.required';
    const serviceCode = form.serviceCode.trim();
    if (serviceCode.length === 0) found['serviceCode'] = 'field.required';
    else if (!EXTERNAL_CODE.test(serviceCode)) found['serviceCode'] = 'services.create.codeFormat';
    const name = form.name.trim();
    if (name.length === 0) found['name'] = 'field.required';
    else if (name.length > MAX_NAME) found['name'] = 'services.create.nameTooLong';
    const description = form.description.trim();
    if (description.length > MAX_DESCRIPTION)
      found['description'] = 'services.create.descriptionTooLong';
    refuse(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await createService({
      serviceCategoryId: form.categoryId,
      serviceCode,
      name,
      ...(description ? { description } : {}),
    });
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      // Stored, so nothing is unsaved any more: the declaration goes before
      // the move, and the typed values with it.
      setForm(EMPTY_SERVICE);
      router.push(`/${locale}/services/${result.created.id}`);
    }
  };

  const set = (field: keyof typeof EMPTY_SERVICE) => (value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="service-create-heading"
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="service-create-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'services.create.title')}
      </h2>
      {disabled ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'services.create.needsCategory')}
        </p>
      ) : null}
      <CategoryPicker
        messages={messages}
        taxonomy={taxonomy}
        label={translate(messages, 'services.create.category')}
        required
        value={form.categoryId}
        onChange={set('categoryId')}
        error={errorFor('categoryId', 'serviceCategoryId')}
        testId="service-create-category"
      />
      <FormTextField
        label={translate(messages, 'services.create.code')}
        description={translate(messages, 'services.create.codeHelp')}
        required
        dir="ltr"
        autoComplete="off"
        value={form.serviceCode}
        onChange={set('serviceCode')}
        error={errorFor('serviceCode')}
      />
      <FormTextField
        label={translate(messages, 'services.create.name')}
        required
        value={form.name}
        onChange={set('name')}
        error={errorFor('name')}
      />
      <FormTextField
        label={translate(messages, 'services.create.description')}
        multiline
        rows={3}
        value={form.description}
        onChange={set('description')}
        error={errorFor('description')}
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="contained" disabled={busy || disabled}>
          {translate(messages, 'services.create.submit')}
        </Button>
        <Button type="button" variant="outlined" onClick={onClose}>
          {translate(messages, 'services.create.cancel')}
        </Button>
      </div>
    </form>
  );
}

const EMPTY_CATEGORY = { code: '', name: '', parentCategoryId: '' };

function CategoryForm({
  messages,
  taxonomy,
}: {
  readonly messages: Messages;
  readonly taxonomy: Taxonomy;
}) {
  const [form, setForm] = useState(EMPTY_CATEGORY);
  const { errorKey, formRef, refuse } = useLocalRefusal(form);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const dirty = Object.values(form).some((field) => field.trim().length > 0);
  useUnsavedGuard(dirty, () => {
    setForm(EMPTY_CATEGORY);
    setOutcome(null);
  });

  const errorFor = (name: string): string | undefined => {
    const key = errorKey(name) ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    const code = form.code.trim();
    if (code.length === 0) found['code'] = 'field.required';
    else if (!INTERNAL_CODE.test(code)) found['code'] = 'services.category.codeFormat';
    const name = form.name.trim();
    if (name.length === 0) found['name'] = 'field.required';
    else if (name.length > MAX_NAME) found['name'] = 'services.create.nameTooLong';
    refuse(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await createServiceCategory({
      code,
      name,
      ...(form.parentCategoryId ? { parentCategoryId: form.parentCategoryId } : {}),
    });
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      taxonomy.add(result.created);
      setForm(EMPTY_CATEGORY);
    }
  };

  const set = (field: keyof typeof EMPTY_CATEGORY) => (value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="category-create-heading"
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="category-create-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'services.category.new')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'services.category.explain')}
      </p>
      <FormTextField
        label={translate(messages, 'services.category.code')}
        description={translate(messages, 'services.category.codeHelp')}
        required
        dir="ltr"
        autoComplete="off"
        value={form.code}
        onChange={set('code')}
        error={errorFor('code')}
      />
      <FormTextField
        label={translate(messages, 'services.category.name')}
        required
        value={form.name}
        onChange={set('name')}
        error={errorFor('name')}
      />
      <CategoryPicker
        messages={messages}
        taxonomy={taxonomy}
        label={translate(messages, 'services.category.parent')}
        noneLabel={translate(messages, 'services.category.parentNone')}
        help={translate(messages, 'services.category.parentHelp')}
        value={form.parentCategoryId}
        onChange={set('parentCategoryId')}
        error={errorFor('parentCategoryId')}
        testId="category-create-parent"
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <Button type="submit" variant="contained" disabled={busy}>
          {translate(messages, 'services.category.submit')}
        </Button>
      </div>
    </form>
  );
}

/**
 * A backend refusal or failure, with the correlation reference an operator can
 * quote. A client-side validation error carries none, because nothing was
 * logged for it. Success is a toast, not a paragraph.
 */
export function OutcomeNote({
  messages,
  outcome,
  onReload,
}: {
  readonly messages: Messages;
  readonly outcome: ActionState | null;
  /**
   * A version-guarded form's way out of a conflict: what is stored now
   * replaces the stale work. Offered only beside a conflict.
   */
  readonly onReload?: () => void;
}) {
  if (!outcome || outcome.status === 'idle' || outcome.status === 'success') return null;
  const key = outcome.messageKey ?? 'action.failed';
  const note = (
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
  if (onReload === undefined || outcome.status !== 'conflict') return note;
  return (
    <div className="flex flex-col items-start gap-2">
      {note}
      <Button type="button" variant="outlined" size="small" onClick={onReload}>
        {translate(messages, 'services.detail.reload')}
      </Button>
    </div>
  );
}
