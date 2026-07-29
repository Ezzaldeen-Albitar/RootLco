# P1-21 — GitHub-Hosted Exact-SHA Clean Room

**Workflow:** `P1-21 Hosted Clean Room` — `.github/workflows/p1-21-clean-room.yml`
**Runner:** `ubuntu-latest` (standard GitHub-hosted, public-repository tier)
**Triggers:** `pull_request` into `develop`/`main`, and `workflow_dispatch`
**Database:** `postgres:17-alpine` service container, fresh per run

## Why this workflow exists

`ci.yml` already runs on fresh hosted VMs with a lockfile-only install and a fresh
PostgreSQL 17 service, so most of a clean room was already proved there. It was
examined step by step against the clean-room definition rather than assumed to
qualify, and **three requirements were genuinely missing**:

| Clean-room requirement                    | In `ci.yml`? | Consequence of the gap                                                                                                               |
| ----------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Zero application tables before migration  | **No**       | The service container is fresh, so this is true — but it is never asserted, so a change that seeded state early would pass unnoticed |
| Schema hash identical before/after suites | **No**       | There is no schema-hash step at all; a suite that mutated the schema would leave no trace and every result above it would be unsound |
| Working tree clean afterwards             | **No**       | A suite that writes a tracked file would go unreported                                                                               |

Two further differences make this a **stricter** proof than `ci.yml`:

- **It checks out the exact pull-request head.** For a `pull_request` event
  `actions/checkout` defaults to the _merge ref_ — a synthetic commit that exists
  nowhere in the branch history. Proving that tree is not the same as proving the
  commit being merged. This workflow pins
  `ref: ${{ github.event.pull_request.head.sha }}` and then **asserts**
  `git rev-parse HEAD` equals it, failing closed if it does not.
- **Every suite runs in one job against one database**, so they are serial by
  construction rather than by convention, and they share state the way a real
  deployment would. `ci.yml` splits them across four independent VMs.

## What the job proves, in order

1. Checkout of the exact head, and an assertion that the SHA matches.
2. `npm ci` — lockfile only.
3. **Assertion that the database holds zero application tables** before anything runs.
4. Every migration applied to that empty database, with the file count and the
   recorded applied count both printed.
5. Seeds applied twice, idempotent, every business table empty.
6. **Schema hash recorded before the suites.**
7. Unit and foundation suite.
8. Database suite — RLS, constraints, concurrency, negative stock.
9. Backend suite — authorization, isolation, idempotency, outbox.
10. **Schema hash re-read and compared; a difference fails the job**, because it would
    mean a suite changed the schema and every result above it is unsound.
11. Contract and coverage gates: OpenAPI, authorization coverage, operation coverage,
    module boundaries, the P1-19/P1-20/P1-21 inventories, encoding.
12. Security scans: scope exclusions, tracked secrets, browser secrets, no-fake-data.
13. Production build.
14. `docker compose config`, the production runner image build, and the **non-root
    runtime assertion** (uid must not be 0).
15. **Assertion that the working tree is clean.**

## Secrets posture

The workflow consumes **no repository secret**. Every value is a non-secret literal:
the placeholder Supabase URL and anon key, and the throwaway `postgres` password of an
ephemeral service container that exists only for the life of the job. Nothing in the
logs depends on a credential, which matters now that the repository — and therefore
every Actions log — is public. There is no `pull_request_target` trigger anywhere in
the repository, so a fork pull request cannot obtain write permissions or secrets.

No artifacts are uploaded. The job's evidence is its log.

## Recorded results

Recorded in the gate record, which names the exact SHA, the run id and the run
conclusion. This document describes the proof; the gate record carries the readings.
