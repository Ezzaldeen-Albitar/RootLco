import type { Messages } from '@/i18n/get-messages';

/**
 * The catalogue entries Material UI and MUI X are given, and nothing else.
 *
 * ## Why a subset crosses the server/client boundary rather than the catalogue
 *
 * The locale layout is a Server Component and `UiFoundationProvider` is a Client
 * Component, so whatever the layout hands the provider is serialised into the
 * page. Handing it the whole catalogue would ship both languages' six thousand
 * messages to every browser; handing it the `mui.*` entries ships the hundred or
 * so the component library actually reads. The provider then builds the
 * FUNCTION-valued texts (the pagination range, the clock label) on the client,
 * because a function is not serialisable.
 *
 * This module imports no Material code, so the server layout can use it without
 * pulling the component library into the server's module graph for nothing.
 */

export const MUI_TEXT_PREFIX = 'mui.';

/** Every catalogue key under the `mui.` namespace. */
export type MuiTextKey = Extract<keyof Messages, `mui.${string}`>;

/** The `mui.*` entries of one catalogue. */
export type MuiText = Readonly<Record<MuiTextKey, string>>;

/** Picks the `mui.*` entries out of a catalogue. */
export function muiTextOf(messages: Messages): MuiText {
  const picked: Record<string, string> = {};
  for (const [key, value] of Object.entries(messages)) {
    if (key.startsWith(MUI_TEXT_PREFIX)) picked[key] = value;
  }
  return picked as MuiText;
}
