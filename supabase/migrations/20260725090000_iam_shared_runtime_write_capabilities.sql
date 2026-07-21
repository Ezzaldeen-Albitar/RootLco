-- ============================================================================
-- Phase: 1-13 — Backend Architecture and Shared Application Foundation
-- Migration: tenant-safe runtime write capabilities for the foundation
--            primitives (audit append, transactional outbox, idempotency,
--            security events)
-- Change request: DBCR-P1-13-001
-- Tasks: P1-13-SEC-002, P1-13-BE-012, P1-13-BE-015, P1-13-SEC-003,
--        P1-13-SEC-004
-- Owner module: iam / shared
--
-- Purpose
--   The Release 2 baseline gives the `app_runtime` archetype SELECT only across
--   `shared` and `iam`. The backend foundation needs four WRITE capabilities in
--   the request transaction — append an audit record, publish a domain event,
--   store an idempotency key, and record a security event — and holds none of
--   them, so the foundation currently fails closed. DBCR-P1-13-001 records the
--   measured gap; this migration is its approved, minimum, additive remediation.
--
--   Nothing here creates a table, column, constraint, index, or sequence. It
--   adds grants, tenant-scoped policies, and one in-place redefinition of
--   `iam.audit_append` whose ONLY behavioural change is where the next chain
--   sequence number is read from (see section 3).
--
-- Dependencies
--   20260717107000 (shared.idempotency_keys), 20260718095000 (audit subsystem),
--   20260718098000 (permission-gated audit reads), 20260718106000
--   (shared.event_outbox), 0002 (role archetypes and context readers).
--
-- Rollback classification: ROLLBACK-SAFE (grants, policies, and one function
--   body only — no data is written, moved, or destroyed). The exact inverse is
--   given at the end of this file. Recorded in
--   docs/phase-1/phase-1-13/phase-1-13-migration-classification.md.
--
-- Security implications
--   * `app_runtime` remains NOLOGIN, non-owner, NOBYPASSRLS, and owns nothing.
--     No role is created, no ownership is transferred, no role attribute changes.
--   * Every policy added here is `tenant_id = iam.current_tenant_id()`. There is
--     no `USING (true)` and no `WITH CHECK (true)`. A session with no resolved
--     tenant matches nothing, because the comparison is against NULL.
--   * Only SELECT and INSERT are granted. No UPDATE, no DELETE, no TRUNCATE on
--     any of these tables — the audit trail, the outbox envelope, and a stored
--     idempotent response all stay append-only for the request path.
--   * The audit READ gate is preserved. `iam.audit.view` still governs reading
--     audit history: the SELECT policies added here expose ONLY audit records
--     that do not yet have a chain link, which is true exclusively for the row
--     being written inside the current `iam.audit_append` call and never for a
--     committed record. An ordinary runtime session therefore still reads zero
--     rows of audit history without the permission (proved in
--     tests/db/iam-audit.test.ts and tests/db/iam-hardening.test.ts).
--   * `app_worker` keeps its separate, deliberately all-tenant dispatch surface.
--     The runtime gains NO EXECUTE on `shared.claim_outbox_events`,
--     `complete_outbox_event`, or `fail_outbox_event`: producing an event and
--     draining the queue stay different capabilities held by different roles.
--   * `app_readonly` gains nothing at all.
--   * NO schema USAGE is granted. `iam.audit_hash` used `extensions.digest`
--     (pgcrypto), which under SECURITY INVOKER would have forced `GRANT USAGE ON
--     SCHEMA extensions TO app_runtime` — and that was measured to expose
--     `extensions.pg_stat_statements` and `pg_stat_statements_info`, which the
--     extension grants to PUBLIC. Section 1 removes the dependency instead of
--     paying for it: `pg_catalog.sha256(bytea)` is byte-identical (verified),
--     equally IMMUTABLE, and already executable by every role.
--
-- Objects created
--   Functions (redefined in place): iam.audit_hash(bytea, text),
--                                  iam.audit_append(uuid, uuid, text, text,
--                                  text, uuid, uuid, uuid, uuid, text, jsonb)
--   Policies:  ins_audit_records_writer, sel_audit_records_unlinked,
--              ins_audit_record_details_writer,
--              sel_audit_record_details_unlinked,
--              ins_audit_integrity_links_writer,
--              sel_audit_integrity_links_chain,
--              ins_event_outbox_producer, sel_event_outbox_producer,
--              ins_idempotency_keys_tenant, sel_idempotency_keys_tenant,
--              ins_security_events_runtime
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. iam.audit_hash — remove the cross-schema extension dependency.
--
--    Measured, not assumed: rehearsing the grant set failed with "permission
--    denied for schema extensions", because iam.audit_hash resolves
--    extensions.digest under the CALLER's privileges (SECURITY INVOKER). The
--    obvious fix — GRANT USAGE ON SCHEMA extensions TO app_runtime — was
--    rejected after measuring what it actually opens: pgcrypto installs
--    `extensions.pg_stat_statements` and `extensions.pg_stat_statements_info`
--    with SELECT to PUBLIC, so the schema grant would hand the request role a
--    cluster-wide statement view it has no business reading, and PUBLIC grants
--    cannot be revoked for one role.
--
--    `pg_catalog.sha256(bytea)` has been part of core PostgreSQL since 11, is
--    IMMUTABLE, is executable by every role without any grant, and produces
--    BYTE-IDENTICAL output to `digest(…, 'sha256')` — verified on this baseline
--    for the empty input, a short input, and a genuine `prev_hash || canonical`
--    chain input. Every hash already written therefore still verifies:
--    iam.audit_verify_chain recomputes with this same function and is untouched.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION iam.audit_hash(p_prev bytea, p_canonical text)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.sha256(p_prev || convert_to(p_canonical, 'UTF8'));
$$;

