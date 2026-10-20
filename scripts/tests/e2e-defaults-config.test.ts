// e2e-defaults-config.test.ts — schema integrity of tests/e2e/defaults.toml, the [judge] table and
// its surfacing through toml_merge, the scenario/parity lockstep with docs/cli-matrix.md and the
// .gitignore entries of tests/e2e (spec 0261 R19). Migrated from test-e2e-defaults-toml.sh,
// test-e2e-judge-config.sh, test-e2e-scenarios-parity.sh and test-e2e-gitignore.sh. No Docker, no
// bash, jq or yq: the TOML subset reader replaces yq; `git` is the only spawned program.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { tomlMerge } from "../../tests/e2e/lib/toml_merge.ts";
import { isNumber, isTable, parseToml } from "../../tests/e2e/lib/toml_subset.ts";
import type { TomlTable, TomlValue } from "../../tests/e2e/lib/toml_subset.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const DEFAULTS = path.join(REPO, "tests", "e2e", "defaults.toml");
const MATRIX = path.join(REPO, "docs", "cli-matrix.md");
const CLIS = ["claude", "gemini", "copilot"];

const git = (...args: string[]): number =>
  spawnSync("git", args, { cwd: REPO, stdio: "ignore" }).status ?? -1;
const defaults = (): TomlTable => parseToml(fs.readFileSync(DEFAULTS, "utf8"), "defaults.toml");
const table = (t: TomlTable, ...keys: string[]): TomlTable => {
  let cur: TomlValue | undefined = t;
  for (const k of keys) cur = isTable(cur as TomlValue) ? (cur as TomlTable).get(k) : undefined;
  assert.ok(cur !== undefined && isTable(cur), `[${keys.join(".")}] table present`);
  return cur;
};
const scalar = (v: TomlValue | undefined): string => {
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return String(v);
  if (v !== undefined && isNumber(v)) return v.num;
  return assert.fail(`not a scalar: ${JSON.stringify(v)}`);
};

describe("defaults.toml schema (ADR 0003)", () => {
  it("exists, is git-tracked and parses", () => {
    assert.ok(fs.existsSync(DEFAULTS));
    assert.equal(git("ls-files", "--error-unmatch", "tests/e2e/defaults.toml"), 0);
    defaults();
  });

  for (const cli of CLIS) {
    it(`[cli.${cli}] has every required key, an array command and the pinned image`, () => {
      const t = table(defaults(), "cli", cli);
      for (const k of ["image", "command", "command_args", "env_keys", "mounts"]) {
        assert.ok(t.has(k), `[cli.${cli}].${k} present`);
      }
      assert.ok(Array.isArray(t.get("command")), `[cli.${cli}].command is array`);
      // The tags stay verbatim literals: deriving them would couple the assertion to the naming
      // convention it exists to pin.
      assert.equal(t.get("image"), `crewrig/e2e-${cli}:latest`);
    });
  }

  it("[cli.copilot].mounts declares exactly one rw credential mount on ~/.copilot", () => {
    const mounts = table(defaults(), "cli", "copilot").get("mounts");
    assert.ok(Array.isArray(mounts) && mounts.length === 1, `got ${JSON.stringify(mounts)}`);
    const mount0 = String(mounts[0] ?? "");
    assert.ok(
      mount0.includes(":/home/agent/.copilot:") || mount0.endsWith(":/home/agent/.copilot"),
      mount0,
    );
    assert.ok(mount0.startsWith("${CREWRIG_E2E_HOME}"), mount0);
    assert.ok(mount0.endsWith(":rw"), mount0);
  });

  it("env_keys values all match ^[A-Z_][A-Z0-9_]*$", () => {
    const bad: string[] = [];
    for (const cli of CLIS) {
      const keys = table(defaults(), "cli", cli).get("env_keys") ?? [];
      for (const k of keys as TomlValue[]) {
        if (!/^[A-Z_][A-Z0-9_]*$/.test(String(k))) bad.push(`[cli.${cli}]=${String(k)}`);
      }
    }
    assert.deepEqual(bad, []);
  });
});

