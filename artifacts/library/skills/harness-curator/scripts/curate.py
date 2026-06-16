#!/usr/bin/env python3
"""harness_curate — Curator backend.

Reads friction reports from MemPalace ``wing="harness-friction"`` (or from
stdin in test mode), parses the ``FRICTION:`` payload schema documented in
``config/TOOLS.md``, clusters them, composes MR bodies, and emits a single
JSON document on stdout.

Read-only against MemPalace. Writes — if ever needed — flow through MCP on
the agent side, not from this script.

Output JSON schema (stable, depended on by ``scripts/harness-curate.sh``):

    {
      "stats": {
        "total_drawers": int,
        "valid_frictions": int,
        "skipped_malformed": int,
        "skipped_resolved": int,
        "clusters_formed": int,
        "clusters_above_threshold": int,
        "clusters_parked": int,
        "clusters_truncated": int,
        "routing_failures": int
      },
      "clusters": [
        {
          "cluster_key": str,
          "cluster_size": int,
          "target_repo": str,
          "title": str,
          "body": str,
          "labels": [...],
          "frictions": [...]
        }
      ],
      "skipped": [
        {
          "drawer_id": str,
          "room": str,
          "reason": str,
          "snippet": str
        }
      ],
      "routing_failures": [
        {
          "cluster_key": str,
          "frictions": [...],
          "reason": str
        }
      ]
    }

Environment variables (set by the bash wrapper):

* ``FRICTION_WING`` — wing name to read from (default ``harness-friction``).
* ``THRESHOLD`` — minimum cluster size to propose an issue.
* ``TARGET_REPO_OVERRIDE`` — force a single issue target (test mode).
* ``FROM_STDIN_FILE`` — path to a JSON file with a list of fake drawers,
  used for ``--from-stdin``. Empty when reading from MemPalace.
"""

import json
import os
import re
import sys
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

# Dup fd 1 BEFORE any mempalace.mcp_server import (which happens lazily
# inside read_from_mempalace, but the dup must precede the interpreter's
# first chance to be hijacked — so we do it at module load). The
# mempalace MCP module swaps sys.stdout to keep its JSON-RPC channel
# clean; we route our JSON output through a duped handle to survive
# that swap. `closefd=False` is load-bearing: without it, fd 1 closes
# at GC and any late `atexit` write breaks.
_REAL_STDOUT = os.fdopen(os.dup(1), "w", encoding="utf-8", closefd=False)

# --- Configuration from environment ---------------------------------------

WING = os.environ.get("FRICTION_WING", "harness-friction")
THRESHOLD = int(os.environ.get("THRESHOLD", "2"))
MAX_ISSUES = int(os.environ.get("MAX_ISSUES", "0"))
TARGET_OVERRIDE = os.environ.get("TARGET_REPO_OVERRIDE", "").strip()
STDIN_FILE = os.environ.get("FROM_STDIN_FILE", "").strip()
DEEP_MODE = os.environ.get("DEEP_MODE", "false").lower() == "true"
DEEP_WINDOW = int(os.environ.get("DEEP_WINDOW", "500"))

# Heuristic keyword patterns for --deep pre-filter (label → regex)
_DEEP_HEURISTICS: Dict[str, str] = {
    "FAILED":        r"\bfailed\b",
    "error":         r"\berror\b",
    "retry":         r"\bretry\b",
    "didn't work":   r"didn.t work",
    "not working":   r"not working",
    "unexpected":    r"\bunexpected\b",
    "broken":        r"\bbroken\b",
    "try again":     r"try again",
}

# Keep the page size aligned with prune-transcripts.sh: 100 is the sweet spot
# between MCP roundtrips and per-call payload size.
PAGE_SIZE = 100
MAX_TOTAL_DRAWERS = 50000  # safety cap, identical rationale to prune script


# --- FRICTION payload parser ----------------------------------------------

