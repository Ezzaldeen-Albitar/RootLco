'use client';

/**
 * The inspection-template catalogue (P1-29 W7): `dia.template-list` with its
 * status filter, and `dia.template-create` for the holder of
 * `dia.catalogue.manage`.
 *
 * The create form needs a diagnostic type, and the vocabulary is whatever
 * `dia.diagnostic-type-list` answers — which, while no approved content exists,
 * is `[]`. That renders as an honest statement that no type is configured and
 * the form stays closed; it does not render a default the Owner never approved.
 *
 * ## On the shared Material wrappers (ADR-022, Owner directive slice 4)
 *
 * The list is `OperationalGrid` over `useServerTable`: server mode, no count,
 * the cursor footer, and the grid's own refused, unavailable (with a retry),
 * ended-session and failed states. The status filter is a `FormSelectField`
 * whose value is the read's key, so a change goes back to page one. A template
 * is named by its name, and its type by the type's name — never a reference.
 * The create form is `FormTextField` / `FormSelectField`: each missing field is
 * refused on itself with the cursor moved to the first, a complaint goes once
 * its field changes, and what was typed survives a refusal. Typed work is
 * unsaved work until it is stored.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  OperationalGrid,
  type OperationalColumn,
  type RowAction,
} from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable, type ServerPage } from '@/components/data-table/use-server-table';
import Button from '@mui/material/Button';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiEmptyState, MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import { useReread } from '@/lib/api/use-reread';
import type { ItemsOnly, ReadState } from '@/lib/api/read-operation';
import type { ActionState } from '@/lib/forms/action-result';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { createTemplate, listDiagnosticTypes, listTemplates } from '../api';
import type { DiagnosticType, InspectionTemplateListRow } from '../diagnostics-contract';
import { useHeldRefusal } from '@/lib/forms/use-local-refusal';

const TEMPLATE_STATUSES = ['active', 'inactive'] as const;

export function TemplateCatalogueScreen({
  locale,
  messages,
  canManage,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly canManage: boolean;
}) {
  const types = useReread(listDiagnosticTypes);
  const [status, setStatus] = useState<string>('');

  const load = useCallback(
    async (
      request: TableRequest,
      cursor: string | null
    ): Promise<ServerPage<InspectionTemplateListRow>> => {
      const read = await listTemplates(
        { ...(status ? { status } : {}), limit: request.pageSize },
        cursor
      );
      if (read.status !== 'ok') {
        return {
          status: read.status,
          rows: [],
          nextCursor: null,
          hasMore: false,
          correlationId: read.correlationId,
        };
      }
      return {
        status: 'ok',
        rows: read.data.items,
        nextCursor: read.data.nextCursor,
        hasMore: read.data.hasMore,
        correlationId: read.correlationId,
      };
    },
    [status]
  );
  // The status filter lives OUTSIDE the table request, so it is the read's key.
  const table = useServerTable<InspectionTemplateListRow>(load, {
    initial: INITIAL_REQUEST,
    loadKey: status,
  });

  const typeRead = types.value;
  const typeName = useCallback(
    (id: string): string =>
      (typeRead?.status === 'ok'
        ? typeRead.data.items.find((t) => t.id === id)?.name
        : undefined) ?? translate(messages, 'diagnostics.catalogue.typeUnknown'),
    [typeRead, messages]
  );

  const columns = useMemo<readonly OperationalColumn<InspectionTemplateListRow>[]>(
    () => [
      {
        id: 'name',
        headerKey: 'diagnostics.catalogue.name',
        flex: 2,
        cell: (row) => <bdi className="font-medium">{row.name}</bdi>,
      },
      {
        id: 'code',
        headerKey: 'diagnostics.catalogue.code',
        hideBelow: 'md',
        cell: (row) => (
          <code className="font-mono text-caption" dir="ltr">
            {row.code}
          </code>
        ),
      },
      {
        id: 'status',
        headerKey: 'diagnostics.catalogue.filterStatus',
        cell: (row) => translateDynamic(messages, `diagnostics.templateStatus.${row.status}`),
      },
      {
        id: 'type',
        headerKey: 'diagnostics.catalogue.type',
        cell: (row) => <bdi>{typeName(row.diagnosticTypeId)}</bdi>,
      },
      {
        id: 'createdAt',
        headerKey: 'diagnostics.catalogue.created',
        hideBelow: 'md',
        cell: (row) => <bdi>{formatDateTime(row.createdAt, locale)}</bdi>,
      },
    ],
    [locale, messages, typeName]
  );

  const rowActions = useCallback(
    (row: InspectionTemplateListRow): readonly RowAction[] => [
      {
        kind: 'link',
        label: translate(messages, 'diagnostics.catalogue.open'),
        href: `/${locale}/work-orders/diagnostics/${row.id}`,
        about: row.name,
      },
    ],
    [locale, messages]
  );

  return (
    <div className="flex flex-col gap-6">
      {canManage ? (
        <CreateTemplateForm
          locale={locale}
          messages={messages}
          types={typeRead}
          onRetryTypes={() => void types.reload()}
          onCreated={() => table.refresh()}
        />
      ) : null}

      <section
        aria-labelledby="template-list-heading"
        className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2
            id="template-list-heading"
            className="text-section-title font-medium text-text-primary"
          >
            {translate(messages, 'diagnostics.catalogue.listHeading')}
          </h2>
          {/* A filter, not a form field: it re-reads on change and is never submitted. */}
          <FormSelectField
            name="status"
            label={translate(messages, 'diagnostics.catalogue.filterStatus')}
            value={status}
            onChange={setStatus}
            options={TEMPLATE_STATUSES.map((value) => ({
              value,
              label: translate(messages, `diagnostics.templateStatus.${value}`),
            }))}
            placeholder={translate(messages, 'diagnostics.catalogue.anyStatus')}
            testId="template-status-filter"
          />
        </div>
        <OperationalGrid<InspectionTemplateListRow>
          messages={messages}
          locale={locale}
          label={translate(messages, 'diagnostics.catalogue.listHeading')}
          columns={columns}
          rowId={(row) => row.id}
          table={table}
          rowActions={rowActions}
          // The status filter lives outside the request, so the grid's own empty
          // state cannot tell "none yet" from "none with this status": the screen says it.
          suppressEmptyState
          testId="template-grid"
        />
        {table.status === 'idle' && table.response && table.response.rows.length === 0 ? (
          status ? (
            <MuiEmptyState
              messages={messages}
              titleKey="diagnostics.catalogue.noneMatchingTitle"
              descriptionKey="diagnostics.catalogue.noneMatchingBody"
              testId="template-none-matching"
            />
          ) : (
            <MuiEmptyState
              messages={messages}
              titleKey="diagnostics.catalogue.emptyTitle"
              descriptionKey="diagnostics.catalogue.emptyBody"
              testId="template-empty"
            />
          )
        ) : null}
      </section>
    </div>
  );
}

