'use client';

/**
 * A part coming back (P1-32).
 *
 * ## Two independent facts decide everything
 *
 * **The source** — the part issue it was fitted from, or the counter-sale
 * invoice line it was sold on — bounds how much may come back and decides
 * whether money moves. `inv.returnable-quantity-read` states all three figures:
 * what left, what has already come back, and the remainder. All three, because a
 * bare remainder cannot be reconciled by the person standing there holding the
 * part.
 *
 * **The condition** decides which shelf it lands on. `restockable` goes back
 * into sellable stock. `damaged` goes into a QUARANTINE location, and the screen
 * says that plainly rather than letting an operator believe a damaged return
 * rejoins the sellable balance: quarantine stock is unavailable because of where
 * it sits, and somebody still has to decide what becomes of it.
 *
 * ## The cap here is courtesy; the ceiling is the database
 *
 * The quantity box refuses more than the remainder before anything is sent, by
 * comparing two exact decimal strings — never by turning either into a number.
 * That is a kindness to the operator and nothing more: the binding ceiling is
 * re-checked under the source row lock when the return is received, counting
 * both return tables, so two counters reading the same remainder still produce
 * one winner and the loser is told.
 *
 * ## The credit note is pending, and the screen says so
 *
 * A return against an ISSUED counter sale raises a credit note in a PENDING
 * state. A second person approves it elsewhere. Nothing here claims the customer
 * has been refunded.
 *
 * ## A part handed to a job is found by name (route sweep B2)
 *
 * A part that left on a WORK ORDER used to be named by a typed reference, because
 * issued parts were listed per job and not per branch. `inv.part-issue-list` now
 * lists the branch's issued parts, so the clerk finds the line by the item's name
 * or code, the job's number, a plate or a chassis number, and each match says how
 * much left and how much may still come back. The read needs `inv.stock.read`,
 * the page's own gate, so everyone who reaches the form may search. Should the
 * read be refused for the working branch anyway, the typed reference returns
 * beside the refusal, as it does for the sale picker, so the desk is never left
 * without a way to name the line.
 *
 * Permissions: `inv.stock.read` gates the page and every read;
 * `inv.stock.operate` with `sal.finance.view` offers the write.
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { SelectField, TextAreaField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { listCounterSales, readInvoice } from '@/features/billing/api';
import type { Invoice, InvoiceLine } from '@/features/billing/billing-contract';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic, translateWithValues } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { formatDateTime } from '@/lib/format';
import { compareMoney, formatMoney } from '@/lib/money';

import { createSalesReturn, listSalesReturns, readReturnable } from '../api';
import {
  MAX_REASON,
  RETURN_CONDITIONS,
  SALES_RETURN_SOURCE_KINDS,
  type IssuedPart,
  type ReturnCondition,
  type ReturnableQuantity,
  type SalesReturnRow,
  type SalesReturnSourceKind,
  type StockTarget,
} from '../inventory-contract';
import {
  LocationPicker,
  OutcomeNote,
  PRIMARY_BUTTON,
  Qty,
  SECONDARY_BUTTON,
  useLocations,
} from './shared';
import {
  BranchListView,
  BranchTargetForm,
  LINK,
  PANEL,
  StockOperationLinks,
  isQuantity,
  outcomeField,
  useBranchList,
} from './stock-operations';
import { IssuedPartPicker, REFERENCE } from './pickers';

export function CustomerReturnsScreen({
  locale,
  messages,
  canOperate,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** `inv.stock.operate` (with `sal.finance.view`) — receiving a return. */
  readonly canOperate: boolean;
  /**
   * `org.branch.read`. Accepted so the route did not have to change, and no
   * longer read: the branch is the working context's own named selection, and
   * that read is gated on `iam.user.read` rather than on an administration
   * code.
   */
  readonly canReadBranches?: boolean;
}) {
  const [target, setTarget] = useState<StockTarget | null>(null);
  return (
    <div className="flex min-h-0 flex-col gap-4">
      <StockOperationLinks locale={locale} messages={messages} />
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.returns.explain')}
      </p>
      <BranchTargetForm
        messages={messages}
        formLabelKey="inventory.returns.targetLabel"
        explainKey="inventory.target.explain"
        onChosen={setTarget}
      />
      {target !== null ? (
        <BranchReturns
          key={`${target.companyId}:${target.branchId}`}
          locale={locale}
          messages={messages}
          target={target}
          canOperate={canOperate}
        />
      ) : null}
    </div>
  );
}

