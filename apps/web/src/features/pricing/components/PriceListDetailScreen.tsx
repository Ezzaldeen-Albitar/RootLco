'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';

import { DateField, type DayProblem } from '@/components/forms/mui/DateField';
import { FormMoneyField } from '@/components/forms/mui/FormMoneyField';
import { FormNumberField } from '@/components/forms/mui/FormNumberField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
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
import {
  useUnsavedGuard,
  useWorkingContext,
} from '@/features/working-context/WorkingContextProvider';
import type { WorkingContextCompany } from '@/features/working-context/working-context-contract';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import type { ActionState } from '@/lib/forms/action-result';
import { useLocalRefusal } from '@/lib/forms/use-local-refusal';
import { formatMoney } from '@/lib/money';

import {
  createPriceListAssignment,
  createPriceListVersion,
  listPriceRules,
  publishPriceListVersion,
  recordPriceRule,
} from '../api';
import {
  AMOUNT,
  INTERNAL_CODE,
  ISO_DATE,
  MAX_NOTES,
  MAX_PRIORITY,
  type PriceListDetail,
  type PriceListRules,
  type PriceListVersion,
  type PriceRuleRow,
} from '../pricing-contract';
import {
  ActivationBadge,
  BranchPairPicker,
  CompanyPicker,
  EMPTY_PAIR,
  Figure,
  OutcomeNote,
  ServicePicker,
  UUID,
  VersionStatusBadge,
  branchLabel,
  useBranches,
  type BranchPair,
  type Branches,
} from './shared';

/**
 * One price list (P1-30, `W2`, FE-002): its versions, the rules of a chosen
 * version, and the writes A1 and P1-20 opened on it. On the shared Material UI
 * wrappers since `P1-32-PRE-OD-MUISP` (ADR-022): `forms/mui` fields,
 * `FormMoneyField` for the amount, `DateField` for every day, `EntityPicker`
 * for the service, Material's table for the two bounded lists, and the shared
 * states.
 *
 * ## The version that guards a write is the LIST's
 *
 * `svc.price-list-version-create` and `svc.price-list-version-publish` lock
 * the price list and compare `If-Match` with ITS `recordVersion`. The number
 * sent is therefore `priceList.recordVersion` from the detail this page read,
 * never the `recordVersion` a version's own answer carries, and after either
 * write the page is refreshed so the next write reads a fresh one.
 *
 * ## Rules are the server's figures
 *
 * `amount` renders through `formatMoney` with the list's currency and is typed
 * as a decimal STRING (`FormMoneyField`) from the keystroke to the request
 * body; `specificity` and `priority` render as the numbers the server sent.
 * Nothing on this screen orders, weighs or totals a rule — the rules list
 * already arrives in the resolver's order.
 *
 * ## What cannot be shown, said
 *
 * Assignments have no read: the panel records one and says the list of
 * existing assignments does not exist here. Tax classes have no list either,
 * so a rule's tax class is still an identifier field (route checklist,
 * prerequisite 6). A published version's rules are frozen, and the rule form is
 * withheld for any version that is not a draft. A company or branch a rule
 * names that this reader's working context cannot name is said in words, never
 * printed as its identifier.
 *
 * ## Unsaved work
 *
 * The rule, the new draft, the publication and the assignment each declare
 * what is typed and not yet stored (`useUnsavedGuard`), so leaving the page or
 * switching the branch asks first, and "discard" empties that form.
 */

