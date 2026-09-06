'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { SelectField, TextAreaField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import type { ServiceUpdateBody } from '@/lib/contracts/services-contract';

import {
  createServiceVersion,
  listBranches,
  listServiceCategories,
  publishServiceVersion,
  setBranchAvailability,
  updateService,
} from '../api';
import {
  MAX_DESCRIPTION,
  MAX_NAME,
  MAX_NOTES,
  type BranchOption,
  type ServiceCategory,
  type ServiceDetail,
  type ServiceVersion,
} from '../services-contract';
import { LifecycleBadge, OutcomeNote } from './ServiceCatalogueScreen';

/**
 * One service (P1-30, `W1`, FE-001) — `svc.service-detail`, with the four
 * writes that act on it.
 *
 * ## The version the guarded writes send
 *
 * `svc.service-update` and `svc.service-version-publish` are version-guarded
 * and require `If-Match`. The version is the `recordVersion` the page read —
 * for publication too, because `svc.publish_service_version` locks the SERVICE
 * first. After any write that moved it, the page is refreshed so the next
 * write carries the current one; a stale one is a genuine conflict and renders
 * as one, never as a silent overwrite.
 *
 * ## What this screen cannot show, and says
 *
 * There is no read of a service's versions and no read of its availability.
 * The draft this screen creates is held in state for publication because its
 * id exists nowhere else; availability can be verified only through the
 * catalogue's branch filter. Both are stated on the screen rather than faked.
 *
 * ## Retired is terminal
 *
 * `archived` cannot be reversed (`svc.guard_service_lifecycle`), so retiring
 * asks for an explicit acknowledgement, and a retired service offers no writes
 * at all — an edit form on a frozen row would be an invitation to a refusal.
 *
 * No money crosses this screen. `standardMinutes` would, as a decimal string,
 * if a version listed labour times; the create response carries the empty
 * draft's list, which is rendered as a count of entries and nothing more.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const PRIMARY_BUTTON =
  'rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover';
const SECONDARY_BUTTON =
  'rounded-md border border-border bg-surface px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard';

export function ServiceDetailScreen({
  locale,
  messages,
  service,
  canManage,
  canReadBranches,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly service: ServiceDetail;
  readonly canManage: boolean;
  readonly canReadBranches: boolean;
}) {
  const router = useRouter();
  const retired = service.lifecycleStatus === 'archived';
  const categories = useCategories();
  const branches = useBranchList(canReadBranches && canManage && !retired);
  const categoryLabel = useMemo(() => {
    const found = categories.items?.find((category) => category.id === service.categoryId);
    return found ? `${found.code} — ${found.name}` : null;
  }, [categories.items, service.categoryId]);

  return (
    <div className="flex flex-col gap-4" lang={locale}>
      <section
        aria-labelledby="service-summary-heading"
        className="rounded-lg border border-border bg-surface p-4"
      >
        <h2 id="service-summary-heading" className="sr-only">
          {translate(messages, 'services.detail.summaryHeading')}
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Field label={translate(messages, 'services.detail.code')}>
            <code className="font-mono text-caption" dir="ltr">
              {service.serviceCode}
            </code>
          </Field>
          <Field label={translate(messages, 'services.detail.name')}>
            <bdi>{service.name}</bdi>
          </Field>
          <Field label={translate(messages, 'services.detail.category')}>
            {categoryLabel ? (
              <bdi>{categoryLabel}</bdi>
            ) : (
              <code className="font-mono text-caption" dir="ltr">
                {service.categoryId}
              </code>
            )}
          </Field>
          <Field label={translate(messages, 'services.detail.status')}>
            <LifecycleBadge messages={messages} status={service.lifecycleStatus} />
          </Field>
          <Field label={translate(messages, 'services.detail.descriptionLabel')} wide>
            {service.description ? (
              <bdi>{service.description}</bdi>
            ) : (
              <span className="text-text-muted">
                {translate(messages, 'services.detail.noDescription')}
              </span>
            )}
          </Field>
        </dl>
        {retired ? (
          <p className="mt-3 text-body text-text-secondary">
            {translate(messages, 'services.detail.retiredNote')}
          </p>
        ) : null}
      </section>

      {!canManage ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'services.detail.noManagePermission')}
        </p>
      ) : retired ? null : (
        <>
          <EditPanel
            messages={messages}
            service={service}
            categories={categories}
            onDone={() => router.refresh()}
          />
          <AvailabilityPanel messages={messages} service={service} branches={branches} />
          <VersionPanel
            locale={locale}
            messages={messages}
            service={service}
            onPublished={() => router.refresh()}
          />
        </>
      )}
    </div>
  );
}

function Field({
  label,
  wide,
  children,
}: {
  readonly label: string;
  readonly wide?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="text-body text-text-primary">{children}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Reference data
 * ------------------------------------------------------------------ */