describe("[judge] schema (ADR 0004 Decision 4)", () => {
  const PINNED: Record<string, string> = {
    backend: "anthropic",
    model: "claude-sonnet-4-6",
    api_key_env: "ANTHROPIC_JUDGE_API_KEY",
    strict: "false",
    max_calls: "30",
    endpoint: "https://api.anthropic.com/v1/messages",
    max_tokens: "256",
  };

  it("pins every field", () => {
    const judge = table(defaults(), "judge");
    for (const [k, want] of Object.entries(PINNED)) {
      assert.equal(scalar(judge.get(k)), want, `[judge].${k}`);
    }
  });

  it("toml_merge passes the defaults through and exposes every field", () => {
    const r = tomlMerge([DEFAULTS], REPO, {});
    assert.equal(r.rc, 0, r.stderr);
    const merged = JSON.parse(r.stdout) as { judge?: Record<string, unknown> };
    for (const f of Object.keys(PINNED)) {
      assert.ok(merged.judge !== undefined && f in merged.judge, `merged JSON exposes .judge.${f}`);
    }
  });
});

describe("scenarios parity with docs/cli-matrix.md", () => {
  const SCENARIOS = [
    "01-layered-context",
    "02-cross-tool-memory",
    "03-skill-build",
    "04-harness-loop",
    "05-copilot-model-routing",
    "06-agent-surface-consumption",
  ];
  /** Logical lines: a wrapped bullet (indented continuation lines) is folded back into one. */
  const matrix = (): string[] => {
    const out: string[] = [];
    for (const l of fs.readFileSync(MATRIX, "utf8").split(/\r?\n/)) {
      if (/^\s+\S/.test(l) && out.length > 0) out[out.length - 1] += ` ${l.trim()}`;
      else out.push(l);
    }
    return out;
  };

  it("both sources exist", () => {
    assert.ok(fs.existsSync(MATRIX));
    assert.ok(fs.existsSync(DEFAULTS));
  });

  for (const s of SCENARIOS) {
    it(`cli-matrix.md mentions '${s}' and defaults.toml declares its applies_to`, () => {
      assert.ok(
        matrix().some((l) => l.includes(s)),
        `no occurrence of '${s}'`,
      );
      const lines = fs.readFileSync(DEFAULTS, "utf8").split(/\r?\n/);
      const hdr = lines.findIndex((l) => l.startsWith(`[scenarios.${s}]`));
      assert.ok(hdr >= 0, `no '[scenarios.${s}]' header`);
      const block = lines.slice(hdr, hdr + 11);
      assert.ok(
        block.some((l) => /^\s*applies_to\s*=/.test(l)),
        "no 'applies_to =' within 10 lines of header",
      );
    });
  }

  it("the cross-tool-memory copilot gap is documented", () => {
    // Each matrix row is one `### ` section; the old single table line is now that whole section.
    const sections = matrix()
      .join("\n")
      .split(/\n(?=### )/)
      .filter((x) => x.includes("02-cross-tool-memory"));
    assert.ok(sections.length > 0, "no row section mentions '02-cross-tool-memory'");
    assert.ok(
      sections.some((x) => /copilot/i.test(x)),
      "no 'copilot' mention within the row of '02-cross-tool-memory'",
    );
    assert.ok(
      sections.some((x) => /gap/i.test(x)),
      "no 'GAP' marker within the row mentioning the scenario",
    );
  });
});

describe("tests/e2e gitignore entries (issue #78)", () => {
  const ignored = (p: string): boolean => git("check-ignore", "-q", p) === 0;
  const tracked = (p: string): boolean => git("ls-files", "--error-unmatch", p) === 0;

  it("local.toml and reports/<dir> are ignored", () => {
    assert.ok(ignored("tests/e2e/local.toml"));
    assert.ok(ignored("tests/e2e/reports/some-run-dir"));
  });
  it("reports/.gitkeep is tracked and not ignored (negation works)", () => {
    assert.ok(!ignored("tests/e2e/reports/.gitkeep"));
    assert.ok(tracked("tests/e2e/reports/.gitkeep"));
  });
  it("local.toml.example is tracked and not ignored", () => {
    assert.ok(tracked("tests/e2e/local.toml.example"));
    assert.ok(!ignored("tests/e2e/local.toml.example"));
  });
});
