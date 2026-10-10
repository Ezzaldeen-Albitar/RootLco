'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  OperationalGrid,
  type OperationalColumn,
  type RowAction,
} from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable, type ServerPage } from '@/components/data-table/use-server-table';
import { FormMoneyField } from '@/components/forms/mui/FormMoneyField';
import { FormNumberField } from '@/components/forms/mui/FormNumberField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { EntityPicker } from '@/components/pickers/EntityPicker';
import {
  MuiEmptyState,
  MuiErrorState,
  MuiExpiredState,
  MuiLoadingState,
  MuiNoResultsState,
  MuiNotFoundState,
  MuiRefusedState,
  MuiStaleState,
  MuiUnavailableState,
} from '@/components/states/MuiStates';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { CursorPage, ReadState } from '@/lib/api/read-operation';
import { intlLocale } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import {
  FIXTURE_CURRENCY,
  FIXTURE_ROWS,
  FIXTURE_STATUS_KEY,
  simulateServer,
  type FixtureRow,
} from './fixtures';

/**
 * The shared Material UI wrappers, rendered — ADR-022 PR1.
 *
 * The components screens move to: the operational grid, the record picker, the
 * form fields and the read states, each on the product theme in the page's
 * language and direction. Like the rest of the gallery it fetches nothing:
 * the grid and the picker are driven through the REAL read hooks by a loader
 * over the gallery's fixed, obviously invented placeholder rows (`./fixtures`),
 * shaped exactly like a cursor page — rows, the cursor of the next page, and
 * whether one exists — so they behave here as they will on a screen.
 */
