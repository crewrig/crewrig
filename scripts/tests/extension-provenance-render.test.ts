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

  // R6, R10, ledger #961 i1-F4: a carrier authored in a skill, an agent or the context file
  // never reaches a rendered copy, and nothing depends on a source carrier existing.
  const STALE =
    '<!-- crewrig-provenance: extension="hello-world" version="1.0.0" canonical="https://stale" feedback="https://stale" -->';
  const SKILL = "skills/greeter/SKILL.md";
  const AGENT_SRC = "agents/reference-guide/AGENT.md";
  const dropCarrier = (text: string): string =>
    text
      .split("\n")
      .filter((l) => !l.includes("crewrig-provenance"))
      .join("\n");
  const afterFrontmatter = (text: string): string => {
    const end = text.indexOf("\n---\n", 4) + "\n---\n".length;
    return `${text.slice(0, end)}${STALE}\n${text.slice(end)}`;
  };
  const stripped = (): Record<string, string> => {
    const files: Record<string, string> = { ...realHelloWorld() };
    for (const rel of [SKILL, AGENT_SRC]) files[rel] = dropCarrier(files[rel]!);
    return files;
  };
  const staleTree = (): Record<string, string> => {
    const files = stripped();
    for (const rel of [SKILL, AGENT_SRC]) files[rel] = afterFrontmatter(files[rel]!);
    files["CONTEXT.md"] = `${STALE}\n${files["CONTEXT.md"]!}`;
    return files;
  };
  const agentCopy = {
    gemini: "agents/reference-guide/AGENT.md",
    claude: "agents/reference-guide.md",
    copilot: "agents/reference-guide.agent.md",
    antigravity: "agents/reference-guide.md",
  } as const;
  const contextCopy = {
    gemini: "GEMINI.md",
    claude: "CLAUDE.md",
    copilot: "skills/hello-world-context/SKILL.md",
    antigravity: "rules/AGENTS.md",
  } as const;

  it("a stale source carrier leaves no trace in any rendered copy", async () => {
    const files = staleTree();
    assert.ok(files[SKILL]!.includes("1.0.0"), "fixture carries the stale value");
    assert.ok(files[AGENT_SRC]!.includes("1.0.0"), "fixture carries the stale value");
    assert.ok(files["CONTEXT.md"]!.includes("1.0.0"), "fixture carries the stale value");
    const clean = await render(stripped());
    const stale = await render(files);
    assert.equal(clean.status, 0, clean.err.join("\n"));
    assert.equal(stale.status, 0, stale.err.join("\n"));
    for (const target of TARGETS) {
      const cleanRoot = clean.roots[target]!;
      const staleRoot = stale.roots[target]!;
      // Skill and agent copies: byte identity with a render that never had a carrier.
      for (const rel of [SKILL, agentCopy[target]]) {
        const text = read(staleRoot, rel);
        assert.equal(text, read(cleanRoot, rel), `${target}/${rel}: byte-identical`);
        assert.equal(count(text), 1, `${target}/${rel}: one marker`);
        assert.ok(text.split("\n").includes(HTML), `${target}/${rel}: exact marker`);
      }
      // Context copy: exactly one marker and no stale byte (the line position may differ).
      const context = read(staleRoot, contextCopy[target]);
      assert.equal(count(context), 1, `${target}/${contextCopy[target]}: one marker`);
      assert.ok(context.split("\n").includes(HTML), `${target}/${contextCopy[target]}: marker`);
      assert.ok(
        !context.includes("1.0.0") && !context.includes("stale"),
        `${target}/${contextCopy[target]}: no stale byte`,
      );
    }
  });

  it("pins the raw gemini CONTEXT.md passthrough, which gemini does not load", async () => {
    // The Gemini build tree ships the source CONTEXT.md as a raw copy next to GEMINI.md (the
    // file gemini loads). Rendering never stamps it, so a carrier authored there survives
    // verbatim. Spec 0316 R6 does not reach this copy; it is a known, unloaded passthrough.
    const stale = await render(staleTree());
    const clean = await render(stripped());
    const raw = read(stale.roots.gemini!, "CONTEXT.md");
    assert.ok(raw.split("\n").includes(STALE), "the stale line survives in the raw copy");
    assert.equal(count(raw), 1);
    assert.ok(!count(read(clean.roots.gemini!, "CONTEXT.md")), "a clean render has none");
    assert.ok(
      !read(stale.roots.gemini!, "GEMINI.md").includes("stale"),
      "the loaded copy is clean",
    );
  });
});
