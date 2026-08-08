import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { NotFoundState, PermissionDeniedState, ErrorState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { VehicleProfileScreen } from '@/features/vehicles/components/VehicleProfileScreen';
import { readVehicle } from '@/features/vehicles/profile-api';
import { readEvProfile } from '@/features/vehicles/relations-api';
import { listVehicleDocuments, type DocumentsState } from '@/features/vehicles/documents-api';
import { DOCUMENT_LIST_PERMISSION } from '@/features/vehicles/documents-contract';
import { CRM_PERMISSIONS, VEHICLE_PERMISSIONS, holds } from '@/features/crm/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Vehicle profile (`P1-27-FE-019`) and VIN validation (`P1-27-FE-020`).
 *
 * Three permissions, three different questions:
 *
 * - `veh.vehicle.read` — may this operator see the vehicle at all?
 * - `veh.vehicle.manage` — may they edit its description?
 * - `veh.vehicle.status.manage` — may they change its lifecycle?
 *
 * The read gates the page; the other two gate panels inside it. One read code
 * fans out to five write codes across this domain, so rendering an edit form
 * from read access would be wrong here and on every sub-resource.
 *
 * A 404 means four things at once — absent, soft-deleted, another tenant's, or
 * never existed — and the screen says "not found" without speculating which.
 * Speculating would rebuild the existence oracle the shared 404 exists to
 * prevent. A **merged** vehicle is not among them: it is returned, and shown.
 */
export default async function VehicleProfilePage({
  params,
}: {
  readonly params: Promise<{ locale: string; vehicleId: string }>;
}) {
  const { locale, vehicleId } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);

  const header = (
    <PageHeader
      locale={locale}
      messages={messages}
      titleKey="vehicles.profile.title"
      crumbs={[{ labelKey: 'nav.vehicles' }, { labelKey: 'vehicles.profile.title' }]}
    />
  );

  if (!holds(session.permissions, VEHICLE_PERMISSIONS.vehicleRead)) {
    return (
      <>
        {header}
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const result = await readVehicle(vehicleId);

  if (result.status === 'not-found' || (result.status === 'ok' && result.data === null)) {
    return (
      <>
        {header}
        <PageBody>
          <NotFoundState messages={messages} />
        </PageBody>
      </>
    );
  }

  if (result.status !== 'ok' || result.data === null) {
    return (
      <>
        {header}
        <PageBody>
          {result.status === 'denied' ? (
            <PermissionDeniedState messages={messages} />
          ) : (
            <ErrorState messages={messages} correlationId={result.correlationId ?? undefined} />
          )}
        </PageBody>
      </>
    );
  }

  // Read on the SERVER. A 404 here means "no EV profile" as often as it means
  // "no vehicle", and the vehicle's existence has just been established above —
  // so this is the one place the ambiguity can be resolved honestly.
  const evProfile = await readEvProfile(vehicleId);

  // The documents tab needs `shared.document.manage` — a MANAGE capability from
  // a different module, inverted relative to every other vehicle sub-resource.
  // The list is only read when the caller holds it, so a denied operator never
  // spends an `expensive-read` slot discovering they cannot see it.
  const canListDocuments = holds(session.permissions, DOCUMENT_LIST_PERMISSION);
  const documents: DocumentsState = canListDocuments
    ? await listVehicleDocuments(vehicleId)
    : { status: 'denied', correlationId: null };

  return (
    <>
      <PageBody>
        <VehicleProfileScreen
          locale={locale}
          messages={messages}
          vehicle={result.data}
          canEdit={holds(session.permissions, VEHICLE_PERMISSIONS.vehicleManage)}
          canChangeStatus={holds(session.permissions, VEHICLE_PERMISSIONS.statusManage)}
          canManageRelationships={holds(
            session.permissions,
            VEHICLE_PERMISSIONS.relationshipManage
          )}
          // `crm.vehicle-link` is a CRM operation with a CRM permission. An
          // operator may hold one of these two and not the other, so the
          // relationships panel takes both rather than conflating them.
          canLinkCustomer={holds(session.permissions, CRM_PERMISSIONS.vehicleManage)}
          evProfile={evProfile}
          canListDocuments={canListDocuments}
          documents={documents}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('vehicles.profile.title');
