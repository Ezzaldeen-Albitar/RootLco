'use client';

/**
 * Stock transfers (P1-32): dispatch, receive what arrived, settle what did not,
 * and cancel.
 *
 * A transfer is two postings separated in time. Dispatch moves the quantity out
 * of its source into the branch's transit location, where it is part of neither
 * end's availability; a receipt moves what ARRIVED into the destination. A
 * receipt of less than is still in transit leaves the transfer partly received
 * and the remainder in transit — the screen shows the server's
 * `outstandingQuantity` for it and never derives one. What did not arrive leaves
 * transit only by an act with a reason: a return to the origin (posted at once)
 * or a write-off (waiting for a second person).
 *
 * ## A write-off is decided here, by someone else
 *
 * A pending write-off is decided on its SETTLEMENT. The branch's write-offs
 * waiting for a decision — for transfers it sent or is receiving — are listed
 * from `inv.stock-transfer-settlement-list`, and a holder of
 * `inv.adjustment.approve` approves or rejects one with a reason. The requester
 * is never offered the decision: the screen knows who is signed in and says on
 * their own request that another person must decide it. The server remains the
 * guarantee, and a refusal that arrives anyway is said in plain words.
 *
 * Permissions: `inv.stock.read` gates the page (the lists and the locations);
 * `inv.stock.operate` offers dispatch, receipt, settlement and cancellation;
 * `inv.adjustment.approve` the write-off decision; `org.branch.read` the branch
 * picker.
 */

import { useState } from 'react';

import { RadioGroupField, TextAreaField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { formatDateTime } from '@/lib/format';

import {
  cancelTransfer,
  createTransfer,
  decideTransferWriteOff,
  listTransferWriteOffs,
  listTransfers,
  receiveTransfer,
  resolveTransferDiscrepancy,
} from '../api';
import {
  MAX_REASON,
  TRANSFER_DIRECTIONS,
  TRANSFER_DISCREPANCY_KINDS,
  type InventoryItem,
  type StockTarget,
  type AdjustmentDecision,
  type StockTransfer,
  type TransferDirection,
  type TransferDiscrepancyKind,
  type TransferSettlement,
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
  DANGER_BUTTON,
  ItemFinder,
  PANEL,
  StockOperationLinks,
  isQuantity,
  outcomeField,
  useBranchList,
} from './stock-operations';

const readOutbound = (target: StockTarget) => listTransfers(target, 'outbound');
const readInbound = (target: StockTarget) => listTransfers(target, 'inbound');
const readPendingWriteOffs = (target: StockTarget) => listTransferWriteOffs(target, 'pending');

/** What a write left to say, shown above the list it caused to re-read. */
interface Notice {
  readonly messageKey: string;
  /** A figure the server stated, shown beside the sentence. */
  readonly quantity: string | null;
  readonly detailKey: string | null;
}

type RowAction = { readonly kind: 'receive' | 'resolve' | 'cancel'; readonly row: StockTransfer };

export function TransfersScreen({
  locale,
  messages,
  currentUserId,
  canOperate,
  canApprove,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** The signed-in person, compared with `requestedBy` to say why a decision is not offered. */
  readonly currentUserId: string;
  /** `inv.stock.operate` — dispatch, receive, settle, cancel. */
  readonly canOperate: boolean;
  /** `inv.adjustment.approve` — approving or rejecting someone else's write-off. */
  readonly canApprove: boolean;
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
        {translate(messages, 'inventory.transfers.explain')}
      </p>
      {!canOperate ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.transfers.needsOperate')}
        </p>
      ) : null}
      <BranchTargetForm
        messages={messages}
        formLabelKey="inventory.transfers.targetLabel"
        explainKey="inventory.target.explain"
        submitKey="inventory.transfers.chooseBranch"
        onChosen={setTarget}
      />
      {target !== null ? (
        <BranchTransfers
          key={`${target.companyId}:${target.branchId}`}
          locale={locale}
          messages={messages}
          target={target}
          currentUserId={currentUserId}
          canOperate={canOperate}
          canApprove={canApprove}
        />
      ) : null}
    </div>
  );
}

