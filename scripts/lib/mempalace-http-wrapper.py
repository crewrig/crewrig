#!/usr/bin/env python3
# Requires: chromadb>=1.5.9
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

If the daemon is unreachable at startup we ``exit 1`` with the installer
command on stderr. Silent fallback to ``PersistentClient`` is forbidden by
design — it would re-introduce the corruption bug.
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

# ── Step 1: patch BEFORE any mempalace import resolves chromadb ──────────────
import chromadb as _chromadb

_host = os.environ.get("MEMPALACE_CHROMA_HOST", "127.0.0.1")
_port = int(os.environ.get("MEMPALACE_CHROMA_PORT", "8001"))


def _http_factory(path=None, settings=None, **kwargs):
    """Drop-in replacement for ``chromadb.PersistentClient``.

    Ignores ``path`` and ``settings`` — the HTTP daemon owns the index. All
    callers in MemPalace pass these but they are meaningless once routing
    goes over the wire.
    """
    # TODO(ADR-0006): ``settings`` is intentionally ignored — ``HttpClient``
    # has no equivalent parameter. Reconfigure the daemon via the
    # ``MEMPALACE_CHROMA_HOST`` / ``MEMPALACE_CHROMA_PORT`` environment
    # variables instead.
    return _chromadb.HttpClient(host=_host, port=_port)


_chromadb.PersistentClient = _http_factory  # type: ignore[assignment]

# ── Step 2: verify daemon is reachable before handing off to mempalace ───────
try:
    _probe = _chromadb.HttpClient(host=_host, port=_port)
    _probe.heartbeat()
except Exception as _e:  # acknowledged-exception: broad except intentional — any HttpClient failure (connection refused, DNS, auth, protocol) MUST block startup; silent fallback re-introduces the corruption bug ADR-0006 eliminates
    print(
        f"ERROR: ChromaDB HTTP daemon unreachable at {_host}:{_port} — {_e}\n"
        f"Start it first:  bash scripts/start-chroma-server.sh\n",
        file=sys.stderr,
    )
    sys.exit(1)

# ── Step 3: hand off to mempalace MCP server ─────────────────────────────────
from mempalace.mcp_server import main  # noqa: E402

main()
