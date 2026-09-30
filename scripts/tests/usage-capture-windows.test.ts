// usage-capture-windows.test.ts — the `windows-usage-capture` job's functional
// proof (spec 0243 R28): both entries run from a non-POSIX shell, and the
// command line hook-command.ts produces for each CLI launches through the
// interpreter row 37 of docs/cli-matrix.md records for that CLI.
//
// The entry legs run on every platform, so the Linux `usage-capture`
// capability exercises them too. The interpreter legs need Windows and are
// skipped elsewhere. The `cmd /c` leg proves the launch semantics of that
// interpreter, not which interpreter Antigravity CLI uses for a status line:
// that is row 37e's to state. Row 37e records `cmd.exe` and a planted
// `node.cmd` that wins over `PATH` (#1389, security review finding 1), so the
// statusline legs are b1 (the module produces no command line and reports the
// single diagnostic of R32(c), with and without a space in the path) and b2
// (the planted-binary case through the invocation row 37e records), spec 0243
// delta-02 R28(b).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  hookCommandLine,
  MEASURED_SURFACES,
  type Cli,
  type HookCommandResult,
  type Interpreter,
} from "../lib/hook-command.ts";
import { resolveReal } from "../lib/paths.ts";
import { writeTimingFixtures, type TimingFixtures } from "./lib/usage-capture-timing-fixtures.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CAPTURE = path.join(REPO, "hooks", "usage-capture.ts");
const SHIM = path.join(REPO, "hooks", "antigravity-statusline-shim.ts");
const WINDOWS = process.platform === "win32";
// The Git Bash path row 37 records for Claude Code.
const GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";

let work = "";
let fixtures: TimingFixtures;
let counter = 0;

before(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "usage-capture-windows-"));
  fixtures = writeTimingFixtures(path.join(work, "fixtures"));
});
after(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

interface Outcome {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** A fresh, empty usage root for one firing. */
function freshRoot(): string {
  counter += 1;
  const root = path.join(work, `root-${counter}`);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function spawnWith(
  file: string,
  args: string[],
  root: string,
  stdin: string,
  verbatim = false,
): Outcome {
  const res = spawnSync(file, args, {
    encoding: "utf8",
    input: stdin,
    env: { ...process.env, CREWRIG_USAGE_ROOT: root },
    windowsVerbatimArguments: verbatim,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** Run an entry with the current Node.js binary, as a hook's `node <entry>` does. */
function runEntry(entry: string, args: string[], root: string, stdin: string): Outcome {
  return spawnWith(process.execPath, [entry, ...args], root, stdin);
}

/** The records one firing left in a usage root (journal entries, not sidecars). */
function records(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".json") && !entry.name.endsWith(".wing.json")) found.push(full);
    }
  };
  walk(path.join(root, "journal"));
  return found;
}

const read = (file: string): string => fs.readFileSync(file, "utf8");

describe("the entries, run directly", () => {
  test("usage-capture.ts captures a fresh transcript: a record, empty streams", () => {
    const root = freshRoot();
    const res = runEntry(CAPTURE, ["claude-code", "Stop"], root, read(fixtures.slowPayload));
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, "");
    assert.equal(res.stderr, "");
    assert.ok(records(root).length > 0, "a record appears in the temporary usage root");
  });

  test("usage-capture.ts takes the fast path on a stamped transcript: no record", () => {
    const res = runEntry(
      CAPTURE,
      ["claude-code", "Stop"],
      fixtures.usageRoot,
      read(fixtures.fastPayload),
    );
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, "");
    assert.equal(res.stderr, "");
    assert.deepEqual(records(fixtures.usageRoot), []);
  });

  test("the statusline shim forwards the prior command's output and captures", () => {
    const root = freshRoot();
    const prior = path.join(work, "prior.js");
    fs.writeFileSync(
      prior,
      "let n = 0;\nprocess.stdin.on('data', (c) => { n += c.length; });\nprocess.stdin.on('end', () => process.stdout.write('prior:' + n));\n",
    );
    const state = path.join(root, "state");
    fs.mkdirSync(state, { recursive: true });
    fs.writeFileSync(
      path.join(state, "antigravity-statusline.json"),
      JSON.stringify({ priorStatusLineCommand: `node "${prior.replaceAll("\\", "/")}"` }),
    );
    const payload = read(fixtures.shimPayload);
    const res = runEntry(SHIM, [], root, payload);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, `prior:${Buffer.byteLength(payload)}`);
    assert.equal(res.stderr, "");
    assert.ok(records(root).length > 0, "the statusline payload is captured too");
  });

  test("the statusline shim with no prior command writes nothing to stdout", () => {
    const root = freshRoot();
    const res = runEntry(SHIM, [], root, read(fixtures.shimPayload));
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, "");
    assert.equal(res.stderr, "");
    assert.ok(records(root).length > 0);
  });
});

