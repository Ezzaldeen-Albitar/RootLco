'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { SelectField, TextAreaField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { listApprovalLimits } from '@/features/administration/access/api';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import type { ActionState } from '@/lib/forms/action-result';
import { formatDateTime } from '@/lib/format';

import type { DecisionEvidenceBody } from '@/lib/contracts/quotations-contract';
import {
  createQuotationRevision,
  decideItem,
  decideRevision,
  issueQuotation,
  listRevisions,
  readRevision,
  readRevisionDecisions,
} from '../api';
import {
  DECISIONS,
  DECISION_CHANNELS,
  EVIDENCE_KINDS,
  INTERNAL_CODE,
  MAX_REFERENCE_NOTE,
  type ApprovalLimit,
  type QuotationDetail,
  type QuotationRevision,
  type QuotationRevisionHeader,
  type RevisionDecisions,
} from '../quotations-contract';
import {
  Figure,
  LinesEditor,
  LinesTable,
  Money,
  OutcomeNote,
  PRIMARY_BUTTON,
  QuotationStatusBadge,
  RevisionStatusBadge,
  SECONDARY_BUTTON,
  TotalsList,
  UUID,
  newLine,
  validateLines,
  type DraftLine,
} from './shared';

/**
 * One quotation (P1-30, `W3`, FE-004 revisions, FE-007 approval display, and
 * the writes on it).
 *
 * ## Totals are captured figures
 *
 * The current revision's lines and its four totals are rendered exactly as
 * the server captured them. This screen adds, multiplies and rounds nothing;
 * the database constrains the identities and the screen shows the results.
 *
 * ## The version that guards a write is the QUOTATION's
 *
 * `quo.quotation-issue` and `quo.quotation-revision-create` compare `If-Match`
 * with the quotation's `recordVersion`, which is what this page read; a
 * revision's own `recordVersion` is never sent. After either write the page is
 * refreshed so the next write reads a fresh one.
 *
 * ## Decisions are the server's roll-up
 *
 * The decisions panel renders `outcome`, `itemCount` and `decidedCount` as the
 * read states them, with each line's decision and evidence beneath. A decision
 * is recorded against the revision the customer was shown, and the server
 * refuses one against a revision that is no longer current.
 *
 * ## Approval limits need their own code
 *
 * The discount ceiling that decides a refusal lives in the approval limits,
 * readable only under `iam.approval.manage`. With that code the panel lists the
 * company's discount limits as the server states them; without it, it says
 * they cannot be shown rather than claiming there are none.
 */

