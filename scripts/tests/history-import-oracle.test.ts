// history-import-oracle.test.ts — behavioural oracle for the four history
// importers (spec 0253, PLAN v3 step A2, delta-01 R26). It drives
// `bash scripts/import-{claude,gemini,copilot,antigravity}-history.sh` as black
// boxes under the hermetic harness and MUST pass unchanged against the shell
// scripts today and against the shims to the TypeScript entries after PR C.
// Scripted answers go through stdin AND the `fzf` stub (dual channel). Every
// case asserts that `python3` saw only `-c import mempalace.mcp_server` or
// `-m mempalace mine ...`, that the poison MEMPALACE_PYTHON never ran (spec R14:
// the importers ignore it), and that the script left nothing in its TMPDIR.
// The size shown by `du -h` is asserted by shape only (spec deviation 3).
// POSIX only: skipped on win32.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  runImport,
  writeFiles,
  type ImportOptions,
  type ImportOutcome,
} from "./lib/import-oracle-lib.ts";

const SIZE = "[0-9.]+[BKMGT]?";
const PROBE = "-c import mempalace.mcp_server";

interface Cli {
  readonly cli: string;
  readonly agent: string;
  readonly sourceVar: string;
  readonly sourceName: string;
  readonly errStream: "stdout" | "stderr";
  readonly populate: (dir: string) => void;
  /** Creates a source that exists but holds no session; absent when the script has no such branch. */
  readonly empty?: (dir: string) => void;
  readonly emptyMessage?: (dir: string) => string;
  readonly missingMessage: (src: string) => string;
  readonly summary: readonly RegExp[];
  /** True when `arg` is the directory the script hands to `mine`. */
  readonly mineSource: (arg: string, source: string) => boolean;
}

const CLIS: readonly Cli[] = [
  {
    cli: "claude",
    agent: "claude-code",
    sourceVar: "CLAUDE_PROJECTS_DIR",
    sourceName: "claude-projects",
    errStream: "stdout",
    populate: (dir) =>
      writeFiles(dir, { "p1/a.jsonl": "{}\n", "p1/b.jsonl": "{}\n", "p2/c.jsonl": "{}\n" }),
    empty: (dir) => fs.mkdirSync(path.join(dir, "p1"), { recursive: true }),
    emptyMessage: (dir) => `No .jsonl session files found under ${dir} — nothing to import.`,
    missingMessage: (src) =>
      `Error: Claude projects directory not found: ${src}\n` +
      "Override with CLAUDE_PROJECTS_DIR=<path> if your install uses a different location.",
    summary: [/^Projects: {5}2$/m, new RegExp(`^Sessions: {5}3 files \\(~${SIZE}\\)$`, "m")],
    mineSource: (arg, source) => arg === source,
  },
  {
    cli: "gemini",
    agent: "gemini-cli",
    sourceVar: "GEMINI_TMP_DIR",
    sourceName: "gemini-tmp",
    errStream: "stdout",
    populate: (dir) =>
      writeFiles(dir, {
        "a/chats/session-1.json": "{}\n",
        "a/chats/session-2.json": "{}\n",
        "a/logs.json": "[]\n",
        "b/logs.json": "[]\n",
      }),
    empty: (dir) => fs.mkdirSync(path.join(dir, "a"), { recursive: true }),
    emptyMessage: (dir) =>
      `No session-*.json or logs.json files found under ${dir} — nothing to import.`,
    missingMessage: (src) =>
      `Error: Gemini tmp directory not found: ${src}\n` +
      "Override with GEMINI_TMP_DIR=<path> if your install uses a different location.",
    summary: [
      /^Projects: {6}2$/m,
      /^Session files: 2$/m,
      /^Logs files: {4}2$/m,
      new RegExp(`^Total size: {4}~${SIZE}$`, "m"),
    ],
    mineSource: (arg, source) => arg === source,
  },
  {
    cli: "copilot",
    agent: "copilot-cli",
    sourceVar: "COPILOT_SESSIONS_DIR",
    sourceName: "copilot-sessions",
    errStream: "stdout",
    populate: (dir) =>
      writeFiles(dir, { "s1/events.jsonl": "{}\n", "s2/events.jsonl": "{}\n", "s3/x.txt": "x\n" }),
    empty: (dir) => fs.mkdirSync(path.join(dir, "s1"), { recursive: true }),
    emptyMessage: (dir) => `No events.jsonl files found under ${dir} — nothing to import.`,
    missingMessage: (src) =>
      `Error: Copilot session directory not found: ${src}\n` +
      "Override with COPILOT_SESSIONS_DIR=<path> if your install uses a different location.",
    summary: [
      /^Sessions: {5}3 directories$/m,
      new RegExp(`^Transcripts: {2}2 files \\(~${SIZE}\\)$`, "m"),
    ],
    mineSource: (arg, source) => arg === source,
  },
  {
    cli: "antigravity",
    agent: "antigravity-cli",
    sourceVar: "ANTIGRAVITY_HISTORY_FILE",
    sourceName: "history.jsonl",
    errStream: "stderr",
    populate: (dir) => writeFiles(dir, { "history.jsonl": '{"a":1}\n\n{"b":2}\n{"c":3}\n' }),
    missingMessage: (src) =>
      `Error: Antigravity CLI history file not found: ${src}\n` +
      "Override with ANTIGRAVITY_HISTORY_FILE=<path> if your install uses a different location.",
    summary: [/^Records: {7}3$/m, new RegExp(`^File size: {5}~${SIZE}$`, "m")],
    // the script mines a temporary `mktemp -d` directory holding the history file, never the file
    // itself; BSD mktemp ignores TMPDIR, so the location is only checked by its name
    mineSource: (arg, source) => arg !== source && /(^|\/)tmp\.[A-Za-z0-9]+$/.test(arg),
  },
];

