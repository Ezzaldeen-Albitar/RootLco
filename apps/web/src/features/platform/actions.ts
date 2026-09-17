'use server';

import { z } from 'zod';
import { authorizedClient } from '@/lib/api/server-client';
import {
  VIOLATION_FALLBACK_KEY,
  failureMessageKey,
  violationMessageKey,
  type ApiFailure,
} from '@/lib/api/client';
import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { query } from '@/lib/api/read-operation';
import { fromFailure, invalid, success, type ActionState } from '@/lib/forms/action-result';
import { readPage } from './api';
import type {
  OrganizationRow,
  PlatformAuditCriteria,
  PlatformAuditEvent,
  ProvisionState,
} from './types';

/**
 * The Platform Owner Console mutations (P1-32-PRE-063), and the two reads a
 * client data table drives (P1-32-PRE-068).
 *
 * Each calls exactly one published platform operation, named beside it. None
 * re-checks a permission first: the server decides, and its refusal is what the
 * operator is shown. Idempotency keys are attached by the API client from the
 * generated operation manifest, so a write here never invents one.
 *
 * Money is a decimal string from the form to the wire. It is checked against the
 * same pattern the operation publishes and is never turned into a number.
 *
 * ## Why two READS live in the actions module
 *
 * Every other console read is server-only, in `api.ts`, reachable only from the
 * page that gates it. These two are not: the organisation list and the activity
 * search are paged and searched by a client data table AFTER render, so the
 * browser has to be able to call them. They are the named, deliberate exception
 * to "console reads are not Server Actions", and each is refused by its backend
 * operation without the platform code it declares — `platform.organization.read`
 * and `platform.audit.read` — which is what makes the exception safe rather than
 * merely convenient.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^\d{1,14}(\.\d{1,4})?$/;
const CODE = /^[a-z][a-z0-9_]{1,62}$/;
const CURRENCY = /^[A-Z]{3}$/;

const reasonSchema = z
  .string()
  .trim()
  .min(1, 'overlay.reasonRequired')
  .max(500, 'platform.error.tooLong');
const positiveAmount = z
  .string()
  .trim()
  .regex(DECIMAL, 'platform.error.amount')
  .refine((value) => /[1-9]/.test(value), 'platform.error.amount');

function keysOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path.map(String).join('.') || 'form';
    if (!(field in out)) out[field] = issue.message;
  }
  return out;
}

async function send(
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown,
  doneKey: string,
  options: { readonly ifMatch?: number } = {}
): Promise<ActionState> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt: 1 };
  const result = await client.send(method, path, body, {
    ...(options.ifMatch !== undefined ? { ifMatch: options.ifMatch } : {}),
  });
  if (!result.ok) return fromFailure(result, 1);
  return success(doneKey, 1);
}

const organizationPath = (tenantId: string) =>
  `/api/v1/platform/organizations/${encodeURIComponent(tenantId)}`;

// --- the two browser-callable reads -------------------------------------------

/** `platform.organization-read` — one page of organisations, searched and filtered. */
export async function listOrganizations(
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<OrganizationRow>> {
  const status = request.filters.find((filter) => filter.key === 'status')?.value;
  const q = request.search.trim();
  return readPage<OrganizationRow>(
    '/api/v1/platform/organizations' +
      query({
        q: q.length > 0 ? q.slice(0, 100) : undefined,
        status,
        cursor,
        limit: request.pageSize,
      })
  );
}

/** `platform.audit-search` — one page of the operator's own trail in a bounded window. */
export async function searchPlatformAudit(
  criteria: PlatformAuditCriteria,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<PlatformAuditEvent>> {
  const organizationId =
    criteria.organizationId && UUID.test(criteria.organizationId)
      ? criteria.organizationId
      : undefined;
  return readPage<PlatformAuditEvent>(
    '/api/v1/platform/audit-events' +
      query({
        from: criteria.from,
        to: criteria.to,
        action: criteria.action || undefined,
        targetTenantId: organizationId,
        cursor,
        limit: request.pageSize,
      })
  );
}

// --- provisioning -------------------------------------------------------------

const provisionSchema = z.object({
  tenantCode: z.string().trim().min(2, 'platform.error.required').max(63, 'platform.error.tooLong'),
  tenantName: z
    .string()
    .trim()
    .min(1, 'platform.error.required')
    .max(200, 'platform.error.tooLong'),
  tenantLocale: z
    .string()
    .trim()
    .min(2, 'platform.error.required')
    .max(35, 'platform.error.tooLong'),
  tenantTimezone: z
    .string()
    .trim()
    .min(1, 'platform.error.required')
    .max(64, 'platform.error.tooLong'),
  companyCode: z
    .string()
    .trim()
    .min(1, 'platform.error.required')
    .max(63, 'platform.error.tooLong'),
  companyLegalName: z
    .string()
    .trim()
    .min(1, 'platform.error.required')
    .max(200, 'platform.error.tooLong'),
  companyCurrency: z.string().trim().regex(CURRENCY, 'platform.error.currency'),
  companyRegistration: z.string().trim().max(100, 'platform.error.tooLong'),
  companyTaxRegistration: z.string().trim().max(100, 'platform.error.tooLong'),
  branchCode: z.string().trim().min(1, 'platform.error.required').max(63, 'platform.error.tooLong'),
  branchName: z
    .string()
    .trim()
    .min(1, 'platform.error.required')
    .max(200, 'platform.error.tooLong'),
  branchCity: z.string().trim().max(120, 'platform.error.tooLong'),
  branchCountry: z
    .string()
    .trim()
    .regex(/^([A-Z]{2})?$/, 'platform.error.country'),
  branchTimezone: z
    .string()
    .trim()
    .min(1, 'platform.error.required')
    .max(64, 'platform.error.tooLong'),
  ownerEmail: z.string().trim().min(3, 'platform.error.email').max(320, 'platform.error.tooLong'),
  ownerDisplayName: z
    .string()
    .trim()
    .min(1, 'platform.error.required')
    .max(200, 'platform.error.tooLong'),
  planCode: z
    .string()
    .trim()
    .regex(/^([a-z][a-z0-9_]{1,62})?$/, 'platform.error.required'),
  subscriptionStart: z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/, 'platform.error.date'),
  activate: z.boolean(),
});

/**
 * Wire path → form control. The provisioning document nests four parts that
 * share leaf names (`code`, `timezone`), so the leaf alone cannot place an error.
 */
const PROVISION_CONTROL_BY_PATH: Readonly<Record<string, string>> = {
  'body.tenant.code': 'tenantCode',
  'body.tenant.display_name': 'tenantName',
  'body.tenant.locale': 'tenantLocale',
  'body.tenant.timezone': 'tenantTimezone',
  'body.company.code': 'companyCode',
  'body.company.legal_name': 'companyLegalName',
  'body.company.base_currency': 'companyCurrency',
  'body.company.registration_number': 'companyRegistration',
  'body.company.tax_registration_number': 'companyTaxRegistration',
  'body.branch.code': 'branchCode',
  'body.branch.name': 'branchName',
  'body.branch.city': 'branchCity',
  'body.branch.country_code': 'branchCountry',
  'body.branch.timezone': 'branchTimezone',
  'body.owner.email': 'ownerEmail',
  'body.owner.displayName': 'ownerDisplayName',
  'body.subscription.plan_code': 'planCode',
  'body.subscription.effective_from': 'subscriptionStart',
};

function provisionFailure(failure: ApiFailure, attempt: number): ProvisionState {
  const fieldErrors: Record<string, string> = {};
  let formKey: string | null = null;
  for (const violation of failure.problem?.violations ?? []) {
    if (typeof violation?.path !== 'string' || typeof violation?.rule !== 'string') continue;
    const key = violationMessageKey(violation.rule);
    const control = PROVISION_CONTROL_BY_PATH[violation.path];
    if (control) {
      if (!(control in fieldErrors)) fieldErrors[control] = key;
    } else if (formKey === null && key !== VIOLATION_FALLBACK_KEY) {
      formKey = key;
    }
  }
  const base = fromFailure(failure, attempt);
  return {
    ...base,
    messageKey:
      failure.kind === 'conflict'
        ? 'platform.provision.conflict'
        : (formKey ?? base.messageKey ?? failureMessageKey(failure)),
    ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
  };
}

/** `platform.organization-provision` — POST /platform/organizations. */
export async function provisionOrganizationAction(
  previous: ProvisionState,
  form: FormData
): Promise<ProvisionState> {
  const attempt = (previous.attempt ?? 0) + 1;
  const text = (name: string) => String(form.get(name) ?? '');
  const parsed = provisionSchema.safeParse({
    tenantCode: text('tenantCode'),
    tenantName: text('tenantName'),
    tenantLocale: text('tenantLocale'),
    tenantTimezone: text('tenantTimezone'),
    companyCode: text('companyCode'),
    companyLegalName: text('companyLegalName'),
    companyCurrency: text('companyCurrency').toUpperCase(),
    companyRegistration: text('companyRegistration'),
    companyTaxRegistration: text('companyTaxRegistration'),
    branchCode: text('branchCode'),
    branchName: text('branchName'),
    branchCity: text('branchCity'),
    branchCountry: text('branchCountry').toUpperCase(),
    branchTimezone: text('branchTimezone'),
    ownerEmail: text('ownerEmail'),
    ownerDisplayName: text('ownerDisplayName'),
    planCode: text('planCode'),
    subscriptionStart: text('subscriptionStart'),
    activate: form.get('activate') === 'on',
  });
  if (!parsed.success) return invalid(keysOf(parsed.error), attempt);
  const input = parsed.data;
  if (input.subscriptionStart && !input.planCode) {
    return invalid({ planCode: 'platform.error.required' }, attempt);
  }

  const optional = (value: string) => (value.length > 0 ? value : undefined);
  const body = {
    tenant: {
      code: input.tenantCode,
      display_name: input.tenantName,
      locale: input.tenantLocale,
      timezone: input.tenantTimezone,
    },
    company: {
      code: input.companyCode,
      legal_name: input.companyLegalName,
      base_currency: input.companyCurrency,
      registration_number: optional(input.companyRegistration),
      tax_registration_number: optional(input.companyTaxRegistration),
    },
    branch: {
      code: input.branchCode,
      name: input.branchName,
      city: optional(input.branchCity),
      country_code: optional(input.branchCountry),
      timezone: input.branchTimezone,
    },
    owner: { email: input.ownerEmail, displayName: input.ownerDisplayName },
    ...(input.planCode
      ? {
          subscription: {
            plan_code: input.planCode,
            effective_from: optional(input.subscriptionStart),
          },
        }
      : {}),
    ...(input.activate ? { activate: true } : {}),
  };

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };
  const result = await client.send<{ readonly tenantId: string }>(
    'POST',
    '/api/v1/platform/organizations',
    body
  );
  if (!result.ok) return provisionFailure(result, attempt);
  return {
    status: 'success',
    messageKey: 'platform.provision.done',
    attempt,
    tenantId: typeof result.data?.tenantId === 'string' ? result.data.tenantId : undefined,
  };
}

