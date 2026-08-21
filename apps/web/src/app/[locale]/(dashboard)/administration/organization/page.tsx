import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { requireSession } from '@/features/authentication/api/session';
import { readTenant } from '@/features/administration/organization/api';
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

  const tenant = await readTenant();
  const canWriteSettings = holds(session.permissions, PERMISSIONS.settingsManage);

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
          <ContractNotice messages={messages} bodyKeys={['admin.contractGap.noDirectory']} />

          <Panel title={t('organization.tenant')}>
            <ReadBoundary state={toReadState(tenant)} messages={messages}>
              {(view) => (
                <TenantForm messages={messages} tenant={view} canWrite={canWriteSettings} />
              )}
            </ReadBoundary>
          </Panel>

          {holds(session.permissions, PERMISSIONS.companyRead) ? (
            <Panel title={t('organization.settings.company')}>
              <SettingsEditor
                messages={messages}
                scope="company"
                scopeIds={session.companyIds}
                canWrite={canWriteSettings}
                keyPrefix=""
              />
            </Panel>
          ) : null}

          {holds(session.permissions, PERMISSIONS.branchRead) ? (
            <Panel title={t('organization.settings.branch')}>
              <SettingsEditor
                messages={messages}
                scope="branch"
                scopeIds={session.branchIds}
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
