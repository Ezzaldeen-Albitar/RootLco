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
 * ## A batch is reachable again, so the rule is satisfiable by two people
 *
 * `inv.opening-batch-list` lists a branch's batches and `inv.opening-batch-read`
 * reads one back with its counted lines — both on `inv.stock.read`, the code
 * this page already gates on. So the screen no longer renders only what it
 * happens to hold: an operator who reloaded, or signed in again, opens their
 * draft from the list, and the SECOND person — the one the maker-and-checker
 * rule requires — finds the batch in their own session and approves it there.
 * Everything shown after a batch is opened is the server's answer, not this
 * page's memory.
 *
 * ## Maker ≠ checker
 *
 * The server refuses the person who counted the batch as its approver (409).
 * That refusal is rendered as published; the screen offers the approval to
 * whoever holds `inv.adjustment.approve` and says a second person is needed
 * when the refusal arrives. Nothing is computed here: quantities are the exact
 * decimal strings the operator typed and the server echoed or published, and
 * the line count beside a listed batch is the server's own figure.
 *
 * Permissions: `inv.stock.read` gates the page (the batch list, the batch read
 * and the location list are all that code); `inv.stock.operate` offers the
 * batch and line forms;
 * `inv.adjustment.approve` offers the approval; `org.branch.read` the branch
 * picker.
 *
 * ## On Material UI (ADR-022, `P1-32-PRE-OD-INV3`)
 *
 * Every control this screen draws itself is a shared wrapper: the batch code,
 * the notes, the item search and the item are `forms/mui` fields, the quantity
 * `FormNumberField` (the string typed is the string sent), the count's date a
 * `DateField` (the same `YYYY-MM-DD` the native box produced), and every
 * button is Material's. The batch list and the counted lines are Material's
 * table — the list is one page of up to fifty with a "more exist" flag and no
 * cursor is walked, so there is nothing for `OperationalGrid`'s pager to do —
 * and the list's empty and failed answers are the shared states carrying this
 * screen's own sentences. The location select is the shared `LocationPicker`,
 * drawn as it draws. What is read, sent, authorized and refused is unchanged,
 * and so is the one-opening-per-stock-cell rule the server enforces.
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { DateField, type DayProblem } from '@/components/forms/mui/DateField';
import { FormNumberField } from '@/components/forms/mui/FormNumberField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiEmptyState, MuiReadFailureState } from '@/components/states/MuiStates';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { VIOLATION_KEY_PREFIX } from '@/lib/api/client';
import type { ActionState } from '@/lib/forms/action-result';
import {
  approveOpeningBatch,
  createOpeningBatch,
  createOpeningBatchLine,
  listItems,
  listOpeningBatches,
  readOpeningBatch,
} from '../api';
import {
  ISO_DATE,
  LOCATION_CODE,
  MAX_DESCRIPTION,
  MAX_NAME,
  QUANTITY,
  type InventoryItem,
  type OpeningBatch,
  type OpeningBatchLine,
  type OpeningBatchSummary,
  type StockTarget,
} from '../inventory-contract';
import { LocationPicker, OutcomeNote, Qty, UUID, useLocations } from './shared';
import { BranchTargetForm } from './stock-operations';

const LINK = 'text-primary underline-offset-2 hover:underline';
const PANEL = 'flex flex-col gap-3 rounded-lg border border-border bg-surface p-4';

/** A line as the screen shows it: the server's echo plus the labels the operator chose it by. */
interface ShownLine {
  readonly line: OpeningBatchLine;
  readonly sku: string;
  readonly itemName: string;
  readonly locationCode: string;
}

/**
 * The branch's batches as one of four outcomes rather than three fields, on the
 * precedent `Branches` in `./shared` records: `items === null` cannot say
 * whether a read is in flight or came back refused, and rendering a refusal as
 * "this branch has no opening batch yet" would tell an approver that the batch
 * they were asked to approve does not exist.
 *
 * `retry` is `null` where a second attempt cannot help — a refusal and a dead
 * session are the same shape — which is the rule `shared.tsx` settled.
 */
