'use client';

/**
 * Stock counts (P1-32): open a count of one location, record what is physically
 * there, reconcile the variances into pending adjustments, or cancel.
 *
 * ## The variance is aware of what moved during the count
 *
 * Opening a count snapshots what the location holds, and the branch keeps
 * trading while the shelf is counted. Each line therefore shows four figures the
 * server publishes: the snapshot, the net of the movements posted at the
 * location since the snapshot, what was counted, and the variance the database
 * generates from those three. None is computed here, and a line not yet counted
 * says so instead of showing a variance of nothing.
 *
 * ## Recording is version-guarded; reconciling posts nothing
 *
 * Recording a counted quantity sends the COUNT's `recordVersion` as If-Match,
 * taken from the last read or write of this count, and the answer is the whole
 * count again, which replaces what the screen shows. Reconciling raises one
 * PENDING adjustment per variance; the stock changes only when a second person
 * approves each one on the adjustments screen.
 *
 * Permissions: `inv.stock.read` gates the page; `inv.stock.operate` offers
 * opening, recording, reconciling and cancelling; `org.branch.read` the branch
 * picker.
 */

import Link from 'next/link';
import { useState } from 'react';

import { TextAreaField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { formatDateTime } from '@/lib/format';

import {
  cancelStockCount,
  listStockCounts,
  openStockCount,
  readStockCount,
  reconcileStockCount,
  recordStockCountLine,
} from '../api';
import {
  MAX_DESCRIPTION,
  MAX_REASON,
  QUANTITY,
  type StockCountDetail,
  type StockCountLine,
  type StockCountSummary,
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
  Fact,
  LINK,
  PANEL,
  StockOperationLinks,
  outcomeField,
  useBranchList,
} from './stock-operations';

/** The count on screen, with the location code it was chosen by (the detail carries none). */
interface ShownCount {
  readonly count: StockCountDetail;
  readonly locationCode: string;
}

function detailFailureKey(status: string): string {
  if (status === 'denied') return 'inventory.counts.detail.refused';
  if (status === 'not-found') return 'inventory.counts.detail.gone';
  if (status === 'expired') return 'state.expired.title';
  return 'inventory.counts.detail.unavailable';
}

export function StockCountsScreen({
  locale,
  messages,
  canOperate,
  canReadBranches,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** `inv.stock.operate` — open, record, reconcile, cancel. */
  readonly canOperate: boolean;
  /** `org.branch.read` — whether a branch list is requested for the picker. */
  readonly canReadBranches: boolean;
}) {
  const [target, setTarget] = useState<StockTarget | null>(null);
  return (
    <div className="flex min-h-0 flex-col gap-4">
      <StockOperationLinks locale={locale} messages={messages} />
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.counts.explain')}
      </p>
      {!canOperate ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.counts.needsOperate')}
        </p>
      ) : null}
      <BranchTargetForm
        messages={messages}
        canReadBranches={canReadBranches}
        formLabelKey="inventory.counts.targetLabel"
        explainKey="inventory.target.explain"
        submitKey="inventory.counts.chooseBranch"
        onChosen={setTarget}
      />
      {target !== null ? (
        <BranchCounts
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

function BranchCounts({
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
  const { list, reload } = useBranchList<StockCountSummary>(
    target,
    listStockCounts,
    'inventory.counts.list.refused',
    'inventory.counts.list.unavailable'
  );
  const locations = useLocations(target);
  const [shown, setShown] = useState<ShownCount | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [openFailure, setOpenFailure] = useState<string | null>(null);

  const open = async (row: StockCountSummary) => {
    setOpening(row.id);
    setOpenFailure(null);
    const state = await readStockCount(row.id);
    setOpening(null);
    if (state.status !== 'ok') {
      setOpenFailure(detailFailureKey(state.status));
      return;
    }
    setShown({ count: state.data, locationCode: row.locationCode });
  };

  return (
    <>
      <section aria-labelledby="counts-list-heading" className={PANEL}>
        <h2 id="counts-list-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'inventory.counts.list.heading')}
        </h2>
        {openFailure !== null ? (
          <p role="alert" className="text-body text-error">
            {translateDynamic(messages, openFailure)}
          </p>
        ) : null}
        <BranchListView
          messages={messages}
          list={list}
          loadingKey="inventory.counts.list.loading"
          noneKey="inventory.counts.list.none"
          truncatedKey="inventory.counts.list.truncated"
        >
          {(items) => (
            <table className="w-full text-body">
              <caption className="sr-only">
                {translate(messages, 'inventory.counts.list.caption')}
              </caption>
              <thead>
                <tr className="text-caption text-text-muted">
                  <th scope="col" className="text-start font-medium">
                    {translate(messages, 'inventory.counts.column.location')}
                  </th>
                  <th scope="col" className="text-start font-medium">
                    {translate(messages, 'inventory.counts.column.snapshotAt')}
                  </th>
                  <th scope="col" className="text-start font-medium">
                    {translate(messages, 'inventory.counts.column.status')}
                  </th>
                  <th scope="col" className="text-end font-medium">
                    {translate(messages, 'inventory.counts.column.counted')}
                  </th>
                  <th scope="col" className="text-end font-medium">
                    {translate(messages, 'inventory.counts.column.varianceLines')}
                  </th>
                  <th scope="col" className="text-end font-medium">
                    {translate(messages, 'inventory.counts.column.absoluteVariance')}
                  </th>
                  <th scope="col" className="text-end font-medium">
                    {translate(messages, 'inventory.counts.column.action')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td dir="ltr" className="text-start">
                      {row.locationCode}
                    </td>
                    <td dir="ltr" className="text-start">
                      {formatDateTime(row.snapshotAt, locale)}
                    </td>
                    <td>{translateDynamic(messages, `inventory.countStatus.${row.status}`)}</td>
                    <td className="text-end" dir="ltr">
                      {row.countedLineCount} / {row.lineCount}
                    </td>
                    <td className="text-end">{row.varianceLineCount}</td>
                    <td className="text-end">
                      <Qty value={row.absoluteVarianceQty} />
                    </td>
                    <td className="text-end">
                      <button
                        type="button"
                        className={SECONDARY_BUTTON}
                        disabled={opening !== null}
                        onClick={() => {
                          void open(row);
                        }}
                      >
                        {translate(messages, 'inventory.counts.open')}
                        <span className="sr-only"> {row.locationCode}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </BranchListView>
      </section>

      {shown !== null ? (
        <CountDetail
          key={shown.count.id}
          locale={locale}
          messages={messages}
          shown={shown}
          canOperate={canOperate}
          onChanged={(count) => {
            setShown({ count, locationCode: shown.locationCode });
            reload();
          }}
          onClose={() => setShown(null)}
        />
      ) : null}

      {canOperate ? (
        <OpenCountForm
          messages={messages}
          locations={locations}
          onOpened={(count, locationCode) => {
            setShown({ count, locationCode });
            reload();
          }}
        />
      ) : null}
    </>
  );
}

function CountDetail({
  locale,
  messages,
  shown,
  canOperate,
  onChanged,
  onClose,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly shown: ShownCount;
  readonly canOperate: boolean;
  readonly onChanged: (count: StockCountDetail) => void;
  readonly onClose: () => void;
}) {
  const { count } = shown;
  const editable = count.status === 'open' || count.status === 'counting';
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const [raised, setRaised] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const reconcile = async () => {
    setBusy(true);
    const result = await reconcileStockCount(count.id);
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      setRaised(result.created.adjustmentsRaised ?? null);
      onChanged(result.created);
    }
  };

  return (
    <section aria-labelledby="count-detail-heading" className={PANEL}>
      <h2 id="count-detail-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.counts.detail.heading')}{' '}
        <span dir="ltr">{shown.locationCode}</span>
      </h2>
      <dl className="grid gap-2 sm:grid-cols-4">
        <Fact label={translate(messages, 'inventory.counts.column.status')}>
          {translateDynamic(messages, `inventory.countStatus.${count.status}`)}
        </Fact>
        <Fact label={translate(messages, 'inventory.counts.column.snapshotAt')}>
          <span dir="ltr">{formatDateTime(count.snapshotAt, locale)}</span>
        </Fact>
        <Fact label={translate(messages, 'inventory.counts.column.counted')}>
          <span dir="ltr">
            {count.countedLineCount} / {count.lineCount}
          </span>
        </Fact>
        <Fact label={translate(messages, 'inventory.counts.column.absoluteVariance')}>
          <Qty value={count.absoluteVarianceQty} />
        </Fact>
      </dl>
      {count.cancelReason ? (
        <p className="text-caption text-text-muted">{count.cancelReason}</p>
      ) : null}
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.counts.detail.varianceExplain')}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-body">
          <caption className="sr-only">
            {translate(messages, 'inventory.counts.detail.caption')}
          </caption>
          <thead>
            <tr className="text-caption text-text-muted">
              <th scope="col" className="text-start font-medium">
                {translate(messages, 'inventory.counts.line.item')}
              </th>
              <th scope="col" className="text-end font-medium">
                {translate(messages, 'inventory.counts.line.snapshot')}
              </th>
              <th scope="col" className="text-end font-medium">
                {translate(messages, 'inventory.counts.line.movements')}
              </th>
              <th scope="col" className="text-end font-medium">
                {translate(messages, 'inventory.counts.line.counted')}
              </th>
              <th scope="col" className="text-end font-medium">
                {translate(messages, 'inventory.counts.line.variance')}
              </th>
              <th scope="col" className="text-start font-medium">
                {translate(messages, 'inventory.counts.line.adjustment')}
              </th>
            </tr>
          </thead>
          <tbody>
            {count.lines.map((line) => (
              <CountLineRow
                key={line.id}
                messages={messages}
                count={count}
                line={line}
                canRecord={canOperate && editable}
                onRecorded={onChanged}
              />
            ))}
          </tbody>
        </table>
      </div>
      {count.lines.length === 0 ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.counts.detail.noLines')}
        </p>
      ) : null}

      {raised !== null ? (
        <p role="status" className="text-body text-text-primary">
          {translate(messages, 'inventory.counts.reconcile.raised')}{' '}
          <strong dir="ltr">{raised}</strong>{' '}
          <Link href={`/${locale}/inventory/adjustments`} className={LINK}>
            {translate(messages, 'inventory.counts.reconcile.seeAdjustments')}
          </Link>
        </p>
      ) : null}

      {canOperate && editable ? (
        <>
          <p className="text-caption text-text-muted">
            {translate(messages, 'inventory.counts.reconcile.explain')}
          </p>
          <OutcomeNote messages={messages} outcome={outcome} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={PRIMARY_BUTTON}
              disabled={busy}
              onClick={() => {
                void reconcile();
              }}
            >
              {translate(messages, 'inventory.counts.reconcile.action')}
            </button>
            <button type="button" className={DANGER_BUTTON} onClick={() => setCancelling(true)}>
              {translate(messages, 'inventory.counts.cancel.action')}
            </button>
          </div>
        </>
      ) : null}
      {cancelling && editable ? (
        <CancelCountForm
          messages={messages}
          count={count}
          onClose={() => setCancelling(false)}
          onCancelled={(cancelled) => {
            setCancelling(false);
            onChanged(cancelled);
          }}
        />
      ) : null}
      <div>
        <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
          {translate(messages, 'inventory.stockOps.close')}
        </button>
      </div>
    </section>
  );
}

function CountLineRow({
  messages,
  count,
  line,
  canRecord,
  onRecorded,
}: {
  readonly messages: Messages;
  readonly count: StockCountDetail;
  readonly line: StockCountLine;
  readonly canRecord: boolean;
  readonly onRecorded: (count: StockCountDetail) => void;
}) {
  const [value, setValue] = useState(line.countedQty ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const record = async () => {
    const counted = value.trim();
    // Zero is a legitimate count — an empty shelf — so only the shape is checked.
    if (!QUANTITY.test(counted)) {
      setError('inventory.counts.line.format');
      return;
    }
    setError(null);
    setBusy(true);
    // The COUNT's version as this screen last received it from the server.
    const result = await recordStockCountLine(
      count.id,
      line.itemId,
      { countedQty: counted },
      count.recordVersion
    );
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) onRecorded(result.created);
  };

  const fieldError = error
    ? translateDynamic(messages, error)
    : outcomeField(messages, outcome, 'countedQty');

  return (
    <tr className="border-t border-border align-top">
      <td>
        <code className="font-mono text-caption" dir="ltr">
          {line.sku}
        </code>
      </td>
      <td className="text-end">
        <Qty value={line.snapshotQty} />
      </td>
      <td className="text-end">
        <Qty value={line.movementDeltaDuringCount} />
      </td>
      <td className="text-end">
        {canRecord ? (
          <div className="flex flex-col items-end gap-1">
            <TextField
              label={translate(messages, 'inventory.counts.line.countedField')}
              description={line.sku}
              inputMode="decimal"
              dir="ltr"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              error={fieldError}
            />
            <OutcomeNote messages={messages} outcome={outcome} />
            <button
              type="button"
              className={SECONDARY_BUTTON}
              disabled={busy}
              onClick={() => {
                void record();
              }}
            >
              {translate(messages, 'inventory.counts.line.save')}
              <span className="sr-only"> {line.sku}</span>
            </button>
          </div>
        ) : line.countedQty === null ? (
          <span className="text-caption text-text-muted">
            {translate(messages, 'inventory.counts.line.notCounted')}
          </span>
        ) : (
          <Qty value={line.countedQty} />
        )}
      </td>
      <td className="text-end">
        {line.varianceQty === null ? (
          <span className="text-caption text-text-muted">
            {translate(messages, 'inventory.counts.line.notCounted')}
          </span>
        ) : (
          <strong>
            <Qty value={line.varianceQty} />
          </strong>
        )}
      </td>
      <td>
        {line.adjustmentStatus === null ? (
          <span className="text-caption text-text-muted">
            {translate(messages, 'inventory.counts.line.noAdjustment')}
          </span>
        ) : (
          translateDynamic(messages, `inventory.adjustmentStatus.${line.adjustmentStatus}`)
        )}
      </td>
    </tr>
  );
}

function CancelCountForm({
  messages,
  count,
  onClose,
  onCancelled,
}: {
  readonly messages: Messages;
  readonly count: StockCountDetail;
  readonly onClose: () => void;
  readonly onCancelled: (count: StockCountDetail) => void;
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
    const result = await cancelStockCount(count.id, { reason: why });
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) onCancelled(result.created);
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="count-cancel-heading"
      className="flex flex-col gap-3 border-t border-border pt-3"
    >
      <h3 id="count-cancel-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.counts.cancel.heading')}
      </h3>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.counts.cancel.explain')}
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
          {translate(messages, 'inventory.counts.cancel.submit')}
        </button>
        <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
          {translate(messages, 'inventory.stockOps.close')}
        </button>
      </div>
    </form>
  );
}

function OpenCountForm({
  messages,
  locations,
  onOpened,
}: {
  readonly messages: Messages;
  readonly locations: Locations;
  readonly onOpened: (count: StockCountDetail, locationCode: string) => void;
}) {
  const [locationId, setLocationId] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());

  const errorFor = (name: string) =>
    errors[name] ? translateDynamic(messages, errors[name]) : outcomeField(messages, outcome, name);

  const submit = async () => {
    const found: Record<string, string> = {};
    if (!locationId) found['locationId'] = 'field.required';
    const text = notes.trim();
    if (text.length > MAX_DESCRIPTION) found['notes'] = 'inventory.setup.descriptionTooLong';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    const result = await openStockCount({
      locationId,
      idempotencyKey: attemptKey,
      ...(text.length > 0 ? { notes: text } : {}),
    });
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      const code =
        locations.items?.find((row) => row.id === locationId)?.locationCode ?? locationId;
      setLocationId('');
      setNotes('');
      setOutcome(null);
      setAttemptKey(crypto.randomUUID());
      onOpened(result.created, code);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="count-open-heading"
      className={PANEL}
    >
      <h2 id="count-open-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.counts.openForm.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.counts.openForm.explain')}
      </p>
      <LocationPicker
        messages={messages}
        locations={locations}
        label={translate(messages, 'inventory.counts.openForm.location')}
        placeholder={translate(messages, 'inventory.stockOps.chooseLocation')}
        required
        value={locationId}
        onChange={setLocationId}
        error={errorFor('locationId')}
      />
      <TextAreaField
        label={translate(messages, 'inventory.counts.openForm.notes')}
        rows={2}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        error={errorFor('notes')}
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'inventory.counts.openForm.submit')}
        </button>
      </div>
    </form>
  );
}
