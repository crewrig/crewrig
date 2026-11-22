// usage-capture-optin-enable-b.test.ts — the registered command and the checkout-path contract of
// the usage-capture opt-in (spec 0263, row J1b; port of sections 3 (k), (q), (r) of
// test-setup-usage-capture-optin.sh: groups G17, G25, G26). POSIX-only: the registered command is
// run through /bin/sh and some directory names are illegal on win32.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { assertOnceAt, runRegistered, SKIP_POSIX } from "./lib/optin-enable.ts";
import { addCmds, initCfg, REPO, runOptin, scratch, type Scratch } from "./lib/optin-fixtures.ts";
import {
  backups,
  captureCmds,
  cliEvents,
  homeConfig,
  jsonEq,
  noncaptureView,
  OPTIN_CLIS,
  readJson,
  totalCapture,
  type Json,
  type OptinCli,
} from "./lib/optin-oracle.ts";

const posix = process.platform === "win32" ? SKIP_POSIX : false;
const both = (r: { stdout: string; stderr: string }): string => r.stdout + r.stderr;
const firstCmd = (cfg: string, cli: OptinCli): string => {
  const ev = cliEvents(cli)[0] ?? "";
  return captureCmds(readJson(cfg), ev)[0] ?? "";
};
const rawCmd = (cfg: string): string =>
  (readJson(cfg) as { hooks: { AfterModel: { hooks: { command: string }[] }[] } }).hooks
    .AfterModel[0]?.hooks[0]?.command ?? "";
const write = (f: string, doc: Json): void => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `${JSON.stringify(doc, null, 2)}\n`);
};

describe(
  "G17 the registered command writes a journal record with no MemPalace (R3)",
  { skip: posix },
  () => {
    for (const cli of OPTIN_CLIS) {
      it(`${cli}: the registered command, run from outside the repo, journals a record`, () => {
        const s = scratch();
        const cfg = homeConfig(cli, s.home);
        assert.equal(runOptin("enable", [cli, cfg, REPO], { env: s.env }).status, 0);
        const cmd = firstCmd(cfg, cli);
        assert.notEqual(cmd, "", "a registered command exists");
        const r = runRegistered(s, cmd, cli, "k");
        assert.ok(r.premiseOk, "mempalace is not on the restricted PATH");
        assert.equal(r.status, 0);
        assert.ok(r.journal.length >= 1, "at least one journal record");
        s.cleanup();
      });
    }
  },
);

function spacedCheckout(s: Scratch): { repo: string; abs: string; shAbs: string } {
  const repo = path.join(s.tmp, "My Projects", "crewrig");
  fs.mkdirSync(path.join(repo, "scripts", "lib"), { recursive: true });
  fs.cpSync(path.join(REPO, "hooks"), path.join(repo, "hooks"), { recursive: true });
  // The shim is gone from the repository: this checkout models the legacy layout that still carries one.
  fs.writeFileSync(path.join(repo, "hooks", "usage-capture.sh"), "");
  for (const d of ["usage-capture", "usage-store", "usage-hook", "usage-inventory"])
    fs.cpSync(path.join(REPO, "scripts/lib", d), path.join(repo, "scripts/lib", d), {
      recursive: true,
    });
  for (const f of fs.readdirSync(path.join(REPO, "scripts/lib")))
    if (f.endsWith(".ts"))
      fs.copyFileSync(path.join(REPO, "scripts/lib", f), path.join(repo, "scripts/lib", f));
  fs.mkdirSync(path.join(repo, ".git"));
  const nm = path.join(REPO, "node_modules");
  if (fs.existsSync(nm)) fs.symlinkSync(nm, path.join(repo, "node_modules"));
  const hooks = fs.realpathSync(path.join(repo, "hooks"));
  return {
    repo,
    abs: path.join(hooks, "usage-capture.ts"),
    shAbs: path.join(hooks, "usage-capture.sh"),
  };
}

