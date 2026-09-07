# P1-12 Evidence — Backup Evidence

**Phase:** 1-12 · **Release:** Release 2 — Core Business Database · **Wave:** 7
(backup / encryption drill) · **Base:** protected `origin/develop` = `5cd16da` (P1-11 gate
merge #45) · **Branch:** `feature/p1-12-database-integration-validation-release-gate`.

> **Governance / self-review note.** Produced and reviewed under the Solo Developer Review Policy
> and the Standing Technical Authorization Policy — owner-authorized technical, QA, security, and
> adversarial **self-review** by Eng. Ezzaldeen Al-Bitar; **not** an independent third-party
> audit. All merges are performed by the owner. Every figure below traces to actual execution of
> `scripts/db/backup-restore-drill.sh` against the local validation database; nothing is
> extrapolated.

## Scope and honesty boundary

> This is a **validation-environment drill only**. It exercises the backup → encryption path on
> the local validation database (`supabase_db_RootLco`). It does **NOT** establish or operate a
> production backup scheduler, and it asserts **no** RPO/RTO compliance beyond the measured
> figures. All artifacts are written to a working directory **outside the repository**, and
> **nothing is committed**.

## Source state (pre-backup)

The source database was reset to its canonical, seeded state before the backup so the artifact is
reproducible. Verified control totals at source: currencies **3**, permissions **43**,
payment_methods **3**; schema hash `d3b1e7e4…` (full
`d3b1e7e40a141152f8aff04cf582c02cffa43f8709adad936450c8019d3e4cdb`).

## Backup command and measured artifact

- **Command:** custom-format `pg_dump` — `pg_dump -Fc -U postgres -d postgres -f <archive>.dump`
- **`pg_dump` version:** PostgreSQL **17.6**
- **Archive size:** **2,941,202 bytes (≈ 2.94 MB)**
- **Duration:** **1,123 ms**
- **SHA-256 (plaintext dump):**
  `9cd5ee42a8d64cd7a2bf6f4e392d8999d7d77fb2560150bd2efebd26c48b1b9f`

## Encryption

- **Mechanism:** **AES-256-CBC** with **PBKDF2** key derivation and a random salt
  (`openssl enc -aes-256-cbc -pbkdf2 -salt`).
- **Key handling:** an **ephemeral passphrase** generated for the drill and **NOT stored** —
  never written to the repository, never committed, discarded with the working directory. The
  passphrase is required to decrypt; loss of the passphrase renders the archive unrecoverable by
  design (see `recovery-runbook.md` §Secrets & key handling).
- **Integrity:** the encrypted archive is independently hashed (SHA-256). Any tamper of the
  ciphertext is detected downstream (decryption failure or `pg_restore` rejection — see
  `restore-evidence.md`).

## Access posture

- Artifacts live in a working directory **outside the repository tree**; the repository never
  contains a backup, a decrypted dump, or a key.
- The plaintext dump and the encryption passphrase are both treated as sensitive: the passphrase
  is ephemeral and unstored, and every artifact (plaintext, ciphertext, restore copies) is
  **deleted at the end of the drill**.
- No backup artifact or secret is transmitted to any external endpoint by this drill.

## Backup schedule — CONTRACT, not a running scheduler

The Release 2 database defines the **expectations** a future production backup process must
satisfy; it does **not** run a scheduler in this phase. The contract (to be implemented when
production is authorized) is:

- Backups are produced with `pg_dump -Fc` (custom format) so selective, ordered restore is
  possible.
- Every backup is **encrypted at rest** (AES-256, PBKDF2-derived key) before leaving the database
  host; keys are managed outside the archive and outside the repository.
- Every backup records **size, SHA-256, and duration**, and is verified against **control totals
  and the schema hash** on restore before it is trusted.
- Corruption, tamper, and wrong-key conditions must be **detectable** (proven in this drill).
- Point-in-time recovery (PITR) is a **production dependency not exercised here** — see
  `recovery-runbook.md`.

No claim is made that this schedule is currently operating.

## Addendum, 2026-09-07 — a dump does not carry database-level settings

_Added after the fact; nothing above is rewritten. The figures and the PASS
recorded in this document stand as measured in Phase 1-12._

The contract above says a backup is verified against **control totals and the
schema hash** on restore. That is necessary and it is **not sufficient**, and
the nightly `backup-restore-drill` proved so on 2026-09-06.

`supabase/migrations/0001_extensions.sql` runs `ALTER DATABASE <current> SET
search_path TO "$user", public, extensions`. That setting lives in
`pg_db_role_setting`, which belongs to the **cluster**, not to the database's own
contents. **A custom-format `pg_dump` taken without `--create` — which is the
command recorded above — does not carry it**, and a restore into a database made
with a bare `CREATE DATABASE` therefore comes up without it.

What the drill measured: integrity matched exactly, **254 of 254 tables and 202
of 202 rows**, while the schema hash differed. The restore was **faithful** —
with the search paths equalised, both schema inventories were byte-identical
across **9,683 rows**. The hash moved only because three objects **render**
differently under a different search path: a check constraint on
`iam.user_accounts` and the trigram index operator classes on `inv.item_master`
and `shared.search_metadata`.

**The operational consequence, which is what a recovery needs to know.** The
restored database is not broken on arrival: existing objects are bound by
identifier and keep working, which is why the row counts and the application
smoke queries all passed. But anything executed **after** the restore that
relies on an unqualified name resolved through `extensions` — `citext`,
`gin_trgm_ops`, `gist_trgm_ops` — will fail or resolve wrongly. **Restoring the
dump is not on its own enough to rebuild a working database. The database-level
settings must be re-applied as a step of the recovery**, read from the source
cluster's `pg_db_role_setting` (or captured alongside the dump), because the
archive does not contain them.

Two mechanical options, either of which closes the gap for a real recovery:

- take the backup with `pg_dump --create`, so the archive carries the
  `CREATE DATABASE` and its settings; or
- re-apply them explicitly after `CREATE DATABASE`, one
  `ALTER DATABASE <target> SET <name> = <value>` per row of the source's
  `pg_db_role_setting` where `setrole = 0`.

`scripts/ci/backup-restore-drill.mjs` now does the second, **before**
`pg_restore` runs, and then asserts that the restored database's set of
database-level settings **equals** the source's — failing when it does not, and
reporting both sets. The schema-hash equality assertion was left exactly as it
was, so it still catches genuine structural loss.

This addendum does not change the Phase 1-12 status. It records a
**disaster-recovery gap in the contract** that the Phase 1-12 drill did not
measure and the nightly drill has since closed. See
`docs/engineering/ci-automation/nightly-assurance.md` §"Backup and restore" and
`docs/phase-1/phase-1-30/change-control-2026-09-06.md` CC-17.

## Status

**Status: PASS (validation drill).** A real custom-format `pg_dump` (2,941,202 bytes, 1,123 ms,
SHA-256 recorded) was produced from the canonical source state and encrypted with AES-256-CBC /
PBKDF2 using an ephemeral, unstored passphrase. All artifacts were removed; nothing committed.
Restore verification and corruption detection are recorded in `restore-evidence.md`.

**2026-09-07:** still PASS as measured, and now qualified — see the addendum above. A restore of
this dump must **re-apply the database-level settings**, which the dump does not carry.