type BatchList =
  | { readonly phase: 'loading' }
  | {
      readonly phase: 'listed';
      readonly items: readonly OpeningBatchSummary[];
      /** The server's `hasMore`; the screen says so rather than implying it listed everything. */
      readonly truncated: boolean;
    }
  | { readonly phase: 'none' }
  | {
      readonly phase: 'failed';
      /** Which failure, so it is drawn as that state (`MuiReadFailureState`). */
      readonly status: 'denied' | 'expired' | 'unavailable';
      readonly messageKey:
        'inventory.opening.batches.refused' | 'inventory.opening.batches.unavailable';
      readonly correlationId: string | null;
      readonly retry: (() => void) | null;
    };

const LIST_LOADING: BatchList = { phase: 'loading' };
const LIST_NONE: BatchList = { phase: 'none' };

/**
 * `inv.opening-batch-list` for the chosen branch, and a way to ask again.
 *
 * `reload` is called after every write this screen makes, because the list
 * states a status and a line count that the write just changed; a list still
 * saying `draft` after an approval would be the screen contradicting itself.
 */
function useOpeningBatches(target: StockTarget | null): {
  readonly list: BatchList;
  readonly reload: () => void;
} {
  const [answer, setAnswer] = useState<{
    readonly request: string;
    readonly items: readonly OpeningBatchSummary[] | null;
    readonly truncated: boolean;
    readonly failure: {
      readonly status: 'denied' | 'expired' | 'unavailable';
      readonly correlationId: string | null;
    } | null;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const companyId = target?.companyId ?? null;
  const branchId = target?.branchId ?? null;
  /*
   * The read this hook is currently waiting for, as a value.
   *
   * An answer is STAMPED with the request it answers and is only rendered while
   * the stamp still matches, which is what keeps the previous branch's rows off
   * the screen while a new branch's read is in flight — without clearing state
   * inside the effect, which would be a cascading render. `attempt` is part of
   * the stamp, so a retry is a different request and re-enters `loading`.
   */
  const request = companyId === null || branchId === null ? null : `${companyId}|${branchId}`;

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (companyId === null || branchId === null || request === null) return;
    const stamp = `${request}#${attempt}`;
    let live = true;
    void listOpeningBatches({ companyId, branchId }).then((state) => {
      if (!live) return;
      if (state.status === 'ok') {
        setAnswer({
          request: stamp,
          items: state.data.items,
          truncated: state.data.hasMore,
          failure: null,
        });
        return;
      }
      // Three states, not one, on the rule `useBranches` settled: a refusal
      // and a dead session are final, everything else is a "not right now" and
      // is the only kind a second attempt can clear.
      const failure = {
        status:
          state.status === 'denied' || state.status === 'expired'
            ? state.status
            : ('unavailable' as const),
        correlationId: state.correlationId,
      };
      setAnswer({ request: stamp, items: null, truncated: false, failure });
    });
    return () => {
      live = false;
    };
    // Keyed on the pair's VALUES, never the object — the rule `useLocations` records.
  }, [companyId, branchId, request, attempt]);

  const current =
    answer !== null && request !== null && answer.request === `${request}#${attempt}`
      ? answer
      : null;
  if (current === null) return { list: LIST_LOADING, reload };
  if (current.failure !== null) {
    const { status, correlationId } = current.failure;
    return {
      list: {
        phase: 'failed',
        status,
        messageKey:
          status === 'unavailable'
            ? 'inventory.opening.batches.unavailable'
            : 'inventory.opening.batches.refused',
        correlationId,
        retry: status === 'unavailable' ? reload : null,
      },
      reload,
    };
  }
  if (current.items === null || current.items.length === 0) return { list: LIST_NONE, reload };
  return { list: { phase: 'listed', items: current.items, truncated: current.truncated }, reload };
}

