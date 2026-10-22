'use client';

/**
 * The quality and closure view of one work order (P1-29 W8).
 *
 * Six panels, each on the operation and the code that owns it, each reading
 * its own truth and re-reading after its own writes:
 *
 * - **The closure gate** — `wo.work-order-closure-eligibility`, rendered as the
 *   backend states it: each blocker `B1..B6` in the reader's language, keyed by
 *   its code, and the stock the order still holds. The screen invents no rule;
 *   it shows the ones the platform has.
 * - **QC records** — `qms.qc-record-list` / `-open` / `-detail`; each record's
 *   checklist is a JOIN of the vocabulary (`qms.qc-check-list`, W8's one Backend
 *   read) with the record's results, so an unanswered check is visible as
 *   unanswered and every result is addressed to the check's id; `-check-result`
 *   per check and `-finalize` with the record's `If-Match`.
 * - **Rework** — `qms.rework-list` / `-create` / `-sign-off` (`If-Match`); the
 *   cost only with `iam.sensitive.view` (`-cost-read` / `-cost-record`).
 * - **Reopen attempts** — `qms.reopen-attempt-list` / `-attempt`: an
 *   append-only log; the OUTCOME is the backend's, never the screen's.
 * - **Additional work** — `wo.additional-work-list` / `-request` /
 *   `-approval-read` / `-approval` (`If-Match`) / `-fulfillment` / `-withdraw`;
 *   the description only with `iam.sensitive.view`.
 * - **Closure** — `wo.work-order-closure` with the order's `If-Match`, to a
 *   terminal, non-cancelling state the order's own `nextStates` name.
 *
 * Every version-guarded command hands its outcome onward so the version the
 * screen holds is renewed. Submit-for-QA is not here: it is
 * `wo.work-order-transition` on the detail, to whichever state the catalogue
 * permits.
 *
 * ## On the shared Material wrappers (ADR-022, Owner directive slice 4)
 *
 * - **Fields** are `forms/mui/*` with the `FieldFrame` contract: a missing
 *   answer is refused on its own field (red, the sentence beside it, the cursor
 *   moved to the first), where the forms here used to return silently from a
 *   press; a refusal from the service lands on the field it names; a complaint
 *   goes once its field changes; what was typed survives every refusal.
 * - **Decisions are asked**: finalizing a quality check and closing the order
 *   are `ConfirmDialog`s — neither can be walked back here — and a reopen
 *   attempt and a withdrawal take their reason through `ReasonDialog`.
 * - **Every command stays busy until the re-read it caused has landed**
 *   (`useReread`): the screen's reads and the panel's own. A second press in
 *   between would re-send a write, or send a version the re-read is about to
 *   replace.
 * - **Every read failure is its own state** (`MuiReadFailureState`): an outage
 *   — a throttled or unanswered service included — offers a retry, a refusal
 *   does not.
 * - **Every state is said in words** — the order's (`workOrderStateLabel`), an
 *   extra-work request's and its fulfilment's — never the code (browser QA row
 *   B.S3); the order is named by its number, never its reference.
 */
import Link from 'next/link';
import { useCallback, useState } from 'react';
import Button from '@mui/material/Button';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { ReasonDialog } from '@/components/dialogs/ReasonDialog';
import { FormCheckboxField } from '@/components/forms/mui/FormCheckboxField';
import { FormNumberField } from '@/components/forms/mui/FormNumberField';
import { FormRadioGroupField } from '@/components/forms/mui/FormRadioGroupField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiEmptyState, MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import { readWorkOrderDetail } from '@/features/work-orders/api';
import {
  WORK_ORDER_REFUSAL_KEYS,
  workOrderStateLabel,
  type WorkOrderDetail,
} from '@/features/work-orders/work-orders-contract';
import { useReread } from '@/lib/api/use-reread';
import type { ReadState } from '@/lib/api/read-operation';
import type { ActionState } from '@/lib/forms/action-result';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate, translateDynamic } from '@/i18n/get-messages';
import {
  closeWorkOrder,
  createRework,
  finalizeQcRecord,
  fulfillAdditionalWork,
  listAdditionalWork,
  listQcChecks,
  listQcRecords,
  listReopenAttempts,
  listReworkLinks,
  openQcRecord,
  raiseReopenAttempt,
  readAdditionalWorkApproval,
  readAdditionalWorkDetail,
  readClosureEligibility,
  readQcRecord,
  readReworkCost,
  recordAdditionalWorkApproval,
  recordAdditionalWorkDetail,
  recordReworkCost,
  requestAdditionalWork,
  signOffRework,
  withdrawAdditionalWork,
  writeQcCheckResult,
} from '../api';
import {
  unattachedRefusalKey,
  type AdditionalWorkRequest,
  type ClosureBlocker,
  type ClosureEligibility,
  type QcCheckVocabularyEntry,
  type ReworkLink,
} from '../quality-contract';
import { useHeldRefusal } from '@/lib/forms/use-local-refusal';

const CHECK_RESULTS = ['pass', 'fail', 'na'] as const;
const OVERALL_RESULTS = ['passed', 'failed'] as const;
const DECISIONS = ['approved', 'rejected'] as const;
const CHANNELS = ['in_person', 'phone', 'email', 'sms', 'portal', 'other'] as const;
const FULFILLMENT = ['fulfilled', 'waived'] as const;
/** `wo.additional_work_requests.state`'s CHECK vocabulary. */
const REQUEST_STATES = ['pending', 'approved', 'rejected', 'withdrawn'];
/** `wo.additional_work_requests.fulfillment_state`'s CHECK vocabulary. */
const FULFILLMENT_STATES = ['unfulfilled', 'fulfilled', 'waived'];

export interface ClosureCapabilities {
  readonly canReadQc: boolean;
  readonly canRecordQc: boolean;
  readonly canFinalizeQc: boolean;
  readonly canManageRework: boolean;
  readonly canSignOffRework: boolean;
  readonly canTransition: boolean;
  readonly canClose: boolean;
  readonly canRequestAdditionalWork: boolean;
  readonly canApproveAdditionalWork: boolean;
  readonly canViewSensitive: boolean;
}

/** What a panel is told to re-read the screen with, awaited by the command that asked. */
type Renew = () => Promise<void>;

/**
 * The sentence a refused command shows on this screen.
 *
 * A conflict used to be printed as one fixed line — "this record cannot take
 * that change" — for every refusal the work-order services raise, which covers
 * an order closed to new work, parts still reserved, a customer who has not
 * agreed and a dozen more, each with a different cure. The services now name
 * the rule they refused on (Owner directive, user-facing errors), and this
 * prefers that sentence when it is one the screen has been told about.
 *
 * Membership, not trust: a token missing from `WORK_ORDER_REFUSAL_KEYS` falls
 * back to the fixed sentence rather than being rendered, so an unfamiliar rule
 * can never put a raw name in front of a service adviser.
 */
function problemKeyOf(result: ActionState): string {
  if (result.status === 'conflict') {
    const stated = result.messageKey;
    return stated !== undefined && WORK_ORDER_REFUSAL_KEYS.includes(stated)
      ? stated
      : 'quality.closure.conflict';
  }
  return result.messageKey ?? 'action.failed';
}

/** A read's failure as its own state, with a retry where one can help. */
function ReadProblem({
  locale,
  messages,
  state,
  onRetry,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly state: Exclude<ReadState<unknown>, { readonly status: 'ok' }>;
  readonly onRetry: () => void;
}) {
  return (
    <MuiReadFailureState
      messages={messages}
      locale={locale}
      status={state.status}
      correlationId={state.correlationId}
      onRetry={onRetry}
    />
  );
}

function Problem({
  messages,
  problem,
  onReload,
}: {
  readonly messages: Messages;
  readonly problem: string | null;
  /** Offered with the fixed conflict sentence: re-read what this view holds. */
  readonly onReload?: (() => void) | undefined;
}) {
  if (problem === null) return null;
  return (
    <div className="flex basis-full flex-wrap items-center gap-3">
      <p role="alert" className="text-body text-error">
        {translateDynamic(messages, problem)}
      </p>
      {onReload !== undefined && problem === 'quality.closure.conflict' ? (
        <Button type="button" variant="outlined" size="small" onClick={onReload}>
          {translate(messages, 'form.loadLatest')}
        </Button>
      ) : null}
    </div>
  );
}

function Panel({
  id,
  titleKey,
  messages,
  children,
}: {
  readonly id: string;
  readonly titleKey: string;
  readonly messages: Messages;
  readonly children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="rounded-lg border border-border bg-surface p-4">
      <h2 id={id} className="mb-3 text-section-title font-medium text-text-primary">
        {translateDynamic(messages, titleKey)}
      </h2>
      {children}
    </section>
  );
}

/** A form's one submit, saying "Working…" while its write — and its re-read — is in flight. */
function Submit({
  messages,
  pending,
  labelKey,
  variant = 'contained',
  disabled = false,
}: {
  readonly messages: Messages;
  readonly pending: boolean;
  readonly labelKey: string;
  readonly variant?: 'contained' | 'outlined';
  readonly disabled?: boolean;
}) {
  return (
    <Button
      type="submit"
      variant={variant}
      disabled={pending || disabled}
      aria-busy={pending || undefined}
    >
      {pending ? translate(messages, 'form.pending') : translateDynamic(messages, labelKey)}
    </Button>
  );
}

