import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CHECK_IN_WIZARD_PATH,
  HANDOFF_CUSTOMER_PARAM,
  HANDOFF_VEHICLE_PARAM,
  checkInWizardHref,
  parseWalkInHandoff,
  walkInHandoffFromQuery,
} from '@/features/receptions/intake/intake-handoff';

/**
 * The intake → check-in handoff contract (`P1-28-FE-006` → `P1-28-FE-007`).
 *
 * Both ends of the handoff live in one module so they cannot disagree; these
 * cases prove the round trip and the refusal of everything that is not a
 * complete, well-formed pair. The wizard's start screen consumes
 * `parseWalkInHandoff` through `walkInHandoffFromQuery`, so the refusal cases
 * here are the wizard's "start from intake" cases.
 *
 * ## One module is not agreement — the address was wrong for three waves
 *
 * `CHECK_IN_WIZARD_PATH` read `/reception/check-in` while the wizard mounted at
 * `/receptions/check-in`, and every test agreed with it, because every test
 * compared the link to the constant that built it. A shared constant makes two
 * ends consistent; only a check against the ROUTE TREE makes them right. That
 * is the first case below, and it is the one that would have failed.
 */

const CUSTOMER = '9f8e7d6c-5b4a-4392-8172-0e02b2c3d479';
const VEHICLE = 'a1b2c3d4-0000-4000-8000-000000000001';

const APP_ROUTES = join(fileURLToPath(new URL('../src/app', import.meta.url)), '[locale]');

describe('the address the constant names', () => {
  it('resolves to a route directory that really exists', () => {
    const segments = CHECK_IN_WIZARD_PATH.split('/').filter((part) => part !== '');
    const route = join(APP_ROUTES, '(dashboard)', ...segments);
    expect(existsSync(join(route, 'page.tsx')), `${CHECK_IN_WIZARD_PATH} has no page.tsx`).toBe(
      true
    );
  });

  it('is the plural segment — the singular one holds the intake, not the wizard', () => {
    // Stated as a fact about the tree rather than about the constant, so the
    // two cannot be "fixed" together in the wrong direction.
    expect(existsSync(join(APP_ROUTES, '(dashboard)', 'receptions', 'check-in', 'page.tsx'))).toBe(
      true
    );
    expect(existsSync(join(APP_ROUTES, '(dashboard)', 'reception', 'check-in'))).toBe(false);
    expect(existsSync(join(APP_ROUTES, '(dashboard)', 'reception', 'walk-in', 'page.tsx'))).toBe(
      true
    );
  });
});

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

/**
 * The record a Next.js page actually receives. `searchParams` is not a
 * `URLSearchParams`, and the page is the only place the handoff is read, so the
 * conversion is part of the seam rather than an implementation detail.
 */
describe('reading the pair out of a page searchParams record', () => {
  it('completes the round trip the intake link starts', () => {
    const href = checkInWizardHref('en', { customerId: CUSTOMER, vehicleId: VEHICLE });
    const query = Object.fromEntries(new URLSearchParams(href.split('?')[1]));
    expect(walkInHandoffFromQuery(query)).toEqual({ customerId: CUSTOMER, vehicleId: VEHICLE });
  });

  it('keeps the first value of a repeated key, as the URL itself would', () => {
    expect(
      walkInHandoffFromQuery({
        [HANDOFF_CUSTOMER_PARAM]: [CUSTOMER, 'a-second-value'],
        [HANDOFF_VEHICLE_PARAM]: VEHICLE,
      })
    ).toEqual({ customerId: CUSTOMER, vehicleId: VEHICLE });
  });

  it('refuses the same things the parser refuses — one rule, not two', () => {
    expect(walkInHandoffFromQuery({})).toBeNull();
    expect(walkInHandoffFromQuery({ [HANDOFF_CUSTOMER_PARAM]: CUSTOMER })).toBeNull();
    expect(
      walkInHandoffFromQuery({
        [HANDOFF_CUSTOMER_PARAM]: 'not-an-identifier',
        [HANDOFF_VEHICLE_PARAM]: VEHICLE,
      })
    ).toBeNull();
    expect(
      walkInHandoffFromQuery({
        [HANDOFF_CUSTOMER_PARAM]: undefined,
        [HANDOFF_VEHICLE_PARAM]: VEHICLE,
      })
    ).toBeNull();
  });

  it('ignores parameters that are not the pair', () => {
    expect(
      walkInHandoffFromQuery({
        [HANDOFF_CUSTOMER_PARAM]: CUSTOMER,
        [HANDOFF_VEHICLE_PARAM]: VEHICLE,
        page: '3',
      })
    ).toEqual({ customerId: CUSTOMER, vehicleId: VEHICLE });
  });
});
