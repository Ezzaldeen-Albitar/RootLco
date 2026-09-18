/**
 * Control-plane organisation service (PRE-P1-29 Wave B; extended by
 * P1-32-PRE-022).
 *
 * Thin by design. The invariants that matter here are enforced in the database —
 * the bootstrap window, the transition graph, the append-only history, the
 * authority predicate on every policy — so a service that re-implemented them in
 * TypeScript would create a second place for them to drift. What it does own is
 * the two things the database cannot see: the operation's request shape, and the
 * rule that no caller value ever becomes an authorization principal.
 */
import { appendAudit } from '@/server/audit/audit';
import { AppFailure } from '@/server/errors/app-failure';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import {
  type DbHandle,
  withPlatformTarget,
  withPlatformTenantScope,
} from '@/server/db/transaction';
import { type Page, pageRequest } from '@/server/db/pagination';
import {
  type BranchCreateInput,
  type BranchRecordRow,
  type CompanyCreateInput,
  type CompanyRecordRow,
  type FirstOwnerInput,
  iamModule,
} from '@/modules/iam';
import { paymentsModule } from '@/modules/payments';
import { sharedServicesModule } from '@/modules/shared-services';
import type {
  CapacityAllowanceRow,
  CapacityUsageRow,
  OrganizationBranchRow,
  OrganizationCompanyRow,
  OrganizationRow,
  OrganizationSearchFilters,
  PlatformRepository,
  ProvisionedRoot,
  TenantStatusHistoryRow,
} from '../data/platform-repository';
import { ORGANIZATION_ORDERING } from '../data/platform-repository';
import type {
  SubscriptionEventRow,
  SubscriptionRepository,
  TenantSubscriptionRow,
} from '../data/subscription-repository';
import { TARGET_TENANT_DETAIL_FIELD } from '../data/insight-repository';

export interface OrganizationView {
  readonly id: string;
  readonly tenantCode: string;
  readonly displayName: string;
  readonly status: string;
  readonly defaultLocale: string;
  readonly defaultTimezone: string;
  readonly createdAt: string;
  readonly activePlanCode: string | null;
  readonly activePlanEffectiveTo: string | null;
  readonly activeCompanyCount: number;
  readonly activeBranchCount: number;
  readonly activeUserCount: number;
}

/**
 * How much of a plan's allowance an organisation is using, per kind.
 *
 * `limit` is null when the plan states none for that kind — which the console
 * renders as unlimited. That is the honest reading: `capacity_limits` is an open
 * document and an absent key is an absent rule, not a zero.
 *
 * The shape is `org.capacity_usage`'s own, re-exported rather than rebuilt: the
 * console and the tenant capacity read publish the SAME numbers because they
 * call the same function, which is what stops a screen explaining a refusal with
 * figures the database does not recognise.
 */
export type CapacityUsage = CapacityAllowanceRow;

/** Everything the console's organisation screen shows about one tenant. */
export interface OrganizationDetailView {
  readonly id: string;
  readonly tenantCode: string;
  readonly displayName: string;
  readonly status: string;
  readonly defaultLocale: string;
  readonly defaultTimezone: string;
  readonly createdAt: string;
  readonly companies: readonly OrganizationCompanyRow[];
  readonly branches: readonly OrganizationBranchRow[];
  /** Account counts by lifecycle state. Counts only — never an identity. */
  readonly userCountsByStatus: readonly { readonly status: string; readonly count: number }[];
  readonly subscriptions: readonly TenantSubscriptionRow[];
  readonly subscriptionEvents: readonly SubscriptionEventRow[];
  readonly statusHistory: readonly TenantStatusHistoryRow[];
  readonly capacity: CapacityUsageRow;
}

/** How many rows of each unbounded child list the detail publishes. */
const DETAIL_HISTORY_LIMIT = 100;

/**
 * What provisioning returns to the caller.
 *
 * Named and exported rather than written inline, because it crosses the wire:
 * an anonymous return type is invisible to the generated client and to anyone
 * reading the contract. Deliberately just the identifier — the caller reads the
 * organisation back through platform.organization-read rather than being handed
 * a projection built at creation time, so there is exactly one shape describing
 * a tenant and it is the one the read publishes.
 */
