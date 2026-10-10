// Tests of scripts/lib/setup/chroma-unit.ts (spec 0256 requirement 25, delta-01 deviation (q)).

import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { materialiseChromaUnit } from "../lib/setup/chroma-unit.ts";
import type { ChromaUnitRequest } from "../lib/setup/chroma-unit.ts";

const realRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const posix = process.platform !== "win32";
let root: string;
let home: string;
let repoDir: string;
let python: string;
let out: string[];
let err: string[];

function req(over: Partial<ChromaUnitRequest["ctx"]> & { template?: string } = {}) {
  const { template, ...ctx } = over;
  return {
    ctx: {
      io: {
        out: (l: string) => void out.push(l),
        err: (l: string) => void err.push(l),
        errRaw: () => {},
      },
      env: {},
      platform: process.platform,
      home,
      repoDir,
      ...ctx,
    },
    template:
      template ?? path.join(repoDir, "config", "systemd", "mempalace-chroma-server.service"),
    target: path.join(home, ".config", "systemd", "user", "mempalace-chroma-server.service"),
    python,
  } satisfies ChromaUnitRequest;
}

before(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "chroma-unit-"));
  repoDir = path.join(root, "repo");
  for (const rel of [
    "config/systemd/mempalace-chroma-server.service",
    "config/launchd/com.mempalace.chroma-server.plist",
    "scripts/lib/tls-exec.sh",
  ]) {
    mkdirSync(path.dirname(path.join(repoDir, rel)), { recursive: true });
    writeFileSync(path.join(repoDir, rel), readFileSync(path.join(realRepo, rel)));
  }
});
after(() => rmSync(root, { recursive: true, force: true }));

function fresh(withChroma: boolean) {
  out = [];
  err = [];
  home = mkdtempSync(path.join(root, "home-"));
  const venv = path.join(root, `venv-${path.basename(home)}`, "bin");
  mkdirSync(venv, { recursive: true });
  python = path.join(venv, "python");
  if (withChroma) {
    writeFileSync(path.join(venv, "chroma"), "#!/bin/sh\n");
    chmodSync(path.join(venv, "chroma"), 0o755);
  }
}

test(
  "systemd unit: placeholders replaced, interpreter token kept, wrapper copied 0755",
  { skip: !posix },
  () => {
    fresh(true);
    const r = req();
    const res = materialiseChromaUnit(r);
    assert.equal(res.ok, true);
    const text = readFileSync(r.target, "utf8");
    const wrapper = path.join(home, ".crewrig", "tls-exec.sh");
    assert.ok(
      text.includes(
        `ExecStart=/usr/bin/env bash ${wrapper} ${python} ${path.dirname(python)}/chroma run --path %h/.mempalace/palace --host`,
      ),
    );
    assert.ok(!/__[A-Z]/.test(text));
    assert.equal(statSync(wrapper).mode & 0o777, 0o755);
    assert.equal(
      readFileSync(wrapper, "utf8"),
      readFileSync(path.join(repoDir, "scripts/lib/tls-exec.sh"), "utf8"),
    );
  },
);

test(
  "plist: home-based palace path, and MEMPALACE_PALACE_PATH wins when non-empty",
  { skip: !posix },
  () => {
    fresh(true);
    const plist = path.join(repoDir, "config", "launchd", "com.mempalace.chroma-server.plist");
    let r = req({ template: plist });
    assert.equal(materialiseChromaUnit(r).ok, true);
    let text = readFileSync(r.target, "utf8");
    assert.ok(text.includes(`<string>${home}/.mempalace/palace</string>`));
    assert.ok(text.includes("<string>/bin/bash</string>"));
    r = req({ template: plist, env: { MEMPALACE_PALACE_PATH: "/data/palace" } });
    materialiseChromaUnit(r);
    text = readFileSync(r.target, "utf8");
    assert.ok(text.includes("<string>/data/palace</string>"));
    r = req({ template: plist, env: { MEMPALACE_PALACE_PATH: "" } });
    materialiseChromaUnit(r);
    assert.ok(readFileSync(r.target, "utf8").includes(`${home}/.mempalace/palace`));
  },
);

