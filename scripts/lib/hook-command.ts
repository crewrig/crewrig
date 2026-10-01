// hook-command.ts — the single source of the direct `node` command line each
// CLI receives for a hook or a status line (spec 0243 R16-R18, R31-R33).
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
/** A binary planted in the surface's working directory for the guarded-form measurement (R31). */
export type GuardedCandidate = "node.cmd" | "node.bat" | "node.exe";
/**
 * The guarded-form result of R31: for each planted candidate, whether the real
 * `node` ran (`real`) or the planted one did (`planted`). Holding only when
 * every candidate is `real` and there is at least one (R32, S3).
 */
export type GuardedFormResult = readonly {
  readonly plant: GuardedCandidate;
  readonly ran: "real" | "planted";
}[];

export interface MeasuredSurface {
  readonly cli: Cli;
  readonly surface: Surface;
  readonly os: "win32";
  readonly interpreter: Interpreter;
  readonly quoting: Quoting;
  /** `conforming` when interpreter and quoting equal row 37b's, else `contradicting`. */
  readonly status: "conforming" | "contradicting";
  /**
   * The planted-binary result of the bare form (R31). Required of a Windows
   * Antigravity entry: an entry without it is malformed and the surface is
   * treated as unmeasured whatever its status (R31, R32(a1)-(a4)).
   */
  readonly plantedBinary?: PlantedBinaryResult;
  /** The caveats the bare measurement was made under (R31), carried beside the result. */
  readonly caveats?: readonly Caveat[];
  /** The guarded-form result (R31, delta-03); absent is the delta-02 state, not malformed. */
  readonly guardedForm?: GuardedFormResult;
  /** The caveats the guarded-form measurement was made under (R31, R33). */
  readonly guardedCaveats?: readonly Caveat[];
}

/** The caveats of R31 and R33, as the row 37e / 37f tokens name them. */
export type Caveat =
  | "arm64-vm"
  | "agy-1.2.14"
  | "idle-start-screen"
  | "node.cmd-only"
  | "one-plant-cwd-only"
  | "marker-probe"
  | "node.exe-control-two-draws"
  | "stop-print-console";

/**
 * The guarded prefix of R16(c) and R34, byte for byte, with its one trailing
 * space. `cmd.exe` leaves out the current-directory step of its program search
 * while `NoDefaultCurrentDirectoryInExePath` exists; `set` is a builtin no file
 * can stand in for. Written by this module, recognised by hook-recognition.ts.
 */
export const GUARDED_PREFIX = "set NoDefaultCurrentDirectoryInExePath=1&& ";

/**
 * One entry per measured (CLI, surface, operating system) triple (R18): the
 * four hooks-surface Windows triples of rows 37-37d and the Antigravity
 * `statusline` triple of row 37e. Both Antigravity entries carry the bare
 * planted-binary result — `cmd.exe` resolves a bare `node` from the working
 * directory first (#1389, #1392) — and a holding guarded-form result (#1392),
 * so both are in state (e) of R32 and receive the guarded form (R16(c), R33).
 *
 * Rows 37e and 37f carry `[measured: interpreter=<v>; quoting=<v>;
 * planted-binary=<v>; caveats=<v,…>; guarded-form=<plant:ran,…>;
 * guarded-caveats=<v,…>]` with the same tokens as the entries; a test compares
 * them.
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
    // Row 37f (#1392): fired once per run by `Stop` from `agy --print` in the
    // console session, working directory `~\.gemini\config`. The bare `node`
    // ran each of the three plants; the guarded form ran the real `node` each
    // time. The statusline-only two-draw control caveat is not carried (R33).
    cli: "antigravity",
    surface: "hooks",
    os: "win32",
    interpreter: "cmd.exe",
    quoting: "cmd-no-grouping",
    status: "conforming",
    plantedBinary: "planted-runs",
    caveats: ["arm64-vm", "agy-1.2.14", "stop-print-console", "one-plant-cwd-only", "marker-probe"],
    guardedForm: [
      { plant: "node.cmd", ran: "real" },
      { plant: "node.bat", ran: "real" },
      { plant: "node.exe", ran: "real" },
    ],
    guardedCaveats: [
      "arm64-vm",
      "agy-1.2.14",
      "stop-print-console",
      "one-plant-cwd-only",
      "marker-probe",
    ],
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
    // 1.2.13); idle start-up screen only, no turn observed; the #1389 bare
    // result was measured with `node.cmd` only and no alternative form, whereas
    // #1392 planted `node.cmd`, `node.bat` and `node.exe` for both forms (R31).
    caveats: ["arm64-vm", "agy-1.2.14", "idle-start-screen", "node.cmd-only"],
    // #1392: 11, 7 and 9 draws ran the real `node`, none the plant; one plant
    // per run in the working directory only, nothing on PATH (R36); a marker
    // probe with `%CMDCMDLINE%`, no `wmic`; the `node.exe` bare control drew
    // twice in 60 s.
    guardedForm: [
      { plant: "node.cmd", ran: "real" },
      { plant: "node.bat", ran: "real" },
      { plant: "node.exe", ran: "real" },
    ],
    guardedCaveats: [
      "arm64-vm",
      "agy-1.2.14",
      "idle-start-screen",
      "one-plant-cwd-only",
      "marker-probe",
      "node.exe-control-two-draws",
    ],
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

/** The eight states of a Windows Antigravity CLI entry (R32). */
export type AgyState = "a1" | "a2" | "a3" | "a4" | "b" | "c" | "d" | "e";
/** What the module does for one surface in one state (R32). */
export type AgyOutcome = "refuse" | "bare" | "guarded";

