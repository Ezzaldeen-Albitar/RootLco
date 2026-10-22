/**
 * Whether the print sheet keeps an element on the paper.
 *
 * The rules of `styles/print/_index.scss`, which `gallery-and-print.dom.test.tsx`
 * holds against the compiled sheet: a direct child of a print scope that holds
 * an open document is left off unless it is, or holds, that document; and
 * `hide`, navigation and buttons never print. jsdom applies no print media, so
 * the page tests read the paper this way; the browser tier
 * (`tests/e2e/print-layout.spec.ts`) prints it.
 */
export function onPaper(element: Element): boolean {
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    if (node.matches('[data-print="hide"], nav, button:not([data-print="keep"])')) return false;
    const parent = node.parentElement;
    if (
      parent !== null &&
      parent.matches('[data-print-scope]') &&
      parent.querySelector('[data-print="document"]') !== null &&
      !node.matches('[data-print="document"]') &&
      node.querySelector('[data-print="document"]') === null
    ) {
      return false;
    }
  }
  return true;
}
