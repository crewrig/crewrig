// workspace.ts — the per-run workspace helpers of the runner (spec 0290 R9, R10, R29).
//
// `copyInputs` places an eval's R3 files in the run's workspace, `collectOutputs` copies what the
// run produced (anything but an unchanged input file, and never the top-level `.claude/`) into the
// run's `outputs/`, and `Semaphore` bounds the executor runs in flight.
//
// Usage: copyInputs(skillDir, files, workspace); collectOutputs(workspace, inputs, outputsDir).
// Exit codes: not applicable (library). Finding-line format: not applicable.

import fs from "node:fs";
import path from "node:path";

export function copyInputs(
  skillDirAbs: string,
  files: readonly string[],
  workspace: string,
): Map<string, Buffer> {
  const inputs = new Map<string, Buffer>();
  for (const f of files) {
    const bytes = fs.readFileSync(path.join(skillDirAbs, f));
    const base = path.basename(f);
    fs.writeFileSync(path.join(workspace, base), bytes);
    inputs.set(base, bytes);
  }
  return inputs;
}

/** Copy what the run produced (anything but an unchanged input file) into `outputs/`. */
export function collectOutputs(
  workspace: string,
  inputs: Map<string, Buffer>,
  outputsDir: string,
): void {
  fs.mkdirSync(outputsDir, { recursive: true });
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(workspace, abs).split(path.sep).join("/");
      if (dir === workspace && e.name === ".claude") continue; // the install location, not an output
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) {
        const was = inputs.get(rel);
        const bytes = fs.readFileSync(abs);
        if (was !== undefined && was.equals(bytes)) continue;
        const dest = path.join(outputsDir, ...rel.split("/"));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, bytes);
      }
    }
  };
  walk(workspace);
}

export class Semaphore {
  private free: number;
  private waiters: (() => void)[] = [];
  constructor(n: number) {
    this.free = Math.max(1, n);
  }
  async acquire(): Promise<void> {
    if (this.free > 0) return void this.free--;
    await new Promise<void>((r) => this.waiters.push(r));
  }
  release(): void {
    const w = this.waiters.shift();
    if (w !== undefined) w();
    else this.free++;
  }
}
