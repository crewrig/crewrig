// Replaces artifacts/library/skills/harness-curator/scripts/test.sh group G13 (spec 0265 row J2,
// issue #62 stdout hijack, issue #69 drawer-id round trip): the real MemPalace read path of curate.ts
// against a SCRATCH palace. Every child runs with an allow-list env (HOME, XDG_*, TMPDIR and
// MEMPALACE_PALACE_PATH under one mkdtemp root, PATH holding only a stub `gh` that logs and refuses
// `issue create`). The palace path is asserted under os.tmpdir() and not $HOME/.mempalace BEFORE any
// seeding (hard failure, never a skip). The group skips with a printed reason when no interpreter
// imports mempalace.mcp_server; no `mempalace` shell command is run. Also holds the self-test of
// assertNoRealState. POSIX only.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { findOnPath, mempalacePythonCandidates, splitLauncher } from "../lib/mempalace-python.ts";
import {
  assertNoRealState,
  python3,
  SCRIPTS_DIR,
  scratchEnv,
  SKIP_WIN32,
  snapshotRealState,
  stubGh,
} from "./lib/harness-curator-py.ts";
import type { Scratch } from "./lib/harness-curator-py.ts";

/** A child env that owns every path it may write; the palace is the scratch one. */
function childEnv(sc: Scratch): NodeJS.ProcessEnv {
  const xdg = (d: string): string => {
    const dir = path.join(sc.home, d);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  return {
    ...sc.env,
    USERPROFILE: sc.home,
    XDG_CONFIG_HOME: xdg(".config"),
    XDG_STATE_HOME: xdg(".state"),
    XDG_DATA_HOME: xdg(".data"),
    MEMPALACE_PALACE_PATH: sc.palace,
    PYTHONDONTWRITEBYTECODE: "1",
  };
}

/** First interpreter (listed candidates, PIPX_HOME read-only) that imports mempalace.mcp_server under `env`. */
function mempalaceInterpreter(env: NodeJS.ProcessEnv): string | undefined {
  const lookup: NodeJS.ProcessEnv = { PATH: process.env["PATH"] ?? "", HOME: os.homedir() };
  if (process.env["PIPX_HOME"] !== undefined) lookup["PIPX_HOME"] = process.env["PIPX_HOME"];
  for (const candidate of mempalacePythonCandidates(lookup)) {
    const [command] = splitLauncher(candidate);
    const resolved = command === undefined ? undefined : findOnPath(command, lookup, undefined);
    if (resolved === undefined) continue;
    const probe = spawnSync(resolved, ["-c", "import mempalace.mcp_server"], {
      env,
      stdio: "ignore",
    });
    if (probe.status === 0) return resolved;
  }
  return undefined;
}

const SEED = `
import os
_real = os.fdopen(os.dup(1), "w", encoding="utf-8", closefd=False)
from mempalace.mcp_server import tool_add_drawer
result = tool_add_drawer(
    wing="harness-friction",
    room="tool",
    content=(
        "FRICTION: regression probe for curate-stdout-hijack\\n\\n"
        "writer_agent: test-runner\\n"
        "subcategory: real-mempalace-smoke\\n"
        "canonical: https://github.com/crewrig/crewrig\\n"
        "severity: high\\n"
        "evidence:\\n"
        "  - artifacts/library/skills/harness-curator/scripts/curate.py:60\\n"
    ),
)
_real.write(result.get("drawer_id", "") if isinstance(result, dict) else str(result))
_real.flush()
`;

const STAMP = `
import os, sys
_real = os.fdopen(os.dup(1), "w", encoding="utf-8", closefd=False)
from mempalace.mcp_server import tool_get_drawer, tool_update_drawer
did = sys.argv[1]
drawer = tool_get_drawer(drawer_id=did)
tool_update_drawer(drawer_id=did, content=drawer["content"].rstrip() + "\\nopened_as: https://example.com/fake/1\\n")
_real.write("ok")
_real.flush()
`;

const baseSkip = SKIP_WIN32 ?? (python3() === undefined ? "python3 not found" : undefined);

describe("G13 real MemPalace path (scratch palace)", { skip: baseSkip }, () => {
  let sc: Scratch;
  let env: NodeJS.ProcessEnv;
  let interp: string | undefined;
  const realBefore = baseSkip === undefined ? snapshotRealState() : {};
  const probe = (): void => {
    sc = scratchEnv();
    env = childEnv(sc);
    stubGh(sc);
    interp = mempalaceInterpreter(env);
  };
  before(probe);
  after(() => {
    try {
      assertNoRealState(env, sc.calls, realBefore);
      assert.doesNotMatch(sc.calls, /issue create/, "no dry-run may create an issue");
    } finally {
      sc.cleanup();
    }
  });

  const py = (code: string, args: string[] = []): string => {
    const r = spawnSync(interp as string, ["-c", code, ...args], {
      env,
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  const curate = (): { status: number | null; stdout: string; stderr: string } =>
    spawnSync(process.execPath, [path.join(SCRIPTS_DIR, "curate.ts"), "--dry-run"], {
      env: { ...env, MEMPALACE_PYTHON: interp as string },
      encoding: "utf8",
      timeout: 120_000,
    });
  const apply = (input: string): { status: number | null; stdout: string } =>
    spawnSync(python3() as string, ["-I", path.join(SCRIPTS_DIR, "apply.py"), "--dry-run-apply"], {
      env,
      input,
      encoding: "utf8",
      timeout: 60_000,
    });

  test("G13 round trip: seed, curate, apply dry-run, stamp, curate again", (t) => {
    if (interp === undefined) {
      t.skip("mempalace not installed: no interpreter imports mempalace.mcp_server");
      return;
    }
    // Hard isolation guard BEFORE any seeding: never skipped.
    const palace = fs.realpathSync(sc.palace);
    const tmp = fs.realpathSync(os.tmpdir());
    assert.ok(palace.startsWith(tmp + path.sep), `palace outside tmpdir: ${palace}`);
    assert.notEqual(palace, path.join(os.homedir(), ".mempalace"));
    assert.equal(env["MEMPALACE_PALACE_PATH"], sc.palace);

    const id = py(SEED);
    assert.notEqual(id, "", "tool_add_drawer returned no drawer_id");

    const first = curate();
    assert.equal(first.status, 0, first.stderr);
    assert.ok(first.stdout.length > 0, "stdout is non-empty (issue #62 hijack)");
    const out = JSON.parse(first.stdout) as {
      stats: Record<string, number>;
      clusters: { cluster_key: string }[];
    };
    assert.equal(out.stats["total_drawers"], 1);
    assert.equal(out.stats["valid_frictions"], 1);
    assert.equal(out.stats["clusters_above_threshold"], 1);
    assert.equal(out.clusters[0]?.cluster_key, "real-mempalace-smoke");

    const applied = apply(first.stdout);
    assert.equal(applied.status, 0);
    const obj = applied.stdout
      .split("\n")
      .filter((l) => l.startsWith("{"))
      .map((l): Record<string, unknown> => JSON.parse(l) as Record<string, unknown>)
      .find((o) => o["would_update_drawers"] != null);
    assert.ok(obj !== undefined, "would_update_drawers object missing");
    assert.deepEqual(obj["would_update_drawers"], [id]);

    assert.equal(py(STAMP, [id]), "ok");
    const second = curate();
    assert.equal(second.status, 0, second.stderr);
    const again = JSON.parse(second.stdout) as typeof out;
    assert.equal(again.stats["skipped_resolved"], 1);
    assert.equal(again.stats["valid_frictions"], 0);
    assert.equal(again.stats["clusters_above_threshold"], 0);
    assert.equal(
      again.clusters.find((c) => c.cluster_key === "real-mempalace-smoke"),
      undefined,
    );
  });
});

describe("assertNoRealState guard self-test", { skip: SKIP_WIN32 }, () => {
  const tmp = fs.realpathSync(os.tmpdir());
  const inside = path.join(tmp, "crewrig-hc-guard", "home");

  test("guard throws when HOME is unset or empty", () => {
    assert.throws(() => assertNoRealState({ PATH: "x" }), /HOME unset/);
    assert.throws(() => assertNoRealState({ HOME: "" }), /HOME unset/);
  });

  test("guard throws when HOME is not under the tmpdir", () => {
    assert.throws(() => assertNoRealState({ HOME: os.homedir() }), /outside tmpdir/);
  });

  test("guard throws on a scheduler mutation in the call log, passes on read-only calls", () => {
    assert.throws(() => assertNoRealState({ HOME: inside }, "launchctl <load> <x>\n"), /scheduler/);
    assert.doesNotThrow(() => assertNoRealState({ HOME: inside }, "crontab <-l>\n"));
  });

  test("scratchEnv never leaves HOME unset and keeps it under the tmpdir", () => {
    const sc = scratchEnv();
    try {
      assert.ok(sc.env["HOME"]?.startsWith(tmp + path.sep));
      assert.doesNotThrow(() => assertNoRealState(sc.env));
    } finally {
      sc.cleanup();
    }
  });
});
