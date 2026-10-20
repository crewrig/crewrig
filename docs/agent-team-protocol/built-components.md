# Agent Team Protocol — Built Components

<!-- crewrig-doc: published=false -->
<!-- markdownlint-disable MD033 -->

<a id="built-components"></a>

## Built Components

Source files under `artifacts/` are compiled into `.gemini/` and `.claude/` by `scripts/build-components.ts` (`scripts/build-components.ts` forwards to it). The CI `check-components` job fails if the built outputs drift from sources.

**Rule:** any commit that modifies a file under `artifacts/` MUST also run the build (invocation below) and stage the regenerated outputs in the same commit or an immediately following one — never deferred to a separate PR.

**Invocation:** two separate steps, never chained with `&&` (the PowerShell 5.1 rule of [`docs/ticket-ownership.md`](../ticket-ownership.md)):

```sh
node scripts/lib/node-floor-guard.js
node scripts/build-components.ts
```

The build needs Node.js 24 or newer (the first step refuses an older Node.js with a diagnostic) and `js-yaml`, which the setup dependency step installs; there is no `yq` requirement.

**Verify before push:** run the same two steps after staging. A clean `git status --porcelain` means no drift.

This rule applies to every role — doc-writer edits to `SKILL.md`, architect edits to `AGENT.md`, and pr-reviewer self-edits all count. The CI job is a backstop; this rule closes the loop before push.
