/**
 * CRM customer READ repository (P1-16 remediation, `P1-27-INT-001`).
 *
 * Every customer profile component was write-only over HTTP. `crm.contact_points`,
 * `crm.addresses`, `crm.communication_preferences`, `crm.consent_history`,
 * `shared.notes`, `crm.customer_alerts`, `crm.partner_segment_assignments` and
 * `crm.customer_restrictions` each had a POST or PUT and no GET, and there was
 * no route module for a customer at all — so nothing in the platform could
 * return a customer or anything attached to one.
 *
 * The data was always there and always correctly scoped; only the way out was
 * missing. That is why this is one repository of reads rather than a change to
 * any existing write.
 *
 * ## The same rules as every other statement in this module
 *
 *  1. `tenant_id` comes from the resolved context, never from a caller. Every
 *     statement carries an explicit `tenant_id = $1` predicate ON TOP of RLS,
 *     because a defence that exists once exists nowhere.
 *  2. The parent is resolved first, through `requireLiveCustomer`, so
 *     "not yours" and "does not exist" are the same 404 and the endpoint cannot
 *     be used to test whether an id exists in another tenant.
 *  3. Soft-deleted and merged-away rows are excluded, so a tombstone never
 *     appears as live data.
 *  4. Every list is a keyset page under the platform contract — one sort column
 *     plus the id tie-break — and never an unbounded SELECT.
 *
 * ## Why presentation ordering is not done here
 *
 * A contact list wants primaries first and an alert list wants critical first,
 * and neither is expressible as `(sortColumn, id)`, which is what keyset
 * pagination requires to stay total and stable. Sorting by `is_primary DESC,
 * created_at DESC` would make the cursor lie: two rows can swap sides of a page
 * boundary the moment a primary is demoted, and the caller would silently miss
 * one.
 *
 * So the ordering here is the one pagination can guarantee, and every row
 * carries the field the screen ranks by (`isPrimary`, `severity`). Presentation
 * order is the screen's job; a total order is the database's.
 *
 * ## `date` columns are read as `::text`
 *
 * The same rule `wty` states and for the same reason: `pg` decodes OID 1082 into
 * a JS `Date` at LOCAL midnight, so `toISOString().slice(0, 10)` moves the day
 * back by one for any process running east of UTC — which the pilot deployment
 * is. An alert that started today would be published as having started
 * yesterday, and because the same value feeds the keyset cursor, the page
 * boundary would be wrong too.
 *
 * The tables are aliased in those queries so the keyset `ORDER BY` names a
 * QUALIFIED column. An unqualified `ORDER BY effective_from` binds to the output
 * column — the `::text` alias — rather than to the `date` it came from, while
 * the `WHERE` predicate can only see the table column. The two happen to agree
 * for ISO dates, and relying on that coincidence is not a contract.
 *
 * ## Verified against the live schema, not against memory
 *
 * Every column named below was read out of `information_schema` before it was
 * written here. That is not diligence theatre: the first draft of this file
 * selected `crm.customer_notes.category`, `is_sensitive` and `retired_at` from a
 * table that **does not exist** — notes are polymorphic and live in
 * `shared.notes`. A read repository that compiles proves nothing about whether
 * its columns are real, because the failure is at runtime.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import {
  buildPage,
  buildPageWithCursors,
  cursorTimestamp,
  keysetFragment,
  type OrderingContract,
  type Page,
  type PageRequest,
} from '@/server/db/pagination';

/**
 * One ordering contract per component list.
 *
 * Named after the relation and the sort column so a cursor issued for one list
 * is rejected by every other: `decodeCursor` compares the key, and a contacts
 * cursor replayed against addresses fails `ERR-PAG-001` instead of producing a
 * plausible wrong page.
 */
export const CONTACT_ORDERING: OrderingContract = {
  key: 'crm.contact_points:created_at_desc',
  direction: 'desc',
};
export const ADDRESS_ORDERING: OrderingContract = {
  key: 'crm.addresses:created_at_desc',
  direction: 'desc',
};
export const PREFERENCE_ORDERING: OrderingContract = {
  key: 'crm.communication_preferences:created_at_desc',
  direction: 'desc',
};
export const CONSENT_ORDERING: OrderingContract = {
  key: 'crm.consent_history:effective_at_desc',
  direction: 'desc',
};
export const NOTE_ORDERING: OrderingContract = {
  key: 'shared.notes:created_at_desc',
  direction: 'desc',
};
export const ALERT_ORDERING: OrderingContract = {
  key: 'crm.customer_alerts:effective_from_desc',
  direction: 'desc',
};
export const TAG_ORDERING: OrderingContract = {
  key: 'crm.partner_segment_assignments:assigned_at_desc',
  direction: 'desc',
};
export const RESTRICTION_ORDERING: OrderingContract = {
  key: 'crm.customer_restrictions:effective_from_desc',
  direction: 'desc',
};
/**
 * The customer→vehicle list (P1-16 remediation, `P1-27-INT-012`).
 *
 * Deliberately NOT `veh.vehicle_relationships:created_at_desc`, although that is
 * the relation and the sort: the vehicle module's vehicle-centric list
 * (`veh.vehicle-relationship-list`) already paginates the same table under that
 * key, and two lists sharing a key would ACCEPT each other's cursors — the same
 * relation filtered by a different parent, which is precisely the "plausible
 * wrong page" the key comparison exists to refuse.
 */
