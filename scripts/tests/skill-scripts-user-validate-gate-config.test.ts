// Black-box test of user-validate/scripts/gate-config.ts: defaults, parsing, warnings, --json, exits.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { envelope, run, tempDir } from "./lib/skill-scripts-governance-cli.ts";

const tmp = tempDir("gate-config-");
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const conf = (name: string, text: string): string => {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, text);
  return f;
};
const cfg = (args: string[]) => run("user-validate", "gate-config.ts", [...args, "--json"]);

describe("gate-config", () => {
  test("a missing file gives every default and exit 0", () => {
    const r = cfg(["--conf", path.join(tmp, "absent.conf")]);
    assert.equal(r.status, 0);
    const e = envelope(r);
    assert.equal(e.ok, true);
    assert.deepEqual(
      { ...e.data, path: undefined },
      {
        path: undefined,
        found: false,
        backend: "internal",
        translate: "off",
        pedagogy: "contextual",
        illustration: "off",
        theme: "auto",
        raw_passthrough_allowed: false,
      },
    );
    assert.deepEqual(e.findings, []);
  });

  test("keys are read, comments and blank lines ignored, missing keys default", () => {
    const f = conf(
      "a.conf",
      "# note\n\nbackend=plannotator\n translate = on \npedagogy=professor\n",
    );
    const e = envelope(cfg(["--conf", f]));
    assert.equal(e.data?.["backend"], "plannotator");
    assert.equal(e.data?.["translate"], "on");
    assert.equal(e.data?.["pedagogy"], "professor");
    assert.equal(e.data?.["illustration"], "off");
    assert.equal(e.data?.["found"], true);
  });

  test("system is read as auto, dark and light are kept", () => {
    assert.equal(
      envelope(cfg(["--conf", conf("s.conf", "theme=system\n")])).data?.["theme"],
      "auto",
    );
    assert.equal(envelope(cfg(["--conf", conf("d.conf", "theme=dark\n")])).data?.["theme"], "dark");
  });

  test("an invalid value and an unknown key warn, keep the default and exit 0", () => {
    const f = conf("bad.conf", "backend=carrier-pigeon\nbogus=1\n");
    const r = cfg(["--conf", f]);
    assert.equal(r.status, 0);
    const e = envelope(r);
    assert.equal(e.data?.["backend"], "internal");
    assert.deepEqual(e.findings.map((x) => x.rule).sort(), ["invalid-value", "unknown-key"]);
    assert.ok(e.findings.every((x) => x.severity === "warning"));
  });

  test("raw passthrough is allowed only with every presentation option off", () => {
    const f = conf("p.conf", "translate=off\npedagogy=simple\nillustration=off\ntheme=auto\n");
    assert.equal(envelope(cfg(["--conf", f])).data?.["raw_passthrough_allowed"], true);
    const g = conf("q.conf", "pedagogy=simple\ntheme=dark\n");
    assert.equal(envelope(cfg(["--conf", g])).data?.["raw_passthrough_allowed"], false);
  });

  test("the default path is under HOME", () => {
    fs.mkdirSync(path.join(tmp, ".crewrig"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".crewrig", "validation.conf"), "backend=plannotator\n");
    const r = run("user-validate", "gate-config.ts", ["--json"], { env: { HOME: tmp } });
    assert.equal(envelope(r).data?.["backend"], "plannotator");
  });

  test("an unreadable path degrades to the defaults with a warning", () => {
    const e = envelope(cfg(["--conf", tmp]));
    assert.equal(e.data?.["backend"], "internal");
    assert.equal(e.findings[0]?.rule, "unreadable");
  });

  test("--help exits 0, unknown option and stray argument exit 2", () => {
    const h = run("user-validate", "gate-config.ts", ["--help"]);
    assert.equal(h.status, 0);
    assert.match(h.stdout, /^Usage:/);
    const u = cfg(["--nope"]);
    assert.equal(u.status, 2);
    assert.equal(envelope(u).findings[0]?.rule, "usage");
    assert.equal(envelope(cfg(["stray"])).ok, false);
  });
});
