'use client';

import { useState, type FormEvent, type RefObject } from 'react';
import Button from '@mui/material/Button';
import {
  useUnavailableListGuard,
  type UnavailableListGuard,
} from '@/components/forms/ReferenceList';
import { FormCheckboxField } from '@/components/forms/mui/FormCheckboxField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { FormDialog } from '@/features/administration/shared/components/FormDialog';
import { ListRetry } from '@/features/administration/shared/components/ListRetry';
import { MuiFormFeedback } from '@/features/authentication/components/MuiFormFeedback';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translateDynamic } from '@/i18n/get-messages';
import { currencyLabel, timeZoneLabel } from '@/lib/format';
import {
  addBranchAction,
  addCompanyAction,
  inviteAdministratorAction,
  resendAdministratorInvitationAction,
} from '../actions';
import type { OrganizationDetail, ReferenceValues } from '../types';
import { ConsoleSection } from './console-parts';
import { SECTION_HINT } from './ui';
import { useConsoleAction } from './use-console-action';
import { useStateRefusal } from '@/lib/forms/use-local-refusal';

/**
 * Growing an organisation that is already running (P1-32-PRE-151).
 *
 * Three acts the control plane could not perform at all before this slice: a
 * second legal company, another branch, and an administrator for an
 * organisation that has none — the state an organisation is left in when its
 * first owner never accepts the invitation, and the state in which nobody
 * inside it can put anything right.
 *
 * Each dialog sends ONE published operation and shows the server's refusal as
 * the server gave it. Nothing here re-checks a permission or a capacity ceiling:
 * the panel appears for an operator whose authority could satisfy it, and the
 * database decides. A refusal for a spent plan allowance arrives as its own
 * sentence, naming the ceiling and the usage.
 *
 * The base currency and the branch time zone are selects fed from the reference
 * registers (`platform.reference-values-read`, P1-32-PRE-OD-REF): a currency
 * reads as its name in the reader's language with its code beside it, a zone as
 * its generic name with its identifier (P1-32-PRE-OD-QAF, D-1). A select with
 * nothing to offer says so on the field, offers Try again, and refuses the
 * submission on that field; it never becomes free text.
 *
 * ## On Material UI (ADR-022, P1-32-PRE-OD-WP06B)
 *
 * The four dialogs are the shared form dialog with the Material fields; what
 * each sends is unchanged, field for field. The list guard is the shared one
 * (`useUnavailableListGuard`), handed the dialog's own form, because the form
 * dialog answers a submission with no event of its own. Try again is the
 * administration's shared Material retry (`ListRetry`, the one the Organisation
 * screen uses), which renders the page again as `ReferenceListRetry` did.
 */

type Pending = 'company' | 'branch' | 'invite' | 'resend';

/**
 * Whether the list guard stops this submission. The guard reads the form a
 * submission came from; the form dialog hands its caller none, so the guard is
 * given the dialog's own form — the one the submission was made in.
 */
function stoppedForList(
  guard: UnavailableListGuard,
  formRef: RefObject<HTMLFormElement | null>
): boolean {
  const form = formRef.current;
  if (form === null) return false;
  const submission = {
    currentTarget: form,
    preventDefault: () => undefined,
  } as unknown as FormEvent<HTMLFormElement>;
  return guard.stop(submission);
}

