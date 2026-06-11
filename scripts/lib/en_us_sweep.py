#!/usr/bin/env python3
"""en-GB -> en-US orthographic sweep engine (spec 0023).

This is the single shared implementation behind both the sweep (apply the
replacement map) and the R6 detector (assert zero residual British spellings).
Both operate over the SAME in-scope set S, computed by ONE masking pipeline,
so the detector can never flag a token the sweep was designed not to touch.

S = sweepable character ranges of a file =
    (a) Markdown human prose  (outside fenced code, inline code, link/image
        URL targets, raw HTML tags, and YAML frontmatter scalar values), OR
    (b) comment text of source files (shell/py/yaml/toml `#` tails -- quote
        -state-aware so a `#` inside a string is never mis-split -- plus `.py`
        docstrings and C-style // and /* */), OR
    (c) non-load-bearing user-facing message-string args (echo/printf/report/
        note_* "...").

MINUS the out-of-reach set X (code-semantic tokens that happen to spell a
British word):
    - code identifiers / variable names (the shell var `artefact`),
    - strings compared by an assertion (==, =~, grep -q, [[ ]]),
    - sample/fixture payload strings passed to code (a `${1:-...}` default
      that is an LLM prompt).

X is enforced two ways: (1) by construction -- the masking never emits code
identifiers or `${...}` expansions or compared operands as sweepable ranges --
and (2) by an explicit, reviewed per-file allowlist of literal (line, token)
pairs for the residual cases the structural rules cannot see.

The module exposes:
    sweepable_ranges(path, text) -> list[(start, end)]   # the set S
    apply_map(path, text, mapping) -> (new_text, counts)
    detect(path, text, words) -> list[(lineno, word)]

`sweepable_ranges` is THE shared pipeline -- both apply_map and detect call it.
"""

from __future__ import annotations

import os
import re
import sys

# --------------------------------------------------------------------------- #
# X -- explicit out-of-reach allowlist.
#
# Keyed by repo-relative path. Each entry lists literal British-spelled tokens
# that, on ANY line of that file, must be treated as code-semantic and excluded
# from BOTH sweep and detect even if they survive the structural masking.
#
# These are the residual cases the structural rules cannot disambiguate on
# their own (a bare `artefact` word inside a comment vs. the `$artefact` shell
# identifier on the same conceptual file). The structural pipeline already
# drops `$artefact`, `${artefact...}`, `artefact=` (code, not comment); this
# allowlist additionally protects the `<artefact>` parameter-doc token in the
# `# Usage:` comment lines, which ARE comment text but document the variable.
# --------------------------------------------------------------------------- #
X_DOC_TOKEN_FILES = {
    "tests/e2e/lib/assert.sh",
    "tests/e2e/lib/llm_judge.sh",
    "tests/e2e/lib/structural.sh",
}

# Sample-payload strings: a British word inside a code-fed literal (not a
# comment, not an echo/report message). Keyed by path -> set of substrings that,
# when present on a line, mark the British token on that line as out-of-reach.
X_SAMPLE_PAYLOAD = {
    "docs/research/artifacts/147/trace-gemini-p.sh": [
        # The `${1:-what colour is ...}` default is a literal model prompt
        # fed to `gemini -p`. Load-bearing sample payload (R3), not prose.
        '${1:-what colour',
    ],
}


# --------------------------------------------------------------------------- #
# Case-aware whole-word replacement helpers.
# --------------------------------------------------------------------------- #
def _case_variants(british: str, american: str):
    """Yield (pattern_word, replacement) for lower / Title / UPPER casings."""
    yield british.lower(), american.lower()
    yield british.capitalize(), american.capitalize()
    yield british.upper(), american.upper()


