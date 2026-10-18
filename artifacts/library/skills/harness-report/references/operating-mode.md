# Operating mode: tag, resume, reactive trigger

## 4. Tag

One MCP call. Fire and forget — do not wait for an acknowledgment,
do not block, return to your task:

```text
mempalace_add_drawer(
  wing="harness-friction",
  room="<one of the 5 categories>",
  content="""
FRICTION: <one-line title>

writer_agent: <you>
subcategory: <optional anchor>
canonical: <URL of offender, if known>
severity: <low|med|high — default med>
evidence:
  - <commit_hash>:<path>:<line>
  - <URL>
suggestion: <optional fix idea>
"""
)
```

**Fallback — MemPalace write path unavailable.** The
`mempalace_add_drawer` call above is the normal path, but it can fail
in two ways. Both have the *same* remedy: file the friction directly as
an issue on the offender's canonical repository so the signal is never
silently lost.

- **(a) A peer writer holds the write lock.** The mutating call returns
  MCP error `-32001` ("Peer MCP writer active; this server is read-only
  for mutating tools"). Retry the `mempalace_add_drawer` call **at most
  once**. If it still returns `-32001`, fall back to direct filing. Do
  **not** loop with backoff.
- **(b) The MemPalace MCP server is unreachable.** It is disconnected
  and *every* MemPalace tool — not only the mutating ones — is
  unavailable. There is no live server to retry against: go **straight**
  to direct filing, with no retry.

**Choose the forge tool from the `canonical` URL host.** CrewRig is
multi-forge (see `AGENTS.md` → *Forge Access*), so do **not** assume
GitHub. Read the host of the offender's `canonical` repository URL and
pick the matching CLI — this is guidance to apply by reading the URL,
not a pattern to codify in a regex:

- host is `github.com` → **`gh`**
- host is `gitlab.com`, begins with `gitlab.`, or is a host the
  environment is already configured to treat as a self-hosted GitLab
  instance → **`glab`**
- any other self-hosted host → assume a Gitea instance → **`tea`**

When a host is genuinely ambiguous, prefer the tool whose authenticated
login is already established for that host. When the offender cannot be
identified and `canonical` is empty, default to the framework's own
canonical repository and the forge that hosts it, mirroring the manual
filing of issues #636 and #637.

**Direct-filing procedure.** File the friction as an issue on the
offender's canonical repository, carrying the `harness-feedback` label
so a directly-filed friction lands in the identical triage lane the
curator's normal path produces. The label name is **forge-independent** —
the same `harness-feedback` on every forge; do **not** map it per-forge.
Shown here with `gh`; `glab` and `tea` take the same shape with their own
repo/label/body flag names (noted below the block):

```bash
gh issue create \
  --repo <owner>/<repo> \
  --label harness-feedback \
  --title "FRICTION: <one-line title>" \
  --body "$(cat <<'EOF'
writer_agent: <you>
subcategory: <optional anchor>
canonical: <URL of offender, if known>
severity: <low|med|high — default med>
evidence:
  - <commit_hash>:<path>:<line>
  - <URL>
suggestion: <optional fix idea>
EOF
)"
```

- **`gh`** (GitHub): as above — `--repo <owner>/<repo>` is the
  `canonical` URL with the `https://github.com/` prefix stripped (the
  same transformation the curator's apply step performs; see step 3's
  `canonical` note), then `--label harness-feedback`, `--title`,
  `--body`.
- **`glab`** (GitLab): `glab issue create --repo <group>/<project>
  --label harness-feedback --title "FRICTION: …" --description "…"` —
  the repo path may be `group/project` or a deeper `group/subgroup/project`
  namespace, and the body flag is `--description`, not `--body`.
- **`tea`** (Gitea): `tea issue create --repo <owner>/<repo> --labels
  harness-feedback --title "FRICTION: …" --description "…"` — note the
  plural `--labels` and, as with `glab`, `--description` rather than
  `--body`.
- Preserve the payload's substance: the one-line title, the offender's
  `canonical` reference when known, and every `evidence:` entry carry
  the same signal the MemPalace drawer would have. The
  `harness-feedback` label is mandatory — it is exactly what routes the
  friction into the curator's triage lane.

## 5. Resume

Return to the task that was interrupted by the signal. The friction
is now in the wing; the Curator will pick it up on its next run.

## Reactive trigger for `severity: high`

When you file a `FRICTION:` payload with `severity: high`, you SHOULD
surface it immediately rather than wait for the next scheduled curator
sweep. After the `mempalace_add_drawer` call returns, run:

```bash
node artifacts/library/skills/harness-curator/scripts/curate.ts --apply --dedup --max-issues 5
```

Dedup is on, so re-running is safe — already-open clusters are skipped.
The curator's high-severity bypass (`cluster_qualifies` in `curate.py`)
promotes the singleton even before a second report arrives. Skip this
step for `low` / `med`: those wait for the weekly sweep.
