'use client';

import Link from 'next/link';
import { useState } from 'react';
import Button from '@mui/material/Button';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiLoadingState } from '@/components/states/MuiStates';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { workOrderStateMessageKey } from '@/features/work-orders/work-orders-contract';
import { IDLE, unreachable, type ActionState } from '@/lib/forms/action-result';
import { convertReceptionToWorkOrder } from '../../api';
import type { ReceptionConverted } from '../../receptions-contract';
import { readConvertedWorkOrder } from '../../work-order-api';
import type { ConvertedWorkOrder, ConvertedWorkOrderJob } from '../../work-order-contract';
import type { CheckInStepProps } from '../../check-in/wizard';
import { receptionAffordances } from '../../check-in/closure';
import { InstantOrRaw, RecordReadState } from './EvidencePanels';
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
 * ## The work-order state is said in words, and the work order is linked
 *
 * The state is translated by the same platform-state vocabulary the work-order
 * screens use (`workOrderStateMessageKey`); a code outside it is drawn as the
 * code rather than as a composed key. And the answer names the work order it
 * created, so the operator is offered a link to it rather than being left to
 * find it on the board (Browser QA part 7, row 5.3).
 *
 * ## A visit converted EARLIER links to its work order too (row 5.3, revisited)
 *
 * Coming back to a converted visit used to say "already converted" and nothing
 * else: the conversion's answer is gone with the session that received it. The
 * visit read now publishes the live ordinary work order it was converted into
 * (`workOrderId`, `workOrderDisplayNumber` on `rec.reception-detail`), so the
 * step names it by number and links to it — for a reader who may open work
 * orders; the link is not offered to anybody whose one outcome would be a
 * refusal.
 *
 * ## On the Material UI wrappers (ADR-022)
 *
 * Material buttons and states; the convert handler awaits the send AND the
 * re-read after it inside one `try` and clears its pending state in its
 * `finally`, so an answer that never arrives is said as that and the button is
 * usable again, and the button stays busy until that re-read has landed.
 */

export function ConversionStep({
  locale,
  messages,
  visitId,
  recordVersion,
  detail,
  capabilities,
  writesLocked,
  refresh,
  goToStep,
}: CheckInStepProps) {
  const affordances = receptionAffordances(detail.receptionStatus);
  const [state, setState] = useState<ActionState>(IDLE);
  const [converted, setConverted] = useState<ReceptionConverted | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    const attempt = (state.attempt ?? 0) + 1;
    setPending(true);
    // Pending covers the send AND the re-read after it: until the re-read
    // lands the only version on hand is the one just spent.
    try {
      let result: Awaited<ReturnType<typeof convertReceptionToWorkOrder>>;
      try {
        result = await convertReceptionToWorkOrder(visitId, recordVersion, attempt);
      } catch {
        // No answer came back: said as that, and the button works again. The
        // visit is re-read before the next attempt, which a replay also answers.
        setState(unreachable(attempt));
        return;
      }
      setState(result);
      notifyActionResult(result, messages);
      if (result.status === 'success' && result.converted) {
        setConverted(result.converted);
      }
      if (result.status === 'success' || result.status === 'conflict') {
        await refresh();
      }
    } finally {
      setPending(false);
    }
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
                <Button
                  type="button"
                  variant="contained"
                  onClick={() => {
                    if (!pending) void submit();
                  }}
                  disabled={pending}
                  aria-busy={pending || undefined}
                >
                  {pending
                    ? translate(messages, 'form.pending')
                    : translate(messages, 'receptions.convert.submit')}
                </Button>
              </div>
            ) : (
              <p className="text-caption text-text-muted" lang={locale}>
                {translate(messages, 'receptions.convert.denied')}
              </p>
            )
          ) : detail.receptionStatus === 'converted' ? (
            <ConvertedEarlier
              locale={locale}
              messages={messages}
              workOrderId={detail.workOrderId ?? null}
              workOrderDisplayNumber={detail.workOrderDisplayNumber ?? null}
              canReadWorkOrder={capabilities.readWorkOrders}
            />
          ) : (
            <p className="text-caption text-text-muted" lang={locale}>
              {/* Derived from the transition graph: `converted` is one edge from
                  `authorized` and from nowhere else. */}
              {translate(messages, 'receptions.convert.unavailable')}
            </p>
          )
        ) : null}

        {/* Conversion refuses through the SAME authorization rule the approval
            does (`assertStandingAuthorization`), so it can be refused for a
            missing or withdrawn authorization too. It is handed the wizard's
            navigation for the same reason the approval is: naming a step and
            then leaving the operator to find it is half an answer. */}
        <CommandOutcome locale={locale} messages={messages} state={state} goToStep={goToStep} />

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
 * A visit converted before this screen was opened: the work order the visit
 * read names, by number, and the way to it.
 *
 * The read publishes the work order only while it is live, so a visit whose
 * work order is gone says "already converted" and no more — never a link to
 * nothing.
 */
