import { arSD as materialArabic, enUS as materialEnglish } from '@mui/material/locale';
import type { Localization } from '@mui/material/locale';
import type { GridLocaleText } from '@mui/x-data-grid';
import { arSD as gridArabic, enUS as gridEnglish } from '@mui/x-data-grid/locales';
import type { PickersLocaleText } from '@mui/x-date-pickers';
import { enUS as pickersEnglish } from '@mui/x-date-pickers/locales';
import type { ChartsLocaleText } from '@mui/x-charts/locales';
import { enUS as chartsEnglish } from '@mui/x-charts/locales';
import type { Locale } from '@/i18n/config';
import type { MuiText } from './mui-text';

/**
 * The texts Material UI and MUI X render, built from THIS repository's catalogue.
 *
 * ## Why the upstream locales are only a base
 *
 * Measured against the installed versions: Material ships `arSD`; the data grid
 * ships `arSD` covering 126 of its 226 texts (every Community gap is filled
 * here); the date pickers and the charts ship NO Arabic at all. So the upstream
 * locale is the floor, and every text an operator reads on a Community
 * component is overridden from `apps/web/src/i18n/messages/{en,ar}.json` — the
 * same catalogues, the same plain-language gate and the same parity test as
 * every other string in the product.
 *
 * Texts that only a commercial (Pro/Premium) feature reads — pivoting, the chart
 * builder, the assistant, range pickers, export — are deliberately NOT
 * provided: ADR-022 adopts the MIT editions only, and a translation for a
 * feature the product cannot render would be dead text.
 *
 * ## No derived total, anywhere
 *
 * Every list operation returns `{ items, nextCursor, hasMore }` and no count
 * (P1-26-F-001). The grid, told `rowCount={-1}`, can still DERIVE a "total"
 * once it reaches a page with no successor, and hands it to
 * `paginationDisplayedRows` as `count`. The label below never reads `count` or
 * `estimated`, so a derived total cannot reach an operator.
 *
 * It does not read `to` either. With an unknown count the grid passes the page's
 * UPPER BOUND as `to` — measured in the gallery: five rows on a page of ten are
 * labelled "1–10" — so the only exact figure it receives is `from`. A grid that
 * knows its page (the gallery; PR1's operational grid) labels it "Page N" with
 * `pageLabel` instead.
 */

/** A `{name}` template filled from plain values. Missing values stay visible. */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole
  );
}

/**
 * The grid's default pagination label: the first row on screen, never a count.
 *
 * Exported so the "no derived total" rule is tested on the function itself
 * rather than on whatever the grid happens to render in jsdom.
 */
export function rowsShownLabel(text: MuiText) {
  return ({ from }: { from: number; to: number; count: number; estimated: number | undefined }) =>
    fill(text['mui.pagination.rowsShown'], { from });
}

/** "Page N" for a grid that knows its zero-based page index. */
export function pageLabel(template: string, page: number): string {
  return fill(template, { page: page + 1 });
}

type PaginationItem = 'first' | 'last' | 'next' | 'previous';

function paginationItemLabel(text: MuiText) {
  return (type: PaginationItem) => text[`mui.pagination.${type}`];
}

/** Material's own components (Autocomplete, Alert, TablePagination). */
function materialText(text: MuiText): Localization {
  return {
    components: {
      MuiAlert: { defaultProps: { closeText: text['mui.material.alertClose'] } },
      MuiAutocomplete: {
        defaultProps: {
          clearText: text['mui.material.autocompleteClear'],
          closeText: text['mui.material.autocompleteClose'],
          loadingText: text['mui.material.autocompleteLoading'],
          noOptionsText: text['mui.material.autocompleteNoOptions'],
          openText: text['mui.material.autocompleteOpen'],
        },
      },
      MuiTablePagination: {
        defaultProps: {
          labelRowsPerPage: text['mui.pagination.rowsPerPage'],
          // `page` is zero-based; `count` is deliberately never read.
          labelDisplayedRows: ({ page }) => pageLabel(text['mui.pagination.page'], page),
          getItemAriaLabel: paginationItemLabel(text),
        },
      },
    },
  };
}

