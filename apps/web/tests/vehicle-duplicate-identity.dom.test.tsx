import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import { vehiclePairMembers } from '@/features/vehicles/duplicates-contract';

/**
 * The vehicle duplicate queue names each side (`P1-27-FE-028`).
 *
 * ## The defect
 *
 * Both links read "First record" and "Second record" — the pair's ORDINAL, on
 * the one screen whose entire job is telling two vehicles apart. A reviewer was
 * asked to decide whether two records are the same vehicle, and shown nothing
 * about either of them.
 *
 * `veh.vehicle-duplicate-list` has published `displayNumberA` and
 * `displayNumberB` since #194. The frontend TYPE omitted both fields, so
 * TypeScript could not flag the screen, the hand-written fixture inherited the
 * same omission, and every test that rendered the queue was blind to it. The
 * component's own docblock then defended the gap with an N+1 argument that the
 * repository had already made false.
 *
 * ## What is asserted
 *
 * The reference is the visible text; the ordinal survives only as the accessible
 * name, because two links still have to be distinguishable when a reference is
 * missing; and the uuid appears in the href but never as a label.
 */

const listVehicleDuplicates = vi.fn();
const reviewVehicleDuplicateAction = vi.fn();

vi.mock('@/features/vehicles/duplicates-api', () => ({
  listVehicleDuplicates: (...a: unknown[]) => listVehicleDuplicates(...a),
  reviewVehicleDuplicateAction: (...a: unknown[]) => reviewVehicleDuplicateAction(...a),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { VehicleDuplicateReviewScreen } =
  await import('@/features/vehicles/components/VehicleDuplicateReviewScreen');

const ID_A = 'a1b2c3d4-0000-4000-8000-000000000001';
const ID_B = 'a1b2c3d4-0000-4000-8000-000000000002';

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cand-1',
    vehicleIdA: ID_A,
    displayNumberA: 'V-0001',
    vehicleIdB: ID_B,
    displayNumberB: 'V-0002',
    matchScore: '0.9300',
    matchBasis: [{ basis: 'vin_near', classification: 'strong', weight: 70 }],
    status: 'open',
    detectedAt: '2026-08-04T10:00:00.000Z',
    reviewedBy: null,
    reviewedAt: null,
    ...overrides,
  };
}

function page(rows: readonly unknown[]) {
  return { status: 'ok', rows, nextCursor: null, hasMore: false, correlationId: 'cid' };
}

beforeEach(() => {
  listVehicleDuplicates.mockReset();
  reviewVehicleDuplicateAction.mockReset();
  listVehicleDuplicates.mockResolvedValue(page([candidate()]));
});

function render(locale: 'en' | 'ar' = 'en') {
  const messages = locale === 'en' ? en : ar;
  const view = locale === 'en' ? renderLtr : renderRtl;
  return view(<VehicleDuplicateReviewScreen locale={locale} messages={messages} />);
}

describe('each side of the pair is named by its own reference', () => {
  it('shows the reference, not the position in the pair', async () => {
    render();
    expect(await screen.findByText('V-0001')).toBeInTheDocument();
    expect(screen.getByText('V-0002')).toBeInTheDocument();
  });

  it('no longer uses the ordinal as the visible label', async () => {
    const { container } = render();
    await screen.findByText('V-0001');
    // "First record" / "Second record" told a reviewer nothing about which two
    // vehicles they were comparing.
    const text = container.textContent ?? '';
    expect(text).not.toContain(en['vehicles.duplicates.memberA']);
    expect(text).not.toContain(en['vehicles.duplicates.memberB']);
  });

  it('keeps the ordinal as the accessible name, so the two links stay distinct', async () => {
    render();
    await screen.findByText('V-0001');
    expect(screen.getByRole('link', { name: en['vehicles.duplicates.memberA'] })).toHaveAttribute(
      'href',
      `/en/vehicles/${ID_A}`
    );
    expect(screen.getByRole('link', { name: en['vehicles.duplicates.memberB'] })).toHaveAttribute(
      'href',
      `/en/vehicles/${ID_B}`
    );
  });

  it('says so when a reference is missing rather than falling back to the uuid', async () => {
    // The repository uses a LEFT JOIN, so a merged-away or deleted side yields
    // null. That is a real state and must not become an identifier on screen.
    listVehicleDuplicates.mockResolvedValue(
      page([candidate({ displayNumberA: null, displayNumberB: null })])
    );
    const { container } = render();
    expect(await screen.findAllByText(en['vehicles.duplicates.numberUnavailable'])).toHaveLength(2);
    const text = container.textContent ?? '';
    expect(text).not.toContain(ID_A);
    expect(text).not.toContain(ID_B);
  });

  it('renders no uuid as text anywhere in the queue', async () => {
    const { container } = render();
    await screen.findByText('V-0001');
    // The href carries it — that is a URL. The visible text must not.
    expect(container.textContent ?? '').not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    );
  });
});

describe('the decision panel identifies the pair as well', () => {
  it('shows each reference beside its ordinal', async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText('V-0001');
    await user.click(screen.getByRole('button', { name: en['crm.duplicates.review'] }));

    // The panel is where the decision is made, so it must say which two records
    // the decision is about. It previously offered only "Open vehicle".
    expect(await screen.findByText(en['vehicles.duplicates.memberA'])).toBeInTheDocument();
    const panelText = document.body.textContent ?? '';
    expect(panelText).toContain('V-0001');
    expect(panelText).toContain('V-0002');
  });

  it('offers no merge control, because P1-OD-017 is open', async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText('V-0001');
    await user.click(screen.getByRole('button', { name: en['crm.duplicates.review'] }));
    // Absent, not disabled — the canonical plan requires the affordance to be
    // gone while the decision is open.
    expect(screen.queryByRole('button', { name: /merge/i })).toBeNull();
  });
});

describe('the exact decimal score survives', () => {
  it('never rounds the number that decides whether two vehicles are one', async () => {
    listVehicleDuplicates.mockResolvedValue(page([candidate({ matchScore: '0.9300' })]));
    const { container } = render();
    await screen.findByText('V-0001');
    // `numeric` arrives as a STRING because it need not fit a double. Any
    // `parseFloat` here would be the cursor-precision defect again.
    expect(container.textContent ?? '').toMatch(/93/);
  });
});

describe('Arabic', () => {
  it('names both sides right-to-left', async () => {
    render('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(await screen.findByText('V-0001')).toBeInTheDocument();
  });

  it('says "reference unavailable" in Arabic', async () => {
    listVehicleDuplicates.mockResolvedValue(page([candidate({ displayNumberA: null })]));
    render('ar');
    expect(
      await screen.findByText(ar['vehicles.duplicates.numberUnavailable'])
    ).toBeInTheDocument();
  });
});

describe('this file is not vacuous', () => {
  it('reads the pair through the shared helper both call sites use', () => {
    const pair = vehiclePairMembers(candidate() as never);
    expect(pair).toHaveLength(2);
    expect(pair[0]).toEqual({ id: ID_A, number: 'V-0001' });
    expect(pair[1]).toEqual({ id: ID_B, number: 'V-0002' });
  });

  it('asserts against copy that exists in both catalogues', () => {
    for (const key of [
      'vehicles.duplicates.numberUnavailable',
      'vehicles.duplicates.memberA',
      'vehicles.duplicates.memberB',
    ]) {
      expect(Object.keys(en), key).toContain(key);
      expect(Object.keys(ar), key).toContain(key);
      expect((en as Record<string, string>)[key]).not.toBe((ar as Record<string, string>)[key]);
    }
  });
});
