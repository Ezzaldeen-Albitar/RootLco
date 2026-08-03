import type { ReactNode } from 'react';
import {
  BackendUnavailableState,
  ErrorState,
  NotFoundState,
  PermissionDeniedState,
  SessionExpiredState,
} from '@/components/states/States';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import type { ReadState } from '../api';

/**
 * Renders a read that did not succeed, or hands the data to the caller.
 *
 * The important word is **instead**. A denied read renders the denial *in place
 * of* the screen's content, never over it — a table that paints its rows and
 * covers them with an overlay has already sent the data to the browser, and the
 * overlay is decoration.
 */
export function ReadBoundary<T>({
  state,
  messages,
  children,
}: {
  readonly state: ReadState<T>;
  readonly messages: Messages;
  readonly children: (data: T) => ReactNode;
}) {
  if (state.status === 'ok') return <>{children(state.data)}</>;

  const correlationId = state.correlationId ?? undefined;
  if (state.status === 'denied') {
    return <PermissionDeniedState messages={messages} correlationId={correlationId} />;
  }
  if (state.status === 'expired') return <SessionExpiredState messages={messages} />;
  if (state.status === 'unavailable') return <BackendUnavailableState messages={messages} />;
  if (state.status === 'not-found') return <NotFoundState messages={messages} />;
  return <ErrorState messages={messages} correlationId={correlationId} />;
}

/**
 * The notice a screen shows when the platform does not publish what it needs.
 *
 * Five screens edit organization settings because there is no dedicated
 * operation for their subject, and two more show references where names would
 * be better. Saying so in the interface is the difference between a considered
 * limitation and a product that looks half-finished for no stated reason — and
 * it stops an operator concluding that a value they cannot find must be hidden
 * somewhere.
 */
export function ContractNotice({
  messages,
  bodyKeys,
}: {
  readonly messages: Messages;
  readonly bodyKeys: readonly string[];
}) {
  return (
    <aside className="rounded-xl border border-info-border bg-info-subtle p-4">
      <p className="text-label font-semibold text-text-primary">
        {translate(messages, 'admin.contractGap.title')}
      </p>
      <ul className="mt-2 flex flex-col gap-1 text-supporting text-text-secondary">
        {bodyKeys.map((key) => (
          <li key={key}>{translate(messages, key as keyof Messages)}</li>
        ))}
      </ul>
    </aside>
  );
}

/** A titled card. Every administration screen is built from these. */
export function Panel({
  title,
  description,
  actions,
  children,
}: {
  readonly title: string;
  readonly description?: string | undefined;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border-subtle bg-surface p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-section-title font-semibold text-text-heading">{title}</h2>
          {description ? (
            <p className="mt-1 text-supporting text-text-secondary">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * A read-only label and value. Used wherever the platform offers no edit path.
 *
 * The hint lives INSIDE the `<dd>`, not beside it. A `<dl>` may only contain
 * `<dt>`/`<dd>` groups and `<div>` wrappers, and a `<div>` wrapper may only
 * contain the group — a sibling `<p>` makes the whole list malformed, which axe
 * reports as the *serious* `definition-list` violation (`P1-26-F-047`).
 *
 * It is also the better markup: the hint describes the value, so it belongs
 * with the value rather than floating after it in the reading order.
 */
export function Fact({
  label,
  value,
  hint,
  mono = false,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly hint?: string | undefined;
  readonly mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-label font-medium text-text-primary">{label}</dt>
      <dd className={`text-body text-text-secondary ${mono ? 'break-all font-mono' : ''}`}>
        {value}
        {hint ? <span className="mt-1 block text-caption text-text-muted">{hint}</span> : null}
      </dd>
    </div>
  );
}
