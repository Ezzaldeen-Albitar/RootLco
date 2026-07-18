/** Controlled-package content assertions without embedding customer identity. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageDocument = JSON.parse(
  readFileSync(
    join(__dirname, '..', 'supabase', 'packages', 'pilot-provisioning.package.json'),
    'utf8'
  )
);

describe('controlled pilot provisioning package', () => {
  it('preserves approved draft configuration and leaves unknown facts null', () => {
    expect(packageDocument.plan.plan_code).toBe('pilot');
    expect(packageDocument.provisioning.tenant.locale).toBe('ar');
    expect(packageDocument.provisioning.tenant.timezone).toBe('Asia/Amman');
    expect(packageDocument.provisioning.subscription.status).toBe('draft');
    expect(packageDocument.provisioning.company.base_currency).toBe('JOD');
    expect(packageDocument.provisioning.company.registration_number).toBeNull();
    expect(packageDocument.provisioning.company.tax_registration_number).toBeNull();
    expect(packageDocument.provisioning.sequences).toEqual([
      { code: 'org_document', prefix_template: 'DOC-', pad_width: 6 },
    ]);
    expect(packageDocument.idempotency_key).toBeTruthy();
  });
});
