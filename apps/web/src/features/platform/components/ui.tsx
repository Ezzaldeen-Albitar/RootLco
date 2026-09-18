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

export const PRIMARY_BUTTON =
  'rounded-lg bg-primary px-4 py-2 text-button font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-60';

export const SECONDARY_BUTTON =
  'rounded-md border border-border bg-surface px-3 py-1.5 text-caption text-text-secondary transition-colors duration-fast ease-standard hover:bg-surface-subtle hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';

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

export function SimpleTable({
  caption,
  headers,
  children,
  empty,
}: {
  readonly caption: string;
  readonly headers: readonly string[];
  readonly children: ReactNode;
  readonly empty?: string | null;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-table-cell">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-table-border bg-table-header">
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                scope="col"
                className="px-3 py-2 text-start text-table-header font-semibold text-table-header-text"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {empty ? (
            <tr>
              <td colSpan={headers.length} className="px-3 py-3 text-text-muted">
                {empty}
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Cell({
  children,
  end = false,
}: {
  readonly children: ReactNode;
  readonly end?: boolean;
}) {
  return (
    <td className={`px-3 py-2 text-text-primary ${end ? 'text-end tabular-nums' : ''}`}>
      {children}
    </td>
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
