// check-ratchet.ts — shell / JavaScript / Python footprint ratchet (spec 0238 R1-R3).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-ratchet.ts [--write]
//
// Check mode (default):
//   - state: every tracked shell file outside the built-copy trees is listed
//     in ci/shell-allowlist.txt, and every entry still is such a file;
//   - state: every tracked *.js/*.mjs/*.cjs file outside the built-copy trees
//     is listed in ci/js-baseline.txt or justified in ci/js-exceptions.txt;
//   - hygiene: every list is sorted and unique, with no blank entry line;
//   - diff vs the merge-base with BASE_REF: no entry is added to
//     ci/shell-allowlist.txt or ci/js-baseline.txt, and every added *.py file
//     imports the `mempalace` library.
// --write: regenerates the two shrink-only lists — the full computed set when
//   the list is absent on the merge-base (bootstrap), otherwise the existing
//   entries intersected with the computed set, so a list can never grow.
//
// Exit: 0 clean, 1 findings, 2 wiring fault (unresolvable explicit BASE_REF,
// missing or unreadable list file).
// Finding lines: `ratchet: <rule-id>: <path>[:<line>]: <message>`.

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  JS_BASELINE,
  JS_EXCEPTIONS,
  SHELL_LIST,
  computeSets,
  finding,
  findings,
  parseListQuiet,
  readList,
  writeLists,
} from "./lib/ratchet-lists.ts";
import {
  WiringError,
  git,
  inBuiltTree,
  isJsFile,
  isShellFile,
  repoRoot,
  resolveBase,
  showAt,
  trackedFiles,
} from "./lib/ts-scope.ts";

const EXCEPTION_CATEGORIES = ["node-floor-guard", "tool-config"];
const PY_IMPORT = /^\s*import\s+([\w.]+(\s+as\s+\w+)?\s*,\s*)*mempalace\b/m;
const PY_FROM = /^\s*from\s+mempalace(\.\w+)*\s+import\b/m;

function checkShell(shell: string[], trackedSet: Set<string>): void {
  const entries = readList(SHELL_LIST, false, false);
  const listed = new Set(entries.map((e) => e.value));
  for (const p of shell) {
    if (!listed.has(p)) {
      finding(
        "shell-unlisted",
        p,
        `shell file not in ${SHELL_LIST}; new code is TypeScript (spec 0238 R1), and the allowlist never grows`,
      );
    }
  }
  for (const e of entries) {
    if (!trackedSet.has(e.value) || inBuiltTree(e.value) || !isShellFile(e.value)) {
      finding(
        "shell-stale-entry",
        `${SHELL_LIST}:${e.line}`,
        `'${e.value}' is no longer a tracked shell file; delete this entry in the same PR`,
      );
    }
  }
}

function checkJs(js: string[], trackedSet: Set<string>, specIds: Set<string>): void {
  const baseline = readList(JS_BASELINE, false, false);
  const exceptions = readList(JS_EXCEPTIONS, true, true);
  const listed = new Set([...baseline, ...exceptions].map((e) => e.value));
  for (const p of js) {
    if (!listed.has(p)) {
      finding(
        "js-unlisted",
        p,
        `JavaScript file outside ${JS_BASELINE}; spec 0238 R3 only permits the Node.js floor guard ` +
          `(node-floor-guard) or a tool-mandated configuration file (tool-config), justified in ${JS_EXCEPTIONS}`,
      );
    }
  }
  for (const [rel, list] of [
    [JS_BASELINE, baseline],
    [JS_EXCEPTIONS, exceptions],
  ] as const) {
    for (const e of list) {
      if (!trackedSet.has(e.value) || inBuiltTree(e.value) || !isJsFile(e.value)) {
        finding(
          "js-stale-entry",
          `${rel}:${e.line}`,
          `'${e.value}' is no longer a tracked JavaScript file; delete this entry in the same PR`,
        );
      }
    }
  }
  for (const e of exceptions) {
    const [category = "", specId = ""] = e.reason.split(/\s+/);
    if (
      !EXCEPTION_CATEGORIES.includes(category) ||
      !/^\d{4}$/.test(specId) ||
      !specIds.has(specId)
    ) {
      finding(
        "js-exception-unjustified",
        `${JS_EXCEPTIONS}:${e.line}`,
        `'${e.value}' needs a reason '<node-floor-guard|tool-config> <NNNN> <text>' citing an existing specs/NNNN-*.md`,
      );
    }
  }
}

