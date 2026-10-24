// Spec 0282 stage A: the pin, its build-ci rendering, the composite action's verification and
// the parity arm. Fixtures live in mkdtemp directories only.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { run } from "../lib/build-ci/entry.ts";
import { BuildCiError, parseTaskPin, taskRecipe } from "../lib/build-ci/tools.ts";
import { installRecipeTool } from "../lib/ci-parity/probe-tokens.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const PIN_TEXT = fs.readFileSync(path.join(REPO, "ci", "task-pin.json"), "utf8");
const PIN = parseTaskPin(PIN_TEXT);
const ACTION = fs.readFileSync(path.join(REPO, ".github/actions/setup-task/action.yml"), "utf8");

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "task-pin-"));
}

/** The single inline `run:` body of the composite action. */
function actionScript(): string {
  const i = ACTION.indexOf("      run: |\n");
  assert.ok(i >= 0, "action has an inline run");
  return ACTION.slice(i + "      run: |\n".length)
    .split("\n")
    .map((l) => l.slice(8))
    .join("\n");
}

test("the committed pin is pretty JSON, one key per line, version 3.54.0", () => {
  assert.equal(PIN_TEXT, JSON.stringify(JSON.parse(PIN_TEXT), null, 2) + "\n");
  assert.equal(PIN.version, "3.54.0");
  assert.match(PIN.sha256["linux_amd64"] as string, /^[0-9a-f]{64}$/);
});

test("parseTaskPin fails closed on malformed pins", () => {
  for (const bad of [
    "",
    "{",
    "null",
    '{"version":"3.54","sha256":{}}',
    '{"version":"3.54.0","sha256":{"linux_amd64":"zz"}}',
  ]) {
    assert.throws(() => parseTaskPin(bad), BuildCiError, bad);
  }
});

test("taskRecipe pins the URL and checksum and ends on a version check", () => {
  const lines = taskRecipe(PIN);
  const text = lines.join("\n");
  assert.ok(text.includes(`/download/v${PIN.version}/task_linux_amd64.tar.gz`));
  assert.ok(text.includes(`${PIN.sha256["linux_amd64"]}  /tmp/task.tar.gz" | sha256sum -c -`));
  assert.equal(lines.at(-1), "task --version");
  assert.ok(!text.includes("taskfile.dev"));
});

test("build-ci fails closed when the pin is missing or bad", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "ci"));
  fs.copyFileSync(
    path.join(REPO, "ci", "ci-capabilities.yml"),
    path.join(dir, "ci", "ci-capabilities.yml"),
  );
  const missing = run(["--check"], dir);
  assert.notEqual(missing.code, 0);
  assert.match(missing.stderr, /task pin not found/i);
  fs.writeFileSync(path.join(dir, "ci", "task-pin.json"), "{}");
  const bad = run(["--check"], dir);
  assert.notEqual(bad.code, 0);
  assert.match(bad.stderr, /task-pin\.json/);
});

test("the generated GitLab pipeline carries the pinned recipe, not the install script", () => {
  const gl = fs.readFileSync(path.join(REPO, ".gitlab-ci.yml"), "utf8");
  assert.ok(!gl.includes("taskfile.dev"));
  assert.ok(gl.includes(PIN.sha256["linux_amd64"] as string));
});

test("parity no longer treats a hand-written taskfile.dev install as provisioning", () => {
  assert.equal(
    installRecipeTool('sudo sh -c "$(curl --location https://taskfile.dev/install.sh)"'),
    "",
  );
});

function runAction(archive: Buffer | null, pin: string): { code: number; out: string } {
  const dir = tmp();
  const pinFile = path.join(dir, "pin.json");
  fs.writeFileSync(pinFile, pin);
  const arch = path.join(dir, "a.tar.gz");
  fs.writeFileSync(arch, archive ?? "");
  const script = path.join(dir, "run.sh");
  fs.writeFileSync(script, actionScript());
  const r = spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      TASK_PIN_FILE: pinFile,
      TASK_ARCHIVE_URL: `file://${arch}`,
      TASK_INSTALL_DIR: path.join(dir, "bin"),
      TASK_SUDO: "",
      TASK_PLATFORM: "linux_amd64",
    },
  });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

test("action: a checksum mismatch fails and names the version and platform", () => {
  const r = runAction(Buffer.from("not the pinned archive"), PIN_TEXT);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /checksum mismatch for Task 3\.54\.0 on platform linux_amd64/);
  assert.ok(r.out.includes(PIN.sha256["linux_amd64"] as string));
});

test("action: a missing checksum fails and names the version and platform", () => {
  const noSum = JSON.stringify({ version: "3.54.0", sha256: {} }, null, 2) + "\n";
  const r = runAction(Buffer.from("x"), noSum);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /no pinned checksum for Task 3\.54\.0 on platform linux_amd64/);
});

test("action: a matching archive that is not the pinned binary fails the version check", () => {
  const dir = tmp();
  const src = path.join(dir, "src");
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, "task"), "#!/bin/sh\necho 'Task version: v9.9.9'\n", {
    mode: 0o755,
  });
  const tar = path.join(dir, "t.tar.gz");
  assert.equal(spawnSync("tar", ["-czf", tar, "-C", src, "task"]).status, 0);
  const buf = fs.readFileSync(tar);
  const sum = crypto.createHash("sha256").update(buf).digest("hex");
  const pin = JSON.stringify({ version: "3.54.0", sha256: { linux_amd64: sum } }, null, 2) + "\n";
  const r = runAction(buf, pin);
  assert.notEqual(r.code, 0);
  assert.match(
    r.out,
    /task --version reports .*9\.9\.9.*expected 3\.54\.0 on platform linux_amd64/,
  );
});

test("action: success when the archive matches and the binary reports the pinned version", () => {
  const dir = tmp();
  const src = path.join(dir, "src");
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, "task"), "#!/bin/sh\necho 'Task version: v3.54.0 (h1:x)'\n", {
    mode: 0o755,
  });
  const tar = path.join(dir, "t.tar.gz");
  assert.equal(spawnSync("tar", ["-czf", tar, "-C", src, "task"]).status, 0);
  const buf = fs.readFileSync(tar);
  const sum = crypto.createHash("sha256").update(buf).digest("hex");
  const pin = JSON.stringify({ version: "3.54.0", sha256: { linux_amd64: sum } }, null, 2) + "\n";
  const r = runAction(buf, pin);
  assert.equal(r.code, 0, r.out);
});
