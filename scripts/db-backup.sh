#!/usr/bin/env bash
# PreFlop database backup, restore and restore drill (docs/18 §Backups and restore drill).
#
#   scripts/db-backup.sh dump    <SOURCE_URL> <file.dump>        pg_dump, custom format, compressed
#   scripts/db-backup.sh restore <TARGET_URL> <file.dump>        pg_restore into an existing, empty database
#   scripts/db-backup.sh verify  <SOURCE_URL> <TARGET_URL>       the restored copy matches the source
#   scripts/db-backup.sh drill   <SOURCE_URL> <SCRATCH_URL> [file.dump]
#       dump the source, restore it into the scratch database (dropped and recreated), verify, report.
#       The scratch database must not exist, or must be one an earlier drill created (it is marked with
#       a database comment); anything else is refused, so an alias of the source can never be dropped.
#       The expectations are read in the dump's own snapshot, so live writes never fail a good restore.
#
# Needs pg_dump/pg_restore/psql of a version at least the server's (PostgreSQL 17 client dumps 15–17).
# Supabase signs its certificate with its own CA: with sslmode=verify-full set PGSSLROOTCERT, or let this
# script point it at deploy/supabase-ca.crt when that file exists. Nothing here prints a connection string.
set -euo pipefail

here=$(cd "$(dirname "$0")/.." && pwd)
if [ -z "${PGSSLROOTCERT:-}" ] && [ -f "$here/deploy/supabase-ca.crt" ]; then export PGSSLROOTCERT="$here/deploy/supabase-ca.crt"; fi

redact() { sed -E 's#(postgres(ql)?://[^:/@]+:)[^@]*@#\1[redacted]@#g'; }
say() { printf '%s\n' "$*" | redact; }
die() { say "error: $*" >&2; exit 1; }