export function PriceListDetailScreen({
  locale,
  messages,
  priceList,
  canManage,
  canPublish,
  canReadBranches,
  canReadServices,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly priceList: PriceListDetail;
  /** `svc.price.manage` — versions, rules and assignments. */
  readonly canManage: boolean;
  /** `svc.price.publish` — publication, which the backend demands workshop-wide. */
  readonly canPublish: boolean;
  /** `org.branch.read` — whether branch lists are requested for the pickers. */
  readonly canReadBranches: boolean;
  /** `svc.service.read` — whether a service can be found by code. */
  readonly canReadServices: boolean;
}) {
  const router = useRouter();
  const branches = useBranches(canReadBranches);
  const [chosenVersionId, setChosenVersionId] = useState<string | null>(
    priceList.versions[0]?.id ?? null
  );
  const chosen = priceList.versions.find((version) => version.id === chosenVersionId) ?? null;
  const inactive = priceList.status !== 'active';

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-labelledby="price-list-summary-heading"
        className="rounded-lg border border-border bg-surface p-4"
        lang={locale}
      >
        <h2 id="price-list-summary-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'pricing.detail.summaryHeading')}
        </h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <Figure label={translate(messages, 'pricing.detail.code')}>
            <code className="font-mono" dir="ltr">
              {priceList.priceListCode}
            </code>
          </Figure>
          <Figure label={translate(messages, 'pricing.detail.name')}>
            <bdi>{priceList.name}</bdi>
          </Figure>
          <Figure label={translate(messages, 'pricing.detail.currency')}>
            <code className="font-mono" dir="ltr">
              {priceList.currency}
            </code>
          </Figure>
          <Figure label={translate(messages, 'pricing.detail.status')}>
            <ActivationBadge messages={messages} status={priceList.status} />
          </Figure>
          <Figure label={translate(messages, 'pricing.detail.descriptionLabel')} wide>
            {priceList.description ? (
              <bdi>{priceList.description}</bdi>
            ) : (
              <span className="text-text-muted">
                {translate(messages, 'pricing.detail.noDescription')}
              </span>
            )}
          </Figure>
        </dl>
        {!canManage ? (
          <p className="mt-3 text-caption text-text-muted">
            {translate(messages, 'pricing.detail.noManagePermission')}
          </p>
        ) : null}
        {inactive ? (
          <p className="mt-3 text-caption text-text-muted">
            {translate(messages, 'pricing.detail.inactiveNote')}
          </p>
        ) : null}
      </section>

      <VersionsPanel
        locale={locale}
        messages={messages}
        priceList={priceList}
        chosenVersionId={chosenVersionId}
        onChoose={setChosenVersionId}
      />

      <RulesPanel
        locale={locale}
        messages={messages}
        priceList={priceList}
        version={chosen}
        branches={branches}
        canManage={canManage && !inactive}
        canReadServices={canReadServices}
      />

      {canManage && !inactive ? (
        <CreateVersionPanel
          locale={locale}
          messages={messages}
          priceList={priceList}
          onCreated={() => router.refresh()}
        />
      ) : null}

      {canPublish && !inactive ? (
        <PublishPanel
          locale={locale}
          messages={messages}
          priceList={priceList}
          onPublished={() => router.refresh()}
        />
      ) : null}

      {canManage && !inactive ? (
        <AssignmentPanel
          locale={locale}
          messages={messages}
          priceList={priceList}
          branches={branches}
        />
      ) : null}
    </div>
  );
}

/** Tracks which date fields hold parts of a day and not yet a whole one. */
function useUnfinishedDays(): {
  readonly unfinished: Readonly<Record<string, boolean>>;
  readonly noteDay: (field: string) => (problem: DayProblem) => void;
  readonly reset: () => void;
} {
  const [unfinished, setUnfinished] = useState<Readonly<Record<string, boolean>>>({});
  return {
    unfinished,
    noteDay: (field) => (problem) =>
      setUnfinished((current) =>
        current[field] === (problem !== null) ? current : { ...current, [field]: problem !== null }
      ),
    reset: () => setUnfinished({}),
  };
}

/* ------------------------------------------------------------------ *
 * Versions — inside the detail, newest first, bounded
 * ------------------------------------------------------------------ */

