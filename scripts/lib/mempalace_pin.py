#!/usr/bin/env python3
"""MemPalace supported-range pin parser and range comparator (spec 0108).

One home for the two operations shared by the memory-server launch guard in
``mempalace-http-wrapper.py`` and the operator diagnostic
``scripts/doctor-mempalace.sh``:

* :func:`read_pin` — extract ``MEMPALACE_MIN_VERSION`` and
  ``MEMPALACE_MAX_VERSION_EXCLUSIVE`` from ``scripts/lib/common.sh``, the single
  executable declaration of the supported range (spec 0108 R5). Neither bound is
  written into this file, and no shell is spawned to obtain them.
* :func:`check` — decide whether a found version lies in ``[min, max)``, and
  report which comparator produced the verdict so a caller can name it.

No third-party import at module scope
-------------------------------------
The launch guard runs inside the very process that goes on to serve the MCP
session — before ``chromadb`` is patched and before ``mempalace`` is imported.
A module-scope third-party dependency here would either fail every launch on an
interpreter that lacks it or perturb that import order. ``packaging`` is
therefore imported lazily inside :func:`check` and is strictly optional: when it
is unimportable, :func:`check` falls back to the closed whitelist grammar
documented below.

Dual role, one file
-------------------
This module is a stderr-writing library inside a process that owns a JSON-RPC
channel on stdout, and a stdout-writing CLI when run directly. Every ``print``
and every ``sys.argv`` access therefore lives under ``if __name__ ==
"__main__":`` — a stray module-scope write would corrupt the MCP handshake of
the process that imports it.
"""
import os
import re
import sys

#: Verdict provenance labels reported alongside every :func:`check` result.
COMPARATOR_PACKAGING = "packaging"
COMPARATOR_FALLBACK = "stdlib-whitelist"

_PIN_NAMES = ("MEMPALACE_MIN_VERSION", "MEMPALACE_MAX_VERSION_EXCLUSIVE")

# Line-anchored, so the interpolated consumer forms further down common.sh
# (e.g. `mempalace>=${MEMPALACE_MIN_VERSION},<${...}` inside a message) never
# match. Exactly one declaration per name is required; see read_pin.
_PIN_RE = re.compile(
    r'^(MEMPALACE_MIN_VERSION|MEMPALACE_MAX_VERSION_EXCLUSIVE)="([^"]*)"$',
    re.M,
)

# --- The degraded-mode comparator's closed whitelist grammar -----------------
#
# Admits exactly `release[.postN][+local]` and refuses everything it does not
# fully consume — pre-releases, dev releases, epochs, non-canonical post
# spellings, and unparseable remainders alike.
#
# The invariant this shape buys, as a property of the rule rather than of a row
# set: (i) every string the grammar admits is a valid PEP 440 version, so
# `packaging.version.Version()` never raises on anything the fallback accepts;
# (ii) no admitted string carries an epoch, a pre-release or a dev-release, so
# its ordering position is its release tuple, possibly nudged *upward* by a post
# or local segment, never downward; (iii) both bounds are plain releases, so
# `min <= rel < max` on zero-padded tuples implies
# `Version(min) <= Version(s) < Version(max)`. Therefore fallback-ACCEPT implies
# `packaging`-ACCEPT for every string, by construction. The converse fails —
# `packaging` additionally accepts in-range pre/dev releases, epoch-qualified
# versions and non-canonical post spellings — so every divergence between the
# two comparators is a refusal, which is the safe direction.
#
# Deliberately NOT admitted: the `-N`, `.revN` and `.rN` implicit-post spellings
# PEP 440 normalises. Each widening is a fresh opportunity for the invariant to
# break; this is a degraded-mode comparator whose job is to be safe rather than
# maximally compatible, and the cost of omitting them is exactly one extra
# refusal.
_FALLBACK_RE = re.compile(
    r"^(?P<release>[0-9]+(?:\.[0-9]+)*)"
    r"(?:\.post[0-9]+)?"
    r"(?:\+[a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)*)?$"
)

#: A bound the whitelist can order: a plain release segment, nothing else.
_RELEASE_RE = re.compile(r"^[0-9]+(?:\.[0-9]+)*$")


def read_pin(common_sh_path):
    """Return ``(min_version, max_version_exclusive)`` read from *common_sh_path*.

    Raises ``OSError`` when the file cannot be read, and ``ValueError`` when
    either name is absent or declared more than once. The pin is a
    single-declaration contract (spec 0108 R5); an ambiguous file is a refusal,
    never a guess between candidates.
    """
    with open(os.fspath(common_sh_path), "r", encoding="utf-8") as handle:
        text = handle.read()
    seen = {}
    for name, value in _PIN_RE.findall(text):
        seen.setdefault(name, []).append(value)
    bounds = []
    for name in _PIN_NAMES:
        values = seen.get(name, [])
        if len(values) != 1:
            raise ValueError(
                '{0} must be declared exactly once as {0}="<version>" at line '
                "start; found {1} declaration(s) in {2}".format(
                    name, len(values), os.fspath(common_sh_path)
                )
            )
        bounds.append(values[0])
    return bounds[0], bounds[1]