# The database named by a URL, and the same URL pointing at the maintenance database instead.
db_of() { local p; p=${1#*://}; p=${p#*/}; p=${p%%\?*}; printf '%s' "$p"; }
admin_url() { local u=$1 name; name=$(db_of "$u"); printf '%s' "${u/\/$name/\/postgres}"; }

DRILL_MARK='preflop-drill scratch'

cmd_dump() {
  local url=$1 out=$2 snapshot=${3:-}
  [ -n "$url" ] && [ -n "$out" ] || die "usage: dump <SOURCE_URL> <file.dump>"
  say "dumping $(db_of "$url") → $out"
  pg_dump --format=custom --compress=6 --no-owner --no-privileges ${snapshot:+--snapshot="$snapshot"} --file="$out" "$url"
  say "dump: $(du -h "$out" | cut -f1), $(pg_restore --list "$out" | grep -c '^[0-9]') objects"
}

cmd_restore() {
  local url=$1 in=$2
  [ -n "$url" ] && [ -f "$in" ] || die "usage: restore <TARGET_URL> <file.dump>"
  local tables; tables=$(psql "$url" -At -c "select count(*) from pg_tables where schemaname = 'public'")
  [ "$tables" = 0 ] || die "target $(db_of "$url") is not empty ($tables tables): restore only into a fresh database"
  say "restoring $in → $(db_of "$url")"
  # --no-owner/--no-privileges: roles differ between hosts. --single-transaction: all or nothing. Exit code
  # 0 only when every object came back.
  pg_restore --no-owner --no-privileges --single-transaction --exit-on-error --dbname="$url" "$in"
}

COUNTS_SQL="select c.relname, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1"
MIGRATIONS_SQL="select string_agg(name, ',' order by name) from schema_migrations"

# Compares a restored database with what the source held: the applied migrations and the row count of
# every table (both as text), plus checks the copy must pass on its own: the ledger sums to zero per
# currency, and every audit event's hash recomputes from its predecessor and its text, the links hold
# and the head is the last event.
verify_against() {
  local dst=$1 migrations=$2 counts=$3 ok=1
  local m2; m2=$(psql "$dst" -At -c "$MIGRATIONS_SQL")
  if [ "$migrations" = "$m2" ]; then say "  migrations: same $(printf '%s' "$migrations" | tr ',' '\n' | wc -l) applied"; else say "  migrations differ"; ok=0; fi
  local c2; c2=$(psql "$dst" -At -F $'\t' -c "$COUNTS_SQL")
  if [ "$counts" = "$c2" ]; then say "  row counts: same across $(printf '%s\n' "$counts" | wc -l) tables ($(printf '%s\n' "$counts" | awk -F'\t' '{s+=$2} END {print s}') rows)"; else say "  row counts differ:"; diff <(printf '%s\n' "$counts") <(printf '%s\n' "$c2") | redact || true; ok=0; fi
  local unbalanced; unbalanced=$(psql "$dst" -At -c "select count(*) from (select currency from ledger_entries group by currency having sum(amount_minor) <> 0) x")
  if [ "$unbalanced" = 0 ]; then say "  ledger: every currency sums to zero"; else say "  ledger: $unbalanced currencies do not sum to zero"; ok=0; fi
  # The hash of every event is sha256(prev_hash || event) (lib/audit.ts); a changed event or a changed
  # hash fails here, a broken link or a wrong head below.
  local bad; bad=$(psql "$dst" -At -c "select count(*) from audit_log where hash <> encode(sha256(convert_to(prev_hash || event, 'UTF8')), 'hex')")
  # Sequence numbers may skip (a rolled-back append consumes one), so the predecessor is the previous row in order.
  local chain; chain=$(psql "$dst" -At -c "select count(*) from (select prev_hash, lag(hash) over (order by seq) as ph from audit_log) x where prev_hash is distinct from coalesce(ph, 'genesis')")
  local head; head=$(psql "$dst" -At -c "select (h.seq = coalesce((select max(seq) from audit_log), 0)) and (h.hash = coalesce((select hash from audit_log order by seq desc limit 1), 'genesis')) from audit_head h")
  if [ "$bad" = 0 ] && [ "$chain" = 0 ] && [ "$head" = t ]; then say "  audit: every event hash recomputes, the chain is intact and the head matches"; else say "  audit: $bad events with a wrong hash, $chain broken links, head ok = $head"; ok=0; fi
  [ "$ok" = 1 ] && say "verify: OK" || die "verify: FAILED"
}

cmd_verify() {
  local src=$1 dst=$2
  [ -n "$src" ] && [ -n "$dst" ] || die "usage: verify <SOURCE_URL> <TARGET_URL>"
  say "verifying $(db_of "$dst") against $(db_of "$src") as it is now (rows written since the dump show as a difference; the drill compares against the dump's own snapshot)"
  verify_against "$dst" "$(psql "$src" -At -c "$MIGRATIONS_SQL")" "$(psql "$src" -At -F $'\t' -c "$COUNTS_SQL")"
}

# One psql session on the source, driven through a coprocess: `src_sql` runs a statement and returns
# its output. The drill opens a REPEATABLE READ transaction in it, exports its snapshot for pg_dump
# and reads the expectations in the same transaction, so a write that lands between the dump and the
# comparison cannot make a good restore look bad.
# psql's errors go to $SRC_ERR, never into a result: a failed statement (psql stops on the first error,
# so the session ends) makes the drill fail with that error, instead of handing the error text on as data.
# Only errors count: a NOTICE or WARNING from a successful statement is shown and the drill goes on
# (the session also asks the server for warnings and up, so routine notices never appear).
src_failed() { grep -qE '^(ERROR|FATAL|PANIC|psql: error|psql:.*: error)' "$SRC_ERR" 2>/dev/null; }
src_sql() {
  if [ -z "${SRC_PID:-}" ] || ! kill -0 "$SRC_PID" 2>/dev/null; then die "source session is gone: $(cat "$SRC_ERR" 2>/dev/null)"; fi
  # Every statement is terminated here: psql would otherwise buffer one without a semicolon into the next.
  printf '%s;\n\\echo __PREFLOP_DONE__\n' "${1%;}" >&"${SRC[1]}"
  local line out="" done=0
  while IFS= read -r line <&"${SRC[0]}"; do
    if [ "$line" = __PREFLOP_DONE__ ]; then done=1; break; fi
    out+="$line"$'\n'
  done
  if src_failed; then die "source query failed: $(cat "$SRC_ERR")"; fi
  [ "$done" = 1 ] || die "source session ended before answering: $(cat "$SRC_ERR")"
  # To stderr: callers capture this function's stdout as the query's value.
  if [ -s "$SRC_ERR" ]; then say "  source said: $(tr -d '\000' <"$SRC_ERR" | paste -sd' ')" >&2; : >"$SRC_ERR"; fi
  printf '%s' "${out%$'\n'}"
}

cmd_drill() {
  local src=$1 scratch=$2 file=${3:-}
  [ -n "$src" ] && [ -n "$scratch" ] || die "usage: drill <SOURCE_URL> <SCRATCH_URL> [file.dump]"
  local name; name=$(db_of "$scratch")
  [ "$name" != "$(db_of "$src")" ] || die "the scratch database must not carry the source's name"
  # The scratch database is dropped and recreated. Only a database this drill created before (marked
  # by its comment), or one that does not exist yet, may be dropped: an alias or other credentials
  # pointing the scratch URL at a real database stop here.
  local admin; admin=$(admin_url "$scratch")
  local mark; mark=$(psql "$admin" -At -c "select coalesce(shobj_description(oid, 'pg_database'), '') from pg_database where datname = '$name'")
  if [ -n "$mark" ] && [ "$mark" != "$DRILL_MARK" ]; then die "scratch database $name exists and was not created by this drill (comment: '$mark'); refusing to drop it"; fi
  if [ -z "$mark" ] && [ "$(psql "$admin" -At -c "select count(*) from pg_database where datname = '$name'")" != 0 ]; then die "scratch database $name exists without the drill marker; refusing to drop it"; fi
  DRILL_TMP=""; if [ -z "$file" ]; then DRILL_TMP=$(mktemp -t preflop-drill-XXXXXX.dump); file=$DRILL_TMP; fi
  local t0; t0=$(date +%s)

  SRC_ERR=$(mktemp -t preflop-drill-err-XXXXXX)
  # Globals on purpose: the trap runs after this function's locals are gone.
  trap 'rm -f "$SRC_ERR" ${DRILL_TMP:+"$DRILL_TMP"}' EXIT
  coproc SRC { PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning" psql "$src" -At -F $'\t' -q -v ON_ERROR_STOP=1 2>"$SRC_ERR"; }
  src_sql "begin isolation level repeatable read read only;" >/dev/null
  local snapshot; snapshot=$(src_sql "select pg_export_snapshot();")
  [ -n "$snapshot" ] || die "could not export a snapshot from the source"
  say "source snapshot $snapshot"
  cmd_dump "$src" "$file" "$snapshot"
  local migrations counts
  migrations=$(src_sql "$MIGRATIONS_SQL")
  counts=$(src_sql "$COUNTS_SQL")
  src_sql "commit;" >/dev/null
  local wfd=${SRC[1]}
  exec {wfd}>&-
  wait "$SRC_PID" 2>/dev/null || true
  if src_failed; then die "source session reported: $(cat "$SRC_ERR")"; fi

  say "recreating scratch database $name"
  psql "$admin" -q -c "drop database if exists \"$name\" with (force)" -c "create database \"$name\"" -c "comment on database \"$name\" is '$DRILL_MARK'"
  cmd_restore "$scratch" "$file"
  say "verifying $name against the source as of the dump's snapshot"
  verify_against "$scratch" "$migrations" "$counts"
  say "drill: restored and verified in $(( $(date +%s) - t0 ))s"
  return 0
}

case "${1:-}" in
  dump) shift; cmd_dump "${1:-}" "${2:-}" ;;
  restore) shift; cmd_restore "${1:-}" "${2:-}" ;;
  verify) shift; cmd_verify "${1:-}" "${2:-}" ;;
  drill) shift; cmd_drill "${1:-}" "${2:-}" "${3:-}" ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac
