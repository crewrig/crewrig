// gemini-settings-rig.ts — shared rig of the setup-gemini-settings-*.test.ts suites (spec 0263, ports of
// scripts/tests/test-setup-gemini-settings-merge.sh): a fresh home per case, the R11 oracle spelled out
// as literals (NOT derived from the writer), and the write over `geminiSettingsWrite`.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";

import { geminiSettingsWrite } from "../../lib/setup/gemini-settings.ts";
import { REPO, WINDOWS } from "./worktree-fixtures.ts";

export const FAKE_REPO = "/fake/repo";
export const FAKE_PY = "/opt/crewrig-test/bin/python3";
export const TEMPLATE = path.join(REPO, "config", "gemini", "settings.json");
export const COMMENT_WARN = "holds comments; they are not kept in the rewritten file.";
export const INVALID_WARN =
  "is not a JSON object, even with its comments removed; it was replaced by a fresh configuration.";
export const MODE_SKIP = WINDOWS ? "POSIX mode bits" : false;

export type Json = unknown;
const roots: string[] = [];
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

/** Sorted-key canonical JSON text (the Bash suite's `jq -Sc`). */
export function canon(value: Json): string {
  const sort = (v: Json): Json => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, Json>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => [k, sort(x)]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

const reserved = (py: string): Record<string, Json> => {
  const tls = `${FAKE_REPO}/scripts/lib/tls-exec.sh`;
  return {
    ...(py === ""
      ? {}
      : {
          mempalace: {
            command: "bash",
            args: [tls, py, `${FAKE_REPO}/scripts/lib/mempalace-http-wrapper.py`],
          },
        }),
    sequentialthinking: {
      command: "bash",
      args: [tls, "npx", "-y", "@modelcontextprotocol/server-sequential-thinking"],
    },
  };
};
export const ORACLE_MCP_PY = reserved(FAKE_PY);
export const ORACLE_MCP_NOPY = reserved("");
export const ORACLE_MEMPALACE = ORACLE_MCP_PY["mempalace"];
export const ORACLE_SEQ = ORACLE_MCP_PY["sequentialthinking"];

const template = JSON.parse(fs.readFileSync(TEMPLATE, "utf8")) as Record<string, Json>;
export const TEMPLATE_FILES = (template["context"] as { fileName: string[] }).fileName;
/** The whole absent-file document: the template, mcpServers replaced. */
export const freshDoc = (py: string): string => canon({ ...template, mcpServers: reserved(py) });

export interface Case {
  readonly home: string;
  readonly target: string;
  readonly out: string[];
  readonly err: string[];
  rc: number;
}

export function newCase(): Case {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-gsm-")));
  roots.push(home);
  const target = path.join(home, ".gemini", "settings.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  return { home, target, out: [], err: [], rc: -1 };
}

/** A case whose settings file holds `content`, pre-chmod 0644. */
export function caseWith(content: string | Buffer): Case {
  const c = newCase();
  fs.writeFileSync(c.target, content);
  if (!WINDOWS) fs.chmodSync(c.target, 0o644);
  return c;
}

export function gsWrite(
  c: Case,
  py: string,
  orgNative?: string,
  src: string = TEMPLATE,
  repoDir: string = FAKE_REPO,
): Case {
  const io = { out: (l: string) => void c.out.push(l), err: (l: string) => void c.err.push(l) };
  c.rc = geminiSettingsWrite({
    ctx: { io, platform: process.platform, home: c.home, repoDir },
    settingsTarget: c.target,
    settingsSrc: src,
    python: py,
    ...(orgNative === undefined ? {} : { orgNative }),
  });
  return c;
}

export const readDoc = (c: Case): Record<string, Json> =>
  JSON.parse(fs.readFileSync(c.target, "utf8")) as Record<string, Json>;
export const docText = (c: Case): string => canon(readDoc(c));
export const stdout = (c: Case): string => c.out.join("\n");

export function expectMode600(c: Case): void {
  if (WINDOWS) return;
  assert.equal(fs.statSync(c.target).mode & 0o777, 0o600);
}
export function expectNoTmp(c: Case): void {
  const left = fs
    .readdirSync(path.dirname(c.target))
    .filter((n) => n.startsWith("settings.json.tmp"));
  assert.deepEqual(left, []);
}

/** The warning holding `marker` names a backup beside the target holding the prior bytes. */
export function expectWarningBackup(c: Case, marker: string, original: Buffer | string): void {
  const i = c.out.findIndex((l) => l.includes(marker));
  assert.ok(i >= 0, `no stdout line holds '${marker}': ${stdout(c)}`);
  const line = c.out[i + 1] ?? "";
  const backup = line.replace(/^.*timestamped backup: /, "");
  assert.ok(backup.startsWith(`${c.target}.bak.`), `backup line: '${line}'`);
  assert.deepEqual(fs.readFileSync(backup), Buffer.from(original));
}
