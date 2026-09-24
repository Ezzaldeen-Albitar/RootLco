'use client';

import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { SearchPicker } from '@/components/search/SearchPicker';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { CursorPage, ReadState } from '@/lib/api/read-operation';
import { listUsers, type UserRow } from '../api';

/**
 * A person's sign-in account, found by name or email and chosen — never pasted
 * as an account reference (route sweep B3, Owner directive `P1-32-PRE-OD-UX`).
 *
 * ## Which read, and what it costs
 *
 * `iam.user-list` (`iam.user.read`), searched on the server by the free-text
 * `search` it publishes. The term is held in memory and never reaches the
 * address. `GET /auth/session` itself requires `iam.user.read`, so an operator
 * who could load an administration screen holds it; a caller who does not is
 * still given the labelled reference box they had before, by the screen that
 * renders this picker — the picker offers no search and says why.
 *
 * ## Every status is offered
 *
 * The typed box it replaces accepted any account of the tenant, and neither
 * caller's operation is limited to active accounts, so the picker offers every
 * status and says which ones are not active. Narrowing it here would take away
 * a choice the server accepts.
 */
export interface ChosenAccount {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly status: UserRow['status'];
}

/** The shortest box the picker sends. */
const MIN_ACCOUNT_SEARCH = 2;
/** The longest box `iam.user-list` accepts. */
const MAX_ACCOUNT_SEARCH = 120;

async function loadAccounts(
  term: string,
  cursor: string | null
): Promise<ReadState<CursorPage<ChosenAccount>>> {
  const page = await listUsers({ ...INITIAL_REQUEST, pageSize: 10, search: term }, cursor);
  if (page.status !== 'ok') return { status: page.status, correlationId: page.correlationId };
  return {
    status: 'ok',
    data: {
      items: page.rows.map((row) => ({
        id: row.id,
        displayName: row.displayName,
        email: row.email,
        status: row.status,
      })),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    },
    correlationId: page.correlationId,
  };
}

export function AccountPicker({
  messages,
  locale,
  label,
  value,
  onChange,
  canSearch,
  error,
  countsAsUnsaved,
  testId,
}: {
  readonly messages: Messages;
  readonly locale?: Locale | undefined;
  /** The question the caller asks — "Person", "Who". */
  readonly label: string;
  readonly value: ChosenAccount | null;
  readonly onChange: (next: ChosenAccount | null) => void;
  /** `iam.user.read`. */
  readonly canSearch: boolean;
  readonly error?: string | undefined;
  /** True in a form that writes; a list filter passes false. */
  readonly countsAsUnsaved: boolean;
  readonly testId: string;
}) {
  const labelOf = (account: ChosenAccount): string => {
    const name = account.email ? `${account.displayName} — ${account.email}` : account.displayName;
    return account.status === 'active'
      ? name
      : `${name} (${translateDynamic(messages, `users.status.${account.status}`)})`;
  };
  return (
    <SearchPicker<ChosenAccount>
      messages={messages}
      locale={locale}
      label={label}
      value={value}
      onChange={onChange}
      labelOf={labelOf}
      load={loadAccounts}
      canSearch={canSearch}
      notPermitted={translate(messages, 'users.picker.notPermitted')}
      error={error}
      minLength={MIN_ACCOUNT_SEARCH}
      maxLength={MAX_ACCOUNT_SEARCH}
      placeholder={translate(messages, 'users.picker.searchPlaceholder')}
      example={translate(messages, 'users.picker.searchExample')}
      tooShort={translate(messages, 'users.picker.tooShort')}
      resultsLabel={translate(messages, 'users.picker.results')}
      change={translate(messages, 'users.picker.change')}
      countsAsUnsaved={countsAsUnsaved}
      testId={testId}
    />
  );
}
