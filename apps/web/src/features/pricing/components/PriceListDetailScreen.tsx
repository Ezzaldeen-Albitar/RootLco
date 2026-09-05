'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { SelectField, TextAreaField, TextField } from '@/components/forms/Field';
import { MoneyField } from '@/components/forms/MoneyField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import type { ActionState } from '@/lib/forms/action-result';
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
  EMPTY_PAIR,
  Figure,
  OutcomeNote,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
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
 * version, and the writes A1 and P1-20 opened on it.
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
 * `amount` renders through `formatMoney` with the list's currency;
 * `specificity` and `priority` render as the numbers the server sent. Nothing
 * on this screen orders, weighs or totals a rule — the rules list already
 * arrives in the resolver's order.
 *
 * ## What cannot be shown, said
 *
 * Assignments have no read: the panel records one and says the list of
 * existing assignments does not exist here. Tax classes have no list either,
 * so a rule's tax class is an identifier field. A published version's rules are
 * frozen, and the rule form is withheld for any version that is not a draft.
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
        <p className="text-body text-text-secondary">
          {translate(messages, 'pricing.versions.none')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <caption className="sr-only">{translate(messages, 'pricing.versions.caption')}</caption>
            <thead>
              <tr className="text-start text-caption text-text-muted">
                <th scope="col" className="py-1 pe-3 text-start">
                  {translate(messages, 'pricing.versions.column.number')}
                </th>
                <th scope="col" className="py-1 pe-3 text-start">
                  {translate(messages, 'pricing.versions.column.status')}
                </th>
                <th scope="col" className="py-1 pe-3 text-start">
                  {translate(messages, 'pricing.versions.column.from')}
                </th>
                <th scope="col" className="py-1 pe-3 text-start">
                  {translate(messages, 'pricing.versions.column.to')}
                </th>
                <th scope="col" className="py-1 pe-3 text-start">
                  {translate(messages, 'pricing.versions.column.notes')}
                </th>
                <th scope="col" className="py-1 text-start">
                  <span className="sr-only">{translate(messages, 'pricing.versions.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {priceList.versions.map((version) => (
                <tr
                  key={version.id}
                  className="border-t border-border"
                  aria-current={version.id === chosenVersionId ? 'true' : undefined}
                >
                  <td className="py-2 pe-3">
                    <code className="font-mono" dir="ltr">
                      {version.versionNo}
                    </code>
                  </td>
                  <td className="py-2 pe-3">
                    <VersionStatusBadge messages={messages} status={version.status} />
                  </td>
                  <td className="py-2 pe-3">
                    <code className="font-mono text-caption" dir="ltr">
                      {version.effectiveFrom}
                    </code>
                  </td>
                  <td className="py-2 pe-3">
                    {version.effectiveTo ? (
                      <code className="font-mono text-caption" dir="ltr">
                        {version.effectiveTo}
                      </code>
                    ) : (
                      <span className="text-text-muted">
                        {translate(messages, 'pricing.versions.noEnd')}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pe-3">{version.notes ? <bdi>{version.notes}</bdi> : null}</td>
                  <td className="py-2">
                    <button
                      type="button"
                      className={SECONDARY_BUTTON}
                      aria-pressed={version.id === chosenVersionId}
                      onClick={() => onChoose(version.id)}
                    >
                      {translate(messages, 'pricing.versions.showRules')}{' '}
                      <code className="font-mono" dir="ltr">
                        {version.versionNo}
                      </code>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
    readonly versionId: string;
    readonly state: ReadState<PriceListRules>;
  } | null>(null);
  const [reloads, setReloads] = useState(0);
  const versionId = version?.id ?? null;

  useEffect(() => {
    if (!versionId) return;
    let live = true;
    void listPriceRules(priceList.id, versionId).then((result) => {
      if (live) setAnswer({ versionId, state: result });
    });
    return () => {
      live = false;
    };
  }, [priceList.id, versionId, reloads]);
  // An answer for another version is not this version's; it reads as loading.
  const state = answer && answer.versionId === versionId ? answer.state : null;

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
            <code className="font-mono" dir="ltr">
              {version.versionNo}
            </code>
          </>
        ) : null}
      </h2>
      {!version ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'pricing.rules.choose')}
        </p>
      ) : state === null ? (
        <p className="text-body text-text-secondary" aria-busy="true">
          {translate(messages, 'state.loading')}
        </p>
      ) : state.status !== 'ok' ? (
        <p role="alert" className="text-body text-error">
          {translate(
            messages,
            state.status === 'denied' ? 'pricing.rules.refused' : 'pricing.rules.unavailable'
          )}
          {state.correlationId ? (
            <>
              {' '}
              <span className="text-caption text-text-muted">
                {translate(messages, 'state.correlationId')}{' '}
                <code className="font-mono" dir="ltr">
                  {state.correlationId}
                </code>
              </span>
            </>
          ) : null}
        </p>
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
          messages={messages}
          priceList={priceList}
          version={version}
          branches={branches}
          canReadServices={canReadServices}
          onRecorded={() => setReloads((n) => n + 1)}
        />
      ) : null}
    </section>
  );
}

