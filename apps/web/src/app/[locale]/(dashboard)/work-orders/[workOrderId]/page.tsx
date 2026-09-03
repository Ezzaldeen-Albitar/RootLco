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
import { readWorkOrderDetail } from '@/features/work-orders/api';
import { WorkOrderDetailScreen } from '@/features/work-orders/components/WorkOrderDetailScreen';
import { WORK_ORDER_DETAIL_PERMISSIONS } from '@/features/work-orders/work-orders-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * One work order (P1-29, `W3`) — identity, lifecycle, jobs, routing, assignment.
 *
 * ## The guard runs BEFORE the read, not beside it
 *
 * `wo.work_order.read` is tested and returned on before `readWorkOrderDetail` is
 * called. That ordering is the rule `check-p1-29-access.mjs` enforces and it is
 * not cosmetic: a page that issues its read first has already asked the backend
 * for the record by the time it decides whether the operator may see it. The
 * backend would refuse — it is the authority, not this page — but the request
 * would still have been made, and a screen that leans on that is one backend
 * regression away from leaking.
 *
 * ## Four more permissions are computed, and none of them gates the page
 *
 * Transitioning, editing a job, seeing technicians and assigning them are
 * separate authorities. They are resolved here and passed down as capabilities
 * so each panel can refuse on its own. An operator who may read a work order but
 * not move it sees the lifecycle and no action — which is more useful, and more
 * honest, than a missing section.
 *
 * **These are affordances, never enforcement.** Every one of them is decided
 * again by the backend against the actual record; the screen only decides what
 * to offer.
 */
export default async function WorkOrderDetailPage({
  params,
}: {
  readonly params: Promise<{ locale: string; workOrderId: string }>;
}) {
  const { locale, workOrderId } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [
    { labelKey: 'nav.workOrders', href: '/work-orders' },
    { labelKey: 'workOrders.detail.crumb' },
  ];

  if (!holds(session.permissions, WORK_ORDER_DETAIL_PERMISSIONS.read)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="workOrders.detail.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const detail = await readWorkOrderDetail(workOrderId);

  /**
   * The chrome every outcome shares.
   *
   * Each outcome below is its own `if` and its own return rather than a branch
   * of one ternary chain. That is deliberate: `route-correlation-binding` reads
   * the nearest enclosing `if` to decide whether a denial came from the BACKEND
   * or from a client-side gate, and a ternary carries no condition it can see —
   * so a chain leaves every denial on this page unclassified, which is a rule
   * declining to judge rather than a rule passing.
   */
  const shell = (children: React.ReactNode) => (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="workOrders.detail.title"
        descriptionKey="workOrders.detail.description"
        crumbs={crumbs}
      />
      <PageBody>{children}</PageBody>
    </>
  );

  // The reference the backend logged. `null` becomes `undefined` because the
  // state components take an optional prop, and an explicit null would render as
  // a reference that is not there.
  const reference = detail.correlationId ?? undefined;

  if (detail.status === 'not-found') {
    // A work order in another tenant or another branch is NOT FOUND here, not
    // "denied": the backend deliberately does not confirm that a record it will
    // not show you exists. No reference is printed, because the whole point is
    // that nothing about this record is being disclosed.
    return shell(<NotFoundState messages={messages} />);
  }
  if (detail.status === 'denied') {
    /*
     * The BACKEND refused this read and that refusal is in its logs, so the
     * correlation id is printed: it is the only diagnostic an operator ever
     * sees and the only thing support can search for.
     *
     * The client-side gate above prints NONE, and the difference is the point —
     * nothing was logged there, so a reference would lead nowhere.
     */
    return shell(<PermissionDeniedState messages={messages} correlationId={reference} />);
  }
  if (detail.status === 'expired') {
    return shell(<SessionExpiredState messages={messages} />);
  }
  if (detail.status === 'unavailable') {
    return shell(<BackendUnavailableState messages={messages} correlationId={reference} />);
  }
  if (detail.status !== 'ok') {
    return shell(<ErrorState messages={messages} correlationId={reference} />);
  }

  return shell(
    <WorkOrderDetailScreen
      locale={locale}
      messages={messages}
      initial={detail.data}
      canTransition={holds(session.permissions, WORK_ORDER_DETAIL_PERMISSIONS.transition)}
      canManageJobs={holds(session.permissions, WORK_ORDER_DETAIL_PERMISSIONS.jobManage)}
      canReadTechnicians={holds(session.permissions, WORK_ORDER_DETAIL_PERMISSIONS.technicianRead)}
      canAssign={holds(session.permissions, WORK_ORDER_DETAIL_PERMISSIONS.assignmentManage)}
      canReadDepartments={holds(session.permissions, WORK_ORDER_DETAIL_PERMISSIONS.departmentRead)}
      canReadDiagnostics={holds(session.permissions, WORK_ORDER_DETAIL_PERMISSIONS.diagnosticRead)}
      canRecordLabor={holds(session.permissions, WORK_ORDER_DETAIL_PERMISSIONS.laborRecord)}
    />
  );
}

export const generateMetadata = pageMetadata('workOrders.detail.title');