export interface ProvisionedOrganization {
  readonly tenantId: string;
  /** The first human principal of the tenant (P1-29 W9). */
  readonly ownerAccountId: string;
  /** `first_owner` — the narrow bootstrap IAM authority (frozen B7). */
  readonly firstOwnerRoleId: string;
  /** `tenant_administrator` — the tenant's ordinary administration role. */
  readonly tenantAdministratorRoleId: string;
  /** True when the request asked for activation and the tenant is now `active`. */
  readonly activated: boolean;
}

/** What provisioning takes beyond the organisation spec: the Owner, and whether to activate. */
export interface ProvisionCommand {
  readonly spec: Readonly<Record<string, unknown>>;
  readonly owner: FirstOwnerInput;
  readonly activate: boolean;
}

/**
 * What the console is handed after adding a legal company to an existing
 * organisation.
 *
 * `targetTenantId` travels with the row deliberately. Every other response on
 * this module describes the operator's own context; these three describe an act
 * performed INSIDE another organisation, and the response says which one rather
 * than leaving the caller to infer it from the path it happened to call.
 */
export interface CompanyAddedView {
  readonly targetTenantId: string;
  readonly company: CompanyRecordRow;
}

/** The branch half, with the numbering runs already established for it. */
export interface BranchAddedView {
  readonly targetTenantId: string;
  readonly branch: BranchRecordRow;
}

/**
 * What the console asks for when an organisation needs an administrator.
 *
 * `resend` and the establishment fields are one command rather than two
 * operations because they are one question asked of one address — "this
 * organisation's administrator has not arrived, act on it" — and splitting them
 * would put the same address lock, the same window and the same authority behind
 * two routes.
 */
export interface AdministratorCommand {
  readonly email: string;
  readonly displayName?: string | undefined;
  readonly additionalAdministrator: boolean;
  readonly reason?: string | undefined;
  readonly redirectTo?: string | undefined;
  readonly resend: boolean;
}

/** What an administrator setup or re-invitation established. Identifiers only. */
export interface AdministratorSetupResultView {
  readonly targetTenantId: string;
  /** `established` — an account was written and granted. `reinvited` — a fresh link, nothing written. */
  readonly outcome: string;
  readonly accountId: string | null;
  readonly tenantAdministratorRoleId: string | null;
  readonly roleEstablished: boolean;
  readonly administratorsBefore: number;
}

export class OrganizationService {
  constructor(
    private readonly repository: PlatformRepository,
    private readonly subscriptions: SubscriptionRepository
  ) {}

