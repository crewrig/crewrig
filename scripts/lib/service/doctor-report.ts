// doctor-report.ts — the accumulated state, the line formats and the verdict of
// `doctor-mempalace` (spec 0252 requirement 20; spec 0108 R7-R10). Ports the
// `field`, `note_failure`, `record_version`, `record_pin` and `Verdict` parts of
// scripts/doctor-mempalace.sh; messages and the exit rule are the shell's.

export type Write = (line: string) => void;

/** Printed unconditionally at the end, on every outcome (spec 0108 R4). */
export const RESTART_NOTE =
  "A memory-server session that is already running keeps serving the\n" +
  "  MemPalace version it started with. Running sessions must be restarted before\n" +
  "  any change to the install takes effect — including a change this report\n" +
  "  prompts you to make.";

/** What the three sections learn; the verdict reads it. */
export class DoctorState {
  readonly versions: Array<[string, string]> = [];
  readonly pins: Array<[string, string]> = [];
  readonly notes: string[] = [];

  noteFailure(note: string): void {
    this.notes.push(note);
  }

  recordVersion(label: string, version: string): void {
    this.versions.push([label, version]);
  }

  recordPin(label: string, pin: string): void {
    this.pins.push([label, pin]);
  }
}

/** `printf '    %-24s%s\n'`. */
export function field(write: Write, name: string, value: string): void {
  write(`    ${name.padEnd(24)}${value}`);
}

/** The shell's `${1/#$HOME/\~}`: a leading home directory becomes `~`. */
export function tildify(text: string, home: string): string {
  return home !== "" && text.startsWith(home) ? `~${text.slice(home.length)}` : text;
}

function distinct(rows: ReadonlyArray<[string, string]>): string[] {
  return [...new Set(rows.map((r) => r[1]).filter((v) => v !== ""))].sort();
}

function breakdown(write: Write, title: string, rows: ReadonlyArray<[string, string]>): void {
  write(`  ${title}`);
  for (const [label, value] of rows) {
    if (value !== "") write(`    ${label.padEnd(28)} ${value}`);
  }
  write("");
}

/** Print the Verdict block; resolves to the exit status (0 when no finding). */
export function verdict(state: DoctorState, write: Write): number {
  write("Verdict");
  write("-------");
  write("");

  const versions = distinct(state.versions);
  if (versions.length > 1) {
    state.noteFailure(`reported versions DIVERGE — ${versions.join(" ")}`);
    breakdown(write, "Versions reported, by source:", state.versions);
  }
  const pins = distinct(state.pins);
  if (pins.length > 1) {
    state.noteFailure(`declared pins DIVERGE — ${pins.join(" ")}`);
    breakdown(write, "Pins declared, by source:", state.pins);
  }

  const failures = state.notes.length;
  if (failures === 0) {
    write("  OK — every source reports the same MemPalace version against the same pin,");
    write("  and every reported version lies inside it.");
  } else {
    write(`  NOT OK — ${failures} finding(s):`);
    for (const note of state.notes) write(`  - ${note}`);
  }
  write("");
  write(`  NOTE: ${RESTART_NOTE}`);
  write("");
  return failures === 0 ? 0 : 1;
}
