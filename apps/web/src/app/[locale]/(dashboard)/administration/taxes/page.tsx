import { notFound } from 'next/navigation';
import { requireSession } from '@/features/authentication/api/session';
import { SettingsBackedScreen } from '@/features/administration/shared/components/SettingsBackedScreen';
import { TAX_KEYS, TAX_PREFIX } from '@/features/administration/shared/settings-keys';
import { isLocale } from '@/i18n/config';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Taxes.
 *
 * `org.tax_classes` and `org.tax_rates` exist in the schema and **no route
 * handler reads or writes either** (`P1-26-F-004`); tax policy waits on the
 * Owner's accounting decisions (ACC01).
 *
 * So this screen changes nothing (P1-32-PRE-OD-ADM5). A tax setting written to
 * the company or branch settings would be applied by nothing — no part of the
 * service reads a `tax.` setting when it prices or invoices — so an edit form here would be a
 * control for an operation that does not exist. The screen shows the settings
 * the company and branch settings operations genuinely hold under `tax.`, and
 * says plainly what is not available and why.
 *
 * Decision-neutral in the strict sense: no country is assumed, no rate is
 * supplied, and no effective date is presumed.
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
      noticeKeys={['taxes.gap.catalogue', 'taxes.noJurisdiction']}
      writable={false}
      scopes={['company', 'branch']}
    />
  );
}

/** The document title. Same key as the visible header, so they cannot disagree. */
export const generateMetadata = pageMetadata('taxes.title');