/** The Community data grid's texts. */
function gridText(text: MuiText): Partial<GridLocaleText> {
  return {
    noRowsLabel: text['mui.grid.noRows'],
    noResultsOverlayLabel: text['mui.grid.noResults'],
    noColumnsOverlayLabel: text['mui.grid.noColumns'],
    noColumnsOverlayManageColumns: text['mui.grid.columnMenuManage'],

    toolbarDensity: text['mui.grid.density'],
    toolbarDensityLabel: text['mui.grid.density'],
    toolbarDensityCompact: text['mui.grid.densityCompact'],
    toolbarDensityStandard: text['mui.grid.densityStandard'],
    toolbarDensityComfortable: text['mui.grid.densityComfortable'],
    toolbarColumns: text['mui.grid.toolbarColumns'],
    toolbarColumnsLabel: text['mui.grid.columnMenuManage'],
    toolbarFilters: text['mui.grid.toolbarFilters'],
    toolbarFiltersLabel: text['mui.grid.columnFiltersLabel'],
    toolbarFiltersTooltipHide: text['mui.grid.toolbarFiltersHide'],
    toolbarFiltersTooltipShow: text['mui.grid.columnFiltersLabel'],
    toolbarFiltersTooltipActive: (count: number) =>
      fill(text['mui.grid.columnFiltersActive'], { count }),
    toolbarQuickFilterPlaceholder: text['mui.grid.toolbarSearch'],
    toolbarQuickFilterLabel: text['mui.grid.toolbarSearch'],
    toolbarQuickFilterDeleteIconLabel: text['mui.grid.toolbarSearchClear'],

    columnsManagementSearchTitle: text['mui.grid.columnsSearch'],
    columnsManagementNoColumns: text['mui.grid.columnsNone'],
    columnsManagementShowHideAllText: text['mui.grid.columnsShowHideAll'],
    columnsManagementReset: text['mui.grid.columnsReset'],

    filterPanelAddFilter: text['mui.grid.filterAdd'],
    filterPanelRemoveAll: text['mui.grid.filterRemoveAll'],
    filterPanelDeleteIconLabel: text['mui.grid.filterDelete'],
    filterPanelOperator: text['mui.grid.filterOperator'],
    filterPanelColumn: text['mui.grid.filterColumn'],
    filterPanelInputLabel: text['mui.grid.filterValue'],
    filterPanelInputPlaceholder: text['mui.grid.filterValuePlaceholder'],
    filterOperatorContains: text['mui.grid.operatorContains'],
    filterOperatorDoesNotContain: text['mui.grid.operatorDoesNotContain'],
    filterOperatorEquals: text['mui.grid.operatorEquals'],
    filterOperatorDoesNotEqual: text['mui.grid.operatorDoesNotEqual'],
    filterOperatorStartsWith: text['mui.grid.operatorStartsWith'],
    filterOperatorEndsWith: text['mui.grid.operatorEndsWith'],
    filterOperatorIs: text['mui.grid.operatorIs'],
    filterOperatorNot: text['mui.grid.operatorNot'],
    filterOperatorAfter: text['mui.grid.operatorAfter'],
    filterOperatorOnOrAfter: text['mui.grid.operatorOnOrAfter'],
    filterOperatorBefore: text['mui.grid.operatorBefore'],
    filterOperatorOnOrBefore: text['mui.grid.operatorOnOrBefore'],
    filterOperatorIsEmpty: text['mui.grid.operatorIsEmpty'],
    filterOperatorIsNotEmpty: text['mui.grid.operatorIsNotEmpty'],
    filterOperatorIsAnyOf: text['mui.grid.operatorIsAnyOf'],

    columnMenuLabel: text['mui.grid.columnMenuLabel'],
    columnMenuAriaLabel: (columnName: string) =>
      fill(text['mui.grid.columnMenuFor'], { column: columnName }),
    columnMenuShowColumns: text['mui.grid.columnMenuShow'],
    columnMenuManageColumns: text['mui.grid.columnMenuManage'],
    columnMenuFilter: text['mui.grid.columnMenuFilter'],
    columnMenuHideColumn: text['mui.grid.columnMenuHide'],
    columnMenuUnsort: text['mui.grid.columnMenuUnsort'],
    columnMenuSortAsc: text['mui.grid.columnMenuSortAsc'],
    columnMenuSortDesc: text['mui.grid.columnMenuSortDesc'],
    columnHeaderSortIconLabel: text['mui.grid.columnSortLabel'],
    columnHeaderFiltersLabel: text['mui.grid.columnFiltersLabel'],
    columnHeaderFiltersTooltipActive: (count: number) =>
      fill(text['mui.grid.columnFiltersActive'], { count }),

    footerRowSelected: (count: number) => fill(text['mui.grid.rowsSelected'], { count }),
    actionsCellMore: text['mui.grid.actionsMore'],

    checkboxSelectionHeaderName: text['mui.grid.checkboxHeader'],
    checkboxSelectionSelectAllRows: text['mui.grid.checkboxSelectAll'],
    checkboxSelectionUnselectAllRows: text['mui.grid.checkboxUnselectAll'],
    checkboxSelectionSelectRow: text['mui.grid.checkboxSelectRow'],
    checkboxSelectionUnselectRow: text['mui.grid.checkboxUnselectRow'],

    paginationRowsPerPage: text['mui.pagination.rowsPerPage'],
    paginationDisplayedRows: rowsShownLabel(text),
    paginationItemAriaLabel: paginationItemLabel(text),
  };
}

