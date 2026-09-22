import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { Locale } from '@/i18n/config';
import { directionOf } from '@/i18n/config';
import { getMessages, type Messages } from '@/i18n/get-messages';
import { WorkingContextProvider } from '@/features/working-context/WorkingContextProvider';
import type {
  WorkingContextBranch,
  WorkingContextSnapshot,
} from '@/features/working-context/working-context-contract';

/**
 * Render helpers that put the component in a real DIRECTION.
 *
 * `dir` lives on `<html>` in the application, so a component tested in a bare
 * jsdom container is always LTR — and every RTL bug survives the suite. These
 * set `dir` and `lang` on the document element, exactly as the locale layout
 * does, so a logical-property mistake actually shows up.
 */

export interface LocaleRenderResult extends RenderResult {
  readonly messages: Messages;
  readonly locale: Locale;
}

function renderIn(locale: Locale, ui: ReactElement, options?: RenderOptions): LocaleRenderResult {
  document.documentElement.lang = locale;
  document.documentElement.dir = directionOf(locale);
  const result = render(ui, options);
  return Object.assign(result, { messages: getMessages(locale), locale });
}

/** English, LTR. */
export function renderLtr(ui: ReactElement, options?: RenderOptions): LocaleRenderResult {
  return renderIn('en', ui, options);
}

/** Arabic, RTL. */
export function renderRtl(ui: ReactElement, options?: RenderOptions): LocaleRenderResult {
  return renderIn('ar', ui, options);
}

/** Both directions, so a case cannot pass in one and be forgotten in the other. */
export const BOTH_DIRECTIONS: readonly [Locale, typeof renderLtr][] = [
  ['en', renderLtr],
  ['ar', renderRtl],
];

export const messagesFor = getMessages;

/**
 * A screen, standing in the branch an operator is working in.
 *
 * ## Why this exists rather than props on each screen
 *
 * The company/branch pair used to be two controls on every branch-addressed
 * screen, so a test set it by typing a reference or picking one from a select.
 * It is now one choice held by the shell, so a test that renders a screen
 * OUTSIDE the provider is rendering it for an operator whose branch list could
 * not be read — which is a real state, and not the one most cases are about.
 *
 * The default is a single authorized branch, because that is both the ordinary
 * workshop and the case the provider auto-selects: the screen is addressed and
 * reads immediately, exactly as a one-branch session did before.
 */
export const TEST_COMPANY = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Test Operations',
  code: 'OPS',
};

export const TEST_BRANCH: WorkingContextBranch = {
  id: '22222222-2222-4222-8222-222222222222',
  companyId: TEST_COMPANY.id,
  code: 'MAIN',
  name: 'Main workshop',
  city: null,
  timezone: 'Asia/Riyadh',
  status: 'active',
};

export function branchSnapshot(
  branches: readonly WorkingContextBranch[] = [TEST_BRANCH],
  status: WorkingContextSnapshot['status'] = 'ready'
): WorkingContextSnapshot {
  return {
    status,
    tenantId: '33333333-3333-4333-8333-333333333333',
    accountId: '44444444-4444-4444-8444-444444444444',
    unrestricted: false,
    companies: [TEST_COMPANY],
    branches,
  };
}

/** Wraps a screen in a working context. Pass the snapshot to vary the case. */
export function inBranch(
  ui: ReactElement,
  options: {
    readonly snapshot?: WorkingContextSnapshot;
    readonly locale?: Locale;
  } = {}
): ReactElement {
  return (
    <WorkingContextProvider
      snapshot={options.snapshot ?? branchSnapshot()}
      messages={getMessages(options.locale ?? 'en')}
    >
      {ui}
    </WorkingContextProvider>
  );
}
