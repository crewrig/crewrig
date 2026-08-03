#!/usr/bin/env python3
# Requires: chromadb>=1.5.9
# Prefers (optional): packaging — the primary version comparator of the
# spec-0108 launch guard. When it is unimportable the guard falls back to the
# closed whitelist grammar in scripts/lib/mempalace_pin.py, which is never more
# permissive than `packaging`. Which comparator decided is named in every
# refusal diagnostic and reported by scripts/doctor-mempalace.sh.
"""MemPalace MCP server wrapper — routes ``chromadb.PersistentClient`` to the
shared ChromaDB HTTP daemon.

Why this exists
---------------
MemPalace always instantiates ``chromadb.PersistentClient`` internally (see
``mempalace/backends/chroma.py``). When multiple MCP server processes run
concurrently they each spawn an independent Rust HNSW compactor against the
same on-disk index, corrupting the shared binary files.

Solution: a single ``chroma run`` HTTP daemon owns the index, and every
MCP server connects via ``HttpClient``. This wrapper monkey-patches the
``PersistentClient`` symbol **before** ``mempalace`` is imported, then hands
off to the regular MCP entrypoint.

Configuration
-------------
- ``MEMPALACE_CHROMA_HOST`` (default ``127.0.0.1``) — daemon host (loopback only).
- ``MEMPALACE_CHROMA_PORT`` (default ``8001``) — daemon port.
- ``MEMPALACE_CHROMA_MAX_CONNECTIONS`` (default ``8``) — ceiling on the total
  number of connections this session holds open against the daemon.
- ``MEMPALACE_CHROMA_MAX_KEEPALIVE_CONNECTIONS`` (default ``4``) — ceiling on
  the number of idle keep-alive connections retained between requests.

If the daemon is unreachable at startup we ``exit 1`` with the installer
command on stderr. Silent fallback to ``PersistentClient`` is forbidden by
design — it would re-introduce the corruption bug.

Runtime version guard (spec 0108)
---------------------------------
An out-of-range MemPalace is the same class of unmet precondition as an
unreachable daemon and is treated the same way: this process determines, before
it begins serving, the MemPalace version *its own interpreter* resolves, and
refuses to serve when that version lies outside the range pinned in
``scripts/lib/common.sh``. Two independent gates, both of which must pass:

- **Phase A** (Step 1, before ``chromadb`` is even imported) range-checks
  ``importlib.metadata.version("mempalace")`` — the in-process resolution, the
  same machinery an ``import`` in this process would use.
- **Phase B** (Step 4, after ``mempalace`` is imported) range-checks
  ``mempalace.__version__`` independently. It is *not* compared for equality
  with the Phase A value: ``mempalace/version.py`` is a hand-maintained literal,
  structurally independent of the dist-info field, so a ``.postN`` rebuild
  legitimately disagrees with both values in range. Such disagreement is
  reported by ``scripts/doctor-mempalace.sh``, never refused here.
"""
import os
import sys
import threading
import time

# ── Step 0: orphan self-reap watchdog (spec 0029 R5) ─────────────────────────
# An MCP stdio server normally exits on stdin EOF: ``mempalace.mcp_server.main()``
# loops on ``sys.stdin.readline()`` and breaks when it returns empty, which the
# OS then releases the daemon-side ``HttpClient`` sockets for (sockets close on
# process exit). That covers the common case where the parent agent session dies
# and closes the write-end of the stdin pipe. But if the parent dies while some
# other process keeps that pipe's write-end open, stdin never EOFs and the
# orphaned wrapper lingers, holding its daemon connection open indefinitely —
# the exact leak R5 forbids. This watchdog is a belt-and-suspenders guard for
# that case: it polls ``os.getppid()`` and self-terminates when the parent is
# reaped (reparented to PID 1 = orphaned). It deliberately does NOT read stdin,
# so it cannot steal JSON-RPC bytes that ``main()`` owns. It uses ``os._exit``,
# not ``sys.exit``: ``sys.exit`` only raises ``SystemExit`` in its own thread
# and would not terminate the process from this daemon thread (cold-review
# finding #2).
def _reap_if_orphaned(poll_interval: float = 5.0) -> None:
    while True:
        time.sleep(poll_interval)
        if os.getppid() == 1:
            os._exit(0)


threading.Thread(target=_reap_if_orphaned, daemon=True).start()

# ── Step 1: refuse to serve an out-of-range MemPalace (spec 0108) ────────────
# Placed before `import chromadb` so a refusal costs nothing and cannot perturb
# the patch ordering Step 2 depends on. Every refusal on this path — both guard
# phases plus the branch where the shared pin module itself cannot be imported —
# routes through the single `_refuse` emitter defined below, so R3's four fields
# and R4's restart sentence are structurally impossible to omit.
import importlib.metadata  # noqa: E402