// --- lifecycle ----------------------------------------------------------------

/** `platform.organization-lifecycle` — POST /platform/organizations/{tenantId}/status. */
export async function changeOrganizationStatusAction(
  tenantId: string,
  to: 'active' | 'suspended' | 'closed',
  reason: string
): Promise<ActionState> {
  if (!UUID.test(tenantId)) return invalid({}, 1, 'state.notFound.title');
  if (!['active', 'suspended', 'closed'].includes(to)) return invalid({}, 1);
  const checked = reasonSchema.safeParse(reason);
  if (!checked.success)
    return invalid({ reason: 'overlay.reasonRequired' }, 1, 'overlay.reasonRequired');
  return send(
    'POST',
    `${organizationPath(tenantId)}/status`,
    { to, reason: checked.data },
    'platform.lifecycle.done'
  );
}

// --- subscriptions ------------------------------------------------------------

const assignSchema = z.object({
  planCode: z.string().regex(CODE, 'platform.error.plan'),
  effectiveFrom: z.string().regex(DATE, 'platform.error.date'),
  termMonths: z
    .number({ message: 'platform.error.term' })
    .int('platform.error.term')
    .min(1, 'platform.error.term')
    .max(120, 'platform.error.term')
    .optional(),
  kind: z.enum(['assigned', 'renewed', 'upgraded', 'downgraded']),
  reason: reasonSchema,
});

