import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { requireSession } from '@/features/authentication/api/session';
import {
  listBranches,
  listCompanies,
  readCapacity,
  readCurrencyChoices,
  readTenant,
} from '@/features/administration/organization/api';
import { CapacityPanel } from '@/features/administration/organization/components/CapacityPanel';
import { readReferenceValues } from '@/features/administration/organization/reference-values';
import { OrganizationStructure } from '@/features/administration/organization/components/OrganizationStructure';
import { OrgReadBoundary } from '@/features/administration/organization/components/OrgReadBoundary';
import { SettingsEditor } from '@/features/administration/organization/components/SettingsEditor';
import { TenantForm } from '@/features/administration/organization/components/TenantForm';
import { Panel } from '@/features/administration/shared/components/ScreenStates';
import { PERMISSIONS, holds } from '@/features/administration/shared/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages, translate } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Organization settings.
 *
 * Three approved surfaces, in the order an operator thinks about them: the
 * workspace itself, then the settings a company runs on, then a branch's.
 *
 * Scope is whatever the SERVER resolved for this session. The screen never sends
 * a company or branch the caller chose from client state as if it were
 * authoritative — it sends an identifier as a path parameter, and
 * `assertScopeWithinAuthority` decides, before existence is even checked.
 *
 * The currency, time-zone and language choices come from
 * `org.reference-values-read` (P1-32-PRE-OD-REF), read only for a holder of
 * `org.tenant.read`, the code it declares. Without it, or when it fails, the
 * company and branch dialogs and the tenant form fall back to the values already
 * in use; nothing becomes free text. When it was made and failed, the fields say
 * so and offer Try again, and a select left empty refuses to send.
 *
 * On Material UI (ADR-022, P1-32-PRE-OD-ADM1): a read that did not answer is
 * the shared Material state (`OrgReadBoundary`), with Try again where trying
 * again can help; the companies and branches can be edited as well as added
 * (`org.company-update`, `org.branch-update`), each by the code its operation
 * declares.
 */
export default async function OrganizationPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const t = (key: string) => translate(messages, key as keyof typeof messages);

  // Every read below is decided by the permission its operation declares BEFORE
  // it is made, so a session that may not see a section never requests it.
  const canReadTenant = holds(session.permissions, PERMISSIONS.tenantRead);
  const canReadCompanies = holds(session.permissions, PERMISSIONS.companyRead);
  const canReadBranches = holds(session.permissions, PERMISSIONS.branchRead);
  const canWriteSettings = holds(session.permissions, PERMISSIONS.settingsManage);
  const canManageCompanies = holds(session.permissions, PERMISSIONS.companyManage);
  const canManageBranches = holds(session.permissions, PERMISSIONS.branchManage);

  // `iam.tenant-settings-read` declares `org.tenant.read`: without it the
  // Workspace card says so, and no read is made to be refused.
  const tenant = canReadTenant
    ? await readTenant()
    : { status: 'denied' as const, data: null, correlationId: null };
  const capacity = canReadTenant ? await readCapacity() : null;
  const referenceValues = canReadTenant ? await readReferenceValues() : null;
  // Made and failed, as against never made: only a failure offers Try again.
  const referenceUnavailable = canReadTenant && referenceValues === null;
  const companies = canReadCompanies ? await listCompanies() : null;
  const branches = canReadBranches ? await listBranches() : null;
  const currencyChoices =
    canManageCompanies && companies?.status === 'ok'
      ? await readCurrencyChoices(companies.data.map((company) => company.id))
      : [];
  const timezoneChoices = [
    ...new Set([
      ...(tenant.status === 'ok' && tenant.data ? [tenant.data.defaultTimezone] : []),
      ...(branches?.status === 'ok' ? branches.data.map((branch) => branch.timezoneName) : []),
    ]),
  ].sort();

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="organization.title"
        descriptionKey="organization.description"
        crumbs={[
          { labelKey: 'nav.administration', href: `/${locale}/administration` },
          { labelKey: 'nav.organization' },
        ]}
      />
      <PageBody>
        <div className="flex flex-col gap-6">
          <Panel title={t('organization.tenant')}>
            <OrgReadBoundary state={toReadState(tenant)} messages={messages} locale={locale}>
              {(view) => (
                <TenantForm
                  locale={locale}
                  messages={messages}
                  tenant={view}
                  canWrite={canWriteSettings}
                  referenceValues={referenceValues}
                  referenceUnavailable={referenceUnavailable}
                  timezoneChoices={timezoneChoices}
                />
              )}
            </OrgReadBoundary>
          </Panel>

          {capacity ? (
            <Panel
              title={t('organization.capacity.title')}
              description={t('organization.capacity.description')}
            >
              <OrgReadBoundary state={capacity} messages={messages} locale={locale}>
                {(view) => <CapacityPanel capacity={view} messages={messages} locale={locale} />}
              </OrgReadBoundary>
            </Panel>
          ) : null}

          {companies || branches ? (
            <Panel title={t('organization.structure.title')}>
              <OrganizationStructure
                locale={locale}
                messages={messages}
                capacity={capacity?.status === 'ok' ? capacity.data : null}
                companies={companies}
                branches={branches}
                currencyChoices={currencyChoices}
                timezoneChoices={timezoneChoices}
                referenceValues={referenceValues}
                referenceUnavailable={referenceUnavailable}
                canManageCompanies={canManageCompanies}
                canManageBranches={canManageBranches}
                canChangeBranchStatus={canWriteSettings}
              />
            </Panel>
          ) : null}

          {/* The code alone does not decide the company read: a branch grant carries
              it too. The editor reads only the companies the working context names
              in `companySettingsReadableIds` and says so plainly for the rest. */}
          {canReadCompanies ? (
            <Panel title={t('organization.settings.company')}>
              <SettingsEditor
                messages={messages}
                scope="company"
                canWrite={canWriteSettings}
                keyPrefix=""
              />
            </Panel>
          ) : null}

          {canReadBranches ? (
            <Panel title={t('organization.settings.branch')}>
              <SettingsEditor
                messages={messages}
                scope="branch"
                canWrite={canWriteSettings}
                keyPrefix=""
              />
            </Panel>
          ) : null}
        </div>
      </PageBody>
    </>
  );
}

/**
 * Bridges the organization module's `Read<T>` onto the shared `ReadState<T>`.
 *
 * Two shapes exist because the settings reads return `null` data on failure and
 * the shared boundary is a discriminated union; converting once here is cheaper
 * than making every caller narrow twice.
 */
function toReadState<T>(read: {
  readonly status: 'ok' | 'denied' | 'expired' | 'unavailable' | 'error' | 'not-found';
  readonly data: T | null;
  readonly correlationId: string | null;
}) {
  if (read.status === 'ok' && read.data !== null) {
    return { status: 'ok' as const, data: read.data, correlationId: read.correlationId };
  }
  return {
    status: read.status === 'ok' ? ('error' as const) : read.status,
    correlationId: read.correlationId,
  };
}

/** The document title. Same key as the visible header, so they cannot disagree. */
export const generateMetadata = pageMetadata('organization.title');
