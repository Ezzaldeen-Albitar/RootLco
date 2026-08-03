import { notFound } from 'next/navigation';
import { AuthCard } from '@/features/authentication/components/AuthCard';
import { RecoveryTokenBridge } from '@/features/authentication/components/RecoveryTokenBridge';
import { tokenFromQuery } from '@/features/authentication/api/recovery-token';
import { isLocale } from '@/i18n/config';
import { getMessages, translate } from '@/i18n/get-messages';

/**
 * Account activation, from the invitee's side.
 *
 * ## This page does not activate the account, and says so
 *
 * `iam.has_permission` returns false for an account that is not `active`, and
 * every write to `iam.user_accounts` is gated on `iam.user.manage` — so an
 * invited user cannot activate itself and no request path exists that would let
 * it. That is the schema's deliberate position, not a gap: a lifecycle
 * transition has an accountable administrative actor.
 *
 * What the invitee CAN do is set their password with the provider token their
 * invitation carried, which is the same approved operation the reset flow uses.
 * `activate()` then asks the provider whether the identity is confirmed and
 * refuses if it is not — so this step is a verified precondition of the
 * administrator's, not a formality.
 *
 * The confirmation therefore tells the truth: the password is set, and an
 * administrator completes the activation. A screen that claimed "your account is
 * now active" would be wrong every time.
 */
export default async function ActivateAccountPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const messages = getMessages(locale);
  const serverToken = tokenFromQuery(await searchParams);

  return (
    <AuthCard
      title={translate(messages, 'auth.activate.title')}
      description={translate(messages, 'auth.activate.description')}
      footer={translate(messages, 'auth.activate.note')}
    >
      <RecoveryTokenBridge
        locale={locale}
        messages={messages}
        serverToken={serverToken}
        submitLabelKey="auth.reset.submit"
        doneTitleKey="auth.activate.done"
        doneBodyKey="auth.activate.doneDetail"
      />
    </AuthCard>
  );
}
