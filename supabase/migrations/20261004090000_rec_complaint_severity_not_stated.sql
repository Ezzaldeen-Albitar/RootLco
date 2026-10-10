-- ============================================================================
-- P1-32-PRE-OD-RWS — a concern recorded without a severity is stored as
-- "not stated", never as 'medium'.
-- Owner module: rec (one CHECK constraint and one column default)
--
-- Rollback classification: ROLLBACK-SAFE while no row holds 'not_stated';
--   roll-forward-only once one does, because the earlier constraint cannot
--   hold such a row and no rule can say which severity the customer would
--   have given. Forward-only — the inverse at the foot of this file is for a
--   rehearsal copy only.
--
-- Purpose
--   The customer's stated severity of a reception concern (rec.complaints) is
--   optional on the write. Until now an omitted severity was stored as
--   'medium': the service substituted it, and the column default
--   (20260721099000_rec_complaints.sql) did the same for any other writer.
--   'medium' is a value the customer did not give. The Owner answered the
--   question on 2026-10-03: a concern recorded with no severity is stored as
--   "not stated".
--
--   This migration adds 'not_stated' to ck_complaints_severity and makes it
--   the column default. The column stays NOT NULL, so every consumer reads an
--   explicit value from one vocabulary: a filter or a count of "not stated"
--   is `severity = 'not_stated'`, never a NULL test beside the other values.
--   A stated severity is stored exactly as given; the four stated values are
--   unchanged.
--
-- Existing rows are NOT rewritten
--   No UPDATE is issued. A row stored before this migration as 'medium' may
--   have been stated by the customer or substituted for an omission; the two
--   cannot be told apart from the row, so neither is guessed. Every existing
--   value is one of the four the earlier constraint allowed, all of which the
--   new constraint still allows, so adding it re-checks the rows and changes
--   none of them.
--
-- Security implications
--   None. No grant, policy, trigger or function changes; RLS on rec.complaints
--   stays enabled and forced with the same three policies.
-- ============================================================================

ALTER TABLE rec.complaints DROP CONSTRAINT ck_complaints_severity;

ALTER TABLE rec.complaints
  ADD CONSTRAINT ck_complaints_severity
  CHECK (severity IN ('not_stated', 'low', 'medium', 'high', 'critical'));

ALTER TABLE rec.complaints ALTER COLUMN severity SET DEFAULT 'not_stated';

COMMENT ON COLUMN rec.complaints.severity IS
  'How serious the customer said the concern was: low, medium, high or critical as stated, or not_stated when the customer gave none (the default). Rows recorded before 20261004090000 hold medium where the severity was omitted, indistinguishable from a stated medium; they are not rewritten.';

-- ----------------------------------------------------------------------------
-- Exact inverse (rehearsal copy only — refused once a 'not_stated' row exists)
--
--   COMMENT ON COLUMN rec.complaints.severity IS NULL;
--   ALTER TABLE rec.complaints ALTER COLUMN severity SET DEFAULT 'medium';
--   ALTER TABLE rec.complaints DROP CONSTRAINT ck_complaints_severity;
--   ALTER TABLE rec.complaints
--     ADD CONSTRAINT ck_complaints_severity
--     CHECK (severity IN ('low', 'medium', 'high', 'critical'));
-- ----------------------------------------------------------------------------
