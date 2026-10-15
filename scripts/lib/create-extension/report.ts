// report.ts — the progress and closing lines of the scaffolder, verbatim from create-extension.sh.

import type { Io } from "../extension/types.ts";

export function reportStart(io: Io, name: string): void {
  io.out(`Creating extension: ${name}`);
  io.out("");
  io.out("Select components to include (TAB to toggle, ENTER to confirm):");
}

export function reportNoComponents(io: Io): void {
  io.out("No components selected. Creating base-only extension.");
}

export function reportSurvivorsClear(io: Io, target: string): void {
  io.out(`  No placeholder literal survives in ${target}.`);
}

export function reportDone(io: Io, tier: string, name: string): void {
  io.out("");
  io.out(`Extension created: extensions/${tier}/${name}`);
  io.out("");
  io.out("Next steps:");
  io.out(`  cd extensions/${tier}/${name}`);
  io.out("  npm install");
  io.out(`  task install-gemini-extension EXT=${name}`);
  io.out(`  (debugging: task link-gemini-extension-build EXT=${name})`);
}
