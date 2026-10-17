// mempalace-doctor-divergence.test.ts — the doctor's three independent failure triggers on a
// fabricated machine (spec 0263, PR E; ports G1, G5, G6 of the retired
// test-mempalace-doctor.sh): divergent installs with every guard label (G1), out of range
// without divergence (G5), version divergence alone (G6). The doctor runs through its bash
// shim. POSIX only: sh-shim interpreters and shebang console scripts.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import {
  COMMON_SH,
  GOOD_VERSION,
  OLD_VERSION,
  PIN,
  PIN_MODULE,
  POSIX,
  PYTHON_ABS,
  SECOND_GOOD_VERSION,
  makeCheckout,
  makeConsoleScript,
  makeFakesite,
  makeInterpreter,
  makeToolbin,
  pipxCandidate,
  rewriteMaxPin,
  runDoctor,
  runDoctorIsolated,
  scratchDir,
  writeRegBash,
  writeRegDirect,
  writeRegUnguarded,
  type DoctorRun,
} from "./lib/doctor-machine.ts";
import { realHomeGuard } from "./lib/real-home-guard.ts";

const skip = POSIX ? false : "sh-shim interpreters and shebang console scripts are POSIX only";
const guard = realHomeGuard();
const roots: string[] = [];
const root = (label: string): string => {
  const dir = scratchDir(label);
  roots.push(dir);
  return dir;
};
const wrapperOf = (checkout: string): string =>
  path.join(checkout, "scripts", "lib", "mempalace-http-wrapper.py");

after(() => {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
  guard.assertUnchanged();
});

describe("G1: divergent installs, both argv shapes, the guard labels", { skip }, () => {
  let r: DoctorRun;
  let pathDir = "";
  let good = "";
  let home = "";

  before(() => {
    const s = root("g1");
    home = path.join(s, "home");
    pathDir = path.join(s, "bin");
    const oldSite = path.join(s, "an-unrecognised-mechanism", "site");
    const goodSite = path.join(s, "good", "site");
    makeFakesite(oldSite, OLD_VERSION);
    makeFakesite(goodSite, GOOD_VERSION);
    const old = path.join(s, "an-unrecognised-mechanism", "python-old");
    good = path.join(s, "good", "python-good");
    makeInterpreter(old, oldSite);
    makeInterpreter(good, goodSite);
    for (const name of ["guarded", "preguard", "altpin"]) makeCheckout(path.join(s, name));
    fs.rmSync(path.join(s, "preguard", "scripts", "lib", "mempalace_pin.py"));
    rewriteMaxPin(path.join(s, "altpin"), "9.9");
    writeRegBash(path.join(home, ".claude.json"), good, wrapperOf(path.join(s, "guarded")));
    writeRegDirect(
      path.join(home, ".gemini", "settings.json"),
      good,
      wrapperOf(path.join(s, "preguard")),
    );
    writeRegUnguarded(path.join(home, ".copilot", "mcp-config.json"), good);
    writeRegBash(
      path.join(home, ".gemini", "config", "mcp_config.json"),
      good,
      wrapperOf(path.join(s, "altpin")),
    );
    makeConsoleScript(path.join(pathDir, "mempalace"), old);
    makeConsoleScript(path.join(pathDir, "mempalace-mcp"), good);
    r = runDoctor(home, pathDir);
  });

  test("exits non-zero", () => assert.notEqual(r.rc, 0, r.out));

  test("reports both versions, both paths and the unrecognised install (R9)", () => {
    for (const text of [OLD_VERSION, GOOD_VERSION, path.join(pathDir, "mempalace")]) {
      assert.ok(r.out.includes(text), `missing ${text}`);
    }
    assert.ok(r.out.includes("mempalace-mcp"));
    assert.ok(r.out.includes("an-unrecognised-mechanism"));
  });

  test("reports the version and the pin divergence as separate full sentences (R8)", () => {
    assert.ok(r.out.includes("reported versions DIVERGE"), "version divergence sentence");
    assert.ok(r.out.includes("declared pins DIVERGE"), "pin divergence sentence");
  });

  test("carries the restart sentence (R4)", () => {
    assert.ok(r.out.includes("must be restarted"));
  });

  test("attributes the out-of-range version to a named path on one line (R8)", () => {
    const hit = r.out
      .split("\n")
      .some((l) => l.includes("PATH:mempalace") && l.includes(OLD_VERSION));
    assert.ok(hit, r.out);
  });

  test("both argv shapes resolve the registered interpreter (at least 3 registrations)", () => {
    const hits = r.out.split("\n").filter((l) => l.includes(`registered interpreter: ${good}`));
    assert.ok(hits.length >= 3, `found ${hits.length}`);
  });

  test("GUARD ABSENT and UNGUARDED are distinct labels, one registration each", () => {
    assert.ok(r.out.includes("GUARD ABSENT (pre-guard checkout)"));
    assert.equal(r.out.split("GUARD ABSENT").length - 1, 1);
    assert.equal(r.out.split("UNGUARDED").length - 1, 1);
  });

  test("a checkout declaring a different pin is tabulated by source", () => {
    assert.ok(r.out.includes("Pins declared, by source"));
  });

  test("R10: the fallback names the skipped highest-priority candidate", () => {
    const lines = r.out.split("\n");
    const at = lines.findIndex((l) => l.includes("fallback selected:"));
    assert.ok(at >= 0, "fallback selected: is announced");
    const window = lines.slice(at, at + 4).join("\n");
    assert.ok(window.includes(`(${pipxCandidate(home)})`), window);
  });
});

