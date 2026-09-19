'use client';

import { useState, useTransition } from 'react';
import { SelectField, TextAreaField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import { completeDelivery } from '../api';
import {
  DELIVERY_ERROR_CODES,
  MAX_REASON,
  ODOMETER_UNITS,
  ODOMETER_UNIT_LABEL_KEYS,
  isAcceptableOdometerValue,
  type DeliveryEligibility,
  type OdometerUnit,
} from '../delivery-contract';
import { BlockerLabel } from './CodeLabel';
import { PRIMARY_BUTTON, Panel, PanelFailure, PanelLoading } from './PanelShell';

/**
 * Releasing the vehicle (P1-31, FE-002/FE-005).
 *
 * ## The browser never decides that a handover may complete
 *
 * `sal.complete_delivery` locks the delivery row and recomposes the whole
 * blocker set inside its own transaction. This panel enables its button from
 * what the ELIGIBILITY read published and from nothing else — it composes no
 * rule, applies no threshold and knows no exception. Enabling is an affordance;
 * the decision is taken again, server-side, on every attempt, and a refusal is
 * rendered as the server's answer rather than as a surprise.
 *
 * ## The version comes from the eligibility read, and only from there
 *
 * Completion is version-guarded. Verifying a receiver, recording a checklist
 * outcome and binding a signature all move the delivery row, so a version taken
 * from any of those responses is stale the moment it arrives. The eligibility
 * read republishes the current version on every read and is re-read after every
 * write on this screen, so the number the button sends is the number the panel
 * above it displays.
 *
 * A conflict is retried exactly once, in the adapter, against a freshly read
 * version — see `completeDelivery`. A second conflict is reported.
 *
 * ## The odometer is checked here because the ROUTE is wider than the column
 *
 * The route's pattern admits two decimals; `veh.odometer_readings.value` holds
 * one, and the delivery domain refuses the extra digit with a validation error
 * naming a field the operator has already left. So the form refuses two decimals
 * itself, says so in the field's own help text, and spends no request on a body
 * that cannot be stored.
 *
 * ## The override is narrow, and it is the server's list
 *
 * Exactly one blocker is overridable and the eligibility read says which, and
 * with what authority. This panel reads that list rather than carrying its own
 * copy: a second list here would be a second authority on what may be waived,
 * and it would be the one that got out of date. The control appears only when
 * the server named an overridable blocker that is actually blocking AND the
 * reader holds the authority the server named for it.
 *
 * ## Why a refusal sends the reader back to the checks above
 *
 * The reasons behind a blocked completion are NOT in the refusal. The problem
 * document carries a catalogue code and no service prose, so the blocker list
 * and the unsatisfied item codes are read back from the eligibility operation —
 * which publishes both as data — and rendered here from that read. Inventing a
 * sentence from the code would be this tier claiming to know something it was
 * not told.
 */
export function CompletionPanel({
  messages,
  deliveryId,
  state,
  withheld,
  onDone,
}: {
  readonly messages: Messages;
  readonly deliveryId: string;
  /** The screen's eligibility read. `null` while in flight or when withheld. */
  readonly state: ReadState<DeliveryEligibility> | null;
  /** True when the caller lacks the financial read code the completion also demands. */
  readonly withheld: boolean;
  /** Called after a successful release so the screen re-reads every panel. */
  readonly onDone: () => void;
}) {
  const [odometer, setOdometer] = useState('');
  const [unit, setUnit] = useState<OdometerUnit>('km');
  const [overriding, setOverriding] = useState(false);
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [refusal, setRefusal] = useState<{
    readonly code: string;
    readonly requiredPermissions: readonly string[];
  } | null>(null);
  const [pending, startTransition] = useTransition();

  const view = state !== null && state.status === 'ok' ? state.data : null;
  const blocking = view === null ? [] : view.blockers;
  const overridableCodes = new Set((view?.overridable ?? []).map((entry) => entry.code));
  /*
   * The blockers the server said may be overridden, of the ones actually
   * blocking. Derived from the read every time rather than held in state: an
   * overridable blocker that has since been satisfied must stop offering an
   * override, and a copy kept in state would keep offering one.
   */
  const overridableBlocking = blocking.filter((code) => overridableCodes.has(code));
  const remaining = blocking.filter((code) => !overridableCodes.has(code));
  const couldRelease =
    view !== null && (view.eligible || (overridableBlocking.length > 0 && remaining.length === 0));

  const submit = () => {
    if (view === null) return;
    const value = odometer.trim();
    if (!isAcceptableOdometerValue(value)) {
      setFieldError({ finalOdometerValue: 'delivery.completion.odometerInvalid' });
      return;
    }
    if (overriding && reason.trim().length === 0) {
      setFieldError({ overrideReason: 'form.required' });
      return;
    }
    setFieldError({});
    setRefusal(null);

    startTransition(() => {
      void completeDelivery({
        deliveryId,
        // The version the eligibility read republished. Never a version a
        // checklist result or a signature answered with.
        ifMatch: view.recordVersion,
        finalOdometerValue: value,
        odometerUnit: unit,
        ...(overriding ? { overrideReason: reason.trim() } : {}),
      }).then((result) => {
        notifyActionResult(result, messages);
        if (result.status === 'success') {
          setOdometer('');
          setOverriding(false);
          setReason('');
        } else if (result.code !== undefined) {
          setRefusal({
            code: result.code,
            requiredPermissions: result.requiredPermissions ?? [],
          });
        }
        // Re-read either way. A success moves the record to delivered; a refusal
        // means the screen's view of why is the thing that has to be refreshed,
        // because the refusal itself carries none of the reasons.
        onDone();
      });
    });
  };

  return (
    <Panel
      headingId="delivery-completion-heading"
      titleKey="delivery.completion.heading"
      messages={messages}
      description={translate(messages, 'delivery.completion.explain')}
    >
      {withheld ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'delivery.completion.needsFinance')}
        </p>
      ) : state === null ? (
        <PanelLoading messages={messages} />
      ) : state.status !== 'ok' ? (
        <PanelFailure
          messages={messages}
          status={state.status}
          correlationId={state.correlationId}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label={translate(messages, 'delivery.completion.odometer')}
              description={translate(messages, 'delivery.completion.odometerHelp')}
              inputMode="decimal"
              dir="ltr"
              spellCheck={false}
              required
              value={odometer}
              error={
                fieldError['finalOdometerValue']
                  ? translate(messages, 'delivery.completion.odometerInvalid')
                  : undefined
              }
              onChange={(event) => setOdometer(event.target.value)}
            />
            <SelectField
              label={translate(messages, 'delivery.completion.unit')}
              value={unit}
              onChange={(event) => setUnit(event.target.value as OdometerUnit)}
              options={ODOMETER_UNITS.map((value) => ({
                value,
                label: translateDynamic(messages, ODOMETER_UNIT_LABEL_KEYS[value] ?? value),
              }))}
            />
          </div>

          {overridableBlocking.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-md border border-warning-border bg-warning-subtle p-3">
              <label className="flex items-center gap-2 text-body text-text-primary">
                <input
                  type="checkbox"
                  checked={overriding}
                  onChange={(event) => setOverriding(event.target.checked)}
                />
                {translate(messages, 'delivery.completion.override')}
              </label>
              <p className="text-caption text-text-secondary">
                {translate(messages, 'delivery.completion.overrideExplain')}
              </p>
              {overriding ? (
                <TextAreaField
                  label={translate(messages, 'delivery.completion.overrideReason')}
                  required
                  maxLength={MAX_REASON}
                  value={reason}
                  error={
                    fieldError['overrideReason'] ? translate(messages, 'form.required') : undefined
                  }
                  onChange={(event) => setReason(event.target.value)}
                />
              ) : null}
            </div>
          ) : null}

          {refusal === null ? null : (
            <RefusalNote
              messages={messages}
              code={refusal.code}
              requiredPermissions={refusal.requiredPermissions}
              view={state.data}
            />
          )}

          <div className="flex flex-col gap-2">
            <button
              type="button"
              className={PRIMARY_BUTTON}
              disabled={pending || !couldRelease}
              onClick={submit}
            >
              {translate(messages, 'delivery.completion.submit')}
            </button>
            {couldRelease ? null : (
              <p className="text-caption text-text-secondary">
                {translate(messages, 'delivery.completion.heldBack')}
              </p>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

/**
 * What the backend refused, in the operator's language.
 *
 * Four codes are distinguished and everything else keeps the shared banner the
 * notification already showed. The four are distinguished because each leads
 * somewhere different: a blocked handover sends the operator back to the checks,
 * a refused override sends them to whoever holds the authority, a conflict that
 * survived the retry means somebody else is working on the same record, and a
 * missing version guard is a fault in this screen rather than in the request.
 */
function RefusalNote({
  messages,
  code,
  requiredPermissions,
  view,
}: {
  readonly messages: Messages;
  readonly code: string;
  readonly requiredPermissions: readonly string[];
  readonly view: DeliveryEligibility;
}) {
  if (code === DELIVERY_ERROR_CODES.blocked) {
    return (
      <div
        role="alert"
        className="flex flex-col gap-2 rounded-md border border-error-border bg-error-subtle p-3"
      >
        <p className="text-body text-text-primary">
          {translate(messages, 'delivery.completion.refusedBlocked')}
        </p>
        <ul className="flex list-disc flex-col gap-1 ps-5">
          {view.blockers.map((blocker) => (
            <li key={blocker} className="text-body text-text-primary">
              <BlockerLabel messages={messages} code={blocker} />
            </li>
          ))}
        </ul>
        {view.checklistGaps.length === 0 ? null : (
          <ul className="flex list-disc flex-col gap-1 ps-5">
            {view.checklistGaps.map((gap) => (
              <li key={gap.templateItemId} className="text-body text-text-primary">
                <bdi>{gap.label}</bdi>{' '}
                <code className="font-mono text-caption text-text-secondary" dir="ltr">
                  {gap.itemCode}
                </code>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (code === DELIVERY_ERROR_CODES.overrideDenied) {
    return (
      <div
        role="alert"
        className="flex flex-col gap-2 rounded-md border border-error-border bg-error-subtle p-3"
      >
        <p className="text-body text-text-primary">
          {translate(messages, 'delivery.completion.refusedOverride')}
        </p>
        {requiredPermissions.length === 0 ? null : (
          <ul className="flex flex-col gap-1">
            {requiredPermissions.map((permission) => (
              <li key={permission}>
                <code className="font-mono text-caption text-text-secondary" dir="ltr">
                  {permission}
                </code>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const key =
    code === DELIVERY_ERROR_CODES.staleVersion
      ? 'delivery.completion.refusedStale'
      : code === DELIVERY_ERROR_CODES.versionRequired
        ? 'delivery.completion.refusedNoVersion'
        : null;
  if (key === null) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-error-border bg-error-subtle p-3 text-body text-text-primary"
    >
      {translateDynamic(messages, key)}
    </p>
  );
}
