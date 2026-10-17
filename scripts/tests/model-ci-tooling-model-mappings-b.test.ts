// model-ci-tooling-model-mappings-b.test.ts — differential test of the surfaces, grounds
// and offerings passes of scripts/check-model-mappings.ts against the shell (spec 0262
// requirements 1-4, 6, 24). Each case mutates a scratch copy of model-mappings/gemini.yml
// (target gemini, so A13 stays quiet) and compares the rejection lines.

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
const PORTED = /: A[0-9]/;
const roots: string[] = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function repoWith(edit: (t: string) => string, file: string): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-cmmb-")));
  roots.push(root);
  fs.mkdirSync(path.join(root, "scripts", "lib"), { recursive: true });
  fs.copyFileSync(
    path.join(REPO, "scripts", "lib", "model-resolve.sh"),
    path.join(root, "scripts", "lib", "model-resolve.sh"),
  );
  fs.mkdirSync(path.join(root, "model-mappings"));
  const text = fs.readFileSync(path.join(REPO, "model-mappings", file), "utf8");
  fs.writeFileSync(path.join(root, "model-mappings", file), edit(text));
  return root;
}

function rejections(cmd: string, args: string[], repo: string): Promise<string[]> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, LC_ALL: "C", CREWRIG_REPO_DIR: repo },
    });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", () => resolve(stderr.split("\n").filter((l) => PORTED.test(l))));
  });
}

const flags = ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"];
const once =
  (from: string | RegExp, to: string) =>
  (t: string): string => {
    assert.notEqual(t.replace(from, to), t, `mutation did not apply: ${String(from)}`);
    return t.replace(from, to);
  };

const CASES: Array<[string, string, (t: string) => string, string?]> = [
  ["A19 kind outside vocabulary", "A19", once(/kind: frontmatter/, "kind: bogus")],
  ["A27 item outside vocabulary", "A27", once("- item: model\n", "- item: modelx\n")],
  [
    "A21 second frontmatter surface",
    "A21",
    once(
      /(  - id: guidance|\nofferings:)/,
      "  - id: fm2\n    kind: frontmatter\n    items: []\n$1",
    ),
  ],
  ["A8 intelligence outside rungs", "A8", once("intelligence: low", "intelligence: lowest")],
  ["A8 context not a positive integer", "A8", once("specialization: general", "context: 0")],
  [
    "A8 specialization not kebab",
    "A8",
    once("specialization: general", "specialization: Bad_Case"),
  ],
  [
    "A9 native-value outside domain",
    "A9",
    once("native-value: gemini-3.1-flash-lite", "native-value: elsewhere"),
  ],
  [
    "A10 encodes not a key of provides",
    "A10",
    once("      intelligence: flash\n", "      speed: flash\n"),
  ],
  [
    "A10 encodes not a segment",
    "A10",
    once("      intelligence: flash\n", "      intelligence: zzz\n"),
  ],
  ["A15 offering missing a key", "A15", once("    supports-reasoning-surface: false\n", "")],
  ["A3 offering foreign key", "A3", once("    rank: 1\n", "    rank: 1\n    extra: 1\n")],
  [
    "A4 offering without grounds",
    "A4",
    once(
      "    grounds:\n      - declares: native-value",
      "    unused:\n      - declares: native-value",
    ),
  ],
  [
    "A5 grounds neither mark",
    "A5",
    once(
      "      - declares: native-value\n        citation:",
      "      - declares: native-value\n        note:",
    ),
  ],
  [
    "A16 blank citation",
    "A16",
    once(
      /citation: >-\n          RR -> Gemini CLI -> Model-id spelling: `gemini-3.1-flash-lite`\n.*\n/,
      'citation: " "\n',
    ),
  ],
  [
    "A24 two marks for one target",
    "A24",
    once(
      "      - declares: provides.intelligence\n        assumption:",
      "      - declares: native-value\n        assumption: x\n      - declares: provides.intelligence\n        assumption:",
    ),
  ],
  [
    "A25 unresolvable declares",
    "A25",
    once("      - declares: provides.intelligence\n", "      - declares: provides.nonsuch\n"),
  ],
  [
    "A18 guidance item with a key",
    "A18",
    once(/(    template: \|[\s\S]*?items:\n      - item: model\n)/, "$1        key: model\n"),
    "claude.yml",
  ],
  [
    "A20a placeholder set differs",
    "A20a",
    once("{{model}}", "{{model}} {{nothing}}"),
    "claude.yml",
  ],
  [
    "A20b two placeholders in one sentence",
    "A20b",
    once("{{model}} model.\n      Give", "{{model}} model and give"),
    "claude.yml",
  ],
];

describe(
  "surfaces, grounds and offerings passes vs the shell",
  { skip: SKIP, concurrency: 6 },
  () => {
    for (const [name, id, edit, file = "gemini.yml"] of CASES) {
      test(name, async () => {
        const repo = repoWith(edit, file);
        const [sh, ts] = await Promise.all([
          rejections("bash", [SH], repo),
          rejections(process.execPath, [...flags, TS], repo),
        ]);
        assert.deepEqual(ts, sh);
        assert.ok(
          ts.some((l) => l.includes(`: ${id} `)),
          `expected ${id} in ${JSON.stringify(ts)}`,
        );
      });
    }
  },
);
