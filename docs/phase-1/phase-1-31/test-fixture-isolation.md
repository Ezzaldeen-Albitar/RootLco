# P1-31 database fixture isolation correction

Status: prepared on the repository-tooling lane; not merged and not phase acceptance.
Integration baseline: `d6ad2f824477904e521e7e4d80882b6327c29ec6` (PR #358).

The two shared-services database suites used to insert and later delete the governed
`iam.sensitive.view` permission. Deleting that catalog row fails when another tenant's
role references it. Both suites now require the existing seeded permission, clean
their own fixtures through the existing helper, and close their pools in `finally`.
The permission is neither replaced nor deleted. No runtime assertion, global
pristine-state assertion, cleanup helper, seed, migration or product code changed.

## Failure attribution and controlled proof

The historical `db.log` records three assertion failures and two teardown failures.
It does not establish the exact source commit, database identity or ownership of the
existing tenants. Their names and prefixes do not establish permission to delete them.

- The IAM seed suite found other tenants' baseline roles and a nonzero global user
  count. The empty-business-state suite found populated application tables. These
  three assertions require a pristine target; their failure is not evidence that
  existing tenant data may be removed.
- Both shared-services suite teardowns attempted to delete `iam.sensitive.view` and
  failed on `fk_role_permissions_permission`. Their own tenant cleanup does not own
  another tenant's reference to that shared permission.

Controlled proof used a newly created PostgreSQL 17 container on loopback port 55432,
never the shared database. Baseline source was
`0204f2d12ae1c6b80888a00a85bb321b6327a43f`, with 138 migrations. The relevant four
suites and helper were identical in candidate
`fd29e37b87e511bf0630276e5437459886213b37`.

With locked Vitest 4.1.11, clean global assertions passed 10/10. A newly owned tenant-C
role referencing the seeded permission reproduced both old teardown failures while
all 26 runtime assertions passed. The fixed files passed the same 26 assertions and
both teardowns. Full permission identity and metadata, and tenant-C's tenant, role and
mapping snapshots, were unchanged. Only the exact newly created witness IDs were
subsequently removed; clean global assertions passed again.

A separately owned tenant-D with one user and role reproduced exactly the three
global assertion failures on baseline source; seven other assertions passed. The
expected failing command's exit 1 is retained. Removing only those exact new fixture
IDs restored 10/10. This counterfactual explains the failure mechanisms without
attributing historical shared data to any actor.

The exact candidate 139-migration set and eight seeds replayed twice passed in a
separate disposable database. Four candidate suites passed 73/73: IAM seeds 7,
empty-business-state 3, capability posture 52, and delivery 11. This is bounded
candidate evidence, not a full database-tier or hosted-gate result. No valid replay
or controlled witness proof was repeated for this integration.

## Technical review and verification limits

The final sync was a conflict-free fast-forward to the actual #358 merge. Both fixed
test files retained their pre-sync SHA256 hashes; their baseline helper and database
dependencies did not change in that sync. The original PR #224 branch remains at
`5a21dd3a92ba73e667ff9ce45e2b1c0877189feb`. No new worktree or ownership mapping was
created. Separate agent-assisted source verification found no blocking issue; this
is technical review, not independent human QA.

The source correction is two test files, with 16 added and 46 removed lines. Installed
Vitest, TypeScript, ESLint, Prettier, Next and PostgreSQL client versions match the
unchanged lockfile. Final static and tier results are recorded only after their
processes terminate. The required hosted database-security job runs the full database
tier; it remains pending until the PR's exact-head gates complete. Local full database
replay is not required for these test-only edits under the standing targeted-local
policy in CONTRIBUTING section 8.

Raw evidence is retained outside product checkouts in the coordinator's
`orchestration/evidence/p1-31/test-fixture-isolation-20260910` bundle, including its
46-entry SHA256 manifest, source/database provenance, raw reports, permission and
witness snapshots, and original terminal statuses. Final integration evidence is in
the adjacent `tooling-final-20260910` directory. Historical proof remains labeled by
its original source and database; current unit/web records measure the settled source.

This contributes to P1-31-QA-005 only. It closes no canonical task and claims no
end-to-end or phase acceptance. No architectural or canonical Word-document content
changes are required by this test cleanup correction.
