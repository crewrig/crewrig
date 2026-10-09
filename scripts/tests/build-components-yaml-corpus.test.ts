// build-components-yaml-corpus.test.ts — the yq-versus-reader corpus (spec 0250 R11, plan step 14).
//
// Every field the build reads is compared, string for string, between `yq -r` (the shell's
// own expressions, spawned on purpose) and the reader (scripts/lib/yaml-text.ts), on every
// component source and on the awkward-shape fixtures of fixtures/build-components/yaml-corpus/.
// Both sides read the same frontmatter; `$(...)` is reproduced by removing trailing line feeds.
// A difference fails unless the source is a `deviation-*` fixture whose table row names the
// clause and the EXACT yq and reader texts (an unlisted difference fails, and so does a listed
// one that vanished). CRLF and BOM variants are generated in a temporary directory
// (`.gitattributes` forces LF on `*.md`; the fixtures end in `.fixture` so markdownlint does not lint them as prose); they equal yq on the LF original (R33(e)).
// Linux and macOS only (win32 skips); it retires with the last yq-based suite.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { extractFrontmatter, frontmatterOfText } from "../lib/render-command.ts";
import type { YamlDoc } from "../lib/yaml-text.ts";
import { yamlText as Y } from "./lib/yaml-lib.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORPUS = "scripts/tests/fixtures/build-components/yaml-corpus";
const yqVersion =
  process.platform === "win32"
    ? undefined
    : spawnSync("yq", ["--version"], { encoding: "utf8" }).stdout;
const noYq = yqVersion?.includes("mikefarah") ? undefined : "skipped: mikefarah yq not available";

// ── the yq side: the shell's expressions ─────────────────────────────────────
/** `noR`: no `-r` (the shell omits it on `has`); `fallback`: the `|| echo` after a failing yq. */
type Opts = { noR?: boolean; fallback?: string };
const strip = (s: string): string => s.replace(/\n+$/, "");

function runYq(args: string[], input: string): Promise<{ out: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn("yq", args, { stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (out += chunk));
    child.on("close", (code) => resolve({ out, code }));
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });
}

/** `raw` is `extract_frontmatter | yq`; `printf` is `printf '%s\n' "$fm" | yq`. */
function yqRunner(fm: string) {
  const cache = new Map<string, ReturnType<typeof runYq>>();
  const run = (expr: string, form: string, flags: string[]) => {
    const key = [form, ...flags, expr].join("\0");
    const input = form === "raw" && fm === "" ? "" : `${fm}\n`;
    return cache.get(key) ?? cache.set(key, runYq([...flags, expr], input)).get(key)!;
  };
  return {
    /** `$(<pipe> | yq -r EXPR 2>/dev/null)`: stdout with trailing line feeds removed. */
    async text(expr: string, form: "raw" | "printf" = "printf", o: Opts = {}): Promise<string> {
      const { out, code } = await run(expr, form, o.noR === true ? [] : ["-r"]);
      return strip(code !== 0 && o.fallback !== undefined ? `${out}${o.fallback}\n` : out);
    },
    /** `if yq -e EXPR >/dev/null 2>&1`. */
    ok: async (expr: string): Promise<boolean> => (await run(expr, "printf", ["-e"])).code === 0,
  };
}
type Q = ReturnType<typeof yqRunner>;
// ── the probes: one per shell read, each with its reader twin ────────────────
interface Probe {
  label: string;
  yq(q: Q): Promise<string>;
  ts(d: YamlDoc | null): string;
}
const probes: Probe[] = [];
const add = (label: string, yq: Probe["yq"], ts: Probe["ts"]) => probes.push({ label, yq, ts });
/** `yaml_nested`: the text, or empty when it is `null` or empty. */
const nested = (s: string): string => (s === "null" ? "" : s);
const M = ["metadata", "model"];
const P = ["metadata", "provenance"];
const hasYq = (q: Q, expr: string) => q.text(expr, "printf", { noR: true, fallback: "false" });
const hasModel = (q: Q) => hasYq(q, '.metadata // {} | has("model")');
const hasProv = (q: Q) => hasYq(q, '.metadata // {} | has("provenance")');
const yqText = (expr: string, form?: "raw" | "printf") => (q: Q) => q.text(expr, form);
for (const f of ["name", "description", "license", "compatibility"])
  add(`yaml_field .${f}`, yqText(`.${f}`, "raw"), (d) => Y.plain(d, f));
for (const f of ["user-invocable", "disable-model-invocation", "context", "agent"])
  add(
    `yaml_nested .claude.${f}`,
    async (q) => nested(await q.text(`.claude.${f}`, "raw")),
    (d) => nested(Y.plain(d, ["claude", f])),
  );
add("claude.allowed-tools", yqText(".claude.allowed-tools // [] | .[]", "raw"), (d) =>
  strip(Y.seq(d, ["claude", "allowed-tools"]).join("\n")),
);
add("provenance present", hasProv, (d) => String(Y.has(d, P)));
for (const f of ["version", "canonical", "feedback"])
  add(`provenance.${f}`, yqText(`.metadata.provenance.${f} // ""`), (d) => Y.alt(d, [...P, f]));
