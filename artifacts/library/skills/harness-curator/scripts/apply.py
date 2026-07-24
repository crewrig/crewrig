#!/usr/bin/env python3
"""harness_curate — Apply step.

Reads the cluster JSON emitted by ``curate.py`` on stdin and either opens
one issue per cluster on whichever forge hosts that cluster's canonical
repository — GitHub via ``gh``, GitLab via ``glab``, Gitea via ``tea``,
selected from the target repository's host — or, with ``--dry-run-apply``,
prints the resolved forge argv as one JSON line per cluster without running
anything. The GitHub argv path is kept byte-for-byte identical to the
original single-forge behavior (spec 0105 R7).

The script is invoked by ``curate.sh`` through ``$MEMPALACE_PYTHON``
rather than via shebang exec, so that any future ``from mempalace …``
import resolves against the same interpreter that ``curate.py`` uses.
The ``#!/usr/bin/env python3`` shebang above is kept so a human can still
run the script standalone for debugging.
"""

import argparse
import json
import os
import subprocess
import sys
from typing import Optional
from urllib.parse import urlsplit


def _detect_forge(url: str) -> str:
    """Select the forge CLI family from a canonical repository URL's host.

    `github.com` → ``"github"``; `gitlab.com`, a host whose name begins
    ``gitlab.``, or a host present in the comma-separated
    ``CREWRIG_GITLAB_HOSTS`` env var (default unset → empty; spec 0105 R9's
    deterministic, default-unset self-hosted-GitLab allowlist) →
    ``"gitlab"``; any other host → ``"gitea"``. Robust to a URL with or
    without a scheme. Mirrors spec 0103 delta-01 R9 and spec 0105 R1.
    """
    # urlsplit only fills netloc when a scheme (or leading `//`) is present;
    # prepend `//` for a bare `host/owner/repo` so the host parses reliably.
    parsed = urlsplit(url.strip() if "://" in url else "//" + url.strip())
    host = (parsed.hostname or "").lower()
    if host == "github.com":
        return "github"
    if host == "gitlab.com" or host.startswith("gitlab."):
        return "gitlab"
    allow = {
        h.strip().lower()
        for h in os.environ.get("CREWRIG_GITLAB_HOSTS", "").split(",")
        if h.strip()
    }
    if host in allow:
        return "gitlab"
    return "gitea"


def _clean_target(target: str) -> str:
    """Strip a `/blob/…` or `/tree/…` file-URL suffix to the repo root.

    Defensive: a filer may set `canonical:` to a file URL
    (`https://<host>/<o>/<r>/blob/<branch>/<path>`) despite the schema
    requiring the bare repo form. Single-sources the issue-#63 normalization
    previously duplicated in `_build_cmd` and `_repo_slug`, emitting the
    unchanged warning on stderr. Idempotent: a clean URL passes through with
    no warning. Schema contract: harness-report/SKILL.md → `canonical` field.
    """
    for sep in ("/blob/", "/tree/"):
        if sep in target:
            print(
                f"  warn: target_repo '{target}' contains '{sep}'; "
                "stripping to repo root. Filers should set canonical "
                "to the repo URL, not a file URL.",
                file=sys.stderr,
            )
            return target.split(sep, 1)[0]
    return target


def _repo_ref(forge: str, cleaned: str) -> str:
    """Derive the repository reference the selected forge CLI accepts, from an
    already-`_clean_target`-normalized canonical URL (spec 0105 R3):

    - github: strip the `https://github.com/` prefix to the bare
      `owner/repo` slug — kept VERBATIM so the `gh` argv stays byte-for-byte
      identical to the original single-forge behavior (spec R7);
    - gitlab: the full cleaned URL — `glab -R` accepts a full URL, covering
      self-hosted hosts and nested subgroups;
    - gitea: the last two path segments (`owner/repo`).
    """
    if forge == "github":
        return cleaned.replace("https://github.com/", "")
    if forge == "gitlab":
        return cleaned
    # gitea: owner/repo from the final two non-empty path segments.
    parts = [p for p in cleaned.split("/") if p]
    return "/".join(parts[-2:])


