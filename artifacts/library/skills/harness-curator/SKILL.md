---
name: harness-curator
description: 'Reads the friction tags that agents filed in the harness-friction wing, clusters them, and opens one evidence-backed feedback issue per cluster on the repositories named in the components'' provenance, after a health check of the wing. Also sweeps transcripts for untagged frictions (`--deep`) and runs on a schedule. Use when the user explicitly asks to curate, sweep or cluster frictions, to open the feedback issues, to check the health of the friction wing or to schedule the curator. Trigger terms: harness curator, curate frictions, friction wing, feedback issues, deep sweep. Not for tagging a single friction (harness-report) or for ordinary bug reports.'
type: skill
license: Apache-2.0
compatibility: Requires Node.js 24 or later, a forge CLI (setup-labels.ts uses gh; --apply selects gh, glab, or tea per the target repository's forge), and the mempalace Python package (pipx install 'mempalace>=3.6.0,<3.7').
metadata:
  provenance:
    canonical: "${CANONICAL_REPO}"
    feedback: "${CANONICAL_REPO}"
    version: "2.1.0"
claude:
  allowed-tools:
    - Read
    - Bash
    - Grep
    - Glob
  user-invocable: true
---

# Harness Curator

Closes the feedback loop: the frictions that agents tagged during real work become one descriptive issue per
cluster, on the repository that owns the offending component. The issue carries evidence, not a fix; the fix
lands later as a human-authored change that closes it.

## When to run it

Only on an explicit request: the user runs `/harness-curate`, asks what frictions the crew has accumulated,
asks for a deep sweep, or a schedule triggers it. During unrelated work, reaching for this skill means you are
off task.

## The script

Reading the wing through MCP would take thousands of calls, so a bundled script reads it with the MemPalace
Python library, parses every `FRICTION:` payload and clusters them. Run it from the skill directory (or
`task harness-curate -- <options>`); `node scripts/curate.ts --help` lists every option.

Exit codes of `curate.ts`: `0` ok, `1` a usage error or an unhealthy `--check`, `2` python or MemPalace not
found (or the backend failed), `3` `--apply` without an authenticated forge CLI. A usage error prints
`Error:` or `Unknown option` on stderr, which tells it from an unhealthy wing.

Test mode: `--from-stdin` reads a JSON list of drawers (`drawer_id`, `room`, `content`) instead of MemPalace,
so a dry run needs no server and no forge. `assets/sample-frictions.json` is a sample.

## Step 1: dry run and health gate

```sh
node scripts/curate.ts --check
```

It runs a dry run and prints `healthy` or `unhealthy`: exit `0` healthy, exit `1` when `skipped_malformed`
exceeds 25 percent of the drawers (`--max-malformed-ratio` moves the limit) or `routing_failures` is above
zero. An unhealthy wing means the filing source is rotten (payloads missing `writer_agent` or evidence) or a
friction names no canonical repository; fix that before opening issues, so that the issues are not opened
blind or partial. Without `--check`, `node scripts/curate.ts --dry-run` (the default) prints the full JSON report: `stats`,
`clusters` (each with `cluster_key`, `target_repo`, `title`, `body`, `labels`, `frictions`), `skipped` and
`routing_failures`. Spot-check at least one `body` to see that it reads sensibly.

## Step 2: open the issues

Two equivalent paths; either way open one issue per cluster, because independent clusters deserve
independent triage.

- **The script:** `node scripts/curate.ts --apply` opens one issue per cluster through the forge CLI picked
  from the cluster's repository host (`gh`, `glab` or `tea`), with the three labels from the report.
- **By hand:** iterate the report and run `gh issue create --repo <owner>/<repo> --title <title> --body <body>
  --label <label>` per cluster (the `glab` and `tea` equivalents on GitLab and Gitea). Choose this when you
  want to enrich a body first. Forge access is CLI-only; the framework ships no forge MCP server.

### What the script decides

- A cluster is proposed at 2 or more reports (`--threshold`), or at 1 report of `severity: high`, which
  bypasses the threshold by design.
- The cluster key is the `subcategory`, else the room. The target repository is the most frequent
  `canonical` in the cluster (`--target-repo` forces one).
- Labels are `harness-feedback`, `room:<dominant room>` and `severity:<worst>`. The title carries a Gitmoji
  per dominant room (`tool` 🐛, `process` 📝, `behavior` 🚸, `format` 🎨, `prompt` 💬, other 🔧).
- A cluster with no resolvable `canonical` is a routing failure: it is reported, never opened blind.
- `--max-issues N` keeps the N highest-ranked clusters (severity, then size, then key) and `--dedup` skips a
  cluster whose key already has an open `harness-feedback` issue.

### Labels must exist first

`--label` fails on a label the target repository does not have. Create the nine labels once per receiving
repository; the script is idempotent and safe to re-run after a vocabulary change:

```sh
node scripts/setup-labels.ts --repo <owner/repo>        # add --dry-run to preview
```

A missing label shows up as a `failures:` entry of the run summary; create it and retry.

## Deep mode

```sh
node scripts/curate.ts --deep [--deep-window 1000]
```

It scans the most recent transcript drawers (default 500) with a fixed set of heuristic patterns and prints a
Markdown checklist of candidates grouped by pattern, for a human to triage. It never opens issues and
excludes `--apply`. To promote a candidate, tag it with the `harness-report` skill; it joins the next sweep.

## Scheduled mode

`node scripts/schedule-curator.ts` installs a weekly Monday 09:00 run of
`node scripts/curate.ts --apply --dedup --max-issues 5` (launchd on macOS, cron on Linux; re-running replaces
the entry; `--dry-run` previews, `--uninstall` removes it). It runs on the maintainer's machine, never in CI,
because the MemPalace state is local. Run the same command by hand right after filing a `severity: high`
friction.

## Step 3: report the run

```sh
node scripts/curate.ts --summary
```

prints the counts as bullets: frictions read and skipped, clusters formed, proposed and parked, routing
failures and the proposed clusters. Post it, adding the issues opened with their links. Even a zero-issue run
is worth reporting: it tells the user the wing is healthy.

## Friction

If the curation led to a bad cluster, a wrong target or an unactionable issue, tag it with the
`harness-report` skill; the shared rule is in `references/shared-friction-reporting.md`.