/**
 * The shared settle-and-report of every command form: pending, problem, and the
 * refusal's field errors.
 *
 * `run` awaits the write AND the re-read it causes (`onDone`) before it lets go
 * of `pending`, inside a `finally`, so a rejected promise never leaves a form
 * saying "Working…" for ever.
 *
 * A refusal that names a control no form here renders — the closure refused
 * blocker by blocker is the one that reaches this — is preferred over the
 * generic banner, because it is the only thing in the response that says what
 * was wrong. `unattachedRefusalKey` recognises a short list, so anything else
 * leaves the banner exactly as it was. `rendered` names the controls the
 * calling form really does show, so a sentence that already sits beside a
 * control is never repeated in the banner.
 */
function useCommand(messages: Messages, onDone: Renew, rendered: readonly string[] = []) {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const run = async (action: () => Promise<ActionState>): Promise<boolean> => {
    setPending(true);
    setProblem(null);
    setFieldErrors({});
    try {
      let outcome: ActionState;
      try {
        outcome = await action();
      } catch {
        setProblem('state.unavailable.message');
        return false;
      }
      notifyActionResult(outcome, messages);
      if (outcome.status === 'success') {
        await onDone();
        return true;
      }
      setFieldErrors(outcome.fieldErrors ?? {});
      setProblem(unattachedRefusalKey(outcome.fieldErrors, rendered) ?? problemKeyOf(outcome));
      return false;
    } finally {
      setPending(false);
    }
  };
  return { pending, problem, setProblem, fieldErrors, setFieldErrors, run } as const;
}

