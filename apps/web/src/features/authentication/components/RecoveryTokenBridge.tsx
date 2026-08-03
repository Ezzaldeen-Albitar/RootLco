'use client';

import { useEffect, useSyncExternalStore } from 'react';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { isTokenShaped } from '../api/recovery-token';
import { MissingToken } from './MissingToken';
import { SetPasswordForm } from './SetPasswordForm';

/**
 * Recovers a recovery token from the URL, erases it, and renders the form.
 *
 * ## Why this component has to exist
 *
 * A URL fragment is never sent to the server. When the identity provider
 * delivers a recovery link as `…/reset-password#access_token=…`, the server
 * render sees no token at all — so a server-only implementation would show "this
 * link is not complete" to every user of a provider that uses that shape.
 *
 * ## Only serialisable props cross the boundary
 *
 * It used to take `children: (token) => ReactNode`. A function prop is not
 * serialisable across Server-to-Client, and both credential pages returned a 500
 * in the production build (`P1-26-F-013`). The page now passes values; this
 * component decides what to render.
 *
 * ## Reading is pure; erasing is an effect
 *
 * `useSyncExternalStore`'s snapshot must be a pure read — React may call it
 * during render, more than once, and may discard the render entirely. An earlier
 * version called `history.replaceState` inside it, which mutates browser state
 * from the render phase (`P1-26-F-039`).
 *
 * So: the snapshot reads, and the effect erases. And it erases **both** forms.
 * The first version only cleaned the fragment, which left a token delivered as
 * `?token=…` sitting in the address bar for the life of the tab — the exact
 * exposure the fragment handling existed to prevent, on the delivery shape the
 * server *can* see (`P1-26-F-021`).
 *
 * Erasing means: no navigation, no history entry, and it happens whether or not
 * the token was usable — a malformed credential-shaped string in the address bar
 * is still a credential-shaped string in the address bar.
 *
 * The token is never written to storage, a cookie, a log, or any returned state.
 * It lives in memory for as long as the form is on screen.
 */

/** The URL is read once per load; nothing else here can change it. */
function subscribe(): () => void {
  return () => undefined;
}

/** The parameter names providers use, in both the query and the fragment. */
const TOKEN_KEYS = ['access_token', 'token', 'code'] as const;

/**
 * A PURE read of the fragment. No mutation, and stable across repeated calls
 * because it derives its answer only from `window.location`.
 */
function readFragmentToken(): string | null {
  const hash = window.location.hash.replace(/^#/, '');
  if (hash.length === 0) return null;
  const params = new URLSearchParams(hash);
  for (const name of TOKEN_KEYS) {
    const value = params.get(name);
    if (value && isTokenShaped(value)) return value;
  }
  return null;
}

/**
 * Whether the address bar still carries anything credential-shaped.
 *
 * Checked before rewriting so the effect does not push a redundant
 * `replaceState` on every render pass.
 */
function urlCarriesToken(): boolean {
  if (window.location.hash.replace(/^#/, '').length > 0) return true;
  const query = new URLSearchParams(window.location.search);
  return TOKEN_KEYS.some((name) => query.has(name));
}

export function RecoveryTokenBridge({
  locale,
  messages,
  serverToken,
  submitLabelKey,
  doneTitleKey,
  doneBodyKey,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly serverToken: string | null;
  readonly submitLabelKey: string;
  readonly doneTitleKey: string;
  readonly doneBodyKey: string;
}) {
  const fragmentToken = useSyncExternalStore(
    subscribe,
    // Client snapshot. Pure: it reads and returns, and returns the same value
    // for the same URL.
    () => readFragmentToken(),
    // Server snapshot. It MUST NOT touch `window`, which does not exist here.
    () => null
  );

  useEffect(() => {
    // Not a state update — a URL rewrite, which is exactly the kind of external
    // synchronisation an effect is for. Both delivery shapes are cleaned.
    if (!urlCarriesToken()) return;
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const token = serverToken ?? fragmentToken;
  if (token === null) return <MissingToken locale={locale} messages={messages} />;

  return (
    <SetPasswordForm
      locale={locale}
      messages={messages}
      token={token}
      submitLabelKey={submitLabelKey}
      doneTitleKey={doneTitleKey}
      doneBodyKey={doneBodyKey}
    />
  );
}
