import { notFound } from 'next/navigation';
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
          <section className="rounded-lg border border-border bg-surface p-5 shadow-xs">
            <h2 className="text-section-title font-semibold text-text-primary">
              {translate(messages, 'overview.shellTitle')}
            </h2>
            <p className="mt-2 text-body text-text-secondary">
              {translate(messages, 'overview.shellBody')}
            </p>
          </section>
          <section className="rounded-lg border border-border bg-surface p-5 shadow-xs">
            <h2 className="text-section-title font-semibold text-text-primary">
              {translate(messages, 'overview.brandTitle')}
            </h2>
            <p className="mt-2 text-body text-text-secondary">
              {translate(messages, 'overview.brandBody')}
            </p>
          </section>
        </div>
      </PageBody>
    </>
  );
}
