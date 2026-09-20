'use client';

/**
 * Selling stock over the counter (P1-32).
 *
 * Someone — often another garage — buys a part and leaves. No vehicle is
 * received and no job is opened, so the document is an INVOICE with no work
 * order, and it is issued, settled and credited through the invoice and payment
 * screens that already exist rather than through a second set built here.
 *
 * ## Three things happen in order, and only one of them moves stock
 *
 * 1. **Draft.** The lines say what is being sold and where it comes off the
 *    shelf. No amount is sent — the route refuses a body carrying one — and
 *    every figure is computed in the database from the item's configured selling
 *    price. An item with no configured price refuses the whole sale rather than
 *    selling it for nothing, and the screen states that as what it is.
 * 2. **Void, while it is still a draft.** Nothing has moved, so there is nothing
 *    to put back.
 * 3. **Issue.** This is the act that takes the stock off the shelf, against the
 *    invoice lines, in that transaction. An issued sale cannot be voided:
 *    cancelling a document never returns stock, and a part comes back only
 *    through the customer-returns screen.
 *
 * ## Scanning, and the rule that makes it safe
 *
 * A scan RESOLVES a code to an item — a read — and adds a line to the draft on
 * screen. It writes nothing. The write happens when the person at the counter
 * says the sale is complete, and the idempotency key is derived once at that
 * moment, so a retry after a lost answer replays the first draft instead of
 * opening a second one. The scan box additionally ignores the same code arriving
 * twice within a moment, and says that it did.
 *
 * ## Finding the buyer
 *
 * Through the customer directory, by name, by customer number or by telephone
 * number. `crm.customer-search` publishes a `phone` parameter — an exact number
 * or a tail of at least seven digits — and this screen sends it through the one
 * customer-search authority, `lib/customers/directory`, exactly as the customer
 * search screen does. The number is sent as typed: the backend folds
 * Arabic-Indic digits before it compares.
 *
 * Permissions: `sal.invoice.manage` gates the page and offers the draft and the
 * void; `sal.finance.view` is required by construction wherever amounts are
 * written; `sal.invoice.issue` offers the issue; `inv.item.read` the catalogue;
 * `crm.customer.read` the buyer search; `org.branch.read` the branch picker.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { SelectField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { cancelInvoice, createCounterSale, issueInvoice } from '@/features/billing/api';
import {
  MAX_REASON as MAX_INVOICE_REASON,
  type CreatedInvoice,
} from '@/features/billing/billing-contract';
import { searchCustomerDirectory } from '@/lib/customers/directory';
import type { CustomerSearchHit } from '@/lib/customers/directory-contract';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { formatMoney } from '@/lib/money';

import { resolveBarcode } from '../api';
import {
  MAX_NAME,
  type ChosenItem,
  type CounterSaleLine,
  type InventoryItem,
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
import { ScanBox } from './ScanBox';
import {
  BranchTargetForm,
  DANGER_BUTTON,
  ItemFinder,
  LINK,
  PANEL,
  StockOperationLinks,
  isQuantity,
} from './stock-operations';

export function CounterSalesScreen({
  locale,
  messages,
  canSell,
  canIssue,
  canReadCustomers,
  canReadBranches,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** `sal.invoice.manage` — drafting and voiding. */
  readonly canSell: boolean;
  /** `sal.invoice.issue` — issuing, which is what moves the stock. */
  readonly canIssue: boolean;
  /** `crm.customer.read` — whether the buyer search is offered. */
  readonly canReadCustomers: boolean;
  /** `org.branch.read` — whether a branch list is requested for the picker. */
  readonly canReadBranches: boolean;
}) {
  const [target, setTarget] = useState<StockTarget | null>(null);
  return (
    <div className="flex min-h-0 flex-col gap-4">
      <StockOperationLinks locale={locale} messages={messages} />
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.counterSales.explain')}
      </p>
      <BranchTargetForm
        messages={messages}
        canReadBranches={canReadBranches}
        formLabelKey="inventory.counterSales.targetLabel"
        explainKey="inventory.target.explain"
        submitKey="inventory.counterSales.chooseBranch"
        onChosen={setTarget}
      />
      {target === null ? null : !canSell ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.counterSales.needsManage')}
        </p>
      ) : (
        <BranchCounter
          key={`${target.companyId}:${target.branchId}`}
          locale={locale}
          messages={messages}
          target={target}
          canIssue={canIssue}
          canReadCustomers={canReadCustomers}
        />
      )}
    </div>
  );
}