export function OrganizationGrowthPanel({
  locale,
  messages,
  organization,
  canManage,
  referenceValues,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly organization: OrganizationDetail;
  readonly canManage: boolean;
  readonly referenceValues: ReferenceValues | null;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  const [pending, setPending] = useState<Pending | null>(null);
  const companies = organization.companies.filter((company) => company.status === 'active');
  // A closed organisation is not grown. Suspended is refused by the database
  // too (`ERR-CAP-002`), and the button stays so the operator sees the reason
  // rather than a disappearing action.
  const offered = canManage && organization.status !== 'closed';

  if (!offered) return null;

  return (
    <ConsoleSection
      title={t('platform.growth.title')}
      actions={
        <>
          <Button
            type="button"
            variant="outlined"
            data-testid="platform-add-company"
            onClick={() => setPending('company')}
          >
            {t('platform.growth.addCompany')}
          </Button>
          <Button
            type="button"
            variant="outlined"
            data-testid="platform-add-branch"
            disabled={companies.length === 0}
            onClick={() => setPending('branch')}
          >
            {t('platform.growth.addBranch')}
          </Button>
          <Button
            type="button"
            variant="outlined"
            data-testid="platform-invite-administrator"
            onClick={() => setPending('invite')}
          >
            {t('platform.growth.inviteAdministrator')}
          </Button>
          <Button
            type="button"
            variant="outlined"
            data-testid="platform-resend-invitation"
            onClick={() => setPending('resend')}
          >
            {t('platform.growth.resend')}
          </Button>
        </>
      }
    >
      <p className={SECTION_HINT}>
        {companies.length === 0
          ? t('platform.growth.noCompanies')
          : t('platform.growth.inviteHint')}
      </p>

      {pending === 'company' ? (
        <CompanyDialog
          locale={locale}
          messages={messages}
          tenantId={organization.id}
          referenceValues={referenceValues}
          onClose={() => setPending(null)}
        />
      ) : null}
      {pending === 'branch' ? (
        <BranchDialog
          locale={locale}
          messages={messages}
          tenantId={organization.id}
          companies={companies}
          referenceValues={referenceValues}
          onClose={() => setPending(null)}
        />
      ) : null}
      {pending === 'invite' ? (
        <AdministratorDialog
          messages={messages}
          tenantId={organization.id}
          onClose={() => setPending(null)}
        />
      ) : null}
      {pending === 'resend' ? (
        <ResendDialog
          messages={messages}
          tenantId={organization.id}
          onClose={() => setPending(null)}
        />
      ) : null}
    </ConsoleSection>
  );
}

function CompanyDialog({
  locale,
  messages,
  tenantId,
  referenceValues,
  onClose,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly tenantId: string;
  readonly referenceValues: ReferenceValues | null;
  readonly onClose: () => void;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  const action = useConsoleAction(messages);
  const [code, setCode] = useState('');
  const [legalName, setLegalName] = useState('');
  const [baseCurrency, setBaseCurrency] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [taxRegistrationNumber, setTaxRegistrationNumber] = useState('');
  // Question f: the cursor goes to the first refused field, and a complaint
  // goes once its field changes (route sweep B3).
  const { errors, formRef } = useStateRefusal(action.state, {
    code,
    legalName,
    baseCurrency,
    registrationNumber,
    taxRegistrationNumber,
  });
  const currencyOptions = (referenceValues?.currencies ?? []).map((currency) => ({
    value: currency.code,
    label: currencyLabel(currency.code, locale, currency.name),
  }));
  const currencyMissing = currencyOptions.length === 0;
  const listGuard = useUnavailableListGuard(currencyMissing ? ['baseCurrency'] : []);
  const error = (name: string) =>
    errors[name]
      ? t(errors[name] as string)
      : listGuard.refused(name)
        ? t('form.referenceList.blocked')
        : undefined;

  return (
    <FormDialog
      messages={messages}
      title={t('platform.growth.addCompanyTitle')}
      description={t('platform.growth.addCompanyHint')}
      submitLabel={t('platform.save')}
      pendingLabel={t('overlay.working')}
      pending={action.pending}
      onCancel={onClose}
      onSubmit={() => {
        if (stoppedForList(listGuard, formRef)) return;
        action.run(
          () =>
            addCompanyAction(tenantId, {
              code,
              legalName,
              baseCurrency: baseCurrency.toUpperCase(),
              registrationNumber,
              taxRegistrationNumber,
            }),
          onClose
        );
      }}
      formRef={formRef}
      testId="platform-company-dialog"
    >
      {action.state.status !== 'idle' && action.state.status !== 'success' ? (
        <MuiFormFeedback state={action.state} messages={messages} />
      ) : null}
      <FormTextField
        name="code"
        label={t('platform.provision.code')}
        description={t('platform.provision.codeHint')}
        required
        dir="ltr"
        spellCheck={false}
        autoFocus
        value={code}
        onChange={setCode}
        error={error('code')}
      />
      <FormTextField
        name="legalName"
        label={t('platform.provision.legalName')}
        required
        value={legalName}
        onChange={setLegalName}
        error={error('legalName')}
      />
      <FormSelectField
        name="baseCurrency"
        label={t('platform.provision.baseCurrency')}
        description={
          currencyMissing
            ? t('platform.provision.referenceUnavailable')
            : t('platform.provision.currencyHint')
        }
        required
        value={baseCurrency}
        placeholder={t('platform.provision.choose')}
        onChange={setBaseCurrency}
        options={currencyOptions}
        error={error('baseCurrency')}
      />
      {currencyMissing ? <ListRetry label={t('form.retry')} /> : null}
      <FormTextField
        name="registrationNumber"
        label={t('platform.provision.registration')}
        value={registrationNumber}
        onChange={setRegistrationNumber}
        error={error('registrationNumber')}
      />
      <FormTextField
        name="taxRegistrationNumber"
        label={t('platform.provision.taxRegistration')}
        value={taxRegistrationNumber}
        onChange={setTaxRegistrationNumber}
        error={error('taxRegistrationNumber')}
      />
    </FormDialog>
  );
}

function BranchDialog({
  locale,
  messages,
  tenantId,
  companies,
  referenceValues,
  onClose,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly tenantId: string;
  readonly companies: OrganizationDetail['companies'];
  readonly referenceValues: ReferenceValues | null;
  readonly onClose: () => void;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  const action = useConsoleAction(messages);
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [city, setCity] = useState('');
  const [countryCode, setCountryCode] = useState('');
  // Question f: the cursor goes to the first refused field, and a complaint
  // goes once its field changes (route sweep B3).
  const { errors, formRef } = useStateRefusal(action.state, {
    companyId,
    code,
    name,
    timezone,
    city,
    countryCode,
  });
  const timezoneOptions = (referenceValues?.timezones ?? []).map((zone) => ({
    value: zone.zoneName,
    label: timeZoneLabel(zone.zoneName, locale),
  }));
  const timezoneMissing = timezoneOptions.length === 0;
  const listGuard = useUnavailableListGuard(timezoneMissing ? ['timezone'] : []);
  const error = (field: string) =>
    errors[field]
      ? t(errors[field] as string)
      : listGuard.refused(field)
        ? t('form.referenceList.blocked')
        : undefined;

  return (
    <FormDialog
      messages={messages}
      title={t('platform.growth.addBranchTitle')}
      description={t('platform.growth.addBranchHint')}
      submitLabel={t('platform.save')}
      pendingLabel={t('overlay.working')}
      pending={action.pending}
      onCancel={onClose}
      onSubmit={() => {
        if (stoppedForList(listGuard, formRef)) return;
        action.run(
          () =>
            addBranchAction(tenantId, {
              companyId,
              code,
              name,
              timezone,
              city,
              countryCode: countryCode.toUpperCase(),
            }),
          onClose
        );
      }}
      formRef={formRef}
      testId="platform-branch-dialog"
    >
      {action.state.status !== 'idle' && action.state.status !== 'success' ? (
        <MuiFormFeedback state={action.state} messages={messages} />
      ) : null}
      <FormSelectField
        name="companyId"
        label={t('platform.growth.company')}
        required
        value={companyId}
        placeholder={t('platform.provision.choose')}
        onChange={setCompanyId}
        options={companies.map((company) => ({ value: company.id, label: company.legalName }))}
        error={error('companyId')}
      />
      <FormTextField
        name="code"
        label={t('platform.provision.code')}
        description={t('platform.provision.codeHint')}
        required
        dir="ltr"
        spellCheck={false}
        value={code}
        onChange={setCode}
        error={error('code')}
      />
      <FormTextField
        name="name"
        label={t('platform.provision.name')}
        required
        value={name}
        onChange={setName}
        error={error('name')}
      />
      <FormSelectField
        name="timezone"
        label={t('platform.provision.timeZone')}
        description={
          timezoneMissing
            ? t('platform.provision.referenceUnavailable')
            : t('platform.provision.timeZoneHint')
        }
        required
        value={timezone}
        placeholder={t('platform.provision.choose')}
        onChange={setTimezone}
        options={timezoneOptions}
        error={error('timezone')}
      />
      {timezoneMissing ? <ListRetry label={t('form.retry')} /> : null}
      <FormTextField
        name="city"
        label={t('platform.provision.city')}
        value={city}
        onChange={setCity}
        error={error('city')}
      />
      <FormTextField
        name="countryCode"
        label={t('platform.provision.country')}
        description={t('platform.provision.countryHint')}
        dir="ltr"
        spellCheck={false}
        value={countryCode}
        onChange={setCountryCode}
        error={error('countryCode')}
      />
    </FormDialog>
  );
}

function AdministratorDialog({
  messages,
  tenantId,
  onClose,
}: {
  readonly messages: Messages;
  readonly tenantId: string;
  readonly onClose: () => void;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  const action = useConsoleAction(messages);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [additional, setAdditional] = useState(false);
  const [reason, setReason] = useState('');
  // Question f: the cursor goes to the first refused field, and a complaint
  // goes once its field changes (route sweep B3).
  const { errors, formRef } = useStateRefusal(action.state, {
    email,
    displayName,
    reason,
  });
  const error = (field: string) => (errors[field] ? t(errors[field] as string) : undefined);

  return (
    <FormDialog
      messages={messages}
      title={t('platform.growth.inviteTitle')}
      description={t('platform.growth.inviteHint')}
      submitLabel={t('platform.save')}
      pendingLabel={t('overlay.working')}
      pending={action.pending}
      onCancel={onClose}
      onSubmit={() => {
        action.run(
          () =>
            inviteAdministratorAction(tenantId, {
              email,
              displayName,
              ...(additional ? { additionalAdministrator: true, reason } : {}),
            }),
          onClose
        );
      }}
      formRef={formRef}
      testId="platform-invite-dialog"
    >
      {action.state.status !== 'idle' && action.state.status !== 'success' ? (
        <MuiFormFeedback state={action.state} messages={messages} />
      ) : null}
      <FormTextField
        name="email"
        type="email"
        label={t('platform.provision.email')}
        required
        dir="ltr"
        spellCheck={false}
        autoFocus
        value={email}
        onChange={setEmail}
        error={error('email')}
      />
      <FormTextField
        name="displayName"
        label={t('platform.provision.displayName')}
        required
        value={displayName}
        onChange={setDisplayName}
        error={error('displayName')}
      />
      {/*
        The refusal for an organisation that already has an active
        administrator is filed by the service under this control, because
        this is the control that cures it: tick it, give the reason, save
        again. Without the `error` prop the sentence arrived in the form's
        field errors and was dropped, and the operator was shown the generic
        conflict line instead (Owner directive, user-facing errors).
      */}
      <FormCheckboxField
        name="additionalAdministrator"
        label={t('platform.growth.additional')}
        description={t('platform.growth.additionalHint')}
        checked={additional}
        onChange={setAdditional}
        error={error('additionalAdministrator')}
      />
      {additional ? (
        <FormTextField
          name="reason"
          multiline
          rows={3}
          label={t('platform.reason')}
          required
          value={reason}
          onChange={setReason}
          error={error('reason')}
        />
      ) : null}
    </FormDialog>
  );
}

function ResendDialog({
  messages,
  tenantId,
  onClose,
}: {
  readonly messages: Messages;
  readonly tenantId: string;
  readonly onClose: () => void;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  const action = useConsoleAction(messages);
  const [email, setEmail] = useState('');
  // Question f: the cursor goes to the first refused field, and a complaint
  // goes once its field changes (route sweep B3).
  const { errors, formRef } = useStateRefusal(action.state, {
    email,
  });

  return (
    <FormDialog
      messages={messages}
      title={t('platform.growth.resendTitle')}
      description={t('platform.growth.resendHint')}
      submitLabel={t('platform.save')}
      pendingLabel={t('overlay.working')}
      pending={action.pending}
      onCancel={onClose}
      onSubmit={() => {
        action.run(() => resendAdministratorInvitationAction(tenantId, email), onClose);
      }}
      formRef={formRef}
      testId="platform-resend-dialog"
    >
      {action.state.status !== 'idle' && action.state.status !== 'success' ? (
        <MuiFormFeedback state={action.state} messages={messages} />
      ) : null}
      <FormTextField
        name="email"
        type="email"
        label={t('platform.provision.email')}
        required
        dir="ltr"
        spellCheck={false}
        autoFocus
        value={email}
        onChange={setEmail}
        error={errors['email'] ? t(errors['email'] as string) : undefined}
      />
    </FormDialog>
  );
}
