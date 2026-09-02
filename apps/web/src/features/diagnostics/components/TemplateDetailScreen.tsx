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
 * Every select and checkbox inside a `<form action>` carries the epoch-key shape
 * (`key` from the form's `attempt`, `defaultValue`/`defaultChecked`, `onChange`):
 * React resets the form DOM once the action settles, and that shape is the one
 * measured to keep the operator's choice when the write is refused.
 */
import { useCallback, useEffect, useState } from 'react';
import { CheckboxField, SelectField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { ItemsOnly, ReadState } from '@/lib/api/read-operation';
import type { ActionState } from '@/lib/forms/action-result';
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
import type { TemplateDetail, TemplateItem, TemplateVersion } from '../diagnostics-contract';

const PRIMARY_BUTTON =
  'rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover disabled:opacity-60';
const SECONDARY_BUTTON =
  'rounded-md border border-border px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle disabled:opacity-60';

const RESPONSE_TYPES = ['numeric', 'text', 'boolean', 'select'] as const;
type ResponseType = (typeof RESPONSE_TYPES)[number];

function problemKeyOf(result: ActionState): string {
  if (result.status === 'conflict') return 'diagnostics.template.conflict';
  return result.messageKey ?? 'action.failed';
}

function useReload(): readonly [number, () => void] {
  const [reloadCount, setReloadCount] = useState(0);
  const reload = useCallback(() => setReloadCount((n) => n + 1), []);
  return [reloadCount, reload];
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
  const [readProblem, setReadProblem] = useState<string | null>(null);
  const [reloadCount, reload] = useReload();
  const [openVersionId, setOpenVersionId] = useState<string | null>(
    initial.versions[0]?.id ?? null
  );

  useEffect(() => {
    if (reloadCount === 0) return;
    let cancelled = false;
    void readTemplate(templateId).then((next) => {
      if (cancelled) return;
      if (next.status === 'ok') {
        setDetail(next.data);
        setReadProblem(null);
      } else setReadProblem(`state.${next.status}.title`);
    });
    return () => {
      cancelled = true;
    };
  }, [templateId, reloadCount]);

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
          <p role="alert" className="mt-2 text-body text-error">
            {translateDynamic(messages, readProblem)}
          </p>
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
            {detail.versions.map((version) => (
              <li key={version.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="text-body font-medium text-text-primary">
                    {translate(messages, 'diagnostics.template.version')} {version.versionNumber}
                  </span>
                  <span className="text-caption text-text-muted">
                    {translateDynamic(messages, `diagnostics.versionStatus.${version.status}`)}
                  </span>
                  <span className="text-caption text-text-muted">
                    {translate(messages, 'diagnostics.template.itemCount')}: {version.itemCount}
                  </span>
                  {version.publishedAt ? (
                    <span className="text-caption text-text-muted">
                      {translate(messages, 'diagnostics.template.publishedAt')}{' '}
                      {formatDateTime(version.publishedAt, locale)}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() =>
                      setOpenVersionId(openVersionId === version.id ? null : version.id)
                    }
                    aria-expanded={openVersionId === version.id}
                    className="ms-auto text-primary underline-offset-2 hover:underline"
                  >
                    {translate(
                      messages,
                      openVersionId === version.id
                        ? 'diagnostics.template.closeItems'
                        : 'diagnostics.template.openItems'
                    )}
                  </button>
                </div>
                {openVersion?.id === version.id ? (
                  <VersionItems
                    messages={messages}
                    version={version}
                    canManage={canManage}
                    onChanged={reload}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
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
  readonly onDone: () => void;
}) {
  const [nextName, setNextName] = useState(name);
  const [nextStatus, setNextStatus] = useState(status);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => setNextName(name), [name]);
  useEffect(() => setNextStatus(status), [status]);

  return (
    <form
      action={async () => {
        setPending(true);
        setProblem(null);
        const body = {
          ...(nextName.trim() !== name ? { name: nextName.trim() } : {}),
          ...(nextStatus !== status ? { status: nextStatus as 'active' | 'inactive' } : {}),
        };
        if (Object.keys(body).length === 0) {
          setPending(false);
          setAttempt((n) => n + 1);
          setProblem('diagnostics.template.nothingChanged');
          return;
        }
        const outcome = await updateTemplate(templateId, body, recordVersion);
        setPending(false);
        setAttempt((n) => n + 1);
        notifyActionResult(outcome, messages);
        if (outcome.status === 'success') {
          onDone();
          return;
        }
        setProblem(problemKeyOf(outcome));
      }}
      className="mt-3 flex flex-wrap items-end gap-3"
    >
      <TextField
        name="name"
        label={translate(messages, 'diagnostics.catalogue.name')}
        value={nextName}
        onChange={(event) => setNextName(event.target.value)}
        required
      />
      <SelectField
        key={`status-${attempt}`}
        name="status"
        label={translate(messages, 'diagnostics.catalogue.filterStatus')}
        defaultValue={nextStatus}
        onChange={(event) => setNextStatus(event.target.value)}
        options={['active', 'inactive'].map((value) => ({
          value,
          label: translate(messages, `diagnostics.templateStatus.${value}` as keyof Messages),
        }))}
      />
      <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>
        {translate(messages, pending ? 'diagnostics.template.saving' : 'diagnostics.template.save')}
      </button>
      {problem === null ? null : (
        <p role="alert" className="basis-full text-body text-error">
          {translateDynamic(messages, problem)}
        </p>
      )}
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
  readonly onDone: () => void;
}) {
  const [copyFromVersionId, setCopyFromVersionId] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  return (
    <form
      action={async () => {
        setPending(true);
        setProblem(null);
        const outcome = await createVersion(
          templateId,
          copyFromVersionId ? { copyFromVersionId } : {}
        );
        setPending(false);
        setAttempt((n) => n + 1);
        notifyActionResult(outcome, messages);
        if (outcome.status === 'success') {
          setCopyFromVersionId('');
          onDone();
          return;
        }
        setProblem(problemKeyOf(outcome));
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <SelectField
        key={`copyFromVersionId-${attempt}`}
        name="copyFromVersionId"
        label={translate(messages, 'diagnostics.template.copyFrom')}
        defaultValue={copyFromVersionId}
        onChange={(event) => setCopyFromVersionId(event.target.value)}
        options={versions.map((version) => ({
          value: version.id,
          label: `${translate(messages, 'diagnostics.template.version')} ${version.versionNumber}`,
        }))}
        placeholder={translate(messages, 'diagnostics.template.startEmpty')}
      />
      <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
        {translate(
          messages,
          pending ? 'diagnostics.template.openingVersion' : 'diagnostics.template.newVersion'
        )}
      </button>
      {problem === null ? null : (
        <p role="alert" className="basis-full text-body text-error">
          {translateDynamic(messages, problem)}
        </p>
      )}
    </form>
  );
}

function VersionItems({
  messages,
  version,
  canManage,
  onChanged,
}: {
  readonly messages: Messages;
  readonly version: TemplateVersion;
  readonly canManage: boolean;
  readonly onChanged: () => void;
}) {
  const [items, setItems] = useState<ReadState<ItemsOnly<TemplateItem>> | null>(null);
  const [reloadCount, reload] = useReload();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    void listVersionItems(version.id).then((next) => {
      if (!cancelled) setItems(next);
    });
    return () => {
      cancelled = true;
    };
  }, [version.id, reloadCount]);

  const move = async (toStatus: 'published' | 'retired') => {
    setPending(true);
    setProblem(null);
    const outcome = await setVersionStatus(version.id, { toStatus }, version.recordVersion);
    setPending(false);
    notifyActionResult(outcome, messages);
    if (outcome.status === 'success') {
      onChanged();
      return;
    }
    setProblem(problemKeyOf(outcome));
  };

  return (
    <div className="mt-3 flex flex-col gap-3">
      {items === null ? (
        <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
      ) : items.status !== 'ok' ? (
        <p role="alert" className="text-body text-error">
          {translateDynamic(messages, `state.${items.status}.title`)}
        </p>
      ) : items.data.items.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'diagnostics.template.noItems')}
        </p>
      ) : (
        <ol className="flex flex-col gap-1">
          {items.data.items.map((item) => (
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
          onDone={() => {
            reload();
            onChanged();
          }}
        />
      ) : null}

      {canManage ? (
        <div className="flex flex-wrap items-center gap-3">
          {version.status === 'draft' ? (
            <button
              type="button"
              onClick={() => void move('published')}
              disabled={pending}
              className={PRIMARY_BUTTON}
            >
              {translate(messages, 'diagnostics.template.publish')}
            </button>
          ) : null}
          {version.status === 'published' ? (
            <button
              type="button"
              onClick={() => void move('retired')}
              disabled={pending}
              className={SECONDARY_BUTTON}
            >
              {translate(messages, 'diagnostics.template.retire')}
            </button>
          ) : null}
          {problem === null ? null : (
            <p role="alert" className="basis-full text-body text-error">
              {translateDynamic(messages, problem)}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function NewItemForm({
  messages,
  versionId,
  onDone,
}: {
  readonly messages: Messages;
  readonly versionId: string;
  readonly onDone: () => void;
}) {
  const [itemCode, setItemCode] = useState('');
  const [prompt, setPrompt] = useState('');
  const [responseType, setResponseType] = useState('');
  const [unit, setUnit] = useState('');
  const [isMandatory, setIsMandatory] = useState(false);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [attempt, setAttempt] = useState(0);

  const errorFor = (field: string): string | undefined => {
    const key = fieldErrors[field];
    return key ? translateDynamic(messages, key) : undefined;
  };

  return (
    <form
      action={async () => {
        setPending(true);
        setProblem(null);
        setFieldErrors({});
        const errors: Record<string, string> = {};
        if (itemCode.trim().length === 0) errors['itemCode'] = 'field.required';
        if (prompt.trim().length === 0) errors['prompt'] = 'field.required';
        if (responseType.length === 0) errors['responseType'] = 'field.required';
        if (responseType === 'numeric' && unit.trim().length === 0) {
          errors['unit'] = 'diagnostics.template.unitRequired';
        }
        if (Object.keys(errors).length > 0) {
          setFieldErrors(errors);
          setPending(false);
          setAttempt((n) => n + 1);
          return;
        }
        const outcome = await createItem(versionId, {
          itemCode: itemCode.trim(),
          prompt: prompt.trim(),
          responseType: responseType as ResponseType,
          ...(unit.trim().length > 0 ? { unit: unit.trim() } : {}),
          ...(isMandatory ? { isMandatory: true } : {}),
        });
        setPending(false);
        setAttempt((n) => n + 1);
        notifyActionResult(outcome, messages);
        if (outcome.status === 'success') {
          setItemCode('');
          setPrompt('');
          setResponseType('');
          setUnit('');
          setIsMandatory(false);
          onDone();
          return;
        }
        if (outcome.fieldErrors) setFieldErrors(outcome.fieldErrors);
        setProblem(problemKeyOf(outcome));
      }}
      className="flex flex-wrap items-end gap-3 rounded-md border border-dashed border-border p-3"
    >
      <TextField
        name="itemCode"
        label={translate(messages, 'diagnostics.template.itemCode')}
        description={translate(messages, 'diagnostics.template.itemCodeHint')}
        value={itemCode}
        onChange={(event) => setItemCode(event.target.value)}
        error={errorFor('itemCode')}
        required
        dir="ltr"
      />
      <TextField
        name="prompt"
        label={translate(messages, 'diagnostics.template.prompt')}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        error={errorFor('prompt')}
        required
      />
      <SelectField
        key={`responseType-${attempt}`}
        name="responseType"
        label={translate(messages, 'diagnostics.template.responseType')}
        defaultValue={responseType}
        onChange={(event) => setResponseType(event.target.value)}
        options={RESPONSE_TYPES.map((value) => ({
          value,
          label: translate(messages, `diagnostics.responseType.${value}` as keyof Messages),
        }))}
        placeholder={translate(messages, 'diagnostics.template.chooseResponseType')}
        error={errorFor('responseType')}
        required
      />
      <TextField
        name="unit"
        label={translate(messages, 'diagnostics.template.unit')}
        description={translate(messages, 'diagnostics.template.unitHint')}
        value={unit}
        onChange={(event) => setUnit(event.target.value)}
        error={errorFor('unit')}
        dir="ltr"
      />
      <CheckboxField
        key={`isMandatory-${attempt}`}
        name="isMandatory"
        label={translate(messages, 'diagnostics.template.mandatory')}
        defaultChecked={isMandatory}
        onChange={(event) => setIsMandatory(event.target.checked)}
      />
      <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
        {translate(
          messages,
          pending ? 'diagnostics.template.addingItem' : 'diagnostics.template.addItem'
        )}
      </button>
      {problem === null ? null : (
        <p role="alert" className="basis-full text-body text-error">
          {translateDynamic(messages, problem)}
        </p>
      )}
    </form>
  );
}