def _build_cmd(cluster: dict) -> list[str]:
    """Build the per-forge `issue create` argv for a cluster (spec R2, R4).

    Dispatches on the target repository's host. The GitHub branch is
    byte-for-byte identical to the original single-forge output (spec R7).
    The `harness-feedback` label name is forge-independent (spec R4).
    """
    target = cluster["target_repo"]
    cleaned = _clean_target(target)
    forge = _detect_forge(target)
    ref = _repo_ref(forge, cleaned)
    title = cluster["title"]
    body = cluster["body"]
    labels = cluster.get("labels", ["harness-feedback"])
    if forge == "gitlab":
        return [
            "glab", "issue", "create",
            "--repo", ref,
            "--title", title,
            "--description", body,
            "--label", ",".join(labels),
        ]
    if forge == "gitea":
        return [
            "tea", "issues", "create",
            "--repo", ref,
            "--title", title,
            "--description", body,
            "--labels", ",".join(labels),
        ]
    # github (default): unchanged argv — same flag order, same warning path.
    cmd = [
        "gh", "issue", "create",
        "--repo", ref,
        "--title", title,
        "--body", body,
    ]
    for lbl in labels:
        cmd.extend(["--label", lbl])
    return cmd


def _dedup_list_cmd(forge: str, repo_ref: str, cluster_key: str) -> list[str]:
    """Build the per-forge list/search argv for the dedup lookup (spec R5).

    Each forge lists open `harness-feedback` issues matching the cluster-key
    phrase; the skip decision itself is title-only and made by
    `_match_existing`, so the forge-specific search need only narrow the set.

    - github: unchanged — `gh issue list … --search "… in:title" --json
      title,url` (byte-identical to the original single-forge query);
    - gitlab: `glab issue list … --search "…" --output json` (lists open by
      default);
    - gitea: `tea issues list … --keyword "…" --output json --fields
      index,title,state,url`. The `--fields …,url` is REQUIRED — `tea
      issues list --output json` uses tea's DEFAULT field set, which omits
      `url`, so a URL-keyed skip would never fire on Gitea.
    """
    if forge == "gitlab":
        return [
            "glab", "issue", "list",
            "--repo", repo_ref,
            "--label", "harness-feedback",
            "--search", f"Friction cluster: {cluster_key}",
            "--output", "json",
            "--per-page", "50",
        ]
    if forge == "gitea":
        return [
            "tea", "issues", "list",
            "--repo", repo_ref,
            "--labels", "harness-feedback",
            "--state", "open",
            "--keyword", f"Friction cluster: {cluster_key}",
            "--fields", "index,title,state,url",
            "--output", "json",
            "--limit", "50",
        ]
    # github (default): unchanged query.
    return [
        "gh", "issue", "list",
        "--repo", repo_ref,
        "--label", "harness-feedback",
        "--state", "open",
        "--search", f"Friction cluster: {cluster_key} in:title",
        "--json", "title,url",
        "--limit", "50",
    ]


def _match_existing(items: list, cluster_key: str) -> Optional[str]:
    """Pure title-prefix matcher (no I/O) for the dedup skip decision (R5).

    Returns a truthy value for the first item whose title starts with
    `Friction cluster: <key> (` — the matched issue's URL if any of
    `url` / `web_url` / `html_url` is present (read defensively across the
    forges' differing JSON shapes, for the caller's log line only), else the
    matched **title** as a non-None placeholder so the caller's `if existing:`
    still skips. The skip decision is therefore title-only and independent of
    any forge-specific URL field (spec R5). Returns `None` only when no title
    matches.

    The trailing ` (` anchor is load-bearing — it prevents substring
    collisions between sibling cluster keys (e.g. `yq` vs `yq-merge`).
    """
    prefix = f"Friction cluster: {cluster_key} ("
    for item in items:
        title = item.get("title", "")
        if title.startswith(prefix):
            return (
                item.get("url")
                or item.get("web_url")
                or item.get("html_url")
                or title
            )
    return None