  /**
   * §6.5 — the organisation list, searchable and paginated.
   *
   * Wave B returned the tenant root and nothing beneath it, capped by a bare
   * LIMIT. The console needs to find an organisation by name and to see, without
   * opening it, what plan it is on and how big it is — so the read carries a
   * search fragment, a status filter and a keyset cursor, and each row carries
   * the plan in force and three counts. The rows a caller may see are still
   * decided by `sel_tenants_platform`, not by anything here.
   */
  async read(
    db: DbHandle,
    filters: OrganizationSearchFilters,
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined }
  ): Promise<Page<OrganizationView>> {
    const result = await this.repository.listOrganizations(
      db,
      filters,
      pageRequest(ORGANIZATION_ORDERING, page)
    );
    return { ...result, items: result.items.map(toView) };
  }

  /**
   * Everything the console shows about ONE organisation.
   *
   * Seven reads on one connection inside one transaction, so the document is
   * internally consistent: a subscription assigned between two of them cannot
   * appear in the trail and be missing from the list.
   *
   * A tenant the caller cannot see is `404`, not an empty document. The
   * distinction matters here more than usual, because "no companies" is a real
   * state for a tenant still provisioning and must not be confused with "no
   * such tenant".
   */
  async detail(db: DbHandle, tenantId: string): Promise<OrganizationDetailView> {
    const root = await this.repository.readTenantRoot(db, tenantId);
    if (!root) {
      throw new AppFailure('ERR-RES-001', { message: 'No such organization' });
    }

    // Sequential, not Promise.all: every read shares ONE connection, and `pg`
    // deprecates issuing a query on a client that is still executing another.
    const companies = await this.repository.listCompanies(db, tenantId);
    const branches = await this.repository.listBranches(db, tenantId);
    const userCounts = await this.repository.countUsersByStatus(db, tenantId);
    const subscriptions = await this.subscriptions.listSubscriptions(db, tenantId);
    const events = await this.subscriptions.listEvents(db, tenantId, DETAIL_HISTORY_LIMIT);
    const statusHistory = await this.repository.listStatusHistory(
      db,
      tenantId,
      DETAIL_HISTORY_LIMIT
    );
    // The allowance comes from `org.capacity_usage` rather than from the lists
    // above and the plan document. Those gave the console a SECOND definition of
    // every number, and it disagreed with the one that decides a refusal: the
    // database holds a seat for an `invited` account as well as an `active` one.
    const capacity = await this.repository.readCapacityUsage(db, tenantId);

    return {
      id: root.id,
      tenantCode: root.tenantCode,
      displayName: root.displayName,
      status: root.status,
      defaultLocale: root.defaultLocale,
      defaultTimezone: root.defaultTimezone,
      createdAt: root.createdAt,
      companies,
      branches,
      userCountsByStatus: userCounts,
      subscriptions,
      subscriptionEvents: events,
      statusHistory,
      capacity,
    };
  }

  /**
   * §6.2 + §6.3 — the sanctioned provisioning path, both halves in ONE
   * transaction (P1-29 W9):
   *
   *  1. the organisation: `org.provision_organization` writes tenant, history,
   *     subscription, company, branch, settings, overrides, sequences and the
   *     replay record — with `tenant.activate` NEVER forwarded, so the tenant
   *     is `provisioning` and the §6.3 window is open;
   *  2. the platform-on-target window, derived from what step 1 returned and
   *     never from the request: the First-Owner bootstrap writes the account,
   *     `first_owner`, `tenant_administrator`, their mappings and grants;
   *  3. the tenant's own canonical payment methods and its document-number
   *     sequences, in the same window, because a tenant that can neither take
   *     money nor number an invoice is not a provisioned workshop;
   *  4. the audit record, inside the same window, so the new tenant's own
   *     trail carries its genesis with the identifiers the bootstrap produced;
   *  5. only then, and only when asked, activation through the same function
   *     the lifecycle operation uses — AFTER a usable administrator exists.
   *
   * Any refusal at any step throws, and the transaction the route opened rolls
   * back all five. The committed states are therefore exactly two: nothing, or
   * a tenant that works (active if requested).
   *
   * Activation needs the lifecycle authority as well as the provisioning one,
   * because `upd_tenants_platform` is predicated on it. That is checked BEFORE
   * the first write, so a caller who cannot activate is refused with nothing
   * created rather than after a rolled-back tenant.
   */
  async provision(
    db: DbHandle,
    command: ProvisionCommand,
    idempotencyKey: string
  ): Promise<ProvisionedOrganization> {
    if (command.activate) {
      await this.requireLifecycleAuthority(db);
    }

    // The Owner's identity and profile ride inside the spec so the function's
    // own replay fingerprint (md5 of the whole document) covers them: the same
    // key with a different Owner is a different request at BOTH layers.
    const spec = {
      ...command.spec,
      owner: { email: command.owner.email, display_name: command.owner.displayName },
    };
    const created = await this.provisionOrRefuseDuplicate(db, spec, idempotencyKey);

    const tenant = (command.spec.tenant ?? {}) as Record<string, unknown>;
    const bootstrap = await withPlatformTarget(db, created.tenantId, async (target) => {
      const owner = await iamModule().tenantBootstrap.bootstrapFirstOwner(target, command.owner);

      // The tenant's own payment methods, in the same window and for the same
      // reason the roles are: a composite foreign key makes them a PRECONDITION
      // of the product working, not an administrative nicety a new operator can
      // be left to discover. `fk_receipts_method` resolves
      // (tenant_id, payment_method_id), a platform row's tenant_id is NULL, and
      // no route creates a tenant one — so before this call every organisation
      // this operation had ever created could read the payments experience and
      // record nothing. Six of them existed. The write belongs to `payments`:
      // this service names the need, that module owns `sal.payment_methods`, and
      // the vocabulary is the P1-11 seed's rather than either module's.
      //
      // A shortfall throws, so the whole provisioning unwinds. That is the
      // point: there must be no committed tenant the product calls provisioned
      // and which cannot record an ASM-14 receipt.
      const paymentMethods =
        await paymentsModule().methodBootstrap.provisionCanonicalMethods(target);

      // The document numbers, for the same reason and with the same failure
      // mode. Every human-facing number on this platform comes from
      // shared.next_display_number, which refuses when no row is configured for
      // (tenant, company, branch, code) — and app_runtime holds no INSERT here
      // either. Invoice issue, receipt record and quotation create do not
      // degrade: they fail. Zero rows existed for any tenant on the stack.
      //
      // Unlike the payment methods, this half needed NO migration:
      // ins_number_sequences_platform and the INSERT privilege have existed
      // since the control plane shipped and had simply never been used.
      const numberSequences =
        await sharedServicesModule().sequenceBootstrap.provisionRegisteredSequences(target, {
          companyId: created.companyId,
          branchId: created.branchId,
        });

      // Both control-plane writes declare auditClass: 'privileged' with a named
      // action, and NEITHER is written by the pipeline: route-handler validates
      // the declaration against the controlled catalogue and stops there, so an
      // operation can declare a privileged class, pass every structural gate,
      // and append nothing for the life of the product. Measured on this very
      // pair — both wrote zero rows until these calls existed. The record is
      // written in the TARGET tenant's context: it is that tenant's genesis.
      // Identifiers only — no credential, token or secret ever reaches it.
      await appendAudit(target, {
        action: 'org.tenant.provisioned',
        entityType: 'org.tenant',
        entityId: created.tenantId,
        details: [
          { field: 'tenant_code', classification: 'public', value: String(tenant.code ?? '') },
          {
            field: 'display_name',
            classification: 'public',
            value: String(tenant.display_name ?? ''),
          },
          { field: 'owner_account_id', classification: 'internal', value: owner.ownerAccountId },
          {
            field: 'first_owner_role_id',
            classification: 'internal',
            value: owner.firstOwnerRoleId,
          },
          {
            field: 'tenant_administrator_role_id',
            classification: 'internal',
            value: owner.tenantAdministratorRoleId,
          },
          { field: 'activated', classification: 'public', value: String(command.activate) },
          // Counts, not lists: both sets are server-owned and identical for
          // every tenant, so the fact worth recording is that the tenant left
          // the window able to take money and to number a document. Public —
          // neither names an identifier.
          {
            field: 'payment_methods_provisioned',
            classification: 'public',
            value: String(paymentMethods),
          },
          {
            field: 'number_sequences_provisioned',
            classification: 'public',
            value: String(numberSequences),
          },
        ],
      });
      return owner;
    });

    if (command.activate) {
      await this.repository.changeStatus(db, {
        tenantId: created.tenantId,
        toState: 'active',
        reason: 'activated at provisioning, after the first-owner bootstrap',
        correlationId: db.context.correlationId,
      });
    }

    // The SECOND record, and it is not a duplicate of the one above.
    //
    // The record written inside `withPlatformTarget` lives in the NEW tenant and
    // is that tenant's genesis. It is invisible to the operator's own trail,
    // because `sel_audit_records_platform` is `tenant_id = current_tenant_id()`
    // and the operator's current tenant is its home one — so before this call,
    // the single most consequential act on the control plane left NOTHING an
    // operator could find by searching its own audit trail. Measured: the
    // platform audit search returned zero rows for every tenant ever
    // provisioned.
    //
    // So the act is recorded a second time where the actor can see it, carrying
    // `target_tenant_id` — the field every platform operation stamps and the
    // field the audit search filters on. Identifiers only.
    await appendAudit(db, {
      action: 'org.tenant.provisioned',
      entityType: 'org.tenant',
      entityId: created.tenantId,
      details: [
        {
          field: TARGET_TENANT_DETAIL_FIELD,
          classification: 'internal',
          value: created.tenantId,
        },
        { field: 'tenant_code', classification: 'public', value: String(tenant.code ?? '') },
        { field: 'activated', classification: 'public', value: String(command.activate) },
      ],
    });

    return {
      tenantId: created.tenantId,
      ownerAccountId: bootstrap.ownerAccountId,
      firstOwnerRoleId: bootstrap.firstOwnerRoleId,
      tenantAdministratorRoleId: bootstrap.tenantAdministratorRoleId,
      activated: command.activate,
    };
  }

  /**
   * Adds a legal company to an organisation that is already running
   * (P1-32-PRE-151).
   *
   * The write is `iam`'s, not this module's, and the sharing is the point:
   * `org.company-create` and this operation issue the SAME statement through the
   * same port, so the duplicate-code refusal, the capacity refusal and the
   * companion state a company is born with are one implementation. What the
   * console adds is WHERE the act happens and where it is recorded — inside a
   * platform-on-target window for the named organisation, and audited in the
   * operator's own tenant with `target_tenant_id`, because
   * `sel_audit_records_platform` is `tenant_id = current_tenant_id()` and a
   * record written in the target would be invisible to the operator who made it.
   */
  async addCompany(
    db: DbHandle,
    tenantId: string,
    input: CompanyCreateInput
  ): Promise<CompanyAddedView> {
    const company = await withPlatformTenantScope(db, tenantId, (target) =>
      iamModule().organizationAdministration.writeCompany(target, input)
    );

    await appendAudit(db, {
      action: 'org.company.created',
      entityType: 'org.legal_company',
      entityId: company.id,
      details: [
        { field: TARGET_TENANT_DETAIL_FIELD, classification: 'internal', value: tenantId },
        { field: 'company_code', classification: 'public', value: company.companyCode },
        { field: 'legal_name', classification: 'public', value: company.legalName },
        {
          field: 'base_currency_code',
          classification: 'public',
          value: company.baseCurrencyCode,
        },
      ],
    });

    return { targetTenantId: tenantId, company };
  }

  /**
   * Adds a branch to a company of an organisation that is already running.
   *
   * Through the same `iam` port the tenant operation uses, so the branch arrives
   * with its invoice, quotation and receipt numbering runs — the half a console
   * copy of the insert would silently omit, leaving a branch that cannot issue
   * an invoice and a failure nobody could explain weeks later.
   */
  async addBranch(
    db: DbHandle,
    tenantId: string,
    input: BranchCreateInput
  ): Promise<BranchAddedView> {
    const branch = await withPlatformTenantScope(db, tenantId, (target) =>
      iamModule().organizationAdministration.writeBranch(target, input)
    );

    await appendAudit(db, {
      action: 'org.branch.created',
      entityType: 'org.branch',
      entityId: branch.id,
      details: [
        { field: TARGET_TENANT_DETAIL_FIELD, classification: 'internal', value: tenantId },
        { field: 'branch_code', classification: 'public', value: branch.branchCode },
        { field: 'name', classification: 'public', value: branch.name },
        { field: 'timezone_name', classification: 'public', value: branch.timezoneName },
      ],
    });

    return { targetTenantId: tenantId, branch };
  }

  /**
   * Gives an organisation its first administrator — or sends the outstanding
   * invitation again.
   *
   * The act that closes the hole the control plane has had since it shipped: an
   * organisation whose first owner never accepted their link had nobody who
   * could sign in, and no operation could give it one. Both paths run through
   * `iam`'s bootstrap service inside the target window, so the address lock, the
   * identity rules, the seat ceiling and the refusal recovery are the ones the
   * provisioning path already proves.
   *
   * The record is written in the operator's tenant for the reason the company
   * port states, and it carries the outcome: an operator asking "was this
   * organisation given an administrator, or merely reminded?" must be able to
   * tell from the trail.
   */
  async setUpAdministrator(
    db: DbHandle,
    tenantId: string,
    command: AdministratorCommand
  ): Promise<AdministratorSetupResultView> {
    const result = await withPlatformTenantScope(db, tenantId, (target) =>
      command.resend
        ? iamModule().tenantBootstrap.reinviteAdministrator(target, {
            email: command.email,
            ...(command.redirectTo === undefined ? {} : { redirectTo: command.redirectTo }),
          })
        : iamModule().tenantBootstrap.establishAdministrator(target, {
            email: command.email,
            displayName: command.displayName ?? '',
            additionalAdministrator: command.additionalAdministrator,
            ...(command.reason === undefined ? {} : { reason: command.reason }),
            ...(command.redirectTo === undefined ? {} : { redirectTo: command.redirectTo }),
          })
    );

    await appendAudit(db, {
      action: 'iam.tenant_administrator.invited',
      entityType: 'org.tenant',
      entityId: tenantId,
      details: [
        { field: TARGET_TENANT_DETAIL_FIELD, classification: 'internal', value: tenantId },
        { field: 'outcome', classification: 'public', value: result.outcome },
        // The address is `restricted`, so iam.audit_mask replaces it with a fixed
        // marker in the stored row: the trail proves that an administrator was
        // established and for which account, never who they are.
        { field: 'email', classification: 'restricted', value: command.email },
        {
          field: 'account_id',
          classification: 'internal',
          value: result.accountId ?? '',
        },
        {
          field: 'additional_administrator',
          classification: 'public',
          value: String(command.additionalAdministrator),
        },
        { field: 'reason', classification: 'internal', value: command.reason ?? '' },
      ],
    });

    return {
      targetTenantId: tenantId,
      outcome: result.outcome,
      accountId: result.accountId,
      tenantAdministratorRoleId: result.tenantAdministratorRoleId,
      roleEstablished: result.roleEstablished,
      administratorsBefore: result.administratorsBefore,
    };
  }

  /** The lifecycle predicate, asked of the database before anything is written. */
  /**
   * A second organization with a code already in use is a conflict, not an
   * outage. `org.provision_organization` inserts the tenant, company and branch
   * under their unique constraints and lets the violation surface raw; measured
   * on the shipped route (P1-29 W9 acceptance), a repeated tenant code answered
   * `500 ERR-SYS-001` with `uq_tenants_tenant_code` in the log. The same
   * collision on a role or department code answers `ERR-RES-002`, and so does
   * this one now. The constraint name says which code collided.
   */
  private async provisionOrRefuseDuplicate(
    db: DbHandle,
    spec: Readonly<Record<string, unknown>>,
    idempotencyKey: string
  ): Promise<ProvisionedRoot> {
    try {
      return await this.repository.provisionOrganization(db, spec, idempotencyKey);
    } catch (error) {
      if (isSqlState(error, SQLSTATE.uniqueViolation)) {
        const constraint = (error as { constraint?: unknown }).constraint;
        const which =
          constraint === 'uq_tenants_tenant_code'
            ? 'An organization with that code already exists'
            : 'A company or branch code in the request already exists';
        throw new AppFailure('ERR-RES-002', { message: which });
      }
      throw error;
    }
  }

  private async requireLifecycleAuthority(db: DbHandle): Promise<void> {
    const held = await this.repository.holdsPlatformAuthority(
      db,
      'platform.organization.lifecycle'
    );
    if (!held) {
      throw new AppFailure('ERR-IAM-001', {
        message:
          'Activation at provisioning requires platform.organization.lifecycle; provision without `activate` or activate later',
      });
    }
  }

  /**
   * §6.4 — the lifecycle transition.
   *
   * No actor is threaded through. The history row's `actor_id` is server-derived
   * by the shared stamp from `iam.current_user_id()`, which is also the value the
   * platform-authority predicate resolves from — so attribution and authority
   * come from the same trusted place and a request document cannot influence
   * either.
   */
  async changeStatus(
    db: DbHandle,
    params: {
      readonly tenantId: string;
      readonly toState: string;
      readonly reason: string;
      readonly correlationId?: string;
    }
  ): Promise<void> {
    // Read BEFORE the transition: `org.change_tenant_status` has already moved
    // the row by the time it returns, so afterwards there is no way to tell
    // whether a tenant arriving at `active` came back from suspension or was
    // being activated for the first time — and those are different events.
    const before = await this.repository.readTenantRoot(db, params.tenantId);
    const liveSubscription = await this.subscriptions.readLiveSubscriptionRef(db, params.tenantId);

    await this.repository.changeStatus(db, params);

    // Appended AFTER the transition, so a refusal by the M4 graph guard leaves
    // no record of a change that did not happen. The reason is caller-supplied
    // justification rather than a system value, so it is classified 'internal'
    // — it is already stored verbatim in org.tenant_status_history, and the
    // audit trail should not be the more exposed of the two copies.
    await appendAudit(db, {
      action: 'org.tenant.status_changed',
      entityType: 'org.tenant',
      entityId: params.tenantId,
      details: [
        {
          field: TARGET_TENANT_DETAIL_FIELD,
          classification: 'internal',
          value: params.tenantId,
        },
        { field: 'to_status', classification: 'public', value: params.toState },
        { field: 'reason', classification: 'internal', value: params.reason },
      ],
    });

    // A suspension and a reactivation are SUBSCRIPTION events as much as
    // lifecycle ones: they are what an operator is asked to explain when a
    // customer disputes a period. org.tenant_status_history records the
    // transition, but nothing joined it to the subscription it interrupted, so
    // the subscription trail read straight through a suspension as if service
    // had been continuous. The event is appended only when there IS a live
    // assignment to attach it to — an unsubscribed tenant being suspended is a
    // lifecycle fact and nothing more.
    const eventKind = subscriptionEventKindFor(before?.status ?? null, params.toState);
    if (eventKind !== null && liveSubscription !== null) {
      await this.subscriptions.appendEvent(db, {
        tenantId: params.tenantId,
        subscriptionId: liveSubscription.id,
        eventKind,
        fromPlanId: liveSubscription.planId,
        toPlanId: liveSubscription.planId,
        effectiveFrom: today(db),
        effectiveTo: null,
        reason: params.reason,
        correlationId: db.context.correlationId,
      });
    }
  }
}

