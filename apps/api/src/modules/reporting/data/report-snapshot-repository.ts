/**
 * `rpt.report_snapshots` — the frozen copies of report runs and their
 * restatements (Owner decision D16, P1-32-PRE-OD-FD16B).
 *
 * Every statement here runs under the caller's row-level security: a snapshot is
 * visible only in the caller's tenant and branch reach, and only to a caller
 * holding `rpt.report.read` and every code the snapshot froze
 * (`sel_report_snapshots_scope`). The INSERT is held to the same, plus
 * `rpt.export` (`ins_report_snapshots_scope`). Nothing here can update or delete
 * a row: no application role holds either privilege, and the guard refuses an
 * UPDATE whoever runs it.
 *
 * The database states what a row holds — who saved it and when, the row count
 * and the sha256 digests of its rows and filters — so this repository never
 * supplies any of them except as the placeholders the columns require.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import { cursorTimestamp, type PageRequest } from '@/server/db/pagination';

/** One snapshot, without its rows. */
export interface ReportSnapshotRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly reportCode: string;
  readonly periodFrom: string;
  readonly periodToExclusive: string;
  readonly timezoneName: string;
  readonly asOf: Date;
  readonly parameters: Record<string, unknown>;
  readonly requiredPermissions: readonly string[];
  readonly columns: readonly unknown[];
  readonly rowCount: number;
  readonly rowsDigest: string;
  readonly generatedAt: Date;
  readonly generatedBy: string;
  readonly restatesSnapshotId: string | null;
  readonly restatedBySnapshotId: string | null;
  readonly restatementReason: string | null;
  readonly difference: Record<string, unknown> | null;
  /** Microsecond-precision `generated_at`, for a keyset cursor. */
  readonly sortValue: string;
}

/** What a new snapshot is written with. The database stamps the rest. */
export interface ReportSnapshotInsert {
  readonly companyId: string;
  readonly branchId: string;
  readonly reportCode: string;
  readonly periodFrom: string;
  readonly periodToExclusive: string;
  readonly timezoneName: string;
  readonly asOf: string;
  readonly parameters: Record<string, string>;
  readonly requiredPermissions: readonly string[];
  readonly columns: readonly unknown[];
  readonly rows: readonly unknown[];
  readonly restatesSnapshotId: string | null;
  readonly restatementReason: string | null;
  readonly difference: Record<string, unknown> | null;
}

/** One money measure's total in one currency, on one side of a restatement. */
export interface ReportSnapshotTotalRow {
  readonly side: 'before' | 'after';
  readonly currency: string | null;
  readonly measure: string;
  /** A decimal string summed by PostgreSQL; never computed in this process. */
  readonly total: string;
}

const COLUMNS = `
  s.id, s.company_id AS "companyId", s.branch_id AS "branchId", s.report_code AS "reportCode",
  to_char(s.period_from, 'YYYY-MM-DD') AS "periodFrom",
  to_char(s.period_to_exclusive, 'YYYY-MM-DD') AS "periodToExclusive",
  s.timezone_name AS "timezoneName", s.as_of AS "asOf", s.parameters,
  s.required_permissions AS "requiredPermissions", s.columns, s.row_count AS "rowCount",
  s.rows_digest AS "rowsDigest", s.generated_at AS "generatedAt", s.generated_by AS "generatedBy",
  s.restates_snapshot_id AS "restatesSnapshotId",
  (SELECT r.id FROM rpt.report_snapshots r
    WHERE r.tenant_id = s.tenant_id AND r.company_id = s.company_id
      AND r.branch_id = s.branch_id AND r.restates_snapshot_id = s.id) AS "restatedBySnapshotId",
  s.restatement_reason AS "restatementReason", s.difference,
  ${cursorTimestamp('s.generated_at')} AS "sortValue"`;

