'use client';

import type { ReactNode } from 'react';
import {
  MuiEmptyState,
  MuiErrorState,
  MuiExpiredState,
  MuiLoadingState,
  MuiNotFoundState,
  MuiRefusedState,
  MuiUnavailableState,
} from '@/components/states/MuiStates';
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
 * A panel's read outcome, other than success — on the shared Material states
 * (ADR-022), which read the same catalogue entries `States.tsx` does.
 *
 * `not-found` is its own state and not an empty one. Every delivery subresource
 * answers absence with a 200 and an empty payload, so a 404 here means the
 * delivery itself could not be resolved — a different sentence, and one an
 * operator acts on differently.
 *
 * `onRetry` is offered only by the two states where asking again can change the
 * answer — an outage (a throttled or unanswered read included) and a fault — so
 * a 429 or a 5xx says "unavailable, try again" with the control beside it, and a
 * refusal or an ended session never offers one.
 */
export function PanelFailure({
  messages,
  status,
  correlationId,
  onRetry,
}: {
  readonly messages: Messages;
  readonly status: ReadFailureStatus;
  readonly correlationId: string | null;
  readonly onRetry?: (() => void) | undefined;
}) {
  if (status === 'denied') {
    return <MuiRefusedState messages={messages} correlationId={correlationId} />;
  }
  if (status === 'expired') return <MuiExpiredState messages={messages} />;
  if (status === 'unavailable') {
    return (
      <MuiUnavailableState messages={messages} correlationId={correlationId} onRetry={onRetry} />
    );
  }
  if (status === 'not-found') return <MuiNotFoundState messages={messages} />;
  return <MuiErrorState messages={messages} correlationId={correlationId} onRetry={onRetry} />;
}

/** The panel's own loading placeholder, sized like the rows it stands in for. */
export function PanelLoading({ messages }: { readonly messages: Messages }) {
  return <MuiLoadingState messages={messages} rows={3} />;
}

/**
 * Nothing recorded yet, said in the panel's own words — the ordinary state of a
 * fresh handover, never a failure.
 */
export function PanelEmpty({
  messages,
  titleKey,
  descriptionKey,
}: {
  readonly messages: Messages;
  readonly titleKey: keyof Messages;
  readonly descriptionKey: keyof Messages;
}) {
  return <MuiEmptyState messages={messages} titleKey={titleKey} descriptionKey={descriptionKey} />;
}

/**
 * A person, by name (Owner directive, DEF-R2).
 *
 * The delivery reads publish each person's id AND, beside it, the name the owning
 * module resolved for this caller. The name is shown; the id never is. A `null`
 * name — the caller does not hold the code the owning read declares, or the
 * person cannot be resolved — is said in words, because an identifier reads to
 * an operator as something they ought to recognise, and they cannot.
 */
export function PersonFact({
  messages,
  label,
  name,
}: {
  readonly messages: Messages;
  readonly label: string;
  readonly name: string | null | undefined;
}) {
  return (
    <Fact label={label}>
      {name ? (
        <bdi>{name}</bdi>
      ) : (
        <span className="text-text-secondary" data-name-withheld="">
          {translate(messages, 'delivery.person.notShown')}
        </span>
      )}
    </Fact>
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

/**
 * The button class the work order's own handover panel (`WorkOrderDeliveryPanel`,
 * on `/work-orders/[workOrderId]`) still commits with. The handover screen's
 * panels draw Material's `Button` instead (ADR-022); this class moves with the
 * work-order detail slice.
 */
export const PRIMARY_BUTTON =
  'rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';