export type AssignSubscriptionInput = z.input<typeof assignSchema>;

/** `platform.subscription-assign` — POST /platform/organizations/{tenantId}/subscriptions. */
export async function assignSubscriptionAction(
  tenantId: string,
  input: AssignSubscriptionInput
): Promise<ActionState> {
  if (!UUID.test(tenantId)) return invalid({}, 1, 'state.notFound.title');
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return invalid(keysOf(parsed.error), 1);
  return send(
    'POST',
    `${organizationPath(tenantId)}/subscriptions`,
    parsed.data,
    'platform.subscription.done'
  );
}

const cancelSchema = z.object({
  effectiveTo: z.string().regex(DATE, 'platform.error.date'),
  reason: reasonSchema,
});

/** `platform.subscription-cancel` — POST …/subscriptions/{subscriptionId}/cancellation. */
export async function cancelSubscriptionAction(
  tenantId: string,
  subscriptionId: string,
  input: z.input<typeof cancelSchema>
): Promise<ActionState> {
  if (!UUID.test(tenantId) || !UUID.test(subscriptionId)) {
    return invalid({}, 1, 'state.notFound.title');
  }
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return invalid(keysOf(parsed.error), 1);
  return send(
    'POST',
    `${organizationPath(tenantId)}/subscriptions/${encodeURIComponent(subscriptionId)}/cancellation`,
    parsed.data,
    'platform.subscription.cancelled'
  );
}

