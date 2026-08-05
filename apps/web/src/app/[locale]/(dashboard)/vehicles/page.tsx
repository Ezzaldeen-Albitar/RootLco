import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { VehicleSearchScreen } from '@/features/vehicles/components/VehicleSearchScreen';
import { listMakes } from '@/features/vehicles/catalogue-api';
import { VEHICLE_PERMISSIONS, holds } from '@/features/crm/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Vehicle search (`P1-27-FE-017`).
 *
 * The route-level check renders the denial **instead of** the screen. A screen
 * that mounts and then discovers it is denied has already issued its first read.
 * It is not the security boundary — `GET /api/v1/vehicles` enforces
 * `veh.vehicle.read` on every request — it only stops an operator being shown a
 * form whose every submission would come back denied.
 *
 * The make catalogue is read here, once, on the server. Search publishes
 * `makeId` and no name, so the results table needs the catalogue to render a
 * Make column at all. Reading it per row would be an N+1 against a rate-limited
 * API; reading it once per page load is one request for the whole table.
 */
export default async function VehicleSearchPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);

  if (!holds(session.permissions, VEHICLE_PERMISSIONS.vehicleRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="vehicles.search.title"
          crumbs={[{ labelKey: 'nav.vehicles' }]}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  // A failed catalogue read is not a failed page. The Make column degrades to
  // "unavailable" and search still works, because a vehicle search that refuses
  // to run because a label lookup failed would be worse than one without labels.
  const makes = await listMakes();

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="vehicles.search.title"
        descriptionKey="vehicles.search.description"
        crumbs={[{ labelKey: 'nav.vehicles' }]}
      />
      <PageBody fill>
        <VehicleSearchScreen
          locale={locale}
          messages={messages}
          canCreate={holds(session.permissions, VEHICLE_PERMISSIONS.vehicleManage)}
          makes={makes.status === 'ok' ? makes.options : []}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('vehicles.search.title');
