'use client';

/**
 * Opening stock — P1-30 W10, change-control CC-05: the only path by which
 * stock first appears in a fresh organisation, through the product.
 *
 * The chain is the server's and is walked in order: choose a branch, open a
 * batch (`inv.opening-batch-create`), add counted lines
 * (`inv.opening-batch-line-create`), and have a SECOND person approve it
 * (`inv.opening-batch-approve`), which posts the opening movements. After that
 * `/inventory` shows the balance and `/inventory/movements` the `opening`
 * rows.
 *
 * ## What the screen says because the API cannot
 *
 * No operation reads a batch back — there is no batch list and no batch
 * detail (register area C, line C-2). A batch therefore exists for this
 * screen only through the echoes of the writes that made it, and is gone from
 * view the moment the page is left, even though it persists on the server.
 * The screen states this beside the batch, shows the batch id so it can be
 * quoted, and offers approval on the same page.
 *
 * ## Maker ≠ checker
 *
 * The server refuses the person who counted the batch as its approver (409).
 * That refusal is rendered as published; the screen offers the approval to
 * whoever holds `inv.adjustment.approve` and says a second person is needed
 * when the refusal arrives. Nothing is computed here: quantities are the
 * exact decimal strings the operator typed and the server echoed.
 *
 * Permissions: `inv.stock.read` gates the page (the location list is that
 * read); `inv.stock.operate` offers the batch and line forms;
 * `inv.adjustment.approve` offers the approval; `org.branch.read` the branch
 * picker.
 */

