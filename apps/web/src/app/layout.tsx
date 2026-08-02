import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.scss';

/**
 * Root layout.
 *
 * Deliberately minimal: `lang` and `dir` are decided per locale in
 * `app/[locale]/layout.tsx`, because setting them here would require guessing a
 * direction before the locale is known and would flash the wrong one.
 */
/**
 * The provisional favicon. Linked explicitly so the browser never probes
 * /favicon.ico — real Chrome requests it when no icon is declared, and the
 * resulting 404 fails the clean-console browser gate (found by the installed-
 * Chrome run; headless chromium does not probe). Replacing the brand
 * overwrites public/favicon.svg in place: an asset swap, zero code change.
 */
export const metadata: Metadata = {
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return children;
}
