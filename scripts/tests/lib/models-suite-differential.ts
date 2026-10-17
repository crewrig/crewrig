// models-suite-differential.ts — runs one UNCHANGED models Bash suite through the differential
// wrapper in pure-checker mode (spec 0262 req 21, 23, 26) and returns its outcome. Shared by the
// two per-suite test files so each stays inside the CI time budget.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createDifferential, installWrapper } from "./bash-suite-differential.ts";

export const HAS_YQ = process.platform !== "win32" && spawnSync("yq", ["--version"]).status === 0;
export const SKIP = HAS_YQ ? false : "SKIP: the Bash suites need bash and yq (not on win32)";
const TS_COMMAND = ["node", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"];

/**
 * The yq-absent case runs the script with PATH=/nonexistent-dir-for-this-test, where the wrapper
 * itself cannot find `node`: it has no twin equivalent (the TS twin does not need yq), so the
 * wrapper run reports exactly this one case as FAIL. Req 24 pins the twin's own behaviour.
 */
export const YQ_ABSENT = "FAIL  exit 2 — yq absent from PATH";

/**
 * Documented difference (spec 0262 delta-03 item (i)): the YAML syntax-error TEXT of the A0 case. yq prints the go-yaml message,
 * the twin prints js-yaml's. Only the text after `does not parse as YAML:` is masked (by message); the id `A0`, the file, the rest of
 * stderr, stdout and the exit status must still be equal.
 */
const YAML_MSG = /(: A0 does not parse as YAML: )[^\n]*?\\n/;

function withoutYamlText(diff: string): string[] {
  if (!diff.startsWith("stderr differs:")) return [diff];
  const lines = diff.split("\n").map((l) => l.replace(YAML_MSG, "$1<MSG>\\n"));
  const shell = lines.find((l) => l.startsWith(" shell="))?.slice(7);
  const ts = lines.find((l) => l.startsWith(" ts="))?.slice(4);
  return shell === ts ? [] : [diff];
}

export interface SuiteRun {
  status: number | null;
  out: string;
  diffs: string[];
  calls: number;
  ms: number;
}

interface Entry {
  equal: boolean;
  diffs: string[];
}

export function runSuite(name: string, suite: string): Promise<SuiteRun> {
  const d = createDifferential({ script: `scripts/${name}.sh`, tsCommand: TS_COMMAND });
  const record = installWrapper(d, name, { compareState: false });
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [path.join(d.a, "scripts", "tests", suite)], {
      cwd: d.a,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, LC_ALL: "C", CI: "", NODE_TEST_CONTEXT: "" },
    });
    let out = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.on("error", reject);
    child.on("close", (status) => {
      const entries = fs
        .readFileSync(record, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Entry);
      d.cleanup();
      resolve({
        status,
        out,
        calls: entries.length,
        diffs: entries
          .filter((e) => !e.equal)
          .flatMap((e) => e.diffs)
          .flatMap(withoutYamlText),
        ms: Date.now() - started,
      });
    });
  });
}

export const failLines = (out: string): string[] =>
  out.split("\n").filter((l) => l.startsWith("FAIL"));
