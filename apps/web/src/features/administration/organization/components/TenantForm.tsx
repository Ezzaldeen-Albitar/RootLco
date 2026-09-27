'use client';

import { useRouter } from 'next/navigation';
import { startTransition, useActionState, useState, type FormEvent } from 'react';
import Button from '@mui/material/Button';
import { ReferenceListRetry } from '@/components/forms/ReferenceList';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { LOCALES, isLocale, type Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { languageLabel, timeZoneLabel } from '@/lib/format';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { FormFeedback } from '@/features/authentication/components/FormFeedback';
import { SubmitButton } from '@/features/authentication/components/SubmitButton';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import { updateTenantAction } from '../actions';
import type { ReferenceValues, TenantView } from '../types';
import { useActionRefusal } from '@/lib/forms/use-action-refusal';

/**
 * The three tenant fields the contract lets an administrator change.
 *
 * `tenantCode` and `status` are absent from the update contract by design —
 * tenant status is an owner/operator capability (ADR-008), not tenant
 * administration — so they are shown as facts and have no control. A disabled
 * input would imply the field could be enabled by someone; there is no such
 * someone inside this application. The status is shown in words from the
 * catalogue (`TENANT_STATUS_KEYS`), never as the stored value.
 *
 * Who may change the rest is the server's decision: `iam.tenant-settings-update`
 * declares `org.settings.manage`, which the standard tenant administrator holds
 * by the Owner decision of 2026-09-27. `canWrite` only chooses between the form
 * and the read-only facts with their notice, so a session without the code is
 * never offered a control the server would refuse.
 *
 * Locale and timezone are foreign keys to `shared.languages` and
 * `shared.timezones`, and both are selects fed from `org.reference-values-read`
 * (P1-32-PRE-OD-REF, closing `P1-26-F-006`): a language is offered when the
 * platform holds it and the interface can be shown in it, a zone when the
 * platform holds it. When that read was not permitted or failed, the language
 * falls back to the interface languages and the zone to the zones already in
 * use, as it also does when the list holds no active zone. The saved value is
 * always one of the choices, so an untouched form still submits it. Nothing is
 * typed; a refusal is still shown on its field.
 *
 * A language and a zone read as names in the reader's language, the zone with
 * its identifier beside it, in the form and in the read-only facts alike. When
 * the reference read FAILED (`referenceUnavailable`), each select says its list
 * is partial and offers Try again (P1-32-PRE-OD-QAF). The saved value keeps
 * both selects valid, so the form still sends.
 *
 * ## The form's own behaviour (Material UI wrappers, ADR-022)
 *
 * The fields are `FormTextField` and `FormSelectField`, controlled from the
 * draft. A refused save marks the field, says why beside it, moves the cursor to
 * the first refused field and keeps what was typed; editing the field clears its
 * complaint (`useActionRefusal`). A draft that differs from the saved values is
 * unsaved work: a branch change asks first (`useUnsavedGuard`), and Discard
 * changes puts the saved values back and withdraws every complaint, since each
 * was about a value that is no longer there. A save is said in words and the
 * page is re-read, so the next save carries the new version.
 *
 * The submission is dispatched from `onSubmit` inside a transition rather than
 * left to the form's `action`. React resets a form whose `action` settles, and
 * a controlled native select comes back from a reset on its FIRST option — the
 * saved value — while the draft still holds the operator's choice, so after a
 * refusal that names no field (a lost-update 412, a server fault, an expired
 * session) the screen showed the saved values and a second Save sent them. A
 * prevented submit that starts a transition is not reset, and React still ties
 * that transition to the form, so `SubmitButton`'s `useFormStatus` stays the
 * double-submit guard. `action` stays for a page that has not hydrated.
 */
export function TenantForm({
  locale,
  messages,
  tenant,
  canWrite,
  referenceValues = null,
  referenceUnavailable = false,
  timezoneChoices = [],
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly tenant: TenantView;
  readonly canWrite: boolean;
  /** `org.reference-values-read`; `null` when it was not permitted or failed. */
  readonly referenceValues?: ReferenceValues | null;
  /** The reference read was made and failed, so the selects offer Try again. */
  readonly referenceUnavailable?: boolean;
  /** The zones the tenant and its branches already use — the fallback. */
  readonly timezoneChoices?: readonly string[];
}) {
  const router = useRouter();
  const saved: TenantDraft = {
    displayName: tenant.displayName,
    defaultLocale: tenant.defaultLocale,
    defaultTimezone: tenant.defaultTimezone,
  };
  /*
   * `baseline` is what the server holds as far as this form knows: the values it
   * was rendered with, then whatever a successful save sent. `draft` is what the
   * operator has in front of them. They differ exactly when there is unsaved work.
   */
  const [baseline, setBaseline] = useState<TenantDraft>(saved);
  const [draft, setDraft] = useState<TenantDraft>(saved);
  const [state, formAction] = useActionState<ActionState, FormData>(async (previous, form) => {
    const result = await updateTenantAction(previous, form);
    if (result.status === 'success') {
      setBaseline({
        displayName: String(form.get('displayName') ?? ''),
        defaultLocale: String(form.get('defaultLocale') ?? ''),
        defaultTimezone: String(form.get('defaultTimezone') ?? ''),
      });
      // The saved values and the version the next save needs come from the server.
      router.refresh();
    }
    return result;
  }, IDLE);
  const dirty = FIELDS.some((field) => draft[field] !== baseline[field]);
  // Question f: the cursor goes to the refused field, and its complaint goes
  // once the operator edits it (route sweep B3).
  const {
    edited: refusalEdited,
    errorKey: refusalErrorKey,
    formRef: refusalFormRef,
  } = useActionRefusal(state);
  const discard = () => {
    setDraft(baseline);
    // Every complaint was about a value Discard has just taken away.
    FIELDS.forEach(refusalEdited);
  };
  // Typed and not saved is work a branch change would throw away, so it asks
  // first; a confirmed discard puts the saved values back.
  useUnsavedGuard(canWrite && dirty, discard);
  const retain = (name: keyof TenantDraft) => (value: string) => {
    refusalEdited(name);
    setDraft((current) => ({ ...current, [name]: value }));
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(() => formAction(form));
  };
  const t = (key: string) => translate(messages, key as keyof Messages);
  // The refusal is said on the field it is about, not only in the banner.
  const fieldError = (name: string) => {
    const key = refusalErrorKey(name);
    return key ? t(key) : undefined;
  };

  const withSaved = (values: readonly string[], current: string) =>
    current && !values.includes(current) ? [current, ...values] : values;
  const localeValues = withSaved(
    referenceValues
      ? referenceValues.languages
          .map((language) => language.localeCode)
          .filter((code) => isLocale(code))
      : [...LOCALES],
    tenant.defaultLocale
  );
  const referenceZones = (referenceValues?.timezones ?? []).map((zone) => zone.zoneName);
  const timezoneValues = withSaved(
    referenceZones.length > 0 ? referenceZones : timezoneChoices,
    tenant.defaultTimezone
  );
  const registerLanguage = new Map(
    (referenceValues?.languages ?? []).map((language) => [language.localeCode, language.name])
  );
  const localeName = (code: string) =>
    isLocale(code) ? t(`locale.${code}`) : languageLabel(code, locale, registerLanguage.get(code));
  const statusLabel = t(TENANT_STATUS_KEYS[tenant.status] ?? TENANT_STATUS_UNKNOWN_KEY);

  if (!canWrite) {
    return (
      <dl className="grid gap-4 sm:grid-cols-2">
        <Fact label={t('organization.tenantCode')} value={tenant.tenantCode} mono />
        <Fact label={t('organization.displayName')} value={tenant.displayName} />
        <Fact label={t('organization.status')} value={statusLabel} />
        <Fact label={t('organization.defaultLocale')} value={localeName(tenant.defaultLocale)} />
        <Fact
          label={t('organization.defaultTimezone')}
          value={timeZoneLabel(tenant.defaultTimezone, locale)}
        />
        <div className="sm:col-span-2">
          <p className="text-supporting text-text-muted">{t('admin.readOnly')}</p>
        </div>
      </dl>
    );
  }

  return (
    <form
      ref={refusalFormRef}
      action={formAction}
      onSubmit={submit}
      className="flex max-w-xl flex-col gap-4"
      noValidate
    >
      {/*
        The version the operator was actually looking at. `If-Match` is refused
        outright by the backend when absent, and defaulting it would turn a
        lost-update guard into a lost update.
      */}
      <input type="hidden" name="recordVersion" value={tenant.recordVersion} />

      <FormFeedback state={state} messages={messages} />

      <dl className="grid gap-4 sm:grid-cols-2">
        <Fact label={t('organization.tenantCode')} value={tenant.tenantCode} mono />
        <Fact label={t('organization.status')} value={statusLabel} />
      </dl>

      {/* Controlled from the draft, which a refused save leaves untouched. */}
      <FormTextField
        name="displayName"
        label={t('organization.displayName')}
        value={draft.displayName}
        onChange={retain('displayName')}
        error={fieldError('displayName')}
        required
      />
      <FormSelectField
        name="defaultLocale"
        label={t('organization.defaultLocale')}
        description={t(
          referenceUnavailable ? 'form.referenceList.partial' : 'organization.defaultLocaleHint'
        )}
        value={draft.defaultLocale}
        onChange={retain('defaultLocale')}
        error={fieldError('defaultLocale')}
        options={localeValues.map((code) => ({ value: code, label: localeName(code) }))}
      />
      {referenceUnavailable ? <ReferenceListRetry label={t('form.retry')} /> : null}
      <FormSelectField
        name="defaultTimezone"
        label={t('organization.defaultTimezone')}
        description={t(
          referenceUnavailable ? 'form.referenceList.partial' : 'organization.defaultTimezoneHint'
        )}
        value={draft.defaultTimezone}
        onChange={retain('defaultTimezone')}
        error={fieldError('defaultTimezone')}
        options={timezoneValues.map((zone) => ({
          value: zone,
          label: timeZoneLabel(zone, locale),
        }))}
      />
      {referenceUnavailable ? <ReferenceListRetry label={t('form.retry')} /> : null}

      <div className="flex flex-wrap justify-end gap-3">
        {dirty ? (
          <Button type="button" variant="outlined" onClick={discard}>
            {t('organization.discardChanges')}
          </Button>
        ) : null}
        <SubmitButton label={t('admin.save')} pendingLabel={t('admin.saving')} full={false} />
      </div>
    </form>
  );
}

interface TenantDraft {
  readonly displayName: string;
  readonly defaultLocale: string;
  readonly defaultTimezone: string;
}

const FIELDS: readonly (keyof TenantDraft)[] = ['displayName', 'defaultLocale', 'defaultTimezone'];

/**
 * The words for each tenant status `ck_tenants_status` allows. A status outside
 * the list is said as "unknown" rather than printed as it is stored.
 */
const TENANT_STATUS_KEYS: Readonly<Record<string, string>> = {
  provisioning: 'organization.tenantStatus.provisioning',
  active: 'organization.tenantStatus.active',
  suspended: 'organization.tenantStatus.suspended',
  closed: 'organization.tenantStatus.closed',
};
const TENANT_STATUS_UNKNOWN_KEY = 'organization.tenantStatus.unknown';

function Fact({
  label,
  value,
  mono = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-label font-medium text-text-primary">{label}</dt>
      <dd className={`text-body text-text-secondary ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}
