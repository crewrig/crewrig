// evidence.ts — the evidence rule of the judge (spec 0290 R13 as modified by delta-01).
//
// The judge answers each expectation with `VERDICT=.. CONF=..` then `EVIDENCE=<JSON string>`.
// An expectation is `passed: true` only when the verdict is PASS and the evidence is valid:
// at least 12 non-whitespace characters and either an exact substring of the run's transcript.md
// or of a file the run produced (line endings normalised), or a `path:line` reference naming a
// produced file and an existing line of it. Anything else is an unsupported PASS.
//
// Usage: validateEvidence(evidence, { transcript, files }) -> { ok } | { ok: false, reason }
// Exit codes: not applicable (library). Finding-line format: not applicable.

import fs from "node:fs";
import path from "node:path";

import { EVIDENCE_MIN_CHARS } from "./settings.ts";

export interface ProducedFile {
  /** Path relative to the run's outputs/ directory, `/` separators. */
  readonly rel: string;
  readonly content: string;
}

export interface EvidenceMaterial {
  readonly transcript: string;
  readonly files: readonly ProducedFile[];
}

const norm = (s: string) => s.replaceAll("\r\n", "\n").replaceAll("\r", "\n");

/** The `EVIDENCE=<JSON string>` value of a judge answer; undefined when there is none. */
export function parseEvidence(text: string): string | undefined {
  const m = /^[ \t]*EVIDENCE=(.*)$/m.exec(text);
  if (m === null) return undefined;
  const rest = (m[1] ?? "").trim();
  try {
    const v: unknown = JSON.parse(rest);
    if (typeof v === "string") return v;
  } catch {
    // not a JSON string: fall through to the raw remainder
  }
  return rest === "" ? undefined : rest;
}

export function validateEvidence(
  evidence: string | undefined,
  material: EvidenceMaterial,
): { ok: true } | { ok: false; reason: string } {
  if (evidence === undefined || evidence.trim() === "")
    return { ok: false, reason: "no evidence was given" };
  if (evidence.replace(/\s/g, "").length < EVIDENCE_MIN_CHARS)
    return {
      ok: false,
      reason: `evidence has fewer than ${EVIDENCE_MIN_CHARS} non-whitespace characters`,
    };
  const needle = norm(evidence);
  if (norm(material.transcript).includes(needle)) return { ok: true };
  for (const f of material.files) if (norm(f.content).includes(needle)) return { ok: true };
  const ref = /^(.+):(\d+)$/.exec(evidence.trim());
  if (ref !== null) {
    const rel = (ref[1] ?? "").replace(/^\.?\/?(outputs\/)?/, "");
    const line = Number(ref[2]);
    const file = material.files.find((f) => f.rel === rel);
    if (file !== undefined && line >= 1 && line <= norm(file.content).split("\n").length)
      return { ok: true };
  }
  return {
    ok: false,
    reason:
      "evidence occurs in neither the transcript nor a produced file, and is not a path:line of a produced file",
  };
}

/** Read the text files a run produced under `outputsDir` (bounded), for the judge and the evidence rule. */
export function readProducedFiles(outputsDir: string, maxBytes = 1_000_000): ProducedFile[] {
  const out: ProducedFile[] = [];
  const walk = (dir: string) => {
    let names: fs.Dirent[];
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of names.sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && fs.statSync(abs).size <= maxBytes)
        out.push({
          rel: path.relative(outputsDir, abs).split(path.sep).join("/"),
          content: fs.readFileSync(abs, "utf8"),
        });
    }
  };
  walk(outputsDir);
  return out;
}
