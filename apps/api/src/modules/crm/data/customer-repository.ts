/**
 * CRM customer write repository (Phase 1-16, FR-CRM-001, FR-CRM-002).
 *
 * The only place customer *write* SQL lives. Every statement runs through a
 * `DbHandle`, so it inherits the caller's transaction and the resolved request
 * context; `tenant_id` and `created_by` are stamped from that context and are
 * never accepted from a caller.
 *
 * ## Why every INSERT is `RETURNING id` and may answer `null`
 *
 * Under `FORCE ROW LEVEL SECURITY`, an INSERT whose `WITH CHECK` fails raises;
 * but an INSERT the policy silently filters would return no row. Returning the
 * id and letting the service treat `null` as a policy refusal means a row that
 * did not land can never be reported as created — the failure is loud instead of
 * a phantom 201.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';

export interface PartnerInsert {
  readonly id: string;
  readonly partyType: 'individual' | 'organization';
  readonly displayName: string;
  /** Allocated in the same transaction when the sequence is provisioned. */
  readonly displayNumber: string | null;
  readonly lifecycleStatus: string;
}

export interface IndividualProfileInsert {
  readonly partnerId: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly preferredLocale: string | null;
}

export interface CompanyProfileInsert {
  readonly partnerId: string;
  readonly legalName: string;
  readonly tradeName: string | null;
}

/** A live partner whose normalised name equals a proposed one. */
export interface DuplicateNameMatch {
  readonly id: string;
  readonly displayName: string;
  readonly displayNumber: string | null;
}

export class CustomerRepository extends Repository {
  protected readonly module = 'crm';

  async insertPartner(db: DbHandle, input: PartnerInsert): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO crm.business_partners
         (id, tenant_id, party_type, display_name, display_number, lifecycle_status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        input.id,
        context.principal.tenantId,
        input.partyType,
        input.displayName,
        input.displayNumber,
        input.lifecycleStatus,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  async insertIndividualProfile(
    db: DbHandle,
    input: IndividualProfileInsert
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO crm.individual_profiles
         (tenant_id, partner_id, given_name, family_name, preferred_locale, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.partnerId,
        input.givenName,
        input.familyName,
        input.preferredLocale,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  async insertCompanyProfile(db: DbHandle, input: CompanyProfileInsert): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `INSERT INTO crm.company_profiles
         (tenant_id, partner_id, legal_name, trade_name, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.partnerId,
        input.legalName,
        input.tradeName,
        context.principal.userId,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  /**
   * Live partners in the tenant whose normalised display name equals `name`.
   *
   * The duplicate **pre-check** (FR-CRM-003): an exact normalised-name collision
   * is reported so the caller can confirm intent, but it never blocks — two real
   * customers genuinely can share a name, and refusing would make them
   * unrepresentable. Bounded to a handful of rows: this exists to say "there is
   * a collision", not to page through one.
   */
  async findLiveByNormalizedName(
    db: DbHandle,
    name: string,
    limit = 5
  ): Promise<readonly DuplicateNameMatch[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      display_name: string;
      display_number: string | null;
    }>(
      db,
      `SELECT id, display_name, display_number
         FROM crm.business_partners
        WHERE tenant_id = $1
          AND deleted_at IS NULL
          AND merged_into_id IS NULL
          AND crm.normalize_name(display_name) = crm.normalize_name($2)
        ORDER BY created_at DESC, id DESC
        LIMIT $3`,
      [context.principal.tenantId, name, limit]
    );
    return result.rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      displayNumber: row.display_number,
    }));
  }
}
