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

## Status

**Status: PASS (validation drill).** A real custom-format `pg_dump` (2,941,202 bytes, 1,123 ms,
SHA-256 recorded) was produced from the canonical source state and encrypted with AES-256-CBC /
PBKDF2 using an ephemeral, unstored passphrase. All artifacts were removed; nothing committed.
Restore verification and corruption detection are recorded in `restore-evidence.md`.