/** How a failed `inv.opening-batch-read` is said. A 404 is its own sentence, never a blank panel. */
function detailFailureKey(status: string): string {
  if (status === 'denied') return 'inventory.opening.detail.refused';
  if (status === 'not-found') return 'inventory.opening.detail.gone';
  if (status === 'expired') return 'state.expired.message';
  return 'inventory.opening.detail.unavailable';
}

export function OpeningStockScreen({
  locale,
  messages,
  canOperate,
  canApprove,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** `inv.stock.operate` — opening a batch and adding lines. */
  readonly canOperate: boolean;
  /** `inv.adjustment.approve` — approving; the server still refuses the counter. */
  readonly canApprove: boolean;
  /**
   * `org.branch.read`. Accepted so the route did not have to change, and no
   * longer read: the branch is the working context's named selection.
   */
  readonly canReadBranches?: boolean;
}) {
  const [target, setTarget] = useState<StockTarget | null>(null);
  const [batch, setBatch] = useState<OpeningBatch | null>(null);
  const [lines, setLines] = useState<readonly ShownLine[]>([]);
  const [opening, setOpening] = useState<string | null>(null);
  const [openFailure, setOpenFailure] = useState<string | null>(null);
  const locations = useLocations(target);
  const { list, reload } = useOpeningBatches(target);

  const approved = batch !== null && batch.status === 'approved';

  /**
   * Open one batch from the list — `inv.opening-batch-read`.
   *
   * Everything the screen then shows about that batch is this answer: its
   * header, and its lines with the item and location codes the server resolved.
   * Nothing is carried over from a line this tab happened to add earlier, which
   * is what makes the panel below true after a reload and true for a second
   * person who never saw the count being entered.
   */
  const openBatch = async (batchId: string): Promise<void> => {
    setOpening(batchId);
    setOpenFailure(null);
    const state = await readOpeningBatch(batchId);
    setOpening(null);
    if (state.status !== 'ok') {
      setOpenFailure(detailFailureKey(state.status));
      return;
    }
    setBatch(state.data.batch);
    setLines(
      state.data.lines.map((line) => ({
        line,
        sku: line.sku,
        itemName: line.itemName,
        locationCode: line.locationCode,
      }))
    );
  };

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
        {translate(messages, 'inventory.opening.batchesReadable')}
      </p>
      {!canOperate && !canApprove ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.opening.needsOperate')}
        </p>
      ) : null}

      <BranchTargetForm
        messages={messages}
        formLabelKey="inventory.opening.targetLabel"
        explainKey="inventory.opening.targetExplain"
        onChosen={(next) => {
          // Everything the previous branch owned goes with it. A failure to
          // read a batch of THAT branch says nothing about this one, and a
          // batch left on screen would be one workshop's count under another
          // workshop's name.
          setBatch(null);
          setLines([]);
          setOpenFailure(null);
          setTarget(next);
        }}
      />

      {target !== null ? (
        <BatchListPanel
          locale={locale}
          messages={messages}
          list={list}
          busyId={opening}
          failureKey={openFailure}
          onOpen={(batchId) => {
            void openBatch(batchId);
          }}
        />
      ) : null}

      {target !== null && batch === null && canOperate ? (
        <BatchForm
          // Keyed on the branch: the form would otherwise stay mounted across a
          // switch and send what was typed for one branch to the next.
          key={`${target.companyId}:${target.branchId}`}
          messages={messages}
          target={target}
          onOpened={(opened) => {
            setBatch(opened);
            setLines([]);
            reload();
          }}
        />
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
            {translate(messages, 'inventory.opening.batch.serverNote')}
          </p>
          <div>
            <Button
              type="button"
              variant="outlined"
              onClick={() => {
                setBatch(null);
                setLines([]);
                setOpenFailure(null);
                reload();
              }}
            >
              {translate(messages, 'inventory.opening.batches.back')}
            </Button>
          </div>
        </section>
      ) : null}

      {batch !== null && !approved && canOperate ? (
        <LineForm
          messages={messages}
          batch={batch}
          locations={locations}
          onAdded={(shown) => {
            setLines((current) => [...current, shown]);
            reload();
          }}
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
            <TableContainer>
              <Table size="small">
                <caption className="sr-only">
                  {translate(messages, 'inventory.opening.lines.caption')}
                </caption>
                <TableHead>
                  <TableRow>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.opening.lines.column.item')}
                    </TableCell>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.opening.lines.column.location')}
                    </TableCell>
                    <TableCell scope="col" align="right">
                      {translate(messages, 'inventory.opening.lines.column.quantity')}
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lines.map((shown) => (
                    <TableRow key={shown.line.id}>
                      <TableCell>
                        <span dir="ltr">{shown.sku}</span>
                        {' — '}
                        {shown.itemName}
                      </TableCell>
                      <TableCell>
                        <span dir="ltr">{shown.locationCode}</span>
                      </TableCell>
                      <TableCell align="right">
                        <Qty value={shown.line.quantity} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </section>
      ) : null}

      {batch !== null && lines.length > 0 ? (
        <ApprovalPanel
          locale={locale}
          messages={messages}
          batch={batch}
          canApprove={canApprove}
          onApproved={(approvedBatch) => {
            setBatch(approvedBatch);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The batches this branch already has — the recovery path
 * ------------------------------------------------------------------ */

/**
 * `inv.opening-batch-list` rendered as a table, newest first.
 *
 * This is the whole point of the slice: the operator who reloaded, and the
 * second person who must approve, both arrive here and find the batch. The
 * status is shown because it decides what can still be done with a batch — a
 * draft takes lines and an approval, an approved one is frozen — and the line
 * count is the server's own figure, never counted here.
 *
 * A wait, an empty branch and a failure are three different sentences. The
 * empty one is a statement about this branch, not about permission: a refusal
 * has its own wording and, where a second attempt could help, a retry.
 */
function BatchListPanel({
  locale,
  messages,
  list,
  busyId,
  failureKey,
  onOpen,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly list: BatchList;
  /** The batch whose detail read is in flight; every open button waits on it. */
  readonly busyId: string | null;
  /** A failed `inv.opening-batch-read`, said here beside the row that was clicked. */
  readonly failureKey: string | null;
  readonly onOpen: (batchId: string) => void;
}) {
  return (
    <section aria-labelledby="opening-batches-heading" className="flex flex-col gap-3">
      <h2 id="opening-batches-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.opening.batches.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.opening.batches.explain')}
      </p>
      {failureKey !== null ? (
        <Alert severity="error" role="alert" variant="outlined">
          {translateDynamic(messages, failureKey)}
        </Alert>
      ) : null}
      {list.phase === 'loading' ? (
        <p role="status" aria-live="polite" className="text-caption text-text-muted">
          {translate(messages, 'inventory.opening.batches.loading')}
        </p>
      ) : null}
      {list.phase === 'none' ? (
        <MuiEmptyState
          messages={messages}
          descriptionKey="inventory.opening.batches.none"
          testId="opening-batches-none"
        />
      ) : null}
      {list.phase === 'failed' ? (
        /*
         * The shared state for each failure, with this list's own sentence: a
         * refusal and an ended session offer no retry; an outage offers one, and
         * its reference. The retry is `type="button"`, so it never sends one of
         * the forms on the same page.
         */
        <MuiReadFailureState
          messages={messages}
          locale={locale}
          status={list.status}
          correlationId={list.correlationId}
          onRetry={list.retry ?? undefined}
          descriptionKey={list.messageKey}
          testId="opening-batches-failed"
        />
      ) : null}
      {list.phase === 'listed' ? (
        <>
          {list.truncated ? (
            <p className="text-caption text-text-muted">
              {translate(messages, 'inventory.opening.batches.truncated')}
            </p>
          ) : null}
          <TableContainer>
            <Table size="small">
              <caption className="sr-only">
                {translate(messages, 'inventory.opening.batches.caption')}
              </caption>
              <TableHead>
                <TableRow>
                  <TableCell scope="col">
                    {translate(messages, 'inventory.opening.batch.code')}
                  </TableCell>
                  <TableCell scope="col">
                    {translate(messages, 'inventory.opening.batch.asOfDate')}
                  </TableCell>
                  <TableCell scope="col">
                    {translate(messages, 'inventory.opening.batch.status')}
                  </TableCell>
                  <TableCell scope="col" align="right">
                    {translate(messages, 'inventory.opening.batches.column.lines')}
                  </TableCell>
                  <TableCell scope="col" align="right">
                    {translate(messages, 'inventory.opening.batches.column.action')}
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {list.items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <span dir="ltr">{row.batchCode}</span>
                    </TableCell>
                    <TableCell>
                      <span dir="ltr">{row.asOfDate}</span>
                    </TableCell>
                    <TableCell>
                      {translateDynamic(messages, `inventory.opening.status.${row.status}`)}
                    </TableCell>
                    <TableCell align="right">{row.lineCount}</TableCell>
                    <TableCell align="right">
                      <Button
                        type="button"
                        variant="outlined"
                        size="small"
                        disabled={busyId !== null}
                        onClick={() => onOpen(row.id)}
                      >
                        {translate(messages, 'inventory.opening.batches.open')}
                        {/* The code is part of the accessible name: five buttons
                            reading only "Open" name nothing a listener can choose
                            between. */}
                        <span className="sr-only"> {row.batchCode}</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      ) : null}
    </section>
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
  /*
   * A count date only partly typed, or typed whole but impossible (31/02),
   * holds no day — its value stays `''`, as for a field nobody touched — so
   * the picker's own report is kept: it is refused as an unfinished or an
   * impossible date, never as a missing one, and it is unsaved work
   * (P1-32-PRE-OD-INVR).
   */
  const [dateProblem, setDateProblem] = useState<DayProblem>(null);
  // One batch opened at a time, before `busy` has disabled the button.
  const sending = useRef(false);
  // The batch is addressed to THIS branch, so a switch asks before dropping it.
  useUnsavedGuard(
    dateProblem !== null || Object.values(form).some((value) => value.trim().length > 0)
  );

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
    if (dateProblem === 'incomplete' || (asOfDate.length > 0 && !ISO_DATE.test(asOfDate))) {
      found['asOfDate'] = 'inventory.opening.batch.dateFormat';
    } else if (dateProblem !== null) found['asOfDate'] = 'inventory.opening.batch.dateInvalid';
    else if (asOfDate.length === 0) found['asOfDate'] = 'field.required';
    const notes = form.notes.trim();
    if (notes.length > MAX_DESCRIPTION) found['notes'] = 'inventory.setup.descriptionTooLong';
    setErrors(found);
    if (Object.keys(found).length > 0 || sending.current) return;

    sending.current = true;
    setBusy(true);
    const result = await createOpeningBatch({
      companyId: target.companyId,
      branchId: target.branchId,
      batchCode,
      asOfDate,
      ...(notes.length > 0 ? { notes } : {}),
    });
    sending.current = false;
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
      <FormTextField
        label={translate(messages, 'inventory.opening.batch.code')}
        description={translate(messages, 'inventory.opening.batch.codeHelp')}
        required
        spellCheck={false}
        dir="ltr"
        value={form.batchCode}
        onChange={(next) => setForm((f) => ({ ...f, batchCode: next }))}
        error={errorFor('batchCode')}
      />
      {/*
        A calendar day on the MIT date picker (ADR-022, E1-E4): the value is the
        same `YYYY-MM-DD` the native box produced and the route accepts.
      */}
      <DateField
        label={translate(messages, 'inventory.opening.batch.asOfDate')}
        description={translate(messages, 'inventory.opening.batch.asOfDateHelp')}
        required
        value={form.asOfDate}
        onChange={(next) => setForm((f) => ({ ...f, asOfDate: next }))}
        onProblem={setDateProblem}
        error={errorFor('asOfDate')}
      />
      <FormTextField
        label={translate(messages, 'inventory.opening.batch.notes')}
        multiline
        rows={2}
        value={form.notes}
        onChange={(next) => setForm((f) => ({ ...f, notes: next }))}
        error={errorFor('notes')}
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <Button type="submit" variant="contained" disabled={busy}>
          {translate(messages, 'inventory.opening.batch.open')}
        </Button>
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
  // One line sent at a time, before `busy` has disabled the button.
  const sending = useRef(false);
  /*
   * Unsaved work, declared to the shell. The item and location stay chosen
   * after a line is added, as defaults for the next one, so after the first
   * line only a typed quantity counts — otherwise the guard would stay raised
   * for ever and ask about every switch.
   */
  const [added, setAdded] = useState(false);
  useUnsavedGuard(
    form.quantity.trim().length > 0 || (!added && (form.itemId !== '' || form.locationId !== ''))
  );

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
    if (Object.keys(next).length > 0 || sending.current) return;

    sending.current = true;
    setBusy(true);
    const result = await createOpeningBatchLine(batch.id, {
      itemId: form.itemId,
      locationId: form.locationId,
      quantity,
    });
    sending.current = false;
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
      setAdded(true);
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
          <FormTextField
            label={translate(messages, 'inventory.opening.line.find')}
            description={translate(messages, 'inventory.opening.line.findHelp')}
            value={search}
            onChange={setSearch}
            error={errorFor('search')}
          />
        </div>
        <div className="flex items-end">
          <Button
            type="button"
            variant="outlined"
            onClick={() => {
              void find();
            }}
          >
            {translate(messages, 'inventory.opening.line.search')}
          </Button>
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
      <FormSelectField
        label={translate(messages, 'inventory.opening.line.item')}
        required
        value={form.itemId}
        onChange={(next) => setForm((f) => ({ ...f, itemId: next }))}
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
      <FormNumberField
        label={translate(messages, 'inventory.opening.line.quantity')}
        description={translate(messages, 'inventory.opening.line.quantityHelp')}
        required
        value={form.quantity}
        onChange={(next) => setForm((f) => ({ ...f, quantity: next }))}
        error={errorFor('quantity')}
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <Button type="submit" variant="contained" disabled={busy}>
          {translate(messages, 'inventory.opening.line.add')}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Approve — a second person
 * ------------------------------------------------------------------ */

/**
 * Whether a refusal already carries its own reason.
 *
 * Approval is refused for two different reasons and only one of them is
 * "someone else must do this". The server also refuses a batch that counts a
 * cell the branch has already opened — `path.batchId` +
 * `duplicate_opening_cell` — and that refusal is not cured by finding a second
 * person, so pairing it with "a second person must approve" would send the
 * approver to fetch a colleague who would be refused for the same reason.
 *
 * The test is the KEY, not the status, because both are `conflict`: a banner
 * that names a violation is the specific reason, and the standing hint below it
 * is the generic one. `OutcomeNote` has already rendered whichever arrived.
 */
function statedRefusal(outcome: ActionState): boolean {
  return outcome.messageKey?.startsWith(VIOLATION_KEY_PREFIX) === true;
}

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
  // One approval in flight at a time, before `busy` has disabled the button.
  const sending = useRef(false);
  const approved = batch.status === 'approved';

  const approve = async () => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    const result = await approveOpeningBatch(batch.id);
    sending.current = false;
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
          {outcome?.status === 'conflict' && !statedRefusal(outcome) ? (
            <p className="text-caption text-text-muted">
              {translate(messages, 'inventory.opening.approve.secondPerson')}
            </p>
          ) : null}
          <div>
            <Button
              type="button"
              variant="contained"
              disabled={busy}
              onClick={() => {
                void approve();
              }}
            >
              {translate(messages, 'inventory.opening.approve.action')}
            </Button>
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
