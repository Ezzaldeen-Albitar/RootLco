import { notFound } from 'next/navigation';
import { AuthCard } from '@/features/authentication/components/AuthCard';
import { LoginForm } from '@/features/authentication/components/LoginForm';
import { readTenantHint } from '@/lib/api/session-cookie';
import { isLocale } from '@/i18n/config';
import { getMessages, translate } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Sign in.
 *
 * ## The `reason` parameter
 *
 * `?reason=expired|signed-out|unavailable`, and nothing else. It changes one
 * sentence so an operator who was thrown out mid-task is told why rather than
 * being silently returned to a form. It is a fixed enum, matched exactly: an
 * unrecognised value renders no notice at all, so the query string cannot become
 * a way to put arbitrary text on the page.
 *
 * ## No session check here
 *
 * Deliberately. A sign-in page that redirects an already-signed-in visitor to
 * the dashboard is the other half of a redirect loop the moment a cookie exists
 * that the backend rejects. Signing in again is harmless; a browser spinning
 * between two redirects is not.
 */
const REASONS = {
  expired: 'auth.login.reason.expired',
  'signed-out': 'auth.login.reason.signedOut',
  unavailable: 'auth.login.reason.unavailable',
  // The credentials were accepted and the account may not read its own session
  // — it does not hold `iam.user.read`. Signing in again will not help, so the
  // message says so rather than inviting an operator to try the same thing
  // repeatedly (`P1-26-F-022`).
  forbidden: 'auth.login.reason.forbidden',
} as const;

export default async function LoginPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const messages = getMessages(locale);

  const query = await searchParams;
  const rawReason = Array.isArray(query.reason) ? query.reason[0] : query.reason;
  const reasonKey =
    rawReason && rawReason in REASONS ? REASONS[rawReason as keyof typeof REASONS] : null;

  const tenantHint = await readTenantHint();

  return (
    <AuthCard
      title={translate(messages, 'auth.login.title')}
      description={translate(messages, 'auth.login.description')}
    >
      <div className="flex flex-col gap-5">
        {reasonKey ? (
          <p
            role="status"
            className="rounded-lg border border-info-border bg-info-subtle p-3 text-supporting text-text-primary"
          >
            {translate(messages, reasonKey)}
          </p>
        ) : null}
        <LoginForm locale={locale} messages={messages} tenantHint={tenantHint} />
      </div>
    </AuthCard>
  );
}

/** The document title. Same key as the visible header, so they cannot disagree. */
export const generateMetadata = pageMetadata('auth.login.title');
