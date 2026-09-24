'use client';

import { useState } from 'react';
import { CheckboxField, SelectField, TextAreaField, TextField } from '@/components/forms/Field';
import { Dialog } from '@/components/overlays/Overlays';
import { FormFeedback } from '@/features/authentication/components/FormFeedback';
import type { Messages } from '@/i18n/get-messages';
import { translateDynamic } from '@/i18n/get-messages';
import {
  addBranchAction,
  addCompanyAction,
  inviteAdministratorAction,
  resendAdministratorInvitationAction,
} from '../actions';
import type { OrganizationDetail } from '../types';
import { PRIMARY_BUTTON, SECONDARY_BUTTON, Section, SECTION_HINT } from './ui';
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
 */

type Pending = 'company' | 'branch' | 'invite' | 'resend';

export function OrganizationGrowthPanel({
  messages,
  organization,
  canManage,
}: {
  readonly messages: Messages;
  readonly organization: OrganizationDetail;
  readonly canManage: boolean;
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
    <Section
      title={t('platform.growth.title')}
      actions={
        <>
          <button
            type="button"
            className={SECONDARY_BUTTON}
            data-testid="platform-add-company"
            onClick={() => setPending('company')}
          >
            {t('platform.growth.addCompany')}
          </button>
          <button
            type="button"
            className={SECONDARY_BUTTON}
            data-testid="platform-add-branch"
            disabled={companies.length === 0}
            onClick={() => setPending('branch')}
          >
            {t('platform.growth.addBranch')}
          </button>
          <button
            type="button"
            className={SECONDARY_BUTTON}
            data-testid="platform-invite-administrator"
            onClick={() => setPending('invite')}
          >
            {t('platform.growth.inviteAdministrator')}
          </button>
          <button
            type="button"
            className={SECONDARY_BUTTON}
            data-testid="platform-resend-invitation"
            onClick={() => setPending('resend')}
          >
            {t('platform.growth.resend')}
          </button>
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
          messages={messages}
          tenantId={organization.id}
          onClose={() => setPending(null)}
        />
      ) : null}
      {pending === 'branch' ? (
        <BranchDialog
          messages={messages}
          tenantId={organization.id}
          companies={companies}
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
    </Section>
  );
}

function CompanyDialog({
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
  const [code, setCode] = useState('');
  const [legalName, setLegalName] = useState('');
  const [baseCurrency, setBaseCurrency] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [taxRegistrationNumber, setTaxRegistrationNumber] = useState('');
  // Question f: the cursor goes to the first refused field, and a complaint
  // goes once its field changes (route sweep B3).
  const { errors: refusalErrors, formRef: refusalFormRef } = useStateRefusal(action.state, {
    code,
    legalName,
    baseCurrency,
    registrationNumber,
    taxRegistrationNumber,
  });
  const errors = refusalErrors;
  const error = (name: string) => (errors[name] ? t(errors[name] as string) : undefined);

  return (
    <Dialog
      open
      onClose={onClose}
      messages={messages}
      title={t('platform.growth.addCompanyTitle')}
      description={t('platform.growth.addCompanyHint')}
    >
      <form
        ref={refusalFormRef}
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
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
      >
        {action.state.status !== 'idle' && action.state.status !== 'success' ? (
          <FormFeedback state={action.state} messages={messages} />
        ) : null}
        <TextField
          name="code"
          label={t('platform.provision.code')}
          description={t('platform.provision.codeHint')}
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
          error={error('code')}
        />
        <TextField
          name="legalName"
          label={t('platform.provision.legalName')}
          required
          value={legalName}
          onChange={(event) => setLegalName(event.target.value)}
          error={error('legalName')}
        />
        <TextField
          name="baseCurrency"
          label={t('platform.provision.baseCurrency')}
          description={t('platform.provision.currencyHint')}
          required
          value={baseCurrency}
          onChange={(event) => setBaseCurrency(event.target.value)}
          error={error('baseCurrency')}
        />
        <TextField
          name="registrationNumber"
          label={t('platform.provision.registration')}
          value={registrationNumber}
          onChange={(event) => setRegistrationNumber(event.target.value)}
          error={error('registrationNumber')}
        />
        <TextField
          name="taxRegistrationNumber"
          label={t('platform.provision.taxRegistration')}
          value={taxRegistrationNumber}
          onChange={(event) => setTaxRegistrationNumber(event.target.value)}
          error={error('taxRegistrationNumber')}
        />
        <DialogButtons messages={messages} pending={action.pending} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

function BranchDialog({
  messages,
  tenantId,
  companies,
  onClose,
}: {
  readonly messages: Messages;
  readonly tenantId: string;
  readonly companies: OrganizationDetail['companies'];
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
  const { errors: refusalErrors, formRef: refusalFormRef } = useStateRefusal(action.state, {
    companyId,
    code,
    name,
    timezone,
    city,
    countryCode,
  });
  const errors = refusalErrors;
  const error = (field: string) => (errors[field] ? t(errors[field] as string) : undefined);

  return (
    <Dialog
      open
      onClose={onClose}
      messages={messages}
      title={t('platform.growth.addBranchTitle')}
      description={t('platform.growth.addBranchHint')}
    >
      <form
        ref={refusalFormRef}
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
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
      >
        {action.state.status !== 'idle' && action.state.status !== 'success' ? (
          <FormFeedback state={action.state} messages={messages} />
        ) : null}
        <SelectField
          name="companyId"
          label={t('platform.growth.company')}
          required
          value={companyId}
          placeholder={t('platform.provision.choose')}
          onChange={(event) => setCompanyId(event.target.value)}
          options={companies.map((company) => ({ value: company.id, label: company.legalName }))}
          error={error('companyId')}
        />
        <TextField
          name="code"
          label={t('platform.provision.code')}
          description={t('platform.provision.codeHint')}
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
          error={error('code')}
        />
        <TextField
          name="name"
          label={t('platform.provision.name')}
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={error('name')}
        />
        <TextField
          name="timezone"
          label={t('platform.provision.timeZone')}
          description={t('platform.provision.timeZoneHint')}
          required
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
          error={error('timezone')}
        />
        <TextField
          name="city"
          label={t('platform.provision.city')}
          value={city}
          onChange={(event) => setCity(event.target.value)}
          error={error('city')}
        />
        <TextField
          name="countryCode"
          label={t('platform.provision.country')}
          description={t('platform.provision.countryHint')}
          value={countryCode}
          onChange={(event) => setCountryCode(event.target.value)}
          error={error('countryCode')}
        />
        <DialogButtons messages={messages} pending={action.pending} onCancel={onClose} />
      </form>
    </Dialog>
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
  const { errors: refusalErrors, formRef: refusalFormRef } = useStateRefusal(action.state, {
    email,
    displayName,
    reason,
  });
  const errors = refusalErrors;
  const error = (field: string) => (errors[field] ? t(errors[field] as string) : undefined);

  return (
    <Dialog
      open
      onClose={onClose}
      messages={messages}
      title={t('platform.growth.inviteTitle')}
      description={t('platform.growth.inviteHint')}
    >
      <form
        ref={refusalFormRef}
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
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
      >
        {action.state.status !== 'idle' && action.state.status !== 'success' ? (
          <FormFeedback state={action.state} messages={messages} />
        ) : null}
        <TextField
          name="email"
          type="email"
          label={t('platform.provision.email')}
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={error('email')}
        />
        <TextField
          name="displayName"
          label={t('platform.provision.displayName')}
          required
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
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
        <CheckboxField
          name="additionalAdministrator"
          label={t('platform.growth.additional')}
          description={t('platform.growth.additionalHint')}
          checked={additional}
          onChange={(event) => setAdditional(event.target.checked)}
          error={error('additionalAdministrator')}
        />
        {additional ? (
          <TextAreaField
            name="reason"
            label={t('platform.reason')}
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={error('reason')}
          />
        ) : null}
        <DialogButtons messages={messages} pending={action.pending} onCancel={onClose} />
      </form>
    </Dialog>
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
  const { errors: refusalErrors, formRef: refusalFormRef } = useStateRefusal(action.state, {
    email,
  });
  const errors = refusalErrors;

  return (
    <Dialog
      open
      onClose={onClose}
      messages={messages}
      title={t('platform.growth.resendTitle')}
      description={t('platform.growth.resendHint')}
    >
      <form
        ref={refusalFormRef}
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          action.run(() => resendAdministratorInvitationAction(tenantId, email), onClose);
        }}
      >
        {action.state.status !== 'idle' && action.state.status !== 'success' ? (
          <FormFeedback state={action.state} messages={messages} />
        ) : null}
        <TextField
          name="email"
          type="email"
          label={t('platform.provision.email')}
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={errors['email'] ? t(errors['email'] as string) : undefined}
        />
        <DialogButtons messages={messages} pending={action.pending} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

function DialogButtons({
  messages,
  pending,
  onCancel,
}: {
  readonly messages: Messages;
  readonly pending: boolean;
  readonly onCancel: () => void;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  return (
    <div className="flex justify-end gap-2">
      <button type="button" className={SECONDARY_BUTTON} onClick={onCancel}>
        {t('overlay.cancel')}
      </button>
      <button type="submit" className={PRIMARY_BUTTON} disabled={pending}>
        {pending ? t('overlay.working') : t('platform.save')}
      </button>
    </div>
  );
}
