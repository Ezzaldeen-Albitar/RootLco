import { notFound } from 'next/navigation';
import { AuthCard } from '@/features/authentication/components/AuthCard';
import { MissingToken } from '@/features/authentication/components/MissingToken';
import { RecoveryTokenBridge } from '@/features/authentication/components/RecoveryTokenBridge';
import { SetPasswordForm } from '@/features/authentication/components/SetPasswordForm';
import { tokenFromQuery } from '@/features/authentication/api/recovery-token';
import { isLocale } from '@/i18n/config';
import { getMessages, translate } from '@/i18n/get-messages';

export default async function ResetPasswordPage({
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
      title={translate(messages, 'auth.reset.title')}
      description={translate(messages, 'auth.reset.description')}
    >
      <RecoveryTokenBridge
        serverToken={serverToken}
        fallback={<MissingToken locale={locale} messages={messages} />}
      >
        {(token) => (
          <SetPasswordForm
            locale={locale}
            messages={messages}
            token={token}
            submitLabelKey="auth.reset.submit"
            doneTitleKey="auth.reset.done"
            doneBodyKey="auth.reset.doneDetail"
          />
        )}
      </RecoveryTokenBridge>
    </AuthCard>
  );
}
