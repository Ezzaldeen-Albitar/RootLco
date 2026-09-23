import { notFound, redirect } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { landingPath } from '@/features/authentication/api/landing';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { DashboardScreen } from '@/features/overview/components/DashboardScreen';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/** The code `ovw.dashboard-summary-read` is entitled by, and the nav gate. */
const DASHBOARD_READ = 'wo.work_order.read';

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
 * ## One code is checked here, and it is the one the read is entitled by
 *
 * `ovw.dashboard-summary-read` requires `wo.work_order.read`, and nothing else
 * on this page can be shown without it. A session lacking it is NOT given a
 * full-page refusal on the screen it lands on after signing in: it is sent to
 * the first screen of the navigation it can open (`landingPath`), which is the
 * same rule the sign-in redirect and the sidebar use. Only a session the
 * navigation offers nothing else to sees the refusal here.
 *
 * Beyond that one code the SCREEN gates itself section by section, from the
 * status the summary publishes for each one — a reader who may not see stock is
 * told so on that card, while the rest of their workshop still reads normally.
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
  const session = await requireSession(locale);
  const messages = getMessages(locale);

  if (!holds(session.permissions, DASHBOARD_READ)) {
    const elsewhere = landingPath(locale, session.permissions);
    // `redirect` throws, so nothing below runs for a session that has somewhere
    // else to go. The overview itself is excluded by construction — its gate is
    // the code this session lacks — so this can never redirect to itself; the
    // guard is what keeps that true if the rule ever changes.
    if (elsewhere !== `/${locale}`) redirect(elsewhere);
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="dashboard.title"
          crumbs={[{ labelKey: 'nav.dashboard' }]}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

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
