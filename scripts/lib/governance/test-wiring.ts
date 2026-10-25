// test-wiring.ts — logic of check-test-wiring.ts (spec 0076 R1-R5, spec 0259).
//
// Usage: evaluateWiring(repoDir) -> { code, stdout, stderr }
// A `scripts/tests/test-*.sh` script is WIRED iff the token `scripts/tests/<name>`
// appears on a line of a CI surface (`.github/workflows/*.yml|*.yaml`,
// `ci/ci-capabilities.yml`) with no `#` before its FIRST occurrence on that line and
// no name character `[A-Za-z0-9._-]` right after it. Only the first occurrence of a
// line is judged, as the shell twin does. Otherwise the test must be named in
// `ci/test-wiring-exemptions.txt` (`name<WS>reason`).
// A `scripts/tests/*.test.ts` file (issue #1375) is WIRED iff an executed line of a CI surface
// (the surfaces above plus `taskfiles/*.yml` and `Taskfile.yml`, where the Task CI contract
// keeps the commands) names it, literally or through a `scripts/tests/<glob>` it matches, at
// ANY occurrence of the line with no `#` before it. A line that is only a path-filter entry
// (`- "scripts/tests/x.test.ts"`) selects when a job runs, not what it runs, and never wires.
// Exit codes: 0 clean, 1 findings, 2 tests directory missing.
// Finding-line format: the three FAILED blocks of the shell twin, on stderr.

import { readFileSync, readdirSync, statSync } from "node:fs";

import { globToRegExp } from "../glob-engine.ts";

export interface Outcome {
  code: number;
  stdout: string;
  stderr: string;
}

const WS = " \t\n\v\f\r";
const NAME_CHAR = /[A-Za-z0-9._-]/;

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** UTF-16 code unit order, the default sort order. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Names matching the shell glob `<dir>/<prefix>*<suffix>` (a leading dot never matches `*`). */
function globNames(dir: string, prefix: string, suffix: string): string[] {
  return readdirSync(dir)
    .filter(
      (n) =>
        n.length >= prefix.length + suffix.length &&
        n.startsWith(prefix) &&
        n.endsWith(suffix) &&
        !(prefix === "" && n.startsWith(".")),
    )
    .sort(byCodeUnit);
}

/** Contents of every CI surface that exists. */
function readSurfaces(repo: string): string[] {
  const files: string[] = [];
  const workflows = `${repo}/.github/workflows`;
  if (isDir(workflows)) {
    for (const ext of [".yml", ".yaml"])
      for (const n of globNames(workflows, "", ext)) files.push(`${workflows}/${n}`);
  }
  const taskfiles = `${repo}/taskfiles`;
  if (isDir(taskfiles))
    for (const n of globNames(taskfiles, "", ".yml")) files.push(`${taskfiles}/${n}`);
  files.push(`${repo}/ci/ci-capabilities.yml`, `${repo}/Taskfile.yml`);
  return files.filter(isFile).map((f) => readFileSync(f, "utf8"));
}

/** First-occurrence rule: judge only the first `token` of each line. */
function isWired(token: string, surfaces: string[]): boolean {
  for (const text of surfaces) {
    for (const line of text.split("\n")) {
      const at = line.indexOf(token);
      if (at < 0) continue;
      if (line.slice(0, at).includes("#")) continue;
      const next = line.charAt(at + token.length);
      if (next !== "" && NAME_CHAR.test(next)) continue;
      return true;
    }
  }
  return false;
}