def build_substitutions(mapping: list[tuple[str, str]]):
    """Compile a single alternation regex over all case variants.

    Longest-first so e.g. `organisations` is tried before `organisation`.
    Word-boundary anchored; `(?<![\\w-])`/`(?![\\w-])` so hyphenated and
    underscore-joined identifiers are not partially rewritten.
    """
    pairs: dict[str, str] = {}
    for british, american in mapping:
        for pat, repl in _case_variants(british, american):
            pairs.setdefault(pat, repl)
    words = sorted(pairs, key=len, reverse=True)
    alt = "|".join(re.escape(w) for w in words)
    # Word boundary is `\w` only (NOT `-`). In prose, a hyphen separates
    # words, so `Organisation-specific` must have its first element swept.
    # Underscore stays inside `\w`, so a code identifier like `organisation_id`
    # is protected -- but such identifiers live in masked-out code regions
    # anyway and never reach this substitution.
    rx = re.compile(r"(?<!\w)(" + alt + r")(?!\w)")
    return rx, pairs


def build_detector(words: list[str]):
    variants = set()
    for w in words:
        variants.add(w.lower())
    alt = "|".join(re.escape(w) for w in sorted(variants, key=len, reverse=True))
    # Case-insensitive whole-word; same boundary rule as the substituter
    # (hyphen is a prose separator, so it does not bound the match).
    return re.compile(r"(?<!\w)(" + alt + r")(?!\w)", re.IGNORECASE)


# --------------------------------------------------------------------------- #
# Masking: compute the sweepable ranges S for a file.
#
# Strategy: build a boolean mask over the text (True = sweepable prose/comment),
# then collapse to (start, end) ranges. Each language gets its own mask builder.
# --------------------------------------------------------------------------- #
def _ranges_from_mask(mask: list[bool]):
    ranges = []
    i = 0
    n = len(mask)
    while i < n:
        if mask[i]:
            j = i
            while j < n and mask[j]:
                j += 1
            ranges.append((i, j))
            i = j
        else:
            i += 1
    return ranges


# ---- Markdown -------------------------------------------------------------- #
_FENCE_RE = re.compile(r"^(\s*)(```+|~~~+)")
_FRONTMATTER_DELIM = "---"


def _markdown_mask(text: str) -> list[bool]:
    mask = [False] * len(text)
    lines = text.splitlines(keepends=True)
    pos = 0
    in_fence = False
    fence_marker = ""
    in_frontmatter = False
    seen_first_line = False
    # Frontmatter `description:` is human prose shipped to the CLIs and is in
    # R1 scope. We sweep ONLY the description scalar value (inline, multi-line
    # inline, or block `|`/`>` form); every other frontmatter key (name, type,
    # license, version, canonical/feedback URLs, tool lists) stays masked as an
    # identifier.
    desc_block_indent = None  # key indent while inside a `description:` block
    desc_cont_indent = None   # key indent while inside a multi-line inline desc

    for idx, line in enumerate(lines):
        start = pos
        pos += len(line)
        stripped = line.strip("\n")

        # YAML frontmatter: a leading `---` on line 0 opens it; the next `---`
        # closes it.
        if not seen_first_line:
            seen_first_line = True
            if stripped.strip() == _FRONTMATTER_DELIM:
                in_frontmatter = True
                continue
        if in_frontmatter:
            if stripped.strip() == _FRONTMATTER_DELIM:
                in_frontmatter = False
                desc_block_indent = None
                desc_cont_indent = None
                continue
            indent = len(line) - len(line.lstrip(" "))
            is_new_key = bool(re.match(r'^\s*[A-Za-z0-9_.-]+:(\s|$)', line))
            # Are we continuing a `description:` block scalar?
            if desc_block_indent is not None:
                if stripped.strip() == "" or indent > desc_block_indent:
                    for k in range(len(stripped)):
                        mask[start + k] = True
                    continue
                else:
                    desc_block_indent = None  # block ended; fall through
            # Are we continuing a multi-line inline `description:` scalar?
            if desc_cont_indent is not None:
                if not is_new_key and (stripped.strip() != "") and indent > desc_cont_indent:
                    # Continuation line of the inline scalar -> prose. Sweep it,
                    # but drop a trailing closing quote from the swept span.
                    body = stripped
                    a, b = 0, len(body)
                    if b and body[b - 1] in "\"'":
                        b -= 1
                    for k in range(a, b):
                        mask[start + k] = True
                    continue
                else:
                    desc_cont_indent = None  # scalar ended; fall through
            m = re.match(r'^(\s*)description:\s*(.*)$', line)
            if m:
                val = m.group(2).rstrip("\n")
                if val in ("|", ">", "|-", ">-", "|+", ">+"):
                    desc_block_indent = indent  # block scalar opens next line
                else:
                    desc_cont_indent = indent   # may continue on indented lines
                    # Inline scalar: sweep the value text (strip surrounding
                    # quotes from the swept span so quote chars are preserved).
                    vstart = start + m.start(2)
                    v = m.group(2)
                    a, b = 0, len(v)
                    if len(v) >= 2 and v[0] in "\"'" and v[-1] == v[0]:
                        a, b = 1, len(v) - 1
                    for k in range(a, b):
                        mask[vstart + k] = True
                continue
            # Any other frontmatter key -> identifier/scalar, never swept.
            continue

        # Fenced code blocks.
        m = _FENCE_RE.match(line)
        if m:
            marker = m.group(2)
            if not in_fence:
                in_fence = True
                fence_marker = marker[0] * 3
                continue
            elif marker[0] * 3 == fence_marker:
                in_fence = False
                continue
        if in_fence:
            continue

        # Prose line: mark sweepable, then carve OUT inline code spans, link/
        # image URL targets, and raw HTML tags.
        line_mask = _markdown_prose_line_mask(stripped)
        for k, val in enumerate(line_mask):
            mask[start + k] = val

    return mask


