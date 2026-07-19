# Plate Normalization Contract (P1-07)

`veh.normalize_plate(text)` is the single normalization authority for license
plates. It is `IMMUTABLE`, `SECURITY INVOKER`, `search_path=''`, and generates
the STORED column `veh.plate_history.plate_normalized`.

## Exact behavior

```sql
SELECT NULLIF(upper(regexp_replace(btrim(COALESCE(p_value, '')), '[[:space:]._\-]', '', 'g')), '');
```

| Rule              | Behavior                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Case              | Uppercased (affects Latin; Arabic has no case)                                                                                                                                  |
| Separators        | Whitespace, `.`, `_`, `-` removed — nothing else                                                                                                                                |
| Unicode / Arabic  | **Preserved verbatim.** `٢٢-٣ ك ٤٥` and `22-3 ك 45` remain DISTINCT normalized values; no digit-shape folding, no transliteration — folding would forge jurisdictional identity |
| Silent correction | None                                                                                                                                                                            |
| Blank / NULL      | Normalizes to `NULL`                                                                                                                                                            |

## Jurisdiction dimension

`plate_history.country_code` carries the issuing jurisdiction; the same
normalized plate string under two `country_code`s is two different plates.
**No jurisdiction-specific format engine ships in P1-07** — format rules per
country are a later, explicitly-scoped concern.

## Interval + uniqueness semantics

- Per-Vehicle non-overlap: `ex_plate_history_no_overlap` (gist, daterange `[)`).
- Cross-Vehicle active-plate exclusivity **over the full interval** (not
  `now()`): `ex_plate_history_active_plate` — a future-dated assignment cannot
  duplicate a plate (abuse case #19); tenant-scoped (no cross-tenant oracle).
- Historical reuse is legal: once an interval is closed, the plate may be
  assigned to another Vehicle.
- Current plate resolver: `veh.plate_at(vehicle_id, date)`.

Concurrency: one winner under simultaneous assignment (QA-008 §4, loser 23P01).
