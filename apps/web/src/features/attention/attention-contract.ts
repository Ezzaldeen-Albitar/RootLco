/**
 * The Attention area's contract (Owner directive, operational alerts).
 *
 * Five reads, and not one write:
 *
 * | operation                              | method | path                                     | permission        |
 * | -------------------------------------- | ------ | ---------------------------------------- | ----------------- |
 * | `inv.low-stock-alert-read`             | GET    | `/inventory-alerts/low-stock`            | `inv.stock.read`  |
 * | `inv.count-discrepancy-alert-read`     | GET    | `/inventory-alerts/count-discrepancies`  | `inv.stock.read`  |
 * | `inv.unusual-consumption-alert-read`   | GET    | `/inventory-alerts/unusual-consumption`  | `inv.stock.read`  |
 * | `inv.aged-in-transit-alert-read`       | GET    | `/inventory-alerts/aged-in-transit`      | `inv.stock.read`  |
 * | `org.capacity-alert-read`              | GET    | `/org/capacity-alerts`                   | `org.tenant.read` |
 *
 * ## A suggestion is not a transaction
 *
 * Nothing on this surface posts stock or money, and nothing on it can. The four
 * stock reads are addressed through `features/inventory/api.ts`, which offers
 * this screen no writer; the capacity read is the only adapter this feature
 * owns, and it is a `GET`. The one figure that looks like an instruction — the
 * preferred order quantity beside a low-stock row — is a quantity somebody
 * recorded on the item, rendered under a label that says it is a suggestion. It
 * orders nothing, reserves nothing and moves nothing.
 *
 * ## Every card carries the instant the database answered
 *
 * `asOf` is the database's own `now()` inside the request's transaction, not
 * this process's clock and not the moment the card painted. A card that cannot
 * state it does not show figures at all.
 *
 * ## Where a row goes
 *
 * A finding a reader can do nothing about is a nuisance. Every row links to the
 * screen where the work is done, and the targets are below rather than inline
 * so a screen that moves is corrected in one place. None of those screens takes
 * a record in its address today, so each link names the screen itself; when one
 * gains a deep link, only this map changes.
 */
import type { Locale } from '@/i18n/config';

/** The codes the Attention area consults, as the backend registers them. */
export const ATTENTION_PERMISSIONS = {
  /** The four stock alerts. Each of them is a statement about stock. */
  stockRead: 'inv.stock.read',
  /** The subscription allowance — the same code `GET /org/capacity` requires. */
  tenantRead: 'org.tenant.read',
  /** Whether a branch list is requested for the target picker. */
  branchRead: 'org.branch.read',
} as const;

/** One capacity kind worth telling an administrator about. */
export interface CapacityAlertEntry {
  /** `companies`, `branches` or `users`. */
  readonly kind: string;
  readonly used: number;
  readonly limit: number;
  /** `near-limit`, `at-limit` or `over-limit`, decided by the server. */
  readonly severity: string;
  /** The limit less what is used. Negative when the allowance is exceeded. */
  readonly headroom: number;
}

/** One allowance, alerting or not, as `org.capacity_usage` computes it. */
export interface CapacityAllowanceEntry {
  readonly used: number;
  /** Absent when the plan places no ceiling on this kind. */
  readonly limit: number | null;
}

/** `org.capacity-alert-read`: the ceilings that are about to refuse a write. */
export interface CapacityAlerts {
  readonly asOf: string;
  readonly rule: { readonly statement: string; readonly nearLimitRatio: number };
  /** Only the kinds that qualify. An empty list means nothing is close. */
  readonly alerts: readonly CapacityAlertEntry[];
  readonly capacity: Readonly<Record<string, CapacityAllowanceEntry>>;
  readonly subscription: {
    readonly planCode: string;
    readonly displayName: string;
    readonly status: string;
    readonly effectiveFrom: string;
    readonly effectiveTo: string | null;
  } | null;
}

/** The capacity kinds shown, in the order an administrator reads them. */
export const CAPACITY_KINDS = ['companies', 'branches', 'users'] as const;

/**
 * Where each kind of finding is acted on.
 *
 * `capacity` is the exception that proves the rule: an allowance is raised by
 * the platform owner and not by anyone inside the organisation, so the link goes
 * to the screen that explains the allowance rather than to a control that could
 * not help.
 */
export function attentionLink(
  locale: Locale,
  kind: 'lowStock' | 'discrepancy' | 'consumption' | 'inTransit' | 'capacity',
  itemId?: string
): string {
  if (kind === 'lowStock') {
    return itemId === undefined
      ? `/${locale}/inventory`
      : `/${locale}/inventory/items/${encodeURIComponent(itemId)}`;
  }
  if (kind === 'discrepancy') return `/${locale}/inventory/counts`;
  if (kind === 'consumption') return `/${locale}/inventory/movements`;
  if (kind === 'inTransit') return `/${locale}/inventory/transfers`;
  return `/${locale}/administration/organization`;
}

/**
 * The message key for a read that did not answer.
 *
 * Five outcomes, five sentences, and none of them is a zero. A card that
 * rendered "0 items are low" because the read was refused would be stating a
 * fact about the stock that nobody established — which is the failure this whole
 * surface exists to avoid.
 */
export function refusalKey(status: 'denied' | 'expired' | 'unavailable' | 'error' | 'not-found') {
  if (status === 'denied') return 'attention.state.denied';
  if (status === 'expired') return 'attention.state.expired';
  if (status === 'unavailable') return 'attention.state.unavailable';
  return 'attention.state.error';
}