function checkListGrowth(mergeBase: string): void {
  for (const [rel, rule] of [
    [SHELL_LIST, "shell-entry-added"],
    [JS_BASELINE, "js-entry-added"],
  ] as const) {
    const onBase = showAt(mergeBase, rel);
    if (onBase === null) continue;
    const before = new Set(parseListQuiet(onBase));
    for (const e of readList(rel, false, false)) {
      if (!before.has(e.value)) {
        finding(
          rule,
          `${rel}:${e.line}`,
          `'${e.value}' was added; this list may only shrink (spec 0238 R1, R3)`,
        );
      }
    }
  }
}

/** Python files added (or renamed/copied into place) since the merge-base. */
function addedPython(mergeBase: string): string[] {
  const res = git(["diff", "--name-status", "-M", "-z", mergeBase]);
  if (res.status !== 0)
    throw new WiringError(`git diff against ${mergeBase} failed: ${res.stderr.trim()}`);
  const parts = res.stdout.split("\0");
  const added: string[] = [];
  for (let i = 0; i < parts.length;) {
    const status = parts[i] ?? "";
    if (status === "") break;
    const twoPaths = status.startsWith("R") || status.startsWith("C");
    const target = parts[i + (twoPaths ? 2 : 1)] ?? "";
    if ((status === "A" || twoPaths) && target.endsWith(".py") && !inBuiltTree(target))
      added.push(target);
    i += twoPaths ? 3 : 2;
  }
  return added;
}

function checkPython(mergeBase: string): void {
  for (const rel of addedPython(mergeBase)) {
    let src = "";
    try {
      src = readFileSync(path.join(repoRoot(), rel), "utf8");
    } catch {
      continue;
    }
    if (!PY_IMPORT.test(src) && !PY_FROM.test(src)) {
      finding(
        "py-no-mempalace",
        rel,
        "added Python file does not import the mempalace library; only mempalace-bound Python may be added (spec 0238 R3)",
      );
    }
  }
}

function main(): number {
  if (process.argv.includes("--write")) {
    writeLists();
    return 0;
  }
  const tracked = trackedFiles();
  const trackedSet = new Set(tracked);
  const specIds = new Set(
    tracked.flatMap((p) => {
      const m = /^specs\/(\d{4})-[^/]*\.md$/.exec(p);
      return m?.[1] === undefined ? [] : [m[1]];
    }),
  );
  const { shell, js } = computeSets(tracked);
  checkShell(shell, trackedSet);
  checkJs(js, trackedSet, specIds);
  const base = resolveBase();
  if (base === null) {
    console.log("ratchet: note: no base ref resolves; list-growth and Python diff arms skipped");
  } else {
    checkListGrowth(base.mergeBase);
    checkPython(base.mergeBase);
  }
  for (const f of findings) console.log(f);
  if (findings.length > 0) {
    console.log(
      `ratchet: ${findings.length} finding(s); see DEVELOPMENT.md (TypeScript toolchain and ratchet)`,
    );
    return 1;
  }
  console.log(
    `ratchet: OK (${shell.length} allowlisted shell files, ${js.length} baseline/excepted JS files)`,
  );
  return 0;
}

try {
  process.exitCode = main();
} catch (err) {
  const detail =
    err instanceof WiringError
      ? err.message
      : err instanceof Error
        ? (err.stack ?? err.message)
        : String(err);
  console.error(`ratchet: error: ${detail}`);
  process.exitCode = 2;
}