test(
  "a residual placeholder is refused, the target removed, the message on stderr",
  { skip: !posix },
  () => {
    fresh(true);
    const tpl = path.join(root, "bad.service");
    writeFileSync(tpl, "ExecStart=__PIPX_PYTHON__ __UNKNOWN_THING__\n");
    const r = req({ template: tpl });
    mkdirSync(path.dirname(r.target), { recursive: true });
    writeFileSync(r.target, "old");
    const res = materialiseChromaUnit(r);
    assert.equal(res.ok, false);
    assert.equal(existsSync(r.target), false);
    assert.deepEqual(err, [`  ERROR: ${r.target} still contains an unsubstituted placeholder.`]);
    assert.deepEqual(out, []);
  },
);

test(
  "missing chroma binary: the shell's message, nothing written, no wrapper copy",
  { skip: !posix },
  () => {
    fresh(false);
    const r = req();
    assert.equal(materialiseChromaUnit(r).ok, false);
    assert.deepEqual(out, [
      `  ERROR: chroma binary not found at ${path.dirname(python)}/chroma — run: pipx inject mempalace 'chromadb>=1.5.9'`,
    ]);
    assert.equal(existsSync(r.target), false);
    assert.equal(existsSync(path.join(home, ".crewrig", "tls-exec.sh")), false);
  },
);

test(
  "a non-executable chroma binary is refused; the test mock lifts the pre-flight",
  { skip: !posix },
  () => {
    fresh(true);
    chmodSync(path.join(path.dirname(python), "chroma"), 0o644);
    assert.equal(materialiseChromaUnit(req()).ok, false);
    assert.equal(
      materialiseChromaUnit(req({ env: { CREWRIG_TEST_MOCK_CHROMA_BIN: "true" } })).ok,
      true,
    );
  },
);

test("no interpreter: the shell's first message", () => {
  fresh(true);
  const r = { ...req(), python: "" };
  assert.equal(materialiseChromaUnit(r).ok, false);
  assert.deepEqual(out, [
    "  ERROR: cannot detect mempalace pipx python — install mempalace first.",
  ]);
});

test("win32 form of the pre-flight message, and nothing is written", () => {
  fresh(false);
  const r = {
    ...req({ platform: "win32" }),
    python: "C:\\pipx\\venvs\\mempalace\\Scripts\\python.exe",
  };
  assert.equal(materialiseChromaUnit(r).ok, false);
  assert.deepEqual(out, [
    "  ERROR: chroma binary not found at C:\\pipx\\venvs\\mempalace\\Scripts\\chroma.exe — run: pipx inject mempalace 'chromadb>=1.5.9'",
  ]);
  assert.equal(existsSync(path.join(home, ".crewrig")), false);
});

test("win32 with the binary mocked: ok, no unit and no .sh wrapper", () => {
  fresh(false);
  const r = req({ platform: "win32", env: { CREWRIG_TEST_MOCK_CHROMA_BIN: "true" } });
  const res = materialiseChromaUnit(r);
  assert.deepEqual(res, { ok: true });
  assert.equal(existsSync(r.target), false);
});

test(
  "a missing wrapper source prints the shell's message; re-running is idempotent",
  { skip: !posix },
  () => {
    fresh(true);
    const r = req();
    const first = materialiseChromaUnit(r);
    const bytes = readFileSync(r.target, "utf8");
    assert.equal(materialiseChromaUnit(r).text, first.text);
    assert.equal(readFileSync(r.target, "utf8"), bytes);
    const noWrapper = { ...r, ctx: { ...r.ctx, repoDir: path.join(root, "empty") } };
    mkdirSync(path.join(root, "empty", "config", "systemd"), { recursive: true });
    writeFileSync(path.join(root, "empty", "config", "systemd", "t.service"), "x\n");
    assert.equal(
      materialiseChromaUnit({
        ...noWrapper,
        template: path.join(root, "empty", "config", "systemd", "t.service"),
      }).ok,
      false,
    );
    assert.deepEqual(out, [
      `  ERROR: ${path.join(root, "empty", "scripts", "lib", "tls-exec.sh")} missing — tls-exec wrapper not shipped.`,
    ]);
  },
);