COMMENT ON FUNCTION iam.audit_hash(bytea, text) IS
  'record_hash = SHA-256(prev_hash || UTF8(canonical)). 32-byte output. Uses pg_catalog.sha256 rather than extensions.digest so the SECURITY INVOKER call chain needs no USAGE on schema extensions (DBCR-P1-13-001); the two are byte-identical, so hashes written before this change still verify.';

-- ----------------------------------------------------------------------------
-- 2. Function EXECUTE.
--
--    iam.audit_append is SECURITY INVOKER, so its three helpers execute with
--    the caller's privileges too. All four were REVOKEd from PUBLIC when they
--    were created; these are the only grants they carry.
--
--    Deliberately NOT granted: iam.audit_verify_chain (an operator/forensic
--    routine, not a request-path capability) and the three outbox worker
--    routines (a producer must not be able to claim, complete, or fail work).
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION
  iam.audit_append(uuid, uuid, text, text, text, uuid, uuid, uuid, uuid, text, jsonb)
  TO app_runtime;
GRANT EXECUTE ON FUNCTION iam.audit_mask(text, text)  TO app_runtime;
GRANT EXECUTE ON FUNCTION iam.audit_canonical(uuid)   TO app_runtime;
GRANT EXECUTE ON FUNCTION iam.audit_hash(bytea, text) TO app_runtime;

