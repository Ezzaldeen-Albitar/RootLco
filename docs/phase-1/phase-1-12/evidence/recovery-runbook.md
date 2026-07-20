# P1-12 — Database Recovery Runbook

**Phase:** 1-12 · **Release:** Release 2 — Core Business Database · **Wave:** 7 (recovery drill

- runbook) · **Base:** protected `origin/develop` = `5cd16da` (P1-11 gate merge #45) ·
  **Branch:** `feature/p1-12-database-integration-validation-release-gate`.

> **Governance / self-review note.** Authored and reviewed under the Solo Developer Review Policy
> and the Standing Technical Authorization Policy — owner-authorized technical, QA, security, and
> adversarial **self-review** by Eng. Ezzaldeen Al-Bitar; **not** an independent third-party
> audit. All merges are performed by the owner. Procedures below are backed by the actual Wave 7
> drill (`scripts/db/backup-restore-drill.sh`); measured figures trace to that execution. Where a
> step is a production dependency not exercised in this phase, it is labeled as such.

> **Scope disclaimer.** This runbook documents the **validated recovery procedure** for the
> Release 2 database as exercised in the validation environment. It is a **contract and
> operational guide**, not proof of a running production backup/restore service. No RPO/RTO is
> asserted beyond the measured restore time of **8,204 ms**. PITR is a **production dependency
> not exercised** in Wave 7 (see §7).

---

## 1. Reference facts (from actual execution)

| Fact                       | Value                                                                |
| -------------------------- | -------------------------------------------------------------------- |
| Canonical schema hash      | `d3b1e7e40a141152f8aff04cf582c02cffa43f8709adad936450c8019d3e4cdb`   |
| Backup format              | Custom-format `pg_dump -Fc` (PostgreSQL **17.6**)                    |
| Measured backup size       | 2,941,202 bytes (≈ 2.94 MB)                                          |
| Measured backup duration   | 1,123 ms                                                             |
| Backup SHA-256 (plaintext) | `9cd5ee42a8d64cd7a2bf6f4e392d8999d7d77fb2560150bd2efebd26c48b1b9f`   |
| Encryption                 | AES-256-CBC, PBKDF2-derived key, random salt                         |
| Measured restore duration  | 8,204 ms                                                             |
| Control totals (seed)      | `shared.currencies`=3, `iam.permissions`=43, `sal.payment_methods`=3 |
| Drill script               | `scripts/db/backup-restore-drill.sh <WORKDIR>`                       |

Full backup and restore evidence: `backup-evidence.md`, `restore-evidence.md`.

---

## 2. Backup creation

1. Bring the source database to a known, consistent state. In validation this is
   `supabase db reset` (clean + seeded); in production this is the live database at the recovery
   point.
2. Record the **pre-backup source fingerprint**: schema hash (`node scripts/db/schema-inventory.mjs
--hash-only`) and control totals (currencies, permissions, payment_methods). These are the
   trust anchors verified on restore.
3. Produce the archive with **custom-format `pg_dump`**:
   `pg_dump -Fc -U postgres -d <db> -f <archive>.dump`. Custom format is required so restore can
   be selective and ordered.
4. Record **size, SHA-256, and duration** for the archive (chain-of-custody metadata).

## 3. Encryption

1. Encrypt the archive **before it leaves the database host**:
   `openssl enc -aes-256-cbc -pbkdf2 -salt -in <archive>.dump -out <archive>.dump.enc -pass pass:<KEY>`.
2. Hash the ciphertext (SHA-256) independently.
3. The passphrase/key is managed **outside the archive and outside the repository** (see §8). In
   the validation drill the key is **ephemeral and never stored**.

## 4. Storage & access expectations

- Store the **encrypted** artifact only; never store an unencrypted dump at rest.
- Keep artifacts **outside the repository tree**; the repository must never contain a backup, a
  decrypted dump, or a key. (In the drill, the working directory is outside the repo and nothing
  is committed.)
- Restrict read access to the encrypted archive and its key to the recovery operator role.
- Retain the archive metadata (size, plaintext SHA-256, ciphertext SHA-256, creation time) with
  the archive so integrity can be re-verified before any restore.

## 5. Restore

1. **Decrypt:** `openssl enc -d -aes-256-cbc -pbkdf2 -in <archive>.dump.enc -out <archive>.dump
-pass pass:<KEY>`. A wrong key fails here (by design).
2. **Provision a fresh, disposable target:** `CREATE DATABASE <restore_db>` — never restore over a
   live database without an explicit, separate decision.
3. **Restore:** `pg_restore -U postgres -d <restore_db> <archive>.dump`.
4. Record the **restore duration** (measured 8,204 ms in the drill).

## 6. Verification (mandatory before trusting a restore)

A restore is trusted **only** when both gates pass:

1. **Schema-hash gate:** restored hash **must equal** the canonical
   `d3b1e7e40a141152f8aff04cf582c02cffa43f8709adad936450c8019d3e4cdb`.
2. **Control-total gate:** `shared.currencies`=3, `iam.permissions`=43, `sal.payment_methods`=3
   must all match source.

If either gate fails, **stop** — the restore is incomplete or corrupt (this is exactly how case
(c) below is caught). Do not promote a failing restore.

**Corruption / tamper detection (all three proven in Wave 7):**

- **(a) Tampered archive** → decryption fails or `pg_restore` rejects the corrupt archive.
- **(b) Wrong passphrase** → decryption fails; no plaintext is produced.
- **(c) Incomplete/empty restore** → schema hash differs from source and the gate fails.

## 7. Roll-forward remediation & PITR dependency

- **Roll-forward-only migrations.** Financial and append-only migrations are **never blindly
  reversed**. Recovery of a schema defect is performed by an **additive, forward-only remediation
  migration**, not by rewriting or reverting a merged migration. All 113 migrations carry a
  rollback-classification header and are additive/forward-only.
- **Baseline-rebuild recovery.** The validated recovery path in this phase is the **empty rebuild
  - phase-boundary upgrade matrix** (P1-2…P1-11 → canonical schema hash), i.e. a deterministic
    reconstruction of structure from migrations, plus restore of data from an encrypted backup.
- **PITR is a production dependency NOT exercised here.** Point-in-time recovery (WAL archiving /
  replay to a target timestamp) is required for production-grade RPO but is **not** established or
  tested in Wave 7. Do not represent PITR as available until it is implemented and drilled under a
  production authorization. Until then, the recovery granularity is the **last verified encrypted
  backup**.

## 8. Secrets & key handling

- The **encryption passphrase/key** is the single most sensitive artifact. In the validation
  drill it is **ephemeral and unstored**; in production it must be held in a managed secret store,
  never in the repository, never alongside the archive, and never logged.
- **Loss of the key = unrecoverable archive** by design (AES-256). Key custody and rotation are a
  production prerequisite for the backup contract.
- The plaintext dump is sensitive while it exists (during backup creation and during restore) and
  must be deleted immediately after use.
- No backup artifact or secret may be sent to an endpoint not explicitly authorized by the owner.

## 9. Incident decision tree

```
Incident detected
│
├─ Is the live database corrupt / lost?
│   ├─ NO  → Is it a SCHEMA defect only (data intact)?
│   │        ├─ YES → author an ADDITIVE forward-only remediation migration (§7);
│   │        │        do NOT reverse a merged/financial/append-only migration.
│   │        └─ NO  → contain, capture evidence (§10), reassess.
│   └─ YES → proceed to restore:
│            1. Select the last VERIFIED encrypted backup (metadata + ciphertext SHA-256 checked).
│            2. Decrypt with the managed key (§8). Wrong key → STOP, escalate key custody.
│            3. Restore into a FRESH database (§5) — never over the live DB blindly.
│            4. Verify BOTH gates (§6): schema hash + control totals.
│               ├─ PASS → promote restored DB per owner decision; record evidence (§10).
│               └─ FAIL → archive is incomplete/corrupt → try prior verified backup;
│                          if none, escalate (data loss beyond last good backup).
│
└─ Is data loss WITHIN the window since the last backup?
    └─ PITR NOT available in this phase (§7) → recovery granularity = last verified backup.
       Record the gap; do not claim PITR coverage.
```

Reserved-decision guard: promotion of a restored database to production, or anything touching real
customer data / production, is a **reserved owner decision** — never taken autonomously.

## 10. Evidence collection (every recovery event)

Record, from actual execution:

- Backup: format, `pg_dump` version, size, plaintext SHA-256, duration, ciphertext SHA-256.
- Encryption: mechanism (AES-256-CBC/PBKDF2), key custody (managed store / ephemeral), confirming
  the key is **not** stored with the archive or in the repo.
- Restore: target DB, restore duration, **restored schema hash vs canonical**, **control totals vs
  source**, pass/fail per gate.
- Corruption checks exercised: (a) tamper, (b) wrong key, (c) incomplete — with detected/not
  detected per case.
- Disposal: confirmation that probe databases were dropped and all artifacts removed; nothing
  committed.

---

## Status

**Status: PASS (validation drill) — runbook validated.** The end-to-end recovery path (backup →
AES-256/PBKDF2 encryption → decrypt → `pg_restore` into a fresh database → schema-hash +
control-total verification → corruption/tamper/wrong-key/incomplete detection) was exercised with
measured figures (backup 2,941,202 B / 1,123 ms; restore 8,204 ms; schema hash MATCH; control
totals MATCH; all three corruption cases DETECTED). This is a **validation-environment** result:
no production scheduler is running, **PITR is a not-yet-exercised production dependency**, and no
RPO/RTO compliance is asserted beyond the measured restore time.