/** Holding: at least one candidate, and every one ran the real `node` (R32; empty fails closed, S3). */
export function isHolding(result: GuardedFormResult | undefined): boolean {
  return result !== undefined && result.length > 0 && result.every((r) => r.ran === "real");
}

/** The R32 state of an entry, from its four facts alone. Exclusive and exhaustive by construction. */
export function antigravityState(entry: MeasuredSurface | undefined): AgyState {
  if (entry === undefined) return "a1";
  if (entry.plantedBinary === undefined) {
    if (entry.guardedForm !== undefined) return "a2";
    return entry.status === "conforming" ? "a3" : "a4";
  }
  if (entry.status === "contradicting") return "b";
  if (entry.guardedForm === undefined) return "c";
  return isHolding(entry.guardedForm) ? "e" : "d";
}

/** The R32 table, row by row: `statusLine.command` and hooks-surface outcome per state. */
export const AGY_OUTCOMES: Readonly<
  Record<AgyState, Readonly<{ statusline: AgyOutcome; hooks: AgyOutcome }>>
> = Object.freeze({
  a1: Object.freeze({ statusline: "refuse", hooks: "refuse" }), // none: unmeasured | unmeasured
  a2: Object.freeze({ statusline: "refuse", hooks: "refuse" }), // no bare, guarded: unmeasured | unmeasured
  a3: Object.freeze({ statusline: "refuse", hooks: "bare" }), // no bare, no guarded, conforming: unmeasured | bare
  a4: Object.freeze({ statusline: "refuse", hooks: "refuse" }), // no bare, no guarded, contradicting: unmeasured | recorded shape
  b: Object.freeze({ statusline: "refuse", hooks: "refuse" }), // bare, contradicting: recorded shape | recorded shape
  c: Object.freeze({ statusline: "refuse", hooks: "bare" }), // bare, conforming, no guarded: lookup #1392 | bare
  d: Object.freeze({ statusline: "refuse", hooks: "refuse" }), // bare, conforming, hijacked: hijacked #1392 | same, hooks
  e: Object.freeze({ statusline: "guarded", hooks: "guarded" }), // bare, conforming, holding: guarded | guarded
});

function unmeasured(cli: Cli, surface: Surface): string {
  return surface === "statusline"
    ? `${cli} statusline on Windows is unmeasured: no row of docs/cli-matrix.md records, with its planted-binary result, how ${cli} parses a statusLine.command there, so no command line is written for it.`
    : `${cli} ${surface} on Windows is unmeasured: no row of docs/cli-matrix.md records how ${cli} parses a hook command line there, so no command line is written for it.`;
}

