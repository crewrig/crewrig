// real-home-guard.ts — fingerprint of the files a setup writes in the REAL home (read-only; same
// file set as the shell reference real-home-check.sh). `home` defaults to the account home, never
// process.env.HOME, which a sandbox rewrites.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dirs = [".claude/rules", ".claude/skills", ".claude/agents", ".gemini/antigravity-cli"];
dirs.push(".gemini/config", ".copilot/instructions", ".copilot/hooks", ".crewrig/system-context");
const files = [".claude/settings.json", ".gemini/settings.json", ".gemini/GEMINI.md"];
files.push(".copilot/mcp-config.json", ".crewrig/tls-env.sh", ".crewrig/validation.conf");
files.push(".crewrig/tls-exec.sh");

const sha = (f: string): string => {
  try {
    return createHash("sha256").update(fs.readFileSync(f)).digest("hex");
  } catch {
    return "unreadable";
  }
};

// ~/.claude.json is rewritten constantly by Claude Code itself: only its MCP server list is a setup
// effect, so that is what is fingerprinted.
function mcpServersSha(f: string): string {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(f, "utf8"));
    const servers: unknown =
      typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "mcpServers") : null;
    return createHash("sha256")
      .update(JSON.stringify(servers ?? null))
      .digest("hex");
  } catch {
    return fs.existsSync(f) ? "unreadable" : "absent";
  }
}

function walk(dir: string, out: Map<string, string>): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    // The Antigravity language server logs here on its own schedule, unrelated to a setup.
    if (e.name === "log" || e.name === "cli.log") continue;
    if (e.isDirectory()) walk(full, out);
    else out.set(full, e.isSymbolicLink() ? `link ${fs.readlinkSync(full)}` : sha(full));
  }
}

function fingerprint(home: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rel of dirs) if (fs.existsSync(path.join(home, rel))) walk(path.join(home, rel), out);
  for (const rel of files) {
    const f = path.join(home, rel);
    out.set(f, fs.existsSync(f) ? sha(f) : "absent");
  }
  out.set(path.join(home, ".claude.json"), mcpServersSha(path.join(home, ".claude.json")));
  for (const top of [".claude", ".gemini", ".copilot", ".crewrig"]) {
    const dir = path.join(home, top);
    if (!fs.existsSync(dir)) continue;
    for (const n of fs.readdirSync(dir)) {
      if (/\.bak\.|^\.selected_/.test(n)) out.set(path.join(dir, n), sha(path.join(dir, n)));
    }
  }
  return out;
}

/** Fingerprint now; `assertUnchanged` throws listing added, removed and changed paths. `home` is for tests. */
export function realHomeGuard(home: string = os.userInfo().homedir): { assertUnchanged(): void } {
  const before = fingerprint(home);
  return {
    assertUnchanged() {
      const now = fingerprint(home);
      const diff = [...before].flatMap(([f, s]) =>
        !now.has(f) ? [`- removed ${f}`] : now.get(f) !== s ? [`~ changed ${f}`] : [],
      );
      for (const f of now.keys()) if (!before.has(f)) diff.push(`+ added ${f}`);
      if (diff.length > 0) throw new Error(`real home ${home} was modified:\n${diff.join("\n")}`);
    },
  };
}
