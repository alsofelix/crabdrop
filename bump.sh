#!/bin/bash
set -e
bun pm version "$1" --no-git-tag-version
VERSION=$(bun -e "console.log(require('./package.json').version)")
cd src-tauri
cargo bump "$1"
cargo generate-lockfile
cd ..
git add -A
git commit -m "chore: bump to v$VERSION"
git tag "v$VERSION"
echo "Run 'git push && git push origin v$VERSION' to release"