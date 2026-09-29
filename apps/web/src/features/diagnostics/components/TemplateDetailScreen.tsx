'use client';

/**
 * One inspection template (P1-29 W7): `dia.template-detail`, its versions, and
 * each version's items through `dia.template-version-item-list`. The holder of
 * `dia.catalogue.manage` renames or retires the template (`dia.template-update`,
 * version-guarded), opens a new version (`dia.template-version-create`), authors
 * items on a DRAFT version (`dia.template-item-create`) and publishes or retires
 * a version (`dia.template-version-status-set`).
 *
 * A published version is frozen: the backend refuses new items on it, and this
 * screen does not offer the form. There is no edit and no delete of an item
 * because no such operation exists — "create a new version to change what an
 * inspection asks" is the backend's own refusal text, and it is the rule here.
 *
 * ## On the shared Material wrappers (ADR-022, Owner directive slice 4)
 *
 * - The template's name and status are an EDIT of a stored record, so the form
 *   rides `useEditBaseline`: the baseline's version is the `If-Match`, a
 *   refresh arriving while the form is dirty neither moves the version nor
 *   overwrites what was typed, a conflict offers "Load the latest version", a
 *   discard re-bases on what is stored, and a save leaves the form clean — no
 *   prompt after it. Its submit stays busy until the template has been read
 *   again.
 * - Publishing freezes a version and retiring withdraws it; both are asked
 *   first (`ConfirmDialog`).
 * - Every form is `forms/mui/*` with the `FieldFrame` contract, and holds its
 *   typed work as unsaved work until it is stored.
 */
import { useCallback, useState } from 'react';
import Button from '@mui/material/Button';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { FormCheckboxField } from '@/components/forms/mui/FormCheckboxField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import { useReread } from '@/lib/api/use-reread';
import type { ReadFailureStatus } from '@/lib/api/read-operation';
import type { ActionState } from '@/lib/forms/action-result';
import { useEditBaseline } from '@/lib/forms/use-edit-baseline';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import {
  createItem,
  createVersion,
  listVersionItems,
  readTemplate,
  setVersionStatus,
  updateTemplate,
} from '../api';
import {
  unattachedRefusalKey,
  type TemplateDetail,
  type TemplateVersion,
} from '../diagnostics-contract';
import { useHeldRefusal } from '@/lib/forms/use-local-refusal';

const RESPONSE_TYPES = ['numeric', 'text', 'boolean', 'select'] as const;
type ResponseType = (typeof RESPONSE_TYPES)[number];
const TEMPLATE_STATUSES = ['active', 'inactive'] as const;

function problemKeyOf(result: ActionState): string {
  if (result.status === 'conflict') return 'diagnostics.template.conflict';
  return result.messageKey ?? 'action.failed';
}

/** A form's one submit, saying "Working…" while its write — and its re-read — is in flight. */
function Submit({
  messages,
  pending,
  labelKey,
  variant = 'contained',
  disabled = false,
}: {
  readonly messages: Messages;
  readonly pending: boolean;
  readonly labelKey: string;
  readonly variant?: 'contained' | 'outlined';
  readonly disabled?: boolean;
}) {
  return (
    <Button
      type="submit"
      variant={variant}
      disabled={pending || disabled}
      aria-busy={pending || undefined}
    >
      {pending ? translate(messages, 'form.pending') : translateDynamic(messages, labelKey)}
    </Button>
  );
}

function Problem({
  messages,
  problem,
  onReload,
}: {
  readonly messages: Messages;
  readonly problem: string | null;
  readonly onReload?: (() => void) | undefined;
}) {
  if (problem === null) return null;
  return (
    <div className="flex basis-full flex-wrap items-center gap-3">
      <p role="alert" className="text-body text-error">
        {translateDynamic(messages, problem)}
      </p>
      {onReload !== undefined && problem === 'diagnostics.template.conflict' ? (
        <Button type="button" variant="outlined" size="small" onClick={onReload}>
          {translate(messages, 'form.loadLatest')}
        </Button>
      ) : null}
    </div>
  );
}

