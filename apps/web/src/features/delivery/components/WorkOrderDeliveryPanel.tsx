'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { SelectField } from '@/components/forms/Field';
import type { Locale } from '@/i18n/config';
import { FailureExplanation } from '@/components/states/States';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic, translateWithValues } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';

import { createDelivery, readWorkOrderDelivery, type DeliveryWriteState } from '../api';
import { listBranches } from '../branch-api';
import type { DeliveryBranchOption } from '../branch-contract';
import type { WorkOrderDelivery } from '../delivery-contract';
import { listEmployees } from '../employee-api';
import {
  ASSIGNABLE_EMPLOYEE_STATUS,
  DELIVERY_START_ERROR_CODES,
  DELIVERY_START_RULES,
  type EmployeeSummary,
} from '../employee-contract';
import { StatusLabel } from './CodeLabel';
import { PRIMARY_BUTTON, PanelFailure } from './PanelShell';

/**
 * The way in from a work order to its handover, and the control that starts one
 * (P1-31, FE-002).
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
 * ## The Start control is back, and what had to exist first
 *
 * It was withheld in PR #362 because `delivering_employee_id` carried no foreign
 * key and no validation: any identifier at all was a legal handover officer, and
 * a control that sent one would have been this tier inventing an identity. The
 * Owner answered that on 2026-09-10 — the delivering employee is a **tenant-owned
 * employee identity**, distinct from a login account, from the authenticated
 * actor and from the authorized receiver, with the reference and its
 * organisational assignment **validated on the server** — and P1-31 prerequisite
 * P-17 built it. The control returns against that contract and against nothing
 * else.
 *
 * ## Three authorities, and each one alone decides a different thing
 *
 * `sal.delivery.manage` decides whether the form is drawn at all. Without it
 * there is no form, not a disabled one: a button whose only outcome is a denial
 * teaches an operator to ignore denials.
 *
 * `org.employee.read` decides whether the register can be OFFERED. Without it
 * the panel says the selection cannot be offered and **issues no read** — asking
 * and being refused would put a denial in the backend's log for a decision this
 * screen could make. It offers no reference field in its place either: an
 * identifier typed into a box is exactly the unvalidated input the withholding
 * existed to prevent, and the read code is the affordance, not the rule.
 *
 * `org.branch.read` decides whether the wider branch directory can be offered,
 * on the same terms: without it no directory read is issued, the panel says so,
 * and the work order's own branch is what the register is read for.
 *
 * ## A home branch is offered first and never enforced
 *
 * The Owner clarified on 2026-09-10 that an employee's home branch must not
 * restrict authorized work in another branch of the same organisation, and the
 * backend carries that literally: the foreign key names the organisation and
 * nothing narrower, and the create service refuses only an unknown employee and
 * a retired one. So the register is read for the work order's own branch first —
 * that is where the colleague usually stands — and the operator can choose
 * another branch of the same company and read that one instead. Narrowing the
 * candidates to one branch and calling it validation would re-impose, in a
 * browser, the restriction the Owner removed from the database.
 *
 * The branch is CHOSEN FROM THE PUBLISHED DIRECTORY, never typed. `org.branch-list`
 * is the read every other picker in this product consumes, and the standing
 * tenancy requirement is that no company or branch identifier is ever typed into
 * a screen — a field demanding one does not merely inconvenience an operator, it
 * makes the cross-branch handover the Owner's clarification protects unreachable
 * in practice. Where the directory cannot be offered the panel states that and
 * falls back to the work order's own branch, which is the branch it would have
 * read anyway.
 *
 * ## Every refusal on screen is the server's own decision
 *
 * `ERR-VAL-001` carries two causes here — an employee this caller cannot resolve
 * and an employee who has been retired — and the problem document's first
 * violation is the only machine-readable statement of which. They are worded
 * apart because they send an operator somewhere different: name somebody else,
 * or have this person reinstated. `ERR-RES-002` means the work order already has
 * a live handover. Everything else keeps the shared wording, and nothing is
 * retried silently.
 */