/**
 * Which subscription event, if any, a lifecycle transition produces.
 *
 * Only two transitions do. Everything else — provisioning to active, active to
 * closed — is a lifecycle fact that the subscription trail has no opinion about,
 * and inventing an event for it would put rows in an append-only table that
 * nobody could later justify.
 */
function subscriptionEventKindFor(fromState: string | null, toState: string): string | null {
  if (toState === 'suspended' && fromState !== 'suspended') return 'suspended';
  if (toState === 'active' && fromState === 'suspended') return 'reactivated';
  return null;
}

/**
 * Today, as `YYYY-MM-DD`, from the request's own start time.
 *
 * `context.startedAt` rather than a fresh `new Date()`: every row this request
 * writes should agree about what day it is, and a request that straddles
 * midnight would otherwise record two different ones.
 */
function today(db: DbHandle): string {
  return db.context.startedAt.toISOString().slice(0, 10);
}

function toView(row: OrganizationRow): OrganizationView {
  return {
    id: row.id,
    tenantCode: row.tenantCode,
    displayName: row.displayName,
    status: row.status,
    defaultLocale: row.defaultLocale,
    defaultTimezone: row.defaultTimezone,
    createdAt: row.createdAt,
    activePlanCode: row.activePlanCode,
    activePlanEffectiveTo: row.activePlanEffectiveTo,
    activeCompanyCount: row.activeCompanyCount,
    activeBranchCount: row.activeBranchCount,
    activeUserCount: row.activeUserCount,
  };
}