import Link from 'next/link';
import { useState } from 'react';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { SelectField, TextAreaField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { approveOpeningBatch, createOpeningBatch, createOpeningBatchLine, listItems } from '../api';
import {
  ISO_DATE,
  LOCATION_CODE,
  MAX_DESCRIPTION,
  MAX_NAME,
  QUANTITY,
  type InventoryItem,
  type OpeningBatch,
  type OpeningBatchLine,
  type StockTarget,
} from '../inventory-contract';
import {
  BranchPairPicker,
  EMPTY_PAIR,
  LocationPicker,
  OutcomeNote,
  PRIMARY_BUTTON,
  Qty,
  SECONDARY_BUTTON,
  UUID,
  useBranches,
  useLocations,
  type BranchPair,
} from './shared';

const LINK = 'text-primary underline-offset-2 hover:underline';
const PANEL = 'flex flex-col gap-3 rounded-lg border border-border bg-surface p-4';

/** A line as the screen shows it: the server's echo plus the labels the operator chose it by. */
interface ShownLine {
  readonly line: OpeningBatchLine;
  readonly sku: string;
  readonly itemName: string;
  readonly locationCode: string;
}

export function OpeningStockScreen({
  locale,
  messages,
  canOperate,
  canApprove,
  canReadBranches,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** `inv.stock.operate` — opening a batch and adding lines. */
  readonly canOperate: boolean;
  /** `inv.adjustment.approve` — approving; the server still refuses the counter. */
  readonly canApprove: boolean;
  /** `org.branch.read` — whether a branch list is requested for the picker. */
  readonly canReadBranches: boolean;
}) {
  const branches = useBranches(canReadBranches);
  const [pair, setPair] = useState<BranchPair>(EMPTY_PAIR);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [target, setTarget] = useState<StockTarget | null>(null);
  const [batch, setBatch] = useState<OpeningBatch | null>(null);
  const [lines, setLines] = useState<readonly ShownLine[]>([]);
  const locations = useLocations(target);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const approved = batch !== null && batch.status === 'approved';

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <p className="text-caption" lang={locale}>
        <Link href={`/${locale}/inventory`} className={LINK}>
          {translate(messages, 'inventory.opening.backToInventory')}
        </Link>
        {' · '}
        <Link href={`/${locale}/inventory/setup`} className={LINK}>
          {translate(messages, 'inventory.links.setup')}
        </Link>
      </p>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.opening.explain')}
      </p>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.opening.noBatchRead')}
      </p>
      {!canOperate && !canApprove ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.opening.needsOperate')}
        </p>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const found: Record<string, string> = {};
          if (!UUID.test(pair.companyId.trim())) found['companyId'] = 'inventory.common.idFormat';
          if (!UUID.test(pair.branchId.trim())) found['branchId'] = 'inventory.common.idFormat';
          setErrors(found);
          if (Object.keys(found).length > 0) return;
          setBatch(null);
          setLines([]);
          setTarget({ companyId: pair.companyId.trim(), branchId: pair.branchId.trim() });
        }}
        noValidate
        aria-label={translate(messages, 'inventory.opening.targetLabel')}
        className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3"
      >
        <p className="text-caption text-text-muted sm:col-span-3">
          {translate(messages, 'inventory.opening.targetExplain')}
        </p>
        <BranchPairPicker
          messages={messages}
          branches={branches}
          label={translate(messages, 'inventory.target.branch')}
          placeholder={translate(messages, 'inventory.target.chooseBranch')}
          value={pair}
          onChange={setPair}
          errors={{ companyId: errorFor('companyId'), branchId: errorFor('branchId') }}
        />
        <div className="sm:col-span-3">
          <button type="submit" className={PRIMARY_BUTTON}>
            {translate(messages, 'inventory.opening.chooseBranch')}
          </button>
        </div>
      </form>

      {target !== null && batch === null && canOperate ? (
        <BatchForm messages={messages} target={target} onOpened={setBatch} />
      ) : null}

      {batch !== null ? (
        <section aria-labelledby="opening-batch-heading" className={PANEL}>
          <h2 id="opening-batch-heading" className="text-body font-medium text-text-primary">
            {translate(messages, 'inventory.opening.batch.heading')}
          </h2>
          <dl className="grid gap-2 text-body sm:grid-cols-3">
            <div>
              <dt className="text-caption text-text-muted">
                {translate(messages, 'inventory.opening.batch.code')}
              </dt>
              <dd dir="ltr" className="text-start">
                {batch.batchCode}
              </dd>
            </div>
            <div>
              <dt className="text-caption text-text-muted">
                {translate(messages, 'inventory.opening.batch.status')}
              </dt>
              <dd>{translateDynamic(messages, `inventory.opening.status.${batch.status}`)}</dd>
            </div>
            <div>
              <dt className="text-caption text-text-muted">
                {translate(messages, 'inventory.opening.batch.id')}
              </dt>
              <dd dir="ltr" className="text-start">
                {batch.id}
              </dd>
            </div>
          </dl>
          <p className="text-caption text-text-muted">
            {translate(messages, 'inventory.opening.batch.holdNote')}
          </p>
        </section>
      ) : null}

      {batch !== null && !approved && canOperate ? (
        <LineForm
          messages={messages}
          batch={batch}
          locations={locations}
          onAdded={(shown) => setLines((current) => [...current, shown])}
        />
      ) : null}

      {batch !== null ? (
        <section aria-labelledby="opening-lines-heading" className="flex flex-col gap-3">
          <h2 id="opening-lines-heading" className="text-body font-medium text-text-primary">
            {translate(messages, 'inventory.opening.lines.heading')}
          </h2>
          {lines.length === 0 ? (
            <p className="text-caption text-text-muted">
              {translate(messages, 'inventory.opening.lines.none')}
            </p>
          ) : (
            <table className="w-full text-body">
              <caption className="sr-only">
                {translate(messages, 'inventory.opening.lines.caption')}
              </caption>
              <thead>
                <tr className="text-caption text-text-muted">
                  <th scope="col" className="text-start font-medium">
                    {translate(messages, 'inventory.opening.lines.column.item')}
                  </th>
                  <th scope="col" className="text-start font-medium">
                    {translate(messages, 'inventory.opening.lines.column.location')}
                  </th>
                  <th scope="col" className="text-end font-medium">
                    {translate(messages, 'inventory.opening.lines.column.quantity')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((shown) => (
                  <tr key={shown.line.id}>
                    <td>
                      <span dir="ltr">{shown.sku}</span>
                      {' — '}
                      {shown.itemName}
                    </td>
                    <td dir="ltr" className="text-start">
                      {shown.locationCode}
                    </td>
                    <td className="text-end">
                      <Qty value={shown.line.quantity} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}

      {batch !== null && lines.length > 0 ? (
        <ApprovalPanel
          locale={locale}
          messages={messages}
          batch={batch}
          canApprove={canApprove}
          onApproved={setBatch}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Open a batch
 * ------------------------------------------------------------------ */

function BatchForm({
  messages,
  target,
  onOpened,
}: {
  readonly messages: Messages;
  readonly target: StockTarget;
  readonly onOpened: (batch: OpeningBatch) => void;
}) {
  const [form, setForm] = useState({ batchCode: '', asOfDate: '', notes: '' });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    const batchCode = form.batchCode.trim();
    if (batchCode.length === 0) found['batchCode'] = 'field.required';
    else if (!LOCATION_CODE.test(batchCode))
      found['batchCode'] = 'inventory.opening.batch.codeFormat';
    const asOfDate = form.asOfDate.trim();
    if (asOfDate.length === 0) found['asOfDate'] = 'field.required';
    else if (!ISO_DATE.test(asOfDate)) found['asOfDate'] = 'inventory.opening.batch.dateFormat';
    const notes = form.notes.trim();
    if (notes.length > MAX_DESCRIPTION) found['notes'] = 'inventory.setup.descriptionTooLong';
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await createOpeningBatch({
      companyId: target.companyId,
      branchId: target.branchId,
      batchCode,
      asOfDate,
      ...(notes.length > 0 ? { notes } : {}),
    });
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) onOpened(result.created);
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="opening-batch-create-heading"
      className={PANEL}
    >
      <h2 id="opening-batch-create-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.opening.batch.new')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.opening.batch.explain')}
      </p>
      <TextField
        label={translate(messages, 'inventory.opening.batch.code')}
        description={translate(messages, 'inventory.opening.batch.codeHelp')}
        required
        spellCheck={false}
        dir="ltr"
        value={form.batchCode}
        onChange={(event) => setForm((f) => ({ ...f, batchCode: event.target.value }))}
        error={errorFor('batchCode')}
      />
      <TextField
        label={translate(messages, 'inventory.opening.batch.asOfDate')}
        description={translate(messages, 'inventory.opening.batch.asOfDateHelp')}
        required
        type="date"
        dir="ltr"
        value={form.asOfDate}
        onChange={(event) => setForm((f) => ({ ...f, asOfDate: event.target.value }))}
        error={errorFor('asOfDate')}
      />
      <TextAreaField
        label={translate(messages, 'inventory.opening.batch.notes')}
        rows={2}
        value={form.notes}
        onChange={(event) => setForm((f) => ({ ...f, notes: event.target.value }))}
        error={errorFor('notes')}
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'inventory.opening.batch.open')}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Add a counted line
 * ------------------------------------------------------------------ */

function LineForm({
  messages,
  batch,
  locations,
  onAdded,
}: {
  readonly messages: Messages;
  readonly batch: OpeningBatch;
  readonly locations: ReturnType<typeof useLocations>;
  readonly onAdded: (shown: ShownLine) => void;
}) {
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<readonly InventoryItem[] | null>(null);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [form, setForm] = useState({ itemId: '', locationId: '', quantity: '' });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const find = async () => {
    const prefix = search.trim();
    if (prefix.length > MAX_NAME) {
      setErrors((current) => ({ ...current, search: 'inventory.items.searchTooLong' }));
      return;
    }
    setErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([name]) => name !== 'search'))
    );
    const page = await listItems(
      { ...(prefix.length > 0 ? { search: prefix } : {}), lifecycleStatus: 'active' },
      { ...INITIAL_REQUEST, pageSize: 25 },
      null
    );
    if (page.status === 'ok') {
      setFound(page.rows);
      setSearchNote(page.hasMore ? 'inventory.opening.line.moreItems' : null);
    } else {
      setFound(null);
      setSearchNote(
        page.status === 'denied'
          ? 'inventory.opening.line.itemsRefused'
          : 'inventory.opening.line.itemsUnavailable'
      );
    }
  };

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!UUID.test(form.itemId)) next['itemId'] = 'field.required';
    if (!UUID.test(form.locationId)) next['locationId'] = 'field.required';
    const quantity = form.quantity.trim();
    if (quantity.length === 0) next['quantity'] = 'field.required';
    else if (!QUANTITY.test(quantity) || /^0+(\.0+)?$/.test(quantity)) {
      next['quantity'] = 'inventory.opening.line.quantityFormat';
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    const result = await createOpeningBatchLine(batch.id, {
      itemId: form.itemId,
      locationId: form.locationId,
      quantity,
    });
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      const item = found?.find((row) => row.id === form.itemId);
      const location = locations.items?.find((row) => row.id === form.locationId);
      onAdded({
        line: result.created,
        sku: item?.sku ?? result.created.itemId,
        itemName: item?.name ?? '',
        locationCode: location?.locationCode ?? result.created.locationId,
      });
      setForm((f) => ({ ...f, quantity: '' }));
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="opening-line-create-heading"
      className={PANEL}
    >
      <h2 id="opening-line-create-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.opening.line.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.opening.line.explain')}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <TextField
            label={translate(messages, 'inventory.opening.line.find')}
            description={translate(messages, 'inventory.opening.line.findHelp')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            error={errorFor('search')}
          />
        </div>
        <div className="flex items-end">
          <button
            type="button"
            className={SECONDARY_BUTTON}
            onClick={() => {
              void find();
            }}
          >
            {translate(messages, 'inventory.opening.line.search')}
          </button>
        </div>
      </div>
      {searchNote ? (
        <p className="text-caption text-text-muted">{translateDynamic(messages, searchNote)}</p>
      ) : null}
      {found !== null && found.length === 0 ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.opening.line.noItems')}
        </p>
      ) : null}
      <SelectField
        label={translate(messages, 'inventory.opening.line.item')}
        required
        value={form.itemId}
        onChange={(event) => setForm((f) => ({ ...f, itemId: event.target.value }))}
        options={(found ?? []).map((item) => ({
          value: item.id,
          label: `${item.sku} — ${item.name}`,
        }))}
        placeholder={translate(messages, 'inventory.opening.line.chooseItem')}
        error={errorFor('itemId')}
      />
      <LocationPicker
        messages={messages}
        locations={locations}
        label={translate(messages, 'inventory.opening.line.location')}
        placeholder={translate(messages, 'inventory.opening.line.chooseLocation')}
        required
        value={form.locationId}
        onChange={(next) => setForm((f) => ({ ...f, locationId: next }))}
        error={errorFor('locationId')}
      />
      <TextField
        label={translate(messages, 'inventory.opening.line.quantity')}
        description={translate(messages, 'inventory.opening.line.quantityHelp')}
        required
        inputMode="decimal"
        dir="ltr"
        value={form.quantity}
        onChange={(event) => setForm((f) => ({ ...f, quantity: event.target.value }))}
        error={errorFor('quantity')}
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'inventory.opening.line.add')}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Approve — a second person
 * ------------------------------------------------------------------ */

function ApprovalPanel({
  locale,
  messages,
  batch,
  canApprove,
  onApproved,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly batch: OpeningBatch;
  readonly canApprove: boolean;
  readonly onApproved: (batch: OpeningBatch) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const approved = batch.status === 'approved';

  const approve = async () => {
    setBusy(true);
    const result = await approveOpeningBatch(batch.id);
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) onApproved(result.created);
  };

  return (
    <section aria-labelledby="opening-approve-heading" className={PANEL}>
      <h2 id="opening-approve-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.opening.approve.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.opening.approve.explain')}
      </p>
      {approved ? (
        <>
          <p className="text-body text-text-primary">
            {translate(messages, 'inventory.opening.approve.approved')}
          </p>
          <p className="text-caption" lang={locale}>
            <Link href={`/${locale}/inventory`} className={LINK}>
              {translate(messages, 'inventory.opening.approve.seeStock')}
            </Link>
            {' · '}
            <Link href={`/${locale}/inventory/movements`} className={LINK}>
              {translate(messages, 'inventory.opening.approve.seeMovements')}
            </Link>
          </p>
        </>
      ) : canApprove ? (
        <>
          <OutcomeNote messages={messages} outcome={outcome} />
          {outcome?.status === 'conflict' ? (
            <p className="text-caption text-text-muted">
              {translate(messages, 'inventory.opening.approve.secondPerson')}
            </p>
          ) : null}
          <div>
            <button
              type="button"
              className={PRIMARY_BUTTON}
              disabled={busy}
              onClick={() => {
                void approve();
              }}
            >
              {translate(messages, 'inventory.opening.approve.action')}
            </button>
          </div>
        </>
      ) : (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.opening.needsApprove')}
        </p>
      )}
    </section>
  );
}