export function QuotationDetailScreen({
  locale,
  messages,
  quotation,
  canManage,
  canDecide,
  canReadLimits,
  canReadServices,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly quotation: QuotationDetail;
  /** `quo.quotation.manage` — revisions and issuing. */
  readonly canManage: boolean;
  /** `quo.decision.record` — recording the customer's decisions. */
  readonly canDecide: boolean;
  /** `iam.approval.manage` — the discount limits panel. */
  readonly canReadLimits: boolean;
  /** `svc.service.read` — whether a service can be found by code in the revision builder. */
  readonly canReadServices: boolean;
}) {
  const router = useRouter();
  const open = quotation.status === 'draft' || quotation.status === 'active';
  const current = quotation.currentRevision;
  const [decisionsEpoch, setDecisionsEpoch] = useState(0);

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-labelledby="quotation-summary-heading"
        className="rounded-lg border border-border bg-surface p-4"
        lang={locale}
      >
        <h2 id="quotation-summary-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'quotations.detail.summaryHeading')}
        </h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <Figure label={translate(messages, 'quotations.detail.number')}>
            <code className="font-mono" dir="ltr">
              {quotation.quotationNumber}
            </code>
          </Figure>
          <Figure label={translate(messages, 'quotations.detail.status')}>
            <QuotationStatusBadge messages={messages} status={quotation.status} />
          </Figure>
          <Figure label={translate(messages, 'quotations.detail.currency')}>
            <code className="font-mono" dir="ltr">
              {quotation.currency}
            </code>
          </Figure>
          <Figure label={translate(messages, 'quotations.detail.workOrder')}>
            <Link
              href={`/${locale}/work-orders/${quotation.workOrderId}`}
              className="font-mono text-caption text-primary underline-offset-2 hover:underline"
              dir="ltr"
            >
              {quotation.workOrderId}
            </Link>
          </Figure>
          <Figure label={translate(messages, 'quotations.detail.payer')}>
            {quotation.payerPartnerRef ? (
              <code className="font-mono text-caption" dir="ltr">
                {quotation.payerPartnerRef}
              </code>
            ) : (
              <span className="text-text-muted">
                {translate(messages, 'quotations.detail.noPayer')}
              </span>
            )}
          </Figure>
          <Figure label={translate(messages, 'quotations.detail.version')}>
            <code className="font-mono" dir="ltr">
              {quotation.recordVersion}
            </code>
          </Figure>
        </dl>
        {!open ? (
          <p className="mt-3 text-caption text-text-muted">
            {translate(messages, 'quotations.detail.closedNote')}
          </p>
        ) : null}
      </section>

      <section
        aria-labelledby="quotation-current-heading"
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
        lang={locale}
      >
        <h2 id="quotation-current-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'quotations.current.heading')}
        </h2>
        {current ? (
          <RevisionBody locale={locale} messages={messages} revision={current} />
        ) : (
          <p className="text-body text-text-secondary">
            {translate(messages, 'quotations.current.none')}
          </p>
        )}
      </section>

      <RevisionsPanel locale={locale} messages={messages} quotation={quotation} />

      {current ? (
        <DecisionsPanel
          locale={locale}
          messages={messages}
          quotation={quotation}
          revision={current}
          canDecide={canDecide && open}
          epoch={decisionsEpoch}
          onRecorded={() => {
            setDecisionsEpoch((n) => n + 1);
            router.refresh();
          }}
        />
      ) : null}

      {canManage && open ? (
        <IssuePanel
          locale={locale}
          messages={messages}
          quotation={quotation}
          onIssued={() => router.refresh()}
        />
      ) : null}

      {canManage && open ? (
        <NewRevisionPanel
          locale={locale}
          messages={messages}
          quotation={quotation}
          canReadServices={canReadServices}
          onCreated={() => router.refresh()}
        />
      ) : null}

      <LimitsPanel
        locale={locale}
        messages={messages}
        companyId={quotation.companyId}
        canReadLimits={canReadLimits}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * A revision, rendered: header, lines, totals
 * ------------------------------------------------------------------ */

function RevisionBody({
  locale,
  messages,
  revision,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly revision: QuotationRevision;
}) {
  return (
    <>
      <dl className="grid gap-3 sm:grid-cols-4">
        <Figure label={translate(messages, 'quotations.revision.number')}>
          <code className="font-mono" dir="ltr">
            {revision.revisionNumber}
          </code>
        </Figure>
        <Figure label={translate(messages, 'quotations.revision.status')}>
          <RevisionStatusBadge messages={messages} status={revision.status} />
        </Figure>
        <Figure label={translate(messages, 'quotations.revision.issuedAt')}>
          {revision.issuedAt ? (
            <span dir="ltr">{formatDateTime(revision.issuedAt, locale)}</span>
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'quotations.revision.notIssued')}
            </span>
          )}
        </Figure>
        <Figure label={translate(messages, 'quotations.revision.expiresAt')}>
          {revision.expiresAt ? (
            <span dir="ltr">{formatDateTime(revision.expiresAt, locale)}</span>
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'quotations.revision.noExpiry')}
            </span>
          )}
        </Figure>
      </dl>
      <LinesTable
        locale={locale}
        messages={messages}
        lines={revision.lines}
        caption={translate(messages, 'quotations.lines.caption')}
      />
      <TotalsList locale={locale} messages={messages} revision={revision} />
      <p className="text-caption text-text-muted">
        {translate(messages, 'quotations.totals.note')}
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Revision history — headers, and any revision on request
 * ------------------------------------------------------------------ */

