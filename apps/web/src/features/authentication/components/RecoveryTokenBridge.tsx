'use client';

import { useSyncExternalStore } from 'react';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { isTokenShaped } from '../api/recovery-token';
import { MissingToken } from './MissingToken';
import { SetPasswordForm } from './SetPasswordForm';

/**
 * Recovers a token that arrived in the URL **fragment**, and renders the form.
 *
 * ## Why this component has to exist
 *
 * A fragment is never sent to the server. When the identity provider delivers a
 * recovery link as `…/reset-password#access_token=…`, the server render sees no
 * token at all — so a server-only implementation would show "this link is not
 * complete" to every user of a provider that uses that shape.
 *
 * ## Why it renders the form rather than taking a render prop
 *
 * It used to take `children: (token) => ReactNode`. That is a **function prop
 * crossing the Server-to-Client boundary**, which is not serialisable: the page
 * returned a 500 in the production build and the browser suite caught it. The
 * page now passes only serialisable values — a locale, a message catalogue, a
 * token or null, and message keys — and this component decides what to render.
 *
 * ## Why `useSyncExternalStore` rather than an effect
 *
 * `window.location.hash` cannot be read during render: the server has no such
 * object, so the server HTML and the first client render would disagree and
 * React would discard the tree. The obvious workaround — render the fallback and
 * `setState` from an effect — is what `react-hooks/set-state-in-effect` catches,
 * and the rule is right: it renders twice, and the user sees "this link is not
 * complete" for a frame before the form appears. On a page reached from an email
 * that flash reads as a broken link.
 *
 * ## What happens to the token
 *
 * The fragment is **erased from the address bar** with `history.replaceState` —
 * no navigation, no history entry — on the first read. That stops the credential
 * from being read back out of the address bar later, from being copied when the
 * user copies the URL, and from being restored when the tab is reopened.
 *
 * It is never written to storage, to a cookie, to a query parameter, or to any
 * log. It exists in memory for as long as the form is on screen.
 */

/** The hash is read once per page load; nothing else can change it here. */
function subscribe(): () => void {
  return () => undefined;
}

let consumed: { readonly href: string; readonly token: string | null } | null = null;

/**
 * Reads and erases the fragment, memoised per URL.
 *
 * `useSyncExternalStore` may call the snapshot more than once and requires the
 * value to be referentially stable between calls, or it loops. Erasing the
 * fragment makes the read destructive, so the result is cached against the href
 * it was taken from — the second call returns the same token rather than looking
 * at a hash that is no longer there.
 */
function readTokenFromFragment(): string | null {
  const href = window.location.pathname + window.location.search;
  if (consumed && consumed.href === href) return consumed.token;

  let token: string | null = null;
  const hash = window.location.hash.replace(/^#/, '');
  if (hash.length > 0) {
    const params = new URLSearchParams(hash);
    for (const name of ['access_token', 'token', 'code']) {
      const value = params.get(name);
      if (value && isTokenShaped(value)) {
        token = value;
        break;
      }
    }
    // Erased whether or not it was usable. A malformed fragment is still a
    // credential-shaped string sitting in the address bar.
    window.history.replaceState(null, '', href);
  }

  consumed = { href, token };
  return token;
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
    () => (serverToken === null ? readTokenFromFragment() : serverToken),
    // The server snapshot. It MUST NOT touch `window`, which does not exist here.
    () => serverToken
  );

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

/** Test seam: clears the per-URL memo so a suite can exercise a fresh load. */
export function resetRecoveryTokenMemo(): void {
  consumed = null;
}
