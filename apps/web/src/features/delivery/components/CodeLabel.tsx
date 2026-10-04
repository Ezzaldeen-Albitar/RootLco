'use client';

import type { Messages } from '@/i18n/get-messages';
import { translateDynamic } from '@/i18n/get-messages';
import {
  BLOCKER_LABEL_KEYS,
  OUTCOME_LABEL_KEYS,
  SIGNER_ROLE_LABEL_KEYS,
  STATUS_LABEL_KEYS,
  labelKeyFor,
} from '../delivery-contract';

/**
 * A closed-vocabulary value from the backend, in the operator's language.
 *
 * ## Why a lookup and not a key built from the value
 *
 * Composing `delivery.status.${value}` would produce a plausible-looking key for
 * a value this build has never heard of, and `translate` renders a missing key
 * AS the key — so a new state added by the backend would appear on screen as a
 * dotted internal string that looks like a label. The lookup fails visibly
 * instead: an unknown value is drawn as the code the backend actually sent,
 * marked as an identifier and left-to-right in both reading directions.
 *
 * That is the honest failure. The screen does not know what the value means, so
 * it does not pretend to; it reports the word the backend used, which is the one
 * thing anyone can act on.
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

/** One of the eight reasons a handover may be refused. */
export function BlockerLabel(props: { readonly messages: Messages; readonly code: string }) {
  return <CodeLabel messages={props.messages} table={BLOCKER_LABEL_KEYS} value={props.code} />;
}

/** One of the five states a delivery record may hold. */
export function StatusLabel(props: { readonly messages: Messages; readonly status: string }) {
  return <CodeLabel messages={props.messages} table={STATUS_LABEL_KEYS} value={props.status} />;
}

/** One of the three roles a signature may be given in. */
export function SignerRoleLabel(props: { readonly messages: Messages; readonly role: string }) {
  return <CodeLabel messages={props.messages} table={SIGNER_ROLE_LABEL_KEYS} value={props.role} />;
}

/** One of the three outcomes a checklist item may be recorded with. */
export function OutcomeLabel(props: { readonly messages: Messages; readonly outcome: string }) {
  return <CodeLabel messages={props.messages} table={OUTCOME_LABEL_KEYS} value={props.outcome} />;
}
