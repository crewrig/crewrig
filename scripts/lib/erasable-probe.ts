// erasable-probe.ts — child process for scripts/lib/erasable-syntax.ts, layers 2 and 3.
//
// Run as:
//   node --experimental-vm-modules --disable-warning=ExperimentalWarning \
//        --disable-warning=MODULE_TYPELESS_PACKAGE_JSON erasable-probe.ts <root> <rel>...
//
// For each file it runs Node's own `stripTypeScriptTypes` in strip mode
// (layer 2), then parses the stripped output as an ES module with V8
// (layer 3), which is what catches a decorator: both `tsc`'s
// erasableSyntaxOnly and the stripper accept one, and V8 rejects it.
// It prints one JSON array of ProbeResult on stdout. It lives in its own
// process because `vm.SourceTextModule` needs --experimental-vm-modules and
// `stripTypeScriptTypes` prints an ExperimentalWarning otherwise.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import vm from "node:vm";

export interface ProbeResult {
  file: string;
  /** Construct named by an ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX from the stripper. */
  stripConstruct?: string;
  /** V8 rejected the stripped module: its 1-based line and that line's text. */
  parseError?: { line: number | null; text: string };
}

const CONSTRUCTS: ReadonlyArray<[RegExp, string]> = [
  [/\benum\b/i, "enum"],
  [/\bnamespace\b/i, "namespace"],
  [/\bparameter propert/i, "parameter-property"],
  [/\bimport equals\b/i, "import-equals"],
];

function errorCode(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err && typeof err.code === "string")
    return err.code;
  return "";
}

/** V8's line for a syntax error, via `node --check` on the stripped source. */
function syntaxErrorLine(stripped: string): number | null {
  const res = spawnSync(process.execPath, ["--input-type=module", "--check"], {
    input: stripped,
    encoding: "utf8",
  });
  const m = /\[stdin\]:(\d+)/.exec(res.stderr ?? "");
  return m?.[1] === undefined ? null : Number(m[1]);
}

function probe(root: string, rel: string): ProbeResult {
  const src = readFileSync(path.join(root, rel), "utf8");
  let stripped: string;
  try {
    stripped = stripTypeScriptTypes(src, { mode: "strip" });
  } catch (err) {
    if (errorCode(err) !== "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX") return { file: rel };
    const message = err instanceof Error ? err.message : String(err);
    const hit = CONSTRUCTS.find(([re]) => re.test(message));
    return { file: rel, stripConstruct: hit?.[1] ?? "non-erasable" };
  }
  try {
    new vm.SourceTextModule(stripped, { identifier: rel });
    return { file: rel };
  } catch {
    const line = syntaxErrorLine(stripped);
    const text = line === null ? "" : (stripped.split("\n")[line - 1] ?? "");
    return { file: rel, parseError: { line, text } };
  }
}

const [root = ".", ...files] = process.argv.slice(2);
process.stdout.write(JSON.stringify(files.map((rel) => probe(root, rel))));
