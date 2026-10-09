// model-resolve-kit.ts — shared builders of the model-resolve unit suites (spec 0250 R19, R20).
//
// Not a suite: the `model-resolve-*.test.ts` files import it. It builds throwaway repository
// roots under the OS temp directory (removed by `cleanupTmp`, which every suite calls in
// `after`), writes agent-source fixtures like the Bash suite's `write_fixture`, mutates a copy
// of a real `model-mappings/*.yml` through the real `js-yaml`, and wires a `ResolveContext`
// whose environment, pid and temp directory are explicit so no suite reads the machine's.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extractFrontmatter } from "../../../lib/render-command.ts";
import { createResolveContext, mappingInForce, resolveAgent } from "../../../lib/model-resolve.ts";
import type { ResolveContext, ResolveResult } from "../../../lib/model-resolve.ts";
import { docOf, yamlLib, yamlText } from "../../lib/yaml-lib.ts";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
export const TARGETS = ["claude", "gemini", "antigravity", "copilot"] as const;
export { docOf, yamlLib, yamlText };

const made: string[] = [];

/** A fresh directory under the OS temp directory. */
export function mkTmp(prefix = "mres"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `crewrig-${prefix}-`));
  made.push(dir);
  return dir;
}

export function cleanupTmp(): void {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

/** A context plus the standard-error lines it collected. */
export interface Run {
  readonly ctx: ResolveContext;
  readonly err: string[];
}

/** Hermetic context: explicit env, pid and temp directory, stderr captured. */
export function makeRun(
  repoDir: string,
  env: Record<string, string | undefined> = {},
  over: Partial<ResolveContext> = {},
): Run {
  const err: string[] = [];
  const ctx = createResolveContext({
    repoDir,
    yaml: yamlText,
    extractFrontmatter,
    env,
    pid: 4242,
    tmpdir: mkTmp("tmpdir"),
    stderr: (line) => err.push(line),
    ...over,
  });
  return { ctx, err };
}

/** Write one agent source whose `metadata.model` carries the lines (the Bash `write_fixture`). */
export function writeProfile(dir: string, ...lines: string[]): string {
  const file = path.join(dir, "probe.md");
  const model = lines.length === 0 ? [] : ["metadata:", "  model:", ...indent(lines, 4)];
  fs.writeFileSync(
    file,
    ["---", "name: probe", 'description: "Probe agent."', ...model, "---", "Body.", ""].join("\n"),
  );
  return file;
}

function indent(lines: readonly string[], n: number): string[] {
  return lines.flatMap((l) => l.split("\n")).map((l) => " ".repeat(n) + l);
}

/** A repository root holding a copy of the real `model-mappings/`. */
export function realRoot(): string {
  const root = mkTmp("root");
  fs.cpSync(path.join(REPO, "model-mappings"), path.join(root, "model-mappings"), {
    recursive: true,
  });
  return root;
}

/** A root with the real mappings plus `model-mappings/<target>.org.yml` set to `content`. */
export function orgRoot(target: string, content: string): string {
  const root = realRoot();
  fs.writeFileSync(path.join(root, "model-mappings", `${target}.org.yml`), `${content}\n`);
  return root;
}

/** Edit the parsed `<target>.yml` of a copy of the real mappings and write it back. */
export function mutatedRoot(target: string, edit: (doc: Record<string, unknown>) => void): string {
  const root = realRoot();
  const file = path.join(root, "model-mappings", `${target}.yml`);
  const doc = yamlLib.load(fs.readFileSync(file, "utf8"), { schema: yamlLib.CORE_SCHEMA });
  if (typeof doc !== "object" || doc === null) throw new Error("mapping is not a mapping");
  const record = Object.fromEntries(Object.entries(doc));
  edit(record);
  fs.writeFileSync(file, yamlLib.dump(record, { lineWidth: -1 }));
  return root;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The mappings of the sequence at `doc[key]`: the same objects, so an edit sticks. */
export function listOf(doc: Record<string, unknown>, key: string): Array<Record<string, unknown>> {
  const value: unknown = doc[key];
  if (!Array.isArray(value)) throw new Error(`${key} is not a sequence`);
  return value.filter(isRecord);
}

/** `resolveAgent` of the `probe` agent over a fixture. */
export function resolveProbe(run: Run, source: string, target: string): ResolveResult {
  return resolveAgent(run.ctx, "probe", source, target);
}

/** Join fields with the tab the diagnostic format uses. */
export const tab = (...fields: string[]): string => fields.join("\t");

/** A complete org offering as the Bash suite's fixtures write it. */
export function offering(id: string, rank: number | string, native: string, level: string): string {
  return [
    `  - id: ${id}`,
    `    rank: ${rank}`,
    `    native-value: ${native}`,
    "    provides:",
    `      intelligence: ${level}`,
    "      specialization: general",
    "    encodes:",
    `      intelligence: ${id}`,
    "    supports-reasoning-surface: false",
    "    grounds:",
    "      - declares: native-value",
    "        assumption: fixture",
  ].join("\n");
}

/** A repository root whose `model-mappings/` holds exactly these files (name to text). */
export function rootWith(files: Readonly<Record<string, string>>): string {
  const root = mkTmp("root");
  fs.mkdirSync(path.join(root, "model-mappings"), { recursive: true });
  for (const [name, text] of Object.entries(files))
    fs.writeFileSync(path.join(root, "model-mappings", name), text);
  return root;
}

/** The frontmatter surface of the synthetic mappings: model, reasoning (projected), temperature. */
export const FM_ENTRY = [
  "  - id: fm",
  "    kind: frontmatter",
  "    items:",
  "      - {item: model, key: model}",
  "      - item: reasoning",
  "        key: effort",
  "        domain: {values: [low, medium, high]}",
  "        projection: {none: unmapped, low: low, medium: medium, high: high}",
  "      - {item: temperature, key: temperature, domain: {type: number, min: 0.0, max: 2.0}}",
].join("\n");

/** A guidance surface carrying model and reasoning, template lines as given. */
export function gdEntry(...template: string[]): string {
  const lines = template.map((l) => `      ${l}`);
  return [
    "  - id: gd",
    "    kind: guidance",
    "    template: |",
    ...lines,
    "    items:",
    "      - {item: model}",
    "      - {item: reasoning}",
  ].join("\n");
}

/** One synthetic target `t`: these surface entries, these offering lines (flow style), extra top-level text. */
export function miniRoot(
  offeringLines: readonly string[],
  extra = "",
  entries: readonly string[] = [FM_ENTRY],
): string {
  const offers =
    offeringLines.length === 0
      ? "offerings: []"
      : `offerings:\n${offeringLines.map((l) => `  - ${l}`).join("\n")}`;
  return rootWith({
    "t.yml": `target: t\nsurfaces:\n${entries.join("\n")}\n${offers}\n${extra}\n`,
  });
}

/** The outcome of one `mappingInForce`: the handle, the stderr lines, the merge root. */
export interface Merged {
  readonly handle: string;
  readonly err: string[];
  readonly mergeDir: string;
  readonly run: Run;
}

/** `mappingInForce` over a root with a fresh `MAPPING_MERGE_DIR` (or the given one). */
export function mergeOf(root: string, target = "claude", mergeDir = mkTmp("merge")): Merged {
  const run = makeRun(root, { MAPPING_MERGE_DIR: mergeDir });
  const handle = mappingInForce(run.ctx, target);
  return { handle, err: run.err, mergeDir, run };
}

/** A document file read through the CORE schema as plain JavaScript values. */
export function loadFile(file: string): Record<string, unknown> {
  const doc: unknown = yamlLib.load(fs.readFileSync(file, "utf8"), { schema: yamlLib.CORE_SCHEMA });
  return isRecord(doc) ? doc : {};
}

/** The `id` of every element of the sequence at `key`, in document order. */
export function idsOf(file: string, key = "offerings"): string[] {
  const list: unknown = loadFile(file)[key];
  return Array.isArray(list)
    ? list.map((el: unknown) => (isRecord(el) ? String(el["id"]) : ""))
    : [];
}
