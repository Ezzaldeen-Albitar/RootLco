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
 * ## Printing a sale again, and what the paper carries (finance checkpoint)
 *
 * An issued sale used to be reachable only while the operator stayed at the
 * counter: the list offered drafts only and the invoice screen needs a work
 * order, so a lost or second copy could not be printed (DF-B3). The branch's
 * issued sales are now listed beside the drafts, found by the server's search
 * (the sale number or the buyer's name; Arabic-Indic digits are folded by the
 * server) and walked a page at a time with the server's cursor, and opening one
 * shows the sale read-only with its printable copy already open.
 *
 * Wherever an issued sale is shown, its payment position is shown with it — Not
 * paid yet, Partly paid, Paid or Nothing to pay — from the server's balance read
 * (DF-2), and the printed copy carries the same read as its "settlement as of"
 * section (DF-B1). A part paid by a third party for the buyer (ADR-023 D14) reads
 * "Paid by <payer> (<relationship>) for <buyer>" with its authorisation reference,
 * on the panel and on the copy alike (finance QA fixes D). The whole screen is one print scope, so while the copy is
 * open the paper carries the copy alone and not the screen's text, the branch
 * panel or a notice (DF-B2).
 *
 * Permissions: `sal.invoice.manage` gates the page and offers the draft and the
 * void; `sal.finance.view` is required by construction wherever amounts are
 * written, and is what the issued-sales list (`sal.invoice-list`) and the balance
 * read declare; `sal.invoice.issue` offers the issue; `inv.item.read` the
 * catalogue; `crm.customer.read` the buyer search and the buyer's name on the
 * issued list; `org.branch.read` the branch picker.
 *
 * ## On Material UI (ADR-022, `P1-32-PRE-OD-INV6`)
 *
 * The issued sales were already `FilterToolbar`, `OperationalGrid` (the
 * server's cursor pages, `rowCount` -1) and `MuiSearchStates`. Every other
 * control the screen draws itself is now a shared wrapper too: the buyer's
 * search field and the buyer are `FormSelectField` (native, F6), the search term
 * and the void reason `FormTextField`, a line's quantity `FormNumberField` (the
 * exact string typed is the string sent), and every button is Material's. The
 * drafted sales and the lines being composed are Material's table: the draft
 * read answers one page with a "more exist" flag and no cursor is walked, and
 * the lines are held on this screen, so neither has a pager to drive. The scan
 * box, the item finder, the location select and the drafts' wait, empty and
 * failed states are the shared inventory pieces. The printed copy is billing's
 * `CounterSalePrintPanel`, unchanged. What is read, sent, authorized and refused
 * is unchanged, and so is who sees an amount.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';

import {
  OperationalGrid,
  type OperationalColumn,
  type RowAction,
} from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { FilterToolbar } from '@/components/filters/FilterToolbar';
import { FormNumberField } from '@/components/forms/mui/FormNumberField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiSearchStates } from '@/components/states/MuiStates';
import {
  useUnsavedGuard,
  useWorkingContext,
} from '@/features/working-context/WorkingContextProvider';
import {
  cancelInvoice,
  createCounterSale,
  issueInvoice,
  listCounterSales,
  listInvoices,
  readInvoice,
} from '@/features/billing/api';
import {
  MAX_INVOICE_SEARCH,
  MAX_REASON as MAX_INVOICE_REASON,
  MIN_INVOICE_SEARCH,
  type CreatedInvoice,
  type Invoice,
  type InvoiceDetail,
  type InvoiceListEntry,
  type Outstanding,
} from '@/features/billing/billing-contract';
import type { PayerName } from '@/features/billing/components/InvoiceDocument';
import { CounterSalePrintPanel, usePayerName } from '@/features/billing/components/InvoiceScreen';
import { ThirdPartyPaymentItems, When } from '@/features/billing/components/shared';
import { settlementOf, useOutstandingRead } from '@/features/billing/use-outstanding-read';
import { searchCustomerDirectoryCancellable } from '@/lib/customers/directory-read';
import type { CustomerSearchHit } from '@/lib/customers/directory-contract';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { CursorPage, ReadState } from '@/lib/api/read-operation';
import { useSearchRequest } from '@/lib/api/use-search-request';
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
import { LocationPicker, OutcomeNote, Qty, useLocations } from './shared';
import { ScanBox } from './ScanBox';
import {
  BranchListView,
  BranchTargetForm,
  ItemFinder,
  LINK,
  PANEL,
  StockOperationLinks,
  isQuantity,
  useBranchList,
} from './stock-operations';

