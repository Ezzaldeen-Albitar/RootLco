/**
 * The warranty POLICY and COVERAGE surface (P1-31 prerequisite P-10, **PPD-04**).
 *
 * `wty.warranty_policies` and `wty.warranty_coverage` landed in P1-11 carrying
 * SELECT, INSERT and UPDATE grants for `app_runtime` and an INSERT and an UPDATE
 * policy each, and until this slice **nothing in `apps/api/src` had ever written
 * either one**. Every method that touched them only READ them: to explain a warranty
 * that already cites a policy, or to resolve the terms `wty.issue_warranty` will
 * apply.
 *
 * The consequence is the one A0 records under PPD-04. `wty.warranty-generate` refuses
 * with `ERR-RES-001` and the message "A policy and its effective-dated coverage are
 * operator configuration; the backend does not create one" whenever a company has no
 * active policy — and no operator could create one, so on a tenant provisioned through
 * the product NO warranty could ever be issued. The `wty.policy.manage` code the
 * catalogue has seeded since P1-08 was declared by nothing at all.
 *
 * ## Why this is its own service and not a method on `WarrantyService`
 *
 * `WarrantyService` is warranty GENERATION: it establishes a delivery's preconditions,
 * calls one primitive and reads the record back. This is CONFIGURATION — authored long
 * before any delivery exists, by a different person, under a different authority, and
 * touching no delivery, no work order and no warranty record. `serviceCatalogModule().catalogWrites`
 * is the precedent for a second write service inside one module. The SQL still lives in
 * the one repository file, because two files writing one table is how a tenant
 * predicate ends up on one query and not the other.
 *
 * ## The authority is COMPANY-WIDE, and it is measured rather than chosen
 *
 * Every write calls `authorizeScope({ companyId })` against the row's own company, so
 * a caller must hold `wty.policy.manage` for that company or through an unrestricted
 * grant. `iam.has_permission_in_scope(code, company, NULL, NULL)` is satisfied only by
 * `scope_mode = 'unrestricted'` or by a `company`-type grant scope naming it — a
 * BRANCH-scoped grant compares `s.branch_id = NULL` and does not apply.
 *
 * Company-wide because the row's reach is company-wide: both tables carry a
 * `company_id` and NO `branch_id`, the RLS policies narrow by
 * `iam.allowed_company_ids()` with no branch clause, and `resolvePolicy` picks a
 * company's ONLY active policy for every branch of it. One coverage row authored here
 * therefore sets the terms of every warranty issued in every branch of that company.
 * A branch-scoped actor must not be able to do that.
 *
 * ## The READS deliberately do not re-authorize against the company
 *
 * They declare `wty.warranty.read` and `scope: 'tenant'`, narrowed by
 * `sel_warranty_policies_scope` — tenant plus `iam.allowed_company_ids()`, a set that
 * includes the company of a BRANCH-scoped grant because `ck_grant_scopes_shape`
 * requires every scope row to name its company. Requiring company-wide authority to
 * READ would deny the policy list to exactly the principal who needs it: whoever
 * issues a warranty must be able to name the policy to issue under, and
 * `wty.warranty-generate` is `scope: 'branch'`. The P-2…P-5 read seam states the same
 * rule — a read on this surface must be holdable by the principal that acts on it.
 *
 * ## What is NOT offered, and why each absence is deliberate
 *
 * - **No hard delete, of a policy or of a coverage row.** Neither table carries a
 *   DELETE grant or a DELETE policy for any application role, and
 *   `fk_warranty_records_policy` and `fk_warranty_records_coverage` are
 *   `ON DELETE RESTRICT` — a warranty record cites both by id for the life of the
 *   warranty. Retirement is `status = 'archived'`, which is the column both tables
 *   already carry for it.
 * - **No soft delete either.** `deleted_at` exists on both tables and this surface
 *   never sets it. A soft-deleted policy would vanish from `findPolicyByCode` and
 *   `listActivePolicies` while `findPolicy` still resolved it for an existing
 *   warranty, which is a second retirement mechanism meaning something subtly
 *   different from the first; one is enough and `status` is the one the issue path
 *   already reads.
 * - **No coverage edit.** `tg_warranty_coverage_immutable` freezes `policy_id` and
 *   `effective_from`, so the two fields that decide WHICH window a row occupies
 *   cannot move; and `ex_warranty_coverage_no_overlap` is evaluated per statement, so
 *   editing `effective_to` in place would silently re-open or re-close a window that
 *   warranties have already been issued under. Archive the row and add the one you
 *   meant: that leaves the superseded terms readable beside the warranties that cite
 *   them.
 * - **No second name.** `wty.warranty_policies` has one `name` column and no locale
 *   column, so a bilingual name cannot be stored. Adding one is a migration and not
 *   this slice.
 * - **No money.** `wty` has 80 columns and not one is an amount, a currency or a cap
 *   in any unit of account. `durationMonths` is a count of months and is an
 *   `integer`; `odometerAllowance` is a distance and is published as an exact decimal
 *   STRING, spelled exactly as `WarrantyCoverageView` spells it so the coverage a
 *   warranty cites and the coverage an operator authors are one shape.
 */
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import { pageRequest, type Page, type PageRequest } from '@/server/db/pagination';
import type { CoveredScope, WarrantyLifecycleStatus } from '../domain/warranty';
import {
  WARRANTY_POLICY_ORDER,
  type WarrantyCoverageRow,
  type WarrantyPolicyRow,
  type WarrantyRepository,
} from '../data/warranty-repository';

