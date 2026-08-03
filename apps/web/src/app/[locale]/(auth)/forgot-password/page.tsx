import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuthCard } from '@/features/authentication/components/AuthCard';
import { ForgotPasswordForm } from '@/features/authentication/components/ForgotPasswordForm';
import { isLocale } from '@/i18n/config';
import { getMessages, translate } from '@/i18n/get-messages';

export default async function ForgotPasswordPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const messages = getMessages(locale);

  return (
    <AuthCard
      title={translate(messages, 'auth.forgot.title')}
      description={translate(messages, 'auth.forgot.description')}
      footer={
        <Link
          href={`/${locale}/login`}
          className="text-primary underline-offset-2 hover:underline"
        >
          {translate(messages, 'auth.backToLogin')}
        </Link>
      }
    >
      <ForgotPasswordForm messages={messages} />
    </AuthCard>
  );
}
