# Pilot Provisioning Runbook

**Status:** Controlled Class-3 operator procedure. **Owner decision:** 2026-07-18.

The approved pilot organization is held in
`supabase/packages/pilot-provisioning.package.json`. It is executed only through
the generic `scripts/db/provision-organization.mjs` CLI by an authorized operator
against an approved environment. The package is not referenced by `[db.seed]`,
never runs in CI, never runs on local reset, and is not an application startup
path.

## Preconditions

1. Obtain approval for the target database and verify the connection variables:
   `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`. Defaults target
   the local Supabase PostgreSQL instance; the password is never printed.
2. Set `ROOTLCO_ENV` to exactly `local-pilot` or `production-pilot`. Every other
   value, including an unset value, fails closed.
3. Use the package's exact `provisioning.tenant.code` as the value of
   `--confirm`. A mismatch fails before any database connection.

## Procedure

Always inspect a dry run first. It prints the environment, target host/port/db/user,
the complete plan and provisioning payload, and the idempotency key. It performs
no connection and no write.

```powershell
$env:ROOTLCO_ENV = 'local-pilot'
node scripts/db/provision-organization.mjs --package supabase/packages/pilot-provisioning.package.json --confirm benzene_vehicle_services --dry-run
```

After comparing that output with the approval record, remove `--dry-run` and run
the same command. The CLI starts one transaction, inserts the generic active plan
only when no active version with that plan code exists, and invokes
`org.provision_organization(payload, idempotency_key)`.

The successful command prints a JSON change log containing the environment,
target identity, idempotency key, and returned tenant/subscription/company/branch
identifiers. Preserve that output in the authorized execution record. It never
prints the database password.

## Retry semantics

Re-running the same package is idempotent: the guarded plan insert creates no
duplicate, and the same provisioning key plus byte-equivalent JSON payload
replays the stored response without creating rows. The same key with a changed
payload fails with SQLSTATE `23000`; investigate and obtain approval instead of
editing or bypassing the stored key. Any database failure rolls back the CLI
transaction and exits non-zero.