interface Categories {
  readonly items: readonly ServiceCategory[] | null;
  readonly refused: string | null;
}

function useCategories(): Categories {
  const [items, setItems] = useState<readonly ServiceCategory[] | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void listServiceCategories().then((state) => {
      if (!live) return;
      if (state.status === 'ok') setItems(state.data.items);
      else setRefused('services.catalogue.categoriesRefused');
    });
    return () => {
      live = false;
    };
  }, []);
  return { items, refused };
}

interface BranchList {
  readonly items: readonly BranchOption[] | null;
  readonly refused: string | null;
  readonly offered: boolean;
}

function useBranchList(wanted: boolean): BranchList {
  const [items, setItems] = useState<readonly BranchOption[] | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    void listBranches().then((state) => {
      if (!live) return;
      if (state.status === 'ok') setItems(state.data.items);
      else setRefused('services.catalogue.branchesRefused');
    });
    return () => {
      live = false;
    };
  }, [wanted]);
  return { items, refused, offered: wanted };
}

/* ------------------------------------------------------------------ *
 * Editing — `svc.service-update`, version-guarded
 * ------------------------------------------------------------------ */

function EditPanel({
  messages,
  service,
  categories,
  onDone,
}: {
  readonly messages: Messages;
  readonly service: ServiceDetail;
  readonly categories: Categories;
  readonly onDone: () => void;
}) {
  const [form, setForm] = useState({
    name: service.name,
    description: service.description ?? '',
    categoryId: service.categoryId,
  });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const [acknowledgeRetire, setAcknowledgeRetire] = useState(false);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const problemKey = (state: ActionState): string =>
    state.status === 'conflict'
      ? 'services.detail.conflict'
      : (state.messageKey ?? 'action.failed');

  const save = async () => {
    const found: Record<string, string> = {};
    const name = form.name.trim();
    if (name.length === 0) found['name'] = 'field.required';
    else if (name.length > MAX_NAME) found['name'] = 'services.create.nameTooLong';
    const description = form.description.trim();
    if (description.length > MAX_DESCRIPTION)
      found['description'] = 'services.create.descriptionTooLong';
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    // Only what changed travels. `description` is three-way: a blank field on a
    // service that had one CLEARS it (`null`); an unchanged field is omitted.
    const body: ServiceUpdateBody = {
      ...(name !== service.name ? { name } : {}),
      ...(form.categoryId !== service.categoryId ? { serviceCategoryId: form.categoryId } : {}),
      ...(description !== (service.description ?? '')
        ? { description: description.length === 0 ? null : description }
        : {}),
    };
    if (Object.keys(body).length === 0) {
      setOutcome({ status: 'invalid', messageKey: 'services.detail.nothingChanged' });
      return;
    }
    setBusy(true);
    const result = await updateService(service.id, body, service.recordVersion);
    setBusy(false);
    notifyActionResult(result, messages);
    if (result.status === 'success') {
      setOutcome(null);
      onDone();
      return;
    }
    setOutcome({ ...result, messageKey: problemKey(result) });
  };

  const retire = async () => {
    if (!acknowledgeRetire) return;
    setBusy(true);
    const result = await updateService(
      service.id,
      { lifecycleStatus: 'archived' },
      service.recordVersion
    );
    setBusy(false);
    notifyActionResult(result, messages);
    if (result.status === 'success') {
      onDone();
      return;
    }
    setOutcome({ ...result, messageKey: problemKey(result) });
  };

  return (
    <section
      aria-labelledby="service-edit-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="service-edit-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'services.detail.editHeading')}
      </h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        noValidate
        className="flex flex-col gap-3"
      >
        <TextField
          label={translate(messages, 'services.create.name')}
          required
          value={form.name}
          onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
          error={errorFor('name')}
        />
        <SelectField
          label={translate(messages, 'services.create.category')}
          {...(categories.refused
            ? { description: translateDynamic(messages, categories.refused) }
            : {})}
          value={form.categoryId}
          onChange={(event) => setForm((f) => ({ ...f, categoryId: event.target.value }))}
          options={(categories.items ?? []).map((category) => ({
            value: category.id,
            label: `${category.code} — ${category.name}`,
          }))}
          error={errorFor('serviceCategoryId')}
        />
        <TextAreaField
          label={translate(messages, 'services.create.description')}
          description={translate(messages, 'services.detail.descriptionHelp')}
          value={form.description}
          onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
          error={errorFor('description')}
        />
        <OutcomeNote messages={messages} outcome={outcome} />
        <div>
          <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
            {translate(messages, 'services.detail.save')}
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <h3 className="text-body font-medium text-text-primary">
          {translate(messages, 'services.detail.retire')}
        </h3>
        <p className="text-caption text-text-muted">
          {translate(messages, 'services.detail.retireConfirm')}
        </p>
        <label className="flex items-center gap-2 text-body text-text-primary">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={acknowledgeRetire}
            onChange={(event) => setAcknowledgeRetire(event.target.checked)}
          />
          {translate(messages, 'services.detail.retireAcknowledge')}
        </label>
        <div>
          <button
            type="button"
            className={`${SECONDARY_BUTTON} text-error`}
            disabled={busy || !acknowledgeRetire}
            onClick={() => void retire()}
          >
            {translate(messages, 'services.detail.retire')}
          </button>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Availability — `svc.branch-availability-set`, branch-scoped
 * ------------------------------------------------------------------ */