_INLINE_CODE_RE = re.compile(r"(`+)(?:.*?)(\1)")
_LINK_TARGET_RE = re.compile(r"\]\(([^)]*)\)")
_AUTOLINK_RE = re.compile(r"<((?:https?|mailto|ftp):[^>]*)>")
_HTML_TAG_RE = re.compile(r"</?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^>]*)?/?>")
_BARE_URL_RE = re.compile(r"\b(?:https?|ftp)://[^\s)\]<>`]+")
_REF_DEF_RE = re.compile(r"^\s*\[[^\]]+\]:\s*\S+")


def _markdown_prose_line_mask(line: str) -> list[bool]:
    m = [True] * len(line)

    # Reference-definition lines ([id]: url "title") -> the URL is not prose.
    if _REF_DEF_RE.match(line):
        # Mask only up to the optional quoted title; simplest safe choice:
        # treat the whole line as non-prose except a trailing quoted title.
        for i in range(len(line)):
            m[i] = False
        # Re-enable a trailing "quoted title" if present.
        tq = re.search(r'"([^"]*)"\s*$', line)
        if tq:
            for i in range(tq.start(1), tq.end(1)):
                m[i] = True
        return m

    def kill(rx):
        for mt in rx.finditer(line):
            for i in range(mt.start(), mt.end()):
                m[i] = False

    # Inline code spans first (highest priority: their content is literal).
    kill(_INLINE_CODE_RE)
    # Link/image targets: `](URL)` -- kill the URL inside the parens.
    for mt in _LINK_TARGET_RE.finditer(line):
        for i in range(mt.start(1), mt.end(1)):
            m[i] = False
    kill(_AUTOLINK_RE)
    kill(_HTML_TAG_RE)
    kill(_BARE_URL_RE)
    return m


# ---- Shell / generic-# languages ------------------------------------------ #
def _hash_comment_mask(text: str, allow_message_strings: bool) -> list[bool]:
    """Mask for shell/yaml/toml: sweep `#` comment tails (quote-aware) and,
    optionally, non-load-bearing echo/printf/report/note_* message strings."""
    mask = [False] * len(text)
    lines = text.splitlines(keepends=True)
    pos = 0
    for line in lines:
        start = pos
        pos += len(line)
        body = line.rstrip("\n")
        cstart = _shell_comment_start(body)
        if cstart is not None:
            for i in range(cstart + 1, len(body)):
                mask[start + i] = True
        if allow_message_strings:
            for a, b in _message_string_spans(body):
                for i in range(a, b):
                    mask[start + i] = True
    return mask


