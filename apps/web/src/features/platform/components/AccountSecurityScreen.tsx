'use client';

import { useState } from 'react';
import { PasswordField } from '@/components/forms/Field';
import { FormFeedback } from '@/features/authentication/components/FormFeedback';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { changeOwnPasswordAction } from '../actions';
import type { PlatformSession } from '../api/session';
import { PRIMARY_BUTTON, SECTION_HINT, Section } from './ui';
import { useConsoleAction } from './use-console-action';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';

/**
 * Account and security for the signed-in platform operator.
 *
 * ## Why this is not the tenant profile screen
 *
 * The tenant profile surface reads `GET /auth/session`, which declares a tenant
 * permission. A platform operator holds platform authority and no tenant role,
 * so that read answers 403 and the screen cannot render at all. This one reads
 * the console's own session and calls the console's own operation.
 *
 * ## What it shows about the identity, and what it does not
 *
 * The operator's identifier, its home organisation and its authority codes —
 * exactly what `GET /platform/session` carries. The ADDRESS is deliberately
 * absent: the control-plane connection's SELECT on the account table is
 * column-scoped, PostgreSQL column privileges are table-wide, and adding the
 * address column so an operator could read their OWN would make every
 * organisation's addresses readable from the control plane. The change of
 * password does not need it either — the server reads it from the caller's own
 * token.
 *
 * ## The form
 *
 * Three fields, each with its own reveal control, because choosing a password
 * you cannot see and confirming a password you cannot see is how a typo becomes
 * an account nobody can open. Nothing here logs a password, echoes one back
 * into a field error, or puts one in a URL: the values live in component state,
 * travel as arguments of one server function, and are cleared on success.
 *
 * The two refusals are distinct on screen because they are distinct on the
 * wire: a current password the provider would not verify marks the FIRST field,
 * a new password the provider refused marks the SECOND. RootLco holds no
 * strength rule of its own, so the interface states none.
 */