function RevisionsPanel({
  locale,
  messages,
  quotation,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly quotation: QuotationDetail;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) => listRevisions(quotation.id, request, cursor),
    [quotation.id]
  );
  const table = useServerTable<QuotationRevisionHeader>(load, { initial: INITIAL_REQUEST });
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<ReadState<QuotationRevision> | null>(null);

  useEffect(() => {
    if (!chosenId) return;
    let live = true;
    void readRevision(chosenId).then((state) => {
      if (live) setChosen(state);
    });
    return () => {
      live = false;
    };
  }, [chosenId]);

  const columns = useMemo<readonly Column<QuotationRevisionHeader>[]>(
    () => [
      {
        id: 'revisionNumber',
        headerKey: 'quotations.revisions.column.number',
        cell: (row) => (
          <code className="font-mono" dir="ltr">
            {row.revisionNumber}
          </code>
        ),
      },
      {
        id: 'status',
        headerKey: 'quotations.revisions.column.status',
        cell: (row) => <RevisionStatusBadge messages={messages} status={row.status} />,
      },
      {
        id: 'isCurrent',
        headerKey: 'quotations.revisions.column.current',
        cell: (row) =>
          row.isCurrent ? (
            <span>{translate(messages, 'quotations.revisions.current')}</span>
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'quotations.revisions.notCurrent')}
            </span>
          ),
      },
      {
        id: 'grandTotal',
        headerKey: 'quotations.revisions.column.grandTotal',
        numeric: true,
        cell: (row) =>
          row.status === 'draft' ? (
            <span className="text-text-muted">
              {translate(messages, 'quotations.totals.draftShort')}
            </span>
          ) : (
            <Money amount={row.grandTotal} currency={row.currency} locale={locale} />
          ),
      },
      {
        id: 'show',
        headerKey: 'quotations.revisions.column.actions',
        cell: (row) => (
          <button
            type="button"
            className={SECONDARY_BUTTON}
            aria-pressed={row.id === chosenId}
            onClick={() => {
              setChosen(null);
              setChosenId(row.id);
            }}
          >
            {translate(messages, 'quotations.revisions.show')}{' '}
            <code className="font-mono" dir="ltr">
              {row.revisionNumber}
            </code>
          </button>
        ),
      },
    ],
    [chosenId, locale, messages]
  );

  return (
    <section
      aria-labelledby="quotation-revisions-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="quotation-revisions-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'quotations.revisions.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'quotations.revisions.explain')}
      </p>
      <DataTable<QuotationRevisionHeader>
        messages={messages}
        columns={columns}
        rowId={(row) => row.id}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={table.setRequest}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={translate(messages, 'quotations.revisions.caption')}
        suppressEmptyState
      />
      {table.response && table.response.rows.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'quotations.revisions.none')}
        </p>
      ) : null}
      {chosenId ? (
        <section
          aria-labelledby="quotation-chosen-revision-heading"
          className="flex flex-col gap-3 border-t border-border pt-3"
        >
          <h3
            id="quotation-chosen-revision-heading"
            className="text-body font-medium text-text-primary"
          >
            {translate(messages, 'quotations.revisions.chosenHeading')}
          </h3>
          {chosen === null ? (
            <p className="text-body text-text-secondary" aria-busy="true">
              {translate(messages, 'state.loading')}
            </p>
          ) : chosen.status !== 'ok' ? (
            <p role="alert" className="text-body text-error">
              {translate(
                messages,
                chosen.status === 'denied'
                  ? 'quotations.revisions.refused'
                  : 'quotations.revisions.unavailable'
              )}
            </p>
          ) : (
            <RevisionBody locale={locale} messages={messages} revision={chosen.data} />
          )}
        </section>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Decisions — FE-007
 * ------------------------------------------------------------------ */

function DecisionsPanel({
  locale,
  messages,
  quotation,
  revision,
  canDecide,
  epoch,
  onRecorded,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly quotation: QuotationDetail;
  readonly revision: QuotationRevision;
  readonly canDecide: boolean;
  readonly epoch: number;
  readonly onRecorded: () => void;
}) {
  const [answer, setAnswer] = useState<{
    readonly revisionId: string;
    readonly state: ReadState<RevisionDecisions>;
  } | null>(null);

  useEffect(() => {
    let live = true;
    void readRevisionDecisions(revision.id).then((state) => {
      if (live) setAnswer({ revisionId: revision.id, state });
    });
    return () => {
      live = false;
    };
  }, [revision.id, epoch]);

  const state = answer && answer.revisionId === revision.id ? answer.state : null;
  const decidable =
    canDecide && revision.status === 'issued' && quotation.currentRevisionId === revision.id;

  return (
    <section
      aria-labelledby="quotation-decisions-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="quotation-decisions-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'quotations.decisions.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'quotations.decisions.explain')}
      </p>
      {state === null ? (
        <p className="text-body text-text-secondary" aria-busy="true">
          {translate(messages, 'state.loading')}
        </p>
      ) : state.status !== 'ok' ? (
        <p role="alert" className="text-body text-error">
          {translate(
            messages,
            state.status === 'denied'
              ? 'quotations.decisions.refused'
              : 'quotations.decisions.unavailable'
          )}
        </p>
      ) : (
        <DecisionsBody locale={locale} messages={messages} decisions={state.data} />
      )}
      {canDecide && !decidable ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'quotations.decisions.notDecidable')}
        </p>
      ) : null}
      {decidable ? (
        <DecisionForm
          messages={messages}
          quotation={quotation}
          revision={revision}
          onRecorded={onRecorded}
        />
      ) : null}
    </section>
  );
}

