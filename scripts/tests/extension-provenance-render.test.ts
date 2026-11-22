// extension-provenance-render.test.ts — render-time provenance stamping of the extension
// renderers (spec 0316 R5, R9, R10): the exact marker bytes per kind and per CLI, the sidecar,
// and a source tree that stays untouched.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { renderExtension } from "../lib/extension/render-extension.ts";
import { TARGETS } from "../lib/extension/types.ts";
import { realHelloWorld, writeTree } from "./lib/extension-trees.ts";
import type { FileMap } from "./lib/extension-trees.ts";
import { makeCtx, tmpRoot } from "./lib/plugin-ctx.ts";

const FIELDS =
  'package="hello-world-extension" extension="hello-world" version="2.1.1" canonical="https://github.com/crewrig/crewrig" feedback="https://github.com/crewrig/crewrig"';
const HTML = `<!-- crewrig-provenance: ${FIELDS} -->`;
const HASH = `# crewrig-provenance: ${FIELDS}`;
const YAML = [
  "metadata:",
  "  provenance:",
  '    package: "hello-world-extension"',
  '    extension: "hello-world"',
  '    version: "2.1.1"',
  '    canonical: "https://github.com/crewrig/crewrig"',
  '    feedback: "https://github.com/crewrig/crewrig"',
].join("\n");

function digest(dir: string): string {
  const h = createHash("sha256");
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d).sort()) {
      const full = path.join(d, e);
      if (fs.statSync(full).isDirectory()) {
        if (e === "node_modules" || e.startsWith("dist-")) continue;
        walk(full);
      } else h.update(`${path.relative(dir, full)}\0${fs.readFileSync(full)}\0`);
    }
  };
  walk(dir);
  return h.digest("hex");
}

interface Rendered {
  readonly repo: string;
  readonly extDir: string;
  readonly roots: Readonly<Record<string, string>>;
  readonly status: number;
  readonly err: string[];
}

async function render(files: FileMap, tier = "core", name = "hello-world"): Promise<Rendered> {
  const repo = tmpRoot();
  const extDir = path.join(repo, "extensions", tier, name);
  writeTree(extDir, files);
  const { ctx, err } = makeCtx(repo);
  const status = await renderExtension(ctx, extDir, TARGETS);
  const roots = {
    gemini: path.join(repo, "build", "extensions", name),
    claude: path.join(extDir, "dist-claude-plugin", name),
    copilot: path.join(repo, "dist-copilot-plugin", name),
    antigravity: path.join(repo, "dist-antigravity-plugin", name),
  };
  return { repo, extDir, roots, status, err };
}

const read = (root: string, rel: string): string => fs.readFileSync(path.join(root, rel), "utf8");
const count = (text: string): number => text.split("crewrig-provenance").length - 1;

describe("hello-world render stamps every kind on every CLI", async () => {
  const r = await render(realHelloWorld());

  it("renders without a failure", () => {
    assert.equal(r.status, 0, r.err.join("\n"));
  });

  for (const target of ["gemini", "claude", "copilot", "antigravity"] as const) {
    it(`${target}: skill, agent and context carry one html line`, () => {
      const root = r.roots[target]!;
      const agent =
        target === "gemini"
          ? "agents/reference-guide/AGENT.md"
          : target === "copilot"
            ? "agents/reference-guide.agent.md"
            : "agents/reference-guide.md";
      const context = {
        gemini: "GEMINI.md",
        claude: "CLAUDE.md",
        copilot: "skills/hello-world-context/SKILL.md",
        antigravity: "rules/AGENTS.md",
      }[target];
      for (const rel of ["skills/greeter/SKILL.md", agent, context]) {
        const text = read(root, rel);
        assert.equal(count(text), 1, `${target}/${rel}`);
        assert.ok(text.split("\n").includes(HTML), `${target}/${rel}: exact bytes`);
      }
    });

    it(`${target}: sidecar is byte-exact and ties to the manifest`, () => {
      const root = r.roots[target]!;
      assert.equal(
        read(root, "crewrig-provenance.json"),
        `${JSON.stringify(
          {
            package: "hello-world-extension",
            extension: "hello-world",
            version: "2.1.1",
            canonical: "https://github.com/crewrig/crewrig",
            feedback: "https://github.com/crewrig/crewrig",
          },
          null,
          2,
        )}\n`,
      );
      const manifest = {
        gemini: "gemini-extension.json",
        claude: ".claude-plugin/plugin.json",
        copilot: "plugin.json",
        antigravity: "plugin.json",
      }[target];
      const m = JSON.parse(read(root, manifest)) as { name: string; version: string };
      const s = JSON.parse(read(root, "crewrig-provenance.json")) as {
        extension: string;
        version: string;
      };
      assert.equal(m.name, s.extension);
      assert.equal(m.version, s.version);
    });
  }

  it("gemini command carries the hash line", () => {
    const text = read(r.roots.gemini!, "commands/hello.toml");
    assert.equal(text.split("\n")[0], HASH);
    assert.equal(count(text), 1);
  });

  for (const target of ["claude", "copilot", "antigravity"] as const) {
    it(`${target}: a command converted to a skill carries the YAML block`, () => {
      const text = read(r.roots[target]!, "skills/hello/SKILL.md");
      const frontmatter = text.split("\n---\n")[0]!;
      assert.ok(frontmatter.includes(YAML), `${target}: yaml block in the frontmatter`);
      assert.equal(text.split("provenance:").length - 1, 1);
      assert.equal(count(text), 0);
    });
  }
});

describe("source tree and stale carriers", () => {
  it("leaves the source tree byte-identical", async () => {
    const repo = tmpRoot();
    const extDir = path.join(repo, "extensions", "core", "hello-world");
    writeTree(extDir, realHelloWorld());
    const pre = digest(extDir);
    const { ctx } = makeCtx(repo);
    assert.equal(await renderExtension(ctx, extDir, TARGETS), 0);
    assert.equal(digest(extDir), pre);
  });

  it("a stale source carrier leaves no trace in any copy", async () => {
    const files: Record<string, string> = { ...realHelloWorld() };
    const skill = files["skills/greeter/SKILL.md"]!;
    files["skills/greeter/SKILL.md"] = skill.replace(
      /<!-- crewrig-provenance:.*-->/,
      '<!-- crewrig-provenance: extension="hello-world" version="1.0.0" canonical="https://stale" feedback="https://stale" -->',
    );
    assert.ok(
      files["skills/greeter/SKILL.md"].includes("1.0.0"),
      "fixture carries the stale value",
    );
    const r = await render(files);
    assert.equal(r.status, 0, r.err.join("\n"));
    for (const target of TARGETS) {
      const text = read(r.roots[target]!, "skills/greeter/SKILL.md");
      assert.ok(!text.includes('version="1.0.0"') && !text.includes("stale"), target);
      assert.ok(text.includes(HTML), target);
    }
  });

  it("the interim source carriers agree with the generated marker", () => {
    const files = realHelloWorld();
    for (const rel of ["skills/greeter/SKILL.md", "agents/reference-guide/AGENT.md"]) {
      const line = files[rel]!.split("\n").find((l) => l.includes("crewrig-provenance"));
      if (line === undefined) continue;
      for (const key of ["extension", "version", "canonical", "feedback"]) {
        const wanted = new RegExp(`${key}="[^"]*"`).exec(HTML)![0];
        assert.ok(line.includes(wanted), `${rel}: ${key}`);
      }
    }
  });
});
