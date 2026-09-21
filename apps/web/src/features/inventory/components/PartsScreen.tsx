'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { SelectField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import {
  workOrderStateMessageKey,
  type WorkOrderListEntry,
} from '@/features/work-orders/work-orders-contract';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { formatDateTime } from '@/lib/format';

import {
  cancelMaterialRequest,
  closeMaterialRequest,
  createIssue,
  createReservation,
  createReturn,
  listPartIssues,
  listRequiredParts,
  listReservations,
} from '../api';
import {
  MAX_REASON,
  QUANTITY,
  type IssueEcho,
  type MaterialRequirement,
  type PartIssue,
  type RequiredPart,
  type ReservationEcho,
  type ReturnEcho,
  type StockReservation,
  type StockTarget,
} from '../inventory-contract';
import { MaterialRequirementsPanel } from './MaterialRequirementsPanel';
import {
  BranchPairPicker,
  EMPTY_PAIR,
  LocationPicker,
  OutcomeNote,
  PRIMARY_BUTTON,
  Qty,
  SECONDARY_BUTTON,
  UUID,
  canNameBranch,
  useBranches,
  useLocations,
  type BranchPair,
} from './shared';

/**
 * The parts of one work order (P1-30, `W5`, FE-011 issues and FE-012 returns).
 *
 * ## Reached from a work order
 *
 * Part issues are published per work order only (`inv.work-order-part-issue-list`
 * names the order in its path — the parent is the target, one guard), so this
 * screen is addressed to one work order and, without one, explains and takes
 * an identifier. The required parts (`wo.required-part-list`) and the header
 * come with `wo.work_order.read`; the branch the work order belongs to is the
 * TARGET of the location and reservation pickers, and when the order cannot be
 * read the branch is taken as identifiers instead.
 *
 * ## Two operands, never a difference
 *
 * Each issue row carries `quantity` and `returnedQty`, two exact decimal
 * strings shown side by side. The row publishes no remaining figure and none
 * is taken here; the server refuses a return that would exceed the issue, and
 * a return's echo states `totalReturned` and `issuedQuantity` as the server
 * holds them.
 *
 * ## What the writes carry
 *
 * Issuing and returning are marked idempotent, so the transport attaches the
 * header key to every send; neither takes a body key, so neither reports a
 * replay. An issue larger than its reservation is refused (409) and rendered
 * as that refusal, with its reference. Write notices are held HERE, above the
 * panels that remount to re-read after a write (the W4 rule).
 *
 * ## P1-32: a work-order draw is measured against a requirement
 *
 * Reserving and issuing for this work order both name the material requirement
 * they draw on, and the forms CANNOT be submitted without one: the requirement
 * is chosen in the panel above, and the submit stays disabled until it is. That
 * is not a substitute for the server rule — the server refuses an unnamed or
 * over-drawn requirement with `ERR-INV-001` whatever this screen does — it is
 * the screen refusing to send a request it already knows is wrong, and naming
 * the act the operator has to do first.
 *
 * Every published refusal reason has its own sentence and its own next step:
 * ask for the requirement to be approved, add the missing conversion, confirm
 * the vehicle capacity, or request an exception for the excess. The refusal is
 * translated in `api.ts` from `materialDraw.reason`, which is what the server
 * publishes; nothing here guesses why a draw failed.
 */

/** What a write left to say, with the figures the server stated. */
interface WriteNotice {
  readonly messageKey: string;
  readonly figures: readonly { readonly labelKey: string; readonly value: string }[];
}

/** What a required part hands to the issue form. */
interface IssuePrefill {
  readonly itemId: string;
  readonly requiredPartRef: string;
  readonly quantity: string;
}