function DecisionsBody({
  locale,
  messages,
  decisions,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly decisions: RevisionDecisions;
}) {
  return (
    <>
      <dl className="grid gap-3 sm:grid-cols-3">
        <Figure label={translate(messages, 'quotations.decisions.outcome')}>
          {decisions.outcome ? (
            <strong>{translateDynamic(messages, `quotations.outcome.${decisions.outcome}`)}</strong>
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'quotations.outcome.pending')}
            </span>
          )}
        </Figure>
        <Figure label={translate(messages, 'quotations.decisions.decided')}>
          <code className="font-mono" dir="ltr">
            {decisions.decidedCount}
          </code>
        </Figure>
        <Figure label={translate(messages, 'quotations.decisions.items')}>
          <code className="font-mono" dir="ltr">
            {decisions.itemCount}
          </code>
        </Figure>
      </dl>
      {decisions.decisions.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'quotations.decisions.none')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {decisions.decisions.map((entry) => (
            <li key={entry.decisionId} className="rounded-md border border-border p-3">
              <p className="text-body">
                <code className="font-mono" dir="ltr">
                  {entry.lineNumber}
                </code>{' '}
                {entry.description ? <bdi>{entry.description}</bdi> : null}{' '}
                <strong>
                  {translateDynamic(messages, `quotations.decision.${entry.decision}`)}
                </strong>{' '}
                <span className="text-caption text-text-muted">
                  {translateDynamic(messages, `quotations.channel.${entry.channel}`)} ·{' '}
                  <span dir="ltr">{formatDateTime(entry.decidedAt, locale)}</span>
                </span>
              </p>
              {entry.evidence.length > 0 ? (
                <ul className="mt-1 flex flex-col gap-1 text-caption text-text-secondary">
                  {entry.evidence.map((item) => (
                    <li key={item.id}>
                      {translateDynamic(messages, `quotations.evidenceKind.${item.evidenceKind}`)}
                      {item.referenceNote ? (
                        <>
                          {': '}
                          <bdi>{item.referenceNote}</bdi>
                        </>
                      ) : null}
                      {item.documentVersionId ? (
                        <>
                          {' '}
                          <code className="font-mono" dir="ltr">
                            {item.documentVersionId}
                          </code>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-caption text-text-muted">
                  {translate(messages, 'quotations.decisions.noEvidence')}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function DecisionForm({
  messages,
  quotation,
  revision,
  onRecorded,
}: {
  readonly messages: Messages;
  readonly quotation: QuotationDetail;
  readonly revision: QuotationRevision;
  readonly onRecorded: () => void;
}) {
  const [target, setTarget] = useState('revision');
  const [decision, setDecision] = useState<string>('');
  const [channel, setChannel] = useState<string>('');
  const [party, setParty] = useState(quotation.payerPartnerRef ?? '');
  const [evidenceKind, setEvidenceKind] = useState<string>('');
  const [note, setNote] = useState('');
  const [documentVersionId, setDocumentVersionId] = useState('');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    if (!DECISIONS.includes(decision as (typeof DECISIONS)[number]))
      found['decision'] = 'field.required';
    if (!DECISION_CHANNELS.includes(channel as (typeof DECISION_CHANNELS)[number])) {
      found['channel'] = 'field.required';
    }
    const partyId = party.trim();
    if (partyId.length > 0 && !UUID.test(partyId))
      found['decidingPartyRef'] = 'quotations.common.idFormat';
    const kind = evidenceKind;
    const referenceNote = note.trim();
    const docId = documentVersionId.trim();
    if (kind && !EVIDENCE_KINDS.includes(kind as (typeof EVIDENCE_KINDS)[number])) {
      found['evidenceKind'] = 'field.required';
    }
    if (kind === 'document' && !UUID.test(docId))
      found['documentVersionId'] = 'quotations.decide.documentNeeded';
    if (kind !== 'document' && docId.length > 0)
      found['documentVersionId'] = 'quotations.decide.documentOnlyForDocument';
    if (referenceNote.length > MAX_REFERENCE_NOTE)
      found['referenceNote'] = 'quotations.decide.noteTooLong';
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const evidence: DecisionEvidenceBody | null = kind
      ? {
          evidenceKind: kind as DecisionEvidenceBody['evidenceKind'],
          ...(docId ? { documentVersionId: docId } : {}),
          ...(referenceNote ? { referenceNote } : {}),
        }
      : null;
    const body = {
      decision: decision as (typeof DECISIONS)[number],
      channel: channel as (typeof DECISION_CHANNELS)[number],
      ...(partyId ? { decidingPartyRef: partyId } : {}),
      ...(evidence ? { evidence } : {}),
      presentedRevisionId: revision.id,
    };
    setBusy(true);
    const result =
      target === 'revision'
        ? await decideRevision(revision.id, body)
        : await decideItem(target, body);
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success') {
      setOutcome(null);
      onRecorded();
    }
  };

  const targetOptions = [
    { value: 'revision', label: translate(messages, 'quotations.decide.wholeRevision') },
    ...revision.lines.map((line) => ({
      value: line.id,
      label: `${translate(messages, 'quotations.lines.one')} ${line.lineNumber}${line.description ? ` — ${line.description}` : ''}`,
    })),
  ];

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="quotation-decide-heading"
      className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2"
    >
      <h3
        id="quotation-decide-heading"
        className="text-body font-medium text-text-primary sm:col-span-2"
      >
        {translate(messages, 'quotations.decide.heading')}
      </h3>
      <p className="text-caption text-text-muted sm:col-span-2">
        {translate(messages, 'quotations.decide.explain')}
      </p>
      <SelectField
        label={translate(messages, 'quotations.decide.target')}
        required
        value={target}
        onChange={(event) => setTarget(event.target.value)}
        options={targetOptions}
      />
      <SelectField
        label={translate(messages, 'quotations.decide.decision')}
        required
        value={decision}
        onChange={(event) => setDecision(event.target.value)}
        options={DECISIONS.map((value) => ({
          value,
          label: translateDynamic(messages, `quotations.decision.${value}`),
        }))}
        placeholder={translate(messages, 'quotations.decide.chooseDecision')}
        error={errorFor('decision')}
      />
      <SelectField
        label={translate(messages, 'quotations.decide.channel')}
        required
        value={channel}
        onChange={(event) => setChannel(event.target.value)}
        options={DECISION_CHANNELS.map((value) => ({
          value,
          label: translateDynamic(messages, `quotations.channel.${value}`),
        }))}
        placeholder={translate(messages, 'quotations.decide.chooseChannel')}
        error={errorFor('channel')}
      />
      <TextField
        label={translate(messages, 'quotations.decide.party')}
        description={translate(messages, 'quotations.decide.partyHelp')}
        spellCheck={false}
        dir="ltr"
        value={party}
        onChange={(event) => setParty(event.target.value)}
        error={errorFor('decidingPartyRef')}
      />
      <SelectField
        label={translate(messages, 'quotations.decide.evidenceKind')}
        value={evidenceKind}
        onChange={(event) => setEvidenceKind(event.target.value)}
        options={EVIDENCE_KINDS.map((value) => ({
          value,
          label: translateDynamic(messages, `quotations.evidenceKind.${value}`),
        }))}
        placeholder={translate(messages, 'quotations.decide.noEvidence')}
        error={errorFor('evidenceKind')}
      />
      <TextField
        label={translate(messages, 'quotations.decide.documentVersionId')}
        description={translate(messages, 'quotations.decide.documentHelp')}
        spellCheck={false}
        dir="ltr"
        value={documentVersionId}
        onChange={(event) => setDocumentVersionId(event.target.value)}
        error={errorFor('documentVersionId')}
      />
      <div className="sm:col-span-2">
        <TextAreaField
          label={translate(messages, 'quotations.decide.note')}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          error={errorFor('referenceNote')}
        />
      </div>
      <div className="sm:col-span-2">
        <OutcomeNote messages={messages} outcome={outcome} />
      </div>
      <div className="sm:col-span-2">
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'quotations.decide.submit')}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Issuing — guarded by the QUOTATION's version
 * ------------------------------------------------------------------ */

function IssuePanel({
  locale,
  messages,
  quotation,
  onIssued,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly quotation: QuotationDetail;
  readonly onIssued: () => void;
}) {
  const draft =
    quotation.currentRevision && quotation.currentRevision.status === 'draft'
      ? quotation.currentRevision
      : null;
  const [expiresAt, setExpiresAt] = useState('');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const submit = async () => {
    if (!draft) return;
    const raw = expiresAt.trim();
    let instant: string | null = null;
    if (raw.length > 0) {
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        setErrors({ expiresAt: 'quotations.issue.dateFormat' });
        return;
      }
      instant = parsed.toISOString();
    }
    setErrors({});
    setBusy(true);
    const result = await issueQuotation(
      quotation.id,
      { revisionId: draft.id, ...(instant ? { expiresAt: instant } : {}) },
      quotation.recordVersion
    );
    setBusy(false);
    notifyActionResult(result, messages);
    if (result.status === 'success') {
      setOutcome(null);
      onIssued();
      return;
    }
    setOutcome(
      result.status === 'conflict'
        ? { ...result, messageKey: 'quotations.detail.conflict' }
        : result
    );
  };

  return (
    <section
      aria-labelledby="quotation-issue-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="quotation-issue-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'quotations.issue.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'quotations.issue.explain')}
      </p>
      {draft === null ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'quotations.issue.noDraft')}
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          noValidate
          aria-labelledby="quotation-issue-heading"
          className="grid gap-3 sm:grid-cols-2"
        >
          <p className="text-body sm:col-span-2">
            {translate(messages, 'quotations.issue.draftLabel')}{' '}
            <code className="font-mono" dir="ltr">
              {draft.revisionNumber}
            </code>
          </p>
          <TextField
            label={translate(messages, 'quotations.issue.expiresAt')}
            description={translate(messages, 'quotations.issue.expiresAtHelp')}
            type="datetime-local"
            dir="ltr"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            error={
              errors['expiresAt'] ? translateDynamic(messages, errors['expiresAt']) : undefined
            }
          />
          <div className="sm:col-span-2">
            <OutcomeNote messages={messages} outcome={outcome} />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
              {translate(messages, 'quotations.issue.submit')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * A new revision — FE-004, guarded by the QUOTATION's version
 * ------------------------------------------------------------------ */

function NewRevisionPanel({
  locale,
  messages,
  quotation,
  canReadServices,
  onCreated,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly quotation: QuotationDetail;
  readonly canReadServices: boolean;
  readonly onCreated: () => void;
}) {
  const [lines, setLines] = useState<readonly DraftLine[]>([newLine()]);
  const [customerClass, setCustomerClass] = useState('');
  const [requestedBy, setRequestedBy] = useState('');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const { bodies, errors: found } = validateLines(lines);
    const klass = customerClass.trim();
    if (klass.length > 0 && !INTERNAL_CODE.test(klass))
      found['customerClass'] = 'quotations.common.classFormat';
    const requester = requestedBy.trim();
    if (requester.length > 0 && !UUID.test(requester))
      found['discountRequestedBy'] = 'quotations.common.idFormat';
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await createQuotationRevision(
      quotation.id,
      {
        lines: bodies,
        ...(klass ? { customerClass: klass } : {}),
        ...(requester ? { discountRequestedBy: requester } : {}),
      },
      quotation.recordVersion
    );
    setBusy(false);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success') {
      setOutcome(null);
      setLines([newLine()]);
      onCreated();
      return;
    }
    setOutcome(
      result.state.status === 'conflict'
        ? { ...result.state, messageKey: 'quotations.detail.conflict' }
        : result.state
    );
  };

  return (
    <section
      aria-labelledby="quotation-revise-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="quotation-revise-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'quotations.revise.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'quotations.revise.explain')}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        noValidate
        aria-labelledby="quotation-revise-heading"
        className="flex flex-col gap-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label={translate(messages, 'quotations.build.customerClass')}
            description={translate(messages, 'quotations.common.classHelp')}
            spellCheck={false}
            dir="ltr"
            value={customerClass}
            onChange={(event) => setCustomerClass(event.target.value)}
            error={errorFor('customerClass')}
          />
          <TextField
            label={translate(messages, 'quotations.build.requestedBy')}
            description={translate(messages, 'quotations.build.requestedByHelp')}
            spellCheck={false}
            dir="ltr"
            value={requestedBy}
            onChange={(event) => setRequestedBy(event.target.value)}
            error={errorFor('discountRequestedBy')}
          />
        </div>
        <LinesEditor
          messages={messages}
          currency={quotation.currency}
          lines={lines}
          onChange={setLines}
          canReadServices={canReadServices}
          errors={errors}
        />
        <OutcomeNote
          messages={messages}
          outcome={outcome}
          hintKey="quotations.build.discountRefusedHint"
        />
        <div>
          <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
            {translate(messages, 'quotations.revise.submit')}
          </button>
        </div>
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Discount limits — readable only under iam.approval.manage
 * ------------------------------------------------------------------ */

function LimitsPanel({
  locale,
  messages,
  companyId,
  canReadLimits,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly companyId: string;
  readonly canReadLimits: boolean;
}) {
  const [rows, setRows] = useState<readonly ApprovalLimit[] | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  useEffect(() => {
    if (!canReadLimits) return;
    let live = true;
    void listApprovalLimits(
      { ...INITIAL_REQUEST, filters: [{ key: 'companyId', value: companyId }] },
      null
    ).then((page) => {
      if (!live) return;
      if (page.status === 'ok') setRows(page.rows as readonly ApprovalLimit[]);
      else
        setRefused(
          page.status === 'denied' ? 'quotations.limits.refused' : 'quotations.limits.unavailable'
        );
    });
    return () => {
      live = false;
    };
  }, [canReadLimits, companyId]);

  const discountRows = (rows ?? []).filter((row) => row.limitType === 'discount');

  return (
    <section
      aria-labelledby="quotation-limits-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="quotation-limits-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'quotations.limits.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'quotations.limits.explain')}
      </p>
      {!canReadLimits ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'quotations.limits.noPermission')}
        </p>
      ) : refused ? (
        <p role="alert" className="text-body text-error">
          {translateDynamic(messages, refused)}
        </p>
      ) : rows === null ? (
        <p className="text-body text-text-secondary" aria-busy="true">
          {translate(messages, 'state.loading')}
        </p>
      ) : discountRows.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'quotations.limits.none')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <caption className="sr-only">
              {translate(messages, 'quotations.limits.caption')}
            </caption>
            <thead>
              <tr className="text-caption text-text-muted">
                <th scope="col" className="py-1 pe-3 text-start">
                  {translate(messages, 'quotations.limits.column.holder')}
                </th>
                <th scope="col" className="py-1 pe-3 text-end">
                  {translate(messages, 'quotations.limits.column.amount')}
                </th>
                <th scope="col" className="py-1 pe-3 text-start">
                  {translate(messages, 'quotations.limits.column.from')}
                </th>
                <th scope="col" className="py-1 text-start">
                  {translate(messages, 'quotations.limits.column.to')}
                </th>
              </tr>
            </thead>
            <tbody>
              {discountRows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="py-2 pe-3">
                    <code className="font-mono text-caption" dir="ltr">
                      {row.userId ?? row.roleId ?? '—'}
                    </code>
                  </td>
                  <td className="py-2 pe-3 text-end">
                    <Money amount={row.amount} currency={row.currencyCode} locale={locale} />
                  </td>
                  <td className="py-2 pe-3">
                    <code className="font-mono text-caption" dir="ltr">
                      {row.effectiveFrom}
                    </code>
                  </td>
                  <td className="py-2">
                    {row.effectiveTo ? (
                      <code className="font-mono text-caption" dir="ltr">
                        {row.effectiveTo}
                      </code>
                    ) : (
                      <span className="text-text-muted">
                        {translate(messages, 'quotations.limits.noEnd')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