export function WorkOrderDeliveryPanel({
  locale,
  messages,
  workOrderId,
  companyId,
  branchId,
  canManage = false,
  canReadEmployees = false,
  canReadBranches = false,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  /** The work order's own organisation. The register is read for this one only. */
  readonly companyId: string;
  /** The work order's own branch, offered first and never enforced. */
  readonly branchId: string;
  /** `sal.delivery.manage` — whether the Start form is drawn at all. */
  readonly canManage?: boolean;
  /** `org.employee.read` — whether the register may be offered and read. */
  readonly canReadEmployees?: boolean;
  /** `org.branch.read` — whether the branch directory may be offered and read. */
  readonly canReadBranches?: boolean;
}) {
  const [held, setHeld] = useState<{
    readonly key: string;
    readonly read: ReadState<WorkOrderDelivery>;
  } | null>(null);
  const key = workOrderId;

  useEffect(() => {
    let cancelled = false;
    void readWorkOrderDelivery(workOrderId).then((read) => {
      if (!cancelled) setHeld({ key, read });
    });
    return () => {
      cancelled = true;
    };
  }, [key, workOrderId]);

  // A result for another work order is never shown under this work order.
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
        <PanelFailure
          messages={messages}
          status={state.status}
          correlationId={state.correlationId}
        />
      ) : state.data.delivery === null ? (
        <div className="flex flex-col gap-3">
          <p className="text-body text-text-secondary">
            {translate(messages, 'delivery.workOrder.none')}
          </p>
          {canManage ? (
            <StartHandoverForm
              locale={locale}
              messages={messages}
              workOrderId={workOrderId}
              companyId={companyId}
              branchId={branchId}
              canReadEmployees={canReadEmployees}
              canReadBranches={canReadBranches}
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
 * The register read as one of five outcomes rather than three fields.
 *
 * The shape the inventory branch picker settled on (P1-30 **CC-15**), for the
 * same reason: a list held as `items | null` plus a refused flag cannot tell "the
 * read is in flight" from "the caller may not read the register" — both are
 * `null` — and it cannot tell "nobody is listed" from "somebody is", because an
 * empty list is not absence. A union rather than an added flag, because a flag
 * leaves the contradictory combination representable and that combination IS the
 * defect.
 */
type Candidates =
  /** No `org.employee.read`. No request is issued, and none may be. */
  | { readonly phase: 'not-offered' }
  /** Permitted, and the register has not answered. The only phase with no control. */
  | { readonly phase: 'loading' }
  /** Answered with at least one assignable employee. */
  | { readonly phase: 'listed'; readonly items: readonly EmployeeSummary[] }
  /** Answered, and this branch has nobody who may be named. */
  | { readonly phase: 'none' }
  /** Did not answer. `retry` is absent for a refusal and for an ended session. */
  | {
      readonly phase: 'failed';
      readonly messageKey: string;
      readonly retry: (() => void) | null;
    };

const NOT_OFFERED: Candidates = { phase: 'not-offered' };
const LOADING: Candidates = { phase: 'loading' };
const NOBODY: Candidates = { phase: 'none' };

/**
 * The branch directory in the same five states, and for the same reason.
 *
 * It replaces a text box that asked an operator to type a branch identifier. The
 * standing tenancy requirement is that tenancy comes from the session and no
 * company or branch identifier is ever typed, so the box did not merely read
 * badly — it made the cross-branch handover unreachable for anybody who did not
 * already know an identifier by heart. `org.branch-list` publishes the same
 * directory every other picker in this product reads.
 *
 * Each phase below decides what the form offers, and NONE of them is a fallback
 * to a field: where the directory cannot be offered the work order's own branch
 * is used, which is the branch the register would have been read for anyway.
 */
type BranchDirectory =
  /** No `org.branch.read`. No request is issued, and none may be. */
  | { readonly phase: 'not-offered' }
  /** Permitted, and the directory has not answered. The only phase with no control. */
  | { readonly phase: 'loading' }
  /** Answered with at least one branch of this work order's company. */
  | { readonly phase: 'listed'; readonly items: readonly DeliveryBranchOption[] }
  /** Answered, and this company has no branch this caller may reach. */
  | { readonly phase: 'none' }
  /** Did not answer. `retry` is absent for a refusal and for an ended session. */
  | {
      readonly phase: 'failed';
      readonly messageKey: string;
      readonly retry: (() => void) | null;
    };

const DIRECTORY_NOT_OFFERED: BranchDirectory = { phase: 'not-offered' };
const DIRECTORY_LOADING: BranchDirectory = { phase: 'loading' };
const NO_BRANCH: BranchDirectory = { phase: 'none' };

/**
 * The branches of this work order's company, in the five states the picker can
 * be in.
 *
 * The operation is tenant-wide and every row carries its company, so the
 * narrowing happens here rather than in a second read: a handover belongs to its
 * work order's organisation, and no company may be chosen. That is a DISPLAY
 * narrowing and not a rule — the register read authorizes the pair again before
 * a row is read, and the create operation resolves the chosen person once more.
 */
function useBranchDirectory(canRead: boolean, companyId: string): BranchDirectory {
  const [attempt, setAttempt] = useState(0);
  /** The outcome, TAGGED with the request it answers — see `useEmployees` below. */
  const [held, setHeld] = useState<{
    readonly key: string;
    readonly items: readonly DeliveryBranchOption[] | null;
    readonly failure: { readonly messageKey: string; readonly retryable: boolean } | null;
  } | null>(null);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const key = `${companyId}|${attempt}`;

  useEffect(() => {
    if (!canRead) return;
    let live = true;
    void listBranches().then((result) => {
      if (!live) return;
      if (result.status === 'ok') {
        setHeld({
          key,
          items: result.data.items.filter((branch) => branch.companyId === companyId),
          failure: null,
        });
        return;
      }
      // Three sentences, not one, exactly as the register read below: a refusal
      // keeps its own wording and offers no second attempt, an ended session
      // says so, and everything else is a "not right now".
      const failure =
        result.status === 'denied'
          ? { messageKey: 'delivery.start.branchesRefused', retryable: false }
          : result.status === 'expired'
            ? { messageKey: 'state.expired.message', retryable: false }
            : { messageKey: 'delivery.start.branchesUnavailable', retryable: true };
      setHeld({ key, items: null, failure });
    });
    return () => {
      live = false;
    };
  }, [canRead, companyId, key]);

  // Derived last and in this order: permission, then failure, then arrival, then
  // emptiness — so no caller can read an absent directory as a refusal.
  if (!canRead) return DIRECTORY_NOT_OFFERED;
  const answer = held !== null && held.key === key ? held : null;
  if (answer === null) return DIRECTORY_LOADING;
  if (answer.failure !== null) {
    return {
      phase: 'failed',
      messageKey: answer.failure.messageKey,
      retry: answer.failure.retryable ? retry : null,
    };
  }
  if (answer.items === null || answer.items.length === 0) return NO_BRANCH;
  return { phase: 'listed', items: answer.items };
}

/**
 * The assignable employees of one branch, in the five states the picker can be
 * in.
 *
 * Only the ACTIVE state is asked for: a retired employee is refused by the
 * create operation with its own rule, so offering one is offering a choice whose
 * only outcome is a refusal. It is asked for rather than filtered after arrival,
 * because filtering a page on this side would silently shorten it.
 */
function useEmployees(canRead: boolean, companyId: string, branchId: string): Candidates {
  const [attempt, setAttempt] = useState(0);
  /**
   * The outcome, TAGGED with the request it answers.
   *
   * Not two fields cleared at the top of the effect: clearing state
   * synchronously inside an effect is a cascading render, and the lint rule that
   * says so is right. Tagging is also more honest — a result for the previous
   * branch is not shown under the current one, exactly as the delivery read
   * above refuses a result for another work order.
   */
  const [held, setHeld] = useState<{
    readonly key: string;
    readonly items: readonly EmployeeSummary[] | null;
    readonly failure: { readonly messageKey: string; readonly retryable: boolean } | null;
  } | null>(null);

  // A retry is a NEW attempt, and the attempt is part of the tag — so the
  // previous failure stops matching the moment the button is pressed and the
  // picker returns to its waiting state instead of sitting in its failed one.
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const key = `${companyId}|${branchId}|${attempt}`;

  useEffect(() => {
    if (!canRead) return;
    let live = true;
    void listEmployees({ companyId, branchId, status: ASSIGNABLE_EMPLOYEE_STATUS }).then(
      (result) => {
        if (!live) return;
        if (result.status === 'ok') {
          setHeld({ key, items: result.data.items, failure: null });
          return;
        }
        // Three sentences, not one. A refusal keeps its own wording and offers
        // no second attempt; an ended session says so and offers none either;
        // everything else — too many requests, a timeout, a network fault, a
        // server fault — is a "not right now", which is the only kind a second
        // attempt can clear.
        const failure =
          result.status === 'denied'
            ? { messageKey: 'delivery.start.employeesRefused', retryable: false }
            : result.status === 'expired'
              ? { messageKey: 'state.expired.message', retryable: false }
              : { messageKey: 'delivery.start.employeesUnavailable', retryable: true };
        setHeld({ key, items: null, failure });
      }
    );
    return () => {
      live = false;
    };
  }, [canRead, companyId, branchId, key]);

  // Derived last and in this order: permission, then failure, then arrival, then
  // emptiness. Nothing outside this function observes the raw fields, so no
  // caller can read an absent list as a denial.
  if (!canRead) return NOT_OFFERED;
  const answer = held !== null && held.key === key ? held : null;
  if (answer === null) return LOADING;
  if (answer.failure !== null) {
    return {
      phase: 'failed',
      messageKey: answer.failure.messageKey,
      retry: answer.failure.retryable ? retry : null,
    };
  }
  if (answer.items === null || answer.items.length === 0) return NOBODY;
  return { phase: 'listed', items: answer.items };
}

/**
 * The form that opens a handover.
 *
 * Drawn only for a caller holding `sal.delivery.manage`; the picker inside it is
 * drawn only for a caller who can also read the register. See the component
 * docblock above for why each of those is a separate decision.
 */
function StartHandoverForm({
  locale,
  messages,
  workOrderId,
  companyId,
  branchId,
  canReadEmployees,
  canReadBranches,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly canReadEmployees: boolean;
  readonly canReadBranches: boolean;
}) {
  const [pickedBranch, setPickedBranch] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [sending, setSending] = useState(false);
  const [state, setState] = useState<DeliveryWriteState | null>(null);

  /*
   * Gated on BOTH codes, and the second one is not belt-and-braces. The
   * directory exists to say which branch's register to read; with no register
   * read there is nothing for it to answer, and a request whose result cannot be
   * used is a request that should not be made.
   */
  const directory = useBranchDirectory(canReadBranches && canReadEmployees, companyId);
  const offeredBranches = directory.phase === 'listed' ? directory.items : [];

  /*
   * The default is the work order's OWN branch, and it is derived rather than
   * seeded into state: seeding from a prop would either miss the directory
   * arriving later or need an effect to correct itself, and a chosen branch that
   * is no longer offered would survive both. So a choice counts only while the
   * directory still offers it, the work order's own branch is next, and an empty
   * selection — the directory does not carry this work order's branch — still
   * reads that branch, because it is the one this handover belongs to.
   */
  const selectedBranch = offeredBranches.some((branch) => branch.id === pickedBranch)
    ? pickedBranch
    : offeredBranches.some((branch) => branch.id === branchId)
      ? branchId
      : '';
  const chosenBranch = selectedBranch === '' ? branchId : selectedBranch;
  const candidates = useEmployees(canReadEmployees, companyId, chosenBranch);
  const created = state?.created ?? null;

  // The selected employee must still be one the picker is offering. Reading
  // another branch replaces the whole set, and a value left behind from the
  // previous one would be submitted under a name no longer on screen.
  const offered = candidates.phase === 'listed' ? candidates.items : [];
  const selected = offered.some((employee) => employee.id === employeeId) ? employeeId : '';

  return (
    <div className="flex flex-col gap-3">
      {canReadEmployees ? null : (
        <p className="text-body text-text-secondary">
          {translate(messages, 'delivery.start.employeeSelectionUnavailable')}
        </p>
      )}

      {canReadEmployees ? (
        <form
          aria-label={translate(messages, 'delivery.start.formLabel')}
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (sending || created !== null || selected.length === 0) return;
            setSending(true);
            void createDelivery({ workOrderId, deliveringEmployeeId: selected }).then((outcome) => {
              setState(outcome);
              setSending(false);
            });
          }}
        >
          {directory.phase === 'listed' ? (
            <SelectField
              label={translate(messages, 'delivery.start.branchField')}
              description={translate(messages, 'delivery.start.branchHelp')}
              value={selectedBranch}
              onChange={(event) => setPickedBranch(event.target.value)}
              options={directory.items.map((branch) => ({
                value: branch.id,
                label: branch.name,
              }))}
              placeholder={translate(messages, 'delivery.start.branchPlaceholder')}
            />
          ) : directory.phase === 'loading' ? (
            <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
          ) : directory.phase === 'none' ? (
            <p className="text-caption text-text-muted">
              {translate(messages, 'delivery.start.branchesNone')}
            </p>
          ) : directory.phase === 'failed' ? (
            <p role="alert" className="flex flex-col gap-2 text-body text-error">
              {translateDynamic(messages, directory.messageKey)}
              {directory.retry === null ? null : (
                <span>
                  <button
                    type="button"
                    className="text-primary underline-offset-2 hover:underline"
                    onClick={directory.retry}
                  >
                    {translate(messages, 'delivery.start.employeesRetry')}
                  </button>
                </span>
              )}
            </p>
          ) : (
            <p className="text-caption text-text-muted">
              {translate(messages, 'delivery.start.branchesNotOffered')}
            </p>
          )}

          {candidates.phase === 'listed' ? (
            <SelectField
              label={translate(messages, 'delivery.start.employeeField')}
              description={translate(messages, 'delivery.start.employeeHelp')}
              value={selected}
              onChange={(event) => setEmployeeId(event.target.value)}
              options={candidates.items.map((employee) => ({
                value: employee.id,
                // The employment reference is shown beside the name when the
                // register carries one, so two colleagues who share a name can
                // be told apart. It is an opaque reference and is never resolved.
                label:
                  employee.employmentRef === null
                    ? employee.displayName
                    : `${employee.displayName} — ${employee.employmentRef}`,
              }))}
              placeholder={translate(messages, 'delivery.start.employeePlaceholder')}
            />
          ) : candidates.phase === 'loading' ? (
            <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
          ) : candidates.phase === 'none' ? (
            <p className="text-caption text-text-muted">
              {translate(messages, 'delivery.start.noEmployees')}
            </p>
          ) : candidates.phase === 'failed' ? (
            <p role="alert" className="flex flex-col gap-2 text-body text-error">
              {translateDynamic(messages, candidates.messageKey)}
              {candidates.retry === null ? null : (
                <span>
                  <button
                    type="button"
                    className="text-primary underline-offset-2 hover:underline"
                    onClick={candidates.retry}
                  >
                    {translate(messages, 'delivery.start.employeesRetry')}
                  </button>
                </span>
              )}
            </p>
          ) : null}

          <div>
            <button
              type="submit"
              className={PRIMARY_BUTTON}
              disabled={sending || created !== null || selected.length === 0}
            >
              {translate(messages, 'delivery.start.submit')}
            </button>
          </div>
        </form>
      ) : null}

      {created === null ? null : (
        <p role="status" className="text-body text-text-primary">
          {/*
            The name the SERVER stamped, not the one the picker showed. They are
            the same text today and the authority is not: a completed handover is
            attributed from the stored snapshot, and quoting the request back
            would make the screen the author of its own confirmation.
          */}
          {translate(messages, 'delivery.start.done')}{' '}
          {created.deliveringEmployeeDisplayName === null
            ? null
            : `${translate(messages, 'delivery.start.recordedFor')} ${created.deliveringEmployeeDisplayName}. `}
          <Link
            href={`/${locale}/delivery/${created.id}`}
            className="text-primary underline-offset-2 hover:underline"
          >
            {translate(messages, 'delivery.workOrder.open')}
          </Link>
        </p>
      )}

      {state !== null && state.status !== 'success' ? (
        <p role="alert" className="text-body text-error">
          {translateWithValues(messages, refusalKeyFor(state), state.messageValues)}
          <FailureExplanation messages={messages} messageKey={refusalKeyFor(state)} />
          {state.correlationId ? (
            <>
              {' '}
              <span className="text-caption text-text-muted">
                {translate(messages, 'state.correlationId')}{' '}
                <code className="font-mono" dir="ltr">
                  {state.correlationId}
                </code>
              </span>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The sentence a refused start is reported with.
 *
 * Read off the catalogue code the problem document carried, and — for the one
 * code that carries two causes — off the first violation's rule. Nothing else is
 * branched on, and no sentence is composed beyond what the document states:
 * anything the server did not distinguish keeps the shared wording the rest of
 * the product uses for a failed action.
 */
function refusalKeyFor(state: DeliveryWriteState): string {
  if (state.code === DELIVERY_START_ERROR_CODES.alreadyStarted) {
    return 'delivery.start.refusedAlreadyStarted';
  }
  if (state.code === DELIVERY_START_ERROR_CODES.denied) return 'delivery.start.refusedDenied';
  if (state.code === DELIVERY_START_ERROR_CODES.refusedEmployee) {
    if (state.rule === DELIVERY_START_RULES.retired) return 'delivery.start.refusedRetired';
    if (state.rule === DELIVERY_START_RULES.unknown) return 'delivery.start.refusedUnknown';
  }
  return state.messageKey ?? 'action.failed';
}
