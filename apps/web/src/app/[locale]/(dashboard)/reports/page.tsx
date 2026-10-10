import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { ReportCatalogueScreen } from '@/features/reports/components/ReportCatalogueScreen';
import { REPORT_PERMISSIONS } from '@/features/reports/reports-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * The report catalogue (P1-31, FE-011 … FE-014; Owner decision **D-4** of
 * 2026-09-09).
 *
 * Which reports a workshop may read, as `rpt.report-catalogue` publishes them:
 * the code-registered baselines the platform ships and the workshop's own
 * published definitions, each carrying whether it can be RUN.
 *
 * ## One permission gates the page, and it is the operation's own
 *
 * `rpt.report.read` is what all three report operations declare. There is no part
 * of this screen an operator without it may see, so a partial denial would be a
 * screen with nothing left in it. The page decides first so the refusal is stated
 * in the operator's own language instead of putting a denial in the backend's log
 * for a decision this page could make itself — and the rows a given report
 * returns need that report's own dataset codes as well, which only the server can
 * evaluate and which it evaluates on every run.
 *
 * ## The guard runs BEFORE anything is read
 *
 * Nothing is awaited above the check except the route parameters and the session
 * that produces the permissions being tested. The catalogue read itself is issued
 * by the screen below, through a Server Action, after the page has decided.
 * `scripts/ci/check-p1-31-access.mjs` is what keeps that ordering true.
 *
 * ## No write, and no download
 *
 * Authoring a report definition is a separate surface with its own authority, and
 * report export is a prerequisite that has not been built — the export permission
 * is deliberately withheld and a platform baseline names no export authority at
 * all. This page reads, and it links.
 */
export default async function ReportCataloguePage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [{ labelKey: 'nav.reports' }];

  if (!holds(session.permissions, REPORT_PERMISSIONS.read)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="reports.catalogue.title"
          crumbs={crumbs}
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
        titleKey="reports.catalogue.title"
        descriptionKey="reports.catalogue.description"
        crumbs={crumbs}
      />
      <PageBody>
        <ReportCatalogueScreen locale={locale} messages={messages} />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('reports.catalogue.title');
