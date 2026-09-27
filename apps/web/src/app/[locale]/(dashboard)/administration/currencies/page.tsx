import { notFound } from 'next/navigation';
import { requireSession } from '@/features/authentication/api/session';
import { SettingsBackedScreen } from '@/features/administration/shared/components/SettingsBackedScreen';
import { CURRENCY_KEYS, CURRENCY_PREFIX } from '@/features/administration/shared/settings-keys';
import { isLocale } from '@/i18n/config';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Currencies.
 *
 * `shared.currencies` holds the ISO 4217 reference list. Since
 * P1-32-PRE-OD-REF it is published by `org.reference-values-read` (closing
 * `P1-26-F-005`), which the Organization screen uses to offer a company's base
 * currency as a choice. This screen is unchanged by that: it stores the codes
 * the operator enables, as an exact list, and the Organization screen offers
 * those codes first when any are enabled.
 *
 * No base currency is chosen and no exchange rate is held or calculated here —
 * both are stated on the page, because their absence would otherwise read as an
 * unfinished screen rather than a deliberate boundary.
 */
export default async function CurrenciesPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const session = await requireSession(locale);

  return (
    <SettingsBackedScreen
      locale={locale}
      session={session}
      titleKey="currencies.title"
      descriptionKey="currencies.description"
      navLabelKey="nav.currencies"
      keyPrefix={CURRENCY_PREFIX}
      suggestions={CURRENCY_KEYS}
      noticeKeys={['currencies.noRates']}
    />
  );
}

/** The document title. Same key as the visible header, so they cannot disagree. */
export const generateMetadata = pageMetadata('currencies.title');