export function CounterSalesScreen({
  locale,
  messages,
  canSell,
  canIssue,
  canReadCustomers,
  initialInvoiceId = null,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /**
   * `sal.invoice.manage` AND `sal.finance.view` — drafting and voiding, and the
   * issued-sales list and balance read, which declare the finance view.
   */
  readonly canSell: boolean;
  /** `sal.invoice.issue` — issuing, which is what moves the stock. */
  readonly canIssue: boolean;
  /** `crm.customer.read` — whether the buyer search is offered. */
  readonly canReadCustomers: boolean;
  /**
   * `org.branch.read`. Accepted so the route did not have to change, and no
   * longer read: the branch is the working context's own named selection, and
   * that read is gated on `iam.user.read` rather than on an administration
   * code.
   */
  readonly canReadBranches?: boolean;
  /**
   * A sale named in the address — how a credit note links the counter sale it
   * reduces (DF-B4). Opened once, as soon as the branch is known, and never
   * again after the operator moves on.
   */
  readonly initialInvoiceId?: string | null;
}) {
  const [target, setTarget] = useState<StockTarget | null>(null);
  const [named, setNamed] = useState<string | null>(initialInvoiceId);
  const consumeNamed = useCallback(() => setNamed(null), []);
  /*
   * DF-B2. The whole screen is one print scope: while a printable copy is open
   * below, every direct child that holds no copy — the links, the explanation,
   * the branch panel, a notice — is left off the paper (`styles/print`), and the
   * nested scope around the sale leaves its working panel off too. The page puts
   * its own header in a scope of its own the same way.
   */
  return (
    <div data-print-scope="document" className="flex min-h-0 flex-col gap-4">
      <StockOperationLinks locale={locale} messages={messages} />
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.counterSales.explain')}
      </p>
      <BranchTargetForm
        messages={messages}
        formLabelKey="inventory.counterSales.targetLabel"
        explainKey="inventory.target.explain"
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
          openOnMount={named}
          onOpened={consumeNamed}
        />
      )}
    </div>
  );
}

/** What the screen was asked to show of an issued sale: nothing, or how it was reached. */
type SaleOrigin = 'counter' | 'reprint';