const lines = (text: string): string[] => text.split("\n");
const mines = (o: ImportOutcome): string[] =>
  o.calls.filter((c) => c.startsWith("-m mempalace mine "));

/** The invariants every case shares: stub-only calls, no poison, no leftover temp entry. */
function assertHarness(o: ImportOutcome): void {
  for (const call of o.calls) {
    assert.ok(
      call === PROBE || call.startsWith("-m mempalace mine "),
      `unexpected python3 call: ${call}`,
    );
  }
  assert.equal(o.poisoned, false, "MEMPALACE_PYTHON (poison) must be ignored");
  assert.deepEqual(o.tmpLeft, [], "the script must not leave entries in its TMPDIR");
  for (const call of mines(o)) {
    const arg = call.split(" ")[3] ?? "";
    if (arg !== o.source)
      assert.equal(fs.existsSync(arg), false, `temporary directory left: ${arg}`);
  }
}

function mineLine(
  arg: string,
  c: Cli,
  dry: boolean,
  extra: Partial<Record<string, string>> = {},
): string {
  const wing = extra["wing"] ?? "transcripts";
  const agent = extra["agent"] ?? c.agent;
  const extract = extra["extract"] ?? "exchange";
  return `-m mempalace mine ${arg} --mode convos --wing ${wing} --agent ${agent} --extract ${extract}${dry ? " --dry-run" : ""}`;
}

