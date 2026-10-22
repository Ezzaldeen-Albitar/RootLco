import { createTheme, type Theme } from '@mui/material/styles';
import type {} from '@mui/x-charts/themeAugmentation';
import type {} from '@mui/x-data-grid/themeAugmentation';
import type {} from '@mui/x-date-pickers/themeAugmentation';
import { PAGE_SIZES } from '@/components/data-table/table-state';
import type { Locale } from '@/i18n/config';
import { directionOf } from '@/i18n/config';
import {
  BREAKPOINT_PX,
  DURATION_MS,
  FONT_SIZE_PX,
  FONT_WEIGHT,
  LAYOUT_PX,
  RADIUS_PX,
  Z_INDEX,
} from '@/styles/tokens/generated/tokens';
import { muiLocaleText } from './mui-locale';
import type { MuiText } from './mui-text';

/**
 * The product's Material UI theme — ADR-022.
 *
 * ## One source of design values, still
 *
 * Every colour, type size, radius and spacing step below is a REFERENCE to a
 * custom property the Sass token layer emits (`var(--color-primary)` and so on),
 * exactly as `tailwind.config.ts` is. A palette change in `_colors.scss`
 * therefore reaches Material components, Tailwind utilities and SCSS modules
 * together, and a `[data-theme]` remap reaches all three at runtime.
 *
 * The few values Material needs as JavaScript NUMBERS — breakpoints (a media
 * query cannot read a custom property), the radius base, the stacking layers,
 * transition timeouts and the grid's row heights — come from
 * `styles/tokens/generated/tokens.ts`, which is GENERATED from the same Sass
 * maps and drift-checked by `tests/design-tokens-generated.test.ts`. Nothing
 * here is typed in by hand; `validate:web-tokens` fails on a raw colour, length
 * or duration in this file.
 *
 * ## `nativeColor`
 *
 * A palette of `var(--…)` references only works because `cssVariables.nativeColor`
 * makes Material derive hover, focus and disabled shades with CSS `color-mix()`
 * rather than by parsing the colour in JavaScript — the parser cannot read a
 * custom property and would throw. The ADR-022 spike rendered Material, the
 * data grid, the date pickers, the charts and the tree view on this palette in
 * both directions; `tests/ui-foundation.dom.test.tsx` keeps that proof.
 *
 * ## Layers
 *
 * `modularCssLayers` states the same order `styles/_layers.scss` declares, so
 * Material's styles land in `mui.global` … `mui.sx` beneath the unlayered
 * Tailwind utilities, whichever stylesheet the browser sees first.
 */

/** The cascade-layer order, identical to `styles/_layers.scss`. */
export const LAYER_ORDER = '@layer rootlco-reset, mui;';

/** The focus ring every Material control draws, from the same tokens as `_focus.scss`. */
const FOCUS_RING = {
  outline: 'calc(var(--space-1) / 2) solid var(--color-focus-ring)',
  outlineOffset: 'calc(var(--space-1) / 2)',
} as const;

