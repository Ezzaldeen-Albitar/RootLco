'use server';

import { z } from 'zod';
import { authorizedClient } from '@/lib/api/server-client';
import { fromFailure, invalid, success, type ActionState } from '@/lib/forms/action-result';
import { issueKeysByField } from '@/features/authentication/schemas/credentials';

/**
 * Employee register writes.
 *
 *   `POST /api/v1/org/employees`                      — `org.employee-create`
 *   `POST /api/v1/org/employees/{employeeId}/status`  — `org.employee-status-set`
 *
 * Both take `org.employee.manage`. The status change is version-guarded, and the
 * version comes from the row the operator was looking at.
 *
 * There is no rename: the platform publishes no operation that changes an
 * employee's display name, so this module offers none.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const createSchema = z.object({
  companyId: z.string().regex(UUID, 'departments.branchRequired'),
  branchId: z.string().regex(UUID, 'departments.branchRequired'),
  displayName: z.string().trim().min(1, 'field.required').max(200, 'field.tooLong'),
  userAccountId: z.string().regex(UUID, 'field.invalid').optional(),
  employmentRef: z.string().trim().min(1).max(64, 'field.tooLong').optional(),
});

export async function createEmployeeAction(
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  const attempt = (previous.attempt ?? 0) + 1;
  const parsed = createSchema.safeParse({
    companyId: String(form.get('companyId') ?? ''),
    branchId: String(form.get('branchId') ?? ''),
    displayName: String(form.get('displayName') ?? ''),
    userAccountId: text(form.get('userAccountId')),
    employmentRef: text(form.get('employmentRef')),
  });
  if (!parsed.success) return invalid(issueKeysByField(parsed.error), attempt);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.message', attempt };

  const { userAccountId, employmentRef, ...required } = parsed.data;
  const result = await client.send('POST', '/api/v1/org/employees', {
    ...required,
    ...(userAccountId === undefined ? {} : { userAccountId }),
    ...(employmentRef === undefined ? {} : { employmentRef }),
  });
  if (!result.ok) return fromFailure(result, attempt);
  return success('employees.created', attempt);
}

export async function setEmployeeStatusAction(
  employeeId: string,
  status: 'active' | 'inactive',
  recordVersion: number
): Promise<ActionState> {
  if (!UUID.test(employeeId) || !Number.isInteger(recordVersion) || recordVersion < 1) {
    return invalid({}, 1, 'state.notFound.title');
  }
  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.message', attempt: 1 };

  const result = await client.send(
    'POST',
    `/api/v1/org/employees/${encodeURIComponent(employeeId)}/status`,
    { status },
    { ifMatch: recordVersion }
  );
  if (!result.ok) return fromFailure(result, 1);
  return success('admin.saved', 1);
}

function text(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
