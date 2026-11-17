// skill-scripts-github-actions-contract.test.ts — the additive `--help` and `--json` surface of the
// five existing github-actions scripts (spec 0300 R10 as amended by delta-01, R21). `--json`
// captures are stored under fixtures/github-actions-contract/ and re-recorded with
// GHA_CONTRACT_REGEN=1. The legacy behaviour itself is pinned in the -contract-legacy file and by
// the 0258 oracle. No actionlint, act or docker is on PATH unless a test installs a stub.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  ALL_SCRIPTS,
  parseEnvelope,
  type ScriptName,
  stubTool,
  WF_CLEAN,
} from "./lib/skill-scripts-github-actions-cli.ts";
import {
  act,
  dockerOk,
  exec,
  golden,
  root,
  sandbox,
  type Sandbox,
  tmpLeft,
  WF_UNPINNED,
} from "./lib/skill-scripts-github-actions-sandbox.ts";

after(() => fs.rmSync(root, { recursive: true, force: true }));

describe("--help on all ten scripts, with no external tool on PATH", () => {
  for (const script of ALL_SCRIPTS)
    test(`${script} --help: usage on stdout, exit 0, empty stderr`, () => {
      const s = sandbox();
      const r = exec(s, script, ["--help"], false);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(r.stderr, "");
      assert.match(r.stdout, /^Usage: /i);
      assert.ok(r.stdout.length > 20);
    });
  test("--help never reaches a tool: an installed stub is not called, nothing is written to TMPDIR", () => {
    const s = sandbox();
    const marker = path.join(s.work, "called");
    for (const t of ["actionlint", "act", "docker"]) stubTool(s.bin, t, `: > '${marker}'`);
    for (const script of ALL_SCRIPTS) assert.equal(exec(s, script, ["--help"]).status, 0, script);
    assert.ok(!fs.existsSync(marker));
    assert.deepEqual(tmpLeft(s), []);
  });
  test("--help wins over other arguments on the migrated scripts", () => {
    const s = sandbox({ "wf.yml": WF_CLEAN });
    for (const script of [
      "lint-workflow",
      "check-pinned-actions",
      "simulate-job",
      "simulate-workflow",
    ] as const)
      assert.equal(exec(s, script, ["wf.yml", "--help"], false).status, 0, script);
  });
});

