'use client';

/**
 * One item's codes and selling prices (P1-32).
 *
 * ## What an identifier is, and what it is not
 *
 * The stock code (SKU) is the identity the ledger keys on. An identifier is what
 * a person can SCAN: a manufacturer's GTIN on the unit, a second on the case
 * with a pack quantity of twelve, a supplier's own code, or an INTERNAL code the
 * workshop printed for a part that arrived with none.
 *
 * The internal one is named as such everywhere it appears, because the
 * difference matters at the counter: a manufacturer code identifies the part
 * anywhere in the world, and an internal code identifies it inside this tenant
 * and nowhere else. This screen never invents a manufacturer code — every
 * enterable kind is typed from the part or its packaging, the database checks
 * the retail check digit, and the one code this screen can produce is the
 * internal one, allocated by the server from the tenant's own counter.
 *
 * ## Prices are the server's, and are narrowed
 *
 * A price row may name a company, or a company and a branch, or neither. The
 * list states which, row by row, because "the price of this item" is not a
 * question with one answer. Nothing here computes, rounds or reformats a figure;
 * the string the operator typed is the string that is sent.
 *
 * Permissions: `inv.item.read` gates the page; `inv.item.manage` — held
 * TENANT-WIDE, which the server checks — offers every write.
 *
 * ## On Material UI (ADR-022, `P1-32-PRE-OD-MUI7A1`)
 *
 * Both lists are Material's table: each read answers the item's whole list at
 * once (no cursor), so there is nothing for the operational grid's pager to
 * walk. Every field is a `forms/mui` wrapper, every button Material's, and a
 * read that does not answer is the shared Material state carrying this
 * screen's own sentence, with a retry after an outage. What is read, sent and
 * authorized is unchanged.
 */

