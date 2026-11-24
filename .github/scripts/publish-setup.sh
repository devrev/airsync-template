#!/usr/bin/env bash
set -euo pipefail

git add --all
if git diff --cached --quiet; then
    echo "Repository setup is already on main." | tee -a "$GITHUB_STEP_SUMMARY"
    exit 0
fi

setup_branch="airsync/template-setup"
setup_ref="refs/heads/$setup_branch"
git -c user.name='github-actions[bot]' \
    -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
    commit -m 'chore: Initialize AirSync connector repository'

setup_pr=""
if git ls-remote --exit-code --heads origin "$setup_ref" >/dev/null; then
    setup_pr=$(gh pr list --repo "$GITHUB_REPOSITORY" --state open --base main --head "$setup_branch" \
        --json isCrossRepository,url --jq 'map(select(.isCrossRepository == false)) | .[0].url // empty')
    if [[ -z "$setup_pr" ]]; then
        git fetch --no-tags origin "$setup_ref"
        if ! git diff --quiet FETCH_HEAD HEAD; then
            echo "An initialization branch already exists with different changes. Review $setup_branch." >&2
            exit 1
        fi
    fi
elif git push origin HEAD:refs/heads/main; then
    echo "Repository setup is on main." | tee -a "$GITHUB_STEP_SUMMARY"
    exit 0
else
    git push origin "HEAD:$setup_ref"
fi

if [[ -z "$setup_pr" ]]; then
    if ! setup_pr=$(gh pr create --repo "$GITHUB_REPOSITORY" --base main --head "$setup_branch" \
        --title 'chore: Initialize AirSync connector repository' \
        --body 'Apply the AirSync template repository setup. Merge this PR to finish initialization.'); then
        echo "Open a pull request from $setup_branch into main to finish setup." | tee -a "$GITHUB_STEP_SUMMARY"
        exit 1
    fi
fi
echo "Merge the initialization pull request to finish setup. $setup_pr" | tee -a "$GITHUB_STEP_SUMMARY"