-- ----------------------------------------------------------------------------
-- 3. iam.audit_append — chain sequence derived from the chain itself.
--
--    WHY THIS CHANGES. The original body assigned the next sequence number with
--    `SELECT max(seq) FROM iam.audit_records WHERE tenant_id = p_tenant`. Under
--    FORCE RLS that read is subject to the caller's policies, so granting the
--    request path the ability to append would have required giving it SELECT
--    over the tenant's whole audit history — which is exactly the read that
--    `iam.audit.view` exists to gate. Any writer would have become a reader.
--
--    `iam.audit_integrity_links` carries the same seq for the same record and is
--    written by this function in the same transaction, so max(seq) over the
--    chain is identical to max(seq) over the records whenever the chain is
--    intact. Deriving it from the chain lets the writer's read of
--    `iam.audit_records` be narrowed to the single unlinked row it just wrote.
--
--    Everything else is unchanged: same signature, same defaults, same return,
--    same SECURITY INVOKER context, same empty search_path, same advisory lock,
--    same masking, same canonical form, same hash, same one-transaction
--    all-or-nothing behaviour. `iam.audit_verify_chain` is untouched and still
--    detects gaps, alterations, and orphan records.
--
--    If the chain is ever inconsistent with the records (an orphan record, which
--    audit_verify_chain reports as tampering), this derivation collides with
--    uq_audit_records_tenant_seq and the append FAILS rather than silently
--    writing a second record at a reused sequence number. Failing closed on a
--    damaged chain is the intended behaviour.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION iam.audit_append(
  p_tenant       uuid,
  p_actor        uuid,
  p_actor_kind   text,
  p_action       text,
  p_entity_type  text,
  p_entity_id    uuid    DEFAULT NULL,
  p_company      uuid    DEFAULT NULL,
  p_branch       uuid    DEFAULT NULL,
  p_correlation  uuid    DEFAULT NULL,
  p_request_ref  text    DEFAULT NULL,
  p_details      jsonb   DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_seq       bigint;
  v_id        uuid;
  v_prev      bytea;
  v_hash      bytea;
  v_canonical text;
  v_detail    jsonb;
BEGIN
  IF p_tenant IS NULL THEN
    RAISE EXCEPTION 'audit_append requires a tenant' USING ERRCODE = 'check_violation';
  END IF;

  -- Serialize this tenant's chain: seq + prev_hash are assigned under the lock,
  -- which is held to COMMIT — concurrent appends cannot fork the chain.
  PERFORM pg_advisory_xact_lock(hashtext('iam.audit:' || p_tenant::text));

  -- The chain is the sequence authority (see the note above), so appending
  -- never requires reading this tenant's committed audit records.
  SELECT COALESCE(max(seq), 0) + 1
    INTO v_seq
    FROM iam.audit_integrity_links
   WHERE tenant_id = p_tenant;

  v_id := gen_random_uuid();

  INSERT INTO iam.audit_records
    (id, tenant_id, seq, actor_id, actor_kind, action, entity_type, entity_id,
     company_id, branch_id, correlation_id, request_ref, occurred_at)
  VALUES
    (v_id, p_tenant, v_seq, p_actor, p_actor_kind, p_action, p_entity_type, p_entity_id,
     p_company, p_branch, p_correlation, p_request_ref, now());

  FOR v_detail IN SELECT * FROM jsonb_array_elements(COALESCE(p_details, '[]'::jsonb)) LOOP
    INSERT INTO iam.audit_record_details
      (tenant_id, audit_record_id, field_name, old_value_masked, new_value_masked, value_classification)
    VALUES
      (p_tenant, v_id, v_detail ->> 'field',
       iam.audit_mask(v_detail ->> 'old', COALESCE(v_detail ->> 'class', 'internal')),
       iam.audit_mask(v_detail ->> 'new', COALESCE(v_detail ->> 'class', 'internal')),
       COALESCE(v_detail ->> 'class', 'internal'));
  END LOOP;

  SELECT record_hash INTO v_prev
    FROM iam.audit_integrity_links WHERE tenant_id = p_tenant ORDER BY seq DESC LIMIT 1;
  IF v_prev IS NULL THEN
    v_prev := decode(repeat('00', 32), 'hex'); -- genesis: 32 zero bytes
  END IF;

  v_canonical := iam.audit_canonical(v_id);
  -- A caller that cannot read back the row it just wrote would otherwise fail
  -- later with an opaque NOT NULL violation on record_hash. Name the cause.
  IF v_canonical IS NULL THEN
    RAISE EXCEPTION 'audit_append cannot read back the record it just wrote (id %); the caller lacks the writer-scoped SELECT path on iam.audit_records', v_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_hash := iam.audit_hash(v_prev, v_canonical);

  INSERT INTO iam.audit_integrity_links (tenant_id, audit_record_id, seq, prev_hash, record_hash)
  VALUES (p_tenant, v_id, v_seq, v_prev, v_hash);

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION iam.audit_append(uuid, uuid, text, text, text, uuid, uuid, uuid, uuid, text, jsonb) IS
  'Sole audit writer (P1-04-DB-022): under a per-tenant advisory lock, assigns the next seq FROM THE CHAIN (iam.audit_integrity_links, so appending never requires reading committed audit history), inserts the record + masked details + chain link in ONE transaction. A failure of any step aborts the caller''s transaction (nothing persists). SECURITY INVOKER; granted to app_runtime by DBCR-P1-13-001.';

-- ----------------------------------------------------------------------------
-- 4. Audit tables — tenant-scoped append, and the narrowest possible read.
--
--    The writer must read three things and nothing else:
--      a) the tenant's highest chain sequence and its last record_hash
--         → sel_audit_integrity_links_chain (tenant-scoped; the chain carries
--           opaque hashes, a counter, and a record id — no business content);
--      b) the record row it just inserted, for iam.audit_canonical
--         → sel_audit_records_unlinked;
--      c) that record's detail rows, for the same canonical form
--         → sel_audit_record_details_unlinked.
--
--    (b) and (c) are expressed as "has no chain link yet". Inside audit_append
--    the link is written LAST, so the row under construction qualifies and every
--    committed record — which always has its link — does not. The permission
--    gate on audit history is therefore untouched: a session without
--    iam.audit.view still reads zero committed audit rows.
-- ----------------------------------------------------------------------------
GRANT INSERT ON iam.audit_records         TO app_runtime;
GRANT INSERT ON iam.audit_record_details  TO app_runtime;
GRANT INSERT ON iam.audit_integrity_links TO app_runtime;

CREATE POLICY ins_audit_records_writer ON iam.audit_records
  FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_audit_record_details_writer ON iam.audit_record_details
  FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_audit_integrity_links_writer ON iam.audit_integrity_links
  FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id());

CREATE POLICY sel_audit_records_unlinked ON iam.audit_records
  FOR SELECT TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND NOT EXISTS (
      SELECT 1 FROM iam.audit_integrity_links l
       WHERE l.audit_record_id = iam.audit_records.id
    )
  );
CREATE POLICY sel_audit_record_details_unlinked ON iam.audit_record_details
  FOR SELECT TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND NOT EXISTS (
      SELECT 1 FROM iam.audit_integrity_links l
       WHERE l.audit_record_id = iam.audit_record_details.audit_record_id
    )
  );
CREATE POLICY sel_audit_integrity_links_chain ON iam.audit_integrity_links
  FOR SELECT TO app_runtime
  USING (tenant_id = iam.current_tenant_id());

COMMENT ON POLICY ins_audit_records_writer ON iam.audit_records IS
  'Runtime append path (DBCR-P1-13-001): a request may write an audit header for its own resolved tenant only. No UPDATE or DELETE grant exists, so records stay append-only, and the hash chain remains the tamper control.';
COMMENT ON POLICY sel_audit_records_unlinked ON iam.audit_records IS
  'Writer-scoped read, NOT an audit-history read: exposes only records that have no chain link yet, which inside iam.audit_append is the row being written and after COMMIT is never any row. Reading audit history still requires iam.audit.view via sel_audit_records_permitted.';
COMMENT ON POLICY sel_audit_record_details_unlinked ON iam.audit_record_details IS
  'Writer-scoped read for iam.audit_canonical, limited to details of a record that has no chain link yet. Committed detail rows remain gated by iam.audit.view.';
COMMENT ON POLICY sel_audit_integrity_links_chain ON iam.audit_integrity_links IS
  'The appending session must read its own tenant''s last chain link (seq and record_hash) to extend the chain. Chain rows carry opaque hashes, a counter, and a record id — no action, actor, entity, or field value.';

-- ----------------------------------------------------------------------------
-- 5. shared.event_outbox — producer insertion only.
--
--    SELECT is required because the producer writes with INSERT ... RETURNING id
--    and RETURNING is evaluated against the SELECT policy. It is tenant-scoped:
--    a producer sees its own tenant's envelopes and no other tenant's.
--
--    Deliberately absent: UPDATE and DELETE, and EXECUTE on the three claim /
--    complete / fail routines. Queue drainage stays exclusively app_worker's.
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT ON shared.event_outbox TO app_runtime;

CREATE POLICY ins_event_outbox_producer ON shared.event_outbox
  FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY sel_event_outbox_producer ON shared.event_outbox
  FOR SELECT TO app_runtime
  USING (tenant_id = iam.current_tenant_id());

COMMENT ON POLICY ins_event_outbox_producer ON shared.event_outbox IS
  'Transactional-outbox producer (BR-INT-001): a request publishes an event for its own resolved tenant inside the transaction that commits the state change. The initial-state trigger still forces pending/unstamped, and the runtime holds no claim, complete, or fail capability.';
COMMENT ON POLICY sel_event_outbox_producer ON shared.event_outbox IS
  'Tenant-scoped producer read. Required for INSERT ... RETURNING and bounded to the producing tenant; the worker''s deliberately all-tenant dispatch policy is separate and unchanged.';

-- ----------------------------------------------------------------------------
-- 6. shared.idempotency_keys — tenant-scoped replay protection.
--
--    Until now this table had RLS enabled AND forced with no policy at all and
--    no application grant, so every application role was denied twice.
--
--    tenant_id is nullable BY DESIGN (platform-scope keys, e.g. the provisioning
--    key written by org.provision_organization). `tenant_id = current_tenant_id()`
--    evaluates to NULL for those rows, so they stay invisible and unwritable to
--    every tenant session — which is the required behaviour, not a limitation:
--    the request path is always tenant-scoped, and platform provisioning keeps
--    using a platform connection.
--
--    Deliberately absent: UPDATE and DELETE. A stored response is immutable, and
--    expiry is an administrative sweep, not a request-path capability.
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT ON shared.idempotency_keys TO app_runtime;