function BranchReturns({
  locale,
  messages,
  target,
  canOperate,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: StockTarget;
  readonly canOperate: boolean;
}) {
  const read = useCallback((where: StockTarget) => listSalesReturns(where), []);
  const { list, reload } = useBranchList<SalesReturnRow>(
    target,
    read,
    'inventory.returns.list.refused',
    'inventory.returns.list.unavailable'
  );
  const locations = useLocations(target);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      {notice !== null ? (
        <p role="status" className="rounded-lg border border-border bg-surface p-3 text-body">
          {translateDynamic(messages, notice)}
        </p>
      ) : null}

      {canOperate ? (
        <ReceiveForm
          locale={locale}
          messages={messages}
          target={target}
          locations={locations}
          onReceived={(noticeKey) => {
            setNotice(noticeKey);
            reload();
          }}
        />
      ) : (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.returns.needsOperate')}
        </p>
      )}

      <section aria-labelledby="returns-list-heading" className={PANEL}>
        <h2 id="returns-list-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'inventory.returns.list.heading')}
        </h2>
        <BranchListView
          messages={messages}
          list={list}
          loadingKey="inventory.returns.list.loading"
          noneKey="inventory.returns.list.none"
          truncatedKey="inventory.returns.list.truncated"
        >
          {(items) => (
            <table className="w-full text-body">
              <caption className="sr-only">
                {translate(messages, 'inventory.returns.list.caption')}
              </caption>
              <thead>
                <tr className="text-caption text-text-muted">
                  <th scope="col" className="text-start font-medium">
                    {translate(messages, 'inventory.returns.column.item')}
                  </th>
                  <th scope="col" className="text-end font-medium">
                    {translate(messages, 'inventory.returns.column.quantity')}
                  </th>
                  <th scope="col" className="text-start font-medium">
                    {translate(messages, 'inventory.returns.column.condition')}
                  </th>
                  <th scope="col" className="text-start font-medium">
                    {translate(messages, 'inventory.returns.column.credit')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id} className="border-t border-border align-top">
                    <td>
                      <code className="font-mono text-caption" dir="ltr">
                        {row.sku}
                      </code>
                      <span className="block text-caption text-text-muted" dir="ltr">
                        {formatDateTime(row.createdAt, locale)}
                      </span>
                    </td>
                    <td className="text-end">
                      <Qty value={row.quantity} />
                    </td>
                    <td>
                      {translateDynamic(messages, `inventory.returnCondition.${row.condition}`)}
                      {row.condition === 'damaged' ? (
                        <span className="block text-caption text-text-muted">
                          {translate(messages, 'inventory.returns.quarantined')}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {translateDynamic(messages, `inventory.returnStatus.${row.status}`)}
                      {row.creditNoteId !== null ? (
                        <>
                          <span className="block text-caption text-text-muted">
                            {translate(messages, 'inventory.returns.creditPending')}
                          </span>
                          {/*
                           * DEF-T-07. The credit a return raises used to be
                           * named here and reachable nowhere. The credit-note
                           * screen opens straight onto this note.
                           */}
                          <Link
                            href={`/${locale}/credit-notes?creditNoteId=${row.creditNoteId}`}
                            className={LINK}
                          >
                            {translate(messages, 'inventory.returns.openCredit')}
                          </Link>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </BranchListView>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Receiving one part back
 * ------------------------------------------------------------------ */

function ReceiveForm({
  locale,
  messages,
  target,
  locations,
  onReceived,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: StockTarget;
  readonly locations: ReturnType<typeof useLocations>;
  readonly onReceived: (noticeKey: string) => void;
}) {
  const [sourceKind, setSourceKind] = useState<SalesReturnSourceKind>('invoice_line');
  const [sourceId, setSourceId] = useState('');
  // The part handed to a job, chosen by name; and whether that search was refused here.
  const [issuedPart, setIssuedPart] = useState<IssuedPart | null>(null);
  const [issuesRefused, setIssuesRefused] = useState(false);
  const refuseIssues = useCallback(() => setIssuesRefused(true), []);
  const [returnable, setReturnable] = useState<ReturnableQuantity | null>(null);
  const [sourceNote, setSourceNote] = useState<string | null>(null);
  const [form, setForm] = useState<{
    quantity: string;
    condition: ReturnCondition;
    receivedLocationId: string;
    quarantineLocationId: string;
    reason: string;
  }>({
    quantity: '',
    condition: 'restockable',
    receivedLocationId: '',
    quarantineLocationId: '',
    reason: '',
  });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  /* One key per opened form: a repeated scan of the part being handed back, or
   * a retry after a lost answer, replays the first receipt. */
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());
  /*
   * Unsaved work, declared to the shell. The return lands in THIS branch's
   * locations, so a switch asks first; a confirmed switch remounts the form
   * empty. The source KIND is not counted: it is a posture that survives a
   * successful receipt, not something the operator would lose.
   */
  useUnsavedGuard(
    sourceId.trim().length > 0 ||
      form.quantity.trim().length > 0 ||
      form.condition !== 'restockable' ||
      form.receivedLocationId !== '' ||
      form.quarantineLocationId !== '' ||
      form.reason.trim().length > 0
  );

  const errorFor = (name: string) =>
    errors[name] ? translateDynamic(messages, errors[name]) : outcomeField(messages, outcome, name);

  /*
   * Which question about the returnable quantity is the live one. Every new
   * source — a part chosen, a part put back, a kind switched, a reference
   * edited — moves it on, so a reply for a source no longer selected is dropped
   * rather than shown under the one that replaced it (route sweep B2 review).
   */
  const asked = useRef(0);
  const forgetAsked = () => {
    asked.current += 1;
  };

  /**
   * Asks the server how much of one source may still come back.
   *
   * Takes the source explicitly rather than reading it out of state, because the
   * line picker calls it in the same turn as it chooses a line — a version that
   * read `sourceId` would ask about the previous line.
   *
   * The shape check is the server's own identifier rule (`REFERENCE`), not a
   * looser 8-4-4-4-12 copy that let through values the route then refused.
   */
  const lookAt = useCallback(async (kind: SalesReturnSourceKind, id: string) => {
    asked.current += 1;
    const question = asked.current;
    if (!REFERENCE.test(id)) {
      setSourceNote('inventory.common.idFormat');
      setReturnable(null);
      return;
    }
    setSourceNote('inventory.returns.source.looking');
    const state = await readReturnable(kind, id);
    if (question !== asked.current) return;
    if (state.status === 'ok') {
      setReturnable(state.data);
      setSourceNote(null);
      return;
    }
    setReturnable(null);
    setSourceNote(
      state.status === 'not-found'
        ? 'inventory.returns.source.missing'
        : state.status === 'denied'
          ? 'inventory.returns.source.refused'
          : 'inventory.returns.source.unavailable'
    );
  }, []);

  const look = () => lookAt(sourceKind, sourceId.trim());

  const submit = async () => {
    const found: Record<string, string> = {};
    const id = sourceId.trim();
    if (sourceKind === 'part_issue' && !issuesRefused && issuedPart === null) {
      found['sourceId'] = 'inventory.returns.issue.required';
    } else if (!REFERENCE.test(id)) found['sourceId'] = 'inventory.common.idFormat';
    const quantity = form.quantity.trim();
    if (!isQuantity(quantity)) {
      found['quantity'] = 'inventory.stockOps.quantityFormat';
    } else if (returnable !== null && compareMoney(quantity, returnable.remainingQuantity) > 0) {
      // Two exact decimal strings, compared digit by digit. Never a subtraction,
      // and never a number: the server holds the same two strings.
      found['quantity'] = 'inventory.returns.overRemaining';
    }
    if (form.receivedLocationId === '') found['receivedLocationId'] = 'field.required';
    if (form.condition === 'damaged' && form.quarantineLocationId === '') {
      found['quarantineLocationId'] = 'inventory.returns.quarantineRequired';
    }
    const reason = form.reason.trim();
    if (reason.length > MAX_REASON) found['reason'] = 'inventory.stockOps.reasonTooLong';
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await createSalesReturn(
      {
        sourceKind,
        sourceId: id,
        quantity,
        condition: form.condition,
        receivedLocationId: form.receivedLocationId,
        ...(form.condition === 'damaged'
          ? { quarantineLocationId: form.quarantineLocationId }
          : {}),
        ...(reason === '' ? {} : { reason }),
      },
      attemptKey
    );
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      const received = result.created;
      setForm({
        quantity: '',
        condition: 'restockable',
        receivedLocationId: '',
        quarantineLocationId: '',
        reason: '',
      });
      forgetAsked();
      setReturnable(null);
      setSourceId('');
      setIssuedPart(null);
      setAttemptKey(crypto.randomUUID());
      setOutcome(null);
      onReceived(
        received.replayed
          ? 'inventory.returns.create.replayed'
          : received.creditNoteId !== null
            ? 'inventory.returns.create.credited'
            : 'inventory.returns.create.done'
      );
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="return-receive-heading"
      className={PANEL}
    >
      <h2 id="return-receive-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.returns.create.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.returns.create.explain')}
      </p>

      <SelectField
        label={translate(messages, 'inventory.returns.source.kind')}
        required
        value={sourceKind}
        onChange={(event) => {
          forgetAsked();
          setSourceKind(event.target.value as SalesReturnSourceKind);
          setSourceId('');
          setIssuedPart(null);
          setSourceNote(null);
          setReturnable(null);
        }}
        options={SALES_RETURN_SOURCE_KINDS.map((kind) => ({
          value: kind,
          label: translateDynamic(messages, `inventory.returnSource.${kind}`),
        }))}
      />

      {/*
       * DEF-T-06. This asked the operator to type "the reference of the sale
       * line" as free text, and no sale screen, invoice screen or list in the
       * product prints one — the acceptance campaign copied a 36-character
       * identifier out of the raw column of the movement table by hand to get
       * through the journey at all. The branch's issued counter sales are now
       * OFFERED, and choosing a line of one is what names the source.
       *
       * The box survives for the two cases the picker cannot cover: a part
       * handed to a job, which is listed per work order and not per branch, and
       * a caller whose sale reads were refused or failed. In both the screen
       * says which it is rather than leaving a naked identifier field.
       */}
      {sourceKind === 'invoice_line' ? (
        <SalePicker
          locale={locale}
          messages={messages}
          target={target}
          onChosen={(lineId) => {
            setSourceId(lineId);
            void lookAt('invoice_line', lineId);
          }}
          fallback={
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <TextField
                  label={translate(messages, 'inventory.returns.source.id')}
                  description={translate(messages, 'inventory.returns.source.idHelp')}
                  required
                  dir="ltr"
                  value={sourceId}
                  onChange={(event) => {
                    forgetAsked();
                    setSourceId(event.target.value);
                    setReturnable(null);
                  }}
                  error={errorFor('sourceId')}
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  className={SECONDARY_BUTTON}
                  onClick={() => {
                    void look();
                  }}
                >
                  {translate(messages, 'inventory.returns.source.look')}
                </button>
              </div>
            </div>
          }
        />
      ) : (
        <>
          <IssuedPartPicker
            messages={messages}
            locale={locale}
            target={target}
            value={issuedPart}
            onChange={(next) => {
              forgetAsked();
              setIssuedPart(next);
              setSourceId(next?.id ?? '');
              setReturnable(null);
              setSourceNote(null);
              if (next !== null) void lookAt('part_issue', next.id);
            }}
            error={issuesRefused ? undefined : errorFor('sourceId')}
            onRefused={refuseIssues}
          />
          {issuesRefused && issuedPart === null ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <p role="status" className="text-caption text-text-muted sm:col-span-3">
                {translate(messages, 'inventory.returns.issue.fallback')}
              </p>
              <div className="sm:col-span-2">
                <TextField
                  label={translate(messages, 'inventory.returns.source.id')}
                  description={translate(messages, 'inventory.returns.source.issueHelp')}
                  required
                  dir="ltr"
                  value={sourceId}
                  onChange={(event) => {
                    forgetAsked();
                    setSourceId(event.target.value);
                    setReturnable(null);
                  }}
                  error={errorFor('sourceId')}
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  className={SECONDARY_BUTTON}
                  onClick={() => {
                    void look();
                  }}
                >
                  {translate(messages, 'inventory.returns.source.look')}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}

      {sourceNote !== null ? (
        <p role="status" className="text-caption text-text-muted">
          {translateDynamic(messages, sourceNote)}
        </p>
      ) : null}

      {returnable !== null ? (
        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-caption text-text-muted">
              {translate(messages, 'inventory.returns.figures.sold')}
            </dt>
            <dd className="text-body text-text-primary">
              <Qty value={returnable.sourceQuantity} />
            </dd>
          </div>
          <div>
            <dt className="text-caption text-text-muted">
              {translate(messages, 'inventory.returns.figures.returned')}
            </dt>
            <dd className="text-body text-text-primary">
              <Qty value={returnable.returnedQuantity} />
            </dd>
          </div>
          <div>
            <dt className="text-caption text-text-muted">
              {translate(messages, 'inventory.returns.figures.remaining')}
            </dt>
            <dd className="text-body text-text-primary">
              <Qty value={returnable.remainingQuantity} />
            </dd>
          </div>
        </dl>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label={translate(messages, 'inventory.returns.create.quantity')}
          description={translate(messages, 'inventory.stockOps.quantityHelp')}
          required
          inputMode="decimal"
          dir="ltr"
          value={form.quantity}
          onChange={(event) => setForm((f) => ({ ...f, quantity: event.target.value }))}
          error={errorFor('quantity')}
        />
        <LocationPicker
          messages={messages}
          locations={locations}
          label={translate(messages, 'inventory.returns.create.receivedLocation')}
          placeholder={translate(messages, 'inventory.stockOps.chooseLocation')}
          required
          value={form.receivedLocationId}
          onChange={(next) => setForm((f) => ({ ...f, receivedLocationId: next }))}
          error={errorFor('receivedLocationId')}
        />
      </div>

      <SelectField
        label={translate(messages, 'inventory.returns.create.condition')}
        required
        value={form.condition}
        onChange={(event) =>
          setForm((f) => ({ ...f, condition: event.target.value as ReturnCondition }))
        }
        options={RETURN_CONDITIONS.map((condition) => ({
          value: condition,
          label: translateDynamic(messages, `inventory.returnCondition.${condition}`),
        }))}
      />

      {form.condition === 'damaged' ? (
        <>
          <p className="text-body text-text-primary">
            {translate(messages, 'inventory.returns.damagedExplain')}
          </p>
          <LocationPicker
            messages={messages}
            locations={locations}
            label={translate(messages, 'inventory.returns.create.quarantineLocation')}
            placeholder={translate(messages, 'inventory.stockOps.chooseLocation')}
            required
            value={form.quarantineLocationId}
            onChange={(next) => setForm((f) => ({ ...f, quarantineLocationId: next }))}
            error={errorFor('quarantineLocationId')}
          />
        </>
      ) : null}

      <TextAreaField
        label={translate(messages, 'inventory.stockOps.reason')}
        rows={2}
        value={form.reason}
        onChange={(event) => setForm((f) => ({ ...f, reason: event.target.value }))}
        error={errorFor('reason')}
      />

      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.returns.creditExplain')}
      </p>
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'inventory.returns.create.submit')}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Choosing the sale, then the line (DEF-T-06)
 * ------------------------------------------------------------------ */

type SalesState =
  | { readonly phase: 'loading' }
  | {
      readonly phase: 'listed';
      readonly sales: readonly Invoice[];
      // The server's own end-of-set signal, kept rather than dropped: one page
      // of fifty is all the read returns, and a branch busier than that would
      // otherwise offer a list the sale is not in with no way to say so.
      readonly truncated: boolean;
    }
  | { readonly phase: 'refused' }
  | { readonly phase: 'unavailable' };

type LinesState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'loading' }
  | { readonly phase: 'listed'; readonly lines: readonly InvoiceLine[] }
  | { readonly phase: 'failed'; readonly messageKey: string };

/**
 * Pick the sale, then pick the line that is coming back.
 *
 * Two reads, both already published and both the ones the counter itself uses:
 * `sal.counter-sale-list` narrowed to ISSUED sales — nothing left the shelf on a
 * draft, so a draft has nothing to take back — and `sal.invoice-detail` for the
 * lines of the chosen one.
 *
 * Quantities and amounts are the server's strings, rendered and never computed.
 * How much of the chosen line may still come back is a separate read,
 * `inv.returnable-quantity-read`, issued by the form above the moment a line is
 * chosen — so the ceiling an operator sees is always the server's figure.
 *
 * When the sale reads are refused or unavailable the caller's fallback is
 * rendered instead — the typed reference — beside a sentence saying which of the
 * two happened. A picker that silently disappeared would leave an operator
 * hunting for a control that is not there.
 *
 * The counter-sale read answers ONE page, so `hasMore` is read rather than
 * assumed away. A branch whose issued sales do not fit that page gets the
 * picker AND the fallback together, under a sentence saying the list is partial:
 * offering fifty sales with no way to name the fifty-first is the same dead end
 * this picker was built to remove, only quieter.
 */
function SalePicker({
  locale,
  messages,
  target,
  onChosen,
  fallback,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: StockTarget;
  readonly onChosen: (lineId: string) => void;
  readonly fallback: ReactNode;
}) {
  const [sales, setSales] = useState<SalesState>({ phase: 'loading' });
  const [saleId, setSaleId] = useState('');
  const [lines, setLines] = useState<LinesState>({ phase: 'idle' });
  const [lineId, setLineId] = useState('');

  const companyId = target.companyId;
  const branchId = target.branchId;

  useEffect(() => {
    let live = true;
    void listCounterSales({ companyId, branchId }, { status: 'issued' }).then((answer) => {
      if (!live) return;
      if (answer.status === 'ok') {
        setSales({
          phase: 'listed',
          sales: answer.data.items,
          truncated: answer.data.hasMore,
        });
        return;
      }
      setSales({ phase: answer.status === 'denied' ? 'refused' : 'unavailable' });
    });
    return () => {
      live = false;
    };
    // Keyed on the two branch VALUES, never on the target object: a parent that
    // rebuilds the pair on every render would otherwise re-read the branch on
    // every render.
  }, [companyId, branchId]);

  const chooseSale = (id: string) => {
    setSaleId(id);
    setLineId('');
    if (id === '') {
      setLines({ phase: 'idle' });
      return;
    }
    setLines({ phase: 'loading' });
    void readInvoice(id).then((answer) => {
      if (answer.status === 'ok') {
        setLines({ phase: 'listed', lines: answer.data.lines });
        return;
      }
      setLines({
        phase: 'failed',
        messageKey:
          answer.status === 'denied'
            ? 'inventory.returns.sale.linesRefused'
            : answer.status === 'not-found'
              ? 'inventory.returns.sale.linesMissing'
              : 'inventory.returns.sale.linesUnavailable',
      });
    });
  };

  if (sales.phase === 'loading') {
    return (
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.returns.sale.loading')}
      </p>
    );
  }

  if (sales.phase !== 'listed') {
    return (
      <>
        <p role="status" className="text-caption text-text-muted">
          {translate(
            messages,
            sales.phase === 'refused'
              ? 'inventory.returns.sale.refused'
              : 'inventory.returns.sale.unavailable'
          )}
        </p>
        {fallback}
      </>
    );
  }

  if (sales.sales.length === 0) {
    return (
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.returns.sale.none')}
      </p>
    );
  }

  return (
    <>
      {sales.truncated ? (
        <p role="status" className="text-caption text-text-muted">
          {translate(messages, 'inventory.returns.sale.truncated')}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label={translate(messages, 'inventory.returns.sale.label')}
          description={translate(messages, 'inventory.returns.sale.help')}
          required
          value={saleId}
          onChange={(event) => chooseSale(event.target.value)}
          options={sales.sales.map((sale) => ({
            value: sale.id,
            label: [
              sale.invoiceNumber ?? translate(messages, 'inventory.returns.sale.noNumber'),
              sale.issuedAt === null ? null : formatDateTime(sale.issuedAt, locale),
              sale.totals === null ? null : formatMoney(sale.totals.gross, locale),
            ]
              .filter((part) => part !== null)
              .join(' — '),
          }))}
          placeholder={translate(messages, 'inventory.returns.sale.choose')}
        />

        {lines.phase === 'idle' ? null : lines.phase === 'loading' ? (
          <p className="text-caption text-text-muted">
            {translate(messages, 'inventory.returns.sale.linesLoading')}
          </p>
        ) : lines.phase === 'failed' ? (
          <p role="alert" className="text-body text-error">
            {translateDynamic(messages, lines.messageKey)}
          </p>
        ) : lines.lines.length === 0 ? (
          <p className="text-caption text-text-muted">
            {translate(messages, 'inventory.returns.sale.linesNone')}
          </p>
        ) : (
          <SelectField
            label={translate(messages, 'inventory.returns.sale.lineLabel')}
            description={translate(messages, 'inventory.returns.sale.lineHelp')}
            required
            value={lineId}
            onChange={(event) => {
              setLineId(event.target.value);
              if (event.target.value !== '') onChosen(event.target.value);
            }}
            options={lines.lines.map((line) => ({
              value: line.id,
              // The quantity is the server's decimal string and the amount the
              // server's money, both rendered as sent. Nothing here is summed.
              label: [
                translateWithValues(messages, 'inventory.returns.sale.lineNumber', {
                  number: String(line.lineNumber),
                }),
                line.quantity,
                line.money === null ? null : formatMoney(line.money.gross, locale),
              ]
                .filter((part) => part !== null)
                .join(' — '),
            }))}
            placeholder={translate(messages, 'inventory.returns.sale.chooseLine')}
          />
        )}
      </div>

      {/*
       * The typed reference, the same box the refused and unavailable cases get.
       * It is rendered HERE too because a partial list is a third way for the
       * sale not to be offerable, and the two controls stand together: choose it
       * if it is listed, name it if it is not.
       */}
      {sales.truncated ? fallback : null}
    </>
  );
}