export function PartsScreen({
  locale,
  messages,
  workOrderId,
  workOrder,
  workOrderRefused,
  canOperate,
  canReadWorkOrder,
  canReadBranches,
  currentUserId,
  canRequestMaterial,
  canApproveMaterial,
  canDecideMaterialException,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** From the address; `null` when the page was reached without one. */
  readonly workOrderId: string | null;
  /** The page's own read of the work order, when the operator may read it; else `null`. */
  readonly workOrder: WorkOrderListEntry | null;
  /** True when the page tried to read the order (the operator holds the code) and was refused or found nothing. */
  readonly workOrderRefused: boolean;
  /** `inv.stock.operate` — issuing and returning. */
  readonly canOperate: boolean;
  /** `wo.work_order.read` — the required parts list is requested only with it. */
  readonly canReadWorkOrder: boolean;
  /** `org.branch.read` — whether a branch list is requested when the order's branch is unknown. */
  readonly canReadBranches: boolean;
  /** The signed-in person, so the panel can say why they cannot decide their own request. */
  readonly currentUserId: string;
  /** `inv.material.request` — asking for a requirement, re-checking, withdrawing. */
  readonly canRequestMaterial: boolean;
  /** `inv.material.approve` — deciding a requirement someone else asked for. */
  readonly canApproveMaterial: boolean;
  /** `inv.material.exception.approve` — deciding an exception. */
  readonly canDecideMaterialException: boolean;
}) {
  const [epoch, setEpoch] = useState(0);
  const [notice, setNotice] = useState<WriteNotice | null>(null);
  const [drawing, setDrawing] = useState<'reserve' | 'issue' | null>(null);
  const [prefill, setPrefill] = useState<IssuePrefill | null>(null);
  // The requirement a draw is measured against, chosen in the panel. Held here
  // because both draw forms name it and the panel is a sibling of both.
  const [requirement, setRequirement] = useState<MaterialRequirement | null>(null);
  // The material request the last draw opened, when a requirement governed it.
  // It is what "finish" and "withdraw" act on; null when no draw has landed.
  const [materialRequestId, setMaterialRequestId] = useState<string | null>(null);
  // The order's branch, memoised on its VALUES: the issue form keys its reads
  // on this object, and a fresh one per render would re-read without end.
  const workOrderCompanyId = workOrder?.companyId ?? null;
  const workOrderBranchId = workOrder?.branchId ?? null;
  const target = useMemo<StockTarget | null>(
    () =>
      workOrderCompanyId !== null && workOrderBranchId !== null
        ? { companyId: workOrderCompanyId, branchId: workOrderBranchId }
        : null,
    [workOrderCompanyId, workOrderBranchId]
  );

  if (workOrderId === null) {
    return <ChooseWorkOrder locale={locale} messages={messages} />;
  }

  const changed = (next: WriteNotice | null) => {
    setNotice(next);
    setEpoch((n) => n + 1);
  };

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <section
        aria-labelledby="parts-work-order-heading"
        className="rounded-lg border border-border bg-surface p-4"
        lang={locale}
      >
        <h2 id="parts-work-order-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'inventory.parts.workOrderHeading')}
        </h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <Figure label={translate(messages, 'inventory.parts.workOrderRef')}>
            <Link
              href={`/${locale}/work-orders/${workOrderId}`}
              className="font-mono text-caption text-primary underline-offset-2 hover:underline"
              dir="ltr"
            >
              {workOrder?.displayNumber ?? workOrderId}
            </Link>
          </Figure>
          {workOrder ? (
            <>
              <Figure label={translate(messages, 'inventory.parts.workOrderState')}>
                <WorkOrderState messages={messages} state={workOrder.state} />
              </Figure>
              <Figure label={translate(messages, 'inventory.parts.customer')}>
                {workOrder.customer ? (
                  <bdi>{workOrder.customer.displayName}</bdi>
                ) : (
                  <span className="text-text-muted">
                    {translate(messages, 'inventory.parts.noCustomer')}
                  </span>
                )}
              </Figure>
            </>
          ) : (
            <Figure label={translate(messages, 'inventory.parts.workOrderState')} wide>
              <span className="text-text-muted">
                {translate(
                  messages,
                  workOrderRefused
                    ? 'inventory.parts.workOrderRefused'
                    : 'inventory.parts.workOrderNotReadable'
                )}
              </span>
            </Figure>
          )}
        </dl>
        <p className="mt-3 text-caption">
          <Link
            href={`/${locale}/inventory/movements?workOrderId=${workOrderId}`}
            className="text-primary underline-offset-2 hover:underline"
          >
            {translate(messages, 'inventory.parts.movementsLink')}
          </Link>
        </p>
      </section>

      {canReadWorkOrder ? (
        <RequiredPartsPanel
          key={`req-${epoch}`}
          locale={locale}
          messages={messages}
          workOrderId={workOrderId}
          canOperate={canOperate}
          onIssue={(part) => {
            setPrefill(part);
            setDrawing('issue');
          }}
        />
      ) : null}

      <MaterialRequirementsPanel
        key={`material-${epoch}`}
        locale={locale}
        messages={messages}
        workOrderId={workOrderId}
        target={target}
        currentUserId={currentUserId}
        canRequest={canRequestMaterial}
        canApprove={canApproveMaterial}
        canDecideException={canDecideMaterialException}
        canReadWorkOrder={canReadWorkOrder}
        chosenId={requirement?.id ?? null}
        onChoose={(chosen) => {
          setRequirement(chosen);
          setPrefill(null);
        }}
        onChanged={() => {
          // A decision may have changed the requirement the forms hold, so the
          // choice is dropped rather than carried forward as a stale copy.
          setRequirement(null);
          setEpoch((n) => n + 1);
        }}
      />

      {canOperate ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={SECONDARY_BUTTON}
            aria-expanded={drawing === 'reserve'}
            onClick={() => {
              setDrawing((open) => (open === 'reserve' ? null : 'reserve'));
              setPrefill(null);
            }}
          >
            {translate(messages, 'inventory.parts.reserve.open')}
          </button>
          <button
            type="button"
            className={SECONDARY_BUTTON}
            aria-expanded={drawing === 'issue'}
            onClick={() => {
              setDrawing((open) => (open === 'issue' ? null : 'issue'));
              setPrefill(null);
            }}
          >
            {translate(messages, 'inventory.issue.open')}
          </button>
        </div>
      ) : null}

      {notice ? (
        <p role="status" className="text-caption text-text-muted" lang={locale}>
          {translateDynamic(messages, notice.messageKey)}
          {notice.figures.map((figure) => (
            <span key={figure.labelKey}>
              {' · '}
              {translateDynamic(messages, figure.labelKey)}{' '}
              <code className="font-mono" dir="ltr">
                {figure.value}
              </code>
            </span>
          ))}
        </p>
      ) : null}

      {canOperate && materialRequestId !== null ? (
        <MaterialRequestActions
          key={materialRequestId}
          messages={messages}
          requestId={materialRequestId}
          onSettled={() => {
            setMaterialRequestId(null);
            setEpoch((n) => n + 1);
          }}
        />
      ) : null}

      {canOperate && drawing === 'reserve' ? (
        <ReserveForm
          messages={messages}
          workOrderId={workOrderId}
          requirement={requirement}
          target={target}
          canReadBranches={canReadBranches}
          onReserved={(echo) => {
            setDrawing(null);
            setMaterialRequestId(echo.materialRequestId);
            changed({
              messageKey: 'inventory.parts.reserve.recorded',
              figures: [{ labelKey: 'inventory.reserve.figure.quantity', value: echo.quantity }],
            });
          }}
        />
      ) : null}

      {canOperate && drawing === 'issue' ? (
        <IssueForm
          key={prefill ? `${prefill.requiredPartRef}` : 'blank'}
          messages={messages}
          workOrderId={workOrderId}
          requirement={requirement}
          target={target}
          canReadBranches={canReadBranches}
          prefill={prefill}
          onIssued={(echo) => {
            setDrawing(null);
            setPrefill(null);
            setMaterialRequestId(echo.materialRequestId);
            changed({
              messageKey: 'inventory.issue.recorded',
              figures: [{ labelKey: 'inventory.issue.figure.quantity', value: echo.quantity }],
            });
          }}
        />
      ) : null}

      <PartIssuesPanel
        key={`issues-${epoch}`}
        locale={locale}
        messages={messages}
        workOrderId={workOrderId}
        canOperate={canOperate}
        onReturned={(echo) =>
          changed({
            messageKey: 'inventory.return.recorded',
            figures: [
              { labelKey: 'inventory.return.figure.quantity', value: echo.quantity },
              { labelKey: 'inventory.return.figure.returnedSoFar', value: echo.totalReturned },
              { labelKey: 'inventory.return.figure.issued', value: echo.issuedQuantity },
            ],
          })
        }
      />
    </div>
  );
}

