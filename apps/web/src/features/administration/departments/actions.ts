'use server';

import { z } from 'zod';
import { authorizedClient } from '@/lib/api/server-client';
import { fromFailure, invalid, success, type ActionState } from '@/lib/forms/action-result';
import { issueKeysByField } from '@/features/authentication/schemas/credentials';

/**
 * Department writes.
 *
 *   `POST  /api/v1/org/departments`                 — `org.department-create`
 *   `PATCH /api/v1/org/departments/{departmentId}` — `org.department-update`
 *
 * Both take `org.department.manage`. The update is version-guarded, and the
 * version comes from the row the operator was looking at; a stale one is a
 * conflict the operator is told about, never retried on their behalf.
 *
 * Retiring is `status = inactive`, not archival: the code stays reserved and the
 * change is reversible, which is the route's own documented reason.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const createSchema = z.object({
  companyId: z.string().regex(UUID, 'departments.branchRequired'),
  branchId: z.string().regex(UUID, 'departments.branchRequired'),
  departmentCode: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/, 'organization.structure.codeHint'),
  name: z.string().trim().min(1, 'field.required').max(200, 'field.tooLong'),
});

export async function createDepartmentAction(
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  const attempt = (previous.attempt ?? 0) + 1;
  const parsed = createSchema.safeParse({
    companyId: String(form.get('companyId') ?? ''),
    branchId: String(form.get('branchId') ?? ''),
    departmentCode: String(form.get('departmentCode') ?? '').trim(),
    name: String(form.get('name') ?? ''),
  });
  if (!parsed.success) return invalid(issueKeysByField(parsed.error), attempt);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send('POST', '/api/v1/org/departments', parsed.data);
  if (!result.ok) return fromFailure(result, attempt);
  return success('departments.created', attempt);
}

const nameSchema = z.string().trim().min(1, 'field.required').max(200, 'field.tooLong');

export async function renameDepartmentAction(
  departmentId: string,
  name: string,
  recordVersion: number
): Promise<ActionState> {
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) {
    return invalid({ name: parsed.error.issues[0]?.message ?? 'field.required' }, 1);
  }
  return update(departmentId, { name: parsed.data }, recordVersion);
}

export async function setDepartmentStatusAction(
  departmentId: string,
  status: 'active' | 'inactive',
  recordVersion: number
): Promise<ActionState> {
  return update(departmentId, { status }, recordVersion);
}

async function update(
  departmentId: string,
  changes: { readonly name?: string; readonly status?: 'active' | 'inactive' },
  recordVersion: number
): Promise<ActionState> {
  if (!UUID.test(departmentId) || !Number.isInteger(recordVersion) || recordVersion < 1) {
    return invalid({}, 1, 'state.notFound.title');
  }
  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt: 1 };

  const result = await client.send(
    'PATCH',
    `/api/v1/org/departments/${encodeURIComponent(departmentId)}`,
    changes,
    { ifMatch: recordVersion }
  );
  if (!result.ok) return fromFailure(result, 1);
  return success('admin.saved', 1);
}