/**
 * One policy header, as a caller sees it.
 *
 * A superset of `WarrantyPolicyView`, which `wty.warranty-detail` and
 * `wty.warranty-list` publish on a warranty: the four fields they carry are spelled
 * identically here, and this adds the two an administration surface needs —
 * `companyId`, so a tenant-wide list says which company a row belongs to, and
 * `recordVersion`, which is the `If-Match` the two commands over it require.
 */
export interface WarrantyPolicySummaryView {
  readonly id: string;
  readonly companyId: string;
  readonly policyCode: string;
  readonly name: string;
  readonly status: string;
  readonly recordVersion: number;
}

/**
 * One effective-dated coverage row: the entire source of a warranty's terms.
 *
 * `coveredScope`, `durationMonths`, `odometerAllowance`, `effectiveFrom`,
 * `effectiveTo` and `status` are spelled exactly as `WarrantyCoverageView` spells
 * them on an issued warranty. `odometerAllowance` is deliberately NOT called
 * `odometerLimit`: this is the RELATIVE distance the coverage grants, while
 * `wty.warranty_records.odometer_limit` is the ABSOLUTE reading at which a warranty
 * lapses. They are the same column name in two tables and the wrong one is a silently
 * wrong warranty, which is why the wire has never used one word for both.
 */
export interface WarrantyCoverageTermsView {
  readonly id: string;
  readonly policyId: string;
  readonly coveredScope: string;
  readonly durationMonths: number;
  readonly odometerAllowance: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: string;
  readonly recordVersion: number;
}

export interface WarrantyPolicyListView {
  readonly policies: Page<WarrantyPolicySummaryView>;
}

/** A policy WITH its coverage rows, in a stable published order. */
export interface WarrantyPolicyDetailView {
  readonly policy: WarrantyPolicySummaryView;
  readonly coverage: readonly WarrantyCoverageTermsView[];
}

export interface CreateWarrantyCoverageInput {
  readonly coveredScope: CoveredScope;
  readonly durationMonths: number;
  readonly odometerAllowance?: string | undefined;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | undefined;
}

export interface CreateWarrantyPolicyInput {
  readonly companyId: string;
  readonly policyCode: string;
  readonly name: string;
  readonly coverage: readonly CreateWarrantyCoverageInput[];
}

const toPolicyView = (row: WarrantyPolicyRow): WarrantyPolicySummaryView => ({
  id: row.id,
  companyId: row.companyId,
  policyCode: row.policyCode,
  name: row.name,
  status: row.status,
  recordVersion: row.recordVersion,
});

const toCoverageView = (row: WarrantyCoverageRow): WarrantyCoverageTermsView => ({
  id: row.id,
  policyId: row.policyId,
  coveredScope: row.coveredScope,
  durationMonths: row.durationMonths,
  odometerAllowance: row.odometerLimit,
  effectiveFrom: row.effectiveFrom,
  effectiveTo: row.effectiveTo,
  status: row.status,
  recordVersion: row.recordVersion,
});