function Figure({
  label,
  wide = false,
  children,
}: {
  readonly label: string;
  readonly wide?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="text-body text-text-primary">{children}</dd>
    </div>
  );
}

/**
 * The work order's state, in the operator's language (DEF-M-04).
 *
 * The header used to print `workOrder.state` raw, so an English screen read
 * "State in_progress" and an Arabic one carried the same Latin token inside a
 * right-to-left sentence. The nine codes the platform seeds have catalogue
 * entries; a state a tenant defined for itself has none, and rather than guess
 * at a sentence the code is rendered as the token it is, marked `ltr` inside a
 * `bdi` so it cannot reorder the Arabic line around it.
 */
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
      <bdi dir="ltr" className="font-mono text-caption">
        {state}
      </bdi>
    );
  }
  return <bdi>{translateDynamic(messages, key)}</bdi>;
}

/* ------------------------------------------------------------------ *
 * Without a work order: say so, and take one
 * ------------------------------------------------------------------ */

function ChooseWorkOrder({
  locale,
  messages,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
}) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const id = value.trim();
        if (!UUID.test(id)) {
          setError(translate(messages, 'inventory.common.idFormat'));
          return;
        }
        router.push(`/${locale}/inventory/parts?workOrderId=${encodeURIComponent(id)}`);
      }}
      noValidate
      aria-labelledby="parts-choose-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="parts-choose-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.parts.choose.heading')}
      </h2>
      <p className="text-body text-text-secondary">
        {translate(messages, 'inventory.parts.choose.explain')}
      </p>
      <p className="text-body">
        <Link
          href={`/${locale}/work-orders`}
          className="text-primary underline-offset-2 hover:underline"
        >
          {translate(messages, 'inventory.parts.choose.boardLink')}
        </Link>
      </p>
      <TextField
        label={translate(messages, 'inventory.parts.choose.workOrderId')}
        required
        spellCheck={false}
        dir="ltr"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        error={error}
      />
      <div>
        <button type="submit" className={PRIMARY_BUTTON}>
          {translate(messages, 'inventory.parts.choose.submit')}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * The required parts of the order (wo.required-part-list)
 * ------------------------------------------------------------------ */

