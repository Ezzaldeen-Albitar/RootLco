/**
 * Appointment/reception configuration-catalogue service — the reads, and the
 * management commands that make the catalogues populatable at all (P1-27
 * remediation, executed by P1-18: `P1-27-INT-018`).
 *
 * The reads are thin by design: a catalogue read has no lifecycle, no scope
 * beyond the RLS union, and no decision to make — it validates the page input
 * against the list's own ordering contract and delegates. Empty pages are the
 * no-fake-data policy working, not a fault.
 *
 * There are TWO reads per catalogue and the split is the contract, not an
 * optimisation. The picker read serves the booking and check-in forms: active
 * entries only, no `status`, no `recordVersion`. `listForManagement` serves the
 * catalogue-administration screen: every entry including retired ones, with the
 * `recordVersion` that `rename` and `setStatus` require as `If-Match`. Without
 * the second one the management commands published here were unreachable in
 * practice — a retired entry appeared in no read, so nothing could restore it,
 * and no read supplied the version the writes demand.
 *
 * The management half is where the decisions live, and there are exactly four:
 *
 *  1. **A platform row is refused before the statement runs.** The
 *     `upd_<t>_tenant` policy is `USING (scope = 'tenant' AND tenant_id = ...)`,
 *     so editing a shared default would change zero rows and be reported as a
 *     version conflict — a caller told to "re-read and retry" a thing that can
 *     never succeed. The probe separates the two, exactly as the P1-15 template
 *     service does.
 *  2. **Zero rows changed is a stale version, and nothing else**, because the
 *     probe has already established the row exists and is this tenant's.
 *  3. **A duplicate code is `ERR-RES-002`, not a 500.** The partial unique
 *     indexes make one live code per tenant per catalogue; a second is a
 *     conflict the caller can act on.
 *  4. **Retirement is a status, never a delete**, and is reversible — see the
 *     descriptor module for why the unique index makes that mandatory rather
 *     than a convenience.
 *
 * No row is ever seeded from here or anywhere else. The operator populates the
 * catalogue; the platform's job was only to make that possible.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import { pageRequest, type OrderingContract, type Page } from '@/server/db/pagination';
import {
  APPOINTMENT_TYPE_ORDERING,
  CANCELLATION_REASON_ORDERING,
  FUEL_LEVEL_ORDERING,
  REFUSAL_REASON_ORDERING,
  SOURCE_CHANNEL_ORDERING,
  VISIT_REASON_ORDERING,
  WARNING_LIGHT_CODE_ORDERING,
  intakeCatalogueOrdering,
  type IntakeCatalogue,
  type IntakeCatalogueEntry,
  type IntakeCatalogueRecord,
  type IntakeCatalogueRepository,
} from '../data/intake-catalogue-repository';
import { INTAKE_CATALOGUE_DESCRIPTORS, type CatalogueStatus } from '../domain/intake-catalogue';

export interface PageInput {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

/** What a management command returns: enough to render the row and guard the next write. */
export interface IntakeCatalogueEntryView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
  readonly recordVersion: number;
}

export class IntakeCatalogueService extends ApplicationService {
  protected readonly module = 'reception';

  constructor(private readonly catalogues: IntakeCatalogueRepository) {
    super();
  }

