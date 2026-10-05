#!/usr/bin/env bash
# PreFlop database backup, restore and restore drill (docs/18 §Backups and restore drill).
#
#   scripts/db-backup.sh dump    <SOURCE_URL> <file.dump>        pg_dump, custom format, compressed
#   scripts/db-backup.sh restore <TARGET_URL> <file.dump>        pg_restore into an existing, empty database
#   scripts/db-backup.sh verify  <SOURCE_URL> <TARGET_URL>       the restored copy matches the source
#   scripts/db-backup.sh drill   <SOURCE_URL> <SCRATCH_URL> [file.dump]
#       dump the source, restore it into the scratch database (dropped and recreated), verify, report.
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

cmd_dump() {
  local url=$1 out=$2
  [ -n "$url" ] && [ -n "$out" ] || die "usage: dump <SOURCE_URL> <file.dump>"
  say "dumping $(db_of "$url") → $out"
  pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$out" "$url"
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

# Prints "name<TAB>count" for every public table, ordered. Ledger and audit checks follow.
counts() { psql "$1" -At -F $'\t' -c "select c.relname, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1"; }

cmd_verify() {
  local src=$1 dst=$2 ok=1
  [ -n "$src" ] && [ -n "$dst" ] || die "usage: verify <SOURCE_URL> <TARGET_URL>"
  say "verifying $(db_of "$dst") against $(db_of "$src")"
  local m1 m2; m1=$(psql "$src" -At -c "select string_agg(name, ',' order by name) from schema_migrations"); m2=$(psql "$dst" -At -c "select string_agg(name, ',' order by name) from schema_migrations")
  if [ "$m1" = "$m2" ]; then say "  migrations: same $(printf '%s' "$m1" | tr ',' '\n' | wc -l) applied"; else say "  migrations differ"; ok=0; fi
  local c1 c2; c1=$(counts "$src"); c2=$(counts "$dst")
  if [ "$c1" = "$c2" ]; then say "  row counts: same across $(printf '%s\n' "$c1" | wc -l) tables ($(printf '%s\n' "$c1" | awk -F'\t' '{s+=$2} END {print s}') rows)"; else say "  row counts differ:"; diff <(printf '%s\n' "$c1") <(printf '%s\n' "$c2") | redact || true; ok=0; fi
  local unbalanced; unbalanced=$(psql "$dst" -At -c "select count(*) from (select currency from ledger_entries group by currency having sum(amount_minor) <> 0) x")
  if [ "$unbalanced" = 0 ]; then say "  ledger: every currency sums to zero"; else say "  ledger: $unbalanced currencies do not sum to zero"; ok=0; fi
  local chain; chain=$(psql "$dst" -At -c "select count(*) from audit_log a left join audit_log p on p.seq = a.seq - 1 where a.seq > 1 and a.prev_hash <> p.hash")
  local head; head=$(psql "$dst" -At -c "select (h.seq = coalesce((select max(seq) from audit_log), 0)) and (h.hash = coalesce((select hash from audit_log order by seq desc limit 1), 'genesis')) from audit_head h")
  if [ "$chain" = 0 ] && [ "$head" = t ]; then say "  audit: hash chain intact and the head matches"; else say "  audit: $chain broken links, head ok = $head"; ok=0; fi
  [ "$ok" = 1 ] && say "verify: OK" || die "verify: FAILED"
}

cmd_drill() {
  local src=$1 scratch=$2 file=${3:-}
  [ -n "$src" ] && [ -n "$scratch" ] || die "usage: drill <SOURCE_URL> <SCRATCH_URL> [file.dump]"
  [ "$(db_of "$src")" != "$(db_of "$scratch")" ] || [ "${src%%\?*}" != "${scratch%%\?*}" ] || die "the scratch database must not be the source"
  local tmp=""; if [ -z "$file" ]; then tmp=$(mktemp -t preflop-drill-XXXXXX.dump); file=$tmp; fi
  local t0; t0=$(date +%s)
  cmd_dump "$src" "$file"
  local name; name=$(db_of "$scratch")
  say "recreating scratch database $name"
  psql "$(admin_url "$scratch")" -q -c "drop database if exists \"$name\" with (force)" -c "create database \"$name\""
  cmd_restore "$scratch" "$file"
  cmd_verify "$src" "$scratch"
  say "drill: restored and verified in $(( $(date +%s) - t0 ))s"
  [ -n "$tmp" ] && rm -f "$tmp"
  return 0
}

case "${1:-}" in
  dump) shift; cmd_dump "${1:-}" "${2:-}" ;;
  restore) shift; cmd_restore "${1:-}" "${2:-}" ;;
  verify) shift; cmd_verify "${1:-}" "${2:-}" ;;
  drill) shift; cmd_drill "${1:-}" "${2:-}" "${3:-}" ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac
