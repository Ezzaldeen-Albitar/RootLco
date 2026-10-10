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
 *
 * ## On Material UI (ADR-022, `P1-32-PRE-OD-INV5`)
 *
 * Every control this screen draws itself is a shared wrapper: the counted
 * quantity is `FormNumberField` (the string typed is the string sent), the
 * notes and the cancel reason are multi-line `FormTextField`s, every button is
 * Material's, and the two lists are Material's table — the count list answers
 * one bounded page with a "more exist" flag and no cursor (planner ruling of
 * 2026-10-09), and a count's lines are the whole of that count. The location
 * select and the list's wait, empty and failed states are the shared inventory
 * pieces. A count's start is written on the branch's clock, with the clock
 * named (`StockMoment`), never on the browser's.
 *
 * Each write is held to one at a time by a ref set before anything is awaited,
 * so a second press inside the same frame sends nothing. Opening a count moves
 * the cursor to its heading, and closing it returns the cursor to the row's
 * Open button; the cancel form takes the cursor into its reason box and gives
 * it back to "Cancel count" when it closes.
 */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';

import { FormNumberField } from '@/components/forms/mui/FormNumberField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';

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
import { LocationPicker, OutcomeNote, Qty, useLocations, type Locations } from './shared';
import { StockAlertIndicator } from './StockAlertIndicator';
import {
  BranchListView,
  BranchTargetForm,
  Fact,
  LINK,
  PANEL,
  StockMoment,
  StockOperationLinks,
  outcomeField,
  refusalState,
  useBranchList,
  useFocusOnOpen,
  useReturnFocus,
  useStockDisplayZone,
} from './stock-operations';

/** The count on screen, with the location code it was chosen by (the detail carries none). */
interface ShownCount {
  readonly count: StockCountDetail;
  readonly locationCode: string;
}

function detailFailureKey(status: string): string {
  if (status === 'denied') return 'inventory.counts.detail.refused';
  if (status === 'not-found') return 'inventory.counts.detail.gone';
  if (status === 'expired') return 'state.expired.message';
  return 'inventory.counts.detail.unavailable';
}

