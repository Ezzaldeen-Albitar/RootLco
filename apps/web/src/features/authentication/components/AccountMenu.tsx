'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { logoutAction } from '../actions/logout';

/**
 * The account control in the header.
 *
 * A disclosure, not a modal: it closes on Escape, on a click outside, and when
 * focus leaves — and it returns focus to its trigger, so a keyboard user is not
 * dropped at the top of the document. Those are the same three properties the
 * shared overlay layer guarantees; the reason this does not use `Dialog` is that
 * a header menu must NOT trap focus or block the page behind it.
 *
 * ## Sign out is a form, not a link
 *
 * It ends a session, so it is a POST. A `GET /logout` link is followed by link
 * prefetchers, by antivirus scanners and by anything that walks the page — which
 * signs the operator out at random. The form posts a Server Action that clears
 * the cookie first and tells the backend second.
 *
 * ## What it displays
 *
 * The display name and email the SERVER resolved for this session. Nothing here
 * is read from client state, and nothing here is authoritative — it is a label
 * telling the operator whose session they are looking at.
 */
export function AccountMenu({
  locale,
  messages,
  displayName,
  email,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly displayName: string;
  readonly email: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    const onPointer = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex max-w-[14rem] items-center gap-2 rounded-lg px-2 py-1.5 text-start transition-colors duration-fast ease-standard hover:bg-primary-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-caption font-semibold text-primary"
        >
          {initialsOf(displayName)}
        </span>
        <span className="hidden min-w-0 flex-col sm:flex">
          <span className="truncate text-supporting font-medium text-text-primary">
            {displayName}
          </span>
          <span className="truncate text-caption text-text-muted">{email}</span>
        </span>
        <span className="sr-only">{translate(messages, 'auth.session.account')}</span>
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={translate(messages, 'auth.session.account')}
          className="absolute end-0 z-dropdown mt-1 w-64 rounded-lg border border-border bg-surface p-1 shadow-lg"
        >
          <p className="px-3 py-2 text-caption text-text-muted">
            {translate(messages, 'auth.session.signedInAs')}{' '}
            <span className="block truncate text-supporting text-text-secondary">{email}</span>
          </p>
          <Link
            role="menuitem"
            href={`/${locale}/profile`}
            onClick={() => setOpen(false)}
            className="block rounded-md px-3 py-2 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle"
          >
            {translate(messages, 'nav.profile')}
          </Link>
          <form action={logoutAction}>
            <input type="hidden" name="locale" value={locale} />
            <button
              role="menuitem"
              type="submit"
              className="w-full rounded-md px-3 py-2 text-start text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle"
            >
              {translate(messages, 'auth.session.signOut')}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Up to two initials from a display name.
 *
 * Uses `Intl.Segmenter` where available so a name in Arabic, or one containing a
 * grapheme cluster made of several code points, is cut at a character boundary
 * rather than mid-sequence — `name[0]` on such a name renders a broken glyph.
 */
export function initialsOf(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return words.map(firstGrapheme).join('');
}

function firstGrapheme(word: string): string {
  const Segmenter = (
    Intl as unknown as {
      Segmenter?: new (
        locale?: string,
        options?: { granularity: string }
      ) => { segment: (input: string) => Iterable<{ segment: string }> };
    }
  ).Segmenter;
  if (!Segmenter) return word.slice(0, 1);
  const [first] = new Segmenter(undefined, { granularity: 'grapheme' }).segment(word);
  return first?.segment ?? word.slice(0, 1);
}
