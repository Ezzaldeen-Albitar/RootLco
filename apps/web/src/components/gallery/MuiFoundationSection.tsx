'use client';

import { useCallback, useMemo, useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import { useTheme } from '@mui/material/styles';
import { BarChart } from '@mui/x-charts/BarChart';
import { DataGrid, type GridColDef, type GridPaginationModel } from '@mui/x-data-grid';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { SimpleTreeView } from '@mui/x-tree-view/SimpleTreeView';
import { TreeItem } from '@mui/x-tree-view/TreeItem';
import type { Dayjs } from 'dayjs';
import { pageLabel } from '@/components/ui-foundation/mui-locale';
import type { Locale } from '@/i18n/config';
import { directionOf } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { intlLocale } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { LAYOUT_PX } from '@/styles/tokens/generated/tokens';
import {
  FIXTURE_CURRENCY,
  FIXTURE_ROWS,
  FIXTURE_STATUS_KEY,
  simulateServer,
  type FixtureRow,
} from './fixtures';

/**
 * The Material UI foundation, rendered — ADR-022.
 *
 * A visual reference for the pull requests that move screens onto Material UI:
 * each Community component the product adopts, on the product theme, in the
 * page's language and direction. Like the rest of the gallery it fetches
 * nothing; every row and figure is one of the gallery's fixed, obviously
 * invented placeholder rows (`./fixtures`), and nothing here is business data.
 *
 * The grid is wired the way every product list will be: SERVER pagination with
 * an UNKNOWN row count (`rowCount={-1}`) and `hasNextPage` from the page itself,
 * because the platform's list contract carries no total (P1-26-F-001). Its
 * range label comes from the catalogue and never shows a count, and it has no
 * toolbar, so there is no export or print surface (`validate:web-boundary`
 * refuses both). Its pagination label is "Page N", from its own page model.
 */
export function MuiFoundationSection({
  locale,
  messages,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
}) {
  const t = useCallback((key: keyof Messages) => translate(messages, key), [messages]);
  const rtl = directionOf(locale) === 'rtl';
  const theme = useTheme();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [date, setDate] = useState<Dayjs | null>(null);
  const [status, setStatus] = useState<FixtureRow['status'] | null>(null);
  const [pagination, setPagination] = useState<GridPaginationModel>({ page: 0, pageSize: 10 });

  const statusLabel = useCallback(
    (value: FixtureRow['status']) => translateDynamic(messages, FIXTURE_STATUS_KEY[value]),
    [messages]
  );

  const page = useMemo(
    () =>
      simulateServer(FIXTURE_ROWS, {
        page: pagination.page + 1,
        pageSize: pagination.pageSize,
        sort: null,
        filters: [],
        search: '',
      }),
    [pagination]
  );
  // The cursor contract's `hasMore`, reconstructed for the placeholder rows: is
  // there a row after this page? The count is used for nothing else.
  const hasNextPage = (pagination.page + 1) * pagination.pageSize < FIXTURE_ROWS.length;

  const columns = useMemo<GridColDef<FixtureRow>[]>(
    () => [
      { field: 'reference', headerName: t('column.reference'), flex: 1, sortable: false },
      {
        field: 'descriptionKey',
        headerName: t('column.description'),
        flex: 2,
        sortable: false,
        valueGetter: (value: string) => translateDynamic(messages, value),
      },
      {
        field: 'status',
        headerName: t('column.status'),
        flex: 1,
        sortable: false,
        valueGetter: (value: FixtureRow['status']) => statusLabel(value),
      },
      {
        field: 'amount',
        headerName: t('column.amount'),
        flex: 1,
        sortable: false,
        valueGetter: (value: string) =>
          formatMoney({ amount: value, currency: FIXTURE_CURRENCY }, intlLocale(locale)),
      },
    ],
    [locale, messages, statusLabel, t]
  );

  const counts = useMemo(() => {
    const order: FixtureRow['status'][] = ['open', 'pending', 'closed'];
    return order.map((value) => ({
      status: value,
      label: statusLabel(value),
      count: FIXTURE_ROWS.filter((row) => row.status === value).length,
    }));
  }, [statusLabel]);

  return (
    <section className="flex flex-col gap-4" data-testid="mui-foundation">
      <h2 className="text-section-title font-semibold text-text-primary">
        {t('gallery.mui.title')}
      </h2>
      <p className="text-supporting text-text-secondary">{t('gallery.mui.description')}</p>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="contained">{t('gallery.mui.buttonPrimary')}</Button>
        <Button variant="outlined">{t('gallery.mui.buttonSecondary')}</Button>
        <Button variant="text" onClick={() => setDialogOpen(true)}>
          {t('gallery.mui.dialogOpen')}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label={t('gallery.mui.textFieldLabel')}
          error
          helperText={t('gallery.mui.textFieldError')}
        />
        <Autocomplete
          options={counts.map((entry) => entry.status)}
          getOptionLabel={statusLabel}
          value={status}
          onChange={(_, value) => setStatus(value)}
          renderInput={(params) => (
            <TextField {...params} label={t('gallery.mui.autocompleteLabel')} />
          )}
        />
        <DatePicker label={t('gallery.mui.datePickerLabel')} value={date} onChange={setDate} />
      </div>

      <div className="rounded-lg border border-border bg-surface">
        <DataGrid
          aria-label={t('gallery.mui.gridLabel')}
          rows={[...page.rows]}
          columns={columns}
          paginationMode="server"
          sortingMode="server"
          filterMode="server"
          rowCount={-1}
          paginationMeta={{ hasNextPage }}
          paginationModel={pagination}
          onPaginationModelChange={setPagination}
          // The grid knows its page, so it is labelled by it — never by a count.
          // A `localeText` prop REPLACES the theme's texts rather than merging
          // with them, so the theme's are spread in first.
          localeText={{
            ...theme.components?.MuiDataGrid?.defaultProps?.localeText,
            paginationDisplayedRows: () => pageLabel(t('mui.pagination.page'), pagination.page),
          }}
          disableVirtualization
          disableColumnMenu
        />
      </div>

      <figure className="flex flex-col gap-2">
        <figcaption className="text-body font-medium text-text-primary">
          {t('gallery.mui.chartTitle')}
        </figcaption>
        <BarChart
          height={LAYOUT_PX['chart-height']}
          xAxis={[
            {
              scaleType: 'band',
              data: counts.map((entry) => entry.label),
              // Charts do not mirror themselves; the category axis runs from
              // the inline start in both directions.
              reverse: rtl,
            },
          ]}
          yAxis={[{ position: rtl ? 'right' : 'left' }]}
          series={[
            { data: counts.map((entry) => entry.count), label: t('gallery.mui.chartCountHeader') },
          ]}
          hideLegend
        />
        <table className="text-supporting text-text-primary">
          <caption className="sr-only">{t('gallery.mui.chartTableCaption')}</caption>
          <thead>
            <tr>
              <th scope="col" className="text-start">
                {t('column.status')}
              </th>
              <th scope="col" className="text-end">
                {t('gallery.mui.chartCountHeader')}
              </th>
            </tr>
          </thead>
          <tbody>
            {counts.map((entry) => (
              <tr key={entry.status}>
                <th scope="row" className="text-start font-normal">
                  {entry.label}
                </th>
                <td className="text-end">{entry.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figure>

      <SimpleTreeView aria-label={t('gallery.mui.treeLabel')} defaultExpandedItems={['root']}>
        <TreeItem itemId="root" label={t('gallery.mui.treeRoot')}>
          <TreeItem itemId="first" label={t('gallery.mui.treeBranchFirst')} />
          <TreeItem itemId="second" label={t('gallery.mui.treeBranchSecond')} />
        </TreeItem>
      </SimpleTreeView>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        aria-labelledby="mui-foundation-dialog-title"
      >
        <DialogTitle id="mui-foundation-dialog-title">{t('gallery.mui.dialogTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('gallery.mui.dialogBody')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t('gallery.mui.buttonSecondary')}</Button>
          <Button variant="contained" onClick={() => setDialogOpen(false)}>
            {t('gallery.mui.buttonPrimary')}
          </Button>
        </DialogActions>
      </Dialog>
    </section>
  );
}
