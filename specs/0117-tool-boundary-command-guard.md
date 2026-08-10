---
id: "0117"
slug: tool-boundary-command-guard
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 771
version: 1.0.0
---

# A prohibited command is refused before it runs, on every supported CLI

## Intent

The repository has obligations that can only be honoured *before* a command
executes, and today nothing can refuse one. `specs/0114-shared-worktree-agent-isolation.md`
R2 forbids a whole-tree git operation in a shared worktree without an exclusive
claim; an agent that types `git reset --hard` into its own shell tool call still
runs it, and the residual enforcement is a REVIEW-stage audit *after* the changes
are gone. `#766` needs the same thing at a different moment — refusing a spec-PR
merge whose spec still says `draft`.

Both are one missing surface: a guard at the tool boundary that can deny. This
spec adds that surface **once**, driven by a table of rules, so that the second
obligation is a table entry rather than a second mechanism. Which prohibitions
ride on it is deliberately not this spec's subject; that a new prohibition costs a
row and not an architecture is.

The surface exists on all four supported CLIs. That is measured, not assumed, and
it is what makes this spec an implementation rather than a parity negotiation.

## Requirements

1. This spec SHALL declare `complexity: standard`. It introduces a new
   enforcement surface deployed per CLI across all four supported CLIs, each with
   its own event name, configuration location and output contract, and it obliges
   a `docs/cli-matrix.md` row — the coordination `AGENTS.md` → *CLI Matrix
   Maintenance* governs. The `small`-tier composition in *Team sizing by
   complexity* excludes `architect`, and a first-of-its-kind enforcement surface
   is exactly the case *Standard Team Templates → Template 2* reserves
   `architect` for.
2. A prohibited operation SHALL be refused **before it executes**, on each of
   Claude Code, Gemini CLI, GitHub Copilot CLI and Antigravity CLI, through that
   CLI's own before-tool event. **Gap-acceptance evidence SHALL NOT be admitted
   for this capability on any of the four**, because the capability is documented
   on all four; the accepted forms in `docs/cli-matrix-maintenance.md` apply to an
   absent mechanism, and none is absent here:
   - Claude Code — `PreToolUse`, denied by `permissionDecision: "deny"`, and exit
     code 2 also blocks the call.
   - Gemini CLI — `BeforeTool` ("Fires before a tool is invoked"), denied by
     `decision: "deny"` (alias `"block"`), and exit code 2 "Prevents execution".
   - GitHub Copilot CLI — `preToolUse` ("Before each tool executes"), denied by
     `permissionDecision: "deny"`.
   - Antigravity CLI — `PreToolUse` ("Before a tool step executes"), denied by
     `decision: "deny"`, documented as "Hard block the execution immediately".
3. The set of prohibited operations SHALL be **data, not decision logic**. Adding
   a prohibition SHALL NOT require editing the guard's decision path, so a second
   obligation — the spec-PR merge guard of `#766` being the known next one — costs
   a rule and not a mechanism. A change that adds a prohibition by branching
   inside the guard fails this requirement even if it works.
4. For each rule, the decision SHALL be **delegated to the authority that already
   owns that obligation**, never re-derived inside the guard. For the prohibitions
   of `specs/0114` that authority is `scripts/worktree-claim.sh`, whose
   `status --ticket <id>` reports the holder and whose clean-tree gate is
   evaluated on every operation. A guard that inspects `git status` itself
   acquires a second source of truth to keep in sync, and the repository would
   then have two answers to one question.
5. The guarantee SHALL be recorded **per CLI, not averaged across them**. Where a
   CLI's documented behaviour weakens enforcement, that CLI's actual guarantee
   SHALL be stated in `docs/cli-matrix.md` and SHALL NOT be presented as
   equivalent to the others. One instance is already known and is not a defect
   this spec can fix: Copilot CLI documents that "Command hook timeouts are always
   fail-open, even for `preToolUse` and admin-deployed policy hooks", so a slow or
   unreachable guard there allows the operation. A guard that fails open while
   being described as protection is worse than no guard, so the description is
   part of the deliverable.
6. A rule the guard **cannot evaluate** SHALL deny only the operation that rule
   matched, and SHALL NOT deny a tool call no rule matches. An unreachable
   authority, a malformed decision, or a crash in one rule's evaluation SHALL
   leave every unmatched tool call unaffected. This is the failure mode with the
   worst blast radius available here: `agy`'s `PreToolUse` documents `decision` as
   a **required** field, and an upstream report exists of a stricter-than-expected
   contract causing *every* tool call to be denied, which ends a session rather
   than protecting a worktree.
