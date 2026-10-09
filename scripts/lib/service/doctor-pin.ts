// doctor-pin.ts — the pin and served-version evaluation of `doctor-mempalace`
// (spec 0252 requirement 20; spec 0108 R7-R10). The module `mempalace_pin.py`
// stays Python and is run under the interpreter being reported — the one spawn
// of this tool, the Python toolchain parent requirement 23 permits. Ports
// `run_probe`, `probe_get` and `evaluate` of scripts/doctor-mempalace.sh.

import { spawnSync } from "node:child_process";
import { splitLauncher } from "../mempalace-python.ts";
import { DoctorState, field, tildify } from "./doctor-report.ts";
import type { Write } from "./doctor-report.ts";

const PYTHON_TIMEOUT_MS = 60_000;

/** The captured text of one Python run: stdout, then stderr when `mergeStderr`. */
function runPython(
  interp: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  mergeStderr: boolean,
): { status: number | null; text: string } {
  const [command, ...lead] = splitLauncher(interp);
  if (command === undefined || command === "") return { status: null, text: "" };
  const r = spawnSync(command, [...lead, ...args], {
    env,
    encoding: "utf8",
    shell: false,
    timeout: PYTHON_TIMEOUT_MS,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out: unknown = r.stdout;
  const err: unknown = r.stderr;
  const text =
    (typeof out === "string" ? out : "") + (mergeStderr && typeof err === "string" ? err : "");
  return { status: r.error === undefined ? r.status : null, text };
}

/** The output of `<interp> <pinModule> --probe` as `key=value` lines; empty on any failure. */
export function runProbe(interp: string, pinModule: string, env: NodeJS.ProcessEnv): string {
  return runPython(interp, [pinModule, "--probe"], env, false).text;
}

/** `probe_get`: the value of the first `key=` line, else `unknown`. */
export function probeGet(capture: string, key: string): string {
  for (const line of capture.split("\n")) {
    if (line.startsWith(`${key}=`)) {
      const value = line.slice(key.length + 1);
      return value === "" ? "unknown" : value;
    }
  }
  return "unknown";
}

/** `$(...)`: trailing newlines removed. */
function trimNewlines(text: string): string {
  return text.replace(/\n+$/, "");
}

export interface EvaluateInput {
  label: string;
  interp: string;
  pinModule: string;
  commonSh: string;
  probeCapture: string;
  home: string;
  env: NodeJS.ProcessEnv;
}

/**
 * Print the pin, the served version, the `__version__` agreement note, whether
 * `packaging` is importable and the range verdict, then record the version and
 * the pin for the cross-source check and note a failure when out of range.
 */
export function evaluate(i: EvaluateInput, state: DoctorState, write: Write): void {
  const { label, interp, commonSh } = i;
  const dist = probeGet(i.probeCapture, "dist");
  const attr = probeGet(i.probeCapture, "attr");
  const hasPackaging = probeGet(i.probeCapture, "packaging");

  const pinRun = runPython(
    interp,
    [i.pinModule, "--common-sh", commonSh, "--print-pin"],
    i.env,
    true,
  );
  const pinLine = trimNewlines(pinRun.text);
  if (pinRun.status !== 0) {
    field(write, "pin:", `UNREADABLE from ${tildify(commonSh, i.home)} — ${pinLine}`);
    state.noteFailure(
      `${label}: the supported-version pin could not be read from ${tildify(commonSh, i.home)}`,
    );
    return;
  }
  const minRaw = pinLine.startsWith("min=") ? pinLine.slice(4) : pinLine;
  const pinMin = minRaw.split(" ")[0] ?? "";
  const maxAt = pinLine.lastIndexOf("max=");
  const pinMax = maxAt === -1 ? pinLine : pinLine.slice(maxAt + 4);
  field(write, "supported range:", `>=${pinMin},<${pinMax}`);
  field(write, "pin declared by:", tildify(commonSh, i.home));
  state.recordPin(label, `${pinMin},${pinMax}`);

  field(write, "version served:", `${dist}  (dist-info, resolved in-process)`);
  if (attr === "absent" || attr === "unknown") {
    field(write, "mempalace.__version__:", `${attr}  (no second declaration to compare)`);
  } else if (attr === dist) {
    field(write, "mempalace.__version__:", `${attr}  (agrees with dist-info)`);
  } else {
    field(write, "mempalace.__version__:", `${attr}  (DISAGREES with dist-info ${dist})`);
    write(
      "                            note: the module literal is hand-maintained and independent",
    );
    write(
      "                            of the dist-info field; a .postN rebuild disagrees legitimately.",
    );
    write("                            The launch guard range-checks each on its own and refuses");
    write("                            neither for disagreeing.");
  }
  field(write, "packaging importable:", hasPackaging);

  if (dist === "absent" || dist === "unknown") {
    field(write, "verdict:", "NO VERSION — this interpreter resolves no mempalace distribution");
    state.noteFailure(`${label}: no mempalace version is resolvable from ${interp}`);
    return;
  }

  const check = runPython(
    interp,
    [i.pinModule, "--common-sh", commonSh, "--check", dist],
    i.env,
    true,
  );
  field(write, "verdict:", trimNewlines(check.text));
  state.recordVersion(label, dist);
  if (check.status !== 0) {
    state.noteFailure(`${label}: ${dist} lies outside >=${pinMin},<${pinMax} (${interp})`);
  }
}