# Title line is fixed: ``FRICTION: <free-form title>``.
TITLE_RE = re.compile(r"^FRICTION:\s*(.+)$")
# Keys are lowercase identifiers; values may be empty.
KV_RE = re.compile(r"^([a-z_][a-z0-9_]*):\s*(.*)$")
# Evidence entries are ``  - <value>`` indented list items.
LIST_RE = re.compile(r"^\s*-\s+(.+)$")
# A lone YAML block-scalar indicator as a field value: ``|``, ``>`` with an
# optional chomping indicator (``-``/``+``). When a ``key:`` value is just
# this, the field body is the following MORE-indented block of lines.
BLOCK_SCALAR_RE = re.compile(r"^[|>][-+]?$")


def parse_friction(content: str) -> Tuple[Optional[Dict[str, Any]], str]:
    """Parse one FRICTION: payload.

    Returns ``(payload, reason)``:
      * ``(dict, "ok")``  — well-formed and still open (no ``opened_as:``).
      * ``(None, "resolved")`` — well-formed but already correlated with a
        GitHub issue (carries ``opened_as: <url>``). Caller skips silently
        so the curator does not re-open issues for drawers that already
        have one (issue #69).
      * ``(None, "malformed")`` — missing required fields or no title.
      * ``(None, "empty_suggestion")`` — ``suggestion`` is present but
        contains only whitespace (spec 0010 R1).

    The schema co-evolves with ``config/TOOLS.md``: ``opened_as`` is the
    correlation field stamped on each drawer by ``apply.py`` after a
    successful ``gh issue create``."""
    if not content:
        return None, "malformed"
    lines = content.splitlines()
    title = None
    body_start = 0
    # Skip leading blanks; first non-blank line must be the title.
    for i, line in enumerate(lines):
        if not line.strip():
            continue
        m = TITLE_RE.match(line.strip())
        if not m:
            return None, "malformed"
        title = m.group(1).strip()
        body_start = i + 1
        break
    if title is None:
        return None, "malformed"

    out: Dict[str, Any] = {"title": title, "evidence": []}
    in_evidence = False
    body_lines = lines[body_start:]
    n = len(body_lines)
    i = 0
    # Index-driven scan: a lone block-scalar indicator value (``key: |``)
    # makes the field's body the following MORE-indented block of lines,
    # so the cursor must be able to jump past that block — a plain ``for``
    # loop cannot. This generalizes to ANY field, not just ``suggestion``
    # (spec 0032 R2).
    while i < n:
        line = body_lines[i]
        if in_evidence:
            m = LIST_RE.match(line)
            if m:
                out["evidence"].append(m.group(1).strip())
                i += 1
                continue
            # First non-list-item line ends the evidence block.
            in_evidence = False
        if not line.strip():
            i += 1
            continue
        m = KV_RE.match(line)
        if not m:
            i += 1
            continue
        key, val = m.group(1), m.group(2).strip()
        if key == "evidence":
            in_evidence = True
            # Allow inline evidence: "evidence: foo" → single entry.
            if val:
                out["evidence"].append(val)
            i += 1
            continue
        if BLOCK_SCALAR_RE.match(val):
            # Block scalar: capture the following lines whose indentation
            # exceeds the key line's as the field body (spec 0032 R1/R2).
            # Blank lines inside the block are preserved; trailing blanks
            # are dropped. Capture stops at the first line that dedents
            # back to (or past) key level — a sibling ``key:`` line, the
            # ``evidence:`` block, or EOF — so the block-scalar capture and
            # the evidence-list handling never swallow each other.
            key_indent = len(line) - len(line.lstrip())
            i += 1
            block: List[str] = []
            while i < n:
                cont = body_lines[i]
                if not cont.strip():
                    # Blank line: tentatively part of the block (trailing
                    # blanks are stripped below).
                    block.append("")
                    i += 1
                    continue
                cont_indent = len(cont) - len(cont.lstrip())
                if cont_indent <= key_indent:
                    break
                block.append(cont)
                i += 1
            # Dedent by the common leading whitespace of non-blank lines.
            indents = [len(b) - len(b.lstrip()) for b in block if b.strip()]
            if indents:
                common = min(indents)
                block = [b[common:] if b.strip() else "" for b in block]
            # Strip trailing blank lines.
            while block and not block[-1].strip():
                block.pop()
            out[key] = "\n".join(block)
            continue
        out[key] = val
        i += 1

    # Required fields per config/TOOLS.md: writer_agent + ≥1 evidence.
    if not out.get("writer_agent"):
        return None, "malformed"
    if not out["evidence"]:
        return None, "malformed"
    # Resolved-correlation takes precedence over empty-suggestion
    # (spec 0032 R4/R5). A drawer already correlated with an opened issue
    # (the write-back stamp from apply.py, issue #69) is skipped silently
    # so the curator does not re-open issues — regardless of the shape or
    # emptiness of its suggestion. Any truthy `opened_as` counts as a
    # resolved correlation even if it is not a valid URL: the curator's
    # job here is just to avoid re-opening.
    if out.get("opened_as"):
        return None, "resolved"
    # A present-but-empty suggestion is treated identically to an absent key:
    # the key is stripped and the friction is accepted (spec 0033 R1-R3).
    # This supersedes the spec 0010 R1 / spec 0032 R6 empty_suggestion reject.
    if "suggestion" in out and not out["suggestion"].strip():
        out.pop("suggestion")
    # Default severity if absent.
    out.setdefault("severity", "med")
    return out, "ok"


