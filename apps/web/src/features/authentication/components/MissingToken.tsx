'use client';

import Link from 'next/link';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';

/**
 * What a reset or activation page shows when the link carried no token, on
 * Material UI (ADR-022).
 *
 * Reached by someone opening the route directly, or by a mail client that
 * mangled the link. It offers the only useful next step — request a fresh link —
 * rather than a form that cannot possibly succeed. `role="status"`: it is the
 * answer to opening the link, announced politely.
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
      <Alert severity="warning" variant="outlined" role="status" data-testid="missing-token">
        <AlertTitle component="p" className="text-body font-medium text-text-primary">
          {translate(messages, 'auth.reset.missingToken')}
        </AlertTitle>
        <p className="text-supporting text-text-secondary">
          {translate(messages, 'auth.reset.missingTokenDetail')}
        </p>
      </Alert>
      <Link
        href={`/${locale}/forgot-password`}
        className="text-supporting text-primary underline-offset-2 hover:underline"
      >
        {translate(messages, 'auth.reset.requestAnother')}
      </Link>
    </div>
  );
}
