// schedule-spec.ts — what a scheduled job runs and when (spec 0258 requirement 15).

export type ScheduleFrequency = "weekly" | "daily";

export interface ScheduleSpec {
  /** `weekly` fires on Monday; both fire at minute 0 of `hour`. */
  readonly frequency: ScheduleFrequency;
  /** 0..23. */
  readonly hour: number;
  /** Absolute path of the interpreter (`process.execPath`). */
  readonly nodePath: string;
  /** Absolute path of the program the interpreter runs. */
  readonly entry: string;
  /** Arguments after the entry, one token per element. */
  readonly args: readonly string[];
  /** The installer's `PATH` (the shell relied on a login shell for it). */
  readonly pathValue: string;
  /** Absolute path of the log file; standard output and error are appended to it. */
  readonly logFile: string;
}

const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const ABSOLUTE_RE = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;

function refuse(label: string, value: unknown): never {
  throw new RangeError(`invalid ${label}: ${JSON.stringify(value)}`);
}

function checkText(label: string, value: string, absolute: boolean): void {
  if (value === "" || CONTROL_RE.test(value) || (absolute && !ABSOLUTE_RE.test(value))) {
    refuse(label, value);
  }
}

/**
 * Throws `RangeError` unless the spec is renderable: a known frequency, an
 * integer hour 0..23, absolute interpreter, entry and log paths, a non-empty
 * `PATH`, and no newline or other control character in any text.
 */
export function validateSchedule(spec: ScheduleSpec): void {
  if (spec.frequency !== "weekly" && spec.frequency !== "daily") {
    refuse("frequency", spec.frequency);
  }
  if (!Number.isInteger(spec.hour) || spec.hour < 0 || spec.hour > 23) refuse("hour", spec.hour);
  checkText("node path", spec.nodePath, true);
  checkText("entry", spec.entry, true);
  checkText("log file", spec.logFile, true);
  checkText("PATH", spec.pathValue, false);
  for (const arg of spec.args) {
    if (CONTROL_RE.test(arg)) refuse("argument", arg);
  }
}