export const CUSTOMER_VEHICLE_ORDERING: OrderingContract = {
  key: 'veh.vehicle_relationships:partner_created_at_desc',
  direction: 'desc',
};

/** A customer, as much of one as a profile screen needs. */
/**
 * The least a screen needs to name a customer instead of showing a uuid.
 *
 * Deliberately three fields. A relationship row needs to say WHO, not to carry a
 * second copy of the customer profile — and every field published somewhere it is
 * not needed is a field that has to be justified against the tenant's privacy
 * classification wherever it lands.
 */
export interface CustomerDisplayIdentity {
  readonly id: string;
  readonly displayName: string;
  readonly displayNumber: string | null;
  readonly partyType: string;
}

export interface CustomerDetailRow {
  readonly id: string;
  readonly displayNumber: string | null;
  readonly displayName: string;
  readonly partyType: string;
  readonly lifecycleStatus: string;
  readonly commercialStatus: string;
  /**
   * The optimistic-concurrency token.
   *
   * `crm.business_partners.record_version` has always existed and has never been
   * published. A client that cannot read it cannot send `If-Match` on a later
   * update, so every write is a last-writer-wins race. Returning it here is what
   * makes a conflict detectable rather than silent.
   */
  readonly recordVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string | null;
  /** Individual profile fields; null for an organization. */
  readonly givenName: string | null;
  readonly familyName: string | null;
  readonly preferredLocale: string | null;
  /** Company profile fields; null for an individual. */
  readonly legalName: string | null;
  readonly tradeName: string | null;
}

export interface ContactPointEntry {
  readonly id: string;
  readonly channel: string;
  /** As the operator typed it. `null` when only the normalized form was kept. */
  readonly rawValue: string | null;
  readonly normalizedValue: string;
  readonly label: string | null;
  readonly isPrimary: boolean;
  readonly status: string;
  readonly verifiedAt: string | null;
  readonly createdAt: string;
}

export interface AddressEntry {
  readonly id: string;
  readonly addressType: string;
  readonly line1: string;
  readonly line2: string | null;
  readonly line3: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly postalCode: string | null;
  /**
   * Nullable, because `crm.addresses.country_code` is.
   *
   * It was typed `string` on the first pass, which is a lie TypeScript would
   * have believed: a consumer writing `countryCode.toUpperCase()` compiles and
   * throws at runtime on any address whose country was never captured — and the
   * POST that creates one accepts `countryCode` as optional, so such rows are
   * ordinary rather than exotic.
   */
  readonly countryCode: string | null;
  readonly isPrimary: boolean;
  readonly status: string;
  readonly createdAt: string;
}

export interface PreferenceEntry {
  readonly id: string;
  readonly channel: string;
  readonly purpose: string;
  readonly preferred: boolean;
  readonly preferredLocale: string | null;
  readonly quietHoursNote: string | null;
  /** Published so a client can send `If-Match` on the preferences PUT. */
  readonly recordVersion: number;
  readonly createdAt: string;
}

export interface ConsentEntry {
  readonly id: string;
  readonly consentKind: string;
  readonly channel: string | null;
  readonly purpose: string | null;
  readonly status: string;
  readonly source: string | null;
  readonly effectiveAt: string;
  readonly contactPointId: string | null;
  readonly evidenceDocumentId: string | null;
  readonly recordedBy: string;
  /**
   * The append-only sequence number.
   *
   * Two consent rows written in one transaction share `effective_at` to the
   * microsecond. `seq` is the only field that says which decision came second,
   * so a screen showing "the current answer" needs it to be right.
   */
  readonly seq: string;
}

export interface NoteEntry {
  readonly id: string;
  readonly body: string;
  readonly classification: string;
  readonly visibility: string;
  readonly authorId: string;
  readonly editedAt: string | null;
  readonly createdAt: string;
}

export interface AlertEntry {
  readonly id: string;
  readonly alertType: string;
  readonly severity: string;
  readonly message: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly acknowledgedBy: string | null;
  readonly acknowledgedAt: string | null;
}

