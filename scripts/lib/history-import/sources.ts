// sources.ts — one descriptor per CLI whose history the importers backfill into MemPalace (spec
// 0253 R11-R15). Each descriptor carries what differs between the four shell predecessors: the
// banner title, the source variable and default, the stream of the Error lines, the messages, the
// counting and summary block, and the directory handed to `mempalace mine`. The shared skeleton
// lives in flow.ts.

import fs from "node:fs";
import path from "node:path";

import { stageHistoryFile } from "./antigravity-staging.ts";
import { countNonEmptyLines, countSubdirs, listFiles, totalBytes } from "./count.ts";
import { humanSize } from "./size.ts";

/** What the importer found in the source: the summary lines, or the nothing-to-import line. */
export interface Inspection {
  /** Printed instead of the summary and the rest of the run, exit 0; absent when there are sessions. */
  readonly empty?: string;
  readonly summary: readonly string[];
}

/** A directory handed to `mine`, removed by `dispose` on every path. */
export interface MineSource {
  readonly dir: string;
  dispose(): void;
}

export interface ImportDescriptor {
  /** The banner title line, e.g. `Claude Code → MemPalace history import`. */
  readonly title: string;
  /** Variable overriding the source location; empty counts as unset. */
  readonly sourceVar: string;
  readonly defaultSource: (home: string) => string;
  readonly defaultAgent: string;
  /** Stream of every `Error:` line: Antigravity writes them to standard error, the others to standard output. */
  readonly errStream: "out" | "err";
  /** True when `source` is the kind of path the CLI keeps (a directory, or for Antigravity a file). */
  readonly isSource: (source: string) => boolean;
  readonly missing: (source: string) => readonly [string, string];
  readonly inspect: (source: string) => Inspection;
  /** The directory `mine` reads; the source itself unless the CLI needs staging. */
  readonly mineSource: (source: string) => MineSource;
}

const isDir = (p: string): boolean => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

const isFile = (p: string): boolean => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

const inPlace = (source: string): MineSource => ({ dir: source, dispose: () => {} });
const override = (name: string): string =>
  `Override with ${name}=<path> if your install uses a different location.`;

const claude: ImportDescriptor = {
  title: "Claude Code → MemPalace history import",
  sourceVar: "CLAUDE_PROJECTS_DIR",
  defaultSource: (home) => path.join(home, ".claude", "projects"),
  defaultAgent: "claude-code",
  errStream: "out",
  isSource: isDir,
  missing: (source) => [
    `Error: Claude projects directory not found: ${source}`,
    override("CLAUDE_PROJECTS_DIR"),
  ],
  inspect: (source) => {
    const sessions = listFiles(source, (name) => name.endsWith(".jsonl"));
    if (sessions.length === 0)
      return {
        empty: `No .jsonl session files found under ${source} — nothing to import.`,
        summary: [],
      };
    return {
      summary: [
        `Source:       ${source}`,
        `Projects:     ${countSubdirs(source)}`,
        `Sessions:     ${sessions.length} files (~${humanSize(totalBytes(sessions))})`,
      ],
    };
  },
  mineSource: inPlace,
};

const gemini: ImportDescriptor = {
  title: "Gemini CLI → MemPalace history import",
  sourceVar: "GEMINI_TMP_DIR",
  defaultSource: (home) => path.join(home, ".gemini", "tmp"),
  defaultAgent: "gemini-cli",
  errStream: "out",
  isSource: isDir,
  missing: (source) => [
    `Error: Gemini tmp directory not found: ${source}`,
    override("GEMINI_TMP_DIR"),
  ],
  inspect: (source) => {
    const sessions = listFiles(
      source,
      (name) => name.startsWith("session-") && name.endsWith(".json"),
    );
    const logs = listFiles(source, (name) => name === "logs.json");
    if (sessions.length === 0 && logs.length === 0)
      return {
        empty: `No session-*.json or logs.json files found under ${source} — nothing to import.`,
        summary: [],
      };
    return {
      summary: [
        `Source:        ${source}`,
        `Projects:      ${countSubdirs(source)}`,
        `Session files: ${sessions.length}`,
        `Logs files:    ${logs.length}`,
        `Total size:    ~${humanSize(totalBytes([...sessions, ...logs]))}`,
      ],
    };
  },
  mineSource: inPlace,
};

const copilot: ImportDescriptor = {
  title: "GitHub Copilot CLI → MemPalace history import",
  sourceVar: "COPILOT_SESSIONS_DIR",
  defaultSource: (home) => path.join(home, ".copilot", "session-state"),
  defaultAgent: "copilot-cli",
  errStream: "out",
  isSource: isDir,
  missing: (source) => [
    `Error: Copilot session directory not found: ${source}`,
    override("COPILOT_SESSIONS_DIR"),
  ],
  inspect: (source) => {
    const events = listFiles(source, (name) => name === "events.jsonl");
    if (events.length === 0)
      return {
        empty: `No events.jsonl files found under ${source} — nothing to import.`,
        summary: [],
      };
    return {
      summary: [
        `Source:       ${source}`,
        `Sessions:     ${countSubdirs(source)} directories`,
        `Transcripts:  ${events.length} files (~${humanSize(totalBytes(events))})`,
      ],
    };
  },
  mineSource: inPlace,
};

const antigravity: ImportDescriptor = {
  title: "Antigravity CLI → MemPalace history import",
  sourceVar: "ANTIGRAVITY_HISTORY_FILE",
  defaultSource: (home) => path.join(home, ".gemini", "antigravity-cli", "history.jsonl"),
  defaultAgent: "antigravity-cli",
  errStream: "err",
  isSource: isFile,
  missing: (source) => [
    `Error: Antigravity CLI history file not found: ${source}`,
    override("ANTIGRAVITY_HISTORY_FILE"),
  ],
  inspect: (source) => ({
    summary: [
      `Source:        ${source}`,
      `Records:       ${countNonEmptyLines(source)}`,
      `File size:     ~${humanSize(totalBytes([source]))}`,
    ],
  }),
  // `mempalace mine` reads a directory: the history file is staged into a temporary one
  mineSource: (source) => stageHistoryFile(source),
};

export const SOURCES: Readonly<Record<string, ImportDescriptor>> = {
  claude,
  gemini,
  copilot,
  antigravity,
};