type PickerView = 'year' | 'month' | 'day' | 'hours' | 'minutes' | 'seconds' | 'meridiem';

/** The MIT date and time pickers' texts. No Arabic ships upstream at all. */
function pickersText(text: MuiText): Partial<PickersLocaleText> {
  const viewName = (view: PickerView): string =>
    ({
      year: text['mui.pickers.year'],
      month: text['mui.pickers.month'],
      day: text['mui.pickers.day'],
      hours: text['mui.pickers.hours'],
      minutes: text['mui.pickers.minutes'],
      seconds: text['mui.pickers.seconds'],
      meridiem: text['mui.pickers.meridiem'],
    })[view];

  return {
    previousMonth: text['mui.pickers.previousMonth'],
    nextMonth: text['mui.pickers.nextMonth'],
    openPreviousView: text['mui.pickers.openPreviousView'],
    openNextView: text['mui.pickers.openNextView'],
    calendarViewSwitchingButtonAriaLabel: (view) =>
      view === 'year' ? text['mui.pickers.switchToCalendar'] : text['mui.pickers.switchToYear'],
    calendarWeekNumberHeaderLabel: text['mui.pickers.weekNumberHeader'],
    calendarWeekNumberHeaderText: text['mui.pickers.weekNumberHeaderShort'],
    calendarWeekNumberAriaLabelText: (weekNumber) =>
      fill(text['mui.pickers.weekNumber'], { week: weekNumber }),
    calendarWeekNumberText: (weekNumber) => String(weekNumber),

    cancelButtonLabel: text['mui.pickers.cancel'],
    clearButtonLabel: text['mui.pickers.clear'],
    okButtonLabel: text['mui.pickers.ok'],
    todayButtonLabel: text['mui.pickers.today'],
    nextStepButtonLabel: text['mui.pickers.nextStep'],

    datePickerToolbarTitle: text['mui.pickers.toolbarDate'],
    timePickerToolbarTitle: text['mui.pickers.toolbarTime'],
    dateTimePickerToolbarTitle: text['mui.pickers.toolbarDateTime'],

    clockLabelText: (view, formattedTime) =>
      `${fill(text['mui.pickers.clockSelect'], { view: viewName(view) })} ${
        formattedTime === null
          ? text['mui.pickers.clockNoTime']
          : fill(text['mui.pickers.clockSelectedTime'], { time: formattedTime })
      }`,
    hoursClockNumberText: (hours) => fill(text['mui.pickers.hoursValue'], { value: hours }),
    minutesClockNumberText: (minutes) => fill(text['mui.pickers.minutesValue'], { value: minutes }),
    secondsClockNumberText: (seconds) => fill(text['mui.pickers.secondsValue'], { value: seconds }),
    selectViewText: (view) => fill(text['mui.pickers.openView'], { view: viewName(view) }),

    openDatePickerDialogue: (formattedDate) =>
      formattedDate
        ? fill(text['mui.pickers.chooseDateSelected'], { date: formattedDate })
        : text['mui.pickers.chooseDate'],
    openTimePickerDialogue: (formattedTime) =>
      formattedTime
        ? fill(text['mui.pickers.chooseTimeSelected'], { time: formattedTime })
        : text['mui.pickers.chooseTime'],

    fieldClearLabel: text['mui.pickers.clear'],
    timeTableLabel: text['mui.pickers.chooseTime'],
    dateTableLabel: text['mui.pickers.chooseDate'],

    fieldYearPlaceholder: () => text['mui.pickers.placeholderYear'],
    fieldMonthPlaceholder: () => text['mui.pickers.placeholderMonth'],
    fieldDayPlaceholder: () => text['mui.pickers.placeholderDay'],
    fieldWeekDayPlaceholder: () => text['mui.pickers.placeholderWeekDay'],
    fieldHoursPlaceholder: () => text['mui.pickers.placeholderHours'],
    fieldMinutesPlaceholder: () => text['mui.pickers.placeholderMinutes'],
    fieldSecondsPlaceholder: () => text['mui.pickers.placeholderSeconds'],
    fieldMeridiemPlaceholder: () => text['mui.pickers.placeholderMeridiem'],

    year: text['mui.pickers.year'],
    month: text['mui.pickers.month'],
    day: text['mui.pickers.day'],
    weekDay: text['mui.pickers.weekDay'],
    hours: text['mui.pickers.hours'],
    minutes: text['mui.pickers.minutes'],
    seconds: text['mui.pickers.seconds'],
    meridiem: text['mui.pickers.meridiem'],
    empty: text['mui.pickers.empty'],
  };
}

