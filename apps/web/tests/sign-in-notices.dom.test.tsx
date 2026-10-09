import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionState } from '@/lib/forms/action-result';
import { BOTH_DIRECTIONS } from './render';

/**
 * The sign-in page's reason notices and the intended page, in English and
 * Arabic (P1-32-PRE-OD-AUTHB).
 *
 * The page is a Server Component, so it is invoked for its element tree and
 * that tree is rendered — the real `LoginForm`, the real notices, the real
 * catalogue. Only the Server Action is replaced: it reaches the network and
 * the cookie jar, neither of which a DOM test has.
 *
 * What is asserted is what an operator reads and what the form would send: the
 * sentence for each reason, that nothing names another account, that the
 * intended page is announced but never echoed, and that a hostile intended
 * value leaves no trace on the page at all.
 */

const login = vi.hoisted(() => ({
  calls: [] as FormData[],
  answer: null as Promise<ActionState> | null,
}));

vi.mock('@/features/authentication/actions/login', () => ({
  loginAction: async (_previous: ActionState, form: FormData): Promise<ActionState> => {
    login.calls.push(form);
    return login.answer ?? { status: 'idle' };
  },
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const { default: LoginPage } = await import('@/app/[locale]/(auth)/login/page');

async function page(locale: string, query: Record<string, string | string[]>) {
  return LoginPage({
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve(query),
  });
}

function intendedField(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('input[type="hidden"][name="intended"]');
}

beforeEach(() => {
  login.calls = [];
  login.answer = null;
});

afterEach(() => {
  document.documentElement.removeAttribute('dir');
});

describe.each(BOTH_DIRECTIONS)('sign-in notices (%s)', (locale, render) => {
  it.each([
    ['expired', 'auth.login.reason.expired'],
    ['signed-out', 'auth.login.reason.signedOut'],
    ['forbidden', 'auth.login.reason.forbidden'],
    ['unavailable', 'auth.login.reason.unavailable'],
  ] as const)('says why for reason=%s', async (reason, key) => {
    const { messages } = render(await page(locale, { reason }));
    const notice = screen.getByText(messages[key]);
    expect(notice).toHaveAttribute('role', 'status');
    // One sentence for the reason, and nothing else announced alongside it.
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('names the locked or suspended account as a cause of an ended session, for everyone', async () => {
    const { messages } = render(await page(locale, { reason: 'expired' }));
    const sentence = messages['auth.login.reason.expired'];
    // The same sentence for every ended session, whatever ended it: the page
    // never learns which account was locked, so it cannot say.
    expect(screen.getByRole('status')).toHaveTextContent(sentence);
    expect(sentence).toMatch(locale === 'en' ? /locks or suspends/ : /يقفل الحساب أو يوقفه/);
  });

  it('says an account with no access has been given none, and names no permission', async () => {
    const { messages } = render(await page(locale, { reason: 'forbidden' }));
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(messages['auth.login.reason.forbidden']);
    // No code, no dotted identifier, no address.
    expect(status.textContent ?? '').not.toMatch(/[a-z]+\.[a-z_]+\.[a-z_]+/);
    expect(status.textContent ?? '').not.toMatch(/@/);
  });

  it('shows no notice for a reason it does not know, and does not echo it', async () => {
    render(await page(locale, { reason: '<script>alert(1)</script>' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.body.textContent ?? '').not.toContain('alert(1)');
  });

  it('announces the intended page without echoing its address, and sends it with the form', async () => {
    const { messages } = render(
      await page(locale, { reason: 'signed-out', intended: `/${locale}/work-orders` })
    );
    expect(screen.getByTestId('sign-in-intended')).toHaveTextContent(
      messages['auth.login.intended']
    );
    expect(screen.getAllByRole('status')).toHaveLength(2);
    expect(document.body.textContent ?? '').not.toContain('/work-orders');
    expect(intendedField()?.value).toBe(`/${locale}/work-orders`);
  });

  it.each([
    ['an absolute address', 'https://evil.example/en/work-orders'],
    ['a protocol-relative address', '//evil.example'],
    ['a backslash address', '/\\evil.example'],
    ['an encoded slash', '/en/%2F%2Fevil.example'],
    ['a scheme', 'javascript:alert(1)'],
    ['the session-ended handler', '/en/session-ended'],
  ])('leaves no trace of %s', async (_label, intended) => {
    render(await page(locale, { reason: 'expired', intended }));
    expect(screen.queryByTestId('sign-in-intended')).toBeNull();
    expect(intendedField()).toBeNull();
    expect(document.body.innerHTML).not.toContain('evil.example');
    expect(document.body.textContent ?? '').not.toContain('alert(1)');
    expect(document.body.textContent ?? '').not.toContain('session-ended');
  });

  it('reads only the first of a repeated intended parameter, and checks it', async () => {
    render(await page(locale, { intended: ['//evil.example', `/${locale}/work-orders`] }));
    expect(intendedField()).toBeNull();
  });

  it('sends the intended page with the credentials when the form is submitted', async () => {
    const user = userEvent.setup();
    const { messages } = render(await page(locale, { intended: `/${locale}/invoices` }));
    await user.type(
      screen.getByRole('textbox', { name: messages['auth.login.email'] }),
      'someone@example.test'
    );
    const password = document.querySelector<HTMLInputElement>('input[name="password"]');
    if (password === null) throw new Error('the password field is missing');
    await user.type(password, 'a password');
    await user.click(screen.getByRole('button', { name: messages['auth.login.submit'] }));
    expect(login.calls).toHaveLength(1);
    const sent = login.calls[0];
    expect(sent?.get('intended')).toBe(`/${locale}/invoices`);
    expect(sent?.get('locale')).toBe(locale);
  });

  it('submits once when the button is pressed twice before the page re-renders', async () => {
    const { messages } = render(await page(locale, { reason: 'expired' }));
    let open: (state: ActionState) => void = () => undefined;
    login.answer = new Promise<ActionState>((resolve) => {
      open = resolve;
    });
    const button = screen.getByRole('button', { name: messages['auth.login.submit'] });
    await act(async () => {
      button.click();
      button.click();
    });
    expect(login.calls).toHaveLength(1);
    await act(async () => {
      open({ status: 'idle' });
    });
    // Still one once the first answer has settled: the second press was not
    // queued behind it.
    expect(login.calls).toHaveLength(1);
    const again = within(document.body).getByRole('button', {
      name: messages['auth.login.submit'],
    });
    expect(again).toBeEnabled();
    // And the hold is released: a refused sign-in can be tried again.
    login.answer = null;
    await act(async () => {
      again.click();
    });
    expect(login.calls).toHaveLength(2);
  });
});
