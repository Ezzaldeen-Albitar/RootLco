import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { requireSession } from '@/features/authentication/api/session';
import { readTenant } from '@/features/administration/organization/api';
import { TenantForm } from '@/features/administration/organization/components/TenantForm';
import {
  ContractNotice,
  Fact,
  Panel,
} from '@/features/administration/shared/components/ScreenStates';
import { PERMISSIONS, holds } from '@/features/administration/shared/permissions';
import { DIRECTION, LOCALES, isLocale } from '@/i18n/config';
import { getMessages, translate, type Messages } from '@/i18n/get-messages';

/**
 * Languages.
 *
 * Two different things live on this screen, and conflating them would be a lie:
 *
 * **What this application serves** — Arabic and English, from
 * `src/i18n/config.ts`, which is the single Frontend authority for locale and
 * direction. It is not configurable at runtime because a locale with no message
 * catalogue is a screen full of translation keys.
 *
 * **What the workspace defaults to** — `defaultLocale` on the tenant record,
 * writable through `PATCH /api/v1/org/tenant` and foreign-key constrained to
 * `shared.languages` server-side.
 *
 * `shared.languages` itself has no read operation (`P1-26-F-006`), so this
 * screen does not claim to manage the platform's language registry, and does not
 * validate the default against a list it does not have — the backend's "not a
 * registered platform value" verdict is the authority.
 */
export default async function LanguagesPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages: Messages = getMessages(locale);
  const t = (key: string) => translate(messages, key as keyof Messages);
  const tenant = await readTenant();

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="languages.title"
        descriptionKey="languages.description"
        crumbs={[
          { labelKey: 'nav.administration', href: `/${locale}/administration` },
          { labelKey: 'nav.languages' },
        ]}
      />
      <PageBody>
        <div className="flex flex-col gap-6">
          <ContractNotice
            messages={messages}
            bodyKeys={['admin.contractGap.noCatalogue', 'languages.required']}
          />

          <Panel title={t('languages.available')}>
            <dl className="grid gap-4 sm:grid-cols-2">
              {LOCALES.map((code) => (
                <Fact
                  key={code}
                  label={t(`locale.${code}`)}
                  value={t(
                    DIRECTION[code] === 'rtl' ? 'languages.direction.rtl' : 'languages.direction.ltr'
                  )}
                  hint={code}
                />
              ))}
            </dl>
          </Panel>

          <Panel title={t('languages.default')} description={t('languages.defaultHint')}>
            {tenant.status === 'ok' && tenant.data ? (
              <TenantForm
                messages={messages}
                tenant={tenant.data}
                canWrite={holds(session.permissions, PERMISSIONS.settingsManage)}
              />
            ) : (
              <p role="status" className="text-body text-text-secondary">
                {t(
                  tenant.status === 'denied'
                    ? 'state.denied.description'
                    : 'state.unavailable.description'
                )}
              </p>
            )}
          </Panel>
        </div>
      </PageBody>
    </>
  );
}
