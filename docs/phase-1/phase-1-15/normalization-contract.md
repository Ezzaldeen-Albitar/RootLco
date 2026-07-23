# Phase 1-15 — Normalization Contract (VIN, phone, email, search)

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Release group:** Release 3 — Backend Foundation ·
**Phase:** P1-15 — Shared Services Backend ·
**Date:** 2026-07-23 ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit. The Phase 1-15 owner gate is
[Pending](phase-1-15-owner-gate.md).**

**Implementation:**
[`src/modules/shared-services/domain/normalization.ts`](../../../src/modules/shared-services/domain/normalization.ts) ·
**Differential evidence:**
[`tests/db/p1-15-normalization-parity.test.ts`](../../../tests/db/p1-15-normalization-parity.test.ts) ·
**Related:** [VIN normalization contract (P1-7)](../phase-1-7/veh-vin-normalization-contract.md) ·
[Binding implementation decisions](phase-1-15-implementation-decisions.md)

---

## 1. What this record is for

Three of the four normalizers in this phase are **mirrors of frozen database functions**. They exist
so that a request can be validated and a lookup key can be built without a database round trip — and
that is only worth doing if the answer is identical to the one the database would have given. A
mirror that "improves" on the frozen function is worse than no mirror at all: it produces a key that
looks correct, finds nothing, and fails silently.

The consequence is a rule that reads backwards to most reviewers. Where the frozen SQL does
something surprising, **the surprise is the contract**. It is reproduced deliberately, recorded here
as behaviour rather than as a defect, and changed only through a database change request — never by
quietly tightening the TypeScript.

The second rule is that normalization **never repairs**. Judgement about a value is reported
alongside the normalized form and never applied to it. Silent repair is how a typo becomes a
different vehicle.

## 2. The frozen functions, read from the live database

Definitions below were read with `pg_get_functiondef()` against the local PostgreSQL 17.6 instance
backing this work, not copied from a migration file. All three are `LANGUAGE sql`, `IMMUTABLE`,
`SET search_path TO ''`, and **not** `SECURITY DEFINER`.

```sql
CREATE OR REPLACE FUNCTION veh.normalize_vin(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT NULLIF(
    regexp_replace(upper(btrim(COALESCE(p_value, ''))), '[^A-Z0-9]', '', 'g'),
    ''
  );
$function$
```

```sql
CREATE OR REPLACE FUNCTION crm.normalize_phone(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT nullif(
    (CASE WHEN btrim(coalesce(p, '')) LIKE '+%' THEN '+' ELSE '' END)
      || regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'),
    '');
$function$
```

```sql
CREATE OR REPLACE FUNCTION crm.normalize_email(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT nullif(btrim(lower(coalesce(p, ''))), '');
$function$
```

`IMMUTABLE` is not decoration here. The same probe confirmed that `veh.vehicles.vin_normalized` is a
**generated column** whose expression is `veh.normalize_vin(vin_raw)` — it is the only generated
column in the schema derived from any of these three functions. Stored rows and the lookup keys
built from them are therefore already committed to this behaviour, which is precisely why the mirror
has no licence to disagree.

## 3. VIN — the contract, including the parts that look wrong

`normalizeVin()` trims, upper-cases, strips every character outside `[A-Z0-9]`, and maps the empty
result to `null`. Observed against the live function:

| Input                  | Normalized          | Why it matters                                           |
| ---------------------- | ------------------- | -------------------------------------------------------- |
| `'  wp0zzz9 8s1k303 '` | `WP0ZZZ98S1K303`    | Interior whitespace is removed, not just edge whitespace |
| `'jh4-tb2h26cc000000'` | `JH4TB2H26CC000000` | Punctuation is removed anywhere in the value             |
| `'iooq1234567890abc'`  | `IOOQ1234567890ABC` | **`I`, `O` and `Q` are preserved**                       |
| `'   '`                | `NULL`              | Empty after stripping becomes `NULL`, never `''`         |

Three absences are as much a part of the contract as the rules:

- **No character rejection.** ISO 3779 excludes `I`, `O` and `Q` from a VIN because they are
  confusable with `1` and `0`. The frozen function does not enforce that, so neither does the mirror.
- **No length rule.** A 3-character value and a 40-character value both normalize successfully.
- **No check-digit validation.** None is computed and none is claimed.

Planning text for this phase asked for all three. They are **reported**, never applied — see §6.

## 4. Phone — a lone `+` survives, and Arabic-Indic digits do not

`normalizePhoneDigits()` reproduces the SQL exactly, including its asymmetry: the `+` test reads the
**trimmed** input while the digits are taken from the **untrimmed** input.

| Input                | Normalized       | Contract statement                                       |
| -------------------- | ---------------- | -------------------------------------------------------- |
| `'+962 7 9012 3456'` | `+962790123456`  | Separators removed; a single leading `+` is preserved    |
| `'+'`                | `'+'`            | **A lone plus survives — it is not `NULL`**              |
| `' + '`              | `'+'`            | Same, after trimming                                     |
| `'++'`               | `'+'`            | Only one `+` is ever emitted, and only in first position |
| `'00962790123456'`   | `00962790123456` | An IDD prefix is data, not a `+`; nothing converts it    |
| `'(079) 012-3456'`   | `0790123456`     | National format is preserved as digits, not expanded     |
| `'٠٧٩٠١٢٣٤٥٦'`       | `NULL`           | **Arabic-Indic digits normalize to `NULL`**              |
| `'٠٧٩ 0123'`         | `0123`           | Only the ASCII digits survive                            |

