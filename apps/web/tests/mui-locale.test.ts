import dayjs from 'dayjs';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import { enUS as gridEnglish, arSD as gridArabic } from '@mui/x-data-grid/locales';
import { enUS as pickersEnglish } from '@mui/x-date-pickers/locales';
import { describe, expect, it } from 'vitest';
import {
  ARABIC_DAYJS_LOCALE,
  arabicDayjsLocale,
  dayjsLocaleFor,
} from '@/components/ui-foundation/dayjs-locale';
import {
  fill,
  muiLocaleText,
  pageLabel,
  rowsShownLabel,
} from '@/components/ui-foundation/mui-locale';
import { MUI_TEXT_PREFIX, muiTextOf } from '@/components/ui-foundation/mui-text';
import { getMessages } from '@/i18n/get-messages';
import { intlLocale } from '@/lib/format';

/**
 * The texts Material UI and MUI X render (ADR-022), built by `muiLocaleText`
 * from the product's catalogue.
 *
 * The catalogue-wide rules — the same keys in both languages, no Arabic left in
 * English, plain language, a code-point-sorted file — are held by
 * `tests/i18n.test.ts` and `validate:plain-language` for these entries like any
 * other. What is held here is what only this builder can get wrong.
 */

const ARABIC_SCRIPT = /[؀-ۿ]/;
const ARABIC_INDIC_DIGIT = /[٠-٩۰-۹]/;

// The pickers' adapter extends dayjs with this plugin itself; the tests extend
// it here so `L`/`LLLL` expand to the locale's formats exactly as they do there.
dayjs.extend(localizedFormat);

const text = { en: muiTextOf(getMessages('en')), ar: muiTextOf(getMessages('ar')) };
const built = { en: muiLocaleText('en', text.en), ar: muiLocaleText('ar', text.ar) };

describe('the mui.* catalogue subset', () => {
  it('carries every mui.* entry and nothing else', () => {
    const all = Object.keys(getMessages('en')).filter((key) => key.startsWith(MUI_TEXT_PREFIX));
    expect(all.length).toBeGreaterThan(100);
    expect(Object.keys(text.en).sort()).toEqual(all.sort());
    expect(Object.keys(text.ar).sort()).toEqual(Object.keys(text.en).sort());
  });
});

describe('no derived total reaches an operator', () => {
  it('names the first row on screen and never the count, the estimate or the bound', () => {
    for (const locale of ['en', 'ar'] as const) {
      const label = rowsShownLabel(text[locale])({
        from: 11,
        to: 20,
        count: 73519,
        estimated: 88421,
      });
      expect(label).toContain('11');
      // `to` is the page's upper bound when the count is unknown, not a fact.
      expect(label, locale).not.toContain('20');
      expect(label, locale).not.toContain('73519');
      expect(label, locale).not.toContain('88421');
      expect(
        built[locale].grid.paginationDisplayedRows?.({
          from: 1,
          to: 10,
          count: 64207,
          estimated: undefined,
        })
      ).not.toContain('64207');
    }
  });

  it('labels a Material table page by its number, never by a total', () => {
    const pagination = built.en.material.components?.MuiTablePagination?.defaultProps;
    const label = pagination?.labelDisplayedRows?.({ from: 1, to: 10, count: 90817, page: 2 });
    expect(label).toBe('Page 3');
    expect(String(label)).not.toContain('90817');
  });

  it('labels a grid that knows its page by the page number', () => {
    expect(pageLabel(text.en['mui.pagination.page'], 0)).toBe('Page 1');
    expect(pageLabel(text.ar['mui.pagination.page'], 4)).toBe('الصفحة 5');
  });

  it('fills a template and leaves an unknown placeholder visible', () => {
    expect(fill('Rows {from} to {to}', { from: 1, to: 10 })).toBe('Rows 1 to 10');
    expect(fill('Rows {from} to {to}', { from: 1 })).toBe('Rows 1 to {to}');
  });
});

