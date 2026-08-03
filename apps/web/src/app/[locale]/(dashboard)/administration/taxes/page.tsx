import { notFound } from 'next/navigation';
import { requireSession } from '@/features/authentication/api/session';
import { SettingsBackedScreen } from '@/features/administration/shared/components/SettingsBackedScreen';
import { TAX_KEYS, TAX_PREFIX } from '@/features/administration/shared/settings-keys';
import { isLocale } from '@/i18n/config';

/**
 * Taxes.
 *
 * `org.tax_classes` and `org.tax_rates` exist in the schema and **no route
 * handler exposes either** (`P1-26-F-004`).
 *
 * Decision-neutral in the strict sense: no country is assumed, Jordan is not
 * hard-coded, no rate is supplied, and no effective date is presumed. The rate
 * is stored as a **string**, not a `number` — a rate is money-adjacent, exact in
 * the database, and a JavaScript number would round it on the way through.
 */
export default async function TaxesPage({
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
      titleKey="taxes.title"
      descriptionKey="taxes.description"
      navLabelKey="nav.taxes"
      keyPrefix={TAX_PREFIX}
      suggestions={TAX_KEYS}
      noticeKeys={['admin.contractGap.noCatalogue', 'taxes.noJurisdiction']}
    />
  );
}
