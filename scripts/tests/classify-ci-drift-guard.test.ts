// Spec 0302 R11 drift guard: every message family of the drift-check harness has a sample in
// fixtures/classify-ci-drift-samples.txt, every sample belongs to a family, and no sample is
// `unclassified`. The families come from a static scan of scripts/lib/ci-parity/: the literal
// argument of each `fail(` and `verr(` call and of each literal `validityErrors.push(` call,
// reduced to its normalised template (the first rendered line, each `${...}` replaced by `{}`).
// A new, removed or reworded harness message fails here instead of silently degrading ci-parity.
//
// Samples file format: a `  DRIFT: <message>` line plus the lines indented by four or more spaces
// that follow it, or one `  - <error>` validity bullet. Bullets carry no header in the file; this
// test prepends the `FAILED: n reference-validity violation(s)` header when it classifies them.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const LIB = path.join(REPO, "scripts", "lib", "ci-parity");
const SCRIPT = path.join(REPO, "scripts", "classify-ci-drift.ts");
const SAMPLES = path.join(
  import.meta.dirname,
  "fixtures",
  "classify-ci-drift-samples.txt",
);

/** The one non-literal call site: `verr` is forwarded to the validity-error list. Exempt by exact text. */
const EXEMPT_FILE = "reference.ts";
const EXEMPT_TEXT = "(m) => state.validityErrors.push(m)";

export type Family = "drift" | "bullet";
export interface Site {
  file: string;
  line: number;
  family: Family;
  /** Normalised template, or null when the argument is not a literal. */
  template: string | null;
  exempt: boolean;
}

const OPEN = "([{";
const CLOSE = ")]}";

/** Index just after the string or template literal starting at `i` (quote at `i`). */
function skipLiteral(src: string, i: number): number {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") j += 2;
    else if (c === q) return j + 1;
    else if (q === "`" && c === "$" && src[j + 1] === "{")
      j = skipBraces(src, j + 1);
    else j++;
  }
  throw new Error("unterminated literal");
}
/** Index just after the `{...}` starting at `i`, honouring nested literals. */
function skipBraces(src: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const c = src[j] as string;
    if (c === "'" || c === '"' || c === "`") j = skipLiteral(src, j);
    else {
      if (c === "{") depth++;
      if (c === "}" && --depth === 0) return j + 1;
      j++;
    }
  }
  throw new Error("unterminated ${...}");
}

/** The top-level arguments of the call whose `(` is at `open`, as raw source text. */
function callArgs(src: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  let j = open;
  while (j < src.length) {
    const c = src[j] as string;
    if (c === "'" || c === '"' || c === "`") {
      j = skipLiteral(src, j);
      continue;
    }
    if (c === "/" && src[j + 1] === "/") {
      j = src.indexOf("\n", j);
      continue;
    }
    if (c === "/" && src[j + 1] === "*") {
      j = src.indexOf("*/", j) + 2;
      continue;
    }
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) {
      depth--;
      if (depth === 0) {
        const last = src.slice(start, j).trim();
        if (last !== "") args.push(last);
        return args;
      }
    } else if (c === "," && depth === 1) {
      args.push(src.slice(start, j).trim());
      start = j + 1;
    }
    j++;
  }
  throw new Error("unterminated call");
}

/** The normalised template of `arg`, or null when it is not exactly one string or template literal. */
export function templateOf(arg: string): string | null {
  const q = arg[0];
  if (q !== "'" && q !== '"' && q !== "`") return null;
  if (skipLiteral(arg, 0) !== arg.length) return null;
  let body = "";
  for (let i = 1; i < arg.length - 1;) {
    if (q === "`" && arg[i] === "$" && arg[i + 1] === "{") {
      i = skipBraces(arg, i + 1);
      body += "{}";
    } else body += arg[i++];
  }
  const cut = body.search(/\\n|\n/);
  return cut < 0 ? body : body.slice(0, cut);
}

