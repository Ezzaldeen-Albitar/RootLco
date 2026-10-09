'use client';

/**
 * Goods receipts and the item cost history (P1-32).
 *
 * A receipt is created as a DRAFT with its counted lines and posted as a
 * separate act; nothing is on hand until it is posted. Posting is
 * version-guarded: the receipt's `recordVersion` travels as If-Match exactly as
 * the last read or write answered it, and a receipt changed by someone else in
 * between is refused rather than posted over.
 *
 * ## Cost is gated at both ends
 *
 * A unit cost on a line may be written only by a holder of `inv.cost.view`, so
 * the cost fields are offered only to one — the server refuses the field
 * otherwise rather than dropping it. The receipt reads say whether a line is
 * priced, never the figure; the figures are read through the cost history,
 * offered only to the same holder. The latest unit cost and the weighted
 * average are the server's, shown as the decimal strings it sent; where the
 * layers span more than one currency the server publishes no average and the
 * screen says why.
 *
 * Permissions: `inv.stock.read` gates the page; `inv.stock.operate` offers the
 * receipt form and posting; `inv.cost.view` the cost fields and the cost
 * history; `org.branch.read` the branch picker.
 *
 * ## On Material UI (ADR-022, `P1-32-PRE-OD-INV3`)
 *
 * Every control this screen draws itself is a shared wrapper: the receipt's
 * references, notes and currency are `forms/mui` text fields, the quantity and
 * the unit cost `FormNumberField` (the exact strings typed are the strings
 * sent; a cost is never rounded or re-formatted on the way), the day received a
 * `DateField` (the same `YYYY-MM-DD` the native box produced), and every button
 * is Material's. The receipt list, a receipt's lines, the lines being written
 * and the cost layers are Material's table — each read answers one page with a
 * "more exist" flag and no cursor is walked, so there is nothing for
 * `OperationalGrid`'s pager to do. The item finder, the location select and the
 * list's wait, empty and failed states are the shared inventory pieces
 * (`ItemFinder`, `LocationPicker`, `BranchListView`), drawn as those pieces
 * draw. What is read, sent, authorized and refused is unchanged, and so is who
 * sees a cost.
 */

import { useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';

import { DateField, type DayProblem } from '@/components/forms/mui/DateField';
import { FormNumberField } from '@/components/forms/mui/FormNumberField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { formatMoney } from '@/lib/money';
import type { GoodsReceiptCreateLine } from '@/lib/contracts/inventory-contract';

import {
  createGoodsReceipt,
  listGoodsReceipts,
  postGoodsReceipt,
  readGoodsReceipt,
  readItemCostHistory,
} from '../api';
import {
  CURRENCY_CODE,
  ISO_DATE,
  LOCATION_CODE,
  MAX_DESCRIPTION,
  MAX_NAME,
  UNIT_COST,
  type GoodsReceiptDetail,
  type GoodsReceiptSummary,
  type InventoryItem,
  type ItemCostHistory,
  type StockTarget,
} from '../inventory-contract';
import { LocationPicker, OutcomeNote, Qty, useLocations, type Locations } from './shared';
import {
  BranchListView,
  BranchTargetForm,
  Fact,
  ItemFinder,
  PANEL,
  StockMoment,
  StockOperationLinks,
  isQuantity,
  outcomeField,
  useBranchList,
  useStockDisplayZone,
} from './stock-operations';

/** A line being written, before it is sent. */
interface DraftLine {
  readonly key: string;
  readonly item: InventoryItem;
  readonly locationId: string;
  readonly locationCode: string;
  readonly quantity: string;
  readonly unitCost: string;
  readonly currencyCode: string;
}

function detailFailureKey(status: string): string {
  if (status === 'denied') return 'inventory.receipts.detail.refused';
  if (status === 'not-found') return 'inventory.receipts.detail.gone';
  if (status === 'expired') return 'state.expired.message';
  return 'inventory.receipts.detail.unavailable';
}

export function GoodsReceiptsScreen({
  locale,
  messages,
  canOperate,
  canViewCost,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** `inv.stock.operate` — creating and posting receipts. */
  readonly canOperate: boolean;
  /** `inv.cost.view` — unit costs on lines, and the cost history. */
  readonly canViewCost: boolean;
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
        {translate(messages, 'inventory.receipts.explain')}
      </p>
      {!canOperate ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.receipts.needsOperate')}
        </p>
      ) : null}
      <BranchTargetForm
        messages={messages}
        formLabelKey="inventory.receipts.targetLabel"
        explainKey="inventory.target.explain"
        onChosen={setTarget}
      />
      {target !== null ? (
        <BranchReceipts
          key={`${target.companyId}:${target.branchId}`}
          locale={locale}
          messages={messages}
          target={target}
          canOperate={canOperate}
          canViewCost={canViewCost}
        />
      ) : null}
    </div>
  );
}

