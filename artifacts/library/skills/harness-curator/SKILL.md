---
name: harness-curator
description: "Harness feedback-loop curator. Activate on demand to read
  friction tags from the global harness-friction wing, cluster them, and
  open one descriptive issue per cluster on the canonical/feedback repos
  declared in components' provenance blocks. The fix MR lands later
  (human-authored or via the auto-fix mode tracked in #42). Also supports
  a `--deep` mode that sweeps `wing=transcripts` with heuristic
  pre-filtering and emits a Markdown review document for triage. Auto
  mode (#42) supports scheduled runs via scripts/schedule-curator.sh
  with dedup and per-run issue cap."
type: skill
license: Apache-2.0
compatibility: Requires bash, jq, the gh CLI (used by setup-labels.sh and --apply), and the mempalace Python package (pipx install 'mempalace>=3.3.3,<3.4').
metadata:
  provenance:
    canonical: "${CANONICAL_REPO}"
    feedback: "${CANONICAL_REPO}"
    version: "1.5.2"
claude:
  allowed-tools:
    - Read
    - Bash
    - Grep
    - Glob
  user-invocable: true
---

# Harness Curator

The agent that closes the harness feedback loop. Reads the frictions
tagged by sibling agents during real work, clusters them, and opens
one descriptive issue per cluster against the agent system itself so
the friction surfaces to the maintainers.

## V0 contract — descriptive issues only

The Curator does **not** attempt a fix. It produces a rich,
evidence-backed issue body — the artifact is a GitHub *issue*, not a
PR/MR, because there is no diff yet. The actual fix lands later, as a
human-authored MR (or via the auto-fix mode tracked in #42) that
closes the issue. Proving the surfacing loop matters more than proving
auto-repair.

## When to activate

- The user runs `/harness-curate` (or equivalent invocation).
- The user asks for "what frictions has the crew accumulated lately".
- A scheduled sweep triggers it (auto mode — out of V0 scope, tracked
  in issue #42).

The Curator is **never** activated implicitly during normal work. If
you are in the middle of an unrelated task and find yourself reaching
for this skill, you are off-task.

## Operating mode

The heavy lifting (reading the wing, parsing payloads, clustering,
composing issue bodies) is delegated to a bundled script — you run
it, read the JSON it returns, and open issues from there. This split
exists because batch-reading the friction wing per-call through MCP
would be a multi-thousand-call traversal; see `config/TOOLS.md` →
*Carve-out for bundled skill/agent scripts* for the rationale.

### 1. Run the curator script

```bash
task harness-curate -- --dry-run
# or directly, from the skill bundle (works whether installed at project
# level under .gemini/.claude or user level under ~/.gemini/~/.claude):
bash scripts/curate.sh --dry-run
```

The script walks `wing="harness-friction"` via the MemPalace Python
library, parses every `FRICTION:` payload, clusters, and emits a JSON
document on stdout:

```json
{
  "stats": {
    "total_drawers": 12,
    "valid_frictions": 11,
    "skipped_malformed": 1,
    "clusters_formed": 4,
    "clusters_above_threshold": 2,
    "clusters_parked": 2,
    "routing_failures": 0
  },
  "clusters": [
    {
      "cluster_key": "yq-merge",
      "cluster_size": 3,
      "target_repo": "https://github.com/crewrig/crewrig",
      "title": "Friction cluster: yq-merge (3 reports)",
      "body": "<markdown>",
      "labels": ["harness-feedback", "room:prompt", "severity:med"],
      "frictions": [...]
    }
  ],
  "skipped": [
    {
      "drawer_id": "drw-005",
      "room": "process",
      "reason": "malformed",
      "snippet": "Not a friction at all — random text..."
    }
  ],
  "routing_failures": [
    {
      "cluster_key": "no-canonical-cluster",
      "frictions": [...],
      "reason": "missing_canonical"
    }
  ]
}
```

### 2. Validate the output before opening anything

Read the JSON. Check the stats — high `skipped_malformed` or
`routing_failures` is a signal that the wing has rot, and you should
investigate before opening issues. Spot-check at least one body to
make sure it reads sensibly.

### 3. Open the issues

Two paths, equivalent in outcome:

- **Let the script do it**: `task harness-curate -- --apply`. The
  script opens one issue per cluster via `gh issue create`, with all
  three labels from the JSON (`harness-feedback`, `room:<x>`,
  `severity:<y>`).
- **Open them yourself**: iterate the JSON, use the GitHub MCP (or
  `gh`) per cluster. Use this path when you want to enrich the body
  before opening (e.g. linking a recent `logbook` issue you noticed
  while reviewing).

Either way: **one issue per cluster**. Resist bundling — independent
clusters deserve independent triage.

### 4. Threshold + routing rules (encoded in the script)

The script applies these for you. Documented here so you can override
via flags when the situation warrants:

| Rule | Default | Override |
|---|---|---|
| Cluster size threshold | 2 | `--threshold N` |
| Severity-`high` bypass | always promotes a singleton | (no override — by design) |
| Target repo | most-frequent `canonical:` in cluster | `--target-repo <url>` for tests |
| Cluster key | `subcategory:` if set, else `room` | (no override — wire-protocol) |
| Labels | `harness-feedback` + `room:<dominant>` + `severity:<worst>` | (no override — wire-protocol) |
| Max issues per run | 0 (unlimited) | `--max-issues N` (ranks high-severity → biggest cluster first, then truncates) |
| Dedup existing issues | off | `--dedup` (skips clusters whose `cluster_key` already has an open `harness-feedback` issue) |

A cluster with no resolvable `canonical:` and no `--target-repo`
override counts as a *routing failure* — surfaced in the stats, not
opened blind.

### Prerequisite: labels exist on the target repo

`gh issue create --label <name>` fails if the label does not already
exist on the target repo. The three labels the Curator uses
(`harness-feedback`, `room:<category>` for each of the 5 fixed rooms,
and `severity:low|med|high`) **must be pre-created** on every repo
that may receive curator output, before the first `--apply` run.
A fork maintainer typically does this once at fork setup time.

Bootstrap the 9 labels via the bundled script (idempotent — safe to
re-run after a label vocabulary change):

```bash
bash scripts/setup-labels.sh --repo <owner/repo>
# Or preview the plan without contacting GitHub:
bash scripts/setup-labels.sh --repo <owner/repo> --dry-run
```

The script uses `gh label create --force` per label, so it creates
missing labels and updates the color / description of any that already
exist. Omit `--repo` to target the repo resolved from the current
working directory's git remote.

If `--apply` fails on a missing label, the script surfaces it as a
`failures:` entry in the run summary. The maintainer creates the
label and retries.

### --deep mode

Run a heuristic sweep of `wing="transcripts"` instead of the regular
`wing="harness-friction"` curation. Useful for catching frictions that
slipped through the recognition signals and were never tagged.

```bash
bash scripts/curate.sh --deep
# Tune the scan window (default: 500 most-recent transcript drawers):
bash scripts/curate.sh --deep --deep-window 1000
```

Behavior:

- Reads up to `--deep-window` drawers from `wing="transcripts"` (most
  recent first).
- Pre-filters each drawer against a fixed set of heuristic regex
  patterns (`error`, `failed`, `retry`, `not working`, `unexpected`,
  `broken`, `didn't work`, `try again`).
- Emits a **Markdown review document** on stdout — not JSON, not
  issues. Each candidate appears as a checkbox item grouped by pattern,
  with a one-line excerpt for triage.
- Incompatible with `--apply`: the script exits with an error if both
  are passed. Deep mode is a discovery aid, not an issue-opening path.
  To promote a candidate, the human (or agent) runs `/harness-report`
  for it, which lands a `FRICTION:` payload in `wing="harness-friction"`
  for the next regular sweep.

Auto mode is implemented; see *Auto mode (scheduled curation)* below.

### Auto mode (scheduled curation)

Auto mode runs `curate.sh --apply --dedup --max-issues 5` on a recurring
local schedule, default weekly Monday 09:00. Dedup is on so re-running
the curator never re-opens the same cluster; `--max-issues 5` caps a
single sweep so a noisy week cannot flood a repo. Ranking before
truncation is severity-first (`high` > `med` > `low`), then cluster
size (descending), then `cluster_key` (ascending, tie-breaker).

Install the schedule on your maintainer machine:

```bash
bash artifacts/library/skills/harness-curator/scripts/schedule-curator.sh
# Preview only:
bash artifacts/library/skills/harness-curator/scripts/schedule-curator.sh --dry-run
# Remove the managed entry:
bash artifacts/library/skills/harness-curator/scripts/schedule-curator.sh --uninstall
```

The installer detects macOS (launchd, plist at
`~/Library/LaunchAgents/io.crewrig.harness-curator.plist`) vs Linux
(cron, marker-comment-wrapped entry in `crontab -l`). Re-running the
install replaces the previous entry, never duplicates.

Reactive trigger — run manually the moment you file a `severity: high`
friction so the curator surfaces it without waiting for the next sweep:

```bash
bash artifacts/library/skills/harness-curator/scripts/curate.sh --apply --dedup --max-issues 5
```

Auto mode never runs on CI by design — MemPalace state is local to the
maintainer.

### 5. Run summary

After applying, post a brief run summary to the user:

- Frictions read / skipped (malformed).
- Clusters formed / above threshold / parked.
- Issues opened (with links) / routing failures.

The summary is the primary signal that the loop ran. Even a zero-issue
run is worth reporting — it tells the user the wing is healthy.

## Output expectations

- One issue per cluster, descriptive body only.
- Every claim in the body backed by an evidence pointer.
- Three labels per issue (`harness-feedback`, `room:<x>`, `severity:<y>`)
  so maintainers can filter and triage natively.
- No Curator-proposed diff (V0 contract — diffs live in follow-up MRs).

## Friction reporting

When a recognition signal fires (see `config/TOOLS.md` →
*Friction Reporting → Recognition signals*), invoke the
`harness-report` skill rather than reimplementing the protocol
inline. The Curator is not exempt from the loop it serves — if the
curation prompt led to a bad cluster, a wrong routing target, or an
unactionable issue, report it like any other friction.
