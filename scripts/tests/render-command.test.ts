// render-command.test.ts — unit suite for scripts/lib/render-command.ts (spec 0250 R10, R18).
//
// Real sources (every SKILL.md, AGENT.md, commands/*.md, plus the hello-world command)
// are checked structurally; synthetic ones carry the edge cases with the exact string the
// shell printed. The shell is the oracle (R14): where it disagrees with R10's prose
// (no line-1 fence, yet a body after the second `---`) the SHELL is pinned.
// A small parity set runs the shell on Linux (the exhaustive one is the conformance
// suite's). Strings carry no trailing LF; an unreadable source throws.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  bodyOfText,
  createRenderCommand,
  extractBody,
  extractFrontmatter,
  frontmatterOfText,
} from "../lib/render-command.ts";
import { yamlText } from "./lib/yaml-lib.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const R = createRenderCommand(yamlText);
const BOM = String.fromCharCode(0xfeff);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "render-command-test-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
function src(text: string): string {
  const file = path.join(fs.mkdtempSync(path.join(tmp, "s")), "src.md");
  fs.writeFileSync(file, text);
  return file;
}

const hello = path.join(REPO, "extensions", "core", "hello-world", "commands", "hello.md");
const realSources = fs
  .globSync(
    ["artifacts/*/skills/*/SKILL.md", "artifacts/*/agents/*/AGENT.md", "artifacts/*/commands/*.md"],
    { cwd: REPO },
  )
  .sort()
  .map((rel) => path.join(REPO, rel));
realSources.push(hello);

const yq = spawnSync("yq", ["--version"], { encoding: "utf8" }).stdout ?? "";
const parityOk =
  (process.platform === "linux" || process.env["CREWRIG_SHELL_PARITY"] === "1") &&
  yq.includes("mikefarah") &&
  spawnSync("bash", ["--version"]).status === 0;
const noShell = parityOk ? undefined : "skipped: needs Linux with bash and mikefarah yq";
/** A library function as the shell printed it; helpers lose trailing LFs as `$(...)` did. */
function sh(fn: string, ...args: string[]): string {
  const script = `. "${REPO}/scripts/lib/render-command.sh"; out=$(${fn} "$@"; printf x); printf '%s' "\${out%x}"`;
  const r = spawnSync("bash", ["-c", script, "x", ...args], { encoding: "utf8" });
  return /_(gemini|claude)$/.test(fn) ? r.stdout : r.stdout.replace(/\n+$/, "");
}

const FENCED = "---\ndescription: f\n---\nintro\n```\n---\nx: y\n---\n```\nend\n";
const FENCED_BODY = "intro\n```\n---\nx: y\n---\n```\nend";
type Row = readonly [name: string, text: string, frontmatter: string, body: string];
const rows: readonly Row[] = [
  ["plain source", "---\na: 1\n---\nbody\n", "a: 1", "body"],
  ["a bare --- inside a fenced body belongs to the body", FENCED, "description: f", FENCED_BODY],
  ["no line-1 fence: no frontmatter, yet the shell has a body", "x\n---\ny\n---\nz\n", "", "z"],
  ["unclosed frontmatter runs to the end, no body", "---\nn: u\ntail\n", "n: u\ntail", ""],
  ["empty file", "", "", ""],
  ["a lone fence", "---\n", "", ""],
  ["late fence: line 1 is blank", "\n---\nn: x\n---\nbody\n", "", "body"],
  ["three fences: the third stays in the body", "---\nn: n\n---\nA\n---\nB\n", "n: n", "A\n---\nB"],
  ["empty body", "---\na: 1\n---\n", "a: 1", ""],
  ["no final newline", "---\na: 1\n---\nbody", "a: 1", "body"],
  [
    "trailing blank lines dropped, inner kept",
    "---\na: 1\n\n\n---\nb\n\nc\n\n\n",
    "a: 1",
    "b\n\nc",
  ],
  ["a fence followed by a blank is not a fence", "--- \na: 1\n---\nb\n", "", ""],
  ["CRLF is read as LF", "---\r\na: 1\r\n---\r\nb\r\nc\r\n", "a: 1", "b\nc"],
  ["a byte-order mark is dropped", `${BOM}---\na: 1\n---\nb\n`, "a: 1", "b"],
  ["BOM and CRLF together", `${BOM}---\r\na: 1\r\n---\r\nb\r\n`, "a: 1", "b"],
];

describe("extractFrontmatter and extractBody (R10)", () => {
  for (const [name, text, fm, body] of rows)
    test(name, () => {
      const file = src(text);
      assert.deepEqual([extractFrontmatter(file), extractBody(file)], [fm, body]);
      assert.deepEqual([R.extractFrontmatter(file), R.extractBody(file)], [fm, body]);
      if (!text.includes("\r") && !text.includes(BOM))
        assert.deepEqual([frontmatterOfText(text), bodyOfText(text)], [fm, body]);
    });
  test("an unreadable source throws where the shell printed a diagnostic and went on", () => {
    const missing = path.join(tmp, "absent.md");
    const calls = [
      () => extractFrontmatter(missing),
      () => extractBody(missing),
      () => R.yamlField(missing, "name"),
      () => R.renderCommandGemini(missing),
      () => R.renderCommandClaude(missing),
    ];
    for (const call of calls) assert.throws(call, { code: "ENOENT" });
  });
});

