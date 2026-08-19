#!/usr/bin/env bash
# The uploads directory was committed once before the images and videos were
# re-encoded, so git stores both versions — about 185 MB of dead weight in every
# clone. This replays the branch with the *final* uploads tree in every commit, so
# the media is stored once while the commit messages and authorship are untouched.
#
# Safe to run only before the branch has been pushed anywhere.
#
#   bash scripts/dedupe-media-history.sh
set -euo pipefail

cd "$(dirname "$0")/.."
BRANCH=$(git rev-parse --abbrev-ref HEAD)
UPLOADS=public/wp-content/uploads
FINAL_TREE=$(git rev-parse "HEAD:$UPLOADS")

echo "replaying $BRANCH with $UPLOADS pinned to $FINAL_TREE"

parent=""
SCRATCH_INDEX=".git/dedupe-index"
export GIT_INDEX_FILE="$SCRATCH_INDEX"
trap 'rm -f "$SCRATCH_INDEX"' EXIT

for commit in $(git rev-list --reverse "$BRANCH"); do
  rm -f "$GIT_INDEX_FILE"
  git read-tree "$commit"
  git rm -r --cached -q --ignore-unmatch "$UPLOADS"
  git read-tree --prefix="$UPLOADS" "$FINAL_TREE"
  tree=$(git write-tree)

  message=$(git log -1 --format=%B "$commit")
  new=$(
    GIT_AUTHOR_NAME=$(git log -1 --format=%an "$commit") \
    GIT_AUTHOR_EMAIL=$(git log -1 --format=%ae "$commit") \
    GIT_AUTHOR_DATE=$(git log -1 --format=%aI "$commit") \
    GIT_COMMITTER_NAME=$(git log -1 --format=%cn "$commit") \
    GIT_COMMITTER_EMAIL=$(git log -1 --format=%ce "$commit") \
    GIT_COMMITTER_DATE=$(git log -1 --format=%cI "$commit") \
    git commit-tree "$tree" ${parent:+-p "$parent"} -m "$message"
  )
  parent=$new
done

unset GIT_INDEX_FILE
git reset --hard "$parent" >/dev/null
git reflog expire --expire=now --all
git gc --prune=now --quiet
echo "done — .git is now $(du -sh .git | cut -f1)"
