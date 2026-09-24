'use client';

import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { SearchPicker } from '@/components/search/SearchPicker';
import { listUsers, type UserRow } from '@/features/administration/users/api';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import type { CursorPage, ReadState } from '@/lib/api/read-operation';

/**
 * The colleague who asked for a discount, found by name and chosen — never typed
 * as an account reference (Owner directive, `P1-32-PRE-OD-UX`).
 *
 * ## Which read, and why this one
 *
 * `discountRequestedBy` names a platform ACCOUNT: the discount check refuses a
 * requester who is not an active account of this tenant, so a staff or
 * technician register would offer people the write cannot accept. The one read
 * that names accounts is `iam.user-list`, and it costs `iam.user.read` — the code
 * `GET /auth/session` already requires, so every operator who can load this
 * screen holds it and the picker widens nobody's access
 * (`features/receptions/people/user-directory.ts` records the disposition). The
 * reception and appointment surfaces are barred from it because they were moved
 * to a narrower BRANCH read of their own; no such read names the accounts a
 * discount may be attributed to.
 *
 * Only ACTIVE accounts are offered, because only an active one is accepted. The
 * label is the display name; the address is shown beside it only so two people
 * with one name can be told apart.
 */
export interface ChosenRequester {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
}

/** The shortest box the picker sends; the read would accept one character. */
const MIN_REQUESTER_SEARCH = 2;
/** The longest box `iam.user-list` accepts. */
const MAX_REQUESTER_SEARCH = 120;

function requesterLabel(user: ChosenRequester): string {
  return user.email ? `${user.displayName} — ${user.email}` : user.displayName;
}

async function loadRequesters(
  term: string,
  cursor: string | null
): Promise<ReadState<CursorPage<ChosenRequester>>> {
  const page = await listUsers(
    {
      ...INITIAL_REQUEST,
      pageSize: 10,
      search: term,
      filters: [{ key: 'status', value: 'active' }],
    },
    cursor
  );
  if (page.status !== 'ok') return { status: page.status, correlationId: page.correlationId };
  return {
    status: 'ok',
    data: {
      items: page.rows.map((row: UserRow) => ({
        id: row.id,
        displayName: row.displayName,
        email: row.email,
      })),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    },
    correlationId: page.correlationId,
  };
}

export function RequesterPicker({
  messages,
  locale,
  value,
  onChange,
  canSearch,
  error,
  testId = 'requester-picker',
}: {
  readonly messages: Messages;
  readonly locale?: Locale | undefined;
  readonly value: ChosenRequester | null;
  readonly onChange: (next: ChosenRequester | null) => void;
  /** `iam.user.read`. */
  readonly canSearch: boolean;
  readonly error?: string | undefined;
  readonly testId?: string;
}) {
  return (
    <SearchPicker<ChosenRequester>
      messages={messages}
      locale={locale}
      label={translate(messages, 'quotations.build.requestedBy')}
      value={value}
      onChange={onChange}
      labelOf={requesterLabel}
      load={loadRequesters}
      canSearch={canSearch}
      notPermitted={translate(messages, 'quotations.requester.notPermitted')}
      error={error}
      minLength={MIN_REQUESTER_SEARCH}
      maxLength={MAX_REQUESTER_SEARCH}
      placeholder={translate(messages, 'quotations.requester.searchPlaceholder')}
      example={translate(messages, 'quotations.requester.searchExample')}
      tooShort={translate(messages, 'quotations.requester.tooShort')}
      resultsLabel={translate(messages, 'quotations.requester.results')}
      change={translate(messages, 'quotations.requester.change')}
      testId={testId}
    />
  );
}
