'use client';

import useMediaQuery from '@mui/material/useMediaQuery';

/** The media query an operator's "reduce motion" setting answers. */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether the operator asked the system for less motion.
 *
 * The product's own transitions already collapse under this setting: every
 * duration token is 0ms there (`styles/tokens`). Material UI and MUI X time
 * their transitions and chart animations in JavaScript, from numbers, so they
 * never see that token change. A wrapper that animates asks here and turns its
 * animation off — a dialog's fade, a chart's growing bars.
 *
 * `false` on the server and on the first render, then the real answer: the
 * worst this can do is animate one first frame for somebody who asked not to,
 * never hide content from anybody.
 */
export function useReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY);
}
