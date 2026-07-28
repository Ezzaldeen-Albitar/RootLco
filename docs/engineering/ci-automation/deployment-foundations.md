# Deployment foundations

**Nothing here deploys anything, and nothing here should be made to without an
owner decision.**

ADR-012 records Local as the only environment. No hosting provider has been
chosen. Inventing one in a workflow would be worse than leaving the gap, because
the gap is visible and a wrong guess is not.

## What the two workflows actually do today

Both are real, and both stop.

### `deploy-staging.yml`

| Step                                                                                   | Executable now   |
| -------------------------------------------------------------------------------------- | ---------------- |
| Refuse anything that is not a `sha256:` digest                                         | **yes**          |
| Verify the source commit                                                               | **yes**          |
| Migration preflight against a clean PostgreSQL 17, checked against the frozen baseline | **yes**          |
| Record what remains undecided                                                          | **yes**          |
| Authenticate, deploy, smoke-test, health-check, roll back                              | commented, inert |

### `deploy-production.yml`

| Step                                                    | Executable now   |
| ------------------------------------------------------- | ---------------- |
| Verify the commit is an ancestor of `origin/main`       | **yes**          |
| Refuse anything that is not a `sha256:` digest          | **yes**          |
| Refuse unless `staging-verified` is confirmed           | **yes**          |
| Refuse without a change record                          | **yes**          |
| Record the preconditions and refuse to deploy           | **yes**          |
| Migrate, promote, verify, roll back, record the release | commented, inert |

Trigger is `workflow_dispatch` only. There is no path from a pull request, a
push or a schedule, and there must never be one.

## Three properties enforced by construction

**No rebuild.** The only input is a digest that release verification already
produced, scanned and inventoried. Rebuilding for production would produce a
different artifact from the same source and discard every result that referred
to the first one.

**No path from untrusted input.** Dispatch only, `main` only, no
`pull_request_target` anywhere in the repository.

**No standing credential.** This initiative introduces no long-lived cloud
secret. When deployment becomes real it will use OIDC and short-lived
credentials.

## Environments

| Environment | State                                             | What it would carry                                                                                         |
| ----------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| development | implicit — local Supabase stack, `docker compose` | nothing to configure                                                                                        |
| staging     | **not created**                                   | branch restriction to `develop`, scoped secrets, optional wait timer                                        |
| production  | **not created**                                   | tag/branch restriction to `main`, **required reviewers** (the approval control), wait timer, scoped secrets |

Both jobs carry a commented `environment:` block. Uncommenting it is what binds
the job to the environment's protection rules and scoped secrets — and for
production, **the required-reviewer gate is the approval control**. It must be
added before any deployment step is made executable, never after.

Declaring an environment that does not exist yet fails the run with a confusing
error rather than a clear one, which is why they are commented rather than
present.

### If a plan limitation blocks a feature

Record the exact limitation here. **Do not weaken production approval to work
around it.** If required reviewers are unavailable on the plan, the correct
response is that production deployment is not yet automatable — not that it
proceeds without approval.

## OIDC readiness

Nothing is configured, because there is no provider to configure it against.
What is already true:

- job permissions are least-privilege, and `id-token: write` is granted only to
  the release-artifact job that needs it;
- no workflow reads a repository secret, so there is no standing credential to
  migrate away from;
- both deployment workflows are dispatch-only and `main`-only, which is the
  restriction an OIDC trust policy would mirror.

When a provider is chosen, the trust policy must be scoped to: this repository,
the specific workflow file, the specific environment, and the `main` ref.
Anything broader hands the credential to every workflow in the repository.

**Do not create a cloud identity, a role, or a trust policy before the hosting
decision.** A credential that exists is a credential that can leak, and one
scoped to a provider nobody chose is worse than none.

## Rollback criteria

Drafted, not executable. When staging exists:

| Signal                                                     | Action                                                                                                   |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Post-deployment health probe fails 3× over 60 s            | roll back to the previous digest                                                                         |
| Error rate above the pre-deployment baseline for 5 minutes | roll back                                                                                                |
| A migration fails partway                                  | **do not** auto-roll-back the schema — migrations are forward-only; halt, alert, and decide with a human |
| Smoke test fails on any critical workflow                  | roll back                                                                                                |

The migration row is the important one. Rolling an application container back is
cheap and reversible; rolling a schema back is neither, which is why every
migration in this repository is forward-only and why recovery runs through a
forward migration plus, if data was lost, the restore path the nightly drill
exercises.

## What must be decided before any of this becomes real

1. **Hosting provider** — owner decision. Nothing here assumes one.
2. **GitHub environments** `staging` and `production`, with required reviewers on
   production.
3. **OIDC trust policy**, scoped as above.
4. **A staging database**, so a forward-migration check against a _real_ prior
   schema becomes possible. Today's preflight builds from nothing, which is a
   different and weaker claim.
5. **Who approves production.** Reserved to the authorised founders / production
   owner (ADR-006). No automation may assume it.