/**
 * The three CHECK constraints a coverage body can violate, mapped to their field.
 *
 * Read from the driver error's `constraint` field by NAME, the way
 * `INVOICE_UNIQUE_INDEX` is: the SQLSTATE alone says only "a CHECK refused this row"
 * and a caller cannot act on that. The application refuses each of these at the
 * boundary as well, so reaching one of them means the boundary and the column
 * disagree — which is exactly when the caller most needs to be told which field.
 */
const COVERAGE_CHECK_FIELD: Readonly<Record<string, string>> = Object.freeze({
  ck_warranty_coverage_scope: 'coveredScope',
  ck_warranty_coverage_duration: 'durationMonths',
  ck_warranty_coverage_odometer: 'odometerAllowance',
  ck_warranty_coverage_effective: 'effectiveTo',
  ck_warranty_coverage_status: 'status',
});

/** Reads the violated constraint name from an unknown driver error, if present. */
function violatedConstraint(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'constraint' in error) {
    const name = (error as { constraint?: unknown }).constraint;
    return typeof name === 'string' ? name : undefined;
  }
  return undefined;
}

export class WarrantyPolicyService {
  public constructor(private readonly repository: WarrantyRepository) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /** `wty.warranty-policy-list` — every policy the caller can see. */
  public async listPolicies(
    db: DbHandle,
    filter: { readonly status?: WarrantyLifecycleStatus | undefined },
    page: { readonly limit?: number | undefined; readonly cursor?: string | undefined }
  ): Promise<WarrantyPolicyListView> {
    const request: PageRequest = pageRequest(WARRANTY_POLICY_ORDER, page);
    const rows = await this.repository.listPolicies(db, request, {
      ...(filter.status === undefined ? {} : { status: filter.status }),
    });
    return { policies: { ...rows, items: rows.items.map(toPolicyView) } };
  }

