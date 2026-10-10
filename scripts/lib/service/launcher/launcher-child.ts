// launcher-child.ts — the PURE child-supervision core of the installed MCP
// launcher and of the installed trust wrapper (spec 0252 requirements 11 and
// 12; plan v3 D6).
//
// A Node.js process cannot replace itself the way the shell launcher's `exec`
// does, so the daemon is a child and the supervisor watches this process. The
// core takes everything it touches as a parameter: the spawn function, the
// signal registrar, the exit function, the log sink and the escalation timer.
// Nothing here imports anything.
//
// Rules:
//   - SIGTERM and SIGINT are forwarded to the child; a stop is then requested;
//   - a child that ends while no stop was requested ends this process too: the
//     child's status when non-zero, 128+signal for a signal death, 1 for a
//     clean status 0 (a task or unit would otherwise read a clean end as
//     success and never restart the daemon) — and a log line says so;
//   - the stop request and the child's end race under a control-group stop (systemd
//     signals every process of the unit at once): an unasked child end is therefore
//     judged after a short grace (`stopGraceMs`, default 250 ms), and a stop request
//     that arrives within it still counts as requested, so the end is status 0;
//   - this process never outlives the child (it exits in the child's exit
//     handler, nowhere else);
//   - a requested stop ends the child, escalating to SIGKILL after a bounded
//     wait, then exits 0 (a clean stop under Restart=always and KeepAlive);
//   - `endNonzeroOnChildExit` false (the unflagged trust wrapper) exits with
//     the child's own status, status 0 included.
//
// BUNDLE (installed flat as service-lib/launcher-child.ts): standalone, no
// import. Used by launcher/mcp-daemon-launcher.ts and launcher/trust-wrapper.ts.

export type StopSignal = "SIGTERM" | "SIGINT";

/** The part of a Node.js `ChildProcess` the core uses. */
export interface ChildLike {
  kill(signal?: NodeJS.Signals): boolean;
  on(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export interface SuperviseOptions {
  readonly spawn: () => ChildLike;
  /** Registers `handler` for `signal` (`process.on` in the real entries). */
  readonly onSignal: (signal: StopSignal, handler: () => void) => void;
  readonly exit: (code: number) => void;
  readonly log: (line: string) => void;
  /** Default true. False: exit with the child's own status. */
  readonly endNonzeroOnChildExit?: boolean;
  /** Wait before SIGKILL on a requested stop, ms. Default 10 000. */
  readonly killAfterMs?: number;
  /** Grace before an unasked child end is judged, ms. Default 250; 0 judges at once. */
  readonly stopGraceMs?: number;
  /** Runs `fn` once after `ms`; returns the cancel function. */
  readonly schedule?: (fn: () => void, ms: number) => () => void;
}

export const DEFAULT_KILL_AFTER_MS = 10_000;
export const DEFAULT_STOP_GRACE_MS = 250;

/** Signal numbers (Linux, macOS agree on these) for the 128+n convention. */
const SIGNAL_NUMBERS: Readonly<Record<string, number>> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGABRT: 6,
  SIGKILL: 9,
  SIGUSR1: 10,
  SIGSEGV: 11,
  SIGUSR2: 12,
  SIGPIPE: 13,
  SIGALRM: 14,
  SIGTERM: 15,
};

export function signalExitCode(signal: string): number {
  return 128 + (SIGNAL_NUMBERS[signal] ?? 15);
}

/** The status this process ends with when the child ended unasked. */
export function endStatus(
  code: number | null,
  signal: NodeJS.Signals | null,
  endNonzero: boolean,
): number {
  if (code === null) return signal === null ? 1 : signalExitCode(signal);
  if (code !== 0) return code;
  return endNonzero ? 1 : 0;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** `date '+%Y-%m-%dT%H:%M:%S%z'` of the shell launcher. */
export function stamp(now: Date = new Date()): string {
  const offset = -now.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return (
    `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`
  );
}

/** The shell `log` line: `<stamp> <message>` (standard output). */
export function logLine(message: string, now?: Date): string {
  return `${stamp(now)} ${message}`;
}

/** The shell `die` line: `<stamp> ERROR: <message>` (standard error). */
export function dieLine(message: string, now?: Date): string {
  return `${stamp(now)} ERROR: ${message}`;
}

function defaultSchedule(fn: () => void, ms: number): () => void {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
}

/** Supervise one child. Returns after wiring; the exit function ends it. */
export function superviseChild(opts: SuperviseOptions): void {
  const endNonzero = opts.endNonzeroOnChildExit ?? true;
  const killAfter = opts.killAfterMs ?? DEFAULT_KILL_AFTER_MS;
  const schedule = opts.schedule ?? defaultSchedule;
  const grace = opts.stopGraceMs ?? DEFAULT_STOP_GRACE_MS;
  let stopRequested = false;
  let childEnded = false;
  let cancelEscalation: (() => void) | undefined;
  let child: ChildLike;
  try {
    child = opts.spawn();
  } catch (error) {
    opts.log(logLine(`could not start the child: ${(error as Error).message}`));
    opts.exit(126);
    return;
  }
  const stop = (signal: StopSignal): void => {
    child.kill(signal);
    if (stopRequested) return;
    stopRequested = true;
    if (childEnded) return;
    cancelEscalation = schedule(() => {
      child.kill("SIGKILL");
    }, killAfter);
  };
  opts.onSignal("SIGTERM", () => stop("SIGTERM"));
  opts.onSignal("SIGINT", () => stop("SIGINT"));
  child.on("error", (error: Error) => {
    cancelEscalation?.();
    const code = (error as NodeJS.ErrnoException).code === "ENOENT" ? 127 : 126;
    opts.log(logLine(`could not start the child: ${error.message}`));
    opts.exit(code);
  });
  child.on("exit", (code, signal) => {
    childEnded = true;
    cancelEscalation?.();
    const settle = (): void => {
      if (stopRequested) return opts.exit(0);
      const status = endStatus(code, signal, endNonzero);
      const how = signal === null ? `status ${code}` : `signal ${signal}`;
      // The unflagged wrapper is transparent: it says nothing of its own.
      if (endNonzero) {
        opts.log(
          logLine(
            `child ended (${how}); ending with status ${status} so the supervisor restarts it`,
          ),
        );
      }
      opts.exit(status);
    };
    if (stopRequested || grace <= 0) return settle();
    schedule(settle, grace);
  });
}