function BranchCounter({
  locale,
  messages,
  target,
  canIssue,
  canReadCustomers,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: StockTarget;
  readonly canIssue: boolean;
  readonly canReadCustomers: boolean;
}) {
  const locations = useLocations(target);
  const [buyer, setBuyer] = useState<CustomerSearchHit | null>(null);
  const [lines, setLines] = useState<readonly CounterSaleLine[]>([]);
  const [sale, setSale] = useState<CreatedInvoice | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      {notice !== null ? (
        <p role="status" className="rounded-lg border border-border bg-surface p-3 text-body">
          {translateDynamic(messages, notice)}
        </p>
      ) : null}

      {sale === null ? (
        <>
          <BuyerPicker
            messages={messages}
            canReadCustomers={canReadCustomers}
            value={buyer}
            onChange={setBuyer}
          />
          <LineBuilder
            messages={messages}
            target={target}
            locations={locations}
            onAdd={(line) => setLines((current) => [...current, line])}
          />
          <DraftLines
            messages={messages}
            lines={lines}
            onRemove={(key) => setLines((current) => current.filter((line) => line.key !== key))}
          />
          <DraftSubmit
            messages={messages}
            target={target}
            buyer={buyer}
            lines={lines}
            onDrafted={(created) => {
              setSale(created);
              setNotice(
                created.replayed
                  ? 'inventory.counterSales.create.replayed'
                  : 'inventory.counterSales.create.done'
              );
            }}
          />
        </>
      ) : (
        <SalePanel
          locale={locale}
          messages={messages}
          sale={sale}
          canIssue={canIssue}
          onChanged={(next, noticeKey) => {
            setSale(next);
            setNotice(noticeKey);
          }}
          onNewSale={() => {
            setSale(null);
            setLines([]);
            setBuyer(null);
            setNotice(null);
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The buyer
 * ------------------------------------------------------------------ */

/**
 * The three criteria this picker offers, each a parameter `crm.customer-search`
 * publishes. Email is deliberately absent: the backend accepts no email filter,
 * and a box that is silently ignored is worse than no box.
 */
type BuyerSearchField = 'name' | 'customerNumber' | 'phone';

function BuyerPicker({
  messages,
  canReadCustomers,
  value,
  onChange,
}: {
  readonly messages: Messages;
  readonly canReadCustomers: boolean;
  readonly value: CustomerSearchHit | null;
  readonly onChange: (next: CustomerSearchHit | null) => void;
}) {
  const [term, setTerm] = useState('');
  const [field, setField] = useState<BuyerSearchField>('name');
  const [found, setFound] = useState<readonly CustomerSearchHit[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const find = async () => {
    const text = term.trim();
    if (text.length === 0 || text.length > MAX_NAME) {
      setNote('inventory.counterSales.buyer.termNeeded');
      return;
    }
    const page = await searchCustomerDirectory(
      { ...INITIAL_REQUEST, pageSize: 25 },
      null,
      // One criterion at a time, named by the chosen field. `directory.ts`
      // normalises and truncates it; nothing is assembled here.
      field === 'name'
        ? { name: text }
        : field === 'phone'
          ? { phone: text }
          : { customerNumber: text }
    );
    if (page.status === 'ok') {
      setFound(page.rows);
      setNote(
        page.rows.length === 0
          ? 'inventory.counterSales.buyer.none'
          : page.hasMore
            ? 'inventory.counterSales.buyer.more'
            : null
      );
      return;
    }
    setFound(null);
    setNote(
      page.status === 'denied'
        ? 'inventory.counterSales.buyer.refused'
        : 'inventory.counterSales.buyer.unavailable'
    );
  };

  const options = found ?? (value ? [value] : []);
  return (
    <section aria-labelledby="counter-buyer-heading" className={PANEL}>
      <h2 id="counter-buyer-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.counterSales.buyer.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.counterSales.buyer.explain')}
      </p>
      {!canReadCustomers ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.counterSales.buyer.needsRead')}
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField
              label={translate(messages, 'inventory.counterSales.buyer.searchBy')}
              value={field}
              onChange={(event) => setField(event.target.value as BuyerSearchField)}
              options={[
                {
                  value: 'name',
                  label: translate(messages, 'inventory.counterSales.buyer.byName'),
                },
                {
                  value: 'customerNumber',
                  label: translate(messages, 'inventory.counterSales.buyer.byNumber'),
                },
                {
                  value: 'phone',
                  label: translate(messages, 'inventory.counterSales.buyer.byPhone'),
                },
              ]}
            />
            <TextField
              label={translate(messages, 'inventory.counterSales.buyer.term')}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                void find();
              }}
            />
            <div className="flex items-end">
              <button
                type="button"
                className={SECONDARY_BUTTON}
                onClick={() => {
                  void find();
                }}
              >
                {translate(messages, 'inventory.counterSales.buyer.search')}
              </button>
            </div>
          </div>
          {note !== null ? (
            <p className="text-caption text-text-muted">{translateDynamic(messages, note)}</p>
          ) : null}
          <SelectField
            label={translate(messages, 'inventory.counterSales.buyer.label')}
            required
            value={value?.id ?? ''}
            onChange={(event) =>
              onChange(options.find((hit) => hit.id === event.target.value) ?? null)
            }
            options={options.map((hit) => ({
              value: hit.id,
              label:
                hit.displayNumber === null
                  ? hit.displayName
                  : `${hit.displayNumber} — ${hit.displayName}`,
            }))}
            placeholder={translate(messages, 'inventory.counterSales.buyer.choose')}
          />
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The lines
 * ------------------------------------------------------------------ */

function LineBuilder({
  messages,
  target,
  locations,
  onAdd,
}: {
  readonly messages: Messages;
  readonly target: StockTarget;
  readonly locations: ReturnType<typeof useLocations>;
  readonly onAdd: (line: CounterSaleLine) => void;
}) {
  /*
   * Two sources, one choice. `finderItem` is the catalogue search's own value
   * and `scanned` is what a scan resolved; whichever came last is the chosen
   * item, reduced to the three facts BOTH of them publish. Nothing is invented
   * for an item that arrived by scan.
   */
  const [finderItem, setFinderItem] = useState<InventoryItem | null>(null);
  const [scanned, setScanned] = useState<ChosenItem | null>(null);
  const [locationId, setLocationId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [onShelf, setOnShelf] = useState<string | null>(null);
  const chosen: ChosenItem | null =
    scanned ??
    (finderItem === null
      ? null
      : { id: finderItem.id, sku: finderItem.sku, name: finderItem.name });

  const onScanned = useCallback(
    (code: string) => {
      setScanNote('inventory.counterSales.line.looking');
      setOnShelf(null);
      void resolveBarcode(code, target).then((state) => {
        if (state.status !== 'ok') {
          setScanNote(
            state.status === 'not-found'
              ? 'inventory.scan.notFound'
              : state.status === 'denied'
                ? 'inventory.scan.refused'
                : state.status === 'error'
                  ? 'inventory.scan.ambiguous'
                  : 'inventory.scan.unavailable'
          );
          return;
        }
        const found = state.data;
        setFinderItem(null);
        setScanned({ id: found.item.id, sku: found.item.sku, name: found.item.name });
        setScanNote('inventory.counterSales.line.scanned');
        // The server's own figures, one row per location, shown as sent.
        const rows = found.availability;
        setOnShelf(
          rows === null || rows.length === 0
            ? null
            : rows.map((row) => `${row.locationCode}: ${row.available}`).join(' · ')
        );
      });
    },
    [target]
  );

  const add = () => {
    const found: Record<string, string> = {};
    if (chosen === null) found['itemId'] = 'field.required';
    if (locationId === '') found['locationId'] = 'field.required';
    const typed = quantity.trim();
    if (!isQuantity(typed)) found['quantity'] = 'inventory.stockOps.quantityFormat';
    setErrors(found);
    if (Object.keys(found).length > 0 || chosen === null) return;
    onAdd({ key: crypto.randomUUID(), item: chosen, locationId, quantity: typed });
    setFinderItem(null);
    setScanned(null);
    setLocationId('');
    setQuantity('');
    setScanNote(null);
    setOnShelf(null);
  };

  return (
    <section aria-labelledby="counter-line-heading" className={PANEL}>
      <h2 id="counter-line-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.counterSales.line.heading')}
      </h2>
      <ScanBox
        messages={messages}
        idPrefix="counter"
        label={translate(messages, 'inventory.scan.label')}
        description={translate(messages, 'inventory.scan.help')}
        onCode={onScanned}
      />
      {scanNote !== null ? (
        <p role="status" className="text-caption text-text-muted">
          {translateDynamic(messages, scanNote)}
          {chosen !== null ? (
            <span className="ms-2" dir="ltr">
              {chosen.sku} — {chosen.name}
            </span>
          ) : null}
        </p>
      ) : null}
      {onShelf !== null ? (
        <p className="text-caption text-text-muted" dir="ltr">
          {translate(messages, 'inventory.counterSales.line.onShelf')} {onShelf}
        </p>
      ) : null}
      <ItemFinder
        messages={messages}
        idPrefix="counter"
        value={finderItem}
        onChange={(next) => {
          setFinderItem(next);
          setScanned(null);
        }}
        error={errors['itemId'] ? translateDynamic(messages, errors['itemId']) : undefined}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <LocationPicker
          messages={messages}
          locations={locations}
          label={translate(messages, 'inventory.counterSales.line.location')}
          placeholder={translate(messages, 'inventory.stockOps.chooseLocation')}
          required
          value={locationId}
          onChange={setLocationId}
          error={
            errors['locationId'] ? translateDynamic(messages, errors['locationId']) : undefined
          }
        />
        <TextField
          label={translate(messages, 'inventory.counterSales.line.quantity')}
          description={translate(messages, 'inventory.stockOps.quantityHelp')}
          required
          inputMode="decimal"
          dir="ltr"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          error={errors['quantity'] ? translateDynamic(messages, errors['quantity']) : undefined}
        />
      </div>
      <div>
        <button type="button" className={SECONDARY_BUTTON} onClick={add}>
          {translate(messages, 'inventory.counterSales.line.add')}
        </button>
      </div>
    </section>
  );
}

function DraftLines({
  messages,
  lines,
  onRemove,
}: {
  readonly messages: Messages;
  readonly lines: readonly CounterSaleLine[];
  readonly onRemove: (key: string) => void;
}) {
  return (
    <section aria-labelledby="counter-draft-heading" className={PANEL}>
      <h2 id="counter-draft-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.counterSales.draft.heading')}
      </h2>
      {lines.length === 0 ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.counterSales.draft.none')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <caption className="sr-only">
              {translate(messages, 'inventory.counterSales.draft.caption')}
            </caption>
            <thead>
              <tr className="text-caption text-text-muted">
                <th scope="col" className="text-start font-medium">
                  {translate(messages, 'inventory.counterSales.column.item')}
                </th>
                <th scope="col" className="text-end font-medium">
                  {translate(messages, 'inventory.counterSales.column.quantity')}
                </th>
                <th scope="col" className="text-end font-medium">
                  {translate(messages, 'inventory.counterSales.column.action')}
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.key} className="border-t border-border align-top">
                  <td>
                    <code className="font-mono text-caption" dir="ltr">
                      {line.item.sku}
                    </code>
                    <span className="block text-caption text-text-muted">{line.item.name}</span>
                  </td>
                  <td className="text-end">
                    <Qty value={line.quantity} />
                  </td>
                  <td className="text-end">
                    <button
                      type="button"
                      className={DANGER_BUTTON}
                      onClick={() => onRemove(line.key)}
                    >
                      {translate(messages, 'inventory.counterSales.draft.remove')}
                      <span className="sr-only"> {line.item.sku}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.counterSales.draft.priceNote')}
      </p>
    </section>
  );
}

function DraftSubmit({
  messages,
  target,
  buyer,
  lines,
  onDrafted,
}: {
  readonly messages: Messages;
  readonly target: StockTarget;
  readonly buyer: CustomerSearchHit | null;
  readonly lines: readonly CounterSaleLine[];
  readonly onDrafted: (created: CreatedInvoice) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /*
   * Derived ONCE per confirmation, not per keystroke and not per render: the
   * whole point of the key is that pressing the button again after a lost answer
   * replays the draft that was already made.
   */
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());

  const submit = async () => {
    if (buyer === null) {
      setProblem('inventory.counterSales.create.needsBuyer');
      return;
    }
    if (lines.length === 0) {
      setProblem('inventory.counterSales.create.needsLine');
      return;
    }
    setProblem(null);
    setBusy(true);
    const result = await createCounterSale(
      {
        companyId: target.companyId,
        branchId: target.branchId,
        customerPartnerId: buyer.id,
        lines: lines.map((line) => ({
          itemId: line.item.id,
          locationId: line.locationId,
          quantity: line.quantity,
        })),
      },
      attemptKey
    );
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      setAttemptKey(crypto.randomUUID());
      onDrafted(result.created);
    }
  };

  return (
    <div className={PANEL}>
      {problem !== null ? (
        <p className="text-body text-error">{translateDynamic(messages, problem)}</p>
      ) : null}
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <button
          type="button"
          className={PRIMARY_BUTTON}
          disabled={busy}
          onClick={() => {
            void submit();
          }}
        >
          {translate(messages, 'inventory.counterSales.create.submit')}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The drafted sale: issue, void, and where the money is settled
 * ------------------------------------------------------------------ */

function SalePanel({
  locale,
  messages,
  sale,
  canIssue,
  onChanged,
  onNewSale,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly sale: CreatedInvoice;
  readonly canIssue: boolean;
  readonly onChanged: (next: CreatedInvoice, noticeKey: string) => void;
  readonly onNewSale: () => void;
}) {
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const invoice = sale.invoice;

  /*
   * DEF-T-13. While the sale is a draft it exists only here: the control that
   * issues it is on this panel and no operation lists drafted sales, so a
   * reload leaves it unreachable. The browser is asked to confirm before the
   * document goes away — the only thing a page can do about a closed tab — and
   * the panel says the same in words for every other way of leaving.
   *
   * Registered only while the sale IS a draft: an issued or voided sale is
   * reachable through the invoice it produced, and a confirmation prompt with
   * nothing behind it teaches an operator to dismiss the next one.
   */
  useEffect(() => {
    if (invoice.status !== 'draft') return;
    const confirmLeaving = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', confirmLeaving);
    return () => window.removeEventListener('beforeunload', confirmLeaving);
  }, [invoice.status]);

  const issue = async () => {
    setBusy(true);
    // `If-Match` is the INVOICE's own `recordVersion`, as this answer published
    // it — never a line's, never defaulted, never carried across a write.
    const result = await issueInvoice(invoice.id, sale.recordVersion);
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      onChanged(
        {
          ...sale,
          invoice: result.created.invoice,
          recordVersion: result.created.recordVersion,
        },
        result.created.replayed
          ? 'inventory.counterSales.issue.replayed'
          : 'inventory.counterSales.issue.done'
      );
    }
  };

  const voidDraft = async () => {
    const why = reason.trim();
    if (why.length === 0 || why.length > MAX_INVOICE_REASON) {
      setReasonError(why.length === 0 ? 'field.required' : 'inventory.stockOps.reasonTooLong');
      return;
    }
    setReasonError(null);
    setBusy(true);
    const result = await cancelInvoice(invoice.id, { reason: why }, sale.recordVersion);
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      onChanged(
        {
          ...sale,
          invoice: result.created.invoice,
          recordVersion: result.created.recordVersion,
        },
        'inventory.counterSales.void.done'
      );
    }
  };

  return (
    <section aria-labelledby="counter-sale-heading" className={PANEL}>
      <h2 id="counter-sale-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.counterSales.sale.heading')}
      </h2>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-caption text-text-muted">
            {translate(messages, 'inventory.counterSales.sale.status')}
          </dt>
          <dd className="text-body text-text-primary">
            {translateDynamic(messages, `invoices.status.${invoice.status}`)}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-muted">
            {translate(messages, 'inventory.counterSales.sale.number')}
          </dt>
          <dd className="text-body text-text-primary" dir="ltr">
            {invoice.invoiceNumber ?? translate(messages, 'inventory.counterSales.sale.noNumber')}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-muted">
            {translate(messages, 'inventory.counterSales.sale.gross')}
          </dt>
          <dd className="text-body text-text-primary" dir="ltr">
            {invoice.totals === null
              ? translate(messages, 'inventory.counterSales.sale.noAmounts')
              : formatMoney(invoice.totals.gross, locale)}
          </dd>
        </div>
      </dl>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.counterSales.sale.explain')}
      </p>

      <OutcomeNote messages={messages} outcome={outcome} />

      {invoice.status === 'draft' ? (
        <>
          {/*
           * DEF-T-13. The draft lives in this component's state and the product
           * publishes no list of drafted sales, so a reload or an interrupted
           * session strands it with no way back — one such draft was left
           * stranded by the acceptance campaign and is still unreachable. The
           * list operation is owed by a later change; until it exists the screen
           * says plainly what leaving costs, rather than letting an operator
           * discover it afterwards, and `beforeunload` above asks the browser to
           * confirm a navigation away.
           */}
          <p role="status" className="text-body text-text-primary">
            {translate(messages, 'inventory.counterSales.sale.draftStranded')}
          </p>
          {canIssue ? (
            <div>
              <button
                type="button"
                className={PRIMARY_BUTTON}
                disabled={busy}
                onClick={() => {
                  void issue();
                }}
              >
                {translate(messages, 'inventory.counterSales.issue.action')}
              </button>
            </div>
          ) : (
            <p className="text-caption text-text-muted">
              {translate(messages, 'inventory.counterSales.issue.needsIssue')}
            </p>
          )}
          <TextField
            label={translate(messages, 'inventory.counterSales.void.reason')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={reasonError ? translateDynamic(messages, reasonError) : undefined}
          />
          <div>
            <button
              type="button"
              className={DANGER_BUTTON}
              disabled={busy}
              onClick={() => {
                void voidDraft();
              }}
            >
              {translate(messages, 'inventory.counterSales.void.action')}
            </button>
          </div>
        </>
      ) : (
        <p className="text-body text-text-primary">
          {translate(messages, 'inventory.counterSales.sale.issuedNote')}
        </p>
      )}

      {/*
       * The money is settled on the payments screen, and that screen already
       * accepts the invoice it is to settle: `payments/page.tsx` reads an
       * `invoiceId` from the address and prefills the allocation with it. So
       * this is a link rather than an instruction to go and find the sale
       * again — the operator arrives with the invoice already chosen.
       *
       * It is offered for an ISSUED invoice and for nothing else. A draft has
       * no number and no receivable — `sal.payment-record` refuses to allocate
       * against one — so a link offered beside a draft sends the operator to a
       * screen that can only refuse them, and a voided sale has nothing left to
       * settle at all.
       */}
      {invoice.status === 'issued' ? (
        <>
          <p className="text-caption text-text-muted">
            {translate(messages, 'inventory.counterSales.sale.paymentNote')}
          </p>
          <div>
            <Link href={`/${locale}/payments?invoiceId=${invoice.id}`} className={LINK}>
              {translate(messages, 'inventory.counterSales.sale.takePayment')}
            </Link>
          </div>
        </>
      ) : null}
      <div>
        <button type="button" className={SECONDARY_BUTTON} onClick={onNewSale}>
          {translate(messages, 'inventory.counterSales.sale.next')}
        </button>
      </div>
    </section>
  );
}