export function WorkOrderClosureScreen({
  locale,
  messages,
  workOrderId,
  capabilities,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  readonly capabilities: ClosureCapabilities;
}) {
  const readDetail = useCallback(() => readWorkOrderDetail(workOrderId), [workOrderId]);
  const readEligibility = useCallback(() => readClosureEligibility(workOrderId), [workOrderId]);
  const detailRead = useReread(readDetail);
  const eligibilityRead = useReread(readEligibility);
  const detail = detailRead.value;
  const eligibility = eligibilityRead.value;
  const reloadDetail = detailRead.reload;
  const reloadEligibility = eligibilityRead.reload;

  /** The order and its gate, read again — every panel's writes move them. */
  const reload = useCallback(async () => {
    await Promise.all([reloadDetail(), reloadEligibility()]);
  }, [reloadDetail, reloadEligibility]);

  return (
    <div className="flex flex-col gap-6">
      <GatePanel
        locale={locale}
        messages={messages}
        eligibility={eligibility}
        detail={detail}
        onRetry={() => void reload()}
      />
      {capabilities.canReadQc ? (
        <QcPanel
          locale={locale}
          messages={messages}
          workOrderId={workOrderId}
          capabilities={capabilities}
          onChanged={reload}
        />
      ) : null}
      {capabilities.canReadQc ? (
        <ReworkPanel
          locale={locale}
          messages={messages}
          workOrderId={workOrderId}
          capabilities={capabilities}
          terminal={eligibility?.status === 'ok' ? eligibility.data.alreadyTerminal : null}
          onChanged={reload}
        />
      ) : null}
      {capabilities.canReadQc ? (
        <ReopenPanel
          locale={locale}
          messages={messages}
          workOrderId={workOrderId}
          capabilities={capabilities}
          onChanged={reload}
        />
      ) : null}
      <AdditionalWorkPanel
        locale={locale}
        messages={messages}
        workOrderId={workOrderId}
        detail={detail}
        capabilities={capabilities}
        onChanged={reload}
      />
      <ClosurePanel
        messages={messages}
        workOrderId={workOrderId}
        detail={detail}
        eligibility={eligibility}
        capabilities={capabilities}
        onDone={reload}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ gate */

/** The six guard blockers the platform defines, each with its own sentence. */
const CLOSURE_BLOCKER_KEYS: Readonly<Record<string, string>> = {
  B1: 'quality.closure.blocker.B1',
  B2: 'quality.closure.blocker.B2',
  B3: 'quality.closure.blocker.B3',
  B4: 'quality.closure.blocker.B4',
  B5: 'quality.closure.blocker.B5',
  B6: 'quality.closure.blocker.B6',
};

/**
 * What stands between the order and its closure, in the reader's language.
 *
 * Keyed by the blocker's CODE, never by its prose: the backend's `message` is
 * English whatever the reader's language. A code this build has not been told
 * about falls back to the backend's sentence, which is still plain language —
 * never to the code itself.
 */
export function closureBlockerText(messages: Messages, blocker: ClosureBlocker): string {
  const key = CLOSURE_BLOCKER_KEYS[blocker.code];
  return key === undefined ? blocker.message : translateDynamic(messages, key);
}

/** A work-order state in words; a workshop's own code keeps its code. */
function orderStateText(messages: Messages, code: string): string {
  return workOrderStateLabel(code, [], (key) => translateDynamic(messages, key));
}

function GatePanel({
  locale,
  messages,
  eligibility,
  detail,
  onRetry,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly eligibility: ReadState<ClosureEligibility> | null;
  readonly detail: ReadState<WorkOrderDetail> | null;
  readonly onRetry: () => void;
}) {
  return (
    <Panel id="closure-gate-heading" titleKey="quality.closure.gateHeading" messages={messages}>
      {detail?.status === 'ok' ? (
        <p className="mb-2 text-body text-text-secondary" data-testid="closure-order">
          {detail.data.workOrder.displayNumber ? (
            <code className="font-mono" dir="ltr">
              {detail.data.workOrder.displayNumber}
            </code>
          ) : (
            // Never the internal reference: a reference slot showing one reads
            // as the work order's number.
            translate(messages, 'workOrders.queue.column.noReference')
          )}{' '}
          · <bdi>{orderStateText(messages, detail.data.workOrder.state)}</bdi>
        </p>
      ) : null}
      {eligibility === null ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : eligibility.status !== 'ok' ? (
        <ReadProblem locale={locale} messages={messages} state={eligibility} onRetry={onRetry} />
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-body font-medium text-text-primary">
            {translate(
              messages,
              eligibility.data.alreadyTerminal
                ? 'quality.closure.alreadyTerminal'
                : eligibility.data.eligible
                  ? 'quality.closure.eligible'
                  : 'quality.closure.notEligible'
            )}
          </p>
          {eligibility.data.blockers.length === 0 ? null : (
            <ul className="flex flex-col gap-1">
              {eligibility.data.blockers.map((blocker) => (
                <li
                  key={blocker.code}
                  data-blocker={blocker.code}
                  className="text-body text-text-primary"
                >
                  {closureBlockerText(messages, blocker)}
                </li>
              ))}
            </ul>
          )}
          {/*
            The eligibility read still publishes `deferred` — the name of the
            phase that once owned the stock conditions and why they were not
            enforced yet. It is a note for developers, and it stopped being true
            when `inventoryCommitments` below started answering for exactly
            those two conditions, so it is not drawn for an operator (Browser QA
            part 7, row 2.10). The blocker's enforcing database object is not
            drawn for the same reason: the sentence says what to do, the object
            name says nothing to the person doing it.
          */}
          {eligibility.data.inventoryCommitments.blocking ? (
            <p className="text-body text-text-primary">
              {translate(messages, 'quality.closure.inventoryBlocking')}
              <span className="text-caption text-text-muted">
                {' '}
                · {translate(messages, 'quality.closure.activeReservations')}{' '}
                <span dir="ltr">{eligibility.data.inventoryCommitments.activeReservations}</span> ·{' '}
                {translate(messages, 'quality.closure.openIssues')}{' '}
                <span dir="ltr">{eligibility.data.inventoryCommitments.openIssues}</span>
              </span>
            </p>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------- qc */

function QcPanel({
  locale,
  messages,
  workOrderId,
  capabilities,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  readonly capabilities: ClosureCapabilities;
  readonly onChanged: Renew;
}) {
  const readRecords = useCallback(() => listQcRecords(workOrderId), [workOrderId]);
  const records = useReread(readRecords);
  const checks = useReread(listQcChecks);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  /*
   * Unsaved work, declared to the shell, so a branch changed in the header asks
   * before it discards what is typed here. The work order is not addressed to
   * the working branch and nothing here is keyed on it, so a confirmed discard
   * empties the draft itself — the question said it would go.
   */
  useUnsavedGuard(notes.trim().length > 0, () => setNotes(''));
  const reloadRecords = records.reload;
  const renew = useCallback(async () => {
    await Promise.all([reloadRecords(), onChanged()]);
  }, [reloadRecords, onChanged]);
  const { pending, problem, run } = useCommand(messages, renew);

  const list = records.value;

  return (
    <Panel id="qc-heading" titleKey="quality.closure.qcHeading" messages={messages}>
      {capabilities.canRecordQc ? (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (pending) return;
            void (async () => {
              const ok = await run(() =>
                openQcRecord(workOrderId, notes.trim().length > 0 ? { notes: notes.trim() } : {})
              );
              if (ok) setNotes('');
            })();
          }}
          className="mb-3 flex flex-wrap items-start gap-3"
        >
          <FormTextField
            name="notes"
            label={translate(messages, 'quality.closure.qcNotes')}
            value={notes}
            onChange={setNotes}
          />
          <Submit messages={messages} pending={pending} labelKey="quality.closure.openQc" />
          <Problem messages={messages} problem={problem} />
        </form>
      ) : null}
      {list === null ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : list.status !== 'ok' ? (
        <ReadProblem
          locale={locale}
          messages={messages}
          state={list}
          onRetry={() => void records.reload()}
        />
      ) : list.data.items.length === 0 ? (
        <MuiEmptyState
          messages={messages}
          titleKey="quality.closure.noQcTitle"
          descriptionKey="quality.closure.noQcBody"
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.data.items.map((record) => (
            <li key={record.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-body font-medium text-text-primary">
                  {translateDynamic(messages, `quality.result.${record.overallResult}`)}
                </span>
                {record.finalizedAt ? (
                  <span className="text-caption text-text-muted">
                    {translate(messages, 'quality.queue.finalizedAt')}{' '}
                    <bdi>{formatDateTime(record.finalizedAt, locale)}</bdi>
                  </span>
                ) : null}
                <Button
                  type="button"
                  size="small"
                  variant="text"
                  onClick={() => setOpenId(openId === record.id ? null : record.id)}
                  aria-expanded={openId === record.id}
                  className="ms-auto"
                >
                  {translate(
                    messages,
                    openId === record.id
                      ? 'quality.closure.closeRecord'
                      : 'quality.closure.openRecord'
                  )}
                </Button>
              </div>
              {openId === record.id ? (
                <QcRecordWorkbench
                  locale={locale}
                  messages={messages}
                  recordId={record.id}
                  checks={checks.value}
                  onRetryChecks={() => void checks.reload()}
                  capabilities={capabilities}
                  onChanged={renew}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function QcRecordWorkbench({
  locale,
  messages,
  recordId,
  checks,
  onRetryChecks,
  capabilities,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly recordId: string;
  readonly checks: ReadState<{ readonly items: readonly QcCheckVocabularyEntry[] }> | null;
  readonly onRetryChecks: () => void;
  readonly capabilities: ClosureCapabilities;
  readonly onChanged: Renew;
}) {
  const readRecord = useCallback(() => readQcRecord(recordId), [recordId]);
  const record = useReread(readRecord);
  const [pendingCheck, setPendingCheck] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const detail = record.value;
  if (detail === null) {
    return (
      <div className="mt-3">
        <MuiLoadingState messages={messages} variant="inline" />
      </div>
    );
  }
  if (detail.status !== 'ok') {
    return (
      <div className="mt-3">
        <ReadProblem
          locale={locale}
          messages={messages}
          state={detail}
          onRetry={() => void record.reload()}
        />
      </div>
    );
  }
  const data = detail.data;
  const open = data.record.finalizedAt === null;
  const vocabulary = checks?.status === 'ok' ? checks.data.items : [];

  /** Records one check's answer, and waits for the record to be read again. */
  const answer = async (qcCheckId: string, result: string, note: string): Promise<boolean> => {
    setPendingCheck(qcCheckId);
    setProblem(null);
    try {
      let outcome: ActionState;
      try {
        outcome = await writeQcCheckResult(recordId, qcCheckId, {
          result: result as (typeof CHECK_RESULTS)[number],
          ...(note.trim().length > 0 ? { note: note.trim() } : {}),
        });
      } catch {
        setProblem('state.unavailable.message');
        return false;
      }
      notifyActionResult(outcome, messages);
      if (outcome.status === 'success') {
        await record.reload();
        return true;
      }
      setProblem(problemKeyOf(outcome));
      return false;
    } finally {
      setPendingCheck(null);
    }
  };

  return (
    <div className="mt-3 flex flex-col gap-3">
      {data.unresolvedMandatory.length > 0 ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'quality.closure.unresolvedMandatory')}{' '}
          {/* The checks by NAME, as the checklist below names them. */}
          {data.unresolvedMandatory.map((check) => check.name).join(', ')}
        </p>
      ) : null}
      {checks === null ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : checks.status !== 'ok' ? (
        <ReadProblem locale={locale} messages={messages} state={checks} onRetry={onRetryChecks} />
      ) : (
        <ol className="flex flex-col gap-2">
          {vocabulary.map((check) => {
            const result = data.results.find((r) => r.qcCheckId === check.id) ?? null;
            return (
              <li key={check.id} className="rounded-md bg-surface-subtle px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-body text-text-primary">
                    <bdi>{check.name}</bdi>
                  </span>
                  <span className="text-caption text-text-muted">
                    {check.isMandatory ? translate(messages, 'quality.closure.mandatory') : ''}
                    {check.isSafetyCritical
                      ? ` · ${translate(messages, 'quality.closure.safetyCritical')}`
                      : ''}
                    {check.status !== 'active'
                      ? ` · ${translateDynamic(messages, `quality.checkStatus.${check.status}`)}`
                      : ''}
                  </span>
                  <span
                    className="ms-auto text-caption text-text-secondary"
                    data-testid="check-result"
                  >
                    {result === null
                      ? translate(messages, 'quality.closure.unanswered')
                      : `${translateDynamic(messages, `quality.checkResult.${result.result}`)}${result.note ? ` — ${result.note}` : ''}`}
                  </span>
                </div>
                {open && capabilities.canRecordQc && check.status === 'active' ? (
                  <CheckAnswerForm
                    messages={messages}
                    check={check}
                    pending={pendingCheck === check.id}
                    busy={pendingCheck !== null}
                    onSubmit={(value, note) => answer(check.id, value, note)}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      <Problem messages={messages} problem={problem} onReload={() => void record.reload()} />
      {open && capabilities.canFinalizeQc ? (
        <FinalizeForm
          messages={messages}
          recordId={recordId}
          recordVersion={data.record.recordVersion}
          onDone={async () => {
            await Promise.all([record.reload(), onChanged()]);
          }}
        />
      ) : null}
    </div>
  );
}

function CheckAnswerForm({
  messages,
  check,
  pending,
  busy,
  onSubmit,
}: {
  readonly messages: Messages;
  readonly check: QcCheckVocabularyEntry;
  readonly pending: boolean;
  readonly busy: boolean;
  readonly onSubmit: (result: string, note: string) => Promise<boolean>;
}) {
  const [result, setResult] = useState('');
  const [note, setNote] = useState('');
  /*
   * The result that was last RECORDED, not merely chosen.
   *
   * The result is deliberately retained after a successful submit, so the
   * operator keeps looking at the answer they have just recorded rather than an
   * empty choice. So "the draft is non-empty" is not the same question as
   * "there is unsaved work" here, and using the first for the second left the
   * guard permanently dirty — the shell asked about every later branch switch
   * for a check that was saved.
   *
   * Comparing against what was recorded answers the real question: a result the
   * operator has changed SINCE the save is unsaved work; the same one is not.
   */
  const [savedResult, setSavedResult] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const { errors, formRef } = useHeldRefusal(fieldErrors, { result });

  /*
   * Unsaved work, declared to the shell, so a branch changed in the header asks
   * before it discards what is typed here. The work order is not addressed to
   * the working branch and nothing here is keyed on it, so a confirmed discard
   * puts back the recorded result and empties the note — the question said it would go.
   */
  useUnsavedGuard(result !== (savedResult ?? '') || note.trim().length > 0, () => {
    setResult(savedResult ?? '');
    setNote('');
    setFieldErrors({});
  });

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        if (!result) {
          setFieldErrors({ result: 'field.required' });
          return;
        }
        setFieldErrors({});
        void onSubmit(result, note).then((stored) => {
          if (!stored) return;
          setSavedResult(result);
          setNote('');
        });
      }}
      className="mt-2 flex flex-wrap items-start gap-3"
    >
      <FormRadioGroupField
        name={`result-${check.id}`}
        label={translate(messages, 'quality.closure.checkResult')}
        value={result}
        onChange={setResult}
        required
        options={CHECK_RESULTS.map((value) => ({
          value,
          label: translate(messages, `quality.checkResult.${value}`),
        }))}
        error={errors['result'] ? translateDynamic(messages, errors['result']) : undefined}
      />
      <FormTextField
        name={`note-${check.id}`}
        label={translate(messages, 'quality.closure.note')}
        value={note}
        onChange={setNote}
      />
      <Submit
        messages={messages}
        pending={pending}
        disabled={busy && !pending}
        labelKey="quality.closure.record"
        variant="outlined"
      />
    </form>
  );
}

function FinalizeForm({
  messages,
  recordId,
  recordVersion,
  onDone,
}: {
  readonly messages: Messages;
  readonly recordId: string;
  readonly recordVersion: number;
  readonly onDone: Renew;
}) {
  const [overallResult, setOverallResult] = useState('');
  const [notes, setNotes] = useState('');
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const { errors, formRef } = useHeldRefusal(fieldErrors, { overallResult });
  /*
   * Unsaved work, declared to the shell, so a branch changed in the header asks
   * before it discards what is typed here. The work order is not addressed to
   * the working branch and nothing here is keyed on it, so a confirmed discard
   * empties the draft itself — the question said it would go.
   */
  useUnsavedGuard(overallResult.length > 0 || notes.trim().length > 0, () => {
    setOverallResult('');
    setNotes('');
    setProblem(null);
    setFieldErrors({});
  });

  /*
   * Version-guarded on the record's version as this form was rendered from it;
   * `onDone` re-reads the record and the order, so the next command carries the
   * renewed version rather than a stale one — and the dialog stays busy until
   * that re-read has landed.
   */
  const finalize = async () => {
    setPending(true);
    setProblem(null);
    try {
      let outcome: ActionState;
      try {
        outcome = await finalizeQcRecord(
          recordId,
          {
            overallResult: overallResult as (typeof OVERALL_RESULTS)[number],
            ...(notes.trim().length > 0 ? { notes: notes.trim() } : {}),
          },
          recordVersion
        );
      } catch {
        setProblem('state.unavailable.message');
        return;
      }
      notifyActionResult(outcome, messages);
      if (outcome.status === 'success') {
        await onDone();
        setOverallResult('');
        setNotes('');
        return;
      }
      setProblem(problemKeyOf(outcome));
    } finally {
      setPending(false);
      setAsking(false);
    }
  };

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        if (!overallResult) {
          setFieldErrors({ overallResult: 'field.required' });
          return;
        }
        setFieldErrors({});
        setAsking(true);
      }}
      className="flex flex-wrap items-start gap-3 rounded-md border border-dashed border-border p-3"
    >
      <span className="basis-full text-caption font-medium text-text-secondary">
        {translate(messages, 'quality.closure.finalizeHeading')}
      </span>
      <FormRadioGroupField
        name={`overallResult-${recordId}`}
        label={translate(messages, 'quality.closure.overallResult')}
        value={overallResult}
        onChange={setOverallResult}
        required
        options={OVERALL_RESULTS.map((value) => ({
          value,
          label: translate(messages, `quality.result.${value}`),
        }))}
        error={
          errors['overallResult'] ? translateDynamic(messages, errors['overallResult']) : undefined
        }
      />
      <FormTextField
        name={`finalizeNotes-${recordId}`}
        label={translate(messages, 'quality.closure.note')}
        value={notes}
        onChange={setNotes}
      />
      <Submit messages={messages} pending={pending} labelKey="quality.closure.finalize" />
      <Problem messages={messages} problem={problem} onReload={() => void onDone()} />
      <ConfirmDialog
        open={asking}
        onCancel={() => setAsking(false)}
        onConfirm={() => void finalize()}
        title={translate(messages, 'quality.closure.confirmFinalizeTitle')}
        description={formatMessage(translate(messages, 'quality.closure.confirmFinalizeBody'), {
          result: overallResult
            ? translateDynamic(messages, `quality.result.${overallResult}`)
            : '',
        })}
        confirmLabel={translate(messages, 'quality.closure.finalize')}
        messages={messages}
        pending={pending}
        testId="qc-finalize-confirm"
      />
    </form>
  );
}

/* ---------------------------------------------------------------- rework */

interface ReworkDraft {
  readonly rootCause: string;
  readonly correctiveAction: string;
  readonly responsibility: string;
  readonly leadTechnicianId: string;
  readonly safetyCritical: boolean;
}

const EMPTY_REWORK: ReworkDraft = {
  rootCause: '',
  correctiveAction: '',
  responsibility: '',
  leadTechnicianId: '',
  safetyCritical: false,
};

function ReworkPanel({
  locale,
  messages,
  workOrderId,
  capabilities,
  terminal,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  readonly capabilities: ClosureCapabilities;
  /** The gate's `alreadyTerminal`; rework corrects a closed order, so the form waits for it. `null` while unknown. */
  readonly terminal: boolean | null;
  readonly onChanged: Renew;
}) {
  const readLinks = useCallback(() => listReworkLinks(workOrderId), [workOrderId]);
  const links = useReread(readLinks);
  const [draft, setDraft] = useState<ReworkDraft>(EMPTY_REWORK);
  const [localErrors, setLocalErrors] = useState<Readonly<Record<string, string>>>({});
  const set = <K extends keyof ReworkDraft>(field: K, value: ReworkDraft[K]) =>
    setDraft((current) => ({ ...current, [field]: value }));
  /*
   * Unsaved work, declared to the shell, so a branch changed in the header asks
   * before it discards what is typed here. The work order is not addressed to
   * the working branch and nothing here is keyed on it, so a confirmed discard
   * empties the draft itself — the question said it would go.
   */
  useUnsavedGuard(
    draft.rootCause.trim().length > 0 ||
      draft.correctiveAction.trim().length > 0 ||
      draft.responsibility.trim().length > 0 ||
      draft.leadTechnicianId.trim().length > 0 ||
      draft.safetyCritical,
    () => {
      setDraft(EMPTY_REWORK);
      setLocalErrors({});
    }
  );
  const reloadLinks = links.reload;
  const renew = useCallback(async () => {
    await Promise.all([reloadLinks(), onChanged()]);
  }, [reloadLinks, onChanged]);
  const command = useCommand(messages, renew, [
    'rootCause',
    'correctiveAction',
    'responsibility',
    'leadTechnicianId',
  ]);
  const shownErrors = Object.keys(localErrors).length > 0 ? localErrors : command.fieldErrors;
  const { errors, formRef } = useHeldRefusal(shownErrors, {
    rootCause: draft.rootCause,
    correctiveAction: draft.correctiveAction,
    responsibility: draft.responsibility,
    leadTechnicianId: draft.leadTechnicianId,
  });
  const errorFor = (field: string) =>
    errors[field] ? translateDynamic(messages, errors[field]) : undefined;

  const submit = async () => {
    const missing: Record<string, string> = {};
    if (draft.rootCause.trim().length === 0) missing['rootCause'] = 'field.required';
    if (draft.correctiveAction.trim().length === 0) missing['correctiveAction'] = 'field.required';
    setLocalErrors(missing);
    if (Object.keys(missing).length > 0) return;
    const ok = await command.run(() =>
      createRework(workOrderId, {
        rootCause: draft.rootCause.trim(),
        correctiveAction: draft.correctiveAction.trim(),
        ...(draft.responsibility.trim().length > 0
          ? { responsibility: draft.responsibility.trim() }
          : {}),
        ...(draft.leadTechnicianId.trim().length > 0
          ? { leadTechnicianId: draft.leadTechnicianId.trim() }
          : {}),
        ...(draft.safetyCritical ? { isSafetyCritical: true } : {}),
      })
    );
    if (ok) setDraft(EMPTY_REWORK);
  };

  const list = links.value;

  return (
    <Panel id="rework-heading" titleKey="quality.closure.reworkHeading" messages={messages}>
      {capabilities.canManageRework && terminal === false ? (
        <p className="mb-3 text-caption text-text-muted">
          {translate(messages, 'quality.closure.reworkNeedsClosed')}
        </p>
      ) : null}
      {capabilities.canManageRework && terminal === true ? (
        <form
          ref={formRef}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (command.pending) return;
            void submit();
          }}
          className="mb-3 grid gap-3 rounded-md border border-dashed border-border p-3 sm:grid-cols-2"
        >
          <span className="text-caption font-medium text-text-secondary sm:col-span-2">
            {translate(messages, 'quality.closure.openRework')}
          </span>
          <FormTextField
            name="rootCause"
            label={translate(messages, 'quality.closure.rootCause')}
            value={draft.rootCause}
            onChange={(value) => set('rootCause', value)}
            multiline
            rows={2}
            required
            error={errorFor('rootCause')}
          />
          <FormTextField
            name="correctiveAction"
            label={translate(messages, 'quality.closure.correctiveAction')}
            value={draft.correctiveAction}
            onChange={(value) => set('correctiveAction', value)}
            multiline
            rows={2}
            required
            error={errorFor('correctiveAction')}
          />
          <FormTextField
            name="responsibility"
            label={translate(messages, 'quality.closure.responsibility')}
            value={draft.responsibility}
            onChange={(value) => set('responsibility', value)}
            error={errorFor('responsibility')}
          />
          <FormTextField
            name="leadTechnicianId"
            label={translate(messages, 'quality.closure.leadTechnician')}
            description={translate(messages, 'quality.closure.leadTechnicianHint')}
            value={draft.leadTechnicianId}
            onChange={(value) => set('leadTechnicianId', value)}
            dir="ltr"
            autoComplete="off"
            error={errorFor('leadTechnicianId')}
          />
          <FormCheckboxField
            name="safetyCritical"
            label={translate(messages, 'quality.closure.safetyCritical')}
            checked={draft.safetyCritical}
            onChange={(checked) => set('safetyCritical', checked)}
          />
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Submit
              messages={messages}
              pending={command.pending}
              labelKey="quality.closure.createRework"
            />
            <Problem messages={messages} problem={command.problem} />
          </div>
        </form>
      ) : null}
      {list === null ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : list.status !== 'ok' ? (
        <ReadProblem
          locale={locale}
          messages={messages}
          state={list}
          onRetry={() => void links.reload()}
        />
      ) : list.data.items.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'quality.closure.noRework')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.data.items.map((link) => (
            <ReworkRow
              key={link.id}
              locale={locale}
              messages={messages}
              link={link}
              capabilities={capabilities}
              onChanged={renew}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ReworkRow({
  locale,
  messages,
  link,
  capabilities,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly link: ReworkLink;
  readonly capabilities: ClosureCapabilities;
  readonly onChanged: Renew;
}) {
  const [signOffBy, setSignOffBy] = useState('');
  /**
   * `body.signOffBy` — rework may not be signed off by the technician who did
   * it. The sentence states that rule beside the control holding the name, and
   * names nobody: who carried the work out is already on this row.
   */
  const [signOffFieldErrors, setSignOffFieldErrors] = useState<Readonly<Record<string, string>>>(
    {}
  );
  // Question f: the cursor goes to the first refused field, and a complaint
  // goes once its field changes (route sweep B3).
  const { errors: signOffErrors, formRef: signOffFormRef } = useHeldRefusal(signOffFieldErrors, {
    signOffBy,
  });
  const readCost = useCallback(() => readReworkCost(link.id), [link.id]);
  const cost = useReread(capabilities.canViewSensitive ? readCost : null);
  const [reworkCost, setReworkCost] = useState('');
  const [costCurrency, setCostCurrency] = useState('');
  const [costFieldErrors, setCostFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const { errors: costErrors, formRef: costFormRef } = useHeldRefusal(costFieldErrors, {
    reworkCost,
    costCurrency,
  });
  const [pending, setPending] = useState<'signOff' | 'cost' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Typed work on this row is unsaved: the question is asked, and a confirmed
  // discard empties it.
  useUnsavedGuard(
    signOffBy.trim().length > 0 || reworkCost.trim().length > 0 || costCurrency.trim().length > 0,
    () => {
      setSignOffBy('');
      setReworkCost('');
      setCostCurrency('');
      setSignOffFieldErrors({});
      setCostFieldErrors({});
    }
  );

  /*
   * The sign-off is version-guarded: the `If-Match` is the link's version this
   * row was rendered from, and `onChanged` re-reads the list so the next
   * command carries the renewed version rather than a stale one.
   */
  const signOff = async () => {
    if (signOffBy.trim().length === 0) {
      setSignOffFieldErrors({ signOffBy: 'field.required' });
      return;
    }
    setPending('signOff');
    setProblem(null);
    setSignOffFieldErrors({});
    try {
      let outcome: ActionState;
      try {
        outcome = await signOffRework(link.id, { signOffBy: signOffBy.trim() }, link.recordVersion);
      } catch {
        setProblem('state.unavailable.message');
        return;
      }
      notifyActionResult(outcome, messages);
      if (outcome.status === 'success') {
        setSignOffBy('');
        await onChanged();
        return;
      }
      setSignOffFieldErrors(outcome.fieldErrors ?? {});
      setProblem(problemKeyOf(outcome));
    } finally {
      setPending(null);
    }
  };

  const recordCost = async () => {
    const missing: Record<string, string> = {};
    if (reworkCost.trim().length === 0) missing['reworkCost'] = 'field.required';
    if (costCurrency.trim().length === 0) missing['costCurrency'] = 'field.required';
    if (Object.keys(missing).length > 0) {
      setCostFieldErrors(missing);
      return;
    }
    setPending('cost');
    setProblem(null);
    setCostFieldErrors({});
    try {
      let outcome: ActionState;
      try {
        outcome = await recordReworkCost(link.id, {
          reworkCost: reworkCost.trim(),
          costCurrency: costCurrency.trim(),
        });
      } catch {
        setProblem('state.unavailable.message');
        return;
      }
      notifyActionResult(outcome, messages);
      if (outcome.status === 'success') {
        setReworkCost('');
        setCostCurrency('');
        await Promise.all([cost.reload(), onChanged()]);
        return;
      }
      setCostFieldErrors(outcome.fieldErrors ?? {});
      setProblem(problemKeyOf(outcome));
    } finally {
      setPending(null);
    }
  };

  const costRead = cost.value;

  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-body font-medium text-text-primary">
          <bdi>{link.rootCause}</bdi>
        </span>
        <span className="text-caption text-text-muted">
          {translate(messages, 'quality.closure.correctiveAction')}:{' '}
          <bdi>{link.correctiveAction}</bdi>
        </span>
        {link.isSafetyCritical ? (
          <span className="text-caption text-text-muted">
            {translate(messages, 'quality.closure.safetyCritical')}
          </span>
        ) : null}
        <span className="text-caption text-text-muted">
          {link.signOffAt ? (
            <>
              {translate(messages, 'quality.closure.signedOff')}{' '}
              <bdi>{formatDateTime(link.signOffAt, locale)}</bdi>
            </>
          ) : (
            translate(messages, 'quality.closure.notSignedOff')
          )}
        </span>
        {/*
          The rework order by a link in words: no rework read publishes the
          order's number, and a bare reference read as the record's own number
          (route sweep B3). Named with the root cause for assistive technology,
          so two rework links are two different links.
        */}
        <Link
          href={`/${locale}/work-orders/${link.reworkWorkOrderId}`}
          className="ms-auto text-caption text-primary underline-offset-2 hover:underline"
        >
          {translate(messages, 'quality.closure.openReworkOrder')}
          <span className="sr-only"> — {link.rootCause}</span>
        </Link>
      </div>
      {capabilities.canViewSensitive ? (
        <p className="mt-1 text-caption text-text-secondary">
          {translate(messages, 'quality.closure.cost')}:{' '}
          {costRead === null
            ? translate(messages, 'state.loading')
            : costRead.status === 'ok'
              ? `${costRead.data.reworkCost} ${costRead.data.costCurrency}`
              : costRead.status === 'not-found'
                ? translate(messages, 'quality.closure.noCost')
                : translateDynamic(messages, `state.${costRead.status}.title`)}
        </p>
      ) : null}
      {capabilities.canSignOffRework && link.signOffAt === null ? (
        <form
          ref={signOffFormRef}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (pending !== null) return;
            void signOff();
          }}
          className="mt-2 flex flex-wrap items-start gap-3"
        >
          <FormTextField
            name={`signOffBy-${link.id}`}
            label={translate(messages, 'quality.closure.signOffBy')}
            description={translate(messages, 'quality.closure.signOffByHint')}
            value={signOffBy}
            onChange={setSignOffBy}
            error={
              signOffErrors['signOffBy']
                ? translateDynamic(messages, signOffErrors['signOffBy'])
                : undefined
            }
            dir="ltr"
            autoComplete="off"
            required
          />
          <Submit
            messages={messages}
            pending={pending === 'signOff'}
            disabled={pending !== null}
            labelKey="quality.closure.signOff"
            variant="outlined"
          />
        </form>
      ) : null}
      {capabilities.canManageRework && capabilities.canViewSensitive ? (
        <form
          ref={costFormRef}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (pending !== null) return;
            void recordCost();
          }}
          className="mt-2 flex flex-wrap items-start gap-3"
        >
          <FormNumberField
            name={`reworkCost-${link.id}`}
            label={translate(messages, 'quality.closure.cost')}
            value={reworkCost}
            onChange={setReworkCost}
            required
            error={
              costErrors['reworkCost']
                ? translateDynamic(messages, costErrors['reworkCost'])
                : undefined
            }
          />
          <FormTextField
            name={`costCurrency-${link.id}`}
            label={translate(messages, 'quality.closure.currency')}
            value={costCurrency}
            onChange={setCostCurrency}
            dir="ltr"
            maxLength={3}
            autoComplete="off"
            required
            error={
              costErrors['costCurrency']
                ? translateDynamic(messages, costErrors['costCurrency'])
                : undefined
            }
          />
          <Submit
            messages={messages}
            pending={pending === 'cost'}
            disabled={pending !== null}
            labelKey="quality.closure.recordCost"
            variant="outlined"
          />
        </form>
      ) : null}
      <Problem messages={messages} problem={problem} onReload={() => void onChanged()} />
    </li>
  );
}

/* ---------------------------------------------------------------- reopen */

function ReopenPanel({
  locale,
  messages,
  workOrderId,
  capabilities,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  readonly capabilities: ClosureCapabilities;
  readonly onChanged: Renew;
}) {
  const readAttempts = useCallback(() => listReopenAttempts(workOrderId), [workOrderId]);
  const attempts = useReread(readAttempts);
  const [asking, setAsking] = useState(false);
  const reloadAttempts = attempts.reload;
  const renew = useCallback(async () => {
    await Promise.all([reloadAttempts(), onChanged()]);
  }, [reloadAttempts, onChanged]);
  const command = useCommand(messages, renew, ['reason']);

  const list = attempts.value;

  return (
    <Panel id="reopen-heading" titleKey="quality.closure.reopenHeading" messages={messages}>
      <p className="mb-2 text-caption text-text-muted">
        {translate(messages, 'quality.closure.reopenNote')}
      </p>
      {capabilities.canTransition ? (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outlined"
            onClick={() => {
              command.setProblem(null);
              command.setFieldErrors({});
              setAsking(true);
            }}
            disabled={command.pending}
          >
            {translate(messages, 'quality.closure.attemptReopen')}
          </Button>
          {asking ? null : <Problem messages={messages} problem={command.problem} />}
        </div>
      ) : null}
      <ReasonDialog
        open={asking}
        onCancel={() => setAsking(false)}
        onConfirm={(reason) =>
          void command
            .run(() => raiseReopenAttempt(workOrderId, { reason }))
            .then((ok) => {
              if (ok) setAsking(false);
            })
        }
        title={translate(messages, 'quality.closure.reopenDialogTitle')}
        description={translate(messages, 'quality.closure.reopenDialogBody')}
        confirmLabel={translate(messages, 'quality.closure.attemptReopen')}
        reasonLabel={translate(messages, 'quality.closure.reopenReason')}
        messages={messages}
        pending={command.pending}
        error={command.problem === null ? undefined : translateDynamic(messages, command.problem)}
        reasonError={
          command.fieldErrors['reason']
            ? translateDynamic(messages, command.fieldErrors['reason'])
            : undefined
        }
        maxLength={500}
        testId="reopen-reason-dialog"
      />
      {list === null ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : list.status !== 'ok' ? (
        <ReadProblem
          locale={locale}
          messages={messages}
          state={list}
          onRetry={() => void attempts.reload()}
        />
      ) : list.data.items.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'quality.closure.noReopen')}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {list.data.items.map((attempt) => (
            <li key={attempt.id} className="text-body text-text-primary">
              <bdi>{attempt.reason}</bdi> —{' '}
              {translateDynamic(messages, `quality.reopenOutcome.${attempt.outcome}`)}
              <span className="text-caption text-text-muted">
                {' '}
                · <bdi>{formatDateTime(attempt.requestedAt, locale)}</bdi>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------- additional work */

interface WorkRequestDraft {
  readonly summary: string;
  readonly originatingJobId: string;
  readonly required: boolean;
}

const EMPTY_WORK_REQUEST: WorkRequestDraft = { summary: '', originatingJobId: '', required: false };

/**
 * Requesting extra work, and the origin every request must carry.
 *
 * `wo.additional-work-request` refuses a request that names neither the job nor
 * the diagnostic finding the work came from (`origin_required`), and this form
 * used to send neither — so every extra-work request raised from the closure
 * screen was refused, whatever was typed into it. The cure is a control, not a
 * sentence: the screen already reads the order's jobs for the gate panel, so the
 * origin is a required picker over those jobs and the chosen id is what goes on
 * the wire.
 *
 * No finding picker. The optional second origin would need the job's inspection
 * findings, and nothing this screen reads carries them; adding a read for it is
 * a backend operation this panel does not have, and a control that cannot be
 * filled is worse than no control. A finding-only origin remains reachable
 * through the diagnostics screen, which is where findings are.
 *
 * `origin_required` and `origin_conflict` are published against
 * `body.originatingJobId`, so both land beside the picker rather than in the
 * form's alert. The typed summary survives a refusal: it is cleared on success
 * only.
 */
function AdditionalWorkPanel({
  locale,
  messages,
  workOrderId,
  detail,
  capabilities,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  readonly detail: ReadState<WorkOrderDetail> | null;
  readonly capabilities: ClosureCapabilities;
  readonly onChanged: Renew;
}) {
  const readRequests = useCallback(() => listAdditionalWork(workOrderId), [workOrderId]);
  const requests = useReread(readRequests);
  const [draft, setDraft] = useState<WorkRequestDraft>(EMPTY_WORK_REQUEST);
  const [localErrors, setLocalErrors] = useState<Readonly<Record<string, string>>>({});
  // Two different emptinesses. `detail` is null while the read is in flight and
  // carries a problem when it failed, and in both the job list is simply not
  // known — saying "this work order has no jobs yet" there would state a cause
  // that has not been established, on every first paint.
  const jobsKnown = detail !== null && detail.status === 'ok';
  const jobs = jobsKnown ? detail.data.jobs : [];
  const reloadRequests = requests.reload;
  const renew = useCallback(async () => {
    await Promise.all([reloadRequests(), onChanged()]);
  }, [reloadRequests, onChanged]);
  const command = useCommand(messages, renew, ['originatingJobId', 'summary']);
  const shownErrors = Object.keys(localErrors).length > 0 ? localErrors : command.fieldErrors;
  const { errors, formRef } = useHeldRefusal(shownErrors, {
    summary: draft.summary,
    originatingJobId: draft.originatingJobId,
  });
  const errorFor = (field: string) =>
    errors[field] ? translateDynamic(messages, errors[field]) : undefined;

  useUnsavedGuard(
    draft.summary.trim().length > 0 || draft.originatingJobId !== '' || draft.required,
    () => {
      setDraft(EMPTY_WORK_REQUEST);
      setLocalErrors({});
    }
  );

  const submit = async () => {
    const missing: Record<string, string> = {};
    if (draft.summary.trim().length === 0) missing['summary'] = 'field.required';
    // The origin is refused here rather than sent empty, because the service
    // refuses it anyway and a round trip that can only fail is a slower way of
    // saying the same thing.
    if (draft.originatingJobId === '')
      missing['originatingJobId'] = 'form.violation.origin_required';
    setLocalErrors(missing);
    if (Object.keys(missing).length > 0) return;
    const ok = await command.run(() =>
      requestAdditionalWork(workOrderId, {
        originatingJobId: draft.originatingJobId,
        summary: draft.summary.trim(),
        ...(draft.required ? { isRequired: true } : {}),
      })
    );
    if (ok) setDraft(EMPTY_WORK_REQUEST);
  };

  const list = requests.value;

  return (
    <Panel
      id="additional-work-heading"
      titleKey="quality.closure.additionalWorkHeading"
      messages={messages}
    >
      {capabilities.canRequestAdditionalWork ? (
        <form
          ref={formRef}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (command.pending) return;
            void submit();
          }}
          className="mb-3 grid gap-3 sm:grid-cols-2"
        >
          <FormTextField
            name="summary"
            label={translate(messages, 'quality.closure.additionalWorkSummary')}
            value={draft.summary}
            onChange={(summary) => setDraft((current) => ({ ...current, summary }))}
            required
            error={errorFor('summary')}
          />
          <FormSelectField
            name="originatingJobId"
            label={translate(messages, 'quality.closure.originatingJob')}
            description={translate(
              messages,
              !jobsKnown
                ? 'quality.closure.originatingJobUnknown'
                : jobs.length === 0
                  ? 'quality.closure.originatingJobNone'
                  : 'quality.closure.originatingJobHint'
            )}
            value={draft.originatingJobId}
            onChange={(originatingJobId) =>
              setDraft((current) => ({ ...current, originatingJobId }))
            }
            error={errorFor('originatingJobId')}
            options={jobs.map((job) => ({ value: job.id, label: job.title }))}
            placeholder={translate(messages, 'quality.closure.originatingJobPlaceholder')}
            required
          />
          <FormCheckboxField
            name="isRequired"
            label={translate(messages, 'quality.closure.required')}
            checked={draft.required}
            onChange={(required) => setDraft((current) => ({ ...current, required }))}
          />
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Submit
              messages={messages}
              pending={command.pending}
              labelKey="quality.closure.requestWork"
            />
            <Problem messages={messages} problem={command.problem} />
          </div>
        </form>
      ) : null}
      {list === null ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : list.status !== 'ok' ? (
        <ReadProblem
          locale={locale}
          messages={messages}
          state={list}
          onRetry={() => void requests.reload()}
        />
      ) : list.data.items.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'quality.closure.noAdditionalWork')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.data.items.map((request) => (
            <AdditionalWorkRow
              key={request.id}
              locale={locale}
              messages={messages}
              request={request}
              capabilities={capabilities}
              onChanged={renew}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

interface ApprovalDraft {
  readonly decision: string;
  readonly channel: string;
  readonly decidingPartyRoleId: string;
  readonly presentedScope: string;
}

const EMPTY_APPROVAL: ApprovalDraft = {
  decision: '',
  channel: '',
  decidingPartyRoleId: '',
  presentedScope: '',
};

function AdditionalWorkRow({
  locale,
  messages,
  request,
  capabilities,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly request: AdditionalWorkRequest;
  readonly capabilities: ClosureCapabilities;
  readonly onChanged: Renew;
}) {
  const readApproval = useCallback(() => readAdditionalWorkApproval(request.id), [request.id]);
  const readDetail = useCallback(() => readAdditionalWorkDetail(request.id), [request.id]);
  const approval = useReread(readApproval);
  const detail = useReread(capabilities.canViewSensitive ? readDetail : null);
  const [description, setDescription] = useState('');
  const [approvalDraft, setApprovalDraft] = useState<ApprovalDraft>(EMPTY_APPROVAL);
  const [fulfillment, setFulfillment] = useState('');
  const [fulfillmentReason, setFulfillmentReason] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const reloadApproval = approval.reload;
  const reloadDetail = detail.reload;
  const renew = useCallback(async () => {
    await Promise.all([reloadApproval(), reloadDetail(), onChanged()]);
  }, [reloadApproval, reloadDetail, onChanged]);
  const descriptionCommand = useCommand(messages, renew, ['description']);
  const fulfillmentCommand = useCommand(messages, renew, ['fulfillmentState', 'reason']);
  const withdrawCommand = useCommand(messages, renew, ['reason']);
  const [approvalPending, setApprovalPending] = useState(false);
  const [approvalProblem, setApprovalProblem] = useState<string | null>(null);
  /**
   * `body.decidingPartyRoleId` — the person named is not recorded on the visit
   * this order came from. The sentence states that rule and names nobody who
   * is on the visit; it belongs beside the control that holds the name, and
   * what was typed in the other three controls stays where it is.
   */
  const [approvalFieldErrors, setApprovalFieldErrors] = useState<Readonly<Record<string, string>>>(
    {}
  );
  // Question f: the cursor goes to the first refused field, and a complaint
  // goes once its field changes (route sweep B3).
  const { errors: approvalErrors, formRef: approvalFormRef } = useHeldRefusal(approvalFieldErrors, {
    ...approvalDraft,
  });
  const [descriptionErrors, setDescriptionErrors] = useState<Readonly<Record<string, string>>>({});
  const { errors: descriptionShown, formRef: descriptionFormRef } = useHeldRefusal(
    Object.keys(descriptionErrors).length > 0 ? descriptionErrors : descriptionCommand.fieldErrors,
    { description }
  );
  const [fulfillmentErrors, setFulfillmentErrors] = useState<Readonly<Record<string, string>>>({});
  const { errors: fulfillmentShown, formRef: fulfillmentFormRef } = useHeldRefusal(
    Object.keys(fulfillmentErrors).length > 0 ? fulfillmentErrors : fulfillmentCommand.fieldErrors,
    { fulfillmentState: fulfillment, reason: fulfillmentReason }
  );

  useUnsavedGuard(
    description.trim().length > 0 ||
      Object.values(approvalDraft).some((value) => value.trim().length > 0) ||
      fulfillment !== '' ||
      fulfillmentReason.trim().length > 0,
    () => {
      setDescription('');
      setApprovalDraft(EMPTY_APPROVAL);
      setFulfillment('');
      setFulfillmentReason('');
      setApprovalFieldErrors({});
      setDescriptionErrors({});
      setFulfillmentErrors({});
    }
  );

  const setApproval = <K extends keyof ApprovalDraft>(field: K, value: string) =>
    setApprovalDraft((current) => ({ ...current, [field]: value }));

  /*
   * The approval is version-guarded on the request's version this row was
   * rendered from; `onChanged` re-reads the list so the version is renewed.
   * Called directly, not through `useCommand`, so the outcome is visibly handed
   * onward.
   */
  const approve = async () => {
    const missing: Record<string, string> = {};
    if (!approvalDraft.decision) missing['decision'] = 'field.required';
    if (!approvalDraft.channel) missing['channel'] = 'field.required';
    if (approvalDraft.decidingPartyRoleId.trim().length === 0) {
      missing['decidingPartyRoleId'] = 'field.required';
    }
    if (approvalDraft.presentedScope.trim().length === 0) {
      missing['presentedScope'] = 'field.required';
    }
    if (Object.keys(missing).length > 0) {
      setApprovalFieldErrors(missing);
      return;
    }
    setApprovalPending(true);
    setApprovalProblem(null);
    setApprovalFieldErrors({});
    try {
      let outcome: ActionState;
      try {
        outcome = await recordAdditionalWorkApproval(
          request.id,
          {
            decision: approvalDraft.decision as (typeof DECISIONS)[number],
            channel: approvalDraft.channel as (typeof CHANNELS)[number],
            decidingPartyRoleId: approvalDraft.decidingPartyRoleId.trim(),
            presentedScope: approvalDraft.presentedScope.trim(),
          },
          request.recordVersion
        );
      } catch {
        setApprovalProblem('state.unavailable.message');
        return;
      }
      notifyActionResult(outcome, messages);
      if (outcome.status === 'success') {
        setApprovalDraft(EMPTY_APPROVAL);
        // The approval is this row's own read: it is read again with the list.
        await Promise.all([reloadApproval(), onChanged()]);
        return;
      }
      setApprovalFieldErrors(outcome.fieldErrors ?? {});
      setApprovalProblem(problemKeyOf(outcome));
    } finally {
      setApprovalPending(false);
    }
  };

  const approvalRead = approval.value;
  const detailRead = detail.value;
  const errorOf = (errors: Readonly<Record<string, string>>, field: string) =>
    errors[field] ? translateDynamic(messages, errors[field]) : undefined;

  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-body font-medium text-text-primary">
          <bdi>{request.summary}</bdi>
        </span>
        <span className="text-caption text-text-secondary" data-testid="request-state">
          {REQUEST_STATES.includes(request.state)
            ? translateDynamic(messages, `quality.requestState.${request.state}`)
            : request.state}
        </span>
        <span className="text-caption text-text-secondary" data-testid="request-fulfillment">
          {FULFILLMENT_STATES.includes(request.fulfillmentState)
            ? translateDynamic(messages, `quality.fulfillment.${request.fulfillmentState}`)
            : request.fulfillmentState}
        </span>
        {request.isRequired ? (
          <span className="text-caption text-text-muted">
            {translate(messages, 'quality.closure.required')}
          </span>
        ) : null}
        <span className="ms-auto text-caption text-text-muted">
          <bdi>{formatDateTime(request.createdAt, locale)}</bdi>
        </span>
      </div>
      {capabilities.canViewSensitive ? (
        <p className="mt-1 text-caption text-text-secondary">
          {translate(messages, 'quality.closure.description')}:{' '}
          {detailRead === null
            ? translate(messages, 'state.loading')
            : detailRead.status === 'ok'
              ? detailRead.data.description
              : detailRead.status === 'not-found'
                ? translate(messages, 'quality.closure.noDescription')
                : translateDynamic(messages, `state.${detailRead.status}.title`)}
        </p>
      ) : null}
      <p className="mt-1 text-caption text-text-secondary">
        {translate(messages, 'quality.closure.approval')}:{' '}
        {approvalRead === null
          ? translate(messages, 'state.loading')
          : approvalRead.status === 'ok'
            ? `${translateDynamic(messages, `quality.decision.${approvalRead.data.decision}`)} · ${translateDynamic(messages, `quality.channel.${approvalRead.data.channel}`)} · ${formatDateTime(approvalRead.data.decidedAt, locale)}`
            : approvalRead.status === 'not-found'
              ? translate(messages, 'quality.closure.noApproval')
              : translateDynamic(messages, `state.${approvalRead.status}.title`)}
      </p>
      {capabilities.canRequestAdditionalWork && capabilities.canViewSensitive ? (
        <form
          ref={descriptionFormRef}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (descriptionCommand.pending) return;
            if (description.trim().length === 0) {
              setDescriptionErrors({ description: 'field.required' });
              return;
            }
            setDescriptionErrors({});
            void descriptionCommand
              .run(() =>
                recordAdditionalWorkDetail(request.id, { description: description.trim() })
              )
              .then((ok) => {
                if (ok) setDescription('');
              });
          }}
          className="mt-2 flex flex-wrap items-start gap-3"
        >
          <FormTextField
            name={`description-${request.id}`}
            label={translate(messages, 'quality.closure.description')}
            value={description}
            onChange={setDescription}
            required
            error={errorOf(descriptionShown, 'description')}
          />
          <Submit
            messages={messages}
            pending={descriptionCommand.pending}
            labelKey="quality.closure.recordDescription"
            variant="outlined"
          />
          <Problem messages={messages} problem={descriptionCommand.problem} />
        </form>
      ) : null}
      {capabilities.canApproveAdditionalWork && approvalRead?.status === 'not-found' ? (
        <form
          ref={approvalFormRef}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (approvalPending) return;
            void approve();
          }}
          className="mt-2 grid gap-3 sm:grid-cols-2"
        >
          <FormRadioGroupField
            name={`decision-${request.id}`}
            label={translate(messages, 'quality.closure.decision')}
            value={approvalDraft.decision}
            onChange={(value) => setApproval('decision', value)}
            options={DECISIONS.map((value) => ({
              value,
              label: translate(messages, `quality.decision.${value}`),
            }))}
            required
            error={errorOf(approvalErrors, 'decision')}
          />
          <FormSelectField
            name={`channel-${request.id}`}
            label={translate(messages, 'quality.closure.channel')}
            value={approvalDraft.channel}
            onChange={(value) => setApproval('channel', value)}
            options={CHANNELS.map((value) => ({
              value,
              label: translate(messages, `quality.channel.${value}`),
            }))}
            placeholder={translate(messages, 'quality.closure.chooseChannel')}
            required
            error={errorOf(approvalErrors, 'channel')}
          />
          <FormTextField
            name={`decidingPartyRoleId-${request.id}`}
            label={translate(messages, 'quality.closure.decidingParty')}
            description={translate(messages, 'quality.closure.decidingPartyHint')}
            value={approvalDraft.decidingPartyRoleId}
            onChange={(value) => setApproval('decidingPartyRoleId', value)}
            error={errorOf(approvalErrors, 'decidingPartyRoleId')}
            dir="ltr"
            autoComplete="off"
            required
          />
          <FormTextField
            name={`presentedScope-${request.id}`}
            label={translate(messages, 'quality.closure.presentedScope')}
            value={approvalDraft.presentedScope}
            onChange={(value) => setApproval('presentedScope', value)}
            error={errorOf(approvalErrors, 'presentedScope')}
            required
          />
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Submit
              messages={messages}
              pending={approvalPending}
              labelKey="quality.closure.recordApproval"
            />
            <Problem
              messages={messages}
              problem={approvalProblem}
              onReload={() => void onChanged()}
            />
          </div>
        </form>
      ) : null}
      {capabilities.canRequestAdditionalWork ? (
        <div className="mt-2 flex flex-wrap items-start gap-3">
          <form
            ref={fulfillmentFormRef}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (fulfillmentCommand.pending) return;
              if (!fulfillment) {
                setFulfillmentErrors({ fulfillmentState: 'field.required' });
                return;
              }
              setFulfillmentErrors({});
              void fulfillmentCommand
                .run(() =>
                  fulfillAdditionalWork(request.id, {
                    fulfillmentState: fulfillment as (typeof FULFILLMENT)[number],
                    ...(fulfillmentReason.trim().length > 0
                      ? { reason: fulfillmentReason.trim() }
                      : {}),
                  })
                )
                .then((ok) => {
                  if (!ok) return;
                  setFulfillment('');
                  setFulfillmentReason('');
                });
            }}
            className="flex flex-wrap items-start gap-3"
          >
            <FormRadioGroupField
              name={`fulfillment-${request.id}`}
              label={translate(messages, 'quality.closure.fulfillment')}
              value={fulfillment}
              onChange={setFulfillment}
              options={FULFILLMENT.map((value) => ({
                value,
                label: translate(messages, `quality.fulfillment.${value}`),
              }))}
              required
              error={errorOf(fulfillmentShown, 'fulfillmentState')}
            />
            <FormTextField
              name={`reason-${request.id}`}
              label={translate(messages, 'quality.closure.reason')}
              value={fulfillmentReason}
              onChange={setFulfillmentReason}
              error={errorOf(fulfillmentShown, 'reason')}
            />
            <Submit
              messages={messages}
              pending={fulfillmentCommand.pending}
              labelKey="quality.closure.recordFulfillment"
              variant="outlined"
            />
            <Problem messages={messages} problem={fulfillmentCommand.problem} />
          </form>
          <Button
            type="button"
            variant="text"
            color="error"
            onClick={() => {
              withdrawCommand.setProblem(null);
              withdrawCommand.setFieldErrors({});
              setWithdrawing(true);
            }}
            disabled={withdrawCommand.pending}
          >
            {translate(messages, 'quality.closure.withdraw')}
            <span className="sr-only"> — {request.summary}</span>
          </Button>
          <ReasonDialog
            open={withdrawing}
            onCancel={() => setWithdrawing(false)}
            onConfirm={(reason) =>
              void withdrawCommand
                .run(() => withdrawAdditionalWork(request.id, { reason }))
                .then((ok) => {
                  if (ok) setWithdrawing(false);
                })
            }
            title={translate(messages, 'quality.closure.withdrawDialogTitle')}
            description={translate(messages, 'quality.closure.withdrawDialogBody')}
            confirmLabel={translate(messages, 'quality.closure.withdraw')}
            reasonLabel={translate(messages, 'quality.closure.reason')}
            messages={messages}
            destructive
            pending={withdrawCommand.pending}
            error={
              withdrawCommand.problem === null
                ? undefined
                : translateDynamic(messages, withdrawCommand.problem)
            }
            reasonError={
              withdrawCommand.fieldErrors['reason']
                ? translateDynamic(messages, withdrawCommand.fieldErrors['reason'])
                : undefined
            }
            maxLength={500}
            testId="withdraw-reason-dialog"
          />
        </div>
      ) : null}
    </li>
  );
}

/* --------------------------------------------------------------- closure */

function ClosurePanel({
  messages,
  workOrderId,
  detail,
  eligibility,
  capabilities,
  onDone,
}: {
  readonly messages: Messages;
  readonly workOrderId: string;
  readonly detail: ReadState<WorkOrderDetail> | null;
  readonly eligibility: ReadState<ClosureEligibility> | null;
  readonly capabilities: ClosureCapabilities;
  readonly onDone: Renew;
}) {
  const [toState, setToState] = useState('');
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /**
   * The closure refusals, each shown where the reader can act on it.
   *
   * `body.toState` — the chosen state does not close the order — belongs beside
   * the state control. The outstanding-blocker refusal names each blocker by
   * its own code, which is no control at all, so it goes to the form's alert
   * instead of into a map nothing renders.
   */
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  // Question f: the cursor goes to the first refused field, and a complaint
  // goes once its field changes (route sweep B3).
  const { errors, formRef } = useHeldRefusal(fieldErrors, { toState, reason });
  useUnsavedGuard(toState !== '' || reason.trim().length > 0, () => {
    setToState('');
    setReason('');
    setFieldErrors({});
    setProblem(null);
  });

  if (!capabilities.canTransition || !capabilities.canClose) return null;
  if (detail === null || detail.status !== 'ok') return null;
  const targets = detail.data.nextStates.filter((s) => s.isTerminal && !s.isCancellation);
  const chosen = targets.find((s) => s.code === toState) ?? null;
  const version = detail.data.workOrder.recordVersion;
  const eligible = eligibility?.status === 'ok' && eligibility.data.eligible;

  /*
   * Version-guarded: the `If-Match` is the order's version the detail carried,
   * and `onDone` re-reads the detail and the eligibility after every attempt —
   * a refused closure still names, in the eligibility, what stands in the way.
   */
  const close = async () => {
    if (chosen === null) return;
    setPending(true);
    setProblem(null);
    setFieldErrors({});
    try {
      let outcome: ActionState;
      try {
        outcome = await closeWorkOrder(
          workOrderId,
          { toState: chosen.code, ...(reason.trim().length > 0 ? { reason: reason.trim() } : {}) },
          version
        );
      } catch {
        setProblem('state.unavailable.message');
        return;
      }
      notifyActionResult(outcome, messages);
      if (outcome.status === 'success') {
        // The dialog stays up, busy, until the order has been read again.
        await onDone();
        setToState('');
        setReason('');
        return;
      }
      setFieldErrors(outcome.fieldErrors ?? {});
      setProblem(
        unattachedRefusalKey(outcome.fieldErrors, ['toState', 'reason']) ?? problemKeyOf(outcome)
      );
      await onDone();
    } finally {
      setPending(false);
      setAsking(false);
    }
  };

  return (
    <Panel id="closure-heading" titleKey="quality.closure.closeHeading" messages={messages}>
      {targets.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'quality.closure.noClosureTarget')}
        </p>
      ) : (
        <form
          ref={formRef}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (pending || !eligible) return;
            if (chosen === null) {
              setFieldErrors({ toState: 'field.required' });
              return;
            }
            if (chosen.requiresReason && reason.trim().length === 0) {
              setFieldErrors({ reason: 'quality.closure.reasonRequired' });
              return;
            }
            setFieldErrors({});
            setAsking(true);
          }}
          className="flex flex-wrap items-start gap-3"
        >
          <FormSelectField
            name="toState"
            label={translate(messages, 'quality.closure.closeTo')}
            value={toState}
            onChange={setToState}
            // The closing states in words; a workshop's own keeps its code.
            options={targets.map((s) => ({
              value: s.code,
              label: orderStateText(messages, s.code),
            }))}
            placeholder={translate(messages, 'quality.closure.chooseState')}
            error={errors['toState'] ? translateDynamic(messages, errors['toState']) : undefined}
            required
          />
          <FormTextField
            name="reason"
            label={translate(messages, 'quality.closure.reason')}
            value={reason}
            onChange={setReason}
            required={chosen?.requiresReason ?? false}
            maxLength={500}
            error={errors['reason'] ? translateDynamic(messages, errors['reason']) : undefined}
          />
          <Submit
            messages={messages}
            pending={pending}
            disabled={!eligible}
            labelKey="quality.closure.close"
          />
          {!eligible ? (
            <p className="basis-full text-caption text-text-muted">
              {translate(messages, 'quality.closure.closeBlocked')}
            </p>
          ) : null}
          <Problem messages={messages} problem={problem} onReload={() => void onDone()} />
          <ConfirmDialog
            open={asking && chosen !== null}
            onCancel={() => setAsking(false)}
            onConfirm={() => void close()}
            title={translate(messages, 'quality.closure.confirmCloseTitle')}
            description={
              chosen === null
                ? undefined
                : formatMessage(translate(messages, 'quality.closure.confirmCloseBody'), {
                    state: orderStateText(messages, chosen.code),
                  })
            }
            confirmLabel={translate(messages, 'quality.closure.close')}
            messages={messages}
            pending={pending}
            testId="closure-confirm"
          />
        </form>
      )}
    </Panel>
  );
}
