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

protect_branch() {
  local branch="$1"
  local contexts_json="$2"

  local payload
  payload="$(cat <<JSON
{
  "required_status_checks": {
    "strict": true,
    "contexts": ${contexts_json}
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0
  },
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "restrictions": null
}
JSON
)"

  local output
  if ! output="$(gh api -X PUT "repos/${owner}/${name}/branches/${branch}/protection" \
    -H "Accept: application/vnd.github+json" \
    --input - <<<"${payload}" 2>&1 >/dev/null)"; then
    if [[ "${output}" == *"Upgrade to GitHub Pro"* ]]; then
      echo "Skipping protection for ${branch}: GitHub plan does not allow branch protection on this private repo."
      return 2
    fi
    echo "${output}" >&2
    return 1
  fi
}

develop_status="applied"
main_status="applied"

if ! protect_branch develop '["unit-tests"]'; then
  develop_status="skipped"
fi

if ! protect_branch main '["unit-tests","e2e-tests"]'; then
  main_status="skipped"
fi

echo "Default branch set to develop."
echo "Branch protections:"
echo "  develop (${develop_status}) => PR required + unit-tests (no approval required)"
echo "  main (${main_status}) => PR required + unit-tests + e2e-tests (no approval required)"
