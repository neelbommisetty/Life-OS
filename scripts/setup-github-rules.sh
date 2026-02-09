#!/usr/bin/env bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required."
  exit 1
fi

repo="${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
owner="${repo%/*}"
name="${repo#*/}"

main_sha="$(gh api "repos/${owner}/${name}/branches/main" --jq .commit.sha)"

if ! gh api "repos/${owner}/${name}/branches/develop" >/dev/null 2>&1; then
  gh api -X POST "repos/${owner}/${name}/git/refs" \
    -f ref="refs/heads/develop" \
    -f sha="${main_sha}" >/dev/null
fi

gh repo edit "${repo}" --default-branch develop

remove_branch_protection() {
  local branch="$1"
  local output

  if output="$(gh api -X DELETE "repos/${owner}/${name}/branches/${branch}/protection" \
    -H "Accept: application/vnd.github+json" 2>&1 >/dev/null)"; then
    echo "  ${branch}: removed"
    return 0
  fi

  if [[ "${output}" == *"Branch not protected"* ]] || [[ "${output}" == *"404"* ]]; then
    echo "  ${branch}: already unprotected"
    return 0
  fi

  if [[ "${output}" == *"Upgrade to GitHub Pro"* ]]; then
    echo "  ${branch}: branch protection unavailable on current GitHub plan"
    return 0
  fi

  echo "${output}" >&2
  return 1
}

echo "Default branch set to develop."
echo "Branch protections:"
remove_branch_protection develop
remove_branch_protection main