const ENTRIES = String.raw`.metadata.provenance | to_entries | .[] | "    " + .key + ": \"" + .value + "\""`;
const entryLines = (d: YamlDoc | null): string[] =>
  Y.entries(d, P).map((e) => `    ${e.key}: "${e.text}"`);
add(
  "provenance entries",
  async (q) => ((await hasProv(q)) === "true" ? q.text(ENTRIES) : ""),
  (d) => (Y.has(d, P) ? strip(entryLines(d).join("\n")) : ""),
);
for (const k of ["enable_write_tools", "enable_mcp_tools", "enable_subagent_tools"]) {
  const present = (q: Q) => q.ok(`.antigravity | has("${k}")`);
  add(
    `antigravity has ${k}`,
    async (q) => String(await present(q)),
    (d) => String(Y.has(d, ["antigravity", k])),
  );
  add(
    `antigravity.${k}`,
    async (q) => ((await present(q)) ? q.text(`.antigravity.${k}`) : ""),
    (d) => (Y.has(d, ["antigravity", k]) ? Y.plain(d, ["antigravity", k]) : ""),
  );
}
add("metadata has model", hasModel, (d) => String(Y.has(d, M)));
for (const k of ["intelligence", "reasoning", "specialization", "context", "speed", "locality"])
  add(
    `metadata.model.${k}`,
    async (q) => {
      if ((await hasModel(q)) !== "true") return "";
      if ((await hasYq(q, `.metadata.model // {} | has("${k}")`)) !== "true") return "absent";
      return `present:${await q.text(`.metadata.model.${k}`)}`;
    },
    (d) =>
      !Y.has(d, M) ? "" : !Y.has(d, [...M, k]) ? "absent" : `present:${Y.plain(d, [...M, k])}`,
  );
const modalities = async (q: Q) =>
  (await q.text(".metadata.model.modalities[]?")).replace(/\n/g, " ");
add(
  "metadata.model.modalities",
  async (q) => ((await hasModel(q)) === "true" ? modalities(q) : ""),
  (d) => Y.seq(d, [...M, "modalities"]).join(" "),
);
add(
  "metadata.model.tuning",
  async (q) => {
    if ((await hasModel(q)) !== "true") return "";
    const rows: string[] = [];
    for (const k of (await q.text(".metadata.model.tuning // {} | keys | .[]")).split("\n"))
      if (k !== "") rows.push(`${k}=${await q.text(`.metadata.model.tuning."${k}"`)}`);
    return rows.join("\n");
  },
  (d) =>
    Y.entries(d, [...M, "tuning"])
      .map((e) => `${e.key}=${Y.plain(d, [...M, "tuning", e.key])}`)
      .join("\n"),
);

type Diffs = Record<string, [string, string]>;
const counted = { sources: 0, rows: 0 };
/** Every probe on one source (yq reads `fmYq`, the reader `fmTs`): the labels that differ. */
async function compare(fmYq: string, fmTs: string): Promise<Diffs> {
  const doc = Y.parse(fmTs);
  const q = yqRunner(fmYq);
  const rows = await Promise.all(
    probes.map(async (p) => ({ label: p.label, yq: await p.yq(q), ts: p.ts(doc) })),
  );
  counted.sources += 1;
  counted.rows += rows.length;
  return Object.fromEntries(rows.filter((r) => r.yq !== r.ts).map((r) => [r.label, [r.yq, r.ts]]));
}

