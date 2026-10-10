// doctor-fixture.ts — the isolated-HOME fixtures shared by the doctor-sections tests
// (spec 0252 requirements 20, 22, 24): the checkout, the temporary root, the two entries.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";

export const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
export const posix = process.platform !== "win32";
export const root = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-doctor-sections-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

export const FOURTH = "4. Background service mechanism";
export const MCP_TASK = "\\CrewRig\\mempalace-mcp-server";
export const CHROMA_TASK = "\\CrewRig\\mempalace-chroma-server";

export function home(name: string, claudeJson?: unknown): string {
  const dir = fs.mkdtempSync(path.join(root, `${name}-`));
  if (claudeJson !== undefined) {
    fs.writeFileSync(path.join(dir, ".claude.json"), JSON.stringify(claudeJson));
  }
  return dir;
}

export function isolatedEnv(h: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: h, USERPROFILE: h };
  for (const k of Object.keys(env)) if (k.startsWith("MEMPALACE_MCP_")) delete env[k];
  env["MEMPALACE_MCP_PORT"] = "9"; // nothing listens: the daemon-conflict probe fails
  return env;
}

function runProcess(
  command: string,
  args: string[],
  h: string,
): { status: number | null; out: string } {
  const r = spawnSync(command, args, {
    cwd: REPO,
    env: isolatedEnv(h),
    encoding: "utf8",
    timeout: 120_000,
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

export const entries: Array<
  [string, (h: string) => { status: number | null; out: string }, string | false]
> = [
  [
    "TypeScript entry",
    (h) => runProcess(process.execPath, ["scripts/doctor-mempalace.ts"], h),
    false,
  ],
  [
    "bash shim",
    (h) => runProcess("bash", ["scripts/doctor-mempalace.sh"], h),
    !posix && "bash shims are POSIX-only",
  ],
];