function VersionsPanel({
  locale,
  messages,
  priceList,
  chosenVersionId,
  onChoose,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly priceList: PriceListDetail;
  readonly chosenVersionId: string | null;
  readonly onChoose: (versionId: string) => void;
}) {
  return (
    <section
      aria-labelledby="price-list-versions-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="price-list-versions-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'pricing.versions.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'pricing.versions.explain')}
      </p>
      {priceList.versions.length === 0 ? (
        <MuiEmptyState
          messages={messages}
          descriptionKey="pricing.versions.none"
          testId="price-list-versions-empty"
        />
      ) : (
        <TableContainer>
          <Table size="small">
            <caption className="sr-only">{translate(messages, 'pricing.versions.caption')}</caption>
            <TableHead>
              <TableRow>
                <TableCell scope="col">
                  {translate(messages, 'pricing.versions.column.number')}
                </TableCell>
                <TableCell scope="col">
                  {translate(messages, 'pricing.versions.column.status')}
                </TableCell>
                <TableCell scope="col">
                  {translate(messages, 'pricing.versions.column.from')}
                </TableCell>
                <TableCell scope="col">
                  {translate(messages, 'pricing.versions.column.to')}
                </TableCell>
                <TableCell scope="col">
                  {translate(messages, 'pricing.versions.column.notes')}
                </TableCell>
                <TableCell scope="col">
                  <span className="sr-only">{translate(messages, 'pricing.versions.actions')}</span>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {priceList.versions.map((version) => (
                <TableRow
                  key={version.id}
                  selected={version.id === chosenVersionId}
                  aria-current={version.id === chosenVersionId ? 'true' : undefined}
                >
                  <TableCell>
                    <code className="font-mono" dir="ltr">
                      {version.versionNo}
                    </code>
                  </TableCell>
                  <TableCell>
                    <VersionStatusBadge messages={messages} status={version.status} />
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-caption" dir="ltr">
                      {version.effectiveFrom}
                    </span>
                  </TableCell>
                  <TableCell>
                    {version.effectiveTo ? (
                      <span className="font-mono text-caption" dir="ltr">
                        {version.effectiveTo}
                      </span>
                    ) : (
                      <span className="text-text-muted">
                        {translate(messages, 'pricing.versions.noEnd')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{version.notes ? <bdi>{version.notes}</bdi> : null}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      size="small"
                      variant={version.id === chosenVersionId ? 'contained' : 'outlined'}
                      aria-pressed={version.id === chosenVersionId}
                      onClick={() => onChoose(version.id)}
                    >
                      {translate(messages, 'pricing.versions.showRules')}{' '}
                      <span className="ms-1 font-mono" dir="ltr">
                        {version.versionNo}
                      </span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {priceList.versionsTruncated ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'pricing.versions.truncated')}
        </p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Rules of the chosen version
 * ------------------------------------------------------------------ */

function RulesPanel({
  locale,
  messages,
  priceList,
  version,
  branches,
  canManage,
  canReadServices,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly priceList: PriceListDetail;
  readonly version: PriceListVersion | null;
  readonly branches: Branches;
  readonly canManage: boolean;
  readonly canReadServices: boolean;
}) {
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly state: ReadState<PriceListRules>;
  } | null>(null);
  const [reloads, setReloads] = useState(0);
  const versionId = version?.id ?? null;
  const wanted = `${versionId ?? ''}#${reloads}`;

  useEffect(() => {
    if (!versionId) return;
    let live = true;
    void listPriceRules(priceList.id, versionId).then((result) => {
      if (live) setAnswer({ key: wanted, state: result });
    });
    return () => {
      live = false;
    };
  }, [priceList.id, versionId, wanted]);
  // An answer for another version — or an earlier read of this one — is not
  // this read's; it reads as loading.
  const state = answer && answer.key === wanted ? answer.state : null;
  const retry = () => setReloads((n) => n + 1);

  return (
    <section
      aria-labelledby="price-list-rules-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="price-list-rules-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'pricing.rules.heading')}
        {version ? (
          <>
            {' '}
            <span className="font-mono" dir="ltr">
              {version.versionNo}
            </span>
          </>
        ) : null}
      </h2>
      {!version ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'pricing.rules.choose')}
        </p>
      ) : state === null ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : state.status === 'denied' ? (
        <MuiRefusedState
          messages={messages}
          descriptionKey="pricing.rules.refused"
          correlationId={state.correlationId}
        />
      ) : state.status === 'expired' ? (
        <MuiExpiredState messages={messages} locale={locale} />
      ) : state.status === 'unavailable' ? (
        <MuiUnavailableState
          messages={messages}
          descriptionKey="pricing.rules.unavailable"
          onRetry={retry}
          correlationId={state.correlationId}
        />
      ) : state.status !== 'ok' ? (
        <MuiErrorState
          messages={messages}
          descriptionKey="pricing.rules.unavailable"
          onRetry={retry}
          correlationId={state.correlationId}
        />
      ) : (
        <RulesTable locale={locale} messages={messages} rules={state.data} branches={branches} />
      )}
      {version && version.status !== 'draft' ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'pricing.rules.frozen')}
        </p>
      ) : null}
      {version && version.status === 'draft' && canManage ? (
        <RecordRuleForm
          locale={locale}
          messages={messages}
          priceList={priceList}
          version={version}
          branches={branches}
          canReadServices={canReadServices}
          onRecorded={retry}
        />
      ) : null}
    </section>
  );
}

/**
 * What a rule is narrowed to, in words.
 *
 * The company and the branch are NAMED — the company from the working context
 * (the companies this reader's branches belong to), the branch from the branch
 * list in hand — and never printed as an identifier (Browser QA part 7, row
 * 5.10b). One this reader's lists cannot name is said in words rather than by
 * its reference.
 */
export function narrowingText(
  messages: Messages,
  branches: Branches,
  companies: readonly WorkingContextCompany[],
  rule: PriceRuleRow
): readonly string[] {
  const parts: string[] = [];
  const { companyId, branchId, customerClass } = rule.appliesTo;
  if (branchId) {
    parts.push(
      `${translate(messages, 'pricing.rules.branch')}: ${
        branchLabel(branches, branchId) ?? translate(messages, 'pricing.rules.branchOutsideContext')
      }`
    );
  }
  if (companyId && !branchId) {
    const company =
      companies.find((entry) => entry.id === companyId)?.name ??
      translate(messages, 'pricing.rules.companyOutsideContext');
    parts.push(`${translate(messages, 'pricing.rules.company')}: ${company}`);
  }
  if (customerClass) {
    parts.push(`${translate(messages, 'pricing.rules.customerClass')}: ${customerClass}`);
  }
  return parts;
}