// --- billing ------------------------------------------------------------------

const chargeSchema = z.object({
  subscriptionId: z.string().regex(UUID).optional(),
  amount: positiveAmount,
  currencyCode: z.string().regex(CURRENCY, 'platform.error.currency'),
  dueOn: z.string().regex(DATE, 'platform.error.date'),
  description: z
    .string()
    .trim()
    .min(1, 'platform.error.required')
    .max(500, 'platform.error.tooLong'),
});

/** `platform.charge-record` — POST /platform/organizations/{tenantId}/charges. */
export async function recordChargeAction(
  tenantId: string,
  input: z.input<typeof chargeSchema>
): Promise<ActionState> {
  if (!UUID.test(tenantId)) return invalid({}, 1, 'state.notFound.title');
  const parsed = chargeSchema.safeParse(input);
  if (!parsed.success) return invalid(keysOf(parsed.error), 1);
  return send(
    'POST',
    `${organizationPath(tenantId)}/charges`,
    parsed.data,
    'platform.billing.chargeDone'
  );
}

const receiptSchema = z.object({
  chargeId: z.string().regex(UUID, 'platform.error.required'),
  amount: positiveAmount,
  currencyCode: z.string().regex(CURRENCY, 'platform.error.currency').optional(),
  receivedOn: z.string().regex(DATE, 'platform.error.date'),
  reference: z.string().trim().min(1).max(200, 'platform.error.tooLong').optional(),
  method: z.string().trim().min(1, 'platform.error.required').max(100, 'platform.error.tooLong'),
  notes: z.string().trim().min(1).max(2000, 'platform.error.tooLong').optional(),
});

/** `platform.receipt-record` — POST /platform/organizations/{tenantId}/receipts. */
export async function recordReceiptAction(
  tenantId: string,
  input: z.input<typeof receiptSchema>
): Promise<ActionState> {
  if (!UUID.test(tenantId)) return invalid({}, 1, 'state.notFound.title');
  const parsed = receiptSchema.safeParse(input);
  if (!parsed.success) return invalid(keysOf(parsed.error), 1);
  return send(
    'POST',
    `${organizationPath(tenantId)}/receipts`,
    parsed.data,
    'platform.billing.receiptDone'
  );
}

