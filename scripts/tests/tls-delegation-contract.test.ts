// tls-delegation-contract.test.ts — the spec 0084 contract that no other suite pins, ported from
// test-tls-delegation.sh (spec 0263 row C): R3 off writes nothing, R11 consent writes only the
// managed file, R5 never a verification-disabling setting, R2 the tls-exec.ts runtime wrapper (its
// own suite is tls-exec.test.ts) and the Taskfile install-mempalace prefix. Detection (G1) is setup-tls-detect.test.ts and
// setup-lib-tls-entry.test.ts; the per-CLI tls-offer declaration (G6) is setup-retarget-others.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import { realHomeGuard } from "./lib/real-home-guard.ts";
import { box, envFile, envOf, run } from "./lib/tls-entry-run.ts";
import { loadTaskfileTree } from "../lib/taskfile-tree.ts";

function topLevel(home: string): string[] {
  return fs.readdirSync(home).sort();
}

describe("tls-delegation contract (spec 0084)", () => {
  it("builds the child environment from the scratch home only (non-vacuity)", () => {
    const b = box();
    assert.deepEqual(Object.keys(envOf(b)).sort(), ["HOME", "PATH", "USERPROFILE"]);
    assert.equal(envOf(b)["HOME"], b.home);
    assert.equal(envOf(b)["USERPROFILE"], b.home);
    assert.equal(fs.realpathSync(b.home), b.home);
  });

  it("R3: off exits 0 and writes nothing", () => {
    const guard = realHomeGuard();
    const b = box();
    const res = run(b, ["offer"], { TLS_DELEGATION: "off", TLS_DELEGATION_CA: b.ca });
    assert.equal(res.status, 0);
    assert.equal(fs.existsSync(envFile(b)), false);
    assert.deepEqual(topLevel(b.home), []);
    guard.assertUnchanged();
  });

  it("R11: consent writes only the managed file, removable in one action", () => {
    const guard = realHomeGuard();
    const b = box();
    const res = run(b, ["offer"], { TLS_DELEGATION: "on", TLS_DELEGATION_CA: b.ca });
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(topLevel(b.home), [".crewrig"]);
    assert.deepEqual(fs.readdirSync(path.join(b.home, ".crewrig")), ["tls-env.sh"]);
    const text = fs.readFileSync(envFile(b), "utf8");
    assert.ok(text.includes("NODE_EXTRA_CA_CERTS="));
    assert.ok(text.split("\n").includes("export UV_SYSTEM_CERTS=true"));
    assert.equal(text.includes("UV_NATIVE_TLS"), false);
    fs.rmSync(envFile(b));
    assert.equal(fs.existsSync(envFile(b)), false);
    guard.assertUnchanged();
  });

  it("R5: the managed file never disables verification", () => {
    const b = box();
    assert.equal(run(b, ["offer"], { TLS_DELEGATION: "on", TLS_DELEGATION_CA: b.ca }).status, 0);
    assert.ok(fs.existsSync(envFile(b)), "no managed file: the assertion would be vacuous");
    const text = fs.readFileSync(envFile(b), "utf8");
    assert.ok(text.includes("export UV_SYSTEM_CERTS=true"));
    assert.doesNotMatch(
      text,
      /NODE_TLS_REJECT_UNAUTHORIZED=0|sslVerify[^=]*(=|\s)*false|PYTHONHTTPSVERIFY=0/,
    );
    assert.equal(text.includes("NODE_TLS_REJECT_UNAUTHORIZED"), false);
  });
});

describe("Taskfile install-mempalace (R2, R8)", () => {
  it("runs pipx through scripts/tls-exec.ts", () => {
    const definition = loadTaskfileTree(REPO).byName.get("install-mempalace")?.definition as
      | { cmd?: unknown }
      | undefined;
    const cmd = definition?.cmd;
    assert.equal(typeof cmd, "string", "task install-mempalace has no cmd");
    assert.ok(
      /^node (--disable-warning=\S+ )?\{\{\.REPO_DIR\}\}\/scripts\/tls-exec\.ts pipx install /.test(
        String(cmd),
      ),
      `cmd: ${String(cmd)}`,
    );
  });
});