The last two rows are a **real limitation of the frozen contract**, recorded rather than fixed. The
regular expression class is `[^0-9]`, which matches ASCII only, so `٠`–`٩` are stripped as if they
were punctuation and a wholly Arabic-Indic number disappears. For a platform whose first market
writes Arabic, that is a limitation worth naming plainly: it is not a rendering nicety, it is a
number that cannot be stored under a lookup key at all. Changing it means changing an `IMMUTABLE`
function that a committed generated column depends on, which is a database change request with its
own migration, backfill, and evidence — not a TypeScript edit. Until that request exists, the mirror
reproduces the loss faithfully so that the application and the database agree about what happened.

## 5. Email — dots and `+tags` are preserved

`normalizeEmail()` is trim plus lowercase, and nothing else. `'  A.B+Tag@X.COM  '` becomes
`a.b+tag@x.com`, verified against the live function.

No P1-15 code strips dots and no P1-15 code strips a `+tag`. Both are provider-specific aliasing
conventions, not properties of an address: treating `a.b@x.com` and `ab@x.com` as one identity is
correct for exactly one mail provider and wrong for the general case, and collapsing two distinct
customers into one record is not a defect a later migration can undo.

## 6. Plausibility is reported, never applied

`normalizeVin()` and `normalizePhone()` return a `NormalizationResult`, which carries four fields:
the untouched `original` (what a caller persists as the display value), the `normalized` form, a
`plausible` boolean, and a list of stable machine-readable `reasons`. **`plausible: false` never
changes `normalized`.** It is advice for the caller, delivered next to the value rather than instead
of it.

| Kind  | Reason code                   | Raised when                                                              |
| ----- | ----------------------------- | ------------------------------------------------------------------------ |
| both  | `input-too-long`              | Input exceeds `MAX_NORMALIZATION_INPUT` (512). Rejected, never truncated |
| both  | `empty`                       | Normalization produced `null`                                            |
| VIN   | `length-not-17`               | Normalized length is not 17                                              |
| VIN   | `contains-i-o-q`              | Normalized value contains `I`, `O` or `Q`                                |
| phone | `contains-letters`            | Input contains any `[A-Za-z]`; refused before normalizing                |
| phone | `no-digits`                   | Normalization yielded the lone `'+'`                                     |
| phone | `e164-length-out-of-range`    | Leading `+` with fewer than 8 or more than 15 digits                     |
| phone | `ambiguous-without-region`    | National format with no `regionCallingCode` supplied                     |
| phone | `invalid-region-calling-code` | Supplied region code is not `+?[0-9]{1,4}`                               |
| phone | `too-few-digits`              | Region supplied, fewer than 4 digits normalized                          |

Two of these deserve their reasoning stated rather than assumed.

**The lone `'+'` is preserved and reported.** Returning `null` instead would be a nicer API and a
broken mirror. Preserving it keeps parity; reporting `no-digits` is what stops any caller storing it.

**No default country is assumed anywhere.** A national number arriving without a
`regionCallingCode` is reported `ambiguous-without-region` rather than being resolved against an
assumed dialling code. Guessing would merge two different people's numbers under one key, and the
country/jurisdiction decision is an open commercial one — recorded in
[the binding implementation decisions](phase-1-15-implementation-decisions.md) — not something a
normalizer may settle by defaulting. The region check is a **service-layer judgement layered on top
of** the frozen normalizer; it never alters the normalized value.

## 7. The boundary of the parity claim

[`tests/db/p1-15-normalization-parity.test.ts`](../../../tests/db/p1-15-normalization-parity.test.ts)
is differential rather than example-based: one shared 36-value corpus is pushed through
`veh.normalize_vin`, `crm.normalize_phone` and `crm.normalize_email` in the live database and through
the TypeScript mirrors, and every pair must match. The corpus deliberately carries the values a
well-meaning reimplementation gets wrong — a lone `'+'`, Arabic-Indic digits, `I`/`O`/`Q`, `+tag`
addresses, full-width characters, and Arabic text with and without harakat. Four behaviours are
additionally pinned individually, each asserted against the database in the same test body.

What that proves is parity **over that corpus**. It is worth stating precisely where the two
implementations are known to part company, because the honest claim is narrower than "character for
character":

PostgreSQL `btrim(text)` with no second argument removes only the ASCII space `U+0020`. JavaScript
`String.prototype.trim()` removes the whole Unicode whitespace set, plus `U+FEFF`. Every corpus value
whose edges are padded is padded with `U+0020`, so the difference is invisible to the suite. Probing
the live functions directly with other padding characters shows it:

