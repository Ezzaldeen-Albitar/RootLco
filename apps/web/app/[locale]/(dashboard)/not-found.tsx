import { NotFoundState } from '@/components/states/States';
import { DEFAULT_LOCALE } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';

/** Route-group not-found boundary. Renders inside the shell, not bare. */
export default function DashboardNotFound() {
  return <NotFoundState messages={getMessages(DEFAULT_LOCALE)} />;
}