def _shell_comment_start(line: str):
    """Return index of the `#` that begins a comment, or None.

    Quote-state-aware: a `#` inside a single- or double-quoted string, or one
    that is part of `${var#...}` / `$#` / `#!shebang` / a `#` glued to a
    non-space word char (e.g. `ref#273`, `${x#y}`), is NOT a comment.
    """
    if line.lstrip().startswith("#!"):
        return None
    in_s = in_d = False
    i = 0
    n = len(line)
    while i < n:
        c = line[i]
        if c == "\\" and i + 1 < n:
            i += 2
            continue
        if in_s:
            if c == "'":
                in_s = False
            i += 1
            continue
        if in_d:
            if c == '"':
                in_d = False
            i += 1
            continue
        if c == "'":
            in_s = True
            i += 1
            continue
        if c == '"':
            in_d = True
            i += 1
            continue
        if c == "#":
            # Must be at start or preceded by whitespace to be a comment;
            # a `#` glued to a word char is parameter-expansion / fragment.
            if i == 0 or line[i - 1].isspace():
                return i
            i += 1
            continue
        i += 1
    return None


# A user-facing message *command* (echo/printf/report/note_*/log/warn/...) at
# the start of a simple command. Anchored so a *variable assignment* like
# `report_line="..."` (which is code, not a message call) is NOT matched: the
# command name must be followed by whitespace, never by `=`.
_MSG_CALL_RE = re.compile(
    r'(?:^|[;&|(]|\bthen\b|\bdo\b|\belse\b)\s*'
    r'(echo|printf|report|note_skip|note_pass|note_fail|note_info|note_warn|log|logf|warn|info|die|fail|pass)\b(?!=)\s')
_DQ_STRING_RE = re.compile(r'"((?:[^"\\]|\\.)*)"')
_COMPARE_HINT_RE = re.compile(r'(==|!=|=~|\[\[|grep\s+-[a-zA-Z]*q|\bcase\b)')
# Any shell expansion or substitution inside a string: `$var`, `${...}`,
# `$(...)`, backticks. A span containing one of these is code-bearing and is
# skipped wholesale (we never sweep a message string that interpolates code).
_SHELL_EXPANSION_RE = re.compile(r'(\$\{?\w|\$\(|`)')


def _message_string_spans(line: str):
    """Spans of double-quoted args to user-facing message commands, EXCLUDING
    lines that look load-bearing (comparisons) and any string that interpolates
    a shell expansion (`$var`, `${...}`, `$(...)`, backticks) -- those are
    code-bearing and never touched (R3)."""
    spans = []
    if _COMPARE_HINT_RE.search(line):
        return spans
    if not _MSG_CALL_RE.search(line):
        return spans
    for mt in _DQ_STRING_RE.finditer(line):
        content = mt.group(1)
        if _SHELL_EXPANSION_RE.search(content):
            continue
        spans.append((mt.start(1), mt.end(1)))
    return spans


# ---- Python ---------------------------------------------------------------- #
def _python_mask(text: str) -> list[bool]:
    """Sweep `#` comments and triple-quoted docstrings; never code or
    single-line string literals (which may be load-bearing)."""
    mask = [False] * len(text)
    n = len(text)
    i = 0
    in_s = in_d = False  # single/double single-char strings
    triple = None  # current triple-quote marker or None
    line_has_code = False
    while i < n:
        c = text[i]
        two = text[i:i + 3]
        if triple:
            # Inside a triple-quoted block: sweep it as prose (docstring).
            if text[i:i + 3] == triple:
                triple = None
                i += 3
                continue
            mask[i] = True
            i += 1
            continue
        if in_s:
            if c == "\\":
                i += 2
                continue
            if c == "'":
                in_s = False
            i += 1
            continue
        if in_d:
            if c == "\\":
                i += 2
                continue
            if c == '"':
                in_d = False
            i += 1
            continue
        if two == '"""' or two == "'''":
            triple = two
            i += 3
            continue
        if c == "'":
            in_s = True
            i += 1
            continue
        if c == '"':
            in_d = True
            i += 1
            continue
        if c == "#":
            j = i
            while j < n and text[j] != "\n":
                mask[j] = True
                j += 1
            i = j
            continue
        i += 1
    return mask


