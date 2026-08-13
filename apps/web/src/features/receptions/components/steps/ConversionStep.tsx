'use client';

import { useState, useTransition } from 'react';
import { ErrorState, LoadingState, SessionExpiredState } from '@/components/states/States';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { formatDateTime } from '@/lib/format';
import type { ActionState } from '@/lib/forms/action-result';
import { convertReceptionToWorkOrder } from '../../api';
import type { ReceptionConverted } from '../../receptions-contract';
import { readConvertedWorkOrder } from '../../work-order-api';
import type { ConvertedWorkOrder, ConvertedWorkOrderJob } from '../../work-order-contract';
import type { CheckInStepProps } from '../../check-in/wizard';
import { receptionAffordances } from '../../check-in/closure';
import { CommandOutcome } from './SummaryStep';

/**
 * Conversion to a work order (`FE-022`).
 *
 * `rec.reception-convert-to-work-order` is the ONLY way a work order comes to
 * exist — there is no `POST /work-orders` anywhere in the platform — so this is
 * the seam between P1-28 and P1-29. The step converts and then names what it
 * created; everything past that identity is the next phase's.
 *
 * ## The replay shape: 200 with `alreadyConverted: true` is SUCCESS
 *
 * Of the three replay shapes this phase must handle, this is the one most
 * easily rendered as a failure. Create replays 200 with the stored body and no
 * ETag; approve REFUSES a re-run with 409 `ERR-TRN-001`; convert answers a
 * re-run with **200 and `alreadyConverted: true`**, which is the platform saying
 * "that already happened, here is the work order". A screen that treated it as
 * an error would send an operator hunting for a work order the answer just
 * named. So the outcome renders the work order either way and only the sentence
 * above it changes.
 *
 * ## The version, and the ETag that does not come back
 *
 * `If-Match` is `recordVersion` from the shell's read. The conversion response
 * carries NO ETag, so there is no version to carry forward from it — and none is
 * needed: conversion moves the visit to the terminal `converted`, `refresh()`
 * re-reads, and every write control in the wizard withdraws itself. Nothing here
 * computes a version.
 *
 * ## The work-order state is an opaque catalogue code
 *
 * `wo.work_order_states` is a live catalogue, so `state` is rendered as the
 * identifier it is, with the disposition said beside it. Translating it against
 * a hand-written table would be a second copy of a tenant's configuration, and
 * a code the table lacked would render as the key.
 */

const IDLE: ActionState = { status: 'idle' };

export function ConversionStep({
  locale,
  messages,
  visitId,
  recordVersion,
  detail,
  capabilities,
  writesLocked,
  refresh,
}: CheckInStepProps) {
  const affordances = receptionAffordances(detail.receptionStatus);
  const [state, setState] = useState<ActionState>(IDLE);
  const [converted, setConverted] = useState<ReceptionConverted | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const result = await convertReceptionToWorkOrder(
        visitId,
        recordVersion,
        (state.attempt ?? 0) + 1
      );
      setState(result);
      notifyActionResult(result, messages);
      if (result.status === 'success' && result.converted) {
        setConverted(result.converted);
      }
      if (result.status === 'success' || result.status === 'conflict') {
        await refresh();
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-labelledby="conversion-heading"
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <h4 id="conversion-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'receptions.convert.heading')}
        </h4>
        <p className="text-body text-text-secondary" lang={locale}>
          {translate(messages, 'receptions.convert.body')}
        </p>

        {converted === null ? (
          affordances.convert && !writesLocked ? (
            capabilities.convertReceptions ? (
              <div>
                <button
                  type="button"
                  onClick={submit}
                  disabled={pending}
                  className="rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  {pending
                    ? translate(messages, 'form.pending')
                    : translate(messages, 'receptions.convert.submit')}
                </button>
              </div>
            ) : (
              <p className="text-caption text-text-muted" lang={locale}>
                {translate(messages, 'receptions.convert.denied')}
              </p>
            )
          ) : (
            <p className="text-caption text-text-muted" lang={locale}>
              {/* Derived from the transition graph: `converted` is one edge from
                  `authorized` and from nowhere else. */}
              {translate(
                messages,
                detail.receptionStatus === 'converted'
                  ? 'receptions.convert.alreadyDone'
                  : 'receptions.convert.unavailable'
              )}
            </p>
          )
        ) : null}

        <CommandOutcome locale={locale} messages={messages} state={state} />

        {converted !== null ? (
          <ConversionResult
            locale={locale}
            messages={messages}
            converted={converted}
            canReadWorkOrder={capabilities.readWorkOrders}
          />
        ) : null}
      </section>
    </div>
  );
}

