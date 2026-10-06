// context.ts — session, project and room of a transcript record (spec 0247
// R9), exactly as hooks/mempalace-transcript.sh:94-126 derived them.
//
// The Git top level is asked of Git itself (issue #92), and only when neither
// the environment nor the payload names a project directory — the one process
// this hook ever spawns (R17). The trust variables read from
// `~/.crewrig/tls-env.sh` reach that process's environment, as the shell's `.`
// made them reach every command it ran (R16).
//
// Standard library only.

import { spawnSync } from "node:child_process";
import path from "node:path";

import { defaultIsFile, resolveOnPath } from "../worktree-claim/launch-windows.ts";
import { firstChars, readField, stripTrailingNewlines } from "./fields.ts";

export interface ContextInput {
  /** In Antigravity mode (R3): the session and project come from the Antigravity payload. */
  readonly antigravity: boolean;
  readonly payload: unknown;
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly platform: NodeJS.Platform;
  /** Variables applied to the Git process's environment (R16). */
  readonly extraEnv: Readonly<Record<string, string>>;
  readonly now: Date;
}

export interface RecordContext {
  readonly sessionId: string;
  readonly projectDir: string;
  readonly projectName: string;
  readonly room: string;
}

/** The first non-empty value, as `${A:-${B:-…}}` picks it. */
function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  for (const value of values) if (value !== undefined && value !== "") return value;
  return undefined;
}

/** `git rev-parse --show-toplevel` run from `cwd`; `undefined` when Git fails or is absent. */
export function gitTopLevel(input: ContextInput): string | undefined {
  // On Windows the name is resolved through PATH only, so a `git.exe` planted
  // in the working directory is never run (as the claim tool does).
  const env: NodeJS.ProcessEnv = { ...input.env, ...input.extraEnv };
  if (input.platform === "win32") env["PATHEXT"] = ".EXE";
  const git = resolveOnPath("git", { platform: input.platform, env, isFile: defaultIsFile });
  if (git === undefined) return undefined;
  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync(git, ["rev-parse", "--show-toplevel"], {
      cwd: input.cwd,
      env,
      encoding: "utf8",
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    // An environment the spawn refuses (a value it cannot pass) yields no top level.
    return undefined;
  }
  if (result.error !== undefined || result.status !== 0) return undefined;
  const top = stripTrailingNewlines(String(result.stdout));
  return top === "" ? undefined : top;
}

/** `basename` of the project directory, reading both separators on Windows. */
export function projectNameOf(dir: string, platform: NodeJS.Platform): string {
  const flavour = platform === "win32" ? path.win32 : path.posix;
  const name = flavour.basename(dir);
  if (name !== "") return name;
  // `basename /` is `/`; a Windows drive root keeps its own spelling.
  return dir.replace(platform === "win32" ? /[\\/]+$/ : /\/+$/, "") || dir.slice(0, 1);
}

/** `date +%Y-%m-%d` in local time. */
export function localDate(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${String(now.getFullYear()).padStart(4, "0")}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function deriveContext(input: ContextInput): RecordContext {
  const { env, payload } = input;
  const sessionId = input.antigravity
    ? (readField(payload, ["conversationId"]) ?? "unknown")
    : (firstNonEmpty(
        env["GEMINI_SESSION_ID"],
        env["CLAUDE_SESSION_ID"],
        env["COPILOT_SESSION_ID"],
        readField(payload, ["session_id"], ["sessionId"]),
      ) ?? "unknown");

  const named = input.antigravity
    ? readField(payload, ["workspacePaths", 0])
    : firstNonEmpty(
        env["GEMINI_PROJECT_DIR"],
        env["CLAUDE_PROJECT_DIR"],
        env["COPILOT_PROJECT_DIR"],
        readField(
          payload,
          ["workspace_dir"],
          ["workspace"],
          ["project_dir"],
          ["projectDir"],
          ["cwd"],
        ),
      );
  const projectDir = named ?? gitTopLevel(input) ?? input.cwd;
  const projectName = projectNameOf(projectDir, input.platform);
  const room = `${projectName}-${localDate(input.now)}-${firstChars(sessionId, 8)}`;
  return { sessionId, projectDir, projectName, room };
}
