#!/usr/bin/env bash
# ============================================================================
# P1-12 Wave 7 — Backup, encryption, restore, and corruption-detection drill.
#
# Against the LOCAL VALIDATION database only (supabase_db_RootLco). Produces a real
# custom-format pg_dump, records size + sha256 + duration, encrypts it with AES-256, then
# restores into a fresh disposable database and proves the restored schema hash + control
# totals match the source. Finally exercises corruption/mismatch detection. All artifacts
# are ephemeral (a working dir OUTSIDE the repo); nothing is committed. This is a
# validation-environment drill — it does NOT establish a production backup scheduler.
#
# Usage: bash scripts/db/backup-restore-drill.sh <WORKDIR>
# ============================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'   # keep container /tmp paths intact on Git Bash
WORKDIR="${1:?usage: backup-restore-drill.sh <WORKDIR>}"
mkdir -p "$WORKDIR"
CT=supabase_db_RootLco
PASS="p1-12-ephemeral-$(date +%s 2>/dev/null || echo 0)"   # ephemeral, never stored
RDB=p1_12_restore_probe
dexec() { docker exec "$CT" "$@"; }
psqlq() { dexec psql -U postgres -d "${2:-postgres}" -tAc "$1"; }
fail() { echo "DRILL FAILED: $1"; exit 1; }

echo "=== 0. reset source to canonical state (clean, seeded) ==="
npx supabase db reset >/dev/null 2>&1 || fail "reset"

echo "=== 1. source control totals + schema hash ==="
SRC_HASH=$(node scripts/db/schema-inventory.mjs --hash-only) || fail "src hash"
SRC_CUR=$(psqlq "SELECT count(*) FROM shared.currencies")
SRC_PERM=$(psqlq "SELECT count(*) FROM iam.permissions")
SRC_WOS=$(psqlq "SELECT count(*) FROM wo.work_order_states")
SRC_UOM=$(psqlq "SELECT count(*) FROM inv.units_of_measure")
SRC_PM=$(psqlq "SELECT count(*) FROM sal.payment_methods")
echo "source: hash=$SRC_HASH currencies=$SRC_CUR permissions=$SRC_PERM wo_states=$SRC_WOS uom=$SRC_UOM payment_methods=$SRC_PM"

echo "=== 2. backup (custom-format pg_dump) ==="
T0=$(date +%s%N)
dexec pg_dump -Fc -U postgres -d postgres -f /tmp/p1-12-backup.dump || fail "pg_dump"
T1=$(date +%s%N)
BACKUP_MS=$(( (T1 - T0) / 1000000 ))
SIZE=$(dexec stat -c %s /tmp/p1-12-backup.dump)
docker cp "$CT":/tmp/p1-12-backup.dump "$WORKDIR/p1-12-backup.dump" >/dev/null || fail "docker cp out"
HASH=$(sha256sum "$WORKDIR/p1-12-backup.dump" | cut -d' ' -f1)
echo "backup: bytes=$SIZE duration_ms=$BACKUP_MS sha256=$HASH pg_version=$(dexec pg_dump --version | head -1)"

echo "=== 3. encrypt (AES-256-CBC, pbkdf2) ==="
openssl enc -aes-256-cbc -pbkdf2 -salt -in "$WORKDIR/p1-12-backup.dump" -out "$WORKDIR/p1-12-backup.dump.enc" -pass "pass:$PASS" || fail "encrypt"
ENC_HASH=$(sha256sum "$WORKDIR/p1-12-backup.dump.enc" | cut -d' ' -f1)
echo "encrypted: sha256=$ENC_HASH mechanism=aes-256-cbc/pbkdf2 key-handling=ephemeral-passphrase(not-stored)"

