'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState, type ChangeEvent } from 'react';
import { CheckboxField, SelectField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { FormFeedback } from '@/features/authentication/components/FormFeedback';
import { SubmitButton } from '@/features/authentication/components/SubmitButton';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translateDynamic } from '@/i18n/get-messages';
import { IDLE } from '@/lib/forms/action-result';
import { provisionOrganizationAction } from '../actions';
import type { ProvisionState, SubscriptionPlan } from '../types';
import { Section } from './ui';

/**
 * Provisioning a new organisation (P1-32-PRE-065).
 *
 * One request creates the organisation, its first company and branch and its
 * first administrator, who is sent an email to set a password. The optional
 * subscription is offered only when the plan catalogue could be read, and the
 * activate choice only to an operator who holds the lifecycle authority.
 *
 * Typed values survive a refusal: every control is keyed on the attempt and
 * re-seeded from retained state, so correcting one field does not empty the rest.
 */
export function ProvisionOrganizationScreen({
  locale,
  messages,
  plans,
  canActivate,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly plans: readonly SubscriptionPlan[] | null;
  readonly canActivate: boolean;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<ProvisionState, FormData>(
    provisionOrganizationAction,
    IDLE
  );
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [activate, setActivate] = useState(false);
  const t = (key: string) => translateDynamic(messages, key);

  useEffect(() => {
    if (state.status === 'idle') return;
    notifyActionResult(state, messages);
    if (state.status === 'success' && state.tenantId) {
      router.push(`/${locale}/platform/organizations/${state.tenantId}`);
    }
  }, [state, messages, router, locale]);

  const attempt = state.attempt ?? 0;
  const retain = (name: string) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft((current) => ({ ...current, [name]: event.target.value }));
  const fieldError = (name: string) =>
    state.fieldErrors?.[name] ? t(state.fieldErrors[name] as string) : undefined;

  const activePlans = (plans ?? []).filter((plan) => plan.status === 'active');

  return (
    <form action={formAction} noValidate className="flex max-w-content flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />
      {state.status === 'success' ? (
        <p
          role="status"
          className="rounded-md border border-success-border bg-success-subtle px-3 py-2 text-body text-text-primary"
        >
          {t('platform.provision.done')}
        </p>
      ) : (
        <FormFeedback state={state} messages={messages} />
      )}

      <Section title={t('platform.provision.organization')}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <TextField
            key={`tenantCode-${attempt}`}
            name="tenantCode"
            defaultValue={draft['tenantCode'] ?? ''}
            onChange={retain('tenantCode')}
            error={fieldError('tenantCode')}
            label={t('platform.provision.code')}
            description={t('platform.provision.codeHint')}
            required
            autoComplete="off"
            spellCheck={false}
            dir="ltr"
          />
          <TextField
            key={`tenantName-${attempt}`}
            name="tenantName"
            defaultValue={draft['tenantName'] ?? ''}
            onChange={retain('tenantName')}
            error={fieldError('tenantName')}
            label={t('platform.provision.name')}
            required
            autoComplete="off"
          />
          <SelectField
            key={`tenantLocale-${attempt}`}
            name="tenantLocale"
            defaultValue={draft['tenantLocale'] ?? ''}
            onChange={retain('tenantLocale')}
            error={fieldError('tenantLocale')}
            label={t('platform.provision.language')}
            required
            placeholder={t('platform.provision.choose')}
            options={[
              { value: 'ar', label: t('locale.ar') },
              { value: 'en', label: t('locale.en') },
            ]}
          />
          <TextField
            key={`tenantTimezone-${attempt}`}
            name="tenantTimezone"
            defaultValue={draft['tenantTimezone'] ?? ''}
            onChange={retain('tenantTimezone')}
            error={fieldError('tenantTimezone')}
            label={t('platform.provision.timeZone')}
            description={t('platform.provision.timeZoneHint')}
            required
            autoComplete="off"
            dir="ltr"
          />
        </div>
      </Section>

      <Section title={t('platform.provision.company')}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <TextField
            key={`companyCode-${attempt}`}
            name="companyCode"
            defaultValue={draft['companyCode'] ?? ''}
            onChange={retain('companyCode')}
            error={fieldError('companyCode')}
            label={t('platform.provision.code')}
            required
            autoComplete="off"
            spellCheck={false}
            dir="ltr"
          />
          <TextField
            key={`companyLegalName-${attempt}`}
            name="companyLegalName"
            defaultValue={draft['companyLegalName'] ?? ''}
            onChange={retain('companyLegalName')}
            error={fieldError('companyLegalName')}
            label={t('platform.provision.legalName')}
            required
            autoComplete="off"
          />
          <TextField
            key={`companyCurrency-${attempt}`}
            name="companyCurrency"
            defaultValue={draft['companyCurrency'] ?? ''}
            onChange={retain('companyCurrency')}
            error={fieldError('companyCurrency')}
            label={t('platform.provision.baseCurrency')}
            description={t('platform.provision.currencyHint')}
            required
            maxLength={3}
            autoComplete="off"
            dir="ltr"
          />
          <TextField
            key={`companyRegistration-${attempt}`}
            name="companyRegistration"
            defaultValue={draft['companyRegistration'] ?? ''}
            onChange={retain('companyRegistration')}
            error={fieldError('companyRegistration')}
            label={t('platform.provision.registration')}
            autoComplete="off"
            dir="ltr"
          />
          <TextField
            key={`companyTaxRegistration-${attempt}`}
            name="companyTaxRegistration"
            defaultValue={draft['companyTaxRegistration'] ?? ''}
            onChange={retain('companyTaxRegistration')}
            error={fieldError('companyTaxRegistration')}
            label={t('platform.provision.taxRegistration')}
            autoComplete="off"
            dir="ltr"
          />
        </div>
      </Section>

      <Section title={t('platform.provision.branch')}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <TextField
            key={`branchCode-${attempt}`}
            name="branchCode"
            defaultValue={draft['branchCode'] ?? ''}
            onChange={retain('branchCode')}
            error={fieldError('branchCode')}
            label={t('platform.provision.code')}
            required
            autoComplete="off"
            spellCheck={false}
            dir="ltr"
          />
          <TextField
            key={`branchName-${attempt}`}
            name="branchName"
            defaultValue={draft['branchName'] ?? ''}
            onChange={retain('branchName')}
            error={fieldError('branchName')}
            label={t('platform.provision.name')}
            required
            autoComplete="off"
          />
          <TextField
            key={`branchCity-${attempt}`}
            name="branchCity"
            defaultValue={draft['branchCity'] ?? ''}
            onChange={retain('branchCity')}
            error={fieldError('branchCity')}
            label={t('platform.provision.city')}
            autoComplete="off"
          />
          <TextField
            key={`branchCountry-${attempt}`}
            name="branchCountry"
            defaultValue={draft['branchCountry'] ?? ''}
            onChange={retain('branchCountry')}
            error={fieldError('branchCountry')}
            label={t('platform.provision.country')}
            description={t('platform.provision.countryHint')}
            maxLength={2}
            autoComplete="off"
            dir="ltr"
          />
          <TextField
            key={`branchTimezone-${attempt}`}
            name="branchTimezone"
            defaultValue={draft['branchTimezone'] ?? ''}
            onChange={retain('branchTimezone')}
            error={fieldError('branchTimezone')}
            label={t('platform.provision.timeZone')}
            description={t('platform.provision.timeZoneHint')}
            required
            autoComplete="off"
            dir="ltr"
          />
        </div>
      </Section>

      <Section title={t('platform.provision.administrator')}>
        <p className="mb-3 text-supporting text-text-muted">
          {t('platform.provision.administratorHint')}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <TextField
            key={`ownerEmail-${attempt}`}
            name="ownerEmail"
            defaultValue={draft['ownerEmail'] ?? ''}
            onChange={retain('ownerEmail')}
            error={fieldError('ownerEmail')}
            type="email"
            label={t('platform.provision.email')}
            required
            autoComplete="off"
            spellCheck={false}
            dir="ltr"
          />
          <TextField
            key={`ownerDisplayName-${attempt}`}
            name="ownerDisplayName"
            defaultValue={draft['ownerDisplayName'] ?? ''}
            onChange={retain('ownerDisplayName')}
            error={fieldError('ownerDisplayName')}
            label={t('platform.provision.displayName')}
            required
            autoComplete="off"
          />
        </div>
      </Section>

      {plans !== null ? (
        <Section title={t('platform.provision.subscription')}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <SelectField
              key={`planCode-${attempt}`}
              name="planCode"
              defaultValue={draft['planCode'] ?? ''}
              onChange={retain('planCode')}
              error={fieldError('planCode')}
              label={t('platform.provision.plan')}
              placeholder={t('platform.provision.noSubscription')}
              options={activePlans.map((plan) => ({
                value: plan.planCode,
                label: plan.displayName ?? plan.name,
              }))}
            />
            <TextField
              key={`subscriptionStart-${attempt}`}
              name="subscriptionStart"
              defaultValue={draft['subscriptionStart'] ?? ''}
              onChange={retain('subscriptionStart')}
              error={fieldError('subscriptionStart')}
              type="date"
              label={t('platform.provision.startDate')}
            />
          </div>
        </Section>
      ) : null}

      {canActivate ? (
        <CheckboxField
          key={`activate-${attempt}`}
          name="activate"
          label={t('platform.provision.activate')}
          description={t('platform.provision.activateHint')}
          defaultChecked={activate}
          onChange={(event) => setActivate(event.target.checked)}
        />
      ) : null}

      <div className="flex justify-end">
        {state.status === 'success' ? null : (
          <SubmitButton
            label={t('platform.provision.submit')}
            pendingLabel={t('platform.provision.submitting')}
            full={false}
          />
        )}
      </div>
    </form>
  );
}
