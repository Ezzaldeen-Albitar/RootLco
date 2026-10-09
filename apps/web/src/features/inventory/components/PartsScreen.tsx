'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';

import {
  OperationalGrid,
  type OperationalColumn,
  type RowAction,
} from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { FormNumberField } from '@/components/forms/mui/FormNumberField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiEmptyState, MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import {
  workOrderStateMessageKey,
  type WorkOrderListEntry,
} from '@/features/work-orders/work-orders-contract';
import {
  WorkOrderPicker,
  useWorkOrderSearchScope,
} from '@/features/work-orders/components/WorkOrderPicker';
import { useBranchTarget } from '@/features/working-context/use-branch-target';
import {
  useUnsavedGuard,
  useWorkingContext,
} from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic, translateWithValues } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';
import { unitNameByCode, type NamedUnit } from '@/lib/unit-name';

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
import { MaterialRequirementsPanel, type RequirementSummary } from './MaterialRequirementsPanel';
import {
  BranchPairPicker,
  EMPTY_PAIR,
  LocationPicker,
  OutcomeNote,
  Qty,
  UUID,
  canNameBranch,
  useBranches,
  useLocations,
  type BranchPair,
} from './shared';
import { ItemPicker, REFERENCE, ReferenceBox, withoutKey, type ItemChoice } from './pickers';
import { useUnitList } from './unit-list';
import {
  StockMoment,
  refusalState,
  useFocusOnOpen,
  useReturnFocus,
  useStockDisplayZone,
} from './stock-operations';

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
 * ## The item, the job and the required part are found, not typed
 *
 * Route sweep B2 (Owner directive, `P1-32-PRE-OD-UX`). The issue and reserve
 * forms take the item from the catalogue by its stock code or name
 * (`inv.item.read`), and the issue form names the required-part line from the
 * work order's own list (`wo.work_order.read`). Neither write needs those codes
 * — `inv.stock-issue-create` and `inv.stock-reservation-create` declare
 * `inv.stock.operate` — so a caller without one keeps the labelled,
 * shape-checked reference box they had before. The same holds for the job
 * chooser: without `wo.work_order.read` it keeps a labelled job reference,
 * because the parts of a job are read with `inv.stock.read` alone.
 *
 * Every published refusal reason has its own sentence and its own next step:
 * ask for the requirement to be approved, add the missing conversion, confirm
 * the vehicle capacity, or request an exception for the excess. The refusal is
 * translated in `api.ts` from `materialDraw.reason`, which is what the server
 * publishes; nothing here guesses why a draw failed.
 *
 * ## On Material UI (ADR-022, `P1-32-PRE-OD-INV5`)
 *
 * Every control this screen draws itself is a shared wrapper: the job is
 * `WorkOrderPicker` on `EntityPicker`; the quantities are `FormNumberField`
 * (the string typed is the string sent), the selects `FormSelectField`, the
 * reasons `FormTextField`; every button is Material's. The issues of the order
 * are `OperationalGrid` over the same cursor-paged read (server paging, no
 * count, "Page N"), Return its row action; the required parts are Material's
 * table, since that read answers the job's whole list. Each issue's moment is
 * written on the branch's clock and names it (`StockMoment`), never on the
 * browser's. Each write is held to one at a time by a ref set before anything
 * is awaited, and a form that opens takes the cursor and gives it back when it
 * closes. What is read, sent, authorized and refused is unchanged.
 */

/** What a write left to say, with the figures the server stated. */
interface WriteNotice {
  readonly messageKey: string;
  readonly figures: readonly { readonly labelKey: string; readonly value: string }[];
}

/** What a required part hands to the issue form. */
interface IssuePrefill {
  readonly itemId: string;
  /** The words the required part is known by, shown as the chosen item. */
  readonly itemLabel: string;
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
  canReadItems = false,
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
  /** `inv.item.read` — the item is found in the catalogue, or given as a reference. */
  readonly canReadItems?: boolean;
  /**
   * `org.branch.read`. Accepted so the route did not have to change, and no
   * longer read: the branch is the working context's own named selection, and
   * that read is gated on `iam.user.read` rather than on an administration
   * code.
   */
  readonly canReadBranches?: boolean;
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
  /*
   * The working context's version, part of both draw forms' keys. The issue
   * form seeds its fallback branch from the working branch, and both forms hold
   * a typed quantity and references the picker inside them does not: kept
   * across a switch, a confirmed "Discard and change branch" would leave the
   * previous branch's draw on screen, ready to send. A new mount per version
   * opens them empty and addressed to the branch now named.
   */
  const { version } = useWorkingContext();
  const [notice, setNotice] = useState<WriteNotice | null>(null);
  const [drawing, setDrawing] = useState<'reserve' | 'issue' | null>(null);
  const [prefill, setPrefill] = useState<IssuePrefill | null>(null);
  // The requirement a draw is measured against, chosen in the panel. Held here
  // because both draw forms name it and the panel is a sibling of both.
  const [requirement, setRequirement] = useState<MaterialRequirement | null>(null);
  // What the forms say about it, in words (LANG-identifiers), set with it.
  const [summary, setSummary] = useState<RequirementSummary | null>(null);
  // The units a refusal's figures are named in (UNIT-names); null without `inv.item.read`.
  const units = useUnitList(canReadItems);
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
  // The two toggles take the cursor back when the form they opened closes.
  const reserveToggle = useReturnFocus<HTMLButtonElement>(drawing === 'reserve');
  const issueToggle = useReturnFocus<HTMLButtonElement>(drawing === 'issue');

