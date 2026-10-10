// setup-golden-common.ts — what the golden runner shares across the four shell setups (spec 0256,
// plan v2 step A4): the real tools to expose on the sandbox PATH, the default fzf answers per CLI
// (every question the shell asks, answered with its FIRST option, which is the shell default) and
// the stub options that let a run complete. Types come from setup-golden-types.ts only.
// API: commonTools, defaultAnswers(cli), baseStubs(cli), exposeTools(sb, tools).

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { Cli } from "./setup-golden-types.ts";
import type { SetupSandbox } from "./setup-sandbox.ts";
import type { StubOptions } from "./setup-stubs.ts";

/** Real tools the shells call, linked into the sandbox bin (a missing one is skipped). */
export const commonTools: readonly string[] = (
  "jq git diff ls sort uniq tee touch stat realpath sha256sum shasum comm paste od " +
  "expr dd tty mv rmdir tac rev hostname whoami"
).split(" ");

// Header substring -> first option. The catalogue picker has no header: the stub keys it on the
// `--preview` command, which names the catalogue directory.
const shared: Record<string, string> = {
  "config/teams": "ATLAS",
  "config/expertise": "BACKEND-JAVA",
  "config/level": "CONFIRMED",
  "Validation backend?": "internal",
  "Translate the spec/plan": "off",
  "Pedagogy level": "contextual",
  "Generate illustrations": "off",
  "Configure the framework's tools to trust": "no",
  "MemPalace not found": "no",
  "Enable automatic session recording": "no",
  "How to resolve?": "keep-local",
  Existing: "keep",
};

const perCli: Record<Cli, Record<string, string>> = {
  claude: {
    "Install Sequential Thinking MCP server?": "yes",
    "Remove legacy ~/.claude/mcp.json": "no",
    "Install default settings.json?": "yes",
    "components to ~/.claude/skills": "no",
    "Capture token usage for Claude Code?": "no",
    "Usage capture is registered for Claude Code": "keep",
  },
  gemini: {
    "components to ~/.gemini/skills": "no",
    "Capture token usage for Gemini CLI?": "no",
    "Usage capture is registered for Gemini CLI": "keep",
  },
  copilot: {
    "skills to ~/.copilot": "no",
    "Capture token usage for Copilot CLI?": "no",
    "Usage capture is registered for Copilot CLI": "keep",
  },
  antigravity: {
    "Include SequentialThinking MCP server": "yes",
    "components to ~/.gemini/config/skills": "no",
    "Enable Antigravity CLI usage capture": "no",
    "Antigravity usage capture is installed": "keep",
  },
};

/** The default (first-option) answers for every fzf question `cli`'s shell setup can ask. */
export function defaultAnswers(cli: Cli): Record<string, string> {
  return { ...shared, ...perCli[cli] };
}

/** Stub options that let a default-answer run complete (see the smoke test for the proof). */
export function baseStubs(cli: Cli): StubOptions {
  return { fzf: defaultAnswers(cli) };
}

function lookup(name: string): string | undefined {
  for (const dir of [...(process.env["PATH"] ?? "").split(path.delimiter), "/usr/bin", "/bin"]) {
    if (!path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, name);
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep scanning
    }
  }
  return undefined;
}

/** Link each real tool into the sandbox bin unless a stub or an earlier link already holds the name. */
export function exposeTools(sb: SetupSandbox, tools: readonly string[]): void {
  for (const tool of tools) {
    const target = path.join(sb.bin, tool);
    if (fs.existsSync(target)) continue;
    const found = lookup(tool);
    if (found !== undefined) fs.symlinkSync(found, target);
  }
}

/**
 * The pipx layout `detect_mempalace_python` looks at first on Linux: a venv whose `python` is the
 * python3 stub (so `import mempalace.mcp_server` and the version probes answer like the stub) and
 * a `chroma` beside it, which `_materialise_chroma_unit` demands as `dirname(python)/chroma`.
 * Call after `installStubs`.
 */
export function seedMempalaceVenv(sb: SetupSandbox): void {
  const venvBin = path.join(sb.home, ".local/share/pipx/venvs/mempalace/bin");
  fs.mkdirSync(venvBin, { recursive: true });
  fs.copyFileSync(path.join(sb.bin, "python3"), path.join(venvBin, "python"));
  fs.chmodSync(path.join(venvBin, "python"), 0o755);
  fs.writeFileSync(path.join(venvBin, "chroma"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
}

/**
 * `install_chroma_daemon` polls `GET /api/v2/heartbeat` over real HTTP (status-chroma-server.ts), which
 * a PATH stub cannot answer, so a loopback server runs in a child process (the sandbox run is
 * synchronous). Pass `{ MEMPALACE_CHROMA_PORT: String(port) }` as the run environment.
 */
export async function startChromaHeartbeat(): Promise<{ port: number; stop(): void }> {
  const script =
    "const s=require('node:http').createServer((q,r)=>{r.statusCode=q.url==='/api/v2/heartbeat'?200:404;r.end('{}')});" +
    "s.listen(0,'127.0.0.1',()=>console.log(s.address().port))";
  const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "ignore"] });
  const port = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.stdout.once("data", (chunk: Buffer) => resolve(Number(chunk.toString().trim())));
  });
  return { port, stop: () => void child.kill() };
}
