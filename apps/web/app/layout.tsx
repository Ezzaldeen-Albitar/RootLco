import type { ReactNode } from 'react';
import './globals.scss';

/**
 * Root layout.
 *
 * Deliberately minimal: `lang` and `dir` are decided per locale in
 * `app/[locale]/layout.tsx`, because setting them here would require guessing a
 * direction before the locale is known and would flash the wrong one.
 */
export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return children;
}
