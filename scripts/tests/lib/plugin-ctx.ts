// plugin-ctx.ts — an in-memory `ExtCtx` and throwaway extension trees for the plugin renderer
// suites (spec 0254 R11, R17, R18).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";

import { readTargetTable } from "../../lib/extension/descriptors.ts";
import type { ExtCtx } from "../../lib/extension/types.ts";
import { createRenderCommand } from "../../lib/render-command.ts";
import { REPO } from "./build-fixture-tree.ts";
import { yamlText } from "./yaml-lib.ts";

export interface Captured {
  readonly ctx: ExtCtx;
  readonly out: string[];
  readonly err: string[];
}

const libDir = path.join(REPO, "scripts", "lib");

/** A context whose `Io` records lines; `repoDir` is a distinct throwaway directory. */
export function makeCtx(repoDir: string): Captured {
  const out: string[] = [];
  const err: string[] = [];
  const ctx: ExtCtx = {
    repoDir,
    libDir,
    env: {},
    platform: process.platform,
    io: {
      out: (line) => void out.push(line),
      err: (line) => void err.push(line),
      errRaw: (text) => void err.push(text),
    },
    table: readTargetTable(libDir),
    renderCommand: createRenderCommand(yamlText),
    yaml: yamlText,
  };
  return { ctx, out, err };
}

const roots: string[] = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

/** A fresh temporary directory, removed when the importing suite ends. */
export function tmpRoot(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "plugin-")));
  roots.push(root);
  return root;
}

/** Write `files` (relative path to text) under `dir`. */
export function writeTree(dir: string, files: Readonly<Record<string, string>>): void {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
}

/** Every file under `dir` as `relative path -> text`, plus directories as `path/ -> ""`. */
export function readTree(dir: string): Record<string, string> {
  const tree: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
      const next = rel === "" ? name : `${rel}/${name}`;
      if (fs.statSync(path.join(dir, next)).isDirectory()) {
        tree[`${next}/`] = "";
        walk(next);
      } else tree[next] = fs.readFileSync(path.join(dir, next), "utf8");
    }
  };
  walk("");
  return tree;
}

/** A full extension tree exercising every Claude emitter. */
export function fullExtension(): Record<string, string> {
  const manifest = {
    name: "demo",
    version: "1.2.3",
    description: "A demo extension",
    context: { source: "CONTEXT.md" },
    commands: { location: "commands/", convertToSkills: true },
    skills: { location: "skills/" },
    agents: { location: "agents/" },
    hooks: [{ id: "h", event: "PreToolUse", command: "${extensionRoot}/hooks/h.sh" }],
    mcpServers: { srv: { command: "node", args: ["${extensionRoot}/dist/index.js"] } },
    claude: {
      author: { name: "Ada" },
      defaultAllowedTools: ["Read", "Bash(ls)"],
      settings: { permissions: { allow: ["Read"] } },
      lsp: { ts: { command: "tsserver" } },
      bin: "bin/",
    },
  };
  return {
    "extension.json": JSON.stringify(manifest, null, 2),
    "CONTEXT.md":
      "# ${TOOL} demo\nUse ${COMMAND:greet} and ${SKILL:helper}.\nBad ${ONLY:nowhere}x\n",
    "commands/greet.md": "---\nname: greet\ndescription: Say hello\n---\nHello body\n\n",
    "commands/plain.md": "---\ndescription: No name\n---\nPlain body\n",
    "skills/helper/SKILL.md": "---\nname: helper\n---\nhelp\n",
    "skills/helper/extra/note.txt": "note\n",
    "skills/README.md": "not a directory\n",
    "agents/nested/AGENT.md": "nested agent\n",
    "agents/nested/PROMPT.md": "sibling\n",
    "agents/flat.md": "flat agent\n",
    "agents/ignored.txt": "x\n",
    "hooks/h.sh": "#!/bin/sh\n",
    "dist/index.js": "export {};\n",
    "package.json": '{"type":"module"}\n',
    "bin/tool": "#!/bin/sh\n",
  };
}