describe("yamlField: the yq -r text of a frontmatter field", () => {
  const field = (fm: string, f: string): string => R.yamlField(src(`---\n${fm}\n---\nb\n`), f);
  test("number-like and boolean-like values keep their written text", () => {
    const fm = "name: 1.0\ndescription: True\nlicense: 007";
    assert.deepEqual(
      ["name", "description", "license"].map((f) => field(fm, f)),
      ["1.0", "True", "007"],
    );
  });
  test("an absent key reads null, an empty value reads empty, an unparseable source reads empty", () => {
    assert.deepEqual(
      [field("license: MIT", "name"), field("name:", "name"), field("name: [", "name")],
      ["null", "", ""],
    );
  });
  test("a folded description is joined and its trailing LFs removed", () => {
    assert.equal(
      field("description: >\n  one\n  two\n\n  three\nx: y", "description"),
      "one two\nthree",
    );
  });
  test("a dotted path walks maps", () => {
    assert.equal(
      field("metadata:\n  provenance:\n    version: 1.0", "metadata.provenance.version"),
      "1.0",
    );
  });
});

/** A command source whose frontmatter holds `metadata:` and the given lines under it. */
const withMetadata = (...lines: string[]): string =>
  `---\nname: p\ndescription: d\nmetadata:${lines.map((l) => `\n  ${l}`).join("")}\n---\nb\n`;
const prov = (...fields: string[]): string =>
  withMetadata("provenance:", ...fields.map((f) => `  ${f}`));
const EMPTY = 'version="" canonical="" feedback=""';
const provRows: readonly (readonly [string, string, string])[] = [
  [
    "three strings",
    prov('version: "1.2.3"', 'canonical: "https://x/c"', 'feedback: "https://x/f"'),
    'version="1.2.3" canonical="https://x/c" feedback="https://x/f"',
  ],
  [
    "0 survives, false and ~ do not",
    prov("version: 0", "canonical: false", "feedback: ~"),
    'version="0" canonical="" feedback=""',
  ],
  [
    "1.0 and True keep their text",
    prov("version: 1.0", "canonical: True", 'feedback: ""'),
    'version="1.0" canonical="True" feedback=""',
  ],
  ["partial", prov('version: "1"'), 'version="1" canonical="" feedback=""'],
  ["empty map still has provenance", withMetadata("provenance: {}"), EMPTY],
  ["null provenance still has the key", withMetadata("provenance:"), EMPTY],
  ["scalar provenance", withMetadata("provenance: hello"), EMPTY],
];
const noProvRows: readonly (readonly [string, string])[] = [
  ["no metadata", "---\nname: p\n---\nb\n"],
  ["scalar metadata", "---\nname: p\nmetadata: hello\n---\nb\n"],
  ["sequence metadata", "---\nname: p\nmetadata: [a, b]\n---\nb\n"],
  ["null metadata", "---\nname: p\nmetadata:\n---\nb\n"],
  ["metadata without provenance", withMetadata("other: 1")],
  ["unparseable frontmatter", "---\nname: [\n---\nb\n"],
  ["empty file", ""],
];

describe("provenance comment and the Gemini form (R18)", () => {
  for (const [name, text, fields] of provRows)
    test(`provenance: ${name}`, () => {
      const comment = `# crewrig-provenance: ${fields}`;
      assert.equal(R.renderCommandTomlProvenanceComment(frontmatterOfText(text)), comment);
      const gemini = R.renderCommandGemini(src(text));
      assert.equal(gemini, `${comment}\ndescription = "d"\n\nprompt = """\nb\n"""`);
    });
  for (const [name, text] of noProvRows)
    test(`no provenance: ${name}`, () => {
      assert.equal(R.renderCommandTomlProvenanceComment(frontmatterOfText(text)), "");
      assert.ok(R.renderCommandGemini(src(text)).startsWith("description = "));
    });
  test("golden: a quote in the description is not escaped, as the shell does not", () => {
    const out = R.renderCommandGemini(src("---\ndescription: 'say \"hi\"'\n---\nA\nB\n"));
    assert.equal(out, 'description = "say "hi""\n\nprompt = """\nA\nB\n"""');
  });
  test("empty body, no final newline, fenced body, CRLF and BOM", () => {
    const gemini = (text: string): string => R.renderCommandGemini(src(text));
    assert.equal(gemini("---\ndescription: d\n---\n"), 'description = "d"\n\nprompt = """\n\n"""');
    assert.equal(
      gemini("---\ndescription: d\n---\nt"),
      'description = "d"\n\nprompt = """\nt\n"""',
    );
    const absent = gemini("x\n---\ny\n---\nz\n");
    assert.equal(absent, 'description = "null"\n\nprompt = """\nz\n"""');
    const lf = gemini(FENCED);
    assert.equal(lf, `description = "f"\n\nprompt = """\n${FENCED_BODY}\n"""`);
    for (const variant of [BOM + FENCED, FENCED.replace(/\n/g, "\r\n")])
      assert.equal(gemini(variant), lf);
  });
});

