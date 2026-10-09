'use client';

/**
 * The material a work order may consume, per service line (P1-32).
 *
 * ## What a requirement is
 *
 * A requirement says how much of one item — or one item family — a single
 * service line of this work order is allowed to draw, in one stated unit. It is
 * the thing a reservation and an issue are measured against: without one, the
 * server refuses the draw, and the absence of a requirement is never read as an
 * unlimited one.
 *
 * ## Nothing here is guessed
 *
 * A requirement is asked for in one of two ways, and the screen offers no third.
 * Either the server DERIVES the allowance from the confirmed vehicle
 * specification for this work order vehicle — and then the row names the
 * specification it matched and the source that specification was read from — or
 * the operator ENTERS a value and says where they read it. The entered quantity
 * field starts EMPTY and is never prefilled from a capacity nobody stated; the
 * source is required beside it, because a capacity with no source is a guess
 * wearing a number.
 *
 * Before anything is sent, the form shows the confirmed specifications on file
 * for the service kind being asked about, each with its unit and the source it
 * was read from, so the operator can see what is able to answer instead of
 * learning it only from the created row. It is a display and nothing else: no
 * figure from it is copied into a field, and the panel names no winner, because
 * the vehicle the server matches against is not held by this screen.
 *
 * When no confirmed specification answers for the vehicle, the server does not
 * refuse, return zero, or invent a default: it stores the requirement as
 * `approval_required` naming the fact that is missing. The row says which fact
 * and what closes it.
 *
 * ## Two people, and the one the screen cannot hide from
 *
 * The person who asked may not decide. The panel hides the decision from them
 * and says why, which is a courtesy; the service and a database constraint
 * refuse them whatever codes they hold, which is the rule. Both exist, and the
 * refusal is rendered in the operator language if it ever arrives — a hidden
 * control is not a guarantee.
 *
 * ## Every figure is the server
 *
 * The allowance, the approved exceptions, what is committed and what remains are
 * exact decimal strings in the requirement unit, published by the server. This
 * file subtracts nothing: a remainder computed here would be a second answer to
 * a question the server already answered, and would disagree with it the moment
 * a draw landed between the read and the render.
 *
 * ## On Material UI (ADR-022, `P1-32-PRE-OD-INV5`)
 *
 * Every control the panel draws is a shared wrapper: the fields are `forms/mui`
 * (each quantity `FormNumberField`, so the string typed is the string sent),
 * every button is Material's, and the list's wait, empty answer and failures
 * are the shared states in the panel's own sentences. The item family is
 * CHOSEN from the whole category tree (`CategoryTreePicker`) rather than typed
 * as a reference, and a requirement that names a family says the family's
 * path and code rather than its identifier. Without `inv.item.read` the
 * categories cannot be read, so the typed reference stays, exactly as before.
 *
 * Each write is held to one at a time by a ref set before anything is awaited;
 * a half-filled form is unsaved work; a form that opens takes the cursor and
 * gives it back to the button that opened it when it closes.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Button from '@mui/material/Button';

import { FormNumberField } from '@/components/forms/mui/FormNumberField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiEmptyState, MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';
import { unitNameByCode, unitNameById, unitOptions, type NamedUnit } from '@/lib/unit-name';
import { listServiceLines } from '@/features/work-orders/api';
import type { WorkOrderServiceLine } from '@/features/work-orders/work-orders-contract';

import {
  cancelMaterialRequirement,
  createMaterialRequirement,
  decideMaterialException,
  decideMaterialRequirement,
  listMaterialRequirements,
  listUnitsOfMeasure,
  listVehicleSpecifications,
  readMaterialRequirement,
  recheckMaterialRequirement,
  requestMaterialException,
} from '../api';
import {
  MAX_REASON,
  MAX_SOURCE_REFERENCE,
  QUANTITY,
  SERVICE_CONDITION,
  type MaterialException,
  type MaterialRequirement,
  type InventoryItem,
  type MaterialRequirementCreateBody,
  type StockTarget,
  type UnitOfMeasureOption,
  type VehicleSpecification,
} from '../inventory-contract';
import { CategoryTreePicker } from './CategoryTreePicker';
import { pathText, useAllItemCategories, type CategoryList } from './CategoryTree';
import { useItemNames, useServiceLineNames, type NameAnswer } from './requirement-names';
import { OutcomeNote, Qty, UUID } from './shared';
import {
  ItemFinder,
  PANEL,
  isQuantity,
  refusalState,
  useFocusOnOpen,
  useReturnFocus,
} from './stock-operations';
import { useUnitList } from './unit-list';

/**
 * What the draw forms say about the chosen requirement, in words rather than its
 * identifier (P1-32-PRE-OD-INVF, LANG-identifiers). Taken from what the card
 * showed when it was chosen.
 */
export interface RequirementSummary {
  /** The part, the part group, or the sentence saying it cannot be named here. */
  readonly what: string;
  /** The part's own name when one was read; null for a group or a name not read. */
  readonly itemName: string | null;
  /** The requirement unit in the reader's language; null when it cannot be named. */
  readonly unit: string | null;
}

/** The requirement list as one of four outcomes; an empty branch and a refusal differ. */
type Listing =
  | { readonly phase: 'loading' }
  | { readonly phase: 'listed'; readonly rows: readonly MaterialRequirement[] }
  | {
      readonly phase: 'failed';
      readonly status: 'denied' | 'expired' | 'unavailable';
      readonly messageKey: keyof Messages;
      readonly correlationId: string | null;
    };

/** A read that did not answer, as the shared state's status and the panel's own sentence. */
function failureOf(state: { readonly status: string; readonly correlationId?: string | null }): {
  readonly status: 'denied' | 'expired' | 'unavailable';
  readonly messageKey: keyof Messages;
  readonly correlationId: string | null;
} {
  const correlationId = state.correlationId ?? null;
  if (state.status === 'denied') {
    return { status: 'denied', messageKey: 'inventory.material.refused', correlationId };
  }
  if (state.status === 'expired') {
    return { status: 'expired', messageKey: 'state.expired.message', correlationId };
  }
  return { status: 'unavailable', messageKey: 'inventory.material.unavailable', correlationId };
}

/**
 * The confirmed capacities on file for the service kind being asked about.
 *
 * This is shown BEFORE the request is sent, so the operator can see the
 * capacities that can answer for this vehicle and where each was read from,
 * rather than discovering the match only on the created row. It fills nothing
 * in: the amount is never copied into a field from here, and the vehicle of
 * this job — which this screen does not hold — is what the server matches
 * against, so the panel states the candidates and never names a winner.
 */