/** sha256 of the canonical jsonb text, as the guard stamps `parameters_digest`. */
const PARAMETERS_DIGEST = (index: number): string =>
  `encode(sha256(convert_to(($${index}::jsonb)::text, 'UTF8')), 'hex')`;

export class ReportSnapshotRepository extends Repository {
  protected readonly module = 'reporting';

  /** One snapshot of this tenant by id, or null when it is absent or out of reach. */
  async findById(db: DbHandle, id: string): Promise<ReportSnapshotRow | null> {
    const context = this.assertContext(db);
    return this.runOne<ReportSnapshotRow>(
      db,
      `SELECT ${COLUMNS} FROM rpt.report_snapshots s WHERE s.tenant_id = $1 AND s.id = $2`,
      [context.principal.tenantId, id]
    );
  }

  /** The ORIGINAL snapshot of a report, scope, period and filters, or null. */
  async findOriginal(
    db: DbHandle,
    key: {
      readonly companyId: string;
      readonly branchId: string;
      readonly reportCode: string;
      readonly periodFrom: string;
      readonly periodToExclusive: string;
      readonly parameters: Record<string, string>;
    }
  ): Promise<ReportSnapshotRow | null> {
    const context = this.assertContext(db);
    return this.runOne<ReportSnapshotRow>(
      db,
      `SELECT ${COLUMNS} FROM rpt.report_snapshots s
        WHERE s.tenant_id = $1 AND s.company_id = $2 AND s.branch_id = $3
          AND s.report_code = $4 AND s.period_from = $5::date
          AND s.period_to_exclusive = $6::date
          AND s.parameters_digest = ${PARAMETERS_DIGEST(7)}
          AND s.restates_snapshot_id IS NULL`,
      [
        context.principal.tenantId,
        key.companyId,
        key.branchId,
        key.reportCode,
        key.periodFrom,
        key.periodToExclusive,
        JSON.stringify(key.parameters),
      ]
    );
  }

