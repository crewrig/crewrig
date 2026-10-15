// skill-scripts-golden-regen.ts — regenerate scripts/tests/fixtures/skill-scripts/ from the SHELL
// leg (spec 0258 R29). AFTER THE SWITCH (the S1 pull request, requirement 35) the eleven shell
// scripts no longer exist in the tree: base regeneration (`SKILL_GOLDEN_REGEN=1`) needs them back
// from git history, the last commit that had them being 9f6e75e6 (`git show 9f6e75e6:<path>` for
// each of the eleven `artifacts/core/skills/<skill>/scripts/<name>.sh`, written to the same place
// in the container copy), and refuses to run while one is missing. The overlay mode
// (`SKILL_GOLDEN_OVERLAYS=1`) keeps working without them: the stored base goldens stand for the
// shell's output. Never run it on a macOS host for committed goldens: the shell scripts
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
// `SKILL_GOLDEN_REGEN=1` writes the base goldens from the shell leg and never touches an overlay.
//
// `SKILL_GOLDEN_OVERLAYS=1` (spec 0258 R31) writes the OVERLAY goldens instead, from the entry leg:
// for each deviation-tagged case it runs both legs and writes `<name>.overlay.golden` for exactly
// the stored files whose entry output differs from the shell output (the shell leg is the
// comparison), replacing the case's earlier overlays. A case without a deviation tag is never
// given an overlay: an entry difference there is listed as UNTAGGED and the exit status is 1, as is
// a file the shell wrote that the entry did not (an overlay cannot express a missing file). Run it
// in the same two containers and `diff -r` the fixtures of the two images.

import fs from "node:fs";
import path from "node:path";

import { SCRIPTS } from "./skill-scripts-cases.ts";
import {
  caseDir,
  compareGolden,
  expectedFor,
  goldenFiles,
  overlayKeys,
  readGolden,
  writeGolden,
} from "./skill-scripts-golden.ts";
import { SHELL_RETIRED, observe, shellAvailable } from "./skill-scripts-observe.ts";

/** The overlay mode: returns the exit status. */
function overlays(only: string | undefined): number {
  const report: string[] = [];
  for (const { script, cases } of SCRIPTS) {
    if (only !== undefined && only !== script) continue;
    for (const testCase of cases) {
      const stored = readGolden(testCase);
      // the stored base goldens are the shell's output once the `.sh` is gone
      const shell = shellAvailable(script)
        ? goldenFiles(observe(testCase, "shell"))
        : expectedFor(stored, "shell");
      const entry = goldenFiles(observe(testCase, "entry"));
      for (const key of overlayKeys(stored))
        fs.rmSync(path.join(caseDir(testCase), ...key.split("/")));
      const base = [...shell.keys()].filter((k) => stored.get(k) !== shell.get(k));
      if (base.length > 0)
        report.push(`${script}/${testCase.name}: STALE base golden: ${base.join(", ")}`);
      const differing = [...new Set([...shell.keys(), ...entry.keys()])].filter(
        (k) => shell.get(k) !== entry.get(k),
      );
      if (differing.length === 0) continue;
      if (testCase.deviation === undefined) {
        report.push(`${script}/${testCase.name}: UNTAGGED difference: ${differing.join(", ")}`);
        continue;
      }
      for (const key of differing) {
        const text = entry.get(key);
        if (text === undefined) {
          report.push(`${script}/${testCase.name}: UNREPRESENTABLE, the entry wrote no ${key}`);
          continue;
        }
        const file = path.join(
          caseDir(testCase),
          ...`${key.slice(0, -".golden".length)}.overlay.golden`.split("/"),
        );
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from(text, "latin1"));
        report.push(`${script}/${testCase.name}: overlay ${key} (${testCase.deviation})`);
      }
    }
  }
  process.stdout.write(`${report.join("\n")}\n`);
  return report.some((line) => /STALE|UNTAGGED|UNREPRESENTABLE/.test(line)) ? 1 : 0;
}

function main(): number {
  const mode = process.env["SKILL_GOLDEN_OVERLAYS"] === "1" ? "overlays" : "base";
  if (mode === "base" && process.env["SKILL_GOLDEN_REGEN"] !== "1") {
    process.stderr.write(
      "Error: set SKILL_GOLDEN_REGEN=1 (base goldens) or SKILL_GOLDEN_OVERLAYS=1 (overlays).\n",
    );
    return 1;
  }
  if (process.platform !== "linux") {
    process.stderr.write("Error: run in the Linux golden container, never on a host.\n");
    return 1;
  }
  const only = process.argv[2];
  if (mode === "overlays") return overlays(only);
  const changed: string[] = [];
  for (const { script, cases } of SCRIPTS) {
    if (only !== undefined && only !== script) continue;
    if (!shellAvailable(script)) {
      process.stderr.write(
        `Error: ${script}: ${SHELL_RETIRED}; restore the .sh from git history (see the header).\n`,
      );
      return 1;
    }
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