const HEAD = /(?<![\w.$])(fail|verr)\(|\bvalidityErrors\.push\(/g;

/** Every `fail(`, `verr(` and `validityErrors.push(` call site of `src`, definitions and comments excluded. */
export function scanSource(file: string, src: string): Site[] {
  const sites: Site[] = [];
  for (const m of src.matchAll(HEAD)) {
    const at = m.index as number;
    const lineStart = src.lastIndexOf("\n", at) + 1;
    const before = src.slice(lineStart, at);
    if (/\/\/|^\s*\*|^\s*\/\*/.test(before)) continue;
    if (/\bfunction\s+$/.test(before)) continue;
    const head = m[1] ?? "validityErrors.push";
    const args = callArgs(src, at + m[0].length - 1);
    const arg = head === "fail" ? args[1] : args[0];
    const lineEnd = src.indexOf("\n", at);
    const lineText = src.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
    const template = arg === undefined ? null : templateOf(arg);
    sites.push({
      file,
      line: src.slice(0, at).split("\n").length,
      family: head === "fail" ? "drift" : "bullet",
      template,
      exempt:
        template === null &&
        file === EXEMPT_FILE &&
        head === "validityErrors.push" &&
        arg === "m" &&
        lineText.includes(EXEMPT_TEXT),
    });
  }
  return sites;
}

function scanLib(): Site[] {
  return fs
    .readdirSync(LIB)
    .filter((f) => f.endsWith(".ts"))
    .sort()
    .flatMap((f) => scanSource(f, fs.readFileSync(path.join(LIB, f), "utf8")));
}

interface Sample {
  family: Family;
  first: string;
  lines: string[];
}
function readSamples(): Sample[] {
  const out: Sample[] = [];
  for (const line of fs.readFileSync(SAMPLES, "utf8").split("\n")) {
    if (line === "") continue;
    const d = /^ {2}DRIFT: (.*)$/.exec(line);
    const b = /^ {2}- (.*)$/.exec(line);
    if (d) out.push({ family: "drift", first: d[1] as string, lines: [line] });
    else if (b)
      out.push({ family: "bullet", first: b[1] as string, lines: [line] });
    else if (/^ {4}/.test(line) && out.length > 0)
      out[out.length - 1]?.lines.push(line);
    else assert.fail(`samples file: unrecognised line ${JSON.stringify(line)}`);
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function matcher(template: string): RegExp {
  return new RegExp(`^${template.split("{}").map(escapeRe).join(".*")}$`);
}

// ---------------------------------------------------------------------------
// The scanner itself
// ---------------------------------------------------------------------------

test("scanner: a multi-line call is read across newlines and the template is its first line", () => {
  const src = [
    "function f() {",
    "  fail(",
    "    state,",
    "    `capability '${c.id}' (github-actions): a ${c.yq === \"\" ? DEFAULT : c.yq} b (R3)`,",
    "  );",
    "}",
  ].join("\n");
  const [s, ...rest] = scanSource("x.ts", src);
  assert.equal(rest.length, 0);
  assert.equal(s?.template, "capability '{}' (github-actions): a {} b (R3)");
  assert.equal(s?.line, 2);
  assert.equal(s?.family, "drift");
});

test("scanner: a template stops at the first \\n escape", () => {
  const src =
    "fail(s, `capability '${id}' (github-actions): diverge (R14)\\n    only in the reference:\\n${b}`);";
  assert.equal(
    scanSource("x.ts", src)[0]?.template,
    "capability '{}' (github-actions): diverge (R14)",
  );
});

test("scanner: verr and a literal validityErrors.push are bullet sites; definitions and comments are skipped", () => {
  const src = [
    "export function fail(state: S, message: string): void {}",
    "// fail(state, `commented ${x}`)",
    "verr(`${label}: declares no trigger`);",
    'state.validityErrors.push("reference holds more than one YAML document");',
    "return fail(state, 'plain');",
  ].join("\n");
  assert.deepEqual(
    scanSource("x.ts", src).map((s) => [s.family, s.template]),
    [
      ["bullet", "{}: declares no trigger"],
      ["bullet", "reference holds more than one YAML document"],
      ["drift", "plain"],
    ],
  );
});

test("scanner: a non-literal message is not a template, and only the exact forwarding sink is exempt", () => {
  const sink =
    "caps.forEach((c, i) => check(c, i, seen, (m) => state.validityErrors.push(m)));";
  const [exempt] = scanSource(EXEMPT_FILE, sink);
  assert.equal(exempt?.template, null);
  assert.equal(exempt?.exempt, true);
  assert.equal(
    scanSource("other.ts", sink)[0]?.exempt,
    false,
    "same text in another file",
  );
  assert.equal(
    scanSource(EXEMPT_FILE, "state.validityErrors.push(msg);")[0]?.exempt,
    false,
  );
  assert.equal(
    scanSource(EXEMPT_FILE, "fail(state, message);")[0]?.template,
    null,
  );
  assert.equal(
    scanSource(EXEMPT_FILE, 'fail(state, "a" + b);')[0]?.template,
    null,
    "concatenation",
  );
});

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

test("guard: the scan finds the harness call sites and exempts exactly the forwarding sink", () => {
  const sites = scanLib();
  assert.ok(
    sites.filter((s) => s.family === "drift").length > 0,
    "no fail( site found",
  );
  assert.ok(
    sites.filter((s) => s.family === "bullet").length > 0,
    "no validity site found",
  );
  const bad = sites.filter((s) => s.template === null && !s.exempt);
  assert.deepEqual(
    bad.map((s) => `${s.file}:${s.line}`),
    [],
    "a call site whose message is not a literal cannot be sampled: reword it as a literal",
  );
  assert.equal(
    sites.filter((s) => s.exempt).length,
    1,
    `the exemption of ${EXEMPT_FILE} \`${EXEMPT_TEXT}\` must match exactly once`,
  );
});

test("guard: every call site has a sample, and every sample belongs to a call site", () => {
  const sites = scanLib().filter((s) => s.template !== null);
  const samples = readSamples();
  assert.ok(samples.length > 0);
  const missing = sites.filter(
    (s) =>
      !samples.some(
        (x) =>
          x.family === s.family && matcher(s.template as string).test(x.first),
      ),
  );
  assert.deepEqual(
    missing.map((s) => `${s.file}:${s.line} ${s.template}`),
    [],
    "harness message with no sample in classify-ci-drift-samples.txt",
  );
  const orphans = samples.filter(
    (x) =>
      !sites.some(
        (s) =>
          s.family === x.family && matcher(s.template as string).test(x.first),
      ),
  );
  assert.deepEqual(
    orphans.map((x) => x.first),
    [],
    "sample that matches no harness message (a message was removed or reworded)",
  );
});

function classifySamples(text: string) {
  const r = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", SCRIPT, "--json", "-"],
    { encoding: "utf8", input: text },
  );
  assert.equal(r.status, 1, r.stderr + r.stdout);
  const o = JSON.parse(r.stdout) as {
    data: {
      count: number;
      records: { kind: string; engine: string | null; text: string }[];
    };
  };
  return o.data;
}

test("guard: no sample is unclassified, and the samples cover every rule", () => {
  const samples = readSamples();
  const drift = samples.filter((x) => x.family === "drift");
  const bullets = samples.filter((x) => x.family === "bullet");
  const d = classifySamples(drift.flatMap((x) => x.lines).join("\n") + "\n");
  const b = classifySamples(
    [
      "FAILED: " +
        bullets.length +
        " reference-validity violation(s) in /repo/ci/ci-capabilities.yml:",
    ]
      .concat(bullets.flatMap((x) => x.lines))
      .join("\n") + "\n",
  );
  assert.equal(d.count, drift.length, "one record per DRIFT sample");
  assert.equal(b.count, bullets.length, "one record per bullet sample");
  const unclassified = [...d.records, ...b.records].filter(
    (r) => r.kind === "unclassified",
  );
  assert.deepEqual(
    unclassified.map((r) => r.text.split("\n")[0]),
    [],
    "a harness message the classifier cannot classify",
  );
  const seen = new Set(
    [...d.records, ...b.records].map((r) => `${r.kind}/${r.engine}`),
  );
  for (const want of [
    "stale-derived-pipeline/gitlab",
    "untraceable-job/github-actions",
    "untraceable-job/gitlab",
    "reference-drift/reference",
    "hand-authored-drift/github-actions",
    "hand-authored-drift/gitlab",
    "evidence-less-exception/reference",
  ]) {
    assert.ok(
      seen.has(want),
      `no sample reaches ${want}; got ${[...seen].sort().join(", ")}`,
    );
  }
  assert.ok(
    drift.some((x) => /portable set but absent from/.test(x.first)),
    "rule 5 sample (absent from a platform)",
  );
  assert.ok(
    drift.some((x) => /has no 'group'|not one of/.test(x.first)),
    "rule 6 samples (group)",
  );
  assert.ok(
    drift.some((x) => /^job '[^']*' is in /.test(x.first)),
    "rule 7 samples (placement)",
  );
  assert.ok(
    drift.some((x) => x.first.includes("(reference)")),
    "rule 3 samples ((reference) records)",
  );
});
