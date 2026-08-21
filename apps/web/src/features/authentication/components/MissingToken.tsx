import Link from 'next/link';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';

/**
 * What a reset or activation page shows when the link carried no token.
 *
 * Reached by someone opening the route directly, or by a mail client that
 * mangled the link. It offers the only useful next step — request a fresh link —
 * rather than a form that cannot possibly succeed.
 */
export function MissingToken({
  locale,
  messages,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div role="status" className="rounded-lg border border-warning-border bg-warning-subtle p-4">
        <p className="text-body font-medium text-text-primary">
          {translate(messages, 'auth.reset.missingToken')}
        </p>
        <p className="mt-1 text-supporting text-text-secondary">
          {translate(messages, 'auth.reset.missingTokenDetail')}
        </p>
      </div>
      <Link
        href={`/${locale}/forgot-password`}
        className="text-supporting text-primary underline-offset-2 hover:underline"
      >
        {translate(messages, 'auth.reset.requestAnother')}
      </Link>
    </div>
  );
}
