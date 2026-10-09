// chroma-launch.test.ts — the open-file floor of the ChromaDB start entry (spec
// 0087, carried by spec 0252 requirement 13): the soft limit is raised through the
// Python interpreter before the daemon runs, which the interpreter then replaces
// itself with, so the recorded PID is the daemon's. The stand-in daemon reports the
// soft RLIMIT_NOFILE it started with. POSIX-only, and it needs a real python3 on
// PATH (the interpreter runs the prelude), otherwise it skips with a message.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  daemonRecord,
  dispose,
  hostPython,
  makeSandbox,
  REPO,
  type Sandbox,
} from "./lib/chroma-stand-in.ts";

const python = hostPython();
const posix = process.platform !== "win32";
const SKIP = !posix
  ? "the open-file floor is POSIX-only (spec 0252 requirement 13)"
  : python === null
    ? "skipped: no python3 on PATH to stand in for MEMPALACE_PYTHON"
    : false;

const hardCeiling = (): number => {
  const r = spawnSync("sh", ["-c", "ulimit -Hn"], { encoding: "utf8" });
  const t = r.stdout.trim();
  return t === "unlimited" ? Infinity : Number(t);
};

describe("chroma start: open-file floor", { skip: SKIP }, () => {
  const boxes: Sandbox[] = [];
  afterEach(() => {
    for (const b of boxes.splice(0)) dispose(b);
  });
  const startUnder = async (extra: NodeJS.ProcessEnv, hard?: number) => {
    const b = await makeSandbox(true, python);
    boxes.push(b);
    const entry = `exec "${process.execPath}" scripts/start-chroma-server.ts`;
    const script =
      hard === undefined
        ? entry
        : `ulimit -Sn ${Math.floor(hard / 2)} && ulimit -Hn ${hard}; ${entry}`;
    const r = spawnSync("sh", ["-c", script], {
      cwd: REPO,
      env: { ...b.env, ...extra },
      encoding: "utf8",
      timeout: 60_000,
    });
    return { b, r };
  };

  test(
    "the default floor is 10240, raised before the daemon runs",
    { skip: hardCeiling() < 10240 },
    async () => {
      const { b, r } = await startUnder({});
      assert.equal(r.status, 0, r.stderr);
      assert.equal(daemonRecord(b).nofile, 10240);
      const log = fs.readFileSync(path.join(b.home, ".mempalace", "chroma-server.log"), "utf8");
      assert.doesNotMatch(log + r.stderr, /WARNING: could not raise/);
    },
  );

  test(
    "MEMPALACE_CHROMA_ULIMIT_FLOOR overrides the floor",
    { skip: hardCeiling() < 4000 },
    async () => {
      const { b, r } = await startUnder({ MEMPALACE_CHROMA_ULIMIT_FLOOR: "4000" });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(daemonRecord(b).nofile, 4000);
    },
  );

  test("a floor above the hard ceiling warns with the ceiling and does not end the start", async () => {
    const { b, r } = await startUnder({ MEMPALACE_CHROMA_ULIMIT_FLOOR: "10240" }, 512);
    assert.equal(r.status, 0, r.stderr);
    // The prelude runs inside the daemon process, whose stderr is the log file.
    const log = fs.readFileSync(path.join(b.home, ".mempalace", "chroma-server.log"), "utf8");
    assert.match(
      log,
      /WARNING: could not raise open-file limit to 10240; current hard ceiling is 512\./,
    );
    assert.ok((daemonRecord(b).nofile ?? 0) <= 512, "the daemon runs under the unraised limit");
  });

  test("the recorded PID is the daemon's across the exec", async () => {
    const { b, r } = await startUnder({});
    assert.equal(r.status, 0, r.stderr);
    const pid = Number(fs.readFileSync(b.pidFile, "utf8").trim());
    assert.equal(daemonRecord(b).pid, pid);
    assert.match(r.stdout, new RegExp(`chroma server started \\(PID ${pid},`));
  });
});

test("the TypeScript start entry never opens the palace itself (no PersistentClient)", () => {
  for (const f of ["scripts/start-chroma-server.ts", "scripts/lib/service/chroma-launch.ts"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(REPO, f), "utf8"), /PersistentClient/, f);
  }
});
