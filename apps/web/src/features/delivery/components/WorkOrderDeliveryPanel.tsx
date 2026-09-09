'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import { readWorkOrderDelivery, startDelivery } from '../api';
import type { WorkOrderDelivery } from '../delivery-contract';
import { StatusLabel } from './CodeLabel';
import { PRIMARY_BUTTON } from './PanelShell';

/**
 * The way in from a work order to its handover (P1-31, entry point for FE-002).
 *
 * ## It is not rendered at all without the authority to read it
 *
 * The work-order page resolves `sal.delivery.view` and passes the answer down.
 * Without it this component is never mounted, so no request is issued for a
 * delivery the caller may not see — the same gate-before-read discipline the
 * route page follows, one level in. The work-order screen loses a section and
 * nothing else; an operator who may not see handovers has no use for one.
 *
 * ## "No delivery" includes a delivery in exception, and that is the operation's word
 *
 * The read answers with nothing when a work order has no LIVE delivery, and a
 * delivery marked as an exception is reported that way too. This panel states
 * what the operation states and does not narrate a distinction the read does not
 * publish.
 *
 * ## The control that creates one needs its OWN authority
 *
 * Starting a handover is `sal.delivery-create`, which declares
 * `sal.delivery.manage` — a different code from the one that let this panel be
 * mounted at all. A caller who may READ handovers and may not open one sees the
 * section and no form: the control is absent rather than present-and-refused,
 * because a button whose only outcome is a denial teaches an operator to ignore
 * denials.
 *
 * ## Who is handing the vehicle over is TYPED, and that is the honest shape
 *
 * `sal.delivery_records.delivering_employee_id` is `NOT NULL` with **no foreign
 * key**, and no read in this platform turns it into a person. Owner requirement
 * OWR-2026-09-06-G-10 — where that identity lives — is Undecided, so a picker
 * fed from any one roster would be this screen deciding it: choosing the
 * technician roster would assert that the person handing a vehicle over is a
 * technician, and would couple opening a handover to a permission the operation
 * does not declare. The shipped precedent for exactly this situation is the
 * work-order assignment control, which takes the identifier and says what it is.
 * So the field is explicit, required, has no default, and its help text says the
 * platform holds no name for it. It changes shape when the Owner decides, not
 * before.
 */
export function WorkOrderDeliveryPanel({
  locale,
  messages,
  workOrderId,
  canManage = false,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  /** Whether the caller holds the write code opening a handover declares. */
  readonly canManage?: boolean;
}) {
  const [held, setHeld] = useState<{
    readonly key: string;
    readonly read: ReadState<WorkOrderDelivery>;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const key = `${workOrderId}#${String(revision)}`;

  useEffect(() => {
    let cancelled = false;
    void readWorkOrderDelivery(workOrderId).then((read) => {
      if (!cancelled) setHeld({ key, read });
    });
    return () => {
      cancelled = true;
    };
  }, [key, workOrderId]);

  // What was read for ANOTHER work order, or before this panel opened a
  // handover, is absent rather than stale-but-shown.
  const state = held !== null && held.key === key ? held.read : null;

  return (
    <section
      aria-labelledby="work-order-delivery-heading"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <h2
        id="work-order-delivery-heading"
        className="mb-3 text-section-title font-medium text-text-primary"
      >
        {translate(messages, 'delivery.workOrder.heading')}
      </h2>
      {state === null ? (
        <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
      ) : state.status !== 'ok' ? (
        <p role="alert" className="text-body text-error">
          {translateDynamic(messages, `state.${state.status}.title`)}
          {state.correlationId
            ? ` ${translate(messages, 'action.reference')} ${state.correlationId}`
            : ''}
        </p>
      ) : state.data.delivery === null ? (
        <div className="flex flex-col gap-3">
          <p className="text-body text-text-secondary">
            {translate(messages, 'delivery.workOrder.none')}
          </p>
          {canManage ? (
            <StartForm
              messages={messages}
              workOrderId={workOrderId}
              onDone={() => setRevision((previous) => previous + 1)}
            />
          ) : null}
        </div>
      ) : (
        <p className="text-body text-text-primary">
          <StatusLabel messages={messages} status={state.data.delivery.status} />{' '}
          <Link
            href={`/${locale}/delivery/${state.data.delivery.id}`}
            className="text-primary underline-offset-2 hover:underline"
          >
            {translate(messages, 'delivery.workOrder.open')}
          </Link>
        </p>
      )}
    </section>
  );
}

/**
 * Open a handover for this work order.
 *
 * The vehicle and the visit are not asked for: the service derives both from the
 * work order, because `sal.guard_delivery_coherence` requires them to match it
 * and deriving means the mismatch cannot be expressed at all.
 *
 * A second live handover per work order is refused by the database
 * (`uq_delivery_records_work_order_active`) and surfaces as a conflict. That is
 * reported as the platform stated it rather than pre-empted here — this panel
 * has just read that there is none, and acting on a read that may be a second
 * old is exactly what the unique index is for.
 */
function StartForm({
  messages,
  workOrderId,
  onDone,
}: {
  readonly messages: Messages;
  readonly workOrderId: string;
  readonly onDone: () => void;
}) {
  const [employee, setEmployee] = useState('');
  const [missing, setMissing] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const value = employee.trim();
    if (value.length === 0) {
      setMissing(true);
      return;
    }
    setMissing(false);
    startTransition(() => {
      void startDelivery({ workOrderId, deliveringEmployeeId: value }).then((result) => {
        notifyActionResult(result, messages);
        if (result.status === 'success') {
          setEmployee('');
          onDone();
        }
      });
    });
  };

  return (
    <div className="flex flex-col gap-3 border-t border-border-subtle pt-3">
      <TextField
        label={translate(messages, 'delivery.start.deliveringEmployee')}
        description={translate(messages, 'delivery.start.deliveringEmployeeHelp')}
        dir="ltr"
        spellCheck={false}
        required
        value={employee}
        error={missing ? translate(messages, 'form.required') : undefined}
        onChange={(event) => setEmployee(event.target.value)}
      />
      <div>
        <button type="button" className={PRIMARY_BUTTON} disabled={pending} onClick={submit}>
          {translate(messages, 'delivery.start.submit')}
        </button>
      </div>
    </div>
  );
}
