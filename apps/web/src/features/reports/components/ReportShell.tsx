'use client';

import type { ReactNode } from 'react';
import {
  BackendUnavailableState,
  ErrorState,
  LoadingState,
  NotFoundState,
  PermissionDeniedState,
  SessionExpiredState,
} from '@/components/states/States';
import type { Messages } from '@/i18n/get-messages';
import type { ReadFailureStatus } from '@/lib/api/read-operation';

/**
 * The pieces both report screens share.
 *
 * The states are the SHARED ones. A screen that invented its own wording for a
 * refusal would be a second authority on what a refusal looks like, and the
 * wording is deliberately identical across this product: it names neither the
 * report nor the missing authority, because "you may not see this thing, which
 * exists" is itself a disclosure — and on this surface it would also be a way to
 * discover which report codes a workshop has configured.
 *
 * This file lives in `features/reports` rather than being imported from another
 * feature, because a feature does not import another feature. The delivery
 * screens hold their own copy of the same idea for the same reason.
 */

/**
 * A read outcome other than success.
 *
 * Five outcomes, and each is a different sentence with a different action behind
 * it. Collapsing them was the defect `P1-27-QA-002` recorded: a caller who had
 * merely been rate-limited was told the system had broken, and an ended session
 * was told the same and handed a control that could not work.
 *
 * `denied` is what `ERR-IAM-001` becomes — the uniform refusal the run service
 * answers whether the caller may not run reports at all, may not read the rows
 * this dataset returns, or named a company and branch outside their own tenant.
 * `not-found` is what `ERR-RES-001` becomes — an unknown code, a draft, an
 * archived configuration, or a published one with no live version, all
 * deliberately indistinguishable. Nothing on this side tries to tell them apart.
 */
export function ReportFailure({
  messages,
  status,
  correlationId,
}: {
  readonly messages: Messages;
  readonly status: ReadFailureStatus;
  readonly correlationId: string | null;
}) {
  // `null` becomes `undefined` because the shared states take an optional prop,
  // and an explicit null would render a reference that is not there.
  const reference = correlationId ?? undefined;
  if (status === 'denied') {
    return <PermissionDeniedState messages={messages} correlationId={reference} />;
  }
  if (status === 'expired') return <SessionExpiredState messages={messages} />;
  if (status === 'unavailable') {
    return <BackendUnavailableState messages={messages} correlationId={reference} />;
  }
  if (status === 'not-found') return <NotFoundState messages={messages} />;
  return <ErrorState messages={messages} correlationId={reference} />;
}

/** The shared loading placeholder, so one screen cannot invent a second. */
export function ReportLoading({ messages }: { readonly messages: Messages }) {
  return <LoadingState messages={messages} />;
}

/**
 * A machine name shown AS a machine name.
 *
 * A report code, a column key and a measure key are identifiers, not language.
 * When the catalogue holds no message for one, it is drawn monospaced and left to
 * right instead of being dropped into a heading as though somebody had written
 * it — the same position the work-order board takes on workshop-owned state
 * codes, and for the same reason.
 */
export function MachineName({ value }: { readonly value: string }) {
  return (
    <code className="break-all font-mono text-caption text-text-primary" dir="ltr">
      {value}
    </code>
  );
}

/** A labelled fact of the report's own context. */
export function ContextFact({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-text-muted">{label}</span>
      <span className="text-body text-text-primary">{children}</span>
    </div>
  );
}

export const REPORT_PRIMARY_BUTTON =
  'rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';

export const REPORT_SECONDARY_BUTTON =
  'rounded-md border border-border px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle disabled:opacity-60';

export const REPORT_TABLE_HEADER =
  'px-3 py-2 text-start text-table-header font-semibold uppercase tracking-wide text-table-header-text';

export const REPORT_TABLE_CELL = 'px-3 py-2 align-top text-body text-text-primary';
