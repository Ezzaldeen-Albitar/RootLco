# B1-PGNET-BLOCKER — worker-execution confirmation and verifier reconciliation

Companion to [b1-pgnet-owner-hardening-runbook.md](b1-pgnet-owner-hardening-runbook.md)
§8a and [b1-no-go-register.md](b1-no-go-register.md) (`B1-PGNET-BLOCKER — EXTERNAL`).
This note does not change the verdict. It hardens two things that were previously
argued rather than executed end-to-end, and it reconciles a verifier script that
had drifted from the runbook's own finding.

## Measurement environment

Isolated candidate, not the shared stack: docker `rootlco-b1-candidate`
(`public.ecr.aws/supabase/postgres:17.6.1.143`), port 55432, database `postgres`,
`pg_net` 0.20.3 with a live `pg_net 0.20.3 worker` background worker, 127
migrations applied (B1's three `20260822090000/091000/092000` present). The shared
`supabase_db_RootLco` on 54322 was not modified; both databases were confirmed
returned to baseline (PUBLIC `TEMPORARY` restored, zero residual `net` triggers,
zero probe roles/tables) after every proof.

## What §8a asserted, now confirmed against the live worker

§8a establishes the chain by inspection. This note ran it to completion against the
real worker, with a benign witness function that records `current_user` and
`session_replication_role`, and a request pointed at a dead local port
(`http://127.0.0.1:1`) so no traffic leaves the container — the worker still writes
an error response row, which is all the trigger needs.

- The worker inserts into `net._http_response` as **`supabase_admin`** (a
  superuser) — confirmed by the witness row `who=supabase_admin`.
- The worker runs in **`session_replication_role = origin`**, so an ORIGIN row
  trigger (the only kind `app_platform` can create) **fires**. Witness `srr=origin`.
- Therefore an `AFTER INSERT` trigger `app_platform` attached to
  `net._http_response`, whose body is a `pg_temp` function `app_platform` authored,
  **executes as `supabase_admin`** the next time any request completes.

Two would-be mitigations were checked and do not hold:

- **replica mode** would suppress the ORIGIN trigger — but the real worker runs in
  `origin`, measured, not `replica`. (A manually `replica`-mode insert did suppress
  it, which is exactly why the worker's actual mode is the fact that matters.)
- **`ENABLE ALWAYS`** would let a trigger fire under replica mode — but
  `app_platform` cannot set it: `ALTER TABLE net._http_response ... ENABLE ALWAYS
  TRIGGER` is refused, `must be owner of table _http_response`.

Cross-backend reachability of the temp object — the load-bearing question the
directive's threat model got wrong — was measured directly: a second backend
resolves `pg_temp_N.fn` by name and **executes it**, returning its value, while the
authoring session is held open. The catalogue (`pg_proc`) is cluster-shared and the
stored trigger names its function by OID, so "session-local" does not mean
"unreachable by another backend." At authoring-session disconnect the temp
namespace empties — but the attacker owns that session and holds it open across the
request it itself enqueued.

## Verifier reconciliation

`scripts/security/pgnet-escalation-verifier.mjs` (reusable, reads catalogues only,
never prints credentials, runs against the local candidate or any future hosted
target) previously excluded `pg_temp` from every callable-control query and so
returned **PASS** on this candidate — contradicting §8a. It now measures
`TEMPORARY` on the database as a fourth callable-control door and scores
`TEMPORARY + TRIGGER on a worker-touched relation` as a **PRACTICAL ESCALATION
PATH**. Result on the current candidate: **BLOCK** for every `app_%` role.

Distinctions the tool keeps, so the verdict carries information:

- `TEMPORARY` with **no** reachable worker-relation TRIGGER → defence-in-depth
  warning, not a blocker (no way to attach the temp body where the worker runs).
- PUBLIC TRIGGER with **no** `TEMPORARY` and no persistent callable → the existing
  `CONTEXT TRANSITION PRESENT` warning.
- The 17 executable `RETURNS trigger` functions remain builtins (owner
  `supabase_admin`, language `internal`, no extension) — not attacker-controlled,
  correctly not counted.

Demonstrated flip: after `REVOKE TEMPORARY ON DATABASE postgres FROM PUBLIC` the
verifier returns **PASS** with only the residual platform-TRIGGER warning; baseline
was then restored. This is the co-factor remediation the runbook records but does
**not** ship, for the blast-radius reasons in §8a (it strips `TEMPORARY` from
`anon`/`authenticated`/`service_role` and the Supabase service roles, and the local
tier cannot validate those paths). Shipping it — or pursuing the root
`REVOKE ... ON net._http_response FROM PUBLIC` via an authorised principal / the
provider — remains a platform-posture decision, not a B1 rider.

## Verdict — unchanged

`B1-PGNET-BLOCKER` **REMAINS OPEN**. The pre-hosted closure wording
"the RootLco restricted-role model lacks the persistent callable primitive
required" is **false as stated**: the primitive is a `pg_temp` callable, non-
persistent but worker-reachable for the window the attacker controls, and the chain
closes to superuser. B1 cannot be merged or declared GO while this is open.

## Decision (2026-08-25) — root fix via provider, blocker stays open

The Owner selected the **provider / root-fix path**: pursue the runbook §5
remediation (`REVOKE ALL ON net._http_response FROM PUBLIC`,
`REVOKE ALL ON net.http_request_queue FROM PUBLIC`,
`REVOKE USAGE ON SCHEMA net FROM PUBLIC`, and the wrapper/sequence revokes)
executed by an **authorised principal** — `net.*` is owned by `supabase_admin`
and the migration role `postgres` is not a superuser, so this requires provider
engagement per runbook §8b (categories A–E). The repo-controllable `TEMPORARY`
co-factor revoke was **not** shipped (its PostgREST/service-role blast radius is
unvalidated locally, per §8a).

The §5 precondition was re-verified at the current head: **zero pg_net call sites**
in `supabase/ apps/ src/ scripts/ .github/` (the only match is the classification
note in `scripts/ci/rls-matrix.mjs`), so removing `net.*` from every app role is
safe for RootLco.

`scripts/security/pgnet-escalation-verifier.mjs` is the §7 postcheck instrument:
modelling the §5 revoke on the isolated candidate flipped it from **BLOCK** to
**PASS** (residual defence-in-depth warning only: `TEMPORARY` present but no
reachable worker-relation trigger), and the candidate was restored byte-for-byte
to its baseline `net` ACL (`=arwdDxtm/supabase_admin`). When the provider applies
§5 against a real target, this verifier — run against that target — is the
evidence that closes the blocker, alongside the executable exposure pin in
`tests/db/pre-p1-29-b1-platform-privilege-closure.test.ts` flipping from
"pinned exposure" to "pinned absence".

**Status until then:** `B1-PGNET-BLOCKER` OPEN; B1 not merged; BR-04 and the rest
of PRE-P1-29 remain paused.
