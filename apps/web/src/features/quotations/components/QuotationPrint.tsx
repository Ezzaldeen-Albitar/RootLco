'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Button from '@mui/material/Button';

import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { PrintDocument, PrintTable } from '@/components/print/PrintDocument';
import { PrintUnsavedNote } from '@/components/print/PrintUnsavedNote';
import { MuiLoadingState } from '@/components/states/MuiStates';
import type { WorkOrderListEntry } from '@/features/work-orders/work-orders-contract';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate, translateDynamic } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import { useReread } from '@/lib/api/use-reread';

import { listRevisions, readRevision, readRevisionDecisions } from '../api';
import type {
  QuotationDetail,
  QuotationRevision,
  QuotationRevisionHeader,
  RevisionDecisions,
} from '../quotations-contract';
import { Money, When } from './shared';

/**
 * The printable quotation (Owner decision D10, P1-32-PRE-OD-FD10).
 *
 * The backend publishes no print route, so the paper is composed from the reads
 * the detail screen already makes: `quo.quotation-detail` (the quotation and its
 * current revision), `quo.quotation-revision-detail` (a revision chosen from the
 * history), `quo.quotation-revision-decisions-read` (the customer's decision and
 * the acceptance record, D11) and the page's own work-order read for the job's
 * number, customer and vehicle. No PDF is generated: this is HTML that prints
 * well, through the shared frame (`PrintDocument`, `PrintTable`) — direction from
 * the document root, a header repeated on every page, rows never split.
 *
 * ## The same gate as the screen
 *
 * There is no print permission code (dedicated print codes wait on the Owner's
 * open question Q9). The copy is offered on the quotation page, which is gated by
 * `quo.quotation.read` before any read is made, and every read it makes is one
 * that page already makes — so nobody can print what they cannot read on screen.
 *
 * ## What a quotation copy never carries (D17)
 *
 * Sales prices and the quotation's own totals, and nothing from finance: no
 * invoice, no payment, no balance, no cost and no margin. The document renders
 * only the fields named below, so a field a read might one day carry beside them
 * never reaches the paper (`quotation-print.dom.test.tsx` holds this).
 *
 * ## Figures as issued
 *
 * Lines and totals are printed exactly as the server captured them, at the
 * currency's minor unit (`formatMoney`); nothing is added, multiplied or rounded
 * here. A draft revision's totals are the database's placeholder until issue, so
 * a draft copy says so and prints no total.
 */

/** The newest revisions the chooser offers, one page of the history. */
const REVISION_CHOICES = 50;