  /**
   * `wty.warranty-policy-read` — one policy with its coverage rows.
   *
   * Absent and out-of-scope answer the same `ERR-RES-001`, decided by the row read
   * rather than by a scope decision, so the operation is not an existence oracle for
   * a policy in a company the caller cannot see.
   */
  public async readPolicy(db: DbHandle, policyId: string): Promise<WarrantyPolicyDetailView> {
    const policy = await this.requirePolicy(db, policyId);
    const coverage = await this.repository.listCoverageOfPolicy(db, policy.companyId, policy.id);
    return { policy: toPolicyView(policy), coverage: coverage.map(toCoverageView) };
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  /**
   * `wty.warranty-policy-create` — the header and its coverage, atomically.
   *
   * Coverage travels in the same body because it travels in the same transaction. A
   * policy with no coverage is the exact configuration `wty.issue_warranty` refuses
   * with a bare `check_violation` and `findCoverageEffectiveOn` exists to explain —
   * `POLICY_NO_COVERAGE` is a fixture in the P1-22 helpers precisely because that
   * state is reachable — so publishing create-then-add-each as the only way to
   * author a policy would make the half-configured policy the normal outcome of a
   * dropped connection. Every method here runs inside the route handler's
   * transaction, so either the whole policy exists or none of it does.
   *
   * The caller may still omit `coverage` and add rows one at a time afterwards: a
   * policy that is still being authored is a legitimate intermediate state as long as
   * it was chosen rather than fallen into.
   */
  public async createPolicy(
    db: DbHandle,
    input: CreateWarrantyPolicyInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<WarrantyPolicyDetailView> {
    // The company is a CLAIM about where the row belongs, checked against the
    // caller's own grant scope before anything is written. There is no branch half:
    // neither table has a branch column, and `requireScopedPermissions` accepts a
    // company-only target — the shape `iam.company-settings-write` already uses.
    await authorizeScope({ companyId: input.companyId });

    // Refused here rather than left to `ex_warranty_coverage_no_overlap`, because the
    // constraint would abort the transaction and the caller would learn only that
    // "two coverage windows overlap" — not that it sent the overlap itself, in one
    // body, and can fix it without reading anything back.
    this.#refuseSelfOverlap(input.coverage);

    let policy: WarrantyPolicyRow;
    try {
      policy = await this.repository.insertPolicy(db, {
        companyId: input.companyId,
        policyCode: input.policyCode,
        name: input.name,
      });
    } catch (cause) {
      this.#refusePolicyWriteFailure(cause, input.policyCode);
    }

    const created: WarrantyCoverageRow[] = [];
    for (const [index, terms] of input.coverage.entries()) {
      created.push(await this.#insertCoverage(db, policy, terms, `body.coverage.${String(index)}`));
    }

    await appendAudit(db, {
      action: 'wty.warranty_policy.created',
      entityType: 'wty.warranty_policy',
      entityId: policy.id,
      companyId: policy.companyId,
      requestRef: 'wty.warranty-policy-create',
      details: [
        { field: 'policyCode', classification: 'internal', value: policy.policyCode },
        { field: 'name', classification: 'internal', value: policy.name },
        { field: 'status', classification: 'public', value: policy.status },
        // Recorded because a policy with no coverage cannot issue a warranty: the
        // audit trail should say whether the terms arrived with the header.
        { field: 'coverageCount', classification: 'public', value: String(created.length) },
      ],
    });

    return {
      policy: toPolicyView(policy),
      coverage: created
        .slice()
        .sort(
          (a, b) =>
            a.coveredScope.localeCompare(b.coveredScope) ||
            a.effectiveFrom.localeCompare(b.effectiveFrom) ||
            a.id.localeCompare(b.id)
        )
        .map(toCoverageView),
    };
  }

  /**
   * `wty.warranty-policy-rename` — the name, and nothing else.
   *
   * `policyCode` is absent from the body. It is not frozen by a trigger —
   * `tg_warranty_policies_immutable` freezes the tenant, the company, `created_at`
   * and `created_by`, and the code is merely held by `uq_warranty_policies_code` — so
   * this is a decision of this surface and is stated as one: a re-coded policy is a
   * different configuration wearing the old one's identity, and an operator reading a
   * warranty issued last year would have no way to know the code moved. `status` is
   * absent because retiring a policy is its own command, so the authority to fix a
   * typo is not the authority to stop a company issuing warranties.
   */
  public async renamePolicy(
    db: DbHandle,
    policyId: string,
    expectedVersion: number,
    name: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<WarrantyPolicySummaryView> {
    const existing = await this.requirePolicyForWrite(db, policyId, authorizeScope);
    const updated = this.#assertVersionMatched(
      await this.repository.renamePolicy(db, existing.companyId, existing.id, expectedVersion, name)
    );

    await appendAudit(db, {
      action: 'wty.warranty_policy.renamed',
      entityType: 'wty.warranty_policy',
      entityId: updated.id,
      companyId: updated.companyId,
      requestRef: 'wty.warranty-policy-rename',
      details: [
        {
          field: 'name',
          classification: 'internal',
          previousValue: existing.name,
          value: updated.name,
        },
      ],
    });

    return toPolicyView(updated);
  }

  /**
   * `wty.warranty-policy-status-set` — archive or restore a policy.
   *
   * Bidirectional through one command, on the `apt.catalogue-source-channel-status-set`
   * precedent: `uq_warranty_policies_code` names `deleted_at` and says nothing about
   * `status`, so an archived policy still holds its code and a retire-only command
   * would burn that code for the company permanently.
   *
   * **Archiving does not touch the coverage rows, and that is deliberate.**
   * `wty.issue_warranty` selects coverage on the COVERAGE's `status` and never reads
   * the policy's, so `assertPolicyActive` is the only thing in the platform that
   * refuses an archived policy — a rule this surface leaves exactly where it is.
   * Cascading would also be irreversible: restoring the policy could not know which
   * coverage rows were archived by the cascade and which by an operator, and
   * `ex_warranty_coverage_no_overlap` might refuse to put them back at all.
   *
   * What archiving DOES do is remove the policy from `listActivePolicies`, which is
   * what `resolvePolicy` counts: archiving a company's only active policy makes every
   * subsequent unnamed generation answer `ERR-RES-001`, and the suite proves that
   * sequence on real rows.
   */
  public async setPolicyStatus(
    db: DbHandle,
    policyId: string,
    expectedVersion: number,
    status: WarrantyLifecycleStatus,
    authorizeScope: ScopeAuthorizer
  ): Promise<WarrantyPolicySummaryView> {
    const existing = await this.requirePolicyForWrite(db, policyId, authorizeScope);
    const updated = this.#assertVersionMatched(
      await this.repository.setPolicyStatus(
        db,
        existing.companyId,
        existing.id,
        expectedVersion,
        status
      )
    );

    await appendAudit(db, {
      action: 'wty.warranty_policy.status_changed',
      entityType: 'wty.warranty_policy',
      entityId: updated.id,
      companyId: updated.companyId,
      requestRef: 'wty.warranty-policy-status-set',
      details: [
        {
          field: 'status',
          classification: 'public',
          previousValue: existing.status,
          value: updated.status,
        },
      ],
    });

    return toPolicyView(updated);
  }

  /** `wty.warranty-coverage-create` — one more effective-dated window on a policy. */
  public async createCoverage(
    db: DbHandle,
    policyId: string,
    input: CreateWarrantyCoverageInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<WarrantyCoverageTermsView> {
    const policy = await this.requirePolicyForWrite(db, policyId, authorizeScope);
    const created = await this.#insertCoverage(db, policy, input, 'body');

    await appendAudit(db, {
      action: 'wty.warranty_policy.coverage_added',
      entityType: 'wty.warranty_coverage',
      entityId: created.id,
      companyId: policy.companyId,
      requestRef: 'wty.warranty-coverage-create',
      details: [
        { field: 'policyId', classification: 'internal', value: policy.id },
        { field: 'coveredScope', classification: 'public', value: created.coveredScope },
        {
          field: 'durationMonths',
          classification: 'public',
          value: String(created.durationMonths),
        },
        // The distance is carried as the exact string the column returned. It is a
        // reading and not an amount, and `wty` has no monetary column at all.
        {
          field: 'odometerAllowance',
          classification: 'public',
          value: created.odometerLimit ?? 'unlimited',
        },
        { field: 'effectiveFrom', classification: 'public', value: created.effectiveFrom },
        {
          field: 'effectiveTo',
          classification: 'public',
          value: created.effectiveTo ?? 'open-ended',
        },
      ],
    });

    return toCoverageView(created);
  }

  /**
   * `wty.warranty-coverage-status-set` — archive or reactivate one coverage row.
   *
   * This is the affordance that actually changes which terms a new warranty is issued
   * under: `wty.issue_warranty` filters coverage on `status = 'active'`, so archiving
   * the row effective today stops it being selected while leaving every warranty that
   * already cites it readable and intact.
   *
   * **A reactivation can be refused, and the refusal is not a fault.**
   * `ex_warranty_coverage_no_overlap` is partial on `status = 'active'`, so an
   * archived row's window may have been re-covered while it was archived; putting it
   * back would put two active coverages over one day for one `(policy, covered_scope)`
   * and `wty.issue_warranty`'s `ORDER BY effective_from DESC LIMIT 1` would then be
   * arbitrary between them. That arrives as `23P01` and is reported as the conflict it
   * is, with the same `overlapping_coverage` rule an insert produces.
   */
  public async setCoverageStatus(
    db: DbHandle,
    policyId: string,
    coverageId: string,
    expectedVersion: number,
    status: WarrantyLifecycleStatus,
    authorizeScope: ScopeAuthorizer
  ): Promise<WarrantyCoverageTermsView> {
    const policy = await this.requirePolicyForWrite(db, policyId, authorizeScope);
    const existing = await this.requireCoverage(db, policy, coverageId);

    let updated: WarrantyCoverageRow | null;
    try {
      updated = await this.repository.setCoverageStatus(
        db,
        policy.companyId,
        existing.id,
        expectedVersion,
        status
      );
    } catch (cause) {
      this.#refuseCoverageWriteFailure(cause, 'body.status');
    }
    const changed = this.#assertVersionMatched(updated);

    await appendAudit(db, {
      action: 'wty.warranty_policy.coverage_status_changed',
      entityType: 'wty.warranty_coverage',
      entityId: changed.id,
      companyId: policy.companyId,
      requestRef: 'wty.warranty-coverage-status-set',
      details: [
        { field: 'policyId', classification: 'internal', value: policy.id },
        { field: 'coveredScope', classification: 'public', value: changed.coveredScope },
        {
          field: 'status',
          classification: 'public',
          previousValue: existing.status,
          value: changed.status,
        },
      ],
    });

    return toCoverageView(changed);
  }

  // -------------------------------------------------------------------------
  // Shared resolution
  // -------------------------------------------------------------------------

  /** The policy, or the uniform 404 that does not distinguish absent from invisible. */
  private async requirePolicy(db: DbHandle, policyId: string): Promise<WarrantyPolicyRow> {
    const row = await this.repository.findPolicyById(db, policyId);
    if (row === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Warranty policy ${policyId} is not visible in the caller's scope`,
      });
    }
    return row;
  }

  /**
   * The policy, re-authorized against ITS OWN company.
   *
   * Not-found is decided FIRST and the scope decision second, so a caller that may not
   * see the row is told the same thing as a caller for whom it does not exist. A 403
   * on an id the caller cannot see would confirm that the id names a real row
   * somewhere.
   */
  private async requirePolicyForWrite(
    db: DbHandle,
    policyId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<WarrantyPolicyRow> {
    const row = await this.requirePolicy(db, policyId);
    await authorizeScope({ companyId: row.companyId });
    return row;
  }

  /** One coverage row OF THIS POLICY, or the uniform 404. */
  private async requireCoverage(
    db: DbHandle,
    policy: WarrantyPolicyRow,
    coverageId: string
  ): Promise<WarrantyCoverageRow> {
    const row = await this.repository.findCoverage(db, policy.companyId, coverageId);
    // `findCoverage` resolves within the COMPANY, so a coverage row of a sibling
    // policy in the same company would otherwise be editable through this policy's
    // path. The parent check makes the path mean what it says.
    if (row === null || row.policyId !== policy.id) {
      throw new AppFailure('ERR-RES-001', {
        message: `Coverage ${coverageId} is not a coverage row of policy ${policy.id}`,
      });
    }
    return row;
  }

  /** The insert plus its constraint mapping, shared by the create and the add. */
  async #insertCoverage(
    db: DbHandle,
    policy: WarrantyPolicyRow,
    terms: CreateWarrantyCoverageInput,
    path: string
  ): Promise<WarrantyCoverageRow> {
    try {
      return await this.repository.insertCoverage(db, {
        companyId: policy.companyId,
        policyId: policy.id,
        coveredScope: terms.coveredScope,
        durationMonths: terms.durationMonths,
        odometerAllowance: terms.odometerAllowance ?? null,
        effectiveFrom: terms.effectiveFrom,
        effectiveTo: terms.effectiveTo ?? null,
      });
    } catch (cause) {
      this.#refuseCoverageWriteFailure(cause, path);
    }
  }

  /**
   * Two coverage rows in ONE body that overlap each other.
   *
   * `ex_warranty_coverage_no_overlap` compares `daterange(from, to, '[)')` per
   * `(policy, covered_scope)` on ACTIVE rows, and every row this surface writes is
   * born active — so the constraint is reproduced here on the request's own rows,
   * with the same half-open semantics, and nothing else. It is a better MESSAGE for
   * the same rule, never a second definition of it: the constraint still runs.
   */
  #refuseSelfOverlap(coverage: readonly CreateWarrantyCoverageInput[]): void {
    for (let i = 0; i < coverage.length; i += 1) {
      for (let j = i + 1; j < coverage.length; j += 1) {
        const a = coverage[i];
        const b = coverage[j];
        if (a === undefined || b === undefined) continue;
        if (a.coveredScope !== b.coveredScope) continue;
        // Half-open `[from, to)`: `to === from` of the next row is NOT an overlap,
        // which is how consecutive windows are expressed. `undefined` is an open end.
        const aEndsBeforeB = a.effectiveTo !== undefined && a.effectiveTo <= b.effectiveFrom;
        const bEndsBeforeA = b.effectiveTo !== undefined && b.effectiveTo <= a.effectiveFrom;
        if (aEndsBeforeB || bEndsBeforeA) continue;
        throw new AppFailure('ERR-VAL-001', {
          message:
            `Two coverage rows for scope "${a.coveredScope}" overlap in this request; ` +
            'at most one coverage may be active for a scope on any day',
          safeDetails: {
            violations: [{ path: `body.coverage.${String(j)}`, rule: 'overlapping_coverage' }],
          },
        });
      }
    }
  }

