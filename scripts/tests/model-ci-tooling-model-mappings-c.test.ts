// model-ci-tooling-model-mappings-c.test.ts — differential test of the projection, guard,
// totality and org-override passes of scripts/check-model-mappings.ts against the shell
// (spec 0262 requirements 1-4, 6, 24). Every case writes a scratch repository, runs the
// shell and the twin in parallel under LC_ALL=C, and compares stdout, stderr and status.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { REPO, WINDOWS } from "./lib/worktree-fixtures.ts";

const SH = path.join(REPO, "scripts", "check-model-mappings.sh");
const TS = path.join(REPO, "scripts", "check-model-mappings.ts");
const HAS_YQ = !WINDOWS && spawnSync("yq", ["--version"], { stdio: "ignore" }).status === 0;
const SKIP = HAS_YQ ? false : "SKIP: shell leg needs bash and yq (not on win32)";
const roots: string[] = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

interface Run {
  stdout: string;
  stderr: string;
  status: number | null;
}

function run(cmd: string, args: string[], repo: string): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, LC_ALL: "C", CREWRIG_REPO_DIR: repo },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (status) => resolve({ stdout, stderr, status }));
  });
}

/** A scratch repository holding the real mappings, then `edits` (a file name to its new text). */
function repoWith(
  edits: Record<string, (t: string) => string>,
  extra: Record<string, string> = {},
): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-cmmc-")));
  roots.push(root);
  fs.mkdirSync(path.join(root, "scripts", "lib"), { recursive: true });
  fs.copyFileSync(
    path.join(REPO, "scripts", "lib", "model-resolve.sh"),
    path.join(root, "scripts", "lib", "model-resolve.sh"),
  );
  const dir = path.join(root, "model-mappings");
  fs.mkdirSync(dir);
  for (const name of fs.readdirSync(path.join(REPO, "model-mappings"))) {
    const text = fs.readFileSync(path.join(REPO, "model-mappings", name), "utf8");
    fs.writeFileSync(path.join(dir, name), (edits[name] ?? ((t) => t))(text));
  }
  for (const [name, text] of Object.entries(extra)) fs.writeFileSync(path.join(dir, name), text);
  return root;
}

const once =
  (from: string | RegExp, to: string) =>
  (t: string): string => {
    assert.notEqual(t.replace(from, to), t, `mutation did not apply: ${String(from)}`);
    return t.replace(from, to);
  };

const DIRECTED = once("state: withheld", "state: directed");
const ORG = (body: string): Record<string, string> => ({
  "claude.org.yml": `target: claude\n${body}`,
});

type Case = [string, string, Record<string, (t: string) => string>, Record<string, string>?];
const CASES: Case[] = [
  [
    "A12 projection missing a rung",
    "A12",
    { "claude.yml": once("          max: max\n        grounds:", "        grounds:") },
  ],
  [
    "A12 projection absent",
    "A12",
    { "claude.yml": once(/        projection:\n(          .*\n){6}/, "") },
  ],
  [
    "A9 projection image outside the domain",
    "A9",
    { "claude.yml": once("          low: low\n", "          low: lowest\n") },
  ],
  ["A13 claude without a guard", "A13", { "claude.yml": once(/guard:[\s\S]*$/, "") }],
  [
    "A14a directed guard with blank evidence",
    "A14a",
    {
      "claude.yml": (t) =>
        DIRECTED(t)
          .replace(/holds: true/g, "holds: false")
          .replace(/      evidence: >-\n/g, '      evidence: " "\n      old: >-\n'),
    },
  ],
  [
    "A14b directed guard with a non-citation holds ground",
    "A14b",
    {
      "claude.yml": (t) =>
        DIRECTED(t)
          .replace(/holds: true/g, "holds: false")
          .replace(/(declares: holds\n\s+)citation/g, "$1assumption"),
    },
  ],
  [
    "A17 reasoning surface without a reasoning item",
    "A17",
    {
      "claude.yml": once(
        /      - item: reasoning\n        key: effort[\s\S]*?(?=  - id: guidance)/,
        "",
      ),
    },
  ],
  [
    "A22 guard state outside the vocabulary",
    "A22",
    { "claude.yml": once("state: withheld", "state: maybe") },
  ],
  [
    "A23 withheld guard with no holding term",
    "A23",
    { "claude.yml": once(/holds: true/g, "holds: false") },
  ],
  ["A23 directed guard with a holding term", "A23", { "claude.yml": DIRECTED }],
  [
    "A26 and A11 no offering selectable",
    "A11",
    { "gemini.yml": (t) => t.replace(/ {6}intelligence: (low|medium|high)\n/g, "") },
  ],
  [
    "A3 and A15 zero-offerings shape",
    "A15",
    { "gemini.yml": (t) => `${t}zero-offerings:\n  ground: x\n  stray: 1\n` },
  ],
  [
    "A15 observed-not-declared shape",
    "A15",
    { "gemini.yml": (t) => `${t}observed-not-declared:\n  - native-value: x\n` },
  ],
  ["A28 remove outside the grammar", "A28", {}, ORG("remove:\n  - nonsense/x\n")],
  ["A29 remove names the guard", "A29", {}, ORG("remove:\n  - guard\n  - guard/terms/x\n")],
  [
    "A30 replaces-core with a remove list",
    "A30",
    {},
    ORG("replaces-core: true\nremove:\n  - offerings/haiku\n"),
  ],
  ["A31 remove is not a sequence", "A31", {}, ORG("remove: offerings/haiku\n")],
  ["A31 replaces-core is not a boolean", "A31", {}, ORG("replaces-core: yes please\n")],
  ["A32 org guard with neither id nor state", "A32", {}, ORG("guard:\n  spec: x\n")],
  [
    "A32 org surface with neither kind nor id/template",
    "A32",
    {},
    ORG("surfaces:\n  - items: []\n"),
  ],
  ["org guard state override only", "none", {}, ORG("guard:\n  state: withheld\n")],
];

describe(
  "projection, guard, totality and org passes vs the shell",
  { skip: SKIP, concurrency: 6 },
  () => {
    for (const [name, id, edits, extra] of CASES) {
      test(name, async () => {
        const repo = repoWith(edits, extra);
        const [sh, ts] = await Promise.all([
          run("bash", [SH], repo),
          run(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", TS], repo),
        ]);
        assert.deepEqual(ts, sh);
        if (id !== "none")
          assert.ok(ts.stderr.includes(`: ${id} `), `expected ${id} in ${ts.stderr}`);
      });
    }
  },
);

describe("deviations of requirement 24 (c)", () => {
  test("a null node where the shell's keys call aborts is one Error line and exit 1", async () => {
    // The shell dies silently (exit 1, no message) on `encodes:` with no value.
    const repo = repoWith({
      "gemini.yml": (t) => t.replace(/ {6}intelligence: (flash|pro)\n/g, ""),
    });
    const ts = await run(
      process.execPath,
      ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", TS],
      repo,
    );
    assert.equal(ts.status, 1);
    assert.match(ts.stderr, /Error: .*gemini\.yml: cannot get keys of !!null\n$/);
    assert.equal((ts.stderr.match(/Error:/g) ?? []).length, 1);
  });
});
