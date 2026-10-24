/**
 * The datetime contract after zod 4.5 (P1-32-PRE-OD-DEP8).
 *
 * zod 4.5.0 made seconds mandatory in `z.iso.datetime()` and
 * `z.string().datetime()`. Every API input that uses either form now refuses an
 * instant written to the minute, which it accepted at zod 4.4.3. These
 * assertions pin that contract on two real route schemas, one of each form, so
 * a later zod release that loosens or tightens it again fails here instead of
 * silently changing what the API accepts.
 */
import { describe, expect, it } from 'vitest';
import { Body as LaborCorrectionBody } from '@api/app/api/v1/labor-sessions/[sessionId]/corrections/route';
import { SnapshotBody } from '@api/app/api/v1/reports/[reportCode]/snapshots/route';

const WITH_SECONDS = '2026-10-24T10:15:00Z';
const WITHOUT_SECONDS = '2026-10-24T10:15Z';

describe('API datetime inputs require seconds', () => {
  it('z.string().datetime({ offset: true }): the labour-session correction body', () => {
    const body = (startedAt: string) => ({
      startedAt,
      endedAt: '2026-10-24T11:15:00Z',
      reason: 'clock correction',
    });
    expect(LaborCorrectionBody.safeParse(body(WITH_SECONDS)).success).toBe(true);
    expect(LaborCorrectionBody.safeParse(body('2026-10-24T10:15:00+03:00')).success).toBe(true);
    expect(LaborCorrectionBody.safeParse(body(WITHOUT_SECONDS)).success).toBe(false);
    expect(LaborCorrectionBody.safeParse(body('2026-10-24T10:15+03:00')).success).toBe(false);
  });

  it('z.iso.datetime({ offset: true }): the report snapshot body', () => {
    const body = (asOf: string) => ({
      companyId: '00000000-0000-4000-8000-000000000001',
      branchId: '00000000-0000-4000-8000-000000000002',
      from: '2026-10-01',
      to: '2026-10-24',
      asOf,
    });
    expect(SnapshotBody.safeParse(body(WITH_SECONDS)).success).toBe(true);
    expect(SnapshotBody.safeParse(body(WITHOUT_SECONDS)).success).toBe(false);
  });
});
