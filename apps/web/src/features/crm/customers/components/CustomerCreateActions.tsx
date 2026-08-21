import Link from 'next/link';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';

/**
 * "Add an individual customer" / "Add a company customer".
 *
 * ## Why this exists as its own component
 *
 * The Product Owner rejected the customer search at Owner acceptance: "Customer
 * Search has no clear Add Customer action", and "the system does not guide a
 * normal non-technical user through creating an Individual Customer or Company
 * Customer". The two creation routes existed and were reachable only by typing
 * the URL, or by running a search that found nothing.
 *
 * The actions now appear in TWO places — the page header, where an operator
 * looks for a primary action, and again beneath a search that found nothing,
 * where the thought "this customer is new" actually occurs. Two call sites, one
 * component, so the labels, the permission rule and the destinations cannot
 * drift apart.
 *
 * ## Two buttons, not one with a menu
 *
 * An individual and a company are different records with different fields, and
 * the choice is made before any typing starts. A single "Add customer" that
 * opens a chooser adds a step to every creation to save one word on a screen
 * that has room for it.
 *
 * ## Permission
 *
 * `canCreate` is `crm.customer.create`, resolved from the session on the server.
 * Absent rather than disabled: a disabled control says "this exists and you are
 * not allowed", which invites an operator to go and ask for a permission they
 * may have no business holding. This is a hint, never the boundary —
 * `POST /api/v1/customers` enforces the permission on every request and stays
 * the authority.
 */

export interface CustomerCreateActionsProps {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly canCreate: boolean;
  /**
   * `primary` renders the pair as page actions — one filled, one outlined.
   * `contextual` renders them side by side under an empty result, where neither
   * is more likely than the other.
   */
  readonly variant?: 'primary' | 'contextual';
}

const PRIMARY =
  'inline-flex items-center rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover';
const SECONDARY =
  'inline-flex items-center rounded-md border border-border px-4 py-2 text-body font-medium text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle';

export function CustomerCreateActions({
  locale,
  messages,
  canCreate,
  variant = 'primary',
}: CustomerCreateActionsProps) {
  if (!canCreate) return null;

  const individual = translate(messages, 'crm.customers.search.createIndividual');
  const company = translate(messages, 'crm.customers.search.createCompany');

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="customer-create-actions">
      <Link
        href={`/${locale}/crm/customers/new/individual`}
        data-testid="add-individual-customer"
        className={variant === 'primary' ? PRIMARY : SECONDARY}
      >
        {individual}
      </Link>
      <Link
        href={`/${locale}/crm/customers/new/company`}
        data-testid="add-company-customer"
        className={SECONDARY}
      >
        {company}
      </Link>
    </div>
  );
}
