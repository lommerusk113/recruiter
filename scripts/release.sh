#!/usr/bin/env bash
# Publishes a new version: bumps the patch version, rebuilds, commits and pushes.
# Greasy Fork picks the new version up from the raw GitHub URL of dist/recruiter.user.js
# (set as the script's sync URL on greasyfork.org).
set -euo pipefail
cd "$(dirname "$0")/.."

new=$(npm version patch --no-git-tag-version)
new=${new#v}
sed -i '' -E "s|(// @version[[:space:]]+).*|\1${new}|" src/header.txt

npm run build

git add -A
git commit -m "## - Release v${new}"
git push

echo "v${new} pushed — Greasy Fork will sync it from:"
echo "https://raw.githubusercontent.com/lommerusk113/recruiter/main/dist/recruiter.user.js"
