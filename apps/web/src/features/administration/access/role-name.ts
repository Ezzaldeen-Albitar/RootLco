import type { Messages } from '@/i18n/get-messages';
import { translateDynamic } from '@/i18n/get-messages';

/**
 * A role's name as a reader sees it (finance checkpoint, DF-B6).
 *
 * The roles every organisation is provisioned with are created with an English
 * name — "Tenant Administrator", "First Owner" (`apps/api/src/modules/iam/domain/
 * bootstrap-roles.ts`) — and the Arabic screens printed that English word. Their
 * CODES are stable and are never changed or shown; only the NAME is said in the
 * reader's language, through the catalogue (`roles.standard.<code>`).
 *
 * A standard role is re-worded only while it still carries the name it was
 * provisioned with. These roles are ordinary, editable rows (`is_system = false`),
 * so an organisation may rename one, and a name an administrator chose is that
 * organisation's own words: it is shown exactly as written, in every language.
 */
const PROVISIONED_NAMES: Readonly<Record<string, string>> = Object.freeze({
  first_owner: 'First Owner',
  tenant_administrator: 'Tenant Administrator',
});

export interface NamedRole {
  readonly roleCode: string;
  readonly name: string;
}

export function roleDisplayName(messages: Messages, role: NamedRole): string {
  if (PROVISIONED_NAMES[role.roleCode] !== role.name) return role.name;
  const key = `roles.standard.${role.roleCode}`;
  const worded = translateDynamic(messages, key);
  return worded === key ? role.name : worded;
}
