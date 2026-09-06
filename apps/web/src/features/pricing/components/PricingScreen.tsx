'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';

import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { TextAreaField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import type { ActionState } from '@/lib/forms/action-result';
import { formatMoney } from '@/lib/money';

import { createPriceList, listPriceLists, resolvePrice } from '../api';
import {
  CURRENCY_CODE,
  EXTERNAL_CODE,
  INTERNAL_CODE,
  ISO_DATE,
  LIST_BOUND,
  MAX_DESCRIPTION,
  MAX_NAME,
  type PriceListSummary,
  type ResolvedPrice,
} from '../pricing-contract';
import {
  ActivationBadge,
  BranchPairPicker,
  EMPTY_PAIR,
  Figure,
  OutcomeNote,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  ServicePicker,
  UUID,
  useBranches,
  type BranchPair,
} from './shared';

/**
 * Price lists (P1-30, `W2`, FE-002) and the price lookup (FE-006).
 *
 * ## Bounded, and it says so
 *
 * `svc.price-list-list` answers at most one hundred rows and has no cursor, so
 * the table has no next page and the screen states the bound instead of
 * inventing a total. A workshop with more lists than that is a design question
 * for the wave that meets it, not something to hide.
 *
 * ## The resolved price is the server's
 *
 * The lookup sends a service, a branch (with its company), an optional
 * customer class and an optional date, and renders what came back:
 * `unitPrice` through `formatMoney`, `taxRate` as the fraction string the
 * server stated, `taxClassCode` as given. Nothing is added, multiplied or
 * rounded on this screen; a lookup that resolves nothing renders as that
 * refusal, never as a zero.
 */

export function PricingScreen({
  locale,
  messages,
  canManage,
  canReadBranches,
  canReadServices,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** `svc.price.manage` — decides whether the create form is offered. */
  readonly canManage: boolean;
  /** `org.branch.read` — decides whether a branch list is even requested. */
  readonly canReadBranches: boolean;
  /** `svc.service.read` — decides whether a service can be found by code. */
  readonly canReadServices: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const branches = useBranches(canReadBranches);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {canManage ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={SECONDARY_BUTTON}
            aria-expanded={creating}
            onClick={() => setCreating((open) => !open)}
          >
            {translate(messages, 'pricing.list.create')}
          </button>
        </div>
      ) : null}

      {canManage && creating ? (
        <CreateListForm locale={locale} messages={messages} onClose={() => setCreating(false)} />
      ) : null}

      <PriceListsResults locale={locale} messages={messages} />

      <PriceLookupPanel
        locale={locale}
        messages={messages}
        branches={branches}
        canReadServices={canReadServices}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The lists
 * ------------------------------------------------------------------ */

function PriceListsResults({
  locale,
  messages,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
}) {
  const load = useCallback(() => listPriceLists(), []);
  const table = useServerTable<PriceListSummary>(load, { initial: INITIAL_REQUEST });

  const columns = useMemo<readonly Column<PriceListSummary>[]>(
    () => [
      {
        id: 'priceListCode',
        headerKey: 'pricing.list.column.code',
        cell: (row) => (
          <Link
            href={`/${locale}/pricing/${row.id}`}
            className="font-mono text-caption text-primary underline-offset-2 hover:underline"
            dir="ltr"
          >
            {row.priceListCode}
          </Link>
        ),
      },
      {
        id: 'name',
        headerKey: 'pricing.list.column.name',
        cell: (row) => <bdi>{row.name}</bdi>,
      },
      {
        id: 'currency',
        headerKey: 'pricing.list.column.currency',
        cell: (row) => (
          <code className="font-mono text-caption" dir="ltr">
            {row.currency}
          </code>
        ),
      },
      {
        id: 'status',
        headerKey: 'pricing.list.column.status',
        cell: (row) => <ActivationBadge messages={messages} status={row.status} />,
      },
    ],
    [locale, messages]
  );

  return (
    <section aria-labelledby="price-lists-heading" className="flex min-h-0 flex-col gap-2">
      <h2 id="price-lists-heading" className="sr-only">
        {translate(messages, 'pricing.list.resultsHeading')}
      </h2>
      <DataTable<PriceListSummary>
        messages={messages}
        columns={columns}
        rowId={(row) => row.id}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={table.setRequest}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={translate(messages, 'pricing.list.caption')}
        suppressEmptyState
      />
      {table.response && table.response.rows.length === 0 ? (
        <p className="py-6 text-center text-body text-text-secondary" lang={locale}>
          {translate(messages, 'pricing.list.none')}
        </p>
      ) : null}
      {table.response && table.response.rows.length >= LIST_BOUND ? (
        <p className="text-caption text-text-muted" lang={locale}>
          {translate(messages, 'pricing.list.bound')}
        </p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Creating a list
 * ------------------------------------------------------------------ */

function CreateListForm({
  locale,
  messages,
  onClose,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState({ priceListCode: '', name: '', currency: '', description: '' });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    const priceListCode = form.priceListCode.trim();
    if (priceListCode.length === 0) found['priceListCode'] = 'field.required';
    else if (!EXTERNAL_CODE.test(priceListCode))
      found['priceListCode'] = 'pricing.create.codeFormat';
    const name = form.name.trim();
    if (name.length === 0) found['name'] = 'field.required';
    else if (name.length > MAX_NAME) found['name'] = 'pricing.create.nameTooLong';
    const currency = form.currency.trim();
    if (currency.length === 0) found['currency'] = 'field.required';
    else if (!CURRENCY_CODE.test(currency)) found['currency'] = 'pricing.create.currencyFormat';
    const description = form.description.trim();
    if (description.length > MAX_DESCRIPTION) {
      found['description'] = 'pricing.create.descriptionTooLong';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await createPriceList({
      priceListCode,
      name,
      currency,
      ...(description ? { description } : {}),
    });
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      router.push(`/${locale}/pricing/${result.created.id}`);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="price-list-create-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="price-list-create-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'pricing.create.title')}
      </h2>
      <TextField
        label={translate(messages, 'pricing.create.code')}
        description={translate(messages, 'pricing.create.codeHelp')}
        required
        spellCheck={false}
        dir="ltr"
        value={form.priceListCode}
        onChange={(event) => setForm((f) => ({ ...f, priceListCode: event.target.value }))}
        error={errorFor('priceListCode')}
      />
      <TextField
        label={translate(messages, 'pricing.create.name')}
        required
        value={form.name}
        onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
        error={errorFor('name')}
      />
      <TextField
        label={translate(messages, 'pricing.create.currency')}
        description={translate(messages, 'pricing.create.currencyHelp')}
        required
        spellCheck={false}
        dir="ltr"
        value={form.currency}
        onChange={(event) => setForm((f) => ({ ...f, currency: event.target.value }))}
        error={errorFor('currency')}
      />
      <TextAreaField
        label={translate(messages, 'pricing.create.description')}
        value={form.description}
        onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
        error={errorFor('description')}
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'pricing.create.submit')}
        </button>
        <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
          {translate(messages, 'pricing.create.cancel')}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * The lookup — FE-006
 * ------------------------------------------------------------------ */

export function PriceLookupPanel({
  locale,
  messages,
  branches,
  canReadServices,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly branches: ReturnType<typeof useBranches>;
  readonly canReadServices: boolean;
}) {
  const [serviceId, setServiceId] = useState('');
  const [pair, setPair] = useState<BranchPair>(EMPTY_PAIR);
  const [customerClass, setCustomerClass] = useState('');
  const [asOf, setAsOf] = useState('');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<ReadState<ResolvedPrice> | null>(null);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    const service = serviceId.trim();
    if (!UUID.test(service)) found['serviceId'] = 'pricing.common.idFormat';
    const companyId = pair.companyId.trim();
    const branchId = pair.branchId.trim();
    if (!UUID.test(companyId)) found['companyId'] = 'pricing.common.idFormat';
    if (!UUID.test(branchId)) found['branchId'] = 'pricing.common.idFormat';
    const klass = customerClass.trim();
    if (klass.length > 0 && !INTERNAL_CODE.test(klass)) {
      found['customerClass'] = 'pricing.common.classFormat';
    }
    const date = asOf.trim();
    if (date.length > 0 && !ISO_DATE.test(date)) found['asOf'] = 'pricing.common.dateFormat';
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const state = await resolvePrice({
      serviceId: service,
      companyId,
      branchId,
      ...(klass ? { customerClass: klass } : {}),
      ...(date ? { asOf: date } : {}),
    });
    setBusy(false);
    setAnswer(state);
  };

  return (
    <section
      aria-labelledby="price-lookup-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="price-lookup-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'pricing.lookup.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'pricing.lookup.explain')}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        noValidate
        aria-labelledby="price-lookup-heading"
        className="grid gap-3 sm:grid-cols-2"
      >
        <div className="sm:col-span-2">
          <ServicePicker
            messages={messages}
            canRead={canReadServices}
            label={translate(messages, 'pricing.lookup.service')}
            value={serviceId}
            onChange={setServiceId}
            error={errorFor('serviceId')}
          />
        </div>
        <BranchPairPicker
          messages={messages}
          branches={branches}
          label={translate(messages, 'pricing.lookup.branch')}
          placeholder={translate(messages, 'pricing.lookup.chooseBranch')}
          required
          value={pair}
          onChange={setPair}
          errors={{ companyId: errorFor('companyId'), branchId: errorFor('branchId') }}
        />
        <TextField
          label={translate(messages, 'pricing.lookup.customerClass')}
          description={translate(messages, 'pricing.common.classHelp')}
          spellCheck={false}
          dir="ltr"
          value={customerClass}
          onChange={(event) => setCustomerClass(event.target.value)}
          error={errorFor('customerClass')}
        />
        <TextField
          label={translate(messages, 'pricing.lookup.asOf')}
          description={translate(messages, 'pricing.lookup.asOfHelp')}
          type="date"
          dir="ltr"
          value={asOf}
          onChange={(event) => setAsOf(event.target.value)}
          error={errorFor('asOf')}
        />
        <div className="sm:col-span-2">
          <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
            {translate(messages, 'pricing.lookup.submit')}
          </button>
        </div>
      </form>
      {answer ? <ResolvedPriceView locale={locale} messages={messages} answer={answer} /> : null}
    </section>
  );
}

function ResolvedPriceView({
  locale,
  messages,
  answer,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly answer: ReadState<ResolvedPrice>;
}) {
  if (answer.status !== 'ok') {
    const key =
      answer.status === 'denied'
        ? 'pricing.lookup.refused'
        : answer.status === 'expired'
          ? 'state.expired.title'
          : 'pricing.lookup.failed';
    return (
      <p role="alert" className="text-body text-error">
        {translateDynamic(messages, key)}
        {answer.correlationId ? (
          <>
            {' '}
            <span className="text-caption text-text-muted">
              {translate(messages, 'state.correlationId')}{' '}
              <code className="font-mono" dir="ltr">
                {answer.correlationId}
              </code>
            </span>
          </>
        ) : null}
      </p>
    );
  }
  const price = answer.data;
  return (
    <section
      aria-labelledby="price-lookup-result-heading"
      className="flex flex-col gap-2 border-t border-border pt-3"
    >
      <h3 id="price-lookup-result-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'pricing.lookup.resultHeading')}
      </h3>
      <dl className="grid gap-3 sm:grid-cols-3">
        <Figure label={translate(messages, 'pricing.lookup.unitPrice')}>
          <span className="font-mono" dir="ltr">
            {formatMoney({ amount: price.unitPrice, currency: price.currency }, locale)}
          </span>
        </Figure>
        <Figure label={translate(messages, 'pricing.lookup.taxRate')}>
          <code className="font-mono" dir="ltr">
            {price.taxRate}
          </code>
          <span className="block text-caption text-text-muted">
            {translate(messages, 'pricing.lookup.taxRateHelp')}
          </span>
        </Figure>
        <Figure label={translate(messages, 'pricing.lookup.taxClass')}>
          {price.taxClassCode ? (
            <code className="font-mono" dir="ltr">
              {price.taxClassCode}
            </code>
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'pricing.lookup.noTaxClass')}
            </span>
          )}
        </Figure>
        <Figure label={translate(messages, 'pricing.lookup.asOfResult')}>
          <code className="font-mono" dir="ltr">
            {price.asOf}
          </code>
        </Figure>
        <Figure label={translate(messages, 'pricing.lookup.rule')} wide>
          <code className="font-mono text-caption" dir="ltr">
            {price.priceRuleId}
          </code>
        </Figure>
      </dl>
    </section>
  );
}