describe("--json: envelope and one case per reserved id (golden captures)", () => {
  test("usage: every migrated script with no argument gives rule usage, exit 2", () => {
    for (const script of [
      "lint-workflow",
      "check-pinned-actions",
      "simulate-job",
      "simulate-workflow",
    ] as const) {
      const s = sandbox();
      const r = exec(s, script, ["--json"]);
      assert.equal(r.status, 2, script);
      const env = parseEnvelope(r);
      assert.equal(env.ok, false);
      assert.equal(env.findings[0]?.rule, "usage");
      golden(`usage-${script}`, s, r);
    }
  });
  test("target-unreadable: legacy exit 1 with rule target-unreadable, on each migrated script", () => {
    const cases: [ScriptName, string[], (s: Sandbox) => void][] = [
      ["check-pinned-actions", ["missing.yml"], () => {}],
      ["lint-workflow", ["missing.yml"], (s) => stubTool(s.bin, "actionlint", "exit 0")],
      ["simulate-job", ["missing.yml", "build"], () => {}],
      ["simulate-workflow", ["missing.yml"], () => {}],
      ["simulate-workflow", ["wf.yml", "push", "nope.json"], (s) => act(s, "exit 0")],
    ];
    for (const [script, args, setup] of cases) {
      const s = sandbox({ "wf.yml": WF_CLEAN });
      setup(s);
      const r = exec(s, script, [...args, "--json"]);
      assert.equal(r.status, 1, `${script} ${args.join(" ")}: ${r.stdout}${r.stderr}`);
      const env = parseEnvelope(r);
      assert.equal(env.ok, false);
      assert.equal(env.findings[0]?.rule, "target-unreadable");
      golden(`target-unreadable-${script}-${args.length}`, s, r);
    }
  });
  test("tool-failed: act exits 7 gives the legacy exit 7 with rule tool-failed", () => {
    for (const [script, args] of [
      ["simulate-job", ["wf.yml", "b"]],
      ["simulate-workflow", ["wf.yml"]],
    ] as const) {
      const s = sandbox({ "wf.yml": WF_CLEAN });
      act(s, "echo act-output; exit 7");
      const r = exec(s, script, [...args, "--json"]);
      assert.equal(r.status, 7, r.stdout + r.stderr);
      const env = parseEnvelope(r);
      assert.equal(env.ok, false);
      assert.ok(
        env.findings.some((f) => f.rule === "tool-failed"),
        JSON.stringify(env.findings),
      );
      golden(`tool-failed-${script}`, s, r);
    }
  });
  test("tool-failed: a tool that cannot spawn or is killed keeps its legacy status, rule tool-failed", () => {
    for (const [script, args, tool] of [
      ["simulate-job", ["wf.yml", "b"], "act"],
      ["simulate-workflow", ["wf.yml"], "act"],
      ["lint-workflow", ["wf.yml"], "actionlint"],
    ] as const) {
      for (const body of ["kill -9 $$", null]) {
        const s = sandbox({ "wf.yml": WF_CLEAN });
        dockerOk(s);
        if (body === null) {
          fs.writeFileSync(path.join(s.bin, tool), "#!/nonexistent/interpreter\n", { mode: 0o755 });
        } else stubTool(s.bin, tool, body);
        const legacy = exec(s, script, args);
        assert.notEqual(
          legacy.status,
          0,
          `${script} ${tool} ${body}: ${legacy.stdout}${legacy.stderr}`,
        );
        const r = exec(s, script, [...args, "--json"]);
        assert.equal(r.status, legacy.status, `${script} ${tool} ${body}`);
        const env = parseEnvelope(r);
        assert.equal(env.ok, false);
        assert.ok(
          env.findings.some((f) => f.rule === "tool-failed"),
          `${script} ${tool} ${body}: ${JSON.stringify(env.findings)}`,
        );
      }
    }
  });
  test("tool-missing: a warning finding, ok stays true, exit 0", () => {
    for (const [script, args] of [
      ["lint-workflow", ["wf.yml"]],
      ["simulate-job", ["wf.yml", "b"]],
      ["simulate-workflow", ["wf.yml"]],
    ] as const) {
      const s = sandbox({ "wf.yml": WF_CLEAN });
      const r = exec(s, script, [...args, "--json"]);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const env = parseEnvelope(r);
      assert.equal(env.ok, true);
      const f = env.findings.find((x) => x.rule === "tool-missing");
      assert.ok(f, JSON.stringify(env.findings));
      assert.equal(f.severity, "warning");
      golden(`tool-missing-${script}`, s, r);
    }
  });
  test("internal-error: an unreadable workflow file inside a directory is legacy exit 1 with rule internal-error", (t) => {
    if (process.getuid?.() === 0) return t.skip("root reads a mode-000 file");
    const s = sandbox({ "wfs/a.yml": WF_UNPINNED });
    fs.chmodSync(path.join(s.work, "wfs", "a.yml"), 0o000);
    const r = exec(s, "check-pinned-actions", ["wfs", "--json"]);
    fs.chmodSync(path.join(s.work, "wfs", "a.yml"), 0o644);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const env = parseEnvelope(r);
    assert.equal(env.ok, false);
    assert.equal(env.findings[0]?.rule, "internal-error");
    golden("internal-error-check-pinned-actions", s, r);
  });
  test("a clean run and a findings run keep the envelope shape (check-pinned-actions)", () => {
    const clean = sandbox({ "wf.yml": WF_CLEAN });
    const rc = exec(clean, "check-pinned-actions", ["wf.yml", "--json"]);
    assert.equal(rc.status, 0);
    assert.equal(parseEnvelope(rc).ok, true);
    golden("pinned-clean", clean, rc);

    const bad = sandbox({ "wf.yml": WF_UNPINNED });
    const rb = exec(bad, "check-pinned-actions", ["wf.yml", "--json"]);
    assert.equal(rb.status, 1);
    const env = parseEnvelope(rb);
    assert.equal(env.ok, false);
    assert.equal(env.findings.length, 1);
    assert.equal(env.findings[0]?.line, 7);
    golden("pinned-unpinned", bad, rb);
  });
  test("lint-workflow --json with an actionlint stub: exit 0 and 1 map to ok", () => {
    const s = sandbox({ "wf.yml": WF_CLEAN });
    stubTool(s.bin, "actionlint", "exit 0");
    assert.equal(parseEnvelope(exec(s, "lint-workflow", ["wf.yml", "--json"])).ok, true);
    stubTool(s.bin, "actionlint", "echo 'wf.yml:1:1: bad' >&2; exit 1");
    const r = exec(s, "lint-workflow", ["wf.yml", "--json"]);
    assert.equal(r.status, 1);
    assert.equal(parseEnvelope(r).ok, false);
  });
  test("check-secrets-exposure gains --help only: --json is not part of its contract here", () => {
    const s = sandbox({ "wf.yml": WF_CLEAN });
    const r = exec(s, "check-secrets-exposure", ["wf.yml"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\[OK\] no secret-exposure patterns detected/);
  });
});