type MatchState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'loading' }
  | { readonly phase: 'listed'; readonly rows: readonly VehicleSpecification[] }
  | { readonly phase: 'failed'; readonly messageKey: string };

/** Which per-row form is open, if any. */
type OpenForm =
  | { readonly kind: 'none' }
  | { readonly kind: 'reject'; readonly id: string }
  | { readonly kind: 'cancel'; readonly id: string }
  | { readonly kind: 'exception'; readonly id: string };

export function MaterialRequirementsPanel({
  locale,
  messages,
  workOrderId,
  target,
  currentUserId,
  canRequest,
  canApprove,
  canDecideException,
  canReadWorkOrder,
  canReadItems,
  chosenId,
  onChoose,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  /** The work order branch. The list is branch-targeted and is not requested without it. */
  readonly target: StockTarget | null;
  /** `wo.work_order.read` — whether the service lines are offered as a picker. */
  readonly canReadWorkOrder: boolean;
  /**
   * `inv.item.read` — whether the item categories can be read, so a family is
   * chosen from the tree and named by its path. Without it the family stays a
   * typed reference, and a listed family is shown by its reference.
   */
  readonly canReadItems: boolean;
  /** The signed-in person, so the panel can say why they cannot decide their own request. */
  readonly currentUserId: string;
  /** `inv.material.request` — asking, re-checking, withdrawing, asking for an exception. */
  readonly canRequest: boolean;
  /** `inv.material.approve` — deciding a requirement someone else asked for. */
  readonly canApprove: boolean;
  /** `inv.material.exception.approve` — deciding an exception. */
  readonly canDecideException: boolean;
  /** The requirement a draw will be measured against, chosen here. */
  readonly chosenId: string | null;
  readonly onChoose: (requirement: MaterialRequirement, summary: RequirementSummary) => void;
  /** A write landed: the parts screen re-reads what depends on it. */
  readonly onChanged: () => void;
}) {
  const [listing, setListing] = useState<Listing>({ phase: 'loading' });
  /*
   * The words each row is shown by (LANG-identifiers): the service line's
   * description, the part's name and the unit's name, each read only when the
   * operator may read it and a row needs it.
   */
  const rows = listing.phase === 'listed' ? listing.rows : null;
  const units = useUnitList(canReadItems && rows !== null && rows.length > 0);
  const serviceLineName = useServiceLineNames(
    workOrderId,
    canReadWorkOrder && rows !== null && rows.length > 0
  );
  const itemIds = useMemo(
    () => (rows ?? []).flatMap((row) => (row.itemId === null ? [] : [row.itemId])),
    [rows]
  );
  const itemName = useItemNames(itemIds, canReadItems);
  const [epoch, setEpoch] = useState(0);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<OpenForm>({ kind: 'none' });
  const addRef = useReturnFocus<HTMLButtonElement>(adding);
  /*
   * The whole category tree, read once for the panel and only when something
   * on it needs a category: a listed requirement that names a family, or the
   * form that asks for one. Without `inv.item.read` it is never read.
   */
  const namesFamily =
    listing.phase === 'listed' && listing.rows.some((row) => row.itemCategoryId !== null);
  const categories = useAllItemCategories(canReadItems && (adding || namesFamily));
  const categoryList = canReadItems ? categories : null;

  const reload = useCallback(() => setEpoch((n) => n + 1), []);

  useEffect(() => {
    if (target === null) return;
    let live = true;
    void listMaterialRequirements(target, { workOrderId }).then((state) => {
      if (!live) return;
      if (state.status === 'ok') setListing({ phase: 'listed', rows: state.data.items });
      else setListing({ phase: 'failed', ...failureOf(state) });
    });
    return () => {
      live = false;
    };
  }, [target, workOrderId, epoch]);

  const afterWrite = () => {
    setOpen({ kind: 'none' });
    setAdding(false);
    reload();
    onChanged();
  };

  return (
    <section aria-labelledby="parts-material-heading" className={PANEL} lang={locale}>
      <h2 id="parts-material-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.material.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.material.explain')}
      </p>

      {target === null ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'inventory.material.needBranch')}
        </p>
      ) : (
        <>
          {canRequest ? (
            <div>
              <Button
                ref={addRef}
                type="button"
                variant="outlined"
                aria-expanded={adding}
                onClick={() => setAdding((was) => !was)}
              >
                {translate(messages, 'inventory.material.create.open')}
              </Button>
            </div>
          ) : null}

          {canRequest && adding ? (
            <CreateRequirementForm
              messages={messages}
              workOrderId={workOrderId}
              canReadWorkOrder={canReadWorkOrder}
              categories={categoryList}
              onCreated={afterWrite}
              onDiscard={() => setAdding(false)}
            />
          ) : null}

          {listing.phase === 'loading' ? (
            <MuiLoadingState messages={messages} variant="inline" />
          ) : listing.phase === 'failed' ? (
            <MuiReadFailureState
              messages={messages}
              locale={locale}
              status={listing.status}
              correlationId={listing.correlationId}
              // A retry only where trying again can change the answer (S2).
              onRetry={listing.status === 'unavailable' ? reload : undefined}
              descriptionKey={listing.messageKey}
            />
          ) : listing.rows.length === 0 ? (
            <MuiEmptyState messages={messages} descriptionKey="inventory.material.none" />
          ) : (
            <ul className="flex flex-col gap-3">
              {listing.rows.map((row) => (
                <li key={row.id}>
                  <RequirementCard
                    locale={locale}
                    messages={messages}
                    requirement={row}
                    categories={categoryList}
                    serviceLine={serviceLineName(row.serviceLineId)}
                    item={row.itemId === null ? null : itemName(row.itemId)}
                    units={units}
                    currentUserId={currentUserId}
                    canRequest={canRequest}
                    canApprove={canApprove}
                    canDecideException={canDecideException}
                    chosen={chosenId === row.id}
                    open={open}
                    onOpen={setOpen}
                    onChoose={onChoose}
                    onChanged={afterWrite}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * One requirement
 * ------------------------------------------------------------------ */

function RequirementCard({
  locale,
  messages,
  requirement,
  categories,
  serviceLine,
  item,
  units,
  currentUserId,
  canRequest,
  canApprove,
  canDecideException,
  chosen,
  open,
  onOpen,
  onChoose,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly requirement: MaterialRequirement;
  /** The category tree, or `null` without `inv.item.read`. */
  readonly categories: CategoryList | null;
  /** The service line's description, as far as it could be read. */
  readonly serviceLine: NameAnswer;
  /** The part's name, as far as it could be read; null when the requirement names a group or none. */
  readonly item: NameAnswer | null;
  /** The units the requirement unit is named from; null until read or without `inv.item.read`. */
  readonly units: readonly NamedUnit[] | null;
  readonly currentUserId: string;
  readonly canRequest: boolean;
  readonly canApprove: boolean;
  readonly canDecideException: boolean;
  readonly chosen: boolean;
  readonly open: OpenForm;
  readonly onOpen: (next: OpenForm) => void;
  readonly onChoose: (requirement: MaterialRequirement, summary: RequirementSummary) => void;
  readonly onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  // One decision or re-check in flight at a time, before `busy` has disabled the buttons.
  const sending = useRef(false);
  const ownRequest = requirement.requestedBy === currentUserId;
  const decidable = requirement.status === 'pending_approval';
  const isOpen = (kind: OpenForm['kind']) =>
    open.kind === kind && open.kind !== 'none' && open.id === requirement.id;
  const rejectRef = useReturnFocus<HTMLButtonElement>(isOpen('reject'));
  const exceptionRef = useReturnFocus<HTMLButtonElement>(isOpen('exception'));
  const cancelRef = useReturnFocus<HTMLButtonElement>(isOpen('cancel'));

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
      onChanged();
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3" lang={locale}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-body font-medium text-text-primary">
          {translateDynamic(messages, `inventory.material.status.${requirement.status}`)}
        </span>
        <span className="text-caption text-text-muted">
          {translateDynamic(messages, `inventory.material.basis.${requirement.basis}`)}
        </span>
        {chosen ? (
          <span className="text-caption text-primary">
            {translate(messages, 'inventory.material.chosen')}
          </span>
        ) : null}
      </div>

      <dl className="grid gap-2 sm:grid-cols-2">
        <Fact label={translate(messages, 'inventory.material.serviceLine')}>
          <span data-testid="material-service-line">
            <NamedValue
              messages={messages}
              answer={serviceLine}
              unavailableKey="inventory.material.serviceLineUnavailable"
            />
          </span>
        </Fact>
        <Fact label={translate(messages, 'inventory.material.item')}>
          {item !== null ? (
            <span data-testid="material-item">
              <NamedValue
                messages={messages}
                answer={item}
                unavailableKey="inventory.material.itemUnavailable"
              />
            </span>
          ) : requirement.itemCategoryId ? (
            <span>
              {translate(messages, 'inventory.material.itemFamily')}{' '}
              <CategoryName
                messages={messages}
                categories={categories}
                categoryId={requirement.itemCategoryId}
              />
            </span>
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'inventory.material.noItem')}
            </span>
          )}
        </Fact>
        <Fact label={translate(messages, 'inventory.material.source')} wide>
          <RequirementSource messages={messages} requirement={requirement} />
        </Fact>
      </dl>

      <AllowanceBar messages={messages} requirement={requirement} />

      {requirement.approvalRequiredReason ? (
        <p role="status" className="text-body text-text-secondary">
          {translateDynamic(
            messages,
            `inventory.material.blocked.${requirement.approvalRequiredReason}`
          )}
        </p>
      ) : null}

      {requirement.status === 'rejected' && requirement.rejectionReason ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'inventory.material.rejectedBecause')}{' '}
          <bdi>{requirement.rejectionReason}</bdi>
        </p>
      ) : null}

      {canApprove && decidable && ownRequest ? (
        <p role="note" className="text-body text-text-secondary">
          {translate(messages, 'inventory.material.decide.ownRequest')}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {requirement.status === 'approved' ? (
          <Button
            type="button"
            variant={chosen ? 'contained' : 'outlined'}
            aria-pressed={chosen}
            onClick={() =>
              onChoose(requirement, summaryOf(messages, requirement, item, categories, units))
            }
          >
            {translate(messages, 'inventory.material.use')}
          </Button>
        ) : null}
        {canApprove && decidable && !ownRequest ? (
          <>
            <Button
              type="button"
              variant="contained"
              disabled={busy}
              onClick={() =>
                void run(() => decideMaterialRequirement(requirement.id, { decision: 'approved' }))
              }
            >
              {translate(messages, 'inventory.material.decide.approve')}
            </Button>
            <Button
              ref={rejectRef}
              type="button"
              variant="outlined"
              aria-expanded={isOpen('reject')}
              onClick={() =>
                onOpen(isOpen('reject') ? { kind: 'none' } : { kind: 'reject', id: requirement.id })
              }
            >
              {translate(messages, 'inventory.material.decide.reject')}
            </Button>
          </>
        ) : null}
        {canRequest && requirement.status === 'approval_required' ? (
          <Button
            type="button"
            variant="outlined"
            disabled={busy}
            onClick={() => void run(() => recheckMaterialRequirement(requirement.id))}
          >
            {translate(messages, 'inventory.material.recheck.action')}
          </Button>
        ) : null}
        {canRequest && requirement.status === 'approved' ? (
          <Button
            ref={exceptionRef}
            type="button"
            variant="outlined"
            aria-expanded={isOpen('exception')}
            onClick={() =>
              onOpen(
                isOpen('exception') ? { kind: 'none' } : { kind: 'exception', id: requirement.id }
              )
            }
          >
            {translate(messages, 'inventory.material.exception.open')}
          </Button>
        ) : null}
        {canRequest && (requirement.status === 'approved' || decidable) ? (
          <Button
            ref={cancelRef}
            type="button"
            variant="outlined"
            color="error"
            aria-expanded={isOpen('cancel')}
            onClick={() =>
              onOpen(isOpen('cancel') ? { kind: 'none' } : { kind: 'cancel', id: requirement.id })
            }
          >
            {translate(messages, 'inventory.material.cancel.action')}
          </Button>
        ) : null}
      </div>

      <OutcomeNote messages={messages} outcome={outcome} />

      {isOpen('reject') ? (
        <ReasonForm
          messages={messages}
          headingKey="inventory.material.decide.rejectHeading"
          labelKey="inventory.material.decide.reason"
          submitKey="inventory.material.decide.reject"
          required
          onSubmit={(reason) =>
            decideMaterialRequirement(requirement.id, { decision: 'rejected', reason })
          }
          onDone={onChanged}
          onDiscard={() => onOpen({ kind: 'none' })}
        />
      ) : null}

      {isOpen('cancel') ? (
        <ReasonForm
          messages={messages}
          headingKey="inventory.material.cancel.heading"
          labelKey="inventory.material.cancel.reason"
          submitKey="inventory.material.cancel.submit"
          required
          onSubmit={(reason) => cancelMaterialRequirement(requirement.id, { reason })}
          onDone={onChanged}
          onDiscard={() => onOpen({ kind: 'none' })}
        />
      ) : null}

      {isOpen('exception') ? (
        <ExceptionForm
          messages={messages}
          requirementId={requirement.id}
          onDone={onChanged}
          onDiscard={() => onOpen({ kind: 'none' })}
        />
      ) : null}

      <ExceptionDisclosure
        locale={locale}
        messages={messages}
        requirementId={requirement.id}
        currentUserId={currentUserId}
        canDecide={canDecideException}
        onChanged={onChanged}
      />
    </div>
  );
}

/**
 * The exceptions of one requirement, read ON DEMAND.
 *
 * `inv.material-requirement-list` publishes the approved exception TOTAL and not
 * the exceptions themselves, so the individual rows — including the ones still
 * waiting for a second person — come from `inv.material-requirement-read`. It is
 * requested when the operator opens this disclosure rather than once per listed
 * row, because a list of a dozen requirements would otherwise become a dozen
 * extra reads nobody asked for.
 */
function ExceptionDisclosure({
  locale,
  messages,
  requirementId,
  currentUserId,
  canDecide,
  onChanged,
}: {
  /** Forwarded to the failure state, which links an expired session to sign in. */
  readonly locale: Locale;
  readonly messages: Messages;
  readonly requirementId: string;
  readonly currentUserId: string;
  readonly canDecide: boolean;
  readonly onChanged: () => void;
}) {
  const [shown, setShown] = useState(false);
  /*
   * The answer is STAMPED with the request it answers and `loading` is DERIVED
   * from the stamp not matching — the shape `usePanel` settled on. Setting a
   * loading state inside the effect instead is a second render for every read,
   * which React now reports out loud.
   */
  type Answer =
    | { readonly phase: 'read'; readonly exceptions: readonly MaterialException[] }
    | ({ readonly phase: 'failed' } & ReturnType<typeof failureOf>);
  const [answer, setAnswer] = useState<{
    readonly stamp: string;
    readonly value: Answer;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const stamp = `${requirementId}#${attempt}`;

  useEffect(() => {
    if (!shown) return;
    let live = true;
    void readMaterialRequirement(requirementId).then((got) => {
      if (!live) return;
      setAnswer({
        stamp,
        value:
          got.status === 'ok'
            ? { phase: 'read', exceptions: got.data.exceptions }
            : { phase: 'failed', ...failureOf(got) },
      });
    });
    return () => {
      live = false;
    };
  }, [shown, requirementId, stamp]);

  const state: Answer | { readonly phase: 'loading' } =
    answer !== null && answer.stamp === stamp ? answer.value : { phase: 'loading' };

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-2">
      <div>
        <Button
          type="button"
          variant="outlined"
          aria-expanded={shown}
          onClick={() => setShown((was) => !was)}
        >
          {translate(messages, 'inventory.material.exception.heading')}
        </Button>
      </div>
      {!shown ? null : state.phase === 'loading' ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : state.phase === 'failed' ? (
        <MuiReadFailureState
          messages={messages}
          locale={locale}
          status={state.status}
          correlationId={state.correlationId}
          onRetry={state.status === 'unavailable' ? () => setAttempt((n) => n + 1) : undefined}
          descriptionKey={state.messageKey}
        />
      ) : state.exceptions.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'inventory.material.exception.none')}
        </p>
      ) : (
        <ExceptionList
          messages={messages}
          exceptions={state.exceptions}
          currentUserId={currentUserId}
          canDecide={canDecide}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}

/** Where the allowance came from: a matched specification, or a person and their source. */
function RequirementSource({
  messages,
  requirement,
}: {
  readonly messages: Messages;
  readonly requirement: MaterialRequirement;
}) {
  if (requirement.basis === 'specification') {
    return requirement.specificationId ? (
      <span>
        {translate(messages, 'inventory.material.source.specification')}{' '}
        <code className="font-mono text-caption" dir="ltr">
          {requirement.specificationId}
        </code>
        {requirement.serviceCondition ? (
          <>
            {' · '}
            <bdi>{requirement.serviceCondition}</bdi>
          </>
        ) : null}
      </span>
    ) : (
      <span className="text-text-muted">
        {translate(messages, 'inventory.material.source.noSpecification')}
      </span>
    );
  }
  return requirement.sourceReference ? (
    <span>
      {translate(messages, 'inventory.material.source.entered')}{' '}
      <bdi>{requirement.sourceReference}</bdi>
    </span>
  ) : (
    <span className="text-text-muted">{translate(messages, 'inventory.material.source.none')}</span>
  );
}

/**
 * The allowance, what is committed against it and what remains — three exact
 * decimal strings, each as the server sent it. No width, no percentage and no
 * difference is computed here; a null allowance is rendered as the absent fact
 * it is rather than as a zero.
 */
function AllowanceBar({
  messages,
  requirement,
}: {
  readonly messages: Messages;
  readonly requirement: MaterialRequirement;
}) {
  return (
    <dl className="grid gap-2 sm:grid-cols-4" data-testid="material-allowance">
      <Fact label={translate(messages, 'inventory.material.allowance.allowance')}>
        {requirement.effectiveAllowance === null ? (
          <span className="text-text-muted">
            {translate(messages, 'inventory.material.allowance.unset')}
          </span>
        ) : (
          <Qty value={requirement.effectiveAllowance} />
        )}
      </Fact>
      <Fact label={translate(messages, 'inventory.material.allowance.exceptions')}>
        <Qty value={requirement.approvedExceptionQuantity} />
      </Fact>
      <Fact label={translate(messages, 'inventory.material.allowance.committed')}>
        <Qty value={requirement.committedQuantity} />
      </Fact>
      <Fact label={translate(messages, 'inventory.material.allowance.remaining')}>
        {requirement.remainingQuantity === null ? (
          <span className="text-text-muted">
            {translate(messages, 'inventory.material.allowance.unset')}
          </span>
        ) : (
          <Qty value={requirement.remainingQuantity} />
        )}
      </Fact>
    </dl>
  );
}

/**
 * The item family a requirement names, by its place in the category tree: the
 * path of names and the code beside it, so two families of the same name read
 * apart. While the tree is being read the panel says so; where it cannot be
 * read at all — no `inv.item.read`, or a refused or failed read — or no longer
 * holds the family, the reference the requirement carries is shown, as before.
 */
/** A name read for an identifier, the wait for it, or the sentence that it cannot be shown. */
function NamedValue({
  messages,
  answer,
  unavailableKey,
}: {
  readonly messages: Messages;
  readonly answer: NameAnswer;
  readonly unavailableKey: keyof Messages;
}) {
  if (answer.phase === 'named') return <bdi>{answer.name}</bdi>;
  return (
    <span className="text-text-muted">
      {translate(messages, answer.phase === 'pending' ? 'state.loading' : unavailableKey)}
    </span>
  );
}

/** What the draw forms say about a requirement once it is chosen (`RequirementSummary`). */
function summaryOf(
  messages: Messages,
  requirement: MaterialRequirement,
  item: NameAnswer | null,
  categories: CategoryList | null,
  units: readonly NamedUnit[] | null
): RequirementSummary {
  const read = categories?.read ?? null;
  const family =
    requirement.itemCategoryId !== null &&
    read !== null &&
    read.status === 'ok' &&
    read.forest.byId.has(requirement.itemCategoryId)
      ? pathText(read.forest, requirement.itemCategoryId)
      : null;
  const itemName = item !== null && item.phase === 'named' ? item.name : null;
  const what =
    itemName ??
    (requirement.itemId !== null
      ? translate(messages, 'inventory.material.itemUnavailable')
      : family !== null
        ? `${translate(messages, 'inventory.material.itemFamily')} ${family}`
        : requirement.itemCategoryId !== null
          ? translate(messages, 'inventory.material.familyUnavailable')
          : translate(messages, 'inventory.material.noItem'));
  return {
    what,
    itemName,
    unit: requirement.uomId === null ? null : unitNameById(messages, requirement.uomId, units),
  };
}

function CategoryName({
  messages,
  categories,
  categoryId,
}: {
  readonly messages: Messages;
  readonly categories: CategoryList | null;
  readonly categoryId: string;
}) {
  const read = categories?.read ?? null;
  if (read !== null && read.status === 'loading') {
    return <span className="text-text-muted">{translate(messages, 'state.loading')}</span>;
  }
  const category = read !== null && read.status === 'ok' ? read.forest.byId.get(categoryId) : null;
  if (read === null || read.status !== 'ok' || category === undefined || category === null) {
    return (
      <code className="font-mono text-caption" dir="ltr">
        {categoryId}
      </code>
    );
  }
  return (
    <span data-testid="material-category-path">
      <bdi>{pathText(read.forest, categoryId)}</bdi>{' '}
      <code className="font-mono text-caption" dir="ltr">
        {category.code}
      </code>
    </span>
  );
}

function Fact({
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

/* ------------------------------------------------------------------ *
 * The exceptions of one requirement
 * ------------------------------------------------------------------ */

function ExceptionList({
  messages,
  exceptions,
  currentUserId,
  canDecide,
  onChanged,
}: {
  readonly messages: Messages;
  readonly exceptions: readonly MaterialException[];
  readonly currentUserId: string;
  readonly canDecide: boolean;
  readonly onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  // One decision in flight at a time, before `busy` has disabled the buttons.
  const sending = useRef(false);

  const decide = async (exceptionId: string, decision: 'approved' | 'rejected') => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    const result = await decideMaterialException(exceptionId, { decision });
    sending.current = false;
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success') {
      setOutcome(null);
      onChanged();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {exceptions.map((exception) => (
          <li key={exception.id} className="flex flex-wrap items-baseline gap-2 text-body">
            <span>
              {translateDynamic(
                messages,
                `inventory.material.exception.status.${exception.status}`
              )}
            </span>
            <Qty value={exception.additionalQuantity} />
            <bdi className="text-text-secondary">{exception.reason}</bdi>
            {exception.resultingAllowance ? (
              <span className="text-caption text-text-muted">
                {translate(messages, 'inventory.material.exception.resulting')}{' '}
                <Qty value={exception.resultingAllowance} />
              </span>
            ) : null}
            {canDecide &&
            exception.status === 'pending' &&
            exception.requestedBy !== currentUserId ? (
              <>
                <Button
                  type="button"
                  variant="outlined"
                  size="small"
                  disabled={busy}
                  onClick={() => void decide(exception.id, 'approved')}
                >
                  {translate(messages, 'inventory.material.exception.approve')}
                </Button>
                <Button
                  type="button"
                  variant="outlined"
                  size="small"
                  disabled={busy}
                  onClick={() => void decide(exception.id, 'rejected')}
                >
                  {translate(messages, 'inventory.material.exception.reject')}
                </Button>
              </>
            ) : null}
            {canDecide &&
            exception.status === 'pending' &&
            exception.requestedBy === currentUserId ? (
              <span className="text-caption text-text-secondary">
                {translate(messages, 'inventory.material.exception.ownRequest')}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <OutcomeNote messages={messages} outcome={outcome} />
    </div>
  );
}

function ExceptionForm({
  messages,
  requirementId,
  onDone,
  onDiscard,
}: {
  readonly messages: Messages;
  readonly requirementId: string;
  readonly onDone: () => void;
  /** A confirmed "discard" (a branch switch, leaving the page) closes the form. */
  readonly onDiscard: () => void;
}) {
  const [form, setForm] = useState({ additionalQuantity: '', reason: '' });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [refusals, setRefusals] = useState(0);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  // One request in flight at a time, before `busy` has disabled the button.
  const sending = useRef(false);
  useUnsavedGuard(
    form.additionalQuantity.trim().length > 0 || form.reason.trim().length > 0,
    onDiscard
  );
  const formRef = useFocusFirstInvalid(refusalState(errors, refusals, outcome));
  const firstRef = useFocusOnOpen<HTMLDivElement>();

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    const additionalQuantity = form.additionalQuantity.trim();
    if (!isQuantity(additionalQuantity)) {
      found['additionalQuantity'] = 'inventory.reserve.quantityFormat';
    }
    const reason = form.reason.trim();
    if (reason.length === 0) found['reason'] = 'field.required';
    else if (reason.length > MAX_REASON) found['reason'] = 'inventory.return.reasonTooLong';
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setRefusals((n) => n + 1);
      return;
    }
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    const result = await requestMaterialException(requirementId, { additionalQuantity, reason });
    sending.current = false;
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success') {
      setOutcome(null);
      onDone();
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
      aria-label={translate(messages, 'inventory.material.exception.formHeading')}
      className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2"
    >
      <p className="text-caption text-text-muted sm:col-span-2">
        {translate(messages, 'inventory.material.exception.explain')}
      </p>
      <div ref={firstRef}>
        <FormNumberField
          label={translate(messages, 'inventory.material.exception.quantity')}
          description={translate(messages, 'inventory.reserve.quantityHelp')}
          required
          value={form.additionalQuantity}
          onChange={(next) => setForm((f) => ({ ...f, additionalQuantity: next }))}
          error={errorFor('additionalQuantity')}
        />
      </div>
      <FormTextField
        label={translate(messages, 'inventory.material.exception.reason')}
        required
        value={form.reason}
        onChange={(next) => setForm((f) => ({ ...f, reason: next }))}
        error={errorFor('reason')}
      />
      <div className="sm:col-span-2">
        <OutcomeNote messages={messages} outcome={outcome} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" variant="contained" disabled={busy}>
          {translate(messages, 'inventory.material.exception.submit')}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * A reason, and nothing else
 * ------------------------------------------------------------------ */

function ReasonForm({
  messages,
  headingKey,
  labelKey,
  submitKey,
  required,
  onSubmit,
  onDone,
  onDiscard,
}: {
  readonly messages: Messages;
  readonly headingKey: string;
  readonly labelKey: string;
  readonly submitKey: string;
  readonly required: boolean;
  readonly onSubmit: (reason: string) => Promise<{ readonly state: ActionState }>;
  readonly onDone: () => void;
  /** A confirmed "discard" (a branch switch, leaving the page) closes the form. */
  readonly onDiscard: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [refusals, setRefusals] = useState(0);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  // One answer in flight at a time, before `busy` has disabled the button.
  const sending = useRef(false);
  useUnsavedGuard(reason.trim().length > 0, onDiscard);
  const formRef = useFocusFirstInvalid(
    refusalState(error ? { reason: error } : {}, refusals, outcome)
  );

  const submit = async () => {
    if (sending.current) return;
    const value = reason.trim();
    if (required && value.length === 0) {
      setError(translate(messages, 'field.required'));
      setRefusals((n) => n + 1);
      return;
    }
    if (value.length > MAX_REASON) {
      setError(translate(messages, 'inventory.return.reasonTooLong'));
      setRefusals((n) => n + 1);
      return;
    }
    setError(undefined);
    sending.current = true;
    setBusy(true);
    const result = await onSubmit(value);
    sending.current = false;
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success') {
      setOutcome(null);
      onDone();
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
      aria-label={translateDynamic(messages, headingKey)}
      className="grid gap-3 border-t border-border pt-3"
    >
      <FormTextField
        label={translateDynamic(messages, labelKey)}
        required={required}
        autoFocus
        value={reason}
        onChange={setReason}
        error={error}
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <Button type="submit" variant="contained" disabled={busy}>
          {translateDynamic(messages, submitKey)}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Asking for a requirement
 * ------------------------------------------------------------------ */

/**
 * What the service-line read left the form with (DEF-M-05).
 *
 * `not-offered` is not a failure: the operator does not hold
 * `wo.work_order.read`, so no read was made and none should have been. The
 * three other phases each have their own sentence, because "the picker is not
 * here" and "the picker could not be filled" are different facts and the
 * operator can act on only one of them.
 */
type ServiceLines =
  | { readonly phase: 'not-offered' }
  | { readonly phase: 'loading' }
  | { readonly phase: 'listed'; readonly rows: readonly WorkOrderServiceLine[] }
  | { readonly phase: 'failed'; readonly messageKey: string };

/** What the identifier box says when the picker could not be offered. */
function serviceLineNoteKey(lines: ServiceLines): string {
  if (lines.phase === 'failed') return lines.messageKey;
  if (lines.phase === 'not-offered') return 'inventory.material.create.serviceLineNoRead';
  if (lines.phase === 'listed') return 'inventory.material.create.serviceLineNone';
  return 'inventory.material.create.serviceLineHelp';
}

function CreateRequirementForm({
  messages,
  workOrderId,
  canReadWorkOrder,
  categories,
  onCreated,
  onDiscard,
}: {
  readonly messages: Messages;
  readonly workOrderId: string;
  /** `wo.work_order.read` — whether the service lines are requested for the picker. */
  readonly canReadWorkOrder: boolean;
  /** The whole category tree, or `null` without `inv.item.read` (the family is then typed). */
  readonly categories: CategoryList | null;
  readonly onCreated: () => void;
  /** A confirmed "discard" (a branch switch, leaving the page) closes the form. */
  readonly onDiscard: () => void;
}) {
  const [lines, setLines] = useState<ServiceLines>(
    canReadWorkOrder ? { phase: 'loading' } : { phase: 'not-offered' }
  );
  useEffect(() => {
    if (!canReadWorkOrder) return;
    let live = true;
    void listServiceLines(workOrderId).then((state) => {
      if (!live) return;
      if (state.status === 'ok') setLines({ phase: 'listed', rows: state.data.items });
      else
        setLines({
          phase: 'failed',
          messageKey:
            state.status === 'denied'
              ? 'inventory.material.create.serviceLineRefused'
              : 'inventory.material.create.serviceLineUnavailable',
        });
    });
    return () => {
      live = false;
    };
  }, [canReadWorkOrder, workOrderId]);

  const [units, setUnits] = useState<readonly UnitOfMeasureOption[]>([]);
  useEffect(() => {
    let live = true;
    void listUnitsOfMeasure().then((state) => {
      if (live && state.status === 'ok') setUnits(state.data.items);
    });
    return () => {
      live = false;
    };
  }, []);

  const [opened] = useState(() => ({
    basis: 'specification' as 'specification' | 'entered',
    serviceLineId: '',
    itemId: '',
    itemCategoryId: '',
    serviceCondition: '',
    engineVariant: '',
    // Left EMPTY on purpose, and never seeded from a capacity nobody stated.
    allowanceQuantity: '',
    uomId: '',
    sourceReference: '',
  }));
  const [form, setForm] = useState(opened);
  /*
   * The chosen item, held beside the form because `ItemFinder` renders the row
   * it was given rather than an identifier. `form.itemId` stays the single
   * source of what is SENT — the finder writes into it and never around it.
   */
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [refusals, setRefusals] = useState(0);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  // One request in flight at a time, before `busy` has disabled the button.
  const sending = useRef(false);
  /*
   * Anything chosen or typed is a request in progress: a branch switch or
   * leaving the page asks first, and a confirmed discard closes the form.
   */
  useUnsavedGuard(
    (Object.keys(opened) as (keyof typeof opened)[]).some(
      (key) => form[key].trim() !== opened[key].trim()
    ),
    onDiscard
  );
  const formRef = useFocusFirstInvalid(refusalState(errors, refusals, outcome));
  const headingRef = useFocusOnOpen<HTMLHeadingElement>();

  /*
   * The confirmed capacities on file for the service kind typed above, read as
   * soon as that kind is well formed. Only CONFIRMED ones are asked for,
   * because only a confirmed capacity answers for a vehicle; a recorded one
   * shown here would read as an allowance that exists when it does not.
   *
   * The read is delayed briefly so that typing a service kind does not issue a
   * request per keystroke.
   */
  const [found, setFound] = useState<{
    readonly condition: string;
    readonly result: MatchState;
  } | null>(null);
  const condition = form.serviceCondition.trim();
  const lookFor = form.basis === 'specification' && SERVICE_CONDITION.test(condition);
  useEffect(() => {
    if (!lookFor) return;
    let live = true;
    const timer = setTimeout(() => {
      void listVehicleSpecifications({ serviceCondition: condition, status: 'confirmed' }).then(
        (state) => {
          if (!live) return;
          setFound({
            condition,
            result:
              state.status === 'ok'
                ? { phase: 'listed', rows: state.data.items }
                : {
                    phase: 'failed',
                    messageKey:
                      state.status === 'denied'
                        ? 'inventory.material.create.matchRefused'
                        : 'inventory.material.create.matchUnavailable',
                  },
          });
        }
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [lookFor, condition]);

  /*
   * Derived, never stored: an answer belongs to the service kind it was asked
   * about, so anything else is still being looked for. Holding a phase in state
   * and setting it from the effect would render one service kind's capacities
   * under another's name for a frame.
   */
  const match: MatchState = !lookFor
    ? { phase: 'idle' }
    : found !== null && found.condition === condition
      ? found.result
      : { phase: 'loading' };

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    if (sending.current) return;
    const found: Record<string, string> = {};
    const serviceLineId = form.serviceLineId.trim();
    if (!UUID.test(serviceLineId)) found['serviceLineId'] = 'inventory.common.idFormat';
    const itemId = form.itemId.trim();
    if (itemId.length > 0 && !UUID.test(itemId)) found['itemId'] = 'inventory.common.idFormat';
    const itemCategoryId = form.itemCategoryId.trim();
    if (itemCategoryId.length > 0 && !UUID.test(itemCategoryId)) {
      found['itemCategoryId'] = 'inventory.common.idFormat';
    }

    const target = {
      serviceLineId,
      ...(itemId ? { itemId } : {}),
      ...(itemCategoryId ? { itemCategoryId } : {}),
    };

    let body: MaterialRequirementCreateBody;
    if (form.basis === 'specification') {
      const serviceCondition = form.serviceCondition.trim();
      if (!SERVICE_CONDITION.test(serviceCondition)) {
        found['serviceCondition'] = 'inventory.material.create.conditionFormat';
      }
      const engineVariant = form.engineVariant.trim();
      body = {
        basis: 'specification',
        ...target,
        serviceCondition,
        ...(engineVariant ? { engineVariant } : {}),
      };
    } else {
      const allowanceQuantity = form.allowanceQuantity.trim();
      if (!QUANTITY.test(allowanceQuantity)) {
        found['allowanceQuantity'] = 'inventory.reserve.quantityFormat';
      }
      if (!form.uomId) found['uomId'] = 'field.required';
      const sourceReference = form.sourceReference.trim();
      // The source is REQUIRED beside an entered value: a capacity nobody can
      // point at is a guess, and this screen refuses to send one.
      if (sourceReference.length === 0) found['sourceReference'] = 'field.required';
      else if (sourceReference.length > MAX_SOURCE_REFERENCE) {
        found['sourceReference'] = 'inventory.material.create.sourceTooLong';
      }
      body = {
        basis: 'entered',
        ...target,
        allowanceQuantity,
        uomId: form.uomId,
        sourceReference,
      };
    }

    setErrors(found);
    if (Object.keys(found).length > 0) {
      setRefusals((n) => n + 1);
      return;
    }

    sending.current = true;
    setBusy(true);
    const result = await createMaterialRequirement(body);
    sending.current = false;
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success') {
      setOutcome(null);
      onCreated();
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
      aria-labelledby="material-create-heading"
      className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2"
    >
      <h3
        ref={headingRef}
        id="material-create-heading"
        tabIndex={-1}
        className="text-body font-medium text-text-primary sm:col-span-2"
      >
        {translate(messages, 'inventory.material.create.heading')}
      </h3>
      <p className="text-caption text-text-muted sm:col-span-2">
        {translate(messages, 'inventory.material.create.explain')}
      </p>
      {/*
       * DEF-M-05. This asked an operator to type "the reference of the line
       * this material is for" as free text, and no screen in the product
       * publishes a service line's identifier, so the form could not be used
       * without one already being known. `wo.service-line-list` publishes the
       * lines of this work order under the same code that renders its header,
       * so the lines are OFFERED. The box survives for the one case the picker
       * cannot cover — the operator does not hold `wo.work_order.read`, or the
       * read failed — and then the screen says which of those it is rather than
       * leaving a naked identifier field.
       */}
      {lines.phase === 'listed' && lines.rows.length > 0 ? (
        <FormSelectField
          label={translate(messages, 'inventory.material.create.serviceLine')}
          description={translate(messages, 'inventory.material.create.serviceLineChooseHelp')}
          required
          value={form.serviceLineId}
          onChange={(next) => setForm((f) => ({ ...f, serviceLineId: next }))}
          options={lines.rows.map((line) => ({
            value: line.id,
            label: `${line.description} — ${line.quantity} ${line.unit}`,
          }))}
          placeholder={translate(messages, 'inventory.material.create.chooseServiceLine')}
          error={errorFor('serviceLineId')}
        />
      ) : (
        <FormTextField
          label={translate(messages, 'inventory.material.create.serviceLineId')}
          description={translateDynamic(messages, serviceLineNoteKey(lines))}
          required
          spellCheck={false}
          dir="ltr"
          value={form.serviceLineId}
          onChange={(next) => setForm((f) => ({ ...f, serviceLineId: next }))}
          error={errorFor('serviceLineId')}
        />
      )}
      {/*
       * DEF-M-05, second half. This was the other free-text identifier on this
       * form: "the item this material is", typed as a 36-character reference no
       * screen prints. The catalogue search every other stock screen uses is
       * offered instead, and the typed box is gone — `inv.item-search` is
       * declared under `inv.item.read`, which a caller reaching this panel
       * already holds, so there is no refusal case left for a box to survive.
       *
       * The material may be named by its item, by its category, or by neither,
       * so the finder stays optional: clearing the choice clears the field.
       */}
      <div className="sm:col-span-2">
        <ItemFinder
          messages={messages}
          idPrefix="material"
          required={false}
          value={item}
          onChange={(chosen) => {
            setItem(chosen);
            setForm((f) => ({ ...f, itemId: chosen?.id ?? '' }));
          }}
          error={errorFor('itemId')}
        />
      </div>
      {/*
       * The item family is CHOSEN from the whole category tree
       * (`P1-32-PRE-OD-INV5`): every page of the categories, each row its name
       * and code, the chosen family's path said under the tree. It used to be a
       * typed 36-character reference no screen prints. Without `inv.item.read`
       * the categories cannot be read, so that caller keeps the typed box.
       */}
      <div className="sm:col-span-2">
        {categories !== null ? (
          <CategoryTreePicker
            messages={messages}
            categories={categories}
            label={translate(messages, 'inventory.material.create.itemCategory')}
            description={translate(messages, 'inventory.material.create.itemCategoryHelp')}
            value={form.itemCategoryId}
            onChange={(next) => setForm((f) => ({ ...f, itemCategoryId: next }))}
            error={errorFor('itemCategoryId')}
            testId="material-category-picker"
          />
        ) : (
          <FormTextField
            label={translate(messages, 'inventory.material.create.itemCategoryId')}
            description={translate(messages, 'inventory.material.create.itemCategoryHelp')}
            spellCheck={false}
            dir="ltr"
            value={form.itemCategoryId}
            onChange={(next) => setForm((f) => ({ ...f, itemCategoryId: next }))}
            error={errorFor('itemCategoryId')}
          />
        )}
      </div>
      <FormSelectField
        label={translate(messages, 'inventory.material.create.basis')}
        description={translate(messages, 'inventory.material.create.basisHelp')}
        value={form.basis}
        onChange={(next) =>
          setForm((f) => ({
            ...f,
            basis: next === 'entered' ? 'entered' : 'specification',
          }))
        }
        options={[
          {
            value: 'specification',
            label: translate(messages, 'inventory.material.basis.specification'),
          },
          { value: 'entered', label: translate(messages, 'inventory.material.basis.entered') },
        ]}
      />

      {form.basis === 'specification' ? (
        <>
          <FormTextField
            label={translate(messages, 'inventory.material.create.serviceCondition')}
            description={translate(messages, 'inventory.material.create.serviceConditionHelp')}
            required
            spellCheck={false}
            dir="ltr"
            value={form.serviceCondition}
            onChange={(next) => setForm((f) => ({ ...f, serviceCondition: next }))}
            error={errorFor('serviceCondition')}
          />
          <FormTextField
            label={translate(messages, 'inventory.material.create.engineVariant')}
            description={translate(messages, 'inventory.material.create.engineVariantHelp')}
            value={form.engineVariant}
            onChange={(next) => setForm((f) => ({ ...f, engineVariant: next }))}
            error={errorFor('engineVariant')}
          />
          <div
            aria-live="polite"
            className="flex flex-col gap-2 rounded-md border border-border p-3 sm:col-span-2"
          >
            <h4 className="text-caption font-medium text-text-primary">
              {translate(messages, 'inventory.material.create.matchHeading')}
            </h4>
            {match.phase === 'idle' ? (
              <p className="text-caption text-text-muted">
                {translate(messages, 'inventory.material.create.matchIdle')}
              </p>
            ) : match.phase === 'loading' ? (
              <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
            ) : match.phase === 'failed' ? (
              <p role="alert" className="text-body text-error">
                {translateDynamic(messages, match.messageKey)}
              </p>
            ) : match.rows.length === 0 ? (
              <p className="text-body text-text-secondary">
                {translate(messages, 'inventory.material.create.matchNone')}
              </p>
            ) : (
              <>
                <p className="text-caption text-text-muted">
                  {translate(messages, 'inventory.material.create.matchExplain')}
                </p>
                <ul className="flex flex-col gap-1">
                  {match.rows.map((row) => (
                    <li key={row.id} className="text-body text-text-secondary">
                      <span className="tabular-nums">
                        <Qty value={row.capacity} />{' '}
                        <bdi>{unitNameByCode(messages, row.uomCode, units)}</bdi>
                      </span>
                      {' · '}
                      <code className="font-mono text-caption" dir="ltr">
                        {row.makeId}
                      </code>
                      {row.modelId ? (
                        <>
                          {' · '}
                          <code className="font-mono text-caption" dir="ltr">
                            {row.modelId}
                          </code>
                        </>
                      ) : null}
                      {row.engineVariant ? (
                        <>
                          {' · '}
                          <bdi>{row.engineVariant}</bdi>
                        </>
                      ) : null}
                      {' · '}
                      {translate(messages, 'inventory.material.source.entered')}{' '}
                      <bdi>{row.sourceReference}</bdi>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <p className="text-caption text-text-muted sm:col-span-2">
            {translate(messages, 'inventory.material.create.derivedNote')}
          </p>
        </>
      ) : (
        <>
          <FormNumberField
            label={translate(messages, 'inventory.material.create.allowanceQuantity')}
            description={translate(messages, 'inventory.material.create.allowanceHelp')}
            required
            value={form.allowanceQuantity}
            onChange={(next) => setForm((f) => ({ ...f, allowanceQuantity: next }))}
            error={errorFor('allowanceQuantity')}
          />
          <FormSelectField
            label={translate(messages, 'inventory.material.create.uom')}
            required
            value={form.uomId}
            onChange={(next) => setForm((f) => ({ ...f, uomId: next }))}
            options={unitOptions(messages, units)}
            placeholder={translate(messages, 'inventory.material.create.chooseUom')}
            error={errorFor('uomId')}
          />
          <FormTextField
            label={translate(messages, 'inventory.material.create.sourceReference')}
            description={translate(messages, 'inventory.material.create.sourceHelp')}
            required
            value={form.sourceReference}
            onChange={(next) => setForm((f) => ({ ...f, sourceReference: next }))}
            error={errorFor('sourceReference')}
          />
          <p className="text-caption text-text-muted sm:col-span-2">
            {translate(messages, 'inventory.material.create.enteredNote')}
          </p>
        </>
      )}

      <div className="sm:col-span-2">
        <OutcomeNote messages={messages} outcome={outcome} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" variant="contained" disabled={busy}>
          {translate(messages, 'inventory.material.create.submit')}
        </Button>
      </div>
    </form>
  );
}