| Leading/trailing pad     | `crm.normalize_phone('<pad>+962790123456<pad>')` | Mirror          | Agree? |
| ------------------------ | ------------------------------------------------ | --------------- | ------ |
| `U+0020` space           | `+962790123456`                                  | `+962790123456` | yes    |
| `U+0009` tab             | `962790123456`                                   | `+962790123456` | **no** |
| `U+000A` line feed       | `962790123456`                                   | `+962790123456` | **no** |
| `U+00A0` no-break space  | `962790123456`                                   | `+962790123456` | **no** |
| `U+FEFF` byte-order mark | `962790123456`                                   | `+962790123456` | **no** |

The same padding leaves the character in place for `crm.normalize_email` while the mirror removes it.
`veh.normalize_vin` is unaffected in every case, because its character class strips the padding
regardless of whether `btrim` reached it first.

So the accurate statement of the contract is: **the mirrors reproduce the frozen SQL exactly for
input padded with the ASCII space, which is what the differential corpus exercises; for a leading or
trailing whitespace character outside `U+0020` the mirror trims where the database does not.** This
is recorded here as a known boundary of the parity claim rather than asserted away. A caller that
needs the database's answer for arbitrary input should ask the database; a caller building a lookup
key from operator-typed input padded with ordinary spaces has the guarantee the suite proves.

## 8. Search normalization — the one genuinely new primitive

`normalizeSearchValue()` has no frozen SQL counterpart, so it is defined in this phase and applied on
**both** the indexing side and the querying side. A normalizer applied to only one of the two stops
matching silently, which is the failure mode this design exists to avoid.

The steps run in this order:

1. **NFKC** — canonical plus compatibility composition, so `ﬁ` and `fi`, and the Arabic presentation
   forms, converge on one representation.
2. **Strip combining marks** (`\p{M}`) — Arabic harakat and Latin accents are removed, so `مُحَمَّد`
   and `محمد` match. This step is deliberately lossy, which is exactly why the display value is kept
   separately by the caller.
3. **Remove control characters** — C0/C1 controls, zero-width characters, the bidirectional
   isolates and overrides, and `U+FEFF`. These are invisible, so without this step two values that
   render identically could compare unequal. The pattern is written with escapes rather than literal
   characters so the source file itself contains no invisible bytes.
4. **Lowercase, locale-neutral** — `toLowerCase()`, never `toLocaleLowerCase()`. The locale-aware
   form would make matching depend on the server's locale, so the same query could match on one host
   and not another.
5. **Collapse whitespace** — every run becomes a single space, and the result is trimmed. Empty
   becomes `null`.

Input longer than `MAX_SEARCH_VALUE` (2048) yields `null` rather than a truncated value. That bound
is not arbitrary: `shared.search_metadata` carries the check constraint

```sql
CHECK (((btrim(normalized_value) <> ''::text) AND (char_length(normalized_value) <= 2048)))
```

read from the live catalog as `ck_search_metadata_value`. Normalizing to something the table would
reject is a failure moved later, not avoided, so the primitive refuses at the same bound.

Every pattern in the function is a bounded character class over an already length-checked input.
There is no alternation and no nested quantifier, so no path here can backtrack catastrophically.

`searchTokens()` splits the normalized value on whitespace only. Punctuation stays **inside** a
token, so identifiers such as `wp0zzz98s1k303` or `inv-2026-000042` survive as one unit; a caller
that wants punctuation gone normalizes it away before calling.

### Honest limitation: no homoglyph or confusable detection

**Homoglyph detection is not implemented and is not claimed.** Cyrillic `а` (`U+0430`) and Latin `a`
(`U+0061`) remain different values after normalization, and mixed-script confusables are not
collapsed or flagged. NFKC folds compatibility variants; it does not fold visually similar
characters from different scripts, and nothing else in this phase attempts to.

Anyone reading "normalized for search" should read it as exactly the five steps above and nothing
more.

### Honest limitation: no search index is populated by this phase

The normalizer is a **primitive**, not a search feature. Grants read from the live catalog show that
`shared.search_metadata` is `SELECT` for `app_runtime` and `app_readonly`, `SELECT` and `DELETE` for
`app_worker`, and holds **no `INSERT` or `UPDATE` privilege for any application role** — only the
owner role has those. No application code in this phase can therefore write a row of search metadata,
and none tries to. What P1-15 delivers is a deterministic, bounded, agreed-upon way to produce the
value; populating and querying an index is separate work behind its own change request. This is one
of the deliberate withholdings recorded in
[DBCR-P1-15-001](../../database/change-requests/DBCR-P1-15-001-shared-services-runtime-write-capabilities.md).

## 9. What a caller is expected to do with this

- **Persist the original.** The normalized form is a key and a matching value; it is not a display
  value, and for search it is deliberately lossy.
- **Read `plausible` and act on it in the caller's own terms.** The normalizer will not refuse a
  17-character VIN containing `O`, and it will not rewrite it either. Whether that is a warning, a
  confirmation prompt, or a hard stop is a decision belonging to the module that owns the record.
- **Never re-implement.** The mirrors are exported from
  [`src/modules/shared-services/index.ts`](../../../src/modules/shared-services/index.ts) precisely so
  no other module writes its own `upper(trim(x))` and drifts.
