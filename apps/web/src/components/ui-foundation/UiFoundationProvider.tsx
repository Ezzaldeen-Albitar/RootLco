'use client';

import { useMemo, type ReactNode } from 'react';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import { ThemeProvider } from '@mui/material/styles';
import rtlPlugin from '@mui/stylis-plugin-rtl';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { prefixer } from 'stylis';
import type { Locale } from '@/i18n/config';
import { directionOf } from '@/i18n/config';
import { dayjsLocaleFor } from './dayjs-locale';
import type { MuiText } from './mui-text';
import { createRootTheme } from './theme';

/**
 * The Material UI foundation — ADR-022 — mounted once, in the locale layout.
 *
 * The ONLY client component the foundation adds. The locale layout stays a
 * Server Component and hands this nothing but serialisable props: the locale
 * and the `mui.*` catalogue entries. Everything that is a function — the
 * Emotion plugins, the theme, the texts that take arguments — is built here.
 *
 * ## Direction, in three places that must agree
 *
 * `<html dir>` is set by the locale layout and remains the one authority. This
 * provider follows it in the two places Material cannot read it from:
 *
 *   1. the theme's `direction`, which Material's components consult;
 *   2. the Emotion cache: `stylis-plugin-rtl` flips the PHYSICAL properties in
 *      Material's own styles, and the cache key differs by direction (`mui` /
 *      `muirtl`) so a left-to-right and a right-to-left stylesheet can never be
 *      served from the same cache.
 *
 * Portals (dialogs, menus, pickers, tooltips) mount on `<body>` and inherit
 * `dir` from `<html>`, so they need nothing extra.
 *
 * ## What it does NOT do
 *
 * It renders no `CssBaseline` — the product has its own reset, in the
 * `rootlco-reset` layer — and no notification surface: `NotificationHost` stays
 * the single notification authority (ADR-021), so Material's Snackbar is not
 * used for toasts.
 */
export function UiFoundationProvider({
  locale,
  text,
  children,
}: {
  readonly locale: Locale;
  readonly text: MuiText;
  readonly children: ReactNode;
}) {
  const rtl = directionOf(locale) === 'rtl';
  const theme = useMemo(() => createRootTheme(locale, text), [locale, text]);

  return (
    <AppRouterCacheProvider
      options={{
        key: rtl ? 'muirtl' : 'mui',
        enableCssLayer: true,
        stylisPlugins: rtl ? [prefixer, rtlPlugin] : [prefixer],
      }}
    >
      <ThemeProvider theme={theme}>
        <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={dayjsLocaleFor(locale)}>
          {children}
        </LocalizationProvider>
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
