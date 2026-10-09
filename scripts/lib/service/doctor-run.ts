// doctor-run.ts — `doctor-mempalace` (spec 0252 requirement 20; spec 0108 R7-R10): report
// which MemPalace will actually answer on this machine and flag any divergence.
// Three labelled sections (plus the Windows-only fourth) and a verdict. It only
// READS: no install and no CLI config is mutated, no probe task is created.
// Exit status 0 when no finding, 1 otherwise; the fourth section never changes it.

import { homedir } from "node:os";
import { DoctorState, verdict } from "./doctor-report.ts";
import type { Write } from "./doctor-report.ts";
import { sectionFresh, sectionLaunches, sectionPath } from "./doctor-sections.ts";
import { sectionBackground } from "./doctor-windows.ts";
import type { WindowsSectionOptions } from "./doctor-windows.ts";

export interface DoctorOptions {
  env: NodeJS.ProcessEnv;
  /** Defaults to `HOME` (or `USERPROFILE` on Windows), else the user's home directory. */
  home?: string;
  /** The directory holding this checkout's `scripts/lib/`. */
  scriptDir: string;
  platform: NodeJS.Platform;
  io: { out: Write };
  /** Test seams for the Windows section. */
  windows?: Partial<Omit<WindowsSectionOptions, "env" | "write">>;
}

/** Print the report; resolves to the exit status. */
export async function doctorMempalace(o: DoctorOptions): Promise<number> {
  const write = o.io.out;
  const home =
    o.home ?? (o.env["HOME"] || (o.platform === "win32" ? o.env["USERPROFILE"] : "") || homedir());
  const state = new DoctorState();
  const ctx = { env: o.env, home, scriptDir: o.scriptDir, write, state };

  write("MemPalace doctor — which MemPalace will actually answer on this machine");
  write("======================================================================");
  write("");
  await sectionLaunches(ctx);
  sectionPath(ctx);
  sectionFresh(ctx);
  if (o.platform === "win32") sectionBackground({ env: o.env, write, ...o.windows });
  return verdict(state, write);
}
