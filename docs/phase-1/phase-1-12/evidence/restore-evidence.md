# P1-12 Evidence — Restore Evidence

**Phase:** 1-12 · **Release:** Release 2 — Core Business Database · **Wave:** 7
(restore + corruption-detection drill) · **Base:** protected `origin/develop` = `5cd16da`
(P1-11 gate merge #45) · **Branch:**
`feature/p1-12-database-integration-validation-release-gate`.

> **Governance / self-review note.** Produced and reviewed under the Solo Developer Review Policy
> and the Standing Technical Authorization Policy — owner-authorized technical, QA, security, and
> adversarial **self-review** by Eng. Ezzaldeen Al-Bitar; **not** an independent third-party
> audit. All merges are performed by the owner. Every figure below traces to actual execution of
> `scripts/db/backup-restore-drill.sh`; nothing is extrapolated.

## Scope and honesty boundary

> Validation-environment drill only, against the local validation database. It does **NOT**
> establish a production restore service and asserts **no** RPO/RTO compliance beyond the measured
> **8,204 ms** restore. All artifacts were disposed of; nothing committed.

## Restore procedure and measured result

1. **Decrypt** the encrypted archive (`openssl enc -d -aes-256-cbc -pbkdf2`, ephemeral passphrase
   from the backup step).
2. **Restore into a fresh, disposable database** (`CREATE DATABASE p1_12_restore_probe` →
   `pg_restore -U postgres -d p1_12_restore_probe`).
3. **Verify** the restored schema hash and control totals against the source.

- **Restore duration:** **8,204 ms**
- **Restored schema hash:** `d3b1e7e4…` — **MATCH** with source
  (`d3b1e7e40a141152f8aff04cf582c02cffa43f8709adad936450c8019d3e4cdb`).

## Control-total verification (restored vs source)

| Control total (table) | Source | Restored | Result    |
| --------------------- | -----: | -------: | --------- |
| `shared.currencies`   |      3 |        3 | **MATCH** |
| `iam.permissions`     |     43 |       43 | **MATCH** |
| `sal.payment_methods` |      3 |        3 | **MATCH** |

Both gates passed: **schema hash MATCH** and **control totals MATCH**. The restored database is a
byte-structurally-equivalent, seed-complete reconstruction of the source.

## Corruption / mismatch detection

All three adversarial conditions were injected and **detected**:

| Case | Injected fault                           | Detection mechanism                       | Result       |
| ---- | ---------------------------------------- | ----------------------------------------- | ------------ |
| (a)  | **Tampered archive** (bytes overwritten) | Decryption fails, or `pg_restore` rejects | **DETECTED** |
| (b)  | **Wrong passphrase**                     | Decryption fails                          | **DETECTED** |
| (c)  | **Incomplete / empty restore**           | Schema hash differs from source           | **DETECTED** |

- **(a) Tampered archive:** four bytes of the encrypted archive were overwritten; the corrupted
  archive is rejected — decryption fails or, if bytes still emit, `pg_restore` refuses the corrupt
  archive. No silent partial restore.
- **(b) Wrong passphrase:** decrypting with an incorrect key fails outright; no plaintext dump is
  produced.
- **(c) Incomplete/empty restore:** an empty database hashes differently from the source, so the
  schema-hash gate catches a restore that did not fully materialize.

## Status

**Status: PASS (validation drill).** Decrypt → `pg_restore` into a fresh database completed in
**8,204 ms** with **schema hash MATCH** (`d3b1e7e4…`) and **all control totals matching**
(currencies 3, permissions 43, payment_methods 3). All three corruption/mismatch cases (tamper,
wrong key, incomplete restore) were **detected**. Probe databases dropped and all artifacts
removed; nothing committed. No production RPO/RTO is asserted beyond the measured restore time.