function BranchTransfers({
  locale,
  messages,
  target,
  currentUserId,
  canOperate,
  canApprove,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: StockTarget;
  readonly currentUserId: string;
  readonly canOperate: boolean;
  readonly canApprove: boolean;
}) {
  const [direction, setDirection] = useState<TransferDirection>('outbound');
  const { list, reload } = useBranchList<StockTransfer>(
    target,
    direction === 'outbound' ? readOutbound : readInbound,
    'inventory.transfers.list.refused',
    'inventory.transfers.list.unavailable',
    direction
  );
  const writeOffs = useBranchList<TransferSettlement>(
    target,
    readPendingWriteOffs,
    'inventory.transfers.writeOffs.refused',
    'inventory.transfers.writeOffs.unavailable'
  );
  const locations = useLocations(target);
  const [action, setAction] = useState<RowAction | null>(null);
  const [deciding, setDeciding] = useState<TransferSettlement | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const done = (next: Notice) => {
    setNotice(next);
    setAction(null);
    setDeciding(null);
    reload();
    writeOffs.reload();
  };

  return (
    <>
      {notice !== null ? (
        <div role="status" className="rounded-lg border border-border bg-surface p-3">
          <p className="text-body text-text-primary">
            {translateDynamic(messages, notice.messageKey)}
            {notice.quantity !== null ? (
              <>
                {' '}
                <Qty value={notice.quantity} />
              </>
            ) : null}
          </p>
          {notice.detailKey !== null ? (
            <p className="text-caption text-text-muted">
              {translateDynamic(messages, notice.detailKey)}
            </p>
          ) : null}
        </div>
      ) : null}

      <section aria-labelledby="transfers-list-heading" className={PANEL}>
        <h2 id="transfers-list-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'inventory.transfers.list.heading')}
        </h2>
        <RadioGroupField
          label={translate(messages, 'inventory.transfers.direction.label')}
          name="transfer-direction"
          value={direction}
          onChange={(next) => {
            setDirection(next as TransferDirection);
            setAction(null);
          }}
          options={TRANSFER_DIRECTIONS.map((value) => ({
            value,
            label: translateDynamic(messages, `inventory.transfers.direction.${value}`),
          }))}
        />
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.transfers.list.explain')}
        </p>
        <BranchListView
          messages={messages}
          list={list}
          loadingKey="inventory.transfers.list.loading"
          noneKey="inventory.transfers.list.none"
          truncatedKey="inventory.transfers.list.truncated"
        >
          {(items) => (
            <table className="w-full text-body">
              <caption className="sr-only">
                {translate(messages, 'inventory.transfers.list.caption')}
              </caption>
              <thead>
                <tr className="text-caption text-text-muted">
                  <th scope="col" className="text-start font-medium">
                    {translate(messages, 'inventory.transfers.column.item')}
                  </th>
                  <th scope="col" className="text-start font-medium">
                    {translate(messages, 'inventory.transfers.column.route')}
                  </th>
                  <th scope="col" className="text-end font-medium">
                    {translate(messages, 'inventory.transfers.column.dispatched')}
                  </th>
                  <th scope="col" className="text-end font-medium">
                    {translate(messages, 'inventory.transfers.column.received')}
                  </th>
                  <th scope="col" className="text-end font-medium">
                    {translate(messages, 'inventory.transfers.column.resolved')}
                  </th>
                  <th scope="col" className="text-end font-medium">
                    {translate(messages, 'inventory.transfers.column.inTransit')}
                  </th>
                  <th scope="col" className="text-start font-medium">
                    {translate(messages, 'inventory.transfers.column.status')}
                  </th>
                  {canOperate ? (
                    <th scope="col" className="text-end font-medium">
                      {translate(messages, 'inventory.transfers.column.actions')}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const open = row.status === 'dispatched' || row.status === 'partially_received';
                  return (
                    <tr key={row.id} className="border-t border-border align-top">
                      <td>
                        <code className="font-mono text-caption" dir="ltr">
                          {row.sku}
                        </code>
                        <span className="block text-caption text-text-muted" dir="ltr">
                          {formatDateTime(row.dispatchedAt, locale)}
                        </span>
                      </td>
                      <td>
                        <span dir="ltr">
                          {row.fromLocationCode ??
                            translate(messages, 'inventory.transfers.hiddenLocation')}
                        </span>
                        {' → '}
                        <span dir="ltr">
                          {row.toLocationCode ??
                            translate(messages, 'inventory.transfers.hiddenLocation')}
                        </span>
                      </td>
                      <td className="text-end">
                        <Qty value={row.quantity} />
                      </td>
                      <td className="text-end">
                        {row.receivedQuantity === null ? (
                          <span className="text-caption text-text-muted">
                            {translate(messages, 'inventory.transfers.nothingReceived')}
                          </span>
                        ) : (
                          <Qty value={row.receivedQuantity} />
                        )}
                      </td>
                      <td className="text-end">
                        <Qty value={row.resolvedQuantity} />
                      </td>
                      <td className="text-end">
                        <strong>
                          <Qty value={row.outstandingQuantity} />
                        </strong>
                      </td>
                      <td>
                        {translateDynamic(messages, `inventory.transferStatus.${row.status}`)}
                        {row.cancelReason ? (
                          <span className="block text-caption text-text-muted">
                            {row.cancelReason}
                          </span>
                        ) : null}
                      </td>
                      {canOperate ? (
                        <td className="text-end">
                          {open ? (
                            <div className="flex flex-wrap justify-end gap-2">
                              <button
                                type="button"
                                className={SECONDARY_BUTTON}
                                onClick={() => setAction({ kind: 'receive', row })}
                              >
                                {translate(messages, 'inventory.transfers.receive.action')}
                                <span className="sr-only"> {row.sku}</span>
                              </button>
                              <button
                                type="button"
                                className={SECONDARY_BUTTON}
                                onClick={() => setAction({ kind: 'resolve', row })}
                              >
                                {translate(messages, 'inventory.transfers.resolve.action')}
                                <span className="sr-only"> {row.sku}</span>
                              </button>
                              {row.status === 'dispatched' ? (
                                <button
                                  type="button"
                                  className={DANGER_BUTTON}
                                  onClick={() => setAction({ kind: 'cancel', row })}
                                >
                                  {translate(messages, 'inventory.transfers.cancel.action')}
                                  <span className="sr-only"> {row.sku}</span>
                                </button>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-caption text-text-muted">
                              {translate(messages, 'inventory.transfers.closed')}
                            </span>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </BranchListView>
      </section>

      <section aria-labelledby="transfer-write-offs-heading" className={PANEL}>
        <h2 id="transfer-write-offs-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'inventory.transfers.writeOffs.heading')}
        </h2>
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.transfers.writeOffs.explain')}
        </p>
        <BranchListView
          messages={messages}
          list={writeOffs.list}
          loadingKey="inventory.transfers.writeOffs.loading"
          noneKey="inventory.transfers.writeOffs.none"
          truncatedKey="inventory.transfers.writeOffs.truncated"
        >
          {(items) => (
            <table className="w-full text-body">
              <caption className="sr-only">
                {translate(messages, 'inventory.transfers.writeOffs.caption')}
              </caption>
              <thead>
                <tr className="text-caption text-text-muted">
                  <th scope="col" className="text-start font-medium">
                    {translate(messages, 'inventory.transfers.column.item')}
                  </th>
                  <th scope="col" className="text-end font-medium">
                    {translate(messages, 'inventory.transfers.writeOffs.column.quantity')}
                  </th>
                  <th scope="col" className="text-start font-medium">
                    {translate(messages, 'inventory.transfers.writeOffs.column.reason')}
                  </th>
                  <th scope="col" className="text-end font-medium">
                    {translate(messages, 'inventory.transfers.writeOffs.column.decision')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const own = row.requestedBy === currentUserId;
                  return (
                    <tr key={row.id} className="border-t border-border align-top">
                      <td>
                        <code className="font-mono text-caption" dir="ltr">
                          {row.sku}
                        </code>
                      </td>
                      <td className="text-end">
                        <Qty value={row.quantity} />
                      </td>
                      <td>
                        {row.reason}
                        <span className="block text-caption text-text-muted" dir="ltr">
                          {formatDateTime(row.createdAt, locale)}
                        </span>
                        {own ? (
                          <span className="block text-caption text-text-muted">
                            {translate(messages, 'inventory.transfers.writeOffs.byYou')}
                          </span>
                        ) : null}
                      </td>
                      <td className="text-end">
                        {!canApprove ? (
                          <span className="text-caption text-text-muted">
                            {translate(messages, 'inventory.transfers.writeOffs.needsApprove')}
                          </span>
                        ) : own ? (
                          <span className="text-caption text-text-muted">
                            {translate(messages, 'inventory.transfers.writeOffs.ownRequest')}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className={SECONDARY_BUTTON}
                            onClick={() => {
                              setAction(null);
                              setDeciding(row);
                            }}
                          >
                            {translate(messages, 'inventory.transfers.writeOffs.decide.action')}
                            <span className="sr-only"> {row.sku}</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </BranchListView>
      </section>

      {deciding !== null ? (
        <WriteOffDecisionForm
          key={`decide-${deciding.id}`}
          messages={messages}
          writeOff={deciding}
          onClose={() => setDeciding(null)}
          onDone={done}
        />
      ) : null}

      {action !== null && action.kind === 'receive' ? (
        <ReceiveForm
          key={`receive-${action.row.id}`}
          messages={messages}
          transfer={action.row}
          onClose={() => setAction(null)}
          onDone={done}
        />
      ) : null}
      {action !== null && action.kind === 'resolve' ? (
        <ResolveForm
          key={`resolve-${action.row.id}`}
          messages={messages}
          transfer={action.row}
          onClose={() => setAction(null)}
          onDone={done}
        />
      ) : null}
      {action !== null && action.kind === 'cancel' ? (
        <CancelForm
          key={`cancel-${action.row.id}`}
          messages={messages}
          transfer={action.row}
          onClose={() => setAction(null)}
          onDone={done}
        />
      ) : null}

      {canOperate ? (
        <DispatchForm
          messages={messages}
          locations={locations}
          onDone={(next) => {
            setDirection('outbound');
            done(next);
          }}
        />
      ) : null}
    </>
  );
}

function WriteOffDecisionForm({
  messages,
  writeOff,
  onClose,
  onDone,
}: {
  readonly messages: Messages;
  readonly writeOff: TransferSettlement;
  readonly onClose: () => void;
  readonly onDone: (notice: Notice) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const decide = async (decision: AdjustmentDecision) => {
    const why = reason.trim();
    if (why.length === 0 || why.length > MAX_REASON) {
      setError(why.length === 0 ? 'field.required' : 'inventory.stockOps.reasonTooLong');
      return;
    }
    setError(null);
    setBusy(true);
    const result = await decideTransferWriteOff(writeOff.id, { decision, reason: why });
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      onDone(
        decision === 'approved'
          ? {
              messageKey: 'inventory.transfers.writeOffs.decide.approvedDone',
              quantity: result.created.quantity,
              detailKey: null,
            }
          : {
              messageKey: 'inventory.transfers.writeOffs.decide.rejectedDone',
              quantity: result.created.quantity,
              detailKey: 'inventory.transfers.writeOffs.decide.rejectedNext',
            }
      );
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void decide('approved');
      }}
      noValidate
      aria-labelledby="transfer-write-off-decide-heading"
      className={PANEL}
    >
      <h2
        id="transfer-write-off-decide-heading"
        className="text-body font-medium text-text-primary"
      >
        {translate(messages, 'inventory.transfers.writeOffs.decide.heading')}{' '}
        <code className="font-mono" dir="ltr">
          {writeOff.sku}
        </code>
      </h2>
      <p className="text-body">
        <Qty value={writeOff.quantity} />
      </p>
      <p className="text-caption text-text-muted">{writeOff.reason}</p>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.transfers.writeOffs.decide.explain')}
      </p>
      <TextAreaField
        label={translate(messages, 'inventory.transfers.writeOffs.decide.reason')}
        required
        rows={2}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        error={
          error ? translateDynamic(messages, error) : outcomeField(messages, outcome, 'reason')
        }
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'inventory.transfers.writeOffs.decide.approve')}
        </button>
        <button
          type="button"
          className={DANGER_BUTTON}
          disabled={busy}
          onClick={() => {
            void decide('rejected');
          }}
        >
          {translate(messages, 'inventory.transfers.writeOffs.decide.reject')}
        </button>
        <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
          {translate(messages, 'inventory.stockOps.close')}
        </button>
      </div>
    </form>
  );
}

/** The transfer an action form is about, named in its heading. */
function TransferHeading({
  id,
  messages,
  headingKey,
  transfer,
}: {
  readonly id: string;
  readonly messages: Messages;
  readonly headingKey: string;
  readonly transfer: StockTransfer;
}) {
  return (
    <>
      <h2 id={id} className="text-body font-medium text-text-primary">
        {translateDynamic(messages, headingKey)}{' '}
        <code className="font-mono" dir="ltr">
          {transfer.sku}
        </code>
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.transfers.stillInTransit')}{' '}
        <Qty value={transfer.outstandingQuantity} />
      </p>
    </>
  );
}

function ReceiveForm({
  messages,
  transfer,
  onClose,
  onDone,
}: {
  readonly messages: Messages;
  readonly transfer: StockTransfer;
  readonly onClose: () => void;
  readonly onDone: (notice: Notice) => void;
}) {
  const [quantity, setQuantity] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const submit = async () => {
    const value = quantity.trim();
    if (!isQuantity(value)) {
      setError('inventory.stockOps.quantityFormat');
      return;
    }
    setError(null);
    setBusy(true);
    const result = await receiveTransfer(transfer.id, { quantity: value });
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      const echo = result.created;
      onDone(
        echo.status === 'partially_received'
          ? {
              messageKey: 'inventory.transfers.receive.partial',
              quantity: echo.outstandingQuantity,
              detailKey: 'inventory.transfers.receive.partialNext',
            }
          : {
              messageKey: 'inventory.transfers.receive.complete',
              quantity: null,
              detailKey: null,
            }
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
      aria-labelledby="transfer-receive-heading"
      className={PANEL}
    >
      <TransferHeading
        id="transfer-receive-heading"
        messages={messages}
        headingKey="inventory.transfers.receive.heading"
        transfer={transfer}
      />
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.transfers.receive.explain')}
      </p>
      <TextField
        label={translate(messages, 'inventory.transfers.receive.quantity')}
        description={translate(messages, 'inventory.stockOps.quantityHelp')}
        required
        inputMode="decimal"
        dir="ltr"
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
        error={
          error ? translateDynamic(messages, error) : outcomeField(messages, outcome, 'quantity')
        }
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'inventory.transfers.receive.submit')}
        </button>
        <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
          {translate(messages, 'inventory.stockOps.close')}
        </button>
      </div>
    </form>
  );
}

function ResolveForm({
  messages,
  transfer,
  onClose,
  onDone,
}: {
  readonly messages: Messages;
  readonly transfer: StockTransfer;
  readonly onClose: () => void;
  readonly onDone: (notice: Notice) => void;
}) {
  const [kind, setKind] = useState<TransferDiscrepancyKind>('return_to_origin');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  // One key per opened form: the settlement keeps the header key for its life,
  // so a second press after a lost answer replays the first settlement.
  const [attemptKey] = useState(() => crypto.randomUUID());

  const errorFor = (name: string) =>
    errors[name] ? translateDynamic(messages, errors[name]) : outcomeField(messages, outcome, name);

  const submit = async () => {
    const found: Record<string, string> = {};
    const value = quantity.trim();
    if (!isQuantity(value)) found['quantity'] = 'inventory.stockOps.quantityFormat';
    const why = reason.trim();
    if (why.length === 0) found['reason'] = 'field.required';
    else if (why.length > MAX_REASON) found['reason'] = 'inventory.stockOps.reasonTooLong';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    const result = await resolveTransferDiscrepancy(
      transfer.id,
      { kind, quantity: value, reason: why },
      attemptKey
    );
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      const echo = result.created;
      onDone(
        echo.status === 'pending'
          ? {
              messageKey: 'inventory.transfers.resolve.writeOffPending',
              quantity: echo.quantity,
              detailKey: 'inventory.transfers.resolve.writeOffNoDecision',
            }
          : {
              messageKey: 'inventory.transfers.resolve.returnedDone',
              quantity: echo.quantity,
              detailKey: null,
            }
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
      aria-labelledby="transfer-resolve-heading"
      className={PANEL}
    >
      <TransferHeading
        id="transfer-resolve-heading"
        messages={messages}
        headingKey="inventory.transfers.resolve.heading"
        transfer={transfer}
      />
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.transfers.resolve.explain')}
      </p>
      <RadioGroupField
        label={translate(messages, 'inventory.transfers.resolve.kind')}
        name="transfer-resolution-kind"
        required
        value={kind}
        onChange={(next) => setKind(next as TransferDiscrepancyKind)}
        options={TRANSFER_DISCREPANCY_KINDS.map((value) => ({
          value,
          label: translateDynamic(messages, `inventory.transfers.resolve.kind.${value}`),
        }))}
      />
      <TextField
        label={translate(messages, 'inventory.transfers.resolve.quantity')}
        description={translate(messages, 'inventory.stockOps.quantityHelp')}
        required
        inputMode="decimal"
        dir="ltr"
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
        error={errorFor('quantity')}
      />
      <TextAreaField
        label={translate(messages, 'inventory.stockOps.reason')}
        required
        rows={2}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        error={errorFor('reason')}
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'inventory.transfers.resolve.submit')}
        </button>
        <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
          {translate(messages, 'inventory.stockOps.close')}
        </button>
      </div>
    </form>
  );
}

function CancelForm({
  messages,
  transfer,
  onClose,
  onDone,
}: {
  readonly messages: Messages;
  readonly transfer: StockTransfer;
  readonly onClose: () => void;
  readonly onDone: (notice: Notice) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const submit = async () => {
    const why = reason.trim();
    if (why.length === 0 || why.length > MAX_REASON) {
      setError(why.length === 0 ? 'field.required' : 'inventory.stockOps.reasonTooLong');
      return;
    }
    setError(null);
    setBusy(true);
    const result = await cancelTransfer(transfer.id, { reason: why });
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      onDone({ messageKey: 'inventory.transfers.cancel.done', quantity: null, detailKey: null });
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="transfer-cancel-heading"
      className={PANEL}
    >
      <TransferHeading
        id="transfer-cancel-heading"
        messages={messages}
        headingKey="inventory.transfers.cancel.heading"
        transfer={transfer}
      />
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.transfers.cancel.explain')}
      </p>
      <TextAreaField
        label={translate(messages, 'inventory.stockOps.reason')}
        required
        rows={2}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        error={
          error ? translateDynamic(messages, error) : outcomeField(messages, outcome, 'reason')
        }
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={DANGER_BUTTON} disabled={busy}>
          {translate(messages, 'inventory.transfers.cancel.submit')}
        </button>
        <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
          {translate(messages, 'inventory.stockOps.close')}
        </button>
      </div>
    </form>
  );
}

function DispatchForm({
  messages,
  locations,
  onDone,
}: {
  readonly messages: Messages;
  readonly locations: Locations;
  readonly onDone: (notice: Notice) => void;
}) {
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState({
    fromLocationId: '',
    toLocationId: '',
    quantity: '',
    reason: '',
  });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  // The transfer keeps the body key for its whole life, so a second press after
  // a lost answer returns the transfer already dispatched.
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());

  const errorFor = (name: string) =>
    errors[name] ? translateDynamic(messages, errors[name]) : outcomeField(messages, outcome, name);

  const submit = async () => {
    const found: Record<string, string> = {};
    if (item === null) found['itemId'] = 'field.required';
    if (!form.fromLocationId) found['fromLocationId'] = 'field.required';
    if (!form.toLocationId) found['toLocationId'] = 'field.required';
    else if (form.toLocationId === form.fromLocationId) {
      found['toLocationId'] = 'inventory.transfers.create.sameLocation';
    }
    const quantity = form.quantity.trim();
    if (!isQuantity(quantity)) found['quantity'] = 'inventory.stockOps.quantityFormat';
    const reason = form.reason.trim();
    if (reason.length > MAX_REASON) found['reason'] = 'inventory.stockOps.reasonTooLong';
    setErrors(found);
    if (Object.keys(found).length > 0 || item === null) return;
    setBusy(true);
    const result = await createTransfer({
      itemId: item.id,
      fromLocationId: form.fromLocationId,
      toLocationId: form.toLocationId,
      quantity,
      idempotencyKey: attemptKey,
      ...(reason.length > 0 ? { reason } : {}),
    });
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      const echo = result.created;
      setForm({ fromLocationId: '', toLocationId: '', quantity: '', reason: '' });
      setItem(null);
      setOutcome(null);
      setAttemptKey(crypto.randomUUID());
      onDone({
        messageKey: echo.replayed
          ? 'inventory.transfers.create.replayed'
          : 'inventory.transfers.create.done',
        quantity: echo.outstandingQuantity,
        detailKey: 'inventory.transfers.create.transitNote',
      });
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="transfer-create-heading"
      className={PANEL}
    >
      <h2 id="transfer-create-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.transfers.create.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.transfers.create.explain')}
      </p>
      <ItemFinder
        messages={messages}
        idPrefix="transfer"
        value={item}
        onChange={setItem}
        error={errorFor('itemId')}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <LocationPicker
          messages={messages}
          locations={locations}
          label={translate(messages, 'inventory.transfers.create.from')}
          placeholder={translate(messages, 'inventory.stockOps.chooseLocation')}
          required
          value={form.fromLocationId}
          onChange={(next) => setForm((f) => ({ ...f, fromLocationId: next }))}
          error={errorFor('fromLocationId')}
        />
        <LocationPicker
          messages={messages}
          locations={locations}
          label={translate(messages, 'inventory.transfers.create.to')}
          placeholder={translate(messages, 'inventory.stockOps.chooseLocation')}
          required
          value={form.toLocationId}
          onChange={(next) => setForm((f) => ({ ...f, toLocationId: next }))}
          error={errorFor('toLocationId')}
        />
      </div>
      <TextField
        label={translate(messages, 'inventory.transfers.create.quantity')}
        description={translate(messages, 'inventory.stockOps.quantityHelp')}
        required
        inputMode="decimal"
        dir="ltr"
        value={form.quantity}
        onChange={(event) => setForm((f) => ({ ...f, quantity: event.target.value }))}
        error={errorFor('quantity')}
      />
      <TextAreaField
        label={translate(messages, 'inventory.transfers.create.reason')}
        rows={2}
        value={form.reason}
        onChange={(event) => setForm((f) => ({ ...f, reason: event.target.value }))}
        error={errorFor('reason')}
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'inventory.transfers.create.submit')}
        </button>
      </div>
    </form>
  );
}