interface TemplateDraft {
  readonly code: string;
  readonly name: string;
  readonly diagnosticTypeId: string;
}

const EMPTY_TEMPLATE: TemplateDraft = { code: '', name: '', diagnosticTypeId: '' };

function CreateTemplateForm({
  locale,
  messages,
  types,
  onRetryTypes,
  onCreated,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly types: ReadState<ItemsOnly<DiagnosticType>> | null;
  readonly onRetryTypes: () => void;
  readonly onCreated: () => void;
}) {
  const [draft, setDraft] = useState<TemplateDraft>(EMPTY_TEMPLATE);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  // Question f: the cursor goes to the first refused field, and a complaint goes
  // once its field changes (route sweep B3).
  const { errors: refusalErrors, formRef: refusalFormRef } = useHeldRefusal(fieldErrors, {
    ...draft,
  });
  useUnsavedGuard(
    draft.code.trim().length > 0 || draft.name.trim().length > 0 || draft.diagnosticTypeId !== '',
    () => {
      setDraft(EMPTY_TEMPLATE);
      setFieldErrors({});
      setProblem(null);
    }
  );

  const errorFor = (field: string): string | undefined => {
    const key = refusalErrors[field];
    return key ? translateDynamic(messages, key) : undefined;
  };
  const set = (field: keyof TemplateDraft) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));

  const active =
    types?.status === 'ok' ? types.data.items.filter((t) => t.status === 'active') : [];

  const submit = async () => {
    setProblem(null);
    const errors: Record<string, string> = {};
    if (draft.code.trim().length === 0) errors['code'] = 'field.required';
    if (draft.name.trim().length === 0) errors['name'] = 'field.required';
    if (draft.diagnosticTypeId.length === 0) errors['diagnosticTypeId'] = 'field.required';
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setPending(true);
    try {
      let outcome: ActionState;
      try {
        outcome = await createTemplate({
          code: draft.code.trim(),
          name: draft.name.trim(),
          diagnosticTypeId: draft.diagnosticTypeId,
        });
      } catch {
        setProblem('state.unavailable.message');
        return;
      }
      notifyActionResult(outcome, messages);
      if (outcome.status === 'success') {
        setDraft(EMPTY_TEMPLATE);
        onCreated();
        return;
      }
      if (outcome.fieldErrors) setFieldErrors(outcome.fieldErrors);
      setProblem(outcome.messageKey ?? 'action.failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      aria-labelledby="template-create-heading"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <h2
        id="template-create-heading"
        className="mb-3 text-section-title font-medium text-text-primary"
      >
        {translate(messages, 'diagnostics.catalogue.createHeading')}
      </h2>
      {types === null ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : types.status !== 'ok' ? (
        <MuiReadFailureState
          messages={messages}
          locale={locale}
          status={types.status}
          correlationId={types.correlationId}
          onRetry={onRetryTypes}
        />
      ) : active.length === 0 ? (
        <MuiEmptyState
          messages={messages}
          titleKey="diagnostics.catalogue.noTypesTitle"
          descriptionKey="diagnostics.catalogue.noTypesBody"
        />
      ) : (
        <form
          ref={refusalFormRef}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (pending) return;
            void submit();
          }}
          className="grid gap-3 sm:grid-cols-3"
        >
          <FormTextField
            name="code"
            label={translate(messages, 'diagnostics.catalogue.code')}
            description={translate(messages, 'diagnostics.catalogue.codeHint')}
            value={draft.code}
            onChange={set('code')}
            error={errorFor('code')}
            required
            dir="ltr"
            autoComplete="off"
          />
          <FormTextField
            name="name"
            label={translate(messages, 'diagnostics.catalogue.name')}
            value={draft.name}
            onChange={set('name')}
            error={errorFor('name')}
            required
          />
          <FormSelectField
            name="diagnosticTypeId"
            label={translate(messages, 'diagnostics.catalogue.type')}
            value={draft.diagnosticTypeId}
            onChange={set('diagnosticTypeId')}
            options={active.map((type) => ({ value: type.id, label: type.name }))}
            placeholder={translate(messages, 'diagnostics.catalogue.chooseType')}
            error={errorFor('diagnosticTypeId')}
            required
          />
          <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
            <Button
              type="submit"
              variant="contained"
              disabled={pending}
              aria-busy={pending || undefined}
            >
              {translate(
                messages,
                pending ? 'diagnostics.catalogue.creating' : 'diagnostics.catalogue.create'
              )}
            </Button>
            {problem === null ? null : (
              <p role="alert" className="text-body text-error">
                {translateDynamic(messages, problem)}
              </p>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
