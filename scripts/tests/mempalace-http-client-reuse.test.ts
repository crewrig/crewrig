// mempalace-http-client-reuse.test.ts — regression test for the process-wide
// lazy-singleton `_http_factory()` cache in scripts/lib/mempalace-http-wrapper.py
// (spec 0242 R1-R5, issue #1370).
//
// Unit under test: the real, unmodified wrapper, run for real as a `python3`
// subprocess with `--transport http` (so the spec-0029 orphan-reaper thread
// never starts — it is irrelevant to this fix and would otherwise linger).
// `scripts/lib/mempalace_pin.py` and `scripts/lib/common.sh` also run from
// their real repository paths, unmodified, so the spec-0108 version guard
// exercises the real pin.
//
// HERMETIC: every fixture is a fresh `fs.mkdtempSync` directory prepended to
// PYTHONPATH, holding only a fake `chromadb` package (a stand-in `HttpClient`
// that never opens a socket) and a fake `mempalace` package whose
// `mcp_server.main()` does the case's own assertions instead of serving MCP
// traffic. PYTHONPATH wins over any real install, mirroring the fixture
// pattern already proven against this exact wrapper in
// scripts/tests/test-mempalace-runtime-guard.sh. No network connection is
// opened to the live, shared MemPalace daemon (127.0.0.1:41893) or its
// ChromaDB backend (127.0.0.1:8001): the fake `HttpClient` never touches a
// socket regardless of the host/port values it is constructed with.
//
// CALL-INDEX CONTRACT (shared by every case): the wrapper's Step 3 startup
// probe calls `chromadb.HttpClient(...)` directly and unconditionally BEFORE
// handing off to `mempalace.mcp_server.main()`, so it is always the fake
// `HttpClient`'s call #1. The first call `_http_factory()` itself makes is
// therefore always call #2. Case C's induced failure targets call #2
// specifically so it hits the factory's first build attempt, never the probe
// (an off-by-one here would make the real wrapper's Step 3 `except` block
// call `sys.exit(1)` before `main()` ever runs — see the exit-code assertion
// in that case).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WRAPPER = path.join(REPO, "scripts", "lib", "mempalace-http-wrapper.py");
const COMMON_SH = path.join(REPO, "scripts", "lib", "common.sh");
const PYTHON_BIN = process.env.CREWRIG_TEST_PYTHON ?? "python3";

const MAX_CONNECTIONS = "6";
const MAX_KEEPALIVE_CONNECTIONS = "3";

// The real pin's floor — in range by construction, so the fixture's fake
// dist-info and `__version__` never trip the spec-0108 runtime guard.
const commonSh = fs.readFileSync(COMMON_SH, "utf8");
const pinMatch = commonSh.match(/^MEMPALACE_MIN_VERSION="([^"]+)"$/m);
assert.ok(pinMatch, `could not read MEMPALACE_MIN_VERSION from ${COMMON_SH}`);
const PIN_VERSION = pinMatch[1];

const FAKE_CHROMADB = `"""Minimal chromadb stand-in for mempalace-http-client-reuse.test.ts.

Never opens a real socket: HttpClient() returns an in-memory stand-in
regardless of host/port, and heartbeat() is a no-op. A module-level counter
records every HttpClient() call (including the wrapper's own Step 3 startup
probe, which is always call #1 — see the call-index contract in the test
file), so a case can induce a failure on a specific call and later report how
many calls actually built a client.
"""
import os
import threading

_lock = threading.Lock()
_call_count = 0
_fail_on_call = int(os.environ.get("FAKE_CHROMADB_FAIL_ON_CALL", "0"))


class Settings:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


class _Client:
    def __init__(self, host, port, settings):
        self.host = host
        self.port = port
        self.settings = settings

    def heartbeat(self):
        return 1


def HttpClient(host=None, port=None, settings=None, **kwargs):
    global _call_count
    with _lock:
        _call_count += 1
        idx = _call_count
    if idx == _fail_on_call:
        raise RuntimeError(f"induced failure on call #{idx}")
    return _Client(host, port, settings)


def PersistentClient(path=None, settings=None, **kwargs):
    return _Client(None, None, settings)
`;

const MCP_SERVER_PREAMBLE = `import sys

_REAL_STDOUT = sys.stdout
sys.stdout = sys.stderr

`;

const CASE_A_BODY =
  MCP_SERVER_PREAMBLE +
  `def main():
    sys.stdout = _REAL_STDOUT
    import json
    import chromadb

    factory = sys.modules["__main__"]._http_factory
    ids = []
    last_client = None
    for _ in range(20):
        last_client = factory()
        ids.append(id(last_client))
    print(json.dumps({
        "ids": ids,
        "build_count": chromadb._call_count,
        "pool_kwargs": last_client.settings.kwargs,
    }))
`;

const CASE_B_BODY =
  MCP_SERVER_PREAMBLE +
  `def main():
    sys.stdout = _REAL_STDOUT
    import json
    import threading
    import chromadb

    factory = sys.modules["__main__"]._http_factory
    ids = []
    lock = threading.Lock()

    def worker():
        client = factory()
        with lock:
            ids.append(id(client))

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    print(json.dumps({
        "ids": ids,
        "build_count": chromadb._call_count,
    }))
`;

const CASE_C_BODY =
  MCP_SERVER_PREAMBLE +
  `def main():
    sys.stdout = _REAL_STDOUT
    import json
    import chromadb

    factory = sys.modules["__main__"]._http_factory
    first_call_failed = False
    try:
        factory()
    except RuntimeError:
        first_call_failed = True
    second = factory()
    third = factory()
    print(json.dumps({
        "first_call_failed": first_call_failed,
        "second_third_same_instance": id(second) == id(third),
        "build_count": chromadb._call_count,
    }))
`;

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