_LIB_DIR = os.path.dirname(os.path.realpath(__file__))
_COMMON_SH = os.path.join(_LIB_DIR, "common.sh")

# R4: every operator-facing output of the guard says this, because a session
# that is already up keeps serving what it loaded at start.
_RESTART_NOTE = (
    "a memory-server session that is already running keeps serving the MemPalace "
    "version it started with; running sessions must be restarted before a change "
    "to the install takes effect."
)


def _refuse(found, source, bounds, comparator, extra="", remedy=None):
    """Emit the R3/R4 refusal diagnostic on stderr and terminate unsuccessfully.

    ``bounds`` is the ``(min, max)`` pair parsed from the pin, or ``None`` when
    the pin itself could not be read — in which case the remedy names the repair
    for that, since no bound may be interpolated from a literal in this file
    (R5). The exit is non-zero so the launching CLI reports a failed memory
    server rather than a started one (R3).

    ``remedy`` overrides the action line a caller would otherwise inherit from
    ``bounds``. The bound-less default — re-run the framework setup from a
    complete checkout — is the right repair for a checkout that is *missing* the
    guard module, and the wrong one for a checkout whose ``common.sh`` is
    present and malformed: re-running setup rewrites no declaration in it. That
    branch therefore names its own remedy rather than pointing the operator at a
    step that would change nothing.
    """
    if bounds is None:
        supported_range = "not determined (see the cause below)"
        default_remedy = (
            "re-run the framework setup from a complete checkout "
            "(scripts/setup-<cli>-interactive.sh), so the pin and the guard "
            "module are both present under scripts/lib/"
        )
    else:
        supported_range = ">={0},<{1}".format(*bounds)
        default_remedy = "pipx install --force 'mempalace>={0},<{1}'".format(*bounds)
    remedy = remedy or default_remedy
    fields = [
        ("MemPalace version found:", "{0}  (source: {1})".format(found, source)),
        ("Supported range:", supported_range),
        ("Resolved interpreter:", sys.executable),
        ("Comparator:", comparator or "not reached"),
        ("To bring into range:", remedy),
    ]
    if extra:
        fields.append(("Cause:", extra))
    fields.append(("NOTE:", _RESTART_NOTE))
    lines = [
        "ERROR: MemPalace runtime version guard refused to start the memory "
        "server (spec 0108)."
    ]
    lines.extend("  {0:<26}{1}".format(label, value) for label, value in fields)
    print("\n".join(lines), file=sys.stderr)
    sys.exit(1)


# The script-directory `sys.path[0]` default is defeated by PYTHONSAFEPATH=1 and
# by `python3 -P`, neither of which the framework controls, so the sibling
# import is made explicit rather than inherited — and undone again as soon as the
# import has resolved. This file's whole premise is not perturbing the process
# that goes on to serve, and a `scripts/lib/` left on `sys.path` for the life of
# the session would let any future module dropped there shadow a same-named
# import for `mempalace` or `chromadb`. Only an entry this file added is removed:
# when the interpreter already supplied the directory as `sys.path[0]`, that
# entry is the interpreter's and is left alone.
_MP_PATH_ADDED = _LIB_DIR not in sys.path
if _MP_PATH_ADDED:
    sys.path.insert(0, _LIB_DIR)

try:
    import mempalace_pin  # noqa: E402
except ImportError as _pin_import_error:
    # Fails closed deliberately, with a diagnostic rather than a stack trace: a
    # guard that cannot load is not a guard, and a checkout missing its own
    # sibling module must not silently serve an unchecked install.
    _refuse(
        "not determined",
        "not reached",
        None,
        None,
        extra="the guard module {0}/mempalace_pin.py could not be imported: "
        "{1}".format(_LIB_DIR, _pin_import_error),
    )
finally:
    if _MP_PATH_ADDED and _LIB_DIR in sys.path:
        sys.path.remove(_LIB_DIR)

try:
    _MP_BOUNDS = mempalace_pin.read_pin(_COMMON_SH)
except (OSError, ValueError) as _pin_read_error:
    _refuse(
        "not determined",
        "not reached",
        None,
        None,
        extra="the supported-version pin could not be read from {0}: {1}".format(
            _COMMON_SH, _pin_read_error
        ),
        # NOT the bound-less default: this checkout is complete, so re-running
        # setup rewrites nothing. The declaration itself is what needs repair.
        remedy=(
            "repair the pin declaration in {0} so that each of "
            'MEMPALACE_MIN_VERSION and MEMPALACE_MAX_VERSION_EXCLUSIVE is '
            'declared exactly once, at line start, as NAME="<version>"'.format(
                _COMMON_SH
            )
        ),
    )

