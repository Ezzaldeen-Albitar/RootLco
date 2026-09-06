'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { SelectField, TextAreaField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';

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
 * what the workshop offers, by code, with the writes A1 opened beside it.
 *
 * ## Tenant-wide, so it reads on first paint
 *
 * `svc.service-list` is `scope: 'tenant'`: there is no branch to name before
 * the first request, so the results mount immediately with no filter. The
 * work-order board's "no request before intent" rule exists because that read
 * takes a branch TARGET; this one does not, and copying the ceremony would only
 * hide the catalogue behind a button for no reason.
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
 * it; the only way to observe availability is `availableAtBranchId`. So the
 * catalogue offers "available at branch" as a filter, with the branch list when
 * the operator may read it and a plain identifier field when they may not —
 * `org.branch.read` is a different code from the catalogue's, and a refused
 * branch list must not render as "this tenant has no branches".
 *
 * ## Categories are a label lookup, not a join the client invents
 *
 * A service carries `categoryId`. The taxonomy is read once and the name is
 * looked up for DISPLAY; a service whose category is not in the loaded page —
 * the taxonomy is capped at one page of a hundred — renders its identifier and
 * says the name is not in the list, rather than guessing.
 *
 * No money crosses this screen. There is no price on a catalogue row.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const PRIMARY_BUTTON =
  'rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover';
const SECONDARY_BUTTON =
  'rounded-md border border-border bg-surface px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard';

interface Draft {
  readonly search: string;
  readonly categoryId: string;
  readonly lifecycleStatus: '' | ServiceLifecycleState;
  readonly branchId: string;
  readonly effectiveOn: string;
}

