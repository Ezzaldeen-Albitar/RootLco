import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { TechnicianWorkspaceScreen } from '@/features/technicians/components/TechnicianWorkspaceScreen';
import { TECHNICIAN_WORKSPACE_PERMISSIONS } from '@/features/technicians/technicians-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * The technician's own workspace (P1-29, `W4`) — queue, clock, notes, evidence.
 *
 * ## The guard runs BEFORE any read
 *
 * `tech.technician.read` is tested and returned on here, and nothing is awaited
 * above it except the session that produces the permissions. That is the rule
 * `check-p1-29-access.mjs` enforces. The screen below issues no read of its
 * own until it holds a branch target, which is either the session's single
 * branch or one the technician names.
 *
 * ## Four more permissions are computed, and none of them gates the page
 *
 * Recording labour, correcting it, reading the job's log and evidence, and
 * capturing a document are separate authorities. They are resolved here and
 * passed down as capabilities so each panel can refuse on its own. A technician
 * who may see their queue but may not clock sees their queue.
 *
 * **These are affordances, never enforcement.** Every one is decided again by
 * the backend against the actual record, and the caller's own identity is
 * resolved by the adapter from the server on every write — this page passes
 * down no technician id, because it has none to pass.
 */
export default async function TechnicianWorkspacePage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  // One crumb, as the work-order board has: the workspace IS the Technicians
  // entry today — `/technicians` has no page of its own to lead back to, and a
  // crumb with no route is a promise the shell test refuses.
  const crumbs = [{ labelKey: 'nav.technicians' }];

  if (!holds(session.permissions, TECHNICIAN_WORKSPACE_PERMISSIONS.queue)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="technicians.workspace.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="technicians.workspace.title"
        descriptionKey="technicians.workspace.description"
        crumbs={crumbs}
      />
      <PageBody>
        <TechnicianWorkspaceScreen
          locale={locale}
          messages={messages}
          companyIds={session.companyIds}
          branchIds={session.branchIds}
          capabilities={{
            canRecordLabor: holds(session.permissions, TECHNICIAN_WORKSPACE_PERMISSIONS.labor),
            canCorrectLabor: holds(
              session.permissions,
              TECHNICIAN_WORKSPACE_PERMISSIONS.laborCorrect
            ),
            canReadWork: holds(session.permissions, TECHNICIAN_WORKSPACE_PERMISSIONS.workRead),
            canCaptureDocuments: holds(
              session.permissions,
              TECHNICIAN_WORKSPACE_PERMISSIONS.documentManage
            ),
          }}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('technicians.workspace.title');
