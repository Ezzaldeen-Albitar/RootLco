import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import {
  BackendUnavailableState,
  ErrorState,
  NotFoundState,
  PermissionDeniedState,
  SessionExpiredState,
} from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { ReportScreen } from '@/features/reports/components/ReportScreen';
import { readReport, readReportScopes } from '@/features/reports/reports-api';
import { namedReportSelection, REPORT_PERMISSIONS } from '@/features/reports/reports-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * One report — its definition, and a run of it over one branch and one period
 * (P1-31, FE-011 … FE-014; Owner decisions **D-4**, **D-17** and **D-20**).
 *
 * ONE page serves every report code. The catalogue decides which reports exist
 * and the run envelope decides what each one renders, so the four approved
 * reports — and any the engine registers after them — arrive here without a
 * second page and without a contract guessed at in advance.
 *
 * ## The guard runs BEFORE the read
 *
 * `rpt.report.read` is tested and returned on before `readReport` is called. A
 * page that issues its read first has already asked the backend for the
 * definition by the time it decides whether the operator may see it. The backend
 * would refuse — it is the authority, not this page — but the request would still
 * have been made, and a screen that leans on that is one backend regression away
 * from leaking.
 *
 * ## The dataset's own codes are NOT gated here, and could not be
 *
 * Each report additionally requires the read codes of the data behind it, and
 * they are per-report: a single page cannot declare a code that depends on its
 * own path parameter, and this side cannot see the registry that holds them. The
 * run service evaluates them at the same company and branch and answers the
 * uniform refusal, which this screen renders as a refusal. Nothing here
 * approximates that check or guesses which codes a report needs — a guess would
 * either hide a report an operator may read or offer one they may not.
 *
 * ## The address may fill the form in, and may not submit it
 *
 * A link from the operational overview carries the company, the branch and the
 * two days the summary was read over. They are passed to the screen as the
 * ADDRESS's own values and resolved there against the caller's authorized
 * directory; nothing is run for the operator, and a branch the directory does not
 * hold is dropped rather than shown. That is the whole of the prefill: no default
 * period, no default branch, and no read issued from a parameter.
 *
 * ## A code that is not published answers NOT FOUND, and says no more
 *
 * An unknown code, a draft, an archived definition and another workshop's report
 * all answer identically, deliberately: the catalogue must not become a way to
 * discover which reports a workshop has configured. This page renders that one
 * outcome and does not try to tell the four apart.
 */
export default async function ReportPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string; reportCode: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, reportCode } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [
    { labelKey: 'nav.reports', href: `/${locale}/reports` },
    { labelKey: 'reports.run.crumb' },
  ];

  if (!holds(session.permissions, REPORT_PERMISSIONS.read)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="reports.run.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const definition = await readReport(reportCode);

  /**
   * The chrome every outcome shares.
   *
   * Each outcome below is its own `if` and its own `return` rather than a branch
   * of one ternary chain, for the reason the work-order and delivery detail pages
   * record: `route-correlation-binding` reads the nearest enclosing `if` to decide
   * whether a denial came from the BACKEND or from a client-side gate, and a
   * ternary carries no condition it can see.
   */
  const shell = (children: React.ReactNode) => (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="reports.run.title"
        descriptionKey="reports.run.description"
        crumbs={crumbs}
      />
      <PageBody>{children}</PageBody>
    </>
  );

  // The reference the backend logged. `null` becomes `undefined` because the
  // state components take an optional prop, and an explicit null would render as
  // a reference that is not there.
  const reference = definition.correlationId ?? undefined;

  if (definition.status === 'not-found') {
    // No reference is printed: nothing about this code is being disclosed, which
    // is the whole point of the uniform answer.
    return shell(<NotFoundState messages={messages} />);
  }
  if (definition.status === 'denied') {
    // The BACKEND refused this read and that refusal is in its logs, so the
    // correlation reference is printed: it is the only diagnostic an operator
    // ever sees. The client-side gate above prints none, because nothing was
    // logged there and a reference would lead nowhere.
    return shell(<PermissionDeniedState messages={messages} correlationId={reference} />);
  }
  if (definition.status === 'expired') {
    return shell(<SessionExpiredState messages={messages} />);
  }
  if (definition.status === 'unavailable') {
    return shell(<BackendUnavailableState messages={messages} correlationId={reference} />);
  }
  if (definition.status !== 'ok') {
    return shell(<ErrorState messages={messages} correlationId={reference} />);
  }

  const scopeOptions = await readReportScopes();
  const query = await searchParams;

  return shell(
    <ReportScreen
      locale={locale}
      messages={messages}
      definition={definition.data}
      scopeOptions={scopeOptions}
      named={namedReportSelection(query)}
    />
  );
}

export const generateMetadata = pageMetadata('reports.run.title');