echo "=== 4. restore drill (decrypt -> fresh DB -> pg_restore) ==="
openssl enc -d -aes-256-cbc -pbkdf2 -in "$WORKDIR/p1-12-backup.dump.enc" -out "$WORKDIR/p1-12-restore.dump" -pass "pass:$PASS" || fail "decrypt"
docker cp "$WORKDIR/p1-12-restore.dump" "$CT":/tmp/p1-12-restore.dump >/dev/null || fail "docker cp in"
psqlq "DROP DATABASE IF EXISTS $RDB" >/dev/null
psqlq "CREATE DATABASE $RDB" >/dev/null
R0=$(date +%s%N)
dexec pg_restore -U postgres -d "$RDB" /tmp/p1-12-restore.dump >/dev/null 2>&1
R1=$(date +%s%N)
RESTORE_MS=$(( (R1 - R0) / 1000000 ))
RES_HASH=$(PGDATABASE=$RDB node scripts/db/schema-inventory.mjs --hash-only) || fail "restore hash"
RES_CUR=$(psqlq "SELECT count(*) FROM shared.currencies" "$RDB")
RES_PERM=$(psqlq "SELECT count(*) FROM iam.permissions" "$RDB")
RES_PM=$(psqlq "SELECT count(*) FROM sal.payment_methods" "$RDB")
echo "restore: duration_ms=$RESTORE_MS hash=$RES_HASH currencies=$RES_CUR permissions=$RES_PERM payment_methods=$RES_PM"
[ "$RES_HASH" = "$SRC_HASH" ] && echo "  schema_hash MATCH ✓" || fail "schema hash mismatch (src=$SRC_HASH res=$RES_HASH)"
[ "$RES_CUR" = "$SRC_CUR" ] && [ "$RES_PERM" = "$SRC_PERM" ] && [ "$RES_PM" = "$SRC_PM" ] && echo "  control totals MATCH ✓" || fail "control-total mismatch"

echo "=== 5. corruption / mismatch detection ==="
# (a) tamper the encrypted archive -> decryption must fail
cp "$WORKDIR/p1-12-backup.dump.enc" "$WORKDIR/tampered.enc"
printf '\xff\xff\xff\xff' | dd of="$WORKDIR/tampered.enc" bs=1 seek=64 count=4 conv=notrunc >/dev/null 2>&1
if openssl enc -d -aes-256-cbc -pbkdf2 -in "$WORKDIR/tampered.enc" -out "$WORKDIR/tampered.dump" -pass "pass:$PASS" >/dev/null 2>&1; then
  # decryption may still emit bytes; the restore must then reject the corrupt archive
  if dexec bash -c "cat > /tmp/t.dump" < "$WORKDIR/tampered.dump" && dexec pg_restore -l /tmp/t.dump >/dev/null 2>&1; then
    echo "  (a) tampered archive: NOT detected"; TAMPER=fail
  else echo "  (a) tampered archive DETECTED (pg_restore rejects) ✓"; TAMPER=ok; fi
else echo "  (a) tampered archive DETECTED (decryption fails) ✓"; TAMPER=ok; fi
# (b) wrong passphrase -> decryption fails
if openssl enc -d -aes-256-cbc -pbkdf2 -in "$WORKDIR/p1-12-backup.dump.enc" -out /dev/null -pass "pass:wrong-key" >/dev/null 2>&1; then
  echo "  (b) wrong key: NOT detected"; KEY=fail
else echo "  (b) wrong passphrase DETECTED (decryption fails) ✓"; KEY=ok; fi
# (c) schema-hash mismatch detection: an incomplete restore (empty DB) hashes differently
psqlq "DROP DATABASE IF EXISTS ${RDB}_empty" >/dev/null; psqlq "CREATE DATABASE ${RDB}_empty" >/dev/null
EMPTY_HASH=$(PGDATABASE=${RDB}_empty node scripts/db/schema-inventory.mjs --hash-only)
[ "$EMPTY_HASH" != "$SRC_HASH" ] && echo "  (c) incomplete/empty restore DETECTED (hash differs) ✓" && MISMATCH=ok || MISMATCH=fail

echo "=== 6. cleanup (drop probe DBs + delete ALL artifacts) ==="
psqlq "DROP DATABASE IF EXISTS $RDB" >/dev/null; psqlq "DROP DATABASE IF EXISTS ${RDB}_empty" >/dev/null
dexec rm -f /tmp/p1-12-backup.dump /tmp/p1-12-restore.dump /tmp/t.dump 2>/dev/null
rm -f "$WORKDIR"/p1-12-backup.dump "$WORKDIR"/p1-12-backup.dump.enc "$WORKDIR"/p1-12-restore.dump "$WORKDIR"/tampered.enc "$WORKDIR"/tampered.dump
echo "artifacts removed."

if [ "$RES_HASH" = "$SRC_HASH" ] && [ "$TAMPER" = ok ] && [ "$KEY" = ok ] && [ "$MISMATCH" = ok ]; then
  echo "BACKUP/RESTORE DRILL: PASS (backup=${SIZE}B/${BACKUP_MS}ms restore=${RESTORE_MS}ms hash-match + all corruption checks detected)"
  exit 0
else echo "BACKUP/RESTORE DRILL: FAIL"; exit 1; fi
