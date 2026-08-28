-- ============================================================================
-- PRE-P1-29 — shared.template_version_approvals, the immutable approval witness.
--
-- Rollback classification: DESTRUCTIVE-AFTER-FIRST-WRITE. Everything here is
-- droppable and lossless until the first witness exists. Afterwards the witness
-- rows themselves are the only durable record that a version was approved at a
-- point in time — `template_versions.status` is mutable and retirement erases the
-- evidence — so dropping the table destroys history nothing else holds.
--
-- ## The problem, measured rather than argued
--
-- `shared.outbound_messages` carries a BEFORE INSERT trigger,
-- `shared.guard_outbound_message_scope()`, which is SECURITY INVOKER and reads
-- `shared.template_versions` whenever `template_version_id IS NOT NULL`. It draws
-- THREE conclusions from that one read: the version exists, it belongs to this
-- tenant or to the platform, and its status is `approved`.
--
-- `app_worker` holds no privilege on that table, deliberately, so a worker could
-- not write a row naming a template version at all:
--
--   INSERT … template_version_id => permission denied for table template_versions
--   has_table_privilege('app_worker','shared.template_versions','SELECT') => false
--
-- A composite foreign key alone does not fix it. Referential-integrity checks do
-- run with the CONSTRAINT's rights rather than the caller's — which is why the
-- same role gets `violates foreign key constraint fk_outbound_messages_tenant`
-- rather than a permission error on a bad tenant — so existence and tenancy CAN
-- be made declarative. `status` cannot: it is MUTABLE. A partial unique index
-- cannot be a foreign-key target, and folding the status into the referenced key
-- would make the FK refuse the UPDATE that retires any version a message was ever
-- sent from.
--
-- ## Why an immutable witness is the right shape, not a workaround
--
-- The worker's question is not "is this version approved NOW". It is "was this
-- version validly approved for the carried scope WHEN IT WAS SELECTED". Those are
-- different questions, and only the second one is answerable at consumption time
-- without coupling a historical event to a future catalogue edit.
--
-- A template version approved when `job.assigned` v2 was published may be retired
-- before the event is consumed. That must not retroactively invalidate an event
-- already emitted, and it must not make asynchronous delivery depend on mutable
-- state the publisher no longer controls. So the durable fact is recorded at
-- approval time and referenced thereafter.
--
-- ## What was searched before adding anything
--
-- Three existing candidates were inspected and each is disqualified as a WITNESS,
-- though all three remain correct for their own purposes:
--
--   shared.status_history  append-only, UNIQUE (tenant_id, id) — but entity_type/
--                          entity_id are POLYMORPHIC with no foreign key, so the
--                          database cannot prove a row corresponds to a template
--                          version; tenant_id is NOT NULL, so a platform version
--                          cannot be recorded; and the template approval path does
--                          not write to it at all.
--   iam.audit_records      append-only by privilege (app_runtime holds INSERT and
--                          SELECT, nobody holds UPDATE or DELETE) — but entity_id
--                          is nullable and polymorphic with no foreign key, and
--                          tenant_id is likewise NOT NULL.
--   template_versions.status  mutable by construction; it is the thing the witness
--                          exists to snapshot.
--
-- No second approval ledger is created: this table records ONE fact the platform
-- did not durably record anywhere.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. A NOT NULL scope key on template_versions, so a witness can bind to it
-- ----------------------------------------------------------------------------
--
-- `template_versions.tenant_id` is NULLABLE, and that is meaningful: NULL is how a
-- PLATFORM-scoped version is represented. A composite foreign key is checked under
-- MATCH SIMPLE, and equality with NULL never matches, so a key built directly on
-- `tenant_id` would silently make every platform version unreferenceable —
-- a capability narrowing disguised as an integrity fix.
--
-- The two scopes are therefore folded into one NOT NULL key. The repository has no
-- existing sentinel convention — every scope-bearing `shared` table uses a nullable
-- tenant_id — so this introduces one, and the application half is spelled
-- identically in `PLATFORM_TEMPLATE_OWNER`.

ALTER TABLE shared.template_versions
  ADD COLUMN owner_tenant_id uuid
    GENERATED ALWAYS AS (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid))
    STORED;

COMMENT ON COLUMN shared.template_versions.owner_tenant_id IS
  'Tenant-qualified identity for referential integrity: tenant_id for a tenant version, the all-zero sentinel for a platform version. GENERATED, so it cannot drift from tenant_id and cannot be written directly.';