describe("history import oracle", { skip: process.platform === "win32" }, () => {
  for (const c of CLIS) {
    const base = (over: Partial<ImportOptions> = {}): ImportOutcome =>
      runImport({
        cli: c.cli,
        sourceVar: c.sourceVar,
        source: (root) => path.join(root, c.sourceName),
        populate: (root) =>
          c.populate(path.join(root, c.cli === "antigravity" ? "" : c.sourceName)),
        ...over,
      });
    const err = (o: ImportOutcome): string => (c.errStream === "stdout" ? o.stdout : o.stderr);
    const other = (o: ImportOutcome): string => (c.errStream === "stdout" ? o.stderr : o.stdout);

    describe(c.cli, () => {
      if (c.empty !== undefined && c.emptyMessage !== undefined) {
        const emptyMessage = c.emptyMessage;
        const empty = c.empty;
        test("a source without sessions prints the nothing-to-import line, mines nothing, exits 0", () => {
          const o = base({
            populate: (root) => empty(path.join(root, c.sourceName)),
            answers: ["yes", "yes"],
          });
          assert.equal(o.status, 0);
          assert.ok(lines(o.stdout).includes(emptyMessage(o.source)), o.stdout);
          assert.deepEqual(mines(o), []);
          assertHarness(o);
        });
      }

      test("no candidate Python imports mempalace: the two Error lines, exit 1", () => {
        const o = base({ importStatus: 1, answers: ["yes", "yes"] });
        assert.equal(o.status, 1);
        assert.ok(
          err(o).includes(
            "Error: 'mempalace' is not importable from any candidate Python.\n" +
              "Install MemPalace first: pipx install mempalace\n",
          ),
          err(o),
        );
        assert.ok(!other(o).includes("Error:"), other(o));
        assert.deepEqual(mines(o), []);
        assert.ok(o.calls.length >= 1 && o.calls.every((x) => x === PROBE), o.calls.join("|"));
        assertHarness(o);
      });

      test("a missing source prints the Error and Override lines, exits 1", () => {
        const o = base({ source: (root) => path.join(root, "absent"), populate: () => {} });
        assert.equal(o.status, 1);
        assert.ok(err(o).includes(`${c.missingMessage(o.source)}\n`), err(o));
        assert.ok(!other(o).includes("Error:"), other(o));
        assert.deepEqual(mines(o), []);
        assertHarness(o);
      });

      test("declining both prompts prints Import canceled., mines nothing, exits 0", () => {
        const o = base({ answers: ["no", "no"] });
        assert.equal(o.status, 0);
        assert.ok(lines(o.stdout).includes("Import canceled."), o.stdout);
        assert.ok(!o.stdout.includes("Import complete"), o.stdout);
        assert.deepEqual(mines(o), []);
        assertHarness(o);
      });

      test("confirming both prompts runs a dry-run mine then the real mine, and completes", () => {
        const o = base({ answers: ["yes", "yes"] });
        assert.equal(o.status, 0, o.stderr);
        const [dry, real, ...rest] = mines(o);
        assert.equal(rest.length, 0, "exactly two mine calls");
        const arg = dry?.split(" ")[3] ?? "";
        assert.ok(c.mineSource(arg, o.source), `mine source ${arg}`);
        assert.equal(dry, mineLine(arg, c, true));
        assert.equal(real, mineLine(arg, c, false));
        assert.ok(o.stdout.includes("Import complete"), o.stdout);
        assert.ok(lines(o.stdout).includes("  Interpreter: python3"), o.stdout);
        assert.ok(lines(o.stdout).includes(`  Agent label: ${c.agent}`), o.stdout);
        for (const re of c.summary) assert.match(o.stdout, re);
        assertHarness(o);
      });

      test("MEMPALACE_HISTORY_WING, MEMPALACE_HISTORY_AGENT and MEMPALACE_EXTRACT reach the mine calls", () => {
        const extra = { wing: "w-test", agent: "a-test", extract: "general" };
        const o = base({
          answers: ["yes", "yes"],
          env: {
            MEMPALACE_HISTORY_WING: extra.wing,
            MEMPALACE_HISTORY_AGENT: extra.agent,
            MEMPALACE_EXTRACT: extra.extract,
          },
        });
        assert.equal(o.status, 0, o.stderr);
        const [dry, real] = mines(o);
        const arg = dry?.split(" ")[3] ?? "";
        assert.equal(dry, mineLine(arg, c, true, extra));
        assert.equal(real, mineLine(arg, c, false, extra));
        assertHarness(o);
      });

      test("a failing mine propagates its exit status and the run does not complete", () => {
        const o = base({ answers: ["yes", "yes"], mineStatus: 3 });
        assert.equal(o.status, 3);
        assert.ok(!o.stdout.includes("Import complete"), o.stdout);
        assert.ok(mines(o).length >= 1);
        assertHarness(o); // for antigravity: its mktemp directory is removed
      });
    });
  }
});