export function StockCountsScreen({
  locale,
  messages,
  canOperate,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** `inv.stock.operate` — open, record, reconcile, cancel. */
  readonly canOperate: boolean;
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
        {translate(messages, 'inventory.counts.explain')}
      </p>
      {!canOperate ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.counts.needsOperate')}
        </p>
      ) : null}
      <BranchTargetForm
        messages={messages}
        formLabelKey="inventory.counts.targetLabel"
        explainKey="inventory.target.explain"
        onChosen={setTarget}
      />
      {/*
        The same two signals the Attention area carries, beside the counts that
        raise half of them. Reads only, and silent until a branch is named.
      */}
      <StockAlertIndicator messages={messages} locale={locale} target={target} />
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
  const zone = useStockDisplayZone(target);
  const [shown, setShown] = useState<ShownCount | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [openFailure, setOpenFailure] = useState<string | null>(null);
  // One read of a count at a time, before `opening` has disabled the buttons.
  const reading = useRef(false);
  const sectionRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  /*
   * The count whose Open button takes the cursor back once its panel closes.
   * Held across renders because the list is read again after every write, and
   * the row's button only exists again once that read has answered.
   */
  const returnTo = useRef<string | null>(null);

  useEffect(() => {
    const id = returnTo.current;
    if (id === null || list.phase === 'loading') return;
    returnTo.current = null;
    const now = document.activeElement;
    if (now !== null && now !== document.body) return;
    const button = sectionRef.current?.querySelector<HTMLElement>(`[data-count-open="${id}"]`);
    (button ?? headingRef.current)?.focus();
  });

  const open = async (row: StockCountSummary) => {
    if (reading.current) return;
    reading.current = true;
    setOpening(row.id);
    setOpenFailure(null);
    const state = await readStockCount(row.id);
    reading.current = false;
    setOpening(null);
    if (state.status !== 'ok') {
      setOpenFailure(detailFailureKey(state.status));
      return;
    }
    setShown({ count: state.data, locationCode: row.locationCode });
  };

  return (
    <>
      <section
        ref={sectionRef}
        aria-labelledby="counts-list-heading"
        className={PANEL}
        lang={locale}
      >
        <h2
          ref={headingRef}
          id="counts-list-heading"
          tabIndex={-1}
          className="text-body font-medium text-text-primary"
        >
          {translate(messages, 'inventory.counts.list.heading')}
        </h2>
        {openFailure !== null ? (
          <p role="alert" className="text-body text-error">
            {translateDynamic(messages, openFailure)}
          </p>
        ) : null}
        <BranchListView
          messages={messages}
          locale={locale}
          list={list}
          loadingKey="inventory.counts.list.loading"
          noneKey="inventory.counts.list.none"
          truncatedKey="inventory.counts.list.truncated"
        >
          {(items) => (
            <TableContainer>
              <Table size="small">
                <caption className="sr-only">
                  {translate(messages, 'inventory.counts.list.caption')}
                </caption>
                <TableHead>
                  <TableRow>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.counts.column.location')}
                    </TableCell>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.counts.column.snapshotAt')}
                    </TableCell>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.counts.column.status')}
                    </TableCell>
                    <TableCell scope="col" align="right">
                      {translate(messages, 'inventory.counts.column.counted')}
                    </TableCell>
                    <TableCell scope="col" align="right">
                      {translate(messages, 'inventory.counts.column.varianceLines')}
                    </TableCell>
                    <TableCell scope="col" align="right">
                      {translate(messages, 'inventory.counts.column.absoluteVariance')}
                    </TableCell>
                    <TableCell scope="col" align="right">
                      {translate(messages, 'inventory.counts.column.action')}
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <code className="font-mono text-caption" dir="ltr">
                          {row.locationCode}
                        </code>
                      </TableCell>
                      <TableCell>
                        <StockMoment value={row.snapshotAt} locale={locale} zone={zone} />
                      </TableCell>
                      <TableCell>
                        {translateDynamic(messages, `inventory.countStatus.${row.status}`)}
                      </TableCell>
                      <TableCell align="right">
                        <span dir="ltr">
                          {row.countedLineCount} / {row.lineCount}
                        </span>
                      </TableCell>
                      <TableCell align="right">
                        <span dir="ltr">{row.varianceLineCount}</span>
                      </TableCell>
                      <TableCell align="right">
                        <Qty value={row.absoluteVarianceQty} />
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          type="button"
                          variant="outlined"
                          size="small"
                          data-count-open={row.id}
                          disabled={opening !== null}
                          onClick={() => {
                            void open(row);
                          }}
                        >
                          {translate(messages, 'inventory.counts.open')}
                          <span className="sr-only"> {row.locationCode}</span>
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

      {shown !== null ? (
        <CountDetail
          key={shown.count.id}
          locale={locale}
          messages={messages}
          shown={shown}
          zone={zone}
          canOperate={canOperate}
          onChanged={(count) => {
            setShown({ count, locationCode: shown.locationCode });
            reload();
          }}
          onClose={() => {
            returnTo.current = shown.count.id;
            setShown(null);
          }}
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
  zone,
  canOperate,
  onChanged,
  onClose,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly shown: ShownCount;
  /** The branch's clock (`useStockDisplayZone`), UTC where it is not known. */
  readonly zone: string;
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
  // One reconciliation in flight at a time, before `busy` has disabled the button.
  const sending = useRef(false);
  const headingRef = useFocusOnOpen<HTMLHeadingElement>();
  const cancelRef = useReturnFocus<HTMLButtonElement>(cancelling);

  /*
   * A count that stops being editable — reconciled or cancelled from here —
   * takes away the button the cursor was on. The cursor then goes back to the
   * count's heading rather than to the top of the page.
   */
  useEffect(() => {
    if (editable) return;
    const now = document.activeElement;
    if (now === null || now === document.body) headingRef.current?.focus();
  }, [editable, headingRef]);

  const reconcile = async () => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    const result = await reconcileStockCount(count.id);
    sending.current = false;
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      setRaised(result.created.adjustmentsRaised ?? null);
      onChanged(result.created);
    }
  };

  return (
    <section aria-labelledby="count-detail-heading" className={PANEL} lang={locale}>
      <h2
        ref={headingRef}
        id="count-detail-heading"
        tabIndex={-1}
        className="text-body font-medium text-text-primary"
      >
        {translate(messages, 'inventory.counts.detail.heading')}{' '}
        <span dir="ltr">{shown.locationCode}</span>
      </h2>
      <dl className="grid gap-2 sm:grid-cols-4">
        <Fact label={translate(messages, 'inventory.counts.column.status')}>
          {translateDynamic(messages, `inventory.countStatus.${count.status}`)}
        </Fact>
        <Fact label={translate(messages, 'inventory.counts.column.snapshotAt')}>
          <StockMoment value={count.snapshotAt} locale={locale} zone={zone} />
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
        <p className="text-caption text-text-muted">
          <bdi>{count.cancelReason}</bdi>
        </p>
      ) : null}
      {/*
       * DEF-T-04. `movement_delta_during_count` DEFAULTS to zero and is written
       * by `inv.reconcile_stock_count` and by nothing else, so while a count is
       * open every line holds a zero that was never measured. Printed as a
       * quantity beside three that WERE measured, it reads as "nothing moved",
       * and the campaign read it that way over five units received into the
       * same place while the count was open. So the figure is shown only once
       * the count is reconciled, and until then the screen says when it will be
       * worked out rather than presenting a default as an observation.
       *
       * The difference carries the same zero. `variance_qty` is GENERATED as
       * `counted_qty - (snapshot_qty + movement_delta_during_count)`, so while
       * the count is open every difference on the screen — each line's and the
       * total above — is counted against the opening quantity alone. Stating
       * the reconciled definition there would be a false claim about what the
       * figures beside it mean, so the sentence is the open one until the count
       * is reconciled, and both are recomputed by the server at reconciliation.
       */}
      {count.status === 'reconciled' ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.counts.detail.varianceExplain')}
        </p>
      ) : (
        <>
          <p className="text-caption text-text-muted">
            {translate(messages, 'inventory.counts.detail.varianceExplainOpen')}
          </p>
          <p className="text-caption text-text-muted">
            {translate(messages, 'inventory.counts.detail.movementsPending')}
          </p>
        </>
      )}
      <TableContainer>
        <Table size="small">
          <caption className="sr-only">
            {translate(messages, 'inventory.counts.detail.caption')}
          </caption>
          <TableHead>
            <TableRow>
              <TableCell scope="col">{translate(messages, 'inventory.counts.line.item')}</TableCell>
              <TableCell scope="col" align="right">
                {translate(messages, 'inventory.counts.line.snapshot')}
              </TableCell>
              <TableCell scope="col" align="right">
                {translate(messages, 'inventory.counts.line.movements')}
              </TableCell>
              <TableCell scope="col" align="right">
                {translate(messages, 'inventory.counts.line.counted')}
              </TableCell>
              <TableCell scope="col" align="right">
                {translate(messages, 'inventory.counts.line.variance')}
              </TableCell>
              <TableCell scope="col">
                {translate(messages, 'inventory.counts.line.adjustment')}
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
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
          </TableBody>
        </Table>
      </TableContainer>
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
            <Button
              type="button"
              variant="contained"
              disabled={busy}
              onClick={() => {
                void reconcile();
              }}
            >
              {translate(messages, 'inventory.counts.reconcile.action')}
            </Button>
            <Button
              ref={cancelRef}
              type="button"
              variant="outlined"
              color="error"
              aria-expanded={cancelling}
              onClick={() => setCancelling(true)}
            >
              {translate(messages, 'inventory.counts.cancel.action')}
            </Button>
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
        <Button type="button" variant="outlined" onClick={onClose}>
          {translate(messages, 'inventory.stockOps.close')}
        </Button>
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
  // What the server last holds for this line, as this row sent or received it.
  // Compared against rather than `line.countedQty`, which the server may
  // restate in a different but equal spelling.
  const [saved, setSaved] = useState(line.countedQty ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  // One record of this line in flight at a time, before `busy` has disabled Save.
  const sending = useRef(false);
  // A count typed and not yet recorded is lost if the branch changes.
  useUnsavedGuard(value.trim() !== saved.trim());

  const record = async () => {
    if (sending.current) return;
    const counted = value.trim();
    // Zero is a legitimate count — an empty shelf — so only the shape is checked.
    if (!QUANTITY.test(counted)) {
      setError('inventory.counts.line.format');
      return;
    }
    setError(null);
    sending.current = true;
    setBusy(true);
    // The COUNT's version as this screen last received it from the server.
    const result = await recordStockCountLine(
      count.id,
      line.itemId,
      { countedQty: counted },
      count.recordVersion
    );
    sending.current = false;
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      setSaved(counted);
      onRecorded(result.created);
    }
  };

  const fieldError = error
    ? translateDynamic(messages, error)
    : outcomeField(messages, outcome, 'countedQty');

  return (
    <TableRow className="align-top">
      <TableCell>
        <code className="font-mono text-caption" dir="ltr">
          {line.sku}
        </code>
      </TableCell>
      <TableCell align="right">
        <Qty value={line.snapshotQty} />
      </TableCell>
      <TableCell align="right">
        {count.status === 'reconciled' ? (
          <Qty value={line.movementDeltaDuringCount} />
        ) : (
          <span className="text-caption text-text-muted">
            {translate(messages, 'inventory.counts.line.movementsAtReconcile')}
          </span>
        )}
      </TableCell>
      <TableCell align="right">
        {canRecord ? (
          <div className="flex flex-col items-end gap-1">
            <FormNumberField
              label={translate(messages, 'inventory.counts.line.countedField')}
              description={line.sku}
              value={value}
              onChange={setValue}
              error={fieldError}
            />
            <OutcomeNote messages={messages} outcome={outcome} />
            <Button
              type="button"
              variant="outlined"
              size="small"
              disabled={busy}
              onClick={() => {
                void record();
              }}
            >
              {translate(messages, 'inventory.counts.line.save')}
              <span className="sr-only"> {line.sku}</span>
            </Button>
          </div>
        ) : line.countedQty === null ? (
          <span className="text-caption text-text-muted">
            {translate(messages, 'inventory.counts.line.notCounted')}
          </span>
        ) : (
          <Qty value={line.countedQty} />
        )}
      </TableCell>
      <TableCell align="right">
        {line.varianceQty === null ? (
          <span className="text-caption text-text-muted">
            {translate(messages, 'inventory.counts.line.notCounted')}
          </span>
        ) : (
          <strong>
            <Qty value={line.varianceQty} />
          </strong>
        )}
      </TableCell>
      <TableCell>
        {line.adjustmentStatus === null ? (
          <span className="text-caption text-text-muted">
            {translate(messages, 'inventory.counts.line.noAdjustment')}
          </span>
        ) : (
          translateDynamic(messages, `inventory.adjustmentStatus.${line.adjustmentStatus}`)
        )}
      </TableCell>
    </TableRow>
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
  const [refusals, setRefusals] = useState(0);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  // One cancellation in flight at a time, before `busy` has disabled the button.
  const sending = useRef(false);
  useUnsavedGuard(reason.trim().length > 0);
  const formRef = useFocusFirstInvalid(
    refusalState(error ? { reason: error } : {}, refusals, outcome)
  );

  const submit = async () => {
    if (sending.current) return;
    const why = reason.trim();
    if (why.length === 0 || why.length > MAX_REASON) {
      setError(why.length === 0 ? 'field.required' : 'inventory.stockOps.reasonTooLong');
      setRefusals((n) => n + 1);
      return;
    }
    setError(null);
    sending.current = true;
    setBusy(true);
    const result = await cancelStockCount(count.id, { reason: why });
    sending.current = false;
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) onCancelled(result.created);
  };

  return (
    <form
      ref={formRef}
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
      <FormTextField
        label={translate(messages, 'inventory.stockOps.reason')}
        required
        multiline
        rows={2}
        autoFocus
        value={reason}
        onChange={setReason}
        error={
          error ? translateDynamic(messages, error) : outcomeField(messages, outcome, 'reason')
        }
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="outlined" color="error" disabled={busy}>
          {translate(messages, 'inventory.counts.cancel.submit')}
        </Button>
        <Button type="button" variant="outlined" onClick={onClose}>
          {translate(messages, 'inventory.stockOps.close')}
        </Button>
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
  const [refusals, setRefusals] = useState(0);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());
  // One count opened at a time, before `busy` has disabled the button.
  const sending = useRef(false);
  // The location is one of THIS branch's, so a switch asks before dropping it.
  useUnsavedGuard(locationId !== '' || notes.trim().length > 0);
  const formRef = useFocusFirstInvalid(refusalState(errors, refusals, outcome));

  const errorFor = (name: string) =>
    errors[name] ? translateDynamic(messages, errors[name]) : outcomeField(messages, outcome, name);

  const submit = async () => {
    if (sending.current) return;
    const found: Record<string, string> = {};
    if (!locationId) found['locationId'] = 'field.required';
    const text = notes.trim();
    if (text.length > MAX_DESCRIPTION) found['notes'] = 'inventory.setup.descriptionTooLong';
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setRefusals((n) => n + 1);
      return;
    }
    sending.current = true;
    setBusy(true);
    const result = await openStockCount({
      locationId,
      idempotencyKey: attemptKey,
      ...(text.length > 0 ? { notes: text } : {}),
    });
    sending.current = false;
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
      ref={formRef}
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
      <FormTextField
        label={translate(messages, 'inventory.counts.openForm.notes')}
        multiline
        rows={2}
        value={notes}
        onChange={setNotes}
        error={errorFor('notes')}
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <Button type="submit" variant="contained" disabled={busy}>
          {translate(messages, 'inventory.counts.openForm.submit')}
        </Button>
      </div>
    </form>
  );
}
