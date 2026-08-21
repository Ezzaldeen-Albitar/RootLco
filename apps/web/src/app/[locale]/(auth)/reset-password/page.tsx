import { notFound } from 'next/navigation';
import { AuthCard } from '@/features/authentication/components/AuthCard';
import { RecoveryTokenBridge } from '@/features/authentication/components/RecoveryTokenBridge';
import { tokenFromQuery } from '@/features/authentication/api/recovery-token';
import { isLocale } from '@/i18n/config';
import { getMessages, translate } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

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
      {/*
        Only serialisable props cross this boundary. It used to take a render
        prop, which is a FUNCTION crossing Server to Client — not serialisable,
        and the page returned a 500 in the production build.
      */}
      <RecoveryTokenBridge
        locale={locale}
        messages={messages}
        serverToken={serverToken}
        submitLabelKey="auth.reset.submit"
        doneTitleKey="auth.reset.done"
        doneBodyKey="auth.reset.doneDetail"
      />
    </AuthCard>
  );
}

/** The document title. Same key as the visible header, so they cannot disagree. */
export const generateMetadata = pageMetadata('auth.reset.title');
