// setup-twins-differential-usage.test.ts — spec 0256 requirement 10 (last clause), the usage-capture twins.
// Already differential against scripts/lib/usage-capture-optin.sh (shell function and TypeScript twin over the
// same fixtures, status, both streams, bytes and mode compared), so nothing is repeated here:
//   fragment, disclose, enable, remove, reinject, rewrite, apply: setup-usage-capture.test.ts (bashLibs);
//   keep: setup-usage-capture-keep.test.ts (lib/keep-differential.ts);
//   state, paths, footprint, abs, fragment, enable, remove, keep, disclose, rewrite, apply, reinject through the
//   shim entry: setup-lib-usage-entry.test.ts (lib/usage-entry-rig.ts).
// The one public function with no shell-versus-twin comparison was `usage_capture_require_node_floor`: its three
// outcomes (floor met, no node on PATH, the guard missing) and the guard's own refusal are compared here.
// Linux only; retired with the shell libraries.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { usageCaptureRequireNodeFloor } from "../lib/setup/usage-capture-fragment.ts";
import { bashLibs } from "./lib/bash-libs.ts";
import { REPO } from "./lib/worktree-fixtures.ts";

const LINUX = process.platform === "linux";
const HAS_BASH = spawnSync("bash", ["--version"]).status === 0;
const SKIP =
  !LINUX || !HAS_BASH ? "SKIP: Linux with bash only (retired with the shell libraries)" : false;

const roots: string[] = [];
after(() => roots.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const tmp = (): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "twins-uc-")));
  roots.push(dir);
  return dir;
};

interface Leg {
  readonly ok: boolean;
  readonly err: string;
}

/** The twin, with `PATH` as given and, optionally, a floor guard other than the checkout's. */
function twin(pathEnv: string, floorGuard?: string): Leg {
  const err: string[] = [];
  const io = {
    out: () => undefined,
    err: (l: string) => void err.push(l),
    errRaw: (t: string) => void err.push(t.replace(/\n$/, "")),
  };
  const home = tmp();
  const ctx = { io, env: { PATH: pathEnv }, platform: process.platform, home, repoDir: REPO };
  const ok = usageCaptureRequireNodeFloor(ctx, floorGuard === undefined ? {} : { floorGuard });
  return { ok, err: err.join("\n") };
}

/** The shell function, `PATH` set after the libraries are sourced; `lib` is the library file to source last. */
function shell(pathEnv: string, lib?: string): Leg {
  const res = bashLibs(
    [
      lib === undefined ? "" : `source ${JSON.stringify(lib)}`,
      `PATH=${JSON.stringify(pathEnv)}`,
      "usage_capture_require_node_floor",
      'echo "__RC__$?" >&2',
    ].join("\n"),
  );
  const rc = /__RC__(\d+)\s*$/.exec(res.stderr)?.[1];
  return { ok: rc === "0", err: res.stderr.replace(/__RC__\d+\s*$/, "").replace(/\n$/, "") };
}

/** A directory with a stub `node` running `body`, found first on PATH. */
function stubNode(body: string): string {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "node"), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return dir;
}

describe(
  "usageCaptureRequireNodeFloor against usage_capture_require_node_floor",
  { skip: SKIP },
  () => {
    test("the floor met: true, silent, with the real node and the real guard", () => {
      const pathEnv = path.dirname(process.execPath);
      assert.deepEqual(twin(pathEnv), shell(pathEnv));
      assert.deepEqual(twin(pathEnv), { ok: true, err: "" });
    });

    test("no node on PATH: false and the shell's own diagnostic line", () => {
      const empty = tmp();
      const sh = shell(empty);
      assert.deepEqual(twin(empty), sh);
      assert.match(
        sh.err,
        /^ {2}ERROR: crewrig: Node\.js was not found on PATH; usage capture requires Node\.js >= 24\./,
      );
    });

    test("below the floor: the guard's diagnostic, verbatim", () => {
      const dir = stubNode('echo "crewrig: requires Node.js >= 24 (stub)" >&2; exit 1');
      const sh = shell(dir);
      assert.deepEqual(twin(dir), sh);
      assert.deepEqual(sh, { ok: false, err: "crewrig: requires Node.js >= 24 (stub)" });
    });

    test("the guard missing from the library's checkout: the shell's line, with and without node", () => {
      // A copy of the library in a tree with no node-floor-guard.js: its `_UC_LIB_ROOT` is that tree.
      const root = tmp();
      fs.mkdirSync(path.join(root, "scripts", "lib"), { recursive: true });
      const lib = path.join(root, "scripts", "lib", "usage-capture-optin.sh");
      fs.copyFileSync(path.join(REPO, "scripts", "lib", "usage-capture-optin.sh"), lib);
      const guard = path.join(root, "scripts", "lib", "node-floor-guard.js");
      for (const pathEnv of [path.dirname(process.execPath), tmp()]) {
        const sh = shell(pathEnv, lib);
        assert.deepEqual(twin(pathEnv, guard), sh, pathEnv);
        assert.equal(sh.ok, false);
      }
      assert.match(
        shell(path.dirname(process.execPath), lib).err,
        /Node\.js floor guard not found at /,
      );
    });
  },
);
