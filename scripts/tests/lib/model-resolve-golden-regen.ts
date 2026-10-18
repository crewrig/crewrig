// model-resolve-golden-regen.ts — regenerate scripts/tests/fixtures/model-resolve-oracle/ from the
// SHELL leg (spec 0262 R17). scripts/lib/model-resolve.sh is deleted in the switch PR; after that
// the stored goldens stand for the shell's output, and regeneration needs the library back from
// git history (`git show <last-commit-with-it>:scripts/lib/model-resolve.sh`, written to the same
// place in the container copy). It refuses to run while the library is missing, and on a host.
//
// Run it in a Linux container that mirrors the CI runner (Ubuntu 24.04, Bash 5.2, Node.js 24).
// Two local images differ only in where Node lives: `i2-proof-a:1` (/usr/local/bin) and
// `i2-proof-b:1` (/opt/hostedtoolcache/node/24.13.1/arm64/bin). Generate in image a into one
// output directory, in image b into another, and `diff -r` them: it MUST be empty before commit.
// The worktree's `.git` is a pointer file, so mount the worktree read-only and copy it:
//
//   docker run --rm -v "$PWD":/src:ro -v "$OUT":/out i2-proof-a:1 \
//     sh -c 'cp -a /src /w && cd /w && rm -f .git && git init -q && \
//       MODEL_RESOLVE_GOLDEN_REGEN=1 node scripts/tests/lib/model-resolve-golden-regen.ts \
//         scripts/tests/fixtures/model-resolve-oracle && \
//       cp -a scripts/tests/fixtures/model-resolve-oracle /out/'
//
// Argument: the golden directory, which must resolve inside this repository checkout. This script
// writes only there; it creates no other path.
//
// It records two things. `ladders.json.golden` comes from sourcing the library. The
// `resolve-<suite>.json.golden` files (outcomes and merge directories of every case group) are
// recorded by running the four conformance suites with MODEL_RESOLVE_GOLDEN_REGEN=1 inherited:
// model-resolve-golden.ts then executes the shell leg instead of replaying it. The container
// needs the mikefarah `yq` besides bash; the argument must be the default fixtures directory.
// The `yq` must be the CI one, v4.54.1 (mount the linux binary over /usr/local/bin/yq): the
// merged documents the shell writes, stored in resolve-org, depend on the yq version.
// component-resolve.sh is recorded the same way into fixtures/component-resolve-oracle/
// (COMPONENT_RESOLVE_GOLDEN_REGEN=1, set below); its goldens need no yq.
// The suites' own assertions may fail while recording; the exit status reports only the recording.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..", "..", "..");

/** `ladders.json.golden`: the three tables the shell library declares, as arrays. */
export function laddersFromShell(): string {
  const script = `. scripts/lib/model-resolve.sh
for t in INTELLIGENCE_RUNGS REASONING_RUNGS ITEM_VOCAB_ORDER; do printf '%s\\0' "\${!t}"; done`;
  const run = spawnSync("bash", ["-c", script], { encoding: "utf8", cwd: REPO });
  if (run.status !== 0) throw new Error(`shell leg failed: ${run.stderr}`);
  const [intelligence, reasoning, items] = run.stdout.split("\0").map((s) => s.split(" "));
  return `${JSON.stringify({ INTELLIGENCE_RUNGS: intelligence, REASONING_RUNGS: reasoning, ITEM_VOCAB_ORDER: items }, null, 2)}\n`;
}

function main(): number {
  if (process.env["MODEL_RESOLVE_GOLDEN_REGEN"] !== "1") {
    process.stderr.write("Error: set MODEL_RESOLVE_GOLDEN_REGEN=1.\n");
    return 1;
  }
  if (process.platform !== "linux") {
    process.stderr.write("Error: run in the Linux golden container, never on a host.\n");
    return 1;
  }
  if (!fs.existsSync(path.join(REPO, "scripts/lib/model-resolve.sh"))) {
    process.stderr.write(
      "Error: scripts/lib/model-resolve.sh is retired; restore it (see header).\n",
    );
    return 1;
  }
  const arg = process.argv[2];
  const dir = arg === undefined ? "" : path.resolve(REPO, arg);
  if (arg === undefined || path.relative(REPO, dir).startsWith("..") || dir === REPO) {
    process.stderr.write("Error: pass the golden directory, inside the repository.\n");
    return 1;
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "ladders.json.golden"), laddersFromShell());
  if (dir !== path.join(REPO, "scripts/tests/fixtures/model-resolve-oracle")) return 0;
  for (const name of ["", "-org", "-mutation", "-root"]) {
    const file = `scripts/tests/build-components-conformance${name}.test.ts`;
    spawnSync("node", ["--test", file], { cwd: REPO, stdio: "ignore", env: process.env });
  }
  // component-resolve.sh: the same technique, one golden file per suite family (spec 0262 R17)
  const components = path.join(REPO, "scripts/tests/fixtures/component-resolve-oracle");
  fs.mkdirSync(components, { recursive: true });
  for (const name of ["component-twins", "component-resolve", "render-collisions"])
    fs.writeFileSync(path.join(components, `${name}.json.golden`), "{}\n"); // drop stale keys
  const suites = [
    "component-twins-conformance",
    "component-twins-conformance-migrate",
    "component-resolve",
    "build-components-conformance-render",
  ];
  for (const name of suites)
    spawnSync("node", ["--test", `scripts/tests/${name}.test.ts`], {
      cwd: REPO,
      stdio: "ignore",
      env: { ...process.env, COMPONENT_RESOLVE_GOLDEN_REGEN: "1" },
    });
  return 0;
}

if (import.meta.main) process.exitCode = main();
