#!/bin/bash
# Block commits if any package.json exports contain ./dist/ paths.
# vp pack rewrites exports from ./src/*.ts to ./dist/*.mjs which
# breaks workspace resolution. This must never be committed.

found=0
for file in packages/*/package.json; do
  if grep -q '"./dist/' "$file" 2>/dev/null; then
    echo "BLOCKED: $file contains ./dist/ in exports. Run: git checkout -- $file" >&2
    found=1
  fi
done

if [ $found -eq 1 ]; then
  echo "" >&2
  echo "vp pack rewrites exports to dist paths. Restore source paths before committing." >&2
  exit 2
fi