function narrowingText(
  messages: Messages,
  branches: Branches,
  rule: PriceRuleRow
): readonly string[] {
  const parts: string[] = [];
  const { companyId, branchId, customerClass } = rule.appliesTo;
  if (branchId) {
    parts.push(
      `${translate(messages, 'pricing.rules.branch')}: ${branchLabel(branches, branchId) ?? branchId}`
    );
  }
  if (companyId && !branchId) {
    parts.push(`${translate(messages, 'pricing.rules.company')}: ${companyId}`);
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
  if (rules.rules.length === 0) {
    return (
      <p className="text-body text-text-secondary">{translate(messages, 'pricing.rules.none')}</p>
    );
  }
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-body">
          <caption className="sr-only">{translate(messages, 'pricing.rules.caption')}</caption>
          <thead>
            <tr className="text-caption text-text-muted">
              <th scope="col" className="py-1 pe-3 text-start">
                {translate(messages, 'pricing.rules.column.service')}
              </th>
              <th scope="col" className="py-1 pe-3 text-start">
                {translate(messages, 'pricing.rules.column.appliesTo')}
              </th>
              <th scope="col" className="py-1 pe-3 text-end">
                {translate(messages, 'pricing.rules.column.amount')}
              </th>
              <th scope="col" className="py-1 pe-3 text-end">
                {translate(messages, 'pricing.rules.column.specificity')}
              </th>
              <th scope="col" className="py-1 pe-3 text-end">
                {translate(messages, 'pricing.rules.column.priority')}
              </th>
              <th scope="col" className="py-1 pe-3 text-start">
                {translate(messages, 'pricing.rules.column.taxClass')}
              </th>
              <th scope="col" className="py-1 text-start">
                {translate(messages, 'pricing.rules.column.status')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rules.rules.map((rule) => {
              const parts = narrowingText(messages, branches, rule);
              return (
                <tr key={rule.id} className="border-t border-border">
                  <td className="py-2 pe-3">
                    <span className="flex flex-col">
                      <code className="font-mono text-caption" dir="ltr">
                        {rule.service.serviceCode}
                      </code>
                      <bdi>{rule.service.name}</bdi>
                    </span>
                  </td>
                  <td className="py-2 pe-3">
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
                  </td>
                  <td className="py-2 pe-3 text-end">
                    <span className="font-mono" dir="ltr">
                      {formatMoney({ amount: rule.amount, currency: rule.currency }, locale)}
                    </span>
                  </td>
                  <td className="py-2 pe-3 text-end">
                    <code className="font-mono" dir="ltr">
                      {rule.specificity}
                    </code>
                  </td>
                  <td className="py-2 pe-3 text-end">
                    <code className="font-mono" dir="ltr">
                      {rule.priority}
                    </code>
                  </td>
                  <td className="py-2 pe-3">
                    {rule.taxClassId ? (
                      <code className="font-mono text-caption" dir="ltr">
                        {rule.taxClassId}
                      </code>
                    ) : (
                      <span className="text-text-muted">
                        {translate(messages, 'pricing.rules.noTaxClass')}
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    <ActivationBadge messages={messages} status={rule.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
  messages,
  priceList,
  version,
  branches,
  canReadServices,
  onRecorded,
}: {
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
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    const service = serviceId.trim();
    if (!UUID.test(service)) found['serviceId'] = 'pricing.common.idFormat';
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
    setErrors(found);
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
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="price-rule-heading"
      className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2"
    >
      <h3 id="price-rule-heading" className="text-body font-medium text-text-primary sm:col-span-2">
        {translate(messages, 'pricing.rule.heading')}
      </h3>
      <p className="text-caption text-text-muted sm:col-span-2">
        {translate(messages, 'pricing.rule.explain')}
      </p>
      <div className="sm:col-span-2">
        <ServicePicker
          messages={messages}
          canRead={canReadServices}
          label={translate(messages, 'pricing.rule.service')}
          value={serviceId}
          onChange={setServiceId}
          error={errorFor('serviceId')}
        />
      </div>
      <MoneyField
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
      <TextField
        label={translate(messages, 'pricing.rule.priority')}
        description={translate(messages, 'pricing.rule.priorityHelp')}
        inputMode="numeric"
        dir="ltr"
        value={priority}
        onChange={(event) => setPriority(event.target.value)}
        error={errorFor('priority')}
      />
      <BranchPairPicker
        messages={messages}
        branches={branches}
        label={translate(messages, 'pricing.rule.branch')}
        placeholder={translate(messages, 'pricing.rule.anyBranch')}
        value={pair}
        onChange={setPair}
        errors={{ companyId: errorFor('companyId'), branchId: errorFor('branchId') }}
      />
      <TextField
        label={translate(messages, 'pricing.rule.customerClass')}
        description={translate(messages, 'pricing.common.classHelp')}
        spellCheck={false}
        dir="ltr"
        value={customerClass}
        onChange={(event) => setCustomerClass(event.target.value)}
        error={errorFor('customerClass')}
      />
      <TextField
        label={translate(messages, 'pricing.rule.taxClass')}
        description={translate(messages, 'pricing.rule.taxClassHelp')}
        spellCheck={false}
        dir="ltr"
        value={taxClassId}
        onChange={(event) => setTaxClassId(event.target.value)}
        error={errorFor('taxClassId')}
      />
      <div className="sm:col-span-2">
        <OutcomeNote messages={messages} outcome={outcome} />
      </div>
      <div className="sm:col-span-2">
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'pricing.rule.submit')}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * A new draft — guarded by the LIST's version
 * ------------------------------------------------------------------ */

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
  const [form, setForm] = useState({ effectiveFrom: '', notes: '' });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    const effectiveFrom = form.effectiveFrom.trim();
    if (!ISO_DATE.test(effectiveFrom)) found['effectiveFrom'] = 'pricing.common.dateFormat';
    const notes = form.notes.trim();
    if (notes.length > MAX_NOTES) found['notes'] = 'pricing.version.notesTooLong';
    setErrors(found);
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
      setForm({ effectiveFrom: '', notes: '' });
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
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        noValidate
        aria-labelledby="price-version-create-heading"
        className="grid gap-3 sm:grid-cols-2"
      >
        <TextField
          label={translate(messages, 'pricing.version.effectiveFrom')}
          description={translate(messages, 'pricing.version.effectiveFromHelp')}
          required
          type="date"
          dir="ltr"
          value={form.effectiveFrom}
          onChange={(event) => setForm((f) => ({ ...f, effectiveFrom: event.target.value }))}
          error={errorFor('effectiveFrom')}
        />
        <div className="sm:col-span-2">
          <TextAreaField
            label={translate(messages, 'pricing.version.notes')}
            value={form.notes}
            onChange={(event) => setForm((f) => ({ ...f, notes: event.target.value }))}
            error={errorFor('notes')}
          />
        </div>
        <div className="sm:col-span-2">
          <OutcomeNote messages={messages} outcome={outcome} />
        </div>
        <div className="sm:col-span-2">
          <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
            {translate(messages, 'pricing.version.createDraft')}
          </button>
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
  const [versionId, setVersionId] = useState(drafts[0]?.id ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    if (!versionId) found['versionId'] = 'field.required';
    const from = effectiveFrom.trim();
    if (!ISO_DATE.test(from)) found['effectiveFrom'] = 'pricing.common.dateFormat';
    setErrors(found);
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
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          noValidate
          aria-labelledby="price-publish-heading"
          className="grid gap-3 sm:grid-cols-2"
        >
          <SelectField
            label={translate(messages, 'pricing.publish.version')}
            required
            value={versionId}
            onChange={(event) => setVersionId(event.target.value)}
            options={drafts.map((draft) => ({
              value: draft.id,
              label: `${draft.versionNo} — ${draft.effectiveFrom}`,
            }))}
            placeholder={translate(messages, 'pricing.publish.chooseVersion')}
            error={errorFor('versionId')}
          />
          <TextField
            label={translate(messages, 'pricing.publish.effectiveFrom')}
            required
            type="date"
            dir="ltr"
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
            error={errorFor('effectiveFrom')}
          />
          <div className="sm:col-span-2">
            <OutcomeNote messages={messages} outcome={outcome} />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
              {translate(messages, 'pricing.publish.submit')}
            </button>
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
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const [recorded, setRecorded] = useState<string | null>(null);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
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
    if (!ISO_DATE.test(from)) found['effectiveFrom'] = 'pricing.common.dateFormat';
    const to = effectiveTo.trim();
    if (to.length > 0 && !ISO_DATE.test(to)) found['effectiveTo'] = 'pricing.common.dateFormat';
    else if (to.length > 0 && to <= from) found['effectiveTo'] = 'pricing.assignment.rangeOrder';
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
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
      setOutcome(null);
      setRecorded(result.created.id);
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
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        noValidate
        aria-labelledby="price-assignment-heading"
        className="grid gap-3 sm:grid-cols-2"
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
        <TextField
          label={translate(messages, 'pricing.rule.customerClass')}
          description={translate(messages, 'pricing.common.classHelp')}
          spellCheck={false}
          dir="ltr"
          value={customerClass}
          onChange={(event) => setCustomerClass(event.target.value)}
          error={errorFor('customerClass')}
        />
        <TextField
          label={translate(messages, 'pricing.rule.priority')}
          description={translate(messages, 'pricing.rule.priorityHelp')}
          inputMode="numeric"
          dir="ltr"
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
          error={errorFor('priority')}
        />
        <TextField
          label={translate(messages, 'pricing.assignment.effectiveFrom')}
          required
          type="date"
          dir="ltr"
          value={effectiveFrom}
          onChange={(event) => setEffectiveFrom(event.target.value)}
          error={errorFor('effectiveFrom')}
        />
        <TextField
          label={translate(messages, 'pricing.assignment.effectiveTo')}
          description={translate(messages, 'pricing.assignment.effectiveToHelp')}
          type="date"
          dir="ltr"
          value={effectiveTo}
          onChange={(event) => setEffectiveTo(event.target.value)}
          error={errorFor('effectiveTo')}
        />
        <div className="sm:col-span-2">
          <OutcomeNote messages={messages} outcome={outcome} />
        </div>
        {recorded ? (
          <p className="text-caption text-text-muted sm:col-span-2">
            {translate(messages, 'pricing.assignment.recordedAs')}{' '}
            <code className="font-mono" dir="ltr">
              {recorded}
            </code>
          </p>
        ) : null}
        <div className="sm:col-span-2">
          <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
            {translate(messages, 'pricing.assignment.submit')}
          </button>
        </div>
      </form>
    </section>
  );
}
