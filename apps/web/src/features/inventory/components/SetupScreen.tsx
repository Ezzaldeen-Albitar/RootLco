'use client';

/**
 * Inventory setup — P1-30 W10, change-control CC-05: the screen through which a
 * fresh organisation gives its inventory a catalogue and places, so that stock
 * can exist at all.
 *
 * Five sections, each answering one question the acceptance tenant could not:
 *
 *   - **Categories** — `inv.item-category-list` and, for `inv.item.manage`
 *     holders, `inv.item-category-create`. The code is lower-case snake case
 *     (the server's rule, repeated here so a wrong code is refused before a
 *     request); the parent is chosen from the categories that exist.
 *   - **Units** — `inv.uom-list`, the platform set plus the tenant's own. No
 *     tenant unit WRITER exists (register area B, B-22); the section says so
 *     rather than offering a form that would send nothing.
 *   - **Items** — `inv.item-create`. A catalogue row and nothing else: no cost,
 *     no stock. The echo is rendered as the server published it, and the item
 *     search on `/inventory` is where it is found afterwards.
 *   - **Locations** — for a chosen branch, `inv.stock-location-list` and
 *     `inv.stock-location-create`. A warehouse has no parent; storage and
 *     quarantine take a warehouse of the same branch as parent. The form
 *     repeats the two rules it can know before sending; the server states the
 *     rest by the field.
 *   - **Reorder levels** — `inv.reorder-level-list`, `inv.reorder-level-set`
 *     and `inv.reorder-level-retire` (DEF-T-08). The "Running low" rule on the
 *     attention screen states its own input — "Listed when the quantity
 *     available is at or below the reorder level recorded for the item. An item
 *     with no recorded level is never listed" — and until this section existed
 *     no screen recorded one, so the rule could never fire for anybody. The
 *     level is a property of the ITEM, which is why it sits here rather than on
 *     a stock screen, and why `inv.item.manage` writes it.
 *
 * Nothing here is money and nothing is computed: every list is the server's
 * page, every created row is the server's echo (P1-30 RENDERS SERVER
 * ARITHMETIC ONLY).
 *
 * Permissions: `inv.item.read` gates the page; `inv.item.manage` (tenant-wide,
 * which only the server can decide — a branch-scoped holder is refused 403 and
 * the refusal is rendered) offers the three forms; `inv.stock.read` is needed
 * for the location list; `org.branch.read` for the branch picker.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { CheckboxField, SelectField, TextAreaField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import {
  createItem,
  createItemCategory,
  createStockLocation,
  listItems,
  listReorderLevels,
  listUnitsOfMeasure,
  retireReorderLevel,
  setReorderLevel,
} from '../api';
import {
  CATEGORY_CODE,
  ITEM_TYPES,
  LOCATION_CODE,
  OPERATOR_LOCATION_TYPES,
  MAX_DESCRIPTION,
  MAX_NAME,
  QUANTITY,
  SKU_CODE,
  type CreatedStockLocation,
  type InventoryItem,
  type ItemType,
  type OperatorLocationType,
  type ReorderLevel,
  type StockLocation,
  type StockTarget,
  type UnitOfMeasureOption,
} from '../inventory-contract';
import {
  BranchPairPicker,
  EMPTY_PAIR,
  LocationPicker,
  LocationTypeLabel,
  OutcomeNote,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  UUID,
  canNameBranch,
  useBranches,
  useItemCategories,
  useLocations,
  type BranchPair,
  type Branches,
  type Categories,
} from './shared';

const LINK = 'text-primary underline-offset-2 hover:underline';
const PANEL = 'flex flex-col gap-3 rounded-lg border border-border bg-surface p-4';

/* ------------------------------------------------------------------ *
 * Reads held by the screen
 * ------------------------------------------------------------------ */

interface Units {
  readonly items: readonly UnitOfMeasureOption[] | null;
  readonly refused: string | null;
}

function useUnits(): Units {
  const [items, setItems] = useState<readonly UnitOfMeasureOption[] | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void listUnitsOfMeasure().then((state) => {
      if (!live) return;
      if (state.status === 'ok') setItems(state.data.items);
      else
        setRefused(
          state.status === 'denied'
            ? 'inventory.setup.units.refused'
            : 'inventory.setup.units.unavailable'
        );
    });
    return () => {
      live = false;
    };
  }, []);
  return { items, refused };
}

/* ------------------------------------------------------------------ *
 * The screen
 * ------------------------------------------------------------------ */

