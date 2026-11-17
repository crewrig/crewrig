// ci-split-proof.ts — runs the R13 equivalence proof of spec 0309 on two commits.
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/ci-split-proof.ts --base <ref> --split <ref>
//   <base> holds ci/ci-capabilities.yml and its generated .gitlab-ci.yml, <split> holds
//   ci/capabilities/*.yml and the regenerated .gitlab-ci.yml (spec 0309 R12(e), R13).
// REPO_DIR overrides the repository root. Exit: 0 proof holds, 1 it does not, 2 usage or git error.

import { execFileSync } from "node:child_process";
import path from "node:path";

import { proveSplit } from "./lib/ci-split/proof.ts";

const repo = process.env["REPO_DIR"] || path.resolve(import.meta.dirname, "..");
const git = (...a: string[]): string =>
  execFileSync("git", a, { cwd: repo, encoding: "utf8", maxBuffer: 1 << 26 });

function main(): number {
  const args = process.argv.slice(2);
  const opt = (n: string): string | undefined => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const base = opt("--base");
  const split = opt("--split");
  if (!base || !split) {
    process.stderr.write("usage: ci-split-proof.ts --base <ref> --split <ref>\n");
    return 2;
  }
  try {
    const names = git("ls-tree", "--name-only", `${split}:ci/capabilities`)
      .split("\n")
      .filter((n) => n !== "");
    const splitFiles = new Map(names.map((n) => [n, git("show", `${split}:ci/capabilities/${n}`)]));
    const result = proveSplit({
      baseReference: git("show", `${base}:ci/ci-capabilities.yml`),
      baseGitlab: git("show", `${base}:.gitlab-ci.yml`),
      splitFiles,
      splitGitlab: git("show", `${split}:.gitlab-ci.yml`),
    });
    process.stdout.write(
      `ci-split-proof: base ${base} split ${split}\n${result.report.join("\n")}\n`,
    );
    return result.ok ? 0 : 1;
  } catch (e) {
    process.stderr.write(`ci-split-proof: ${(e as Error).message}\n`);
    return 2;
  }
}

process.exitCode = main();
