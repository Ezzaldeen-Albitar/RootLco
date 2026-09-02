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

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="workOrders.detail.title"
        descriptionKey="workOrders.detail.description"
        crumbs={crumbs}
      />
      <PageBody>
        {detail.status === 'ok' ? (
          <WorkOrderDetailScreen
            locale={locale}
            messages={messages}
            initial={detail.data}
            canTransition={holds(session.permissions, WORK_ORDER_DETAIL_PERMISSIONS.transition)}
            canManageJobs={holds(session.permissions, WORK_ORDER_DETAIL_PERMISSIONS.jobManage)}
            canReadTechnicians={holds(
              session.permissions,
              WORK_ORDER_DETAIL_PERMISSIONS.technicianRead
            )}
            canAssign={holds(session.permissions, WORK_ORDER_DETAIL_PERMISSIONS.assignmentManage)}
            canReadDepartments={holds(
              session.permissions,
              WORK_ORDER_DETAIL_PERMISSIONS.departmentRead
            )}
          />
        ) : detail.status === 'not-found' ? (
          // A work order in another tenant or another branch is NOT FOUND here,
          // not "denied": the backend deliberately does not confirm that a
          // record it will not show you exists.
          <NotFoundState messages={messages} />
        ) : detail.status === 'denied' ? (
          <PermissionDeniedState messages={messages} />
        ) : detail.status === 'expired' ? (
          <SessionExpiredState messages={messages} />
        ) : detail.status === 'unavailable' ? (
          <BackendUnavailableState messages={messages} />
        ) : (
          <ErrorState messages={messages} />
        )}
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('workOrders.detail.title');
