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
export type Quoting = "posix" | "powershell" | "cmd-no-grouping";
/**
 * The planted-binary result of spec 0243 R31: a `node.cmd` placed in the
 * surface's working directory ran on every draw and the real `node` on none.
 * The only result recorded so far.
 */
export type PlantedBinaryResult = "planted-runs";

export interface MeasuredSurface {
  readonly cli: Cli;
  readonly surface: Surface;
  readonly os: "win32";
  readonly interpreter: Interpreter;
  readonly quoting: Quoting;
  /** `conforming` when interpreter and quoting equal row 37b's, else `contradicting`. */
  readonly status: "conforming" | "contradicting";
  /**
   * The planted-binary result (R31). Required of a Windows `statusline` entry:
   * an entry without it is malformed and the module treats the surface as
   * unmeasured whatever its status (R31, R32(a)).
   */
  readonly plantedBinary?: PlantedBinaryResult;
  /** The caveats the measurement was made under (R31), carried beside the result. */
  readonly caveats?: readonly Caveat[];
}

/** The four caveats of R31, as the row 37e token names them. */
export type Caveat = "arm64-vm" | "agy-1.2.14" | "idle-start-screen" | "node.cmd-only";

/**
 * One entry per measured (CLI, surface, operating system) triple (R18): the
 * four hooks-surface Windows triples of rows 37-37d and the Antigravity
 * `statusline` triple of row 37e (#1389). The latter is `conforming` to row 37b
 * and carries the planted-binary result: `cmd.exe` resolves a bare `node` from
 * the working directory first, which a repository can hijack (security review
 * finding 1, spec 0243 delta-02 R31), so the module refuses every Windows
 * statusline command line until #1392 settles a form (R16(c), R32).
 *
 * Row 37e carries `[measured: interpreter=<v>; quoting=<v>; planted-binary=<v>;
 * caveats=<v,…>]` with the same tokens as the entry; a test compares them.
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
    quoting: "cmd-no-grouping",
    status: "conforming",
  },
  {
    cli: "antigravity",
    surface: "statusline",
    os: "win32",
    interpreter: "cmd.exe",
    quoting: "cmd-no-grouping",
    status: "conforming",
    plantedBinary: "planted-runs",
    // Windows 11 ARM64 VM (the CI job is x64); Antigravity CLI 1.2.14 (row 37b:
    // 1.2.13); idle start-up screen only, no turn observed; `node.cmd` only,
    // `NoDefaultCurrentDirectoryInExePath` unset, no alternative form measured.
    caveats: ["arm64-vm", "agy-1.2.14", "idle-start-screen", "node.cmd-only"],
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

/** The single refusal diagnostic of a Windows `statusLine.command` (R32 (a)-(c)). */
function statuslineRefusal(cli: Cli, entry: MeasuredSurface | undefined): string {
  if (entry === undefined || entry.plantedBinary === undefined) {
    // (a) no entry, or an entry lacking the planted-binary result whatever its status.
    return `${cli} statusline on Windows is unmeasured: no row of docs/cli-matrix.md records, with its planted-binary result, how ${cli} parses a statusLine.command there, so no command line is written for it.`;
  }
  if (entry.status === "contradicting") {
    // (b)
    return `${cli} statusline on Windows is measured as interpreter ${entry.interpreter} with ${entry.quoting} quoting, which contradicts the shape this tool writes; no command line is written until a spec 0243 delta sets its shape.`;
  }
  // (c)
  return `${cli} statusline on Windows: the ${entry.interpreter} that runs its statusLine.command resolves the bare 'node' of the command from the directory the user starts ${cli === "antigravity" ? "Antigravity CLI" : cli} in, before PATH (CWE-427), so a repository shipping a node.cmd would run its own code on every draw of the status line (row 37e). No command line is written until ticket #1392 settles a form that does not depend on that lookup.`;
}

/**
 * Build the direct command line for one CLI and surface, or refuse.
 *
 * Refusal order (R17, R32): the surface diagnostic comes first because it
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
    if (surface === "statusline") {
      // R32: one diagnostic, chosen from the constant alone, that replaces any
      // judgement of the path (R17). The module writes no Windows statusline
      // command line in any state of the entry (R16(c), R18).
      return { ok: false, refusal: statuslineRefusal(cli, measured) };
    }
    if (measured === undefined) {
      return {
        ok: false,
        refusal: `${cli} ${surface} on Windows is unmeasured: no row of docs/cli-matrix.md records how ${cli} parses a hook command line there, so no command line is written for it.`,
      };
    }
    if (measured.status === "contradicting") {
      return {
        ok: false,
        refusal: `${cli} ${surface} on Windows is measured as interpreter ${measured.interpreter} with ${measured.quoting} quoting, which contradicts the shape this tool writes; no command line is written until a spec 0243 delta sets its shape.`,
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
