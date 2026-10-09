// extension-golden-regen.ts — regenerate scripts/tests/fixtures/extension-golden/ from the shell oracle
// (spec 0254 R22). One command, Linux and macOS only (it runs `bash`, `jq` and `yq` on purpose):
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/tests/lib/extension-golden-regen.ts
//
// For each subject of `buildSubjects()` it builds `--target all` with `scripts/build-extension.sh`
// in a throwaway root and stores the five outputs under `extension-golden/<subject>/`, replacing
// what was there, then prints the files that changed. The golden is frozen while the shell is the
// oracle; once the shell is a shim (PR D) the procedure runs the TypeScript entry instead and a
// reviewed diff is required.

import fs from "node:fs";
import path from "node:path";

import { buildSubjects } from "./extension-trees.ts";
import {
  collectFiles,
  collectGolden,
  extensionRoot,
  goldenBytes,
  outputDirs,
  runShell,
  runTs,
} from "./extension-run.ts";

const GOLDEN = path.resolve(import.meta.dirname, "..", "fixtures", "extension-golden");

function main(): number {
  if (process.platform === "win32") {
    process.stderr.write("Error: the golden is regenerated on Linux or macOS.\n");
    return 1;
  }
  const useTs = process.argv.includes("--from-typescript");
  const changed: string[] = [];
  for (const [name, files] of Object.entries(buildSubjects())) {
    const tree = extensionRoot({ [name]: files });
    const run = useTs
      ? runTs(tree, "build-extension", ["--target", "all", name])
      : runShell(tree, "build-extension", ["--target", "all", name]);
    if (run.status !== 0) {
      process.stderr.write(`Error: building ${name} failed (${run.status}):\n${run.stderr}\n`);
      return 1;
    }
    for (const [label, dir] of Object.entries(outputDirs(tree, name))) {
      const target = path.join(GOLDEN, name, label);
      const before = collectGolden(target);
      fs.rmSync(target, { recursive: true, force: true });
      const after = collectFiles(dir);
      for (const [rel, bytes] of after) {
        const file = path.join(target, ...`${rel}.golden`.split("/"));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, goldenBytes(bytes));
        const old = before.get(rel);
        if (old === undefined || !old.equals(bytes)) changed.push(`${name}/${label}/${rel}`);
      }
      for (const rel of before.keys())
        if (!after.has(rel)) changed.push(`${name}/${label}/${rel} (removed)`);
    }
    tree.dispose();
  }
  process.stdout.write(changed.length === 0 ? "golden unchanged\n" : `${changed.join("\n")}\n`);
  return 0;
}

process.exitCode = main();
