'use client';

import { useActionState, useState } from 'react';
import { SelectField, TextField } from '@/components/forms/Field';
import { LOCALES, isLocale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { FormFeedback } from '@/features/authentication/components/FormFeedback';
import { SubmitButton } from '@/features/authentication/components/SubmitButton';
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
 * someone inside this application.
 *
 * Locale and timezone are foreign keys to `shared.languages` and
 * `shared.timezones`, and both are selects fed from `org.reference-values-read`
 * (P1-32-PRE-OD-REF, closing `P1-26-F-006`): a language is offered when the
 * platform holds it and the interface can be shown in it, a zone when the
 * platform holds it. When that read was not permitted or failed, the language
 * falls back to the interface languages and the zone to the zones already in
 * use, as it also does when the list holds no active zone. The saved value is always one of the choices, so an untouched form still
 * submits it. Nothing is typed; a refusal is still shown on its field.
 */
export function TenantForm({
  messages,
  tenant,
  canWrite,
  referenceValues = null,
  timezoneChoices = [],
}: {
  readonly messages: Messages;
  readonly tenant: TenantView;
  readonly canWrite: boolean;
  /** `org.reference-values-read`; `null` when it was not permitted or failed. */
  readonly referenceValues?: ReferenceValues | null;
  /** The zones the tenant and its branches already use — the fallback. */
  readonly timezoneChoices?: readonly string[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateTenantAction, IDLE);
  /*
   * Seeded from the SAVED values so an untouched form still submits them,
   * then owned by the draft so a refused save restores what the operator
   * typed rather than what the server already held.
   */
  const [draft, setDraft] = useState<Record<string, string>>({
    displayName: tenant.displayName,
    defaultLocale: tenant.defaultLocale,
    defaultTimezone: tenant.defaultTimezone,
  });
  const retained = (name: string) => draft[name] ?? '';
  // Question f: the cursor goes to the refused field, and its complaint goes
  // once the operator edits it (route sweep B3).
  const {
    edited: refusalEdited,
    errorKey: refusalErrorKey,
    formRef: refusalFormRef,
  } = useActionRefusal(state);
  const retain = (name: string) => (event: { target: { value: string } }) => {
    refusalEdited(name);
    setDraft((current) => ({ ...current, [name]: event.target.value }));
  };
  const t = (key: string) => translate(messages, key as keyof Messages);
  // The refusal is said on the field it is about, not only in the banner.
  const fieldError = (name: string) => {
    const key = refusalErrorKey(name);
    return key ? t(key) : undefined;
  };

  const withSaved = (values: readonly string[], saved: string) =>
    saved && !values.includes(saved) ? [saved, ...values] : values;
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

  if (!canWrite) {
    return (
      <dl className="grid gap-4 sm:grid-cols-2">
        <Fact label={t('organization.tenantCode')} value={tenant.tenantCode} mono />
        <Fact label={t('organization.displayName')} value={tenant.displayName} />
        <Fact label={t('organization.status')} value={tenant.status} />
        <Fact label={t('organization.defaultLocale')} value={tenant.defaultLocale} />
        <Fact label={t('organization.defaultTimezone')} value={tenant.defaultTimezone} />
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
        <Fact label={t('organization.status')} value={tenant.status} />
      </dl>

      {/*
        Seeded from the SAVED value and then owned by the draft. The
        difference matters on a refused save: without the draft the reset
        restores `tenant.displayName` — the value on the server — so the
        operator’s edit is replaced by the thing they were trying to change,
        which reads as the save having silently succeeded in reverse.
      */}
      <TextField
        key={`displayName-${state.attempt ?? 0}`}
        name="displayName"
        label={t('organization.displayName')}
        defaultValue={retained('displayName')}
        onChange={retain('displayName')}
        error={fieldError('displayName')}
        required
      />
      <SelectField
        key={`defaultLocale-${state.attempt ?? 0}`}
        name="defaultLocale"
        label={t('organization.defaultLocale')}
        description={t('organization.defaultLocaleHint')}
        defaultValue={retained('defaultLocale')}
        onChange={retain('defaultLocale')}
        error={fieldError('defaultLocale')}
        options={localeValues.map((code) => ({
          value: code,
          label: isLocale(code) ? t(`locale.${code}`) : code,
        }))}
      />
      <SelectField
        key={`defaultTimezone-${state.attempt ?? 0}`}
        name="defaultTimezone"
        label={t('organization.defaultTimezone')}
        description={t('organization.defaultTimezoneHint')}
        defaultValue={retained('defaultTimezone')}
        onChange={retain('defaultTimezone')}
        error={fieldError('defaultTimezone')}
        options={timezoneValues.map((zone) => ({ value: zone, label: zone }))}
        dir="ltr"
      />

      <div className="flex justify-end">
        <SubmitButton label={t('admin.save')} pendingLabel={t('admin.saving')} full={false} />
      </div>
    </form>
  );
}

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
