import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { DashboardScreen } from '@/features/overview/components/DashboardScreen';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * The dashboard — the workshop's own landing screen (Owner directive,
 * `P1-32-PRE-OD-UX`).
 *
 * ## What replaced what, and why the old page could not stay
 *
 * This route used to be the shell's demonstration page: two cards of prose
 * describing what the product could do. That was the right screen while there
 * was nothing behind it — a page of plausible-looking zeros reads as a working
 * product that is merely empty — and it is the wrong screen now that
 * `ovw.dashboard-summary-read` computes every figure on it as an aggregate over
 * the authorized selection. Nothing below is drawn from a list this page holds;
 * nothing below is drawn at all unless the platform answered it.
 *
 * ## No permission is checked here, and that is deliberate
 *
 * The overview entry in the navigation is the one entry no permission gates:
 * every signed-in person lands here. So this route refuses nobody and gates
 * nothing. The SCREEN gates itself section by section, from the status the
 * summary publishes for each one — a reader who may not see stock is told so on
 * that card, while the rest of their workshop still reads normally. A page-level
 * refusal would have to pick one code and would then hide eleven figures for
 * want of the twelfth.
 *
 * The session itself is already required by the group layout above, which is
 * what turns an unauthenticated arrival into a sign-in rather than an empty
 * dashboard.
 *
 * ## The Platform Owner Console keeps its own overview
 *
 * That screen is about organisations and subscriptions, lives under
 * `(platform)`, and is untouched by this one.
 */
export default async function DashboardPage({
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
        titleKey="dashboard.title"
        descriptionKey="dashboard.description"
        crumbs={[{ labelKey: 'nav.dashboard' }]}
      />
      <PageBody>
        <DashboardScreen locale={locale} messages={messages} />
      </PageBody>
    </>
  );
}

/** The document title. Same key as the visible header, so they cannot disagree. */
export const generateMetadata = pageMetadata('dashboard.title');
