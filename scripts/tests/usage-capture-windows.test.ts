// usage-capture-windows.test.ts — the `windows-usage-capture` job's functional
// proof (spec 0243 R28, reworded at delta-03): both entries run from a
// non-POSIX shell, and the command line hook-command.ts produces for each CLI
// and surface launches through the invocation rows 37 and 37e/37f of
// docs/cli-matrix.md record for it.
//
// The entry legs and b1 run on every platform, so the Linux `usage-capture`
// capability exercises them too. The interpreter legs need Windows and are
// skipped elsewhere. Both Antigravity CLI surfaces run through `agyInvocation`,
// the wrapper rows 37e/37f record: `cmd /c "<command>"`, the whole command in
// one pair of quotes, each inner `"` escaped as `\"` (the #1392 measurement's
// `%CMDCMDLINE%` capture). The Antigravity legs, delta-03 R28(b):
// - the module's guarded hooks command (usage-capture.ts) and its guarded
//   statusline command (the real shim, verdict v1-F2) each capture a record;
// - b1: the module's statusline result from a path with a space, computed from
//   antigravityState: the R17 whitespace refusal in state (e), the single R32
//   diagnostic otherwise;
// - b2: per surface, with a planted `node.cmd`, then a planted `node.bat`, in
//   the working directory, the guarded form runs the real `node`;
// - b3: per surface, the same command without the guarded prefix (the bare
//   R16(c) text, a fixture the module never produces there) still runs the
//   planted `node.cmd`, or the premise of the guard has moved;
// - R35: `node` and the shim's prior command see the variable set to `1`.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  antigravityState,
  GUARDED_PREFIX,
  hookCommandLine,
  MEASURED_SURFACES,
  type Cli,
  type HookCommandResult,
  type Interpreter,
  type Surface,
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
  cwd?: string,
): Outcome {
  const res = spawnSync(file, args, {
    encoding: "utf8",
    input: stdin,
    cwd,
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

interface Invocation {
  readonly file: string;
  readonly args: string[];
  readonly verbatim: boolean;
}

/**
 * How Antigravity CLI runs a command on both its Windows surfaces (rows 37e and
 * 37f): `cmd /c "<command>"`, the whole command in one pair of quotes and each
 * inner `"` escaped as `\"`, passed verbatim so Node.js adds no quoting of its own.
 */
function agyInvocation(command: string): Invocation {
  return { file: "cmd.exe", args: ["/c", `"${command.replaceAll('"', '\\"')}"`], verbatim: true };
}

/** The invocation rows 37 and 37e/37f record for each Windows interpreter. */
function invocation(interpreter: Interpreter, command: string): Invocation {
  switch (interpreter) {
    case "git-bash":
      return { file: GIT_BASH, args: ["-c", command], verbatim: false };
    case "powershell-5.1":
      return {
        file: "powershell.exe",
        args: ["-NoProfile", "-NonInteractive", "-Command", command],
        verbatim: false,
      };
    case "cmd.exe":
      return agyInvocation(command);
  }
}

function run(inv: Invocation, root: string, stdin: string, cwd?: string): Outcome {
  return spawnWith(inv.file, inv.args, root, stdin, inv.verbatim, cwd);
}

function commandFor(cli: Cli, surface: Surface, entry: string, args?: string[]): HookCommandResult {
  return hookCommandLine({
    cli,
    surface,
    platform: "win32",
    scriptPath: resolveReal(entry),
    args: args ?? (entry === SHIM ? [] : ["claude-code", "Stop"]),
  });
}

const entryOf = (surface: Surface) =>
  MEASURED_SURFACES.find((m) => m.cli === "antigravity" && m.surface === surface && m.os === "win32");

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
      const root = freshRoot();
      const res = run(invocation(interpreter, built.command), root, read(fixtures.slowPayload));
      assert.equal(res.status, 0, `${res.stderr}\n${built.command}`);
      assert.equal(res.stderr, "");
      assert.ok(records(root).length > 0, `no record from: ${built.command}`);
    });
  }

  test("antigravity statusline: the module's guarded shim command runs through agyInvocation, captures and forwards the prior command (v1-F2, R35)", () => {
    const built = commandFor("antigravity", "statusline", SHIM);
    assert.ok(built.ok, built.ok ? "" : built.refusal);
    assert.ok(built.command.startsWith(GUARDED_PREFIX), built.command);
    const root = freshRoot();
    // The prior command reports the variable it inherits through the shim's %ComSpec% (R35).
    const prior = path.join(work, "prior-env.js");
    fs.writeFileSync(
      prior,
      "process.stdin.resume();\nprocess.stdin.on('end', () => process.stdout.write('prior-env:' + process.env.NoDefaultCurrentDirectoryInExePath));\n",
    );
    const state = path.join(root, "state");
    fs.mkdirSync(state, { recursive: true });
    fs.writeFileSync(
      path.join(state, "antigravity-statusline.json"),
      JSON.stringify({ priorStatusLineCommand: `node "${prior.replaceAll("\\", "/")}"` }),
    );
    const res = run(agyInvocation(built.command), root, read(fixtures.shimPayload));
    assert.equal(res.status, 0, `${res.stderr}\n${built.command}`);
    assert.equal(res.stderr, "");
    assert.equal(res.stdout, "prior-env:1", "the shim forwards the prior command, which inherits the guard (R35)");
    assert.ok(records(root).length > 0, `no record from: ${built.command}`);
  });

  /** A probe script and a planted candidate in a working directory of their own. */
  function plantedCase(plant: "node.cmd" | "node.bat") {
    const cwd = fs.mkdtempSync(path.join(work, "planted-"));
    const elsewhere = fs.mkdtempSync(path.join(work, "record-"));
    const plantedLog = path.join(elsewhere, "planted.txt");
    const realLog = path.join(elsewhere, "real.txt");
    const script = path.join(elsewhere, "probe.js");
    fs.writeFileSync(
      script,
      `require("node:fs").appendFileSync(${JSON.stringify(realLog)}, "env=" + process.env.NoDefaultCurrentDirectoryInExePath + "\\n");\n`,
    );
    fs.writeFileSync(path.join(cwd, plant), `@echo planted>> "${plantedLog}"\r\n`);
    return {
      cwd,
      script,
      ran: () => ({
        planted: fs.existsSync(plantedLog),
        real: fs.existsSync(realLog),
        realLog: fs.existsSync(realLog) ? read(realLog) : "",
      }),
    };
  }

  for (const surface of ["statusline", "hooks"] as const) {
    for (const plant of ["node.cmd", "node.bat"] as const) {
      test(`b2: antigravity ${surface}, ${plant} planted in the cwd: the guarded form runs the real node`, () => {
        const c = plantedCase(plant);
        const built = commandFor("antigravity", surface, c.script, ["claude-code", "Stop"]);
        assert.ok(built.ok, built.ok ? "" : built.refusal);
        assert.ok(built.command.startsWith(GUARDED_PREFIX), built.command);
        run(agyInvocation(built.command), freshRoot(), "", c.cwd);
        const ran = c.ran();
        assert.ok(
          ran.real && !ran.planted,
          `The guard ${JSON.stringify(GUARDED_PREFIX)} did not hold on the ${surface} surface: the planted ${plant} ran: ${ran.planted}; the real node ran: ${ran.real}. Command: ${built.command}`,
        );
        assert.equal(ran.realLog, "env=1\n", "node sees NoDefaultCurrentDirectoryInExePath=1 exactly (R35)");
      });
    }

    test(`b3: antigravity ${surface}, node.cmd planted in the cwd: the bare form still runs the plant (premise of the guard)`, () => {
      const c = plantedCase("node.cmd");
      const built = commandFor("antigravity", surface, c.script, ["claude-code", "Stop"]);
      assert.ok(built.ok && built.command.startsWith(GUARDED_PREFIX), built.ok ? built.command : built.refusal);
      // The bare `node <abs> <args>` text of R16(c): a fixture, never produced by the module here.
      const bare = built.command.slice(GUARDED_PREFIX.length);
      run(agyInvocation(bare), freshRoot(), "", c.cwd);
      const ran = c.ran();
      assert.ok(
        ran.planted && !ran.real,
        `The premise of the guard no longer holds on the ${surface} surface (planted node.cmd ran: ${ran.planted}; real node ran: ${ran.real}): cmd /c no longer resolves a bare node from the working directory first. Revisit the guarded form of spec 0243 R16(c)/R32 and ticket #1392 instead of keeping it on an outdated premise.`,
      );
    });
  }
});