function AvailabilityPanel({
  messages,
  service,
  branches,
}: {
  readonly messages: Messages;
  readonly service: ServiceDetail;
  readonly branches: BranchList;
}) {
  const [branchId, setBranchId] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [offered, setOffered] = useState(true);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const listed = branches.offered && branches.items !== null;

  const submit = async () => {
    const found: Record<string, string> = {};
    const branch = branchId.trim();
    if (branch.length === 0) found['branchId'] = 'field.required';
    else if (!UUID.test(branch)) found['branchId'] = 'services.catalogue.branchIdFormat';
    // With a list, the company comes from the chosen branch's own row. Without
    // one, the operator names both halves — the body requires the pair.
    const company = listed
      ? (branches.items?.find((option) => option.id === branch)?.companyId ?? '')
      : companyId.trim();
    if (company.length === 0) found['companyId'] = 'field.required';
    else if (!UUID.test(company)) found['companyId'] = 'services.catalogue.branchIdFormat';
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await setBranchAvailability(service.id, {
      companyId: company,
      branchId: branch,
      isAvailable: offered,
    });
    setBusy(false);
    notifyActionResult(result, messages);
    setOutcome(result.status === 'success' ? null : result);
  };

  return (
    <section
      aria-labelledby="service-availability-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="service-availability-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'services.availability.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'services.availability.explain')}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        noValidate
        className="flex flex-col gap-3"
      >
        {listed ? (
          <SelectField
            label={translate(messages, 'services.availability.branch')}
            required
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
            options={(branches.items ?? []).map((branch) => ({
              value: branch.id,
              label: `${branch.branchCode} — ${branch.name}`,
            }))}
            placeholder={translate(messages, 'services.availability.chooseBranch')}
            error={errorFor('branchId')}
          />
        ) : (
          <>
            <TextField
              label={translate(messages, 'services.availability.companyIdField')}
              description={
                branches.refused
                  ? translateDynamic(messages, branches.refused)
                  : translate(messages, 'services.availability.idHelp')
              }
              required
              spellCheck={false}
              dir="ltr"
              value={companyId}
              onChange={(event) => setCompanyId(event.target.value)}
              error={errorFor('companyId')}
            />
            <TextField
              label={translate(messages, 'services.availability.branchIdField')}
              required
              spellCheck={false}
              dir="ltr"
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
              error={errorFor('branchId')}
            />
          </>
        )}
        <label className="flex items-center gap-2 text-body text-text-primary">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={offered}
            onChange={(event) => setOffered(event.target.checked)}
          />
          {translate(messages, 'services.availability.offered')}
        </label>
        <OutcomeNote messages={messages} outcome={outcome} />
        <div>
          <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
            {translate(messages, 'services.availability.submit')}
          </button>
        </div>
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Versions — create a draft, then publish THAT draft
 * ------------------------------------------------------------------ */

function VersionPanel({
  locale,
  messages,
  service,
  onPublished,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly service: ServiceDetail;
  readonly onPublished: () => void;
}) {
  const [form, setForm] = useState({ effectiveFrom: '', effectiveTo: '', notes: '' });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const [draft, setDraft] = useState<ServiceVersion | null>(null);
  const [publishFrom, setPublishFrom] = useState('');

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const createDraft = async () => {
    const found: Record<string, string> = {};
    const effectiveFrom = form.effectiveFrom.trim();
    if (!ISO_DATE.test(effectiveFrom)) found['effectiveFrom'] = 'services.catalogue.dateFormat';
    const effectiveTo = form.effectiveTo.trim();
    if (effectiveTo.length > 0 && !ISO_DATE.test(effectiveTo)) {
      found['effectiveTo'] = 'services.catalogue.dateFormat';
    } else if (effectiveTo.length > 0 && effectiveTo <= effectiveFrom) {
      // Two ISO dates compare correctly as strings; the range is half-open.
      found['effectiveTo'] = 'services.version.rangeOrder';
    }
    const notes = form.notes.trim();
    if (notes.length > MAX_NOTES) found['notes'] = 'services.version.notesTooLong';
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await createServiceVersion(service.id, {
      effectiveFrom,
      ...(effectiveTo ? { effectiveTo } : {}),
      ...(notes ? { notes } : {}),
    });
    setBusy(false);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      setOutcome(null);
      setDraft(result.created);
      setPublishFrom(result.created.effectiveFrom);
      return;
    }
    setOutcome(result.state);
  };

  const publish = async () => {
    if (!draft) return;
    const from = publishFrom.trim();
    if (!ISO_DATE.test(from)) {
      setErrors({ publishFrom: 'services.catalogue.dateFormat' });
      return;
    }
    setErrors({});
    setBusy(true);
    const result = await publishServiceVersion(
      service.id,
      draft.id,
      { effectiveFrom: from },
      service.recordVersion
    );
    setBusy(false);
    notifyActionResult(result, messages);
    if (result.status === 'success') {
      setDraft(null);
      setOutcome(null);
      onPublished();
      return;
    }
    setOutcome({
      ...result,
      messageKey:
        result.status === 'conflict'
          ? 'services.detail.conflict'
          : (result.messageKey ?? 'action.failed'),
    });
  };

  return (
    <section
      aria-labelledby="service-versions-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="service-versions-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'services.version.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'services.version.explain')}
      </p>

      {draft === null ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void createDraft();
          }}
          noValidate
          className="grid gap-3 sm:grid-cols-2"
        >
          <TextField
            label={translate(messages, 'services.version.effectiveFrom')}
            required
            type="date"
            dir="ltr"
            value={form.effectiveFrom}
            onChange={(event) => setForm((f) => ({ ...f, effectiveFrom: event.target.value }))}
            error={errorFor('effectiveFrom')}
          />
          <TextField
            label={translate(messages, 'services.version.effectiveTo')}
            description={translate(messages, 'services.version.effectiveToHelp')}
            type="date"
            dir="ltr"
            value={form.effectiveTo}
            onChange={(event) => setForm((f) => ({ ...f, effectiveTo: event.target.value }))}
            error={errorFor('effectiveTo')}
          />
          <div className="sm:col-span-2">
            <TextAreaField
              label={translate(messages, 'services.version.notes')}
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
              {translate(messages, 'services.version.createDraft')}
            </button>
          </div>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void publish();
          }}
          noValidate
          aria-labelledby="service-draft-heading"
          className="flex flex-col gap-3 border-t border-border pt-3"
        >
          <h3 id="service-draft-heading" className="text-body font-medium text-text-primary">
            {translate(messages, 'services.version.draftHeading')}
          </h3>
          <dl className="grid gap-3 sm:grid-cols-3">
            <Field label={translate(messages, 'services.version.number')}>
              <code className="font-mono text-caption" dir="ltr">
                {draft.versionNo}
              </code>
            </Field>
            <Field label={translate(messages, 'services.version.effectiveFrom')}>
              <code className="font-mono text-caption" dir="ltr">
                {draft.effectiveFrom}
              </code>
            </Field>
            <Field label={translate(messages, 'services.version.effectiveTo')}>
              {draft.effectiveTo ? (
                <code className="font-mono text-caption" dir="ltr">
                  {draft.effectiveTo}
                </code>
              ) : (
                <span className="text-text-muted">
                  {translate(messages, 'services.version.noEnd')}
                </span>
              )}
            </Field>
          </dl>
          <p className="text-caption text-text-muted">
            {translate(messages, 'services.version.labourNote')}{' '}
            <code className="font-mono" dir="ltr">
              {draft.laborTimes.length}
            </code>
          </p>
          <TextField
            label={translate(messages, 'services.version.publishFrom')}
            required
            type="date"
            dir="ltr"
            value={publishFrom}
            onChange={(event) => setPublishFrom(event.target.value)}
            error={errorFor('publishFrom')}
          />
          <OutcomeNote messages={messages} outcome={outcome} />
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
              {translate(messages, 'services.version.publish')}
            </button>
            <button
              type="button"
              className={SECONDARY_BUTTON}
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setOutcome(null);
              }}
            >
              {translate(messages, 'services.version.discardDraft')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
