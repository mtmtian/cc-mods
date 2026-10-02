#!/usr/bin/env bash
# Builds a throwaway upstream and a cc-mods-shaped repo holding it as a squashed subtree, then checks
# what upstream-status.sh reports as the upstream moves, the mod is synced, and both sides touch a file.

set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd -P)/upstream-status.sh"
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
UP="$ROOT/upstream"
REPO="$ROOT/cc-mods"
export GIT_AUTHOR_NAME=fixture GIT_AUTHOR_EMAIL=fixture@example.invalid
export GIT_COMMITTER_NAME=fixture GIT_COMMITTER_EMAIL=fixture@example.invalid

fail() { echo "FAIL: $1" >&2; printf '%s\n' "$OUT" >&2; exit 1; }
expect() { grep -qxF "$1" <<<"$OUT" || fail "missing line: $1"; }
reject() { if grep -q "$1" <<<"$OUT"; then fail "unexpected: $1"; fi; }
run() { OUT="$(bash "$SCRIPT" "$REPO")" || fail "exit $?"; }

git init -q -b main "$UP"
for f in a.txt b.txt c.txt; do echo base > "$UP/$f"; done
git -C "$UP" add . && git -C "$UP" commit -qm base
BASE="$(git -C "$UP" rev-parse HEAD)"

git init -q -b main "$REPO"
printf 'demo\tfile://%s\tmain\n' "$UP" > "$REPO/upstreams.tsv"
git -C "$REPO" add . && git -C "$REPO" commit -qm init
git -C "$REPO" subtree add -q --prefix=mods/demo "file://$UP" main --squash >/dev/null 2>&1
echo local >> "$REPO/mods/demo/a.txt"
echo local >> "$REPO/mods/demo/b.txt"
git -C "$REPO" commit -qam "local change"

# 1. upstream unchanged: local paths listed, nothing new, no overlap
run
expect "mod=demo"
expect "synced=$BASE"
expect "local_path_count=2"
expect "local_path=a.txt"
expect "local_path=b.txt"
expect "new_commit_count=0"
expect "overlap_count=0"

# 2. upstream touches only c.txt: one new commit, still no overlap
echo up >> "$UP/c.txt" && git -C "$UP" commit -qam "upstream c"
C1="$(git -C "$UP" rev-parse HEAD)"
run
expect "new_commit_count=1"
expect "new_commit=$(git -C "$UP" rev-parse --short "$C1") upstream c"
expect "overlap_count=0"

# 3. after a squash pull, the newest squash commit is the sync point
git -C "$REPO" subtree pull -q --prefix=mods/demo "file://$UP" main --squash -m "sync demo" >/dev/null 2>&1
run
expect "synced=$C1"
expect "new_commit_count=0"
expect "local_path_count=2"

# 4. upstream touches a.txt, which the fork changed too: reported as overlap
echo up >> "$UP/a.txt" && git -C "$UP" commit -qam "upstream a"
run
expect "new_commit_count=1"
expect "overlap_count=1"
expect "overlap_path=a.txt"
reject "overlap_path=b.txt"

# 5. a registry line with no subtree behind it is an error and a non-zero exit, other mods still reported
printf 'ghost\tfile://%s\tmain\n' "$UP" >> "$REPO/upstreams.tsv"
set +e
OUT="$(bash "$SCRIPT" "$REPO")"
status=$?
set -e
[[ $status -ne 0 ]] || fail "expected non-zero exit for a missing mod"
expect "mod=ghost"
expect "error=no-subtree-commit"
expect "overlap_path=a.txt"

echo "upstream-status: all checks passed"
