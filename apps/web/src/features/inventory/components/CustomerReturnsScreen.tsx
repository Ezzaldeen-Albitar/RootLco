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
 * Permissions: `inv.stock.read` gates the page and both reads;
 * `inv.stock.operate` with `sal.finance.view` offers the write.
 */

import { useCallback, useState } from 'react';

import { SelectField, TextAreaField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { formatDateTime } from '@/lib/format';
import { compareMoney } from '@/lib/money';

import { createSalesReturn, listSalesReturns, readReturnable } from '../api';
import {
  MAX_REASON,
  RETURN_CONDITIONS,
  SALES_RETURN_SOURCE_KINDS,
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
  UUID,
  useLocations,
} from './shared';
import {
  BranchListView,
  BranchTargetForm,
  PANEL,
  StockOperationLinks,
  isQuantity,
  outcomeField,
  useBranchList,
} from './stock-operations';

export function CustomerReturnsScreen({
  locale,
  messages,
  canOperate,
  canReadBranches,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** `inv.stock.operate` (with `sal.finance.view`) — receiving a return. */
  readonly canOperate: boolean;
  /** `org.branch.read` — whether a branch list is requested for the picker. */
  readonly canReadBranches: boolean;
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
        canReadBranches={canReadBranches}
        formLabelKey="inventory.returns.targetLabel"
        explainKey="inventory.target.explain"
        submitKey="inventory.returns.chooseBranch"
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
          messages={messages}
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
                        <span className="block text-caption text-text-muted">
                          {translate(messages, 'inventory.returns.creditPending')}
                        </span>
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
  messages,
  locations,
  onReceived,
}: {
  readonly messages: Messages;
  readonly locations: ReturnType<typeof useLocations>;
  readonly onReceived: (noticeKey: string) => void;
}) {
  const [sourceKind, setSourceKind] = useState<SalesReturnSourceKind>('invoice_line');
  const [sourceId, setSourceId] = useState('');
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

  const errorFor = (name: string) =>
    errors[name] ? translateDynamic(messages, errors[name]) : outcomeField(messages, outcome, name);

  const look = async () => {
    const id = sourceId.trim();
    if (!UUID.test(id)) {
      setSourceNote('inventory.common.idFormat');
      setReturnable(null);
      return;
    }
    setSourceNote('inventory.returns.source.looking');
    const state = await readReturnable(sourceKind, id);
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
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    const id = sourceId.trim();
    if (!UUID.test(id)) found['sourceId'] = 'inventory.common.idFormat';
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
      setReturnable(null);
      setSourceId('');
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

      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField
          label={translate(messages, 'inventory.returns.source.kind')}
          required
          value={sourceKind}
          onChange={(event) => {
            setSourceKind(event.target.value as SalesReturnSourceKind);
            setReturnable(null);
          }}
          options={SALES_RETURN_SOURCE_KINDS.map((kind) => ({
            value: kind,
            label: translateDynamic(messages, `inventory.returnSource.${kind}`),
          }))}
        />
        <TextField
          label={translate(messages, 'inventory.returns.source.id')}
          description={translate(messages, 'inventory.returns.source.idHelp')}
          required
          dir="ltr"
          value={sourceId}
          onChange={(event) => {
            setSourceId(event.target.value);
            setReturnable(null);
          }}
          error={errorFor('sourceId')}
        />
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