describe("G25 a checkout path with a space works end to end", () => {
  for (const cli of OPTIN_CLIS) {
    it(`${cli}: enable, paths, two keeps and the registered command`, { skip: posix }, () => {
      const s = scratch();
      const sp = spacedCheckout(s);
      const cfg = path.join(s.tmp, "q", cli, "config.json");
      const en = runOptin("enable", [cli, cfg, sp.repo], { env: s.env });
      assert.equal(en.status, 0, both(en));
      assertOnceAt(cfg, cli, sp.abs);
      assert.equal(runOptin("paths", [cli, cfg], { env: s.env }).stdout.trim(), sp.abs);
      const enabled = fs.readFileSync(cfg);
      runOptin("keep", [cli, cfg, sp.repo], { env: s.env });
      const out = both(runOptin("keep", [cli, cfg, sp.repo], { env: s.env }));
      assert.ok(enabled.equals(fs.readFileSync(cfg)), "two keeps are byte-identical");
      assert.ok(!out.includes("re-pointed"));
      assert.deepEqual(backups(cfg), []);
      const r = runRegistered(s, firstCmd(cfg, cli), cli, "q");
      assert.equal(r.status, 0);
      assert.ok(r.journal.length >= 1, "the spaced registered command journals a record");
      s.cleanup();
    });
  }
  const legacy = (s: Scratch, script: string, name: string): string => {
    const cfg = path.join(s.tmp, "q", name, "config.json");
    const doc = initCfg("gemini");
    addCmds(doc, "gemini", script, "legacy");
    write(cfg, doc);
    return cfg;
  };
  it("gemini: the legacy unquoted spaced command is capture; keep only adds the quotes, once", () => {
    const s = scratch();
    const sp = spacedCheckout(s);
    const cfg = legacy(s, sp.shAbs, "gemini-legacy");
    assert.equal(runOptin("state", ["gemini", cfg], { env: s.env }).stdout.trim(), "installed");
    assert.equal(runOptin("paths", ["gemini", cfg], { env: s.env }).stdout.trim(), sp.shAbs);
    assert.equal(captureCmds(readJson(cfg), "AfterModel").length, 1);
    runOptin("keep", ["gemini", cfg, sp.repo], { env: s.env });
    const once = fs.readFileSync(cfg);
    runOptin("keep", ["gemini", cfg, sp.repo], { env: s.env });
    assertOnceAt(cfg, "gemini", sp.shAbs);
    assert.ok(once.equals(fs.readFileSync(cfg)), "the second keep is a no-op");
    s.cleanup();
  });
  it("gemini: a legacy spaced command at a path that does not exist is not capture", () => {
    const s = scratch();
    const sp = spacedCheckout(s);
    const gone = path.join(s.tmp, "Gone Projects", "crewrig", "hooks", "usage-capture.sh");
    const cfg = legacy(s, gone, "gemini-legacy-gone");
    const base = `${cfg}.base`;
    fs.copyFileSync(cfg, base);
    const cmd = rawCmd(cfg);
    assert.ok(!fs.existsSync(gone));
    assert.equal(runOptin("state", ["gemini", cfg], { env: s.env }).stdout.trim(), "absent");
    const fp = runOptin("footprint", ["gemini", cfg], { env: s.env }).stdout;
    assert.deepEqual(JSON.parse(fp), []);
    assert.equal(runOptin("paths", ["gemini", cfg], { env: s.env }).stdout.trim(), "");
    assert.equal(totalCapture(readJson(cfg)), 0);
    runOptin("remove", ["gemini", cfg], { env: s.env });
    assert.ok(jsonEq(cfg, base), "remove leaves it as it was");
    const out = both(runOptin("keep", ["gemini", cfg, sp.repo], { env: s.env }));
    assert.equal(rawCmd(cfg), cmd);
    assert.equal(noncaptureView(readJson(cfg)), noncaptureView(readJson(base)));
    assert.ok(!out.includes("re-pointed") && !out.includes("quoted"));
    assertOnceAt(cfg, "gemini", sp.abs);
    s.cleanup();
  });
});

describe("G26 a path that cannot be double-quoted safely is refused", { skip: posix }, () => {
  const names: [string, string][] = [
    ["double quote", '"'],
    ["dollar", "$"],
    ["backtick", "`"],
    ["backslash", "\\"],
    ["newline", "\n"],
  ];
  const mk = (s: Scratch, dir: string, stub: string): string => {
    fs.mkdirSync(path.join(dir, "hooks"), { recursive: true });
    if (stub.endsWith(".sh")) {
      for (const f of fs.readdirSync(path.join(REPO, "hooks")))
        if (f.endsWith("-usage-capture-hooks.json"))
          fs.copyFileSync(path.join(REPO, "hooks", f), path.join(dir, "hooks", f));
      fs.writeFileSync(path.join(dir, "hooks", stub), "#!/bin/bash\nexit 0\n");
    } else fs.writeFileSync(path.join(dir, "hooks", stub), "// stub\n");
    return dir;
  };
  names.forEach(([label, ch], i) => {
    it(`a checkout path containing ${label}: abs refuses, enable fails per CLI and writes nothing`, () => {
      const s = scratch();
      const d = mk(s, path.join(s.tmp, "r", `bad${i + 1}-a${ch}b`), "usage-capture.sh");
      const r = runOptin("abs", [d], { env: s.env });
      assert.equal(r.status, 1);
      assert.equal(r.stdout, "");
      assert.match(r.stderr, /cannot be wired safely/);
      for (const cli of OPTIN_CLIS) {
        const cfg = path.join(s.tmp, "r", `cfg${i + 1}-${cli}`, "config.json");
        const e = runOptin("enable", [cli, cfg, d], { env: s.env });
        assert.notEqual(e.status, 0);
        assert.ok(!fs.existsSync(cfg), `${cli}: no config written`);
      }
      s.cleanup();
    });
  });
  it("a clean symlink argument whose physical path contains $ is refused", () => {
    const s = scratch();
    const d = mk(s, path.join(s.tmp, "r", "bad2-a$b"), "usage-capture.sh");
    const link = path.join(s.tmp, "r", "clean-link");
    fs.symlinkSync(d, link);
    const r = runOptin("abs", [link], { env: s.env });
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    s.cleanup();
  });
  it("a path with a quote, parentheses and an ampersand is accepted", () => {
    const s = scratch();
    const d = mk(s, path.join(s.tmp, "r", "it's (a&b)"), "usage-capture.ts");
    const r = runOptin("abs", [d], { env: s.env });
    assert.equal(
      r.stdout.trim(),
      path.join(fs.realpathSync(path.join(d, "hooks")), "usage-capture.ts"),
    );
    s.cleanup();
  });
});