CREATE POLICY ins_idempotency_keys_tenant ON shared.idempotency_keys
  FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY sel_idempotency_keys_tenant ON shared.idempotency_keys
  FOR SELECT TO app_runtime
  USING (tenant_id = iam.current_tenant_id());

COMMENT ON POLICY ins_idempotency_keys_tenant ON shared.idempotency_keys IS
  'Idempotency reservation (FR-INT-002) for the resolved tenant only, written inside the guarded command''s transaction so a key is durable if and only if the command committed. Platform-scope rows (tenant_id NULL) remain out of reach: the predicate is NULL for them.';
COMMENT ON POLICY sel_idempotency_keys_tenant ON shared.idempotency_keys IS
  'Replay lookup for the resolved tenant only. uq_idempotency_keys_scope is keyed on tenant_id, so a conflict can only ever be raised by the caller''s own tenant and cannot reveal another tenant''s key.';

-- ----------------------------------------------------------------------------
-- 7. iam.security_events — insertion only, never amendment.
--
--    No new SELECT policy: reading the security log still requires
--    iam.audit.view through sel_security_events_permitted. The runtime may
--    record a denial; it may not browse, amend, or remove one.
-- ----------------------------------------------------------------------------
GRANT INSERT ON iam.security_events TO app_runtime;

CREATE POLICY ins_security_events_runtime ON iam.security_events
  FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id());

COMMENT ON POLICY ins_security_events_runtime ON iam.security_events IS
  'Authorization denials and rate-limit breaches are recorded for the resolved tenant only. INSERT only — no UPDATE, no DELETE — and no new read path: sel_security_events_permitted still gates reading behind iam.audit.view. Platform-scope (NULL tenant) events remain a platform capability.';

-- ----------------------------------------------------------------------------
-- 8. Deliberately absent, and the exact rollback.
--
--    NOT granted anywhere above: BYPASSRLS; ownership of any object; UPDATE,
--    DELETE, TRUNCATE, REFERENCES or TRIGGER on any table; any privilege for
--    app_readonly; EXECUTE on iam.audit_verify_chain, org.provision_organization,
--    shared.claim_outbox_events, shared.complete_outbox_event, or
--    shared.fail_outbox_event; any access to shared.processed_events or
--    shared.error_records (both remain worker-only).
--
--    Rollback (ROLLBACK-SAFE — no data is created or destroyed by this file):
--
--      DROP POLICY ins_security_events_runtime        ON iam.security_events;
--      DROP POLICY sel_idempotency_keys_tenant        ON shared.idempotency_keys;
--      DROP POLICY ins_idempotency_keys_tenant        ON shared.idempotency_keys;
--      DROP POLICY sel_event_outbox_producer          ON shared.event_outbox;
--      DROP POLICY ins_event_outbox_producer          ON shared.event_outbox;
--      DROP POLICY sel_audit_integrity_links_chain    ON iam.audit_integrity_links;
--      DROP POLICY sel_audit_record_details_unlinked  ON iam.audit_record_details;
--      DROP POLICY sel_audit_records_unlinked         ON iam.audit_records;
--      DROP POLICY ins_audit_integrity_links_writer   ON iam.audit_integrity_links;
--      DROP POLICY ins_audit_record_details_writer    ON iam.audit_record_details;
--      DROP POLICY ins_audit_records_writer           ON iam.audit_records;
--      REVOKE INSERT ON iam.security_events, iam.audit_records,
--             iam.audit_record_details, iam.audit_integrity_links FROM app_runtime;
--      REVOKE SELECT, INSERT ON shared.event_outbox, shared.idempotency_keys
--             FROM app_runtime;
--      REVOKE EXECUTE ON FUNCTION
--        iam.audit_append(uuid, uuid, text, text, text, uuid, uuid, uuid, uuid, text, jsonb),
--        iam.audit_mask(text, text), iam.audit_canonical(uuid),
--        iam.audit_hash(bytea, text) FROM app_runtime;
--      -- and restore the section-1 and section-3 function bodies from migration
--      -- 20260718095000. Restoring iam.audit_hash is optional: the two
--      -- implementations produce identical hashes, so the chain verifies either
--      -- way, and no USAGE grant was added that would need withdrawing.
--
--    Rows written while the grants were in place stay valid, readable, and
--    chain-verifiable after a rollback; only the ability to write more is
--    removed.
-- ----------------------------------------------------------------------------
