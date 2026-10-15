// skill-scripts-golden.ts — the stored form of a skill-script case's observation (spec 0258 R28,
// R29): `fixtures/skill-scripts/<skill>/<script>/<case>/{status,stdout,stderr}.golden`, plus
// `calls.log.golden` when a stub was called, `tmp-left.golden` when the temp directory was not
// left empty, and `files/**` for every file written. Every stored name ends in `.golden` and no
// stored file starts with `#!`, so the ratchet counts nothing. A character outside
// `[A-Za-z0-9._@-]` in a file name is percent-encoded, `dist` and `build` are prefixed (they
// would be hidden by `.gitignore`).
//
// Tagged deviations: a case that carries a deviation tag (spec 0258 R31) may have OVERLAY
// goldens, `<name>.overlay.golden` beside `<name>.golden`, recording the entry's own output
// where the shell golden no longer applies (skill-scripts-golden-regen.ts generates them); the
// entry leg is compared with the overlay when present, the shell leg never is (see `expectedFor`).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { Observed, ResolvedLeg, SkillCase } from "./skill-scripts-observe.ts";

export const GOLDEN_ROOT = path.resolve(import.meta.dirname, "..", "fixtures", "skill-scripts");

const OVERLAY = ".overlay.golden";

/** Stored files, relative to the case directory, with their latin1 content. */
export type GoldenFiles = Map<string, string>;

function encodeSegment(segment: string): string {
  if (segment === "dist" || segment === "build") return `_${segment}`;
  return segment.replace(/[^A-Za-z0-9._@-]/g, (ch) =>
    Array.from(
      Buffer.from(ch, "utf8"),
      (b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`,
    ).join(""),
  );
}

const encode = (rel: string): string => rel.split("/").map(encodeSegment).join("/");

export function caseDir(testCase: Pick<SkillCase, "script" | "name">): string {
  return path.join(GOLDEN_ROOT, ...testCase.script.split("/"), testCase.name);
}

export function goldenFiles(obs: Observed): GoldenFiles {
  const out: GoldenFiles = new Map([
    ["status.golden", `${obs.status}\n`],
    ["stdout.golden", obs.stdout],
    ["stderr.golden", obs.stderr],
  ]);
  if (obs.calls !== "") out.set("calls.log.golden", obs.calls);
  if (obs.tmpLeft.length > 0) out.set("tmp-left.golden", `${obs.tmpLeft.join("\n")}\n`);
  for (const [rel, text] of Object.entries(obs.files)) {
    // A file that starts with `#!` is stored as its hash: the ratchet refuses a shebang file.
    out.set(
      text.startsWith("#!") ? `files/${encode(rel)}.shebang.golden` : `files/${encode(rel)}.golden`,
      text.startsWith("#!")
        ? `sha256 ${crypto.createHash("sha256").update(text, "latin1").digest("hex")}\n`
        : text,
    );
  }
  return out;
}

/** The overlay keys of a stored set: `stdout.overlay.golden`, `files/x.overlay.golden`, ... */
export function overlayKeys(stored: GoldenFiles): string[] {
  return [...stored.keys()].filter((key) => key.endsWith(OVERLAY));
}

/**
 * What a leg is compared with. The shell leg sees the base goldens only; the entry leg sees each
 * overlay in place of the base file it names (or alone, when there is no base file).
 */
export function expectedFor(stored: GoldenFiles, leg: ResolvedLeg): GoldenFiles {
  const out: GoldenFiles = new Map();
  for (const [key, content] of stored) if (!key.endsWith(OVERLAY)) out.set(key, content);
  if (leg === "entry")
    for (const key of overlayKeys(stored))
      out.set(`${key.slice(0, -OVERLAY.length)}.golden`, stored.get(key) as string);
  return out;
}

export function readGolden(testCase: Pick<SkillCase, "script" | "name">): GoldenFiles {
  const out: GoldenFiles = new Map();
  const walk = (dir: string, rel: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const at = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), at);
      else out.set(at, fs.readFileSync(path.join(dir, entry.name)).toString("latin1"));
    }
  };
  walk(caseDir(testCase), "");
  return out;
}

/** Replace the stored base files of a case; overlay files are never touched here. */
export function writeGolden(
  testCase: Pick<SkillCase, "script" | "name">,
  files: GoldenFiles,
): void {
  const dir = caseDir(testCase);
  for (const key of readGolden(testCase).keys())
    if (!key.endsWith(OVERLAY)) fs.rmSync(path.join(dir, ...key.split("/")), { force: true });
  for (const [rel, content] of files) {
    const file = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(content, "latin1"));
  }
}

/** Human-readable differences between two stored sets, empty when equal. */
export function compareGolden(actual: GoldenFiles, expected: GoldenFiles): string[] {
  const out: string[] = [];
  for (const rel of new Set([...actual.keys(), ...expected.keys()])) {
    const a = actual.get(rel);
    const e = expected.get(rel);
    if (a === undefined) out.push(`${rel}: stored but not produced`);
    else if (e === undefined) out.push(`${rel}: produced but not stored`);
    else if (a !== e) out.push(`${rel}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
  }
  return out;
}
