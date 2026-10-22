import { EARLY_CHOICE_SCRIPT } from '../early-choice-mark';

/**
 * The inline script that records a person's choice in a branch select before
 * React has hydrated it (`early-choice-mark.ts`, P1-32-PRE-OD-UXQ, F-1).
 *
 * Rendered by the locale layout as the first element of the body, so it runs
 * before any select below it is parsed. It carries the request's CSP nonce:
 * the policy admits an inline script only with that nonce
 * (`src/lib/security/csp.ts`), and nothing about the policy changes for it.
 *
 * `suppressHydrationWarning` because the HTML standard has a browser hide a
 * script's `nonce` attribute once the element is in the document, so the attribute React finds
 * when it hydrates is empty while the value it renders is not. It suppresses
 * that one element's own attribute and text comparison and nothing below it.
 */
export function EarlyChoiceScript({ nonce }: { readonly nonce: string | undefined }) {
  return (
    <script nonce={nonce} suppressHydrationWarning>
      {EARLY_CHOICE_SCRIPT}
    </script>
  );
}
