import { notFound } from 'next/navigation';
import { requireSession } from '@/features/authentication/api/session';
import { SettingsBackedScreen } from '@/features/administration/shared/components/SettingsBackedScreen';
import { NUMBERING_KEYS, NUMBERING_PREFIX } from '@/features/administration/shared/settings-keys';
import { isLocale } from '@/i18n/config';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Numbering rules.
 *
 * `sal.invoice_numbering_configs` and `shared.number_sequences` exist in the
 * schema and **no route handler exposes either** (`P1-26-F-003`): there is no
 * operation that reads or changes how a document number is formed, and how
 * documents beyond the invoice are numbered waits on an Owner decision (DOC01,
 * ADR-023 D10).
 *
 * So this screen changes nothing (P1-32-PRE-OD-ADM5). A numbering setting
 * written to the company or branch settings would be applied by nothing — the
 * service allocates every number from its own sequences — so an edit form here
 * would be a control for an operation that does not exist. The screen shows the
 * settings the company and branch settings operations genuinely hold under
 * `numbering.`, and says plainly what is not available and why. There is no
 * preview operation either, and numbers are always allocated by the service.
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
      noticeKeys={['numbering.gap.formats', 'numbering.noPreview', 'numbering.noGeneration']}
      writable={false}
      scopes={['company', 'branch']}
    />
  );
}

/** The document title. Same key as the visible header, so they cannot disagree. */
export const generateMetadata = pageMetadata('numbering.title');
