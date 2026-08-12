import { describe, expect, it } from 'vitest';
import {
  CHECK_IN_WIZARD_PATH,
  HANDOFF_CUSTOMER_PARAM,
  HANDOFF_VEHICLE_PARAM,
  checkInWizardHref,
  parseWalkInHandoff,
} from '@/features/receptions/intake/intake-handoff';

/**
 * The intake → check-in handoff contract (`P1-28-FE-006` → `P1-28-FE-007`).
 *
 * Both ends of the handoff live in one module so they cannot disagree; these
 * cases prove the round trip and the refusal of everything that is not a
 * complete, well-formed pair. Wave D's wizard consumes `parseWalkInHandoff`,
 * so the refusal cases here are the wizard's "start from intake" cases.
 */

const CUSTOMER = '9f8e7d6c-5b4a-4392-8172-0e02b2c3d479';
const VEHICLE = 'a1b2c3d4-0000-4000-8000-000000000001';

describe('building the wizard URL', () => {
  it('places the pair under the locale at the wizard path', () => {
    const href = checkInWizardHref('en', { customerId: CUSTOMER, vehicleId: VEHICLE });
    expect(href.startsWith(`/en${CHECK_IN_WIZARD_PATH}?`)).toBe(true);
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get(HANDOFF_CUSTOMER_PARAM)).toBe(CUSTOMER);
    expect(params.get(HANDOFF_VEHICLE_PARAM)).toBe(VEHICLE);
  });

  it('keeps the Arabic locale segment', () => {
    expect(checkInWizardHref('ar', { customerId: CUSTOMER, vehicleId: VEHICLE })).toMatch(
      /^\/ar\//
    );
  });
});

describe('reading the pair back', () => {
  it('round-trips what the intake built', () => {
    const href = checkInWizardHref('en', { customerId: CUSTOMER, vehicleId: VEHICLE });
    const parsed = parseWalkInHandoff(new URLSearchParams(href.split('?')[1]));
    expect(parsed).toEqual({ customerId: CUSTOMER, vehicleId: VEHICLE });
  });

  it('refuses a half pair — a missing vehicle is not a handoff', () => {
    const params = new URLSearchParams({ [HANDOFF_CUSTOMER_PARAM]: CUSTOMER });
    expect(parseWalkInHandoff(params)).toBeNull();
  });

  it('refuses a missing customer', () => {
    const params = new URLSearchParams({ [HANDOFF_VEHICLE_PARAM]: VEHICLE });
    expect(parseWalkInHandoff(params)).toBeNull();
  });

  it('refuses malformed identifiers rather than passing them through', () => {
    for (const bad of ['', 'not-an-identifier', '123', `${CUSTOMER}x`, '../../etc']) {
      const params = new URLSearchParams({
        [HANDOFF_CUSTOMER_PARAM]: bad,
        [HANDOFF_VEHICLE_PARAM]: VEHICLE,
      });
      expect(parseWalkInHandoff(params), `customer=${bad}`).toBeNull();
    }
  });

  it('refuses empty parameters entirely', () => {
    expect(parseWalkInHandoff(new URLSearchParams())).toBeNull();
  });
});
