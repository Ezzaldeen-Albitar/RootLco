'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import Button from '@mui/material/Button';
import { OperationalGrid, type OperationalColumn } from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { useServerTable, type ServerTable } from '@/components/data-table/use-server-table';
import { ReasonDialog } from '@/components/dialogs/ReasonDialog';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { FailureExplanation } from '@/components/states/States';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic, translateWithValues } from '@/i18n/get-messages';
import { IDLE, unreachable, type ActionState } from '@/lib/forms/action-result';
import {
  approveReception,
  closeReceptionWithoutWork,
  listAuthorizations,
  listConditionEvidence,
  listPartyRoles,
  refuseReception,
} from '../../api';
import {
  MAX_CLOSURE_REASON,
  type AuthorizationEntry,
  type ConditionEvidenceEntry,
  type PartyRoleEntry,
} from '../../receptions-contract';
import type { CheckInStepProps } from '../../check-in/wizard';
import {
  closureReasonProblem,
  conflictKindOf,
  hasRegisteredMedia,
  isCustomerReported,
  nextVersionAfter,
  receptionAffordances,
  refusalFixStepId,
  refusalReasonKey,
} from '../../check-in/closure';
import { InstantOrRaw } from './EvidencePanels';
import { PartyRoleGrid, authorizationColumns } from './PartiesStep';

/**
 * The reception summary, the approval, and the two terminal exits (`FE-020`).
 *
 * ## Four reads, one version
 *
 * The visit itself arrives from the shell's single `rec.reception-detail` read;
 * this step adds `rec.reception-party-role-list`,
 * `rec.reception-authorization-list` and `rec.reception-condition-evidence-list`
 * so the decision is taken beside what it is a decision ABOUT. The
 * `If-Match` every command below sends is `recordVersion` — the shell's, from
 * that read — and after any write, and after any conflict, `refresh()` re-reads
 * it. Nothing here caches a version (QA-004).
 *
 * ## Three commands, and every one is labelled as what it calls
 *
 *   - `rec.reception-approve` — advances the visit to `authorized`. It may
 *     apply TWO edges in one transaction (`opened → inspecting → authorized`),
 *     so the response's `recordVersion` is the truth and this screen never
 *     computes one. Re-running it on an authorized visit is 409 `ERR-TRN-001`
 *     and RE-READING DOES NOT CURE THAT — the state itself refuses the command
 *     — which is why the conflict copy distinguishes the two 409s instead of
 *     printing one sentence for both.
 *   - `rec.reception-close-without-work` — the exit for a visit that will not
 *     become a work order.
 *   - `rec.reception-refuse` — the exit for a visit the workshop declines.
 *
 * Both exits release the vehicle from `uq_reception_visits_open_vehicle`, which
 * is what lets an abandoned visit's vehicle be received again, and both take one
 * mandatory bounded reason that lands in the append-only status ledger. Both
 * are terminal and irreversible, so each asks in `ReasonDialog` — an alert
 * dialog with Cancel focused, the reason box refused on itself when empty or
 * too long, Escape cancels and a click outside does not.
 *
 * `rec.reception-refuse` is NOT `rec.reception-refusal`: the refusal EVIDENCE
 * this step never touches records that a party declined a step and changes no
 * status. Conflating them would close visits by accident.
 *
 * ## Which controls exist is read off the transition graph
 *
 * `receptionAffordances` walks `RECEPTION_TRANSITIONS` — see `closure.ts`. This
 * component holds no list of statuses, so a graph change moves the interface
 * rather than leaving it confidently wrong.
 *
 * ## A concern is not a finding, and nothing here has been verified
 *
 * A complaint is what the CUSTOMER reported. Everything else on the evidence
 * list is what staff observed at reception. Neither has been through a
 * technician — diagnosis is the work order's job (P1-29) — so the section says
 * so once, and each customer-reported row says so again in its own right. The
 * customer's own words are NOT in this read: `rec.complaint_details` is a
 * restricted narrative table the projection deliberately excludes, so the row
 * renders the category, the severity and who reported it, and states plainly
 * that the wording is held on the restricted record rather than paraphrasing it
 * into a finding nobody made.
 *
 * ## On the Material UI wrappers (ADR-022)
 *
 * The three read-backs are `OperationalGrid` (the server's pages, never
 * counted); the commands are Material buttons whose handlers await the send
 * AND the re-read that settles it inside one `try` and clear their pending
 * state in its `finally`: an answer that never arrives is said as that and the
 * button is usable again, and a command cannot be pressed a second time with
 * the version it has just spent while that re-read is still running.
 */

