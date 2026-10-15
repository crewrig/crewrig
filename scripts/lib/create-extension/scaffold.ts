// scaffold.ts — copy the skeleton into the target (spec 0258 R23).
// Twin of create-extension.sh :49-69: `extension-skeleton/base/.` first, then each selected
// component directory that exists, later files replacing earlier ones.

import fs from "node:fs";
import path from "node:path";

import type { Io } from "../extension/types.ts";

function copyInto(from: string, to: string): void {
  fs.cpSync(from, to, { recursive: true, force: true, verbatimSymlinks: true });
}

export function scaffold(
  skeletonDir: string,
  target: string,
  components: readonly string[],
  io: Io,
): void {
  fs.mkdirSync(target, { recursive: true });
  copyInto(path.join(skeletonDir, "base"), target);
  for (const comp of components) {
    const compDir = path.join(skeletonDir, comp);
    if (fs.existsSync(compDir) && fs.statSync(compDir).isDirectory()) {
      copyInto(compDir, target);
      io.out(`  Added: ${comp}`);
    }
  }
}
