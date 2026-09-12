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
import { readDelivery } from '@/features/delivery/api';
import { DeliveryDetailScreen } from '@/features/delivery/components/DeliveryDetailScreen';
import { DELIVERY_PERMISSIONS } from '@/features/delivery/delivery-contract';
import { WARRANTY_PERMISSIONS } from '@/features/warranty/warranty-contract';
import { WORK_ORDER_PERMISSIONS } from '@/features/work-orders/work-orders-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * One vehicle handover (P1-31) — its record, whether it may complete, who is
 * authorised to receive the vehicle, what was signed, what was checked, and
 * every move it has made.
 *
 * ## The guard runs BEFORE the read
 *
 * `sal.delivery.view` is tested and returned on before `readDelivery` is called.
 * A page that issues its read first has already asked the backend for the record
 * by the time it decides whether the operator may see it. The backend would
 * refuse — it is the authority, not this page — but the request would still have
 * been made, and a screen that leans on that is one backend regression away from
 * leaking. `scripts/ci/check-p1-31-access.mjs` is what keeps that ordering true
 * for every P1-31 screen after this one.
 *
 * ## A second permission is computed and does not gate the page
 *
 * The eligibility read demands `sal.finance.view` as well, because one of the
 * reasons it composes is the customer's open balance. That is resolved here and
 * passed down as a capability, so the eligibility panel refuses on its own while
 * the rest of the handover still renders. Gating the whole page on it would hide
 * the custody chain from everyone who is not in finance.
 *
 * `sal.delivery.complete` is computed for the same reason, and it now authorises
 * something: it decides whether the release control is drawn at all, and whether
 * the eligibility panel says the one overridable reason may be overridden by the
 * reader or by somebody else.
 *
 * `sal.delivery.manage` is the third, and it is deliberately a SEPARATE
 * capability rather than folded into the other two. It is the code every
 * preparation act declares — confirming who may receive the vehicle, recording a
 * checklist result, adding a signature — and it is not the code that releases
 * the vehicle. Resolving each control against the code ITS OWN operation
 * declares is what stops a screen offering a button whose only outcome is a
 * denial.
 *
 * `wty.warranty.issue` is the fourth, added with FE-008. It is the code
 * `wty.warranty-generate` declares and it is neither of the delivery write codes, so
 * it is resolved on its own: a caller who may release a vehicle does not necessarily
 * have the authority to issue the warranty that follows it.
 *
 * `wty.warranty.read` is the fifth, and it rides alongside the fourth without
 * being folded into it: issuing a warranty and reading the published plans are
 * two codes, and a caller may hold either without the other. It is what the plan
 * picker inside the warranty control needs.
 *
 * `wo.work_order.read` is the sixth, and it is consulted for the printable
 * handover sheet alone (FE-007). The work-order read is the only read reachable
 * from this screen that resolves a customer name, a registration plate or a
 * work-order number; without the code it is not asked, and the sheet prints the
 * identifiers the delivery record carries instead. It does not gate the page,
 * because a handover is readable without it.
 *
 * **All six are affordances, never enforcement.** Every read and every write is
 * decided again by the backend against the actual record.
 */
export default async function DeliveryDetailPage({
  params,
}: {
  readonly params: Promise<{ locale: string; deliveryId: string }>;
}) {
  const { locale, deliveryId } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  /*
   * TWO crumbs now, because the ancestor SCREEN exists.
   *
   * This page shipped with one crumb and said why: the navigation entry for
   * `/delivery` was still `planned`, so a parent crumb would have been either a
   * link to a page that does not exist or a route-less ancestor, and
   * `shell.dom.test.tsx` measures that no route-less ancestor exists in this
   * product. FE-001 built that list on the Owner's D-3 decision, so the parent
   * crumb arrives with it — carrying an href, which is what keeps that
   * measurement true.
   */
  const crumbs = [
    { labelKey: 'nav.delivery', href: `/${locale}/delivery` },
    { labelKey: 'delivery.detail.crumb' },
  ];

  if (!holds(session.permissions, DELIVERY_PERMISSIONS.view)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="delivery.detail.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const record = await readDelivery(deliveryId);

  /**
   * The chrome every outcome shares.
   *
   * Each outcome below is its own `if` and its own return rather than a branch
   * of one ternary chain, for the reason the work-order detail page records:
   * `route-correlation-binding` reads the nearest enclosing `if` to decide
   * whether a denial came from the BACKEND or from a client-side gate, and a
   * ternary carries no condition it can see.
   */
  const shell = (children: React.ReactNode) => (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="delivery.detail.title"
        descriptionKey="delivery.detail.description"
        crumbs={crumbs}
      />
      <PageBody>{children}</PageBody>
    </>
  );

  // The reference the backend logged. `null` becomes `undefined` because the
  // state components take an optional prop, and an explicit null would render as
  // a reference that is not there.
  const reference = record.correlationId ?? undefined;

  if (record.status === 'not-found') {
    // A delivery in another company or another branch is NOT FOUND here, not
    // "denied": the backend deliberately does not confirm that a record it will
    // not show you exists. No reference is printed, because the whole point is
    // that nothing about this record is being disclosed.
    return shell(<NotFoundState messages={messages} />);
  }
  if (record.status === 'denied') {
    // The BACKEND refused this read and that refusal is in its logs, so the
    // correlation reference is printed: it is the only diagnostic an operator
    // ever sees. The client-side gate above prints none, because nothing was
    // logged there and a reference would lead nowhere.
    return shell(<PermissionDeniedState messages={messages} correlationId={reference} />);
  }
  if (record.status === 'expired') {
    return shell(<SessionExpiredState messages={messages} />);
  }
  if (record.status === 'unavailable') {
    return shell(<BackendUnavailableState messages={messages} correlationId={reference} />);
  }
  if (record.status !== 'ok') {
    return shell(<ErrorState messages={messages} correlationId={reference} />);
  }

  return shell(
    <DeliveryDetailScreen
      locale={locale}
      messages={messages}
      delivery={record.data}
      canReadFinance={holds(session.permissions, DELIVERY_PERMISSIONS.financeView)}
      canComplete={holds(session.permissions, DELIVERY_PERMISSIONS.complete)}
      canManage={holds(session.permissions, DELIVERY_PERMISSIONS.manage)}
      canIssueWarranty={holds(session.permissions, WARRANTY_PERMISSIONS.issue)}
      canReadWarrantyPolicies={holds(session.permissions, WARRANTY_PERMISSIONS.read)}
      canReadWorkOrder={holds(session.permissions, WORK_ORDER_PERMISSIONS.read)}
    />
  );
}

export const generateMetadata = pageMetadata('delivery.detail.title');