const PATH_FILTER_LINE = /^\s*-\s*["']?[^\s"']+["']?\s*$/;
const TESTS_GLOB = /scripts\/tests\/[^\s"'`]*\*[^\s"'`]*/g;

/** Every executed `scripts/tests/...` glob and the literal-token check, over all occurrences. */
function wiredTsTests(names: string[], surfaces: string[]): Set<string> {
  const wired = new Set<string>();
  const globs: RegExp[] = [];
  const lines: string[] = [];
  for (const text of surfaces)
    for (const line of text.split("\n")) {
      if (PATH_FILTER_LINE.test(line)) continue;
      lines.push(line);
      for (const m of line.matchAll(TESTS_GLOB)) {
        if (line.slice(0, m.index).includes("#")) continue;
        try {
          globs.push(globToRegExp(m[0]));
        } catch {
          // A glob outside the engine's forms wires nothing.
        }
      }
    }
  for (const name of names) {
    const token = `scripts/tests/${name}`;
    if (globs.some((g) => g.test(token))) {
      wired.add(name);
      continue;
    }
    for (const line of lines) {
      let at = line.indexOf(token);
      while (at >= 0) {
        const next = line.charAt(at + token.length);
        if (!line.slice(0, at).includes("#") && (next === "" || !NAME_CHAR.test(next))) {
          wired.add(name);
          break;
        }
        at = line.indexOf(token, at + 1);
      }
      if (wired.has(name)) break;
    }
  }
  return wired;
}

interface Exemptions {
  names: Set<string>;
  reasonless: string[];
  stale: string[];
}

function parseExemptions(repo: string, testsDir: string): Exemptions {
  const out: Exemptions = { names: new Set(), reasonless: [], stale: [] };
  const file = `${repo}/ci/test-wiring-exemptions.txt`;
  if (!isFile(file)) return out;
  const lines = readFileSync(file, "utf8").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  for (let line of lines) {
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line === "" || line.startsWith("#")) continue;
    let end = 0;
    while (end < line.length && !WS.includes(line.charAt(end))) end++;
    const name = line.slice(0, end);
    const reason = line
      .slice(end)
      .replace(/^[ \t\n\v\f\r]+/, "")
      .replace(/[ \t\n\v\f\r]+$/, "");
    out.names.add(name);
    if (reason === "") out.reasonless.push(name);
    if (!isFile(`${testsDir}/${name}`)) out.stale.push(name);
  }
  return out;
}

export function evaluateWiring(repo: string): Outcome {
  const testsDir = `${repo}/scripts/tests`;
  if (!isDir(testsDir))
    return { code: 2, stdout: "", stderr: `Error: tests directory not found: ${testsDir}\n` };

  const surfaces = readSurfaces(repo);
  const ex = parseExemptions(repo, testsDir);
  const orphans: string[] = [];
  let wired = 0;
  let exempt = 0;
  for (const name of globNames(testsDir, "test-", ".sh")) {
    if (!isFile(`${testsDir}/${name}`)) continue;
    if (isWired(`scripts/tests/${name}`, surfaces)) wired++;
    else if (ex.names.has(name)) exempt++;
    else orphans.push(name);
  }

  const tsNames = globNames(testsDir, "", ".test.ts").filter((n) => isFile(`${testsDir}/${n}`));
  const tsWired = wiredTsTests(tsNames, surfaces);
  for (const name of tsNames) {
    if (tsWired.has(name)) wired++;
    else if (ex.names.has(name)) exempt++;
    else orphans.push(name);
  }

  let err = "";
  if (orphans.length > 0) {
    err += `FAILED: ${orphans.length} test script(s) run in no CI workflow and are not exempted:\n`;
    for (const n of orphans) err += `  - scripts/tests/${n}\n`;
    err += "\nWire each into a CI workflow (a step in the check-components job of\n";
    err += ".github/workflows/build.yml and ci/ci-capabilities.yml), or add it to\n";
    err += "ci/test-wiring-exemptions.txt with a reason (spec 0076).\n";
  }
  if (ex.reasonless.length > 0) {
    err += `\nFAILED: ${ex.reasonless.length} exemption entr(y/ies) carry no reason:\n`;
    for (const n of ex.reasonless) err += `  - ${n}\n`;
    err +=
      "Every line in ci/test-wiring-exemptions.txt must be '<name.sh><TAB><reason>' (spec 0076 R3).\n";
  }
  if (ex.stale.length > 0) {
    err += `\nFAILED: ${ex.stale.length} exemption entr(y/ies) name a test that no longer exists:\n`;
    for (const n of ex.stale) err += `  - ${n}\n`;
    err += "Remove the stale exemption from ci/test-wiring-exemptions.txt (spec 0076 R5).\n";
  }
  if (err !== "") return { code: 1, stdout: "", stderr: err };
  return {
    code: 0,
    stdout: `OK: all test scripts are wired (${wired}) or exempted with a reason (${exempt}); the exemption allowlist is honest.\n`,
    stderr: "",
  };
}