export interface TagEntry {
  readonly id: string;
  readonly segmentId: string;
  readonly segmentCode: string;
  readonly name: string;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly assignedAt: string;
  readonly assignedBy: string;
}

export interface RestrictionEntry {
  readonly id: string;
  readonly restrictionType: string;
  readonly reason: string;
  readonly approvalRef: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly imposedBy: string;
}

/**
 * One customer→vehicle relationship, with as much vehicle identity as
 * `veh.vehicles` itself carries (`P1-27-INT-012`).
 *
 * The vehicle fields are nullable as a group: the relationship row outlives a
 * soft-deleted vehicle (`fk_vehicle_relationships_vehicle` is RESTRICT, but the
 * delete is a tombstone), and when the join finds no live vehicle the honest
 * answer is the bare `vehicleId` beside nulls — never a resurrected identity.
 *
 * `makeId`/`modelId` are published as BARE ids on purpose. Their names live in
 * the `veh` reference catalogs, which have their own published reads
 * (`/vehicle-catalogue/**`); resolving them here would put the first
 * CRM-authored join over `veh.makes`/`veh.models` into the codebase inside a
 * remediation, the precedent `resolveDisplayIdentities` refuses in the other
 * direction. Plates live in `veh.plate_history`, not on `veh.vehicles`, and are
 * reachable through `GET /vehicles/{vehicleId}/plates` — same rule, no join.
 */
export interface CustomerVehicleEntry {
  readonly id: string;
  readonly vehicleId: string;
  readonly relationshipRole: string;
  /** `date` columns, read `::text` so a day is never shifted by a timezone. */
  readonly validFrom: string;
  readonly validTo: string | null;
  /** `valid_to IS NULL` — the open interval is the live relationship. */
  readonly active: boolean;
  readonly createdAt: string;
  readonly vehicleDisplayNumber: string | null;
  /** The generated, normalised VIN — never `vin_raw`, matching every veh read. */
  readonly vin: string | null;
  readonly makeId: string | null;
  readonly modelId: string | null;
  readonly modelYear: number | null;
  readonly color: string | null;
  readonly vehicleLifecycleStatus: string | null;
}

