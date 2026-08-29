# BR-01 — Technician Identity Authority (execution record, written after the fact)

Closes `RES-17`.

|                      |                                                               |
| -------------------- | ------------------------------------------------------------- |
| Contract             | `br-01-technician-identity-authority.md` — **not on develop** |
| Branch               | `remediation/p1-29-backend-technician-identity-authority`     |
| Merge                | `3b773980` (PR #265), first parent `b6c374f3`                 |
| Ownership profile    | `p1-29-backend`                                               |
| `B1-PGNET-BLOCKER`   | **OPEN** — untouched, independent                             |
| New migrations       | **0**                                                         |
| New operations       | **1** — 316 → 317                                             |
| New permission codes | **0** — 113 on both sides of the merge                        |

> **This record is retrospective.** BR-01 merged in June carrying no execution
> record — the only merged slice in the programme without one, which the residual
> register carries as `RES-17`. Every figure below is read from the protected tree
> at the merge, not from memory: the operation delta from
> `phase-1-24/evidence/operation-register.json` on both sides, the permission count
> from the same register, the migration count from a diff of `supabase/` across the
> merge, and the case count from the test file as it stands on develop today.

---

## 1. What it shipped

One operation, `tech.technician-me-queue` — `GET /api/v1/technicians/me/queue` —
at `apps/api/src/app/api/v1/technicians/me/queue/route.ts`, with the service and
repository methods behind it on `TechnicianRosterService` and
`TechnicianRosterRepository`.

The surface moved 316 → 317 operations and 256 → 257 OpenAPI paths. Nothing else
in the register moved.

## 2. What it deliberately did NOT ship

**No new permission code.** The operation is guarded by `tech.technician.read`,
which already existed at the parent commit
(`b6c374f3:supabase/seeds/04_iam_permission_catalog.sql:230`). The catalogue reads
113 on both sides of the merge.

**No migration.** `git diff --name-only b6c374f3 3b773980 -- supabase/` is empty.
The queue is a read over tables that already existed.

## 3. The identity authority, which is the point of the slice

The route resolves _which technician is asking_ on the server, from the session,
rather than accepting a technician id from the caller. A technician's own queue is
therefore not addressable by anyone else, and the operation needs no scope
parameter that a browser could forge.

`P1-18-A-01` is the rule it implements: the queue is filtered by the
permission-blind union of every active grant, so RLS cannot be the only thing
standing between one technician and another's work.

## 4. Proof

`tests/backend/br-01-technician-identity.test.ts` — **14 cases** across three
describes, still 14 on develop today:

| describe                              | what it holds                                   |
| ------------------------------------- | ----------------------------------------------- |
| `tech.technician-me-queue — positive` | the queue answers, and answers the caller's own |
| `tech.technician-me-queue — negative` | refusals are refusals, with the right codes     |
| `tech.technician-me-queue — security` | one technician cannot reach another's queue     |

## 5. Status

Merged and long since reproven. `RES-17` moves to **F** when this lands: the
programme's two missing execution records — BR-01's and #278's — are then both
written.

Its **contract** remains absent from develop. That is `RES-16`, and it is not
closed by this record: the sixteen-document planning package exists intact on
`planning/pre-p1-29-remaining-waves-and-p1-29-a0` and has never been promoted. See
the register for why promoting it unmodified is not currently safe.
