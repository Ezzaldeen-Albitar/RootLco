import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/config';
import { getMessages, translate, type Messages } from '@/i18n/get-messages';

/**
 * The document title for one screen, in the caller's language.
 *
 * `P1-26-F-046`: the application shipped with **no `<title>` on any route**, in
 * either language — WCAG 2.4.2 (Page Titled, Level A), which axe reports as a
 * *serious* `document-title` violation. It survived the whole phase because
 * nothing had scanned a rendered document: the jsdom tier renders components,
 * and the browser suite asserted on landmarks. A missing title is invisible
 * there and unmissable to anyone with a screen reader or two tabs open.
 *
 * A factory rather than a copied block, because fifteen hand-written
 * `generateMetadata` functions are fifteen chances to translate the wrong key,
 * forget the locale fallback, or append the product name twice. The parent
 * layout owns the ` — CRM` suffix through `title.template`; a screen contributes
 * only its own name and cannot restate the product.
 *
 * The key is the SAME one the visible `PageHeader` renders, so the tab and the
 * heading can never disagree.
 */
export function pageMetadata(titleKey: keyof Messages) {
  return async function generateMetadata({
    params,
  }: {
    readonly params: Promise<{ locale: string }>;
  }): Promise<Metadata> {
    const { locale } = await params;
    const messages = getMessages(isLocale(locale) ? locale : DEFAULT_LOCALE);
    return { title: translate(messages, titleKey) };
  };
}
