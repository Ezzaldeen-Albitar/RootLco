import { notFound } from 'next/navigation';
import { brandIsProvisional } from '@/components/brand/theme';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { isLocale } from '@/i18n/config';
import { getMessages, translate } from '@/i18n/get-messages';

/**
 * Overview.
 *
 * The shell's own demonstration page, and deliberately NOT a business
 * dashboard: it shows no counts, no queues and no records, because there is no
 * data behind it and a screen full of plausible-looking zeros reads as a
 * working product that is merely empty.
 */
export default async function OverviewPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const messages = getMessages(locale);

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="overview.title"
        descriptionKey="overview.description"
        crumbs={[{ labelKey: 'nav.overview' }]}
      />
      <PageBody>
        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-xl border border-border-subtle bg-surface p-5 shadow-xs">
            <h2 className="text-section-title font-semibold text-text-heading">
              {translate(messages, 'overview.shellTitle')}
            </h2>
            <p className="mt-2 text-body text-text-secondary">
              {translate(messages, 'overview.shellBody')}
            </p>
          </section>
          {/*
            The copy follows brand STATE. While the brand is provisional it says
            so; once approved it describes the identity instead. It used to say
            "provisional" unconditionally, which would have shipped that claim
            alongside an approved brand (P1-25-F-026).
          */}
          <section className="rounded-xl border border-border-subtle bg-surface p-5 shadow-xs">
            <h2 className="text-section-title font-semibold text-text-heading">
              {translate(
                messages,
                brandIsProvisional ? 'overview.brandTitle' : 'overview.identityTitle'
              )}
            </h2>
            <p className="mt-2 text-body text-text-secondary">
              {translate(
                messages,
                brandIsProvisional ? 'overview.brandBody' : 'overview.identityBody'
              )}
            </p>
          </section>
        </div>
      </PageBody>
    </>
  );
}
