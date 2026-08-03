'use server';

import { z } from 'zod';
import { authorizedClient } from '@/lib/api/server-client';
import { fromFailure, invalid, success, type ActionState } from '@/lib/forms/action-result';
import { issueKeysByField } from '@/features/authentication/schemas/credentials';

/**
 * Role, permission-mapping and approval-limit mutations.
 *
 * ## Money is a string, from the keyboard to the wire
 *
 * `iam.approval-limit-create` takes `amount` as a decimal string matched by
 * `^\d{1,14}(\.\d{1,4})?$`, because the column is `numeric(18,4)` and a
 * JavaScript number cannot hold it exactly. Nothing in this file calls
 * `Number()`, `parseFloat`, `toFixed`, or any arithmetic operator on an amount.
 * The operator's text is validated as a string and sent as a string.
 *
 * ## Privilege escalation is the backend's call, and it takes it
 *
 * `assertDelegable` refuses a permission the actor does not itself hold, and
 * `assertNotSystemRole` refuses a built-in role outright. This layer does not
 * duplicate either check — a second implementation of an authorization rule is a
 * second place for it to be wrong, and the one that would be wrong is the one
 * with no database behind it. What the interface does is warn before a
 * high-risk grant, which is advice, not enforcement.
 */

const ROLE_CODE = /^[a-z][a-z0-9_]{1,62}$/;
const PERMISSION_CODE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
const AMOUNT = /^\d{1,14}(\.\d{1,4})?$/;
const CURRENCY = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// --- roles -------------------------------------------------------------------

const createRoleSchema = z.object({
  roleCode: z.string().trim().regex(ROLE_CODE, 'roles.field.codeHint'),
  name: z.string().trim().min(1, 'field.required').max(200),
  description: z.string().trim().max(1000).optional(),
});

export async function createRoleAction(
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  const attempt = (previous.attempt ?? 0) + 1;
  const parsed = createRoleSchema.safeParse({
    roleCode: String(form.get('roleCode') ?? ''),
    name: String(form.get('name') ?? ''),
    description: String(form.get('description') ?? '') || undefined,
  });
  if (!parsed.success) return invalid(issueKeysByField(parsed.error), attempt);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send('POST', '/api/v1/iam/roles', parsed.data);
  if (!result.ok) return fromFailure(result, attempt);
  return success('admin.saved', attempt);
}

export async function updateRoleAction(
  roleId: string,
  recordVersion: number,
  changes: { readonly name?: string; readonly description?: string; readonly archive?: boolean }
): Promise<ActionState> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt: 1 };

  const result = await client.send(
    'PATCH',
    `/api/v1/iam/roles/${encodeURIComponent(roleId)}`,
    changes,
    { ifMatch: recordVersion }
  );
  if (!result.ok) return fromFailure(result, 1);
  return success('admin.saved', 1);
}

// --- role permissions --------------------------------------------------------

export async function addRolePermissionAction(
  roleId: string,
  permissionCode: string,
  effect: 'allow' | 'deny'
): Promise<ActionState> {
  if (!PERMISSION_CODE.test(permissionCode)) {
    return invalid({ permissionCode: 'field.required' }, 1);
  }
  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt: 1 };

  const result = await client.send(
    'POST',
    `/api/v1/iam/roles/${encodeURIComponent(roleId)}/permissions`,
    { permissionCode, effect }
  );
  if (!result.ok) return fromFailure(result, 1);
  return success('admin.saved', 1);
}

export async function removeRolePermissionAction(
  roleId: string,
  mappingId: string
): Promise<ActionState> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt: 1 };

  const result = await client.send(
    'DELETE',
    `/api/v1/iam/roles/${encodeURIComponent(roleId)}/permissions/${encodeURIComponent(mappingId)}`
  );
  if (!result.ok) return fromFailure(result, 1);
  return success('admin.saved', 1);
}

// --- approval limits ---------------------------------------------------------

const limitSchema = z
  .object({
    companyId: z.string().trim().regex(UUID, 'approvalLimits.field.companyId'),
    subject: z.enum(['role', 'user']),
    roleId: z.string().trim().optional(),
    userId: z.string().trim().optional(),
    limitType: z.string().trim().regex(ROLE_CODE, 'approvalLimits.field.limitTypeHint'),
    // A STRING. Validated by pattern, never parsed into a number.
    amount: z.string().trim().regex(AMOUNT, 'approvalLimits.error.amount'),
    currency: z.string().trim().regex(CURRENCY, 'approvalLimits.error.currency'),
    effectiveFrom: z.string().trim().regex(DATE, 'approvalLimits.error.date'),
    effectiveTo: z.string().trim().regex(DATE, 'approvalLimits.error.date').optional(),
  })
  .refine(
    (value) =>
      value.subject === 'role'
        ? UUID.test(value.roleId ?? '')
        : UUID.test(value.userId ?? ''),
    { path: ['subject'], message: 'approvalLimits.error.subject' }
  );

export async function createApprovalLimitAction(
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  const attempt = (previous.attempt ?? 0) + 1;
  const parsed = limitSchema.safeParse({
    companyId: String(form.get('companyId') ?? ''),
    subject: String(form.get('subject') ?? 'role'),
    roleId: String(form.get('roleId') ?? '') || undefined,
    userId: String(form.get('userId') ?? '') || undefined,
    limitType: String(form.get('limitType') ?? ''),
    amount: String(form.get('amount') ?? ''),
    currency: String(form.get('currency') ?? '').toUpperCase(),
    effectiveFrom: String(form.get('effectiveFrom') ?? ''),
    effectiveTo: String(form.get('effectiveTo') ?? '') || undefined,
  });
  if (!parsed.success) return invalid(issueKeysByField(parsed.error), attempt);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const value = parsed.data;
  const result = await client.send('POST', '/api/v1/iam/approval-limits', {
    companyId: value.companyId,
    roleId: value.subject === 'role' ? value.roleId : null,
    userId: value.subject === 'user' ? value.userId : null,
    limitType: value.limitType,
    amount: value.amount,
    currency: value.currency,
    effectiveFrom: value.effectiveFrom,
    ...(value.effectiveTo ? { effectiveTo: value.effectiveTo } : {}),
  });

  if (!result.ok) return fromFailure(result, attempt);
  return success('admin.saved', attempt);
}

export async function endApprovalLimitAction(
  limitId: string,
  recordVersion: number,
  effectiveTo: string
): Promise<ActionState> {
  if (!DATE.test(effectiveTo)) return invalid({ effectiveTo: 'approvalLimits.error.date' }, 1);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt: 1 };

  const result = await client.send(
    'PATCH',
    `/api/v1/iam/approval-limits/${encodeURIComponent(limitId)}`,
    { effectiveTo },
    { ifMatch: recordVersion }
  );
  if (!result.ok) return fromFailure(result, 1);
  return success('admin.saved', 1);
}