import { useCallback, useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';

import { FormNumberField } from '@/components/forms/mui/FormNumberField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import type { ActionState } from '@/lib/forms/action-result';
import { formatDateTime } from '@/lib/format';
import { formatMoney } from '@/lib/money';

import {
  addIdentifier,
  assignInternalBarcode,
  listIdentifiers,
  listSalePrices,
  listUnitsOfMeasure,
  retireIdentifier,
  setSalePrice,
} from '../api';
import {
  CURRENCY_CODE,
  ENTERABLE_IDENTIFIER_KINDS,
  MAX_IDENTIFIER_VALUE,
  QUANTITY,
  UNIT_COST,
  type EnterableIdentifierKind,
  type ItemIdentifier,
  type ItemIdentifierList,
  type ItemSalePriceList,
  type UnitOfMeasureOption,
} from '../inventory-contract';

import { OutcomeNote, Qty, UUID } from './shared';
import { PANEL, outcomeField } from './stock-operations';

/**
 * One read, as one of four outcomes, re-issued after every write that changes it.
 *
 * A failure keeps the screen's own sentence and says which failure it is, so it
 * is drawn as that state (`MuiReadFailureState`): a refusal and an ended session
 * offer no retry, and everything else — the service did not answer, answered
 * too slowly, or failed — is "unavailable, try again", as it always read here.
 */
type Panel<T> =
  | { readonly phase: 'loading' }
  | { readonly phase: 'read'; readonly data: T }
  | {
      readonly phase: 'failed';
      readonly status: 'denied' | 'expired' | 'unavailable';
      readonly messageKey: string;
      readonly correlationId: string | null;
      readonly retry: (() => void) | null;
    };

function usePanel<T>(
  read: () => Promise<ReadState<T>>,
  refusedKey: string,
  unavailableKey: string,
  /** Extra inputs that make a DIFFERENT request, so an old answer is not shown for a new one. */
  variant = ''
): { readonly panel: Panel<T>; readonly reload: () => void } {
  /*
   * An answer is stamped with the request it answers, and `loading` is DERIVED
   * from the stamp not matching — the shape `useBranchList` settled on. Setting
   * a loading state inside the effect instead would be a second render for
   * every read, and React now says so out loud.
   */
  const [answer, setAnswer] = useState<{ readonly stamp: string; readonly value: Panel<T> } | null>(
    null
  );
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const stamp = `${variant}#${attempt}`;
  useEffect(() => {
    let live = true;
    void read().then((got) => {
      if (!live) return;
      setAnswer({
        stamp,
        value:
          got.status === 'ok'
            ? { phase: 'read', data: got.data }
            : got.status === 'denied'
              ? {
                  phase: 'failed',
                  status: 'denied',
                  messageKey: refusedKey,
                  correlationId: got.correlationId,
                  retry: null,
                }
              : got.status === 'expired'
                ? {
                    phase: 'failed',
                    status: 'expired',
                    messageKey: 'state.expired.message',
                    correlationId: got.correlationId,
                    retry: null,
                  }
                : {
                    phase: 'failed',
                    status: 'unavailable',
                    messageKey: unavailableKey,
                    correlationId: got.correlationId,
                    retry: reload,
                  },
      });
    });
    return () => {
      live = false;
    };
  }, [read, stamp, refusedKey, unavailableKey, reload]);
  return {
    panel: answer !== null && answer.stamp === stamp ? answer.value : { phase: 'loading' },
    reload,
  };
}

export function ItemCodesScreen({
  locale,
  messages,
  itemId,
  canManage,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly itemId: string;
  /** `inv.item.manage`, which the server additionally requires TENANT-WIDE. */
  readonly canManage: boolean;
}) {
  if (!UUID.test(itemId)) {
    return (
      <p className="text-body text-error">{translate(messages, 'inventory.common.idFormat')}</p>
    );
  }
  return (
    <div className="flex min-h-0 flex-col gap-4">
      <IdentifiersPanel locale={locale} messages={messages} itemId={itemId} canManage={canManage} />
      <PricesPanel locale={locale} messages={messages} itemId={itemId} canManage={canManage} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Identifiers
 * ------------------------------------------------------------------ */

function IdentifiersPanel({
  locale,
  messages,
  itemId,
  canManage,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly itemId: string;
  readonly canManage: boolean;
}) {
  const [includeRetired, setIncludeRetired] = useState(false);
  const read = useCallback(() => listIdentifiers(itemId, includeRetired), [itemId, includeRetired]);
  const { panel, reload } = usePanel<ItemIdentifierList>(
    read,
    'inventory.identifiers.refused',
    'inventory.identifiers.unavailable',
    includeRetired ? 'all' : 'live'
  );
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <section aria-labelledby="item-codes-heading" className={PANEL}>
      <h2 id="item-codes-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.identifiers.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.identifiers.explain')}
      </p>
      {notice !== null ? (
        <p role="status" className="text-body text-text-primary">
          {translateDynamic(messages, notice)}
        </p>
      ) : null}
      <div className="sm:max-w-xs">
        <FormSelectField
          label={translate(messages, 'inventory.identifiers.show')}
          value={includeRetired ? 'all' : 'live'}
          onChange={(next) => setIncludeRetired(next === 'all')}
          options={[
            { value: 'live', label: translate(messages, 'inventory.identifiers.showLive') },
            { value: 'all', label: translate(messages, 'inventory.identifiers.showAll') },
          ]}
        />
      </div>

      {panel.phase === 'loading' ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : panel.phase === 'failed' ? (
        <PanelFailure locale={locale} messages={messages} panel={panel} />
      ) : (
        <>
          <p className="text-caption text-text-muted">
            <code className="font-mono" dir="ltr">
              {panel.data.sku}
            </code>
            {panel.data.isSerialized ? (
              <span className="ms-2">
                {translate(messages, 'inventory.identifiers.serializedNote')}
              </span>
            ) : null}
          </p>
          {panel.data.identifiers.length === 0 ? (
            <p className="text-caption text-text-muted">
              {translate(messages, 'inventory.identifiers.none')}
            </p>
          ) : (
            <TableContainer>
              <Table size="small">
                <caption className="sr-only">
                  {translate(messages, 'inventory.identifiers.caption')}
                </caption>
                <TableHead>
                  <TableRow>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.identifiers.column.kind')}
                    </TableCell>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.identifiers.column.code')}
                    </TableCell>
                    <TableCell scope="col" align="right">
                      {translate(messages, 'inventory.identifiers.column.pack')}
                    </TableCell>
                    <TableCell scope="col">
                      {translate(messages, 'inventory.identifiers.column.state')}
                    </TableCell>
                    <TableCell scope="col" align="right">
                      {translate(messages, 'inventory.identifiers.column.action')}
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {panel.data.identifiers.map((row) => (
                    <IdentifierRow
                      key={row.id}
                      locale={locale}
                      messages={messages}
                      itemId={itemId}
                      row={row}
                      canManage={canManage}
                      onRetired={() => {
                        setNotice('inventory.identifiers.retire.done');
                        reload();
                      }}
                    />
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </>
      )}

      {canManage ? (
        <>
          <AddIdentifierForm
            messages={messages}
            itemId={itemId}
            onAdded={() => {
              setNotice('inventory.identifiers.add.done');
              reload();
            }}
          />
          <InternalCodeAction
            messages={messages}
            itemId={itemId}
            onAssigned={() => {
              setNotice('inventory.identifiers.internal.done');
              reload();
            }}
          />
        </>
      ) : (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.identifiers.needsManage')}
        </p>
      )}
    </section>
  );
}

function IdentifierRow({
  locale,
  messages,
  itemId,
  row,
  canManage,
  onRetired,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly itemId: string;
  readonly row: ItemIdentifier;
  readonly canManage: boolean;
  readonly onRetired: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  return (
    <TableRow className="align-top">
      <TableCell>
        {translateDynamic(messages, `inventory.identifierKind.${row.kind}`)}
        {row.isPrimary ? (
          <span className="block text-caption text-text-muted">
            {translate(messages, 'inventory.identifiers.primary')}
          </span>
        ) : null}
      </TableCell>
      <TableCell>
        <code className="font-mono text-caption" dir="ltr">
          {row.value}
        </code>
        <span className="block text-caption text-text-muted">
          {translateDynamic(messages, `inventory.symbology.${row.symbology}`)}
        </span>
      </TableCell>
      <TableCell align="right">
        <Qty value={row.packQuantity} /> <span dir="ltr">{row.unit.code}</span>
      </TableCell>
      <TableCell>
        {row.retired
          ? translate(messages, 'inventory.identifiers.retired')
          : translate(messages, 'inventory.identifiers.live')}
        <span className="block text-caption text-text-muted" dir="ltr">
          {formatDateTime(row.retiredAt ?? row.createdAt, locale)}
        </span>
        {outcome !== null ? <OutcomeNote messages={messages} outcome={outcome} /> : null}
      </TableCell>
      <TableCell align="right">
        {row.retired || !canManage ? null : (
          <Button
            type="button"
            variant="outlined"
            color="error"
            size="small"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void retireIdentifier(itemId, row.id).then((result) => {
                setBusy(false);
                setOutcome(result.state);
                notifyActionResult(result.state, messages);
                if (result.state.status === 'success') onRetired();
              });
            }}
          >
            {translate(messages, 'inventory.identifiers.retire.action')}
            <span className="sr-only"> {row.value}</span>
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

function AddIdentifierForm({
  messages,
  itemId,
  onAdded,
}: {
  readonly messages: Messages;
  readonly itemId: string;
  readonly onAdded: () => void;
}) {
  const [units, setUnits] = useState<readonly UnitOfMeasureOption[] | null>(null);
  useEffect(() => {
    let live = true;
    void listUnitsOfMeasure().then((state) => {
      if (live && state.status === 'ok') setUnits(state.data.items);
    });
    return () => {
      live = false;
    };
  }, []);

  const [form, setForm] = useState<{
    kind: EnterableIdentifierKind;
    value: string;
    unitId: string;
    packQuantity: string;
  }>({ kind: 'gtin', value: '', unitId: '', packQuantity: '' });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  /*
   * ONE key per opened form, which is what makes this write safe to repeat.
   * A scanner that delivered the code twice, or an answer that never arrived,
   * replays the first write under the same key instead of colliding with it as
   * a duplicate code.
   */
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());

  const errorFor = (name: string) =>
    errors[name] ? translateDynamic(messages, errors[name]) : outcomeField(messages, outcome, name);

  const submit = async () => {
    const found: Record<string, string> = {};
    const value = form.value.trim();
    if (value.length === 0) found['value'] = 'field.required';
    else if (value.length > MAX_IDENTIFIER_VALUE) found['value'] = 'inventory.scan.tooLong';
    const pack = form.packQuantity.trim();
    if (pack.length > 0 && !QUANTITY.test(pack)) {
      found['packQuantity'] = 'inventory.stockOps.quantityFormat';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    const result = await addIdentifier(
      itemId,
      {
        kind: form.kind,
        value,
        ...(form.unitId === '' ? {} : { unitId: form.unitId }),
        ...(pack === '' ? {} : { packQuantity: pack }),
      },
      attemptKey
    );
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      setForm({ kind: form.kind, value: '', unitId: '', packQuantity: '' });
      setAttemptKey(crypto.randomUUID());
      setOutcome(null);
      onAdded();
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="identifier-add-heading"
      className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2"
    >
      <h3
        id="identifier-add-heading"
        className="text-body font-medium text-text-primary sm:col-span-2"
      >
        {translate(messages, 'inventory.identifiers.add.heading')}
      </h3>
      <p className="text-caption text-text-muted sm:col-span-2">
        {translate(messages, 'inventory.identifiers.add.explain')}
      </p>
      <FormSelectField
        label={translate(messages, 'inventory.identifiers.add.kind')}
        required
        value={form.kind}
        onChange={(next) => setForm((f) => ({ ...f, kind: next as EnterableIdentifierKind }))}
        options={ENTERABLE_IDENTIFIER_KINDS.map((kind) => ({
          value: kind,
          label: translateDynamic(messages, `inventory.identifierKind.${kind}`),
        }))}
      />
      <FormTextField
        label={translate(messages, 'inventory.identifiers.add.value')}
        description={translate(messages, 'inventory.identifiers.add.valueHelp')}
        required
        dir="ltr"
        autoComplete="off"
        value={form.value}
        onChange={(next) => setForm((f) => ({ ...f, value: next }))}
        error={errorFor('value')}
      />
      <FormSelectField
        label={translate(messages, 'inventory.identifiers.add.unit')}
        description={translate(messages, 'inventory.identifiers.add.unitHelp')}
        value={form.unitId}
        onChange={(next) => setForm((f) => ({ ...f, unitId: next }))}
        options={(units ?? []).map((unit) => ({
          value: unit.id,
          label: `${unit.code} — ${unit.name}`,
        }))}
        placeholder={translate(messages, 'inventory.identifiers.add.unitDefault')}
      />
      {/* A decimal string as typed, never a number input (F5). */}
      <FormNumberField
        label={translate(messages, 'inventory.identifiers.add.pack')}
        description={translate(messages, 'inventory.identifiers.add.packHelp')}
        value={form.packQuantity}
        onChange={(next) => setForm((f) => ({ ...f, packQuantity: next }))}
        error={errorFor('packQuantity')}
      />
      <div className="sm:col-span-2">
        <OutcomeNote messages={messages} outcome={outcome} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" variant="contained" disabled={busy}>
          {translate(messages, 'inventory.identifiers.add.submit')}
        </Button>
      </div>
    </form>
  );
}

function InternalCodeAction({
  messages,
  itemId,
  onAssigned,
}: {
  readonly messages: Messages;
  readonly itemId: string;
  readonly onAssigned: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <h3 className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.identifiers.internal.heading')}
      </h3>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.identifiers.internal.explain')}
      </p>
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <Button
          type="button"
          variant="outlined"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void assignInternalBarcode(itemId).then((result) => {
              setBusy(false);
              setOutcome(result.state);
              notifyActionResult(result.state, messages);
              if (result.state.status === 'success' && result.created) {
                setOutcome(null);
                onAssigned();
              }
            });
          }}
        >
          {translate(messages, 'inventory.identifiers.internal.action')}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Selling prices
 * ------------------------------------------------------------------ */

function PricesPanel({
  locale,
  messages,
  itemId,
  canManage,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly itemId: string;
  readonly canManage: boolean;
}) {
  const read = useCallback(() => listSalePrices(itemId), [itemId]);
  const { panel, reload } = usePanel<ItemSalePriceList>(
    read,
    'inventory.prices.refused',
    'inventory.prices.unavailable'
  );
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <section aria-labelledby="item-prices-heading" className={PANEL}>
      <h2 id="item-prices-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.prices.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.prices.explain')}
      </p>
      {notice !== null ? (
        <p role="status" className="text-body text-text-primary">
          {translateDynamic(messages, notice)}
        </p>
      ) : null}
      {panel.phase === 'loading' ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : panel.phase === 'failed' ? (
        <PanelFailure locale={locale} messages={messages} panel={panel} />
      ) : panel.data.prices.length === 0 ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.prices.none')}
        </p>
      ) : (
        <TableContainer>
          <Table size="small">
            <caption className="sr-only">{translate(messages, 'inventory.prices.caption')}</caption>
            <TableHead>
              <TableRow>
                <TableCell scope="col">
                  {translate(messages, 'inventory.prices.column.applies')}
                </TableCell>
                <TableCell scope="col" align="right">
                  {translate(messages, 'inventory.prices.column.price')}
                </TableCell>
                <TableCell scope="col">
                  {translate(messages, 'inventory.prices.column.taxClass')}
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {panel.data.prices.map((price) => (
                <TableRow key={price.id} className="align-top">
                  <TableCell>
                    {translate(
                      messages,
                      price.branchId !== null
                        ? 'inventory.prices.appliesBranch'
                        : price.companyId !== null
                          ? 'inventory.prices.appliesCompany'
                          : 'inventory.prices.appliesTenant'
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <span dir="ltr" className="font-mono text-caption">
                      {formatMoney(
                        { amount: price.unitPrice, currency: price.currencyCode },
                        locale
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    {price.taxClassCode ?? translate(messages, 'inventory.prices.noTaxClass')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {canManage ? (
        <SetPriceForm
          messages={messages}
          itemId={itemId}
          onSet={() => {
            setNotice('inventory.prices.set.done');
            reload();
          }}
        />
      ) : (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.prices.needsManage')}
        </p>
      )}
    </section>
  );
}

function SetPriceForm({
  messages,
  itemId,
  onSet,
}: {
  readonly messages: Messages;
  readonly itemId: string;
  readonly onSet: () => void;
}) {
  /*
   * A sale price may be scoped to the whole workspace, to one company, or to
   * one branch of it, and the two narrower forms used to be TYPED — two boxes
   * asking for references nobody can look up. Both are now chosen from the
   * named lists the working context publishes for this caller (Owner directive,
   * `P1-32-PRE-OD-UX`), and "every company" and "every branch" stay as the
   * explicit first option each control carries, because they are real choices
   * rather than the absence of one.
   */
  const context = useWorkingContext();
  const [form, setForm] = useState({
    companyId: '',
    branchId: '',
    currencyCode: '',
    unitPrice: '',
  });
  const branchesOfCompany = context.branches.filter(
    (branch) => branch.companyId === form.companyId
  );
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const errorFor = (name: string) =>
    errors[name] ? translateDynamic(messages, errors[name]) : outcomeField(messages, outcome, name);

  const submit = async () => {
    const found: Record<string, string> = {};
    const companyId = form.companyId.trim();
    const branchId = form.branchId.trim();
    // Both are picked from the platform's own named lists now, so the only rule
    // left is the one the route states: a branch is meaningless without its
    // company.
    if (branchId !== '' && companyId === '')
      found['companyId'] = 'inventory.prices.branchNeedsCompany';
    const currencyCode = form.currencyCode.trim().toUpperCase();
    if (!CURRENCY_CODE.test(currencyCode))
      found['currencyCode'] = 'inventory.prices.set.currencyFormat';
    const unitPrice = form.unitPrice.trim();
    if (!UNIT_COST.test(unitPrice)) found['unitPrice'] = 'inventory.prices.priceFormat';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    const result = await setSalePrice(itemId, {
      ...(companyId === '' ? {} : { companyId }),
      ...(branchId === '' ? {} : { branchId }),
      currencyCode,
      unitPrice,
    });
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      setForm({ companyId: '', branchId: '', currencyCode: '', unitPrice: '' });
      setOutcome(null);
      onSet();
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="price-set-heading"
      className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2"
    >
      <h3 id="price-set-heading" className="text-body font-medium text-text-primary sm:col-span-2">
        {translate(messages, 'inventory.prices.set.heading')}
      </h3>
      <p className="text-caption text-text-muted sm:col-span-2">
        {translate(messages, 'inventory.prices.set.explain')}
      </p>
      <FormSelectField
        label={translate(messages, 'inventory.prices.set.companyField')}
        description={translate(messages, 'inventory.prices.set.companyHelp')}
        value={form.companyId}
        onChange={(next) =>
          // The branch belongs to the company, so changing one discards the
          // other. Keeping it would send a pair the route refuses.
          setForm((f) => ({ ...f, companyId: next, branchId: '' }))
        }
        options={context.companies.map((company) => ({
          value: company.id,
          label: company.name,
        }))}
        placeholder={translate(messages, 'inventory.prices.set.everyCompany')}
        error={errorFor('companyId')}
      />
      <FormSelectField
        label={translate(messages, 'inventory.prices.set.branchField')}
        description={translate(messages, 'inventory.prices.set.branchHelp')}
        disabled={form.companyId === ''}
        value={form.branchId}
        onChange={(next) => setForm((f) => ({ ...f, branchId: next }))}
        options={branchesOfCompany.map((branch) => ({
          value: branch.id,
          label: `${branch.code} — ${branch.name}`,
        }))}
        placeholder={translate(messages, 'inventory.prices.set.everyBranch')}
        error={errorFor('branchId')}
      />
      {/*
       * DEF-T-14. The box is free text because no operation publishes the
       * currencies an organisation carries — Administration says so itself — so
       * the help says what the constraint IS rather than leaving the operator to
       * discover it from a refusal that used to read "Not found" and nothing
       * else. The refusal now carries its own sentence here; see `setSalePrice`.
       */}
      <FormTextField
        label={translate(messages, 'inventory.prices.set.currency')}
        description={translate(messages, 'inventory.prices.set.currencyHelp')}
        required
        dir="ltr"
        value={form.currencyCode}
        onChange={(next) => setForm((f) => ({ ...f, currencyCode: next }))}
        error={errorFor('currencyCode')}
      />
      {/*
        The exact string typed is the string sent (`FormNumberField`, F5): not
        the money field, which would canonicalise "12.5000" on blur.
      */}
      <FormNumberField
        label={translate(messages, 'inventory.prices.set.price')}
        description={translate(messages, 'inventory.prices.set.priceHelp')}
        required
        value={form.unitPrice}
        onChange={(next) => setForm((f) => ({ ...f, unitPrice: next }))}
        error={errorFor('unitPrice')}
      />
      <div className="sm:col-span-2">
        <OutcomeNote messages={messages} outcome={outcome} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" variant="contained" disabled={busy}>
          {translate(messages, 'inventory.prices.set.submit')}
        </Button>
      </div>
    </form>
  );
}

/**
 * A panel read that did not answer, drawn as the state it is with this screen's
 * own sentence under the shared heading — and a retry only where trying again
 * can change the answer.
 */
function PanelFailure({
  locale,
  messages,
  panel,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly panel: Extract<Panel<unknown>, { readonly phase: 'failed' }>;
}) {
  return (
    <MuiReadFailureState
      messages={messages}
      locale={locale}
      status={panel.status}
      correlationId={panel.correlationId}
      onRetry={panel.retry ?? undefined}
      descriptionKey={panel.messageKey as keyof Messages}
    />
  );
}
