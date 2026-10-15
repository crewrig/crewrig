// create-extension-gap-stubs.ts — a stand-in `scripts/build-extension.ts` for the gap derivation
// branch of the scaffolder (spec 0258 R23): it writes `build/gaps/<NAME>/observed-gaps.json` (or
// no file at all) and stages the three plugin directories inside the scaffold, so the banner, the
// derived `accepted-gaps.json` and the sweep can be compared between the shell and the entry.
// `scripts/build-extension.sh` only forwards to the `.ts`, so this one stub serves both legs.

import { writeFile } from "./create-extension-sandbox.ts";

export const STAGING_DIRS: readonly string[] = [
  "dist-claude-plugin",
  "dist-copilot-plugin",
  "dist-antigravity-plugin",
];

const WITH_HOOK = [
  {
    subject: "hook",
    target: "gemini",
    hook: "SessionStart",
    reason: "no matching event on this target",
  },
];

const TWO_ENTRIES = [
  { subject: "agent", target: "copilot", reason: "tools cannot be mapped" },
  { subject: "hook", target: "antigravity", hook: "PreToolUse", reason: "hooks are unsupported" },
];

/** What the stub writes as the observed gap set: JSON text, or `null` for no file. */
export const GAP_SETS: Readonly<Record<string, string | null>> = {
  "one entry with a hook": JSON.stringify(WITH_HOOK, null, 2),
  "two entries, one without a hook": JSON.stringify(TWO_ENTRIES, null, 2),
  "an empty set": "[]",
  "no observed-gaps file": null,
};

/** A `prepare` step that replaces the builder with the stub. */
export function gapBuilder(observed: string | null): (root: string) => void {
  const source = [
    'const fs = process.getBuiltinModule("node:fs");',
    'const path = process.getBuiltinModule("node:path");',
    "const name = process.argv[process.argv.length - 1];",
    `const observed = ${JSON.stringify(observed)};`,
    "if (observed !== null) {",
    '  const dir = path.join("build", "gaps", name);',
    "  fs.mkdirSync(dir, { recursive: true });",
    '  fs.writeFileSync(path.join(dir, "observed-gaps.json"), observed + "\\n");',
    "}",
    `for (const dir of ${JSON.stringify(STAGING_DIRS)}) {`,
    '  const staged = path.join("extensions", "org", name, dir, "nested");',
    "  fs.mkdirSync(staged, { recursive: true });",
    '  fs.writeFileSync(path.join(staged, "out.txt"), "staged\\n");',
    "}",
    "",
  ].join("\n");
  return (root) => writeFile(root, "scripts/build-extension.ts", source);
}
