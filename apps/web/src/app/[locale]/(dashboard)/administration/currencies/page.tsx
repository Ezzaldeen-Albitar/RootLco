import { notFound } from 'next/navigation';
import { requireSession } from '@/features/authentication/api/session';
import { CurrencyCatalogue } from '@/features/administration/organization/components/CurrencyCatalogue';
import { readReferenceValuesState } from '@/features/administration/organization/reference-values';
import { SettingsBackedScreen } from '@/features/administration/shared/components/SettingsBackedScreen';
import { Panel } from '@/features/administration/shared/components/ScreenStates';
import { PERMISSIONS, holds } from '@/features/administration/shared/permissions';
import {
  CURRENCY_KEYS,
  CURRENCY_PREFIX,
  CURRENCY_RULES,
} from '@/features/administration/shared/settings-keys';
import { isLocale } from '@/i18n/config';
import { getMessages, translate } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Currencies.
 *
 * `shared.currencies` holds the ISO 4217 reference list. Since
 * P1-32-PRE-OD-REF it is published by `org.reference-values-read` (closing
 * `P1-26-F-005`), and since P1-32-PRE-OD-ADM5 this screen shows it: the codes,
 * the names in the page's language and the decimal places, exactly as the read
 * answered — for a holder of `org.tenant.read`, the code that read declares, and
 * for nobody else no read is made. Which currencies the platform holds is the
 * Owner's decision (OIR-04); nothing here adds one.
 *
 * Below it, the company's enabled codes (`currency.enabled_codes`), written
 * through `iam.company-settings-write` and offered first by the Organization
 * screen. A code the platform does not hold is refused beside the value before
 * anything is sent, when the list was read.
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
  const messages = getMessages(locale);

  const canReadCatalogue = holds(session.permissions, PERMISSIONS.tenantRead);
  const read = canReadCatalogue ? await readReferenceValuesState() : null;
  const currencies =
    read === null
      ? null
      : read.status === 'ok'
        ? { status: 'ok' as const, data: read.data.currencies, correlationId: read.correlationId }
        : read;

  return (
    <SettingsBackedScreen
      locale={locale}
      session={session}
      titleKey="currencies.title"
      descriptionKey="currencies.description"
      navLabelKey="nav.currencies"
      keyPrefix={CURRENCY_PREFIX}
      suggestions={CURRENCY_KEYS}
      valueRules={CURRENCY_RULES}
      noticeKeys={['currencies.noRates', 'currencies.noBase']}
      leadReadable={currencies !== null}
      lead={
        currencies === null ? undefined : (
          <Panel
            title={translate(messages, 'currencies.catalogue.title')}
            description={translate(messages, 'currencies.catalogue.description')}
          >
            <CurrencyCatalogue messages={messages} locale={locale} read={currencies} />
          </Panel>
        )
      }
      knownCodes={
        currencies !== null && currencies.status === 'ok'
          ? currencies.data.map((currency) => currency.code)
          : null
      }
    />
  );
}

/** The document title. Same key as the visible header, so they cannot disagree. */
export const generateMetadata = pageMetadata('currencies.title');