function contradicts(cli: Cli, surface: Surface, entry: MeasuredSurface): string {
  return `${cli} ${surface} on Windows is measured as interpreter ${entry.interpreter} with ${entry.quoting} quoting, which contradicts the shape this tool writes; no command line is written until a spec 0243 delta sets its shape.`;
}

/**
 * The single refusal diagnostic of a Windows Antigravity surface in a refusing
 * state (R32). The statusline (a), (b) and (c) texts and the hooks unmeasured
 * and recorded-shape texts are those delta-02 shipped, byte for byte (v1-F5).
 */
function agyRefusal(
  cli: Cli,
  surface: Surface,
  state: AgyState,
  entry: MeasuredSurface | undefined,
): string {
  switch (state) {
    case "a1":
    case "a2":
    case "a3":
      return unmeasured(cli, surface);
    case "a4":
      // The statusline is unmeasured without its bare result; the hooks surface
      // keeps the recorded-shape refusal of every contradicting hooks triple.
      return surface === "statusline" || entry === undefined
        ? unmeasured(cli, surface)
        : contradicts(cli, surface, entry);
    case "b":
      return entry === undefined ? unmeasured(cli, surface) : contradicts(cli, surface, entry);
    case "c":
      return `${cli} statusline on Windows: the ${entry?.interpreter ?? "cmd.exe"} that runs its statusLine.command resolves the bare 'node' of the command from the directory the user starts ${cli === "antigravity" ? "Antigravity CLI" : cli} in, before PATH (CWE-427), so a repository shipping a node.cmd would run its own code on every draw of the status line (row 37e). No command line is written until ticket #1392 settles a form that does not depend on that lookup.`;
    case "d":
      return surface === "statusline"
        ? `${cli} statusline on Windows: the recorded measurement found the guarded form hijacked (row 37e): a planted node ran despite the set NoDefaultCurrentDirectoryInExePath=1 prefix, so no command line is written until a spec 0243 delta revises the measurement of ticket #1392.`
        : `${cli} hooks on Windows: the recorded measurement found the guarded form hijacked (row 37f): a planted node ran in the hooks working directory despite the set NoDefaultCurrentDirectoryInExePath=1 prefix, so no hook command line is written until a spec 0243 delta revises the measurement of ticket #1392.`;
    case "e":
      // Never a refusal state; kept for exhaustiveness.
      return unmeasured(cli, surface);
  }
}

/**
 * Build the direct command line for one CLI and surface, or refuse.
 *
 * Refusal order (R17, R32): the surface diagnostic comes first because it
 * concerns the surface and precedes any judgement of the path. On Windows
 * Antigravity CLI both surfaces follow `AGY_OUTCOMES`; macOS and Linux never
 * carry the guarded prefix (R16(c) null case).
 */
export function hookCommandLine(
  request: HookCommandRequest,
  measuredSurfaces: readonly MeasuredSurface[] = MEASURED_SURFACES,
): HookCommandResult {
  const { cli, surface, platform, args } = request;
  const windows = platform === "win32";

  let cmdExe = false;
  let powershell = false;
  let guarded = false;
  if (windows) {
    const measured = findSurface(measuredSurfaces, cli, surface);
    if (cli === "antigravity" || surface === "statusline") {
      // R32: the outcome is chosen from the constant alone, by the entry's
      // state; a refusal replaces any judgement of the path (R17). The bare and
      // guarded outcomes fall through to the unchanged path judgement.
      const state = antigravityState(measured);
      const outcome = cli === "antigravity" ? AGY_OUTCOMES[state][surface] : "refuse";
      if (outcome === "refuse") {
        return { ok: false, refusal: agyRefusal(cli, surface, state, measured) };
      }
      guarded = outcome === "guarded";
    } else if (measured === undefined) {
      return { ok: false, refusal: unmeasured(cli, surface) };
    } else if (measured.status === "contradicting") {
      return { ok: false, refusal: contradicts(cli, surface, measured) };
    }
    cmdExe = measured?.interpreter === "cmd.exe";
    powershell = measured?.quoting === "powershell";
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
  // The `&&` and `=` of the prefix belong to the template, never to the path (R17).
  const prefix = guarded ? GUARDED_PREFIX : "";
  return { ok: true, command: prefix + ["node", path, ...args].join(" ") };
}