describe("G5: out of range without divergence", { skip }, () => {
  let r: DoctorRun;

  before(() => {
    const s = root("g5");
    const home = path.join(s, "home");
    const pathDir = path.join(s, "bin");
    const toolbin = path.join(s, "toolbin");
    const site = path.join(s, "site");
    makeFakesite(site, OLD_VERSION);
    const py = path.join(home, ".local", "pipx", "venvs", "mempalace", "bin", "python");
    makeInterpreter(py, site);
    // Pre-seeded: inside this PATH `python3` IS the shim, so the env-form shebang resolves.
    makeInterpreter(path.join(toolbin, "python3"), site);
    makeToolbin(toolbin);
    makeConsoleScript(path.join(pathDir, "mempalace"), py);
    fs.writeFileSync(
      path.join(pathDir, "mempalace-mcp"),
      "#!/usr/bin/env python3\n# fake console script, never executed by the doctor\n",
      { mode: 0o755 },
    );
    r = runDoctorIsolated(home, pathDir, toolbin);
  });

  test("exits non-zero from the range trigger alone", () => {
    assert.notEqual(r.rc, 0, r.out);
    assert.ok(!r.out.includes("DIVERGE"), "no divergence stands in for the finding");
  });

  test("names which path carries the out-of-range version", () => {
    assert.ok(r.out.includes(`PATH:mempalace: ${OLD_VERSION} lies outside`));
    assert.ok(r.out.includes(`PATH:mempalace-mcp: ${OLD_VERSION} lies outside`));
  });

  test("an env-form shebang resolves to its second token, not to env", () => {
    assert.match(r.out, /^ +shebang interpreter: +python3$/m);
  });
});

describe("G6: version divergence alone", { skip }, () => {
  let r: DoctorRun;

  before(() => {
    const s = root("g6");
    const home = path.join(s, "home");
    const pathDir = path.join(s, "bin");
    const toolbin = path.join(s, "toolbin");
    makeFakesite(path.join(s, "site-a"), GOOD_VERSION);
    makeFakesite(path.join(s, "site-b"), SECOND_GOOD_VERSION);
    const pyA = path.join(home, ".local", "pipx", "venvs", "mempalace", "bin", "python");
    const pyB = path.join(s, "other", "python-b");
    makeInterpreter(pyA, path.join(s, "site-a"));
    makeInterpreter(pyB, path.join(s, "site-b"));
    makeToolbin(toolbin);
    makeCheckout(path.join(s, "checkout"));
    const wrapper = wrapperOf(path.join(s, "checkout"));
    writeRegBash(path.join(home, ".claude.json"), pyA, wrapper);
    writeRegDirect(path.join(home, ".gemini", "settings.json"), pyA, wrapper);
    writeRegDirect(path.join(home, ".copilot", "mcp-config.json"), pyA, wrapper);
    writeRegBash(path.join(home, ".gemini", "config", "mcp_config.json"), pyA, wrapper);
    makeConsoleScript(path.join(pathDir, "mempalace"), pyA);
    makeConsoleScript(path.join(pathDir, "mempalace-mcp"), pyB);
    r = runDoctorIsolated(home, pathDir, toolbin);
  });

  test("the second version is inside the committed pin (guards the derivation)", () => {
    const check = spawnSync(
      PYTHON_ABS,
      [PIN_MODULE, "--common-sh", COMMON_SH, "--check", SECOND_GOOD_VERSION],
      { encoding: "utf8" },
    );
    assert.equal(
      check.status,
      0,
      `${SECOND_GOOD_VERSION} is outside >=${PIN.min},<${PIN.maxExclusive}`,
    );
  });

  test("exits non-zero and says the versions diverge", () => {
    assert.notEqual(r.rc, 0, r.out);
    assert.ok(r.out.includes("reported versions DIVERGE"));
  });

  test("tabulates the source that carries the second version", () => {
    const lines = r.out.split("\n");
    const at = lines.findIndex((l) => l.includes("Versions reported, by source:"));
    assert.ok(at >= 0, "the divergence table is printed");
    const re = new RegExp(`^ +PATH:mempalace-mcp +${SECOND_GOOD_VERSION.replaceAll(".", "\\.")}$`);
    assert.ok(
      lines.slice(at + 1, at + 9).some((l) => re.test(l)),
      lines.slice(at, at + 9).join("\n"),
    );
  });

  test("neither of the other two triggers stands in for the finding", () => {
    assert.ok(!r.out.includes("lies outside"));
    assert.ok(!r.out.includes("declared pins DIVERGE"));
  });
});