function BranchReceipts({
  locale,
  messages,
  target,
  canOperate,
  canViewCost,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: StockTarget;
  readonly canOperate: boolean;
  readonly canViewCost: boolean;
}) {
  const { list, reload } = useBranchList<GoodsReceiptSummary>(
    target,
    listGoodsReceipts,
    'inventory.receipts.list.refused',
    'inventory.receipts.list.unavailable'
  );
  const locations = useLocations(target);
  // A receipt's posting is written on the branch's clock, named (`P1-32-PRE-OD-INV5`).
  const zone = useStockDisplayZone(target);
  const [receipt, setReceipt] = useState<GoodsReceiptDetail | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [openFailure, setOpenFailure] = useState<string | null>(null);
  const [costItem, setCostItem] = useState<{ id: string; sku: string } | null>(null);

  const open = async (receiptId: string) => {
    setOpening(receiptId);
    setOpenFailure(null);
    const state = await readGoodsReceipt(receiptId);
    setOpening(null);
    if (state.status !== 'ok') {
      setOpenFailure(detailFailureKey(state.status));
      return;
    }
    setReceipt(state.data);
  };

  return (
    <>
      <section aria-labelledby="receipts-list-heading" className={PANEL}>
        <h2 id="receipts-list-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'inventory.receipts.list.heading')}
        </h2>
        {openFailure !== null ? (
          <Alert severity="error" role="alert" variant="outlined">
            {translateDynamic(messages, openFailure)}
          </Alert>
        ) : null}
        <BranchListView
          messages={messages}
          locale={locale}
          list={list}
          loadingKey="inventory.receipts.list.loading"
          noneKey="inventory.receipts.list.none"
          truncatedKey="inventory.receipts.list.truncated"
        >
          {(items) => (
            <TableContainer>
              <Table size="small">
                <caption className="sr-only">
                  {translate(messages, 'inventory.receipts.list.caption')}
                </caption>
                <TableHead>
                  <TableRow>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.receipts.column.reference')}
                    </TableCell>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.receipts.column.supplier')}
                    </TableCell>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.receipts.column.receivedOn')}
                    </TableCell>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.receipts.column.status')}
                    </TableCell>
                    <TableCell scope="col" align="right">
                      {translate(messages, 'inventory.receipts.column.lines')}
                    </TableCell>
                    <TableCell scope="col" align="right">
                      {translate(messages, 'inventory.receipts.column.action')}
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <span dir="ltr">
                          {row.reference ?? translate(messages, 'inventory.receipts.noReference')}
                        </span>
                      </TableCell>
                      <TableCell>{row.supplierReference ?? ''}</TableCell>
                      <TableCell>
                        <span dir="ltr">{row.receivedOn}</span>
                      </TableCell>
                      <TableCell>
                        {translateDynamic(messages, `inventory.receiptStatus.${row.status}`)}
                      </TableCell>
                      <TableCell align="right">{row.lineCount}</TableCell>
                      <TableCell align="right">
                        <Button
                          type="button"
                          variant="outlined"
                          size="small"
                          disabled={opening !== null}
                          onClick={() => {
                            void open(row.id);
                          }}
                        >
                          {translate(messages, 'inventory.receipts.open')}
                          <span className="sr-only"> {row.reference ?? row.receivedOn}</span>
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

      {receipt !== null ? (
        <ReceiptDetail
          key={`${receipt.id}:${receipt.recordVersion}`}
          locale={locale}
          messages={messages}
          receipt={receipt}
          zone={zone}
          canOperate={canOperate}
          canViewCost={canViewCost}
          onPosted={(posted) => {
            setReceipt(posted);
            reload();
          }}
          onClose={() => setReceipt(null)}
          onCostHistory={(line) => setCostItem({ id: line.itemId, sku: line.sku })}
        />
      ) : null}

      {canViewCost && costItem !== null ? (
        <CostHistoryPanel
          key={costItem.id}
          locale={locale}
          messages={messages}
          target={target}
          itemId={costItem.id}
          sku={costItem.sku}
          onClose={() => setCostItem(null)}
        />
      ) : null}

      {canOperate ? (
        <ReceiptForm
          messages={messages}
          target={target}
          locations={locations}
          canViewCost={canViewCost}
          onCreated={(created) => {
            setReceipt(created);
            reload();
          }}
        />
      ) : null}
    </>
  );
}

function ReceiptDetail({
  locale,
  messages,
  receipt,
  zone,
  canOperate,
  canViewCost,
  onPosted,
  onClose,
  onCostHistory,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly receipt: GoodsReceiptDetail;
  /** The branch's clock (`useStockDisplayZone`), UTC where it is not known. */
  readonly zone: string;
  readonly canOperate: boolean;
  readonly canViewCost: boolean;
  readonly onPosted: (posted: GoodsReceiptDetail) => void;
  readonly onClose: () => void;
  readonly onCostHistory: (line: { itemId: string; sku: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  // One posting in flight at a time, before `busy` has disabled the button.
  const sending = useRef(false);

  const post = async () => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    // The version the server last answered for THIS receipt, never a guess.
    const result = await postGoodsReceipt(receipt.id, receipt.recordVersion);
    sending.current = false;
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) onPosted(result.created);
  };

  return (
    <section aria-labelledby="receipt-detail-heading" className={PANEL}>
      <h2 id="receipt-detail-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.receipts.detail.heading')}{' '}
        <span dir="ltr">{receipt.reference ?? receipt.receivedOn}</span>
      </h2>
      <dl className="grid gap-2 sm:grid-cols-3">
        <Fact label={translate(messages, 'inventory.receipts.column.status')}>
          {translateDynamic(messages, `inventory.receiptStatus.${receipt.status}`)}
        </Fact>
        <Fact label={translate(messages, 'inventory.receipts.column.receivedOn')}>
          <span dir="ltr">{receipt.receivedOn}</span>
        </Fact>
        <Fact label={translate(messages, 'inventory.receipts.detail.postedAt')}>
          {receipt.postedAt === null ? (
            translate(messages, 'inventory.receipts.detail.notPosted')
          ) : (
            <StockMoment value={receipt.postedAt} locale={locale} zone={zone} />
          )}
        </Fact>
      </dl>
      {receipt.notes ? <p className="text-caption text-text-muted">{receipt.notes}</p> : null}
      <TableContainer>
        <Table size="small">
          <caption className="sr-only">
            {translate(messages, 'inventory.receipts.detail.caption')}
          </caption>
          <TableHead>
            <TableRow>
              <TableCell scope="col">
                {translate(messages, 'inventory.receipts.line.item')}
              </TableCell>
              <TableCell scope="col">
                {translate(messages, 'inventory.receipts.line.location')}
              </TableCell>
              <TableCell scope="col" align="right">
                {translate(messages, 'inventory.receipts.line.quantity')}
              </TableCell>
              <TableCell scope="col">
                {translate(messages, 'inventory.receipts.line.priced')}
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {receipt.lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell>
                  <code className="font-mono text-caption" dir="ltr">
                    {line.sku}
                  </code>
                </TableCell>
                <TableCell>
                  <span dir="ltr">{line.locationCode}</span>
                </TableCell>
                <TableCell align="right">
                  <Qty value={line.quantity} />
                </TableCell>
                <TableCell>
                  {translate(
                    messages,
                    line.hasUnitCost
                      ? 'inventory.receipts.line.pricedYes'
                      : 'inventory.receipts.line.pricedNo'
                  )}
                  {canViewCost ? (
                    <>
                      {' '}
                      <Button
                        type="button"
                        variant="text"
                        size="small"
                        onClick={() => onCostHistory(line)}
                      >
                        {translate(messages, 'inventory.receipts.costHistory.show')}
                        <span className="sr-only"> {line.sku}</span>
                      </Button>
                    </>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {receipt.status === 'draft' ? (
        canOperate ? (
          <>
            <p className="text-caption text-text-muted">
              {translate(messages, 'inventory.receipts.post.explain')}
            </p>
            <OutcomeNote messages={messages} outcome={outcome} />
            <div>
              <Button
                type="button"
                variant="contained"
                disabled={busy}
                onClick={() => {
                  void post();
                }}
              >
                {translate(messages, 'inventory.receipts.post.action')}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-caption text-text-muted">
            {translate(messages, 'inventory.receipts.needsOperate')}
          </p>
        )
      ) : null}
      {receipt.status === 'posted' ? (
        <p className="text-body text-text-primary">
          {translate(messages, 'inventory.receipts.post.posted')}
        </p>
      ) : null}
      <div>
        <Button type="button" variant="outlined" onClick={onClose}>
          {translate(messages, 'inventory.stockOps.close')}
        </Button>
      </div>
    </section>
  );
}

function ReceiptForm({
  messages,
  target,
  locations,
  canViewCost,
  onCreated,
}: {
  readonly messages: Messages;
  readonly target: StockTarget;
  readonly locations: Locations;
  readonly canViewCost: boolean;
  readonly onCreated: (receipt: GoodsReceiptDetail) => void;
}) {
  const [header, setHeader] = useState({
    reference: '',
    supplierReference: '',
    receivedOn: '',
    notes: '',
  });
  const [lines, setLines] = useState<readonly DraftLine[]>([]);
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [line, setLine] = useState({
    locationId: '',
    quantity: '',
    unitCost: '',
    currencyCode: '',
  });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());
  /*
   * A day received only partly typed holds no day — its value stays `''`, as for
   * a field nobody touched — so the picker's own report is kept: it is refused
   * as a date, not as a missing one, and it is unsaved work.
   */
  const [dayUnfinished, setDayUnfinished] = useState(false);
  // One receipt sent at a time, before `busy` has disabled the button.
  const sending = useRef(false);

  /*
   * Unsaved work, declared to the shell. The receipt is addressed to THIS
   * branch and its lines name this branch's locations, so a switch asks first;
   * a confirmed switch remounts the form empty under the new branch. The
   * chosen location and currency are not counted: they survive a successful
   * create on purpose, as defaults for the next receipt, and a guard that is
   * dirty after every save asks about every switch.
   */
  useUnsavedGuard(
    dayUnfinished ||
      lines.length > 0 ||
      item !== null ||
      line.quantity.trim().length > 0 ||
      line.unitCost.trim().length > 0 ||
      Object.values(header).some((value) => value.trim().length > 0)
  );

  const errorFor = (name: string) =>
    errors[name] ? translateDynamic(messages, errors[name]) : outcomeField(messages, outcome, name);

  const addLine = () => {
    const found: Record<string, string> = {};
    if (item === null) found['itemId'] = 'field.required';
    if (!line.locationId) found['locationId'] = 'field.required';
    const quantity = line.quantity.trim();
    if (!isQuantity(quantity)) found['quantity'] = 'inventory.stockOps.quantityFormat';
    const unitCost = canViewCost ? line.unitCost.trim() : '';
    const currencyCode = canViewCost ? line.currencyCode.trim().toUpperCase() : '';
    if (unitCost.length > 0 && !UNIT_COST.test(unitCost)) {
      found['unitCost'] = 'inventory.receipts.line.unitCostFormat';
    }
    if (unitCost.length > 0 !== currencyCode.length > 0) {
      found['currencyCode'] = 'inventory.receipts.line.costTogether';
    } else if (currencyCode.length > 0 && !CURRENCY_CODE.test(currencyCode)) {
      found['currencyCode'] = 'inventory.receipts.line.currencyFormat';
    }
    setErrors(found);
    if (Object.keys(found).length > 0 || item === null) return;
    const location = locations.items?.find((row) => row.id === line.locationId);
    setLines((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        item,
        locationId: line.locationId,
        locationCode: location?.locationCode ?? line.locationId,
        quantity,
        unitCost,
        currencyCode,
      },
    ]);
    setItem(null);
    setLine((current) => ({ ...current, quantity: '', unitCost: '' }));
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    const receivedOn = header.receivedOn.trim();
    if (dayUnfinished || (receivedOn.length > 0 && !ISO_DATE.test(receivedOn))) {
      found['receivedOn'] = 'inventory.opening.batch.dateFormat';
    } else if (receivedOn.length === 0) found['receivedOn'] = 'field.required';
    const reference = header.reference.trim();
    if (reference.length > 0 && !LOCATION_CODE.test(reference)) {
      found['reference'] = 'inventory.receipts.referenceFormat';
    }
    const supplierReference = header.supplierReference.trim();
    if (supplierReference.length > MAX_NAME)
      found['supplierReference'] = 'inventory.stockOps.tooLong';
    const notes = header.notes.trim();
    if (notes.length > MAX_DESCRIPTION) found['notes'] = 'inventory.setup.descriptionTooLong';
    if (lines.length === 0) found['lines'] = 'inventory.receipts.noLines';
    setErrors(found);
    if (Object.keys(found).length > 0 || sending.current) return;

    const body: GoodsReceiptCreateLine[] = lines.map((draft) => ({
      itemId: draft.item.id,
      locationId: draft.locationId,
      quantity: draft.quantity,
      ...(draft.unitCost.length > 0
        ? { unitCost: draft.unitCost, currencyCode: draft.currencyCode }
        : {}),
    }));
    sending.current = true;
    setBusy(true);
    const result = await createGoodsReceipt({
      companyId: target.companyId,
      branchId: target.branchId,
      receivedOn,
      idempotencyKey: attemptKey,
      lines: body,
      ...(reference.length > 0 ? { reference } : {}),
      ...(supplierReference.length > 0 ? { supplierReference } : {}),
      ...(notes.length > 0 ? { notes } : {}),
    });
    sending.current = false;
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      setHeader({ reference: '', supplierReference: '', receivedOn: '', notes: '' });
      setLines([]);
      setOutcome(null);
      setAttemptKey(crypto.randomUUID());
      onCreated(result.created);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="receipt-create-heading"
      className={PANEL}
    >
      <h2 id="receipt-create-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.receipts.create.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.receipts.create.explain')}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {/*
          A calendar day on the MIT date picker (ADR-022, E1-E4): the value is
          the same `YYYY-MM-DD` the native box produced and the route accepts.
        */}
        <DateField
          label={translate(messages, 'inventory.receipts.create.receivedOn')}
          required
          value={header.receivedOn}
          onChange={(next) => setHeader((h) => ({ ...h, receivedOn: next }))}
          onProblem={(problem: DayProblem) => setDayUnfinished(problem === 'incomplete')}
          error={errorFor('receivedOn')}
        />
        <FormTextField
          label={translate(messages, 'inventory.receipts.create.reference')}
          description={translate(messages, 'inventory.receipts.create.referenceHelp')}
          spellCheck={false}
          dir="ltr"
          value={header.reference}
          onChange={(next) => setHeader((h) => ({ ...h, reference: next }))}
          error={errorFor('reference')}
        />
        <FormTextField
          label={translate(messages, 'inventory.receipts.create.supplier')}
          value={header.supplierReference}
          onChange={(next) => setHeader((h) => ({ ...h, supplierReference: next }))}
          error={errorFor('supplierReference')}
        />
      </div>
      <FormTextField
        label={translate(messages, 'inventory.receipts.create.notes')}
        multiline
        rows={2}
        value={header.notes}
        onChange={(next) => setHeader((h) => ({ ...h, notes: next }))}
        error={errorFor('notes')}
      />

      <fieldset className="flex flex-col gap-3 border-t border-border pt-3">
        <legend className="text-label font-medium text-text-primary">
          {translate(messages, 'inventory.receipts.line.heading')}
        </legend>
        <ItemFinder
          messages={messages}
          idPrefix="receipt"
          value={item}
          onChange={setItem}
          error={errorFor('itemId')}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <LocationPicker
            messages={messages}
            locations={locations}
            label={translate(messages, 'inventory.receipts.line.location')}
            placeholder={translate(messages, 'inventory.stockOps.chooseLocation')}
            required
            value={line.locationId}
            onChange={(next) => setLine((l) => ({ ...l, locationId: next }))}
            error={errorFor('locationId')}
          />
          <FormNumberField
            label={translate(messages, 'inventory.receipts.line.quantity')}
            description={translate(messages, 'inventory.stockOps.quantityHelp')}
            required
            value={line.quantity}
            onChange={(next) => setLine((l) => ({ ...l, quantity: next }))}
            error={errorFor('quantity')}
          />
        </div>
        {canViewCost ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {/*
              `FormNumberField`, not the money field: a unit cost carries up to
              four decimals and is sent exactly as typed, never canonicalised to
              the currency's minor unit (the currency is typed beside it).
            */}
            <FormNumberField
              label={translate(messages, 'inventory.receipts.line.unitCost')}
              description={translate(messages, 'inventory.receipts.line.unitCostHelp')}
              value={line.unitCost}
              onChange={(next) => setLine((l) => ({ ...l, unitCost: next }))}
              error={errorFor('unitCost')}
            />
            <FormTextField
              label={translate(messages, 'inventory.receipts.line.currency')}
              spellCheck={false}
              dir="ltr"
              value={line.currencyCode}
              onChange={(next) => setLine((l) => ({ ...l, currencyCode: next }))}
              error={errorFor('currencyCode')}
            />
          </div>
        ) : (
          <p className="text-caption text-text-muted">
            {translate(messages, 'inventory.receipts.line.costHidden')}
          </p>
        )}
        <div>
          <Button type="button" variant="outlined" onClick={addLine}>
            {translate(messages, 'inventory.receipts.line.add')}
          </Button>
        </div>
      </fieldset>

      {lines.length > 0 ? (
        <TableContainer>
          <Table size="small">
            <caption className="sr-only">
              {translate(messages, 'inventory.receipts.create.linesCaption')}
            </caption>
            <TableHead>
              <TableRow>
                <TableCell scope="col">
                  {translate(messages, 'inventory.receipts.line.item')}
                </TableCell>
                <TableCell scope="col">
                  {translate(messages, 'inventory.receipts.line.location')}
                </TableCell>
                <TableCell scope="col" align="right">
                  {translate(messages, 'inventory.receipts.line.quantity')}
                </TableCell>
                {canViewCost ? (
                  <TableCell scope="col" align="right">
                    {translate(messages, 'inventory.receipts.line.unitCost')}
                  </TableCell>
                ) : null}
                <TableCell scope="col" align="right">
                  {translate(messages, 'inventory.receipts.column.action')}
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.map((draft) => (
                <TableRow key={draft.key}>
                  <TableCell>
                    <span dir="ltr">{draft.item.sku}</span> — {draft.item.name}
                  </TableCell>
                  <TableCell>
                    <span dir="ltr">{draft.locationCode}</span>
                  </TableCell>
                  <TableCell align="right">
                    <Qty value={draft.quantity} />
                  </TableCell>
                  {canViewCost ? (
                    <TableCell align="right">
                      <span dir="ltr">
                        {draft.unitCost.length > 0 ? `${draft.unitCost} ${draft.currencyCode}` : ''}
                      </span>
                    </TableCell>
                  ) : null}
                  <TableCell align="right">
                    <Button
                      type="button"
                      variant="outlined"
                      size="small"
                      onClick={() =>
                        setLines((current) => current.filter((row) => row.key !== draft.key))
                      }
                    >
                      {translate(messages, 'inventory.receipts.line.remove')}
                      <span className="sr-only"> {draft.item.sku}</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <p className={errors['lines'] ? 'text-body text-error' : 'text-caption text-text-muted'}>
          {translate(messages, 'inventory.receipts.noLines')}
        </p>
      )}
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <Button type="submit" variant="contained" disabled={busy}>
          {translate(messages, 'inventory.receipts.create.submit')}
        </Button>
      </div>
    </form>
  );
}

function CostHistoryPanel({
  locale,
  messages,
  target,
  itemId,
  sku,
  onClose,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: StockTarget;
  readonly itemId: string;
  readonly sku: string;
  readonly onClose: () => void;
}) {
  const [history, setHistory] = useState<ItemCostHistory | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const { companyId, branchId } = target;
  // Each layer's moment is written on the branch's clock, named (`P1-32-PRE-OD-INV5`).
  const zone = useStockDisplayZone(target);

  // Read once per item (the caller keys this panel on the item). The pair is
  // keyed on its VALUES, so a caller rebuilding the target does not re-read.
  useEffect(() => {
    let live = true;
    void readItemCostHistory(itemId, { companyId, branchId }).then((state) => {
      if (!live) return;
      if (state.status === 'ok') {
        setHistory(state.data);
        return;
      }
      setFailure(
        state.status === 'denied'
          ? 'inventory.receipts.costHistory.refused'
          : state.status === 'expired'
            ? 'state.expired.message'
            : 'inventory.receipts.costHistory.unavailable'
      );
    });
    return () => {
      live = false;
    };
  }, [itemId, companyId, branchId]);

  return (
    <section aria-labelledby="cost-history-heading" className={PANEL}>
      <h2 id="cost-history-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.receipts.costHistory.heading')}{' '}
        <code className="font-mono" dir="ltr">
          {sku}
        </code>
      </h2>
      {failure !== null ? (
        <Alert severity="error" role="alert" variant="outlined">
          {translateDynamic(messages, failure)}
        </Alert>
      ) : null}
      {history === null && failure === null ? (
        <p role="status" aria-live="polite" className="text-caption text-text-muted">
          {translate(messages, 'inventory.receipts.costHistory.loading')}
        </p>
      ) : null}
      {history !== null ? (
        <>
          <dl className="grid gap-2 sm:grid-cols-3">
            <Fact label={translate(messages, 'inventory.receipts.costHistory.latest')}>
              {history.latestUnitCost === null ? (
                translate(messages, 'inventory.receipts.costHistory.neverPriced')
              ) : (
                <span dir="ltr">
                  {costText(history.latestUnitCost, history.currencyCode, locale)}
                </span>
              )}
            </Fact>
            <Fact label={translate(messages, 'inventory.receipts.costHistory.average')}>
              {history.weightedAverageCost !== null ? (
                <span dir="ltr">
                  {costText(history.weightedAverageCost, history.currencyCode, locale)}
                </span>
              ) : history.mixedCurrencies ? (
                translate(messages, 'inventory.receipts.costHistory.mixed')
              ) : (
                translate(messages, 'inventory.receipts.costHistory.neverPriced')
              )}
            </Fact>
            <Fact label={translate(messages, 'inventory.receipts.costHistory.quantity')}>
              <Qty value={history.totalQuantity} />
            </Fact>
          </dl>
          {history.layers.items.length > 0 ? (
            <TableContainer>
              <Table size="small">
                <caption className="sr-only">
                  {translate(messages, 'inventory.receipts.costHistory.caption')}
                </caption>
                <TableHead>
                  <TableRow>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.receipts.costHistory.when')}
                    </TableCell>
                    <TableCell scope="col" align="right">
                      {translate(messages, 'inventory.receipts.line.quantity')}
                    </TableCell>
                    <TableCell scope="col" align="right">
                      {translate(messages, 'inventory.receipts.line.unitCost')}
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {history.layers.items.map((layer) => (
                    <TableRow key={layer.id}>
                      <TableCell>
                        <StockMoment value={layer.effectiveAt} locale={locale} zone={zone} />
                      </TableCell>
                      <TableCell align="right">
                        <Qty value={layer.quantity} />
                      </TableCell>
                      <TableCell align="right">
                        <span dir="ltr">
                          {formatMoney(
                            { amount: layer.unitCost, currency: layer.currencyCode },
                            locale
                          )}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : null}
          {history.layers.hasMore ? (
            <p className="text-caption text-text-muted">
              {translate(messages, 'inventory.receipts.costHistory.truncated')}
            </p>
          ) : null}
        </>
      ) : null}
      <div>
        <Button type="button" variant="outlined" onClick={onClose}>
          {translate(messages, 'inventory.stockOps.close')}
        </Button>
      </div>
    </section>
  );
}

/**
 * A cost, through the one money formatter when its currency is known (GAP-15):
 * written with the currency's own minor unit, and never rounded below it. A cost
 * whose currency the server did not state is shown as the server sent it.
 */
function costText(amount: string, currency: string | null, locale: Locale): string {
  return currency === null ? amount : formatMoney({ amount, currency }, locale);
}