# ---- dispatch -------------------------------------------------------------- #
def sweepable_ranges(path: str, text: str):
    """THE shared pipeline. Returns S as a list of (start, end) ranges, with
    the X allowlist subtracted."""
    rel = _relpath(path)
    lower = path.lower()
    if lower.endswith((".md", ".md.template", ".markdown")):
        mask = _markdown_mask(text)
    elif lower.endswith(".py"):
        mask = _python_mask(text)
    elif lower.endswith((".sh", ".bash")):
        mask = _hash_comment_mask(text, allow_message_strings=True)
    elif lower.endswith((".yml", ".yaml")):
        mask = _hash_comment_mask(text, allow_message_strings=False)
    elif lower.endswith(".toml") or lower.endswith(".toml.template"):
        mask = _hash_comment_mask(text, allow_message_strings=False)
    else:
        # Unknown type: nothing is sweepable.
        mask = [False] * len(text)

    _subtract_x(rel, text, mask)
    return _ranges_from_mask(mask)


def _relpath(path: str) -> str:
    p = os.path.abspath(path)
    # Normalise to repo-relative by stripping any worktree prefix.
    for marker in ("/.worktrees/",):
        if marker in p:
            tail = p.split(marker, 1)[1]
            # tail = "<ticket>/<relpath>"
            parts = tail.split("/", 1)
            if len(parts) == 2:
                return parts[1]
    # Fall back: relative to cwd.
    try:
        return os.path.relpath(p)
    except ValueError:
        return path


def _subtract_x(rel: str, text: str, mask: list[bool]):
    """Remove X members from the mask (line-scoped literal protections)."""
    # 1. `$artefact` / `${artefact...}` / `artefact=` identifiers: these are
    #    code, already excluded by the comment-only masks, but the bare word in
    #    a `# Usage:` doc-comment IS comment text. Protect `<artefact>` and the
    #    word `artefact` on Usage/parameter-doc lines in the e2e libs.
    if rel in X_DOC_TOKEN_FILES:
        _kill_word_on_matching_lines(
            text, mask,
            line_pred=lambda ln: ("usage:" in ln.lower()) or ("<artefact>" in ln.lower()),
            word="artefact",
        )
    # 2. Sample-payload strings.
    for xpath, needles in X_SAMPLE_PAYLOAD.items():
        if rel == xpath:
            _kill_word_on_matching_lines(
                text, mask,
                line_pred=lambda ln, nd=needles: any(s in ln for s in nd),
                word=None,  # kill the whole line's sweepable mask
            )


def _kill_word_on_matching_lines(text, mask, line_pred, word):
    pos = 0
    for line in text.splitlines(keepends=True):
        start = pos
        pos += len(line)
        if not line_pred(line):
            continue
        if word is None:
            for i in range(start, start + len(line)):
                mask[i] = False
        else:
            for mt in re.finditer(r"(?<![\w-])" + re.escape(word) + r"s?(?![\w-])",
                                  line, re.IGNORECASE):
                for i in range(mt.start(), mt.end()):
                    mask[start + i] = False


# --------------------------------------------------------------------------- #
# Public operations.
# --------------------------------------------------------------------------- #
def apply_map(path: str, text: str, rx, pairs):
    ranges = sweepable_ranges(path, text)
    counts: dict[str, int] = {}
    out = []
    last = 0
    for a, b in ranges:
        out.append(text[last:a])
        segment = text[a:b]

        def _repl(mt):
            src = mt.group(1)
            dst = pairs[src]
            counts[src] = counts.get(src, 0) + 1
            return dst

        out.append(rx.sub(_repl, segment))
        last = b
    out.append(text[last:])
    return "".join(out), counts


def detect(path: str, text: str, det_rx):
    ranges = sweepable_ranges(path, text)
    hits = []
    # Map char offset -> line number for reporting.
    for a, b in ranges:
        segment = text[a:b]
        for mt in det_rx.finditer(segment):
            off = a + mt.start()
            lineno = text.count("\n", 0, off) + 1
            hits.append((lineno, mt.group(0)))
    return hits


# --------------------------------------------------------------------------- #
# Loaders.
# --------------------------------------------------------------------------- #
def load_map(path: str):
    pairs = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            parts = s.split()
            if len(parts) != 2:
                raise SystemExit(f"malformed map line: {line!r}")
            pairs.append((parts[0], parts[1]))
    return pairs


def load_words(path: str):
    words = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            words.append(s)
    return words
