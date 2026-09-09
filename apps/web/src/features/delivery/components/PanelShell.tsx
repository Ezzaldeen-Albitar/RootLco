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
import { translate } from '@/i18n/get-messages';
import type { ReadFailureStatus } from '@/lib/api/read-operation';

/**
 * The frame every delivery panel shares, and the one place a panel's failure is
 * turned into something an operator can read.
 *
 * Each panel of this screen reads its own subresource, so each can fail on its
 * own: a caller may see the delivery and be refused its signatures, or the
 * receiver read may time out while the history returns. Rendering that per
 * panel — rather than collapsing the whole screen onto the first failure — is
 * what lets the operator keep the part that worked.
 *
 * The states are the shared ones. A panel that invented its own wording for a
 * denial would be a second authority on what a refusal looks like, and the
 * refusal text is deliberately identical everywhere: it names neither the
 * record nor the missing authority, because "you cannot see this thing that
 * exists" is itself a disclosure.
 */
export function Panel({
  headingId,
  titleKey,
  messages,
  description,
  children,
}: {
  readonly headingId: string;
  readonly titleKey: keyof Messages;
  readonly messages: Messages;
  readonly description?: ReactNode | undefined;
  readonly children: ReactNode;
}) {
  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-border bg-surface p-4">
      <h2 id={headingId} className="mb-3 text-section-title font-medium text-text-primary">
        {translate(messages, titleKey)}
      </h2>
      {description === undefined ? null : (
        <p className="mb-3 text-caption text-text-muted">{description}</p>
      )}
      {children}
    </section>
  );
}

/**
 * A panel's read outcome, other than success.
 *
 * `not-found` is its own state and not an empty one. Every delivery subresource
 * answers absence with a 200 and an empty payload, so a 404 here means the
 * delivery itself could not be resolved — a different sentence, and one an
 * operator acts on differently.
 */
export function PanelFailure({
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

/** The panel's own loading placeholder, sized like the rows it stands in for. */
export function PanelLoading({ messages }: { readonly messages: Messages }) {
  return <LoadingState messages={messages} />;
}

/**
 * A labelled identifier.
 *
 * No delivery read resolves a name, so an identifier is presented as what it is:
 * a reference, with the label saying what it references. It is rendered
 * left-to-right in both directions because an identifier is not language.
 */
export function Reference({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-text-muted">{label}</span>
      {value === null ? (
        <span className="text-body text-text-secondary">{'—'}</span>
      ) : (
        <code className="font-mono text-caption text-text-primary" dir="ltr">
          {value}
        </code>
      )}
    </div>
  );
}

/** A labelled plain-language value — a date, a status, a sentence. */
export function Fact({
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

/** The button every paged panel uses to ask for the next page. */
export const SECONDARY_BUTTON =
  'rounded-md border border-border px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle disabled:opacity-60';
