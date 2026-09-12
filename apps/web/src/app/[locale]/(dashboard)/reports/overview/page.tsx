import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { ReportOverviewScreen } from '@/features/reports/components/ReportOverviewScreen';
import { listReportCatalogue, readReportScopes } from '@/features/reports/reports-api';
import {
  namedReportSelection,
  REPORT_PAGE_SIZE,
  REPORT_PERMISSIONS,
} from '@/features/reports/reports-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * The operational overview (P1-31, FE-010 and FE-016; Owner decision **D-19** of
 * 2026-09-12, with **D-5** of 2026-09-09 and **D-17** of 2026-09-10).
 *
 * The four approved report domains summarised for one branch and one period, each
 * section from that domain's own report run. FE-016 is this same page with the
 * branch named in the address: **D-19** asks for the overview "for the selected
 * branch, with no hard-coded pilot", and one screen serving both is what makes
 * that literally true — there is no second code path in which a branch could be
 * written down.
 *
 * ## The guard runs BEFORE anything is read
 *
 * `rpt.report.read` is the code all three report operations declare, and it is
 * tested and returned on before the scopes or the catalogue are asked for.
 * Nothing is awaited above the check but the route parameters and the session that
 * produces the permissions being tested. `scripts/ci/check-p1-31-access.mjs` is
 * what keeps that ordering true.
 *
 * The datasets' own read codes are NOT gated here and could not be: they are
 * per-report, the registry that holds them is not visible from this side, and the
 * run service evaluates them at the same company and branch on every run. A guess
 * would either hide a domain an operator may read or offer one they may not.
 *
 * ## Two reads happen here, and the four runs do not
 *
 * The authorized company and branch directory, and the report catalogue — the
 * catalogue because it is the platform's own answer to whether each of the four
 * can be RUN, and a section that cannot be run must not have a read issued for it.
 * The four runs are issued by the screen, after an operator names a branch and a
 * period, because the run is branch-scoped and that pair is its authorization
 * target rather than a filter.
 *
 * ## The branch in the address is resolved, never trusted and never guessed
 *
 * `branchId` is passed down as the caller wrote it. The screen matches it against
 * the authorized directory and renders the no-branch body when it is not there —
 * it does not fall back to another branch, and there is no default branch anywhere
 * in this feature. The company is derived from the branch, so the pair can never
 * disagree.
 *
 * ## `overview` is a route, so it is not a report code
 *
 * This page sits at `/reports/overview`, beside the `[reportCode]` segment that
 * serves one report. A static segment wins over a dynamic one, so a report whose
 * code was literally `overview` could not be opened from the address; none of the
 * four approved codes is, and the day one were, this route is the one that would
 * move.
 */
export default async function ReportOverviewPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [
    { labelKey: 'nav.reports', href: `/${locale}/reports` },
    { labelKey: 'reports.overview.crumb' },
  ];

  if (!holds(session.permissions, REPORT_PERMISSIONS.read)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="reports.overview.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  // The address's own words, read by the feature that owns that vocabulary. FE-016
  // names a branch here; the screen resolves it against the caller's authorized
  // directory and renders the no-branch body when it is not there.
  const named = namedReportSelection(await searchParams);

  const scopeOptions = await readReportScopes();
  const catalogue = await listReportCatalogue({ cursor: null, limit: REPORT_PAGE_SIZE });

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="reports.overview.title"
        descriptionKey="reports.overview.description"
        crumbs={crumbs}
      />
      <PageBody>
        <ReportOverviewScreen
          locale={locale}
          messages={messages}
          scopeOptions={scopeOptions}
          catalogue={catalogue}
          fixedBranchId={named.branchId ?? null}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('reports.overview.title');
