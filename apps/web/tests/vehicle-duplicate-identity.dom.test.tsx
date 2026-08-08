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
 * The reference is the visible text; the ordinal survives as a visually-hidden
 * SUFFIX inside the link, because two links still have to be distinguishable
 * when a reference is missing; and the uuid appears in the href but never as a
 * label.
 *
 * ## The second defect, found by the adversarial recheck
 *
 * The first fix carried the ordinal as an `aria-label`, and this file asserted
 * that as the design. `aria-label` wins the accessible-name computation
 * outright, so the announced name of each link stayed "First record" while the
 * screen showed `V-0001` — WCAG 2.5.3 Label in Name, Level A, on the one screen
 * whose job is telling two vehicles apart. The case that was supposed to catch
 * it inspected `container.textContent`, which structurally cannot see an
 * `aria-label`, so it passed while the defect was live.
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

  it('no longer shows the ordinal as the visible label', async () => {
    const { container } = render();
    await screen.findByText('V-0001');
    /*
     * The ordinal is still in the accessibility tree — it is what keeps two
     * links apart when both references are null — so it IS in `textContent`.
     * `textContent` cannot see CSS and so cannot answer "is this visible"; the
     * honest check is that every occurrence sits inside an `sr-only` element.
     *
     * The case this replaces asserted `textContent` did not contain the ordinal
     * and passed while the ordinal was the announced name of both links, which
     * is the failure it was written to catch. A check that structurally cannot
     * see the thing it names is worse than no check.
     */
    for (const key of ['vehicles.duplicates.memberA', 'vehicles.duplicates.memberB'] as const) {
      const carriers = [...container.querySelectorAll('span')].filter(
        (node) => node.textContent?.trim() === en[key]
      );
      expect(carriers).toHaveLength(1);
      expect(carriers[0]?.className).toContain('sr-only');
    }
  });

  it('puts the visible reference INSIDE the accessible name (WCAG 2.5.3)', async () => {
    render();
    await screen.findByText('V-0001');
    /*
     * The first fix used `aria-label={ordinal}`, which wins the accessible-name
     * computation outright: the announced name was "First record" and the
     * visible label `V-0001` was not contained in it. That is Label in Name,
     * Level A — and a speech-input user saying "click V-0001" matched nothing,
     * on the one screen whose job is telling two vehicles apart.
     *
     * `{ name: 'V-0001' }` here is a SUBSTRING match by testing-library's
     * default, which is exactly the SC's "contains" requirement.
     */
    expect(screen.getByRole('link', { name: /V-0001/ })).toHaveAttribute(
      'href',
      `/en/vehicles/${ID_A}`
    );
    expect(screen.getByRole('link', { name: /V-0002/ })).toHaveAttribute(
      'href',
      `/en/vehicles/${ID_B}`
    );
    // ANCHORED, because containment alone survives swapping the two nodes. SC
    // 2.5.3 requires containment and speech-input software matches best from the
    // start of the name, which is why the reference is rendered first. Without
    // `^` the ordering is asserted by nothing and a reorder passes silently.
    expect(screen.getByRole('link', { name: /^V-0001/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^V-0002/ })).toBeInTheDocument();
  });

  it('refuses to let the ordinal become the whole accessible name again', async () => {
    render();
    await screen.findByText('V-0001');
    /*
     * A string `name` in `*ByRole` is matched against the WHOLE accessible name,
     * so this finds a link only if its entire name is the ordinal — which is
     * precisely the defect. (`{ exact: true }` is not a `ByRoleOptions` key; the
     * whole-name comparison is the default and there is no per-call override.)
     */
    expect(screen.queryByRole('link', { name: en['vehicles.duplicates.memberA'] })).toBeNull();
    expect(screen.queryByRole('link', { name: en['vehicles.duplicates.memberB'] })).toBeNull();
  });

  it('keeps the two links distinguishable by their ordinal as well', async () => {
    render();
    await screen.findByText('V-0001');
    const [first, second] = screen.getAllByRole('link');
    const nameOf = (node: HTMLElement | undefined) =>
      (node?.textContent ?? '').replace(/\s+/g, ' ');
    expect(nameOf(first)).toContain(en['vehicles.duplicates.memberA']);
    expect(nameOf(second)).toContain(en['vehicles.duplicates.memberB']);
    expect(nameOf(first)).not.toBe(nameOf(second));
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
    //
    // `findAllByText`, not `findByText`: the queue's own links now carry the
    // ordinal in a visually-hidden span, so the ordinal legitimately appears
    // twice — once in the table and once in the panel.
    expect(await screen.findAllByText(en['vehicles.duplicates.memberA'])).not.toHaveLength(0);
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