def _existing_issue_url(forge: str, repo_ref: str, cluster_key: str) -> Optional[str]:
    """Look up an open `harness-feedback` issue on the selected forge whose
    title matches the cluster's canonical prefix `Friction cluster: <key> (`.
    Returns a truthy value on match (see `_match_existing`), None otherwise.

    Race condition: two concurrent curator runs could both miss the duplicate
    and both open an issue. V1 ignores this — the scheduler runs serially on
    one machine and the reactive trigger is rare.

    Fails open on ANY error — a tool error, a missing forge CLI binary, or
    unparseable output all resolve to no-match so the cluster's issue is still
    opened (spec R6): a duplicate is recoverable, a missed friction is not.
    """
    cmd = _dedup_list_cmd(forge, repo_ref, cluster_key)
    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        items = json.loads(result.stdout or "[]")
        return _match_existing(items, cluster_key)
    except Exception as e:  # noqa: BLE001 — spec R6 fail-open: any error → no-match
        # Fail open: log and let the cluster open. Duplicates are
        # recoverable; a missed friction is not.
        print(
            f"  warn: dedup query failed on {repo_ref} for '{cluster_key}': {e}; "
            "treating as no-match.",
            file=sys.stderr,
        )
        return None


def _collect_drawer_ids(cluster: dict) -> tuple[list[str], int]:
    """Return (present_ids, missing_count). Caller emits a stderr warning
    when missing > 0 so frictions without `_drawer_id` are surfaced rather
    than silently dropped from the write-back set."""
    ids: list[str] = []
    missing = 0
    for fr in cluster.get("frictions", []):
        did = fr.get("_drawer_id")
        if did:
            ids.append(did)
        else:
            missing += 1
    return ids, missing


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run-apply",
        action="store_true",
        help="Print the resolved gh argv per cluster as JSON lines and exit 0.",
    )
    parser.add_argument(
        "--dedup",
        action="store_true",
        help=(
            "Skip clusters with an existing open harness-feedback issue on "
            "the target repo (matched on the canonical title prefix). "
            "Combine with --dry-run-apply to inspect what would be skipped."
        ),
    )
    args = parser.parse_args()

    data = json.load(sys.stdin)
    clusters = data.get("clusters", [])
    if not clusters:
        print("No clusters above threshold; no issues to open.")
        return 0

    if args.dry_run_apply:
        for c in clusters:
            # Dedup probe runs even in dry-run-apply so tests can assert
            # the resolved behavior without a live `gh issue create`.
            # When --dedup is off, the dedup_match line carries null so
            # the wire shape stays uniform across modes.
            dedup_match: Optional[str] = None
            if args.dedup:
                target = c["target_repo"]
                forge = _detect_forge(target)
                dedup_match = _existing_issue_url(
                    forge, _repo_ref(forge, _clean_target(target)), c["cluster_key"]
                )
            print(json.dumps(_build_cmd(c)))
            # Issue #69: surface the drawers that would receive the
            # `opened_as` correlation stamp. Object shape (not array) so
            # existing argv-array assertions (`grep '^\['`) ignore it.
            drawer_ids, missing = _collect_drawer_ids(c)
            if missing:
                print(
                    f"  warn: cluster '{c['cluster_key']}' has {missing} "
                    "friction(s) without _drawer_id; will not be stamped.",
                    file=sys.stderr,
                )
            print(json.dumps({
                "would_update_drawers": drawer_ids,
                "cluster_key": c["cluster_key"],
            }))
            print(json.dumps({
                "dedup_match": dedup_match,
                "cluster_key": c["cluster_key"],
            }))
        return 0

    # Real --apply path. Capture a duped fd 1 BEFORE importing
    # mempalace.mcp_server — that import swaps sys.stdout to keep the
    # MCP JSON-RPC channel clean (same hazard documented in
    # config/TOOLS.md and motivating curate.py's module-top dup). Result
    # URLs and the run summary go through _real_stdout so the caller
    # can capture them; progress messages route to stderr explicitly.
    _real_stdout = os.fdopen(os.dup(1), "w", encoding="utf-8", closefd=False)
    from mempalace.mcp_server import tool_get_drawer, tool_update_drawer

    opened = []
    failures = []
    skipped_duplicates: list[dict] = []
    writeback_failures = 0
    for c in clusters:
        target = c["target_repo"]
        title = c["title"]
        if args.dedup:
            forge = _detect_forge(target)
            existing = _existing_issue_url(
                forge, _repo_ref(forge, _clean_target(target)), c["cluster_key"]
            )
            if existing:
                print(
                    f"--- Skipping duplicate cluster '{c['cluster_key']}' "
                    f"(already open: {existing})",
                    file=sys.stderr,
                )
                skipped_duplicates.append({
                    "cluster": c["cluster_key"],
                    "url": existing,
                })
                continue
        print(f"--- Opening issue on {target}: {title}", file=sys.stderr)
        cmd = _build_cmd(c)
        try:
            result = subprocess.run(cmd, check=True, capture_output=True, text=True)
            url = result.stdout.strip()
            opened.append({"cluster": c["cluster_key"], "url": url})
            # Write-back: stamp `opened_as: <url>` on every drawer that
            # contributed to the cluster (issue #69). Re-fetch then
            # update because tool_update_drawer REPLACES content; this
            # narrows the clobber window against concurrent edits.
            # Partial failures are counted and logged but do NOT mark
            # the cluster failed — the issue is already opened on
            # the target forge. The aggregate is surfaced in the final summary so
            # the maintainer sees that some drawers remain unstamped.
            drawer_ids, missing = _collect_drawer_ids(c)
            if missing:
                print(
                    f"  warn: cluster '{c['cluster_key']}' has {missing} "
                    "friction(s) without _drawer_id; will not be stamped.",
                    file=sys.stderr,
                )
            for did in drawer_ids:
                try:
                    drawer = tool_get_drawer(drawer_id=did)
                    new_content = drawer["content"].rstrip() + f"\nopened_as: {url}\n"
                    tool_update_drawer(drawer_id=did, content=new_content)
                except Exception as wb_err:  # noqa: BLE001 — best-effort write-back
                    writeback_failures += 1
                    print(
                        f"  warn: failed to stamp opened_as on drawer {did}: {wb_err}",
                        file=sys.stderr,
                    )
        except subprocess.CalledProcessError as e:
            failures.append({"cluster": c["cluster_key"], "error": e.stderr.strip()})

    print("", file=_real_stdout)
    print(f"Opened: {len(opened)} issue(s)", file=_real_stdout)
    for o in opened:
        print(f"  - {o['cluster']}: {o['url']}", file=_real_stdout)
    if skipped_duplicates:
        print(
            f"Skipped (dedup): {len(skipped_duplicates)} duplicate cluster(s)",
            file=_real_stdout,
        )
        for s in skipped_duplicates:
            print(f"  - {s['cluster']}: {s['url']}", file=_real_stdout)
    _real_stdout.flush()
    if writeback_failures:
        print(
            f"Write-back failures: {writeback_failures} drawer(s) not stamped; "
            "next curator run may re-open these issues.",
            file=sys.stderr,
        )
    if failures:
        print(f"Failures: {len(failures)}", file=sys.stderr)
        for f in failures:
            print(f"  - {f['cluster']}: {f['error']}", file=sys.stderr)
        return 4
    return 0


if __name__ == "__main__":
    sys.exit(main())
