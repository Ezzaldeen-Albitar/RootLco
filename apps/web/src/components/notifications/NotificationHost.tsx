'use client';

import { useSyncExternalStore } from 'react';
import { ToastRegion } from '@/components/overlays/Overlays';
import type { Messages } from '@/i18n/get-messages';
import {
  dismiss,
  notificationServerSnapshot,
  notificationSnapshot,
  subscribeNotifications,
} from './notification-store';

/**
 * The one place notifications are rendered.
 *
 * Mounted in the locale layout, as a direct child of `<body>` and OUTSIDE the
 * application shell. That position is load-bearing three times over:
 *
 *  1. The shell is `overflow:hidden`. A toast rendered inside it would be
 *     clipped the moment the stack grew past the shell's box.
 *  2. `body` is `overflow:hidden` too, so a toast must be `position:fixed` to be
 *     positioned against the viewport at all — which it is, in `ToastRegion`.
 *  3. `position:fixed` resolves against the viewport ONLY while no ancestor has
 *     a transform, filter, perspective or paint containment. This is why the
 *     scroll-ownership fix uses `position:relative` on `main` rather than
 *     `contain:paint`: paint containment would have created a containing block
 *     for fixed descendants and, had the host been mounted deeper, pinned the
 *     toast inside a scrolling region. Mounting here means neither choice can
 *     break it.
 *
 * No portal is used, and none is needed: a portal exists to escape an ancestor,
 * and this component has no ancestor to escape. Reaching for `createPortal`
 * here would add a hydration boundary and a `document` dependency to buy
 * nothing.
 *
 * The component renders even when the list is empty. That is not waste — the
 * live region has to exist BEFORE the message does, or assistive technology has
 * nothing to observe a change within and the first notification is announced to
 * nobody.
 */
export function NotificationHost({ messages }: { readonly messages: Messages }) {
  const toasts = useSyncExternalStore(
    subscribeNotifications,
    notificationSnapshot,
    notificationServerSnapshot
  );

  return <ToastRegion messages={messages} toasts={toasts} onDismiss={dismiss} />;
}
