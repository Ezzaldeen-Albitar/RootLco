'use client';

import type { ReactNode } from 'react';

import {
  BackendUnavailableState,
  ErrorState,
  NotFoundState,
  PermissionDeniedState,
  SessionExpiredState,
} from '@/components/states/States';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ReadFailureStatus } from '@/lib/api/read-operation';

import {
  CONFIGURATION_STATUS_LABEL_KEYS,
  COVERED_SCOPE_LABEL_KEYS,
  DUPLICATE_POLICY_CODE_RULE,
  ITEM_KIND_LABEL_KEYS,
  OVERLAPPING_COVERAGE_RULE,
  POLICY_ERROR_CODES,
  WARRANTY_STATUS_LABEL_KEYS,
  labelKeyFor,
} from '../warranty-contract';

/**
 * The pieces both warranty screens share (P1-31, FE-008/FE-009).
 *
 * Written here rather than imported from the delivery feature because a shared
 * component pulled across a feature boundary makes one screen's styling decisions
 * binding on another's, and the ownership gate exists to keep that visible. Nothing
 * in this file computes anything: no distance is parsed, no window is compared
 * against today's date, and no term is derived. Every value on screen is one the
 * backend sent.
 */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PRIMARY_BUTTON =
  'rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';

export const SECONDARY_BUTTON =
  'rounded-md border border-border bg-surface px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle disabled:opacity-60';

/** A titled region of a warranty screen. */
export function Section({
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
 * A read outcome other than success.
 *
 * The states are the shared ones. A screen that invented its own wording for a
 * denial would be a second authority on what a refusal looks like, and the refusal
 * text is deliberately identical everywhere: it names neither the record nor the
 * missing authority, because "you cannot see this thing that exists" is itself a
 * disclosure.
 */
export function ReadFailure({
  messages,
  status,
  correlationId,
}: {
  readonly messages: Messages;
  readonly status: ReadFailureStatus;
  readonly correlationId: string | null;
}) {
  // `null` becomes `undefined` because the shared states take an optional prop, and
  // an explicit null would render a reference that is not there.
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

/**
 * A labelled identifier.
 *
 * No warranty read resolves a vehicle, a work order or a handover to a name, so each
 * is presented as what it is: a reference, with the label saying what it references.
 * It is rendered left-to-right in both reading directions because an identifier is
 * not language.
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

/** A labelled plain-language value — a date, a state, a sentence. */
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
 * A distance reading exactly as the backend stated it.
 *
 * An exact decimal STRING, printed and never parsed. Turning it into a number to
 * format it would be the one place a reading could quietly change, and no unit is
 * appended: the reads publish the figure and not its unit, so a unit written here
 * would be this screen's invention.
 */
export function Distance({ value }: { readonly value: string | null }) {
  if (value === null) return <span className="text-body text-text-secondary">{'—'}</span>;
  return (
    <span className="font-mono text-body text-text-primary" dir="ltr">
      {value}
    </span>
  );
}

/**
 * A closed-vocabulary value from the backend, in the operator's language.
 *
 * Composing a key from the value would produce a plausible-looking key for a word
 * this build has never heard of, and a missing key renders AS the key — so a state
 * added by the backend would appear on screen as a dotted internal string that looks
 * like a label. The lookup fails visibly instead: an unknown value is drawn as the
 * code the backend actually sent.
 */
function CodeLabel({
  messages,
  table,
  value,
}: {
  readonly messages: Messages;
  readonly table: Readonly<Record<string, string>>;
  readonly value: string;
}) {
  const key = labelKeyFor(table, value);
  if (key === null) {
    return (
      <code className="font-mono text-caption" dir="ltr">
        {value}
      </code>
    );
  }
  return <>{translateDynamic(messages, key)}</>;
}

/** One of the five states a warranty record may hold. */
export function WarrantyStatusLabel(props: {
  readonly messages: Messages;
  readonly status: string;
}) {
  return (
    <CodeLabel messages={props.messages} table={WARRANTY_STATUS_LABEL_KEYS} value={props.status} />
  );
}

/** Whether a policy or a coverage window is still in use. */
export function ConfigurationStatusLabel(props: {
  readonly messages: Messages;
  readonly status: string;
}) {
  return (
    <CodeLabel
      messages={props.messages}
      table={CONFIGURATION_STATUS_LABEL_KEYS}
      value={props.status}
    />
  );
}

/** What a coverage window covers. */
export function CoveredScopeLabel(props: { readonly messages: Messages; readonly scope: string }) {
  return (
    <CodeLabel messages={props.messages} table={COVERED_SCOPE_LABEL_KEYS} value={props.scope} />
  );
}

/** Whether a covered item is a job or a part. */
export function ItemKindLabel(props: { readonly messages: Messages; readonly kind: string }) {
  return <CodeLabel messages={props.messages} table={ITEM_KIND_LABEL_KEYS} value={props.kind} />;
}

/**
 * The part of a refused plan-administration write these helpers read.
 *
 * A structural shape rather than the adapter's own state type, so the pieces shared by
 * two screens do not depend on the module that performs the writes. Every field is
 * optional because every one of them is a runtime fact about a response.
 */
export interface PolicyRefusal {
  readonly code?: string | undefined;
  readonly rule?: string | undefined;
  readonly messageKey?: string | undefined;
}

/**
 * Was this refusal a STALE VIEW rather than a rule the write broke?
 *
 * The one refusal the operator can clear without changing anything they typed: the
 * record moved while the screen was open, so re-reading it and sending the same
 * change again succeeds. It is the conflict code with NO violation rule — the two
 * other causes that share the code both name one — and the screens offer a reload
 * beside it for exactly this case and no other.
 */
export function isStaleView(state: PolicyRefusal): boolean {
  return state.code === POLICY_ERROR_CODES.conflict && state.rule === undefined;
}

/**
 * The sentence a refused plan-administration write is reported with.
 *
 * Read off the catalogue code, and off the first violation rule where the code alone
 * is ambiguous. `ERR-CON-001` carries THREE meanings on this surface and the three
 * lead an operator somewhere entirely different — re-read and retry, retire the
 * window that is in the way, choose another reference — so collapsing them into one
 * conflict sentence would send two out of three people to the wrong place.
 *
 * Anything the backend does not distinguish keeps the shared wording. Inventing a
 * sentence per code would claim knowledge the problem document does not carry: the
 * service's own message never crosses the wire.
 */
export function refusalKeyFor(state: PolicyRefusal): string {
  if (state.code === POLICY_ERROR_CODES.conflict) {
    if (state.rule === OVERLAPPING_COVERAGE_RULE) return 'warranty.policies.refusedOverlap';
    if (state.rule === DUPLICATE_POLICY_CODE_RULE) return 'warranty.policies.refusedDuplicateCode';
    return 'warranty.policies.refusedStale';
  }
  if (state.code === POLICY_ERROR_CODES.missingVersion) {
    // Unreachable from this feature: every version-guarded adapter takes the version
    // as a required argument. Named anyway, because a wording chosen on the day it
    // appears would be chosen under pressure and would probably say "stale", which is
    // the one thing this is not.
    return 'warranty.policies.refusedNotSent';
  }
  if (state.code === POLICY_ERROR_CODES.invalid) return 'warranty.policies.refusedInvalid';
  if (state.code === POLICY_ERROR_CODES.denied) return 'warranty.policies.refusedDenied';
  if (state.code === POLICY_ERROR_CODES.missing) return 'warranty.policies.refusedMissing';
  return state.messageKey ?? 'action.failed';
}
