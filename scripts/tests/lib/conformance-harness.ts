// conformance-harness.ts — run functions of scripts/lib/common.sh in a
// temporary HOME (spec 0252 requirement 26; plan v2 D4). The shell side of
// the dual-source conformance test.

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
export const FIXTURES = path.join(REPO, "scripts", "tests", "fixtures", "service-conformance");

/** Linux runs it; `SERVICE_CONFORMANCE_ANY_POSIX=1` is a local escape hatch for macOS. */
export const SKIP: string | false =
  process.platform === "linux" || process.env["SERVICE_CONFORMANCE_ANY_POSIX"] === "1"
    ? false
    : "the shell library is compared on Linux only";

export function tempHome(): string {
  return mkdtempSync(path.join(tmpdir(), "conformance-"));
}

/** Source common.sh in `home` and run `body`; returns trimmed stdout. */
export function shell(
  home: string,
  body: string,
  env: Record<string, string> = {},
  pathDirs: readonly string[] = [],
): string {
  const run = spawnSync("bash", ["-c", `source "${REPO}/scripts/lib/common.sh"; ${body}`], {
    encoding: "utf8",
    env: {
      PATH: [...pathDirs, "/usr/bin", "/bin"].join(":"),
      HOME: home,
      CREWRIG_REPO_DIR: REPO,
      ...env,
    },
  });
  if (run.error !== undefined) throw run.error;
  return run.stdout.replace(/\n$/, "");
}

/** An executable script `name` in `dir`. */
export function stub(dir: string, name: string, body: string): void {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
}