describe('Arabic coverage where upstream ships none or part', () => {
  it('fills every Community grid text the upstream Arabic locale lacks', () => {
    const upstream = gridArabic.components.MuiDataGrid.defaultProps.localeText as Record<
      string,
      unknown
    >;
    const english = gridEnglish.components.MuiDataGrid.defaultProps.localeText as Record<
      string,
      unknown
    >;
    // The commercial-only families (pivoting, the chart builder, the assistant,
    // formulas, aggregation, header filters) are not rendered by the MIT grid.
    const commercial =
      /^(pivot|charts|aiAssistant|prompt|formula|aggregation|headerFilter|toolbarPivot|toolbarCharts|toolbarAssistant|columnMenuManage(Pivot|Charts)|emptyPivot)/;
    const gaps = Object.keys(english).filter(
      (key) => upstream[key] === undefined && !commercial.test(key)
    );
    expect(gaps.length, 'the gap list is empty, so this case checks nothing').toBeGreaterThan(0);
    const ours = built.ar.grid as Record<string, unknown>;
    expect(gaps.filter((key) => ours[key] === undefined)).toEqual([]);
  });

  it('writes every picker text in Arabic', () => {
    const english = pickersEnglish.components.MuiLocalizationProvider.defaultProps
      .localeText as Record<string, unknown>;
    // Range pickers are the commercial edition; the MIT pickers never read these.
    const rangeOnly = new Set([
      'start',
      'end',
      'startDate',
      'startTime',
      'endDate',
      'endTime',
      'openRangePickerDialogue',
      'dateRangePickerToolbarTitle',
      'timeRangePickerToolbarTitle',
    ]);
    const ours = built.ar.pickers as Record<string, unknown>;
    const missing = Object.keys(english).filter(
      (key) => !rangeOnly.has(key) && ours[key] === undefined
    );
    expect(missing).toEqual([]);

    for (const [key, value] of Object.entries(ours)) {
      if (typeof value === 'string') expect(value, key).toMatch(ARABIC_SCRIPT);
    }
    const pickers = built.ar.pickers;
    expect(pickers.openDatePickerDialogue?.(null)).toMatch(ARABIC_SCRIPT);
    expect(pickers.openDatePickerDialogue?.('15/03/2026')).toContain('15/03/2026');
    expect(pickers.clockLabelText?.('hours', null)).toMatch(ARABIC_SCRIPT);
    expect(pickers.calendarViewSwitchingButtonAriaLabel?.('year')).toMatch(ARABIC_SCRIPT);
  });

  it('writes the chart states in Arabic', () => {
    expect(built.ar.charts.loading).toMatch(ARABIC_SCRIPT);
    expect(built.ar.charts.noData).toMatch(ARABIC_SCRIPT);
    expect(built.ar.charts.a11yNoValue).toMatch(ARABIC_SCRIPT);
  });

  it('merges the catalogue AFTER the upstream base, so the catalogue wins', () => {
    const fragments = built.ar.themeLocales as { components?: Record<string, unknown> }[];
    const gridIndex = fragments.findIndex((fragment) => Object.is(fragment, gridArabic));
    const oursIndex = fragments.findIndex(
      (fragment) =>
        (
          fragment.components?.MuiDataGrid as
            { defaultProps?: { localeText?: unknown } } | undefined
        )?.defaultProps?.localeText === built.ar.grid
    );
    expect(gridIndex).toBeGreaterThanOrEqual(0);
    expect(oursIndex).toBeGreaterThan(gridIndex);
  });

  it('never provides an export or print text, because nothing may render one', () => {
    for (const locale of ['en', 'ar'] as const) {
      const grid = built[locale].grid as Record<string, unknown>;
      expect(Object.keys(grid).filter((key) => /export|print/i.test(key))).toEqual([]);
    }
  });
});

describe('the Arabic date locale', () => {
  it('reads its month and weekday names from the product date formatter', () => {
    const month = new Intl.DateTimeFormat(intlLocale('ar'), { month: 'long', timeZone: 'UTC' });
    expect(arabicDayjsLocale.months).toHaveLength(12);
    expect(arabicDayjsLocale.months[2]).toBe(month.format(new Date(Date.UTC(2026, 2, 15, 12))));
    expect(arabicDayjsLocale.weekdays).toHaveLength(7);
    for (const name of [...arabicDayjsLocale.months, ...arabicDayjsLocale.weekdays]) {
      expect(name).toMatch(ARABIC_SCRIPT);
    }
  });

  it('formats with Latin digits, never Arabic-Indic ones', () => {
    const formatted = dayjs('2026-03-15T09:05:00').locale(ARABIC_DAYJS_LOCALE).format('LLLL');
    expect(formatted).toMatch(/15/);
    expect(formatted).toMatch(/2026/);
    expect(formatted).not.toMatch(ARABIC_INDIC_DIGIT);
    expect(formatted).toMatch(ARABIC_SCRIPT);
  });

  it('maps each product locale to the locale its dates are written in', () => {
    expect(dayjsLocaleFor('ar')).toBe(ARABIC_DAYJS_LOCALE);
    expect(dayjsLocaleFor('en')).toBe('en-gb');
    expect(dayjs('2026-03-15').locale('en-gb').format('L')).toBe('15/03/2026');
  });
});