function RulesTable({
  locale,
  messages,
  rules,
  branches,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly rules: PriceListRules;
  readonly branches: Branches;
}) {
  const { companies } = useWorkingContext();
  if (rules.rules.length === 0) {
    return (
      <MuiEmptyState
        messages={messages}
        descriptionKey="pricing.rules.none"
        testId="price-rules-empty"
      />
    );
  }
  return (
    <>
      <TableContainer>
        <Table size="small">
          <caption className="sr-only">{translate(messages, 'pricing.rules.caption')}</caption>
          <TableHead>
            <TableRow>
              <TableCell scope="col">
                {translate(messages, 'pricing.rules.column.service')}
              </TableCell>
              <TableCell scope="col">
                {translate(messages, 'pricing.rules.column.appliesTo')}
              </TableCell>
              <TableCell scope="col" align="right">
                {translate(messages, 'pricing.rules.column.amount')}
              </TableCell>
              <TableCell scope="col" align="right">
                {translate(messages, 'pricing.rules.column.specificity')}
              </TableCell>
              <TableCell scope="col" align="right">
                {translate(messages, 'pricing.rules.column.priority')}
              </TableCell>
              <TableCell scope="col">
                {translate(messages, 'pricing.rules.column.taxClass')}
              </TableCell>
              <TableCell scope="col">
                {translate(messages, 'pricing.rules.column.status')}
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rules.rules.map((rule) => {
              const parts = narrowingText(messages, branches, companies, rule);
              return (
                <TableRow key={rule.id}>
                  <TableCell>
                    <span className="flex flex-col">
                      <span className="font-mono text-caption" dir="ltr">
                        {rule.service.serviceCode}
                      </span>
                      <bdi>{rule.service.name}</bdi>
                    </span>
                  </TableCell>
                  <TableCell>
                    {parts.length === 0 ? (
                      <span className="text-text-muted">
                        {translate(messages, 'pricing.rules.any')}
                      </span>
                    ) : (
                      <span className="flex flex-col">
                        {parts.map((part) => (
                          <span key={part} className="text-caption">
                            {part}
                          </span>
                        ))}
                      </span>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <span className="font-mono tabular-nums" dir="ltr">
                      {formatMoney({ amount: rule.amount, currency: rule.currency }, locale)}
                    </span>
                  </TableCell>
                  <TableCell align="right">
                    <span className="font-mono tabular-nums" dir="ltr">
                      {rule.specificity}
                    </span>
                  </TableCell>
                  <TableCell align="right">
                    <span className="font-mono tabular-nums" dir="ltr">
                      {rule.priority}
                    </span>
                  </TableCell>
                  <TableCell>
                    {/*
                      Tax classes have no read yet (route checklist, prerequisite
                      6), so the recorded reference is shown as it was stored.
                    */}
                    {rule.taxClassId ? (
                      <code className="font-mono text-caption" dir="ltr">
                        {rule.taxClassId}
                      </code>
                    ) : (
                      <span className="text-text-muted">
                        {translate(messages, 'pricing.rules.noTaxClass')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <ActivationBadge messages={messages} status={rule.status} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <p className="text-caption text-text-muted">
        {translate(messages, 'pricing.rules.specificityHelp')}
      </p>
      {rules.truncated ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'pricing.rules.truncated')}
        </p>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Recording a rule on a draft
 * ------------------------------------------------------------------ */

function RecordRuleForm({
  locale,
  messages,
  priceList,
  version,
  branches,
  canReadServices,
  onRecorded,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly priceList: PriceListDetail;
  readonly version: PriceListVersion;
  readonly branches: Branches;
  readonly canReadServices: boolean;
  readonly onRecorded: () => void;
}) {
  const [serviceId, setServiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [amountValid, setAmountValid] = useState(true);
  const [pair, setPair] = useState<BranchPair>(EMPTY_PAIR);
  const [customerClass, setCustomerClass] = useState('');
  const [taxClassId, setTaxClassId] = useState('');
  const [priority, setPriority] = useState('');
  // Confirmed discards: part of the picker's key, so it remounts empty.
  const [discards, setDiscards] = useState(0);
  // Question f: the cursor goes to the first thing to fix, and a complaint is
  // withdrawn once its field no longer holds the refused value (route sweep B3).
  const {
    errorKey: localErrorKey,
    formRef: localFormRef,
    refuse: localRefuse,
  } = useLocalRefusal({
    serviceId,
    amount,
    companyId: pair.companyId,
    branchId: pair.branchId,
    customerClass,
    taxClassId,
    priority,
  });
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  /*
   * The rule is unsaved work the moment ANY of its fields holds something, and
   * the form says so itself — with the catalogue read or without it (QA round
   * three).
   *
   * A price list is not addressed to the working branch, so nothing here
   * follows a switch on its own: a confirmed discard empties the whole rule,
   * which is what the question said would be lost.
   */
  const ruleTyped = [
    serviceId,
    amount,
    pair.companyId,
    pair.branchId,
    customerClass,
    taxClassId,
    priority,
  ].some((field) => field.trim().length > 0);
  useUnsavedGuard(ruleTyped, () => {
    setServiceId('');
    setAmount('');
    setAmountValid(true);
    setPair(EMPTY_PAIR);
    setCustomerClass('');
    setTaxClassId('');
    setPriority('');
    setOutcome(null);
    setDiscards((count) => count + 1);
  });

  const errorFor = (name: string): string | undefined => {
    const key = localErrorKey(name) ?? outcome?.fieldErrors?.[name];
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
    const money = amount.trim();
    if (money.length === 0) found['amount'] = 'field.required';
    else if (!amountValid || !AMOUNT.test(money)) found['amount'] = 'pricing.rule.amountFormat';
    const companyId = pair.companyId.trim();
    const branchId = pair.branchId.trim();
    if (companyId.length > 0 && !UUID.test(companyId))
      found['companyId'] = 'pricing.common.idFormat';
    if (branchId.length > 0 && !UUID.test(branchId)) found['branchId'] = 'pricing.common.idFormat';
    if (branchId.length > 0 && companyId.length === 0) {
      found['companyId'] = 'pricing.rule.branchNeedsCompany';
    }
    const klass = customerClass.trim();
    if (klass.length > 0 && !INTERNAL_CODE.test(klass)) {
      found['customerClass'] = 'pricing.common.classFormat';
    }
    const tax = taxClassId.trim();
    if (tax.length > 0 && !UUID.test(tax)) found['taxClassId'] = 'pricing.common.idFormat';
    if (tax.length > 0 && companyId.length === 0)
      found['taxClassId'] = 'pricing.rule.taxNeedsCompany';
    const priorityText = priority.trim();
    if (priorityText.length > 0 && !/^\d{1,7}$/.test(priorityText)) {
      found['priority'] = 'pricing.rule.priorityFormat';
    } else if (priorityText.length > 0 && Number(priorityText) > MAX_PRIORITY) {
      found['priority'] = 'pricing.rule.priorityFormat';
    }
    localRefuse(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await recordPriceRule(priceList.id, version.id, {
      serviceId: service,
      amount: money,
      ...(companyId ? { companyId } : {}),
      ...(branchId ? { branchId } : {}),
      ...(klass ? { customerClass: klass } : {}),
      ...(tax ? { taxClassId: tax } : {}),
      ...(priorityText ? { priority: Number(priorityText) } : {}),
    });
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success') {
      setAmount('');
      setOutcome(null);
      onRecorded();
    }
  };

  return (
    <form
      ref={localFormRef}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="price-rule-heading"
      className="grid gap-4 border-t border-border pt-3 sm:grid-cols-2"
    >
      <h3 id="price-rule-heading" className="text-body font-medium text-text-primary sm:col-span-2">
        {translate(messages, 'pricing.rule.heading')}
      </h3>
      <p className="text-caption text-text-muted sm:col-span-2">
        {translate(messages, 'pricing.rule.explain')}
      </p>
      <div className="sm:col-span-2">
        <ServicePicker
          // Not `countsAsUnsaved`: the form's own guard above covers the
          // reference with every other field, whichever way the service is named.
          key={`service-${discards}`}
          messages={messages}
          locale={locale}
          canRead={canReadServices}
          label={translate(messages, 'pricing.rule.service')}
          value={serviceId}
          onChange={setServiceId}
          error={errorFor('serviceId')}
          testId="price-rule-service"
        />
      </div>
      <FormMoneyField
        messages={messages}
        label={translate(messages, 'pricing.rule.amount')}
        currency={priceList.currency}
        required
        value={amount}
        onChange={(next, valid) => {
          setAmount(next);
          setAmountValid(valid);
        }}
        error={errorFor('amount')}
      />
      <FormNumberField
        label={translate(messages, 'pricing.rule.priority')}
        description={translate(messages, 'pricing.rule.priorityHelp')}
        integer
        value={priority}
        onChange={setPriority}
        error={errorFor('priority')}
      />
      <CompanyPicker
        messages={messages}
        label={translate(messages, 'pricing.rule.company')}
        placeholder={translate(messages, 'pricing.rule.anyCompany')}
        value={pair}
        onChange={setPair}
        error={errorFor('companyId')}
      />
      <BranchPairPicker
        messages={messages}
        branches={branches}
        label={translate(messages, 'pricing.rule.branch')}
        placeholder={translate(messages, 'pricing.rule.anyBranch')}
        value={pair}
        onChange={(next) =>
          // Clearing the branch keeps the company the operator chose: a rule for
          // every branch of one company is a choice, not an absence.
          setPair(next.branchId === '' ? { companyId: pair.companyId, branchId: '' } : next)
        }
        errors={{ branchId: errorFor('branchId') }}
      />
      <FormTextField
        label={translate(messages, 'pricing.rule.customerClass')}
        description={translate(messages, 'pricing.common.classHelp')}
        dir="ltr"
        autoComplete="off"
        value={customerClass}
        onChange={setCustomerClass}
        error={errorFor('customerClass')}
      />
      <FormTextField
        label={translate(messages, 'pricing.rule.taxClass')}
        description={translate(messages, 'pricing.rule.taxClassHelp')}
        dir="ltr"
        autoComplete="off"
        value={taxClassId}
        onChange={setTaxClassId}
        error={errorFor('taxClassId')}
      />
      <div className="sm:col-span-2">
        <OutcomeNote messages={messages} outcome={outcome} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" variant="contained" disabled={busy}>
          {translate(messages, 'pricing.rule.submit')}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * A new draft — guarded by the LIST's version
 * ------------------------------------------------------------------ */

const EMPTY_DRAFT = { effectiveFrom: '', notes: '' };

function CreateVersionPanel({
  locale,
  messages,
  priceList,
  onCreated,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly priceList: PriceListDetail;
  readonly onCreated: () => void;
}) {
  const [form, setForm] = useState(EMPTY_DRAFT);
  const days = useUnfinishedDays();
  const {
    errorKey: localErrorKey,
    formRef: localFormRef,
    refuse: localRefuse,
  } = useLocalRefusal({
    effectiveFrom: `${form.effectiveFrom}|${days.unfinished['effectiveFrom'] === true}`,
    notes: form.notes,
  });
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const dirty =
    form.effectiveFrom !== '' ||
    form.notes.trim() !== '' ||
    days.unfinished['effectiveFrom'] === true;
  useUnsavedGuard(dirty, () => {
    setForm(EMPTY_DRAFT);
    days.reset();
    setOutcome(null);
  });

  const errorFor = (name: string): string | undefined => {
    const key = localErrorKey(name) ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    const effectiveFrom = form.effectiveFrom.trim();
    if (days.unfinished['effectiveFrom'] || !ISO_DATE.test(effectiveFrom)) {
      found['effectiveFrom'] = 'pricing.common.dateFormat';
    }
    const notes = form.notes.trim();
    if (notes.length > MAX_NOTES) found['notes'] = 'pricing.version.notesTooLong';
    localRefuse(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await createPriceListVersion(
      priceList.id,
      { effectiveFrom, ...(notes ? { notes } : {}) },
      priceList.recordVersion
    );
    setBusy(false);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success') {
      setOutcome(null);
      setForm(EMPTY_DRAFT);
      onCreated();
      return;
    }
    setOutcome(conflictAware(result.state));
  };

  return (
    <section
      aria-labelledby="price-version-create-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="price-version-create-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'pricing.version.createHeading')}
      </h2>
      <form
        ref={localFormRef}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        noValidate
        aria-labelledby="price-version-create-heading"
        className="grid gap-4 sm:grid-cols-2"
      >
        <DateField
          label={translate(messages, 'pricing.version.effectiveFrom')}
          description={translate(messages, 'pricing.version.effectiveFromHelp')}
          required
          value={form.effectiveFrom}
          onChange={(effectiveFrom) => setForm((f) => ({ ...f, effectiveFrom }))}
          onProblem={days.noteDay('effectiveFrom')}
          error={errorFor('effectiveFrom')}
          testId="price-version-from"
        />
        <div className="sm:col-span-2">
          <FormTextField
            label={translate(messages, 'pricing.version.notes')}
            multiline
            rows={3}
            value={form.notes}
            onChange={(notes) => setForm((f) => ({ ...f, notes }))}
            error={errorFor('notes')}
          />
        </div>
        <div className="sm:col-span-2">
          <OutcomeNote messages={messages} outcome={outcome} />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" variant="contained" disabled={busy}>
            {translate(messages, 'pricing.version.createDraft')}
          </Button>
        </div>
      </form>
    </section>
  );
}

/** A 409 on a guarded write is a stale version; it is said as such. */
function conflictAware(state: ActionState): ActionState {
  return state.status === 'conflict' ? { ...state, messageKey: 'pricing.detail.conflict' } : state;
}

/* ------------------------------------------------------------------ *
 * Publication — a separate code, workshop-wide
 * ------------------------------------------------------------------ */

function PublishPanel({
  locale,
  messages,
  priceList,
  onPublished,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly priceList: PriceListDetail;
  readonly onPublished: () => void;
}) {
  const drafts = useMemo(
    () => priceList.versions.filter((version) => version.status === 'draft'),
    [priceList.versions]
  );
  /*
   * Only a draft the operator CHOSE is held in state. The default is read from
   * the current drafts at every render, so a refresh that adds a draft, or drops
   * the one just published, never turns into unsaved work; and a choice whose
   * draft has left the list falls back to the default instead of naming a
   * version that is no longer offered.
   */
  const [chosen, setChosen] = useState<string | null>(null);
  const chosenStillOffered = chosen !== null && drafts.some((draft) => draft.id === chosen);
  const versionId = chosenStillOffered ? chosen : (drafts[0]?.id ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const days = useUnfinishedDays();
  const {
    errorKey: localErrorKey,
    formRef: localFormRef,
    refuse: localRefuse,
  } = useLocalRefusal({
    versionId,
    effectiveFrom: `${effectiveFrom}|${days.unfinished['effectiveFrom'] === true}`,
  });
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  // A day typed for publication, or a draft the operator chose, is unsaved work.
  const dirty =
    effectiveFrom !== '' || days.unfinished['effectiveFrom'] === true || chosenStillOffered;
  useUnsavedGuard(dirty, () => {
    setChosen(null);
    setEffectiveFrom('');
    days.reset();
    setOutcome(null);
  });

  const errorFor = (name: string): string | undefined => {
    const key = localErrorKey(name) ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    if (!versionId) found['versionId'] = 'field.required';
    const from = effectiveFrom.trim();
    if (days.unfinished['effectiveFrom'] || !ISO_DATE.test(from)) {
      found['effectiveFrom'] = 'pricing.common.dateFormat';
    }
    localRefuse(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await publishPriceListVersion(
      priceList.id,
      versionId,
      { effectiveFrom: from },
      priceList.recordVersion
    );
    setBusy(false);
    notifyActionResult(result, messages);
    if (result.status === 'success') {
      setOutcome(null);
      setChosen(null);
      setEffectiveFrom('');
      onPublished();
      return;
    }
    setOutcome(conflictAware(result));
  };

  return (
    <section
      aria-labelledby="price-publish-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="price-publish-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'pricing.publish.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'pricing.publish.explain')}
      </p>
      {drafts.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'pricing.publish.noDraft')}
        </p>
      ) : (
        <form
          ref={localFormRef}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          noValidate
          aria-labelledby="price-publish-heading"
          className="grid gap-4 sm:grid-cols-2"
        >
          <FormSelectField
            label={translate(messages, 'pricing.publish.version')}
            required
            value={versionId}
            onChange={setChosen}
            options={drafts.map((draft) => ({
              value: draft.id,
              label: `${draft.versionNo} — ${draft.effectiveFrom}`,
            }))}
            placeholder={translate(messages, 'pricing.publish.chooseVersion')}
            error={errorFor('versionId')}
          />
          <DateField
            label={translate(messages, 'pricing.publish.effectiveFrom')}
            required
            value={effectiveFrom}
            onChange={setEffectiveFrom}
            onProblem={days.noteDay('effectiveFrom')}
            error={errorFor('effectiveFrom')}
            testId="price-publish-from"
          />
          <div className="sm:col-span-2">
            <OutcomeNote messages={messages} outcome={outcome} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" variant="contained" disabled={busy}>
              {translate(messages, 'pricing.publish.submit')}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Where the list applies — write-only, and it says so
 * ------------------------------------------------------------------ */

function AssignmentPanel({
  locale,
  messages,
  priceList,
  branches,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly priceList: PriceListDetail;
  readonly branches: Branches;
}) {
  const [pair, setPair] = useState<BranchPair>(EMPTY_PAIR);
  const [customerClass, setCustomerClass] = useState('');
  const [priority, setPriority] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const days = useUnfinishedDays();
  const {
    errorKey: localErrorKey,
    formRef: localFormRef,
    refuse: localRefuse,
  } = useLocalRefusal({
    companyId: pair.companyId,
    branchId: pair.branchId,
    customerClass,
    priority,
    effectiveFrom: `${effectiveFrom}|${days.unfinished['effectiveFrom'] === true}`,
    effectiveTo: `${effectiveTo}|${days.unfinished['effectiveTo'] === true}`,
  });
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const [recorded, setRecorded] = useState(false);

  const reset = () => {
    setPair(EMPTY_PAIR);
    setCustomerClass('');
    setPriority('');
    setEffectiveFrom('');
    setEffectiveTo('');
    days.reset();
    setOutcome(null);
  };
  const dirty =
    [pair.companyId, pair.branchId, customerClass, priority, effectiveFrom, effectiveTo].some(
      (field) => field.trim().length > 0
    ) || Object.values(days.unfinished).some(Boolean);
  useUnsavedGuard(dirty, reset);

  const errorFor = (name: string): string | undefined => {
    const key = localErrorKey(name) ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    const companyId = pair.companyId.trim();
    const branchId = pair.branchId.trim();
    if (companyId.length > 0 && !UUID.test(companyId))
      found['companyId'] = 'pricing.common.idFormat';
    if (branchId.length > 0 && !UUID.test(branchId)) found['branchId'] = 'pricing.common.idFormat';
    if (branchId.length > 0 && companyId.length === 0) {
      found['companyId'] = 'pricing.rule.branchNeedsCompany';
    }
    const klass = customerClass.trim();
    if (klass.length > 0 && !INTERNAL_CODE.test(klass)) {
      found['customerClass'] = 'pricing.common.classFormat';
    }
    const priorityText = priority.trim();
    if (priorityText.length > 0 && !/^\d{1,7}$/.test(priorityText)) {
      found['priority'] = 'pricing.rule.priorityFormat';
    } else if (priorityText.length > 0 && Number(priorityText) > MAX_PRIORITY) {
      found['priority'] = 'pricing.rule.priorityFormat';
    }
    const from = effectiveFrom.trim();
    if (days.unfinished['effectiveFrom'] || !ISO_DATE.test(from)) {
      found['effectiveFrom'] = 'pricing.common.dateFormat';
    }
    const to = effectiveTo.trim();
    if (days.unfinished['effectiveTo'] || (to.length > 0 && !ISO_DATE.test(to))) {
      found['effectiveTo'] = 'pricing.common.dateFormat';
    } else if (to.length > 0 && to <= from) {
      found['effectiveTo'] = 'pricing.assignment.rangeOrder';
    }
    localRefuse(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    setRecorded(false);
    const result = await createPriceListAssignment({
      priceListId: priceList.id,
      ...(companyId ? { companyId } : {}),
      ...(branchId ? { branchId } : {}),
      ...(klass ? { customerClass: klass } : {}),
      ...(priorityText ? { priority: Number(priorityText) } : {}),
      effectiveFrom: from,
      ...(to ? { effectiveTo: to } : {}),
    });
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      // Stored: the typed assignment is no longer unsaved work.
      reset();
      setRecorded(true);
    }
  };

  return (
    <section
      aria-labelledby="price-assignment-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="price-assignment-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'pricing.assignment.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'pricing.assignment.explain')}
      </p>
      <p className="text-caption text-text-muted">
        {translate(messages, 'pricing.assignment.noRead')}
      </p>
      <form
        ref={localFormRef}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        noValidate
        aria-labelledby="price-assignment-heading"
        className="grid gap-4 sm:grid-cols-2"
      >
        <BranchPairPicker
          messages={messages}
          branches={branches}
          label={translate(messages, 'pricing.rule.branch')}
          placeholder={translate(messages, 'pricing.rule.anyBranch')}
          value={pair}
          onChange={setPair}
          errors={{ companyId: errorFor('companyId'), branchId: errorFor('branchId') }}
        />
        <FormTextField
          label={translate(messages, 'pricing.rule.customerClass')}
          description={translate(messages, 'pricing.common.classHelp')}
          dir="ltr"
          autoComplete="off"
          value={customerClass}
          onChange={setCustomerClass}
          error={errorFor('customerClass')}
        />
        <FormNumberField
          label={translate(messages, 'pricing.rule.priority')}
          description={translate(messages, 'pricing.rule.priorityHelp')}
          integer
          value={priority}
          onChange={setPriority}
          error={errorFor('priority')}
        />
        <DateField
          label={translate(messages, 'pricing.assignment.effectiveFrom')}
          required
          value={effectiveFrom}
          onChange={setEffectiveFrom}
          onProblem={days.noteDay('effectiveFrom')}
          error={errorFor('effectiveFrom')}
          testId="price-assignment-from"
        />
        <DateField
          label={translate(messages, 'pricing.assignment.effectiveTo')}
          description={translate(messages, 'pricing.assignment.effectiveToHelp')}
          value={effectiveTo}
          onChange={setEffectiveTo}
          onProblem={days.noteDay('effectiveTo')}
          error={errorFor('effectiveTo')}
          testId="price-assignment-to"
        />
        <div className="sm:col-span-2">
          <OutcomeNote messages={messages} outcome={outcome} />
        </div>
        {recorded ? (
          // Said in words: the assignment has no name, and its reference would
          // be a string to look up rather than an answer.
          <p
            role="status"
            className="text-supporting text-text-secondary sm:col-span-2"
            data-testid="price-assignment-recorded"
          >
            {translate(messages, 'pricing.assignment.success')}
          </p>
        ) : null}
        <div className="sm:col-span-2">
          <Button type="submit" variant="contained" disabled={busy}>
            {translate(messages, 'pricing.assignment.submit')}
          </Button>
        </div>
      </form>
    </section>
  );
}
