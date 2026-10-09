// windows-task-xml.ts — renders the Task Scheduler XML of one of the two
// MemPalace tasks (spec 0252 requirement 7; PLAN v3 D5 *Action chain per task*).
//
// Each task has ONE action shape, described by a TaskChain:
//   - MCP task: `Command` = node, `Arguments` = the quoted launcher program alone;
//   - ChromaDB task: `Command` = node, `Arguments` = the quoted trust wrapper,
//     then `--end-nonzero-on-child-exit`, then the daemon command exactly as
//     config/systemd/mempalace-chroma-server.service line 9 gives it.
// The template placeholders are __NODE_PATH__, __PROGRAM_PATH__,
// __PROGRAM_ARGS__, __USER_ID__ and __TASK_URI__; a placeholder that survives
// substitution (or that this module does not know) refuses the render.
// The output is UTF-16LE with a byte-order mark, the encoding schtasks reads.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DaemonKind } from "./names.ts";

/** The first words of the Description; followed by the task URI (ownership marker). */
export const TASK_MARKER = "crewrig:service-task";

export const END_NONZERO_FLAG = "--end-nonzero-on-child-exit";

export interface TaskChain {
  readonly kind: DaemonKind;
  /** `process.execPath` of the installer: the task's `Command`. */
  readonly nodePath: string;
  /** The first argument: the launcher (MCP) or the trust wrapper (ChromaDB). */
  readonly programPath: string;
  /** Everything after the program path, one token per element. */
  readonly programArgs: readonly string[];
}

export interface RenderInput {
  readonly chain: TaskChain;
  /** `\CrewRig\<leaf>`. */
  readonly taskUri: string;
  /** `DOMAIN\user` of the current user. */
  readonly userId: string;
  /** Where the templates live; defaults to the repository's config/windows. */
  readonly templateDir?: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_TEMPLATE_DIR = join(HERE, "..", "..", "..", "config", "windows");

const TEMPLATE_FILE: Record<DaemonKind, string> = {
  mcp: "mempalace-mcp-server.xml",
  chroma: "mempalace-chroma-server.xml",
};

/** The MCP chain: the launcher alone behind node. */
export function mcpChain(nodePath: string, launcher: string): TaskChain {
  return { kind: "mcp", nodePath, programPath: launcher, programArgs: [] };
}

/** The ChromaDB chain: wrapper, flag, then `<python> <chroma> run --path ... --host ... --port ...`. */
export function chromaChain(o: {
  nodePath: string;
  wrapper: string;
  python: string;
  chroma: string;
  palacePath: string;
  host?: string;
  port?: string;
}): TaskChain {
  return {
    kind: "chroma",
    nodePath: o.nodePath,
    programPath: o.wrapper,
    programArgs: [
      END_NONZERO_FLAG,
      o.python,
      o.chroma,
      "run",
      "--path",
      o.palacePath,
      "--host",
      o.host ?? "127.0.0.1",
      "--port",
      o.port ?? "8001",
    ],
  };
}

/** `DOMAIN\user` from the environment (`USERNAME` alone when there is no domain). */
export function currentUserId(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const user = env["USERNAME"];
  if (user === undefined || user === "") throw new Error("cannot determine the current user");
  const domain = env["USERDOMAIN"];
  return domain !== undefined && domain !== "" ? `${domain}\\${user}` : user;
}

export function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function xmlUnescape(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x")) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(parseInt(body.slice(1), 10));
    return ENTITY[body] ?? whole;
  });
}

/** CommandLineToArgvW-compatible quoting of one token. */
export function quoteArg(arg: string): string {
  if (arg !== "" && !/[\s"]/.test(arg)) return arg;
  let out = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === "\\") {
      backslashes += 1;
      continue;
    }
    out += ch === '"' ? "\\".repeat(backslashes * 2 + 1) + '"' : "\\".repeat(backslashes) + ch;
    backslashes = 0;
  }
  return `${out}${"\\".repeat(backslashes * 2)}"`;
}

function refuse(label: string, value: string, quoteAllowed = true): void {
  const bad = /[\u0000-\u001f]/.test(value) || (!quoteAllowed && value.includes('"'));
  if (value === "" || bad) throw new RangeError(`invalid ${label}: ${JSON.stringify(value)}`);
}

const PLACEHOLDER_RE = /__[A-Z][A-Z0-9_]*__/g;

/** The XML text of one task. Throws on a placeholder this module does not substitute. */
export function renderTaskXml(input: RenderInput): string {
  const { chain, taskUri, userId } = input;
  refuse("node path", chain.nodePath, false);
  refuse("program path", chain.programPath, false);
  refuse("task URI", taskUri);
  refuse("user id", userId);
  for (const a of chain.programArgs) refuse("argument", a);
  const template = readFileSync(
    join(input.templateDir ?? DEFAULT_TEMPLATE_DIR, TEMPLATE_FILE[chain.kind]),
    "utf8",
  );
  const args = chain.programArgs.map(quoteArg).join(" ");
  const values: Record<string, string> = {
    __NODE_PATH__: xmlEscape(chain.nodePath),
    __PROGRAM_PATH__: xmlEscape(chain.programPath),
    __PROGRAM_ARGS__: xmlEscape(args),
    __USER_ID__: xmlEscape(userId),
    __TASK_URI__: xmlEscape(taskUri),
  };
  // One pass over the TEMPLATE: substituted values are never re-scanned.
  const dropSpace =
    args === "" ? template.replace(" __PROGRAM_ARGS__<", "__PROGRAM_ARGS__<") : template;
  return dropSpace.replace(PLACEHOLDER_RE, (name) => {
    const value = values[name];
    if (value === undefined)
      throw new Error(`unsubstituted placeholder ${name} in the task template`);
    return value;
  });
}

/** UTF-16LE with a byte-order mark. */
export function encodeUtf16le(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
}

/** The bytes to hand to `schtasks /Create /XML`. */
export function renderTaskFile(input: RenderInput): Buffer {
  return encodeUtf16le(renderTaskXml(input));
}

/** Decode a task file: UTF-16LE with a BOM (ours), else UTF-8. */
export function decodeTaskFile(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString("utf16le");
  }
  return bytes.toString("utf8").replace(/^﻿/, "");
}
