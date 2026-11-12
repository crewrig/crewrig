// skill-quality-fixture.ts — a throwaway repository root and a runner for the skill linter tests
// (spec 0293). Shared by check-skill-quality.test.ts and check-skill-quality-contract.test.ts.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";

import { REPO } from "./build-fixture-tree.ts";

export { REPO };

export const ENTRY = path.join(REPO, "scripts", "check-skill-quality.ts");
export const roots: string[] = [];
after(() => {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

export const DESC =
  "Does a thing for a team. Use when a change needs the thing done, or when asked to thing. Not for other work.";
export const front = (over: Record<string, string> = {}): string => {
  const f: Record<string, string> = {
    name: "x",
    description: JSON.stringify(DESC),
    compatibility: JSON.stringify("Requires Node.js 24."),
    ...over,
  };
  return `---\n${Object.entries(f)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")}\n---\n`;
};
export const probes = (n: number, positive: number) =>
  Array.from({ length: n }, (_, i) => ({ query: `q${i}`, should_trigger: i < positive }));
export const evalsJson = (nEvals = 3, probe = probes(6, 3)): string =>
  JSON.stringify({
    skill_name: "x",
    evals: Array.from({ length: nEvals }, (_, i) => ({
      id: i + 1,
      prompt: "p",
      expected_output: "o",
      files: [],
      expectations: ["e"],
    })),
    trigger_probes: probe,
  });

/** A root with one skill `x`; `files` are paths relative to the skill directory. */
export function root(files: Record<string, string>, skillName = "x"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-quality-"));
  roots.push(dir);
  const all = { "SKILL.md": `${front()}\nBody.\n`, ...files };
  for (const [rel, text] of Object.entries(all)) {
    const p = path.join(dir, "artifacts", "core", "skills", skillName, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
  return dir;
}

export function run(dir: string, args: string[] = [], env: Record<string, string> = {}) {
  return spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY, ...args],
    {
      encoding: "utf8",
      env: { ...process.env, ...env, CREWRIG_REPO_DIR: dir },
    },
  );
}
export const rules = (dir: string, args: string[] = []): Map<string, string> => {
  const res = run(dir, ["--json", ...args]);
  const m = new Map<string, string>();
  for (const f of parsed(res.stdout).findings) m.set(f.rule, f.severity);
  return m;
};
export interface Out {
  ok: boolean;
  data: { errors: number; skills: { name: string; protected: boolean }[] } | null;
  findings: { rule: string; message: string; severity: string; skill?: string }[];
}
export const parsed = (stdout: string): Out => JSON.parse(stdout) as Out;
export const protectedFiles = { "evals/evals.json": evalsJson() };
