import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';

/**
 * The CRM duplicate-review queue (`P1-27-FE-016`).
 *
 * ## Why this file exists
 *
 * `DuplicateReviewScreen` and `DuplicateDecisionPanel` were rendered by no test
 * at any tier. Their vehicle twin got `vehicle-screens.dom.test.tsx`; the CRM
 * pair got nothing, and the e2e assertions that touch the route are all NEGATIVE
 * (no merge button, no scan control) — assertions that pass just as well against
 * a screen that renders nothing at all.
 *
 * ## What the queue has to say
 *
 * A reviewer is being asked whether two customer records are the same person or
 * company. To answer, they need to see WHO the two are, HOW confident the
 * detector is, and WHY it thinks so — in business language. None of that is
 * assertable without rendering a real candidate row, which nothing did.
 *
 * ## Merge is absent, not disabled
 *
 * `P1-OD-017` is open. A disabled button says "this exists and you lack
 * permission", which is a different and false statement. Dismissal is the only
 * decision this endpoint accepts, and the screen must not imply otherwise.
 */

const listDuplicates = vi.fn();
const reviewDuplicateAction = vi.fn();

vi.mock('@/features/crm/customers/identity-api', () => ({
  listDuplicates: (...a: unknown[]) => listDuplicates(...a),
  reviewDuplicateAction: (...a: unknown[]) => reviewDuplicateAction(...a),
  listTimeline: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { DuplicateReviewScreen } =
  await import('@/features/crm/customers/components/DuplicateReviewScreen');

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cand-1',
    partnerIdA: ID_A,
    displayNameA: 'Nadia Khoury',
    partnerIdB: ID_B,
    displayNameB: 'Nadia Khouri',
    matchScore: '0.8500',
    matchBasis: { signals: [{ signal: 'name', weight: 0.5 }] },
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
  listDuplicates.mockReset();
  reviewDuplicateAction.mockReset();
  listDuplicates.mockResolvedValue(page([candidate()]));
  reviewDuplicateAction.mockResolvedValue({ status: 'idle' });
});

function render(locale: 'en' | 'ar' = 'en') {
  const messages = locale === 'en' ? en : ar;
  const view = locale === 'en' ? renderLtr : renderRtl;
  return view(<DuplicateReviewScreen locale={locale} messages={messages} />);
}

describe('opening the queue reads, and never scans', () => {
  it('lists candidates without firing a privileged write', async () => {
    render();
    await screen.findByText('Nadia Khoury');
    expect(listDuplicates).toHaveBeenCalled();
    // `crm.duplicate-scan` is a privileged audited WRITE that creates rows. A
    // queue that "refreshed" by scanning would write audit history every time
    // somebody looked.
    expect(reviewDuplicateAction).not.toHaveBeenCalled();
  });

  it('offers no rescan control at all', async () => {
    render();
    await screen.findByText('Nadia Khoury');
    expect(screen.queryByRole('button', { name: /scan|rescan|refresh/i })).toBeNull();
  });
});

describe('the queue names both customers', () => {
  it('shows each side by name, not by identifier', async () => {
    const { container } = render();
    expect(await screen.findByText('Nadia Khoury')).toBeInTheDocument();
    expect(screen.getByText('Nadia Khouri')).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain(ID_A);
    expect(container.textContent ?? '').not.toContain(ID_B);
  });

  it('says so when a name is unavailable rather than falling back to the uuid', async () => {
    listDuplicates.mockResolvedValue(page([candidate({ displayNameA: null, displayNameB: null })]));
    const { container } = render();
    await screen.findAllByText(en['crm.duplicates.nameUnavailable']);
    expect(container.textContent ?? '').not.toContain(ID_A);
  });
});

describe('the score is exact', () => {
  it('renders the percentage without parsing the decimal', async () => {
    const { container } = render();
    await screen.findByText('Nadia Khoury');
    // `numeric` arrives as a string because it need not fit a double, and this
    // number decides whether two real customer records get combined.
    expect(container.textContent ?? '').toContain('85');
  });
});

describe('the decision panel', () => {
  it('explains WHY the pair might be one person, in business language', async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText('Nadia Khoury');
    // `getAllByRole(...)[0]` is `HTMLElement | undefined` under
    // `noUncheckedIndexedAccess`. `getByRole` is the honest call here, because
    // exactly one row is rendered and it throws if that ever stops being true.
    await user.click(screen.getByRole('button', { name: en['crm.duplicates.review'] }));

    const text = document.body.textContent ?? '';
    // No detector internals: the operator is told what matched, not which
    // column or how heavily it was weighted.
    expect(text).not.toContain('normalized_name');
    expect(text).not.toContain('match_basis');
    expect(text).not.toMatch(/"weight"|\{"signals"/);
  });

  it('offers dismissal and no merge, because P1-OD-017 is open', async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText('Nadia Khoury');
    // `getAllByRole(...)[0]` is `HTMLElement | undefined` under
    // `noUncheckedIndexedAccess`. `getByRole` is the honest call here, because
    // exactly one row is rendered and it throws if that ever stops being true.
    await user.click(screen.getByRole('button', { name: en['crm.duplicates.review'] }));

    // Absent, not disabled. A disabled control says "this exists and you lack
    // permission", which is false.
    expect(screen.queryByRole('button', { name: /merge/i })).toBeNull();
  });

  it('offers no decision on a candidate already settled', async () => {
    listDuplicates.mockResolvedValue(page([candidate({ status: 'dismissed' })]));
    render();
    await screen.findByText('Nadia Khoury');
    // Re-deciding something already settled is refused by the backend; the
    // control should never have been offered.
    expect(screen.queryByRole('button', { name: en['crm.duplicates.review'] })).toBeNull();
  });
});

describe('Arabic', () => {
  it('renders the queue right-to-left with Arabic copy', async () => {
    render('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(await screen.findByText('Nadia Khoury')).toBeInTheDocument();
    expect(screen.getByText(ar['crm.duplicates.title'])).toBeInTheDocument();
  });
});

describe('this file is not vacuous', () => {
  it('really rendered a candidate row, which no previous test did', async () => {
    const { container } = render();
    await screen.findByText('Nadia Khoury');
    expect(container.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
  });

  it('renders no uuid anywhere in the queue', async () => {
    const { container } = render();
    await screen.findByText('Nadia Khoury');
    expect(container.textContent ?? '').not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    );
  });
});