/** A fresh PYTHONPATH fixture: fake chromadb + fake mempalace, in-range pin. */
function buildFixture(mcpServerBody: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mempalace-reuse-test-")));
  temps.push(dir);
  fs.mkdirSync(path.join(dir, "chromadb"), { recursive: true });
  fs.mkdirSync(path.join(dir, "mempalace"), { recursive: true });
  fs.mkdirSync(path.join(dir, `mempalace-${PIN_VERSION}.dist-info`), { recursive: true });

  fs.writeFileSync(path.join(dir, "chromadb", "__init__.py"), FAKE_CHROMADB);
  fs.writeFileSync(path.join(dir, "mempalace", "__init__.py"), `__version__ = "${PIN_VERSION}"\n`);
  fs.writeFileSync(path.join(dir, "mempalace", "mcp_server.py"), mcpServerBody);
  fs.writeFileSync(
    path.join(dir, `mempalace-${PIN_VERSION}.dist-info`, "METADATA"),
    `Metadata-Version: 2.1\nName: mempalace\nVersion: ${PIN_VERSION}\n`,
  );
  return dir;
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface PoolKwargs {
  chroma_http_max_connections: number;
  chroma_http_max_keepalive_connections: number;
}

/** Case A's JSON report shape (`sys.modules["__main__"]._http_factory` called sequentially). */
interface ReuseReport {
  ids: number[];
  build_count: number;
  pool_kwargs: PoolKwargs;
}

/** Case B's JSON report shape (8 concurrent racing callers). */
interface RaceReport {
  ids: number[];
  build_count: number;
}

/** Case C's JSON report shape (a failed lazy build followed by recovery). */
interface RecoveryReport {
  first_call_failed: boolean;
  second_third_same_instance: boolean;
  build_count: number;
}

/** Runs the real wrapper under `--transport http` against a fixture's PYTHONPATH. */
function runWrapper(fixtureDir: string, failOnCall = 0): RunResult {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONPATH: fixtureDir,
    PYTHONDONTWRITEBYTECODE: "1",
    MEMPALACE_CHROMA_MAX_CONNECTIONS: MAX_CONNECTIONS,
    MEMPALACE_CHROMA_MAX_KEEPALIVE_CONNECTIONS: MAX_KEEPALIVE_CONNECTIONS,
    FAKE_CHROMADB_FAIL_ON_CALL: String(failOnCall),
  };
  const res = spawnSync(PYTHON_BIN, [WRAPPER, "--transport", "http"], {
    encoding: "utf8",
    env,
    input: "",
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe("spec 0242 — _http_factory() process-wide client reuse", () => {
  test("Case A: sequential reconnect calls return the same cached instance", () => {
    const fixture = buildFixture(CASE_A_BODY);
    const run = runWrapper(fixture);
    assert.equal(run.status, 0, `wrapper exited ${run.status}: ${run.stderr}`);

    const report = JSON.parse(run.stdout) as ReuseReport;
    assert.equal(report.ids.length, 20);
    assert.equal(new Set(report.ids).size, 1, "every call must return the identical instance");
    // call #1 is Step 3's startup probe, call #2 is the one lazy build the
    // first _http_factory() call performs; the remaining 19 calls are cache
    // hits and must not increment the counter further.
    assert.equal(report.build_count, 2, "exactly one client must be built beyond the probe");
    assert.equal(report.pool_kwargs.chroma_http_max_connections, Number(MAX_CONNECTIONS));
    assert.equal(
      report.pool_kwargs.chroma_http_max_keepalive_connections,
      Number(MAX_KEEPALIVE_CONNECTIONS),
    );
  });

  test("Case B: concurrent racing callers still end up sharing one client", () => {
    const fixture = buildFixture(CASE_B_BODY);
    const run = runWrapper(fixture);
    assert.equal(run.status, 0, `wrapper exited ${run.status}: ${run.stderr}`);

    const report = JSON.parse(run.stdout) as RaceReport;
    assert.equal(report.ids.length, 8);
    assert.equal(new Set(report.ids).size, 1, "a race must not leave more than one live client");
    assert.equal(report.build_count, 2, "the race must still resolve to a single build");
  });

  test("Case C: a failed lazy build does not poison the cache", () => {
    const fixture = buildFixture(CASE_C_BODY);
    // Fail call #2: call #1 is always Step 3's probe (see the call-index
    // contract at the top of this file), so #2 is deterministically the
    // first call _http_factory() itself makes.
    const run = runWrapper(fixture, 2);
    // Asserted BEFORE parsing stdout as JSON: if the call-index arithmetic
    // were off by one, the induced failure would hit the probe instead, and
    // the real wrapper's Step 3 `except` block would call `sys.exit(1)`
    // before `main()` (and therefore the fake case body) ever ran. That must
    // surface as a named assertion failure here, not an opaque JSON.parse
    // crash on empty stdout.
    assert.equal(
      run.status,
      0,
      `wrapper exited ${run.status} before main() ran (Step 3 probe likely swallowed the ` +
        `induced failure instead of _http_factory()): ${run.stderr}`,
    );

    const report = JSON.parse(run.stdout) as RecoveryReport;
    assert.equal(
      report.first_call_failed,
      true,
      "the first _http_factory() call must surface the induced failure",
    );
    assert.equal(
      report.second_third_same_instance,
      true,
      "recovery must cache the next successful build for later calls to reuse",
    );
    // call #1: probe (succeeds). call #2: first _http_factory() call (fails,
    // not cached). call #3: retry (succeeds, cached). No further calls: the
    // third _http_factory() invocation is a cache hit.
    assert.equal(
      report.build_count,
      3,
      "recovery must build exactly once after the failed attempt",
    );
  });
});
