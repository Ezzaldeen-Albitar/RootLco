'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { MuiReadFailureState } from '@/components/states/MuiStates';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import type { ReadFailureStatus } from '@/lib/api/read-operation';

/**
 * A read on the Organisation or Languages screen that did not answer, drawn
 * with the shared Material states (ADR-022, P1-32-PRE-OD-ADM1).
 *
 * The reads are made on the server while the page is rendered, so the browser
 * has nothing of its own to retry: Try again renders the route again
 * (`router.refresh()`), which repeats the read and keeps whatever the operator
 * typed elsewhere on the page. The shared state decides where a retry is
 * offered at all — an outage and a fault, never a refusal or an ended session.
 */
export function OrgReadFailure({
  messages,
  locale,
  status,
  correlationId,
  testId,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly status: ReadFailureStatus;
  readonly correlationId: string | null;
  readonly testId?: string | undefined;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  return (
    <MuiReadFailureState
      messages={messages}
      locale={locale}
      status={status}
      correlationId={correlationId}
      onRetry={() => startTransition(() => router.refresh())}
      testId={testId}
    />
  );
}
