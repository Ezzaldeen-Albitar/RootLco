# `P1-27-INT-006` — a keyset cursor minted from a JS `Date` silently loses rows

**Classification:** Confidential — Commercial Product and Pilot Planning

**Severity:** High · **Class:** silent data loss · **Status:** fixed at 9 of 25
sites; 16 pre-existing sites listed in §6 for their owning phases

---

## 1. The defect

`pg` decodes `timestamptz` into a JavaScript `Date`, which holds
**milliseconds**. PostgreSQL stores **microseconds**.

The decoder computes `1000 * parseFloat('.123456')` = `123.456`, and `Date.UTC`
truncates **toward zero**. So `.toISOString()` returns a value **strictly
earlier** than the stored one whenever the sub-millisecond digits are non-zero:

```
stored     2026-08-04 10:00:00.123456+00
toISOString  2026-08-04T10:00:00.123Z        <-- .000456 lost, downward
```

Put that value in a keyset cursor and the descending predicate

```sql
AND (sort_column, id) < ($v, $i)
```

compares `.123456 > .123000` on its **first** element. The comparison is false,
the `id` tie-break is **never consulted**, and every row sharing the boundary
row's millisecond at a higher microsecond is **skipped**.

Not duplicated. Skipped — the failure mode nobody notices, and the one
`hasMore`/`nextCursor` report nothing about.

## 2. Why it is a certainty, not a race

`now()` is `transaction_timestamp()`, and the request pipeline wraps one
operation in one transaction. So **any batch written by a single request shares
`detected_at` / `effective_at` to the microsecond by construction.**

Two places in this codebase do exactly that:

- a **duplicate scan** writes up to 50 candidates in one transaction;
- a **consent write** can record several decisions about one dimension tuple in
  one statement — the very tie `crm.consent_history.seq` exists to break.

For those, a millisecond cursor does not risk losing the tail of a page. It
loses it every time.

## 3. Measured, not reasoned

Ten rows written at one microsecond-precise instant, read at `limit=4`:

| cursor value                  | page 1 | page 2 | lost  |
| ----------------------------- | ------ | ------ | ----- |
| `...123Z` (JS `Date`)         | 4      | **0**  | **6** |
| `...123456Z` (full precision) | 4      | 6      | 0     |

The predicate itself is sound — replaying it with the full-precision value
returns the correct 6. **The cursor value is the defect.**

## 4. The fix

`cursorTimestamp(column)` in `apps/api/src/server/db/pagination.ts`:

```sql
to_char(<column> AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
```

Three properties, each verified rather than assumed:

1. It **round-trips exactly** — `rendered::timestamptz = column` is true.
2. It **loses zero rows** — the walk above returns 10 of 10.
3. It is **still a parseable timestamp** — `new Date(...)` accepts it, so
   widening it breaks no consumer.

`buildPageWithCursors()` accompanies it. The caller pairs every published item
with the exact `(sortValue, id)` the next page must compare against, so the
cursor key is **not** assumed to be a field of the response. That assumption was
the defect.

**The published wire format is unchanged.** Timestamps in responses stay
millisecond ISO strings; only the opaque cursor carries microseconds.

## 5. Sites fixed (9)

| file                                          | read                        |
| --------------------------------------------- | --------------------------- |
| `crm/data/customer-read-repository.ts`        | contacts                    |
| `crm/data/customer-read-repository.ts`        | addresses                   |
| `crm/data/customer-read-repository.ts`        | preferences                 |
| `crm/data/customer-read-repository.ts`        | consents **(acute)**        |
| `crm/data/customer-read-repository.ts`        | notes                       |
| `crm/data/customer-read-repository.ts`        | tags                        |
| `crm/data/customer-identity-repository.ts`    | timeline                    |
| `crm/data/customer-identity-repository.ts`    | duplicate queue **(acute)** |
| `vehicle/data/vehicle-identity-repository.ts` | duplicate queue **(acute)** |

The alert and restriction lists are **not** affected: they sort on `date`
columns already read as `::text`, which have no sub-day precision to lose.

Regression suite: `tests/backend/p1-27-cursor-precision.test.ts`. It asserts the
premise first — that the fixture really did create the collision and that `pg`
really does truncate — because a suite that silently failed to reproduce the
condition would pass vacuously. Verified by mutation: restoring the `Date` cursor
makes it return **3 of 10**.

## 6. Sites NOT fixed — 16, pre-existing, owned elsewhere

The same pattern predates this remediation. Each is the identical defect and is
listed with its exact location so the owning phase can close it, rather than left
as a general warning:

| file                                                   | line |
| ------------------------------------------------------ | ---- |
| `crm/data/customer-search-repository.ts`               | 102  |
| `diagnostics/data/diagnostics-repository.ts`           | 532  |
| `iam/data/audit-repository.ts`                         | 147  |
| `iam/data/authorization-repository.ts`                 | 329  |
| `iam/data/identity-repository.ts`                      | 283  |
| `shared-services/data/notification-read-repository.ts` | 128  |
| `technician/data/labor-session-repository.ts`          | 171  |
| `vehicle/data/vehicle-history-repository.ts`           | 70   |
| `vehicle/data/vehicle-odometer-repository.ts`          | 115  |
| `vehicle/data/vehicle-registration-repository.ts`      | 158  |
| `vehicle/data/vehicle-registration-repository.ts`      | 262  |
| `vehicle/data/vehicle-relations-repository.ts`         | 156  |
| `vehicle/data/vehicle-search-repository.ts`            | 128  |
| `work-order/data/work-order-repository.ts`             | 550  |
| `work-order/data/work-order-repository.ts`             | 745  |
| `work-order/data/work-order-repository.ts`             | 995  |

They are not fixed here for one reason: each belongs to a closed phase with its
own gate record, and rewriting ten modules' reads inside a CRM/Vehicle
remediation would hide a foundation change inside a feature branch — the thing
§7 exists to prevent. The mechanism they need is now merged and proven.

**A gate cannot be added yet.** A check forbidding `sortValue: <date>.toISOString()`
would fail on all sixteen. It should land in the same change that closes them,
so the rule and the compliance arrive together rather than the rule arriving
disabled.

## 7. Also fixed here

`AddressEntry.countryCode` was typed `string` on a **nullable** column
(`crm.addresses.country_code`, `is_nullable = YES`), and the POST that creates an
address accepts `countryCode` as optional — so null rows are ordinary. A consumer
writing `countryCode.toUpperCase()` compiled and would have thrown at runtime.
Now `string | null`.

## 8. How this was found

Not by a test and not by review of the diff. By an adversarial workflow run over
the three merged read-contract remediations: six independent lenses produced 13
candidate findings, each was handed to a separate agent instructed to **refute**
it, and 4 survived. Two of the four were this defect, on the two duplicate
queues; a third was the same class across the six CRM component lists; the fourth
was the `countryCode` type.

Nine were refuted, which is the more important number — an adversarial pass that
confirms everything is not adversarial.

The finding was then verified independently against the live database before any
code changed, because a confirmed finding from an agent is a claim, not evidence.
