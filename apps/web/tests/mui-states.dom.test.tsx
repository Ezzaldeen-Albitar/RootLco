import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MuiEmptyState,
  MuiErrorState,
  MuiExpiredState,
  MuiLoadingState,
  MuiNoResultsState,
  MuiNotFoundState,
  MuiRefusedState,
  MuiSearchStates,
  MuiStaleState,
  MuiUnavailableState,
} from '@/components/states/MuiStates';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import type { Locale } from '@/i18n/config';
import { getMessages, type Messages } from '@/i18n/get-messages';
import type { SearchPhase } from '@/lib/api/use-search-request';
import { renderLtr, renderRtl } from './render';

/**
 * The read states on Material UI (ADR-022 PR1): the catalogue's own words, a
 * retry only where retrying can change the answer, the correlation reference as
 * the only diagnostic, and no state drawn as another.
 */

function mount(ui: ReactElement, locale: Locale = 'en') {
  const messages = getMessages(locale);
  const renderIn = locale === 'ar' ? renderRtl : renderLtr;
  return renderIn(
    <UiFoundationProvider locale={locale} text={muiTextOf(messages)}>
      {ui}
    </UiFoundationProvider>
  );
}

afterEach(() => {
  for (const style of document.head.querySelectorAll('style')) style.remove();
});

type Case = readonly [
  name: string,
  render: (messages: Messages, onRetry: () => void) => ReactElement,
  testId: string,
  title: keyof Messages,
  description: keyof Messages,
  retry: boolean,
];

const CASES: readonly Case[] = [
  [
    'empty',
    (m) => <MuiEmptyState messages={m} />,
    'state-empty',
    'state.empty.title',
    'state.empty.description',
    false,
  ],
  [
    'no results',
    (m) => <MuiNoResultsState messages={m} />,
    'state-no-results',
    'state.noResults.title',
    'state.noResults.description',
    false,
  ],
  [
    'error',
    (m, r) => <MuiErrorState messages={m} onRetry={r} correlationId="corr-5" />,
    'state-error',
    'state.error.title',
    'state.error.description',
    true,
  ],
  [
    'unavailable',
    (m, r) => <MuiUnavailableState messages={m} onRetry={r} correlationId="corr-5" />,
    'state-unavailable',
    'state.unavailable.title',
    'state.unavailable.description',
    true,
  ],
  [
    'refused',
    (m) => <MuiRefusedState messages={m} correlationId="corr-5" />,
    'state-refused',
    'state.denied.title',
    'state.denied.description',
    false,
  ],
  [
    'expired',
    (m) => <MuiExpiredState messages={m} locale="en" />,
    'state-expired',
    'state.expired.title',
    'state.expired.description',
    false,
  ],
  [
    'not found',
    (m) => <MuiNotFoundState messages={m} />,
    'state-not-found',
    'state.notFound.title',
    'state.notFound.description',
    false,
  ],
  [
    'stale',
    (m, r) => <MuiStaleState messages={m} onRetry={r} />,
    'state-stale',
    'state.conflict.title',
    'state.conflict.description',
    true,
  ],
];

describe('each state says its own sentence', () => {
  it.each(CASES)('%s', async (_name, render, testId, title, description, retry) => {
    for (const locale of ['en', 'ar'] as const) {
      const messages = getMessages(locale);
      const onRetry = vi.fn();
      const user = userEvent.setup();
      const { unmount } = mount(render(messages, onRetry), locale);
      const state = screen.getByTestId(testId);
      expect(state).toHaveAttribute('role', 'status');
      expect(within(state).getByRole('heading', { level: 2 })).toHaveTextContent(messages[title]);
      expect(state).toHaveTextContent(messages[description]);
      const button = within(state).queryByRole('button', { name: messages['state.retry'] });
      if (retry) {
        await user.click(button as HTMLElement);
        expect(onRetry).toHaveBeenCalledTimes(1);
      } else {
        expect(button).toBeNull();
      }
      // No raw code: nothing that looks like a status or an error identifier.
      expect(state.textContent).not.toMatch(/\b[1-5]\d\d\b|[a-z]+\.[a-z]+\.[a-z]+|undefined|null/);
      unmount();
    }
  });

  it('shows the correlation reference and nothing else diagnostic', () => {
    const messages = getMessages('en');
    mount(<MuiUnavailableState messages={messages} correlationId="corr-5" />);
    const state = screen.getByTestId('state-unavailable');
    expect(state).toHaveTextContent(`${messages['state.correlationId']} corr-5`);
    expect(within(state).getByText('corr-5').tagName).toBe('CODE');
  });

  it('offers an ended session the way back to signing in, in its language', () => {
    const messages = getMessages('ar');
    mount(<MuiExpiredState messages={messages} locale="ar" />, 'ar');
    expect(screen.getByRole('link', { name: messages['auth.backToLogin'] })).toHaveAttribute(
      'href',
      '/ar/login'
    );
  });

  it('announces loading once, in words, over skeleton rows or a spinner', () => {
    const messages = getMessages('en');
    const { unmount } = mount(<MuiLoadingState messages={messages} rows={3} />);
    const rows = screen.getByTestId('state-loading');
    expect(rows).toHaveAttribute('aria-live', 'polite');
    expect(rows).toHaveTextContent(messages['state.loading']);
    expect(rows.querySelectorAll('.MuiSkeleton-root')).toHaveLength(3);
    unmount();

    mount(<MuiLoadingState messages={messages} variant="inline" />);
    expect(screen.getByTestId('state-loading')).toHaveTextContent(messages['state.loading']);
    expect(document.querySelector('.MuiCircularProgress-root')).toHaveAttribute(
      'aria-hidden',
      'true'
    );
  });
});

describe('MuiSearchStates keeps SearchStates’ decisions', () => {
  const PHASES: readonly [SearchPhase, string | null, boolean][] = [
    ['loading', 'state-loading', false],
    ['empty', 'state-no-results', false],
    ['unavailable', 'state-unavailable', true],
    ['refused', 'state-refused', false],
    ['expired', 'state-expired', false],
    ['failed', 'state-error', true],
  ];

  it.each(PHASES)('%s → %s', (phase, testId, retry) => {
    const messages = getMessages('en');
    mount(<MuiSearchStates messages={messages} phase={phase} onRetry={() => undefined} />);
    const state = screen.getByTestId(testId as string);
    expect(within(state).queryByRole('button', { name: messages['state.retry'] }) !== null).toBe(
      retry
    );
  });

  it('says a search found nothing, not that filters did, when a search comes back empty', () => {
    const messages = getMessages('en');
    mount(<MuiSearchStates messages={messages} phase="empty" />);
    const state = screen.getByTestId('state-no-results');
    expect(within(state).getByText(messages['state.noSearchMatches.title'])).toBeInTheDocument();
    expect(
      within(state).getByText(messages['state.noSearchMatches.description'])
    ).toBeInTheDocument();
    expect(within(state).queryByText(messages['state.noResults.title'])).toBeNull();
    expect(within(state).queryByText(messages['state.noResults.description'])).toBeNull();
  });

  it('renders nothing for an answer and the caller’s words before one', () => {
    const messages = getMessages('en');
    const { unmount } = mount(<MuiSearchStates messages={messages} phase="ready" />);
    expect(screen.queryByRole('status')).toBeNull();
    unmount();
    mount(<MuiSearchStates messages={messages} phase="idle" idle={<p>Type a name.</p>} />);
    expect(screen.getByText('Type a name.')).toBeInTheDocument();
    expect(screen.queryByTestId('state-no-results')).toBeNull();
  });
});
