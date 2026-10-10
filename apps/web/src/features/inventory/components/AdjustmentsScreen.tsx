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
 *
 * ## On Material UI (ADR-022, `P1-32-PRE-OD-INV3`)
 *
 * Every control this screen draws itself is a shared wrapper: the status, the
 * quantity, the change and the two reasons are `forms/mui` fields (the quantity
 * `FormNumberField`, so the string typed is the string sent), every button is
 * Material's, and the list is Material's table — the read answers one page of
 * up to fifty with a "more exist" flag and no cursor is walked, so there is
 * nothing for `OperationalGrid`'s pager to do. The item finder, the location
 * select and the list's wait, empty and failed states are the shared inventory
 * pieces (`ItemFinder`, `LocationPicker`, `BranchListView`), drawn as those
 * pieces draw. What is read, sent, authorized and refused is unchanged.
 */

import { useRef, useState } from 'react';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';

import { FormNumberField } from '@/components/forms/mui/FormNumberField';
import { FormRadioGroupField } from '@/components/forms/mui/FormRadioGroupField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';

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
import { LocationPicker, OutcomeNote, Qty, useLocations, type Locations } from './shared';
import {
  BranchListView,
  BranchTargetForm,
  ItemFinder,
  PANEL,
  StockMoment,
  StockOperationLinks,
  isQuantity,
  outcomeField,
  useBranchList,
  useStockDisplayZone,
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
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** The signed-in person, compared with `requestedBy` to say why a decision is not offered. */
  readonly currentUserId: string;
  /** `inv.stock.operate` — requesting an adjustment. */
  readonly canOperate: boolean;
  /** `inv.adjustment.approve` — approving or rejecting someone else's request. */
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
        {translate(messages, 'inventory.adjustments.explain')}
      </p>
      <BranchTargetForm
        messages={messages}
        formLabelKey="inventory.adjustments.targetLabel"
        explainKey="inventory.target.explain"
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
  // Each request's moment is written on the branch's clock, named (`P1-32-PRE-OD-INV5`).
  const zone = useStockDisplayZone(target);
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
          <FormSelectField
            label={translate(messages, 'inventory.adjustments.list.status')}
            value={status}
            onChange={(next) => {
              setStatus(next as AdjustmentState | 'all');
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
          locale={locale}
          list={list}
          loadingKey="inventory.adjustments.list.loading"
          noneKey="inventory.adjustments.list.none"
          truncatedKey="inventory.adjustments.list.truncated"
        >
          {(items) => (
            <TableContainer>
              <Table size="small">
                <caption className="sr-only">
                  {translate(messages, 'inventory.adjustments.list.caption')}
                </caption>
                <TableHead>
                  <TableRow>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.adjustments.column.item')}
                    </TableCell>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.adjustments.column.change')}
                    </TableCell>
                    <TableCell scope="col" align="right">
                      {translate(messages, 'inventory.adjustments.column.quantity')}
                    </TableCell>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.adjustments.column.reason')}
                    </TableCell>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.adjustments.column.status')}
                    </TableCell>
                    <TableCell scope="col" align="right">
                      {translate(messages, 'inventory.adjustments.column.decision')}
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.map((row) => {
                    const own = row.requestedBy === currentUserId;
                    return (
                      <TableRow key={row.id} className="align-top">
                        <TableCell>
                          <code className="font-mono text-caption" dir="ltr">
                            {row.sku}
                          </code>
                          <span className="block text-caption text-text-muted" dir="ltr">
                            {row.locationCode}
                          </span>
                        </TableCell>
                        <TableCell>
                          {translateDynamic(
                            messages,
                            `inventory.adjustments.direction.${row.direction}`
                          )}
                        </TableCell>
                        <TableCell align="right">
                          <Qty value={row.quantity} />
                        </TableCell>
                        <TableCell>
                          {row.reason}
                          <span className="block text-caption text-text-muted">
                            <StockMoment value={row.createdAt} locale={locale} zone={zone} />
                          </span>
                        </TableCell>
                        <TableCell>
                          {translateDynamic(messages, `inventory.adjustmentStatus.${row.status}`)}
                          {own ? (
                            <span className="block text-caption text-text-muted">
                              {translate(messages, 'inventory.adjustments.byYou')}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell align="right">
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
                            <Button
                              type="button"
                              variant="outlined"
                              size="small"
                              onClick={() => setDeciding(row)}
                            >
                              {translate(messages, 'inventory.adjustments.decide.action')}
                              <span className="sr-only"> {row.sku}</span>
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
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
  /*
   * One decision in flight at a time. `busy` disables both buttons, but only
   * once React has rendered; a second press inside the same moment would
   * otherwise send a second decision.
   */
  const sending = useRef(false);
  // Unsaved work, declared to the shell: a branch switch asks before it closes this.
  useUnsavedGuard(reason.trim().length > 0);

  const decide = async (decision: AdjustmentDecision) => {
    if (sending.current) return;
    const why = reason.trim();
    if (why.length === 0 || why.length > MAX_REASON) {
      setError(why.length === 0 ? 'field.required' : 'inventory.stockOps.reasonTooLong');
      return;
    }
    setError(null);
    sending.current = true;
    setBusy(true);
    const result = await decideAdjustment(adjustment.id, { decision, reason: why });
    sending.current = false;
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
      <FormTextField
        label={translate(messages, 'inventory.adjustments.decide.reason')}
        required
        multiline
        rows={2}
        value={reason}
        onChange={setReason}
        error={
          error ? translateDynamic(messages, error) : outcomeField(messages, outcome, 'reason')
        }
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="contained" disabled={busy}>
          {translate(messages, 'inventory.adjustments.decide.approve')}
        </Button>
        <Button
          type="button"
          variant="outlined"
          color="error"
          disabled={busy}
          onClick={() => {
            void decide('rejected');
          }}
        >
          {translate(messages, 'inventory.adjustments.decide.reject')}
        </Button>
        <Button type="button" variant="outlined" onClick={onClose}>
          {translate(messages, 'inventory.stockOps.close')}
        </Button>
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
  // One request in flight at a time, before `busy` has disabled the button.
  const sending = useRef(false);
  /*
   * Unsaved work, declared to the shell. The request is addressed to THIS
   * branch and names one of its locations, so a switch asks first; a confirmed
   * switch remounts the form empty under the new branch.
   */
  useUnsavedGuard(
    item !== null ||
      form.locationId !== '' ||
      form.direction !== 'out' ||
      form.quantity.trim().length > 0 ||
      form.reason.trim().length > 0
  );

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
    if (Object.keys(found).length > 0 || item === null || sending.current) return;
    sending.current = true;
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
    sending.current = false;
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
        <FormNumberField
          label={translate(messages, 'inventory.adjustments.create.quantity')}
          description={translate(messages, 'inventory.stockOps.quantityHelp')}
          required
          value={form.quantity}
          onChange={(next) => setForm((f) => ({ ...f, quantity: next }))}
          error={errorFor('quantity')}
        />
      </div>
      <FormRadioGroupField
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
      <FormTextField
        label={translate(messages, 'inventory.stockOps.reason')}
        required
        multiline
        rows={2}
        value={form.reason}
        onChange={(next) => setForm((f) => ({ ...f, reason: next }))}
        error={errorFor('reason')}
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <Button type="submit" variant="contained" disabled={busy}>
          {translate(messages, 'inventory.adjustments.create.submit')}
        </Button>
      </div>
    </form>
  );
}