export function SummaryStep({
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
  const readKey = `${visitId}:${recordVersion}`;
  const affordances = receptionAffordances(detail.receptionStatus);

  const loadRoles = useCallback(
    (request: Parameters<typeof listPartyRoles>[2], cursor: string | null) =>
      listPartyRoles(visitId, 'active', request, cursor),
    [visitId]
  );
  const roles = useServerTable<PartyRoleEntry>(loadRoles, {
    initial: { ...INITIAL_REQUEST, pageSize: 25 },
    loadKey: readKey,
  });

  const loadAuthorizations = useCallback(
    (request: Parameters<typeof listAuthorizations>[1], cursor: string | null) =>
      listAuthorizations(visitId, request, cursor),
    [visitId]
  );
  const authorizations = useServerTable<AuthorizationEntry>(loadAuthorizations, {
    initial: { ...INITIAL_REQUEST, pageSize: 25 },
    loadKey: readKey,
  });

  const loadEvidence = useCallback(
    (request: Parameters<typeof listConditionEvidence>[2], cursor: string | null) =>
      listConditionEvidence(visitId, undefined, request, cursor),
    [visitId]
  );
  const evidence = useServerTable<ConditionEvidenceEntry>(loadEvidence, {
    initial: { ...INITIAL_REQUEST, pageSize: 25 },
    loadKey: readKey,
  });

  const settle = async (state: ActionState) => {
    notifyActionResult(state, messages);
    if (state.status === 'success' || state.status === 'conflict') {
      // Success moved the record; a conflict says the record moved without us.
      // Both are answered by re-reading, which is also where the next
      // `If-Match` comes from.
      await refresh();
      roles.refresh();
      authorizations.refresh();
      evidence.refresh();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <section
          aria-labelledby="summary-parties-heading"
          className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <h4 id="summary-parties-heading" className="text-body font-medium text-text-primary">
            {translate(messages, 'receptions.summary.partiesHeading')}
          </h4>
          <PartyRoleGrid
            locale={locale}
            messages={messages}
            table={roles}
            showInterval={false}
            emptyKey="receptions.summary.partiesEmpty"
            testId="summary-party-grid"
          />
        </section>

        <section
          aria-labelledby="summary-authorizations-heading"
          className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <h4
            id="summary-authorizations-heading"
            className="text-body font-medium text-text-primary"
          >
            {translate(messages, 'receptions.summary.authorizationsHeading')}
          </h4>
          <AuthorizationSummary locale={locale} messages={messages} table={authorizations} />
        </section>
      </div>

      <section
        aria-labelledby="summary-evidence-heading"
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <h4 id="summary-evidence-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'receptions.summary.evidenceHeading')}
        </h4>
        <p className="text-caption text-text-muted" lang={locale}>
          {translate(messages, 'receptions.summary.notVerified')}
        </p>
        <EvidenceSummary locale={locale} messages={messages} table={evidence} />
      </section>

      <section
        aria-labelledby="summary-decision-heading"
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <h4 id="summary-decision-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'receptions.summary.decisionHeading')}
        </h4>

        {writesLocked ? (
          <p role="status" className="text-body text-text-secondary" lang={locale}>
            {translate(messages, 'receptions.summary.decisionClosed')}
          </p>
        ) : (
          <>
            {affordances.approve ? (
              capabilities.approveReceptions ? (
                <ApprovalPanel
                  locale={locale}
                  messages={messages}
                  visitId={visitId}
                  recordVersion={recordVersion}
                  settle={settle}
                  goToStep={goToStep}
                />
              ) : (
                <p className="text-caption text-text-muted" lang={locale}>
                  {translate(messages, 'receptions.summary.approveDenied')}
                </p>
              )
            ) : (
              <p className="text-caption text-text-muted" lang={locale}>
                {translate(messages, 'receptions.summary.approveUnavailable')}
              </p>
            )}

            {affordances.closeWithoutWork || affordances.refuse ? (
              capabilities.closeReceptions ? (
                <div className="grid gap-4 border-t border-border pt-3 lg:grid-cols-2">
                  {affordances.closeWithoutWork ? (
                    <ClosurePanel
                      locale={locale}
                      messages={messages}
                      visitId={visitId}
                      recordVersion={recordVersion}
                      kind="close_without_work"
                      settle={settle}
                    />
                  ) : null}
                  {affordances.refuse ? (
                    <ClosurePanel
                      locale={locale}
                      messages={messages}
                      visitId={visitId}
                      recordVersion={recordVersion}
                      kind="refuse"
                      settle={settle}
                    />
                  ) : null}
                </div>
              ) : (
                <p
                  className="border-t border-border pt-3 text-caption text-text-muted"
                  lang={locale}
                >
                  {translate(messages, 'receptions.summary.closeDenied')}
                </p>
              )
            ) : null}
          </>
        )}

        <div className="border-t border-border pt-3">
          <Button
            component={Link}
            href={`/${locale}/receptions/check-in/${visitId}/acknowledgement`}
            variant="outlined"
          >
            {translate(messages, 'receptions.summary.openAcknowledgement')}
          </Button>
        </div>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------- *
 * Read-backs
 * ---------------------------------------------------------------------- */

/**
 * Standing FIRST, and marked. `isStanding` is each partner's CURRENT decision
 * across both tables; a superseded row is history and is shown as history, so
 * a withdrawn consent can never read as consent. The page the server answered
 * is only re-ordered, never filtered, and the grid is handed that page.
 */
function standingFirst(table: ServerTable<AuthorizationEntry>): ServerTable<AuthorizationEntry> {
  const response = table.response;
  if (response === null) return table;
  const standing = response.rows.filter((row) => row.isStanding);
  const superseded = response.rows.filter((row) => !row.isStanding);
  return { ...table, response: { ...response, rows: [...standing, ...superseded] } };
}

function AuthorizationSummary({
  locale,
  messages,
  table,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly table: ServerTable<AuthorizationEntry>;
}) {
  const columns = useMemo(
    () => authorizationColumns(locale, messages, 'summary'),
    [locale, messages]
  );
  const ordered = useMemo(() => standingFirst(table), [table]);
  const rows = table.response?.rows ?? [];

  return (
    <>
      <OperationalGrid<AuthorizationEntry>
        messages={messages}
        locale={locale}
        label={translate(messages, 'receptions.summary.authorizationsHeading')}
        columns={columns}
        rowId={(row) => `${row.kind}-${row.id}`}
        table={ordered}
        density="compact"
        suppressEmptyState
        testId="summary-authorization-grid"
      />
      {table.status === 'idle' && table.response !== null && rows.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'receptions.summary.authorizationsEmpty')}
        </p>
      ) : null}
    </>
  );
}

function EvidenceSummary({
  locale,
  messages,
  table,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly table: ServerTable<ConditionEvidenceEntry>;
}) {
  const columns = useMemo<readonly OperationalColumn<ConditionEvidenceEntry>[]>(
    () => [
      {
        id: 'kind',
        headerKey: 'receptions.acknowledgement.columnEvidence',
        flex: 2,
        cell: (row) => translateDynamic(messages, `receptions.evidenceKind.${row.kind}`),
      },
      {
        id: 'source',
        headerKey: 'receptions.acknowledgement.columnSource',
        flex: 2,
        cell: (row) =>
          isCustomerReported(row.kind) ? (
            <span className="flex flex-col">
              <span>{translate(messages, 'receptions.summary.customerReported')}</span>
              <span className="text-caption text-text-muted" lang={locale}>
                {translate(messages, 'receptions.summary.complaintWordsRestricted')}
              </span>
            </span>
          ) : (
            translate(messages, 'receptions.summary.staffObserved')
          ),
      },
      {
        id: 'media',
        headerKey: 'receptions.acknowledgement.columnMedia',
        // Existence only, and no lifecycle state: this row publishes
        // `evidenceDocumentId` and no status beside it, so naming one
        // would name a state this screen never read. Never the
        // identifier either — it is an internal reference.
        cell: (row) =>
          hasRegisteredMedia(row.evidenceDocumentId)
            ? translate(messages, 'receptions.summary.mediaRegistered')
            : '',
      },
      {
        id: 'recordedAt',
        headerKey: 'receptions.acknowledgement.columnRecordedAt',
        cell: (row) => <InstantOrRaw value={row.recordedAt} locale={locale} />,
      },
    ],
    [locale, messages]
  );
  const rows = table.response?.rows ?? [];

  return (
    <>
      <OperationalGrid<ConditionEvidenceEntry>
        messages={messages}
        locale={locale}
        label={translate(messages, 'receptions.summary.evidenceHeading')}
        columns={columns}
        rowId={(row) => `${row.kind}-${row.id}`}
        table={table}
        density="compact"
        suppressEmptyState
        testId="summary-evidence-grid"
      />
      {table.status === 'idle' && table.response !== null && rows.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'receptions.summary.evidenceEmpty')}
        </p>
      ) : null}
      {table.status === 'idle' && table.response?.hasMore ? (
        <p className="text-caption text-text-muted" lang={locale}>
          {translate(messages, 'receptions.summary.evidenceTruncated')}
        </p>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------------- *
 * The commands
 * ---------------------------------------------------------------------- */

function ApprovalPanel({
  locale,
  messages,
  visitId,
  recordVersion,
  settle,
  goToStep,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly visitId: string;
  readonly recordVersion: number;
  readonly settle: (state: ActionState) => Promise<void>;
  readonly goToStep: (stepId: string) => void;
}) {
  const [state, setState] = useState<ActionState>(IDLE);
  const [approvedVersion, setApprovedVersion] = useState<number | null>(null);
  const [appliedTransitions, setAppliedTransitions] = useState<readonly string[]>([]);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    const attempt = (state.attempt ?? 0) + 1;
    setPending(true);
    // Pending covers the send AND the re-read that settles it: until the
    // re-read lands the only version on hand is the one just spent, so a
    // second press would send it again and meet a stale-version conflict.
    try {
      let result: Awaited<ReturnType<typeof approveReception>>;
      try {
        result = await approveReception(visitId, recordVersion, attempt);
      } catch {
        // No answer came back: said as that, and the button works again.
        setState(unreachable(attempt));
        return;
      }
      setState(result);
      if (result.status === 'success' && result.approved) {
        // The RESPONSE's version, never `recordVersion + 1`: approve applies one
        // edge from `inspecting` and two from `opened`.
        setApprovedVersion(nextVersionAfter(recordVersion, result.approved.recordVersion));
        setAppliedTransitions(result.approved.appliedTransitions);
      }
      await settle(result);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-body text-text-primary" lang={locale}>
        {translate(messages, 'receptions.summary.approveBody')}
      </p>
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
            : translate(messages, 'receptions.summary.approve')}
        </Button>
      </div>

      {state.status === 'success' && approvedVersion !== null ? (
        <div role="status" className="rounded-md border border-border bg-surface-subtle p-3">
          <p className="text-body text-text-primary">
            {translate(messages, 'receptions.summary.approved')}
          </p>
          <p className="text-caption text-text-muted" lang={locale}>
            {appliedTransitions.length > 1
              ? translate(messages, 'receptions.summary.approvedTwoEdges')
              : translate(messages, 'receptions.summary.approvedOneEdge')}
          </p>
          <p className="text-caption text-text-muted">
            {translate(messages, 'receptions.summary.versionNow')}{' '}
            <span data-testid="approved-record-version" dir="ltr">
              {approvedVersion}
            </span>
          </p>
        </div>
      ) : null}

      <CommandOutcome locale={locale} messages={messages} state={state} goToStep={goToStep} />
    </div>
  );
}

type ClosureKind = 'close_without_work' | 'refuse';

/**
 * The two exits' copy, keyed by kind.
 *
 * Typed `keyof Messages` rather than `string` deliberately: `translate` then
 * stays literal-checked through the table, so a mistyped key here is a compile
 * error instead of a screen that renders its own key at a customer.
 */
const CLOSURE_COPY: Readonly<
  Record<
    ClosureKind,
    {
      readonly heading: keyof Messages;
      readonly body: keyof Messages;
      readonly submit: keyof Messages;
    }
  >
> = {
  close_without_work: {
    heading: 'receptions.closure.closeHeading',
    body: 'receptions.closure.closeBody',
    submit: 'receptions.closure.closeSubmit',
  },
  refuse: {
    heading: 'receptions.closure.refuseHeading',
    body: 'receptions.closure.refuseBody',
    submit: 'receptions.closure.refuseSubmit',
  },
};

/**
 * One terminal exit, asked in `ReasonDialog`.
 *
 * The reason is checked here before anything is sent (`closureReasonProblem`:
 * present, and no longer than the record allows) and refused ON the reason box,
 * which keeps what was typed. A server refusal of the reason lands on the same
 * box; any other answer closes the dialog and is said beside the button.
 */
function ClosurePanel({
  locale,
  messages,
  visitId,
  recordVersion,
  kind,
  settle,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly visitId: string;
  readonly recordVersion: number;
  readonly kind: ClosureKind;
  readonly settle: (state: ActionState) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  const [state, setState] = useState<ActionState>(IDLE);
  const [pending, setPending] = useState(false);
  const copy = CLOSURE_COPY[kind];

  const close = () => {
    setOpen(false);
    setReasonError(undefined);
    setDialogError(undefined);
  };

  const submit = async (reason: string) => {
    const found = closureReasonProblem(reason);
    if (found !== null) {
      setReasonError(translateDynamic(messages, found));
      return;
    }
    setReasonError(undefined);
    setDialogError(undefined);
    const attempt = (state.attempt ?? 0) + 1;
    const input = { reason: reason.trim() };
    setPending(true);
    // Pending covers the send AND the re-read that settles it, so the exit
    // cannot be pressed again with the version this command just spent.
    try {
      let result: ActionState;
      try {
        result =
          kind === 'refuse'
            ? await refuseReception(visitId, recordVersion, input, attempt)
            : await closeReceptionWithoutWork(visitId, recordVersion, input, attempt);
      } catch {
        // No answer came back: the dialog stays open with the reason typed.
        const lost = unreachable(attempt);
        setState(lost);
        setDialogError(translate(messages, 'state.unavailable.message'));
        return;
      }
      const refusedReason = result.fieldErrors?.['reason'];
      if (result.status === 'invalid' && refusedReason !== undefined) {
        // The service refused the reason itself: said on the box, still open.
        setState(result);
        setReasonError(translateDynamic(messages, refusedReason));
        return;
      }
      setState(result);
      close();
      await settle(result);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <h5 className="text-body font-medium text-text-primary">
        {translate(messages, copy.heading)}
      </h5>
      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, copy.body)}
      </p>
      <div>
        <Button
          type="button"
          variant="outlined"
          color="error"
          onClick={() => setOpen(true)}
          disabled={pending}
        >
          {translate(messages, copy.submit)}
        </Button>
      </div>
      <CommandOutcome
        locale={locale}
        messages={messages}
        state={state.status === 'unavailable' && open ? IDLE : state}
      />
      <ReasonDialog
        open={open}
        onCancel={close}
        onConfirm={(reason) => void submit(reason)}
        title={translate(messages, copy.heading)}
        description={`${translate(messages, copy.body)} ${translate(messages, 'receptions.closure.reasonHint')}`}
        confirmLabel={translate(messages, copy.submit)}
        reasonLabel={translate(messages, 'receptions.closure.reason')}
        messages={messages}
        destructive
        pending={pending}
        error={dialogError}
        reasonError={reasonError}
        maxLength={MAX_CLOSURE_REASON}
        testId={`closure-dialog-${kind}`}
        // A typed closure reason is unsaved work: leaving the page asks first.
        countsAsUnsaved
      />
    </div>
  );
}

/**
 * One outcome line for a guarded command.
 *
 * The two 409s are told apart and answered differently: a stale version is
 * cured by the re-read that has just happened, and the operator is invited to
 * try again; a blocked state is not cured by anything the operator can do here,
 * and inviting a retry would invite the same refusal.
 *
 * ## A blocked refusal names its precondition, and offers the step (DEF-T-10)
 *
 * "The visit's current state does not allow this command" was printed for
 * every blocked 409, including the one an operator CAN cure: approval refused
 * because no verified authorization had been recorded, which is a form two
 * steps back. The sentence was true, said nothing about what was missing, and
 * pointed nowhere.
 *
 * So when the API published a reason token — `refusalReasonKey` recognises the
 * ones the approval path can produce — that sentence is shown instead of the
 * generic one, and when the reason is one a step satisfies
 * (`refusalFixStepId`), a button opens that step. Nothing is invented here: a
 * reason this module has not been told about still gets the generic sentence
 * rather than a guess dressed up as an explanation.
 */
export function CommandOutcome({
  locale,
  messages,
  state,
  goToStep,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly state: ActionState;
  /** Opens a step of the wizard; absent where the outcome is not in one. */
  readonly goToStep?: (stepId: string) => void;
}) {
  if (state.status === 'idle' || state.status === 'success') return null;

  if (state.status === 'conflict') {
    const kind = conflictKindOf(state.messageKey);
    const reasonKey = kind === 'blocked' ? refusalReasonKey(state.messageKey) : null;
    const fixStepId = reasonKey === null ? null : refusalFixStepId(reasonKey);
    return (
      <div role="alert" className="rounded-md border border-border bg-surface-subtle p-3">
        <p className="text-body text-text-primary" lang={locale}>
          {reasonKey !== null
            ? translateDynamic(messages, reasonKey)
            : translate(
                messages,
                kind === 'stale'
                  ? 'receptions.command.conflictStale'
                  : 'receptions.command.conflictBlocked'
              )}
        </p>
        {fixStepId !== null && goToStep !== undefined ? (
          <p className="mt-2">
            <Button
              type="button"
              variant="outlined"
              size="small"
              onClick={() => goToStep(fixStepId)}
            >
              {translate(messages, 'receptions.command.goToAuthorization')}
            </Button>
          </p>
        ) : null}
        {state.correlationId ? (
          <p className="mt-1 text-caption text-text-muted">
            {translate(messages, 'state.correlationId')}{' '}
            <code className="font-mono">{state.correlationId}</code>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <p role="alert" className="text-body text-error" lang={locale}>
      {state.messageKey
        ? translateWithValues(messages, state.messageKey, state.messageValues)
        : translate(messages, 'action.failed')}
      <FailureExplanation messages={messages} messageKey={state.messageKey ?? ''} />
      {state.correlationId ? (
        <code className="ms-2 font-mono text-caption">{state.correlationId}</code>
      ) : null}
    </p>
  );
}
