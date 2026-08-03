import { notFound } from 'next/navigation';
import { requireSession } from '@/features/authentication/api/session';
import { SettingsBackedScreen } from '@/features/administration/shared/components/SettingsBackedScreen';
import { NUMBERING_KEYS, NUMBERING_PREFIX } from '@/features/administration/shared/settings-keys';
import { isLocale } from '@/i18n/config';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Numbering rules.
 *
 * `sal.invoice_numbering_configs` exists in the schema and **no route handler
 * exposes it** (`P1-26-F-003`), so this screen edits organization settings and
 * says so. Two further statements are on the page because their absence would be
 * read as a gap rather than a boundary: there is no preview operation, and
 * numbers are always allocated by the service — nothing here produces one.
 */
export default async function NumberingRulesPage({
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
      titleKey="numbering.title"
      descriptionKey="numbering.description"
      navLabelKey="nav.numberingRules"
      keyPrefix={NUMBERING_PREFIX}
      suggestions={NUMBERING_KEYS}
      noticeKeys={['numbering.noPreview', 'numbering.noGeneration']}
    />
  );
}

/** The document title. Same key as the visible header, so they cannot disagree. */
export const generateMetadata = pageMetadata('numbering.title');