/** `Date | null` to an ISO string or null, once, rather than at nine call sites. */
function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export class CustomerReadRepository extends Repository {
  protected readonly module = 'crm';

  /**
   * Resolves the parent, or null.
   *
   * Deliberately identical in shape to `CustomerProfileRepository.findLiveCustomer`
   * rather than shared with it: the write repository's copy gates writes, this one
   * gates reads, and coupling them would mean a change made for one silently
   * changes the other's failure mode.
   */
  async requireLiveCustomer(db: DbHandle, customerId: string): Promise<{ id: string } | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `SELECT id FROM crm.business_partners
        WHERE tenant_id = $1 AND id = $2
          AND deleted_at IS NULL AND merged_into_id IS NULL`,
      [context.principal.tenantId, customerId]
    );
    return result.rows[0] ?? null;
  }

  /**
   * The customer itself, with whichever profile its party type carries.
   *
   * One statement with two LEFT JOINs rather than a lookup followed by a second
   * query: a customer and its profile are written in one transaction and a screen
   * that read them separately could observe one without the other.
   */
  /**
   * Display identity for a SET of partner ids, for callers that hold ids and
   * must show people rather than uuids (`P1-27-INT-025`).
   *
   * ## Why a batch, and why here
   *
   * The vehicle relationship and ownership reads publish `partner_id` and no
   * name, so their screens rendered a uuid under a column headed with a person's
   * name. Resolving that one id at a time would be an N+1 — and against the
   * `expensive-read` bucket, a single page of relationships could exhaust an
   * operator's minute. One statement, one round trip, however many rows.
   *
   * ## Absence is a normal answer, not an error
   *
   * `findCustomerDetail` throws `ERR-RES-001` through its service, which is right
   * for "open this customer" and wrong here: a relationship row can legitimately
   * reference a partner this caller cannot see, and the screen's job is then to
   * say so in words rather than to fail. So ids that resolve to nothing are
   * simply ABSENT from the returned map, and the caller decides what to say.
   *
   * Soft-deleted and merged partners are excluded on the same predicate
   * `findCustomerDetail` uses, so the two reads cannot disagree about who exists.
   * RLS still applies underneath the explicit tenant predicate.
   */
  async findDisplayIdentities(
    db: DbHandle,
    partnerIds: readonly string[]
  ): Promise<ReadonlyMap<string, CustomerDisplayIdentity>> {
    const unique = [...new Set(partnerIds)];
    // No ids means no statement. Sending an empty array would be a round trip
    // that can only return nothing.
    if (unique.length === 0) return new Map();

    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      display_number: string | null;
      display_name: string;
      party_type: string;
    }>(
      db,
      `SELECT id, display_number, display_name, party_type
         FROM crm.business_partners
        WHERE tenant_id = $1 AND id = ANY($2::uuid[])
          AND deleted_at IS NULL AND merged_into_id IS NULL`,
      [context.principal.tenantId, unique]
    );

    return new Map(
      result.rows.map((row) => [
        row.id,
        {
          id: row.id,
          displayName: row.display_name,
          displayNumber: row.display_number,
          partyType: row.party_type,
        },
      ])
    );
  }

  async findCustomerDetail(db: DbHandle, customerId: string): Promise<CustomerDetailRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      display_number: string | null;
      display_name: string;
      party_type: string;
      lifecycle_status: string;
      commercial_status: string;
      record_version: number;
      created_at: Date;
      updated_at: Date | null;
      given_name: string | null;
      family_name: string | null;
      preferred_locale: string | null;
      legal_name: string | null;
      trade_name: string | null;
    }>(
      db,
      `SELECT p.id, p.display_number, p.display_name, p.party_type,
              p.lifecycle_status, p.commercial_status, p.record_version,
              p.created_at, p.updated_at,
              i.given_name, i.family_name, i.preferred_locale,
              c.legal_name, c.trade_name
         FROM crm.business_partners p
         LEFT JOIN crm.individual_profiles i
                ON i.tenant_id = p.tenant_id AND i.partner_id = p.id
         LEFT JOIN crm.company_profiles c
                ON c.tenant_id = p.tenant_id AND c.partner_id = p.id
        WHERE p.tenant_id = $1 AND p.id = $2
          AND p.deleted_at IS NULL AND p.merged_into_id IS NULL
        LIMIT 1`,
      [context.principal.tenantId, customerId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      displayNumber: row.display_number,
      displayName: row.display_name,
      partyType: row.party_type,
      lifecycleStatus: row.lifecycle_status,
      commercialStatus: row.commercial_status,
      recordVersion: row.record_version,
      createdAt: row.created_at.toISOString(),
      updatedAt: iso(row.updated_at),
      givenName: row.given_name,
      familyName: row.family_name,
      preferredLocale: row.preferred_locale,
      legalName: row.legal_name,
      tradeName: row.trade_name,
    };
  }

  /**
   * Contact points, newest first.
   *
   * `deleted_at IS NULL` is not optional: a contact point is soft-deleted, and a
   * read that ignored the tombstone would show a phone number somebody
   * deliberately removed — the one failure mode that turns a stale screen into a
   * call to the wrong person.
   */
  async listContacts(
    db: DbHandle,
    customerId: string,
    page: PageRequest
  ): Promise<Page<ContactPointEntry>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, customerId];
    const keyset = keysetFragment(page, { sort: 'created_at', id: 'id' }, CONTACT_ORDERING, 3);
    values.push(...keyset.values);

    const result = await this.run<{
      id: string;
      channel: string;
      raw_value: string | null;
      normalized_value: string;
      label: string | null;
      is_primary: boolean;
      status: string;
      verified_at: Date | null;
      created_at: Date;
      created_at_cursor: string;
    }>(
      db,
      `SELECT id, channel, raw_value, normalized_value, label, is_primary,
              status, verified_at, created_at,
              ${cursorTimestamp('created_at')} AS created_at_cursor
         FROM crm.contact_points
        WHERE tenant_id = $1 AND partner_id = $2
          AND deleted_at IS NULL ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      values
    );
    const rows = result.rows.map((row) => ({
      item: {
        id: row.id,
        channel: row.channel,
        rawValue: row.raw_value,
        normalizedValue: row.normalized_value,
        label: row.label,
        isPrimary: row.is_primary,
        status: row.status,
        verifiedAt: iso(row.verified_at),
        createdAt: row.created_at.toISOString(),
      },
      sortValue: row.created_at_cursor,
      id: row.id,
    }));
    return buildPageWithCursors(rows, page, CONTACT_ORDERING);
  }

  /** Addresses, newest first. Soft-deleted rows excluded, as for contacts. */
  async listAddresses(
    db: DbHandle,
    customerId: string,
    page: PageRequest
  ): Promise<Page<AddressEntry>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, customerId];
    const keyset = keysetFragment(page, { sort: 'created_at', id: 'id' }, ADDRESS_ORDERING, 3);
    values.push(...keyset.values);

    const result = await this.run<{
      id: string;
      address_type: string;
      line1: string;
      line2: string | null;
      line3: string | null;
      city: string | null;
      region: string | null;
      postal_code: string | null;
      country_code: string | null;
      is_primary: boolean;
      status: string;
      created_at: Date;
      created_at_cursor: string;
    }>(
      db,
      `SELECT id, address_type, line1, line2, line3, city, region, postal_code,
              country_code, is_primary, status, created_at,
              ${cursorTimestamp('created_at')} AS created_at_cursor
         FROM crm.addresses
        WHERE tenant_id = $1 AND partner_id = $2
          AND deleted_at IS NULL ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      values
    );
    const rows = result.rows.map((row) => ({
      item: {
        id: row.id,
        addressType: row.address_type,
        line1: row.line1,
        line2: row.line2,
        line3: row.line3,
        city: row.city,
        region: row.region,
        postalCode: row.postal_code,
        countryCode: row.country_code,
        isPrimary: row.is_primary,
        status: row.status,
        createdAt: row.created_at.toISOString(),
      },
      sortValue: row.created_at_cursor,
      id: row.id,
    }));
    return buildPageWithCursors(rows, page, ADDRESS_ORDERING);
  }

  /**
   * Communication preferences.
   *
   * `record_version` travels with each row because preferences are the one
   * component with an idempotent PUT: without the version a client cannot send
   * `If-Match`, and two people editing the same customer overwrite each other in
   * silence.
   */
  async listPreferences(
    db: DbHandle,
    customerId: string,
    page: PageRequest
  ): Promise<Page<PreferenceEntry>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, customerId];
    const keyset = keysetFragment(page, { sort: 'created_at', id: 'id' }, PREFERENCE_ORDERING, 3);
    values.push(...keyset.values);

    const result = await this.run<{
      id: string;
      channel: string;
      purpose: string;
      preferred: boolean;
      preferred_locale: string | null;
      quiet_hours_note: string | null;
      record_version: number;
      created_at: Date;
      created_at_cursor: string;
    }>(
      db,
      `SELECT id, channel, purpose, preferred, preferred_locale,
              quiet_hours_note, record_version, created_at,
              ${cursorTimestamp('created_at')} AS created_at_cursor
         FROM crm.communication_preferences
        WHERE tenant_id = $1 AND partner_id = $2 ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      values
    );
    const rows = result.rows.map((row) => ({
      item: {
        id: row.id,
        channel: row.channel,
        purpose: row.purpose,
        preferred: row.preferred,
        preferredLocale: row.preferred_locale,
        quietHoursNote: row.quiet_hours_note,
        recordVersion: row.record_version,
        createdAt: row.created_at.toISOString(),
      },
      sortValue: row.created_at_cursor,
      id: row.id,
    }));
    return buildPageWithCursors(rows, page, PREFERENCE_ORDERING);
  }

  /**
   * Consent HISTORY, newest first — not a current-state view.
   *
   * `crm.consent_history` is append-only by design: a withdrawal is a new row,
   * never an edit. Collapsing it to "the current answer" here would throw away
   * the evidence that makes a consent defensible, so the full history is returned
   * and the screen decides what to emphasise.
   */
  async listConsents(
    db: DbHandle,
    customerId: string,
    page: PageRequest
  ): Promise<Page<ConsentEntry>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, customerId];
    const keyset = keysetFragment(page, { sort: 'effective_at', id: 'id' }, CONSENT_ORDERING, 3);
    values.push(...keyset.values);

    const result = await this.run<{
      id: string;
      consent_kind: string;
      channel: string | null;
      purpose: string | null;
      status: string;
      source: string | null;
      effective_at: Date;
      contact_point_id: string | null;
      evidence_document_id: string | null;
      recorded_by: string;
      seq: string;
      effective_at_cursor: string;
    }>(
      db,
      `SELECT id, consent_kind, channel, purpose, status, source,
              effective_at, contact_point_id, evidence_document_id,
              recorded_by, seq,
              ${cursorTimestamp('effective_at')} AS effective_at_cursor
         FROM crm.consent_history
        WHERE tenant_id = $1 AND partner_id = $2 ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      values
    );
    // The acute case for `P1-27-INT-006` on the CRM side: two consent decisions
    // about the same dimension tuple written in one transaction share
    // `effective_at` to the microsecond — the very tie `seq` exists to break — so
    // a millisecond cursor would drop whichever of them fell after a page edge.
    const rows = result.rows.map((row) => ({
      item: {
        id: row.id,
        consentKind: row.consent_kind,
        channel: row.channel,
        purpose: row.purpose,
        status: row.status,
        source: row.source,
        effectiveAt: row.effective_at.toISOString(),
        contactPointId: row.contact_point_id,
        evidenceDocumentId: row.evidence_document_id,
        recordedBy: row.recorded_by,
        // `bigint` arrives from `pg` as a string and stays one: a consent sequence
        // outliving `Number.MAX_SAFE_INTEGER` is unlikely, and silently truncating
        // it if it ever did is not a trade worth making for a field the client only
        // compares and displays.
        seq: String(row.seq),
      },
      sortValue: row.effective_at_cursor,
      id: row.id,
    }));
    return buildPageWithCursors(rows, page, CONSENT_ORDERING);
  }

  /**
   * Notes live in `shared.notes`, not in the CRM schema.
   *
   * They are polymorphic — `(entity_type, entity_id)` — and the RLS policy pins
   * `entity_type = 'crm.business_partners'` on the write side, so this read is
   * scoped by the same discriminator. The literal is passed as a PARAMETER rather
   * than inlined, so the statement text carries no entity vocabulary at all.
   *
   * `deleted_at IS NULL` matters more here than elsewhere: the policy grants
   * UPDATE on `deleted_at` and no DELETE, so retiring a note is a soft delete and
   * a read that ignored it would resurrect notes somebody deliberately withdrew.
   *
   * **What this read cannot see.** `sel_notes_tenant` exposes `restricted` and
   * `secret` notes only to a caller holding `iam.sensitive.view`; everyone else
   * gets a shorter list with no indication that it is shorter. That is correct
   * behaviour and it is also a trap for the screen, so the service publishes
   * whether the caller holds that capability — see `mayViewSensitiveNotes`.
   */
  async listNotes(
    db: DbHandle,
    customerId: string,
    entityType: string,
    page: PageRequest
  ): Promise<Page<NoteEntry>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, customerId, entityType];
    const keyset = keysetFragment(page, { sort: 'created_at', id: 'id' }, NOTE_ORDERING, 4);
    values.push(...keyset.values);

    const result = await this.run<{
      id: string;
      body: string;
      classification: string;
      visibility: string;
      author_id: string;
      edited_at: Date | null;
      created_at: Date;
      created_at_cursor: string;
    }>(
      db,
      `SELECT id, body, classification, visibility, author_id, edited_at, created_at,
              ${cursorTimestamp('created_at')} AS created_at_cursor
         FROM shared.notes
        WHERE tenant_id = $1 AND entity_id = $2 AND entity_type = $3
          AND deleted_at IS NULL ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      values
    );
    const rows = result.rows.map((row) => ({
      item: {
        id: row.id,
        body: row.body,
        classification: row.classification,
        visibility: row.visibility,
        authorId: row.author_id,
        editedAt: iso(row.edited_at),
        createdAt: row.created_at.toISOString(),
      },
      sortValue: row.created_at_cursor,
      id: row.id,
    }));
    return buildPageWithCursors(rows, page, NOTE_ORDERING);
  }

  /**
   * Whether the caller may see `restricted` and `secret` notes.
   *
   * Asked of the database rather than recomputed in TypeScript, because the
   * database is what actually decides: `sel_notes_tenant` calls
   * `iam.has_permission('iam.sensitive.view')`, and any second implementation of
   * "does this caller hold it" could disagree with the policy that matters.
   */
  /**
   * Whether this caller may be told a customer's name at all (`P1-27-INT-025`).
   *
   * `docs/database/veh-ownership-visibility-matrix.md:49` grants a tenant
   * employee holding only Vehicle read the "Ownership partner UUID (opaque
   * UUID)" and denies the CRM columns beside it, giving the reason "CRM RLS +
   * CRM permission model". RLS alone does not implement that: `crm.customer.read`
   * is enforced at the operation boundary, and the vehicle relationship and
   * ownership reads are guarded by `veh.vehicle.read`. So resolving a name for
   * every caller of those reads would hand a CRM name to somebody the matrix
   * says may not have one — a widening, and one the matrix reserves to the Owner
   * (`:36-37`: the API layer "narrows further but can never widen what RLS
   * denies").
   *
   * Checking the capability here narrows instead. A caller who holds
   * `crm.customer.read` could open the customer and read the same name, so they
   * gain nothing they did not have; a caller who does not gets no name — and the
   * screen says "Customer unavailable" rather than falling back to the uuid,
   * which satisfies the no-uuid-as-a-label rule without touching the matrix.
   */
  async mayReadCustomers(db: DbHandle): Promise<boolean> {
    const result = await this.run<{ allowed: boolean }>(
      db,
      `SELECT iam.has_permission('crm.customer.read') AS allowed`
    );
    return result.rows[0]?.allowed === true;
  }

  async mayViewSensitiveNotes(db: DbHandle): Promise<boolean> {
    const result = await this.run<{ allowed: boolean }>(
      db,
      `SELECT iam.has_permission('iam.sensitive.view') AS allowed`
    );
    return result.rows[0]?.allowed === true;
  }

  /**
   * Alerts that are in force today.
   *
   * BOTH conditions, because the table carries two independent ways to stop an
   * alert: `active` is the explicit switch and `effective_to` is the dated end.
   * Reading only one would show a caution somebody had already turned off, and an
   * alert exists to interrupt — a false one costs trust in every true one after
   * it.
   *
   * `severity` is deliberately NOT the sort key. It is `text` with a CHECK, not
   * an enum, so `ORDER BY severity` sorts alphabetically — critical, info,
   * warning — quietly ranking `info` above `warning`. It is returned on every row
   * and ranked by the screen.
   */
  async listAlerts(db: DbHandle, customerId: string, page: PageRequest): Promise<Page<AlertEntry>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, customerId];
    const keyset = keysetFragment(
      page,
      { sort: 'al.effective_from', id: 'al.id' },
      ALERT_ORDERING,
      3
    );
    values.push(...keyset.values);

    const result = await this.run<{
      id: string;
      alert_type: string;
      severity: string;
      message: string;
      effective_from: string;
      effective_to: string | null;
      acknowledged_by: string | null;
      acknowledged_at: Date | null;
    }>(
      db,
      `SELECT al.id, al.alert_type, al.severity, al.message,
              al.effective_from::text AS effective_from,
              al.effective_to::text AS effective_to,
              al.acknowledged_by, al.acknowledged_at
         FROM crm.customer_alerts al
        WHERE al.tenant_id = $1 AND al.partner_id = $2
          AND al.active IS TRUE
          AND (al.effective_to IS NULL OR al.effective_to >= current_date) ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      values
    );
    const rows = result.rows.map((row) => ({
      id: row.id,
      alertType: row.alert_type,
      severity: row.severity,
      message: row.message,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      acknowledgedBy: row.acknowledged_by,
      acknowledgedAt: iso(row.acknowledged_at),
    }));
    return buildPage(rows, page, ALERT_ORDERING, (row) => ({
      sortValue: row.effectiveFrom,
      id: row.id,
    }));
  }

  /** Segment assignments in force today, joined to the segment for its name. */
  async listTags(db: DbHandle, customerId: string, page: PageRequest): Promise<Page<TagEntry>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, customerId];
    const keyset = keysetFragment(page, { sort: 'a.assigned_at', id: 'a.id' }, TAG_ORDERING, 3);
    values.push(...keyset.values);

    const result = await this.run<{
      id: string;
      segment_id: string;
      segment_code: string;
      name: string;
      valid_from: string;
      valid_to: string | null;
      assigned_at: Date;
      assigned_at_cursor: string;
      assigned_by: string;
    }>(
      db,
      `SELECT a.id, a.segment_id, s.segment_code, s.name,
              a.valid_from::text AS valid_from,
              a.valid_to::text AS valid_to,
              a.assigned_at, a.assigned_by,
              ${cursorTimestamp('a.assigned_at')} AS assigned_at_cursor
         FROM crm.partner_segment_assignments a
         JOIN crm.customer_segments s
           ON s.tenant_id = a.tenant_id AND s.id = a.segment_id
        WHERE a.tenant_id = $1 AND a.partner_id = $2
          AND (a.valid_to IS NULL OR a.valid_to >= current_date)
          AND s.deleted_at IS NULL ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      values
    );
    const rows = result.rows.map((row) => ({
      item: {
        id: row.id,
        segmentId: row.segment_id,
        segmentCode: row.segment_code,
        name: row.name,
        validFrom: row.valid_from,
        validTo: row.valid_to,
        assignedAt: row.assigned_at.toISOString(),
        assignedBy: row.assigned_by,
      },
      sortValue: row.assigned_at_cursor,
      id: row.id,
    }));
    return buildPageWithCursors(rows, page, TAG_ORDERING);
  }

  /**
   * Restrictions in force today.
   *
   * Same `effective_to` reasoning as alerts, and it matters more here: a
   * restriction that has been lifted must not keep refusing work, and a screen
   * that cannot see the difference would either block wrongly or reassure
   * wrongly.
   */
  async listRestrictions(
    db: DbHandle,
    customerId: string,
    page: PageRequest
  ): Promise<Page<RestrictionEntry>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, customerId];
    const keyset = keysetFragment(
      page,
      { sort: 'r.effective_from', id: 'r.id' },
      RESTRICTION_ORDERING,
      3
    );
    values.push(...keyset.values);

    const result = await this.run<{
      id: string;
      restriction_type: string;
      reason: string;
      approval_ref: string | null;
      effective_from: string;
      effective_to: string | null;
      imposed_by: string;
    }>(
      db,
      `SELECT r.id, r.restriction_type, r.reason, r.approval_ref,
              r.effective_from::text AS effective_from,
              r.effective_to::text AS effective_to,
              r.imposed_by
         FROM crm.customer_restrictions r
        WHERE r.tenant_id = $1 AND r.partner_id = $2
          AND (r.effective_to IS NULL OR r.effective_to >= current_date) ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      values
    );
    const rows = result.rows.map((row) => ({
      id: row.id,
      restrictionType: row.restriction_type,
      reason: row.reason,
      approvalRef: row.approval_ref,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      imposedBy: row.imposed_by,
    }));
    return buildPage(rows, page, RESTRICTION_ORDERING, (row) => ({
      sortValue: row.effectiveFrom,
      id: row.id,
    }));
  }

  /**
   * The customer's vehicle relationships, newest first (`P1-27-INT-012`).
   *
   * Reads the SAME `veh.vehicle_relationships` table `crm.vehicle-link` writes
   * — the single source of truth the vehicle module reads vehicle-centrically
   * through `veh.vehicle-relationship-list`. This is the partner-centric
   * direction, which had no read of any kind: the POST published no GET.
   *
   * The join to `veh.vehicles` carries `v.deleted_at IS NULL` so a tombstoned
   * vehicle never lends its identity to a live-looking row; the relationship
   * itself still appears, as the bare `vehicleId` it honestly is. History rows
   * (`valid_to` set) are returned with `active: false` rather than filtered:
   * who was linked to which vehicle is a dated business fact, and the screen
   * ranks by `active` the same way the contact list ranks by `isPrimary`.
   *
   * The visibility matrix permits the vehicle identity columns to any
   * authenticated same-tenant session (`veh-ownership-visibility-matrix.md` —
   * intra-tenant veh reads are differentiated only by `iam.sensitive.view`,
   * which gates the restricted identifiers this projection never touches), so
   * a `crm.customer.read` caller gains nothing the matrix reserves. The
   * reception list's `vehicle_display_number` join is the precedent.
   */
  async listVehicles(
    db: DbHandle,
    customerId: string,
    page: PageRequest
  ): Promise<Page<CustomerVehicleEntry>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, customerId];
    const keyset = keysetFragment(
      page,
      { sort: 'r.created_at', id: 'r.id' },
      CUSTOMER_VEHICLE_ORDERING,
      3
    );
    values.push(...keyset.values);

    const result = await this.run<{
      id: string;
      vehicle_id: string;
      relationship_role: string;
      valid_from: string;
      valid_to: string | null;
      created_at: Date;
      created_at_cursor: string;
      vehicle_display_number: string | null;
      vin_normalized: string | null;
      make_id: string | null;
      model_id: string | null;
      model_year: number | null;
      color: string | null;
      vehicle_lifecycle_status: string | null;
    }>(
      db,
      // `valid_from`/`valid_to` are `date` and are read `::text` so a day is
      // never shifted by a timezone; the cursor is a `timestamptz` and needs
      // the opposite treatment — full microsecond precision (`P1-27-INT-008`).
      `SELECT r.id, r.vehicle_id, r.relationship_role,
              r.valid_from::text AS valid_from,
              r.valid_to::text AS valid_to,
              r.created_at,
              ${cursorTimestamp('r.created_at')} AS created_at_cursor,
              v.display_number AS vehicle_display_number,
              v.vin_normalized,
              v.make_id, v.model_id, v.model_year, v.color,
              v.lifecycle_status AS vehicle_lifecycle_status
         FROM veh.vehicle_relationships r
         LEFT JOIN veh.vehicles v
                ON v.tenant_id = r.tenant_id AND v.id = r.vehicle_id
               AND v.deleted_at IS NULL
        WHERE r.tenant_id = $1 AND r.partner_id = $2 ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      values
    );
    const rows = result.rows.map((row) => ({
      item: {
        id: row.id,
        vehicleId: row.vehicle_id,
        relationshipRole: row.relationship_role,
        validFrom: row.valid_from,
        validTo: row.valid_to,
        active: row.valid_to === null,
        createdAt: row.created_at.toISOString(),
        vehicleDisplayNumber: row.vehicle_display_number,
        vin: row.vin_normalized,
        makeId: row.make_id,
        modelId: row.model_id,
        modelYear: row.model_year,
        color: row.color,
        vehicleLifecycleStatus: row.vehicle_lifecycle_status,
      },
      sortValue: row.created_at_cursor,
      id: row.id,
    }));
    return buildPageWithCursors(rows, page, CUSTOMER_VEHICLE_ORDERING);
  }
}