const EMPTY_DRAFT: Draft = {
  search: '',
  categoryId: '',
  lifecycleStatus: '',
  branchId: '',
  effectiveOn: '',
};

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
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [criteria, setCriteria] = useState<ServiceListCriteria>({});
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [creating, setCreating] = useState(false);

  const taxonomy = useTaxonomy();
  const branches = useBranches(canReadBranches);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = () => {
    const found: Record<string, string> = {};
    const search = draft.search.trim();
    if (search.length > MAX_NAME) found['search'] = 'services.catalogue.searchTooLong';
    const branchId = draft.branchId.trim();
    if (branchId.length > 0 && !UUID.test(branchId)) {
      found['branchId'] = 'services.catalogue.branchIdFormat';
    }
    const effectiveOn = draft.effectiveOn.trim();
    if (effectiveOn.length > 0 && !ISO_DATE.test(effectiveOn)) {
      found['effectiveOn'] = 'services.catalogue.dateFormat';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setCriteria({
      ...(search ? { search } : {}),
      ...(draft.categoryId ? { categoryId: draft.categoryId } : {}),
      ...(draft.lifecycleStatus ? { lifecycleStatus: draft.lifecycleStatus } : {}),
      ...(branchId ? { availableAtBranchId: branchId } : {}),
      ...(effectiveOn ? { effectiveOn } : {}),
    });
  };

  const lifecycleOptions = useMemo(
    () =>
      SERVICE_LIFECYCLE_STATES.map((state) => ({
        value: state,
        label: translateDynamic(messages, `services.lifecycle.${state}`),
      })),
    [messages]
  );

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
        aria-label={translate(messages, 'services.catalogue.formLabel')}
        className="rounded-lg border border-border bg-surface p-4"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <TextField
            label={translate(messages, 'services.catalogue.search')}
            value={draft.search}
            onChange={(event) => setDraft((d) => ({ ...d, search: event.target.value }))}
            error={errorFor('search')}
          />
          <CategoryPicker
            messages={messages}
            taxonomy={taxonomy}
            label={translate(messages, 'services.catalogue.category')}
            placeholder={translate(messages, 'services.catalogue.anyCategory')}
            value={draft.categoryId}
            onChange={(next) => setDraft((d) => ({ ...d, categoryId: next }))}
          />
          <SelectField
            label={translate(messages, 'services.catalogue.lifecycle')}
            value={draft.lifecycleStatus}
            onChange={(event) =>
              setDraft((d) => ({
                ...d,
                lifecycleStatus: event.target.value as Draft['lifecycleStatus'],
              }))
            }
            options={lifecycleOptions}
            placeholder={translate(messages, 'services.catalogue.anyLifecycle')}
          />
          <BranchPicker
            messages={messages}
            branches={branches}
            label={translate(messages, 'services.catalogue.availableAtBranch')}
            placeholder={translate(messages, 'services.catalogue.anyBranch')}
            value={draft.branchId}
            onChange={(next) => setDraft((d) => ({ ...d, branchId: next }))}
            error={errorFor('branchId')}
          />
          <TextField
            label={translate(messages, 'services.catalogue.effectiveOn')}
            description={translate(messages, 'services.catalogue.effectiveOnHelp')}
            type="date"
            dir="ltr"
            value={draft.effectiveOn}
            onChange={(event) => setDraft((d) => ({ ...d, effectiveOn: event.target.value }))}
            error={errorFor('effectiveOn')}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="submit" className={PRIMARY_BUTTON}>
            {translate(messages, 'services.catalogue.show')}
          </button>
          {canManage ? (
            <button
              type="button"
              className={SECONDARY_BUTTON}
              aria-expanded={creating}
              onClick={() => setCreating((open) => !open)}
            >
              {translate(messages, 'services.catalogue.create')}
            </button>
          ) : null}
        </div>
      </form>

      {canManage && creating ? (
        <CreatePanel
          locale={locale}
          messages={messages}
          taxonomy={taxonomy}
          onClose={() => setCreating(false)}
        />
      ) : null}

      <CatalogueResults
        key={JSON.stringify(criteria)}
        locale={locale}
        messages={messages}
        criteria={criteria}
        taxonomy={taxonomy}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Reference data the screen loads once
 * ------------------------------------------------------------------ */

interface Taxonomy {
  /** `null` while loading, or when the read was refused. */
  readonly categories: readonly ServiceCategory[] | null;
  /** A message key when the read was refused or failed, else `null`. */
  readonly refused: string | null;
  /** The taxonomy did not fit in one page; the picker is incomplete. */
  readonly truncated: boolean;
  readonly add: (category: ServiceCategory) => void;
}

function useTaxonomy(): Taxonomy {
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

interface Branches {
  readonly items: readonly BranchOption[] | null;
  /** A message key when the list could not be read, else `null`. */
  readonly refused: string | null;
  /** Whether a list was even requested — false for an operator without `org.branch.read`. */
  readonly offered: boolean;
}

function useBranches(canRead: boolean): Branches {
  const [items, setItems] = useState<readonly BranchOption[] | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  useEffect(() => {
    if (!canRead) return;
    let live = true;
    void listBranches().then((state) => {
      if (!live) return;
      if (state.status === 'ok') setItems(state.data.items);
      else setRefused('services.catalogue.branchesRefused');
    });
    return () => {
      live = false;
    };
  }, [canRead]);
  return { items, refused, offered: canRead };
}

function CategoryPicker({
  messages,
  taxonomy,
  label,
  placeholder,
  value,
  onChange,
  required,
  error,
}: {
  readonly messages: Messages;
  readonly taxonomy: Taxonomy;
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly required?: boolean;
  readonly error?: string | undefined;
}) {
  const options = useMemo(
    () =>
      (taxonomy.categories ?? []).map((category) => ({
        value: category.id,
        label: `${category.code} — ${category.name}`,
      })),
    [taxonomy.categories]
  );
  const note = taxonomy.refused
    ? translateDynamic(messages, taxonomy.refused)
    : taxonomy.truncated
      ? translate(messages, 'services.catalogue.categoriesTruncated')
      : undefined;
  return (
    <SelectField
      label={label}
      {...(note ? { description: note } : {})}
      {...(required ? { required: true } : {})}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      options={options}
      placeholder={placeholder}
      error={error}
    />
  );
}

/**
 * A branch, as a list when the operator may read one and as an identifier
 * field when they may not. The two are the same question to the backend — a
 * uuid it re-authorizes — and different affordances to the operator.
 */
function BranchPicker({
  messages,
  branches,
  label,
  placeholder,
  value,
  onChange,
  error,
}: {
  readonly messages: Messages;
  readonly branches: Branches;
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly error?: string | undefined;
}) {
  if (branches.offered && branches.items !== null) {
    return (
      <SelectField
        label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        options={branches.items.map((branch) => ({
          value: branch.id,
          label: `${branch.branchCode} — ${branch.name}`,
        }))}
        placeholder={placeholder}
        error={error}
      />
    );
  }
  return (
    <TextField
      label={translate(messages, 'services.catalogue.branchIdField')}
      description={
        branches.refused
          ? translateDynamic(messages, branches.refused)
          : translate(messages, 'services.catalogue.branchIdHelp')
      }
      spellCheck={false}
      dir="ltr"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      error={error}
    />
  );
}

/* ------------------------------------------------------------------ *
 * The results
 * ------------------------------------------------------------------ */

function CatalogueResults({
  locale,
  messages,
  criteria,
  taxonomy,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly criteria: ServiceListCriteria;
  readonly taxonomy: Taxonomy;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) => listServices(criteria, request, cursor),
    [criteria]
  );
  const table = useServerTable<ServiceSummary>(load, { initial: INITIAL_REQUEST });

  const categoryName = useMemo(() => {
    const names = new Map<string, string>();
    for (const category of taxonomy.categories ?? []) names.set(category.id, category.name);
    return names;
  }, [taxonomy.categories]);

  const columns = useMemo<readonly Column<ServiceSummary>[]>(
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
        cell: (row) => <bdi>{row.name}</bdi>,
      },
      {
        id: 'category',
        headerKey: 'services.catalogue.column.category',
        cell: (row) => {
          const name = categoryName.get(row.categoryId);
          return name !== undefined ? (
            <bdi>{name}</bdi>
          ) : (
            <span className="flex flex-col">
              <code className="font-mono text-caption" dir="ltr">
                {row.categoryId}
              </code>
              <span className="text-caption text-text-muted">
                {translate(messages, 'services.catalogue.unknownCategory')}
              </span>
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
    <section aria-labelledby="service-catalogue-heading" className="flex min-h-0 flex-col gap-2">
      <h2 id="service-catalogue-heading" className="sr-only">
        {translate(messages, 'services.catalogue.resultsHeading')}
      </h2>
      <DataTable<ServiceSummary>
        messages={messages}
        columns={columns}
        rowId={(row) => row.id}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={table.setRequest}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={translate(messages, 'services.catalogue.caption')}
        suppressEmptyState
      />
      {table.response && table.response.rows.length === 0 ? (
        <p className="py-6 text-center text-body text-text-secondary" lang={locale}>
          {translate(messages, 'services.catalogue.noneMatching')}
        </p>
      ) : null}
      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'services.catalogue.orderingNote')}
      </p>
    </section>
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
  const [form, setForm] = useState({ categoryId: '', serviceCode: '', name: '', description: '' });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
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
    setErrors(found);
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
      router.push(`/${locale}/services/${result.created.id}`);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="service-create-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
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
        placeholder={translate(messages, 'services.create.chooseCategory')}
        required
        value={form.categoryId}
        onChange={(next) => setForm((f) => ({ ...f, categoryId: next }))}
        error={errorFor('categoryId')}
      />
      <TextField
        label={translate(messages, 'services.create.code')}
        description={translate(messages, 'services.create.codeHelp')}
        required
        spellCheck={false}
        dir="ltr"
        value={form.serviceCode}
        onChange={(event) => setForm((f) => ({ ...f, serviceCode: event.target.value }))}
        error={errorFor('serviceCode')}
      />
      <TextField
        label={translate(messages, 'services.create.name')}
        required
        value={form.name}
        onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
        error={errorFor('name')}
      />
      <TextAreaField
        label={translate(messages, 'services.create.description')}
        value={form.description}
        onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
        error={errorFor('description')}
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy || disabled}>
          {translate(messages, 'services.create.submit')}
        </button>
        <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
          {translate(messages, 'services.create.cancel')}
        </button>
      </div>
    </form>
  );
}

function CategoryForm({
  messages,
  taxonomy,
}: {
  readonly messages: Messages;
  readonly taxonomy: Taxonomy;
}) {
  const [form, setForm] = useState({ code: '', name: '' });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
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
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await createServiceCategory({ code, name });
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      taxonomy.add(result.created);
      setForm({ code: '', name: '' });
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="category-create-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="category-create-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'services.category.new')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'services.category.explain')}
      </p>
      <TextField
        label={translate(messages, 'services.category.code')}
        description={translate(messages, 'services.category.codeHelp')}
        required
        spellCheck={false}
        dir="ltr"
        value={form.code}
        onChange={(event) => setForm((f) => ({ ...f, code: event.target.value }))}
        error={errorFor('code')}
      />
      <TextField
        label={translate(messages, 'services.category.name')}
        required
        value={form.name}
        onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
        error={errorFor('name')}
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'services.category.submit')}
        </button>
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
