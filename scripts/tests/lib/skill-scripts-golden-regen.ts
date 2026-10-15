// skill-scripts-golden-regen.ts — regenerate scripts/tests/fixtures/skill-scripts/ from the SHELL
// leg (spec 0258 R29). Never run it on a macOS host for committed goldens: the shell scripts
// depend on GNU grep, awk, sed and find. It runs in a Linux container that mirrors the CI runner
// (Ubuntu 24.04, Bash 5.2, jq 1.7, Node.js 24, GNU tar and gzip, and the pinned Go `yq`).
//
// Two derived images carry `yq` (mikefarah, v4.44.3, linux arm64), one FROM each base image.
// Neither Dockerfile is tracked; the recipe is the stdin of `docker build`:
//
//   printf 'FROM crewrig-f1-linux\nADD https://github.com/mikefarah/yq/releases/download/v4.44.3/yq_linux_arm64 /usr/local/bin/yq\nRUN echo "0e7e1524f68d91b3ff9b089872d185940ab0fa020a5a9052046ef10547023156  /usr/local/bin/yq" | sha256sum -c - && chmod 755 /usr/local/bin/yq\n' | docker build -t h1337-golden:1 -
//   printf 'FROM crewrig-f1-linux-alt\n<the same two lines>' | docker build -t h1337-golden-alt:1 -
//
// Image 1 has Node.js at /usr/local/bin/node; image 2 has it under
// /opt/hostedtoolcache/node/24.99.0/x64/bin (a runner-like path, normalised to `<NODE>`).
// The worktree's `.git` is a pointer file to a host path, so mount the worktree read-only, copy
// it inside the container and re-initialise git there. Run each image into its own output
// directory, then `diff -r` the two `scripts/tests/fixtures/skill-scripts/` trees: it MUST be
// empty before the goldens are committed.
//
//   docker run --rm --name h1337-gen-1 -v "$PWD":/src:ro -v "$OUT1":/out h1337-golden:1 \
//     sh -c 'cp -a /src /w && cd /w && rm -f .git && git init -q && \
//       SKILL_GOLDEN_REGEN=1 node scripts/tests/lib/skill-scripts-golden-regen.ts && \
//       cp -a scripts/tests/fixtures/skill-scripts /out/'
//   docker run --rm --name h1337-gen-2 -v "$PWD":/src:ro -v "$OUT2":/out h1337-golden-alt:1 \
//     sh -c '<the same command>'
//
// Optional argument: a script id (`github-actions/check-pinned-actions`) to regenerate one table.
// Overlay goldens (`*.overlay.golden`, deviation-tagged cases) are never generated or deleted here.

import { SCRIPTS } from "./skill-scripts-cases.ts";
import { compareGolden, goldenFiles, readGolden, writeGolden } from "./skill-scripts-golden.ts";
import { observe } from "./skill-scripts-observe.ts";

function main(): number {
  if (process.env["SKILL_GOLDEN_REGEN"] !== "1") {
    process.stderr.write("Error: set SKILL_GOLDEN_REGEN=1 to regenerate the goldens.\n");
    return 1;
  }
  if (process.platform !== "linux") {
    process.stderr.write("Error: run in the Linux golden container, never on a host.\n");
    return 1;
  }
  const only = process.argv[2];
  const changed: string[] = [];
  for (const { script, cases } of SCRIPTS) {
    if (only !== undefined && only !== script) continue;
    for (const testCase of cases) {
      const files = goldenFiles(observe(testCase, "shell"));
      const stored = readGolden(testCase);
      for (const key of [...stored.keys()].filter((k) => k.endsWith(".overlay.golden")))
        stored.delete(key);
      for (const line of compareGolden(files, stored))
        changed.push(`${script}/${testCase.name}/${line.split(":")[0] ?? ""}`);
      writeGolden(testCase, files);
    }
  }
  process.stdout.write(changed.length === 0 ? "golden unchanged\n" : `${changed.join("\n")}\n`);
  return 0;
}

process.exitCode = main();