function BranchCounter({
  locale,
  messages,
  target,
  canIssue,
  canReadCustomers,
  openOnMount,
  onOpened,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: StockTarget;
  readonly canIssue: boolean;
  readonly canReadCustomers: boolean;
  /** A sale to open as soon as this branch's counter is shown, or `null`. */
  readonly openOnMount: string | null;
  /** Called once the named sale has been read, whatever the answer. */
  readonly onOpened: () => void;
}) {
  const locations = useLocations(target);
  const [buyer, setBuyer] = useState<CustomerSearchHit | null>(null);
  const [lines, setLines] = useState<readonly CounterSaleLine[]>([]);
  const [sale, setSale] = useState<CreatedInvoice | null>(null);
  const [origin, setOrigin] = useState<SaleOrigin>('counter');
  const [notice, setNotice] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  /*
   * The draft attempt belongs to the composition, not to the Draft button: the
   * button unmounts whenever a sale is on screen, and the composition outlives
   * that (a reprint or a reopened draft sets it aside). Held here, a retry after
   * a lost answer sends the SAME idempotency key, so the server replays the
   * draft it may already have made instead of making a second one, and the
   * lost-answer notice is still shown on return. Renewed only once a draft has
   * been made.
   */
  const [draftKey, setDraftKey] = useState(() => crypto.randomUUID());
  const [draftOutcome, setDraftOutcome] = useState<ActionState | null>(null);
  const { balance, retryBalance } = useSaleBalance(sale);

  /*
   * DF-B3. An issued sale, opened read-only with its copy already open. The
   * detail read is the sale panel's own (the list publishes a header only), and
   * a sale that turns out not to be a counter sale is not shown here: a job's
   * invoice belongs to the invoice screen. State is written only once the read
   * has answered, never synchronously inside the effect that asks.
   */
  const showOpened = useCallback((answer: ReadState<InvoiceDetail>) => {
    if (answer.status === 'ok' && answer.data.invoice.saleKind === 'counter_sale') {
      setSale({ ...answer.data, replayed: false });
      setOrigin(answer.data.invoice.status === 'draft' ? 'counter' : 'reprint');
      setNotice(
        answer.data.invoice.status === 'draft'
          ? 'inventory.counterSales.drafts.reopened'
          : 'inventory.counterSales.issued.opened'
      );
      return;
    }
    setNotice(
      answer.status === 'ok'
        ? 'inventory.counterSales.issued.notCounterSale'
        : answer.status === 'denied'
          ? 'inventory.counterSales.issued.openRefused'
          : answer.status === 'not-found'
            ? 'inventory.counterSales.issued.openMissing'
            : 'inventory.counterSales.issued.openUnavailable'
    );
  }, []);

  const openIssued = async (invoiceId: string): Promise<void> => {
    setOpening(invoiceId);
    const answer = await readInvoice(invoiceId);
    setOpening(null);
    showOpened(answer);
  };

  useEffect(() => {
    if (openOnMount === null) return;
    let live = true;
    void readInvoice(openOnMount).then((answer) => {
      if (!live) return;
      showOpened(answer);
      onOpened();
    });
    return () => {
      live = false;
    };
  }, [openOnMount, showOpened, onOpened]);
  /*
   * Unsaved work, declared to the shell. A buyer chosen or a line added before
   * the draft exists is held only here, under THIS branch's key, so a branch
   * switch asks first; a confirmed switch remounts the counter empty. Once the
   * draft exists it is stored, the composition is let go, and the drafts list
   * offers it back.
   *
   * Declared on what is HELD, not on what is shown: opening an issued sale to
   * print it again, or reopening a stored draft, sets the composition aside
   * without saving it, so it stays protected while that sale is on screen and
   * is still there when the operator comes back to the counter.
   */
  useUnsavedGuard(buyer !== null || lines.length > 0);
  /*
   * DEF-T-13. The branch's drafted sales, so one is reachable again after a
   * reload. Re-read after every draft, issue and void, because each of those
   * changes what belongs on it.
   */
  const drafts = useBranchList<Invoice>(
    target,
    DRAFT_SALES,
    'inventory.counterSales.drafts.refused',
    'inventory.counterSales.drafts.unavailable'
  );

  return (
    <>
      {notice !== null ? (
        <p role="status" className="rounded-lg border border-border bg-surface p-3 text-body">
          {translateDynamic(messages, notice)}
        </p>
      ) : null}

      {sale === null ? (
        <>
          <OpenDrafts
            locale={locale}
            messages={messages}
            drafts={drafts.list}
            onReopened={(reopened) => {
              setSale(reopened);
              setNotice('inventory.counterSales.drafts.reopened');
            }}
            onProblem={setNotice}
          />
          <IssuedSales
            locale={locale}
            messages={messages}
            target={target}
            opening={opening}
            onOpen={(invoiceId) => void openIssued(invoiceId)}
          />
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
            attemptKey={draftKey}
            outcome={draftOutcome}
            onAttempted={setDraftOutcome}
            onDrafted={(created) => {
              // The buyer and the lines are now the stored draft, so they are no
              // longer unsaved work held here, and the next composition is a new
              // attempt with a key of its own.
              setDraftKey(crypto.randomUUID());
              setDraftOutcome(null);
              setLines([]);
              setBuyer(null);
              setSale(created);
              drafts.reload();
              setNotice(
                created.replayed
                  ? 'inventory.counterSales.create.replayed'
                  : 'inventory.counterSales.create.done'
              );
            }}
          />
        </>
      ) : (
        // The sale and its printable copy side by side in one print scope: while
        // the copy is open, paper carries it and not the working panel (GAP-09).
        <SaleView
          key={`${sale.invoice.id}:${origin}`}
          locale={locale}
          messages={messages}
          sale={sale}
          balance={balance}
          onRetryBalance={retryBalance}
          canIssue={canIssue}
          initiallyOpen={origin === 'reprint'}
          onChanged={(next, noticeKey) => {
            setSale(next);
            drafts.reload();
            setNotice(noticeKey);
          }}
          onNewSale={() => {
            // Back to the counter. A composition set aside to open this sale is
            // kept as it was; one that became this sale was let go when drafted.
            setSale(null);
            setOrigin('counter');
            setNotice(null);
            drafts.reload();
          }}
        />
      )}
    </>
  );
}

/**
 * One open sale: its panel and its printable copy, in one print scope.
 *
 * The buyer is named ONCE, here (`usePayerName`, the invoice screen's own
 * lookup), and handed to both: the panel needs the name for a third-party
 * payment's "Paid by … for <customer>" (finance QA fixes D) and the copy prints
 * it, so the two can never name different people or ask twice. Keyed by the
 * sale and how it was reached, so another sale starts from a fresh lookup.
 */
