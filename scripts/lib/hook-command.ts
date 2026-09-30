// hook-command.ts — the single source of the direct `node` command line each
// CLI receives for a hook or a status line (spec 0243 R16-R18).
//
// Standard library only (spec 0240 R16). The module is pure: it takes the
// platform as a parameter so the Windows shapes are testable on any host, and
// it never reads `docs/cli-matrix.md` — the measured Windows surfaces are the
// `MEASURED_SURFACES` constant below, and a test that does read the matrix
// keeps the two in step (R18).

import { resolveReal } from "./paths.ts";
import type { WiredCli } from "./hook-descriptor.ts";

/** Every CLI a command line can be produced for. */
export type Cli = WiredCli | "antigravity";
/** The configuration surface the command line is written into. */
export type Surface = "hooks" | "statusline";
/** The interpreter a CLI hands a Windows command line to (rows 37-37e). */
export type Interpreter = "git-bash" | "powershell-5.1" | "cmd.exe";
/** The quoting rule that interpreter applies (row 37b). */
export type Quoting = "posix" | "powershell" | "cmd";

export interface MeasuredSurface {
  readonly cli: Cli;
  readonly surface: Surface;
  readonly os: "win32";
  readonly interpreter: Interpreter;
  readonly quoting: Quoting;
  /** `conforming` when interpreter and quoting equal row 37b's, else `contradicting`. */
  readonly status: "conforming" | "contradicting";
  /**
   * How the interpreter finds a bare `node`. `cwd-first` means it searches the
   * current directory before `PATH` (`cmd.exe`, CWE-427), so a repository
   * holding `node.cmd` would run instead of Node.js: the module writes no
   * command line for such a surface. Absent means `path-only`.
   */
  readonly interpreterLookup?: "path-only" | "cwd-first";
}

/**
 * One entry per measured (CLI, surface, operating system) triple (R18): the
 * four hooks-surface Windows triples of rows 37-37d and the Antigravity
 * `statusline` triple of row 37e (#1389). The latter is conforming to row 37b
 * but flagged `cwd-first`: `cmd.exe` resolves a bare `node` from the working
 * directory first, which a repository can hijack (security review finding 1,
 * spec 0243 delta-02), so the module refuses it until #1392 settles a form.
 *
 * Row 37e carries `[measured: interpreter=<v>; quoting=<v>]` with the same
 * tokens as `interpreter` and `quoting` here; a test compares them.
 */
export const MEASURED_SURFACES: readonly MeasuredSurface[] = [
  {
    cli: "claude",
    surface: "hooks",
    os: "win32",
    interpreter: "git-bash",
    quoting: "posix",
    status: "conforming",
  },
  {
    cli: "gemini",
    surface: "hooks",
    os: "win32",
    interpreter: "powershell-5.1",
    quoting: "powershell",
    status: "conforming",
  },
  {
    cli: "copilot",
    surface: "hooks",
    os: "win32",
    interpreter: "powershell-5.1",
    quoting: "powershell",
    status: "conforming",
  },
  {
    cli: "antigravity",
    surface: "hooks",
    os: "win32",
    interpreter: "cmd.exe",
    quoting: "cmd",
    status: "conforming",
  },
  {
    cli: "antigravity",
    surface: "statusline",
    os: "win32",
    interpreter: "cmd.exe",
    quoting: "cmd",
    status: "conforming",
    interpreterLookup: "cwd-first",
  },
];

export interface HookCommandRequest {
  readonly cli: Cli;
  readonly surface: Surface;
  readonly platform: NodeJS.Platform;
  /** Absolute path of the entry script; the caller passes a physical path (`physicalPath`). */
  readonly scriptPath: string;
  /** Positional arguments after the script, e.g. `["claude-code", "Stop"]`. */
  readonly args: readonly string[];
}

export type HookCommandResult =
  | { readonly ok: true; readonly command: string }
  | { readonly ok: false; readonly refusal: string };

