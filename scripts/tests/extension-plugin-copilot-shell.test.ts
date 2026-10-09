// extension-plugin-copilot-shell.test.ts — the Copilot renderer against the real
// `bash scripts/build-copilot-plugin.sh` (spec 0254 R28): `diff -r` of the two output trees and a
// comparison of stdout over three fixtures. Linux and macOS only; needs jq and yq.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { buildCopilotPlugin } from "../lib/extension/plugin-copilot.ts";
import { REPO } from "./lib/build-fixture-tree.ts";
import { fullExtension, makeCtx, tmpRoot, writeTree } from "./lib/plugin-ctx.ts";

const have = (cmd: string): boolean => spawnSync("which", [cmd]).status === 0;
const skip = process.platform === "win32" || !have("jq") || !have("yq");

const clean = fullExtension();
clean["CONTEXT.md"] = "# ${TOOL} demo\nUse ${COMMAND:greet} and ${SKILL:helper}.\n";

const FIXTURES: ReadonlyArray<readonly [string, Record<string, string>]> = [
  ["full extension", clean],
  [
    "bare extension",
    { "extension.json": JSON.stringify({ name: "b", version: "0.1.0", description: "x" }) },
  ],
  [
    "skills, flat agents and hooks without commands",
    {
      "extension.json": JSON.stringify({
        name: "s",
        version: "2.0.0",
        description: "skills",
        skills: { location: "skills/" },
        agents: { location: "agents/" },
        hooks: [{ id: "h", event: "PreToolUse", command: "${extensionRoot}/hooks/h.sh" }],
      }),
      "skills/one/SKILL.md": "one\n",
      "skills/two/SKILL.md": "two\n",
      "agents/a.md": "a\n",
      "agents/b/AGENT.md": "b\n",
      "hooks/h.sh": "#!/bin/sh\n",
    },
  ],
  [
    "agent directory without AGENT.md",
    {
      "extension.json": JSON.stringify({
        name: "n",
        version: "1.0.0",
        description: "agents",
        agents: { location: "agents/" },
      }),
      "agents/a/AGENT.md": "a\n",
      "agents/b/notes.txt": "no agent file\n",
      "agents/c/AGENT.md": "c\n",
    },
  ],
  ["context diagnostic", fullExtension()],
];

describe("Copilot renderer against the shell", { skip }, () => {
  for (const [label, files] of FIXTURES) {
    test(label, () => {
      const root = tmpRoot();
      const ext = path.join(root, "ext");
      writeTree(ext, files);
      const shellOut = path.join(root, "shell-out");
      const tsOut = path.join(root, "ts-out");
      const shell = spawnSync("bash", ["scripts/build-copilot-plugin.sh", ext, shellOut], {
        cwd: REPO,
        encoding: "utf8",
      });
      const repo = path.join(root, "repo");
      fs.mkdirSync(repo);
      const cap = makeCtx(repo);
      const status = buildCopilotPlugin(cap.ctx, ext, tsOut);
      assert.equal(status, shell.status, shell.stderr);
      const norm = (text: string, out: string): string => text.split(out).join("<OUT>");
      assert.equal(
        norm(cap.out.map((l) => `${l}\n`).join(""), tsOut),
        norm(shell.stdout, shellOut),
      );
      const diff = spawnSync("diff", ["-r", shellOut, tsOut], { encoding: "utf8" });
      assert.equal(diff.status, 0, diff.stdout);
    });
  }
});
