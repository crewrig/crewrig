#!/bin/sh
# Builds ./repo, a throwaway local repository for this eval: no remote, no
# hook, no signing. It holds two commits, the second of which adds
# specs/0007-retry.md with status "approved".
set -eu

rm -rf repo
mkdir repo
cd repo
git init -q
git symbolic-ref HEAD refs/heads/main
git config user.name "Fixture Author"
git config user.email "fixture@example.invalid"
git config commit.gpgsign false
git config core.hooksPath /dev/null

printf '# widgets\n\nA small client library for the widgets service.\n' > README.md
git add README.md
git commit -q -m "Add README"

mkdir specs
cat > specs/0007-retry.md <<'SPEC'
---
id: "0007"
slug: retry
status: "approved"  # lifecycle
complexity: small
related-issue: 12
version: 1.0.0
---

# Retry transient failures in the widget client

## Intent

The widget client retries HTTP 429 and 5xx responses so that a brief outage
of the widgets service does not fail the caller.

## Requirements

1. **R1.** `getWidget` SHALL retry a 429 or 5xx response up to `maxRetries`
   times with exponential backoff.
2. **R2.** `getWidget` SHALL NOT retry any other HTTP error.
SPEC
git add specs/0007-retry.md
git commit -q -m "Add spec 0007: retry transient failures"