export function SetupScreen({
  locale,
  messages,
  canManage,
  canReadStock,
  canReadBranches,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** `inv.item.manage` — whether the three create forms are offered. The server decides tenant-wide. */
  readonly canManage: boolean;
  /** `inv.stock.read` — whether the location list can be read at all. */
  readonly canReadStock: boolean;
  /** `org.branch.read` — whether a branch list is requested for the picker. */
  readonly canReadBranches: boolean;
}) {
  const categories = useItemCategories();
  const units = useUnits();
  // ONE branch read for the whole screen. Two sections take a branch — the
  // locations table and the reorder levels — and a `useBranches` in each would
  // issue `org.branch-list` twice for one paint, mount two pickers in two
  // independent phases, and give the operator two retry buttons for one
  // failure. The phase machine (CC-15) is shared, so the answer is shared.
  const branches = useBranches(canReadBranches);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <p className="text-caption" lang={locale}>
        <Link href={`/${locale}/inventory`} className={LINK}>
          {translate(messages, 'inventory.setup.backToInventory')}
        </Link>
        {canReadStock ? (
          <>
            {' · '}
            <Link href={`/${locale}/inventory/opening-stock`} className={LINK}>
              {translate(messages, 'inventory.links.openingStock')}
            </Link>
          </>
        ) : null}
      </p>

      <CategoriesSection messages={messages} categories={categories} canManage={canManage} />
      <UnitsSection messages={messages} units={units} />
      <ItemsSection
        messages={messages}
        categories={categories}
        units={units}
        canManage={canManage}
      />
      <LocationsSection
        messages={messages}
        branches={branches}
        canManage={canManage}
        canReadStock={canReadStock}
      />
      <ReorderLevelsSection
        locale={locale}
        messages={messages}
        branches={branches}
        canManage={canManage}
        canReadStock={canReadStock}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Categories
 * ------------------------------------------------------------------ */

function CategoriesSection({
  messages,
  categories,
  canManage,
}: {
  readonly messages: Messages;
  readonly categories: Categories;
  readonly canManage: boolean;
}) {
  const nameOf = (id: string | null): string => {
    if (id === null) return '';
    const parent = categories.items?.find((category) => category.id === id);
    return parent ? parent.code : id;
  };
  return (
    <section aria-labelledby="setup-categories-heading" className="flex flex-col gap-3">
      <h2 id="setup-categories-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.setup.categories.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.setup.categories.explain')}
      </p>
      {categories.refused ? (
        <p className="text-caption text-text-muted">
          {translateDynamic(messages, categories.refused)}
        </p>
      ) : categories.items === null ? null : categories.items.length === 0 ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.setup.categories.none')}
        </p>
      ) : (
        <table className="w-full text-body">
          <caption className="sr-only">
            {translate(messages, 'inventory.setup.categories.caption')}
          </caption>
          <thead>
            <tr className="text-caption text-text-muted">
              <th scope="col" className="text-start font-medium">
                {translate(messages, 'inventory.setup.categories.column.code')}
              </th>
              <th scope="col" className="text-start font-medium">
                {translate(messages, 'inventory.setup.categories.column.name')}
              </th>
              <th scope="col" className="text-start font-medium">
                {translate(messages, 'inventory.setup.categories.column.parent')}
              </th>
              <th scope="col" className="text-start font-medium">
                {translate(messages, 'inventory.setup.categories.column.status')}
              </th>
            </tr>
          </thead>
          <tbody>
            {categories.items.map((category) => (
              <tr key={category.id}>
                <td dir="ltr" className="text-start">
                  {category.code}
                </td>
                <td>{category.name}</td>
                <td dir="ltr" className="text-start">
                  {nameOf(category.parentCategoryId)}
                </td>
                <td>{translate(messages, `inventory.setup.status.${category.status}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {categories.truncated ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.setup.categories.truncated')}
        </p>
      ) : null}
      {canManage ? <CategoryForm messages={messages} categories={categories} /> : null}
    </section>
  );
}

function CategoryForm({
  messages,
  categories,
}: {
  readonly messages: Messages;
  readonly categories: Categories;
}) {
  const [form, setForm] = useState({ code: '', name: '', description: '', parentCategoryId: '' });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    const code = form.code.trim();
    if (code.length === 0) found['code'] = 'field.required';
    else if (!CATEGORY_CODE.test(code)) found['code'] = 'inventory.setup.category.codeFormat';
    const name = form.name.trim();
    if (name.length === 0) found['name'] = 'field.required';
    else if (name.length > MAX_NAME) found['name'] = 'inventory.setup.nameTooLong';
    const description = form.description.trim();
    if (description.length > MAX_DESCRIPTION) {
      found['description'] = 'inventory.setup.descriptionTooLong';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await createItemCategory({
      code,
      name,
      ...(description.length > 0 ? { description } : {}),
      ...(form.parentCategoryId ? { parentCategoryId: form.parentCategoryId } : {}),
    });
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      categories.add(result.created);
      setForm({ code: '', name: '', description: '', parentCategoryId: '' });
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="setup-category-create-heading"
      className={PANEL}
    >
      <h3 id="setup-category-create-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.setup.category.new')}
      </h3>
      <TextField
        label={translate(messages, 'inventory.setup.category.code')}
        description={translate(messages, 'inventory.setup.category.codeHelp')}
        required
        spellCheck={false}
        dir="ltr"
        value={form.code}
        onChange={(event) => setForm((f) => ({ ...f, code: event.target.value }))}
        error={errorFor('code')}
      />
      <TextField
        label={translate(messages, 'inventory.setup.category.name')}
        required
        value={form.name}
        onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
        error={errorFor('name')}
      />
      <TextAreaField
        label={translate(messages, 'inventory.setup.descriptionField')}
        rows={2}
        value={form.description}
        onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
        error={errorFor('description')}
      />
      <SelectField
        label={translate(messages, 'inventory.setup.category.parent')}
        description={translate(messages, 'inventory.setup.category.parentHelp')}
        value={form.parentCategoryId}
        onChange={(event) => setForm((f) => ({ ...f, parentCategoryId: event.target.value }))}
        options={(categories.items ?? []).map((category) => ({
          value: category.id,
          label: `${category.code} — ${category.name}`,
        }))}
        placeholder={translate(messages, 'inventory.setup.category.noParent')}
        error={errorFor('parentCategoryId')}
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'inventory.setup.category.submit')}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Units
 * ------------------------------------------------------------------ */

function UnitsSection({ messages, units }: { readonly messages: Messages; readonly units: Units }) {
  return (
    <section aria-labelledby="setup-units-heading" className="flex flex-col gap-3">
      <h2 id="setup-units-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.setup.units.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.setup.units.explain')}
      </p>
      {units.refused ? (
        <p className="text-caption text-text-muted">{translateDynamic(messages, units.refused)}</p>
      ) : units.items === null ? null : units.items.length === 0 ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.setup.units.none')}
        </p>
      ) : (
        <table className="w-full text-body">
          <caption className="sr-only">
            {translate(messages, 'inventory.setup.units.caption')}
          </caption>
          <thead>
            <tr className="text-caption text-text-muted">
              <th scope="col" className="text-start font-medium">
                {translate(messages, 'inventory.setup.units.column.code')}
              </th>
              <th scope="col" className="text-start font-medium">
                {translate(messages, 'inventory.setup.units.column.name')}
              </th>
              <th scope="col" className="text-start font-medium">
                {translate(messages, 'inventory.setup.units.column.dimension')}
              </th>
              <th scope="col" className="text-start font-medium">
                {translate(messages, 'inventory.setup.units.column.scope')}
              </th>
            </tr>
          </thead>
          <tbody>
            {units.items.map((unit) => (
              <tr key={unit.id}>
                <td dir="ltr" className="text-start">
                  {unit.code}
                </td>
                <td>{unit.name}</td>
                <td>{unit.dimension}</td>
                <td>{translate(messages, `inventory.setup.units.scope.${unit.scope}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.setup.units.noWriter')}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Items
 * ------------------------------------------------------------------ */

function ItemsSection({
  messages,
  categories,
  units,
  canManage,
}: {
  readonly messages: Messages;
  readonly categories: Categories;
  readonly units: Units;
  readonly canManage: boolean;
}) {
  const [created, setCreated] = useState<readonly InventoryItem[]>([]);
  return (
    <section aria-labelledby="setup-items-heading" className="flex flex-col gap-3">
      <h2 id="setup-items-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.setup.items.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.setup.items.explain')}
      </p>
      {canManage ? (
        <ItemForm
          messages={messages}
          categories={categories}
          units={units}
          onCreated={(item) => setCreated((current) => [...current, item])}
        />
      ) : (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.setup.needsManage')}
        </p>
      )}
      {created.length > 0 ? (
        <table className="w-full text-body">
          <caption className="sr-only">
            {translate(messages, 'inventory.setup.items.createdCaption')}
          </caption>
          <thead>
            <tr className="text-caption text-text-muted">
              <th scope="col" className="text-start font-medium">
                {translate(messages, 'inventory.setup.items.column.sku')}
              </th>
              <th scope="col" className="text-start font-medium">
                {translate(messages, 'inventory.setup.items.column.name')}
              </th>
              <th scope="col" className="text-start font-medium">
                {translate(messages, 'inventory.setup.items.column.unit')}
              </th>
              <th scope="col" className="text-start font-medium">
                {translate(messages, 'inventory.setup.items.column.type')}
              </th>
            </tr>
          </thead>
          <tbody>
            {created.map((item) => (
              <tr key={item.id}>
                <td dir="ltr" className="text-start">
                  {item.sku}
                </td>
                <td>{item.name}</td>
                <td dir="ltr" className="text-start">
                  {item.unitOfMeasure.code}
                </td>
                <td>{translate(messages, `inventory.itemType.${item.itemType}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {created.length > 0 ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.setup.items.findInSearch')}
        </p>
      ) : null}
    </section>
  );
}

function ItemForm({
  messages,
  categories,
  units,
  onCreated,
}: {
  readonly messages: Messages;
  readonly categories: Categories;
  readonly units: Units;
  readonly onCreated: (item: InventoryItem) => void;
}) {
  const [form, setForm] = useState({
    itemCategoryId: '',
    sku: '',
    name: '',
    description: '',
    uomId: '',
    itemType: 'part' as ItemType,
    isStockTracked: true,
    isSerialized: false,
  });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const noCategories = categories.items !== null && categories.items.length === 0;
  const noUnits = units.items !== null && units.items.length === 0;

  const submit = async () => {
    const found: Record<string, string> = {};
    if (!UUID.test(form.itemCategoryId)) found['itemCategoryId'] = 'field.required';
    const sku = form.sku.trim();
    if (sku.length === 0) found['sku'] = 'field.required';
    else if (!SKU_CODE.test(sku)) found['sku'] = 'inventory.setup.item.skuFormat';
    const name = form.name.trim();
    if (name.length === 0) found['name'] = 'field.required';
    else if (name.length > MAX_NAME) found['name'] = 'inventory.setup.nameTooLong';
    const description = form.description.trim();
    if (description.length > MAX_DESCRIPTION) {
      found['description'] = 'inventory.setup.descriptionTooLong';
    }
    if (!UUID.test(form.uomId)) found['uomId'] = 'field.required';
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await createItem({
      itemCategoryId: form.itemCategoryId,
      sku,
      name,
      ...(description.length > 0 ? { description } : {}),
      uomId: form.uomId,
      itemType: form.itemType,
      isStockTracked: form.isStockTracked,
      isSerialized: form.isSerialized,
    });
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      onCreated(result.created);
      setForm((f) => ({ ...f, sku: '', name: '', description: '' }));
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="setup-item-create-heading"
      className={PANEL}
    >
      <h3 id="setup-item-create-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.setup.item.new')}
      </h3>
      {noCategories ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.setup.item.needsCategory')}
        </p>
      ) : null}
      {noUnits ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.setup.item.needsUnit')}
        </p>
      ) : null}
      <SelectField
        label={translate(messages, 'inventory.setup.item.category')}
        required
        value={form.itemCategoryId}
        onChange={(event) => setForm((f) => ({ ...f, itemCategoryId: event.target.value }))}
        options={(categories.items ?? []).map((category) => ({
          value: category.id,
          label: `${category.code} — ${category.name}`,
        }))}
        placeholder={translate(messages, 'inventory.setup.item.chooseCategory')}
        error={errorFor('itemCategoryId')}
      />
      <TextField
        label={translate(messages, 'inventory.setup.item.sku')}
        description={translate(messages, 'inventory.setup.item.skuHelp')}
        required
        spellCheck={false}
        dir="ltr"
        value={form.sku}
        onChange={(event) => setForm((f) => ({ ...f, sku: event.target.value }))}
        error={errorFor('sku')}
      />
      <TextField
        label={translate(messages, 'inventory.setup.item.name')}
        required
        value={form.name}
        onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
        error={errorFor('name')}
      />
      <TextAreaField
        label={translate(messages, 'inventory.setup.descriptionField')}
        rows={2}
        value={form.description}
        onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
        error={errorFor('description')}
      />
      <SelectField
        label={translate(messages, 'inventory.setup.item.unit')}
        required
        value={form.uomId}
        onChange={(event) => setForm((f) => ({ ...f, uomId: event.target.value }))}
        options={(units.items ?? []).map((unit) => ({
          value: unit.id,
          label: `${unit.code} — ${unit.name}`,
        }))}
        placeholder={translate(messages, 'inventory.setup.item.chooseUnit')}
        error={errorFor('uomId')}
      />
      <SelectField
        label={translate(messages, 'inventory.setup.item.type')}
        required
        value={form.itemType}
        onChange={(event) => setForm((f) => ({ ...f, itemType: event.target.value as ItemType }))}
        options={ITEM_TYPES.map((type) => ({
          value: type,
          label: translate(messages, `inventory.itemType.${type}`),
        }))}
        error={errorFor('itemType')}
      />
      <CheckboxField
        label={translate(messages, 'inventory.setup.item.stockTracked')}
        description={translate(messages, 'inventory.setup.item.stockTrackedHelp')}
        checked={form.isStockTracked}
        onChange={(event) => setForm((f) => ({ ...f, isStockTracked: event.target.checked }))}
      />
      <CheckboxField
        label={translate(messages, 'inventory.setup.item.serialized')}
        checked={form.isSerialized}
        onChange={(event) => setForm((f) => ({ ...f, isSerialized: event.target.checked }))}
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'inventory.setup.item.submit')}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Locations
 * ------------------------------------------------------------------ */

function LocationsSection({
  messages,
  branches,
  canManage,
  canReadStock,
}: {
  readonly messages: Messages;
  readonly branches: Branches;
  readonly canManage: boolean;
  readonly canReadStock: boolean;
}) {
  const [pair, setPair] = useState<BranchPair>(EMPTY_PAIR);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [target, setTarget] = useState<StockTarget | null>(null);
  const [added, setAdded] = useState<readonly CreatedStockLocation[]>([]);
  const locations = useLocations(canReadStock ? target : null);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const known: readonly StockLocation[] = [
    ...(locations.items ?? []),
    ...added.filter((location) => !locations.items?.some((row) => row.id === location.id)),
  ];

  return (
    <section aria-labelledby="setup-locations-heading" className="flex flex-col gap-3">
      <h2 id="setup-locations-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.setup.locations.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.setup.locations.explain')}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const found: Record<string, string> = {};
          if (!UUID.test(pair.companyId.trim())) found['companyId'] = 'inventory.common.idFormat';
          if (!UUID.test(pair.branchId.trim())) found['branchId'] = 'inventory.common.idFormat';
          setErrors(found);
          if (Object.keys(found).length > 0) return;
          setAdded([]);
          setTarget({ companyId: pair.companyId.trim(), branchId: pair.branchId.trim() });
        }}
        noValidate
        aria-label={translate(messages, 'inventory.setup.locations.targetLabel')}
        className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3"
      >
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
          <button type="submit" className={PRIMARY_BUTTON} disabled={!canNameBranch(branches)}>
            {translate(messages, 'inventory.setup.locations.show')}
          </button>
        </div>
      </form>

      {target === null ? null : !canReadStock ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.setup.locations.noPermission')}
        </p>
      ) : locations.refused ? (
        <p className="text-caption text-text-muted">
          {translateDynamic(messages, locations.refused)}
        </p>
      ) : locations.items === null ? null : known.length === 0 ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.setup.locations.none')}
        </p>
      ) : (
        <table className="w-full text-body">
          <caption className="sr-only">
            {translate(messages, 'inventory.setup.locations.caption')}
          </caption>
          <thead>
            <tr className="text-caption text-text-muted">
              <th scope="col" className="text-start font-medium">
                {translate(messages, 'inventory.setup.locations.column.code')}
              </th>
              <th scope="col" className="text-start font-medium">
                {translate(messages, 'inventory.setup.locations.column.name')}
              </th>
              <th scope="col" className="text-start font-medium">
                {translate(messages, 'inventory.setup.locations.column.type')}
              </th>
              <th scope="col" className="text-start font-medium">
                {translate(messages, 'inventory.setup.locations.column.parent')}
              </th>
            </tr>
          </thead>
          <tbody>
            {known.map((location) => (
              <tr key={location.id}>
                <td dir="ltr" className="text-start">
                  {location.locationCode}
                </td>
                <td>{location.name}</td>
                <td>
                  <LocationTypeLabel messages={messages} type={location.locationType} />
                </td>
                <td dir="ltr" className="text-start">
                  {location.parentLocationId === null
                    ? ''
                    : (known.find((row) => row.id === location.parentLocationId)?.locationCode ??
                      location.parentLocationId)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {target !== null && locations.truncated ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.locations.truncated')}
        </p>
      ) : null}
      {target !== null && canManage ? (
        <LocationForm
          messages={messages}
          target={target}
          known={known}
          onCreated={(location) => setAdded((current) => [...current, location])}
        />
      ) : null}
    </section>
  );
}

function LocationForm({
  messages,
  target,
  known,
  onCreated,
}: {
  readonly messages: Messages;
  readonly target: StockTarget;
  readonly known: readonly StockLocation[];
  readonly onCreated: (location: CreatedStockLocation) => void;
}) {
  const [form, setForm] = useState({
    locationCode: '',
    name: '',
    locationType: 'warehouse' as OperatorLocationType,
    parentLocationId: '',
  });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const needsParent = form.locationType !== 'warehouse';
  const warehouses = known.filter((location) => location.locationType === 'warehouse');

  const submit = async () => {
    const found: Record<string, string> = {};
    const locationCode = form.locationCode.trim();
    if (locationCode.length === 0) found['locationCode'] = 'field.required';
    else if (!LOCATION_CODE.test(locationCode)) {
      found['locationCode'] = 'inventory.setup.location.codeFormat';
    }
    const name = form.name.trim();
    if (name.length === 0) found['name'] = 'field.required';
    else if (name.length > MAX_NAME) found['name'] = 'inventory.setup.nameTooLong';
    if (needsParent && !UUID.test(form.parentLocationId)) {
      found['parentLocationId'] = 'inventory.setup.location.parentRequired';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await createStockLocation({
      companyId: target.companyId,
      branchId: target.branchId,
      locationCode,
      name,
      locationType: form.locationType,
      ...(needsParent ? { parentLocationId: form.parentLocationId } : {}),
    });
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      onCreated(result.created);
      setForm((f) => ({ ...f, locationCode: '', name: '' }));
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="setup-location-create-heading"
      className={PANEL}
    >
      <h3 id="setup-location-create-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.setup.location.new')}
      </h3>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.setup.location.explain')}
      </p>
      <TextField
        label={translate(messages, 'inventory.setup.location.code')}
        description={translate(messages, 'inventory.setup.location.codeHelp')}
        required
        spellCheck={false}
        dir="ltr"
        value={form.locationCode}
        onChange={(event) => setForm((f) => ({ ...f, locationCode: event.target.value }))}
        error={errorFor('locationCode')}
      />
      <TextField
        label={translate(messages, 'inventory.setup.location.name')}
        required
        value={form.name}
        onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
        error={errorFor('name')}
      />
      <SelectField
        label={translate(messages, 'inventory.setup.location.type')}
        required
        value={form.locationType}
        onChange={(event) =>
          setForm((f) => ({
            ...f,
            locationType: event.target.value as OperatorLocationType,
            parentLocationId: event.target.value === 'warehouse' ? '' : f.parentLocationId,
          }))
        }
        options={OPERATOR_LOCATION_TYPES.map((type) => ({
          value: type,
          label: translate(messages, `inventory.locationType.${type}`),
        }))}
        error={errorFor('locationType')}
      />
      {needsParent ? (
        <SelectField
          label={translate(messages, 'inventory.setup.location.parent')}
          description={translate(messages, 'inventory.setup.location.parentHelp')}
          required
          value={form.parentLocationId}
          onChange={(event) => setForm((f) => ({ ...f, parentLocationId: event.target.value }))}
          options={warehouses.map((location) => ({
            value: location.id,
            label: `${location.locationCode} — ${location.name}`,
          }))}
          placeholder={translate(messages, 'inventory.setup.location.chooseParent')}
          error={errorFor('parentLocationId')}
        />
      ) : null}
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'inventory.setup.location.submit')}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Reorder levels (DEF-T-08)
 * ------------------------------------------------------------------ */

/**
 * The quantity at or below which an item counts as low.
 *
 * The attention screen's "Running low" rule names this as its one input and
 * says an item with no recorded level is never listed. No screen recorded one,
 * so the rule was inert for every organisation the platform provisions. This
 * section records it, lists what is recorded, and retires a level that no
 * longer applies.
 *
 * ## What a level is ABOUT is its narrowing, and it is never blank
 *
 * A row may name nothing, a company, a company and a branch, or a company, a
 * branch and a location, and each omission WIDENS it. A blank cell would read
 * as missing data rather than as every branch, so the table states which of the
 * four each row is, in words.
 *
 * ## Quantities stay the operator's strings
 *
 * `numeric(12,3)` on the server, an exact decimal string here, and nothing on
 * this side parses, rounds or reformats it. The level itself may be zero — tell
 * me the moment this runs out — while the preferred order quantity may not,
 * because an order of nothing is not an order.
 */
function ReorderLevelsSection({
  locale,
  messages,
  branches,
  canManage,
  canReadStock,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly branches: Branches;
  readonly canManage: boolean;
  readonly canReadStock: boolean;
}) {
  const [levels, setLevels] = useState<readonly ReorderLevel[] | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    if (!canReadStock) return;
    let live = true;
    void listReorderLevels().then((state) => {
      if (!live) return;
      if (state.status === 'ok') {
        setLevels(state.data.levels.items);
        setTruncated(state.data.levels.hasMore);
        setRefused(null);
      } else {
        setLevels(null);
        setRefused(
          state.status === 'denied'
            ? 'inventory.reorderLevels.refused'
            : 'inventory.reorderLevels.unavailable'
        );
      }
    });
    return () => {
      live = false;
    };
  }, [canReadStock, epoch]);

  return (
    <section aria-labelledby="setup-reorder-levels-heading" className="flex flex-col gap-3">
      <h2 id="setup-reorder-levels-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.reorderLevels.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.reorderLevels.explain')}
      </p>
      {!canReadStock ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.reorderLevels.noPermission')}
        </p>
      ) : refused ? (
        <p className="text-caption text-text-muted">{translateDynamic(messages, refused)}</p>
      ) : levels === null ? null : levels.length === 0 ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.reorderLevels.none')}
        </p>
      ) : (
        <table className="w-full text-body">
          <caption className="sr-only">
            {translate(messages, 'inventory.reorderLevels.caption')}
          </caption>
          <thead>
            <tr className="text-caption text-text-muted">
              <th scope="col" className="text-start font-medium">
                {translate(messages, 'inventory.reorderLevels.column.item')}
              </th>
              <th scope="col" className="text-start font-medium">
                {translate(messages, 'inventory.reorderLevels.column.appliesTo')}
              </th>
              <th scope="col" className="text-end font-medium">
                {translate(messages, 'inventory.reorderLevels.column.level')}
              </th>
              <th scope="col" className="text-end font-medium">
                {translate(messages, 'inventory.reorderLevels.column.order')}
              </th>
              <th scope="col" className="text-start font-medium">
                {translate(messages, 'inventory.reorderLevels.column.action')}
              </th>
            </tr>
          </thead>
          <tbody>
            {levels.map((level) => (
              <ReorderLevelRow
                key={level.id}
                messages={messages}
                level={level}
                canManage={canManage}
                onRetired={() => setEpoch((n) => n + 1)}
              />
            ))}
          </tbody>
        </table>
      )}
      {truncated ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.reorderLevels.truncated')}
        </p>
      ) : null}
      {canManage ? (
        <ReorderLevelForm
          locale={locale}
          messages={messages}
          branches={branches}
          onSet={() => setEpoch((n) => n + 1)}
        />
      ) : (
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.reorderLevels.needsManage')}
        </p>
      )}
    </section>
  );
}

/** Which of the four narrowings a row is, said in words rather than left blank. */
function appliesToKey(level: ReorderLevel): string {
  if (level.companyId === null) return 'inventory.reorderLevels.appliesTo.organisation';
  if (level.branchId === null) return 'inventory.reorderLevels.appliesTo.company';
  if (level.locationId === null) return 'inventory.reorderLevels.appliesTo.branch';
  return 'inventory.reorderLevels.appliesTo.location';
}

function ReorderLevelRow({
  messages,
  level,
  canManage,
  onRetired,
}: {
  readonly messages: Messages;
  readonly level: ReorderLevel;
  readonly canManage: boolean;
  readonly onRetired: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const retire = async () => {
    setBusy(true);
    // The LEVEL's own `recordVersion` as the list answered it — never a list
    // version, never defaulted, never carried across a write.
    const result = await retireReorderLevel(level.id, level.recordVersion);
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success') onRetired();
  };

  return (
    <tr className="border-t border-border align-top">
      <td>
        <code className="font-mono text-caption" dir="ltr">
          {level.sku}
        </code>{' '}
        <bdi>{level.itemName}</bdi>
      </td>
      <td>
        {translateDynamic(messages, appliesToKey(level))}
        {level.locationCode === null ? null : (
          <>
            {' '}
            <code className="font-mono text-caption" dir="ltr">
              {level.locationCode}
            </code>
          </>
        )}
      </td>
      <td className="text-end" dir="ltr">
        {level.reorderLevelQty}
      </td>
      <td className="text-end" dir="ltr">
        {level.preferredOrderQty ?? translate(messages, 'inventory.reorderLevels.noOrderQty')}
      </td>
      <td>
        {canManage ? (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              className={SECONDARY_BUTTON}
              disabled={busy}
              onClick={() => {
                void retire();
              }}
            >
              {translate(messages, 'inventory.reorderLevels.retire.action')}
              <span className="sr-only"> {level.sku}</span>
            </button>
            <OutcomeNote messages={messages} outcome={outcome} />
          </div>
        ) : null}
      </td>
    </tr>
  );
}

function ReorderLevelForm({
  locale,
  messages,
  branches,
  onSet,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly branches: Branches;
  readonly onSet: () => void;
}) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<readonly InventoryItem[] | null>(null);
  const [itemNote, setItemNote] = useState<string | null>(null);
  const [form, setForm] = useState({ itemId: '', reorderLevelQty: '', preferredOrderQty: '' });
  const [pair, setPair] = useState<BranchPair>(EMPTY_PAIR);
  const [locationId, setLocationId] = useState('');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const companyId = pair.companyId.trim();
  const branchId = pair.branchId.trim();
  const target = UUID.test(companyId) && UUID.test(branchId) ? { companyId, branchId } : null;
  const locations = useLocations(target);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  // The item list is ASKED for, never taken on first paint: a catalogue can be
  // long, and a picker showing the first page silently omits the rest. The box
  // is the server's own `search` parameter, and the note says when more matched
  // than were served.
  const findItems = async () => {
    const text = search.trim();
    const page = await listItems(
      // Only stock-tracked items: a level on an item nothing holds a balance
      // for could never be compared against anything.
      { ...(text.length > 0 ? { search: text } : {}), stockTrackedOnly: 'true' },
      { ...INITIAL_REQUEST, pageSize: 50 },
      null
    );
    if (page.status !== 'ok') {
      setItems(null);
      setItemNote(
        page.status === 'denied'
          ? 'inventory.reorderLevels.items.refused'
          : 'inventory.reorderLevels.items.unavailable'
      );
      return;
    }
    setItems(page.rows);
    setItemNote(
      page.rows.length === 0
        ? 'inventory.reorderLevels.items.none'
        : page.hasMore
          ? 'inventory.reorderLevels.items.more'
          : null
    );
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    if (!UUID.test(form.itemId)) found['itemId'] = 'field.required';
    const level = form.reorderLevelQty.trim();
    // Zero is a legitimate level — tell me the moment this runs out — so only
    // the shape is checked here.
    if (!QUANTITY.test(level)) found['reorderLevelQty'] = 'inventory.reorderLevels.qtyFormat';
    const order = form.preferredOrderQty.trim();
    if (order.length > 0 && !QUANTITY.test(order)) {
      found['preferredOrderQty'] = 'inventory.reorderLevels.qtyFormat';
    }
    if (companyId.length > 0 && !UUID.test(companyId)) {
      found['companyId'] = 'inventory.common.idFormat';
    }
    if (branchId.length > 0 && !UUID.test(branchId)) {
      found['branchId'] = 'inventory.common.idFormat';
    }
    // The signature narrows left to right: a branch with no company, or a shelf
    // with no branch, is a row the server cannot store.
    if (branchId.length > 0 && companyId.length === 0) {
      found['companyId'] = 'inventory.reorderLevels.branchNeedsCompany';
    }
    if (locationId.length > 0 && branchId.length === 0) {
      found['locationId'] = 'inventory.reorderLevels.locationNeedsBranch';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await setReorderLevel({
      itemId: form.itemId,
      ...(companyId.length > 0 ? { companyId } : {}),
      ...(branchId.length > 0 ? { branchId } : {}),
      ...(locationId.length > 0 ? { locationId } : {}),
      reorderLevelQty: level,
      ...(order.length > 0 ? { preferredOrderQty: order } : {}),
    });
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success') {
      setForm((f) => ({ ...f, reorderLevelQty: '', preferredOrderQty: '' }));
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
      aria-labelledby="setup-reorder-level-set-heading"
      className={PANEL}
      lang={locale}
    >
      <h3 id="setup-reorder-level-set-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'inventory.reorderLevels.set.heading')}
      </h3>
      <p className="text-caption text-text-muted">
        {translate(messages, 'inventory.reorderLevels.set.explain')}
      </p>
      <TextField
        label={translate(messages, 'inventory.reorderLevels.items.search')}
        description={translate(messages, 'inventory.reorderLevels.items.searchHelp')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div>
        <button
          type="button"
          className={SECONDARY_BUTTON}
          onClick={() => {
            void findItems();
          }}
        >
          {translate(messages, 'inventory.reorderLevels.items.find')}
        </button>
      </div>
      <SelectField
        label={translate(messages, 'inventory.reorderLevels.set.item')}
        required
        {...(itemNote ? { description: translateDynamic(messages, itemNote) } : {})}
        value={form.itemId}
        onChange={(event) => setForm((f) => ({ ...f, itemId: event.target.value }))}
        options={(items ?? []).map((item) => ({
          value: item.id,
          label: `${item.sku} — ${item.name}`,
        }))}
        placeholder={translate(messages, 'inventory.reorderLevels.set.chooseItem')}
        error={errorFor('itemId')}
      />
      <BranchPairPicker
        messages={messages}
        branches={branches}
        label={translate(messages, 'inventory.reorderLevels.set.branch')}
        placeholder={translate(messages, 'inventory.reorderLevels.set.everyBranch')}
        value={pair}
        onChange={setPair}
        errors={{ companyId: errorFor('companyId'), branchId: errorFor('branchId') }}
      />
      <LocationPicker
        messages={messages}
        locations={locations}
        label={translate(messages, 'inventory.reorderLevels.set.location')}
        placeholder={translate(messages, 'inventory.reorderLevels.set.wholeBranch')}
        value={locationId}
        onChange={setLocationId}
        error={errorFor('locationId')}
      />
      <TextField
        label={translate(messages, 'inventory.reorderLevels.set.level')}
        description={translate(messages, 'inventory.reorderLevels.set.levelHelp')}
        required
        inputMode="decimal"
        dir="ltr"
        value={form.reorderLevelQty}
        onChange={(event) => setForm((f) => ({ ...f, reorderLevelQty: event.target.value }))}
        error={errorFor('reorderLevelQty')}
      />
      <TextField
        label={translate(messages, 'inventory.reorderLevels.set.order')}
        description={translate(messages, 'inventory.reorderLevels.set.orderHelp')}
        inputMode="decimal"
        dir="ltr"
        value={form.preferredOrderQty}
        onChange={(event) => setForm((f) => ({ ...f, preferredOrderQty: event.target.value }))}
        error={errorFor('preferredOrderQty')}
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div>
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'inventory.reorderLevels.set.submit')}
        </button>
      </div>
    </form>
  );
}