describe("b1: the Antigravity statusLine.command from a checkout path with a space (spec 0243 R28(b1), R17, R32)", () => {
  const state = antigravityState(entryOf("statusline"));
  const [plain, spaced] = ["C:/work/crewrig", "C:/work space/crewrig"].map((root) =>
    hookCommandLine({
      cli: "antigravity",
      surface: "statusline",
      platform: "win32",
      scriptPath: `${root}/hooks/antigravity-statusline-shim.ts`,
      args: [],
    }),
  );

  test("the committed entry is in state (e): a holding guarded-form result", () => {
    assert.equal(state, "e");
  });

  test("the result follows the state: R17 whitespace refusal in (e), the single R32 diagnostic otherwise", () => {
    assert.equal(spaced?.ok, false);
    const refusal = spaced?.ok === false ? spaced.refusal : "";
    if (state === "e") {
      assert.deepEqual(plain, {
        ok: true,
        command: `${GUARDED_PREFIX}node C:/work/crewrig/hooks/antigravity-statusline-shim.ts`,
      });
      assert.match(refusal, /whitespace/);
      assert.match(refusal, /C:\/work space\/crewrig/);
    } else {
      assert.equal(plain?.ok, false);
      assert.equal(plain?.ok === false ? plain.refusal : "", refusal, "the same diagnostic for both paths");
      assert.match(refusal, /#1392|unmeasured|contradicts/);
      assert.doesNotMatch(refusal, /whitespace|checkout path/);
    }
  });
});
