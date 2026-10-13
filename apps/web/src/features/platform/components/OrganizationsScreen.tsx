'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import Button from '@mui/material/Button';
import {
  OperationalGrid,
  TwoLineCell,
  type OperationalColumn,
} from '@/components/data/OperationalGrid';
import {
  withFilter,
  withSearch,
  withoutFilter,
  type FilterDefinition,
} from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translateDynamic } from '@/i18n/get-messages';
import { formatDate, formatInteger } from '@/lib/format';
import { listOrganizations } from '../table-reads';
import { ORGANIZATION_STATUSES, type OrganizationRow } from '../types';
import { StatusBadge } from './ui';

/**
 * The organisation list (P1-32-PRE-065).
 *
 * The search term is applied when the operator submits it, not on every
 * keystroke: each read is an `expensive-read` against the control plane. It is
 * held in component state and sent to the server; it never enters the address
 * bar. Paging follows the server's cursor.
 *
 * ## On Material UI (ADR-022)
 *
 * The list is the operational grid over the same read: one page at a time, by
 * the server's cursor, with the status filter and the search term carried in
 * the table request exactly as before. Nothing about what is asked of the
 * server changed with the renderer.
 *
 * A name, a code and a plan code are each drawn in the grid's own line cell: a
 * line longer than its column ends in an ellipsis and carries its whole text,
 * so neither a long name nor a long code is cut without a sign. The plan is
 * shown by its code because the list read names no plan — the code is the only
 * word the read has for it.
 */

const STATUS_FILTER: readonly FilterDefinition[] = [
  {
    key: 'status',
    labelKey: 'platform.organizations.column.status',
    options: ORGANIZATION_STATUSES.map((status) => ({
      value: status,
      labelKey: `platform.status.${status}`,
    })),
  },
];

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

  const columns = useMemo<readonly OperationalColumn<OrganizationRow>[]>(
    () => [
      {
        id: 'name',
        headerKey: 'platform.organizations.column.name',
        flex: 2,
        cell: (row) => (
          <TwoLineCell
            primary={
              <Link
                href={`/${locale}/platform/organizations/${row.id}`}
                className="font-medium text-text-primary underline-offset-2 hover:underline"
              >
                <bdi>{row.displayName}</bdi>
              </Link>
            }
            primaryTitle={row.displayName}
            testId="platform-organization-name"
          />
        ),
      },
      {
        id: 'code',
        headerKey: 'platform.organizations.column.code',
        cell: (row) => (
          <TwoLineCell
            primary={
              <code dir="ltr" className="font-mono">
                {row.tenantCode}
              </code>
            }
            testId="platform-organization-code"
          />
        ),
      },
      {
        id: 'status',
        headerKey: 'platform.organizations.column.status',
        cell: (row) => <StatusBadge status={row.status} messages={messages} />,
      },
      {
        id: 'plan',
        headerKey: 'platform.organizations.column.plan',
        cell: (row) =>
          row.activePlanCode === null ? (
            <span className="text-text-secondary">
              {translateDynamic(messages, 'platform.organizations.noPlan')}
            </span>
          ) : (
            <TwoLineCell
              primary={
                <code dir="ltr" className="font-mono">
                  {row.activePlanCode}
                </code>
              }
            />
          ),
      },
      {
        id: 'ends',
        headerKey: 'platform.organizations.column.ends',
        minChars: 14,
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
    ],
    [locale, messages]
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <form
          role="search"
          noValidate
          className="flex flex-wrap items-start gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            table.setRequest(withSearch(table.request, term.trim()));
          }}
        >
          <div className="w-full max-w-sm">
            <FormTextField
              name="q"
              type="search"
              label={t('platform.organizations.search')}
              description={t('platform.organizations.searchHint')}
              value={term}
              maxLength={100}
              onChange={setTerm}
            />
          </div>
          <Button type="submit" variant="contained">
            {t('platform.organizations.searchSubmit')}
          </Button>
          <div className="w-48">
            <FormSelectField
              label={t('platform.organizations.column.status')}
              value={statusFilter ?? ''}
              placeholder={t('platform.organizations.allStatuses')}
              onChange={(chosen) => {
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
          <Button
            component={Link}
            href={`/${locale}/platform/organizations/new`}
            variant="contained"
          >
            {t('platform.organizations.new')}
          </Button>
        ) : null}
      </div>

      <OperationalGrid<OrganizationRow>
        messages={messages}
        locale={locale}
        label={t('platform.organizations.title')}
        columns={columns}
        rowId={(row) => row.id}
        table={table}
        filterDefinitions={STATUS_FILTER}
        testId="platform-organizations-grid"
      />
    </div>
  );
}
