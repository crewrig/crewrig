// create-extension-golden-regen.ts — regenerate scripts/tests/fixtures/create-extension/ (spec 0258
// R29): one `mask-NN.manifest.json.golden` per component mask (0-63), recorded from the SHELL
// scaffolder under the `fzf` stub. One command, Linux only:
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/tests/lib/create-extension-golden-regen.ts
//
// Container procedure (never the maintainer's host: BSD and GNU userlands differ in what the shell
// writes):
//  1. Image `crewrig-f1-linux` (Ubuntu 24.04, Bash 5.2, jq 1.7, Node.js 24, GNU tar and gzip). Mount
//     the worktree read-only, `cp -a` it into the container, `rm -f .git`, then `git init` and
//     `git add -A` in the copy (the sandbox copies what `git ls-files` lists), run the command.
//  2. Image `crewrig-f1-linux-alt` (Node.js under /opt/hostedtoolcache/node/<version>/x64/bin): the
//     same steps into another directory. `diff -r` of the two fixture directories must be empty.
// Then run `scripts/tests/create-extension-differential.test.ts` in both images: the shell leg
// is compared with the entry live and the entry with these files. The command prints the files
// it changed.

import fs from "node:fs";

import { createCases, maskSpec } from "./create-extension-cases.ts";
import { SHELL_LAST_COMMIT, shellIsShim } from "./create-extension-observe.ts";
import { MASKS, goldenFile, manifestOf, writeGolden } from "./create-extension-golden.ts";

function main(): number {
  if (process.platform !== "linux") {
    process.stderr.write(
      "Error: the manifests are generated from the shell in a Linux container.\n",
    );
    return 1;
  }
  if (shellIsShim()) {
    process.stderr.write(
      "Error: scripts/create-extension.sh is a forwarding shim, so the shell can no longer " +
        "regenerate the base manifests; check out the last commit that held the shell " +
        `(${SHELL_LAST_COMMIT}) to regenerate them. The stored manifests are never edited by hand.\n`,
    );
    return 1;
  }
  const cases = createCases();
  const changed: string[] = [];
  for (const mask of MASKS) {
    const before = fs.existsSync(goldenFile(mask)) ? fs.readFileSync(goldenFile(mask), "utf8") : "";
    writeGolden(mask, manifestOf(cases.observe("shell", maskSpec(mask))));
    if (fs.readFileSync(goldenFile(mask), "utf8") !== before) changed.push(goldenFile(mask));
  }
  process.stdout.write(changed.length === 0 ? "golden unchanged\n" : `${changed.join("\n")}\n`);
  return 0;
}

process.exitCode = main();