  /** Writes one snapshot and reads it back as stored. */
  async insert(db: DbHandle, input: ReportSnapshotInsert): Promise<ReportSnapshotRow> {
    const context = this.assertContext(db);
    const inserted = await this.runOne<{ id: string }>(
      db,
      `INSERT INTO rpt.report_snapshots
         (tenant_id, company_id, branch_id, report_code, period_from, period_to_exclusive,
          timezone_name, as_of, parameters, parameters_digest, required_permissions, columns,
          rows, row_count, rows_digest, generated_by, restates_snapshot_id, restatement_reason,
          difference, created_by)
       VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8::timestamptz, $9::jsonb,
               ${PARAMETERS_DIGEST(9)}, $10::text[], $11::jsonb, $12::jsonb,
               jsonb_array_length($12::jsonb), encode(sha256(convert_to(($12::jsonb)::text, 'UTF8')), 'hex'),
               $13, $14, $15, $16::jsonb, $13)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.reportCode,
        input.periodFrom,
        input.periodToExclusive,
        input.timezoneName,
        input.asOf,
        JSON.stringify(input.parameters),
        [...input.requiredPermissions],
        JSON.stringify(input.columns),
        JSON.stringify(input.rows),
        context.principal.userId,
        input.restatesSnapshotId,
        input.restatementReason,
        input.difference === null ? null : JSON.stringify(input.difference),
      ]
    );
    const stored = inserted === null ? null : await this.findById(db, inserted.id);
    if (stored === null) throw new Error('report snapshot: the inserted row could not be read');
    return stored;
  }

  /** One page of a report's snapshots in one branch, newest first. */
  async list(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly reportCode: string;
      readonly periodFrom: string | null;
      readonly periodToExclusive: string | null;
    },
    page: PageRequest
  ): Promise<readonly ReportSnapshotRow[]> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.reportCode,
      filter.periodFrom,
      filter.periodToExclusive,
    ];
    let after = '';
    if (page.cursor !== null) {
      values.push(page.cursor.v, page.cursor.i);
      after = `AND (s.generated_at, s.id) < ($7::timestamptz, $8::uuid)`;
    }
    values.push(page.limit + 1);
    const result = await this.run<ReportSnapshotRow>(
      db,
      `SELECT ${COLUMNS} FROM rpt.report_snapshots s
        WHERE s.tenant_id = $1 AND s.company_id = $2 AND s.branch_id = $3 AND s.report_code = $4
          AND ($5::date IS NULL OR s.period_from = $5::date)
          AND ($6::date IS NULL OR s.period_to_exclusive = $6::date)
          ${after}
        ORDER BY s.generated_at DESC, s.id DESC
        LIMIT $${values.length}`,
      values
    );
    return result.rows;
  }

  /** Every stored row of one snapshot, in stored order. For a restatement's comparison. */
  async rowsOf(db: DbHandle, id: string): Promise<readonly unknown[]> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ rows: unknown[] }>(
      db,
      `SELECT s.rows FROM rpt.report_snapshots s WHERE s.tenant_id = $1 AND s.id = $2`,
      [context.principal.tenantId, id]
    );
    return row?.rows ?? [];
  }

  /**
   * One page of a snapshot's stored rows, by their 1-based position.
   *
   * Read from the stored array with its ordinality, so the order a page is cut in
   * is the order the snapshot was saved in and never re-sorted.
   */
  async rowsPage(
    db: DbHandle,
    id: string,
    afterPosition: string,
    limit: number
  ): Promise<readonly { readonly position: string; readonly row: unknown }[]> {
    const context = this.assertContext(db);
    const result = await this.run<{ position: string; row: unknown }>(
      db,
      `SELECT e.pos::text AS position, e.item AS row
         FROM rpt.report_snapshots s
         CROSS JOIN LATERAL jsonb_array_elements(s.rows) WITH ORDINALITY AS e(item, pos)
        WHERE s.tenant_id = $1 AND s.id = $2 AND e.pos > $3::bigint
        ORDER BY e.pos
        LIMIT $4`,
      [context.principal.tenantId, id, afterPosition, limit + 1]
    );
    return result.rows;
  }

  /**
   * The total of every money column per currency, before (the restated snapshot's
   * stored rows) and after (the rows about to be stored).
   *
   * Summed by PostgreSQL over the cells' decimal strings, so no amount is ever
   * converted or added in this process. A cell whose value is null is not money
   * on that row and is not counted.
   */
  async totalsByCurrency(
    db: DbHandle,
    input: {
      readonly restatedId: string;
      readonly rows: readonly unknown[];
      readonly currencyColumn: string;
      readonly moneyColumns: readonly string[];
    }
  ): Promise<readonly ReportSnapshotTotalRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<ReportSnapshotTotalRow>(
      db,
      `WITH sides AS (
         SELECT 'before'::text AS side, e.item
           FROM rpt.report_snapshots s
           CROSS JOIN LATERAL jsonb_array_elements(s.rows) AS e(item)
          WHERE s.tenant_id = $1 AND s.id = $2
         UNION ALL
         SELECT 'after'::text AS side, e.item FROM jsonb_array_elements($3::jsonb) AS e(item)
       )
       SELECT sides.side,
              (SELECT c->>'value' FROM jsonb_array_elements(sides.item->'cells') AS c
                WHERE c->>'key' = $4 LIMIT 1) AS currency,
              m->>'key' AS measure,
              sum((m->>'value')::numeric)::text AS total
         FROM sides
         CROSS JOIN LATERAL jsonb_array_elements(sides.item->'cells') AS m
        WHERE m->>'key' = ANY($5::text[]) AND m->>'value' IS NOT NULL
        GROUP BY 1, 2, 3
        ORDER BY 2, 3, 1`,
      [
        context.principal.tenantId,
        input.restatedId,
        JSON.stringify(input.rows),
        input.currencyColumn,
        [...input.moneyColumns],
      ]
    );
    return result.rows;
  }
}