export function createRootTheme(locale: Locale, text: MuiText): Theme {
  const { themeLocales } = muiLocaleText(locale, text);

  return createTheme(
    {
      direction: directionOf(locale),
      cssVariables: { nativeColor: true },
      modularCssLayers: LAYER_ORDER,
      palette: {
        mode: 'light',
        primary: {
          main: 'var(--color-primary)',
          dark: 'var(--color-primary-active)',
          contrastText: 'var(--color-on-primary)',
        },
        secondary: {
          main: 'var(--color-secondary)',
          dark: 'var(--color-secondary-hover)',
          contrastText: 'var(--color-on-secondary)',
        },
        error: { main: 'var(--color-error)', contrastText: 'var(--color-text-inverse)' },
        warning: { main: 'var(--color-warning)', contrastText: 'var(--color-text-inverse)' },
        info: { main: 'var(--color-info)', contrastText: 'var(--color-text-inverse)' },
        success: { main: 'var(--color-success)', contrastText: 'var(--color-text-inverse)' },
        text: {
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          disabled: 'var(--color-text-disabled)',
        },
        background: {
          default: 'var(--color-app-background)',
          paper: 'var(--color-surface)',
        },
        divider: 'var(--color-border)',
        action: {
          hover: 'var(--color-table-row-hover)',
          selected: 'var(--color-table-row-selected)',
          disabled: 'var(--color-text-disabled)',
          disabledBackground: 'var(--color-disabled)',
        },
      },
      typography: {
        fontFamily: 'var(--font-family-sans)',
        fontSize: FONT_SIZE_PX.body,
        fontWeightRegular: FONT_WEIGHT.regular,
        fontWeightMedium: FONT_WEIGHT.medium,
        fontWeightBold: FONT_WEIGHT.bold,
        h1: {
          fontSize: 'var(--font-size-display)',
          lineHeight: 'var(--line-height-display)',
          fontWeight: FONT_WEIGHT.bold,
        },
        h2: {
          fontSize: 'var(--font-size-page-title)',
          lineHeight: 'var(--line-height-page-title)',
          fontWeight: FONT_WEIGHT.semibold,
        },
        h3: {
          fontSize: 'var(--font-size-section-title)',
          lineHeight: 'var(--line-height-section-title)',
          fontWeight: FONT_WEIGHT.semibold,
        },
        h4: {
          fontSize: 'var(--font-size-body-large)',
          lineHeight: 'var(--line-height-body-large)',
          fontWeight: FONT_WEIGHT.semibold,
        },
        h5: {
          fontSize: 'var(--font-size-body)',
          lineHeight: 'var(--line-height-body)',
          fontWeight: FONT_WEIGHT.semibold,
        },
        h6: {
          fontSize: 'var(--font-size-label)',
          lineHeight: 'var(--line-height-label)',
          fontWeight: FONT_WEIGHT.semibold,
        },
        subtitle1: {
          fontSize: 'var(--font-size-body-large)',
          lineHeight: 'var(--line-height-body-large)',
        },
        subtitle2: {
          fontSize: 'var(--font-size-supporting)',
          lineHeight: 'var(--line-height-supporting)',
          fontWeight: FONT_WEIGHT.medium,
        },
        body1: { fontSize: 'var(--font-size-body)', lineHeight: 'var(--line-height-body)' },
        body2: {
          fontSize: 'var(--font-size-supporting)',
          lineHeight: 'var(--line-height-supporting)',
        },
        button: {
          fontSize: 'var(--font-size-button)',
          lineHeight: 'var(--line-height-button)',
          fontWeight: FONT_WEIGHT.medium,
          textTransform: 'none',
        },
        caption: { fontSize: 'var(--font-size-caption)', lineHeight: 'var(--line-height-caption)' },
        overline: {
          fontSize: 'var(--font-size-caption)',
          lineHeight: 'var(--line-height-caption)',
        },
      },
      // `theme.spacing(1)` is the 8px step, as Material's own components expect;
      // `var(--space-2)` IS that step, so `spacing(n)` is `calc(n * var(--space-2))`.
      spacing: 'var(--space-2)',
      shape: { borderRadius: RADIUS_PX.md },
      breakpoints: {
        values: {
          xs: 0,
          sm: BREAKPOINT_PX.sm,
          md: BREAKPOINT_PX.md,
          lg: BREAKPOINT_PX.lg,
          xl: BREAKPOINT_PX.xl,
        },
      },
      // Material's layers, mapped onto the product's single z-index scale so a
      // Material dialog and the product's own overlays stack in one order.
      zIndex: {
        mobileStepper: Z_INDEX.raised,
        fab: Z_INDEX.sticky,
        speedDial: Z_INDEX.sticky,
        appBar: Z_INDEX.header,
        drawer: Z_INDEX.overlay,
        modal: Z_INDEX.dialog,
        snackbar: Z_INDEX.toast,
        tooltip: Z_INDEX.tooltip,
      },
      transitions: {
        duration: {
          shortest: DURATION_MS.instant,
          shorter: DURATION_MS.fast,
          short: DURATION_MS.base,
          standard: DURATION_MS.base,
          complex: DURATION_MS.slow,
          enteringScreen: DURATION_MS.overlay,
          leavingScreen: DURATION_MS.overlay,
        },
        easing: {
          easeInOut: 'var(--ease-standard)',
          easeOut: 'var(--ease-enter)',
          easeIn: 'var(--ease-exit)',
          sharp: 'var(--ease-standard)',
        },
      },
      components: {
        MuiButtonBase: {
          styleOverrides: {
            root: { '&.Mui-focusVisible': FOCUS_RING },
          },
        },
        MuiButton: {
          defaultProps: { disableElevation: true },
          styleOverrides: {
            root: {
              borderRadius: 'var(--radius-md)',
              minBlockSize: 'var(--layout-control-height-md)',
            },
          },
        },
        MuiTextField: {
          defaultProps: { size: 'small', fullWidth: true },
        },
        MuiOutlinedInput: {
          styleOverrides: {
            root: { borderRadius: 'var(--radius-md)' },
          },
        },
        MuiDataGrid: {
          defaultProps: {
            // The product's page sizes, from the one place they are decided.
            pageSizeOptions: [...PAGE_SIZES],
            rowHeight: LAYOUT_PX['table-row-height'],
            columnHeaderHeight: LAYOUT_PX['table-row-height'],
            disableRowSelectionOnClick: true,
          },
        },
      },
    },
    ...themeLocales
  );
}