/** The MIT charts' texts. The accessible descriptions keep upstream's shape. */
function chartsText(text: MuiText): Partial<ChartsLocaleText> {
  return {
    loading: text['mui.charts.loading'],
    noData: text['mui.charts.noData'],
    a11yNoValue: text['mui.charts.noValue'],
    a11yConnector: text['mui.charts.connector'],
  };
}

/** Everything the theme merges, as the theme-component objects MUI expects. */
export interface MuiLocaleText {
  readonly material: Localization;
  readonly grid: Partial<GridLocaleText>;
  readonly pickers: Partial<PickersLocaleText>;
  readonly charts: Partial<ChartsLocaleText>;
  /** Theme fragments, in merge order: upstream base first, the catalogue last. */
  readonly themeLocales: readonly object[];
}

/**
 * The texts for one locale.
 *
 * Arabic starts from the upstream `arSD` where one exists; English from `enUS`.
 * The catalogue always wins, because it is merged last.
 */
export function muiLocaleText(locale: Locale, text: MuiText): MuiLocaleText {
  const arabic = locale === 'ar';
  const materialBase = arabic ? materialArabic : materialEnglish;
  const gridBase = arabic ? gridArabic : gridEnglish;
  const material = materialText(text);
  const grid = gridText(text);
  const pickers = pickersText(text);
  const charts = chartsText(text);

  return {
    material,
    grid,
    pickers,
    charts,
    themeLocales: [
      materialBase,
      gridBase,
      pickersEnglish,
      chartsEnglish,
      material,
      { components: { MuiDataGrid: { defaultProps: { localeText: grid } } } },
      { components: { MuiLocalizationProvider: { defaultProps: { localeText: pickers } } } },
      { components: { MuiChartsLocalizationProvider: { defaultProps: { localeText: charts } } } },
    ],
  };
}