export function MuiWrappersSection({
  locale,
  messages,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
}) {
  const t = useCallback((key: keyof Messages) => translate(messages, key), [messages]);

  // The cursor is the next page's number, which is what a placeholder set can
  // honestly offer; the grid only ever spends what it was handed.
  const load = useCallback(
    async (request: TableRequest, cursor: string | null): Promise<ServerPage<FixtureRow>> => {
      const pageNumber = cursor === null ? 1 : Number.parseInt(cursor, 10);
      const answer = simulateServer(FIXTURE_ROWS, { ...request, page: pageNumber });
      const more = pageNumber * request.pageSize < answer.total;
      return {
        status: 'ok',
        rows: answer.rows,
        nextCursor: more ? String(pageNumber + 1) : null,
        hasMore: more,
        correlationId: null,
      };
    },
    []
  );
  const table = useServerTable(load, { initial: { ...INITIAL_REQUEST, pageSize: 10 } });

  const columns = useMemo<readonly OperationalColumn<FixtureRow>[]>(
    () => [
      {
        id: 'reference',
        headerKey: 'column.reference',
        sortable: true,
        cell: (row) => <span className="font-mono">{row.reference}</span>,
      },
      {
        id: 'descriptionKey',
        headerKey: 'column.description',
        flex: 2,
        hideBelow: 'md',
        cell: (row) => translateDynamic(messages, row.descriptionKey),
      },
      {
        id: 'status',
        headerKey: 'column.status',
        sortable: true,
        cell: (row) => translateDynamic(messages, FIXTURE_STATUS_KEY[row.status]),
      },
      {
        id: 'amount',
        headerKey: 'column.amount',
        numeric: true,
        cell: (row) =>
          formatMoney({ amount: row.amount, currency: FIXTURE_CURRENCY }, intlLocale(locale)),
      },
    ],
    [locale, messages]
  );

  const rowActions = useCallback(
    (row: FixtureRow): readonly RowAction[] => [
      {
        kind: 'link',
        label: t('gallery.muiWrappers.rowOpen'),
        href: `/${locale}/gallery#${row.id}`,
        about: row.reference,
      },
    ],
    [locale, t]
  );

  const search = useCallback(async (term: string): Promise<ReadState<CursorPage<FixtureRow>>> => {
    const needle = term.toLowerCase();
    const items = FIXTURE_ROWS.filter((row) => row.reference.toLowerCase().includes(needle));
    return {
      status: 'ok',
      data: { items, nextCursor: null, hasMore: false },
      correlationId: null,
    };
  }, []);

  const [chosen, setChosen] = useState<FixtureRow | null>(null);
  const [reference, setReference] = useState('');
  const [quantity, setQuantity] = useState('');
  const [amount, setAmount] = useState('1250.0000');
  const [status, setStatus] = useState('');
  const noop = () => undefined;

  return (
    <section className="flex flex-col gap-6" data-testid="mui-wrappers">
      <div className="flex flex-col gap-2">
        <h2 className="text-section-title font-semibold text-text-primary">
          {t('gallery.muiWrappers.title')}
        </h2>
        <p className="text-supporting text-text-secondary">
          {t('gallery.muiWrappers.description')}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-body font-semibold text-text-primary">
          {t('gallery.muiWrappers.gridTitle')}
        </h3>
        <OperationalGrid
          messages={messages}
          locale={locale}
          label={t('gallery.muiWrappers.gridLabel')}
          columns={columns}
          rowId={(row) => row.id}
          table={table}
          rowActions={rowActions}
          testId="gallery-operational-grid"
        />
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-body font-semibold text-text-primary">
          {t('gallery.muiWrappers.pickerTitle')}
        </h3>
        <EntityPicker<FixtureRow>
          messages={messages}
          locale={locale}
          label={t('gallery.muiWrappers.pickerLabel')}
          value={chosen}
          onChange={setChosen}
          labelOf={(row) => row.reference}
          load={search}
          canSearch
          notPermitted={t('gallery.muiWrappers.pickerNotPermitted')}
          minLength={2}
          maxLength={40}
          placeholder={t('gallery.muiWrappers.pickerPlaceholder')}
          example={t('gallery.muiWrappers.pickerExample')}
          tooShort={t('gallery.muiWrappers.pickerTooShort')}
          resultsLabel={t('gallery.muiWrappers.pickerResults')}
          change={t('gallery.muiWrappers.pickerChange')}
          countsAsUnsaved={false}
          testId="gallery-entity-picker"
        />
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-body font-semibold text-text-primary">
          {t('gallery.muiWrappers.fieldsTitle')}
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          <FormTextField
            label={t('gallery.mui.textFieldLabel')}
            value={reference}
            onChange={setReference}
            error={reference === '' ? t('gallery.mui.textFieldError') : undefined}
            required
          />
          <FormNumberField
            label={t('gallery.muiWrappers.fieldQuantity')}
            description={t('gallery.muiWrappers.fieldQuantityHint')}
            value={quantity}
            onChange={setQuantity}
            unit={t('gallery.muiWrappers.fieldQuantityUnit')}
            unitId="gallery-quantity-unit"
            integer
          />
          <FormMoneyField
            messages={messages}
            label={t('column.amount')}
            currency={FIXTURE_CURRENCY}
            value={amount}
            onChange={(next) => setAmount(next)}
          />
          <FormSelectField
            label={t('column.status')}
            value={status}
            onChange={setStatus}
            placeholder={t('form.select.placeholder')}
            options={(['open', 'pending', 'closed'] as const).map((value) => ({
              value,
              label: translateDynamic(messages, FIXTURE_STATUS_KEY[value]),
            }))}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-body font-semibold text-text-primary">
          {t('gallery.muiWrappers.statesTitle')}
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          <MuiEmptyState messages={messages} />
          <MuiNoResultsState messages={messages} />
          <MuiLoadingState messages={messages} rows={2} />
          <MuiUnavailableState messages={messages} onRetry={noop} />
          <MuiErrorState messages={messages} onRetry={noop} />
          <MuiRefusedState messages={messages} />
          <MuiExpiredState messages={messages} locale={locale} />
          <MuiNotFoundState messages={messages} />
          <MuiStaleState messages={messages} onRetry={noop} />
        </div>
      </div>
    </section>
  );
}