export function QuotationPrintPanel({
  locale,
  messages,
  quotation,
  workOrder,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly quotation: QuotationDetail;
  /** The page's own read of the quotation's work order, when the operator may read it. */
  readonly workOrder: WorkOrderListEntry | null;
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const context = useWorkingContext();

  const readHistory = useMemo(
    () =>
      open
        ? async (): Promise<ReadState<ServerPage<QuotationRevisionHeader>>> => {
            const page = await listRevisions(
              quotation.id,
              { ...INITIAL_REQUEST, pageSize: REVISION_CHOICES },
              null
            );
            return page.status === 'ok'
              ? { status: 'ok', data: page, correlationId: page.correlationId }
              : { status: page.status, correlationId: page.correlationId };
          }
        : null,
    [open, quotation.id]
  );
  const history = useReread<ServerPage<QuotationRevisionHeader>>(readHistory);

  const revisionId = chosen ?? quotation.currentRevisionId;
  const fromDetail =
    quotation.currentRevision !== null && quotation.currentRevision.id === revisionId
      ? quotation.currentRevision
      : null;
  const readChosen = useMemo(
    () =>
      open && revisionId !== null && fromDetail === null ? () => readRevision(revisionId) : null,
    [open, revisionId, fromDetail]
  );
  const chosenRead = useReread<QuotationRevision>(readChosen);
  const readDecisions = useMemo(
    () => (open && revisionId !== null ? () => readRevisionDecisions(revisionId) : null),
    [open, revisionId]
  );
  const decisions = useReread<RevisionDecisions>(readDecisions);

  const revision: ReadState<QuotationRevision> | null =
    fromDetail !== null
      ? { status: 'ok', data: fromDetail, correlationId: null }
      : chosenRead.value;
  const failed =
    (revision !== null && revision.status !== 'ok') ||
    (decisions.value !== null && decisions.value.status !== 'ok');
  const ready =
    revision !== null &&
    revision.status === 'ok' &&
    decisions.value !== null &&
    decisions.value.status === 'ok';

  // Reads again only what failed; what already answered stays on the copy.
  const retry = async () => {
    await Promise.all([
      revision !== null && revision.status !== 'ok' ? chosenRead.reload() : Promise.resolve(),
      decisions.value !== null && decisions.value.status !== 'ok'
        ? decisions.reload()
        : Promise.resolve(),
    ]);
  };

  const options = useMemo(() => {
    const rows = history.value?.status === 'ok' ? history.value.data.rows : [];
    const labelOf = (
      row: Pick<QuotationRevisionHeader, 'revisionNumber' | 'status'>,
      current: boolean
    ) =>
      formatMessage(
        translate(
          messages,
          current ? 'quotations.print.revisionOptionCurrent' : 'quotations.print.revisionOption'
        ),
        {
          number: String(row.revisionNumber),
          status: translateDynamic(messages, `quotations.revisionStatus.${row.status}`),
        }
      );
    const listed = rows.map((row) => ({ value: row.id, label: labelOf(row, row.isCurrent) }));
    const current = quotation.currentRevision;
    if (current !== null && !listed.some((option) => option.value === current.id)) {
      listed.unshift({ value: current.id, label: labelOf(current, true) });
    }
    return listed;
  }, [history.value, messages, quotation.currentRevision]);

  return (
    <section
      aria-labelledby="quotation-print-heading"
      className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4 print:border-0 print:p-0"
      lang={locale}
      data-testid="quotation-print-panel"
    >
      <div className="flex flex-wrap items-center gap-3" data-print="hide">
        <h2 id="quotation-print-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'quotations.print.heading')}
        </h2>
        <Button
          type="button"
          variant="outlined"
          aria-expanded={open}
          disabled={revisionId === null}
          onClick={() => setOpen((o) => !o)}
        >
          {translate(messages, open ? 'quotations.print.close' : 'quotations.print.open')}
        </Button>
        {open && ready ? (
          <Button type="button" variant="contained" onClick={() => window.print()}>
            {translate(messages, 'quotations.print.print')}
          </Button>
        ) : null}
      </div>
      {revisionId === null ? (
        <p className="text-body text-text-secondary" data-print="hide">
          {translate(messages, 'quotations.print.nothing')}
        </p>
      ) : null}
      {open && revisionId !== null ? (
        <div className="flex flex-col gap-3" data-print="hide">
          {options.length > 1 ? (
            <div className="max-w-sm">
              <FormSelectField
                label={translate(messages, 'quotations.print.revisionLabel')}
                value={revisionId}
                onChange={(value) => setChosen(value)}
                options={options}
                testId="quotation-print-revision"
              />
            </div>
          ) : null}
          {history.value !== null && history.value.status !== 'ok' ? (
            <p className="text-caption text-text-muted">
              {translate(messages, 'quotations.print.historyUnavailable')}
            </p>
          ) : null}
          {history.value?.status === 'ok' && history.value.data.hasMore ? (
            <p className="text-caption text-text-muted">
              {translate(messages, 'quotations.print.historyPartial')}
            </p>
          ) : null}
          <PrintUnsavedNote messages={messages} />
        </div>
      ) : null}
      {open && revisionId !== null ? (
        failed ? (
          <div
            className="flex flex-wrap items-center gap-3"
            data-print="hide"
            data-testid="quotation-print-unavailable"
          >
            <p className="text-body text-text-secondary" role="alert">
              {translate(messages, 'quotations.print.unavailable')}
            </p>
            <Button type="button" variant="outlined" onClick={() => void retry()}>
              {translate(messages, 'quotations.print.retry')}
            </Button>
          </div>
        ) : !ready ? (
          <MuiLoadingState messages={messages} variant="inline" />
        ) : (
          <QuotationDocument
            locale={locale}
            messages={messages}
            quotation={quotation}
            revision={revision.data}
            decisions={decisions.value.data}
            workOrder={workOrder}
            branchName={context.branchName(quotation.branchId)}
          />
        )
      ) : null}
    </section>
  );
}

/** A labelled figure in the copy's header or its parties block. */
function Pair({
  label,
  children,
  testId,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <div>
      <dt className="inline text-text-muted">{label} </dt>
      <dd className="inline" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}

function NotShown({ messages }: { readonly messages: Messages }) {
  return (
    <span className="text-text-muted">{translate(messages, 'quotations.print.notShown')}</span>
  );
}

/**
 * The paper itself. Exported for the tests; the screen reaches it only through
 * the panel above, once every read it needs has answered.
 */
export function QuotationDocument({
  locale,
  messages,
  quotation,
  revision,
  decisions,
  workOrder,
  branchName,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly quotation: QuotationDetail;
  readonly revision: QuotationRevision;
  readonly decisions: RevisionDecisions;
  readonly workOrder: WorkOrderListEntry | null;
  readonly branchName: string | null;
}) {
  const jobCustomer = workOrder?.customer ?? null;
  const payerElsewhere =
    quotation.payerPartnerRef !== null && quotation.payerPartnerRef !== jobCustomer?.partnerId;
  const vehicle = workOrder?.vehicle ?? null;
  const vehicleText = [vehicle?.registrationPlate, vehicle?.makeModel].filter(
    (part): part is string => typeof part === 'string' && part.length > 0
  );

  const headers = [
    translate(messages, 'quotations.print.column.line'),
    translate(messages, 'quotations.print.column.description'),
    translate(messages, 'quotations.print.column.quantity'),
    translate(messages, 'quotations.print.column.unit'),
    translate(messages, 'quotations.print.column.unitPrice'),
    translate(messages, 'quotations.print.column.discount'),
    translate(messages, 'quotations.print.column.tax'),
    translate(messages, 'quotations.print.column.lineTotal'),
  ];
  const rows = revision.lines.map((line) => [
    <span key="n" dir="ltr">
      {String(line.lineNumber)}
    </span>,
    <span key="d" className="flex flex-col">
      <span className="text-text-muted">
        {translateDynamic(messages, `quotations.itemKind.${line.itemKind}`)}
      </span>
      {line.item ? (
        <span>
          <bdi>{line.item.name}</bdi>{' '}
          <span className="font-mono text-text-muted" dir="ltr">
            {line.item.code}
          </span>
        </span>
      ) : null}
      {line.description ? <bdi>{line.description}</bdi> : null}
    </span>,
    <span key="q" className="font-mono" dir="ltr">
      {line.quantity}
    </span>,
    line.unit ? (
      <bdi key="u">{line.unit.name}</bdi>
    ) : (
      <span key="u" className="text-text-muted">
        {translate(messages, 'quotations.print.noUnit')}
      </span>
    ),
    <Money key="p" amount={line.unitPrice} currency={line.currency} locale={locale} />,
    <Money key="di" amount={line.discount} currency={line.currency} locale={locale} />,
    <Money key="t" amount={line.taxAmount} currency={line.currency} locale={locale} />,
    <Money key="l" amount={line.lineTotal} currency={line.currency} locale={locale} />,
  ]);

  return (
    <PrintDocument
      title={translate(messages, 'quotations.print.title')}
      header={
        <dl className="grid gap-1">
          <Pair label={translate(messages, 'quotations.print.number')}>
            <span className="font-mono" dir="ltr">
              {quotation.quotationNumber}
            </span>
          </Pair>
          <Pair label={translate(messages, 'quotations.print.revision')}>
            <span className="font-mono" dir="ltr">
              {revision.revisionNumber}
            </span>
          </Pair>
          <Pair label={translate(messages, 'quotations.print.status')}>
            {translateDynamic(messages, `quotations.revisionStatus.${revision.status}`)}
          </Pair>
          <Pair
            label={translate(messages, 'quotations.print.issuedAt')}
            testId="quotation-print-issued-at"
          >
            {revision.issuedAt ? (
              <When value={revision.issuedAt} locale={locale} />
            ) : (
              translate(messages, 'quotations.revision.notIssued')
            )}
          </Pair>
          <Pair
            label={translate(messages, 'quotations.print.validUntil')}
            testId="quotation-print-valid-until"
          >
            {revision.expiresAt ? (
              <When value={revision.expiresAt} locale={locale} />
            ) : (
              translate(messages, 'quotations.print.noExpiry')
            )}
          </Pair>
          <Pair label={translate(messages, 'quotations.print.branch')}>
            {branchName !== null ? <bdi>{branchName}</bdi> : <NotShown messages={messages} />}
          </Pair>
        </dl>
      }
      footer={<p>{translate(messages, 'quotations.print.footer')}</p>}
    >
      <dl className="grid gap-1 sm:grid-cols-2" data-testid="quotation-print-parties">
        <Pair label={translate(messages, 'quotations.print.workOrder')}>
          {workOrder?.displayNumber ? (
            <bdi className="font-mono" dir="ltr">
              {workOrder.displayNumber}
            </bdi>
          ) : (
            <NotShown messages={messages} />
          )}
        </Pair>
        <Pair label={translate(messages, 'quotations.print.customer')}>
          {jobCustomer !== null ? (
            <bdi>{jobCustomer.displayName}</bdi>
          ) : (
            <NotShown messages={messages} />
          )}
        </Pair>
        {payerElsewhere ? (
          <Pair label={translate(messages, 'quotations.print.payer')}>
            <NotShown messages={messages} />
          </Pair>
        ) : null}
        <Pair label={translate(messages, 'quotations.print.vehicle')}>
          {vehicleText.length > 0 ? (
            <bdi>{vehicleText.join(' · ')}</bdi>
          ) : (
            <NotShown messages={messages} />
          )}
        </Pair>
      </dl>

      <div className="mt-6">
        {revision.lines.length === 0 ? (
          <p className="text-supporting text-text-muted">
            {translate(messages, 'quotations.lines.none')}
          </p>
        ) : (
          <PrintTable
            headers={headers}
            rows={rows}
            caption={translate(messages, 'quotations.print.linesCaption')}
          />
        )}
      </div>

      <section className="mt-6 break-inside-avoid" data-testid="quotation-print-totals">
        <h2 className="text-body font-semibold">
          {translate(messages, 'quotations.print.totalsHeading')}
        </h2>
        {revision.status === 'draft' ? (
          <p className="text-supporting text-text-muted">
            {translate(messages, 'quotations.totals.draftNote')}
          </p>
        ) : (
          <dl className="mt-2 grid max-w-sm grid-cols-2 gap-1">
            <dt>{translate(messages, 'quotations.totals.subtotal')}</dt>
            <dd className="text-end">
              <Money amount={revision.subtotal} currency={revision.currency} locale={locale} />
            </dd>
            <dt>{translate(messages, 'quotations.totals.discount')}</dt>
            <dd className="text-end">
              <Money amount={revision.discountTotal} currency={revision.currency} locale={locale} />
            </dd>
            <dt>{translate(messages, 'quotations.totals.tax')}</dt>
            <dd className="text-end">
              <Money amount={revision.taxTotal} currency={revision.currency} locale={locale} />
            </dd>
            <dt className="font-semibold">{translate(messages, 'quotations.totals.grand')}</dt>
            <dd className="text-end font-semibold">
              <Money amount={revision.grandTotal} currency={revision.currency} locale={locale} />
            </dd>
          </dl>
        )}
      </section>

      {revision.discountApproval !== null ? (
        <section className="mt-6 break-inside-avoid" data-testid="quotation-print-discount">
          <h2 className="text-body font-semibold">
            {translate(messages, 'quotations.discountApproval.heading')}
          </h2>
          <dl className="mt-2 grid gap-1">
            <Pair label={translate(messages, 'quotations.discountApproval.statusLabel')}>
              {translateDynamic(
                messages,
                `quotations.discountApproval.status.${revision.discountApproval.status}`
              )}
            </Pair>
            <Pair label={translate(messages, 'quotations.discountApproval.requestedBy')}>
              <bdi>
                {revision.discountApproval.requestedBy.displayName ??
                  translate(messages, 'quotations.approvals.someoneElse')}
              </bdi>
            </Pair>
            {revision.discountApproval.decidedBy !== null ? (
              <Pair label={translate(messages, 'quotations.discountApproval.decidedBy')}>
                <bdi>
                  {revision.discountApproval.decidedBy.displayName ??
                    translate(messages, 'quotations.approvals.someoneElse')}
                </bdi>
              </Pair>
            ) : null}
          </dl>
        </section>
      ) : null}

      <section className="mt-6 break-inside-avoid" data-testid="quotation-print-decision">
        <h2 className="text-body font-semibold">
          {translate(messages, 'quotations.print.decisionHeading')}
        </h2>
        <p className="mt-1">
          {decisions.outcome
            ? translateDynamic(messages, `quotations.outcome.${decisions.outcome}`)
            : translate(messages, 'quotations.outcome.pending')}
        </p>
        <AcceptanceOnPaper
          locale={locale}
          messages={messages}
          decisions={decisions}
          payerRef={quotation.payerPartnerRef}
          payerName={
            quotation.payerPartnerRef !== null && !payerElsewhere
              ? (jobCustomer?.displayName ?? null)
              : null
          }
        />
      </section>
    </PrintDocument>
  );
}

/**
 * The acceptance record (ADR-023 D11) on paper: who accepted, through whom, how,
 * when, who recorded it and on what reference — names, never ids. It is headed
 * and explained as a record, never as a signature. A revision accepted before
 * records were kept says it has none.
 */
function AcceptanceOnPaper({
  locale,
  messages,
  decisions,
  payerRef,
  payerName,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly decisions: RevisionDecisions;
  readonly payerRef: string | null;
  readonly payerName: string | null;
}) {
  const record = decisions.acceptance;
  if (record === null) {
    if (decisions.outcome !== 'accepted') return null;
    return (
      <p className="mt-2 text-supporting text-text-muted">
        {translate(messages, 'quotations.acceptance.notRecorded')}
      </p>
    );
  }
  const customer =
    record.customerPartnerId === null
      ? translate(messages, 'quotations.acceptance.customerNotAttributed')
      : record.customerPartnerId === payerRef && payerName !== null
        ? payerName
        : translate(messages, 'quotations.acceptance.customerUnnamed');
  const recorder =
    record.recordedBy.displayName ??
    translate(
      messages,
      record.recordedByCaller
        ? 'quotations.acceptance.recordedByYou'
        : 'quotations.acceptance.recordedBySomeone'
    );
  return (
    <div className="mt-3" data-testid="quotation-print-acceptance">
      <h3 className="text-body font-medium">
        {translate(messages, 'quotations.acceptance.heading')}
      </h3>
      <p className="text-supporting text-text-muted">
        {translate(messages, 'quotations.acceptance.explain')}
      </p>
      <dl className="mt-2 grid gap-1">
        <Pair label={translate(messages, 'quotations.acceptance.acceptedAt')}>
          <When value={record.acceptedAt} locale={locale} />
        </Pair>
        <Pair label={translate(messages, 'quotations.acceptance.customer')}>
          <bdi>{customer}</bdi>
        </Pair>
        <Pair label={translate(messages, 'quotations.acceptance.contact')}>
          {record.contactName === null && record.contactPhone === null ? (
            translate(messages, 'quotations.acceptance.contactNotGiven')
          ) : (
            <>
              {record.contactName !== null ? <bdi>{record.contactName}</bdi> : null}
              {record.contactName !== null && record.contactPhone !== null ? ' ' : null}
              {record.contactPhone !== null ? (
                <span className="font-mono" dir="ltr">
                  {record.contactPhone}
                </span>
              ) : null}
            </>
          )}
        </Pair>
        <Pair label={translate(messages, 'quotations.acceptance.channel')}>
          {translateDynamic(messages, `quotations.channel.${record.channel}`)}
        </Pair>
        <Pair label={translate(messages, 'quotations.acceptance.recordedBy')}>
          <bdi>{recorder}</bdi>
        </Pair>
        <Pair label={translate(messages, 'quotations.acceptance.reference')}>
          {record.evidenceKind === null ? (
            translate(messages, 'quotations.acceptance.referenceNone')
          ) : (
            <>
              {translateDynamic(messages, `quotations.evidenceKind.${record.evidenceKind}`)}
              {record.referenceNote !== null ? (
                <>
                  {': '}
                  <bdi>{record.referenceNote}</bdi>
                </>
              ) : null}
            </>
          )}
        </Pair>
      </dl>
    </div>
  );
}
