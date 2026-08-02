import type { Metadata } from 'next';
import { DESCRIPTIVE_TITLE, PRODUCT_NAME_PLACEHOLDER } from '@/shared/constants/app';
// The ONLY globally imported stylesheet (see docs/standards/styling-and-sass.md).
// Component styling lives in SCSS Modules, never here.
import '@/styles/globals.scss';

export const metadata: Metadata = {
  // The product name is not decided; the controlled placeholder is used (ADR-011).
  title: `${PRODUCT_NAME_PLACEHOLDER} — Phase 1-1 Foundation`,
  description: `${DESCRIPTIVE_TITLE}. Confidential — RootLco (Root Link Company). Development-readiness foundation; no business functionality.`,
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // lang/dir are static in Phase 1-1. Locale-driven switching (ar/rtl) arrives
    // with the i18n foundation in the frontend phases; the stylesheet is already
    // direction-safe because it uses logical properties throughout (ADR-013).
    <html lang="en" dir="ltr">
      <body>{children}</body>
    </html>
  );
}