/** `platform.charge-void` — POST …/charges/{chargeId}/void. */
export async function voidChargeAction(
  tenantId: string,
  chargeId: string,
  reason: string
): Promise<ActionState> {
  if (!UUID.test(tenantId) || !UUID.test(chargeId)) return invalid({}, 1, 'state.notFound.title');
  const checked = reasonSchema.safeParse(reason);
  if (!checked.success)
    return invalid({ reason: 'overlay.reasonRequired' }, 1, 'overlay.reasonRequired');
  return send(
    'POST',
    `${organizationPath(tenantId)}/charges/${encodeURIComponent(chargeId)}/void`,
    { reason: checked.data },
    'platform.billing.voidDone'
  );
}

// --- plans --------------------------------------------------------------------

const limit = z
  .number({ message: 'platform.error.limit' })
  .int('platform.error.limit')
  .min(0, 'platform.error.limit')
  .max(1_000_000, 'platform.error.limit')
  .optional();

const planSchema = z.object({
  planCode: z.string().regex(CODE, 'platform.error.planCode'),
  displayName: z
    .string()
    .trim()
    .min(1, 'platform.error.required')
    .max(200, 'platform.error.tooLong'),
  description: z.string().trim().max(2000, 'platform.error.tooLong').optional(),
  listPrice: z.string().trim().regex(DECIMAL, 'platform.error.price').optional(),
  currencyCode: z.string().regex(CURRENCY, 'platform.error.currency').optional(),
  termMonths: z
    .number({ message: 'platform.error.term' })
    .int('platform.error.term')
    .min(1, 'platform.error.term')
    .max(120, 'platform.error.term')
    .optional(),
  capacityLimits: z.object({ companies: limit, branches: limit, users: limit }),
  entitlementDocument: z.record(z.string().regex(CODE), z.boolean()),
  status: z.enum(['draft', 'active', 'retired']),
  effectiveFrom: z.string().regex(DATE, 'platform.error.date'),
  effectiveTo: z.string().regex(DATE, 'platform.error.date').optional(),
});

export type PlanInput = z.input<typeof planSchema>;

/** `platform.plan-create` — POST /platform/plans. */
export async function createPlanAction(input: PlanInput): Promise<ActionState> {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return invalid(keysOf(parsed.error), 1);
  if ((parsed.data.listPrice === undefined) !== (parsed.data.currencyCode === undefined)) {
    return invalid({ currencyCode: 'platform.error.priceCurrency' }, 1);
  }
  const { description, ...rest } = parsed.data;
  return send(
    'POST',
    '/api/v1/platform/plans',
    { ...rest, ...(description ? { description } : {}) },
    'platform.plans.created'
  );
}

/**
 * `platform.plan-update` — PATCH /platform/plans/{planId} under If-Match.
 *
 * The plan code and start date are frozen once a version exists, so they are
 * not sent. A blank price, currency or term is sent as a clearing value; the
 * version the operator was looking at is the one the change is guarded by.
 */
export async function updatePlanAction(
  planId: string,
  recordVersion: number,
  input: PlanInput
): Promise<ActionState> {
  if (!UUID.test(planId) || !Number.isInteger(recordVersion) || recordVersion < 1) {
    return invalid({}, 1, 'state.notFound.title');
  }
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return invalid(keysOf(parsed.error), 1);
  if ((parsed.data.listPrice === undefined) !== (parsed.data.currencyCode === undefined)) {
    return invalid({ currencyCode: 'platform.error.priceCurrency' }, 1);
  }
  const data = parsed.data;
  return send(
    'PATCH',
    `/api/v1/platform/plans/${encodeURIComponent(planId)}`,
    {
      displayName: data.displayName,
      ...(data.description ? { description: data.description } : {}),
      listPrice: data.listPrice ?? null,
      currencyCode: data.currencyCode ?? null,
      termMonths: data.termMonths ?? null,
      capacityLimits: data.capacityLimits,
      entitlementDocument: data.entitlementDocument,
      status: data.status,
      effectiveTo: data.effectiveTo ?? null,
    },
    'platform.plans.updated',
    { ifMatch: recordVersion }
  );
}
