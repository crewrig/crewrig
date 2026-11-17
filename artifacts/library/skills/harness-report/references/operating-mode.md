# Filing fallback and the high-severity trigger

## Contents

- When MemPalace cannot take the write
- Filing directly on the forge
- The high-severity trigger

## When MemPalace cannot take the write

The `mempalace_add_drawer` call can fail two ways, with the same remedy: file the friction as an issue on the
offender's repository, so the signal is not lost.

- **A peer holds the write lock.** The call returns MCP error `-32001` ("Peer MCP writer active"). Retry it at most
  once; if it still returns `-32001`, file directly. Do not loop with backoff.
- **The server is unreachable.** Every MemPalace tool is unavailable, so there is nothing to retry against: file
  directly at once.

The first diagnostic step for `-32001` or a write-lock refusal is `task mempalace:status`.

## Filing directly on the forge

Save the payload from `friction.ts build` to a file, then print the command for the right forge:

```sh
node scripts/friction.ts forge --canonical <repo url> --payload-file <payload file>
```

It reads the host of the canonical URL and prints one `issue create` command with the `harness-feedback` label,
the `FRICTION:` title and the payload fields as the body, then you run it:

| Host | Tool | Repository flag | Body flag | Label flag |
|---|---|---|---|---|
| `github.com` | `gh` | `--repo <owner>/<repo>` | `--body` | `--label` |
| `gitlab.com`, `gitlab.*`, or a host in `CREWRIG_GITLAB_HOSTS` | `glab` | `--repo <full URL>` | `--description` | `--label` |
| any other host | `tea` | `--repo <owner>/<repo>` | `--description` | `--labels` |

`--forge gh|glab|tea` overrides the host rule when it is ambiguous; prefer the tool already logged in for that host.
The label name is the same on every forge, because it routes the friction into the curator's triage lane. When
the offender is unknown and `canonical` is empty, file on the framework's own repository.

Exit `1` from the script means the payload is invalid (the message states the fix), `2` a usage error, `3` an
unreadable payload file.

## The high-severity trigger

A `severity: high` friction should not wait for the weekly sweep. After the drawer is filed, if the
`harness-curator` skill is installed, run its script from that skill's directory:

```sh
node <harness-curator-skill-dir>/scripts/curate.ts --apply --dedup --max-issues 5
```

Dedup is on, so re-running is safe, and the curator promotes a high-severity singleton before a second report
arrives. If the skill is not installed, skip it. Low and medium frictions wait for the sweep.
