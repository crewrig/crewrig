---
id: "0249"
slug: hook-jq-resolution
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1494
version: 1.0.0
---

# Hook jq resolution verification and non-abort execution guard

## Intent

An agent working in a workspace that ships a broken same-named command ahead
of the real one on its command lookup path no longer sees a failed-hook
warning repeated on every tool call and model completion, and no longer
silently loses the recording of its session because of that collision. Each
hook that reads a payload first confirms that the command it found actually
works, and a later failure of that command never ends the agent's turn.

## Requirements

1. Every hook that invokes `jq` — `hooks/mempalace-transcript.sh`,
   `hooks/worktree-git-guard.sh`, `hooks/antigravity-statusline-shim.sh` —
   SHALL resolve `jq` through the ordinary `PATH` lookup and SHALL verify,
   once per run and before parsing any payload, that the resolved
   implementation answers `jq --version` with exit status 0.
2. A `jq` that is absent from `PATH` entirely SHALL keep its current
   outcome in `hooks/mempalace-transcript.sh`: the hook exits with status
   code 0 and names the missing dependency on stderr.
3. When the resolved `jq` does not answer `jq --version` with exit status
   0, `hooks/mempalace-transcript.sh` SHALL NOT parse the payload and
   SHALL exit with status code 0.
4. When the resolved `jq` does not answer `jq --version` with exit status
   0, `hooks/worktree-git-guard.sh` SHALL NOT block the tool call it
   guards and SHALL exit with status code 0.
5. When the resolved `jq` does not answer `jq --version` with exit status
   0, `hooks/antigravity-statusline-shim.sh` SHALL behave exactly as it
   does when no prior statusline command is recorded: nothing on stdout,
   the capture step still runs, exit status 0.
6. A `jq` invocation that fails at any point after resolution — including
   one that crashes at invocation — SHALL NOT abort a hook: each of the
   three hooks SHALL reach exit status 0, and `hooks/mempalace-transcript.sh`
   SHALL keep its documented contract that a failed persistence never
   fails the agent's turn.
7. A hook that exits with status code 0 under requirements 3 to 6 SHALL
   surface no failed-hook banner in the host CLIs for that event.
8. The payload schemas, the hook events handled, and the persistence each
   of the three hooks performs SHALL be unchanged.
9. The regression suite SHALL cover three cases per hook: a verified `jq`
   that parses and persists with exit 0; a `jq` that fails `jq --version`
   and yields exit 0 with no parse and no banner; a verified `jq` that
   fails at a later call site and still yields exit 0.

## Scenarios

**Scenario:** Verified jq parses and persists the payload

```text
Given a hook run whose PATH resolves to a working jq
When  a transcript event payload is piped to hooks/mempalace-transcript.sh
Then  the payload is parsed and persisted as today, and the hook exits 0.
```

**Scenario:** Shadowed jq no longer aborts the hook

```text
Given a workspace whose node_modules/.bin/jq shadows the system jq and crashes at invocation
When  an AfterModel or AfterTool event fires and pipes its payload to hooks/mempalace-transcript.sh
Then  the hook exits 0 without parsing, and no failed-hook banner is shown to the agent.
```

**Scenario:** Verified jq fails at a later call site

```text
Given a hook run whose jq answers jq --version
When  a later jq invocation during parsing fails or crashes
Then  the hook still exits 0 and the agent's turn is not failed.
```

**Scenario:** Guard hook stays permissive without a verified jq

```text
Given a worktree-git-guard run whose jq fails the jq --version check
When  a git tool call is piped to hooks/worktree-git-guard.sh
Then  the tool call is not blocked by the missing verification and the hook exits 0.
```

## Out of scope

- Probing canonical system directories ahead of `PATH` to locate the real
  `jq`. The resolution policy stays `PATH`-only, with verification; this
  exclusion is deliberate, not an oversight.
- `hooks/usage-capture.sh`, which names `jq` only inside a comment and
  never invokes it.
- Removing `jq` from any hook, or changing which hooks invoke it.
- Changing the payload schema, the handled events, or the persistence
  target of the three hooks.
- The downstream workspace's package tree and the shadowing package itself.
- Hook manifest and event-registration changes in
  `hooks/*-transcript-hooks.json`.
- The MemPalace persistence transport (daemon reachability, HTTP path).

## Open questions

None.