const ARG_RE = /^[A-Za-z0-9._-]+$/;
const CMD_UNSAFE = /[\s&|<>^%()]/;
/** PowerShell reads the typographic double quotes U+201C, U+201D, U+201E as string delimiters. */
const POWERSHELL_UNSAFE = /[\u201C\u201D\u201E]/;

function findSurface(
  measured: readonly MeasuredSurface[],
  cli: Cli,
  surface: Surface,
): MeasuredSurface | undefined {
  return measured.find((m) => m.cli === cli && m.surface === surface && m.os === "win32");
}

function describeChar(ch: string): string {
  if (ch === "\n") return "a newline";
  if (ch === "\r") return "a carriage return";
  if (/\s/.test(ch)) return "whitespace";
  return `'${ch}'`;
}

/** The physical (symlink-resolved) path of an existing entry script. */
export function physicalPath(scriptPath: string): string {
  return resolveReal(scriptPath);
}

/**
 * Build the direct command line for one CLI and surface, or refuse.
 *
 * Refusal order (R17): the surface diagnostic of R18 comes first because it
 * concerns the surface and precedes any judgement of the path.
 */
export function hookCommandLine(
  request: HookCommandRequest,
  measuredSurfaces: readonly MeasuredSurface[] = MEASURED_SURFACES,
): HookCommandResult {
  const { cli, surface, platform, args } = request;
  const windows = platform === "win32";

  let cmdExe = false;
  let powershell = false;
  if (windows) {
    const measured = findSurface(measuredSurfaces, cli, surface);
    if (measured === undefined) {
      return {
        ok: false,
        refusal: `${cli} ${surface} on Windows is unmeasured: no row of docs/cli-matrix.md records how ${cli} parses a ${surface === "statusline" ? "statusLine.command" : "hook command line"} there, so no command line is written for it.`,
      };
    }
    if (measured.status === "contradicting") {
      return {
        ok: false,
        refusal: `${cli} ${surface} on Windows is measured as interpreter ${measured.interpreter} with ${measured.quoting} quoting, which contradicts the shape this tool writes; no command line is written until a spec 0243 delta sets its shape.`,
      };
    }
    // Precedes the path diagnostics (R17): whatever the path, the form is unsafe.
    if (measured.interpreterLookup === "cwd-first") {
      return {
        ok: false,
        refusal: `${cli} ${surface} on Windows runs its command through ${measured.interpreter}, which looks a bare 'node' up in the current directory before PATH (CWE-427): a repository holding node.cmd, node.bat or node.exe would run instead of Node.js. No command line is written until #1392 settles a form that does not depend on that lookup.`,
      };
    }
    cmdExe = measured.interpreter === "cmd.exe";
    powershell = measured.quoting === "powershell";
  }

  const script = windows ? request.scriptPath.replaceAll("\\", "/") : request.scriptPath;
  for (const ch of script) {
    // A remaining backslash can only sit in a POSIX path, where a POSIX shell
    // would collapse `\\` inside double quotes: refuse it (v1-F1, #1174 S3).
    const unsafe =
      ch === '"' ||
      ch === "$" ||
      ch === "`" ||
      ch === "\n" ||
      ch === "\r" ||
      ch === "\\" ||
      (cmdExe && CMD_UNSAFE.test(ch)) ||
      (powershell && POWERSHELL_UNSAFE.test(ch));
    if (unsafe) {
      return {
        ok: false,
        refusal: `the checkout path ${script} contains ${describeChar(ch)}, which ${cmdExe ? "cmd.exe" : powershell ? "PowerShell" : "the hook's shell"} would read as syntax; move the checkout to a path without it.`,
      };
    }
  }
  for (const arg of args) {
    if (!ARG_RE.test(arg)) {
      return { ok: false, refusal: `the hook argument '${arg}' is not a plain word.` };
    }
  }

  const path = cmdExe ? script : `"${script}"`;
  return { ok: true, command: ["node", path, ...args].join(" ") };
}
