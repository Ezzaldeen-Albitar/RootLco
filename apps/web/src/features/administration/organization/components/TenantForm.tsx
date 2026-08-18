'use client';

import { useActionState, useState } from 'react';
import { TextField } from '@/components/forms/Field';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { FormFeedback } from '@/features/authentication/components/FormFeedback';
import { SubmitButton } from '@/features/authentication/components/SubmitButton';
import { updateTenantAction } from '../actions';
import type { TenantView } from '../types';

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
 * `shared.timezones`. Neither catalogue is published by an approved operation
 * (`P1-26-F-006`), so this does not offer a list it does not have: the operator
 * types a value and the backend's "not a registered platform value" verdict is
 * surfaced verbatim in meaning.
 */
export function TenantForm({
  messages,
  tenant,
  canWrite,
}: {
  readonly messages: Messages;
  readonly tenant: TenantView;
  readonly canWrite: boolean;
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
  const retain = (name: string) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [name]: event.target.value }));
  const t = (key: string) => translate(messages, key as keyof Messages);

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
    <form action={formAction} className="flex max-w-xl flex-col gap-4" noValidate>
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
        required
      />
      <TextField
        key={`defaultLocale-${state.attempt ?? 0}`}
        name="defaultLocale"
        label={t('organization.defaultLocale')}
        description={t('organization.defaultLocaleHint')}
        defaultValue={retained('defaultLocale')}
        onChange={retain('defaultLocale')}
        spellCheck={false}
      />
      <TextField
        key={`defaultTimezone-${state.attempt ?? 0}`}
        name="defaultTimezone"
        label={t('organization.defaultTimezone')}
        description={t('organization.defaultTimezoneHint')}
        defaultValue={retained('defaultTimezone')}
        onChange={retain('defaultTimezone')}
        spellCheck={false}
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
