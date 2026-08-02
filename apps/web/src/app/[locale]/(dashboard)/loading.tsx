import { LoadingState } from '@/components/states/States';
import { DEFAULT_LOCALE } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';

/**
 * Route-group loading boundary.
 *
 * Reads the DEFAULT locale rather than the route's, because a `loading.tsx`
 * receives no params — and the alternative, threading the locale through a
 * client provider just to say one word, would make every navigation ship a
 * context before it could show a skeleton.
 */
export default function DashboardLoading() {
  return <LoadingState messages={getMessages(DEFAULT_LOCALE)} />;
}
