// ci-reference-fixtures.ts — reference texts and the build-ci runner shared by the
// build-ci replacement suites (spec 0265, row J2, P8). Group S roots hold two files:
// the files of `ci/capabilities/` and the generated `.gitlab-ci.yml`; the entry runs from the checkout
// with REPO_DIR pinned, so no tracked file is copied.

import fs from "node:fs";
import path from "node:path";
import {
  LEGACY_REFERENCE,
  REFERENCE_DIR,
  readReference,
} from "../../lib/ci-parity/reference-read.ts";
import { yamlLib } from "./yaml-lib.ts";
import { makeSandbox, REPO, runEntry, type RunResult } from "./governance-sandbox.ts";

export { makeSandbox, REPO, type RunResult };

const TRIGGER_PUSH = "    trigger:\n      - on: push\n        branches: [main]\n";

/** One portable capability with `build` as id; `requires` is a YAML fragment (indented). */
export function oneCapability(requires: string, command: string, id = "build"): string {
  return (
    `capabilities:\n  - id: ${id}\n    name: "Build"\n${TRIGGER_PUSH}` +
    `    portability: portable\n${requires}    command:\n      - ${command}\n`
  );
}

export const NODE22 = "    requires:\n      runtime: node@22\n";
export const VALID_REFERENCE = oneCapability(NODE22, "npm install");
export const UNKNOWN_TOOL_REFERENCE = oneCapability(
  "    requires:\n      tools: [nonexistent-tool]\n",
  "nonexistent-tool --run",
);
export const UNKNOWN_RUNTIME_REFERENCE = oneCapability(
  "    requires:\n      runtime: cobol@85\n",
  "cobc -x main.cob",
);
export const SPECIFIC_REFERENCE =
  `${VALID_REFERENCE}  - id: pages-deploy\n    name: "Deploy to GitHub Pages"\n${TRIGGER_PUSH}` +
  `    portability: specific\n    exception:\n      engine: github-actions\n` +
  `      evidence: "GitHub Pages has no faithful GitLab equivalent."\n`;
export const ENV_REFERENCE =
  `capabilities:\n  - id: lint-specs\n    name: "Lint specs"\n    trigger:\n` +
  `      - on: pull-request\n        branches: [main]\n    portability: portable\n` +
  `    env:\n      BASE_REF: "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"\n    command:\n` +
  `      - task spec:lint\n`;
export const MANUAL_REFERENCE =
  `capabilities:\n  - id: manual-job\n    name: "Manual Job"\n    trigger:\n      - on: manual\n` +
  `    portability: portable\n    command:\n      - echo "manual"\n` +
  `  - id: manual-with-branch\n    name: "Manual Job with Branch"\n    trigger:\n` +
  `      - on: manual\n        branches: [main]\n    portability: portable\n    command:\n` +
  `      - echo "manual branch"\n`;

/**
 * Splits a reference text into the files of `ci/capabilities/` (spec 0309 R2): one `<group>.yml`
 * per group and `standalone.yml` for the ungrouped capabilities, each entry kept verbatim and in
 * text order. Returns null when the text is not a plain block list under one `capabilities:`
 * line. An entry naming a group outside the six goes to `<group>.yml`, a file name the reader
 * refuses by name, so a typo in a fixture fails loudly instead of being read some other way.
 */