7. The guard SHALL complete within a stated latency budget, and that budget SHALL
   be **measured on the real call path** rather than asserted. Two documented
   properties make latency load-bearing rather than cosmetic: on Copilot CLI a
   timeout is a silent allow (requirement 5), and on Antigravity CLI "Hooks run
   synchronously and block the agent loop" with a handler `timeout` defaulting to
   30 seconds, so a slow guard is charged to every tool call the matcher admits.
8. The Antigravity handler SHALL satisfy that CLI's own contract as installed
   with the CLI, and the contract SHALL be cited from
   `~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/hooks.md`
   rather than from the public web page, because the installed copy is versioned
   with the binary in use. Four properties of that contract are load-bearing and
   differ from the sibling CLIs:
   - the file's top level is a map of **named** hooks, `{"<name>": {"<Event>": …}}`;
   - `PreToolUse` is **grouped** — `[{"matcher": "<regex>", "hooks": [handler, …]}]`
     — while `PreInvocation`, `PostInvocation` and `Stop` are flat, so a handler
     written at the group level is loaded and never run;
   - a handler's working directory "is set to the directory containing
     `hooks.json`", so a project-relative command path SHALL NOT be used;
   - payload keys are camelCase (protojson), and the payload carries no event
     name, so the event SHALL be passed to the handler explicitly if it needs to
     know.
9. Before the guard is declared shipped on a CLI, its denial SHALL be confirmed
   **empirically on that CLI** — a prohibited operation attempted and observed to
   be refused — and the reproduction recorded. Documentation establishes that the
   mechanism exists; only a run establishes that this guard denies through it.
   The location the guard is installed at SHALL be one whose firing was part of
   that confirmation, since a declared-but-silent hook is indistinguishable from
   an absent one.
10. The change SHALL add a `docs/cli-matrix.md` row for the guard in the same
    diff, per `AGENTS.md` → *CLI Matrix Maintenance*, carrying the per-CLI event
    name, configuration location, and the guarantee of requirement 5.
11. The guard SHALL be covered by a regression suite with at least one case for
    each of: a prohibited operation denied; a permitted operation allowed; an
    unmatched tool call allowed while a rule's authority is unreachable
    (requirement 6); and a second rule added as data alone (requirement 3). Each
    case SHALL fail if the behaviour it covers is removed.

## Scenarios

**Scenario:** a prohibited whole-tree operation is refused

```text
Given a shared worktree whose exclusive claim is held by another agent
When  an agent issues a whole-tree git operation in that worktree
Then  the guard denies the tool call before it executes
And   the reason names the claim holder
```

**Scenario:** the same operation is allowed to the claim holder over a clean tree

```text
Given a shared worktree whose exclusive claim the acting agent holds
And   the worktree carries no uncommitted change
When  that agent issues a whole-tree git operation in that worktree
Then  the guard allows the tool call
```

**Scenario:** an unevaluable rule does not deny unrelated work

```text
Given the authority a rule delegates to cannot be reached
When  an agent issues a tool call that no rule matches
Then  the guard allows it
And   the tool calls that rule does match are denied
```

**Scenario:** a second prohibition costs a rule, not a mechanism

```text
Given the guard is in force with one rule
When  a second prohibition is added to the rule table
Then  no edit to the guard's decision path is required
```

**Scenario:** the guarantee is not overstated on a fail-open CLI

```text
Given a CLI documented to allow a tool call when a hook times out
When  the cli-matrix row for the guard is read
Then  it states that CLI's guarantee as best-effort rather than as enforcement
```

## Out of scope

- **The spec-PR `draft` merge prohibition itself** (`#766`). It is the intended
  second consumer of this surface and the reason requirement 3 exists, but which
  rules ride on the guard is a separate decision per rule. Landing it here would
  couple two obligations whose authorities differ.
- **Amending `specs/0114-shared-worktree-agent-isolation.md`.** Its R2–R5 already
  state the prohibition and the claim; this spec adds the surface that can refuse,
  and changes no obligation.
- **The event-vocabulary mismatch in `hooks/antigravity-transcript-hooks.json`**,
  which declares Gemini's `BeforeAgent`/`AfterTool`/`AfterModel`/`SessionEnd`
  against Antigravity's documented `PreToolUse`/`PostToolUse`/`PreInvocation`/
  `PostInvocation`/`Stop`. Owned by `#724`. Requirement 8 exists so this spec's
  handler does not inherit that shape.
- **Making Copilot CLI's fail-open timeout fail closed.** Vendor behaviour, not
  ours to change. Requirement 5 obliges disclosure, which is the part within
  reach.
- **Operations issued through a path the before-tool event does not see** — an MCP
  server that runs git internally, a command inside a script the guard allowed.
  The guard covers the tool boundary it is attached to, and claiming more than
  that would be the overstatement requirement 5 forbids.
- **Any prohibition unrelated to a documented obligation.** The rule table is not
  a general policy engine; each rule traces to a requirement in a merged spec.

## Open questions

None.