function ConvertedEarlier({
  locale,
  messages,
  workOrderId,
  workOrderDisplayNumber,
  canReadWorkOrder,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string | null;
  readonly workOrderDisplayNumber: string | null;
  readonly canReadWorkOrder: boolean;
}) {
  return (
    <div className="flex flex-col gap-2" data-testid="conversion-converted-earlier">
      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'receptions.convert.alreadyDone')}
      </p>
      {workOrderId !== null ? (
        <>
          <p className="text-body text-text-primary">
            {translate(messages, 'receptions.convert.workOrderNumber')}{' '}
            <bdi>
              {workOrderDisplayNumber ?? translate(messages, 'receptions.convert.unnumbered')}
            </bdi>
          </p>
          {canReadWorkOrder ? (
            <div>
              <Button
                component={Link}
                href={`/${locale}/work-orders/${encodeURIComponent(workOrderId)}`}
                variant="outlined"
              >
                {translate(messages, 'receptions.convert.openWorkOrder')}
              </Button>
            </div>
          ) : (
            <p className="text-caption text-text-muted" lang={locale}>
              {translate(messages, 'receptions.convert.readDenied')}
            </p>
          )}
        </>
      ) : null}
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
            <WorkOrderState messages={messages} state={converted.state} />
          </dd>
        </div>
      </dl>
      {/*
        The way to the work order this conversion created. Offered only to a
        reader who may open it: a link whose one outcome is a refusal is not a
        way anywhere.
      */}
      {canReadWorkOrder ? (
        <div>
          <Button
            component={Link}
            href={`/${locale}/work-orders/${encodeURIComponent(converted.workOrderId)}`}
            variant="outlined"
          >
            {translate(messages, 'receptions.convert.openWorkOrder')}
          </Button>
        </div>
      ) : null}

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

/** A work-order state in the reader's language, or the code when it is not a platform state. */
function WorkOrderState({
  messages,
  state,
}: {
  readonly messages: Messages;
  readonly state: string;
}) {
  const key = workOrderStateMessageKey(state);
  if (key === null) {
    return (
      <code className="font-mono text-caption" dir="ltr">
        {state}
      </code>
    );
  }
  return <>{translateDynamic(messages, key)}</>;
}

type PanelState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ok'; readonly data: ConvertedWorkOrder }
  | { readonly kind: 'denied'; readonly correlationId: string | null }
  | { readonly kind: 'expired'; readonly correlationId: string | null }
  | { readonly kind: 'unavailable'; readonly correlationId: string | null }
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

  const load = async () => {
    setPanel({ kind: 'loading' });
    try {
      const result = await readConvertedWorkOrder(workOrderId);
      if (result.status === 'ok') {
        setPanel({ kind: 'ok', data: result.data });
        return;
      }
      setPanel({
        kind:
          result.status === 'denied'
            ? 'denied'
            : result.status === 'expired'
              ? 'expired'
              : result.status === 'unavailable'
                ? 'unavailable'
                : 'error',
        correlationId: result.correlationId,
      });
    } catch {
      // A read that never came back is "unavailable, try again", not a spinner.
      setPanel({ kind: 'unavailable', correlationId: null });
    }
  };

  if (panel.kind === 'idle') {
    return (
      <div>
        <Button type="button" variant="outlined" size="small" onClick={() => void load()}>
          {translate(messages, 'receptions.convert.loadWorkOrder')}
        </Button>
      </div>
    );
  }
  if (panel.kind === 'loading') return <MuiLoadingState messages={messages} variant="inline" />;
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
  if (panel.kind !== 'ok') {
    // An outage and a fault offer "Try again"; an ended session does not.
    return (
      <RecordReadState
        messages={messages}
        locale={locale}
        status={panel.kind}
        correlationId={panel.correlationId}
        onRetry={() => void load()}
      />
    );
  }

  const { workOrder, jobs } = panel.data;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption text-text-secondary">
        {translate(messages, 'receptions.convert.openedAt')}{' '}
        <InstantOrRaw value={workOrder.openedAt} locale={locale} />
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
