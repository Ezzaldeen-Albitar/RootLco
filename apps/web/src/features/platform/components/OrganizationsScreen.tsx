'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import {
  withFilter,
  withSearch,
  withoutFilter,
  type TableRequest,
} from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { SelectField, TextField } from '@/components/forms/Field';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translateDynamic } from '@/i18n/get-messages';
import { formatDate, formatInteger } from '@/lib/format';
import { listOrganizations } from '../api';
import { ORGANIZATION_STATUSES, type OrganizationRow } from '../types';
import { PRIMARY_BUTTON, StatusBadge } from './ui';

/**
 * The organisation list (P1-32-PRE-065).
 *
 * The search term is applied when the operator submits it, not on every
 * keystroke: each read is an `expensive-read` against the control plane. It is
 * held in component state and sent to the server; it never enters the address
 * bar. Paging follows the server's cursor.
 */
export function OrganizationsScreen({
  locale,
  messages,
  canProvision,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly canProvision: boolean;
}) {
  const table = useServerTable<OrganizationRow>(listOrganizations);
  const [term, setTerm] = useState('');
  const t = (key: string) => translateDynamic(messages, key);
  const statusFilter = table.request.filters.find((filter) => filter.key === 'status')?.value;

  const columns: readonly Column<OrganizationRow>[] = [
    {
      id: 'name',
      headerKey: 'platform.organizations.column.name',
      cell: (row) => (
        <Link
          href={`/${locale}/platform/organizations/${row.id}`}
          className="font-medium text-text-primary underline-offset-2 hover:underline"
        >
          {row.displayName}
        </Link>
      ),
    },
    {
      id: 'code',
      headerKey: 'platform.organizations.column.code',
      cell: (row) => <span dir="ltr">{row.tenantCode}</span>,
    },
    {
      id: 'status',
      headerKey: 'platform.organizations.column.status',
      cell: (row) => <StatusBadge status={row.status} messages={messages} />,
    },
    {
      id: 'plan',
      headerKey: 'platform.organizations.column.plan',
      cell: (row) => row.activePlanCode ?? t('platform.organizations.noPlan'),
    },
    {
      id: 'ends',
      headerKey: 'platform.organizations.column.ends',
      cell: (row) =>
        row.activePlanEffectiveTo ? formatDate(row.activePlanEffectiveTo, locale) : '—',
    },
    {
      id: 'companies',
      headerKey: 'platform.organizations.column.companies',
      numeric: true,
      cell: (row) => formatInteger(row.activeCompanyCount, locale),
    },
    {
      id: 'branches',
      headerKey: 'platform.organizations.column.branches',
      numeric: true,
      cell: (row) => formatInteger(row.activeBranchCount, locale),
    },
    {
      id: 'users',
      headerKey: 'platform.organizations.column.users',
      numeric: true,
      cell: (row) => formatInteger(row.activeUserCount, locale),
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form
          role="search"
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            table.setRequest(withSearch(table.request, term.trim()));
          }}
        >
          <div className="w-full max-w-sm">
            <TextField
              name="q"
              type="search"
              label={t('platform.organizations.search')}
              description={t('platform.organizations.searchHint')}
              value={term}
              maxLength={100}
              onChange={(event) => setTerm(event.target.value)}
            />
          </div>
          <button type="submit" className={PRIMARY_BUTTON}>
            {t('platform.organizations.searchSubmit')}
          </button>
          <div className="w-48">
            <SelectField
              label={t('platform.organizations.column.status')}
              value={statusFilter ?? ''}
              placeholder={t('platform.organizations.allStatuses')}
              onChange={(event) => {
                const chosen = event.target.value;
                const cleared = statusFilter
                  ? withoutFilter(table.request, { key: 'status', value: statusFilter })
                  : table.request;
                table.setRequest(
                  chosen ? withFilter(cleared, { key: 'status', value: chosen }) : cleared
                );
              }}
              options={ORGANIZATION_STATUSES.map((status) => ({
                value: status,
                label: t(`platform.status.${status}`),
              }))}
            />
          </div>
        </form>
        {canProvision ? (
          <Link href={`/${locale}/platform/organizations/new`} className={PRIMARY_BUTTON}>
            {t('platform.organizations.new')}
          </Link>
        ) : null}
      </div>

      <DataTable<OrganizationRow>
        messages={messages}
        columns={columns}
        rowId={(row) => row.id}
        request={table.request}
        response={table.response}
        status={table.status}
        filterDefinitions={[
          {
            key: 'status',
            labelKey: 'platform.organizations.column.status',
            options: ORGANIZATION_STATUSES.map((status) => ({
              value: status,
              labelKey: `platform.status.${status}`,
            })),
          },
        ]}
        onRequestChange={(next: TableRequest) => table.setRequest(next)}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={t('platform.organizations.title')}
      />
    </div>
  );
}
