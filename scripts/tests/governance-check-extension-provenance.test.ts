// check-extension-provenance.test.ts — black-box edge cases of scripts/check-extension-provenance.ts
// not covered by the Bash suite (spec 0259). Each case asserts stdout, stderr and
// status byte for byte against the frozen output of the original shell script
// (recorded under LC_ALL=C on Linux).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(SCRIPTS, "check-extension-provenance.ts");

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Frozen {status, stdout, stderr} of the original shell script, one per check, in call order. */
const GOLDEN = JSON.parse(
  readFileSync(
    path.join(
      SCRIPTS,
      "tests",
      "fixtures",
      "governance-oracle",
      "extension-provenance.json.golden",
    ),
    "utf8",
  ),
) as Run[];
let nextGolden = 0;
function frozen(): Run {
  const g = GOLDEN[nextGolden++];
  assert.ok(g, "frozen shell expectations exhausted");
  return g;
}

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Run {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Run the TS entry in a fresh fixture tree; compare to the frozen shell output. */
function check(setup: (dir: string) => void): Run {
  const dir = mkdtempSync(path.join(tmpdir(), "ext-provenance-"));
  try {
    setup(dir);
    const ts = run(
      process.execPath,
      ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY],
      dir,
    );
    assert.deepEqual(ts, frozen());
    return ts;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function put(dir: string, rel: string, body = ""): void {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), body);
}

const GOOD =
  '---\nname: x\n---\n<!-- crewrig-provenance: version="1" canonical="https://a/b" feedback="https://a/b" -->\n';

describe("check-extension-provenance edge cases", () => {
  it("passes with the OK line when both tier roots are empty or absent", () => {
    const r = check((d) => mkdirSync(path.join(d, "extensions/core"), { recursive: true }));
    assert.equal(r.status, 0);
    assert.match(r.stdout, /OK: 0 upstream-owned/);
  });

  it("excludes a symlinked SKILL.md and finds nested ones in global bytewise order", () => {
    const r = check((d) => {
      put(d, "extensions/library/z/skills/s/SKILL.md", GOOD);
      put(d, "extensions/core/skills/a/AGENT.md", GOOD);
      put(d, "extensions/core/skills/a-b/SKILL.md", GOOD);
      put(d, "elsewhere/SKILL.md", "no carrier\n");
      symlinkSync(
        path.join(d, "elsewhere/SKILL.md"),
        path.join(d, "extensions/core/skills/SKILL.md"),
      );
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /OK: 3 upstream-owned/);
    assert.ok(!r.stdout.includes("extensions/core/skills/SKILL.md"));
  });

  it("reports missing fields and a feedback mismatch", () => {
    const r = check((d) => {
      put(d, "extensions/core/a/SKILL.md", '---\n---\n<!-- crewrig-provenance: version="1" -->\n');
      put(
        d,
        "extensions/core/b/SKILL.md",
        '---\n---\n<!-- crewrig-provenance: version="1" canonical="u" feedback="v" -->\n',
      );
    });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /missing field\(s\): canonical feedback \(R1\)/);
    assert.match(r.stdout, /feedback 'v' != canonical 'u' \(R5\)/);
  });
});

// Spec 0312 R4/R7 (issue #2075): `extension` joins the required carrier fields. These cases are
// not in the frozen shell oracle (the shell script never knew the field), so they run unfrozen.
describe("check-extension-provenance: the extension field (spec 0312 R7)", () => {
  const unfrozen = (setup: (dir: string) => void): Run => {
    const dir = mkdtempSync(path.join(tmpdir(), "ext-provenance-ext-"));
    try {
      setup(dir);
      return run(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY], dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const carrier = (fields: string): string =>
    `---\nname: x\n---\n<!-- crewrig-provenance: ${fields} canonical="u" feedback="u" -->\n`;

  it("a carrier without extension fails naming the file and the field", () => {
    const r = unfrozen((d) =>
      put(d, "extensions/core/hello/skills/s/SKILL.md", carrier('version="1.2.3"')),
    );
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /extensions\/core\/hello\/skills\/s\/SKILL\.md/);
    assert.match(r.stdout, /missing field\(s\): extension \(R1\)/);
  });

  it("a four-field carrier passes", () => {
    const r = unfrozen((d) =>
      put(
        d,
        "extensions/core/hello/skills/s/SKILL.md",
        carrier('extension="hello" version="1.2.3"'),
      ),
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  it("an empty extension value counts as missing", () => {
    const r = unfrozen((d) =>
      put(d, "extensions/core/hello/agents/a/AGENT.md", carrier('extension="" version="1.2.3"')),
    );
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /missing field\(s\): extension \(R1\)/);
  });
});
