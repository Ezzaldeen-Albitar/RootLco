import type { ReactNode } from 'react';
import type { Messages } from '@/i18n/get-messages';
import { translateDynamic } from '@/i18n/get-messages';
import {
  BackendUnavailableState,
  ErrorState,
  NotFoundState,
  PermissionDeniedState,
  SessionExpiredState,
} from '@/components/states/States';
import type { ReadFailureStatus } from '@/lib/api/read-operation';

/**
 * Presentational pieces shared by the console screens (P1-32-PRE-065).
 *
 * Token utilities only — every class below is registered in the Tailwind theme,
 * and every inline direction is logical so Arabic mirrors without an override.
 */

/** Explanatory line under a section heading. One class list, one voice. */
export const SECTION_HINT = 'text-supporting text-text-muted';

export function Section({
  title,
  actions,
  children,
}: {
  readonly title: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border-subtle bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-section-title font-semibold text-text-primary">{title}</h2>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const STATUS_TONE: Readonly<Record<string, string>> = {
  active: 'border-success-border bg-success-subtle',
  settled: 'border-success-border bg-success-subtle',
  provisioning: 'border-info-border bg-info-subtle',
  draft: 'border-info-border bg-info-subtle',
  open: 'border-info-border bg-info-subtle',
  suspended: 'border-warning-border bg-warning-subtle',
  expired: 'border-warning-border bg-warning-subtle',
  closed: 'border-border bg-surface-subtle',
  cancelled: 'border-border bg-surface-subtle',
  retired: 'border-border bg-surface-subtle',
  void: 'border-border bg-surface-subtle',
  invited: 'border-info-border bg-info-subtle',
  locked: 'border-warning-border bg-warning-subtle',
  archived: 'border-border bg-surface-subtle',
  inactive: 'border-border bg-surface-subtle',
};

/** A status word in a pill. An unknown status is shown under a neutral label. */
export function StatusBadge({
  status,
  messages,
}: {
  readonly status: string;
  readonly messages: Messages;
}) {
  const known = status in STATUS_TONE;
  return (
    <span
      data-status={status}
      className={`inline-flex rounded-full border px-2 py-0.5 text-caption text-text-primary ${
        STATUS_TONE[status] ?? 'border-border bg-surface-subtle'
      }`}
    >
      {translateDynamic(messages, known ? `platform.status.${status}` : 'platform.status.other')}
    </span>
  );
}

/** The state a failed read maps to. An ended session reads as one, not as a fault. */
export function ReadFailure({
  status,
  correlationId,
  messages,
}: {
  readonly status: ReadFailureStatus;
  readonly correlationId: string | null;
  readonly messages: Messages;
}) {
  const reference = correlationId ?? undefined;
  if (status === 'denied') return <PermissionDeniedState messages={messages} />;
  if (status === 'expired') return <SessionExpiredState messages={messages} />;
  if (status === 'not-found') return <NotFoundState messages={messages} />;
  if (status === 'unavailable') {
    return <BackendUnavailableState messages={messages} correlationId={reference} />;
  }
  return <ErrorState messages={messages} correlationId={reference} />;
}
