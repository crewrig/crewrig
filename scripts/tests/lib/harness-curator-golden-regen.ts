// harness-curator-golden-regen.ts — regenerate scripts/tests/fixtures/harness-curator/ from the
// SHELL leg, with the overlays of the tagged cases from the entry leg of the same run (spec 0258
// R29). Never run it on a macOS host for committed goldens. It runs in a Linux container that
// mirrors the CI runner (Ubuntu 24.04, Bash 5.2, Node.js 24, python3): images `h1337-golden:1`
// (Node at /usr/local/bin/node) and `h1337-golden-alt:1` (Node under
// /opt/hostedtoolcache/node/24.99.0/x64/bin, normalised to `<NODE>`). The worktree's `.git` is a
// pointer file to a host path, so mount the worktree read-only, copy it inside the container and
// re-initialise git there. Run each image into its own output directory, then `diff -r` the two
// `scripts/tests/fixtures/harness-curator/` trees: it MUST be empty before the goldens are committed.
//
//   docker run --rm --name h1337-hc-1 -v "$PWD":/src:ro -v "$OUT1":/out h1337-golden:1 \
//     sh -c 'cp -a /src /w && cd /w && rm -f .git && git init -q && \
//       HC_GOLDEN_REGEN=1 node scripts/tests/lib/harness-curator-golden-regen.ts && \
//       cp -a scripts/tests/fixtures/harness-curator /out/'
//
// Optional argument: one case name. A difference no rule tags stops the run: no golden is written
// for a case the differential would then fail.

import { CASES } from "./harness-curator-cases.ts";
import {
  caseDir,
  findDifferences,
  goldenFiles,
  overlayBaseKeys,
  tagOf,
  writeGolden,
} from "./harness-curator-differential.ts";
import { observe } from "./harness-curator-observe.ts";

function main(): number {
  if (process.env["HC_GOLDEN_REGEN"] !== "1") {
    process.stderr.write("Error: set HC_GOLDEN_REGEN=1 to regenerate the goldens.\n");
    return 1;
  }
  if (process.platform !== "linux") {
    process.stderr.write("Error: run in the Linux golden container, never on a host.\n");
    return 1;
  }
  const only = process.argv[2];
  let failed = 0;
  for (const testCase of CASES) {
    if (only !== undefined && only !== testCase.name) continue;
    const shell = observe(testCase, "shell");
    const entry = observe(testCase, "entry");
    const untagged = findDifferences(shell, entry).filter((d) => tagOf(d, testCase) === undefined);
    if (untagged.length > 0) {
      failed++;
      for (const d of untagged)
        process.stderr.write(
          `${testCase.name}: untagged ${d.field}\n  shell: ${JSON.stringify(d.shell)}\n  entry: ${JSON.stringify(d.ts)}\n`,
        );
      continue;
    }
    const base = goldenFiles(shell);
    const mine = goldenFiles(entry);
    for (const key of overlayBaseKeys(base, mine))
      base.set(key.replace(/\.golden$/, ".overlay.golden"), mine.get(key) as string);
    writeGolden(testCase.name, base);
    process.stdout.write(`${caseDir(testCase.name)}\n`);
  }
  return failed === 0 ? 0 : 1;
}

process.exitCode = main();
