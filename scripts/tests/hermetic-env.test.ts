// hermetic-env.test.ts — tests for scripts/tests/lib/hermetic-env.ts (spec 0253
// PLAN v3, step A0). The harness underpins every hermetic claim of the oracle
// and port tests, so its isolation is pinned here: temp HOME, no PIPX_HOME /
// XDG_DATA_HOME, PATH reduced to one temp bin, no pipx / mempalace / python3
// resolvable, the poison executable recorded. POSIX only: skipped on win32.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  createHermeticEnv,
  poisonHit,
  runBash,
  writeStub,
  type HermeticEnv,
} from "./lib/hermetic-env.ts";

/** Run `fn` with a fresh harness, disposed afterwards. */
function withHarness(fn: (h: HermeticEnv) => void, options?: { poisonPython?: boolean }): void {
  const h = createHermeticEnv(options);
  try {
    fn(h);
  } finally {
    h.dispose();
  }
}

/** Write `body` as a script file under the harness root and return its path. */
function script(h: HermeticEnv, name: string, body: string): string {
  const file = path.join(h.root, name);
  fs.writeFileSync(file, body);
  return file;
}

describe("hermetic-env", { skip: process.platform === "win32" }, () => {
  test("the child env has a temp HOME and no PIPX_HOME or XDG_DATA_HOME even when the parent sets them", () => {
    const saved = { pipx: process.env["PIPX_HOME"], xdg: process.env["XDG_DATA_HOME"] };
    process.env["PIPX_HOME"] = "/parent/pipx";
    process.env["XDG_DATA_HOME"] = "/parent/xdg";
    try {
      withHarness((h) => {
        assert.equal(h.env["HOME"], h.home);
        assert.equal(h.env["USERPROFILE"], h.home);
        assert.ok(h.home.startsWith(h.root));
        assert.equal("PIPX_HOME" in h.env, false);
        assert.equal("XDG_DATA_HOME" in h.env, false);
        const probe = script(
          h,
          "probe.sh",
          'echo "${PIPX_HOME-unset} ${XDG_DATA_HOME-unset} $HOME"\n',
        );
        const res = runBash(h, probe, []);
        assert.equal(res.stdout.trim(), `unset unset ${h.home}`);
      });
    } finally {
      for (const [key, value] of [
        ["PIPX_HOME", saved.pipx],
        ["XDG_DATA_HOME", saved.xdg],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test("PATH is the temp bin only and no pipx, mempalace or python3 resolves", () => {
    withHarness((h) => {
      const probe = script(
        h,
        "probe.sh",
        'echo "PATH=$PATH"\nfor c in pipx mempalace python3 python; do command -v "$c"; done\n',
      );
      const res = runBash(h, probe, []);
      assert.equal(res.stdout, `PATH=${h.bin}\n`);
      assert.equal(h.env["PATH"], h.bin);
    });
  });

  test("find, grep, date and node resolve to symlinks inside bin", () => {
    withHarness((h) => {
      const probe = script(h, "probe.sh", "command -v find grep date node\n");
      const lines = runBash(h, probe, []).stdout.trim().split("\n");
      assert.deepEqual(
        lines,
        ["find", "grep", "date", "node"].map((n) => path.join(h.bin, n)),
      );
      for (const n of ["find", "grep", "date", "node"]) {
        assert.ok(fs.lstatSync(path.join(h.bin, n)).isSymbolicLink(), `${n} is a symlink`);
      }
      assert.equal(fs.realpathSync(path.join(h.bin, "node")), fs.realpathSync(process.execPath));
      assert.ok(!fs.readdirSync(h.bin).includes("pipx"));
    });
  });

  test("a stub from writeStub runs and receives its arguments and stdin", () => {
    withHarness((h) => {
      const log = path.join(h.root, "stub.log");
      const stub = writeStub(h, "fzf", `printf '%s|' "$@" >> '${log}'\ncat >> '${log}'\n`);
      assert.equal(stub, path.join(h.bin, "fzf"));
      const probe = script(h, "probe.sh", 'printf "in\\n" | fzf --one "$1"\n');
      const res = runBash(h, probe, ["two"]);
      assert.equal(res.status, 0);
      assert.equal(fs.readFileSync(log, "utf8"), "--one|two|in\n");
    });
  });

  test("runBash pipes input, overlays env, deletes undefined keys and honours cwd", () => {
    withHarness((h) => {
      const probe = script(
        h,
        "probe.sh",
        'read -r line\necho "$line|${A-unset}|${HOME-unset}|$PWD"\n',
      );
      const res = runBash(h, probe, [], {
        input: "hello\n",
        env: { A: "1", HOME: undefined },
        cwd: h.root,
      });
      assert.equal(res.stdout.trim(), `hello|1|unset|${h.root}`);
    });
  });

  test("the poison executable records a hit and exits 99; MEMPALACE_PYTHON points at it", () => {
    withHarness((h) => {
      const poison = h.env["MEMPALACE_PYTHON"];
      assert.ok(typeof poison === "string" && poison.startsWith(h.root));
      assert.equal(poisonHit(h), false);
      const res = spawnSync(poison, ["-c", "pass"], { encoding: "utf8" });
      assert.equal(res.status, 99);
      assert.equal(poisonHit(h), true);
      assert.match(fs.readFileSync(h.poisonFile, "utf8"), /POISON-HIT/);
    });
  });

  test("poisonPython false leaves MEMPALACE_PYTHON unset and a caller override wins", () => {
    withHarness((h) => assert.equal("MEMPALACE_PYTHON" in h.env, false), { poisonPython: false });
    withHarness((h) => {
      const probe = script(h, "probe.sh", 'echo "${MEMPALACE_PYTHON-unset}"\n');
      assert.equal(
        runBash(h, probe, [], { env: { MEMPALACE_PYTHON: "/x/py" } }).stdout.trim(),
        "/x/py",
      );
      assert.equal(
        runBash(h, probe, [], { env: { MEMPALACE_PYTHON: undefined } }).stdout.trim(),
        "unset",
      );
    });
  });

  test("writeStub rejects a name that is not a bare file name", () => {
    withHarness((h) => {
      assert.throws(() => writeStub(h, "../evil", "exit 0\n"), /bare file name/);
    });
  });

  test("dispose removes the whole root", () => {
    const h = createHermeticEnv();
    assert.ok(fs.existsSync(h.root));
    h.dispose();
    assert.equal(fs.existsSync(h.root), false);
  });
});

describe("hermetic-env on win32", { skip: process.platform !== "win32" }, () => {
  test("createHermeticEnv throws a clear error", () => {
    assert.throws(() => createHermeticEnv(), /POSIX only/);
  });
});
