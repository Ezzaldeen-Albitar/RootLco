'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, useTransition, type FormEvent } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import { useUnavailableListGuard } from '@/components/forms/ReferenceList';
import type { FormSelectOption } from '@/components/forms/mui/FormSelectField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { IDLE, invalid, unreachable, type ActionState } from '@/lib/forms/action-result';
import { useActionRefusal } from '@/lib/forms/use-action-refusal';
import { FormFeedback } from '@/features/authentication/components/FormFeedback';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import {
  createBranchAction,
  createCompanyAction,
  updateBranchAction,
  updateCompanyAction,
} from '../actions';
import type { BranchView, CompanyView } from '../types';
import { ListRetry, StructureDialog } from './StructureDialog';
import { useSingleFlight } from './use-single-flight';

/**
 * Adding and editing a company or a branch, on the Organisation screen
 * (ADR-022 form fields and dialogs, P1-32-PRE-OD-ADM1).
 *
 * Every dialog here behaves the same way:
 *
 *   - the fields are the Material wrappers, controlled from a draft, so a
 *     refusal never takes what was typed;
 *   - a refusal is said beside its field and the cursor moves to the first
 *     refused field; editing a field withdraws its complaint;
 *   - anything typed is unsaved work: leaving the page or changing branch asks
 *     first, and so do Escape, Close and Cancel;
 *   - one write at a time (`useSingleFlight`), so two presses send once.
 *
 * Adding keeps its confirmation in the dialog until the operator closes it, as
 * before; closing re-reads the page. Editing closes on success, says so, and
 * re-reads the page so the list shows the new values and the next version.
 *
 * ## Editing is version-guarded
 *
 * `org.company-update` and `org.branch-update` refuse an update without
 * `If-Match`. The version sent is the one the list published for the row the
 * operator opened. When someone else changed the record first the answer is a
 * conflict (`ERR-CON-001`): the dialog says so, keeps the typed values, and
 * offers **Load the latest version**; Save waits until it is pressed. Loading
 * re-reads the page; when the record's version has moved, the dialog shows the
 * latest saved values (and says so) and works against the new version.
 */

type Draft = Readonly<Record<string, string>>;

const COMPANY_FIELDS = [
  'code',
  'legalName',
  'baseCurrency',
  'registrationNumber',
  'taxRegistrationNumber',
] as const;
const BRANCH_FIELDS = ['companyId', 'code', 'name', 'city', 'countryCode', 'timezone'] as const;

function emptyDraft(fields: readonly string[]): Draft {
  return Object.fromEntries(fields.map((field) => [field, '']));
}

function formDataOf(draft: Draft): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(draft)) data.set(name, value);
  return data;
}

