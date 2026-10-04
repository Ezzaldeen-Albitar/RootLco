/**
 * The tenant's document-number sequences, written during provisioning (P1-30
 * corrective slice).
 *
 * One statement, run on the PLATFORM connection as `app_platform`, inside the
 * §6.3 platform-on-target window. What admits the rows is
 * `ins_number_sequences_platform` (20260831093000) — the policy that has existed
 * since the control plane shipped, together with the INSERT privilege granted in
 * the same migration. **This half of the slice needs no migration at all**: the
 * authority was already correct, and nothing ever used it.
 *
 * ## Why the rows did not exist
 *
 * `org.provision_organization` does write sequence rows — from
 * `p_spec -> 'sequences'`, and with `company_id`/`branch_id` left NULL. Two
 * things make that path dead for the documents this platform issues:
 *
 *  - the shipped provisioning body is `.strict()` and publishes no `sequences`
 *    member, so no caller can supply one;
 *  - `shared.next_display_number` matches `company_id IS NOT DISTINCT FROM
 *    p_company_id` with NO fallback, and the invoice, receipt and quotation
 *    allocators all pass a concrete company and branch — so a tenant-wide row
 *    would not be found even if one existed.
 *
 * Measured at develop `029fc20d`: `shared.number_sequences` held zero rows for
 * every tenant on the stack.
 *
 * ## Where the set and the scopes come from
 *
 * `SEQUENCE_DEFINITIONS` — the P1-15 registry, already the platform's canonical
 * list of numbering runs and already asserted against `information_schema`. Each
 * entry now also carries the scope its shipped allocator passes, so this
 * statement transcribes a fact rather than deciding one. Nothing about a request
 * reaches here: the provisioning body has no field naming a sequence, a prefix,
 * a width or a reset rule.
 *
 * ## Prefix, width and reset rule are left at their column defaults
 *
 * `prefix_template ''`, `pad_width 6`, `period_reset_rule 'never'`. Those are an
 * operator's configuration, and the registry deliberately does not carry them
 * ("duplicating them here would create a second source of truth"). A tenant that
 * wants `INV-` on its invoices changes the row; a tenant that changes nothing
 * still issues correctly numbered documents from day one, which is the property
 * that was missing.
 *
 * No read-back: `app_platform` holds INSERT on this table and no SELECT, so
 * `RETURNING` would be refused. The affected-row count is the evidence.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle, PlatformTargetHandle } from '@/server/db/transaction';
import { SEQUENCE_DEFINITIONS } from '../domain/sequence-registry';

/** The company and branch `org.provision_organization` created in this transaction. */
export interface SequenceBootstrapScope {
  readonly companyId: string;
  readonly branchId: string;
}

export class NumberSequenceBootstrapRepository extends Repository {
  protected readonly module = 'shared-services';

  /**
   * Creates one row per registered numbering run, each at its own scope.
   *
   * @returns how many rows the statement wrote.
   */
  async provisionRegisteredSequences(
    db: PlatformTargetHandle,
    scope: SequenceBootstrapScope
  ): Promise<number> {
    const codes = SEQUENCE_DEFINITIONS.map((definition) => definition.code);
    const branchScoped = SEQUENCE_DEFINITIONS.map(
      (definition) => definition.provisioningScope === 'branch'
    );
    const result = await this.run(
      db,
      `INSERT INTO shared.number_sequences
         (tenant_id, company_id, branch_id, sequence_code, created_by)
       SELECT $1,
              CASE WHEN run.branch_scoped THEN $2::uuid END,
              CASE WHEN run.branch_scoped THEN $3::uuid END,
              run.code,
              $4
         FROM unnest($5::text[], $6::boolean[]) AS run(code, branch_scoped)`,
      [
        db.targetTenantId,
        scope.companyId,
        scope.branchId,
        db.context.principal.userId,
        codes,
        branchScoped,
      ]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Creates the BRANCH-scoped numbering runs for one branch, on the tenant's own
   * connection.
   *
   * The sibling above runs as `app_platform` during provisioning and its policy
   * requires a tenant still in `provisioning`, so it cannot serve a branch
   * created afterwards. This statement is the request-path equivalent:
   * `ins_number_sequences_branch_authority` is the authority, it is gated on
   * `org.branch.manage`, and it admits only a row naming a real company/branch
   * pair of the session's own tenant.
   *
   * `ON CONFLICT DO NOTHING` on `uq_number_sequences_scope`: a replayed create
   * must not raise on rows a first attempt already wrote, and the affected-row
   * count is therefore a floor rather than an assertion — which is why the
   * service checks the resulting SET of codes rather than this number.
   */
  async provisionBranchSequences(db: DbHandle, scope: SequenceBootstrapScope): Promise<void> {
    const codes = SEQUENCE_DEFINITIONS.filter(
      (definition) => definition.provisioningScope === 'branch'
    ).map((definition) => definition.code);
    await this.run(
      db,
      `INSERT INTO shared.number_sequences
         (tenant_id, company_id, branch_id, sequence_code, created_by)
       SELECT $1, $2::uuid, $3::uuid, run.code, $4
         FROM unnest($5::text[]) AS run(code)
       ON CONFLICT ON CONSTRAINT uq_number_sequences_scope DO NOTHING`,
      [
        db.context.principal.tenantId,
        scope.companyId,
        scope.branchId,
        db.context.principal.userId,
        codes,
      ]
    );
  }

  /** The branch-scoped sequence codes actually configured for a branch. */
  async branchSequenceCodes(db: DbHandle, scope: SequenceBootstrapScope): Promise<string[]> {
    const result = await this.run<{ sequence_code: string }>(
      db,
      `SELECT sequence_code
         FROM shared.number_sequences
        WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3
        ORDER BY sequence_code`,
      [db.context.principal.tenantId, scope.companyId, scope.branchId]
    );
    return result.rows.map((row) => row.sequence_code);
  }
}
