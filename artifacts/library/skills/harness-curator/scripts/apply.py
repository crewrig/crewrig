#!/usr/bin/env python3
"""harness_curate — Apply step.

Reads the cluster JSON emitted by ``curate.py`` on stdin and either opens
one GitHub issue per cluster via ``gh issue create`` (default) or, with
``--dry-run-apply``, prints the resolved ``gh`` argv as one JSON line per
cluster without running anything.

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


def _build_cmd(cluster: dict) -> list[str]:
    target = cluster["target_repo"]
    # Defensive: a filer may set `canonical:` to a file URL
    # (https://github.com/<o>/<r>/blob/<branch>/<path>) despite the
    # schema requiring the bare repo form. Strip /blob/... or
    # /tree/... so `gh --repo` receives a valid <owner>/<repo> slug.
    # Schema contract: harness-report/SKILL.md → `canonical` field.
    for sep in ("/blob/", "/tree/"):
        if sep in target:
            print(
                f"  warn: target_repo '{target}' contains '{sep}'; "
                "stripping to repo root. Filers should set canonical "
                "to the repo URL, not a file URL.",
                file=sys.stderr,
            )
            target = target.split(sep, 1)[0]
            break
    title = cluster["title"]
    body = cluster["body"]
    labels = cluster.get("labels", ["harness-feedback"])
    cmd = [
        "gh", "issue", "create",
        "--repo", target.replace("https://github.com/", ""),
        "--title", title,
        "--body", body,
    ]
    for lbl in labels:
        cmd.extend(["--label", lbl])
    return cmd


def _repo_slug(cluster: dict) -> str:
    """Return the `<owner>/<repo>` slug for a cluster's target_repo, applying
    the same /blob/ and /tree/ stripping as `_build_cmd` so the dedup query
    matches the issue-create target exactly."""
    target = cluster["target_repo"]
    for sep in ("/blob/", "/tree/"):
        if sep in target:
            target = target.split(sep, 1)[0]
            break
    return target.replace("https://github.com/", "")


def _existing_issue_url(repo: str, cluster_key: str) -> Optional[str]:
    """Look up an open `harness-feedback` issue whose title matches the
    cluster's canonical prefix `Friction cluster: <key> (`. Returns the
    issue URL on match, None otherwise.

    `gh search` / `gh issue list --search` is fuzzy, so we post-filter on
    a startswith check. The trailing ` (` anchor is load-bearing — it
    prevents substring collisions between sibling cluster keys (e.g.
    `yq` vs `yq-merge`).

    Race condition: two concurrent curator runs could both miss the
    duplicate and both open an issue. V1 ignores this — the scheduler
    runs serially on one machine and the reactive trigger is rare.
    Fails open on `gh` errors: when in doubt, surface the friction.
    """
    prefix = f"Friction cluster: {cluster_key} ("
    cmd = [
        "gh", "issue", "list",
        "--repo", repo,
        "--label", "harness-feedback",
        "--state", "open",
        "--search", f"Friction cluster: {cluster_key} in:title",
        "--json", "title,url",
        "--limit", "50",
    ]
    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        items = json.loads(result.stdout or "[]")
    except (subprocess.CalledProcessError, json.JSONDecodeError) as e:
        # Fail open: log and let the cluster open. Duplicates are
        # recoverable; a missed friction is not.
        print(
            f"  warn: dedup query failed on {repo} for '{cluster_key}': {e}; "
            "treating as no-match.",
            file=sys.stderr,
        )
        return None
    for item in items:
        title = item.get("title", "")
        if title.startswith(prefix):
            return item.get("url")
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
                dedup_match = _existing_issue_url(_repo_slug(c), c["cluster_key"])
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
            existing = _existing_issue_url(_repo_slug(c), c["cluster_key"])
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
            # GitHub. The aggregate is surfaced in the final summary so
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