export function splitReference(text: string): Map<string, string> | null {
  const lines = text.split("\n");
  const heads = lines.flatMap((l, i) => (/^capabilities:[ \t]*$/.test(l) ? [i] : []));
  if (heads.length !== 1 || lines.some((l) => /^---/.test(l))) return null;
  const body = lines.slice((heads[0] ?? 0) + 1);
  if (body.some((l) => /^[^\s#]/.test(l))) return null;
  const first = body.find((l) => /^\s*- /.test(l));
  if (first === undefined) return null;
  const indent = /^(\s*)/.exec(first)?.[1] ?? "";
  const starts = body.flatMap((l, i) => (l.startsWith(`${indent}- `) ? [i] : []));
  const out = new Map<string, string[]>();
  for (const [n, start] of starts.entries()) {
    let block = body.slice(start, starts[n + 1] ?? body.length);
    if (n + 1 === starts.length && block[block.length - 1] === "") block = block.slice(0, -1);
    const g = block
      .map(
        (l) =>
          new RegExp(`^(?:${indent}- |${indent}  )group:\\s*["']?([\\w-]+)["']?\\s*$`).exec(l)?.[1],
      )
      .find((x) => x !== undefined);
    const key = g ?? "standalone";
    out.set(key, [...(out.get(key) ?? []), ...block]);
  }
  return new Map([...out].map(([k, v]) => [`${k}.yml`, `capabilities:\n${v.join("\n")}\n`]));
}

/**
 * Writes `text` as the reference of `root`: the files of `ci/capabilities/` (any prior reference
 * is removed first). A text `splitReference` declines is written verbatim as the one file
 * `ci/capabilities/gate.yml`, for the reader to refuse.
 */
export function writeReferenceDir(root: string, text: string): void {
  fs.rmSync(path.join(root, REFERENCE_DIR), { recursive: true, force: true });
  fs.rmSync(path.join(root, LEGACY_REFERENCE), { force: true });
  fs.mkdirSync(path.join(root, "ci"), { recursive: true });
  const files = splitReference(text);
  fs.mkdirSync(path.join(root, REFERENCE_DIR), { recursive: true });
  if (files === null) {
    fs.writeFileSync(path.join(root, REFERENCE_DIR, "gate.yml"), text);
    return;
  }
  for (const [name, content] of files)
    fs.writeFileSync(path.join(root, REFERENCE_DIR, name), content);
}

/** The reference text of `root` through the shared reader (its directory). */
export const readReferenceText = (root: string): string => readReference(root).text;

/** Copies the reference directory of `from` into `to`, replacing any there. */
export function copyReference(from: string, to: string): void {
  fs.rmSync(path.join(to, REFERENCE_DIR), { recursive: true, force: true });
  fs.rmSync(path.join(to, LEGACY_REFERENCE), { force: true });
  fs.mkdirSync(path.join(to, "ci"), { recursive: true });
  fs.cpSync(path.join(from, REFERENCE_DIR), path.join(to, REFERENCE_DIR), { recursive: true });
}

const dumpDoc = (doc: unknown): string => yamlLib.dump(doc, { lineWidth: -1, noRefs: true });

/**
 * Loads the reference of `root`, lets `edit` mutate it, and writes it back (comments are dropped).
 * A capability stays in the file that held it while its `group` still names that file's group;
 * one the edit adds or regroups goes to `<group>.yml` (`standalone.yml` without a group), so the
 * reader order of the untouched capabilities does not move.
 */
export function editReference(root: string, edit: (doc: Record<string, unknown>) => void): void {
  const ref = readReference(root);
  const doc = yamlLib.load(ref.text) as Record<string, unknown>;
  edit(doc);
  const byFile = new Map<string, unknown[]>(ref.files.map((f) => [f, []]));
  for (const cap of doc["capabilities"] as Record<string, unknown>[]) {
    const id = String(cap["id"] ?? "");
    const group = cap["group"] === undefined ? "standalone" : String(cap["group"]);
    const held = ref.fileOf.get(id);
    const heldGroup =
      held === undefined ? undefined : path.basename(held).replace(/(-.*)?\.yml$/, "");
    const file = held !== undefined && heldGroup === group ? held : `${REFERENCE_DIR}/${group}.yml`;
    byFile.set(file, [...(byFile.get(file) ?? []), cap]);
  }
  for (const [file, caps] of byFile) {
    if (caps.length === 0) fs.rmSync(path.join(root, file), { force: true });
    else fs.writeFileSync(path.join(root, file), dumpDoc({ capabilities: caps }));
  }
}

/** Replaces the first `from` found in a reference file of `root` with `to`; throws when none holds it. */
export function replaceInReference(root: string, from: string, to: string): void {
  for (const rel of readReference(root).files) {
    const file = path.join(root, rel);
    const text = fs.readFileSync(file, "utf8");
    if (!text.includes(from)) continue;
    fs.writeFileSync(
      file,
      text.replace(from, () => to),
    );
    return;
  }
  throw new Error(`no reference file of ${root} holds: ${from}`);
}

/** A fresh root holding the reference `reference` (see `writeReferenceDir`). */
export function newRoot(reference: string): string {
  const root = makeSandbox("build-ci-");
  writeReferenceDir(root, reference);
  // build-ci reads the Task pin at generation (spec 0282); a root without one fails closed.
  fs.copyFileSync(path.join(REPO, "ci", "task-pin.json"), path.join(root, "ci", "task-pin.json"));
  return root;
}

/** Run `scripts/build-ci.ts` of the checkout against `root` (REPO_DIR). */
export function runBuildCi(root: string, args: readonly string[] = []): RunResult {
  return runEntry(path.join(REPO, "scripts", "build-ci.ts"), {
    args,
    env: { REPO_DIR: root },
  });
}

/** Top-level keys of a generated pipeline, via the real js-yaml. */
export function topLevelKeys(pipelineText: string): string[] {
  // Line-based: the generated pipeline carries GitLab's `!reference` tag, which the plain
  // js-yaml schema rejects; top-level keys sit at column 0.
  return pipelineText
    .split("\n")
    .map((l) => /^([^\s#:-][^:]*):(\s|$)/.exec(l)?.[1])
    .filter((k): k is string => k !== undefined);
}

/** The raw text of one top-level job (from `<id>:` to the next top-level key). */
export function jobText(pipelineText: string, id: string): string {
  const lines = pipelineText.split("\n");
  const start = lines.indexOf(`${id}:`);
  if (start < 0) throw new Error(`job ${id} not found`);
  let end = start + 1;
  while (end < lines.length && (lines[end] === "" || /^[\s#]/.test(lines[end]!))) end += 1;
  return lines.slice(start, end).join("\n");
}
