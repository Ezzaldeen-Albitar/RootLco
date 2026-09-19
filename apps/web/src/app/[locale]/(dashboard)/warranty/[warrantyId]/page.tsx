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
import { WarrantyRecordScreen } from '@/features/warranty/components/WarrantyRecordScreen';
import { readWarranty } from '@/features/warranty/warranty-api';
import { WARRANTY_PERMISSIONS } from '@/features/warranty/warranty-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * One warranty record (P1-31, FE-008) — its state, the policy it was issued under,
 * the coverage terms it cites and the jobs and parts it covers.
 *
 * ## The guard runs BEFORE the read
 *
 * `wty.warranty.read` is tested and returned on before `readWarranty` is called. Until
 * P-7 minted that code this read was gated on `wty.warranty.issue` — the authority to
 * CREATE a warranty — which over-granted by omission, and nothing on this page may
 * collapse the two back together.
 *
 * ## The breadcrumb has a parent, because the list exists
 *
 * Two crumbs rather than one: `/warranty` is a real screen in this same change, so a
 * reader can go back to the branch's records instead of to a route-less ancestor.
 */
export default async function WarrantyRecordPage({
  params,
}: {
  readonly params: Promise<{ locale: string; warrantyId: string }>;
}) {
  const { locale, warrantyId } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [
    { labelKey: 'nav.warranty', href: `/${locale}/warranty` },
    { labelKey: 'warranty.record.crumb' },
  ];

  if (!holds(session.permissions, WARRANTY_PERMISSIONS.read)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="warranty.record.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const record = await readWarranty(warrantyId);

  /**
   * The chrome every outcome shares.
   *
   * Each outcome below is its own `if` and its own return rather than a branch of
   * one ternary chain, for the reason the delivery detail page records:
   * `route-correlation-binding` reads the nearest enclosing `if` to decide whether a
   * denial came from the BACKEND or from a client-side gate, and a ternary carries no
   * condition it can see.
   */
  const shell = (children: React.ReactNode) => (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="warranty.record.title"
        descriptionKey="warranty.record.description"
        crumbs={crumbs}
      />
      <PageBody>{children}</PageBody>
    </>
  );

  // The reference the backend logged. `null` becomes `undefined` because the state
  // components take an optional prop, and an explicit null would render as a
  // reference that is not there.
  const reference = record.correlationId ?? undefined;

  if (record.status === 'not-found') {
    // A warranty in another company or another branch is NOT FOUND here, not
    // "denied": the backend deliberately does not confirm that a record it will not
    // show you exists. No reference is printed, because the whole point is that
    // nothing about this record is being disclosed.
    return shell(<NotFoundState messages={messages} />);
  }
  if (record.status === 'denied') {
    // The BACKEND refused this read and that refusal is in its logs, so the
    // correlation reference is printed: it is the only diagnostic an operator ever
    // sees. The client-side gate above prints none, because nothing was logged there.
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

  return shell(<WarrantyRecordScreen locale={locale} messages={messages} warranty={record.data} />);
}

export const generateMetadata = pageMetadata('warranty.record.title');
