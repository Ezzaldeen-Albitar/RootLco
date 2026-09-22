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
 */

import { useCallback, useEffect, useState } from 'react';

import { SelectField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import type { ActionState } from '@/lib/forms/action-result';
import { formatDateTime } from '@/lib/format';

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

import { OutcomeNote, PRIMARY_BUTTON, Qty, SECONDARY_BUTTON, UUID } from './shared';
import { DANGER_BUTTON, PANEL, outcomeField } from './stock-operations';

/** One read, as one of four outcomes, re-issued after every write that changes it. */
type Panel<T> =
  | { readonly phase: 'loading' }
  | { readonly phase: 'read'; readonly data: T }
  | { readonly phase: 'failed'; readonly messageKey: string; readonly retry: (() => void) | null };

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
              ? { phase: 'failed', messageKey: refusedKey, retry: null }
              : got.status === 'expired'
                ? { phase: 'failed', messageKey: 'state.expired.message', retry: null }
                : { phase: 'failed', messageKey: unavailableKey, retry: reload },
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
      <PricesPanel messages={messages} itemId={itemId} canManage={canManage} />
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
        <SelectField
          label={translate(messages, 'inventory.identifiers.show')}
          value={includeRetired ? 'all' : 'live'}
          onChange={(event) => setIncludeRetired(event.target.value === 'all')}
          options={[
            { value: 'live', label: translate(messages, 'inventory.identifiers.showLive') },
            { value: 'all', label: translate(messages, 'inventory.identifiers.showAll') },
          ]}
        />
      </div>

      {panel.phase === 'loading' ? (
        <p role="status" aria-live="polite" className="text-caption text-text-muted">
          {translate(messages, 'inventory.identifiers.loading')}
        </p>
      ) : panel.phase === 'failed' ? (
        <>
          <p className="text-body text-error">{translateDynamic(messages, panel.messageKey)}</p>
          {panel.retry !== null ? (
            <div>
              <button type="button" className={SECONDARY_BUTTON} onClick={panel.retry}>
                {translate(messages, 'state.retry')}
              </button>
            </div>
          ) : null}
        </>
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
            <div className="overflow-x-auto">
              <table className="w-full text-body">
                <caption className="sr-only">
                  {translate(messages, 'inventory.identifiers.caption')}
                </caption>
                <thead>
                  <tr className="text-caption text-text-muted">
                    <th scope="col" className="text-start font-medium">
                      {translate(messages, 'inventory.identifiers.column.kind')}
                    </th>
                    <th scope="col" className="text-start font-medium">
                      {translate(messages, 'inventory.identifiers.column.code')}
                    </th>
                    <th scope="col" className="text-end font-medium">
                      {translate(messages, 'inventory.identifiers.column.pack')}
                    </th>
                    <th scope="col" className="text-start font-medium">
                      {translate(messages, 'inventory.identifiers.column.state')}
                    </th>
                    <th scope="col" className="text-end font-medium">
                      {translate(messages, 'inventory.identifiers.column.action')}
                    </th>
                  </tr>
                </thead>
                <tbody>
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
                </tbody>
              </table>
            </div>
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
    <tr className="border-t border-border align-top">
      <td>
        {translateDynamic(messages, `inventory.identifierKind.${row.kind}`)}
        {row.isPrimary ? (
          <span className="block text-caption text-text-muted">
            {translate(messages, 'inventory.identifiers.primary')}
          </span>
        ) : null}
      </td>
      <td>
        <code className="font-mono text-caption" dir="ltr">
          {row.value}
        </code>
        <span className="block text-caption text-text-muted">
          {translateDynamic(messages, `inventory.symbology.${row.symbology}`)}
        </span>
      </td>
      <td className="text-end">
        <Qty value={row.packQuantity} /> <span dir="ltr">{row.unit.code}</span>
      </td>
      <td>
        {row.retired
          ? translate(messages, 'inventory.identifiers.retired')
          : translate(messages, 'inventory.identifiers.live')}
        <span className="block text-caption text-text-muted" dir="ltr">
          {formatDateTime(row.retiredAt ?? row.createdAt, locale)}
        </span>
        {outcome !== null ? <OutcomeNote messages={messages} outcome={outcome} /> : null}
      </td>
      <td className="text-end">
        {row.retired || !canManage ? null : (
          <button
            type="button"
            className={DANGER_BUTTON}
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
          </button>
        )}
      </td>
    </tr>
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
      <SelectField
        label={translate(messages, 'inventory.identifiers.add.kind')}
        required
        value={form.kind}
        onChange={(event) =>
          setForm((f) => ({ ...f, kind: event.target.value as EnterableIdentifierKind }))
        }
        options={ENTERABLE_IDENTIFIER_KINDS.map((kind) => ({
          value: kind,
          label: translateDynamic(messages, `inventory.identifierKind.${kind}`),
        }))}
      />
      <TextField
        label={translate(messages, 'inventory.identifiers.add.value')}
        description={translate(messages, 'inventory.identifiers.add.valueHelp')}
        required
        dir="ltr"
        autoComplete="off"
        value={form.value}
        onChange={(event) => setForm((f) => ({ ...f, value: event.target.value }))}
        error={errorFor('value')}
      />
      <SelectField
        label={translate(messages, 'inventory.identifiers.add.unit')}
        description={translate(messages, 'inventory.identifiers.add.unitHelp')}
        value={form.unitId}
        onChange={(event) => setForm((f) => ({ ...f, unitId: event.target.value }))}
        options={(units ?? []).map((unit) => ({
          value: unit.id,
          label: `${unit.code} — ${unit.name}`,
        }))}
        placeholder={translate(messages, 'inventory.identifiers.add.unitDefault')}
      />
      <TextField
        label={translate(messages, 'inventory.identifiers.add.pack')}
        description={translate(messages, 'inventory.identifiers.add.packHelp')}
        inputMode="decimal"
        dir="ltr"
        value={form.packQuantity}
        onChange={(event) => setForm((f) => ({ ...f, packQuantity: event.target.value }))}
        error={errorFor('packQuantity')}
      />
      <div className="sm:col-span-2">
        <OutcomeNote messages={messages} outcome={outcome} />
      </div>
      <div className="sm:col-span-2">
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'inventory.identifiers.add.submit')}
        </button>
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
        <button
          type="button"
          className={SECONDARY_BUTTON}
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
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Selling prices
 * ------------------------------------------------------------------ */

function PricesPanel({
  messages,
  itemId,
  canManage,
}: {
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
        <p role="status" aria-live="polite" className="text-caption text-text-muted">
          {translate(messages, 'inventory.prices.loading')}
        </p>
      ) : panel.phase === 'failed' ? (
        <p className="text-body text-error">{translateDynamic(messages, panel.messageKey)}</p>
      ) : panel.data.prices.length === 0 ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.prices.none')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <caption className="sr-only">{translate(messages, 'inventory.prices.caption')}</caption>
            <thead>
              <tr className="text-caption text-text-muted">
                <th scope="col" className="text-start font-medium">
                  {translate(messages, 'inventory.prices.column.applies')}
                </th>
                <th scope="col" className="text-end font-medium">
                  {translate(messages, 'inventory.prices.column.price')}
                </th>
                <th scope="col" className="text-start font-medium">
                  {translate(messages, 'inventory.prices.column.taxClass')}
                </th>
              </tr>
            </thead>
            <tbody>
              {panel.data.prices.map((price) => (
                <tr key={price.id} className="border-t border-border align-top">
                  <td>
                    {translate(
                      messages,
                      price.branchId !== null
                        ? 'inventory.prices.appliesBranch'
                        : price.companyId !== null
                          ? 'inventory.prices.appliesCompany'
                          : 'inventory.prices.appliesTenant'
                    )}
                  </td>
                  <td className="text-end">
                    <span dir="ltr" className="font-mono text-caption">
                      {price.unitPrice} {price.currencyCode}
                    </span>
                  </td>
                  <td>
                    {price.taxClassCode ?? translate(messages, 'inventory.prices.noTaxClass')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
      <SelectField
        label={translate(messages, 'inventory.prices.set.companyField')}
        description={translate(messages, 'inventory.prices.set.companyHelp')}
        value={form.companyId}
        onChange={(event) =>
          // The branch belongs to the company, so changing one discards the
          // other. Keeping it would send a pair the route refuses.
          setForm((f) => ({ ...f, companyId: event.target.value, branchId: '' }))
        }
        options={context.companies.map((company) => ({
          value: company.id,
          label: company.name,
        }))}
        placeholder={translate(messages, 'inventory.prices.set.everyCompany')}
        error={errorFor('companyId')}
      />
      <SelectField
        label={translate(messages, 'inventory.prices.set.branchField')}
        description={translate(messages, 'inventory.prices.set.branchHelp')}
        disabled={form.companyId === ''}
        value={form.branchId}
        onChange={(event) => setForm((f) => ({ ...f, branchId: event.target.value }))}
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
      <TextField
        label={translate(messages, 'inventory.prices.set.currency')}
        description={translate(messages, 'inventory.prices.set.currencyHelp')}
        required
        dir="ltr"
        value={form.currencyCode}
        onChange={(event) => setForm((f) => ({ ...f, currencyCode: event.target.value }))}
        error={errorFor('currencyCode')}
      />
      <TextField
        label={translate(messages, 'inventory.prices.set.price')}
        description={translate(messages, 'inventory.prices.set.priceHelp')}
        required
        inputMode="decimal"
        dir="ltr"
        value={form.unitPrice}
        onChange={(event) => setForm((f) => ({ ...f, unitPrice: event.target.value }))}
        error={errorFor('unitPrice')}
      />
      <div className="sm:col-span-2">
        <OutcomeNote messages={messages} outcome={outcome} />
      </div>
      <div className="sm:col-span-2">
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'inventory.prices.set.submit')}
        </button>
      </div>
    </form>
  );
}