# --- Data sources ---------------------------------------------------------


def read_from_stdin_file() -> List[Dict[str, Any]]:
    """Load fake drawers from a JSON file. Each entry is a dict mirroring
    the MemPalace drawer shape: ``{drawer_id, room, content}``."""
    with open(STDIN_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError("stdin JSON must be a list of drawer dicts")
    return data


def read_from_mempalace() -> List[Dict[str, Any]]:
    """Walk wing=WING via the in-process mempalace API. Read-only.

    `tool_list_drawers` returns drawer stubs with `content_preview`
    (truncated), not the full payload. We follow up with
    `tool_get_drawer` per ID to fetch the full content and the
    `metadata.filed_at` timestamp used for the MR body's date range.
    """
    try:
        from mempalace.mcp_server import tool_get_drawer, tool_list_drawers
    except ImportError as e:
        print(
            f"Error: failed to import mempalace ({e}). "
            "Install via pipx: pipx install 'mempalace>=3.3.3,<3.4'",
            file=sys.stderr,
        )
        sys.exit(2)

    drawers: List[Dict[str, Any]] = []
    offset = 0
    while len(drawers) < MAX_TOTAL_DRAWERS:
        page = tool_list_drawers(wing=WING, limit=PAGE_SIZE, offset=offset)
        batch = page.get("drawers", [])
        if not batch:
            break
        for stub in batch:
            did = stub.get("drawer_id")
            if not did:
                continue
            full = tool_get_drawer(drawer_id=did)
            drawers.append({
                "drawer_id": did,
                "room": full.get("room", "") or stub.get("room", ""),
                "content": full.get("content", ""),
                "filed_at": (full.get("metadata") or {}).get("filed_at", ""),
            })
        if len(batch) < PAGE_SIZE:
            break  # last (partial) page reached
        offset += PAGE_SIZE
    return drawers


# --- Clustering -----------------------------------------------------------


def cluster_key_for(friction: Dict[str, Any], room: str) -> str:
    """Cluster by subcategory if present, fallback to room (one of the
    5 fixed categories per config/TOOLS.md)."""
    sub = friction.get("subcategory", "").strip()
    if sub:
        return sub
    return room or "unknown"


def cluster_frictions(
    parsed: List[Tuple[Dict[str, Any], str, str, str]],
) -> Dict[str, List[Dict[str, Any]]]:
    """Group parsed frictions by cluster key. Each value entry stores the
    friction with its room, filed_at and drawer_id glued in for downstream
    traceability, date-range computation in the MR body, and post-create
    write-back of the ``opened_as`` correlation field (issue #69)."""
    clusters: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for friction, room, filed_at, drawer_id in parsed:
        key = cluster_key_for(friction, room)
        enriched = dict(friction)
        enriched["_room"] = room
        enriched["_filed_at"] = filed_at
        enriched["_drawer_id"] = drawer_id
        clusters[key].append(enriched)
    return dict(clusters)


def cluster_qualifies(cluster: List[Dict[str, Any]], threshold: int) -> bool:
    """A cluster qualifies for an MR if it crosses the size threshold OR
    contains at least one severity:high friction. The high-severity
    bypass is per config/TOOLS.md to avoid ignoring blockers."""
    if len(cluster) >= threshold:
        return True
    return any(f.get("severity") == "high" for f in cluster)


# --- Routing --------------------------------------------------------------


def pick_target_repo(cluster: List[Dict[str, Any]]) -> Optional[str]:
    """Pick the MR target URL for a cluster.

    Precedence:
    1. ``--target-repo`` override (set by the wrapper for test or
       single-fork curation).
    2. The ``canonical`` URL most frequent across the cluster.
    3. None — caller treats this as a routing failure (does not open a
       blind MR).
    """
    if TARGET_OVERRIDE:
        return TARGET_OVERRIDE
    canonicals: Dict[str, int] = defaultdict(int)
    for f in cluster:
        c = f.get("canonical", "").strip()
        if c:
            canonicals[c] += 1
    if not canonicals:
        return None
    # Most-frequent canonical wins, ties broken by first seen.
    return max(canonicals.items(), key=lambda kv: kv[1])[0]


# --- MR body composition --------------------------------------------------


def cluster_date_range(cluster: List[Dict[str, Any]]) -> str:
    """Compute a "from–to" date range from `_filed_at` timestamps.
    Returns an empty string when no friction in the cluster carries a
    timestamp (e.g. test fixture without metadata). When the cluster
    spans a single calendar day, returns "<date> (single day)" rather
    than a bare date so a reader scanning for the arrow does not miss
    a one-day cluster.

    Logs a stderr warning when valid frictions in the cluster lack
    `_filed_at`, since a partial-timestamp cluster yields a misleading
    range (caller may want to investigate)."""
    dates = []
    missing = 0
    for f in cluster:
        ts = f.get("_filed_at", "")
        if not ts:
            missing += 1
            continue
        # filed_at is ISO 8601 (`2026-04-29T00:16:09.949576`); keep date.
        dates.append(ts.split("T", 1)[0])
    if missing and dates:
        cluster_key = cluster[0].get("subcategory") or cluster[0].get("_room", "?")
        print(
            f"Warning: cluster '{cluster_key}' has {missing} friction(s) "
            "without `_filed_at`; date range computed from the timestamped "
            "ones only.",
            file=sys.stderr,
        )
    if not dates:
        return ""
    dates.sort()
    if dates[0] == dates[-1]:
        return f"{dates[0]} (single day)"
    return f"{dates[0]} → {dates[-1]}"


def compose_body(
    cluster_key: str,
    cluster: List[Dict[str, Any]],
    target_repo: str,
) -> Tuple[str, str]:
    """Return (title, markdown_body)."""
    size = len(cluster)
    title = f"Friction cluster: {cluster_key} ({size} report{'s' if size != 1 else ''})"
    lines: List[str] = []
    lines.append(f"## Friction cluster: `{cluster_key}`")
    lines.append("")
    date_range = cluster_date_range(cluster)
    when = f" ({date_range})" if date_range else ""
    lines.append(
        f"{size} friction{'s' if size != 1 else ''} tagged across the "
        f"`harness-friction` wing{when}. Routed to `{target_repo}`."
    )
    lines.append("")
    # Pattern paragraph: leave room for human / future LLM enrichment in V0
    # we just summarize the rooms involved.
    rooms_seen = sorted({f.get("_room", "?") for f in cluster})
    lines.append("### Pattern")
    lines.append("")
    lines.append(
        f"Reports span room{'s' if len(rooms_seen) != 1 else ''} "
        + ", ".join(f"`{r}`" for r in rooms_seen)
        + ". The common subcategory anchor is "
        f"`{cluster_key}`."
    )
    lines.append("")
    lines.append("### Frictions")
    lines.append("")
    for i, f in enumerate(cluster, 1):
        lines.append(f"{i}. **{f.get('title', '(untitled)')}**")
        lines.append(f"   - Reported by: `{f.get('writer_agent', '?')}`")
        lines.append(f"   - Severity: `{f.get('severity', 'med')}`")
        room = f.get("_room", "?")
        lines.append(f"   - Room: `{room}`")
        for ev in f.get("evidence", []):
            lines.append(f"   - Evidence: {ev}")
        if f.get("suggestion"):
            lines.append(f"   - Suggestion (from reporter): {f['suggestion']}")
        lines.append("")
    lines.append("### Suggested resolution")
    lines.append("")
    suggestions = [f["suggestion"] for f in cluster if f.get("suggestion")]
    if suggestions:
        if len(set(suggestions)) == 1:
            lines.append(f"All reporters converge on: {suggestions[0]}")
        else:
            lines.append("Reporter suggestions diverge:")
            for s in suggestions:
                lines.append(f"- {s}")
    else:
        lines.append(
            "No suggestion in payloads. Curator declined to invent one in "
            "V0 (descriptive-only contract — see "
            "`community-config/skills/harness-curator/SKILL.md`)."
        )
    lines.append("")
    lines.append("### Out of scope")
    lines.append("")
    lines.append(
        "This issue was auto-generated by the Harness Curator (V0). It is "
        "descriptive only — a follow-up MR (human-authored, or via the "
        "auto-fix mode tracked in #42) will close it with the actual diff."
    )
    lines.append("")
    return title, "\n".join(lines)


# --- Labels ---------------------------------------------------------------


SEVERITY_RANK = {"low": 0, "med": 1, "high": 2}


def cluster_labels(cluster: List[Dict[str, Any]]) -> List[str]:
    """Compute the GitHub labels to apply to the auto-generated issue.

    Always includes `harness-feedback` (marks the issue as curator-output).
    Adds `room:<dominant>` (most-frequent room in the cluster; ties broken
    alphabetically for determinism) and `severity:<max>` (worst severity in
    the cluster, since the cluster qualified through that worst case)."""
    rooms: Dict[str, int] = defaultdict(int)
    worst_severity = "low"
    for f in cluster:
        rooms[f.get("_room", "unknown")] += 1
        sev = f.get("severity", "med")
        if SEVERITY_RANK.get(sev, 1) > SEVERITY_RANK.get(worst_severity, 0):
            worst_severity = sev
    dominant_room = sorted(rooms.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
    return [
        "harness-feedback",
        f"room:{dominant_room}",
        f"severity:{worst_severity}",
    ]


# --- Deep mode ------------------------------------------------------------


def read_transcripts_window(window: int) -> List[Dict[str, Any]]:
    """Read at most `window` drawers from wing=transcripts (most recent first)."""
    try:
        from mempalace.mcp_server import tool_get_drawer, tool_list_drawers
    except ImportError as e:
        print(f"Error: failed to import mempalace ({e}).", file=sys.stderr)
        sys.exit(2)
    drawers: List[Dict[str, Any]] = []
    offset = 0
    while len(drawers) < window:
        page_size = min(PAGE_SIZE, window - len(drawers))
        page = tool_list_drawers(wing="transcripts", limit=page_size, offset=offset)
        batch = page.get("drawers", [])
        if not batch:
            break
        for stub in batch:
            did = stub.get("drawer_id")
            if not did:
                continue
            full = tool_get_drawer(drawer_id=did)
            drawers.append({
                "drawer_id": did,
                "room": full.get("room", "") or stub.get("room", ""),
                "content": full.get("content", ""),
                "filed_at": (full.get("metadata") or {}).get("filed_at", ""),
            })
        if len(batch) < page_size:
            break
        offset += page_size
    return drawers


def _deep_excerpt(content: str, pattern: str) -> str:
    """Return the first line containing `pattern` (capped at 120 chars)."""
    for line in content.splitlines():
        if re.search(pattern, line, re.IGNORECASE):
            excerpt = line.strip()
            return excerpt[:120] + "…" if len(excerpt) > 120 else excerpt
    return ""


def compose_deep_review(
    candidates: List[Dict[str, Any]],
    total_scanned: int,
    window: int,
) -> str:
    """Compose a Markdown review document from heuristic candidates."""
    import datetime
    today = datetime.date.today().isoformat()
    by_pattern: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for c in candidates:
        for pat_label in c["matched_patterns"]:
            by_pattern[pat_label].append(c)

    lines: List[str] = [
        f"# Harness Deep Sweep — {today}",
        "",
        f"Scanned **{total_scanned}** drawers from `wing=transcripts` (window: {window}).",
        f"Pre-filtered to **{len(candidates)}** candidate drawers matching heuristic patterns.",
        "",
        "> Tick the items you want to promote to real friction tags, then run `/harness-report`",
        "> for each one to create a `FRICTION:` payload in `wing=harness-friction`.",
        "",
    ]
    for pat_label, items in sorted(by_pattern.items(), key=lambda kv: -len(kv[1])):
        pattern_re = _DEEP_HEURISTICS[pat_label]
        lines.append(
            f"## Pattern: `{pat_label}` "
            f"({len(items)} occurrence{'s' if len(items) != 1 else ''})"
        )
        lines.append("")
        shown = items[:20]
        for item in shown:
            date = item["filed_at"].split("T")[0] if item.get("filed_at") else "unknown"
            lines.append(
                f"- [ ] Drawer `{item['drawer_id']}` "
                f"(room: `{item['room'] or '?'}`, date: {date})"
            )
            excerpt = _deep_excerpt(item["content"], pattern_re)
            if excerpt:
                lines.append(f"  > {excerpt}")
        if len(items) > 20:
            lines.append(f"  _({len(items) - 20} more occurrences not shown)_")
        lines.append("")
    lines += [
        "## Next steps",
        "",
        "For each ticked item, run `/harness-report` to tag it as a `FRICTION:` payload "
        "in `wing=harness-friction`. It will appear in the next regular curator sweep.",
    ]
    return "\n".join(lines)


# --- Main -----------------------------------------------------------------


def main() -> int:
    if DEEP_MODE:
        if STDIN_FILE:
            try:
                drawers = read_from_stdin_file()
            except (OSError, ValueError) as e:
                print(f"Error: failed to read stdin JSON: {e}", file=sys.stderr)
                return 2
        else:
            drawers = read_transcripts_window(DEEP_WINDOW)
        candidates = []
        for drawer in drawers:
            content = drawer.get("content", "")
            matched = [
                label
                for label, pat in _DEEP_HEURISTICS.items()
                if re.search(pat, content, re.IGNORECASE)
            ]
            if matched:
                candidates.append({**drawer, "matched_patterns": matched})
        review = compose_deep_review(candidates, len(drawers), DEEP_WINDOW)
        _REAL_STDOUT.write(review)
        _REAL_STDOUT.write("\n")
        _REAL_STDOUT.flush()
        return 0

    if STDIN_FILE:
        try:
            drawers = read_from_stdin_file()
        except (OSError, ValueError) as e:
            print(f"Error: failed to read stdin JSON: {e}", file=sys.stderr)
            return 2
    else:
        drawers = read_from_mempalace()

    stats = {
        "total_drawers": len(drawers),
        "valid_frictions": 0,
        "skipped_malformed": 0,
        "skipped_resolved": 0,
        "clusters_formed": 0,
        "clusters_above_threshold": 0,
        "clusters_parked": 0,
        "clusters_truncated": 0,
        "routing_failures": 0,
    }

    parsed: List[Tuple[Dict[str, Any], str, str, str]] = []
    skipped: List[Dict[str, Any]] = []
    for drawer in drawers:
        content = drawer.get("content", "")
        room = drawer.get("room", "")
        filed_at = drawer.get("filed_at", "")
        drawer_id = drawer.get("drawer_id", "")
        friction, reason = parse_friction(content)
        if friction is None:
            if reason == "resolved":
                stats["skipped_resolved"] += 1
            else:
                stats["skipped_malformed"] += 1
                snippet = content[:200]
                if len(content) > 200:
                    snippet += "..."
                skipped.append({
                    "drawer_id": drawer_id,
                    "room": room,
                    "reason": reason,
                    "snippet": snippet,
                })
            continue
        parsed.append((friction, room, filed_at, drawer_id))
        stats["valid_frictions"] += 1

    clusters = cluster_frictions(parsed)
    stats["clusters_formed"] = len(clusters)

    output_clusters: List[Dict[str, Any]] = []
    routing_failures: List[Dict[str, Any]] = []
    for cluster_key, items in clusters.items():
        if not cluster_qualifies(items, THRESHOLD):
            stats["clusters_parked"] += 1
            continue
        target = pick_target_repo(items)
        if target is None:
            stats["routing_failures"] += 1
            routing_failures.append({
                "cluster_key": cluster_key,
                "frictions": items,
                "reason": "missing_canonical",
            })
            continue
        stats["clusters_above_threshold"] += 1
        title, body = compose_body(cluster_key, items, target)
        output_clusters.append({
            "cluster_key": cluster_key,
            "cluster_size": len(items),
            "target_repo": target,
            "title": title,
            "body": body,
            "labels": cluster_labels(items),
            "frictions": items,
        })

    # Deterministic ranking before truncation: severity descending (high → low),
    # cluster_size descending, cluster_key ascending (tie-breaker for stability).
    # Severity rank is pulled from the `severity:<x>` label already computed by
    # cluster_labels(), keeping the labels block as the single source of truth.
    def _severity_from_labels(labels: List[str]) -> str:
        for lbl in labels:
            if lbl.startswith("severity:"):
                return lbl.split(":", 1)[1]
        return "med"

    output_clusters.sort(
        key=lambda c: (
            -SEVERITY_RANK.get(_severity_from_labels(c.get("labels", [])), 1),
            -c["cluster_size"],
            c["cluster_key"],
        )
    )

    # --max-issues truncation: 0 = unlimited (existing behavior). When the
    # cap fires, the surplus clusters drop off the end of the ranked list and
    # are surfaced in stats.clusters_truncated for the run summary. The field
    # is always present (0 when no truncation) so consumers can read it
    # unconditionally.
    if MAX_ISSUES > 0 and len(output_clusters) > MAX_ISSUES:
        stats["clusters_truncated"] = len(output_clusters) - MAX_ISSUES
        output_clusters = output_clusters[:MAX_ISSUES]

    json.dump(
        {
            "stats": stats,
            "clusters": output_clusters,
            "skipped": skipped,
            "routing_failures": routing_failures,
        },
        _REAL_STDOUT,
        indent=2,
        ensure_ascii=False,
    )
    _REAL_STDOUT.write("\n")
    _REAL_STDOUT.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
