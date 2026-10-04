'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useRef, useState } from 'react';
import Button from '@mui/material/Button';

import { OperationalGrid, type OperationalColumn } from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { useServerTable, type ServerTable } from '@/components/data-table/use-server-table';
import { DateField, type DayProblem } from '@/components/forms/mui/DateField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import {
  MuiEmptyState,
  MuiErrorState,
  MuiExpiredState,
  MuiLoadingState,
  MuiRefusedState,
  MuiUnavailableState,
} from '@/components/states/MuiStates';
import { useBranchTarget } from '@/features/working-context/use-branch-target';
import {
  useUnsavedGuard,
  useWorkingContextChange,
} from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import type { ActionState } from '@/lib/forms/action-result';
import { useLocalRefusal } from '@/lib/forms/use-local-refusal';
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
  ServicePicker,
  UUID,
  canNameBranch,
  useBranches,
  type BranchPair,
} from './shared';

/**
 * Price lists (P1-30, `W2`, FE-002) and the price lookup (FE-006). On the
 * shared Material UI wrappers since `P1-32-PRE-OD-MUISP` (ADR-022).
 *
 * ## Bounded, and it says so
 *
 * `svc.price-list-list` answers at most one hundred rows and has no cursor and
 * no filter, so the grid (`OperationalGrid` over `useServerTable`) is told the
 * read honours neither a page size nor a sort — it offers no control that would
 * do nothing — its Next is never offered, and the screen states the bound
 * instead of inventing a total. There is nothing to search by, so there is no
 * filter toolbar.
 *
 * ## The resolved price is the server's
 *
 * The lookup sends a service, a branch (with its company), an optional
 * customer class and an optional date, and renders what came back:
 * `unitPrice` through `formatMoney`, `taxRate` as the fraction string the
 * server stated, `taxClassCode` as given. Nothing is added, multiplied or
 * rounded on this screen; a lookup that resolves nothing renders as that
 * refusal, never as a zero, and a throttled or unanswered lookup is
 * "unavailable, try again". The rule that applied is not printed: it has no
 * name, and its identifier would be a string to look up, not an answer.
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
          <Button
            type="button"
            variant="outlined"
            aria-expanded={creating}
            onClick={() => setCreating((open) => !open)}
          >
            {translate(messages, 'pricing.list.create')}
          </Button>
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
  const read = useServerTable<PriceListSummary>(load, { initial: INITIAL_REQUEST });
  // One bounded answer: no page size and no sort reach the read.
  const table: ServerTable<PriceListSummary> = {
    ...read,
    honours: { pageSize: false, sort: false },
  };

  const columns = useMemo<readonly OperationalColumn<PriceListSummary>[]>(
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
        flex: 1.4,
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

  const rows = table.response?.rows ?? [];

  return (
    <section aria-labelledby="price-lists-heading" className="flex min-h-0 flex-col gap-2">
      <h2 id="price-lists-heading" className="sr-only">
        {translate(messages, 'pricing.list.resultsHeading')}
      </h2>
      {table.status === 'idle' && table.response !== null && rows.length === 0 ? (
        <MuiEmptyState
          messages={messages}
          descriptionKey="pricing.list.none"
          testId="price-lists-empty"
        />
      ) : (
        <OperationalGrid<PriceListSummary>
          messages={messages}
          locale={locale}
          label={translate(messages, 'pricing.list.caption')}
          columns={columns}
          rowId={(row) => row.id}
          table={table}
          suppressEmptyState
          testId="price-lists-grid"
        />
      )}
      {rows.length >= LIST_BOUND ? (
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

const EMPTY_LIST = { priceListCode: '', name: '', currency: '', description: '' };

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
  const [form, setForm] = useState(EMPTY_LIST);
  const { errorKey, formRef, refuse } = useLocalRefusal(form);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  // Typed and not created is unsaved work: leaving or a branch switch asks.
  const dirty = Object.values(form).some((field) => field.trim().length > 0);
  useUnsavedGuard(dirty, () => {
    setForm(EMPTY_LIST);
    setOutcome(null);
  });

  const errorFor = (name: string): string | undefined => {
    const key = errorKey(name) ?? outcome?.fieldErrors?.[name];
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
    refuse(found);
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
      // Stored: nothing is unsaved any more.
      setForm(EMPTY_LIST);
      router.push(`/${locale}/pricing/${result.created.id}`);
    }
  };

  const set = (field: keyof typeof EMPTY_LIST) => (value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="price-list-create-heading"
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="price-list-create-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'pricing.create.title')}
      </h2>
      <FormTextField
        label={translate(messages, 'pricing.create.code')}
        description={translate(messages, 'pricing.create.codeHelp')}
        required
        dir="ltr"
        autoComplete="off"
        value={form.priceListCode}
        onChange={set('priceListCode')}
        error={errorFor('priceListCode')}
      />
      <FormTextField
        label={translate(messages, 'pricing.create.name')}
        required
        value={form.name}
        onChange={set('name')}
        error={errorFor('name')}
      />
      <FormTextField
        label={translate(messages, 'pricing.create.currency')}
        description={translate(messages, 'pricing.create.currencyHelp')}
        required
        dir="ltr"
        autoComplete="off"
        maxLength={3}
        value={form.currency}
        onChange={set('currency')}
        error={errorFor('currency')}
      />
      <FormTextField
        label={translate(messages, 'pricing.create.description')}
        multiline
        rows={3}
        value={form.description}
        onChange={set('description')}
        error={errorFor('description')}
      />
      <OutcomeNote messages={messages} outcome={outcome} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="contained" disabled={busy}>
          {translate(messages, 'pricing.create.submit')}
        </Button>
        <Button type="button" variant="outlined" onClick={onClose}>
          {translate(messages, 'pricing.create.cancel')}
        </Button>
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
  /*
   * The branch starts at the one the operator is working in.
   *
   * A price is resolved FOR a branch, and the form used to open empty and wait
   * to be told which — from two free-text boxes. The picker beside it is there
   * to change that choice rather than to make it (Owner directive,
   * `P1-32-PRE-OD-UX`).
   */
  const working = useBranchTarget();
  const workingPair = (): BranchPair =>
    working.kind === 'ready'
      ? { companyId: working.target.companyId, branchId: working.target.branchId }
      : EMPTY_PAIR;
  const [pair, setPair] = useState<BranchPair>(workingPair);
  const [customerClass, setCustomerClass] = useState('');
  const [asOf, setAsOf] = useState('');
  // A day only partly typed reads as `''`; it is refused rather than dropped.
  const [asOfUnfinished, setAsOfUnfinished] = useState(false);
  const { errorKey, formRef, refuse } = useLocalRefusal({
    serviceId,
    companyId: pair.companyId,
    branchId: pair.branchId,
    customerClass,
    asOf: `${asOf}|${asOfUnfinished}`,
  });
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<ReadState<ResolvedPrice> | null>(null);
  // Which lookup is current. A reply to any other is dropped when it lands.
  const lookup = useRef(0);

  /*
   * The branch FOLLOWS the header, not just its first value.
   *
   * Seeded once, the lookup went on naming the previous branch after a switch —
   * the header said one workshop and the form priced for another. On every
   * change the branch is reset to the new working branch (or cleared, when the
   * selection is not one branch), the answer about the old one is removed, and
   * a lookup still in flight is superseded so its reply cannot land under the
   * new heading.
   */
  useWorkingContextChange(() => {
    lookup.current += 1;
    setPair(workingPair());
    setAnswer(null);
    setBusy(false);
  });

  const errorFor = (name: string): string | undefined => {
    const key = errorKey(name);
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    const service = serviceId.trim();
    if (canReadServices) {
      if (service.length === 0) found['serviceId'] = 'pricing.picker.serviceRequired';
      else if (!UUID.test(service)) found['serviceId'] = 'pricing.common.idFormat';
    } else if (!UUID.test(service)) {
      found['serviceId'] = 'pricing.picker.serviceReferenceFormat';
    }
    const companyId = pair.companyId.trim();
    const branchId = pair.branchId.trim();
    // Chosen from the platform's own named list, so the only rule left is that
    // one was chosen at all.
    if (companyId.length === 0) found['companyId'] = 'field.required';
    if (branchId.length === 0) found['branchId'] = 'field.required';
    const klass = customerClass.trim();
    if (klass.length > 0 && !INTERNAL_CODE.test(klass)) {
      found['customerClass'] = 'pricing.common.classFormat';
    }
    const date = asOf.trim();
    if (asOfUnfinished || (date.length > 0 && !ISO_DATE.test(date))) {
      found['asOf'] = 'pricing.common.dateFormat';
    }
    refuse(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    lookup.current += 1;
    const mine = lookup.current;
    const state = await resolvePrice({
      serviceId: service,
      companyId,
      branchId,
      ...(klass ? { customerClass: klass } : {}),
      ...(date ? { asOf: date } : {}),
    });
    if (mine !== lookup.current) return;
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
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        noValidate
        aria-labelledby="price-lookup-heading"
        className="grid gap-4 sm:grid-cols-2"
      >
        <div className="sm:col-span-2">
          <ServicePicker
            messages={messages}
            locale={locale}
            canRead={canReadServices}
            label={translate(messages, 'pricing.lookup.service')}
            value={serviceId}
            onChange={setServiceId}
            error={errorFor('serviceId')}
            testId="price-lookup-service"
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
        <FormTextField
          label={translate(messages, 'pricing.lookup.customerClass')}
          description={translate(messages, 'pricing.common.classHelp')}
          dir="ltr"
          autoComplete="off"
          value={customerClass}
          onChange={setCustomerClass}
          error={errorFor('customerClass')}
        />
        <DateField
          label={translate(messages, 'pricing.lookup.asOf')}
          description={translate(messages, 'pricing.lookup.asOfHelp')}
          value={asOf}
          onChange={setAsOf}
          onProblem={(problem: DayProblem) => setAsOfUnfinished(problem !== null)}
          error={errorFor('asOf')}
          testId="price-lookup-as-of"
        />
        <div className="sm:col-span-2">
          <Button type="submit" variant="contained" disabled={busy || !canNameBranch(branches)}>
            {translate(messages, 'pricing.lookup.submit')}
          </Button>
        </div>
      </form>
      {answer ? (
        <ResolvedPriceView
          locale={locale}
          messages={messages}
          answer={answer}
          onRetry={() => void submit()}
        />
      ) : busy ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : null}
    </section>
  );
}

function ResolvedPriceView({
  locale,
  messages,
  answer,
  onRetry,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly answer: ReadState<ResolvedPrice>;
  readonly onRetry: () => void;
}) {
  if (answer.status !== 'ok') {
    // One state is never drawn as another: a refusal offers no retry, an ended
    // session the way back, a throttled or unanswered lookup "try again".
    switch (answer.status) {
      case 'denied':
        return (
          <MuiRefusedState
            messages={messages}
            descriptionKey="pricing.lookup.refused"
            correlationId={answer.correlationId}
          />
        );
      case 'expired':
        return <MuiExpiredState messages={messages} locale={locale} />;
      case 'unavailable':
        return (
          <MuiUnavailableState
            messages={messages}
            onRetry={onRetry}
            correlationId={answer.correlationId}
          />
        );
      default:
        return (
          <MuiErrorState
            messages={messages}
            descriptionKey="pricing.lookup.failed"
            onRetry={onRetry}
            correlationId={answer.correlationId}
          />
        );
    }
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
      </dl>
    </section>
  );
}
