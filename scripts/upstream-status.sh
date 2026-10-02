#!/usr/bin/env bash
# For each mod in upstreams.tsv: the upstream commit it was last synced from, upstream commits since,
# the paths changed locally and upstream, and the paths changed on both sides. Read-only apart from
# `git fetch` into FETCH_HEAD; it never pulls, merges or edits a mod.

set -euo pipefail

if [[ $# -gt 1 ]]; then
  echo "usage: $0 [cc-mods checkout]" >&2
  exit 64
fi

REPO="${1:-$(cd "$(dirname "$0")/.." && pwd -P)}"
REGISTRY="$REPO/upstreams.tsv"
[[ -f "$REGISTRY" ]] || { echo 'error=registry-missing' >&2; exit 66; }
git -C "$REPO" rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo 'error=not-git-repository' >&2
  exit 68
}

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT
FAILED=0

count() { awk 'END {print NR+0}' "$1"; }
list() {
  local key="$1" file="$2"
  while IFS= read -r line; do
    if [[ -n "$line" ]]; then printf '%s=%s\n' "$key" "$line"; fi
  done < "$file"
}

while IFS=$'\t' read -r name url branch <&3 || [[ -n "${name:-}" ]]; do
  [[ -z "$name" || "$name" == \#* ]] && continue
  printf 'mod=%s\n' "$name"
  if [[ ! "$name" =~ ^[a-z0-9][a-z0-9-]*$ || -z "${url:-}" || -z "${branch:-}" ]]; then
    echo 'error=registry-line-invalid'
    FAILED=1
    continue
  fi
  prefix="mods/$name"

  # The latest squash commit for this prefix: its tree is the upstream content as synced, and its
  # git-subtree-split trailer names the upstream commit.
  squash="$(git -C "$REPO" log -1 --format=%H -E --grep="^git-subtree-dir: $prefix/?$" HEAD)"
  if [[ -z "$squash" ]]; then
    echo 'error=no-subtree-commit'
    FAILED=1
    continue
  fi
  synced="$(git -C "$REPO" log -1 --format=%B "$squash" | sed -n 's/^git-subtree-split: //p' | head -1)"
  printf 'synced=%s\n' "$synced"

  if ! git -C "$REPO" diff --name-only "$squash" "HEAD:$prefix" > "$SCRATCH/diff" 2>/dev/null; then
    echo 'error=mod-dir-missing'
    FAILED=1
    continue
  fi
  LC_ALL=C sort -u "$SCRATCH/diff" > "$SCRATCH/local"
  printf 'local_path_count=%s\n' "$(count "$SCRATCH/local")"
  list local_path "$SCRATCH/local"

  if ! git -C "$REPO" fetch --quiet --no-tags "$url" "$branch" 2>"$SCRATCH/fetch.err"; then
    echo 'error=fetch-failed'
    FAILED=1
    continue
  fi
  head="$(git -C "$REPO" rev-parse FETCH_HEAD)"
  printf 'upstream_head=%s\n' "$head"
  if ! git -C "$REPO" merge-base --is-ancestor "$synced" "$head" 2>/dev/null; then
    echo 'error=synced-commit-not-in-upstream'
    FAILED=1
    continue
  fi

  git -C "$REPO" log --format='%h %s' "$synced..$head" > "$SCRATCH/commits"
  printf 'new_commit_count=%s\n' "$(count "$SCRATCH/commits")"
  list new_commit "$SCRATCH/commits"

  git -C "$REPO" diff --name-only "$synced" "$head" | LC_ALL=C sort -u > "$SCRATCH/upstream"
  comm -12 "$SCRATCH/local" "$SCRATCH/upstream" > "$SCRATCH/overlap"
  printf 'upstream_path_count=%s\n' "$(count "$SCRATCH/upstream")"
  printf 'overlap_count=%s\n' "$(count "$SCRATCH/overlap")"
  list overlap_path "$SCRATCH/overlap"
done 3< "$REGISTRY"

exit "$FAILED"
