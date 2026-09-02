'use client';

/**
 * The inspection-template catalogue (P1-29 W7): `dia.template-list` with its
 * two filters, and `dia.template-create` for the holder of
 * `dia.catalogue.manage`.
 *
 * The create form needs a diagnostic type, and the vocabulary is whatever
 * `dia.diagnostic-type-list` answers — which, while no approved content exists,
 * is `[]`. That renders as an honest statement that no type is configured and
 * the form stays closed; it does not render a default the Owner never approved.
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { SelectField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { EmptyState } from '@/components/states/States';
import type { CursorPage, ItemsOnly, ReadState } from '@/lib/api/read-operation';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { createTemplate, listDiagnosticTypes, listTemplates } from '../api';
import type { DiagnosticType, InspectionTemplateListRow } from '../diagnostics-contract';

const PRIMARY_BUTTON =
  'rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover disabled:opacity-60';
const SECONDARY_BUTTON =
  'rounded-md border border-border px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle disabled:opacity-60';

const TEMPLATE_STATUSES = ['active', 'inactive'] as const;

function ReadProblem({
  messages,
  state,
}: {
  readonly messages: Messages;
  readonly state: { readonly status: string; readonly correlationId: string | null };
}) {
  return (
    <p role="alert" className="text-body text-error">
      {translateDynamic(messages, `state.${state.status}.title`)}
      {state.correlationId
        ? ` ${translate(messages, 'action.reference')} ${state.correlationId}`
        : ''}
    </p>
  );
}

export function TemplateCatalogueScreen({
  locale,
  messages,
  canManage,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly canManage: boolean;
}) {
  const [types, setTypes] = useState<ReadState<ItemsOnly<DiagnosticType>> | null>(null);
  const [status, setStatus] = useState<string>('');
  const [pages, setPages] = useState<readonly CursorPage<InspectionTemplateListRow>[]>([]);
  const [failure, setFailure] = useState<ReadState<never> | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);
  const reload = useCallback(() => setReloadCount((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    void listDiagnosticTypes().then((next) => {
      if (!cancelled) setTypes(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPages([]);
    setFailure(null);
    void listTemplates(status ? { status } : {}, null).then((next) => {
      if (cancelled) return;
      setLoading(false);
      if (next.status === 'ok') setPages([next.data]);
      else setFailure(next as ReadState<never>);
    });
    return () => {
      cancelled = true;
    };
  }, [status, reloadCount]);

  const last = pages.at(-1) ?? null;
  const loadMore = async () => {
    if (last === null || !last.hasMore || last.nextCursor === null) return;
    setLoading(true);
    const next = await listTemplates(status ? { status } : {}, last.nextCursor);
    setLoading(false);
    if (next.status === 'ok') setPages((current) => [...current, next.data]);
    else setFailure(next as ReadState<never>);
  };

  const typeName = (id: string): string =>
    (types?.status === 'ok' ? types.data.items.find((t) => t.id === id)?.name : undefined) ?? id;

  return (
    <div className="flex flex-col gap-6">
      {canManage ? (
        <CreateTemplateForm messages={messages} types={types} onCreated={reload} />
      ) : null}

      <section
        aria-labelledby="template-list-heading"
        className="rounded-lg border border-border bg-surface p-4"
      >
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2
            id="template-list-heading"
            className="text-section-title font-medium text-text-primary"
          >
            {translate(messages, 'diagnostics.catalogue.listHeading')}
          </h2>
          {/* A filter, not a form field: it re-reads on change and is never submitted. */}
          <SelectField
            name="status"
            label={translate(messages, 'diagnostics.catalogue.filterStatus')}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            options={TEMPLATE_STATUSES.map((value) => ({
              value,
              label: translate(messages, `diagnostics.templateStatus.${value}` as keyof Messages),
            }))}
            placeholder={translate(messages, 'diagnostics.catalogue.anyStatus')}
          />
        </div>

        {failure !== null ? (
          <ReadProblem messages={messages} state={failure} />
        ) : pages.length === 0 ? (
          <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
        ) : pages[0]?.items.length === 0 ? (
          <EmptyState
            messages={messages}
            titleKey="diagnostics.catalogue.emptyTitle"
            descriptionKey="diagnostics.catalogue.emptyBody"
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {pages.flatMap((page) =>
              page.items.map((template) => (
                <li
                  key={template.id}
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md border border-border p-3"
                >
                  <Link
                    href={`/${locale}/work-orders/diagnostics/${template.id}`}
                    className="text-body font-medium text-primary underline-offset-2 hover:underline"
                  >
                    <bdi>{template.name}</bdi>
                  </Link>
                  <code className="font-mono text-caption" dir="ltr">
                    {template.code}
                  </code>
                  <span className="text-caption text-text-muted">
                    {translateDynamic(messages, `diagnostics.templateStatus.${template.status}`)}
                  </span>
                  <span className="text-caption text-text-muted">
                    {translate(messages, 'diagnostics.catalogue.type')}:{' '}
                    <bdi>{typeName(template.diagnosticTypeId)}</bdi>
                  </span>
                  <span className="ms-auto text-caption text-text-muted">
                    {formatDateTime(template.createdAt, locale)}
                  </span>
                </li>
              ))
            )}
          </ul>
        )}

        {last !== null && last.hasMore ? (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loading}
              className={SECONDARY_BUTTON}
            >
              {translate(messages, loading ? 'state.loading' : 'diagnostics.catalogue.loadMore')}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function CreateTemplateForm({
  messages,
  types,
  onCreated,
}: {
  readonly messages: Messages;
  readonly types: ReadState<ItemsOnly<DiagnosticType>> | null;
  readonly onCreated: () => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [diagnosticTypeId, setDiagnosticTypeId] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  /*
   * The select's epoch key. React resets the form DOM once the action settles;
   * bumping the key with each attempt remounts the select on ITS default, which
   * is the value the operator chose, so a refused submit keeps their choice.
   */
  const [attempt, setAttempt] = useState(0);

  const errorFor = (field: string): string | undefined => {
    const key = fieldErrors[field];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const active =
    types?.status === 'ok' ? types.data.items.filter((t) => t.status === 'active') : [];

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
        <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
      ) : types.status !== 'ok' ? (
        <ReadProblem messages={messages} state={types} />
      ) : active.length === 0 ? (
        <EmptyState
          messages={messages}
          titleKey="diagnostics.catalogue.noTypesTitle"
          descriptionKey="diagnostics.catalogue.noTypesBody"
        />
      ) : (
        <form
          action={async () => {
            setPending(true);
            setProblem(null);
            setFieldErrors({});
            const errors: Record<string, string> = {};
            if (code.trim().length === 0) errors['code'] = 'field.required';
            if (name.trim().length === 0) errors['name'] = 'field.required';
            if (diagnosticTypeId.length === 0) errors['diagnosticTypeId'] = 'field.required';
            if (Object.keys(errors).length > 0) {
              setFieldErrors(errors);
              setPending(false);
              setAttempt((n) => n + 1);
              return;
            }
            const outcome = await createTemplate({
              code: code.trim(),
              name: name.trim(),
              diagnosticTypeId,
            });
            setPending(false);
            setAttempt((n) => n + 1);
            notifyActionResult(outcome, messages);
            if (outcome.status === 'success') {
              setCode('');
              setName('');
              setDiagnosticTypeId('');
              onCreated();
              return;
            }
            if (outcome.fieldErrors) setFieldErrors(outcome.fieldErrors);
            setProblem(outcome.messageKey ?? 'action.failed');
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <TextField
            name="code"
            label={translate(messages, 'diagnostics.catalogue.code')}
            description={translate(messages, 'diagnostics.catalogue.codeHint')}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            error={errorFor('code')}
            required
            dir="ltr"
          />
          <TextField
            name="name"
            label={translate(messages, 'diagnostics.catalogue.name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={errorFor('name')}
            required
          />
          <SelectField
            key={`diagnosticTypeId-${attempt}`}
            name="diagnosticTypeId"
            label={translate(messages, 'diagnostics.catalogue.type')}
            defaultValue={diagnosticTypeId}
            onChange={(event) => setDiagnosticTypeId(event.target.value)}
            options={active.map((type) => ({ value: type.id, label: type.name }))}
            placeholder={translate(messages, 'diagnostics.catalogue.chooseType')}
            error={errorFor('diagnosticTypeId')}
            required
          />
          <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
            {translate(
              messages,
              pending ? 'diagnostics.catalogue.creating' : 'diagnostics.catalogue.create'
            )}
          </button>
          {problem === null ? null : (
            <p role="alert" className="basis-full text-body text-error">
              {translateDynamic(messages, problem)}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