export function AccountSecurityScreen({
  messages,
  session,
}: {
  readonly messages: Messages;
  readonly session: PlatformSession;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  const action = useConsoleAction(messages);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [local, setLocal] = useState<Readonly<Record<string, string>>>({});
  // Refused attempts made here, before anything is sent. Added to the write's
  // own attempts so the cursor moves to the first thing to fix after either
  // kind of refusal (route sweep B3, question f).
  const [localAttempts, setLocalAttempts] = useState(0);

  const errors = { ...(action.state.fieldErrors ?? {}), ...local };
  const error = (name: string) =>
    errors[name] ? translateDynamic(messages, errors[name] as string) : undefined;
  const succeeded = action.state.status === 'success' && Object.keys(local).length === 0;
  const formRef = useFocusFirstInvalid({
    status: Object.keys(errors).length > 0 ? 'invalid' : 'idle',
    fieldErrors: errors,
    attempt: localAttempts + (action.state.attempt ?? 0),
  });

  /**
   * The three checks the operator can answer without a round trip.
   *
   * None of them is a strength rule — strength is the identity provider's, and
   * a minimum stated here would be a second policy the server does not hold.
   * These are: a field left blank, a confirmation that does not match, and a
   * new password that is the old one. The same three are re-applied by the
   * server function, which is the decision; this only saves a request.
   */
  const checkLocally = (): Readonly<Record<string, string>> => {
    const found: Record<string, string> = {};
    if (currentPassword === '') found.currentPassword = 'platform.error.required';
    if (newPassword === '') found.newPassword = 'platform.error.required';
    if (confirmPassword === '') found.confirmPassword = 'platform.error.required';
    if (newPassword !== '' && currentPassword !== '' && newPassword === currentPassword) {
      found.newPassword = 'platform.account.error.unchanged';
    }
    if (confirmPassword !== '' && newPassword !== confirmPassword) {
      found.confirmPassword = 'platform.account.error.mismatch';
    }
    return found;
  };

  /** Editing a field withdraws the complaint about it, and about the pair it belongs to. */
  const edit = (name: string, set: (value: string) => void) => (value: string) => {
    set(value);
    setLocal((previous) => {
      if (Object.keys(previous).length === 0) return previous;
      const next = { ...previous };
      delete next[name];
      // The two new-password fields are judged together, so correcting either
      // one withdraws the complaint about their disagreement.
      if (name === 'newPassword' || name === 'confirmPassword') delete next.confirmPassword;
      return next;
    });
  };

  const submit = () => {
    const found = checkLocally();
    setLocal(found);
    if (Object.keys(found).length > 0) {
      setLocalAttempts((count) => count + 1);
      return;
    }
    action.run(
      () => changeOwnPasswordAction({ currentPassword, newPassword, confirmPassword }),
      () => {
        // Cleared the moment the server confirms the change, so no browser
        // keeps the old or the new value in a live field.
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Section title={t('platform.account.identityTitle')}>
        <p className={SECTION_HINT}>{t('platform.account.identityHint')}</p>
        <dl className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <dt className="text-caption text-text-muted">{t('platform.account.operatorId')}</dt>
            <dd className="text-body text-text-primary" dir="ltr" data-testid="account-operator-id">
              {session.userId}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-text-muted">{t('platform.account.homeTenant')}</dt>
            <dd className="text-body text-text-primary" dir="ltr" data-testid="account-home-tenant">
              {session.homeTenantId}
            </dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-caption text-text-muted">{t('platform.account.authority')}</dt>
            <dd className="mt-1 flex flex-wrap gap-2">
              {session.platformPermissions.map((code) => (
                <span
                  key={code}
                  dir="ltr"
                  className="inline-flex rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-caption text-text-primary"
                >
                  {code}
                </span>
              ))}
            </dd>
          </div>
        </dl>
      </Section>

      <Section title={t('platform.account.passwordTitle')}>
        <p className={SECTION_HINT}>{t('platform.account.passwordHint')}</p>

        {succeeded ? (
          <div
            role="status"
            data-testid="account-password-done"
            className="mt-3 rounded-lg border border-success-border bg-success-subtle p-4"
          >
            <p className="text-body font-medium text-text-primary">
              {t('platform.account.doneTitle')}
            </p>
            <p className="mt-1 text-supporting text-text-secondary">
              {translateDynamic(messages, action.state.messageKey ?? 'platform.account.done')}
            </p>
          </div>
        ) : null}

        <form
          ref={formRef}
          noValidate
          className="mt-3 flex max-w-xl flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {action.state.status !== 'idle' && !succeeded ? (
            <FormFeedback state={action.state} messages={messages} />
          ) : null}

          <PasswordField
            name="currentPassword"
            label={t('platform.account.currentPassword')}
            required
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => edit('currentPassword', setCurrentPassword)(event.target.value)}
            error={error('currentPassword')}
            showLabel={translate(messages, 'field.password.show')}
            hideLabel={translate(messages, 'field.password.hide')}
          />

          <PasswordField
            name="newPassword"
            label={t('platform.account.newPassword')}
            description={t('platform.account.newPasswordHint')}
            required
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => edit('newPassword', setNewPassword)(event.target.value)}
            error={error('newPassword')}
            showLabel={translate(messages, 'field.password.show')}
            hideLabel={translate(messages, 'field.password.hide')}
          />

          <PasswordField
            name="confirmPassword"
            label={t('platform.account.confirmPassword')}
            required
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => edit('confirmPassword', setConfirmPassword)(event.target.value)}
            error={error('confirmPassword')}
            showLabel={translate(messages, 'field.password.show')}
            hideLabel={translate(messages, 'field.password.hide')}
          />

          <div>
            <button type="submit" className={PRIMARY_BUTTON} disabled={action.pending}>
              {t(action.pending ? 'platform.account.submitting' : 'platform.account.submit')}
            </button>
          </div>
        </form>
      </Section>
    </div>
  );
}