function RequiredPartsPanel({
  locale,
  messages,
  workOrderId,
  canOperate,
  onIssue,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  readonly canOperate: boolean;
  readonly onIssue: (prefill: IssuePrefill) => void;
}) {
  const [items, setItems] = useState<readonly RequiredPart[] | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void listRequiredParts(workOrderId).then((state) => {
      if (!live) return;
      if (state.status === 'ok') setItems(state.data.items);
      else
        setRefused(
          state.status === 'denied'
            ? 'inventory.parts.required.refused'
            : 'inventory.parts.required.unavailable'
        );
    });
    return () => {
      live = false;
    };
  }, [workOrderId]);

  return (
    <section
      aria-labelledby="parts-required-heading"
      className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="parts-required-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.parts.required.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.parts.required.explain')}
      </p>
      {refused ? (
        <p role="alert" className="text-body text-error">
          {translateDynamic(messages, refused)}
        </p>
      ) : items === null ? (
        <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
      ) : items.length === 0 ? (
        <p className="py-4 text-center text-body text-text-secondary">
          {translate(messages, 'inventory.parts.required.none')}
        </p>
      ) : (
        <table className="w-full text-body">
          <caption className="sr-only">
            {translate(messages, 'inventory.parts.required.caption')}
          </caption>
          <thead>
            <tr className="text-start text-caption text-text-muted">
              <th scope="col" className="px-3 py-2 text-start">
                {translate(messages, 'inventory.parts.required.column.description')}
              </th>
              <th scope="col" className="px-3 py-2 text-end">
                {translate(messages, 'inventory.parts.required.column.quantity')}
              </th>
              <th scope="col" className="px-3 py-2 text-start">
                {translate(messages, 'inventory.parts.required.column.unit')}
              </th>
              <th scope="col" className="px-3 py-2 text-start">
                {translate(messages, 'inventory.parts.required.column.item')}
              </th>
              <th scope="col" className="px-3 py-2 text-start">
                {translate(messages, 'inventory.parts.required.column.actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((part) => (
              <tr key={part.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <bdi>{part.description}</bdi>
                </td>
                <td className="px-3 py-2 text-end tabular-nums">
                  <Qty value={part.quantity} />
                </td>
                <td className="px-3 py-2">
                  <bdi>{part.unit}</bdi>
                </td>
                <td className="px-3 py-2">
                  {part.reference ? (
                    <code className="font-mono text-caption" dir="ltr">
                      {part.reference}
                    </code>
                  ) : (
                    <span className="text-text-muted">
                      {translate(messages, 'inventory.parts.required.noItem')}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {canOperate && part.reference ? (
                    <button
                      type="button"
                      className={SECONDARY_BUTTON}
                      onClick={() =>
                        onIssue({
                          itemId: part.reference as string,
                          requiredPartRef: part.id,
                          quantity: part.quantity,
                        })
                      }
                    >
                      {translate(messages, 'inventory.parts.required.issueThis')}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * FE-011 — the issue form
 * ------------------------------------------------------------------ */

function IssueForm({
  messages,
  workOrderId,
  requirement,
  target,
  canReadBranches,
  prefill,
  onIssued,
}: {
  readonly messages: Messages;
  readonly workOrderId: string;
  /** The requirement this draw is measured against. Without one there is nothing to submit. */
  readonly requirement: MaterialRequirement | null;
  /** The work order's branch when it could be read; else taken from the operator. */
  readonly target: StockTarget | null;
  readonly canReadBranches: boolean;
  readonly prefill: IssuePrefill | null;
  readonly onIssued: (echo: IssueEcho) => void;
}) {
  const branches = useBranches(canReadBranches && target === null);
  const [pair, setPair] = useState<BranchPair>(EMPTY_PAIR);
  const typedCompanyId = pair.companyId.trim();
  const typedBranchId = pair.branchId.trim();
  const typedIsValid = UUID.test(typedCompanyId) && UUID.test(typedBranchId);
  // Memoised on the VALUES: a fresh object per render would re-key every
  // effect that reads it and re-read the locations without end.
  const chosen = useMemo<StockTarget | null>(
    () => target ?? (typedIsValid ? { companyId: typedCompanyId, branchId: typedBranchId } : null),
    [target, typedIsValid, typedCompanyId, typedBranchId]
  );
  const locations = useLocations(chosen);
  const [reservations, setReservations] = useState<readonly StockReservation[] | null>(null);
  const [reservationsRefused, setReservationsRefused] = useState<{
    readonly reference: string | null;
  } | null>(null);
  useEffect(() => {
    if (!chosen) return;
    let live = true;
    void listReservations(
      chosen,
      { workOrderId, status: 'active' },
      { ...INITIAL_REQUEST, pageSize: 100 },
      null
    ).then((page) => {
      if (!live) return;
      if (page.status === 'ok') {
        setReservations(page.rows);
        setReservationsRefused(null);
      } else {
        // A refusal is a refusal, never "no reservations".
        setReservations(null);
        setReservationsRefused({ reference: page.correlationId });
      }
    });
    return () => {
      live = false;
    };
  }, [chosen, workOrderId]);

  const [form, setForm] = useState({
    itemId: prefill?.itemId ?? requirement?.itemId ?? '',
    locationId: '',
    quantity: prefill?.quantity ?? '',
    reservationId: '',
    requiredPartRef: prefill?.requiredPartRef ?? '',
  });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    // Not reachable through the submit button, which stays disabled without a
    // requirement. Stated anyway: a form that can be submitted by pressing Enter
    // in a text field must refuse the same request the button refuses.
    if (requirement === null) {
      setErrors({ materialRequirementId: 'inventory.parts.draw.needRequirement' });
      return;
    }
    if (target === null) {
      if (!UUID.test(pair.companyId.trim())) found['companyId'] = 'inventory.common.idFormat';
      if (!UUID.test(pair.branchId.trim())) found['branchId'] = 'inventory.common.idFormat';
    }
    const itemId = form.itemId.trim();
    if (!UUID.test(itemId)) found['itemId'] = 'inventory.common.idFormat';
    if (!form.locationId) found['locationId'] = 'field.required';
    const quantity = form.quantity.trim();
    if (!QUANTITY.test(quantity) || /^0+(?:\.0+)?$/.test(quantity)) {
      found['quantity'] = 'inventory.reserve.quantityFormat';
    }
    const requiredPartRef = form.requiredPartRef.trim();
    if (requiredPartRef.length > 0 && !UUID.test(requiredPartRef)) {
      found['requiredPartRef'] = 'inventory.common.idFormat';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await createIssue({
      workOrderId,
      itemId,
      locationId: form.locationId,
      quantity,
      materialRequirementId: requirement.id,
      ...(form.reservationId ? { reservationId: form.reservationId } : {}),
      ...(requiredPartRef ? { requiredPartRef } : {}),
    });
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      setOutcome(null);
      onIssued(result.created);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="parts-issue-heading"
      className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2"
    >
      <h2
        id="parts-issue-heading"
        className="text-body font-medium text-text-primary sm:col-span-2"
      >
        {translate(messages, 'inventory.issue.heading')}
      </h2>
      <p className="text-caption text-text-muted sm:col-span-2">
        {translate(messages, 'inventory.issue.explain')}
      </p>
      <div className="sm:col-span-2">
        <ChosenRequirement
          messages={messages}
          requirement={requirement}
          error={errorFor('materialRequirementId')}
        />
      </div>
      {target === null ? (
        <>
          <p className="text-caption text-text-muted sm:col-span-2">
            {translate(messages, 'inventory.issue.branchUnknown')}
          </p>
          <BranchPairPicker
            messages={messages}
            branches={branches}
            label={translate(messages, 'inventory.target.branch')}
            placeholder={translate(messages, 'inventory.target.chooseBranch')}
            value={pair}
            onChange={setPair}
            errors={{ companyId: errorFor('companyId'), branchId: errorFor('branchId') }}
          />
        </>
      ) : null}
      <SelectField
        label={translate(messages, 'inventory.issue.reservation')}
        description={
          reservationsRefused
            ? `${translate(messages, 'inventory.issue.reservationsRefused')}${
                reservationsRefused.reference
                  ? ` ${translate(messages, 'state.correlationId')} ${reservationsRefused.reference}`
                  : ''
              }`
            : translate(messages, 'inventory.issue.reservationHelp')
        }
        value={form.reservationId}
        onChange={(event) => {
          const id = event.target.value;
          const reservation = reservations?.find((row) => row.id === id);
          setForm((f) =>
            reservation
              ? {
                  ...f,
                  reservationId: id,
                  itemId: reservation.itemId,
                  locationId: reservation.locationId,
                }
              : { ...f, reservationId: id }
          );
        }}
        options={(reservations ?? []).map((reservation) => ({
          value: reservation.id,
          label: `${reservation.sku} — ${reservation.locationCode} — ${reservation.quantity}`,
        }))}
        placeholder={translate(messages, 'inventory.issue.noReservation')}
      />
      <TextField
        label={translate(messages, 'inventory.issue.itemId')}
        description={translate(messages, 'inventory.issue.itemIdHelp')}
        required
        spellCheck={false}
        dir="ltr"
        value={form.itemId}
        onChange={(event) => setForm((f) => ({ ...f, itemId: event.target.value }))}
        error={errorFor('itemId')}
      />
      <LocationPicker
        messages={messages}
        locations={locations}
        label={translate(messages, 'inventory.issue.location')}
        placeholder={translate(messages, 'inventory.reserve.chooseLocation')}
        required
        value={form.locationId}
        onChange={(next) => setForm((f) => ({ ...f, locationId: next }))}
        error={errorFor('locationId')}
      />
      <TextField
        label={translate(messages, 'inventory.issue.quantity')}
        description={translate(messages, 'inventory.reserve.quantityHelp')}
        required
        inputMode="decimal"
        dir="ltr"
        value={form.quantity}
        onChange={(event) => setForm((f) => ({ ...f, quantity: event.target.value }))}
        error={errorFor('quantity')}
      />
      <TextField
        label={translate(messages, 'inventory.issue.requiredPartRef')}
        description={translate(messages, 'inventory.issue.requiredPartHelp')}
        spellCheck={false}
        dir="ltr"
        value={form.requiredPartRef}
        onChange={(event) => setForm((f) => ({ ...f, requiredPartRef: event.target.value }))}
        error={errorFor('requiredPartRef')}
      />
      <div className="sm:col-span-2">
        <OutcomeNote messages={messages} outcome={outcome} />
      </div>
      <div className="sm:col-span-2">
        <button
          type="submit"
          className={PRIMARY_BUTTON}
          /*
           * `target === null` is not redundant defence. This is the part-ISSUE
           * submit, not a branch submit, and the picker is mounted only while
           * the target is unknown. Writing the condition out keeps the guard
           * about the pair by construction rather than by an accident of the
           * conjunction `useBranches(canReadBranches && target === null)`, so a
           * permitted operator whose branch list came back EMPTY can still
           * issue a part.
           */
          disabled={busy || requirement === null || (target === null && !canNameBranch(branches))}
        >
          {translate(messages, 'inventory.issue.submit')}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * P1-32 — reserving against a requirement, and what the draw opened
 * ------------------------------------------------------------------ */

/**
 * The requirement a draw will be measured against, or the sentence that says
 * there is none and what to do about it. Rendered inside BOTH draw forms, so
 * neither can be filled in under the impression that a draw is possible.
 *
 * `error` is what the service published against `body.materialRequirementId` —
 * a reservation drawn on a different service line is refused there, and this is
 * the only place on either form that names the requirement, so it is the only
 * place the sentence can be read beside what it is about.
 */
function ChosenRequirement({
  messages,
  requirement,
  error,
}: {
  readonly messages: Messages;
  readonly requirement: MaterialRequirement | null;
  readonly error?: string | undefined;
}) {
  const refusal =
    error === undefined ? null : (
      <p role="alert" className="text-body text-error">
        {error}
      </p>
    );
  if (requirement === null) {
    return (
      <>
        <p role="note" className="text-body text-text-secondary">
          {translate(messages, 'inventory.parts.draw.needRequirement')}
        </p>
        {refusal}
      </>
    );
  }
  return (
    <>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.parts.draw.usingRequirement')}{' '}
        <code className="font-mono" dir="ltr">
          {requirement.id}
        </code>
        {' · '}
        {translate(messages, 'inventory.material.allowance.remaining')}{' '}
        {requirement.remainingQuantity === null ? (
          translate(messages, 'inventory.material.allowance.unset')
        ) : (
          <Qty value={requirement.remainingQuantity} />
        )}
      </p>
      {refusal}
    </>
  );
}

/**
 * Reserve stock for this work order, against the chosen requirement.
 *
 * `idempotencyKey` is one key per opened form, kept across a refusal, so
 * pressing Reserve again answers the reservation already made rather than
 * making a second one.
 */
function ReserveForm({
  messages,
  workOrderId,
  requirement,
  target,
  canReadBranches,
  onReserved,
}: {
  readonly messages: Messages;
  readonly workOrderId: string;
  readonly requirement: MaterialRequirement | null;
  readonly target: StockTarget | null;
  readonly canReadBranches: boolean;
  readonly onReserved: (echo: ReservationEcho) => void;
}) {
  const branches = useBranches(canReadBranches && target === null);
  const [pair, setPair] = useState<BranchPair>(EMPTY_PAIR);
  const typedCompanyId = pair.companyId.trim();
  const typedBranchId = pair.branchId.trim();
  const typedIsValid = UUID.test(typedCompanyId) && UUID.test(typedBranchId);
  const chosen = useMemo<StockTarget | null>(
    () => target ?? (typedIsValid ? { companyId: typedCompanyId, branchId: typedBranchId } : null),
    [target, typedIsValid, typedCompanyId, typedBranchId]
  );
  const locations = useLocations(chosen);
  const [form, setForm] = useState({
    itemId: requirement?.itemId ?? '',
    locationId: '',
    quantity: '',
  });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const [attemptKey] = useState(() => crypto.randomUUID());

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    if (requirement === null) {
      setErrors({ materialRequirementId: 'inventory.parts.draw.needRequirement' });
      return;
    }
    const found: Record<string, string> = {};
    if (target === null) {
      if (!UUID.test(typedCompanyId)) found['companyId'] = 'inventory.common.idFormat';
      if (!UUID.test(typedBranchId)) found['branchId'] = 'inventory.common.idFormat';
    }
    const itemId = form.itemId.trim();
    if (!UUID.test(itemId)) found['itemId'] = 'inventory.common.idFormat';
    if (!form.locationId) found['locationId'] = 'field.required';
    const quantity = form.quantity.trim();
    if (!QUANTITY.test(quantity) || /^0+(?:\.0+)?$/.test(quantity)) {
      found['quantity'] = 'inventory.reserve.quantityFormat';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await createReservation({
      itemId,
      locationId: form.locationId,
      quantity,
      workOrderId,
      materialRequirementId: requirement.id,
      idempotencyKey: attemptKey,
    });
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      setOutcome(null);
      onReserved(result.created);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="parts-reserve-heading"
      className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2"
    >
      <h2
        id="parts-reserve-heading"
        className="text-body font-medium text-text-primary sm:col-span-2"
      >
        {translate(messages, 'inventory.parts.reserve.heading')}
      </h2>
      <p className="text-caption text-text-muted sm:col-span-2">
        {translate(messages, 'inventory.parts.reserve.explain')}
      </p>
      <div className="sm:col-span-2">
        <ChosenRequirement
          messages={messages}
          requirement={requirement}
          error={errorFor('materialRequirementId')}
        />
      </div>
      {target === null ? (
        <>
          <p className="text-caption text-text-muted sm:col-span-2">
            {translate(messages, 'inventory.issue.branchUnknown')}
          </p>
          <BranchPairPicker
            messages={messages}
            branches={branches}
            label={translate(messages, 'inventory.target.branch')}
            placeholder={translate(messages, 'inventory.target.chooseBranch')}
            value={pair}
            onChange={setPair}
            errors={{ companyId: errorFor('companyId'), branchId: errorFor('branchId') }}
          />
        </>
      ) : null}
      <TextField
        label={translate(messages, 'inventory.reserve.itemId')}
        description={translate(messages, 'inventory.reserve.itemIdHelp')}
        required
        spellCheck={false}
        dir="ltr"
        value={form.itemId}
        onChange={(event) => setForm((f) => ({ ...f, itemId: event.target.value }))}
        error={errorFor('itemId')}
      />
      <LocationPicker
        messages={messages}
        locations={locations}
        label={translate(messages, 'inventory.reserve.location')}
        placeholder={translate(messages, 'inventory.reserve.chooseLocation')}
        required
        value={form.locationId}
        onChange={(next) => setForm((f) => ({ ...f, locationId: next }))}
        error={errorFor('locationId')}
      />
      <TextField
        label={translate(messages, 'inventory.reserve.quantity')}
        description={translate(messages, 'inventory.reserve.quantityHelp')}
        required
        inputMode="decimal"
        dir="ltr"
        value={form.quantity}
        onChange={(event) => setForm((f) => ({ ...f, quantity: event.target.value }))}
        error={errorFor('quantity')}
      />
      <div className="sm:col-span-2">
        <OutcomeNote messages={messages} outcome={outcome} />
      </div>
      <div className="sm:col-span-2">
        <button
          type="submit"
          className={PRIMARY_BUTTON}
          disabled={busy || requirement === null || (target === null && !canNameBranch(branches))}
        >
          {translate(messages, 'inventory.parts.reserve.submit')}
        </button>
      </div>
    </form>
  );
}

/**
 * What a governed draw opened: the material request it belongs to, which is
 * either FINISHED when the parts are settled — releasing whatever reservation it
 * still holds — or WITHDRAWN with a reason when the job changed.
 */
function MaterialRequestActions({
  messages,
  requestId,
  onSettled,
}: {
  readonly messages: Messages;
  readonly requestId: string;
  readonly onSettled: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const run = async (act: () => Promise<{ readonly state: ActionState }>) => {
    setBusy(true);
    const result = await act();
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success') {
      setOutcome(null);
      onSettled();
    }
  };

  return (
    <section
      aria-labelledby="parts-request-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="parts-request-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.parts.request.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.parts.request.explain')}{' '}
        <code className="font-mono" dir="ltr">
          {requestId}
        </code>
      </p>
      <TextField
        label={translate(messages, 'inventory.parts.request.reason')}
        description={translate(messages, 'inventory.parts.request.reasonHelp')}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        error={error}
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={SECONDARY_BUTTON}
          disabled={busy}
          onClick={() => {
            const value = reason.trim();
            if (value.length > MAX_REASON) {
              setError(translate(messages, 'inventory.return.reasonTooLong'));
              return;
            }
            setError(undefined);
            void run(() => closeMaterialRequest(requestId, value ? { reason: value } : {}));
          }}
        >
          {translate(messages, 'inventory.parts.request.close')}
        </button>
        <button
          type="button"
          className={SECONDARY_BUTTON}
          disabled={busy}
          onClick={() => {
            const value = reason.trim();
            if (value.length === 0) {
              setError(translate(messages, 'field.required'));
              return;
            }
            if (value.length > MAX_REASON) {
              setError(translate(messages, 'inventory.return.reasonTooLong'));
              return;
            }
            setError(undefined);
            void run(() => cancelMaterialRequest(requestId, { reason: value }));
          }}
        >
          {translate(messages, 'inventory.parts.request.cancel')}
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The issues of the order, and FE-012 — returning
 * ------------------------------------------------------------------ */

function PartIssuesPanel({
  locale,
  messages,
  workOrderId,
  canOperate,
  onReturned,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  readonly canOperate: boolean;
  readonly onReturned: (echo: ReturnEcho) => void;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) => listPartIssues(workOrderId, request, cursor),
    [workOrderId]
  );
  const table = useServerTable<PartIssue>(load, { initial: INITIAL_REQUEST });
  const [returning, setReturning] = useState<PartIssue | null>(null);

  const columns = useMemo<readonly Column<PartIssue>[]>(
    () => [
      {
        id: 'sku',
        headerKey: 'inventory.parts.issues.column.sku',
        cell: (row) => (
          <code className="font-mono text-caption" dir="ltr">
            {row.sku}
          </code>
        ),
      },
      {
        id: 'location',
        headerKey: 'inventory.parts.issues.column.location',
        cell: (row) => (
          <code className="font-mono text-caption" dir="ltr">
            {row.locationCode}
          </code>
        ),
      },
      {
        id: 'quantity',
        headerKey: 'inventory.parts.issues.column.quantity',
        numeric: true,
        cell: (row) => <Qty value={row.quantity} />,
      },
      {
        id: 'returned',
        headerKey: 'inventory.parts.issues.column.returned',
        numeric: true,
        cell: (row) => <Qty value={row.returnedQty} />,
      },
      {
        id: 'reservation',
        headerKey: 'inventory.parts.issues.column.reservation',
        cell: (row) =>
          row.reservationId ? (
            <code className="font-mono text-caption" dir="ltr">
              {row.reservationId}
            </code>
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'inventory.parts.issues.noReservation')}
            </span>
          ),
      },
      {
        id: 'issuedAt',
        headerKey: 'inventory.parts.issues.column.issuedAt',
        cell: (row) => <span dir="ltr">{formatDateTime(row.issuedAt, locale)}</span>,
      },
      {
        id: 'actions',
        headerKey: 'inventory.parts.issues.column.actions',
        cell: (row) =>
          canOperate ? (
            <button
              type="button"
              className={SECONDARY_BUTTON}
              aria-expanded={returning?.id === row.id}
              onClick={() => setReturning((current) => (current?.id === row.id ? null : row))}
            >
              {translate(messages, 'inventory.return.action')}
            </button>
          ) : null,
      },
    ],
    [canOperate, locale, messages, returning?.id]
  );

  return (
    <section
      aria-labelledby="parts-issues-heading"
      className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="parts-issues-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.parts.issues.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.parts.issues.explain')}
      </p>
      <DataTable<PartIssue>
        messages={messages}
        columns={columns}
        rowId={(row) => row.id}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={table.setRequest}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={translate(messages, 'inventory.parts.issues.caption')}
        suppressEmptyState
      />
      {table.response && table.response.rows.length === 0 ? (
        <p className="py-6 text-center text-body text-text-secondary">
          {translate(messages, 'inventory.parts.issues.none')}
        </p>
      ) : null}
      {canOperate && returning ? (
        <ReturnForm
          key={returning.id}
          messages={messages}
          issue={returning}
          onReturned={(echo) => {
            setReturning(null);
            onReturned(echo);
          }}
        />
      ) : null}
    </section>
  );
}

function ReturnForm({
  messages,
  issue,
  onReturned,
}: {
  readonly messages: Messages;
  readonly issue: PartIssue;
  readonly onReturned: (echo: ReturnEcho) => void;
}) {
  const [form, setForm] = useState({ quantity: '', reason: '' });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    const quantity = form.quantity.trim();
    if (!QUANTITY.test(quantity) || /^0+(?:\.0+)?$/.test(quantity)) {
      found['quantity'] = 'inventory.reserve.quantityFormat';
    }
    const reason = form.reason.trim();
    if (reason.length > MAX_REASON) found['reason'] = 'inventory.return.reasonTooLong';
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await createReturn({
      partIssueId: issue.id,
      quantity,
      ...(reason ? { reason } : {}),
    });
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      setOutcome(null);
      onReturned(result.created);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="parts-return-heading"
      className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2"
    >
      <h3
        id="parts-return-heading"
        className="text-body font-medium text-text-primary sm:col-span-2"
      >
        {translate(messages, 'inventory.return.heading')}{' '}
        <code className="font-mono text-caption" dir="ltr">
          {issue.sku}
        </code>
      </h3>
      <p className="text-caption text-text-muted sm:col-span-2">
        {translate(messages, 'inventory.return.explain')}{' '}
        {translate(messages, 'inventory.return.issuedLabel')} <Qty value={issue.quantity} />
        {' · '}
        {translate(messages, 'inventory.return.returnedLabel')} <Qty value={issue.returnedQty} />
      </p>
      <TextField
        label={translate(messages, 'inventory.return.quantity')}
        description={translate(messages, 'inventory.reserve.quantityHelp')}
        required
        inputMode="decimal"
        dir="ltr"
        value={form.quantity}
        onChange={(event) => setForm((f) => ({ ...f, quantity: event.target.value }))}
        error={errorFor('quantity')}
      />
      <TextField
        label={translate(messages, 'inventory.return.reason')}
        description={translate(messages, 'inventory.return.reasonHelp')}
        value={form.reason}
        onChange={(event) => setForm((f) => ({ ...f, reason: event.target.value }))}
        error={errorFor('reason')}
      />
      <div className="sm:col-span-2">
        <OutcomeNote messages={messages} outcome={outcome} />
      </div>
      <div className="sm:col-span-2">
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'inventory.return.submit')}
        </button>
      </div>
    </form>
  );
}