def check(found, minimum, maximum):
    """Return ``(in_range, comparator)`` for *found* against ``[min, max)``.

    ``packaging`` is the primary comparator. A version string it rejects as
    invalid is refused, not ignored: an unparseable version is an unmet
    precondition, and the guard fails closed on it.

    When ``packaging`` is unimportable the closed whitelist grammar above
    decides instead, and the returned comparator label says so.

    This function is total on both paths: it returns a verdict for every input
    or refuses, and never propagates an exception. A traceback here would kill
    the launch *without* the R3 field set its caller is about to emit — the
    diagnostic, not the exit status, is what spec 0108 buys.
    """
    try:
        from packaging.version import Version
    except ImportError:
        return _fallback_in_range(found, minimum, maximum), COMPARATOR_FALLBACK
    try:
        verdict = Version(minimum) <= Version(found) < Version(maximum)
    except ValueError:
        # `ValueError` rather than `InvalidVersion`, which it is a subclass of,
        # because the bare form is reachable too: `Version.__init__` maps
        # `int()` over the release segment, so a segment longer than CPython's
        # 4 300-digit conversion limit raises a plain `ValueError` from inside
        # `packaging` before any validity verdict exists. Both are the same
        # unmet precondition — a version string this comparator cannot order —
        # and both fail closed.
        return False, COMPARATOR_PACKAGING
    return verdict, COMPARATOR_PACKAGING


def _fallback_in_range(found, minimum, maximum):
    """Whitelist-grammar range test used when ``packaging`` is unimportable."""
    match = _FALLBACK_RE.match(found.strip())
    if match is None:
        return False
    low, high = minimum.strip(), maximum.strip()
    if _RELEASE_RE.match(low) is None or _RELEASE_RE.match(high) is None:
        # A bound this grammar cannot order is refused rather than guessed:
        # refusal keeps the never-more-permissive-than-`packaging` invariant.
        return False
    try:
        tuples = [
            _release_tuple(match.group("release")),
            _release_tuple(low),
            _release_tuple(high),
        ]
    except ValueError:
        # `int()` on a release segment longer than CPython's 4 300-digit
        # conversion limit. The grammar admits such a string, so this is the
        # fallback's mirror of the same guard `check` applies on the `packaging`
        # branch: unorderable is refused, never raised.
        return False
    width = max(len(item) for item in tuples)
    rel, mn, mx = (_padded(item, width) for item in tuples)
    return mn <= rel < mx


def _release_tuple(release):
    return tuple(int(part) for part in release.split("."))


def _padded(release_tuple, width):
    return release_tuple + (0,) * (width - len(release_tuple))


if __name__ == "__main__":
    import argparse

    _parser = argparse.ArgumentParser(
        description=(
            "MemPalace supported-range pin parser and comparator (spec 0108). "
            "Reads the pin from a given scripts/lib/common.sh; carries no bound "
            "of its own."
        )
    )
    _parser.add_argument(
        "--common-sh",
        metavar="PATH",
        help="path to the scripts/lib/common.sh that declares the pin",
    )
    _modes = _parser.add_mutually_exclusive_group(required=True)
    _modes.add_argument(
        "--check",
        metavar="VERSION",
        help="report whether VERSION lies in the pinned range (exit 0 / 1)",
    )
    _modes.add_argument(
        "--print-pin",
        action="store_true",
        help="print the parsed bounds as `min=<min> max=<max>`",
    )
    _modes.add_argument(
        "--probe",
        action="store_true",
        help=(
            "report what THIS interpreter resolves: the dist-info version, the "
            "mempalace.__version__ literal, and whether packaging is importable"
        ),
    )
    _args = _parser.parse_args()

    if _args.probe:
        from importlib.metadata import PackageNotFoundError
        from importlib.metadata import version as _dist_version

        try:
            _dist = _dist_version("mempalace")
        except PackageNotFoundError:
            _dist = "absent"
        # A bare `import mempalace` is a strictly narrower probe than the one
        # the framework's own detect_mempalace_python already performs on every
        # setup run (`python -c "import mempalace.mcp_server"`, common.sh), and
        # it runs in a throwaway process that never serves a session.
        try:
            import mempalace as _mempalace

            _attr = getattr(_mempalace, "__version__", "absent")
        except ImportError:
            _attr = "absent"
        try:
            import packaging.version  # noqa: F401

            _has_packaging = "yes"
        except ImportError:
            _has_packaging = "no"
        print("interpreter={0}".format(sys.executable))
        print("dist={0}".format(_dist))
        print("attr={0}".format(_attr))
        print("packaging={0}".format(_has_packaging))
        sys.exit(0)

    if not _args.common_sh:
        print(
            "ERROR: --common-sh is required with --check and --print-pin",
            file=sys.stderr,
        )
        sys.exit(2)

    try:
        _min, _max = read_pin(_args.common_sh)
    except (OSError, ValueError) as _exc:
        print("PIN_ERROR {0}".format(_exc), file=sys.stderr)
        sys.exit(2)

    if _args.print_pin:
        print("min={0} max={1}".format(_min, _max))
        sys.exit(0)

    _ok, _comparator = check(_args.check, _min, _max)
    print(
        "{0} version={1} range=>={2},<{3} comparator={4}".format(
            "IN_RANGE" if _ok else "OUT_OF_RANGE",
            _args.check,
            _min,
            _max,
            _comparator,
        )
    )
    sys.exit(0 if _ok else 1)
