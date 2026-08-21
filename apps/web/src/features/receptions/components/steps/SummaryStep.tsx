'use client';

import Link from 'next/link';
import { useCallback, useState, useTransition } from 'react';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { TextAreaField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { PartyLabel } from '@/components/party/PartyLabel';
import {
  ErrorState,
  LoadingState,
  PermissionDeniedState,
  SessionExpiredState,
} from '@/components/states/States';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { formatDateTime } from '@/lib/format';
import type { ActionState } from '@/lib/forms/action-result';
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
} from '../../check-in/closure';

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
 * mandatory bounded reason that lands in the append-only status ledger.
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
 */

const IDLE: ActionState = { status: 'idle' };

export function SummaryStep({
  locale,
  messages,
  visitId,
  recordVersion,
  detail,
  capabilities,
  writesLocked,
  refresh,
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
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <h4 id="summary-parties-heading" className="text-body font-medium text-text-primary">
            {translate(messages, 'receptions.summary.partiesHeading')}
          </h4>
          <RoleSummary messages={messages} table={roles} />
        </section>

        <section
          aria-labelledby="summary-authorizations-heading"
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
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

        <p className="border-t border-border pt-3">
          <Link
            href={`/${locale}/receptions/check-in/${visitId}/acknowledgement`}
            className="text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2"
          >
            {translate(messages, 'receptions.summary.openAcknowledgement')}
          </Link>
        </p>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------- *
 * Read-backs
 * ---------------------------------------------------------------------- */

function ListStates({
  messages,
  status,
  correlationId,
  onRetry,
}: {
  readonly messages: Messages;
  readonly status: string;
  readonly correlationId: string | undefined;
  readonly onRetry: () => void;
}) {
  if (status === 'loading') return <LoadingState messages={messages} />;
  if (status === 'denied') {
    return (
      <PermissionDeniedState messages={messages} {...(correlationId ? { correlationId } : {})} />
    );
  }
  if (status === 'expired') return <SessionExpiredState messages={messages} />;
  return (
    <ErrorState
      messages={messages}
      action={
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {translate(messages, 'state.retry')}
        </button>
      }
      {...(correlationId ? { correlationId } : {})}
    />
  );
}

function RoleSummary({
  messages,
  table,
}: {
  readonly messages: Messages;
  readonly table: ReturnType<typeof useServerTable<PartyRoleEntry>>;
}) {
  if (table.status !== 'idle') {
    return (
      <ListStates
        messages={messages}
        status={table.status}
        correlationId={table.correlationId}
        onRetry={table.refresh}
      />
    );
  }
  const rows = table.response?.rows ?? [];
  if (rows.length === 0) {
    return (
      <p className="text-body text-text-secondary">
        {translate(messages, 'receptions.summary.partiesEmpty')}
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
          <PartyLabel
            messages={messages}
            party={{
              partnerName: row.partnerDisplayName,
              partnerNumber: row.partnerDisplayNumber,
              partnerType: null,
            }}
          />
          <span className="text-caption text-text-secondary">
            {translateDynamic(messages, `receptions.partyRole.${row.relationshipRole}`)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function AuthorizationSummary({
  locale,
  messages,
  table,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly table: ReturnType<typeof useServerTable<AuthorizationEntry>>;
}) {
  if (table.status !== 'idle') {
    return (
      <ListStates
        messages={messages}
        status={table.status}
        correlationId={table.correlationId}
        onRetry={table.refresh}
      />
    );
  }
  const rows = table.response?.rows ?? [];
  if (rows.length === 0) {
    return (
      <p className="text-body text-text-secondary">
        {translate(messages, 'receptions.summary.authorizationsEmpty')}
      </p>
    );
  }
  /*
   * Standing FIRST, and marked. `isStanding` is each partner's CURRENT decision
   * across both tables; a superseded row is history and is shown as history, so
   * a withdrawn consent can never read as consent.
   */
  const standing = rows.filter((row) => row.isStanding);
  const superseded = rows.filter((row) => !row.isStanding);
  return (
    <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
      {[...standing, ...superseded].map((row) => (
        <li key={`${row.kind}-${row.id}`} className="flex flex-wrap items-center gap-3 px-3 py-2">
          <PartyLabel
            messages={messages}
            party={{ partnerName: row.partnerDisplayName, partnerNumber: null, partnerType: null }}
          />
          <span
            className={
              row.decision === 'approved'
                ? 'text-caption font-medium text-success'
                : 'text-caption font-medium text-error'
            }
          >
            {translate(
              messages,
              row.decision === 'approved'
                ? 'receptions.authorization.approved'
                : 'receptions.authorization.declined'
            )}
          </span>
          <span className="text-caption text-text-secondary">
            {translate(
              messages,
              row.kind === 'refusal'
                ? 'receptions.authorization.kindRefusal'
                : 'receptions.authorization.kindAuthorization'
            )}
          </span>
          <span className="text-caption text-text-muted">
            {row.isStanding
              ? translate(messages, 'receptions.authorization.standing')
              : translate(messages, 'receptions.summary.supersededDecision')}
          </span>
          <span className="text-caption text-text-muted">
            {formatDateTime(row.occurredAt, locale)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function EvidenceSummary({
  locale,
  messages,
  table,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly table: ReturnType<typeof useServerTable<ConditionEvidenceEntry>>;
}) {
  if (table.status !== 'idle') {
    return (
      <ListStates
        messages={messages}
        status={table.status}
        correlationId={table.correlationId}
        onRetry={table.refresh}
      />
    );
  }
  const rows = table.response?.rows ?? [];
  if (rows.length === 0) {
    return (
      <p className="text-body text-text-secondary">
        {translate(messages, 'receptions.summary.evidenceEmpty')}
      </p>
    );
  }
  return (
    <>
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {rows.map((row) => {
          const reported = isCustomerReported(row.kind);
          return (
            <li key={`${row.kind}-${row.id}`} className="flex flex-col gap-1 px-3 py-2">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-body text-text-primary">
                  {translateDynamic(messages, `receptions.evidenceKind.${row.kind}`)}
                </span>
                <span
                  className={
                    reported
                      ? 'rounded-full border border-border px-2 py-0.5 text-caption text-text-secondary'
                      : 'rounded-full bg-surface-subtle px-2 py-0.5 text-caption text-text-secondary'
                  }
                >
                  {translate(
                    messages,
                    reported
                      ? 'receptions.summary.customerReported'
                      : 'receptions.summary.staffObserved'
                  )}
                </span>
                {hasRegisteredMedia(row.evidenceDocumentId) ? (
                  // Existence only, and no lifecycle state: this row publishes
                  // `evidenceDocumentId` and no status beside it, so naming one
                  // would name a state this screen never read. Never the
                  // identifier either — it is an internal reference.
                  <span className="text-caption text-text-muted">
                    {translate(messages, 'receptions.summary.mediaRegistered')}
                  </span>
                ) : null}
                <span className="text-caption text-text-muted">
                  {formatDateTime(row.recordedAt, locale)}
                </span>
              </div>
              {reported ? (
                <p className="text-caption text-text-muted" lang={locale}>
                  {translate(messages, 'receptions.summary.complaintWordsRestricted')}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {table.response?.hasMore ? (
        <p className="text-caption text-text-muted" lang={locale}>
          {translate(messages, 'receptions.summary.evidenceTruncated')}
        </p>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------------- *
 * Commands
 * ---------------------------------------------------------------------- */

function ApprovalPanel({
  locale,
  messages,
  visitId,
  recordVersion,
  settle,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly visitId: string;
  readonly recordVersion: number;
  readonly settle: (state: ActionState) => Promise<void>;
}) {
  const [state, setState] = useState<ActionState>(IDLE);
  const [approvedVersion, setApprovedVersion] = useState<number | null>(null);
  const [appliedTransitions, setAppliedTransitions] = useState<readonly string[]>([]);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const result = await approveReception(visitId, recordVersion, (state.attempt ?? 0) + 1);
      setState(result);
      if (result.status === 'success' && result.approved) {
        // The RESPONSE's version, never `recordVersion + 1`: approve applies one
        // edge from `inspecting` and two from `opened`.
        setApprovedVersion(nextVersionAfter(recordVersion, result.approved.recordVersion));
        setAppliedTransitions(result.approved.appliedTransitions);
      }
      await settle(result);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-body text-text-primary" lang={locale}>
        {translate(messages, 'receptions.summary.approveBody')}
      </p>
      <div>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {pending
            ? translate(messages, 'form.pending')
            : translate(messages, 'receptions.summary.approve')}
        </button>
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

      <CommandOutcome locale={locale} messages={messages} state={state} />
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
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [state, setState] = useState<ActionState>(IDLE);
  const [pending, startTransition] = useTransition();
  const copy = CLOSURE_COPY[kind];

  const submit = () => {
    const found = closureReasonProblem(reason);
    setProblem(found);
    if (found !== null) return;
    startTransition(async () => {
      const attempt = (state.attempt ?? 0) + 1;
      const input = { reason: reason.trim() };
      const result =
        kind === 'refuse'
          ? await refuseReception(visitId, recordVersion, input, attempt)
          : await closeReceptionWithoutWork(visitId, recordVersion, input, attempt);
      setState(result);
      if (result.status === 'success') setReason('');
      await settle(result);
    });
  };

  return (
    <form
      aria-label={translate(messages, copy.heading)}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      noValidate
      className="flex flex-col gap-2"
    >
      <h5 className="text-body font-medium text-text-primary">
        {translate(messages, copy.heading)}
      </h5>
      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, copy.body)}
      </p>
      <TextAreaField
        label={translate(messages, 'receptions.closure.reason')}
        description={translate(messages, 'receptions.closure.reasonHint')}
        required
        rows={3}
        maxLength={MAX_CLOSURE_REASON}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        {...(problem !== null ? { error: translateDynamic(messages, problem) } : {})}
      />
      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-border-strong px-4 py-2 text-body font-medium text-text-primary disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {pending ? translate(messages, 'form.pending') : translate(messages, copy.submit)}
        </button>
      </div>
      <CommandOutcome locale={locale} messages={messages} state={state} />
    </form>
  );
}

/**
 * One outcome line for a guarded command.
 *
 * The two 409s are told apart and answered differently: a stale version is
 * cured by the re-read that has just happened, and the operator is invited to
 * try again; a blocked state is not cured by anything the operator can do here,
 * and inviting a retry would invite the same refusal.
 */
export function CommandOutcome({
  locale,
  messages,
  state,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly state: ActionState;
}) {
  if (state.status === 'idle' || state.status === 'success') return null;

  if (state.status === 'conflict') {
    const kind = conflictKindOf(state.messageKey);
    return (
      <div role="alert" className="rounded-md border border-border bg-surface-subtle p-3">
        <p className="text-body text-text-primary" lang={locale}>
          {translate(
            messages,
            kind === 'stale'
              ? 'receptions.command.conflictStale'
              : 'receptions.command.conflictBlocked'
          )}
        </p>
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
        ? translateDynamic(messages, state.messageKey)
        : translate(messages, 'action.failed')}
      {state.correlationId ? (
        <code className="ms-2 font-mono text-caption">{state.correlationId}</code>
      ) : null}
    </p>
  );
}