// ── the corpus ───────────────────────────────────────────────────────────────
function walk(dir: string): string[] {
  const abs = path.join(REPO, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
const isSource = (f: string): boolean =>
  /(^|\/)(SKILL|AGENT)\.md$/.test(f) || /\/commands\/[^/]+\.md$/.test(f);
const md = (f: string): boolean => f.endsWith(".md");
const sources = [
  ...walk("artifacts").filter(isSource),
  ...walk("tests/fixtures").filter(isSource),
  ...walk("scripts/tests/fixtures/agent-profiles").filter(md),
  ...walk("extensions/core/hello-world/commands").filter(md),
  ...walk(CORPUS).filter((f) => f.endsWith(".fixture")),
];
const lfText = (f: string): string => fs.readFileSync(path.join(REPO, f), "utf8");
const fmOf = (f: string): string => frontmatterOfText(lfText(f));
const both = (f: string): Promise<Diffs> => compare(fmOf(f), fmOf(f));

/** A source `parse` rejects: the reader degrades to the `yq` error text, yq read it. */
const rejected = (name: string, description: string): Diffs => ({
  "yaml_field .name": [name, ""],
  "yaml_field .description": [description, ""],
  "yaml_field .license": ["MIT", ""],
  "yaml_field .compatibility": ["null", ""],
});
/** Documented differences by fixture: the spec clause, then label to [yq text, reader text]. */
const DEVIATIONS: Record<string, { clause: string; diffs: Diffs }> = {
  "deviation-merge-key.fixture": {
    clause: "R11: the pinned schema does not expand `<<`",
    diffs: { "yaml_nested .claude.context": ["from-anchor", ""] },
  },
  "deviation-alias.fixture": {
    clause: "R33(g): the loader expands an alias, yq printed `*shared`",
    diffs: { "yaml_field .license": ["*shared", "one shared text"] },
  },
  "deviation-collection-as-scalar.fixture": {
    clause: "R12: a mapping or sequence read as a scalar renders empty, yq printed YAML",
    diffs: {
      "yaml_field .description": ["key: value", ""],
      "yaml_field .license": ["[a, b]", ""],
      "yaml_nested .claude.context": ["nested: map", ""],
    },
  },
  "deviation-timestamp-provenance.fixture": {
    clause: "NOT in R12 or R33, finding F1: yq's string concatenation fails on a timestamp",
    diffs: {
      "provenance entries": [
        "",
        '    version: "1.0"\n    canonical: "2001-01-01"\n    feedback: "2001-12-14t21:59:43.10-05:00"',
      ],
    },
  },
  "deviation-provenance-collection-entry.fixture": {
    clause: "R12, R33(g): a collection provenance entry is a build error, yq failed",
    diffs: {
      "provenance.canonical": ["key: value", ""],
      "provenance.feedback": ["[a, b]", ""],
      "provenance entries": ["", '    version: "1.0"\n    canonical: ""\n    feedback: ""'],
    },
  },
};

// `parse` is null for these (R33(g): duplicate keys and explicit tags follow the library).
for (const pair of "duplicate-key:second binary-tag:aGVsbG8= int-tag:5".split(" ")) {
  const [f = "", text = ""] = pair.split(":");
  DEVIATIONS[`deviation-${f}.fixture`] = {
    clause: `R33(g): ${f}, the source does not parse`,
    diffs: rejected(`deviation-${f}`, text),
  };
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "yaml-corpus-"));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

describe("yq -r versus the reader, every field the build reads", { skip: noYq }, () => {
  for (const file of sources) {
    if (path.basename(file).startsWith("deviation-")) continue;
    test(`parity: ${file}`, async () => assert.deepEqual(await both(file), {}));
  }

  for (const [name, { clause, diffs }] of Object.entries(DEVIATIONS)) {
    test(`documented deviation (${clause}): ${name}`, async () =>
      assert.deepEqual(await both(`${CORPUS}/${name}`), diffs));
  }
  test("a collection provenance entry is told apart by its kind (R12 exits 1 on it)", () => {
    const doc = Y.parse(fmOf(`${CORPUS}/deviation-provenance-collection-entry.fixture`));
    assert.deepEqual(
      Y.entries(doc, P).map((e) => e.kind),
      ["scalar", "mapping", "sequence"],
    );
  });

  // R33(e): the reader sees CRLF and BOM files as LF; the shell found no frontmatter in them.
  for (const [variant, make] of [
    ["CRLF", (t: string) => t.replace(/\n/g, "\r\n")],
    ["BOM", (t: string) => String.fromCharCode(0xfeff) + t],
  ] as const) {
    const original = `${CORPUS}/${variant === "CRLF" ? "crlf-and-block-scalars" : "bom-basic"}.fixture`;
    test(`deviation R33(e): ${variant} reads as its LF original; the shell read nothing`, async () => {
      const file = path.join(scratch, `${variant}.md`);
      const raw = make(lfText(original));
      fs.writeFileSync(file, raw);
      assert.deepEqual(await compare(fmOf(original), extractFrontmatter(file)), {});
      // What the shell's awk saw: no `---` line, no frontmatter, every field `null`.
      assert.equal(frontmatterOfText(raw), "");
      assert.equal(await yqRunner("").text(".name", "raw"), "null");
    });
  }

  test("the corpus was compared, not skipped (floors computed from the tree)", (t) => {
    const artifacts = walk("artifacts").filter(isSource).length;
    t.diagnostic(`${yqVersion?.trim()}; ${counted.sources} sources, ${counted.rows} comparisons`);
    assert.ok(artifacts >= 45, `only ${artifacts} component sources under artifacts/`);
    assert.equal(counted.sources, sources.length + 2, "a source was not compared");
    assert.ok(counted.rows >= counted.sources * 20, "fewer than 20 field comparisons per source");
    // Every R11 awkward shape has its fixture, and every `deviation-*` fixture a table row.
    const shapes =
      "number-like timestamp-like boolean-like null-spellings empty-value quoted-number block-literal-clip block-literal-strip block-literal-keep block-folded block-folded-strip block-folded-blank-line multi-line-plain multi-line-double-quoted multi-line-single-quoted colon-space-in-quotes long-line non-string-sequence-item crlf-and-block-scalars bom-basic";
    for (const shape of shapes.split(" "))
      assert.ok(
        fs.existsSync(path.join(REPO, CORPUS, `${shape}.fixture`)),
        `fixture ${shape}.fixture`,
      );
    const onDisk = walk(CORPUS).map((f) => path.basename(f));
    assert.deepEqual(
      onDisk.filter((n) => n.startsWith("deviation-")).sort(),
      Object.keys(DEVIATIONS).sort(),
    );
  });
});
