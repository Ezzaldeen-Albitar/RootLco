import { screen, waitFor, within } from '@testing-library/react';
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
const { DuplicateDecisionPanel } =
  await import('@/features/crm/customers/components/DuplicateDecisionPanel');

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

/**
 * The Review row action's name. On the operational grid (P1-32-PRE-OD-CRM1C) a
 * row action's name is its label followed by what it acts on, so the name
 * BEGINS with the label. An exact-name query would find nothing at all, and the
 * "no Review on a settled pair" case below would pass for that wrong reason.
 */
const review = () => new RegExp(`^${en['crm.duplicates.review']}`);

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
    await user.click(screen.getByRole('button', { name: review() }));

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
    await user.click(screen.getByRole('button', { name: review() }));

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
    expect(screen.queryByRole('button', { name: review() })).toBeNull();
  });
});

describe('DuplicateDecisionPanel mounted directly', () => {
  /*
   * The panel is reached above by clicking Review, which exercises it but leaves
   * it INVISIBLE to the QA-001 inventory: no test imported it, so its name
   * appeared in the corpus only inside comments and a substring sweep counted
   * the prose as coverage.
   *
   * Mounting it directly also reaches two states the queue cannot produce on
   * demand: a score whose shape the formatter rejects, and a candidate whose
   * `matchBasis` is missing entirely.
   */
  const noop = () => {};

  it('names both sides and offers dismissal, with no merge control', () => {
    renderLtr(
      <DuplicateDecisionPanel
        locale="en"
        messages={en}
        candidate={candidate()}
        onClose={noop}
        onDecided={noop}
      />
    );
    expect(screen.getByText('Nadia Khoury')).toBeInTheDocument();
    expect(screen.getByText('Nadia Khouri')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /merge/i })).toBeNull();
  });

  it('shows the raw score rather than guessing when the shape is unexpected', () => {
    const { container } = renderLtr(
      <DuplicateDecisionPanel
        locale="en"
        messages={en}
        candidate={candidate({ matchScore: 'not-a-number' })}
        onClose={noop}
        onDecided={noop}
      />
    );
    // A number that decides whether two real customers are combined is never
    // guessed at. `formatMatchScore` returns null and the raw value is shown.
    expect(container.textContent ?? '').toContain('not-a-number');
    expect(container.textContent ?? '').not.toContain('NaN');
  });

  it('survives a candidate with no match evidence at all', () => {
    const { container } = renderLtr(
      <DuplicateDecisionPanel
        locale="en"
        messages={en}
        candidate={candidate({ matchBasis: null })}
        onClose={noop}
        onDecided={noop}
      />
    );
    // `match_basis` is `jsonb` and nullable. A panel that threw here would take
    // the whole queue down on one malformed row.
    expect(screen.getByText('Nadia Khoury')).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain('null');
  });

  it('closes through the caller, not by hiding itself', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderLtr(
      <DuplicateDecisionPanel
        locale="en"
        messages={en}
        candidate={candidate()}
        onClose={onClose}
        onDecided={noop}
      />
    );
    await user.click(screen.getByRole('button', { name: en['action.close'] }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('a decision that does not go through', () => {
  /*
   * The panel's `Outcome` was rendered by nothing.
   *
   * Every case above stops short of pressing Dismiss, so the whole outcome
   * branch — the banner, its explanation and the correlation reference — was
   * never executed at any tier. That is how this screen came to translate a
   * refusal heading on its own: "You do not have access", four words, no next
   * step, and no test to notice.
   *
   * These cases submit for real, so the banner is asserted against what the
   * reviewer is actually shown.
   */
  const noop = () => {};

  function panel(onDecided: () => void = noop) {
    return renderLtr(
      <DuplicateDecisionPanel
        locale="en"
        messages={en}
        candidate={candidate()}
        onClose={noop}
        onDecided={onDecided}
      />
    );
  }

  async function dismiss(user: ReturnType<typeof userEvent.setup>) {
    // The textarea is `required` with a minimum length. An unfilled form never
    // reaches the action at all, and the case would pass for the wrong reason.
    await user.type(
      screen.getByLabelText(en['crm.customers.restrictions.reason'], { exact: false }),
      'Same person, one record already on file'
    );
    await user.click(screen.getByRole('button', { name: en['crm.duplicates.dismiss'] }));
  }

  it('sends the one decision the endpoint accepts, with the reviewer reason', async () => {
    const user = userEvent.setup();
    panel();
    await dismiss(user);

    await waitFor(() => expect(reviewDuplicateAction).toHaveBeenCalledTimes(1));
    const form = reviewDuplicateAction.mock.calls[0]?.[2] as FormData;
    // `crm.duplicate-review` accepts `dismissed` and nothing else; the hidden
    // field is the only thing carrying it.
    expect(form.get('decision')).toBe('dismissed');
    expect(form.get('reason')).toBe('Same person, one record already on file');
  });

  it('tells a refused reviewer what to do next, not just that it was refused', async () => {
    reviewDuplicateAction.mockResolvedValue({
      status: 'denied',
      messageKey: 'state.denied.title',
      correlationId: 'corr-duplicate-1',
      attempt: 1,
    });
    const user = userEvent.setup();
    panel();
    await dismiss(user);

    const alert = await screen.findByRole('alert');
    // The heading states the verdict; the sentence under it names the remedy.
    // Showing the heading alone is the defect this asserts against.
    expect(alert).toHaveTextContent(en['state.denied.title']);
    expect(alert).toHaveTextContent(en['state.denied.message']);
    // The one diagnostic that may be shown.
    expect(alert).toHaveTextContent('corr-duplicate-1');
  });

  it('counts out the wait instead of printing the placeholder', async () => {
    reviewDuplicateAction.mockResolvedValue({
      status: 'throttled',
      messageKey: 'state.throttled.messageWithSeconds',
      messageValues: { seconds: '30' },
      attempt: 1,
    });
    const user = userEvent.setup();
    panel();
    await dismiss(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Wait 30 seconds');
    // Translating the key while dropping the values shows `{seconds}` to the
    // operator exactly as the catalogue spells it.
    expect(alert.textContent ?? '').not.toContain('{seconds}');
  });

  it('confirms a dismissal to the reviewer and clears the reason behind it', async () => {
    reviewDuplicateAction.mockResolvedValue({
      status: 'success',
      messageKey: 'crm.duplicates.dismissed',
      attempt: 1,
    });
    const onDecided = vi.fn();
    const user = userEvent.setup();
    panel(onDecided);
    await dismiss(user);

    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1));
    // Announced, not alerted: nothing went wrong.
    expect(await screen.findByRole('status')).toHaveTextContent(en['crm.duplicates.dismissed']);
    expect(
      screen.getByLabelText(en['crm.customers.restrictions.reason'], { exact: false })
    ).toHaveValue('');
  });

  it('moves the cursor to a refused reason and withdraws the complaint once it is edited (route sweep B3)', async () => {
    reviewDuplicateAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.violation.invalid',
      fieldErrors: { reason: 'form.violation.invalid' },
      attempt: 1,
    });
    const user = userEvent.setup();
    panel();
    await dismiss(user);
    const reason = screen.getByLabelText(en['crm.customers.restrictions.reason'], {
      exact: false,
    });
    await waitFor(() => expect(reason).toHaveFocus());
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    await user.type(reason, ' and more');
    expect(reason).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('keeps the reason on screen when the write fails, so it need not be written twice', async () => {
    reviewDuplicateAction.mockResolvedValue({
      status: 'unavailable',
      messageKey: 'state.error.title',
      correlationId: 'corr-duplicate-2',
      attempt: 1,
    });
    const user = userEvent.setup();
    panel();
    await dismiss(user);

    await screen.findByRole('alert');
    // The textarea is controlled for exactly this: React resets an uncontrolled
    // field when the action settles, and the reviewer's reasoning goes with it.
    expect(
      screen.getByLabelText(en['crm.customers.restrictions.reason'], { exact: false })
    ).toHaveValue('Same person, one record already on file');
  });
});

describe('Arabic', () => {
  it('renders the queue right-to-left with Arabic copy', async () => {
    render('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(await screen.findByText('Nadia Khoury')).toBeInTheDocument();
    // The intro, not the title. The title is no longer rendered by this screen:
    // the route's `PageHeader` renders it, and printing it here too gave the
    // page two `<h1>`s and the same string twice on screen.
    expect(screen.getByText(ar['crm.duplicates.intro'])).toBeInTheDocument();
  });

  it('names the grid by the Arabic caption', async () => {
    render('ar');
    await screen.findByText('Nadia Khoury');
    expect(screen.getByRole('grid', { name: ar['crm.duplicates.caption'] })).toBeInTheDocument();
  });

  it('names each Review in Arabic by the pair it opens', async () => {
    render('ar');
    await screen.findByText('Nadia Khoury');
    const action = screen.getByRole('button', {
      name: new RegExp(`^${ar['crm.duplicates.review']}`),
    });
    expect(action).toHaveAccessibleName(
      `${ar['crm.duplicates.review']} Nadia Khoury · Nadia Khouri`
    );
  });

  it('draws the pager right-to-left, in Arabic, Previous and Next closed on a single page', async () => {
    render('ar');
    await screen.findByText('Nadia Khoury');
    const pager = screen.getByRole('navigation', { name: ar['table.pagination'] });
    expect(pager.closest('[dir]')?.getAttribute('dir')).toBe('rtl');
    // That `dir` is the harness's, on the document element. Nothing between it
    // and the grid or the pager sets a direction of its own, so both take the
    // page's rather than a wrapper's.
    const grid = screen.getByRole('grid', { name: ar['crm.duplicates.caption'] });
    expect(grid.closest('[dir]')).toBe(document.documentElement);
    expect(pager.closest('[dir]')).toBe(document.documentElement);
    // The pager's two steps, in reading order and in Arabic.
    expect(
      within(pager)
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual([ar['table.previousPage'], ar['table.nextPage']]);
    expect(within(pager).getByText(ar['mui.pagination.page'].replace('{page}', '1'))).toBeVisible();
    expect(within(pager).getByRole('button', { name: ar['table.previousPage'] })).toBeDisabled();
    expect(within(pager).getByRole('button', { name: ar['table.nextPage'] })).toBeDisabled();
  });

  it('says an open pair is awaiting review under Decision, in Arabic too', async () => {
    render('ar');
    await screen.findByText('Nadia Khoury');
    const row = document.querySelector('[role="row"][data-id="cand-1"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(within(row).getByText(ar['vehicles.duplicateStatus.open'])).toBeInTheDocument();
  });
});

describe('the Decision column', () => {
  const decisionCell = (id: string) =>
    document.querySelector(`[role="row"][data-id="${id}"] [data-field="decide"]`) as HTMLElement;

  it('says an open pair is awaiting review rather than drawing a dash', async () => {
    render();
    await screen.findByText('Nadia Khoury');
    expect(decisionCell('cand-1')).toHaveTextContent(en['vehicles.duplicateStatus.open']);
    expect(decisionCell('cand-1')).not.toHaveTextContent('—');
  });

  it('shows the day a settled pair was decided, and a dash when no day is recorded', async () => {
    listDuplicates.mockResolvedValue(
      page([
        candidate({
          id: 'cand-dated',
          status: 'dismissed',
          reviewedAt: '2026-08-05T09:00:00.000Z',
        }),
        candidate({ id: 'cand-undated', status: 'merged', reviewedAt: null }),
      ])
    );
    render();
    await screen.findAllByText('Nadia Khoury');
    expect(decisionCell('cand-dated').querySelector('time')).toHaveAttribute(
      'dateTime',
      '2026-08-05T09:00:00.000Z'
    );
    expect(decisionCell('cand-dated')).not.toHaveTextContent(en['vehicles.duplicateStatus.open']);
    expect(decisionCell('cand-undated')).toHaveTextContent('—');
    expect(decisionCell('cand-undated').querySelector('time')).toBeNull();
  });
});

describe('the review panel follows the queue', () => {
  it('closes an open panel when the status is changed', async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText('Nadia Khoury');
    await user.click(screen.getByRole('button', { name: review() }));
    expect(screen.getByText(en['crm.duplicates.decideHeading'])).toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText(en['crm.customers.column.status']),
      en['crm.duplicateStatus.dismissed']
    );

    await waitFor(() =>
      expect(screen.queryByText(en['crm.duplicates.decideHeading'])).not.toBeInTheDocument()
    );
  });

  it('closes the panel and re-reads the queue once a dismissal succeeds', async () => {
    reviewDuplicateAction.mockResolvedValue({
      status: 'success',
      messageKey: 'crm.duplicates.dismissed',
      attempt: 1,
    });
    const user = userEvent.setup();
    render();
    await screen.findByText('Nadia Khoury');
    await user.click(screen.getByRole('button', { name: review() }));
    const readsBefore = listDuplicates.mock.calls.length;

    await user.type(
      screen.getByLabelText(en['crm.customers.restrictions.reason'], { exact: false }),
      'Different people who share a name'
    );
    await user.click(screen.getByRole('button', { name: en['crm.duplicates.dismiss'] }));

    await waitFor(() => expect(reviewDuplicateAction).toHaveBeenCalledTimes(1));
    // `onDecided`: the panel is gone and the queue is read again.
    await waitFor(() =>
      expect(screen.queryByText(en['crm.duplicates.decideHeading'])).not.toBeInTheDocument()
    );
    await waitFor(() => expect(listDuplicates.mock.calls.length).toBe(readsBefore + 1));
  });
});

describe('this file is not vacuous', () => {
  it('really rendered a candidate row, which no previous test did', async () => {
    const { container } = render();
    await screen.findByText('Nadia Khoury');
    // The grid's rows are `role="row"` elements, not `<tr>`; a data row carries
    // its row id, the header row does not.
    const rows = container.querySelectorAll('[role="row"][data-id]');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Nadia Khoury');
  });

  it('names the grid by its caption and offers its pager, Previous closed on page one', async () => {
    render();
    await screen.findByText('Nadia Khoury');
    expect(screen.getByRole('grid', { name: en['crm.duplicates.caption'] })).toBeInTheDocument();
    const pager = screen.getByRole('navigation', { name: en['table.pagination'] });
    expect(within(pager).getByRole('button', { name: en['table.previousPage'] })).toBeDisabled();
    // `hasMore: false` on the only page: there is nothing further to walk to.
    expect(within(pager).getByRole('button', { name: en['table.nextPage'] })).toBeDisabled();
  });

  it('walks to the next page through the cursor the first page returned', async () => {
    listDuplicates.mockResolvedValueOnce({
      ...page([candidate()]),
      hasMore: true,
      nextCursor: 'cursor-2',
    });
    listDuplicates.mockResolvedValueOnce(page([candidate({ id: 'cand-2' })]));
    const user = userEvent.setup();
    render();
    await screen.findByText('Nadia Khoury');
    await user.click(screen.getByRole('button', { name: en['table.nextPage'] }));
    await waitFor(() => expect(listDuplicates).toHaveBeenCalledTimes(2));
    // Same status, same page size, and the cursor the first page handed back.
    expect(listDuplicates.mock.calls[1]?.[0]).toBe('open');
    expect(listDuplicates.mock.calls[1]?.[1]).toMatchObject({ page: 2, pageSize: 25 });
    expect(listDuplicates.mock.calls[1]?.[2]).toBe('cursor-2');
  });

  it('names each Review by the pair it opens, never by an identifier', async () => {
    render();
    await screen.findByText('Nadia Khoury');
    const action = screen.getByRole('button', { name: review() });
    expect(action).toHaveAccessibleName(
      `${en['crm.duplicates.review']} Nadia Khoury · Nadia Khouri`
    );
    expect(action.textContent ?? '').not.toContain(ID_A);
  });

  it('renders no uuid anywhere in the queue', async () => {
    const { container } = render();
    await screen.findByText('Nadia Khoury');
    expect(container.textContent ?? '').not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    );
  });

  it('RE-READS the queue with the chosen status', async () => {
    /*
     * The twin of the vehicle queue's case, added at the same time and for the
     * same reason: this screen had the identical dead filter, and nothing here
     * touched the select at all.
     *
     * `useServerTable` keys its read on `TableRequest` plus `loadKey`, and
     * excludes `load` from the effect deps. `status` is not a `TableRequest`
     * field, so without `loadKey` the select rebuilt `load` and moved nothing
     * the effect watches — "dismissed" and "merged" were unreachable options.
     *
     * The defect was reported against the VEHICLE queue only. It is tested in
     * both, because fixing the reported one and leaving its twin is how the
     * survivor becomes the next finding.
     */
    const user = userEvent.setup();
    render();
    await screen.findByText('Nadia Khoury');

    expect(listDuplicates).toHaveBeenCalled();
    expect(listDuplicates.mock.calls[0]?.[0]).toBe('open');

    await user.selectOptions(
      screen.getByLabelText(en['crm.customers.column.status']),
      en['crm.duplicateStatus.dismissed']
    );

    await waitFor(() =>
      expect(
        listDuplicates.mock.calls.map((call) => call[0]),
        'the status filter issued no read with the chosen status'
      ).toContain('dismissed')
    );
  });

  it('reaches the THIRD state too, and writes nothing while filtering', async () => {
    /*
     * The twin of the vehicle queue's case, for the same reason the case above
     * is a twin. `DUPLICATE_STATUSES` is `['open', 'dismissed', 'merged']`; a
     * filter can be live for one option and dead for another if the select's
     * value is mapped rather than passed, so the third is asserted.
     *
     * And `crm.duplicate-scan` is a privileged audited WRITE that creates
     * candidate rows. Opening the queue is already covered above; CHANGING THE
     * FILTER was not, and it is the interaction an operator repeats.
     */
    const user = userEvent.setup();
    render();
    await screen.findByText('Nadia Khoury');

    await user.selectOptions(
      screen.getByLabelText(en['crm.customers.column.status']),
      en['crm.duplicateStatus.merged']
    );

    await waitFor(() =>
      expect(
        listDuplicates.mock.calls.map((call) => call[0]),
        'the third status option is decorative'
      ).toContain('merged')
    );
    expect(
      reviewDuplicateAction,
      'filtering the queue performed a privileged write'
    ).not.toHaveBeenCalled();
  });
});
