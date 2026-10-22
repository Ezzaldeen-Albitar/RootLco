import type { ReactNode } from 'react';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import { OrgReadFailure } from './OrgReadFailure';

/**
 * The answer of one read, or the state that says why there is none.
 *
 * The Material counterpart of the administration `ReadBoundary`, for the
 * Organisation and Languages screens (P1-32-PRE-OD-ADM1). No client directive:
 * the pages render it on the server with the read they made, and the companies
 * and branches render it in the browser; either way a failure is drawn by
 * `OrgReadFailure`, which owns the retry.
 */
export function OrgReadBoundary<T>({
  state,
  messages,
  locale,
  testId,
  children,
}: {
  readonly state: ReadState<T>;
  readonly messages: Messages;
  readonly locale: Locale;
  readonly testId?: string | undefined;
  readonly children: (data: T) => ReactNode;
}) {
  if (state.status === 'ok') return <>{children(state.data)}</>;
  return (
    <OrgReadFailure
      messages={messages}
      locale={locale}
      status={state.status}
      correlationId={state.correlationId}
      testId={testId}
    />
  );
}