describe("the Claude form (R18)", () => {
  const claude = (tools: string): string =>
    R.renderCommandClaude(
      src(`---\nname: t\ndescription: "d"\nclaude:\n  allowed-tools:${tools}\n---\nbody\n`),
    );
  const plain = '---\nname: t\ndescription: "d"\nuser-invocable: true\n---\n\nbody';
  const withTools = (...t: string[]): string =>
    plain.replace("true\n", `true\nallowed-tools:\n${t.map((x) => `  - ${x}`).join("\n")}\n`);
  test("golden: a list of tools", () => {
    assert.equal(claude("\n    - Read\n    - Bash(git *)"), withTools("Read", "Bash(git *)"));
  });
  test("mixed scalars keep their text; an empty element inside stays, a final one goes", () => {
    const tools = '\n    - Read\n    - 5\n    - ""\n    - Write\n    - ""';
    assert.equal(claude(tools), withTools("Read", "5", "", "Write"));
  });
  test("an empty list, null, an all-empty list and a scalar emit no allowed-tools", () => {
    for (const t of [" []", "", ' [""]', " Read"]) assert.equal(claude(t), plain, t);
  });
  test("no claude key; a name like 1.0; with no frontmatter the name reads null", () => {
    const head = (name: string, d: string): string =>
      `---\nname: ${name}\ndescription: "${d}"\nuser-invocable: true\n---\n\n`;
    assert.equal(
      R.renderCommandClaude(src("---\nname: 1.0\ndescription: d\n---\nb\n")),
      `${head("1.0", "d")}b`,
    );
    assert.equal(R.renderCommandClaude(src("x\n---\ny\n---\nz\n")), `${head("null", "null")}z`);
  });
});

describe("real sources", () => {
  test("the corpus is found", () => assert.ok(realSources.length > 30, String(realSources.length)));
  for (const file of realSources)
    test(`${path.relative(REPO, file)}: the six functions agree with one another`, () => {
      const fm = extractFrontmatter(file);
      const body = extractBody(file);
      assert.notEqual(fm, "");
      assert.notEqual(body, "");
      const name = R.yamlField(file, "name");
      const description = R.yamlField(file, "description");
      assert.notEqual(name, "null");
      const hasProvenance = yamlText.has(yamlText.parse(fm), ["metadata", "provenance"]);
      assert.equal(R.renderCommandTomlProvenanceComment(fm) !== "", hasProvenance);
      const gemini = R.renderCommandGemini(file);
      assert.equal(gemini.startsWith("# crewrig-provenance: "), hasProvenance);
      assert.ok(gemini.includes(`description = "${description}"\n\nprompt = """\n`));
      assert.ok(gemini.endsWith(`\n${body}\n"""`));
      const claude = R.renderCommandClaude(file);
      assert.ok(
        claude.startsWith(
          `---\nname: ${name}\ndescription: "${description}"\nuser-invocable: true\n`,
        ),
      );
      assert.ok(claude.endsWith(`\n---\n\n${body}`));
    });
});

describe("parity with the shell library", { skip: noShell }, () => {
  const tools = (list: string): string =>
    `---\nname: t\ndescription: d\nclaude:\n  allowed-tools:${list}\n---\nb\n`;
  const synthetic = [
    ...rows.map((r) => r[1]),
    ...provRows.map((r) => r[1]),
    ...noProvRows.map((r) => r[1]),
    tools('\n    - Read\n    - ""\n    - Write'),
    tools("\n    a: x\n    b: y"),
  ];
  test("each synthetic source above through all six functions (CRLF and BOM against the LF original)", () => {
    for (const text of synthetic) {
      const lf = text.replace(BOM, "").replace(/\r\n/g, "\n");
      const file = src(text);
      const oracle = src(lf);
      const fm = sh("extract_frontmatter", oracle);
      const pairs: readonly (readonly [string, string])[] = [
        [extractFrontmatter(file), fm],
        [extractBody(file), sh("extract_body", oracle)],
        [R.yamlField(file, "description"), sh("yaml_field", oracle, "description")],
        [
          R.renderCommandTomlProvenanceComment(fm),
          sh("render_command_toml_provenance_comment", fm),
        ],
        [R.renderCommandGemini(file), sh("render_command_gemini", oracle)],
        [R.renderCommandClaude(file), sh("render_command_claude", oracle)],
      ];
      for (const [got, want] of pairs) assert.equal(got, want, JSON.stringify(text));
    }
  });
  test("the hello-world command and a real skill", () => {
    for (const file of [hello, realSources[0] ?? hello]) {
      assert.equal(R.renderCommandGemini(file), sh("render_command_gemini", file));
      assert.equal(R.renderCommandClaude(file), sh("render_command_claude", file));
    }
  });
});