/** The invocation each CLI's row 37 records for its Windows interpreter. */
function invocation(interpreter: Interpreter, command: string): [string, string[]] {
  switch (interpreter) {
    case "git-bash":
      return [GIT_BASH, ["-c", command]];
    case "powershell-5.1":
      return ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command]];
    case "cmd.exe":
      return ["cmd", ["/c", command]];
  }
}

function commandFor(cli: Cli, surface: "hooks" | "statusline", entry: string): HookCommandResult {
  return hookCommandLine({
    cli,
    surface,
    platform: "win32",
    scriptPath: resolveReal(entry),
    args: entry === SHIM ? [] : ["claude-code", "Stop"],
  });
}

describe("the command line of each CLI, through its interpreter", { skip: !WINDOWS }, () => {
  before(() => {
    assert.ok(fs.existsSync(GIT_BASH), `${GIT_BASH} is missing: row 37's Git Bash path moved`);
  });

  const legs: { cli: Cli; interpreter: Interpreter }[] = [
    { cli: "claude", interpreter: "git-bash" },
    { cli: "gemini", interpreter: "powershell-5.1" },
    { cli: "copilot", interpreter: "powershell-5.1" },
    { cli: "antigravity", interpreter: "cmd.exe" },
  ];
  for (const { cli, interpreter } of legs) {
    test(`${cli} hooks: the module's command runs under ${interpreter} and captures`, () => {
      const built = commandFor(cli, "hooks", CAPTURE);
      assert.ok(built.ok, built.ok ? "" : built.refusal);
      const [file, args] = invocation(interpreter, built.command);
      const root = freshRoot();
      const res = spawnWith(file, args, root, read(fixtures.slowPayload));
      assert.equal(res.status, 0, `${res.stderr}\n${built.command}`);
      assert.equal(res.stderr, "");
      assert.ok(records(root).length > 0, `no record from: ${built.command}`);
    });
  }

  test("b2: a planted node.cmd wins over node through the row 37e invocation (premise of the refusal)", () => {
    const cwd = fs.mkdtempSync(path.join(work, "planted-"));
    const elsewhere = fs.mkdtempSync(path.join(work, "record-"));
    const plantedLog = path.join(elsewhere, "planted.txt");
    const realLog = path.join(elsewhere, "real.txt");
    const script = path.join(elsewhere, "probe.js").replaceAll("\\", "/");
    fs.writeFileSync(
      script,
      `require("node:fs").appendFileSync(${JSON.stringify(realLog)}, "real\\n");\n`,
    );
    fs.writeFileSync(path.join(cwd, "node.cmd"), `@echo planted>> "${plantedLog}"\r\n`);
    // The bare `node <abs> <args>` text of R16(c): a fixture, never produced by the module.
    const command = `node ${script} claude-code Stop`;
    // Row 37e: `cmd /c "<command>"`, the whole command in one pair of quotes, each inner `"` as `\"`.
    const wrapped = `"${command.replaceAll('"', '\\"')}"`;
    spawnSync("cmd.exe", ["/c", wrapped], {
      cwd,
      encoding: "utf8",
      windowsVerbatimArguments: true,
    });
    const plantedRan = fs.existsSync(plantedLog);
    const realRan = fs.existsSync(realLog);
    assert.ok(
      plantedRan && !realRan,
      `The premise of the statusLine.command refusal no longer holds (planted node.cmd ran: ${plantedRan}; real node ran: ${realRan}): cmd /c no longer resolves a bare node from the working directory first. Revisit the refusal of spec 0243 R16(c)/R32 and ticket #1392 instead of leaving it on an outdated premise.`,
    );
  });
});

describe("b1: the Antigravity statusLine.command is refused on Windows (spec 0243 R28(b1), R32(c))", () => {
  const refusals = ["C:/work/crewrig", "C:/work space/crewrig"].map((root) =>
    hookCommandLine({
      cli: "antigravity",
      surface: "statusline",
      platform: "win32",
      scriptPath: `${root}/hooks/antigravity-statusline-shim.ts`,
      args: [],
    }),
  );

  test("no command line is produced, from a path with a space or without", () => {
    for (const result of refusals) assert.equal(result.ok, false);
  });

  test("the single diagnostic names the working-directory lookup and #1392, not the space", () => {
    const messages = refusals.map((r) => (r.ok ? "" : r.refusal));
    assert.equal(messages[0], messages[1], "the same diagnostic for both paths");
    assert.match(messages[0] ?? "", /from the directory the user starts Antigravity CLI in/);
    assert.match(messages[0] ?? "", /#1392/);
    assert.doesNotMatch(messages[0] ?? "", /whitespace|checkout path|unmeasured|contradicts/);
  });

  test("the constant carries the planted-binary result of row 37e", () => {
    const entry = MEASURED_SURFACES.find(
      (m) => m.cli === "antigravity" && m.surface === "statusline" && m.os === "win32",
    );
    assert.equal(entry?.plantedBinary, "planted-runs");
    assert.equal(entry?.status, "conforming");
  });
});