/**
 * What the conversion produced.
 *
 * The identity comes from the command's own answer — it is complete enough to
 * name the work order without a second read — and `wo.work-order-detail` is then
 * read for the jobs the conversion opened. That read is a SEPARATE permission
 * (`wo.work_order.read`): an operator who may convert but not read work orders
 * still converted successfully, and is told exactly that rather than shown a
 * failure.
 */
function ConversionResult({
  locale,
  messages,
  converted,
  canReadWorkOrder,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly converted: ReceptionConverted;
  readonly canReadWorkOrder: boolean;
}) {
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-md border border-border bg-surface-subtle p-3"
    >
      <p className="text-body font-medium text-text-primary" lang={locale}>
        {translate(
          messages,
          converted.alreadyConverted
            ? // A replay. Success, and said as success.
              'receptions.convert.replayed'
            : 'receptions.convert.done'
        )}
      </p>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <div>
          <dt className="text-caption text-text-secondary">
            {translate(messages, 'receptions.convert.workOrderNumber')}
          </dt>
          <dd className="text-body text-text-primary">
            {converted.displayNumber ?? translate(messages, 'receptions.convert.unnumbered')}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-secondary">
            {translate(messages, 'receptions.convert.workOrderState')}
          </dt>
          <dd className="text-body text-text-primary">
            <code className="font-mono text-caption" dir="ltr">
              {converted.state}
            </code>
          </dd>
        </div>
      </dl>
      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'receptions.convert.stateOpaque')}
      </p>

      {canReadWorkOrder ? (
        <WorkOrderPanel locale={locale} messages={messages} workOrderId={converted.workOrderId} />
      ) : (
        <p className="text-caption text-text-muted" lang={locale}>
          {translate(messages, 'receptions.convert.readDenied')}
        </p>
      )}
    </div>
  );
}

type PanelState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ok'; readonly data: ConvertedWorkOrder }
  | { readonly kind: 'denied'; readonly correlationId: string | null }
  | { readonly kind: 'expired'; readonly correlationId: string | null }
  | { readonly kind: 'error'; readonly correlationId: string | null };

/**
 * The created work order's jobs (`wo.work-order-detail`).
 *
 * Read on intent rather than on mount: the conversion answer already names the
 * work order, so the extra read buys the jobs and nothing else — and spending it
 * automatically on every conversion would put an `expensive-read` on a path
 * nobody asked for.
 */
function WorkOrderPanel({
  locale,
  messages,
  workOrderId,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
}) {
  const [panel, setPanel] = useState<PanelState>({ kind: 'idle' });
  const [pending, startTransition] = useTransition();

  const load = () => {
    setPanel({ kind: 'loading' });
    startTransition(async () => {
      const result = await readConvertedWorkOrder(workOrderId);
      if (result.status === 'ok') {
        setPanel({ kind: 'ok', data: result.data });
        return;
      }
      setPanel({
        kind:
          result.status === 'denied' ? 'denied' : result.status === 'expired' ? 'expired' : 'error',
        correlationId: result.correlationId,
      });
    });
  };

  if (panel.kind === 'idle') {
    return (
      <div>
        <button
          type="button"
          onClick={load}
          disabled={pending}
          className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {translate(messages, 'receptions.convert.loadWorkOrder')}
        </button>
      </div>
    );
  }
  if (panel.kind === 'loading') return <LoadingState messages={messages} />;
  if (panel.kind === 'expired') return <SessionExpiredState messages={messages} />;
  if (panel.kind === 'denied') {
    return (
      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'receptions.convert.readDenied')}
        {panel.correlationId ? (
          <code className="ms-2 font-mono text-caption">{panel.correlationId}</code>
        ) : null}
      </p>
    );
  }
  if (panel.kind === 'error') {
    return (
      <ErrorState
        messages={messages}
        action={
          <button
            type="button"
            onClick={load}
            className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {translate(messages, 'state.retry')}
          </button>
        }
        {...(panel.correlationId ? { correlationId: panel.correlationId } : {})}
      />
    );
  }

  const { workOrder, jobs } = panel.data;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption text-text-secondary">
        {translate(messages, 'receptions.convert.openedAt')}{' '}
        <bdi>{formatDateTime(workOrder.openedAt, locale)}</bdi>
      </p>
      {jobs.length === 0 ? (
        <p className="text-body text-text-secondary" lang={locale}>
          {translate(messages, 'receptions.convert.noJobs')}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface">
          {jobs.map((job: ConvertedWorkOrderJob) => (
            <li key={job.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span className="text-body text-text-primary">{job.title}</span>
              <code className="font-mono text-caption text-text-muted" dir="ltr">
                {job.state}
              </code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
