-- ============================================================================
-- Phase: 1-32 — Owner directive: friendly search
-- Migration: shared digit/text folding and the normalizers that now use it
-- Tasks: P1-32-PRE-050
-- Owner module: shared
--
-- Rollback classification: DESTRUCTIVE-AFTER-FIRST-WRITE. Restoring the previous
--   function bodies is mechanical, but the recomputed normalized values cannot be
--   restored: the pre-folding value of a row that contained Arabic-Indic digits
--   is not recoverable from the row. Forward-only, per the migration standard.
--
-- Purpose
--   A person who types a phone number, a plate or a name on an Arabic keyboard
--   produces Arabic-Indic digits (U+0660-U+0669) or Eastern Arabic-Indic digits
--   (U+06F0-U+06F9). Every normalizer in this repository kept only ASCII
--   [0-9] or [A-Z0-9], so those digits were DELETED rather than folded: a phone
--   number typed in Arabic normalized to NULL, and a plate typed in Arabic lost
--   its numeric part entirely. Two people entering the same number in two
--   keyboards produced two different lookup keys.
--
--   This migration introduces one folding authority in the shared schema and
--   routes the four existing normalizers through it:
--
--     shared.fold_digits(text)      — Arabic-Indic and Eastern Arabic-Indic
--                                     digits become their ASCII counterparts.
--                                     Nothing else is touched.
--     shared.fold_search_text(text) — the NAME rule: tatweel and the tashkeel
--                                     range are removed, the three alef forms
--                                     collapse to bare alef, digits fold,
--                                     case folds, whitespace collapses.
--
--   The split is deliberate and is the whole safety argument. Letter folding is
--   applied ONLY to names (crm.normalize_name), where two spellings of one name
--   are the same name. It is NEVER applied to a VIN or a plate: those are
--   identifiers, where collapsing two characters into one would merge two
--   different vehicles. VIN and plate receive digit folding only.
--
-- Recomputation
--   veh.vehicles.vin_normalized and veh.plate_history.plate_normalized are
--   STORED generated columns computed from the two veh functions. PostgreSQL
--   does not recompute a stored generated column when the function behind it is
--   replaced, so the values are recomputed here with ALTER TABLE ... ALTER
--   COLUMN ... SET EXPRESSION (PostgreSQL 17), which rewrites the table with the
--   identical expression and therefore leaves the schema definition unchanged
--   while refreshing every stored value.
--
--   crm.contact_points.normalized_value is an ORDINARY column written by the
--   application, so it is recomputed with an UPDATE. The row's BEFORE UPDATE
--   metadata trigger fires, which advances record_version and sets updated_at:
--   that is correct and is stated rather than suppressed — the stored value
--   really did change. Rows whose recomputed value is unchanged are excluded by
--   the predicate, so an unaffected row is not touched at all. Only phone-like
--   channels are recomputed; an email address has no digits to fold that matter
--   and crm.normalize_email is unchanged.
--
-- Dependencies
--   shared, crm and veh schemas; the app_runtime / app_readonly roles.
--
-- Security implications
--   * Every function is IMMUTABLE, SECURITY INVOKER, search_path = '', reads no
--     table and never raises with an input value, so none can leak data through
--     an exception channel and all stay legal in generated columns and indexes.
--   * EXECUTE on the two new functions is revoked from PUBLIC and granted only to
--     app_runtime and app_readonly, matching the normalizers that call them.
--   * No policy, grant or RLS setting is changed. The search surface widens in
--     the application layer, never at the row.
--
-- Objects created
--   Functions: shared.fold_digits(text), shared.fold_search_text(text)
--   Functions replaced: crm.normalize_name(text), crm.normalize_phone(text),
--                       veh.normalize_vin(text), veh.normalize_plate(text)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- shared.fold_digits — the digit authority
--
-- translate() is a fixed 1:1 character map: it cannot reorder, drop or duplicate
-- anything, so folding is provably length-preserving and touches no character
-- outside the twenty listed. STRICT so NULL stays NULL rather than becoming ''.
-- The code points are written as escapes rather than as literal glyphs so the
-- source file carries no character that a reviewer cannot see.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.fold_digits(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT translate(
    p_value,
    E'\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9',
    '01234567890123456789'
  );
$$;

COMMENT ON FUNCTION shared.fold_digits(text) IS
  'P1-32 digit folding: Arabic-Indic (U+0660-U+0669) and Eastern Arabic-Indic (U+06F0-U+06F9) digits become ASCII 0-9. Nothing else changes; length is preserved. IMMUTABLE, STRICT.';

-- ---------------------------------------------------------------------------
-- shared.fold_search_text — the NAME rule
--
-- Order matters and is fixed here so both sides of every comparison see the same
-- pipeline:
--   1. remove tatweel (U+0640) and the tashkeel range (U+064B-U+0652). These are
--      presentation marks; a name is the same name with or without them.
--   2. collapse the three alef forms (U+0623, U+0625, U+0622) onto bare alef
--      (U+0627). These are the same letter written with a hamza seat, and they
--      are the single most common spelling difference in a customer name.
--   3. fold digits, so a name containing a number matches either keyboard.
--   4. lower(), which is Unicode-aware and a no-op for Arabic.
--   5. collapse internal whitespace runs and trim; blank becomes NULL.
--
-- Taa marbuta (U+0629) is deliberately NOT collapsed onto haa (U+0647): the two
-- are distinct letters and collapsing them merges words that are not the same.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.fold_search_text(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT nullif(
    btrim(
      regexp_replace(
        lower(
          translate(
            shared.fold_digits(
              regexp_replace(coalesce(p_value, ''), E'[\u0640\u064B-\u0652]', '', 'g')
            ),
            E'\u0623\u0625\u0622',
            E'\u0627\u0627\u0627'
          )
        ),
        '\s+', ' ', 'g'
      )
    ),
    '');
$$;

COMMENT ON FUNCTION shared.fold_search_text(text) IS
  'P1-32 name folding: strips tatweel and tashkeel, collapses the three alef forms onto bare alef, folds digits, lowercases, collapses whitespace; NULL on blank. For NAMES only — never for a VIN or a plate. IMMUTABLE.';

REVOKE EXECUTE ON FUNCTION shared.fold_digits(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION shared.fold_search_text(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION shared.fold_digits(text) TO app_runtime, app_readonly;
GRANT EXECUTE ON FUNCTION shared.fold_search_text(text) TO app_runtime, app_readonly;

-- ---------------------------------------------------------------------------
-- crm.normalize_name — now one line over the shared name rule.
--
-- The body is replaced rather than the signature: every call site, every
-- comparison and every grant stays exactly where it was. Case folding and
-- whitespace collapsing are unchanged; what is added is tashkeel, tatweel, alef
-- and digit folding.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm.normalize_name(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT shared.fold_search_text(p);
$$;

COMMENT ON FUNCTION crm.normalize_name(text) IS
  'Partner name normalization. Since P1-32 this delegates to shared.fold_search_text: case fold, whitespace collapse, tashkeel/tatweel removal, alef collapse, digit fold. NULL on blank. IMMUTABLE.';

-- ---------------------------------------------------------------------------
-- crm.normalize_phone — digits fold BEFORE the non-digit strip.
--
-- That ordering is the entire fix: the previous body stripped [^0-9] first, so
-- an Arabic-Indic digit was removed as if it were punctuation and a wholly
-- Arabic-Indic number normalized to NULL. The leading-'+' rule is unchanged, and
-- it still reads the TRIMMED input while the digits are taken from the untrimmed
-- input, because that is what the stored values were built from.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm.normalize_phone(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT nullif(
    (CASE WHEN btrim(coalesce(p, '')) LIKE '+%' THEN '+' ELSE '' END)
      || regexp_replace(shared.fold_digits(coalesce(p, '')), '[^0-9]', '', 'g'),
    '');
$$;

COMMENT ON FUNCTION crm.normalize_phone(text) IS
  'Phone normalization to digits with an optional single leading +. Since P1-32 Arabic-Indic and Eastern Arabic-Indic digits are FOLDED to ASCII before the non-digit strip, so a number typed on an Arabic keyboard yields the same key as the same number typed in ASCII. No country code is inferred (OIR-04). IMMUTABLE.';

-- ---------------------------------------------------------------------------
-- veh.normalize_vin — digit fold only. Letters are untouched.
--
-- A VIN is Latin by ISO 3779, so [A-Z0-9] still removes only separators. What
-- changes is that a digit typed on an Arabic keyboard is now folded into the VIN
-- instead of being silently dropped, which previously turned one VIN into a
-- shorter, different one. I/O/Q are still preserved; no letter is repaired.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION veh.normalize_vin(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT NULLIF(
    regexp_replace(upper(btrim(shared.fold_digits(COALESCE(p_value, '')))), '[^A-Z0-9]', '', 'g'),
    ''
  );
$$;

COMMENT ON FUNCTION veh.normalize_vin(text) IS
  'VIN normalization (BR-VEH-001): fold Arabic-Indic digits (P1-32), uppercase, strip non-[A-Z0-9] separators; preserves I/O/Q (no silent correction); NULL on blank. IMMUTABLE, used in vehicles.vin_normalized.';

-- ---------------------------------------------------------------------------
-- veh.normalize_plate — digit fold only. Non-Latin letters still survive.
--
-- A plate carrying Arabic-Indic digits now matches the same plate written in
-- ASCII digits, which is the case the Owner directive names. Letter folding is
-- NOT applied: a plate is an identifier, and two plates differing by one letter
-- are two plates.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION veh.normalize_plate(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT NULLIF(
    upper(regexp_replace(btrim(shared.fold_digits(COALESCE(p_value, ''))), '[[:space:]._\-]', '', 'g')),
    ''
  );
$$;

COMMENT ON FUNCTION veh.normalize_plate(text) IS
  'Plate normalization: fold Arabic-Indic digits (P1-32), uppercase, strip whitespace/._- separators; preserves other (incl. non-Latin) characters; NULL on blank. IMMUTABLE.';

-- ---------------------------------------------------------------------------
-- Recompute the stored values that were derived from the old bodies.
--
-- SET EXPRESSION restates the SAME expression, so the column definition and the
-- schema inventory are unchanged; what it does is rewrite the heap, which is the
-- only way to refresh a stored generated column in PostgreSQL 17. Both tables'
-- indexes and exclusion constraints are rebuilt by the rewrite, so the
-- cross-vehicle active-plate uniqueness is re-proved against the folded values
-- rather than assumed.
-- ---------------------------------------------------------------------------
ALTER TABLE veh.vehicles
  ALTER COLUMN vin_normalized SET EXPRESSION AS (veh.normalize_vin(vin_raw));

ALTER TABLE veh.plate_history
  ALTER COLUMN plate_normalized SET EXPRESSION AS (veh.normalize_plate(plate_raw));

-- The ordinary column. Restricted to rows whose value actually changes, so an
-- unaffected row keeps its record_version.
UPDATE crm.contact_points
   SET normalized_value = crm.normalize_phone(raw_value)
 WHERE channel IN ('phone', 'mobile')
   AND raw_value IS NOT NULL
   AND crm.normalize_phone(raw_value) IS NOT NULL
   AND crm.normalize_phone(raw_value) IS DISTINCT FROM normalized_value;
