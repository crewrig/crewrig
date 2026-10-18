// build-extension-suite-render.test.ts — Cases 1, 2a-c, 3, 4, 5a-d and 15a-b of the render
// entry, through the real `node scripts/build-extension.ts` in a sandbox.
// Replaces scripts/tests/test-build-extension.sh (cases 1-5, 15).
//
// Case 1 renders into the SANDBOX `build/`; the checkout is never written. The sourced-Bash
// oracle leg is dropped: `build-components-conformance-render.test.ts` already sources
// `render-command.sh` against the TypeScript renderer.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, describe, test } from "node:test";

import { createRenderCommand } from "../lib/render-command.ts";
import {
  cloneTemplate,
  check,
  createTemplate,
  extDir,
  fixtureManifest,
  REPO,
  render,
  runEntry,
  tomlError,
  tomlField,
  tomlSkip,
  writeFile,
  writeManifest,
} from "./lib/extension-sandbox.ts";
import { yamlText } from "./lib/yaml-lib.ts";

let template = "";
before(() => {
  template = createTemplate();
});

const read = (file: string): string => fs.readFileSync(file, "utf8");
const toml = tomlSkip();

/** Sorted `relative path:size:mtimeMs` lines of a directory tree, or null when it is absent. */
function snapshotTree(dir: string): string[] | null {
  if (!fs.existsSync(dir)) return null;
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else {
        const s = fs.statSync(f);
        out.push(`${path.relative(dir, f)}:${s.size}:${s.mtimeMs}`);
      }
    }
  };
  walk(dir);
  return out.sort();
}

describe("Case 1 — round-trip on hello-world", () => {
  test("Case 1 — build/extensions/hello-world/commands/hello.toml matches a direct render of hello.md", () => {
    const root = cloneTemplate(template);
    // Host-independent: a developer machine may or may not hold a real build/ output, so record
    // the real directory's state first and assert the render left it exactly as it was.
    const realOut = path.join(REPO, "build", "extensions", "hello-world");
    const before = snapshotTree(realOut);
    const res = render(root, "gemini", "hello-world");
    assert.equal(res.status, 0, res.combined);
    const produced = path.join(
      root,
      "build",
      "extensions",
      "hello-world",
      "commands",
      "hello.toml",
    );
    assert.ok(fs.existsSync(produced), "hello.toml was not produced in the sandbox build/");
    const src = path.join(REPO, "extensions", "core", "hello-world", "commands", "hello.md");
    const expected = createRenderCommand(yamlText).renderCommandGemini(src);
    assert.equal(read(produced), `${expected}\n`);
    assert.deepEqual(snapshotTree(realOut), before, "the render wrote into the real checkout");
  });
});

describe("Case 2 — carrier round-trip on a synthetic provenance-bearing fixture", () => {
  let rendered = "";
  before(() => {
    const root = cloneTemplate(template);
    const dir = writeManifest(
      root,
      "synth",
      fixtureManifest("synth", { commands: { location: "commands/" } }),
    );
    writeFile(
      dir,
      "commands/x.md",
      [
        "---",
        "name: x",
        'description: "Synthetic command carrying provenance"',
        "type: command",
        "metadata:",
        "  provenance:",
        '    version: "1.0.0"',
        '    canonical: "https://example.com/owner/repo"',
        '    feedback: "https://example.com/owner/repo"',
        "---",
        "",
        "Do the synthetic thing.",
        "",
      ].join("\n"),
    );
    render(root, "gemini", "synth");
    rendered = path.join(root, "build", "extensions", "synth", "commands", "x.toml");
  });

  test("Case 2a — provenance-bearing .toml parses as valid TOML", { skip: toml }, () => {
    assert.ok(fs.existsSync(rendered), "renderer did not emit commands/x.toml");
    assert.equal(tomlError(rendered), "");
  });

  test("Case 2b — .toml carries the # crewrig-provenance: comment line", () => {
    const line =
      '# crewrig-provenance: version="1.0.0" canonical="https://example.com/owner/repo" feedback="https://example.com/owner/repo"';
    assert.ok(fs.existsSync(rendered), "renderer did not emit commands/x.toml");
    assert.ok(read(rendered).split("\n").includes(line));
  });

  test("Case 2c — prompt body is free of the provenance comment", { skip: toml }, () => {
    assert.ok(!tomlField(rendered, "prompt").includes("crewrig-provenance"));
  });
});

describe("Case 3 — no-provenance no-op", () => {
  test(
    "Case 3 — no-provenance command renders valid TOML with no carrier comment",
    { skip: toml },
    () => {
      const root = cloneTemplate(template);
      const dir = writeManifest(
        root,
        "plain",
        fixtureManifest("plain", { commands: { location: "commands/" } }),
      );
      writeFile(
        dir,
        "commands/y.md",
        '---\nname: y\ndescription: "Plain command, no provenance"\ntype: command\n---\n\nJust a plain prompt.\n',
      );
      render(root, "gemini", "plain");
      const file = path.join(root, "build", "extensions", "plain", "commands", "y.toml");
      assert.ok(fs.existsSync(file));
      assert.equal(tomlError(file), "");
      assert.ok(!read(file).includes("crewrig-provenance"));
    },
  );
});

