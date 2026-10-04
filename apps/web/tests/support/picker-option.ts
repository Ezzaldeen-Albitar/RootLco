import { screen, waitFor } from '@testing-library/react';

/**
 * How long a searched picker option may take to appear.
 *
 * A picker lists an option only after the search pause (`SEARCH_DEBOUNCE_MS`),
 * the replaced read and a render. Testing Library's 1000 ms default was spent
 * on that chain by a loaded CI runner (PR #485, web-quality job 109551243343),
 * so a correct screen failed. This bound is a ceiling, not a delay: a case
 * waits only as long as the option takes, and it stays well inside the 30 s
 * test timeout.
 */
export const PICKER_OPTION_WAIT_MS = 10_000;

/** The part of a `vi.fn()` this helper reads. */
interface ReplacedRead {
  readonly mock: {
    readonly calls: readonly (readonly unknown[])[];
    readonly results: readonly { readonly type: string; readonly value: unknown }[];
  };
}

const asks = (args: readonly unknown[], term: string) =>
  args.some(
    (arg) => typeof arg === 'object' && arg !== null && (arg as { readonly q?: unknown }).q === term
  );

/**
 * The option a search for `term` lists, once that search has been ASKED and
 * ANSWERED.
 *
 * The wait is ordered by what the option depends on rather than by a guessed
 * duration: first the replaced `read` must have been called with `{ q: term }`,
 * then that call's answer must have settled, and only then is the option
 * looked for. Each step has the same bounded ceiling, so a failure says which
 * step never happened — the search never went out, or it answered and the
 * option never rendered.
 */
export async function findSearchedOption(
  read: ReplacedRead,
  term: string,
  name: RegExp
): Promise<HTMLElement> {
  let asked = -1;
  await waitFor(
    () => {
      asked = -1;
      read.mock.calls.forEach((args, index) => {
        if (asks(args, term)) asked = index;
      });
      if (asked < 0) throw new Error(`No search was asked for "${term}".`);
    },
    { timeout: PICKER_OPTION_WAIT_MS }
  );
  const answer = read.mock.results[asked];
  if (answer?.type === 'return') {
    await Promise.resolve(answer.value).catch(() => undefined);
  }
  return screen.findByRole('option', { name }, { timeout: PICKER_OPTION_WAIT_MS });
}
