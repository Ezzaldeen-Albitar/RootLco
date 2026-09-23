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
 */

import { useEffect, useState } from 'react';

import { TextAreaField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { formatDateTime } from '@/lib/format';
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
import {
  LocationPicker,
  OutcomeNote,
  PRIMARY_BUTTON,
  Qty,
  SECONDARY_BUTTON,
  useLocations,
  type Locations,
} from './shared';
import {
  BranchListView,
  BranchTargetForm,
  Fact,
  ItemFinder,
  PANEL,
  StockOperationLinks,
  isQuantity,
  outcomeField,
  useBranchList,
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
          <p role="alert" className="text-body text-error">
            {translateDynamic(messages, openFailure)}
          </p>
        ) : null}
        <BranchListView
          messages={messages}
          list={list}
          loadingKey="inventory.receipts.list.loading"
          noneKey="inventory.receipts.list.none"
          truncatedKey="inventory.receipts.list.truncated"
        >
          {(items) => (
            <table className="w-full text-body">
              <caption className="sr-only">
                {translate(messages, 'inventory.receipts.list.caption')}
              </caption>
              <thead>
                <tr className="text-caption text-text-muted">
                  <th scope="col" className="text-start font-medium">
                    {translate(messages, 'inventory.receipts.column.reference')}
                  </th>
                  <th scope="col" className="text-start font-medium">
                    {translate(messages, 'inventory.receipts.column.supplier')}
                  </th>
                  <th scope="col" className="text-start font-medium">
                    {translate(messages, 'inventory.receipts.column.receivedOn')}
                  </th>
                  <th scope="col" className="text-start font-medium">
                    {translate(messages, 'inventory.receipts.column.status')}
                  </th>
                  <th scope="col" className="text-end font-medium">
                    {translate(messages, 'inventory.receipts.column.lines')}
                  </th>
                  <th scope="col" className="text-end font-medium">
                    {translate(messages, 'inventory.receipts.column.action')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td dir="ltr" className="text-start">
                      {row.reference ?? translate(messages, 'inventory.receipts.noReference')}
                    </td>
                    <td>{row.supplierReference ?? ''}</td>
                    <td dir="ltr" className="text-start">
                      {row.receivedOn}
                    </td>
                    <td>{translateDynamic(messages, `inventory.receiptStatus.${row.status}`)}</td>
                    <td className="text-end">{row.lineCount}</td>
                    <td className="text-end">
                      <button
                        type="button"
                        className={SECONDARY_BUTTON}
                        disabled={opening !== null}
                        onClick={() => {
                          void open(row.id);
                        }}
                      >
                        {translate(messages, 'inventory.receipts.open')}
                        <span className="sr-only"> {row.reference ?? row.receivedOn}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </BranchListView>
      </section>

      {receipt !== null ? (
        <ReceiptDetail
          key={`${receipt.id}:${receipt.recordVersion}`}
          locale={locale}
          messages={messages}
          receipt={receipt}
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
  canOperate,
  canViewCost,
  onPosted,
  onClose,
  onCostHistory,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly receipt: GoodsReceiptDetail;
  readonly canOperate: boolean;
  readonly canViewCost: boolean;
  readonly onPosted: (posted: GoodsReceiptDetail) => void;
  readonly onClose: () => void;
  readonly onCostHistory: (line: { itemId: string; sku: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const post = async () => {
    setBusy(true);
    // The version the server last answered for THIS receipt, never a guess.
    const result = await postGoodsReceipt(receipt.id, receipt.recordVersion);
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
            <span dir="ltr">{formatDateTime(receipt.postedAt, locale)}</span>
          )}
        </Fact>
      </dl>
      {receipt.notes ? <p className="text-caption text-text-muted">{receipt.notes}</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full text-body">
          <caption className="sr-only">
            {translate(messages, 'inventory.receipts.detail.caption')}
          </caption>
          <thead>
            <tr className="text-caption text-text-muted">
              <th scope="col" className="text-start font-medium">
                {translate(messages, 'inventory.receipts.line.item')}
              </th>
              <th scope="col" className="text-start font-medium">
                {translate(messages, 'inventory.receipts.line.location')}
              </th>
              <th scope="col" className="text-end font-medium">
                {translate(messages, 'inventory.receipts.line.quantity')}
              </th>
              <th scope="col" className="text-start font-medium">
                {translate(messages, 'inventory.receipts.line.priced')}
              </th>
            </tr>
          </thead>
          <tbody>
            {receipt.lines.map((line) => (
              <tr key={line.id} className="border-t border-border">
                <td>
                  <code className="font-mono text-caption" dir="ltr">
                    {line.sku}
                  </code>
                </td>
                <td dir="ltr" className="text-start">
                  {line.locationCode}
                </td>
                <td className="text-end">
                  <Qty value={line.quantity} />
                </td>
                <td>
                  {translate(
                    messages,
                    line.hasUnitCost
                      ? 'inventory.receipts.line.pricedYes'
                      : 'inventory.receipts.line.pricedNo'
                  )}
                  {canViewCost ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="text-caption text-primary underline-offset-2 hover:underline"
                        onClick={() => onCostHistory(line)}
                      >
                        {translate(messages, 'inventory.receipts.costHistory.show')}
                        <span className="sr-only"> {line.sku}</span>
                      </button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {receipt.status === 'draft' ? (
        canOperate ? (
          <>
            <p className="text-caption text-text-muted">
              {translate(messages, 'inventory.receipts.post.explain')}
            </p>
            <OutcomeNote messages={messages} outcome={outcome} />
            <div>
              <button
                type="button"
                className={PRIMARY_BUTTON}
                disabled={busy}
                onClick={() => {
                  void post();
                }}
              >
                {translate(messages, 'inventory.receipts.post.action')}
              </button>
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
        <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
          {translate(messages, 'inventory.stockOps.close')}
        </button>
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
   * Unsaved work, declared to the shell. The receipt is addressed to THIS
   * branch and its lines name this branch's locations, so a switch asks first;
   * a confirmed switch remounts the form empty under the new branch. The
   * chosen location and currency are not counted: they survive a successful
   * create on purpose, as defaults for the next receipt, and a guard that is
   * dirty after every save asks about every switch.
   */
  useUnsavedGuard(
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
    if (receivedOn.length === 0) found['receivedOn'] = 'field.required';
    else if (!ISO_DATE.test(receivedOn)) found['receivedOn'] = 'inventory.opening.batch.dateFormat';
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
    if (Object.keys(found).length > 0) return;

    const body: GoodsReceiptCreateLine[] = lines.map((draft) => ({
      itemId: draft.item.id,
      locationId: draft.locationId,
      quantity: draft.quantity,
      ...(draft.unitCost.length > 0
        ? { unitCost: draft.unitCost, currencyCode: draft.currencyCode }
        : {}),
    }));
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
        <TextField
          label={translate(messages, 'inventory.receipts.create.receivedOn')}
          required
          type="date"
          dir="ltr"
          value={header.receivedOn}
          onChange={(event) => setHeader((h) => ({ ...h, receivedOn: event.target.value }))}
          error={errorFor('receivedOn')}
        />
        <TextField
          label={translate(messages, 'inventory.receipts.create.reference')}
          description={translate(messages, 'inventory.receipts.create.referenceHelp')}
          spellCheck={false}
          dir="ltr"
          value={header.reference}
          onChange={(event) => setHeader((h) => ({ ...h, reference: event.target.value }))}
          error={errorFor('reference')}
        />
        <TextField
          label={translate(messages, 'inventory.receipts.create.supplier')}
          value={header.supplierReference}
          onChange={(event) => setHeader((h) => ({ ...h, supplierReference: event.target.value }))}
          error={errorFor('supplierReference')}
        />
      </div>
      <TextAreaField
        label={translate(messages, 'inventory.receipts.create.notes')}
        rows={2}
        value={header.notes}
        onChange={(event) => setHeader((h) => ({ ...h, notes: event.target.value }))}
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
          <TextField
            label={translate(messages, 'inventory.receipts.line.quantity')}
            description={translate(messages, 'inventory.stockOps.quantityHelp')}
            required
            inputMode="decimal"
            dir="ltr"
            value={line.quantity}
            onChange={(event) => setLine((l) => ({ ...l, quantity: event.target.value }))}
            error={errorFor('quantity')}
          />
        </div>
        {canViewCost ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label={translate(messages, 'inventory.receipts.line.unitCost')}
              description={translate(messages, 'inventory.receipts.line.unitCostHelp')}
              inputMode="decimal"
              dir="ltr"
              value={line.unitCost}
              onChange={(event) => setLine((l) => ({ ...l, unitCost: event.target.value }))}
              error={errorFor('unitCost')}
            />
            <TextField
              label={translate(messages, 'inventory.receipts.line.currency')}
              spellCheck={false}
              dir="ltr"
              value={line.currencyCode}
              onChange={(event) => setLine((l) => ({ ...l, currencyCode: event.target.value }))}
              error={errorFor('currencyCode')}
            />
          </div>
        ) : (
          <p className="text-caption text-text-muted">
            {translate(messages, 'inventory.receipts.line.costHidden')}
          </p>
        )}
        <div>
          <button type="button" className={SECONDARY_BUTTON} onClick={addLine}>
            {translate(messages, 'inventory.receipts.line.add')}
          </button>
        </div>
      </fieldset>

      {lines.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <caption className="sr-only">
              {translate(messages, 'inventory.receipts.create.linesCaption')}
            </caption>
            <thead>
              <tr className="text-caption text-text-muted">
                <th scope="col" className="text-start font-medium">
                  {translate(messages, 'inventory.receipts.line.item')}
                </th>
                <th scope="col" className="text-start font-medium">
                  {translate(messages, 'inventory.receipts.line.location')}
                </th>
                <th scope="col" className="text-end font-medium">
                  {translate(messages, 'inventory.receipts.line.quantity')}
                </th>
                {canViewCost ? (
                  <th scope="col" className="text-end font-medium">
                    {translate(messages, 'inventory.receipts.line.unitCost')}
                  </th>
                ) : null}
                <th scope="col" className="text-end font-medium">
                  {translate(messages, 'inventory.receipts.column.action')}
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((draft) => (
                <tr key={draft.key} className="border-t border-border">
                  <td>
                    <span dir="ltr">{draft.item.sku}</span> — {draft.item.name}
                  </td>
                  <td dir="ltr" className="text-start">
                    {draft.locationCode}
                  </td>
                  <td className="text-end">
                    <Qty value={draft.quantity} />
                  </td>
                  {canViewCost ? (
                    <td className="text-end" dir="ltr">
                      {draft.unitCost.length > 0 ? `${draft.unitCost} ${draft.currencyCode}` : ''}
                    </td>
                  ) : null}
                  <td className="text-end">
                    <button
                      type="button"
                      className={SECONDARY_BUTTON}
                      onClick={() =>
                        setLines((current) => current.filter((row) => row.key !== draft.key))
                      }
                    >
                      {translate(messages, 'inventory.receipts.line.remove')}
                      <span className="sr-only"> {draft.item.sku}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={errors['lines'] ? 'text-body text-error' : 'text-caption text-text-muted'}>
          {translate(messages, 'inventory.receipts.noLines')}
        </p>
      )}
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'inventory.receipts.create.submit')}
        </button>
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
        <p role="alert" className="text-body text-error">
          {translateDynamic(messages, failure)}
        </p>
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
                  {history.latestUnitCost} {history.currencyCode ?? ''}
                </span>
              )}
            </Fact>
            <Fact label={translate(messages, 'inventory.receipts.costHistory.average')}>
              {history.weightedAverageCost !== null ? (
                <span dir="ltr">
                  {history.weightedAverageCost} {history.currencyCode ?? ''}
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
            <div className="overflow-x-auto">
              <table className="w-full text-body">
                <caption className="sr-only">
                  {translate(messages, 'inventory.receipts.costHistory.caption')}
                </caption>
                <thead>
                  <tr className="text-caption text-text-muted">
                    <th scope="col" className="text-start font-medium">
                      {translate(messages, 'inventory.receipts.costHistory.when')}
                    </th>
                    <th scope="col" className="text-end font-medium">
                      {translate(messages, 'inventory.receipts.line.quantity')}
                    </th>
                    <th scope="col" className="text-end font-medium">
                      {translate(messages, 'inventory.receipts.line.unitCost')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {history.layers.items.map((layer) => (
                    <tr key={layer.id} className="border-t border-border">
                      <td dir="ltr" className="text-start">
                        {formatDateTime(layer.effectiveAt, locale)}
                      </td>
                      <td className="text-end">
                        <Qty value={layer.quantity} />
                      </td>
                      <td className="text-end" dir="ltr">
                        {layer.unitCost} {layer.currencyCode}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {history.layers.hasMore ? (
            <p className="text-caption text-text-muted">
              {translate(messages, 'inventory.receipts.costHistory.truncated')}
            </p>
          ) : null}
        </>
      ) : null}
      <div>
        <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
          {translate(messages, 'inventory.stockOps.close')}
        </button>
      </div>
    </section>
  );
}
