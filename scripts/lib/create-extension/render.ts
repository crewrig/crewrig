// render.ts — derive the scaffold's gap declaration from one real render (spec 0258 R23).
// Twin of create-extension.sh :213-241: run `node scripts/build-extension.ts --target all <NAME>`
// from the repository root with its output discarded, copy a non-empty observed gap set to
// `accepted-gaps.json` with the review banner, then sweep the three plugin staging directories.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { parseJson } from "../extension/json-ordered.ts";
import type { Io, JsonValue } from "../extension/types.ts";

const RULE = "=".repeat(62);
const STAGING_DIRS = ["dist-claude-plugin", "dist-copilot-plugin", "dist-antigravity-plugin"];

/** The text of one `jq` field used with `+`: a string, or "" when absent or null. */
function text(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function entryLine(entry: JsonValue): string {
  const field = (key: string): JsonValue | undefined =>
    entry instanceof Map ? entry.get(key) : undefined;
  const hook = field("hook");
  const hookPart =
    hook === undefined || hook === null || hook === false ? "" : ` (hook: ${text(hook)})`;
  return `  - ${text(field("subject"))} on ${text(field("target"))}${hookPart}: ${text(field("reason"))}`;
}

function entriesOf(value: JsonValue): JsonValue[] {
  if (Array.isArray(value)) return value;
  return value instanceof Map ? [...value.values()] : [];
}

/** Returns the exit status: 0, or the render's own failing status (the shell's `set -e`). */
export function deriveGaps(
  repoDir: string,
  tier: string,
  name: string,
  target: string,
  io: Io,
): number {
  io.out("");
  io.out("Rendering the scaffold once to derive its gap declaration...");
  const run = spawnSync(
    process.execPath,
    [path.join("scripts", "build-extension.ts"), "--target", "all", name],
    { cwd: repoDir, stdio: "ignore" },
  );
  if (run.status !== 0) return run.status ?? 1;

  const observed = path.join(repoDir, "build", "gaps", name, "observed-gaps.json");
  if (fs.existsSync(observed) && fs.statSync(observed).isFile()) {
    const entries = entriesOf(parseJson(fs.readFileSync(observed, "utf8"), observed));
    if (entries.length > 0) {
      const accepted = path.join(target, "accepted-gaps.json");
      fs.copyFileSync(observed, accepted);
      io.out("");
      io.out(RULE);
      io.out(" REVIEW: this scaffold declares a gap the render could not map.");
      io.out(` extensions/${tier}/${name}/accepted-gaps.json was DERIVED from the`);
      io.out(" render's own observed gap set below. Review each entry before");
      io.out(" committing it — it is a starting point, not a rubber stamp.");
      io.out(RULE);
      for (const entry of entries) io.out(entryLine(entry));
    }
  }
  for (const dir of STAGING_DIRS)
    fs.rmSync(path.join(target, dir), { recursive: true, force: true });
  return 0;
}