try:
    _MP_FOUND = importlib.metadata.version("mempalace")
except importlib.metadata.PackageNotFoundError as _pkg_error:
    _refuse(
        "none resolvable",
        "importlib.metadata",
        _MP_BOUNDS,
        None,
        extra="no mempalace distribution metadata is resolvable from this "
        "interpreter: {0}".format(_pkg_error),
    )

_MP_IN_RANGE, _MP_COMPARATOR = mempalace_pin.check(_MP_FOUND, *_MP_BOUNDS)
if not _MP_IN_RANGE:
    _refuse(_MP_FOUND, "importlib.metadata", _MP_BOUNDS, _MP_COMPARATOR)

# ── Step 2: patch BEFORE any mempalace import resolves chromadb ──────────────
import chromadb as _chromadb  # noqa: E402

_host = os.environ.get("MEMPALACE_CHROMA_HOST", "127.0.0.1")
_port = int(os.environ.get("MEMPALACE_CHROMA_PORT", "8001"))
_max_connections = int(os.environ.get("MEMPALACE_CHROMA_MAX_CONNECTIONS", "8"))
_max_keepalive_connections = int(
    os.environ.get("MEMPALACE_CHROMA_MAX_KEEPALIVE_CONNECTIONS", "4")
)


def _build_pool_settings() -> "_chromadb.Settings":
    """Build a fresh connection-pool ``Settings`` object for one ``HttpClient``.

    Always returns a new instance — never a shared singleton.
    ``chromadb.HttpClient()`` mutates its ``settings`` argument in place
    (``chroma_api_impl``/``chroma_server_host``/``chroma_server_http_port``),
    so reusing one object across the probe and every ``_http_factory()``
    call risks field bleed between independently constructed clients.
    """
    return _chromadb.Settings(
        chroma_http_max_connections=_max_connections,
        chroma_http_max_keepalive_connections=_max_keepalive_connections,
    )


def _http_factory(path=None, settings=None, **kwargs):
    """Drop-in replacement for ``chromadb.PersistentClient``.

    Ignores the caller-supplied ``path``/``settings`` — the HTTP daemon owns
    the index. All callers in MemPalace pass these but they are meaningless
    once routing goes over the wire.
    """
    # TODO(ADR-0006): the caller-supplied ``path``/``settings`` are still
    # ignored — reconfigure the daemon via the ``MEMPALACE_CHROMA_HOST`` /
    # ``MEMPALACE_CHROMA_PORT`` environment variables instead. ``settings``
    # is no longer entirely unused, though: an internally-built,
    # pool-bound ``Settings`` (see ``_build_pool_settings()``) is always
    # applied to cap this session's connection footprint against the daemon.
    return _chromadb.HttpClient(host=_host, port=_port, settings=_build_pool_settings())


_chromadb.PersistentClient = _http_factory  # type: ignore[assignment]

# ── Step 3: verify daemon is reachable before handing off to mempalace ───────
try:
    _probe = _chromadb.HttpClient(host=_host, port=_port, settings=_build_pool_settings())
    _probe.heartbeat()
except Exception as _e:  # acknowledged-exception: broad except intentional — any HttpClient failure (connection refused, DNS, auth, protocol) MUST block startup; silent fallback re-introduces the corruption bug ADR-0006 eliminates
    print(
        f"ERROR: ChromaDB HTTP daemon unreachable at {_host}:{_port} — {_e}\n"
        f"Start it first:  bash scripts/start-chroma-server.sh\n",
        file=sys.stderr,
    )
    sys.exit(1)

# ── Step 4: hand off to mempalace MCP server ─────────────────────────────────
from mempalace.mcp_server import main  # noqa: E402

# Phase B of the spec-0108 guard: a second, independent range check against the
# module attribute now that `mempalace` is imported. It can only ever refuse,
# never rescue — Step 1 already gated the authoritative dist-info version.
# Deliberately NOT an equality test against that value: the two declarations are
# structurally independent, so refusing on mere disagreement would brick a valid
# `.postN` rebuild. When the attribute is absent this is a no-op, not a refusal.
#
# `mempalace.mcp_server` swaps `sys.stdout` for `sys.stderr` at import time and
# restores the real channel only inside `main()`, so a refusal here cannot reach
# the JSON-RPC channel even by accident.
_MP_ATTR = getattr(sys.modules["mempalace"], "__version__", None)
if _MP_ATTR is not None:
    _ATTR_IN_RANGE, _ATTR_COMPARATOR = mempalace_pin.check(_MP_ATTR, *_MP_BOUNDS)
    if not _ATTR_IN_RANGE:
        _refuse(_MP_ATTR, "mempalace.__version__", _MP_BOUNDS, _ATTR_COMPARATOR)

main()