CREATE UNIQUE INDEX uq_template_versions_owner_version
  ON shared.template_versions (owner_tenant_id, id);

COMMENT ON INDEX shared.uq_template_versions_owner_version IS
  'Foreign-key target only. Redundant as a uniqueness claim — id is already the primary key — and that is the point: it exists so (owner_tenant_id, id) can be referenced.';

-- ----------------------------------------------------------------------------
-- 2. The witness
-- ----------------------------------------------------------------------------

CREATE TABLE shared.template_version_approvals (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid        NULL,
  owner_tenant_id     uuid        NOT NULL,
  template_version_id uuid        NOT NULL,
  approved_at         timestamptz NOT NULL DEFAULT now(),
  approved_by         uuid        NOT NULL,

  CONSTRAINT pk_template_version_approvals PRIMARY KEY (id),

  -- ONE canonical witness per version. Approval is a single transition in the
  -- shipped lifecycle (draft -> approved, guarded), so a second witness for the
  -- same version would mean the lifecycle had been re-entered, which it cannot be.
  CONSTRAINT uq_template_version_approvals_version UNIQUE (template_version_id),

  -- The FK target a referencing row uses to prove, declaratively, that a witness
  -- belongs to the version it names AND to the scope it claims. Redundant as
  -- uniqueness — id alone is unique — and present solely to be referenced.
  CONSTRAINT uq_template_version_approvals_binding
    UNIQUE (id, template_version_id, owner_tenant_id),

  -- Binds the witness's scope claim to the version's real scope. Without this a
  -- witness could name a tenant version while claiming platform ownership, and
  -- every downstream proof would inherit the lie.
  CONSTRAINT fk_template_version_approvals_version
    FOREIGN KEY (owner_tenant_id, template_version_id)
    REFERENCES shared.template_versions (owner_tenant_id, id) ON DELETE RESTRICT,

  CONSTRAINT fk_template_version_approvals_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,

  -- tenant_id and owner_tenant_id are two views of one fact and may not disagree.
  CONSTRAINT ck_template_version_approvals_scope
    CHECK (owner_tenant_id = COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid))
);

COMMENT ON TABLE shared.template_version_approvals IS
  'PRE-P1-29 immutable approval witness: this concrete template version entered an approved state under this owning scope, at this time. Append-only — SELECT+INSERT only, no UPDATE or DELETE grant to any role. Exists so an asynchronous consumer can prove approval-at-selection-time without reading template tables, and so later retirement cannot retroactively invalidate an already-emitted event.';

COMMENT ON COLUMN shared.template_version_approvals.owner_tenant_id IS
  'Folded scope: the owning tenant, or the all-zero sentinel for a platform version. NOT NULL so a composite foreign key stays ACTIVE for both scopes instead of being skipped under MATCH SIMPLE.';

-- One index per foreign key, and no index that merely restates a constraint.
-- `template_version_id` alone is NOT indexed here: uq_template_version_approvals_version
-- already is exactly that index, and a second one would be an exact duplicate —
-- which the module-schema index audit refuses, correctly.
CREATE INDEX ix_template_version_approvals_owner_version
  ON shared.template_version_approvals (owner_tenant_id, template_version_id);
CREATE INDEX ix_template_version_approvals_tenant
  ON shared.template_version_approvals (tenant_id);

ALTER TABLE shared.template_version_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.template_version_approvals FORCE  ROW LEVEL SECURITY;

-- Readable on the same terms as the versions themselves: a tenant sees its own
-- and the platform's. Mirrors `findTemplateByCode`'s `scope = 'platform' OR
-- tenant_id = …` rather than inventing a second visibility rule.
CREATE POLICY sel_template_version_approvals_scope
  ON shared.template_version_approvals FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id IS NULL OR tenant_id = iam.current_tenant_id());

-- Written only by the authoritative lifecycle path, and only for the writer's own
-- tenant. A platform witness (tenant_id NULL) is therefore NOT creatable through
-- the request path at all — matching `approveVersion`, whose own
-- `WHERE tenant_id = $1` already makes a platform version unapprovable by the API.
-- Platform witnesses are seeded alongside the platform content they describe.
CREATE POLICY ins_template_version_approvals_scope
  ON shared.template_version_approvals FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND approved_by = iam.current_user_id()
    AND iam.has_permission('org.settings.manage')
  );