  if (workOrderId === null) {
    return (
      <ChooseWorkOrder locale={locale} messages={messages} canSearchWorkOrders={canReadWorkOrder} />
    );
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
        canReadItems={canReadItems}
        chosenId={requirement?.id ?? null}
        onChoose={(chosen, chosenSummary) => {
          setRequirement(chosen);
          setSummary(chosenSummary);
          setPrefill(null);
        }}
        onChanged={() => {
          // A decision may have changed the requirement the forms hold, so the
          // choice is dropped rather than carried forward as a stale copy.
          setRequirement(null);
          setSummary(null);
          setEpoch((n) => n + 1);
        }}
      />

      {canOperate ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            ref={reserveToggle}
            type="button"
            variant="outlined"
            aria-expanded={drawing === 'reserve'}
            onClick={() => {
              setDrawing((open) => (open === 'reserve' ? null : 'reserve'));
              setPrefill(null);
            }}
          >
            {translate(messages, 'inventory.parts.reserve.open')}
          </Button>
          <Button
            ref={issueToggle}
            type="button"
            variant="outlined"
            aria-expanded={drawing === 'issue'}
            onClick={() => {
              setDrawing((open) => (open === 'issue' ? null : 'issue'));
              setPrefill(null);
            }}
          >
            {translate(messages, 'inventory.issue.open')}
          </Button>
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
          key={`reserve-${version}`}
          messages={messages}
          locale={locale}
          workOrderId={workOrderId}
          requirement={requirement}
          summary={summary}
          units={units}
          target={target}
          canReadBranches={canReadBranches ?? false}
          canReadItems={canReadItems}
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
          key={`${prefill ? prefill.requiredPartRef : 'blank'}:${version}`}
          locale={locale}
          messages={messages}
          workOrderId={workOrderId}
          requirement={requirement}
          summary={summary}
          units={units}
          target={target}
          canReadBranches={canReadBranches ?? false}
          canReadItems={canReadItems}
          canReadWorkOrder={canReadWorkOrder}
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
        target={target}
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
  canSearchWorkOrders,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** `wo.work_order.read` — whether the jobs of the branch can be searched. */
  readonly canSearchWorkOrders: boolean;
}) {
  const router = useRouter();
  /*
   * The job is FOUND, not typed (Owner directive, `P1-32-PRE-OD-UX`): the
   * same picker the invoice desk and the quotation builder use, searching the
   * working branch's jobs on the server.
   *
   * The parts of a job are read with `inv.stock.read` alone, so a caller
   * without `wo.work_order.read` keeps the box they had before the picker: a
   * labelled job reference, checked for shape before the page is opened on it
   * (route sweep B2). Choosing where to look is not a write, so it is not
   * unsaved work.
   */
  const [chosen, setChosen] = useState<WorkOrderListEntry | null>(null);
  const [reference, setReference] = useState('');
  const [refusal, setRefusal] = useState<ActionState>({ status: 'idle' });
  const formRef = useFocusFirstInvalid(refusal);
  const refused = refusal.status === 'invalid' ? refusal.fieldErrors?.['workOrderId'] : undefined;
  const error =
    refused === undefined || (canSearchWorkOrders && chosen !== null)
      ? undefined
      : translateDynamic(messages, refused);
  /*
   * With nothing to search — "All my branches" spanning companies, or no branch
   * chosen yet — the picker offers no box, so a refusal would have no control to
   * point at. The submit is disabled instead, described by the sentence the
   * picker shows in place of the box.
   */
  const scope = useWorkOrderSearchScope();
  const needsBranchId = useId();
  const blocked = canSearchWorkOrders && chosen === null && scope === null;
  const refuse = (key: string) =>
    setRefusal((previous) => ({
      status: 'invalid',
      fieldErrors: { workOrderId: key },
      attempt: (previous.attempt ?? 0) + 1,
    }));
  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSearchWorkOrders) {
          const typed = reference.trim();
          if (!REFERENCE.test(typed)) {
            refuse('inventory.workOrderReference.format');
            return;
          }
          router.push(`/${locale}/inventory/parts?workOrderId=${encodeURIComponent(typed)}`);
          return;
        }
        if (chosen === null) {
          refuse('workOrders.picker.required');
          return;
        }
        router.push(`/${locale}/inventory/parts?workOrderId=${encodeURIComponent(chosen.id)}`);
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
      {canSearchWorkOrders ? (
        <WorkOrderPicker
          messages={messages}
          label={translate(messages, 'inventory.parts.choose.workOrderId')}
          value={chosen}
          onChange={setChosen}
          error={error}
          canSearch
          needsBranchId={needsBranchId}
          offersBranchChooser
          material
        />
      ) : (
        <ReferenceBox
          label={translate(messages, 'inventory.workOrderReference.label')}
          help={translate(messages, 'inventory.parts.choose.referenceHelp')}
          value={reference}
          onChange={(next) => {
            setReference(next);
            setRefusal({ status: 'idle' });
          }}
          error={error}
          required
          countsAsUnsaved={false}
          testId="parts-work-order-reference"
        />
      )}
      <div>
        <Button
          type="submit"
          variant="contained"
          disabled={blocked}
          aria-describedby={blocked ? needsBranchId : undefined}
        >
          {translate(messages, 'inventory.parts.choose.submit')}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * The required parts of the order (wo.required-part-list)
 * ------------------------------------------------------------------ */

/**
 * The required parts of one work order (`wo.required-part-list`), or the
 * sentence that says why they could not be read. `null` reads nothing — the
 * caller holds no `wo.work_order.read`.
 */
function useRequiredParts(workOrderId: string | null): {
  readonly items: readonly RequiredPart[] | null;
  readonly refused: string | null;
} {
  const [answer, setAnswer] = useState<{
    readonly workOrderId: string;
    readonly items: readonly RequiredPart[] | null;
    readonly refused: string | null;
  } | null>(null);
  useEffect(() => {
    if (workOrderId === null) return;
    let live = true;
    void listRequiredParts(workOrderId).then((state) => {
      if (!live) return;
      if (state.status === 'ok') setAnswer({ workOrderId, items: state.data.items, refused: null });
      else
        setAnswer({
          workOrderId,
          items: null,
          refused:
            state.status === 'denied'
              ? 'inventory.parts.required.refused'
              : 'inventory.parts.required.unavailable',
        });
    });
    return () => {
      live = false;
    };
  }, [workOrderId]);
  if (answer === null || answer.workOrderId !== workOrderId) return { items: null, refused: null };
  return { items: answer.items, refused: answer.refused };
}

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
  /*
   * The answer, stamped with the attempt it answers, so "Try again" shows the
   * wait again rather than the old failure, and the wait is derived rather
   * than set inside the effect.
   */
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<{
    readonly attempt: number;
    readonly items: readonly RequiredPart[] | null;
    readonly failure: {
      readonly status: 'denied' | 'expired' | 'unavailable';
      readonly messageKey: keyof Messages;
      readonly correlationId: string | null;
    } | null;
  } | null>(null);
  useEffect(() => {
    let live = true;
    void listRequiredParts(workOrderId).then((state) => {
      if (!live) return;
      if (state.status === 'ok') {
        setAnswer({ attempt, items: state.data.items, failure: null });
        return;
      }
      const correlationId = state.correlationId ?? null;
      setAnswer({
        attempt,
        items: null,
        failure:
          state.status === 'denied'
            ? { status: 'denied', messageKey: 'inventory.parts.required.refused', correlationId }
            : state.status === 'expired'
              ? { status: 'expired', messageKey: 'state.expired.message', correlationId }
              : {
                  status: 'unavailable',
                  messageKey: 'inventory.parts.required.unavailable',
                  correlationId,
                },
      });
    });
    return () => {
      live = false;
    };
  }, [workOrderId, attempt]);
  const current = answer !== null && answer.attempt === attempt ? answer : null;

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
      {current === null ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : current.failure !== null ? (
        <MuiReadFailureState
          messages={messages}
          locale={locale}
          status={current.failure.status}
          correlationId={current.failure.correlationId}
          // A retry only where trying again can change the answer (S2).
          onRetry={
            current.failure.status === 'unavailable' ? () => setAttempt((n) => n + 1) : undefined
          }
          descriptionKey={current.failure.messageKey}
        />
      ) : current.items === null || current.items.length === 0 ? (
        <MuiEmptyState messages={messages} descriptionKey="inventory.parts.required.none" />
      ) : (
        <TableContainer>
          <Table size="small">
            <caption className="sr-only">
              {translate(messages, 'inventory.parts.required.caption')}
            </caption>
            <TableHead>
              <TableRow>
                <TableCell scope="col">
                  {translate(messages, 'inventory.parts.required.column.description')}
                </TableCell>
                <TableCell scope="col" align="right">
                  {translate(messages, 'inventory.parts.required.column.quantity')}
                </TableCell>
                <TableCell scope="col">
                  {translate(messages, 'inventory.parts.required.column.unit')}
                </TableCell>
                <TableCell scope="col">
                  {translate(messages, 'inventory.parts.required.column.item')}
                </TableCell>
                <TableCell scope="col">
                  {translate(messages, 'inventory.parts.required.column.actions')}
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {current.items.map((part) => (
                <TableRow key={part.id}>
                  <TableCell>
                    <bdi>{part.description}</bdi>
                  </TableCell>
                  <TableCell align="right">
                    <Qty value={part.quantity} />
                  </TableCell>
                  <TableCell>
                    <bdi>{part.unit}</bdi>
                  </TableCell>
                  <TableCell>
                    {part.reference ? (
                      <code className="font-mono text-caption" dir="ltr">
                        {part.reference}
                      </code>
                    ) : (
                      <span className="text-text-muted">
                        {translate(messages, 'inventory.parts.required.noItem')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {canOperate && part.reference ? (
                      <Button
                        type="button"
                        variant="outlined"
                        size="small"
                        onClick={() =>
                          onIssue({
                            itemId: part.reference as string,
                            itemLabel: part.description,
                            requiredPartRef: part.id,
                            quantity: part.quantity,
                          })
                        }
                      >
                        {translate(messages, 'inventory.parts.required.issueThis')}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * FE-011 — the issue form
 * ------------------------------------------------------------------ */

/**
 * Whether any text value of a draw form differs from what the form opened with.
 *
 * Compared trimmed, so a stray space is not a draw in progress. Every value on
 * these forms is a string — a quantity is a decimal string, a choice an id.
 */
function drawDiffers<Key extends string>(
  now: Readonly<Record<Key, string>>,
  opened: Readonly<Record<Key, string>>
): boolean {
  return (Object.keys(opened) as Key[]).some((key) => now[key].trim() !== opened[key].trim());
}

function IssueForm({
  locale,
  messages,
  workOrderId,
  requirement,
  summary,
  units,
  target,
  canReadBranches,
  canReadItems,
  canReadWorkOrder,
  prefill,
  onIssued,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  /** The requirement this draw is measured against. Without one there is nothing to submit. */
  readonly requirement: MaterialRequirement | null;
  /** The requirement in words, as its card showed it. */
  readonly summary: RequirementSummary | null;
  /** The units a refusal's figures are named in; null when not read. */
  readonly units: readonly NamedUnit[] | null;
  /** The work order's branch when it could be read; else taken from the operator. */
  readonly target: StockTarget | null;
  readonly canReadBranches: boolean;
  /** `inv.item.read` — the item is found in the catalogue, or given as a reference. */
  readonly canReadItems: boolean;
  /** `wo.work_order.read` — the required-part line is chosen from the job's list, or given as a reference. */
  readonly canReadWorkOrder: boolean;
  readonly prefill: IssuePrefill | null;
  readonly onIssued: (echo: IssueEcho) => void;
}) {
  const branches = useBranches((canReadBranches ?? false) && target === null);
  /*
   * The work order's own branch, or the one the operator is working in.
   *
   * The fallback used to start EMPTY and wait to be filled in — by hand, from
   * two free-text boxes. It starts at the working context's named selection
   * now, so a draw against a work order whose read was refused is still
   * addressed the moment the form opens, and the picker beside it is there to
   * CHANGE that choice rather than to make it (Owner directive,
   * `P1-32-PRE-OD-UX`).
   */
  const working = useBranchTarget();
  const [pair, setPair] = useState<BranchPair>(() =>
    working.kind === 'ready'
      ? { companyId: working.target.companyId, branchId: working.target.branchId }
      : EMPTY_PAIR
  );
  const pickedCompanyId = pair.companyId.trim();
  const pickedBranchId = pair.branchId.trim();
  const pickedIsComplete = pickedCompanyId.length > 0 && pickedBranchId.length > 0;
  // Memoised on the VALUES: a fresh object per render would re-key every
  // effect that reads it and re-read the locations without end.
  const chosen = useMemo<StockTarget | null>(
    () =>
      target ??
      (pickedIsComplete ? { companyId: pickedCompanyId, branchId: pickedBranchId } : null),
    [target, pickedIsComplete, pickedCompanyId, pickedBranchId]
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

  /*
   * The item the form opens on: the required part it was started from, or the
   * item the chosen requirement names. Shown by the words that row carries —
   * the part's description, or a sentence saying it is the requirement's item —
   * and never as the reference.
   */
  const [openedItem] = useState<ItemChoice | null>(() =>
    prefill
      ? { id: prefill.itemId, label: prefill.itemLabel }
      : requirement?.itemId
        ? {
            id: requirement.itemId,
            label: summary?.itemName ?? translate(messages, 'inventory.itemPicker.fromRequirement'),
          }
        : null
  );
  const [item, setItem] = useState<ItemChoice | null>(openedItem);
  const [openedForm] = useState(() => ({
    itemReference: openedItem?.id ?? '',
    locationId: '',
    quantity: prefill?.quantity ?? '',
    reservationId: '',
    requiredPartRef: prefill?.requiredPartRef ?? '',
  }));
  const [form, setForm] = useState(openedForm);
  const [openedPair] = useState(pair);
  /*
   * ANY choice the operator made is a draw in progress, so a branch switch
   * asks before it goes — the part, the location, the reservation, the linked
   * line and the branch as much as the quantity. Guarding the quantity alone let
   * a switch throw away a part and a location the operator had already found.
   * The confirmed discard needs no callback here: the form is keyed on the
   * working-context version, so the switch remounts it empty. Measured against
   * what it OPENED with, so a draw started from a requirement's row does not
   * ask until the operator has changed something.
   */
  useUnsavedGuard(
    drawDiffers(form, openedForm) ||
      (item?.id ?? null) !== (openedItem?.id ?? null) ||
      drawDiffers(pair, openedPair)
  );
  const requiredParts = useRequiredParts(canReadWorkOrder ? workOrderId : null);
  /*
   * The required part the form was started from ("Issue" on its row), for as
   * long as the operator has not chosen otherwise.
   *
   * While the job's list is still being read, or could not be read, the select
   * has nothing to show it in. It used to be treated as none chosen, so a draw
   * pressed in that moment went out UNLINKED without a word (route sweep B2
   * review). It is now kept, said in words beside a control that unlinks it, and
   * sent. Once the list answers, a line it holds is shown in the select; a line
   * it no longer holds is dropped, and the form says so rather than dropping it
   * silently.
   */
  const carried = prefill?.requiredPartRef ?? '';
  const holdsCarried = carried !== '' && canReadWorkOrder && form.requiredPartRef === carried;
  const carriedPending = holdsCarried && requiredParts.items === null;
  const carriedGone =
    holdsCarried &&
    requiredParts.items !== null &&
    !requiredParts.items.some((part) => part.id === carried);
  /*
   * Otherwise a line the list in hand cannot contain is treated as none chosen,
   * so the form never sends a line the control is not showing.
   */
  const chosenRequiredPart = carriedPending
    ? carried
    : canReadWorkOrder &&
        (requiredParts.items === null ||
          !requiredParts.items.some((part) => part.id === form.requiredPartRef))
      ? ''
      : form.requiredPartRef;
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [refusals, setRefusals] = useState(0);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  // One issue in flight at a time, before `busy` has disabled the button.
  const sending = useRef(false);
  const formRef = useFocusFirstInvalid(refusalState(errors, refusals, outcome));
  const headingRef = useFocusOnOpen<HTMLHeadingElement>();

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    if (sending.current) return;
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
    const itemId = canReadItems ? (item?.id ?? '') : form.itemReference.trim();
    if (canReadItems && item === null) found['itemId'] = 'inventory.itemPicker.required';
    if (!canReadItems && !REFERENCE.test(itemId)) {
      found['itemId'] = 'inventory.itemPicker.referenceFormat';
    }
    if (!form.locationId) found['locationId'] = 'field.required';
    const quantity = form.quantity.trim();
    if (!QUANTITY.test(quantity) || /^0+(?:\.0+)?$/.test(quantity)) {
      found['quantity'] = 'inventory.reserve.quantityFormat';
    }
    const requiredPartRef = chosenRequiredPart.trim();
    if (!canReadWorkOrder && requiredPartRef.length > 0 && !REFERENCE.test(requiredPartRef)) {
      found['requiredPartRef'] = 'inventory.parts.requiredPartReference.format';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setRefusals((n) => n + 1);
      return;
    }

    sending.current = true;
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
    sending.current = false;
    setBusy(false);
    const state = withUnitNamed(result.state, messages, units);
    setOutcome(state);
    notifyActionResult(state, messages);
    if (result.state.status === 'success' && result.created) {
      setOutcome(null);
      onIssued(result.created);
    }
  };

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="parts-issue-heading"
      className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2"
    >
      <h2
        ref={headingRef}
        id="parts-issue-heading"
        tabIndex={-1}
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
          summary={summary}
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
      <FormSelectField
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
        onChange={(id) => {
          const reservation = reservations?.find((row) => row.id === id);
          if (reservation) {
            // The reservation names the item by its stock code, which is what the
            // choice then says.
            setItem({ id: reservation.itemId, label: reservation.sku });
            setErrors((current) => withoutKey(current, 'itemId'));
          }
          setForm((f) =>
            reservation
              ? {
                  ...f,
                  reservationId: id,
                  itemReference: reservation.itemId,
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
      <div className="sm:col-span-2">
        {canReadItems ? (
          <ItemPicker
            messages={messages}
            locale={locale}
            label={translate(messages, 'inventory.issue.item')}
            value={item}
            onChange={(next) => {
              setItem(next);
              setErrors((current) => withoutKey(current, 'itemId'));
            }}
            canSearch
            error={errorFor('itemId')}
            pristineId={openedItem?.id ?? null}
            testId="issue-item-picker"
          />
        ) : (
          <ReferenceBox
            label={translate(messages, 'inventory.itemPicker.reference')}
            help={translate(messages, 'inventory.itemPicker.referenceHelp')}
            value={form.itemReference}
            onChange={(next) => {
              setForm((f) => ({ ...f, itemReference: next }));
              setErrors((current) => withoutKey(current, 'itemId'));
            }}
            error={errorFor('itemId')}
            required
            countsAsUnsaved
            pristine={openedItem?.id ?? ''}
            testId="issue-item-reference"
          />
        )}
      </div>
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
      <FormNumberField
        label={translate(messages, 'inventory.issue.quantity')}
        description={translate(messages, 'inventory.reserve.quantityHelp')}
        required
        value={form.quantity}
        onChange={(next) => setForm((f) => ({ ...f, quantity: next }))}
        error={errorFor('quantity')}
      />
      {carriedPending ? (
        <div
          role="group"
          aria-labelledby="issue-required-part-carried"
          className="flex flex-col gap-1.5"
        >
          <span
            id="issue-required-part-carried"
            className="text-label font-medium text-text-primary"
          >
            {translate(messages, 'inventory.issue.requiredPart')}
          </span>
          <p role="status" className="text-supporting text-text-secondary">
            {translateWithValues(messages, 'inventory.issue.requiredPartCarried', {
              part: prefill?.itemLabel ?? '',
            })}
            {requiredParts.refused ? (
              <> {translateDynamic(messages, requiredParts.refused)}</>
            ) : null}
          </p>
          <div>
            <Button
              type="button"
              variant="outlined"
              size="small"
              onClick={() => setForm((f) => ({ ...f, requiredPartRef: '' }))}
            >
              {translate(messages, 'inventory.issue.requiredPartUnlink')}
            </Button>
          </div>
        </div>
      ) : canReadWorkOrder ? (
        <div className="flex flex-col gap-1.5">
          <FormSelectField
            label={translate(messages, 'inventory.issue.requiredPart')}
            description={
              requiredParts.refused
                ? translateDynamic(messages, requiredParts.refused)
                : translate(messages, 'inventory.issue.requiredPartHelp')
            }
            value={chosenRequiredPart}
            onChange={(next) => setForm((f) => ({ ...f, requiredPartRef: next }))}
            options={(requiredParts.items ?? []).map((part) => ({
              value: part.id,
              label: `${part.description} — ${part.quantity} ${part.unit}`,
            }))}
            placeholder={translate(messages, 'inventory.issue.noRequiredPart')}
            error={errorFor('requiredPartRef')}
          />
          {carriedGone ? (
            <p role="status" className="text-supporting text-text-secondary">
              {translate(messages, 'inventory.issue.requiredPartGone')}
            </p>
          ) : null}
        </div>
      ) : (
        <ReferenceBox
          label={translate(messages, 'inventory.parts.requiredPartReference.label')}
          help={translate(messages, 'inventory.parts.requiredPartReference.help')}
          value={form.requiredPartRef}
          onChange={(next) => {
            setForm((f) => ({ ...f, requiredPartRef: next }));
            setErrors((current) => withoutKey(current, 'requiredPartRef'));
          }}
          error={errorFor('requiredPartRef')}
          countsAsUnsaved
          pristine={prefill?.requiredPartRef ?? ''}
          testId="issue-required-part-reference"
        />
      )}
      <div className="sm:col-span-2">
        <OutcomeNote messages={messages} outcome={outcome} />
      </div>
      <div className="sm:col-span-2">
        <Button
          type="submit"
          variant="contained"
          /*
           * `target === null` is not redundant defence. This is the part-ISSUE
           * submit, not a branch submit, and the picker is mounted only while
           * the target is unknown. Writing the condition out keeps the guard
           * about the pair by construction rather than by an accident of the
           * conjunction `useBranches((canReadBranches ?? false) && target === null)`, so a
           * permitted operator whose branch list came back EMPTY can still
           * issue a part.
           */
          disabled={busy || requirement === null || (target === null && !canNameBranch(branches))}
        >
          {translate(messages, 'inventory.issue.submit')}
        </Button>
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
  summary,
  error,
}: {
  readonly messages: Messages;
  readonly requirement: MaterialRequirement | null;
  /** The requirement in words (LANG-identifiers); its identifier is never shown. */
  readonly summary: RequirementSummary | null;
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
      <p className="text-caption text-text-muted" data-testid="parts-chosen-requirement">
        {summary === null ? (
          translate(messages, 'inventory.parts.draw.usingRequirement')
        ) : (
          <>
            {translate(messages, 'inventory.parts.draw.usingRequirementFor')}{' '}
            <bdi>{summary.what}</bdi>
          </>
        )}
        {' · '}
        {translate(messages, 'inventory.material.allowance.remaining')}{' '}
        {requirement.remainingQuantity === null ? (
          translate(messages, 'inventory.material.allowance.unset')
        ) : (
          <>
            <Qty value={requirement.remainingQuantity} />
            {summary?.unit ? (
              <>
                {' '}
                <bdi>{summary.unit}</bdi>
              </>
            ) : null}
          </>
        )}
      </p>
      {refusal}
    </>
  );
}

/**
 * A refused draw's figures name their unit by code (`ERR-INV-001`, CC-OD-32),
 * inside a sentence read in the operator's language, so the unit is named the
 * same way (P1-32-PRE-OD-INVF, UNIT-names) — from the unit list, and left as
 * the code when the list does not name it. Nothing else in the state changes.
 */
function withUnitNamed(
  state: ActionState,
  messages: Messages,
  units: readonly NamedUnit[] | null
): ActionState {
  const code = state.messageValues?.['unit'];
  if (code === undefined) return state;
  return {
    ...state,
    messageValues: { ...state.messageValues, unit: unitNameByCode(messages, code, units) },
  };
}

/**
 * Reserve stock for this work order, against the chosen requirement.
 *
 * `idempotencyKey` is one key per opened form, kept across a refusal, so
 * pressing Reserve again answers the reservation already made rather than
 * making a second one.
 */
function ReserveForm({
  locale,
  messages,
  workOrderId,
  requirement,
  summary,
  units,
  target,
  canReadBranches,
  canReadItems,
  onReserved,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  readonly requirement: MaterialRequirement | null;
  /** The requirement in words, as its card showed it. */
  readonly summary: RequirementSummary | null;
  /** The units a refusal's figures are named in; null when not read. */
  readonly units: readonly NamedUnit[] | null;
  readonly target: StockTarget | null;
  readonly canReadBranches: boolean;
  /** `inv.item.read` — the item is found in the catalogue, or given as a reference. */
  readonly canReadItems: boolean;
  readonly onReserved: (echo: ReservationEcho) => void;
}) {
  const branches = useBranches((canReadBranches ?? false) && target === null);
  const [pair, setPair] = useState<BranchPair>(EMPTY_PAIR);
  const typedCompanyId = pair.companyId.trim();
  const typedBranchId = pair.branchId.trim();
  const typedIsValid = UUID.test(typedCompanyId) && UUID.test(typedBranchId);
  const chosen = useMemo<StockTarget | null>(
    () => target ?? (typedIsValid ? { companyId: typedCompanyId, branchId: typedBranchId } : null),
    [target, typedIsValid, typedCompanyId, typedBranchId]
  );
  const locations = useLocations(chosen);
  // The item the chosen requirement names, said as that rather than as its reference.
  const [openedItem] = useState<ItemChoice | null>(() =>
    requirement?.itemId
      ? {
          id: requirement.itemId,
          label: summary?.itemName ?? translate(messages, 'inventory.itemPicker.fromRequirement'),
        }
      : null
  );
  const [item, setItem] = useState<ItemChoice | null>(openedItem);
  const [openedForm] = useState(() => ({
    itemReference: openedItem?.id ?? '',
    locationId: '',
    quantity: '',
  }));
  const [form, setForm] = useState(openedForm);
  // As in the issue form: ANY choice made — part, location, quantity or branch —
  // asks before a switch, and the version key on this form is what empties it
  // once the operator confirms.
  useUnsavedGuard(
    drawDiffers(form, openedForm) ||
      (item?.id ?? null) !== (openedItem?.id ?? null) ||
      drawDiffers(pair, EMPTY_PAIR)
  );
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [refusals, setRefusals] = useState(0);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const [attemptKey] = useState(() => crypto.randomUUID());
  // One reservation in flight at a time, before `busy` has disabled the button.
  const sending = useRef(false);
  const formRef = useFocusFirstInvalid(refusalState(errors, refusals, outcome));
  const headingRef = useFocusOnOpen<HTMLHeadingElement>();

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    if (sending.current) return;
    if (requirement === null) {
      setErrors({ materialRequirementId: 'inventory.parts.draw.needRequirement' });
      return;
    }
    const found: Record<string, string> = {};
    if (target === null) {
      if (!UUID.test(typedCompanyId)) found['companyId'] = 'inventory.common.idFormat';
      if (!UUID.test(typedBranchId)) found['branchId'] = 'inventory.common.idFormat';
    }
    const itemId = canReadItems ? (item?.id ?? '') : form.itemReference.trim();
    if (canReadItems && item === null) found['itemId'] = 'inventory.itemPicker.required';
    if (!canReadItems && !REFERENCE.test(itemId)) {
      found['itemId'] = 'inventory.itemPicker.referenceFormat';
    }
    if (!form.locationId) found['locationId'] = 'field.required';
    const quantity = form.quantity.trim();
    if (!QUANTITY.test(quantity) || /^0+(?:\.0+)?$/.test(quantity)) {
      found['quantity'] = 'inventory.reserve.quantityFormat';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setRefusals((n) => n + 1);
      return;
    }

    sending.current = true;
    setBusy(true);
    const result = await createReservation({
      itemId,
      locationId: form.locationId,
      quantity,
      workOrderId,
      materialRequirementId: requirement.id,
      idempotencyKey: attemptKey,
    });
    sending.current = false;
    setBusy(false);
    const state = withUnitNamed(result.state, messages, units);
    setOutcome(state);
    notifyActionResult(state, messages);
    if (result.state.status === 'success' && result.created) {
      setOutcome(null);
      onReserved(result.created);
    }
  };

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="parts-reserve-heading"
      className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2"
    >
      <h2
        ref={headingRef}
        id="parts-reserve-heading"
        tabIndex={-1}
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
          summary={summary}
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
      <div className="sm:col-span-2">
        {canReadItems ? (
          <ItemPicker
            messages={messages}
            locale={locale}
            label={translate(messages, 'inventory.reserve.item')}
            value={item}
            onChange={(next) => {
              setItem(next);
              setErrors((current) => withoutKey(current, 'itemId'));
            }}
            canSearch
            error={errorFor('itemId')}
            pristineId={openedItem?.id ?? null}
            testId="parts-reserve-item-picker"
          />
        ) : (
          <ReferenceBox
            label={translate(messages, 'inventory.itemPicker.reference')}
            help={translate(messages, 'inventory.itemPicker.referenceHelp')}
            value={form.itemReference}
            onChange={(next) => {
              setForm((f) => ({ ...f, itemReference: next }));
              setErrors((current) => withoutKey(current, 'itemId'));
            }}
            error={errorFor('itemId')}
            required
            countsAsUnsaved
            pristine={openedItem?.id ?? ''}
            testId="parts-reserve-item-reference"
          />
        )}
      </div>
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
      <FormNumberField
        label={translate(messages, 'inventory.reserve.quantity')}
        description={translate(messages, 'inventory.reserve.quantityHelp')}
        required
        value={form.quantity}
        onChange={(next) => setForm((f) => ({ ...f, quantity: next }))}
        error={errorFor('quantity')}
      />
      <div className="sm:col-span-2">
        <OutcomeNote messages={messages} outcome={outcome} />
      </div>
      <div className="sm:col-span-2">
        <Button
          type="submit"
          variant="contained"
          disabled={busy || requirement === null || (target === null && !canNameBranch(branches))}
        >
          {translate(messages, 'inventory.parts.reserve.submit')}
        </Button>
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
  // One settlement or withdrawal in flight at a time, before `busy` has disabled both.
  const sending = useRef(false);
  // A typed reason is work the operator would lose; a confirmed discard clears it.
  useUnsavedGuard(reason.trim().length > 0, () => {
    setReason('');
    setError(undefined);
  });

  const run = async (act: () => Promise<{ readonly state: ActionState }>) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    const result = await act();
    sending.current = false;
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
      <FormTextField
        label={translate(messages, 'inventory.parts.request.reason')}
        description={translate(messages, 'inventory.parts.request.reasonHelp')}
        value={reason}
        onChange={setReason}
        error={error}
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outlined"
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
        </Button>
        <Button
          type="button"
          variant="outlined"
          color="error"
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
        </Button>
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
  target,
  canOperate,
  onReturned,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  /** The work order's branch, whose clock each issue's moment is written on; UTC when unknown. */
  readonly target: StockTarget | null;
  readonly canOperate: boolean;
  readonly onReturned: (echo: ReturnEcho) => void;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) => listPartIssues(workOrderId, request, cursor),
    [workOrderId]
  );
  const table = useServerTable<PartIssue>(load, { initial: INITIAL_REQUEST });
  const [returning, setReturning] = useState<PartIssue | null>(null);
  const zone = useStockDisplayZone(target);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  /*
   * The return form opens from a row of the grid, whose buttons the grid owns;
   * when the form closes, the cursor goes back to this panel's heading — the
   * nearest place it can be returned to — unless the operator has moved it.
   */
  const wasReturning = useRef(false);
  useEffect(() => {
    const open = returning !== null;
    if (wasReturning.current && !open) {
      const now = document.activeElement;
      if (now === null || now === document.body) headingRef.current?.focus();
    }
    wasReturning.current = open;
  }, [returning]);

  const columns = useMemo<readonly OperationalColumn<PartIssue>[]>(
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
        cell: (row) => <StockMoment value={row.issuedAt} locale={locale} zone={zone} />,
      },
    ],
    [locale, messages, zone]
  );

  /*
   * Return is the row's action, offered only to an operator who may. Its name
   * carries the stock code, so ten rows of "Return" are ten different controls
   * to a screen reader, and it is pressed on the row whose form is open.
   */
  const rowActions = (row: PartIssue): readonly RowAction[] =>
    canOperate
      ? [
          {
            kind: 'button',
            label: translate(messages, 'inventory.return.action'),
            about: row.sku,
            pressed: returning?.id === row.id,
            onClick: () => setReturning((current) => (current?.id === row.id ? null : row)),
          },
        ]
      : [];

  return (
    <section
      aria-labelledby="parts-issues-heading"
      className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2
        ref={headingRef}
        id="parts-issues-heading"
        tabIndex={-1}
        className="text-body font-medium text-text-primary"
      >
        {translate(messages, 'inventory.parts.issues.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.parts.issues.explain')}
      </p>
      <OperationalGrid<PartIssue>
        messages={messages}
        locale={locale}
        label={translate(messages, 'inventory.parts.issues.caption')}
        columns={columns}
        rowId={(row) => row.id}
        table={table}
        rowActions={rowActions}
        suppressEmptyState
        testId="parts-issues-grid"
      />
      {table.status === 'idle' && table.response && table.response.rows.length === 0 ? (
        <MuiEmptyState messages={messages} descriptionKey="inventory.parts.issues.none" />
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
          onDiscard={() => setReturning(null)}
        />
      ) : null}
    </section>
  );
}

function ReturnForm({
  messages,
  issue,
  onReturned,
  onDiscard,
}: {
  readonly messages: Messages;
  readonly issue: PartIssue;
  readonly onReturned: (echo: ReturnEcho) => void;
  /** A confirmed "discard" (a branch switch, leaving the page) closes the form. */
  readonly onDiscard: () => void;
}) {
  const [form, setForm] = useState({ quantity: '', reason: '' });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [refusals, setRefusals] = useState(0);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  // One return in flight at a time, before `busy` has disabled the button.
  const sending = useRef(false);
  // A half-typed return is work the operator would lose; a confirmed discard closes it.
  useUnsavedGuard(form.quantity.trim().length > 0 || form.reason.trim().length > 0, onDiscard);
  const formRef = useFocusFirstInvalid(refusalState(errors, refusals, outcome));
  const headingRef = useFocusOnOpen<HTMLHeadingElement>();

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    if (sending.current) return;
    const found: Record<string, string> = {};
    const quantity = form.quantity.trim();
    if (!QUANTITY.test(quantity) || /^0+(?:\.0+)?$/.test(quantity)) {
      found['quantity'] = 'inventory.reserve.quantityFormat';
    }
    const reason = form.reason.trim();
    if (reason.length > MAX_REASON) found['reason'] = 'inventory.return.reasonTooLong';
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setRefusals((n) => n + 1);
      return;
    }

    sending.current = true;
    setBusy(true);
    const result = await createReturn({
      partIssueId: issue.id,
      quantity,
      ...(reason ? { reason } : {}),
    });
    sending.current = false;
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
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="parts-return-heading"
      className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2"
    >
      <h3
        ref={headingRef}
        id="parts-return-heading"
        tabIndex={-1}
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
      <FormNumberField
        label={translate(messages, 'inventory.return.quantity')}
        description={translate(messages, 'inventory.reserve.quantityHelp')}
        required
        value={form.quantity}
        onChange={(next) => setForm((f) => ({ ...f, quantity: next }))}
        error={errorFor('quantity')}
      />
      <FormTextField
        label={translate(messages, 'inventory.return.reason')}
        description={translate(messages, 'inventory.return.reasonHelp')}
        value={form.reason}
        onChange={(next) => setForm((f) => ({ ...f, reason: next }))}
        error={errorFor('reason')}
      />
      <div className="sm:col-span-2">
        <OutcomeNote messages={messages} outcome={outcome} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" variant="contained" disabled={busy}>
          {translate(messages, 'inventory.return.submit')}
        </Button>
      </div>
    </form>
  );
}
