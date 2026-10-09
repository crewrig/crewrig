// extension-trees.ts — whole extension source trees for the build proofs (spec 0254 R22, R23).
//
// The golden tree, the shell/TypeScript differential test and the `windows-latest` proof all
// build the same subjects, so the subjects live here once: a map from a relative path to the
// text of the file, written by `writeTree`. `realHelloWorld` reads the tracked files of the
// real extension (a checkout may carry an untracked `node_modules` inside it, which the build
// would copy).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type FileMap = Readonly<Record<string, string>>;

const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
const lines = (...rows: string[]): string => `${rows.join("\n")}\n`;
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** Write `files` under `dir`; a `hooks/*.sh` or `bin/*` file is made executable. */
export function writeTree(dir: string, files: FileMap): void {
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    if (/^(hooks|bin)\//.test(rel)) fs.chmodSync(file, 0o755);
  }
}

/** The tracked files of `extensions/core/hello-world` (the real extension), as a map. */
export function realHelloWorld(): FileMap {
  const base = "extensions/core/hello-world";
  const listed = spawnSync("git", ["ls-files", "-z", "--", base], { cwd: REPO, encoding: "utf8" });
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`);
  const out: Record<string, string> = {};
  for (const rel of listed.stdout.split("\0").filter(Boolean)) {
    out[rel.slice(base.length + 1)] = fs.readFileSync(path.join(REPO, rel), "utf8");
  }
  return out;
}

const command = (name: string | null, description: string, body: string): string =>
  lines(
    "---",
    ...(name === null ? [] : [`name: ${name}`]),
    `description: "${description}"`,
    "---",
    "",
    body,
  );

const CONTEXT = lines(
  "# ${EXTENSION} for ${TOOL}",
  "",
  "Run ${COMMAND:hello} or load ${SKILL:alpha}.",
  "${ONLY:claude,gemini}Only on Claude and Gemini.${ENDONLY}",
  "${EXCEPT:copilot}Everywhere but Copilot.${ENDEXCEPT}",
  "Literal: $${TOOL}, ${extensionPath} and ${NEARMISS}.",
  "${ONLY:antigravity}",
  "Antigravity-only block",
  "${ENDONLY}",
  "Last line",
);

const GAP = {
  subject: "hooks",
  target: "antigravity",
  hook: "prompt",
  event: "UserPromptSubmit",
  part: "event",
  reason: "neutral event has no counterpart on this target",
};

/** Every subject, every transport, both hook shapes, a gap, a context with every construct. */
export function fullTree(): FileMap {
  return {
    "extension.json": json({
      name: "full",
      version: "1.2.3",
      description: 'Full fixture "quoted" é',
      mcpServers: {
        local: {
          command: "node",
          args: ["${extensionRoot}/dist/index.js"],
          env: { K: "V", "10": "ten" },
          cwd: "${extensionRoot}",
          timeout: 30,
        },
        remote: {
          transport: "http",
          url: "https://example.test/mcp",
          headers: { A: "B" },
          timeout: 7,
        },
        stream: { transport: "sse", url: "https://example.test/sse" },
      },
      commands: { location: "commands/", convertToSkills: true },
      skills: { location: "skills/" },
      agents: { location: "agents/" },
      context: { source: "CONTEXT.md" },
      hooks: [
        {
          id: "shell",
          event: "PreToolUse",
          matcher: "shell",
          command: "bash ${extensionRoot}/hooks/h.sh ${extensionRoot}/x",
        },
        { id: "any", event: "PreToolUse", command: "bash ${extensionRoot}/hooks/h.sh" },
        { id: "prompt", event: "UserPromptSubmit", command: "bash ${extensionRoot}/hooks/h.sh" },
      ],
      gemini: { themes: [{ name: "dark", background: "#000" }] },
      claude: {
        author: { name: "Fixture Author" },
        defaultAllowedTools: ["Read", "Bash"],
        settings: { a: 1, "10": 2 },
        lsp: { srv: { command: "srv" } },
        bin: "bin/",
      },
    }),
    "accepted-gaps.json": json([GAP]),
    "package.json": json({ name: "full", version: "1.2.3", type: "module" }),
    "dist/index.js": "console.log('full');\n",
    "CONTEXT.md": CONTEXT,
    "commands/hello.md": command("hello", "Say hello", "Say hello from the fixture."),
    "commands/second.md": command("second", "Second", "Second body.\n\n---\n\nAfter a rule."),
    "commands/nameless.md": command(null, "No name", "No name here."),
    "skills/alpha/SKILL.md": lines(
      "---",
      "name: alpha",
      'description: "Alpha"',
      "---",
      "",
      "Alpha.",
    ),
    "skills/alpha/ref.md": "Reference.\n",
    "skills/beta/SKILL.md": lines("---", "name: beta", 'description: "Beta"', "---", "", "Beta."),
    "agents/nested/AGENT.md": lines(
      "---",
      "name: nested",
      'description: "Nested"',
      "---",
      "",
      "Nested agent.",
    ),
    "agents/nested/PROMPT.md": "Sibling file.\n",
    "agents/flat.md": lines("---", "name: flat", 'description: "Flat"', "---", "", "Flat agent."),
    "hooks/h.sh": "#!/bin/sh\nexit 0\n",
    "bin/tool.sh": "#!/bin/sh\necho tool\n",
    ".releaserc.json": json({ debris: true }),
  };
}

/** The smallest extension that builds. */
export function minimalTree(): FileMap {
  return { "extension.json": json({ name: "minimal", version: "0.0.1", description: "Minimal" }) };
}

/** Servers only, no other subject. */
export function mcpOnlyTree(): FileMap {
  return {
    "extension.json": json({
      name: "mcponly",
      version: "0.1.0",
      description: "MCP only",
      mcpServers: { s: { command: "node", args: ["${extensionRoot}/dist/s.js"] } },
    }),
    "dist/s.js": "// s\n",
    "package.json": json({ name: "mcponly", version: "0.1.0" }),
  };
}

/** A context source that fails (an unclosed span): every renderer must leave no context file. */
export function contextFailTree(): FileMap {
  return {
    "extension.json": json({
      name: "ctxfail",
      version: "1.0.0",
      description: "Context failure",
      context: { source: "CONTEXT.md" },
    }),
    "CONTEXT.md": "Before\n${ONLY:copilot}never closed\n",
  };
}

/** A manifest the validators refuse (an unknown hook event). */
export function invalidTree(): FileMap {
  return {
    "extension.json": json({
      name: "invalid",
      version: "1.0.0",
      description: "Invalid",
      hooks: [{ id: "x", event: "Bogus", command: "c" }],
    }),
  };
}

/** The retired declaration shape: a `components` object, a retired per-CLI key, a committed output. */
export function legacyTree(): FileMap {
  return {
    "extension.json": json({
      name: "legacy",
      version: "1.0.0",
      description: "Legacy",
      components: {
        commands: { enabled: true, location: "commands/" },
        skills: { enabled: false },
        hooks: { enabled: true },
      },
      claude: { skills: "x", author: { name: "A" } },
      copilot: { pluginName: "p" },
    }),
    "CLAUDE.md": "committed output\n",
    "commands/hello.md": command("hello", "Hi", "Hi."),
  };
}

/** A source tree that commits a generated output and a file named for a CLI. */
export function strayTree(): FileMap {
  return {
    "extension.json": json({ name: "stray", version: "1.0.0", description: "Stray" }),
    "gemini-extension.json": "{}\n",
    "GEMINI.md": "named for a tool\n",
  };
}

/** A version that disagrees between `package.json` and `extension.json`. */
export function versionDriftTree(): FileMap {
  return {
    "extension.json": json({ name: "drift", version: "1.0.0", description: "Drift" }),
    "package.json": json({ name: "drift", version: "9.9.9" }),
  };
}

/** The subjects the golden tree and the differential test build, by directory name. */
export function buildSubjects(): Readonly<Record<string, FileMap>> {
  return {
    "hello-world": realHelloWorld(),
    full: fullTree(),
    minimal: minimalTree(),
    mcponly: mcpOnlyTree(),
  };
}
