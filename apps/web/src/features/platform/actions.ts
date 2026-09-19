'use server';

import { z } from 'zod';
import { authorizedClient } from '@/lib/api/server-client';
import {
  VIOLATION_FALLBACK_KEY,
  failureMessageKey,
  overCapacityOf,
  violationMessageKey,
  type ApiFailure,
} from '@/lib/api/client';
import { fromFailure, invalid, success, type ActionState } from '@/lib/forms/action-result';
import type { ProvisionState, SubscriptionAssignState } from './types';

/**
 * The Platform Owner Console mutations (P1-32-PRE-063). This module holds
 * writes only.
 *
 * Each calls exactly one published platform operation, named beside it. None
 * re-checks a permission first: the server decides, and its refusal is what the
 * operator is shown. Idempotency keys are attached by the API client from the
 * generated operation manifest, so a write here never invents one.
 *
 * Money is a decimal string from the form to the wire. It is checked against the
 * same pattern the operation publishes and is never turned into a number.
 *
 * The two reads a client data table drives, the organisation list and the
 * activity search, are Server Actions in `table-reads.ts`, which explains why.
 * Every other console read is server-only, in `api.ts` (P1-32-PRE-068).
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
  acceptOverCapacity: z.boolean().optional(),
  overCapacityReason: reasonSchema.optional(),
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

/**
 * `platform.subscription-assign` — POST /platform/organizations/{tenantId}/subscriptions.
 *
 * A plan smaller than the organisation is refused by the backend, per kind, and
 * the refusal is handed back to the dialog rather than flattened into one
 * sentence: the operator has to see WHICH ceilings would be breached before
 * deciding whether to accept the change deliberately. Accepting takes a reason,
 * and the flag and the reason travel together — the operation refuses either one
 * without the other.
 */
export async function assignSubscriptionAction(
  tenantId: string,
  input: AssignSubscriptionInput
): Promise<SubscriptionAssignState> {
  if (!UUID.test(tenantId)) return invalid({}, 1, 'state.notFound.title');
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return invalid(keysOf(parsed.error), 1);
  if (
    (parsed.data.acceptOverCapacity === true) !==
    (parsed.data.overCapacityReason !== undefined)
  ) {
    return invalid({ overCapacityReason: 'overlay.reasonRequired' }, 1);
  }
  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt: 1 };
  const result = await client.send(
    'POST',
    `${organizationPath(tenantId)}/subscriptions`,
    parsed.data
  );
  if (result.ok) return success('platform.subscription.done', 1);
  const overCapacity = overCapacityOf(result);
  return {
    ...fromFailure(result, 1),
    ...(overCapacity.length > 0 ? { overCapacity } : {}),
  };
}

// --- growing an existing organisation (P1-32-PRE-151) --------------------------

const companySchema = z.object({
  code: z.string().regex(CODE, 'platform.error.required'),
  legalName: z.string().trim().min(1, 'platform.error.required').max(200, 'platform.error.tooLong'),
  baseCurrency: z.string().regex(CURRENCY, 'platform.error.currency'),
  registrationNumber: z.string().trim().max(100, 'platform.error.tooLong').optional(),
  taxRegistrationNumber: z.string().trim().max(100, 'platform.error.tooLong').optional(),
});

/** `platform.organization-company-create` — POST …/{tenantId}/companies. */
export async function addCompanyAction(
  tenantId: string,
  input: z.input<typeof companySchema>
): Promise<ActionState> {
  if (!UUID.test(tenantId)) return invalid({}, 1, 'state.notFound.title');
  const parsed = companySchema.safeParse(input);
  if (!parsed.success) return invalid(keysOf(parsed.error), 1);
  const { registrationNumber, taxRegistrationNumber, ...rest } = parsed.data;
  return send(
    'POST',
    `${organizationPath(tenantId)}/companies`,
    {
      ...rest,
      ...(registrationNumber ? { registrationNumber } : {}),
      ...(taxRegistrationNumber ? { taxRegistrationNumber } : {}),
    },
    'platform.growth.companyDone'
  );
}

const branchSchema = z.object({
  companyId: z.string().regex(UUID, 'platform.error.required'),
  code: z.string().regex(CODE, 'platform.error.required'),
  name: z.string().trim().min(1, 'platform.error.required').max(200, 'platform.error.tooLong'),
  timezone: z.string().trim().min(3, 'platform.error.required').max(64, 'platform.error.tooLong'),
  city: z.string().trim().max(120, 'platform.error.tooLong').optional(),
  countryCode: z
    .string()
    .trim()
    .regex(/^([A-Z]{2})?$/, 'platform.error.country')
    .optional(),
});

/** `platform.organization-branch-create` — POST …/{tenantId}/branches. */
export async function addBranchAction(
  tenantId: string,
  input: z.input<typeof branchSchema>
): Promise<ActionState> {
  if (!UUID.test(tenantId)) return invalid({}, 1, 'state.notFound.title');
  const parsed = branchSchema.safeParse(input);
  if (!parsed.success) return invalid(keysOf(parsed.error), 1);
  const { city, countryCode, ...rest } = parsed.data;
  return send(
    'POST',
    `${organizationPath(tenantId)}/branches`,
    {
      ...rest,
      ...(city ? { city } : {}),
      ...(countryCode ? { countryCode } : {}),
    },
    'platform.growth.branchDone'
  );
}

