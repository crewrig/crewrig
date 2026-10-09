// build-components-conformance-mutation.test.ts — the conformance suites can fail (spec 0250
// scenario 16: "a change made to only one implementation turns the test red, naming the
// pair and the differing output"). Linux only, spawning `bash` and `yq`.
//
// Each mutation is a one-line change to a COPY of the twin sources (never to the tree): the
// copy is imported, run over a small corpus and compared with the shell, which is run once.
// A mutation that no case detects is a failure, and so is an anchor that no longer matches the
// twin (the table then needs the maintenance the twin got). The renderer and the pre-pass are
// compared with the unmutated twin, which their own suite proves equal to the shell over the
// same inputs. A row is `area § id § file § from § to`, `¶` standing for a line feed.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { pathToFileURL } from "node:url";

import { createRenderCommand } from "../lib/render-command.ts";
import { BUILDERS, casesOf, ORG_EDGES } from "./lib/mapping-fixtures.ts";
import {
  checkCase,
  limited,
  parityGate,
  realTwin,
  REPO,
  runShellResolve,
  runTwinResolve,
  type Outcome,
  type ResolveCase,
  type Twin,
} from "./lib/shell-resolve-harness.ts";
import { yamlText } from "./lib/yaml-lib.ts";

const [L, M] = ["scripts/lib/", "scripts/lib/model-resolve/"];
const RANK = 'compareValues(field(p.item, "rank"), field(q.item, "rank")) ||';
const RANK_REVERSED = RANK.replace(
  'p.item, "rank"), field(q.item',
  'q.item, "rank"), field(p.item',
);
const TABLE = String.raw`
resolve § narrowing flipped: context floor > instead of >= § ${M}narrowing.ts § have >= need § have > need
resolve § intelligence floor flipped: > instead of >= § ${L}model-resolve.ts § idx >= declared § idx > declared
resolve § lowest rank becomes highest rank § ${L}model-resolve.ts § a !== null && b !== null && a < b § a !== null && b !== null && a > b
resolve § narrowing abandoned: an emptying narrowing is applied § ${M}narrowing.ts § if (kept.length === 0) { § if (kept.length < 0) {
resolve § merge digest: first separator byte 0 becomes 1 § ${M}merge-root.ts § .update(Buffer.from([0])) § .update(Buffer.from([1]))
resolve § merge sort: offerings by descending rank § ${M}merge-mapping.ts § ${RANK} § ${RANK_REVERSED}
resolve § merge counter: two lines per merge § ${M}merge-mapping.ts § ${"`${target}\\n`"} § ${"`${target}\\n${target}\\n`"}
resolve § diagnostic line: model-drop becomes model-drops § ${M}diagnostics.ts § ["model-drop", § ["model-drops",
resolve § merge note line: an extra space § ${M}merge-mapping.ts § rank=${"${rank}"} offerings= § rank=${"${rank}"}  offerings=
resolve § guidance prose: two spaces between sentences § ${M}guidance.ts § .join(" "); § .join("  ");
render § renderer line: the provenance keyword § ${L}render-command.ts § return ${"`"}# crewrig-provenance: version=" § return ${"`"}# crewrig-provenance: versions="
collision § pre-pass: duplicates reported in reverse order § ${L}component-resolve.ts § .map(([key]) => key)¶    .sort(); § .map(([key]) => key)¶    .sort()¶    .reverse();
collision § pre-pass: the .md suffix stays on the displayed name § ${L}component-resolve.ts § [".md", ".toml", ".json"] § [".toml", ".json"]
`;
interface Mutation {
  readonly area: string;
  readonly id: string;
  readonly file: string;
  readonly from: string;
  readonly to: string;
}
const MUTATIONS: Mutation[] = TABLE.split("\n")
  .filter((l) => l.trim() !== "")
  .map((row) => {
    const [area = "", id = "", file = "", from = "", to = ""] = row
      .split(" § ")
      .map((f) => f.replaceAll("¶", "\n"));
    return { area, id, file, from, to };
  });

const skip = parityGate();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "conformance-mutation-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** A copy of the twin sources with one change, imported as a module. */
async function mutant<T>(m: Mutation, entry: string): Promise<T> {
  const dir = fs.mkdtempSync(path.join(tmp, "copy-"));
  for (const sub of [L, M]) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
    for (const f of fs.readdirSync(path.join(REPO, sub), { withFileTypes: true })) {
      if (f.isFile() && f.name.endsWith(".ts"))
        fs.copyFileSync(path.join(REPO, sub, f.name), path.join(dir, sub, f.name));
    }
  }
  const file = path.join(dir, m.file);
  const text = fs.readFileSync(file, "utf8");
  assert.ok(text.includes(m.from), `${m.id}: anchor not found in ${m.file}`);
  fs.writeFileSync(file, text.replace(m.from, m.to));
  return (await import(pathToFileURL(path.join(dir, entry)).href)) as T;
}

const names = [
  "C1_claude",
  "C4_antigravity",
  "R21_gemini",
  "C5_copilot",
  "x_context",
  "x_axes",
  "x_encoded",
  "O2_replace",
  "O9_duprank",
  "O7_ties",
  "xo_dup-groups",
];
const builders = [...BUILDERS, ...ORG_EDGES].filter((b) => names.includes(b.name));
const reference = new Map<string, { cases: ResolveCase[]; shell: Outcome[]; ms: string }>();
const read = (file: string): string => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
/** What a merge directory holds: the `.merges` lines and the offering ids of each document, in order. */
function snapshot(dir: string): string {
  const digests = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((n) => n !== ".merges")
        .sort()
    : [];
  const docs = digests.flatMap((d) =>
    fs
      .readdirSync(path.join(dir, d))
      .filter((f) => f.endsWith(".yml"))
      .map((f) => {
        const doc = yamlText.parse(read(path.join(dir, d, f)));
        const offerings = (doc?.text as { offerings?: { id?: string }[] } | null)?.offerings ?? [];
        return `${f}:${offerings.map((o) => o.id)}`;
      }),
  );
  return JSON.stringify([read(`${dir}/.merges`), digests, docs]);
}

if (skip === undefined) {
  await limited(
    builders.map((b) => async () => {
      const ms = fs.mkdtempSync(path.join(tmp, "shell-"));
      const cases = casesOf(b, tmp, b.build(tmp), { mergeDir: ms });
      reference.set(b.name, { cases, shell: await runShellResolve(cases), ms });
    }),
  );
}

/** Every difference the corpus sees between the shell and a twin: pair labels with their output. */
function detected(twin: Twin): string[] {
  const out: string[] = [];
  for (const [name, ref] of reference) {
    const mt = fs.mkdtempSync(path.join(tmp, "twin-"));
    const mine = runTwinResolve(
      ref.cases.map((c) => ({ ...c, mergeDir: mt })),
      twin,
    );
    ref.cases.forEach((c, i) => {
      if (name === "x_context" && c.label.includes("#2")) return; // documented: bash's own `[` diagnostic
      out.push(...checkCase(c, ref.shell[i] as Outcome, mine[i] as Outcome, []));
    });
    if (name !== "x_context" && snapshot(mt) !== snapshot(ref.ms))
      out.push(`${name}: the merge directory differs: ${snapshot(mt)} vs ${snapshot(ref.ms)}`);
  }
  return out;
}

describe(
  "the conformance can fail: a mutated copy of the twin is caught",
  skip === undefined ? {} : { skip },
  () => {
    test("the control: the unmutated twin has no difference over the same corpus", () => {
      assert.equal(reference.size, names.length, `builders found: ${[...reference.keys()]}`);
      assert.deepEqual(detected(realTwin), []);
    });

    for (const m of MUTATIONS.filter((x) => x.area === "resolve")) {
      test(m.id, async () => {
        const found = detected(await mutant<Twin>(m, `${L}model-resolve.ts`));
        assert.ok(found.length > 0, `no case detected: ${m.id}`);
        assert.match(
          found[0] ?? "",
          /^[\w()/# .'-]+(\n|: )/,
          "the report starts with the pair or the builder it names",
        );
      });
    }

    test("renderer line: the provenance keyword", async () => {
      const m = MUTATIONS.find((x) => x.area === "render") as Mutation;
      const mod = await mutant<typeof import("../lib/render-command.ts")>(
        m,
        `${L}render-command.ts`,
      );
      const [bad, control] = [mod.createRenderCommand(yamlText), createRenderCommand(yamlText)];
      const source = path.join(REPO, "artifacts/core/commands/init-soul.md");
      assert.notEqual(bad.renderCommandGemini(source), control.renderCommandGemini(source));
      assert.ok(control.renderCommandGemini(source).startsWith("# crewrig-provenance: version="));
    });

    for (const m of MUTATIONS.filter((x) => x.area === "collision")) {
      test(m.id, async () => {
        const mod = await mutant<typeof import("../lib/component-resolve.ts")>(
          m,
          `${L}component-resolve.ts`,
        );
        const real = await import("../lib/component-resolve.ts");
        const dir = path.join(tmp, "collide", "artifacts");
        const files = [
          "library/skills/a/SKILL.md",
          "org/skills/b/SKILL.md",
          "library/policies/pol.md",
          "org/policies/pol.md",
          "library/themes/t.json",
          "org/themes/t.json",
        ];
        for (const rel of files) {
          fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
          fs.writeFileSync(
            path.join(dir, rel),
            rel.endsWith("SKILL.md") ? "---\nname: dup\n---\n" : "x",
          );
        }
        const report = (api: typeof real): string => {
          let text = "";
          api.reportInstalledNameCollisions(dir, (t) => void (text += t));
          return text;
        };
        assert.ok(report(real).includes("Refusing"), "the control tree collides");
        assert.notEqual(report(mod), report(real), m.id);
      });
    }

    test("every mutation id is distinct and the list is not vacuous", () => {
      assert.equal(new Set(MUTATIONS.map((m) => m.id)).size, MUTATIONS.length);
      assert.ok(MUTATIONS.length >= 10, `${MUTATIONS.length} mutations`);
    });
  },
);
