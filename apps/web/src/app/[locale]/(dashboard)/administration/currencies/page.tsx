import { notFound } from 'next/navigation';
import { requireSession } from '@/features/authentication/api/session';
import { SettingsBackedScreen } from '@/features/administration/shared/components/SettingsBackedScreen';
import { CURRENCY_KEYS, CURRENCY_PREFIX } from '@/features/administration/shared/settings-keys';
import { isLocale } from '@/i18n/config';

/**
 * Currencies.
 *
 * `shared.currencies` holds the ISO 4217 reference list and **no route handler
 * reads it** (`P1-26-F-005`), so this screen cannot offer a picker of known
 * codes. It stores the codes the operator enables, as an exact list.
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
      noticeKeys={['admin.contractGap.noCatalogue', 'currencies.noRates']}
    />
  );
}
