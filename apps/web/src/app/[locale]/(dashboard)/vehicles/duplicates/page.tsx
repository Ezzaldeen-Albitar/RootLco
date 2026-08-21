import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { VehicleDuplicateReviewScreen } from '@/features/vehicles/components/VehicleDuplicateReviewScreen';
import { VEHICLE_PERMISSIONS, holds } from '@/features/crm/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * The vehicle duplicate-candidate review queue (`P1-27-FE-028`).
 *
 * Gated on `veh.vehicle.duplicate.review`, which is what
 * `GET /api/v1/vehicle-duplicates` requires. The denial renders **instead of**
 * the screen, so a denied operator never issues the first read.
 *
 * `veh.vehicle.merge` is deliberately not checked. It gates nothing on this
 * page, because this page offers no merge: `P1-OD-017` is open and the
 * affordance is absent rather than disabled.
 */
export default async function VehicleDuplicatesPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);

  const header = (
    <PageHeader
      locale={locale}
      messages={messages}
      titleKey="vehicles.duplicates.title"
      // The parent crumb LINKS. Without an href it rendered as a `<span>`, which
      // both marked a second current page in the landmark and left this queue
      // with no breadcrumb route back to the list it belongs to.
      crumbs={[
        { labelKey: 'nav.vehicles', href: `/${locale}/vehicles` },
        { labelKey: 'vehicles.duplicates.title' },
      ]}
    />
  );

  if (!holds(session.permissions, VEHICLE_PERMISSIONS.duplicateReview)) {
    return (
      <>
        {header}
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  return (
    <>
      {header}
      <PageBody fill>
        <VehicleDuplicateReviewScreen locale={locale} messages={messages} />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('vehicles.duplicates.title');
