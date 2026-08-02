import type { ReactNode } from 'react';
import { Icon } from '@/components/primitives/Icon';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';

/**
 * The states every operational screen must be able to show.
 *
 * They live here, once, because the failure mode is not that a screen forgets
 * to handle "empty" — it is that twenty screens each invent their own wording,
 * their own layout and their own idea of what to tell the operator to do next.
 *
 * ## What these never render
 *
 * No stack trace, no SQL, no internal path, no storage key, no server internals,
 * and nothing that reveals whether a record the actor may not see exists. A
 * correlation ID is the ONLY diagnostic surfaced, because it is an opaque token
 * that lets support find the server-side log without telling the browser
 * anything about it.
 */

type Tone = 'neutral' | 'error' | 'warning';

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'text-text-muted',
  error: 'text-error',
  warning: 'text-warning',
};

function StateShell({
  icon,
  tone = 'neutral',
  title,
  description,
  action,
  correlationId,
  messages,
}: {
  readonly icon: Parameters<typeof Icon>[0]['name'];
  readonly tone?: Tone | undefined;
  readonly title: string;
  readonly description?: string | undefined;
  readonly action?: ReactNode | undefined;
  readonly correlationId?: string | undefined;
  readonly messages: Messages;
}) {
  return (
    <div
      // `status`, not `alert`: these are the results of an action the operator
      // just took, announced politely. `alert` interrupts, and an empty search
      // result is not an interruption.
      role="status"
      className="mx-auto flex max-w-content flex-col items-center gap-3 px-6 py-16 text-center"
    >
      <span className={TONE_CLASS[tone]}>
        <Icon name={icon} size={32} />
      </span>
      <h2 className="text-section-title font-semibold text-text-primary">{title}</h2>
      {description ? <p className="text-body text-text-secondary">{description}</p> : null}
      {action}
      {correlationId ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'state.correlationId')}{' '}
          <code className="font-mono text-text-secondary">{correlationId}</code>
        </p>
      ) : null}
    </div>
  );
}

export function LoadingState({ messages }: { readonly messages: Messages }) {
  return (
    <div role="status" aria-live="polite" className="px-6 py-6">
      <span className="sr-only">{translate(messages, 'state.loading')}</span>
      <SkeletonRows rows={6} />
    </div>
  );
}

/**
 * Skeleton rows.
 *
 * Fixed heights matching the real row height, so the content that replaces them
 * does not move the page. A skeleton that is a different size from the thing it
 * stands in for causes the exact layout shift it was meant to prevent.
 */
export function SkeletonRows({ rows = 5 }: { readonly rows?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-11 w-full animate-pulse rounded-md bg-skeleton" />
      ))}
    </div>
  );
}

export function EmptyState({
  messages,
  titleKey = 'state.empty.title',
  descriptionKey = 'state.empty.description',
  action,
}: {
  readonly messages: Messages;
  readonly titleKey?: string | undefined;
  readonly descriptionKey?: string | undefined;
  readonly action?: ReactNode | undefined;
}) {
  return (
    <StateShell
      icon="documents"
      messages={messages}
      title={translate(messages, titleKey as keyof Messages)}
      description={translate(messages, descriptionKey as keyof Messages)}
      action={action}
    />
  );
}

export function NoResultsState({
  messages,
  onClearFilters,
}: {
  readonly messages: Messages;
  readonly onClearFilters?: ReactNode | undefined;
}) {
  return (
    <StateShell
      icon="reports"
      messages={messages}
      title={translate(messages, 'state.noResults.title')}
      description={translate(messages, 'state.noResults.description')}
      action={onClearFilters}
    />
  );
}

export function ErrorState({
  messages,
  correlationId,
  action,
}: {
  readonly messages: Messages;
  readonly correlationId?: string | undefined;
  readonly action?: ReactNode | undefined;
}) {
  return (
    <StateShell
      icon="notifications"
      tone="error"
      messages={messages}
      title={translate(messages, 'state.error.title')}
      description={translate(messages, 'state.error.description')}
      action={action}
      {...(correlationId ? { correlationId } : {})}
    />
  );
}

export function PermissionDeniedState({
  messages,
  correlationId,
}: {
  readonly messages: Messages;
  readonly correlationId?: string | undefined;
}) {
  return (
    <StateShell
      icon="administration"
      tone="warning"
      messages={messages}
      title={translate(messages, 'state.denied.title')}
      // Deliberately does not name the record, the module or the missing
      // permission. "You cannot see this thing that exists" is itself a
      // disclosure, and the operator's next step is the same either way.
      description={translate(messages, 'state.denied.description')}
      {...(correlationId ? { correlationId } : {})}
    />
  );
}

export function NotFoundState({ messages }: { readonly messages: Messages }) {
  return (
    <StateShell
      icon="overview"
      messages={messages}
      title={translate(messages, 'state.notFound.title')}
      description={translate(messages, 'state.notFound.description')}
    />
  );
}

export function BackendUnavailableState({
  messages,
  action,
}: {
  readonly messages: Messages;
  readonly action?: ReactNode | undefined;
}) {
  return (
    <StateShell
      icon="delivery"
      tone="error"
      messages={messages}
      title={translate(messages, 'state.unavailable.title')}
      description={translate(messages, 'state.unavailable.description')}
      action={action}
    />
  );
}

export function ConflictState({
  messages,
  action,
}: {
  readonly messages: Messages;
  readonly action?: ReactNode | undefined;
}) {
  return (
    <StateShell
      icon="work-orders"
      tone="warning"
      messages={messages}
      title={translate(messages, 'state.conflict.title')}
      description={translate(messages, 'state.conflict.description')}
      action={action}
    />
  );
}

export function SessionExpiredState({
  messages,
  action,
}: {
  readonly messages: Messages;
  readonly action?: ReactNode | undefined;
}) {
  return (
    <StateShell
      icon="settings"
      tone="warning"
      messages={messages}
      title={translate(messages, 'state.expired.title')}
      description={translate(messages, 'state.expired.description')}
      action={action}
    />
  );
}
