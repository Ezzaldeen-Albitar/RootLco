import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { brandIconHref } from '@/components/brand/theme';
import './globals.scss';

/**
 * Root layout.
 *
 * Deliberately minimal: `lang` and `dir` are decided per locale in
 * `app/[locale]/layout.tsx`, because setting them here would require guessing a
 * direction before the locale is known and would flash the wrong one.
 */
/**
 * The tab icon, which is now the Owner-approved product symbol.
 *
 * Linked explicitly so the browser never probes /favicon.ico — real Chrome
 * requests it when no icon is declared, and the resulting 404 fails the
 * clean-console browser gate (found by the installed-Chrome run; headless
 * chromium does not probe).
 *
 * The href comes from the brand layer rather than being written here. A
 * `/brand/*.png` literal in `src/app/` is precisely what the `logo-asset` rule
 * forbids, and routing is not allowed to know the identity.
 */
export const metadata: Metadata = {
  icons: { icon: brandIconHref },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return children;
}
