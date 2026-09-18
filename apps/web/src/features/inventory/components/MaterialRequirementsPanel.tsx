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
 */

import { useCallback, useEffect, useState } from 'react';

import { SelectField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';

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
  type MaterialRequirementCreateBody,
  type StockTarget,
  type UnitOfMeasureOption,
  type VehicleSpecification,
} from '../inventory-contract';
import { OutcomeNote, PRIMARY_BUTTON, Qty, SECONDARY_BUTTON, UUID } from './shared';
import { DANGER_BUTTON, PANEL, isQuantity } from './stock-operations';

/** The requirement list as one of four outcomes; an empty branch and a refusal differ. */
type Listing =
  | { readonly phase: 'loading' }
  | { readonly phase: 'listed'; readonly rows: readonly MaterialRequirement[] }
  | { readonly phase: 'failed'; readonly messageKey: string };

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
  chosenId,
  onChoose,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  /** The work order branch. The list is branch-targeted and is not requested without it. */
  readonly target: StockTarget | null;
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
  readonly onChoose: (requirement: MaterialRequirement) => void;
  /** A write landed: the parts screen re-reads what depends on it. */
  readonly onChanged: () => void;
}) {
  const [listing, setListing] = useState<Listing>({ phase: 'loading' });
  const [epoch, setEpoch] = useState(0);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<OpenForm>({ kind: 'none' });

  const reload = useCallback(() => setEpoch((n) => n + 1), []);

  useEffect(() => {
    if (target === null) return;
    let live = true;
    void listMaterialRequirements(target, { workOrderId }).then((state) => {
      if (!live) return;
      if (state.status === 'ok') setListing({ phase: 'listed', rows: state.data.items });
      else
        setListing({
          phase: 'failed',
          messageKey:
            state.status === 'denied'
              ? 'inventory.material.refused'
              : 'inventory.material.unavailable',
        });
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
              <button
                type="button"
                className={SECONDARY_BUTTON}
                aria-expanded={adding}
                onClick={() => setAdding((was) => !was)}
              >
                {translate(messages, 'inventory.material.create.open')}
              </button>
            </div>
          ) : null}

          {canRequest && adding ? (
            <CreateRequirementForm messages={messages} onCreated={afterWrite} />
          ) : null}

          {listing.phase === 'loading' ? (
            <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
          ) : listing.phase === 'failed' ? (
            <p role="alert" className="text-body text-error">
              {translateDynamic(messages, listing.messageKey)}
            </p>
          ) : listing.rows.length === 0 ? (
            <p className="py-4 text-center text-body text-text-secondary">
              {translate(messages, 'inventory.material.none')}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {listing.rows.map((row) => (
                <li key={row.id}>
                  <RequirementCard
                    locale={locale}
                    messages={messages}
                    requirement={row}
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
  readonly currentUserId: string;
  readonly canRequest: boolean;
  readonly canApprove: boolean;
  readonly canDecideException: boolean;
  readonly chosen: boolean;
  readonly open: OpenForm;
  readonly onOpen: (next: OpenForm) => void;
  readonly onChoose: (requirement: MaterialRequirement) => void;
  readonly onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const ownRequest = requirement.requestedBy === currentUserId;
  const decidable = requirement.status === 'pending_approval';

  const run = async (act: () => Promise<{ readonly state: ActionState }>) => {
    setBusy(true);
    const result = await act();
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
          <code className="font-mono text-caption" dir="ltr">
            {requirement.serviceLineId}
          </code>
        </Fact>
        <Fact label={translate(messages, 'inventory.material.item')}>
          {requirement.itemId ? (
            <code className="font-mono text-caption" dir="ltr">
              {requirement.itemId}
            </code>
          ) : requirement.itemCategoryId ? (
            <span>
              {translate(messages, 'inventory.material.itemFamily')}{' '}
              <code className="font-mono text-caption" dir="ltr">
                {requirement.itemCategoryId}
              </code>
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
          <button
            type="button"
            className={SECONDARY_BUTTON}
            aria-pressed={chosen}
            onClick={() => onChoose(requirement)}
          >
            {translate(messages, 'inventory.material.use')}
          </button>
        ) : null}
        {canApprove && decidable && !ownRequest ? (
          <>
            <button
              type="button"
              className={PRIMARY_BUTTON}
              disabled={busy}
              onClick={() =>
                void run(() => decideMaterialRequirement(requirement.id, { decision: 'approved' }))
              }
            >
              {translate(messages, 'inventory.material.decide.approve')}
            </button>
            <button
              type="button"
              className={SECONDARY_BUTTON}
              aria-expanded={open.kind === 'reject' && open.id === requirement.id}
              onClick={() =>
                onOpen(
                  open.kind === 'reject' && open.id === requirement.id
                    ? { kind: 'none' }
                    : { kind: 'reject', id: requirement.id }
                )
              }
            >
              {translate(messages, 'inventory.material.decide.reject')}
            </button>
          </>
        ) : null}
        {canRequest && requirement.status === 'approval_required' ? (
          <button
            type="button"
            className={SECONDARY_BUTTON}
            disabled={busy}
            onClick={() => void run(() => recheckMaterialRequirement(requirement.id))}
          >
            {translate(messages, 'inventory.material.recheck.action')}
          </button>
        ) : null}
        {canRequest && requirement.status === 'approved' ? (
          <button
            type="button"
            className={SECONDARY_BUTTON}
            aria-expanded={open.kind === 'exception' && open.id === requirement.id}
            onClick={() =>
              onOpen(
                open.kind === 'exception' && open.id === requirement.id
                  ? { kind: 'none' }
                  : { kind: 'exception', id: requirement.id }
              )
            }
          >
            {translate(messages, 'inventory.material.exception.open')}
          </button>
        ) : null}
        {canRequest && (requirement.status === 'approved' || decidable) ? (
          <button
            type="button"
            className={DANGER_BUTTON}
            aria-expanded={open.kind === 'cancel' && open.id === requirement.id}
            onClick={() =>
              onOpen(
                open.kind === 'cancel' && open.id === requirement.id
                  ? { kind: 'none' }
                  : { kind: 'cancel', id: requirement.id }
              )
            }
          >
            {translate(messages, 'inventory.material.cancel.action')}
          </button>
        ) : null}
      </div>

      <OutcomeNote messages={messages} outcome={outcome} />

      {open.kind === 'reject' && open.id === requirement.id ? (
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
        />
      ) : null}

      {open.kind === 'cancel' && open.id === requirement.id ? (
        <ReasonForm
          messages={messages}
          headingKey="inventory.material.cancel.heading"
          labelKey="inventory.material.cancel.reason"
          submitKey="inventory.material.cancel.submit"
          required
          onSubmit={(reason) => cancelMaterialRequirement(requirement.id, { reason })}
          onDone={onChanged}
        />
      ) : null}

      {open.kind === 'exception' && open.id === requirement.id ? (
        <ExceptionForm messages={messages} requirementId={requirement.id} onDone={onChanged} />
      ) : null}

      <ExceptionDisclosure
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
  messages,
  requirementId,
  currentUserId,
  canDecide,
  onChanged,
}: {
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
    | { readonly phase: 'failed'; readonly messageKey: string };
  const [answer, setAnswer] = useState<{
    readonly stamp: string;
    readonly value: Answer;
  } | null>(null);

  useEffect(() => {
    if (!shown) return;
    let live = true;
    void readMaterialRequirement(requirementId).then((got) => {
      if (!live) return;
      setAnswer({
        stamp: requirementId,
        value:
          got.status === 'ok'
            ? { phase: 'read', exceptions: got.data.exceptions }
            : {
                phase: 'failed',
                messageKey:
                  got.status === 'denied'
                    ? 'inventory.material.refused'
                    : 'inventory.material.unavailable',
              },
      });
    });
    return () => {
      live = false;
    };
  }, [shown, requirementId]);

  const state: Answer | { readonly phase: 'loading' } =
    answer !== null && answer.stamp === requirementId ? answer.value : { phase: 'loading' };

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-2">
      <div>
        <button
          type="button"
          className={SECONDARY_BUTTON}
          aria-expanded={shown}
          onClick={() => setShown((was) => !was)}
        >
          {translate(messages, 'inventory.material.exception.heading')}
        </button>
      </div>
      {!shown ? null : state.phase === 'loading' ? (
        <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
      ) : state.phase === 'failed' ? (
        <p role="alert" className="text-body text-error">
          {translateDynamic(messages, state.messageKey)}
        </p>
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

function Fact({
  label,
  wide = false,
  children,
}: {
  readonly label: string;
  readonly wide?: boolean;
  readonly children: React.ReactNode;
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

  const decide = async (exceptionId: string, decision: 'approved' | 'rejected') => {
    setBusy(true);
    const result = await decideMaterialException(exceptionId, { decision });
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
                <button
                  type="button"
                  className={SECONDARY_BUTTON}
                  disabled={busy}
                  onClick={() => void decide(exception.id, 'approved')}
                >
                  {translate(messages, 'inventory.material.exception.approve')}
                </button>
                <button
                  type="button"
                  className={SECONDARY_BUTTON}
                  disabled={busy}
                  onClick={() => void decide(exception.id, 'rejected')}
                >
                  {translate(messages, 'inventory.material.exception.reject')}
                </button>
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
}: {
  readonly messages: Messages;
  readonly requirementId: string;
  readonly onDone: () => void;
}) {
  const [form, setForm] = useState({ additionalQuantity: '', reason: '' });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

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
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await requestMaterialException(requirementId, { additionalQuantity, reason });
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
      <TextField
        label={translate(messages, 'inventory.material.exception.quantity')}
        description={translate(messages, 'inventory.reserve.quantityHelp')}
        required
        inputMode="decimal"
        dir="ltr"
        value={form.additionalQuantity}
        onChange={(event) => setForm((f) => ({ ...f, additionalQuantity: event.target.value }))}
        error={errorFor('additionalQuantity')}
      />
      <TextField
        label={translate(messages, 'inventory.material.exception.reason')}
        required
        value={form.reason}
        onChange={(event) => setForm((f) => ({ ...f, reason: event.target.value }))}
        error={errorFor('reason')}
      />
      <div className="sm:col-span-2">
        <OutcomeNote messages={messages} outcome={outcome} />
      </div>
      <div className="sm:col-span-2">
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'inventory.material.exception.submit')}
        </button>
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
}: {
  readonly messages: Messages;
  readonly headingKey: string;
  readonly labelKey: string;
  readonly submitKey: string;
  readonly required: boolean;
  readonly onSubmit: (reason: string) => Promise<{ readonly state: ActionState }>;
  readonly onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const submit = async () => {
    const value = reason.trim();
    if (required && value.length === 0) {
      setError(translate(messages, 'field.required'));
      return;
    }
    if (value.length > MAX_REASON) {
      setError(translate(messages, 'inventory.return.reasonTooLong'));
      return;
    }
    setError(undefined);
    setBusy(true);
    const result = await onSubmit(value);
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
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-label={translateDynamic(messages, headingKey)}
      className="grid gap-3 border-t border-border pt-3"
    >
      <TextField
        label={translateDynamic(messages, labelKey)}
        required={required}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        error={error}
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translateDynamic(messages, submitKey)}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Asking for a requirement
 * ------------------------------------------------------------------ */

function CreateRequirementForm({
  messages,
  onCreated,
}: {
  readonly messages: Messages;
  readonly onCreated: () => void;
}) {
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

  const [form, setForm] = useState({
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
  });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

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

    let body: MaterialRequirementCreateBody | null = null;
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
    if (Object.keys(found).length > 0 || body === null) return;

    setBusy(true);
    const result = await createMaterialRequirement(body);
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
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="material-create-heading"
      className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2"
    >
      <h3
        id="material-create-heading"
        className="text-body font-medium text-text-primary sm:col-span-2"
      >
        {translate(messages, 'inventory.material.create.heading')}
      </h3>
      <p className="text-caption text-text-muted sm:col-span-2">
        {translate(messages, 'inventory.material.create.explain')}
      </p>
      <TextField
        label={translate(messages, 'inventory.material.create.serviceLineId')}
        description={translate(messages, 'inventory.material.create.serviceLineHelp')}
        required
        spellCheck={false}
        dir="ltr"
        value={form.serviceLineId}
        onChange={(event) => setForm((f) => ({ ...f, serviceLineId: event.target.value }))}
        error={errorFor('serviceLineId')}
      />
      <TextField
        label={translate(messages, 'inventory.material.create.itemId')}
        description={translate(messages, 'inventory.material.create.itemHelp')}
        spellCheck={false}
        dir="ltr"
        value={form.itemId}
        onChange={(event) => setForm((f) => ({ ...f, itemId: event.target.value }))}
        error={errorFor('itemId')}
      />
      <TextField
        label={translate(messages, 'inventory.material.create.itemCategoryId')}
        description={translate(messages, 'inventory.material.create.itemCategoryHelp')}
        spellCheck={false}
        dir="ltr"
        value={form.itemCategoryId}
        onChange={(event) => setForm((f) => ({ ...f, itemCategoryId: event.target.value }))}
        error={errorFor('itemCategoryId')}
      />
      <SelectField
        label={translate(messages, 'inventory.material.create.basis')}
        description={translate(messages, 'inventory.material.create.basisHelp')}
        value={form.basis}
        onChange={(event) =>
          setForm((f) => ({
            ...f,
            basis: event.target.value === 'entered' ? 'entered' : 'specification',
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
          <TextField
            label={translate(messages, 'inventory.material.create.serviceCondition')}
            description={translate(messages, 'inventory.material.create.serviceConditionHelp')}
            required
            spellCheck={false}
            dir="ltr"
            value={form.serviceCondition}
            onChange={(event) => setForm((f) => ({ ...f, serviceCondition: event.target.value }))}
            error={errorFor('serviceCondition')}
          />
          <TextField
            label={translate(messages, 'inventory.material.create.engineVariant')}
            description={translate(messages, 'inventory.material.create.engineVariantHelp')}
            value={form.engineVariant}
            onChange={(event) => setForm((f) => ({ ...f, engineVariant: event.target.value }))}
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
                        <Qty value={row.capacity} /> <bdi>{row.uomCode}</bdi>
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
          <TextField
            label={translate(messages, 'inventory.material.create.allowanceQuantity')}
            description={translate(messages, 'inventory.material.create.allowanceHelp')}
            required
            inputMode="decimal"
            dir="ltr"
            value={form.allowanceQuantity}
            onChange={(event) => setForm((f) => ({ ...f, allowanceQuantity: event.target.value }))}
            error={errorFor('allowanceQuantity')}
          />
          <SelectField
            label={translate(messages, 'inventory.material.create.uom')}
            required
            value={form.uomId}
            onChange={(event) => setForm((f) => ({ ...f, uomId: event.target.value }))}
            options={units.map((unit) => ({
              value: unit.id,
              label: `${unit.code} — ${unit.name}`,
            }))}
            placeholder={translate(messages, 'inventory.material.create.chooseUom')}
            error={errorFor('uomId')}
          />
          <TextField
            label={translate(messages, 'inventory.material.create.sourceReference')}
            description={translate(messages, 'inventory.material.create.sourceHelp')}
            required
            value={form.sourceReference}
            onChange={(event) => setForm((f) => ({ ...f, sourceReference: event.target.value }))}
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
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'inventory.material.create.submit')}
        </button>
      </div>
    </form>
  );
}
