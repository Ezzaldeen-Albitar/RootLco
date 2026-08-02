import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { Locale } from '@/i18n/config';
import { directionOf } from '@/i18n/config';
import { getMessages, type Messages } from '@/i18n/get-messages';

/**
 * Render helpers that put the component in a real DIRECTION.
 *
 * `dir` lives on `<html>` in the application, so a component tested in a bare
 * jsdom container is always LTR — and every RTL bug survives the suite. These
 * set `dir` and `lang` on the document element, exactly as the locale layout
 * does, so a logical-property mistake actually shows up.
 */

export interface LocaleRenderResult extends RenderResult {
  readonly messages: Messages;
  readonly locale: Locale;
}

function renderIn(locale: Locale, ui: ReactElement, options?: RenderOptions): LocaleRenderResult {
  document.documentElement.lang = locale;
  document.documentElement.dir = directionOf(locale);
  const result = render(ui, options);
  return Object.assign(result, { messages: getMessages(locale), locale });
}

/** English, LTR. */
export function renderLtr(ui: ReactElement, options?: RenderOptions): LocaleRenderResult {
  return renderIn('en', ui, options);
}

/** Arabic, RTL. */
export function renderRtl(ui: ReactElement, options?: RenderOptions): LocaleRenderResult {
  return renderIn('ar', ui, options);
}

/** Both directions, so a case cannot pass in one and be forgotten in the other. */
export const BOTH_DIRECTIONS: readonly [Locale, typeof renderLtr][] = [
  ['en', renderLtr],
  ['ar', renderRtl],
];

export const messagesFor = getMessages;
