'use client';

/**
 * Stock adjustments (P1-32): request a correction, and have a DIFFERENT person
 * approve or reject it.
 *
 * A request moves nothing. Only an approval posts a movement, and the server
 * refuses the requester as the one who decides (maker ≠ checker). The screen
 * knows who is signed in, so on a request the caller made itself it does not
 * offer the decision at all and says why — a second person with the approval
 * permission has to decide it. The server remains the guarantee: a refusal that
 * arrives anyway (an adjustment already decided, or a request by the same person
 * in another session) is said in plain words.
 *
 * Adjustments raised by a stock count arrive here too, pending, and are decided
 * the same way.
 *
 * Permissions: `inv.stock.read` gates the page; `inv.stock.operate` offers the
 * request form; `inv.adjustment.approve` the decision; `org.branch.read` the
 * branch picker.
 */

import { useState } from 'react';

import { RadioGroupField, SelectField, TextAreaField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { formatDateTime } from '@/lib/format';

import { createAdjustment, decideAdjustment, listAdjustments } from '../api';
import {
  ADJUSTMENT_STATES,
  DIRECTIONS,
  MAX_REASON,
  type AdjustmentDecision,
  type AdjustmentState,
  type Direction,
  type InventoryItem,
  type StockAdjustment,
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
  DANGER_BUTTON,
  ItemFinder,
  PANEL,
  StockOperationLinks,
  isQuantity,
  outcomeField,
  useBranchList,
} from './stock-operations';

const READERS: Record<
  AdjustmentState | 'all',
  (target: StockTarget) => ReturnType<typeof listAdjustments>
> = {
  all: (target) => listAdjustments(target, null),
  pending: (target) => listAdjustments(target, 'pending'),
  approved: (target) => listAdjustments(target, 'approved'),
  rejected: (target) => listAdjustments(target, 'rejected'),
};

export function AdjustmentsScreen({
  locale,
  messages,
  currentUserId,
  canOperate,
  canApprove,
  canReadBranches,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** The signed-in person, compared with `requestedBy` to say why a decision is not offered. */
  readonly currentUserId: string;
  /** `inv.stock.operate` — requesting an adjustment. */
  readonly canOperate: boolean;
  /** `inv.adjustment.approve` — approving or rejecting someone else's request. */
  readonly canApprove: boolean;
  /** `org.branch.read` — whether a branch list is requested for the picker. */
  readonly canReadBranches: boolean;
}) {
  const [target, setTarget] = useState<StockTarget | null>(null);
  return (
    <div className="flex min-h-0 flex-col gap-4">
      <StockOperationLinks locale={locale} messages={messages} />
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.adjustments.explain')}
      </p>
      <BranchTargetForm
        messages={messages}
        canReadBranches={canReadBranches}
        formLabelKey="inventory.adjustments.targetLabel"
        explainKey="inventory.target.explain"
        submitKey="inventory.adjustments.chooseBranch"
        onChosen={setTarget}
      />
      {target !== null ? (
        <BranchAdjustments
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

function BranchAdjustments({
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
  const [status, setStatus] = useState<AdjustmentState | 'all'>('pending');
  const { list, reload } = useBranchList<StockAdjustment>(
    target,
    READERS[status],
    'inventory.adjustments.list.refused',
    'inventory.adjustments.list.unavailable',
    status
  );
  const locations = useLocations(target);
  const [deciding, setDeciding] = useState<StockAdjustment | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      {notice !== null ? (
        <p role="status" className="rounded-lg border border-border bg-surface p-3 text-body">
          {translateDynamic(messages, notice)}
        </p>
      ) : null}
      <section aria-labelledby="adjustments-list-heading" className={PANEL}>
        <h2 id="adjustments-list-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'inventory.adjustments.list.heading')}
        </h2>
        <div className="sm:max-w-xs">
          <SelectField
            label={translate(messages, 'inventory.adjustments.list.status')}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as AdjustmentState | 'all');
              setDeciding(null);
            }}
            options={[
              { value: 'all', label: translate(messages, 'inventory.adjustments.list.all') },
              ...ADJUSTMENT_STATES.map((value) => ({
                value,
                label: translateDynamic(messages, `inventory.adjustmentStatus.${value}`),
              })),
            ]}
          />
        </div>
        <BranchListView
          messages={messages}
          list={list}
          loadingKey="inventory.adjustments.list.loading"
          noneKey="inventory.adjustments.list.none"
          truncatedKey="inventory.adjustments.list.truncated"
        >
          {(items) => (
            <table className="w-full text-body">
              <caption className="sr-only">
                {translate(messages, 'inventory.adjustments.list.caption')}
              </caption>
              <thead>
                <tr className="text-caption text-text-muted">
                  <th scope="col" className="text-start font-medium">
                    {translate(messages, 'inventory.adjustments.column.item')}
                  </th>
                  <th scope="col" className="text-start font-medium">
                    {translate(messages, 'inventory.adjustments.column.change')}
                  </th>
                  <th scope="col" className="text-end font-medium">
                    {translate(messages, 'inventory.adjustments.column.quantity')}
                  </th>
                  <th scope="col" className="text-start font-medium">
                    {translate(messages, 'inventory.adjustments.column.reason')}
                  </th>
                  <th scope="col" className="text-start font-medium">
                    {translate(messages, 'inventory.adjustments.column.status')}
                  </th>
                  <th scope="col" className="text-end font-medium">
                    {translate(messages, 'inventory.adjustments.column.decision')}
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
                        <span className="block text-caption text-text-muted" dir="ltr">
                          {row.locationCode}
                        </span>
                      </td>
                      <td>
                        {translateDynamic(
                          messages,
                          `inventory.adjustments.direction.${row.direction}`
                        )}
                      </td>
                      <td className="text-end">
                        <Qty value={row.quantity} />
                      </td>
                      <td>
                        {row.reason}
                        <span className="block text-caption text-text-muted" dir="ltr">
                          {formatDateTime(row.createdAt, locale)}
                        </span>
                      </td>
                      <td>
                        {translateDynamic(messages, `inventory.adjustmentStatus.${row.status}`)}
                        {own ? (
                          <span className="block text-caption text-text-muted">
                            {translate(messages, 'inventory.adjustments.byYou')}
                          </span>
                        ) : null}
                      </td>
                      <td className="text-end">
                        {row.status !== 'pending' ? (
                          <span className="text-caption text-text-muted">
                            {translate(messages, 'inventory.adjustments.decided')}
                          </span>
                        ) : !canApprove ? (
                          <span className="text-caption text-text-muted">
                            {translate(messages, 'inventory.adjustments.needsApprove')}
                          </span>
                        ) : own ? (
                          <span className="text-caption text-text-muted">
                            {translate(messages, 'inventory.adjustments.ownRequest')}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className={SECONDARY_BUTTON}
                            onClick={() => setDeciding(row)}
                          >
                            {translate(messages, 'inventory.adjustments.decide.action')}
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
        <DecisionForm
          key={deciding.id}
          messages={messages}
          adjustment={deciding}
          onClose={() => setDeciding(null)}
          onDecided={(key) => {
            setNotice(key);
            setDeciding(null);
            reload();
          }}
        />
      ) : null}

      {canOperate ? (
        <RequestForm
          messages={messages}
          target={target}
          locations={locations}
          onRequested={() => {
            setNotice('inventory.adjustments.create.done');
            setStatus('pending');
            reload();
          }}
        />
      ) : (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.adjustments.needsOperate')}
        </p>
      )}
    </>
  );
}

function DecisionForm({
  messages,
  adjustment,
  onClose,
  onDecided,
}: {
  readonly messages: Messages;
  readonly adjustment: StockAdjustment;
  readonly onClose: () => void;
  readonly onDecided: (noticeKey: string) => void;
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
    const result = await decideAdjustment(adjustment.id, { decision, reason: why });
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      onDecided(
        decision === 'approved'
          ? 'inventory.adjustments.decide.approvedDone'
          : 'inventory.adjustments.decide.rejectedDone'
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
      aria-labelledby="adjustment-decide-heading"
      className={PANEL}
    >
      <h2 id="adjustment-decide-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.adjustments.decide.heading')}{' '}
        <code className="font-mono" dir="ltr">
          {adjustment.sku}
        </code>
      </h2>
      <p className="text-body">
        {translateDynamic(messages, `inventory.adjustments.direction.${adjustment.direction}`)}{' '}
        <Qty value={adjustment.quantity} />{' '}
        <span className="text-caption text-text-muted" dir="ltr">
          {adjustment.locationCode}
        </span>
      </p>
      <p className="text-caption text-text-muted">{adjustment.reason}</p>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.adjustments.decide.explain')}
      </p>
      <TextAreaField
        label={translate(messages, 'inventory.adjustments.decide.reason')}
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
          {translate(messages, 'inventory.adjustments.decide.approve')}
        </button>
        <button
          type="button"
          className={DANGER_BUTTON}
          disabled={busy}
          onClick={() => {
            void decide('rejected');
          }}
        >
          {translate(messages, 'inventory.adjustments.decide.reject')}
        </button>
        <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
          {translate(messages, 'inventory.stockOps.close')}
        </button>
      </div>
    </form>
  );
}

function RequestForm({
  messages,
  target,
  locations,
  onRequested,
}: {
  readonly messages: Messages;
  readonly target: StockTarget;
  readonly locations: Locations;
  readonly onRequested: () => void;
}) {
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState<{
    locationId: string;
    direction: Direction;
    quantity: string;
    reason: string;
  }>({ locationId: '', direction: 'out', quantity: '', reason: '' });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const errorFor = (name: string) =>
    errors[name] ? translateDynamic(messages, errors[name]) : outcomeField(messages, outcome, name);

  const submit = async () => {
    const found: Record<string, string> = {};
    if (item === null) found['itemId'] = 'field.required';
    if (!form.locationId) found['locationId'] = 'field.required';
    const quantity = form.quantity.trim();
    if (!isQuantity(quantity)) found['quantity'] = 'inventory.stockOps.quantityFormat';
    const reason = form.reason.trim();
    if (reason.length === 0) found['reason'] = 'field.required';
    else if (reason.length > MAX_REASON) found['reason'] = 'inventory.stockOps.reasonTooLong';
    setErrors(found);
    if (Object.keys(found).length > 0 || item === null) return;
    setBusy(true);
    const result = await createAdjustment({
      companyId: target.companyId,
      branchId: target.branchId,
      itemId: item.id,
      locationId: form.locationId,
      direction: form.direction,
      quantity,
      reason,
    });
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      setItem(null);
      setForm({ locationId: '', direction: 'out', quantity: '', reason: '' });
      setOutcome(null);
      onRequested();
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="adjustment-create-heading"
      className={PANEL}
    >
      <h2 id="adjustment-create-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.adjustments.create.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.adjustments.create.explain')}
      </p>
      <ItemFinder
        messages={messages}
        idPrefix="adjustment"
        value={item}
        onChange={setItem}
        error={errorFor('itemId')}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <LocationPicker
          messages={messages}
          locations={locations}
          label={translate(messages, 'inventory.adjustments.create.location')}
          placeholder={translate(messages, 'inventory.stockOps.chooseLocation')}
          required
          value={form.locationId}
          onChange={(next) => setForm((f) => ({ ...f, locationId: next }))}
          error={errorFor('locationId')}
        />
        <TextField
          label={translate(messages, 'inventory.adjustments.create.quantity')}
          description={translate(messages, 'inventory.stockOps.quantityHelp')}
          required
          inputMode="decimal"
          dir="ltr"
          value={form.quantity}
          onChange={(event) => setForm((f) => ({ ...f, quantity: event.target.value }))}
          error={errorFor('quantity')}
        />
      </div>
      <RadioGroupField
        label={translate(messages, 'inventory.adjustments.create.direction')}
        name="adjustment-direction"
        required
        value={form.direction}
        onChange={(next) => setForm((f) => ({ ...f, direction: next as Direction }))}
        options={DIRECTIONS.map((value) => ({
          value,
          label: translateDynamic(messages, `inventory.adjustments.direction.${value}`),
        }))}
      />
      <TextAreaField
        label={translate(messages, 'inventory.stockOps.reason')}
        required
        rows={2}
        value={form.reason}
        onChange={(event) => setForm((f) => ({ ...f, reason: event.target.value }))}
        error={errorFor('reason')}
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'inventory.adjustments.create.submit')}
        </button>
      </div>
    </form>
  );
}