-- No UPDATE policy and no DELETE policy, because there is no grant for either and
-- a policy for an ungranted verb would suggest one exists. Immutability here is a
-- PRIVILEGE property, not a convention: `app_worker` is granted nothing at all,
-- so it can neither read a witness nor manufacture one.
GRANT SELECT, INSERT ON shared.template_version_approvals TO app_runtime;
GRANT SELECT ON shared.template_version_approvals TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. Backfill: every version already approved gets its witness
-- ----------------------------------------------------------------------------
--
-- Deterministic, and it invents nothing. `approved_by` is the version's own
-- recorded approver where the lifecycle captured one, and falls back to its
-- creator where it did not — both are real actors already on the row. No template
-- is fabricated and no lifecycle state is mutated. Current environments hold zero
-- authored templates, but a database that already contains valid approved versions
-- must come out of this migration correct, not merely unbroken.

INSERT INTO shared.template_version_approvals
  (tenant_id, owner_tenant_id, template_version_id, approved_at, approved_by)
SELECT v.tenant_id,
       v.owner_tenant_id,
       v.id,
       COALESCE(v.approved_at, v.created_at),
       COALESCE(v.approved_by, v.created_by)
  FROM shared.template_versions AS v
 WHERE v.status = 'approved'
ON CONFLICT (template_version_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. The referencing side, WITHOUT disturbing any existing writer
-- ----------------------------------------------------------------------------
--
-- Both columns are NULLABLE and neither is required by a table-wide CHECK. That
-- is deliberate and it is the difference between this migration and a rejected
-- earlier attempt: making the pairing globally mandatory broke every existing
-- request-path writer at once. The requirement belongs to the WORKER, so it is
-- carried by the worker's RESTRICTIVE policy instead.

ALTER TABLE shared.outbound_messages
  ADD COLUMN approval_witness_id     uuid NULL,
  ADD COLUMN template_owner_tenant_id uuid NULL;

COMMENT ON COLUMN shared.outbound_messages.approval_witness_id IS
  'The immutable proof that the referenced template version was approved when it was selected. Set by the worker path, whose RESTRICTIVE policy requires it; left NULL by the request path, which proves the same thing synchronously through the trigger.';

-- Proves witness -> version -> scope in ONE constraint. Under MATCH SIMPLE this is
-- checked only when all three columns are non-NULL, which is exactly the worker
-- path; the request path leaves them NULL and is unaffected.
ALTER TABLE shared.outbound_messages
  ADD CONSTRAINT fk_outbound_messages_approval_witness
  FOREIGN KEY (approval_witness_id, template_version_id, template_owner_tenant_id)
  REFERENCES shared.template_version_approvals (id, template_version_id, owner_tenant_id)
  ON DELETE RESTRICT;

-- The half a foreign key cannot state: a message may claim only its OWN tenant's
-- ownership, or the platform's. Without it a caller could truthfully name another
-- tenant's witness and the key would agree.
ALTER TABLE shared.outbound_messages
  ADD CONSTRAINT ck_outbound_messages_template_owner_scope
  CHECK (
    template_owner_tenant_id IS NULL
    OR template_owner_tenant_id = tenant_id
    OR template_owner_tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
  );

-- Covers fk_outbound_messages_approval_witness by its leading columns. Zero
-- unindexed foreign keys is a MEASURED property of these schemas, not an aim.
CREATE INDEX ix_outbound_messages_approval_witness
  ON shared.outbound_messages (approval_witness_id, template_version_id, template_owner_tenant_id);

GRANT INSERT (approval_witness_id, template_owner_tenant_id)
  ON shared.outbound_messages TO app_runtime;
GRANT INSERT (approval_witness_id, template_owner_tenant_id)
  ON shared.outbound_messages TO app_worker;

-- ----------------------------------------------------------------------------
-- 5. The worker policy now demands the proof it is able to supply
-- ----------------------------------------------------------------------------
--
-- RESTRICTIVE, so it ANDs. The worker may still enqueue only a pending, tenant-
-- and author-bearing, deduplicable message — and now, additionally, it may not
-- name a template version without the witness that proves it was approved, and may
-- not omit the version either. `template_version_id = NULL` is no longer an escape
-- hatch for this role.

DROP POLICY wkr_outbound_messages_enqueue_scope ON shared.outbound_messages;

CREATE POLICY wkr_outbound_messages_enqueue_scope
  ON shared.outbound_messages
  AS RESTRICTIVE
  FOR INSERT
  TO app_worker
  WITH CHECK (
    status = 'pending'
    AND tenant_id IS NOT NULL
    AND created_by IS NOT NULL
    AND dedupe_key IS NOT NULL
    AND template_version_id IS NOT NULL
    AND approval_witness_id IS NOT NULL
    AND template_owner_tenant_id IS NOT NULL
  );

COMMENT ON POLICY wkr_outbound_messages_enqueue_scope ON shared.outbound_messages IS
  'RESTRICTIVE so it ANDs with wkr_outbound_messages_dispatch rather than ORing with it. The worker may enqueue only a pending, tenant- and author-bearing, deduplicable message that names a real template version AND the immutable witness proving that version was approved. Requiring the witness HERE rather than table-wide is what leaves every request-path writer untouched.';

-- ----------------------------------------------------------------------------
-- 6. The guard keeps its current-state defence for the path that can afford it
-- ----------------------------------------------------------------------------
--
-- The request path is unchanged: no witness, so the full lookup runs and the
-- CURRENT status is still enforced. That defence is deliberately NOT weakened to
-- make the two paths symmetrical.
--
-- The worker path presents a witness, and then the lookup is skipped — not because
-- the worker is trusted, but because the same three conclusions are already proved
-- by constraints that ran before this trigger's transaction can commit:
--
--   exists     fk_outbound_messages_approval_witness -> a real witness row
--   scope      the same key's third column, plus ck_…_template_owner_scope
--   approved   the witness EXISTS, and it is only created on the approved
--              transition and can never be updated or deleted
--
-- The branch is on a COLUMN whose integrity those constraints establish, not on a
-- role and not on an application assumption. And per the event-snapshot rule it
-- must NOT re-read current status: a version retired after publication is still a
-- version that was validly approved when it was selected.

CREATE OR REPLACE FUNCTION shared.guard_outbound_message_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_template_tenant uuid;
  v_template_status text;
BEGIN
  IF NEW.template_version_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Snapshot semantics. The witness is immutable and is created only by the
  -- approved transition, so its existence IS the proof, and re-reading the
  -- version's mutable status here would make asynchronous delivery depend on a
  -- catalogue edit that happened after the event was emitted.
  IF NEW.approval_witness_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT tenant_id, status
    INTO v_template_tenant, v_template_status
  FROM shared.template_versions
  WHERE id = NEW.template_version_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'template version % does not exist', NEW.template_version_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_template_tenant IS NOT NULL AND v_template_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'template version % is not compatible with tenant %',
      NEW.template_version_id, NEW.tenant_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_template_status <> 'approved' THEN
    RAISE EXCEPTION 'template version % is not approved', NEW.template_version_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION shared.guard_outbound_message_scope() IS
  'BEFORE INSERT guard for shared.outbound_messages. A row WITHOUT an approval witness is validated synchronously against the live template version — existence, tenant compatibility, and CURRENT approved status — which is the request path and keeps its stronger defence. A row WITH a witness is admitted without any template read: the witness foreign key already proves the version, the scope and the approval, and re-reading mutable status would break asynchronous event-snapshot semantics.';

REVOKE EXECUTE ON FUNCTION shared.guard_outbound_message_scope() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- Rollback
-- ----------------------------------------------------------------------------
-- Restore the previous guard body (no witness branch), then:
-- DROP POLICY wkr_outbound_messages_enqueue_scope ON shared.outbound_messages;
--   (recreate without the three template predicates)
-- REVOKE INSERT (approval_witness_id, template_owner_tenant_id) ON shared.outbound_messages FROM app_worker, app_runtime;
-- ALTER TABLE shared.outbound_messages DROP CONSTRAINT ck_outbound_messages_template_owner_scope;
-- ALTER TABLE shared.outbound_messages DROP CONSTRAINT fk_outbound_messages_approval_witness;
-- ALTER TABLE shared.outbound_messages DROP COLUMN template_owner_tenant_id, DROP COLUMN approval_witness_id;
-- DROP TABLE shared.template_version_approvals;
-- DROP INDEX shared.uq_template_versions_owner_version;
-- ALTER TABLE shared.template_versions DROP COLUMN owner_tenant_id;
