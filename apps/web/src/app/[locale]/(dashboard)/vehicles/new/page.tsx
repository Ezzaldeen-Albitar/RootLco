import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { VehicleCreateScreen } from '@/features/vehicles/components/VehicleCreateScreen';
import { listBodyTypes, listMakes, listPowertrainTypes } from '@/features/vehicles/catalogue-api';
import { VEHICLE_PERMISSIONS, holds } from '@/features/crm/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Vehicle creation (`P1-27-FE-018`).
 *
 * Gated on **`veh.vehicle.manage`**, which is what `POST /api/v1/vehicles`
 * requires — not `veh.vehicle.read`. The two are genuinely different
 * capabilities and one read code fans out to five distinct write codes across
 * the vehicle domain, so rendering any write control from read access would be
 * wrong on every sub-resource.
 *
 * The three parentless catalogues are read here, on the server, so the first
 * paint has usable pickers. Models and trims are fetched in the browser when a
 * make or model is chosen, because there is nothing to fetch until then.
 */
export default async function VehicleCreatePage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);

  if (!holds(session.permissions, VEHICLE_PERMISSIONS.vehicleManage)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="vehicles.create.title"
          crumbs={[{ labelKey: 'nav.vehicles' }, { labelKey: 'vehicles.create.title' }]}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  // Read together rather than in sequence: three independent operations behind
  // `low-risk-metadata`, and a form that waits for them one after another takes
  // three round trips to become usable.
  const [makes, bodyTypes, powertrainTypes] = await Promise.all([
    listMakes(),
    listBodyTypes(),
    listPowertrainTypes(),
  ]);

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="vehicles.create.title"
        descriptionKey="vehicles.create.description"
        crumbs={[{ labelKey: 'nav.vehicles' }, { labelKey: 'vehicles.create.title' }]}
      />
      <PageBody>
        <VehicleCreateScreen
          locale={locale}
          messages={messages}
          makes={makes}
          bodyTypes={bodyTypes}
          powertrainTypes={powertrainTypes}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('vehicles.create.title');
