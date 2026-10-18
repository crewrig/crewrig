// build-extension-suite-scaffold.test.ts — the scaffolder harness (v3-F1/v4-F1) through the real
// `node scripts/create-extension.ts` and `node scripts/build-extension.ts --check` in a sandbox:
// Case 12 negative control, 13 (mcp-server, theme), 14, 16. Replaces
// scripts/tests/test-build-extension.sh (cases 12-14, 16).
//
// The `fzf` stub is gone: the selection travels on `CREWRIG_TEST_FZF_SELECTION` (one component
// per line) or `--components`; stdin is not a terminal under a test, so the prompt is unreachable.
// Skipped on win32 (the scaffolder is covered there by windows-create-extension.test.ts).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, describe, test } from "node:test";

import {
  check,
  cloneTemplate,
  createTemplate,
  hookFilePresent,
  runEntry,
  type EntryResult,
} from "./lib/extension-sandbox.ts";

const skip =
  process.platform === "win32"
    ? "scaffolder is covered on win32 by windows-create-extension.test.ts"
    : false;

let template = "";
before(() => {
  if (!skip) template = createTemplate();
});

interface Scaffold {
  readonly root: string;
  readonly res: EntryResult;
  readonly probe: string;
}

/** A fresh sandbox per case: the scaffolder refuses an existing target. */
function scaffold(args: readonly string[], selection?: string): Scaffold {
  const root = cloneTemplate(template);
  const env: Record<string, string> = { NAME: "probe", TIER: "org" };
  if (selection !== undefined) env["CREWRIG_TEST_FZF_SELECTION"] = selection;
  const res = runEntry(root, "create-extension.ts", args, env);
  return { root, res, probe: path.join(root, "extensions", "org", "probe") };
}

function assertSelectionTookEffect(s: Scaffold, comp: string, file: string): void {
  assert.ok(
    s.res.combined.includes(`Added: ${comp}`),
    `stdout is missing 'Added: ${comp}':\n${s.res.combined}`,
  );
  assert.equal(
    hookFilePresent(s.probe, file),
    0,
    `expected file extensions/org/probe/${file} is MISSING`,
  );
}

describe("Case 12 — scaffolder harness, org-tier isolation", { skip }, () => {
  test("Case 12 negative control — an unoffered selection ('mcp') on the env channel prints no 'Added:' line", () => {
    const s = scaffold([], "mcp");
    assert.ok(!s.res.combined.includes("Added:"), s.res.combined);
  });

  test("Case 12 negative control — '--components=mcp' is rejected as an unknown component", () => {
    const s = scaffold(["--components=mcp"]);
    assert.notEqual(s.res.status, 0, s.res.combined);
    assert.ok(!s.res.combined.includes("Added:"), s.res.combined);
    assert.match(s.res.combined, /unknown component/i);
  });
});

describe("Case 13 — scaffold org-tier manifest path (mcp-server, theme)", { skip }, () => {
  for (const [comp, file] of [
    ["mcp-server", "src/index.ts"],
    ["theme", "CONTEXT.md"],
  ] as const) {
    test(`Case 13 (${comp}) — Added, expected file, --check clean, no gemini-extension.json`, () => {
      const s = scaffold([], comp);
      assertSelectionTookEffect(s, comp, file);
      const chk = check(s.root, "probe");
      assert.equal(chk.status, 0, chk.combined);
      assert.equal(fs.existsSync(path.join(s.probe, "gemini-extension.json")), false);
    });
  }
});

describe("Case 14 — scaffold org-tier command path", { skip }, () => {
  test("Case 14 — Added, sample.md, no committed sample.toml, --check clean, render produces sample.toml", () => {
    const s = scaffold([], "command");
    assertSelectionTookEffect(s, "command", "commands/sample.md");
    assert.equal(fs.existsSync(path.join(s.probe, "commands", "sample.toml")), false);
    const chk = check(s.root, "probe");
    assert.equal(chk.status, 0, chk.combined);
    const name = (
      JSON.parse(fs.readFileSync(path.join(s.probe, "extension.json"), "utf8")) as { name: string }
    ).name;
    assert.equal(name, "probe");
    const built = runEntry(s.root, "build-extension.ts", ["--target", "gemini", "probe"]);
    assert.equal(built.status, 0, built.combined);
    assert.ok(
      fs.existsSync(path.join(s.root, "build", "extensions", name, "commands", "sample.toml")),
    );
  });
});

describe(
  "Case 16 — scaffold org-tier hook path (hooks.json.fragment, neutral declaration only)",
  { skip },
  () => {
    test("Case 16 — Added, hooks/logger.ts, fragment consumed, one PreToolUse hook, --check clean", () => {
      const s = scaffold([], "hook");
      assertSelectionTookEffect(s, "hook", "hooks/logger.ts");
      assert.equal(fs.existsSync(path.join(s.probe, "hooks", "logger.sh")), false);
      assert.equal(hookFilePresent(s.probe, "hooks/logger.sh"), 2);
      assert.equal(fs.existsSync(path.join(s.probe, "hooks", "hooks.json")), false);
      assert.equal(fs.existsSync(path.join(s.probe, "hooks.json.fragment")), false);
      const manifest = JSON.parse(
        fs.readFileSync(path.join(s.probe, "extension.json"), "utf8"),
      ) as {
        hooks?: { event: string }[];
      };
      const hooks = manifest.hooks ?? [];
      assert.equal(hooks.length, 1);
      assert.equal(hooks[0]?.event, "PreToolUse");
      const chk = check(s.root, "probe");
      assert.equal(chk.status, 0, chk.combined);
    });
  },
);