test("Case 2/3 sentinel — python3 >= 3.11 is present under CI", () => {
  if (process.env["CI"] !== undefined && process.env["CI"] !== "")
    assert.equal(toml, false, String(toml));
});

describe("Case 4 — Claude render of hello-world yields a NON-EMPTY SKILL.md body", () => {
  test("Case 4 — Claude SKILL.md body is non-empty (empty-prompt bug stays fixed)", () => {
    const root = cloneTemplate(template);
    const out = path.join(root, "plugin-out");
    const res = runEntry(root, "build-claude-plugin.ts", ["hello-world", out]);
    assert.equal(res.status, 0, res.combined);
    const skill = path.join(out, "skills", "hello", "SKILL.md");
    assert.ok(fs.existsSync(skill), "Claude plugin did not emit skills/hello/SKILL.md");
    const text = read(skill);
    const parts = text.split("\n");
    const second = parts.indexOf("---", parts.indexOf("---") + 1);
    const body = parts
      .slice(second + 1)
      .join("")
      .replace(/\s/g, "");
    assert.notEqual(body, "");
    assert.ok(text.includes("This prompt comes from the hello-world extension"));
  });
});

describe("Case 5 — the ONE neutral token is rewritten per target", () => {
  const root = (() => ({ dir: "" }))();
  const withArgs = (args: string[]): Record<string, unknown> =>
    fixtureManifest("mcpfix", { mcpServers: { default: { command: "node", args } } });
  const built = (): string =>
    path.join(root.dir, "build", "extensions", "mcpfix", "gemini-extension.json");
  const args0 = (): unknown =>
    (JSON.parse(read(built())) as { mcpServers: { default: { args: string[] } } }).mcpServers
      .default.args[0];
  before(() => {
    root.dir = cloneTemplate(template);
  });

  test("Case 5a — the ONE neutral token (${extensionRoot}) is rewritten to Gemini's own ${extensionPath} form", () => {
    writeManifest(root.dir, "mcpfix", withArgs(["${extensionRoot}/dist/index.js"]));
    const res = render(root.dir, "gemini", "mcpfix");
    assert.equal(res.status, 0, res.combined);
    assert.equal(args0(), "${extensionPath}/dist/index.js");
  });

  test("Case 5b — declaring a target-specific token (${extensionPath}) directly is a manifest VALIDATION ERROR", () => {
    writeManifest(root.dir, "mcpfix", withArgs(["${extensionPath}/dist/index.js"]));
    const res = render(root.dir, "gemini", "mcpfix");
    assert.notEqual(res.status, 0);
    assert.ok(res.combined.includes("${extensionPath}"), res.combined);
    assert.ok(res.combined.includes("command/args"), res.combined);
  });

  test("Case 5c — a bare form naming no path token at all is passed through verbatim", () => {
    writeManifest(root.dir, "mcpfix", withArgs(["dist/index.js"]));
    render(root.dir, "gemini", "mcpfix");
    assert.equal(args0(), "dist/index.js");
  });

  test("Case 5d — dropping mcpServers omits the key from the built manifest", () => {
    writeManifest(root.dir, "mcpfix", fixtureManifest("mcpfix"));
    render(root.dir, "gemini", "mcpfix");
    assert.equal("mcpServers" in (JSON.parse(read(built())) as object), false);
  });
});

describe("Case 15 — --check leaves no delegated plugin staging dir inside extensions/", () => {
  let root = "";
  let dir = "";
  const strays = (): string[] =>
    ["core", "library", "org"].flatMap((tier) => {
      const base = path.join(root, "extensions", tier);
      return fs.readdirSync(base).flatMap((name) =>
        fs.statSync(path.join(base, name)).isDirectory()
          ? fs
              .readdirSync(path.join(base, name), { withFileTypes: true })
              .filter((e) => e.isDirectory() && /^dist-.*-plugin$/.test(e.name))
              .map((e) => `${tier}/${name}/${e.name}`)
          : [],
      );
    });
  before(() => {
    root = cloneTemplate(template);
    dir = writeManifest(root, "pluginstray", fixtureManifest("pluginstray"));
    assert.ok(fs.existsSync(extDir(root, "pluginstray")));
  });

  test("Case 15a — --check exits 0 and leaves no dist-*-plugin/ under extensions/ at depth 3", () => {
    const res = check(root, "pluginstray");
    assert.equal(res.status, 0, res.combined);
    assert.deepEqual(strays(), []);
  });

  test("Case 15b — an ordinary (non --check) render still leaves the Claude plugin directory in place", () => {
    const res = render(root, "claude", "pluginstray");
    assert.equal(res.status, 0, res.combined);
    assert.ok(
      fs.existsSync(
        path.join(dir, "dist-claude-plugin", "pluginstray", ".claude-plugin", "plugin.json"),
      ),
    );
  });
});
