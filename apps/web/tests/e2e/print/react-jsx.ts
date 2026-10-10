import { createRequire } from 'node:module';
import * as react from 'react/jsx-runtime';

/**
 * Makes JSX compiled by the Playwright runner produce React elements.
 *
 * Playwright compiles every TypeScript file a spec imports with ITS OWN JSX
 * runtime (`playwright/jsx-runtime`), which builds plain descriptor objects for
 * component testing rather than React elements. The print-layout spec renders
 * the application's real document components to HTML with `react-dom/server`,
 * and React refuses those descriptors. So, for this worker process, the three
 * names that runtime exports are pointed at React's own. The compiled code
 * reads them from the module object on every call, which is what makes the
 * assignment effective, and nothing else in the browser tier compiles JSX.
 *
 * Imported FIRST by the spec, before any module whose JSX it renders.
 */
const runtime = createRequire(__filename)('playwright/jsx-runtime') as Record<string, unknown>;
runtime['jsx'] = react.jsx;
runtime['jsxs'] = react.jsxs;
runtime['Fragment'] = react.Fragment;