  /**
   * No row returned means the `record_version` predicate did not match.
   *
   * Every other reason for zero rows — absent, another tenant's, soft-deleted, a
   * company the caller may not write — has already been excluded, so this is the
   * concurrency loss and nothing else. The DATABASE's row is returned rather than
   * `expectedVersion + 1`, because that number is the caller's next `If-Match` and
   * inferring it would encode an assumption about `shared.touch_row_metadata` this
   * module does not own.
   */
  #assertVersionMatched<T>(updated: T | null): T {
    if (updated === null) {
      throw new AppFailure('ERR-CON-001', {
        message: 'The warranty policy changed while this request was in flight; re-read and retry',
      });
    }
    return updated;
  }

  /** Maps the policy header's two reachable constraint failures; re-throws the rest. */
  #refusePolicyWriteFailure(cause: unknown, policyCode: string): never {
    if (isSqlState(cause, SQLSTATE.uniqueViolation)) {
      // `uq_warranty_policies_code` is PARTIAL on `deleted_at IS NULL`, and this
      // surface never soft-deletes, so a colliding row is always one the caller can
      // see and rename or restore — the message does not tell it to restore anything.
      throw new AppFailure('ERR-CON-001', {
        message: `The warranty policy code "${policyCode}" is already used in this company`,
        safeDetails: { violations: [{ path: 'body.policyCode', rule: 'duplicate_code' }] },
      });
    }
    if (isSqlState(cause, SQLSTATE.foreignKeyViolation)) {
      // `fk_warranty_policies_company` resolves `(tenant_id, company_id)` with the
      // tenant taken from the session context, so this is a company that is not in
      // the caller's tenant — including one that exists in another tenant.
      throw new AppFailure('ERR-VAL-001', {
        message: 'The named company does not exist in this tenant',
        safeDetails: { violations: [{ path: 'body.companyId', rule: 'unknown_company' }] },
      });
    }
    throw cause;
  }

  /** Maps the coverage row's three reachable constraint failures; re-throws the rest. */
  #refuseCoverageWriteFailure(cause: unknown, path: string): never {
    if (isSqlState(cause, SQLSTATE.exclusionViolation)) {
      // `ex_warranty_coverage_no_overlap`, the BR-WTY-001 invariant: at most one
      // ACTIVE coverage per (policy, scope) on any day. It fires on an insert into a
      // covered window AND on a reactivation into one, and both mean the same thing
      // to a caller, so both carry the same rule.
      throw new AppFailure('ERR-CON-001', {
        message:
          'Another active coverage already covers part of this window for this scope. ' +
          'Archive it first, or choose a window that does not overlap it.',
        safeDetails: { violations: [{ path, rule: 'overlapping_coverage' }] },
      });
    }
    if (isSqlState(cause, SQLSTATE.checkViolation)) {
      const constraint = violatedConstraint(cause);
      const field = constraint === undefined ? undefined : COVERAGE_CHECK_FIELD[constraint];
      throw new AppFailure('ERR-VAL-001', {
        message:
          field === undefined
            ? 'The coverage terms were refused by the database'
            : `The coverage terms were refused: ${field} is out of range`,
        safeDetails: {
          violations: [
            { path: field === undefined ? path : `${path}.${field}`, rule: 'out_of_range' },
          ],
        },
      });
    }
    if (isSqlState(cause, SQLSTATE.foreignKeyViolation)) {
      // `fk_warranty_coverage_policy` names `(tenant_id, company_id, policy_id)`, all
      // three of which this statement supplies from a row it just read — so reaching
      // this means the policy was removed between the read and the write.
      throw new AppFailure('ERR-CON-001', {
        message: 'The warranty policy changed while this request was in flight; re-read and retry',
      });
    }
    // `22003` (numeric_value_out_of_range) is possible on a distance beyond
    // `integer`, and it is deliberately NOT mapped: the route refuses that value
    // before the statement runs, so arriving with one means the boundary and the
    // column disagree and the fault is the platform's rather than the caller's.
    // Re-thrown, so it is monitored as the server fault it would be.
    throw cause;
  }
}