  #page(input: PageInput, ordering: OrderingContract) {
    return pageRequest(ordering, input);
  }

  async listAppointmentTypes(db: DbHandle, input: PageInput): Promise<Page<IntakeCatalogueEntry>> {
    return this.catalogues.listAppointmentTypes(db, this.#page(input, APPOINTMENT_TYPE_ORDERING));
  }

  async listSourceChannels(db: DbHandle, input: PageInput): Promise<Page<IntakeCatalogueEntry>> {
    return this.catalogues.listSourceChannels(db, this.#page(input, SOURCE_CHANNEL_ORDERING));
  }

  async listCancellationReasons(
    db: DbHandle,
    input: PageInput
  ): Promise<Page<IntakeCatalogueEntry>> {
    return this.catalogues.listCancellationReasons(
      db,
      this.#page(input, CANCELLATION_REASON_ORDERING)
    );
  }

  async listVisitReasons(db: DbHandle, input: PageInput): Promise<Page<IntakeCatalogueEntry>> {
    return this.catalogues.listVisitReasons(db, this.#page(input, VISIT_REASON_ORDERING));
  }

  async listFuelLevels(db: DbHandle, input: PageInput): Promise<Page<IntakeCatalogueEntry>> {
    return this.catalogues.listFuelLevels(db, this.#page(input, FUEL_LEVEL_ORDERING));
  }

  async listWarningLightCodes(db: DbHandle, input: PageInput): Promise<Page<IntakeCatalogueEntry>> {
    return this.catalogues.listWarningLightCodes(
      db,
      this.#page(input, WARNING_LIGHT_CODE_ORDERING)
    );
  }

  async listRefusalReasons(db: DbHandle, input: PageInput): Promise<Page<IntakeCatalogueEntry>> {
    return this.catalogues.listRefusalReasons(db, this.#page(input, REFUSAL_REASON_ORDERING));
  }

  // -------------------------------------------------------------------------
  // Management surface — the administrative read, then the commands.
  // -------------------------------------------------------------------------

  /**
   * The catalogue as an ADMINISTRATOR sees it: every entry, retired included,
   * carrying `status` and the `recordVersion` the guarded writes demand.
   *
   * One method for all seven rather than seven wrappers, because unlike the
   * picker reads above there is a `catalogue` argument in play already — the
   * routes name a literal key, and `assertCatalogue` in the repository turns
   * that key into a runtime allow-list before it reaches any SQL.
   *
   * It is a distinct OPERATION per catalogue at the route layer, gated on
   * `apt.catalogue.manage` / `rec.catalogue.manage`. That separation is the
   * whole point: a booking or check-in caller holding `apt.appointment.read`
   * keeps seeing only the offerable entries, and does not acquire the
   * catalogue's edit surface by being able to read a picker.
   */
  async listForManagement(
    db: DbHandle,
    catalogue: IntakeCatalogue,
    input: PageInput
  ): Promise<Page<IntakeCatalogueRecord>> {
    return this.catalogues.listForManagement(
      db,
      catalogue,
      this.#page(input, intakeCatalogueOrdering(catalogue))
    );
  }

  /**
   * Adds one tenant entry.
   *
   * `scope` and `tenant_id` are the repository's business and come from the
   * resolved principal; the caller supplies a code and a name and nothing else.
   */
  async create(
    db: DbHandle,
    catalogue: IntakeCatalogue,
    input: { readonly code: string; readonly name: string }
  ): Promise<IntakeCatalogueEntryView> {
    const descriptor = INTAKE_CATALOGUE_DESCRIPTORS[catalogue];
    let created: IntakeCatalogueRecord | null;
    try {
      created = await this.catalogues.insert(db, catalogue, input);
    } catch (error) {
      throw this.#mapWriteFailure(error);
    }
    if (!created) {
      // Unreachable through RLS, which raises 42501 rather than returning no
      // row; kept because a silent zero-row INSERT would otherwise be reported
      // as a success that wrote nothing.
      throw new AppFailure('ERR-IAM-001', {
        message: 'Creating this catalogue entry was refused by policy',
      });
    }

    await appendAudit(db, {
      action: descriptor.createdAction,
      entityType: descriptor.entityType,
      entityId: created.id,
      details: [
        { field: 'code', classification: 'public', value: created.code },
        { field: 'name', classification: 'public', value: created.name },
        { field: 'status', classification: 'public', value: created.status },
      ],
    });

    return view(created);
  }

  /**
   * Renames one tenant entry under its record version.
   *
   * The code is not renameable: `tg_<t>_immutable` freezes it, and every row
   * that already references this entry means the code. A typo in a label is an
   * edit; a new code is a new entry.
   */
  async rename(
    db: DbHandle,
    catalogue: IntakeCatalogue,
    id: string,
    expectedVersion: number,
    name: string
  ): Promise<IntakeCatalogueEntryView> {
    const descriptor = INTAKE_CATALOGUE_DESCRIPTORS[catalogue];
    const existing = await this.#requireTenantEntry(db, catalogue, id);

    const updated = this.#assertVersionMatched(
      await this.catalogues.rename(db, catalogue, id, expectedVersion, name)
    );

    await appendAudit(db, {
      action: descriptor.renamedAction,
      entityType: descriptor.entityType,
      entityId: id,
      details: [
        {
          field: 'name',
          classification: 'public',
          previousValue: existing.name,
          value: updated.name,
        },
      ],
    });

    return view(updated);
  }

  /**
   * Retires (`inactive`) or restores (`active`) one tenant entry.
   *
   * Both directions through one command, because the unique index that holds a
   * retired row's code makes a one-way retirement a permanent loss of that code
   * for the tenant. See the descriptor module.
   */
  async setStatus(
    db: DbHandle,
    catalogue: IntakeCatalogue,
    id: string,
    expectedVersion: number,
    status: CatalogueStatus
  ): Promise<IntakeCatalogueEntryView> {
    const descriptor = INTAKE_CATALOGUE_DESCRIPTORS[catalogue];
    const existing = await this.#requireTenantEntry(db, catalogue, id);

    const updated = this.#assertVersionMatched(
      await this.catalogues.setStatus(db, catalogue, id, expectedVersion, status)
    );

    await appendAudit(db, {
      action: descriptor.statusChangedAction,
      entityType: descriptor.entityType,
      entityId: id,
      details: [
        {
          field: 'status',
          classification: 'public',
          previousValue: existing.status,
          value: updated.status,
        },
      ],
    });

    return view(updated);
  }

  /**
   * Resolves the entry a management command names, or explains why it cannot.
   *
   * Three outcomes, deliberately distinct:
   *   - invisible (absent, or another tenant's) → 404, the same answer for both,
   *     so the endpoint is not an existence oracle for another tenant's rows;
   *   - visible but `scope = 'platform'` → 403 naming the reason, rather than
   *     the zero-row UPDATE the RLS policy would otherwise produce;
   *   - the tenant's own row → returned, retired or not.
   */
  async #requireTenantEntry(
    db: DbHandle,
    catalogue: IntakeCatalogue,
    id: string
  ): Promise<IntakeCatalogueRecord> {
    const found = await this.catalogues.findVisible(db, catalogue, id);
    if (!found) {
      throw new AppFailure('ERR-RES-001', { message: 'Catalogue entry not found' });
    }
    if (found.scope !== 'tenant') {
      throw new AppFailure('ERR-IAM-001', {
        message: 'Platform catalogue entries are shared defaults and cannot be changed here',
      });
    }
    return found;
  }

  /**
   * No row returned means the `record_version` predicate did not match.
   *
   * Every other reason for zero rows — absent, another tenant's, a platform row
   * — has already been excluded by `#requireTenantEntry`, so this is the
   * concurrency loss and nothing else.
   *
   * Returns the updated row so the caller renders the DATABASE's answer. The
   * new version is deliberately not computed as `expectedVersion + 1`: that
   * number is what the client sends back as its next `If-Match`, and inferring
   * it would silently encode an assumption about `shared.touch_row_metadata`
   * that this module does not own. `RETURNING` makes the response the row.
   */
  #assertVersionMatched(updated: IntakeCatalogueRecord | null): IntakeCatalogueRecord {
    if (!updated) {
      throw new AppFailure('ERR-CON-001', {
        message: 'The catalogue entry changed while this request was in flight; retry',
      });
    }
    return updated;
  }

  /** Maps the frozen catalogue constraints to stable problems; re-throws the rest. */
  #mapWriteFailure(error: unknown): AppFailure | unknown {
    if (isSqlState(error, SQLSTATE.uniqueViolation)) {
      // `uq_<t>_tenant_code`. The predicate is `deleted_at IS NULL` and says
      // nothing about status, so a RETIRED entry still holds its code — which is
      // why the message names restoring it as the way out rather than leaving
      // the caller to conclude the code is free.
      return new AppFailure('ERR-RES-002', {
        message:
          'This code is already used by an entry in this catalogue; restore the retired entry instead of re-adding it',
      });
    }
    if (isSqlState(error, SQLSTATE.insufficientPrivilege)) {
      // A row-level policy refused the write. That is an authorization outcome
      // and must leave as one: letting 42501 fall through would report a denial
      // as ERR-SYS-001, and route-handler sends every 5xx to the exception
      // monitor.
      return new AppFailure('ERR-IAM-001', {
        message: 'This catalogue entry is outside the scope your access grants',
      });
    }
    if (isSqlState(error, SQLSTATE.checkViolation)) {
      // ck_<t>_code_format / ck_<t>_name_not_blank. The route validates both
      // first, so reaching here means the API's bounds and the database's have
      // drifted apart — reported as the caller's 422 rather than a 500, because
      // the value genuinely is unacceptable.
      return new AppFailure('ERR-VAL-001', {
        message: 'The catalogue entry does not satisfy the catalogue constraints',
        safeDetails: { violations: [{ path: 'body', rule: 'catalogue_constraint' }] },
      });
    }
    return error;
  }
}

function view(record: IntakeCatalogueRecord): IntakeCatalogueEntryView {
  return {
    id: record.id,
    code: record.code,
    name: record.name,
    status: record.status,
    recordVersion: record.recordVersion,
  };
}