const administratorSchema = z.object({
  email: z.string().trim().min(3, 'platform.error.email').max(320, 'platform.error.tooLong'),
  displayName: z
    .string()
    .trim()
    .min(1, 'platform.error.required')
    .max(200, 'platform.error.tooLong'),
  additionalAdministrator: z.boolean().optional(),
  reason: reasonSchema.optional(),
});

/**
 * `platform.organization-administrator-invite` — POST …/{tenantId}/administrators.
 *
 * Two acts on one address. Establishing an administrator needs a name and, when
 * the organisation already has one, a reason; sending the link again needs
 * neither, and writes nothing at all.
 */
export async function inviteAdministratorAction(
  tenantId: string,
  input: z.input<typeof administratorSchema>
): Promise<ActionState> {
  if (!UUID.test(tenantId)) return invalid({}, 1, 'state.notFound.title');
  const parsed = administratorSchema.safeParse(input);
  if (!parsed.success) return invalid(keysOf(parsed.error), 1);
  if ((parsed.data.additionalAdministrator === true) !== (parsed.data.reason !== undefined)) {
    return invalid({ reason: 'overlay.reasonRequired' }, 1);
  }
  const { additionalAdministrator, reason, ...rest } = parsed.data;
  return send(
    'POST',
    `${organizationPath(tenantId)}/administrators`,
    {
      mode: 'invite',
      ...rest,
      ...(additionalAdministrator ? { additionalAdministrator: true } : {}),
      ...(reason ? { reason } : {}),
    },
    'platform.growth.inviteDone'
  );
}

/** The same operation in `resend` mode: a fresh link, and nothing written. */
export async function resendAdministratorInvitationAction(
  tenantId: string,
  email: string
): Promise<ActionState> {
  if (!UUID.test(tenantId)) return invalid({}, 1, 'state.notFound.title');
  const parsed = z
    .string()
    .trim()
    .min(3, 'platform.error.email')
    .max(320, 'platform.error.tooLong')
    .safeParse(email);
  if (!parsed.success) return invalid({ email: 'platform.error.email' }, 1);
  return send(
    'POST',
    `${organizationPath(tenantId)}/administrators`,
    { mode: 'resend', email: parsed.data },
    'platform.growth.resendDone'
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

// --- the operator's own credential -------------------------------------------

/**
 * The two refusals `POST /platform/account/password` tells apart, by code.
 *
 * Read from the problem document rather than from the status, because both are
 * 422: one says the current password did not verify, the other says the
 * identity provider refused the new one. Collapsing them would leave the
 * operator guessing which field to change.
 */
const CURRENT_PASSWORD_WRONG = 'ERR-IAM-003';
const NEW_PASSWORD_REFUSED = 'ERR-IAM-004';

const passwordChangeSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, 'platform.error.required')
      .max(200, 'platform.error.tooLong'),
    newPassword: z.string().min(1, 'platform.error.required').max(200, 'platform.error.tooLong'),
    confirmPassword: z.string().min(1, 'platform.error.required'),
  })
  // Two checks, and neither is a strength rule. The identity provider owns
  // strength (ADR-019); a minimum declared here would be a second policy that
  // could disagree with the one actually in force, and the operator would be
  // told a rule nothing enforces.
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'platform.account.error.mismatch',
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    path: ['newPassword'],
    message: 'platform.account.error.unchanged',
  });

export type PasswordChangeInput = z.input<typeof passwordChangeSchema>;

/**
 * `iam.account-password-change` — POST /platform/account/password.
 *
 * Neither password is logged, echoed into a state, or placed in a URL: they
 * travel as arguments of this server function, reach the request body, and are
 * gone. Nothing about them is returned, not even a length.
 *
 * The success sentence depends on what the backend says happened to the
 * operator's other sessions, and says only that. Claiming a revocation the
 * server did not report would be the one thing worse than not performing it.
 */
export async function changeOwnPasswordAction(input: PasswordChangeInput): Promise<ActionState> {
  const parsed = passwordChangeSchema.safeParse(input);
  if (!parsed.success) return invalid(keysOf(parsed.error), 1);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt: 1 };

  const result = await client.send<{ status: string; otherSessions: string }>(
    'POST',
    '/api/v1/platform/account/password',
    { currentPassword: parsed.data.currentPassword, newPassword: parsed.data.newPassword }
  );

  if (!result.ok) {
    const code = result.problem?.code;
    if (code === CURRENT_PASSWORD_WRONG) {
      return {
        status: 'invalid',
        messageKey: 'platform.account.error.currentPassword',
        fieldErrors: { currentPassword: 'platform.account.error.currentPassword' },
        correlationId: result.correlationId,
        attempt: 1,
      };
    }
    if (code === NEW_PASSWORD_REFUSED) {
      return {
        status: 'invalid',
        messageKey: 'platform.account.error.refused',
        fieldErrors: { newPassword: 'platform.account.error.refused' },
        correlationId: result.correlationId,
        attempt: 1,
      };
    }
    return fromFailure(result, 1);
  }

  return success(
    result.data.otherSessions === 'ended-at-provider'
      ? 'platform.account.done'
      : 'platform.account.doneSessionsKept',
    1
  );
}