function SaleView({
  locale,
  messages,
  sale,
  balance,
  onRetryBalance,
  canIssue,
  initiallyOpen,
  onChanged,
  onNewSale,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly sale: CreatedInvoice;
  readonly balance: ReadState<Outstanding> | null;
  /** Reads the balance again, after a read that was refused or did not answer in time. */
  readonly onRetryBalance: () => void;
  readonly canIssue: boolean;
  readonly initiallyOpen: boolean;
  readonly onChanged: (next: CreatedInvoice, noticeKey: string) => void;
  readonly onNewSale: () => void;
}) {
  const canViewFinance = sale.invoice.totals !== null;
  const payer = usePayerName(sale.invoice, null, canViewFinance);
  return (
    <div data-print-scope="document" className="flex min-h-0 flex-col gap-4">
      <SalePanel
        locale={locale}
        messages={messages}
        sale={sale}
        balance={balance}
        customer={payer.payer}
        canIssue={canIssue}
        onChanged={onChanged}
        onNewSale={onNewSale}
      />
      <CounterSalePrintPanel
        locale={locale}
        messages={messages}
        detail={sale}
        canViewFinance={canViewFinance}
        // DX-2: the copy waits for its settlement as it waits for the name — it
        // is never offered for printing while what was paid is still being read,
        // and a read that failed or ran out of time is said on the copy, with a
        // way to read it again.
        settlement={settlementOf(balance, canViewFinance && owes(sale))}
        onRetrySettlement={onRetryBalance}
        initiallyOpen={initiallyOpen}
        payer={payer}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The drafted sales of this branch (DEF-T-13)
 * ------------------------------------------------------------------ */

/**
 * Module-level, not a closure: `useBranchList` keys its request on the branch
 * and re-issues whenever the reader identity changes, so a function rebuilt on
 * every render would read the branch again on every render.
 */
const DRAFT_SALES = (where: StockTarget) => listCounterSales(where, { status: 'draft' });

/**
 * The balance of an issued sale, as the server computes it on every read
 * (`sal.invoice-outstanding-read`): what is still due, the payment and credit
 * positions (D7) and when they were read (D10). Read for an issued or credited
 * sale only — a draft claims nothing and a voided one never will — and read
 * again whenever the sale changes. `null` while it is being read.
 *
 * A read for a sale the operator has already left is dropped: the answer is
 * kept only for the sale it was asked for.
 */
function useSaleBalance(sale: CreatedInvoice | null): {
  readonly balance: ReadState<Outstanding> | null;
  readonly retryBalance: () => void;
} {
  const invoiceId = sale?.invoice.id ?? null;
  const version = sale?.recordVersion ?? 0;
  // DX-2: read through the cancellable route, not a Server Action, so the
  // buyer-name lookup — an action the router runs one at a time with every
  // other — can no longer hold it up.
  const { state, retry } = useOutstandingRead(
    invoiceId,
    sale !== null && owes(sale) && invoiceId !== null ? `${invoiceId}#${version}` : null
  );
  return { balance: state, retryBalance: retry };
}

/** Whether a sale claims anything yet: an issued or credited one does, a draft never. */
function owes(sale: CreatedInvoice): boolean {
  return sale.invoice.status === 'issued' || sale.invoice.status === 'credited';
}

/* ------------------------------------------------------------------ *
 * The issued sales of this branch (finance checkpoint, DF-B3)
 * ------------------------------------------------------------------ */

/** What the issued-sales search asks the server for. `q` absent: every issued sale. */
interface IssuedCriteria {
  readonly q?: string;
}

/**
 * The branch's issued counter sales, newest first, each openable to print again.
 *
 * `sal.invoice-list` narrowed to `saleKind=counter_sale` and `status=issued`.
 * The box is the server's search — the sale's number, and the buyer's name for
 * a reader who may read customers — sent as typed; the server folds
 * Arabic-Indic digits before it compares. Fewer than two characters are refused
 * at the box and nothing is asked. Pages are the server's cursor pages; the
 * branch is the working context's, and a branch change abandons a read in
 * flight (`useSearchRequest`, keyed on the context's version).
 */
function IssuedSales({
  locale,
  messages,
  target,
  opening,
  onOpen,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: StockTarget;
  /** The sale being opened, while its detail is read. */
  readonly opening: string | null;
  readonly onOpen: (invoiceId: string) => void;
}) {
  const context = useWorkingContext();
  const [term, setTerm] = useState('');
  const trimmed = term.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_INVOICE_SEARCH;
  const criteria: IssuedCriteria | null = tooShort ? null : trimmed ? { q: trimmed } : {};
  const { companyId, branchId } = target;

  const load = useCallback(
    async (
      asked: IssuedCriteria,
      cursor: string | null
    ): Promise<ReadState<CursorPage<InvoiceListEntry>>> =>
      listInvoices(
        { companyId, branchId },
        { saleKind: 'counter_sale', status: 'issued', q: asked.q },
        cursor
      ),
    [companyId, branchId]
  );
  const search = useSearchRequest<InvoiceListEntry, IssuedCriteria>({
    criteria,
    load,
    version: context.version,
    narrows: (asked) => asked.q !== undefined,
  });

  const columns = useMemo<readonly OperationalColumn<InvoiceListEntry>[]>(
    () => [
      {
        id: 'sale',
        headerKey: 'inventory.counterSales.issued.column.sale',
        flex: 1.2,
        cell: (row) => (
          <span className="flex flex-col">
            {row.invoiceNumber === null ? (
              <span>{translate(messages, 'inventory.counterSales.sale.noNumber')}</span>
            ) : (
              <bdi className="font-mono" dir="ltr">
                {row.invoiceNumber}
              </bdi>
            )}
            {row.issuedAt === null ? null : (
              <span className="text-caption text-text-muted">
                <When value={row.issuedAt} locale={locale} />
              </span>
            )}
          </span>
        ),
      },
      {
        id: 'buyer',
        headerKey: 'inventory.counterSales.issued.column.buyer',
        flex: 1.4,
        cell: (row) =>
          row.payer.displayName === null ? (
            <span className="text-text-muted">
              {translate(messages, 'inventory.counterSales.issued.buyerNotShown')}
            </span>
          ) : (
            <bdi>{row.payer.displayName}</bdi>
          ),
      },
      {
        id: 'total',
        headerKey: 'inventory.counterSales.column.total',
        numeric: true,
        cell: (row) =>
          row.totals === null ? (
            <span>{translate(messages, 'inventory.counterSales.sale.noAmounts')}</span>
          ) : (
            <span className="font-mono" dir="ltr">
              {formatMoney(row.totals.gross, locale)}
            </span>
          ),
      },
      {
        id: 'open',
        headerKey: 'inventory.counterSales.issued.column.due',
        numeric: true,
        cell: (row) =>
          row.outstanding === null ? (
            <span>{translate(messages, 'inventory.counterSales.sale.noAmounts')}</span>
          ) : (
            <span className="font-mono" dir="ltr">
              {formatMoney(row.outstanding, locale)}
            </span>
          ),
      },
    ],
    [locale, messages]
  );

  const rowActions = useCallback(
    (row: InvoiceListEntry): readonly RowAction[] => [
      {
        kind: 'button',
        label: translate(messages, 'inventory.counterSales.issued.open'),
        about: row.invoiceNumber ?? undefined,
        disabled: opening !== null,
        onClick: () => onOpen(row.id),
      },
    ],
    [messages, onOpen, opening]
  );

  return (
    <section aria-labelledby="counter-issued-heading" className={PANEL}>
      <h2 id="counter-issued-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.counterSales.issued.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.counterSales.issued.explain')}
      </p>
      <FilterToolbar
        messages={messages}
        label={translate(messages, 'inventory.counterSales.issued.filtersLabel')}
        testId="counter-issued-toolbar"
        search={{
          label: translate(messages, 'inventory.counterSales.issued.search'),
          example: translate(messages, 'inventory.counterSales.issued.searchExample'),
          value: term,
          onChange: setTerm,
          onSubmit: search.submit,
          busy: search.phase === 'loading',
          maxLength: MAX_INVOICE_SEARCH,
          error: tooShort
            ? translate(messages, 'inventory.counterSales.issued.tooShort')
            : undefined,
          echoDigits: true,
        }}
      />
      {search.phase === 'empty' && search.table.narrowed !== true ? (
        <p className="text-body text-text-secondary" lang={locale}>
          {translate(messages, 'inventory.counterSales.issued.none')}
        </p>
      ) : (
        <MuiSearchStates
          messages={messages}
          locale={locale}
          phase={search.phase}
          correlationId={search.correlationId}
          emptyReason="search"
          onRetry={search.submit}
        />
      )}
      {search.phase === 'ready' ? (
        <OperationalGrid<InvoiceListEntry>
          messages={messages}
          locale={locale}
          label={translate(messages, 'inventory.counterSales.issued.caption')}
          columns={columns}
          rowId={(row) => row.id}
          table={search.table}
          rowActions={rowActions}
          suppressEmptyState
          testId="counter-issued-grid"
        />
      ) : null}
    </section>
  );
}

/**
 * The branch's drafted counter sales, each reopenable.
 *
 * DEF-T-13: a draft used to live only in this screen's memory, so a reload — or
 * a closed tab, or an interrupted session — stranded it with no way back, and
 * one such draft was left stranded by the acceptance campaign. `sal.counter-sale-list`
 * answers for the branch, and reopening is the invoice detail read: the sale
 * panel needs the lines and the invoice's own version to issue or void it, and
 * the list publishes a header only.
 */
function OpenDrafts({
  locale,
  messages,
  drafts,
  onReopened,
  onProblem,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly drafts: ReturnType<typeof useBranchList<Invoice>>['list'];
  readonly onReopened: (sale: CreatedInvoice) => void;
  readonly onProblem: (messageKey: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const reopen = async (invoiceId: string) => {
    setBusy(invoiceId);
    const answer = await readInvoice(invoiceId);
    setBusy(null);
    if (answer.status === 'ok') {
      // `replayed: false`: nothing was written to reach this sale, and the panel
      // uses the flag only to choose which sentence it shows after a write.
      onReopened({ ...answer.data, replayed: false });
      return;
    }
    onProblem(
      answer.status === 'denied'
        ? 'inventory.counterSales.drafts.reopenRefused'
        : answer.status === 'not-found'
          ? 'inventory.counterSales.drafts.reopenMissing'
          : 'inventory.counterSales.drafts.reopenUnavailable'
    );
  };

  return (
    <section aria-labelledby="counter-drafts-heading" className={PANEL}>
      <h2 id="counter-drafts-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.counterSales.drafts.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.counterSales.drafts.explain')}
      </p>
      <BranchListView
        messages={messages}
        locale={locale}
        list={drafts}
        loadingKey="inventory.counterSales.drafts.loading"
        noneKey="inventory.counterSales.drafts.none"
        truncatedKey="inventory.counterSales.drafts.truncated"
      >
        {(items) => (
          <TableContainer>
            <Table size="small">
              <caption className="sr-only">
                {translate(messages, 'inventory.counterSales.drafts.caption')}
              </caption>
              <TableHead>
                <TableRow>
                  <TableCell scope="col">
                    {translate(messages, 'inventory.counterSales.column.sale')}
                  </TableCell>
                  <TableCell scope="col" align="right">
                    {translate(messages, 'inventory.counterSales.column.total')}
                  </TableCell>
                  <TableCell scope="col" align="right">
                    {translate(messages, 'inventory.counterSales.column.action')}
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((draft) => (
                  <TableRow key={draft.id} className="align-top">
                    <TableCell>
                      {translate(messages, 'inventory.counterSales.drafts.notIssued')}
                    </TableCell>
                    <TableCell align="right">
                      {draft.totals === null ? (
                        translate(messages, 'inventory.counterSales.sale.noAmounts')
                      ) : (
                        <span dir="ltr">{formatMoney(draft.totals.gross, locale)}</span>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        type="button"
                        variant="outlined"
                        size="small"
                        disabled={busy !== null}
                        onClick={() => {
                          void reopen(draft.id);
                        }}
                      >
                        {translate(messages, 'inventory.counterSales.drafts.reopen')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </BranchListView>
    </section>
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
    // The route read, not the Server Action (P1-32-PRE-OD-READ), so a buyer
    // lookup never waits behind another action on this page.
    const page = await searchCustomerDirectoryCancellable(
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
            <FormSelectField
              label={translate(messages, 'inventory.counterSales.buyer.searchBy')}
              value={field}
              onChange={(next) => setField(next as BuyerSearchField)}
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
            <FormTextField
              label={translate(messages, 'inventory.counterSales.buyer.term')}
              value={term}
              onChange={setTerm}
              onKeyDown={(event) => {
                // Enter searches now and never submits anything around the box.
                if (event.key !== 'Enter') return;
                event.preventDefault();
                void find();
              }}
            />
            <div className="flex items-end">
              <Button
                type="button"
                variant="outlined"
                onClick={() => {
                  void find();
                }}
              >
                {translate(messages, 'inventory.counterSales.buyer.search')}
              </Button>
            </div>
          </div>
          {note !== null ? (
            <p className="text-caption text-text-muted">{translateDynamic(messages, note)}</p>
          ) : null}
          <FormSelectField
            label={translate(messages, 'inventory.counterSales.buyer.label')}
            required
            value={value?.id ?? ''}
            onChange={(next) => onChange(options.find((hit) => hit.id === next) ?? null)}
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
  useUnsavedGuard(
    finderItem !== null || scanned !== null || locationId !== '' || quantity.trim().length > 0
  );
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
        // The sentence in the page's direction; only the server's figures read left to right.
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.counterSales.line.onShelf')}{' '}
          <bdi dir="ltr">{onShelf}</bdi>
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
        <FormNumberField
          label={translate(messages, 'inventory.counterSales.line.quantity')}
          description={translate(messages, 'inventory.stockOps.quantityHelp')}
          required
          value={quantity}
          onChange={setQuantity}
          error={errors['quantity'] ? translateDynamic(messages, errors['quantity']) : undefined}
        />
      </div>
      <div>
        <Button type="button" variant="outlined" onClick={add}>
          {translate(messages, 'inventory.counterSales.line.add')}
        </Button>
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
        <TableContainer>
          <Table size="small">
            <caption className="sr-only">
              {translate(messages, 'inventory.counterSales.draft.caption')}
            </caption>
            <TableHead>
              <TableRow>
                <TableCell scope="col">
                  {translate(messages, 'inventory.counterSales.column.item')}
                </TableCell>
                <TableCell scope="col" align="right">
                  {translate(messages, 'inventory.counterSales.column.quantity')}
                </TableCell>
                <TableCell scope="col" align="right">
                  {translate(messages, 'inventory.counterSales.column.action')}
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.key} className="align-top">
                  <TableCell>
                    <code className="font-mono text-caption" dir="ltr">
                      {line.item.sku}
                    </code>
                    <span className="block text-caption text-text-muted">{line.item.name}</span>
                  </TableCell>
                  <TableCell align="right">
                    <Qty value={line.quantity} />
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      type="button"
                      variant="outlined"
                      color="error"
                      size="small"
                      onClick={() => onRemove(line.key)}
                    >
                      {translate(messages, 'inventory.counterSales.draft.remove')}
                      <span className="sr-only"> {line.item.sku}</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
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
  attemptKey,
  outcome,
  onAttempted,
  onDrafted,
}: {
  readonly messages: Messages;
  readonly target: StockTarget;
  readonly buyer: CustomerSearchHit | null;
  readonly lines: readonly CounterSaleLine[];
  /**
   * The composition's idempotency key, held by the counter (not here) so it
   * survives this panel unmounting while a sale is shown: pressing Draft again
   * after a lost answer replays the draft that was already made.
   */
  readonly attemptKey: string;
  /** The last draft attempt's answer, held with the key for the same reason. */
  readonly outcome: ActionState | null;
  readonly onAttempted: (state: ActionState) => void;
  readonly onDrafted: (created: CreatedInvoice) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // One draft sent at a time, before `busy` has disabled the button.
  const sending = useRef(false);

  const submit = async () => {
    if (sending.current) return;
    if (buyer === null) {
      setProblem('inventory.counterSales.create.needsBuyer');
      return;
    }
    if (lines.length === 0) {
      setProblem('inventory.counterSales.create.needsLine');
      return;
    }
    setProblem(null);
    sending.current = true;
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
    sending.current = false;
    setBusy(false);
    onAttempted(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
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
        <Button
          type="button"
          variant="contained"
          disabled={busy}
          onClick={() => {
            void submit();
          }}
        >
          {translate(messages, 'inventory.counterSales.create.submit')}
        </Button>
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
  balance,
  customer,
  canIssue,
  onChanged,
  onNewSale,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly sale: CreatedInvoice;
  /** The issued sale's balance read (`useSaleBalance`), `null` while read or for a draft. */
  readonly balance: ReadState<Outstanding> | null;
  /** Who the sale bills, as the screen could name them. */
  readonly customer: PayerName;
  readonly canIssue: boolean;
  readonly onChanged: (next: CreatedInvoice, noticeKey: string) => void;
  readonly onNewSale: () => void;
}) {
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  // One issue or void sent at a time, before `busy` has disabled the buttons.
  const sending = useRef(false);
  const invoice = sale.invoice;
  // A void reason typed against a draft is unsaved until the void is recorded.
  useUnsavedGuard(invoice.status === 'draft' && reason.trim().length > 0);

  /*
   * DEF-T-13 used to be guarded here by a `beforeunload` confirmation, because a
   * draft lived only in this component's memory and leaving the page stranded
   * it. `sal.counter-sale-list` now answers for the branch and the panel above
   * offers every draft back, so leaving costs nothing — and a confirmation
   * prompt with nothing behind it teaches an operator to dismiss the next one.
   */

  const issue = async () => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    // `If-Match` is the INVOICE's own `recordVersion`, as this answer published
    // it — never a line's, never defaulted, never carried across a write.
    const result = await issueInvoice(invoice.id, sale.recordVersion);
    sending.current = false;
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
    if (sending.current) return;
    const why = reason.trim();
    if (why.length === 0 || why.length > MAX_INVOICE_REASON) {
      setReasonError(why.length === 0 ? 'field.required' : 'inventory.stockOps.reasonTooLong');
      return;
    }
    setReasonError(null);
    sending.current = true;
    setBusy(true);
    const result = await cancelInvoice(invoice.id, { reason: why }, sale.recordVersion);
    sending.current = false;
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
          <dd className="text-body text-text-primary">
            {invoice.invoiceNumber === null ? (
              translate(messages, 'inventory.counterSales.sale.noNumber')
            ) : (
              <bdi dir="ltr">{invoice.invoiceNumber}</bdi>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-muted">
            {translate(messages, 'inventory.counterSales.sale.gross')}
          </dt>
          <dd className="text-body text-text-primary">
            {invoice.totals === null ? (
              translate(messages, 'inventory.counterSales.sale.noAmounts')
            ) : (
              <bdi dir="ltr">{formatMoney(invoice.totals.gross, locale)}</bdi>
            )}
          </dd>
        </div>
      </dl>
      {invoice.status === 'issued' || invoice.status === 'credited' ? (
        <SalePosition locale={locale} messages={messages} balance={balance} customer={customer} />
      ) : null}
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.counterSales.sale.explain')}
      </p>

      <OutcomeNote messages={messages} outcome={outcome} />

      {invoice.status === 'draft' ? (
        <>
          {/*
           * DEF-T-13. The sentence that used to warn an operator that leaving
           * would strand this draft now tells them where it will be instead: the
           * open-drafts panel lists it until it is issued or voided.
           */}
          <p role="status" className="text-body text-text-primary">
            {translate(messages, 'inventory.counterSales.sale.draftListed')}
          </p>
          {canIssue ? (
            <div>
              <Button
                type="button"
                variant="contained"
                disabled={busy}
                onClick={() => {
                  void issue();
                }}
              >
                {translate(messages, 'inventory.counterSales.issue.action')}
              </Button>
            </div>
          ) : (
            <p className="text-caption text-text-muted">
              {translate(messages, 'inventory.counterSales.issue.needsIssue')}
            </p>
          )}
          <FormTextField
            label={translate(messages, 'inventory.counterSales.void.reason')}
            value={reason}
            onChange={setReason}
            error={reasonError ? translateDynamic(messages, reasonError) : undefined}
          />
          <div>
            <Button
              type="button"
              variant="outlined"
              color="error"
              disabled={busy}
              onClick={() => {
                void voidDraft();
              }}
            >
              {translate(messages, 'inventory.counterSales.void.action')}
            </Button>
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
        <Button type="button" variant="outlined" onClick={onNewSale}>
          {translate(messages, 'inventory.counterSales.sale.next')}
        </Button>
      </div>
    </section>
  );
}

/**
 * Where an issued sale stands (DF-2): whether it has been paid, whether it has
 * been credited, and what is still to pay — the server's own positions and
 * figure, never worked out here. Said in words while it is read and when it
 * could not be read; never a zero standing in for "unknown".
 */
function SalePosition({
  locale,
  messages,
  balance,
  customer,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly balance: ReadState<Outstanding> | null;
  /** Who the sale bills, for a third-party payment's "Paid by … for …". */
  readonly customer: PayerName;
}) {
  if (balance === null) {
    return (
      <p className="text-caption text-text-muted" role="status">
        {translate(messages, 'inventory.counterSales.sale.positionLoading')}
      </p>
    );
  }
  if (balance.status !== 'ok' || balance.data.settlement === null) {
    return (
      <p className="text-caption text-text-muted" data-testid="counter-sale-position-unavailable">
        {translate(messages, 'inventory.counterSales.sale.positionUnavailable')}
      </p>
    );
  }
  const { settlement, outstanding } = balance.data;
  const thirdParty = settlement.thirdPartyPayments ?? [];
  return (
    <dl className="grid gap-3 sm:grid-cols-3" data-testid="counter-sale-position">
      <div>
        <dt className="text-caption text-text-muted">
          {translate(messages, 'invoices.settlement.payment')}
        </dt>
        <dd className="text-body text-text-primary" data-testid="counter-sale-payment-status">
          {translateDynamic(messages, `invoices.paymentStatus.${settlement.paymentStatus}`)}
        </dd>
      </div>
      <div>
        <dt className="text-caption text-text-muted">
          {translate(messages, 'invoices.settlement.credit')}
        </dt>
        <dd className="text-body text-text-primary" data-testid="counter-sale-credit-status">
          {translateDynamic(messages, `invoices.creditStatus.${settlement.creditStatus}`)}
        </dd>
      </div>
      <div>
        <dt className="text-caption text-text-muted">
          {translate(messages, 'inventory.counterSales.sale.due')}
        </dt>
        <dd className="text-body text-text-primary" dir="ltr" data-testid="counter-sale-due">
          {formatMoney(outstanding, locale)}
        </dd>
      </div>
      {thirdParty.length > 0 ? (
        // Somebody other than the buyer paid part of this sale as a third-party
        // payment (ADR-023 D14): said here as on the invoice screen and the copy,
        // from the balance read's own values (finance QA fixes D).
        <div className="sm:col-span-3" data-testid="counter-sale-third-party-payments">
          <dt className="text-caption text-text-muted">
            {translate(messages, 'invoices.thirdParty.heading')}
          </dt>
          <dd className="text-body text-text-primary">
            <ThirdPartyPaymentItems
              locale={locale}
              messages={messages}
              payments={thirdParty}
              truncated={settlement.thirdPartyPaymentsTruncated === true}
              customer={customer}
            />
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
