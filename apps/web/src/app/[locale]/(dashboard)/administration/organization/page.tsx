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
import { OrganizationStructure } from '@/features/administration/organization/components/OrganizationStructure';
import { SettingsEditor } from '@/features/administration/organization/components/SettingsEditor';
import { TenantForm } from '@/features/administration/organization/components/TenantForm';
import {
  ContractNotice,
  Panel,
  ReadBoundary,
} from '@/features/administration/shared/components/ScreenStates';
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

  const tenant = await readTenant();
  const capacity = canReadTenant ? await readCapacity() : null;
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
            <ReadBoundary state={toReadState(tenant)} messages={messages}>
              {(view) => (
                <TenantForm messages={messages} tenant={view} canWrite={canWriteSettings} />
              )}
            </ReadBoundary>
          </Panel>

          {capacity ? (
            <Panel
              title={t('organization.capacity.title')}
              description={t('organization.capacity.description')}
            >
              <ReadBoundary state={capacity} messages={messages}>
                {(view) => <CapacityPanel capacity={view} messages={messages} locale={locale} />}
              </ReadBoundary>
            </Panel>
          ) : null}

          {companies || branches ? (
            <Panel title={t('organization.structure.title')}>
              <OrganizationStructure
                messages={messages}
                capacity={capacity?.status === 'ok' ? capacity.data : null}
                companies={companies}
                branches={branches}
                currencyChoices={currencyChoices}
                timezoneChoices={timezoneChoices}
                canManageCompanies={canManageCompanies}
                canManageBranches={canManageBranches}
                canChangeBranchStatus={canWriteSettings}
              />
            </Panel>
          ) : null}

          <ContractNotice messages={messages} bodyKeys={['admin.contractGap.noDirectory']} />

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