export function TemplateDetailScreen({
  locale,
  messages,
  templateId,
  initial,
  canManage,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly templateId: string;
  readonly initial: TemplateDetail;
  readonly canManage: boolean;
}) {
  const [detail, setDetail] = useState<TemplateDetail>(initial);
  const [readProblem, setReadProblem] = useState<{
    readonly status: ReadFailureStatus;
    readonly correlationId: string | null;
  } | null>(null);
  const [openVersionId, setOpenVersionId] = useState<string | null>(
    initial.versions[0]?.id ?? null
  );

  /** Reads the template again; every command here waits for it before it lets go. */
  const reload = useCallback(async (): Promise<void> => {
    const next = await readTemplate(templateId);
    if (next.status === 'ok') {
      setDetail(next.data);
      setReadProblem(null);
      return;
    }
    // The last template read stays on screen, and the failure says so.
    setReadProblem({ status: next.status, correlationId: next.correlationId });
  }, [templateId]);

  const openVersion = detail.versions.find((v) => v.id === openVersionId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="template-heading"
        className="rounded-lg border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 id="template-heading" className="text-section-title font-medium text-text-primary">
            <bdi>{detail.template.name}</bdi>
          </h2>
          <code className="font-mono text-caption" dir="ltr">
            {detail.template.code}
          </code>
          <span className="text-caption text-text-muted">
            {translateDynamic(messages, `diagnostics.templateStatus.${detail.template.status}`)}
          </span>
        </div>
        {readProblem === null ? null : (
          <div className="mt-2">
            <MuiReadFailureState
              messages={messages}
              locale={locale}
              status={readProblem.status}
              correlationId={readProblem.correlationId}
              onRetry={() => void reload()}
            />
          </div>
        )}
        {canManage ? (
          <TemplateSettingsForm
            messages={messages}
            templateId={templateId}
            name={detail.template.name}
            status={detail.template.status}
            recordVersion={detail.template.recordVersion}
            onDone={reload}
          />
        ) : null}
      </section>

      <section
        aria-labelledby="versions-heading"
        className="rounded-lg border border-border bg-surface p-4"
      >
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 id="versions-heading" className="text-section-title font-medium text-text-primary">
            {translate(messages, 'diagnostics.template.versionsHeading')}
          </h2>
          {canManage ? (
            <NewVersionForm
              messages={messages}
              templateId={templateId}
              versions={detail.versions}
              onDone={reload}
            />
          ) : null}
        </div>
        {detail.versions.length === 0 ? (
          <p className="text-body text-text-secondary">
            {translate(messages, 'diagnostics.template.noVersions')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.versions.map((version) => {
              const open = openVersionId === version.id;
              const versionName = `${translate(messages, 'diagnostics.template.version')} ${version.versionNumber}`;
              return (
                <li key={version.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <span className="text-body font-medium text-text-primary">{versionName}</span>
                    <span className="text-caption text-text-muted">
                      {translateDynamic(messages, `diagnostics.versionStatus.${version.status}`)}
                    </span>
                    <span className="text-caption text-text-muted">
                      {translate(messages, 'diagnostics.template.itemCount')}: {version.itemCount}
                    </span>
                    {version.publishedAt ? (
                      <span className="text-caption text-text-muted">
                        {translate(messages, 'diagnostics.template.publishedAt')}{' '}
                        <bdi>{formatDateTime(version.publishedAt, locale)}</bdi>
                      </span>
                    ) : null}
                    <Button
                      type="button"
                      size="small"
                      variant="text"
                      onClick={() => setOpenVersionId(open ? null : version.id)}
                      aria-expanded={open}
                      className="ms-auto"
                    >
                      {translate(
                        messages,
                        open ? 'diagnostics.template.closeItems' : 'diagnostics.template.openItems'
                      )}
                      <span className="sr-only"> — {versionName}</span>
                    </Button>
                  </div>
                  {openVersion?.id === version.id ? (
                    <VersionItems
                      locale={locale}
                      messages={messages}
                      version={version}
                      canManage={canManage}
                      onChanged={reload}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

interface SettingsDraft {
  readonly name: string;
  readonly status: string;
}

function TemplateSettingsForm({
  messages,
  templateId,
  name,
  status,
  recordVersion,
  onDone,
}: {
  readonly messages: Messages;
  readonly templateId: string;
  readonly name: string;
  readonly status: string;
  readonly recordVersion: number;
  readonly onDone: () => Promise<void>;
}) {
  /*
   * What is stored and the version it is stored at. A clean form follows the
   * template as it is read again; a form holding typed work keeps the version
   * its work was based on, and a save sends that one.
   */
  const edit = useEditBaseline<SettingsDraft>({
    stored: { name, status },
    storedVersion: recordVersion,
    differs: (values, baseline) =>
      values.name.trim() !== baseline.name.trim() || values.status !== baseline.status,
  });
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const { errors, formRef } = useHeldRefusal(fieldErrors, { ...edit.values });

  // Typed work is unsaved: a branch switch or leaving the page asks, and a
  // confirmed discard puts back what is stored.
  useUnsavedGuard(edit.dirty, () => {
    edit.discard();
    setProblem(null);
    setFieldErrors({});
  });

  const save = async () => {
    setProblem(null);
    if (edit.values.name.trim().length === 0) {
      setFieldErrors({ name: 'field.required' });
      return;
    }
    const body = {
      ...(edit.values.name.trim() !== edit.baseline.name ? { name: edit.values.name.trim() } : {}),
      ...(edit.values.status !== edit.baseline.status
        ? { status: edit.values.status as 'active' | 'inactive' }
        : {}),
    };
    if (Object.keys(body).length === 0) {
      setProblem('diagnostics.template.nothingChanged');
      return;
    }
    setFieldErrors({});
    setPending(true);
    try {
      let outcome: ActionState;
      try {
        // The BASELINE's version: work built on a template that has since moved
        // is the server's conflict, never a silent overwrite.
        outcome = await updateTemplate(templateId, body, edit.version);
      } catch {
        setProblem('state.unavailable.message');
        return;
      }
      notifyActionResult(outcome, messages);
      if (outcome.status === 'success') {
        // Stored: clean on what was written; the re-read brings the version.
        edit.rebase({ name: edit.values.name.trim(), status: edit.values.status });
        await onDone();
        return;
      }
      setFieldErrors(outcome.fieldErrors ?? {});
      setProblem(problemKeyOf(outcome));
    } finally {
      setPending(false);
    }
  };

  /** The conflict's way out: what is stored now replaces the stale work. */
  const loadLatest = async () => {
    setPending(true);
    try {
      edit.discard();
      setProblem(null);
      setFieldErrors({});
      await onDone();
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        void save();
      }}
      className="mt-3 flex flex-wrap items-start gap-3"
    >
      <FormTextField
        name="name"
        label={translate(messages, 'diagnostics.catalogue.name')}
        value={edit.values.name}
        onChange={(value) => edit.setValues((current) => ({ ...current, name: value }))}
        error={errors['name'] ? translateDynamic(messages, errors['name']) : undefined}
        required
      />
      <FormSelectField
        name="status"
        label={translate(messages, 'diagnostics.catalogue.filterStatus')}
        value={edit.values.status}
        onChange={(value) => edit.setValues((current) => ({ ...current, status: value }))}
        options={TEMPLATE_STATUSES.map((value) => ({
          value,
          label: translate(messages, `diagnostics.templateStatus.${value}`),
        }))}
        error={errors['status'] ? translateDynamic(messages, errors['status']) : undefined}
      />
      <Submit
        messages={messages}
        pending={pending}
        labelKey="diagnostics.template.save"
        variant="outlined"
      />
      <Problem messages={messages} problem={problem} onReload={() => void loadLatest()} />
    </form>
  );
}

function NewVersionForm({
  messages,
  templateId,
  versions,
  onDone,
}: {
  readonly messages: Messages;
  readonly templateId: string;
  readonly versions: readonly TemplateVersion[];
  readonly onDone: () => Promise<void>;
}) {
  const [copyFromVersionId, setCopyFromVersionId] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /**
   * `body.copyFromVersionId` — the version chosen to copy from belongs to
   * another checklist. The sentence belongs beside the control that holds the
   * choice, and the choice itself is kept so the reader can see what they
   * picked while they pick again.
   */
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  // Question f: the cursor goes to the first refused field, and a complaint
  // goes once its field changes (route sweep B3).
  const { errors: fieldErrorsRefusalErrors, formRef: fieldErrorsRefusalFormRef } = useHeldRefusal(
    fieldErrors,
    { copyFromVersionId }
  );

  const submit = async () => {
    setPending(true);
    setProblem(null);
    setFieldErrors({});
    try {
      let outcome: ActionState;
      try {
        outcome = await createVersion(templateId, copyFromVersionId ? { copyFromVersionId } : {});
      } catch {
        setProblem('state.unavailable.message');
        return;
      }
      notifyActionResult(outcome, messages);
      if (outcome.status === 'success') {
        setCopyFromVersionId('');
        await onDone();
        return;
      }
      setFieldErrors(outcome.fieldErrors ?? {});
      setProblem(problemKeyOf(outcome));
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      ref={fieldErrorsRefusalFormRef}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        void submit();
      }}
      className="flex flex-wrap items-start gap-3"
    >
      <FormSelectField
        name="copyFromVersionId"
        label={translate(messages, 'diagnostics.template.copyFrom')}
        value={copyFromVersionId}
        onChange={setCopyFromVersionId}
        options={versions.map((version) => ({
          value: version.id,
          label: `${translate(messages, 'diagnostics.template.version')} ${version.versionNumber}`,
        }))}
        placeholder={translate(messages, 'diagnostics.template.startEmpty')}
        error={
          fieldErrorsRefusalErrors['copyFromVersionId']
            ? translateDynamic(messages, fieldErrorsRefusalErrors['copyFromVersionId'])
            : undefined
        }
      />
      <Submit messages={messages} pending={pending} labelKey="diagnostics.template.newVersion" />
      <Problem messages={messages} problem={problem} />
    </form>
  );
}

function VersionItems({
  locale,
  messages,
  version,
  canManage,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly version: TemplateVersion;
  readonly canManage: boolean;
  readonly onChanged: () => Promise<void>;
}) {
  const readItems = useCallback(() => listVersionItems(version.id), [version.id]);
  const items = useReread(readItems);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState<'published' | 'retired' | null>(null);

  const move = async (toStatus: 'published' | 'retired') => {
    setPending(true);
    setProblem(null);
    try {
      let outcome: ActionState;
      try {
        outcome = await setVersionStatus(version.id, { toStatus }, version.recordVersion);
      } catch {
        setProblem('state.unavailable.message');
        return;
      }
      notifyActionResult(outcome, messages);
      if (outcome.status === 'success') {
        await onChanged();
        return;
      }
      /*
       * Publishing an empty version is refused against `versionId`, which is a
       * button and not a box, so the sentence saying to add an item first had
       * nowhere to appear. It is shown here beside the button that raised it.
       */
      setProblem(unattachedRefusalKey(outcome.fieldErrors, []) ?? problemKeyOf(outcome));
    } finally {
      setPending(false);
      setAsking(null);
    }
  };

  const list = items.value;

  return (
    <div className="mt-3 flex flex-col gap-3">
      {list === null ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : list.status !== 'ok' ? (
        <MuiReadFailureState
          messages={messages}
          locale={locale}
          status={list.status}
          correlationId={list.correlationId}
          onRetry={() => void items.reload()}
        />
      ) : list.data.items.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'diagnostics.template.noItems')}
        </p>
      ) : (
        <ol className="flex flex-col gap-1">
          {list.data.items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-baseline gap-x-3 rounded-md bg-surface-subtle px-3 py-2"
            >
              <span className="text-caption text-text-muted">{item.sequence}.</span>
              <span className="text-body text-text-primary">
                <bdi>{item.prompt}</bdi>
              </span>
              <code className="font-mono text-caption" dir="ltr">
                {item.itemCode}
              </code>
              <span className="text-caption text-text-muted">
                {translateDynamic(messages, `diagnostics.responseType.${item.responseType}`)}
                {item.unit ? ` · ${item.unit}` : ''}
              </span>
              {item.isMandatory ? (
                <span className="text-caption text-text-muted">
                  {translate(messages, 'diagnostics.template.mandatory')}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {canManage && version.status === 'draft' ? (
        <NewItemForm
          messages={messages}
          versionId={version.id}
          onDone={async () => {
            await Promise.all([items.reload(), onChanged()]);
          }}
        />
      ) : null}

      {canManage ? (
        <div className="flex flex-wrap items-center gap-3">
          {version.status === 'draft' ? (
            <Button
              type="button"
              variant="contained"
              onClick={() => setAsking('published')}
              disabled={pending}
            >
              {translate(messages, 'diagnostics.template.publish')}
            </Button>
          ) : null}
          {version.status === 'published' ? (
            <Button
              type="button"
              variant="outlined"
              onClick={() => setAsking('retired')}
              disabled={pending}
            >
              {translate(messages, 'diagnostics.template.retire')}
            </Button>
          ) : null}
          <Problem messages={messages} problem={problem} onReload={() => void onChanged()} />
        </div>
      ) : null}
      <ConfirmDialog
        open={asking !== null}
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          if (asking !== null) void move(asking);
        }}
        title={translate(
          messages,
          asking === 'retired'
            ? 'diagnostics.template.confirmRetireTitle'
            : 'diagnostics.template.confirmPublishTitle'
        )}
        description={translate(
          messages,
          asking === 'retired'
            ? 'diagnostics.template.confirmRetireBody'
            : 'diagnostics.template.confirmPublishBody'
        )}
        confirmLabel={translate(
          messages,
          asking === 'retired' ? 'diagnostics.template.retire' : 'diagnostics.template.publish'
        )}
        messages={messages}
        destructive={asking === 'retired'}
        pending={pending}
        testId="version-status-confirm"
      />
    </div>
  );
}

interface ItemDraft {
  readonly itemCode: string;
  readonly prompt: string;
  readonly responseType: string;
  readonly unit: string;
  readonly isMandatory: boolean;
}

const EMPTY_ITEM: ItemDraft = {
  itemCode: '',
  prompt: '',
  responseType: '',
  unit: '',
  isMandatory: false,
};

function NewItemForm({
  messages,
  versionId,
  onDone,
}: {
  readonly messages: Messages;
  readonly versionId: string;
  readonly onDone: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<ItemDraft>(EMPTY_ITEM);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  // Question f: the cursor goes to the first refused field, and a complaint
  // goes once its field changes (route sweep B3).
  const { errors: fieldErrorsRefusalErrors, formRef: fieldErrorsRefusalFormRef } = useHeldRefusal(
    fieldErrors,
    {
      itemCode: draft.itemCode,
      prompt: draft.prompt,
      responseType: draft.responseType,
      unit: draft.unit,
    }
  );
  useUnsavedGuard(
    draft.itemCode.trim().length > 0 ||
      draft.prompt.trim().length > 0 ||
      draft.responseType !== '' ||
      draft.unit.trim().length > 0 ||
      draft.isMandatory,
    () => {
      setDraft(EMPTY_ITEM);
      setFieldErrors({});
      setProblem(null);
    }
  );

  const errorFor = (field: string): string | undefined => {
    const key = fieldErrorsRefusalErrors[field];
    return key ? translateDynamic(messages, key) : undefined;
  };
  const set = <K extends keyof ItemDraft>(field: K, value: ItemDraft[K]) =>
    setDraft((current) => ({ ...current, [field]: value }));

  const submit = async () => {
    setProblem(null);
    const errors: Record<string, string> = {};
    if (draft.itemCode.trim().length === 0) errors['itemCode'] = 'field.required';
    if (draft.prompt.trim().length === 0) errors['prompt'] = 'field.required';
    if (draft.responseType.length === 0) errors['responseType'] = 'field.required';
    if (draft.responseType === 'numeric' && draft.unit.trim().length === 0) {
      errors['unit'] = 'diagnostics.template.unitRequired';
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setPending(true);
    try {
      let outcome: ActionState;
      try {
        outcome = await createItem(versionId, {
          itemCode: draft.itemCode.trim(),
          prompt: draft.prompt.trim(),
          responseType: draft.responseType as ResponseType,
          ...(draft.unit.trim().length > 0 ? { unit: draft.unit.trim() } : {}),
          ...(draft.isMandatory ? { isMandatory: true } : {}),
        });
      } catch {
        setProblem('state.unavailable.message');
        return;
      }
      notifyActionResult(outcome, messages);
      if (outcome.status === 'success') {
        setDraft(EMPTY_ITEM);
        await onDone();
        return;
      }
      if (outcome.fieldErrors) setFieldErrors(outcome.fieldErrors);
      setProblem(problemKeyOf(outcome));
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      ref={fieldErrorsRefusalFormRef}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        void submit();
      }}
      className="grid gap-3 rounded-md border border-dashed border-border p-3 sm:grid-cols-2"
    >
      <FormTextField
        name="itemCode"
        label={translate(messages, 'diagnostics.template.itemCode')}
        description={translate(messages, 'diagnostics.template.itemCodeHint')}
        value={draft.itemCode}
        onChange={(value) => set('itemCode', value)}
        error={errorFor('itemCode')}
        required
        dir="ltr"
        autoComplete="off"
      />
      <FormTextField
        name="prompt"
        label={translate(messages, 'diagnostics.template.prompt')}
        value={draft.prompt}
        onChange={(value) => set('prompt', value)}
        error={errorFor('prompt')}
        required
      />
      <FormSelectField
        name="responseType"
        label={translate(messages, 'diagnostics.template.responseType')}
        value={draft.responseType}
        onChange={(value) => set('responseType', value)}
        options={RESPONSE_TYPES.map((value) => ({
          value,
          label: translate(messages, `diagnostics.responseType.${value}`),
        }))}
        placeholder={translate(messages, 'diagnostics.template.chooseResponseType')}
        error={errorFor('responseType')}
        required
      />
      <FormTextField
        name="unit"
        label={translate(messages, 'diagnostics.template.unit')}
        description={translate(messages, 'diagnostics.template.unitHint')}
        value={draft.unit}
        onChange={(value) => set('unit', value)}
        error={errorFor('unit')}
        dir="ltr"
      />
      <FormCheckboxField
        name="isMandatory"
        label={translate(messages, 'diagnostics.template.mandatory')}
        checked={draft.isMandatory}
        onChange={(checked) => set('isMandatory', checked)}
      />
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Submit messages={messages} pending={pending} labelKey="diagnostics.template.addItem" />
        <Problem messages={messages} problem={problem} />
      </div>
    </form>
  );
}
