// task-ownership.ts — is an existing Windows task CrewRig's? (spec 0252
// requirement 8; PLAN v3 D5 *Re-run and foreign task*.)
//
// A task is CrewRig's only when BOTH hold: its Description carries
// `crewrig:service-task` followed by the same task URI, AND the first token of
// its Arguments equals the program path of that task's own chain (the launcher
// for the MCP task, the trust wrapper for the ChromaDB task). The Command
// (`process.execPath`) is deliberately not compared: a re-install under another
// Node.js must still recognise its own task.
//
// The definition is read through exec.ts (`schtasks /Query /TN <task> /XML`),
// never through os-inspect.ts: presence is the exit status, no localized text is
// parsed. schtasks writes the XML in the console code page, not UTF-8, so the
// text may carry NUL bytes (UTF-16), a BOM or U+FFFD where a non-ASCII profile
// path was: comparison folds every run of non-ASCII characters on both sides.

import { runManager } from "./exec.ts";
import { TASK_MARKER, xmlUnescape } from "./windows-task-xml.ts";

export interface OwnershipExpectation {
  /** `\CrewRig\<leaf>`. */
  readonly taskUri: string;
  /** The program path of the task's own chain. */
  readonly programPath: string;
}

export type Ownership =
  | { readonly kind: "own" }
  | { readonly kind: "foreign"; readonly reason: string };

/** What `schtasks /Query /XML` gave: absent by exit status, present, or not asked at all. */
export type TaskRead =
  | { readonly kind: "absent" }
  | { readonly kind: "present"; readonly xml: string }
  | { readonly kind: "unavailable"; readonly detail: string };

/** Drop NULs and the BOM (UTF-16 read as bytes), fold non-ASCII runs, unify separators and case. */
export function normalizeForCompare(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/^﻿/, "")
    .replace(/[^\u0000-\u007f]+/g, "?")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function elementText(xml: string, name: string): string | null {
  const m = new RegExp(
    `<(?:[A-Za-z0-9]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9]+:)?${name}>`,
  ).exec(xml.replace(/\u0000/g, ""));
  return m?.[1] === undefined ? null : xmlUnescape(m[1]);
}

/** The first command-line token of an Arguments text (quoted or bare). */
export function firstToken(args: string): string {
  const t = args.trimStart();
  if (t.startsWith('"')) {
    const end = t.indexOf('"', 1);
    return end === -1 ? t.slice(1) : t.slice(1, end);
  }
  return /^\S*/.exec(t)?.[0] ?? "";
}

/** The task URI a Description names after the marker, or `null` when it is not exactly that. */
export function descriptionUri(description: string | null): string | null {
  if (description === null) return null;
  const m = new RegExp(
    `^\\s*${TASK_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(\\S+)\\s*$`,
  ).exec(description);
  return m?.[1] ?? null;
}

/** The expectation a definition about to be installed states about itself, or `null` when malformed. */
export function expectationFromDefinition(xml: string): OwnershipExpectation | null {
  const taskUri = descriptionUri(elementText(xml, "Description"));
  const args = elementText(xml, "Arguments");
  if (taskUri === null || args === null) return null;
  const programPath = firstToken(args);
  return programPath === "" ? null : { taskUri, programPath };
}

/** Classify the definition of an existing task against what its own chain would be. */
export function classifyTask(xml: string, expect: OwnershipExpectation): Ownership {
  const uri = descriptionUri(elementText(xml, "Description"));
  if (uri === null) {
    return {
      kind: "foreign",
      reason: `its Description does not carry ${TASK_MARKER} followed by a task URI`,
    };
  }
  if (normalizeForCompare(uri) !== normalizeForCompare(expect.taskUri)) {
    return { kind: "foreign", reason: `its Description names ${uri}, not ${expect.taskUri}` };
  }
  const args = elementText(xml, "Arguments");
  const first = args === null ? "" : firstToken(args);
  if (normalizeForCompare(first) !== normalizeForCompare(expect.programPath)) {
    return {
      kind: "foreign",
      reason: `its first argument is ${JSON.stringify(first)}, not ${JSON.stringify(expect.programPath)}`,
    };
  }
  return { kind: "own" };
}

/** Read the definition of `taskPath`: exit status zero present, non-zero absent (no text parsed). */
export function readTaskXml(taskPath: string): TaskRead {
  const r = runManager("schtasks", ["/Query", "/TN", taskPath, "/XML"]);
  if (r.kind === "ok") return { kind: "present", xml: r.stdout };
  if (r.kind === "nonzero") return { kind: "absent" };
  return {
    kind: "unavailable",
    detail: `schtasks.exe absent or refused by policy (${r.kind}${r.code === undefined ? "" : ` ${r.code}`})`,
  };
}

export type TaskInspection =
  | TaskRead
  | { readonly kind: "classified"; readonly ownership: Ownership };

/** Read then classify; `absent` and `unavailable` pass through. */
export function inspectTask(taskPath: string, expect: OwnershipExpectation): TaskInspection {
  const read = readTaskXml(taskPath);
  return read.kind === "present"
    ? { kind: "classified", ownership: classifyTask(read.xml, expect) }
    : read;
}