/** The actions row every dialog ends with: Cancel and the write, or Close once added. */
function DialogButtons({
  messages,
  formId,
  pending,
  done,
  submitLabel,
  pendingLabel,
  submitDisabled = false,
  onCancel,
  onDone,
}: {
  readonly messages: Messages;
  readonly formId: string;
  readonly pending: boolean;
  readonly done: boolean;
  readonly submitLabel: string;
  readonly pendingLabel: string;
  readonly submitDisabled?: boolean;
  readonly onCancel: () => void;
  readonly onDone: () => void;
}) {
  const t = (key: string) => translate(messages, key as keyof Messages);
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {done ? (
        <Button type="button" variant="contained" onClick={onDone}>
          {t('admin.close')}
        </Button>
      ) : (
        <>
          <Button type="button" variant="outlined" onClick={onCancel} disabled={pending}>
            {t('admin.cancel')}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="contained"
            disabled={pending || submitDisabled}
            aria-busy={pending || undefined}
          >
            {pending ? pendingLabel : submitLabel}
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * The parts every dialog shares: the draft, the refusal on the fields, the
 * single write, and the dirty check the frame and the shell ask about.
 */
function useDialogForm(initial: Draft) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [state, setState] = useState<ActionState>(IDLE);
  const { formRef, errorKey, edited } = useActionRefusal(state);
  const flight = useSingleFlight();
  const set = (name: string) => (value: string) => {
    edited(name);
    setDraft((current) => ({ ...current, [name]: value }));
  };
  return { draft, setDraft, state, setState, formRef, errorKey, flight, set };
}

// --- add a company ----------------------------------------------------------------

export function AddCompanyDialog({
  messages,
  currencyChoices,
  currencyHint,
  offerRetry,
  onClose,
}: {
  readonly messages: Messages;
  readonly currencyChoices: readonly FormSelectOption[];
  readonly currencyHint: string;
  /** The currency list is empty: the dialog offers Try again and refuses to send. */
  readonly offerRetry: boolean;
  readonly onClose: () => void;
}) {
  const formId = useId();
  const t = (key: string) => translate(messages, key as keyof Messages);
  const { draft, state, setState, formRef, errorKey, flight, set } = useDialogForm(
    emptyDraft(COMPANY_FIELDS)
  );
  const listGuard = useUnavailableListGuard(currencyChoices.length === 0 ? ['baseCurrency'] : []);
  const done = state.status === 'success';
  const dirty = !done && Object.values(draft).some((value) => value.trim() !== '');
  useUnsavedGuard(dirty, onClose);
  const fieldError = (name: string) => {
    const key = errorKey(name);
    return key ? t(key) : undefined;
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (done || listGuard.stop(event)) return;
    const data = formDataOf(draft);
    const previous = state;
    flight.run(async () => {
      let result: ActionState;
      try {
        result = await createCompanyAction(previous, data);
      } catch {
        result = unreachable((previous.attempt ?? 0) + 1);
      }
      setState(result);
    });
  };

  return (
    <StructureDialog
      title={t('organization.company.add')}
      description={t('organization.company.addDescription')}
      messages={messages}
      dirty={dirty}
      pending={flight.pending}
      onClose={onClose}
      actions={(requestClose) => (
        <DialogButtons
          messages={messages}
          formId={formId}
          pending={flight.pending}
          done={done}
          submitLabel={t('admin.create')}
          pendingLabel={t('admin.creating')}
          onCancel={requestClose}
          onDone={onClose}
        />
      )}
    >
      <form id={formId} ref={formRef} onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <FormFeedback state={state} messages={messages} />
        <FormTextField
          name="code"
          label={t('organization.structure.code')}
          description={t('organization.structure.codeHint')}
          value={draft['code'] ?? ''}
          onChange={set('code')}
          error={fieldError('code')}
          required
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
        <FormTextField
          name="legalName"
          label={t('organization.company.legalName')}
          value={draft['legalName'] ?? ''}
          onChange={set('legalName')}
          error={fieldError('legalName')}
          required
          autoComplete="off"
        />
        <FormSelectField
          name="baseCurrency"
          label={t('organization.company.baseCurrency')}
          description={t(currencyHint)}
          value={draft['baseCurrency'] ?? ''}
          onChange={set('baseCurrency')}
          error={
            fieldError('baseCurrency') ??
            (listGuard.refused('baseCurrency') ? t('form.referenceList.blocked') : undefined)
          }
          required
          placeholder={t('field.selectPlaceholder')}
          options={currencyChoices}
        />
        {offerRetry ? <ListRetry label={t('form.retry')} /> : null}
        <FormTextField
          name="registrationNumber"
          label={`${t('organization.company.registrationNumber')} ${t('field.optional')}`}
          value={draft['registrationNumber'] ?? ''}
          onChange={set('registrationNumber')}
          error={fieldError('registrationNumber')}
          autoComplete="off"
        />
        <FormTextField
          name="taxRegistrationNumber"
          label={`${t('organization.company.taxRegistrationNumber')} ${t('field.optional')}`}
          value={draft['taxRegistrationNumber'] ?? ''}
          onChange={set('taxRegistrationNumber')}
          error={fieldError('taxRegistrationNumber')}
          autoComplete="off"
        />
      </form>
    </StructureDialog>
  );
}

// --- add a branch -----------------------------------------------------------------

export function AddBranchDialog({
  messages,
  companies,
  timezoneChoices,
  timezoneHint,
  offerRetry,
  onClose,
}: {
  readonly messages: Messages;
  readonly companies: readonly CompanyView[];
  readonly timezoneChoices: readonly FormSelectOption[];
  readonly timezoneHint: string;
  /** The zone list is missing or partial, so the dialog offers Try again. */
  readonly offerRetry: boolean;
  readonly onClose: () => void;
}) {
  const formId = useId();
  const t = (key: string) => translate(messages, key as keyof Messages);
  const { draft, state, setState, formRef, errorKey, flight, set } = useDialogForm(
    emptyDraft(BRANCH_FIELDS)
  );
  const listGuard = useUnavailableListGuard(timezoneChoices.length === 0 ? ['timezone'] : []);
  const done = state.status === 'success';
  const dirty = !done && Object.values(draft).some((value) => value.trim() !== '');
  useUnsavedGuard(dirty, onClose);
  const fieldError = (name: string) => {
    const key = errorKey(name);
    return key ? t(key) : undefined;
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (done || listGuard.stop(event)) return;
    const data = formDataOf(draft);
    const previous = state;
    flight.run(async () => {
      let result: ActionState;
      try {
        result = await createBranchAction(previous, data);
      } catch {
        result = unreachable((previous.attempt ?? 0) + 1);
      }
      setState(result);
    });
  };

  return (
    <StructureDialog
      title={t('organization.branch.add')}
      description={t('organization.branch.addDescription')}
      messages={messages}
      dirty={dirty}
      pending={flight.pending}
      onClose={onClose}
      actions={(requestClose) => (
        <DialogButtons
          messages={messages}
          formId={formId}
          pending={flight.pending}
          done={done}
          submitLabel={t('admin.create')}
          pendingLabel={t('admin.creating')}
          onCancel={requestClose}
          onDone={onClose}
        />
      )}
    >
      <form id={formId} ref={formRef} onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <FormFeedback state={state} messages={messages} />
        <FormSelectField
          name="companyId"
          label={t('organization.branch.company')}
          value={draft['companyId'] ?? ''}
          onChange={set('companyId')}
          error={fieldError('companyId')}
          required
          placeholder={t('admin.scope.pickCompany')}
          options={companies.map((company) => ({ value: company.id, label: company.legalName }))}
        />
        <FormTextField
          name="code"
          label={t('organization.structure.code')}
          description={t('organization.structure.codeHint')}
          value={draft['code'] ?? ''}
          onChange={set('code')}
          error={fieldError('code')}
          required
          autoComplete="off"
          spellCheck={false}
        />
        <FormTextField
          name="name"
          label={t('organization.branch.name')}
          value={draft['name'] ?? ''}
          onChange={set('name')}
          error={fieldError('name')}
          required
          autoComplete="off"
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormTextField
            name="city"
            label={`${t('organization.branch.city')} ${t('field.optional')}`}
            value={draft['city'] ?? ''}
            onChange={set('city')}
            error={fieldError('city')}
            autoComplete="off"
          />
          <FormTextField
            name="countryCode"
            label={`${t('organization.branch.country')} ${t('field.optional')}`}
            description={t('organization.branch.countryHint')}
            value={draft['countryCode'] ?? ''}
            onChange={set('countryCode')}
            error={fieldError('countryCode')}
            autoComplete="off"
            maxLength={2}
            dir="ltr"
          />
        </div>
        <FormSelectField
          name="timezone"
          label={t('organization.branch.timezone')}
          description={t(timezoneHint)}
          value={draft['timezone'] ?? ''}
          onChange={set('timezone')}
          error={
            fieldError('timezone') ??
            (listGuard.refused('timezone') ? t('form.referenceList.blocked') : undefined)
          }
          required
          placeholder={t('field.selectPlaceholder')}
          options={timezoneChoices}
        />
        {offerRetry ? <ListRetry label={t('form.retry')} /> : null}
      </form>
    </StructureDialog>
  );
}

// --- edit a company ---------------------------------------------------------------

/**
 * The version guard's part every edit dialog shares: a conflict holds Save until
 * the latest version is loaded, and the latest saved values are put back in
 * front of the operator ONLY once they asked for them with "Load the latest
 * version" (state adjusted while rendering, the pattern React documents for "a
 * prop changed").
 *
 * A version that moves for any other reason — the page rendered again by a
 * list's Try again, say — leaves the typed draft alone: the dialog keeps the
 * version the draft was based on (`version` below) and sends that, so saving
 * over someone else's change is refused as the ordinary conflict instead of
 * the typed edits being silently replaced.
 */
function useVersionGuard(version: number | undefined) {
  const router = useRouter();
  const [seen, setSeen] = useState(version);
  const [requested, setRequested] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const [latestLoaded, setLatestLoaded] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const moved = requested && version !== seen;
  if (moved) {
    setSeen(version);
    setRequested(false);
    setConflicted(false);
    setLatestLoaded(true);
  }
  const loadLatest = () => {
    setRequested(true);
    startRefresh(() => {
      setConflicted(false);
      router.refresh();
    });
  };
  return {
    moved,
    /** The version the draft in front of the operator was based on. */
    version: seen,
    conflicted,
    latestLoaded,
    refreshing,
    unknown: seen === undefined,
    noteResult: (result: ActionState) => {
      // Only the true concurrency refusal holds Save; a conflict that names a
      // rule is about the values, and correcting them is the way forward.
      if (result.status === 'conflict' && result.messageKey === 'state.conflict.title') {
        setConflicted(true);
      }
    },
    loadLatest,
  };
}

function VersionNotices({
  messages,
  guard,
}: {
  readonly messages: Messages;
  readonly guard: ReturnType<typeof useVersionGuard>;
}) {
  const t = (key: string) => translate(messages, key as keyof Messages);
  return (
    <>
      {guard.unknown ? (
        <Alert severity="info" role="status" variant="outlined">
          {t('organization.edit.versionUnknown')}
        </Alert>
      ) : null}
      {guard.latestLoaded && !guard.conflicted ? (
        <Alert severity="info" role="status" variant="outlined">
          {t('organization.edit.latestLoaded')}
        </Alert>
      ) : null}
      {guard.conflicted || guard.unknown ? (
        <div>
          <Button
            type="button"
            variant="outlined"
            onClick={guard.loadLatest}
            disabled={guard.refreshing}
            aria-busy={guard.refreshing || undefined}
          >
            {t('form.loadLatest')}
          </Button>
        </div>
      ) : null}
    </>
  );
}

export function EditCompanyDialog({
  messages,
  company,
  onClose,
  onSaved,
}: {
  readonly messages: Messages;
  readonly company: CompanyView;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const formId = useId();
  const t = (key: string) => translate(messages, key as keyof Messages);
  const saved: Draft = { legalName: company.legalName };
  const { draft, setDraft, state, setState, formRef, errorKey, flight, set } = useDialogForm(saved);
  const guard = useVersionGuard(company.recordVersion);
  if (guard.moved) {
    setDraft(saved);
    setState(IDLE);
  }
  const dirty = (draft['legalName'] ?? '') !== company.legalName;
  useUnsavedGuard(dirty, onClose);
  useFocusAfterReload(guard.latestLoaded, guard.version, formRef, 'legalName');
  const fieldError = (name: string) => {
    const key = errorKey(name);
    return key ? t(key) : undefined;
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const version = guard.version;
    if (version === undefined || guard.conflicted || guard.refreshing) return;
    const attempt = (state.attempt ?? 0) + 1;
    if (!dirty) {
      setState(invalid({}, attempt, 'organization.edit.unchanged'));
      return;
    }
    const legalName = draft['legalName'] ?? '';
    flight.run(async () => {
      let result: ActionState;
      try {
        result = await updateCompanyAction({
          companyId: company.id,
          recordVersion: version,
          legalName,
          attempt,
        });
      } catch {
        result = unreachable(attempt);
      }
      if (result.status === 'success') {
        notifyActionResult(result, messages);
        onSaved();
        return;
      }
      guard.noteResult(result);
      setState(result);
    });
  };

  return (
    <StructureDialog
      title={t('organization.company.edit')}
      description={t('organization.company.editDescription')}
      messages={messages}
      dirty={dirty}
      pending={flight.pending}
      onClose={onClose}
      testId="edit-company-dialog"
      actions={(requestClose) => (
        <DialogButtons
          messages={messages}
          formId={formId}
          pending={flight.pending}
          done={false}
          submitLabel={t('admin.save')}
          pendingLabel={t('admin.saving')}
          submitDisabled={guard.unknown || guard.conflicted || guard.refreshing}
          onCancel={requestClose}
          onDone={onClose}
        />
      )}
    >
      <form id={formId} ref={formRef} onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <FormFeedback state={state} messages={messages} />
        <VersionNotices messages={messages} guard={guard} />
        <FormTextField
          name="legalName"
          label={t('organization.company.legalName')}
          value={draft['legalName'] ?? ''}
          onChange={set('legalName')}
          error={fieldError('legalName')}
          required
          autoComplete="off"
          autoFocus
        />
      </form>
    </StructureDialog>
  );
}

// --- edit a branch ----------------------------------------------------------------

export function EditBranchDialog({
  messages,
  branch,
  timezoneChoices,
  timezoneHint,
  offerRetry,
  onClose,
  onSaved,
}: {
  readonly messages: Messages;
  readonly branch: BranchView;
  /** The zones to offer, the branch's own zone among them. */
  readonly timezoneChoices: readonly FormSelectOption[];
  readonly timezoneHint: string;
  readonly offerRetry: boolean;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const formId = useId();
  const t = (key: string) => translate(messages, key as keyof Messages);
  const saved: Draft = {
    name: branch.name,
    city: branch.city ?? '',
    countryCode: branch.countryCode ?? '',
    timezoneName: branch.timezoneName,
  };
  const { draft, setDraft, state, setState, formRef, errorKey, flight, set } = useDialogForm(saved);
  const guard = useVersionGuard(branch.recordVersion);
  if (guard.moved) {
    setDraft(saved);
    setState(IDLE);
  }
  const changes = branchChanges(saved, draft);
  const dirty = Object.keys(changes).length > 0;
  useUnsavedGuard(dirty, onClose);
  useFocusAfterReload(guard.latestLoaded, guard.version, formRef, 'name');
  const fieldError = (name: string) => {
    const key = errorKey(name);
    return key ? t(key) : undefined;
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const version = guard.version;
    if (version === undefined || guard.conflicted || guard.refreshing) return;
    const attempt = (state.attempt ?? 0) + 1;
    if (!dirty) {
      setState(invalid({}, attempt, 'organization.edit.unchanged'));
      return;
    }
    flight.run(async () => {
      let result: ActionState;
      try {
        result = await updateBranchAction({
          branchId: branch.id,
          recordVersion: version,
          attempt,
          changes,
        });
      } catch {
        result = unreachable(attempt);
      }
      if (result.status === 'success') {
        notifyActionResult(result, messages);
        onSaved();
        return;
      }
      guard.noteResult(result);
      setState(result);
    });
  };

  return (
    <StructureDialog
      title={t('organization.branch.edit')}
      description={t('organization.branch.editDescription')}
      messages={messages}
      dirty={dirty}
      pending={flight.pending}
      onClose={onClose}
      testId="edit-branch-dialog"
      actions={(requestClose) => (
        <DialogButtons
          messages={messages}
          formId={formId}
          pending={flight.pending}
          done={false}
          submitLabel={t('admin.save')}
          pendingLabel={t('admin.saving')}
          submitDisabled={guard.unknown || guard.conflicted || guard.refreshing}
          onCancel={requestClose}
          onDone={onClose}
        />
      )}
    >
      <form id={formId} ref={formRef} onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <FormFeedback state={state} messages={messages} />
        <VersionNotices messages={messages} guard={guard} />
        <FormTextField
          name="name"
          label={t('organization.branch.name')}
          value={draft['name'] ?? ''}
          onChange={set('name')}
          error={fieldError('name')}
          required
          autoComplete="off"
          autoFocus
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormTextField
            name="city"
            label={`${t('organization.branch.city')} ${t('field.optional')}`}
            value={draft['city'] ?? ''}
            onChange={set('city')}
            error={fieldError('city')}
            autoComplete="off"
          />
          <FormTextField
            name="countryCode"
            label={`${t('organization.branch.country')} ${t('field.optional')}`}
            description={t('organization.branch.countryHint')}
            value={draft['countryCode'] ?? ''}
            onChange={set('countryCode')}
            error={fieldError('countryCode')}
            autoComplete="off"
            maxLength={2}
            dir="ltr"
          />
        </div>
        <FormSelectField
          name="timezoneName"
          label={t('organization.branch.timezone')}
          description={`${t(timezoneHint)} ${t('organization.branch.timezoneChangeHint')}`}
          value={draft['timezoneName'] ?? ''}
          onChange={set('timezoneName')}
          error={fieldError('timezoneName')}
          required
          options={timezoneChoices}
        />
        {offerRetry ? <ListRetry label={t('form.retry')} /> : null}
      </form>
    </StructureDialog>
  );
}

/**
 * The fields the operator changed, and only those. A city or a country cleared
 * by the operator is an empty string here and is sent as "remove it"; the
 * country is compared in capitals, as it is stored.
 */
function branchChanges(
  saved: Draft,
  draft: Draft
): {
  name?: string;
  timezoneName?: string;
  city?: string;
  countryCode?: string;
} {
  const out: { name?: string; timezoneName?: string; city?: string; countryCode?: string } = {};
  const name = draft['name'] ?? '';
  if (name !== saved['name']) out.name = name;
  const zone = draft['timezoneName'] ?? '';
  if (zone !== saved['timezoneName']) out.timezoneName = zone;
  const city = (draft['city'] ?? '').trim();
  if (city !== (saved['city'] ?? '').trim()) out.city = city;
  const country = (draft['countryCode'] ?? '').trim().toUpperCase();
  if (country !== (saved['countryCode'] ?? '').trim().toUpperCase()) out.countryCode = country;
  return out;
}

/** After the latest version was loaded, the cursor goes back to the first field. */
function useFocusAfterReload(
  latestLoaded: boolean,
  version: number | undefined,
  formRef: { readonly current: HTMLFormElement | null },
  field: string
) {
  useEffect(() => {
    if (!latestLoaded) return;
    formRef.current?.querySelector<HTMLElement>(`[name="${field}"]`)?.focus();
  }, [latestLoaded, version, formRef, field]);
}
