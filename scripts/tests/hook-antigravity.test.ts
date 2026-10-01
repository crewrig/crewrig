// hook-antigravity.test.ts — tests for scripts/lib/hook-antigravity.ts, the
// descriptor-parameterised keep/remove over an Antigravity CLI `hooks.json`
// (spec 0243 delta-03 R34, scenario "The guarded prefix is recognised on a
// hooks descriptor").

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { GUARDED_PREFIX, MEASURED_SURFACES, type MeasuredSurface } from "../lib/hook-command.ts";
import {
  keepAntigravityHooks,
  keepAntigravityHooksFile,
  removeAntigravityHooks,
  removeAntigravityHooksFile,
} from "../lib/hook-antigravity.ts";
import type { HookDescriptor } from "../lib/hook-descriptor.ts";

const posix = process.platform !== "win32";

// The R25 fixture descriptor shape (hook-rewrite-dedup.test.ts), opted in to the prefix.
const FIXTURE: HookDescriptor = {
  id: "worktree-guard-fixture",
  basename: "fixture-guard",
  cliIds: { claude: "c", gemini: "g", copilot: "p" },
  args: (_cli, event) => [event],
  argsPattern: "\\s+[A-Za-z]+\\s*",
  guardedPrefix: true,
};

const SCRIPT = "C:/repo/hooks/fixture-guard.ts";
const GUARDED = `${GUARDED_PREFIX}node ${SCRIPT} Stop`;
const SPACED = `set NoDefaultCurrentDirectoryInExePath=1 && node ${SCRIPT} Stop`;
const FOREIGN = {
  "crewrig-mempalace-transcript": {
    Stop: [{ type: "command", command: "bash hooks/mempalace-transcript.sh Stop", timeout: 10 }],
  },
};

function config(): Record<string, unknown> {
  return {
    "crewrig-fixture-guard": {
      Stop: [
        { type: "command", command: GUARDED, timeout: 10 },
        { type: "command", command: SPACED, timeout: 10 },
      ],
    },
    "crewrig-fixture-guard-grouped": {
      PreToolUse: [{ matcher: "run_command", hooks: [{ type: "command", command: GUARDED }] }],
    },
    ...structuredClone(FOREIGN),
  };
}

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});
function hooksFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-hook-antigravity-"));
  temps.push(dir);
  const file = path.join(dir, "hooks.json");
  fs.writeFileSync(file, `${JSON.stringify(config(), null, 2)}\n`);
  return file;
}
const backups = (file: string): string[] =>
  fs.readdirSync(path.dirname(file)).filter((n) => n.startsWith(`${path.basename(file)}.bak.`));
const mode = (file: string): number => fs.statSync(file).mode & 0o777;

describe("keep (R34)", () => {
  test("the guarded entry is the direct form, the ` &&` variant an unrecognised shape, foreign hooks unreported", () => {
    const input = config();
    const before = JSON.stringify(input);
    const lines = keepAntigravityHooks(input, { descriptor: FIXTURE, platform: "win32" });
    assert.equal(JSON.stringify(input), before, "keep never mutates");
    assert.deepEqual(
      lines.map((l) => [l.kind, l.event, l.detail]),
      [
        ["left", "crewrig-fixture-guard/Stop", "already the direct form"],
        ["left", "crewrig-fixture-guard/Stop", "unrecognised shape"],
        ["left", "crewrig-fixture-guard-grouped/PreToolUse", "already the direct form"],
      ],
    );
    assert.ok(
      lines.every((l) => l.path === SCRIPT),
      "the path, never the whole command",
    );
  });

  test("on macOS and Linux a guarded entry is an unrecognised shape (S4)", () => {
    for (const platform of ["darwin", "linux"] as const) {
      const lines = keepAntigravityHooks(config(), { descriptor: FIXTURE, platform });
      assert.ok(
        lines.every((l) => l.detail === "unrecognised shape"),
        JSON.stringify(lines),
      );
    }
  });

  test("the file keep writes nothing and creates no backup", { skip: !posix }, () => {
    const file = hooksFile();
    const before = fs.readFileSync(file, "utf8");
    const lines = keepAntigravityHooksFile(file, { descriptor: FIXTURE, platform: "win32" });
    assert.equal(lines.length, 3);
    assert.equal(fs.readFileSync(file, "utf8"), before);
    assert.deepEqual(backups(file), []);
  });
});

describe("remove (R34)", () => {
  test("deletes recognised handlers, keeps the variant byte-identical, prunes only what the deletion emptied", () => {
    const input = config();
    const result = removeAntigravityHooks(input, { descriptor: FIXTURE, platform: "win32" });
    assert.equal(result.removed, 2);
    assert.deepEqual(result.config, {
      "crewrig-fixture-guard": { Stop: [{ type: "command", command: SPACED, timeout: 10 }] },
      ...FOREIGN,
    });
    assert.deepEqual(
      result.lines.map((l) => [l.kind, l.detail]),
      [
        ["dropped", "removed"],
        ["left", "unrecognised shape"],
        ["dropped", "removed"],
      ],
    );
    assert.deepEqual(input, config(), "the input is not mutated");
  });

  test("the file remove backs up at 0600 first, then writes at 0600", { skip: !posix }, () => {
    const file = hooksFile();
    const lines: string[] = [];
    const result = removeAntigravityHooksFile(
      file,
      { descriptor: FIXTURE, platform: "win32" },
      (line) => lines.push(line),
    );
    assert.equal(result.status, 0, lines.join("\n"));
    const made = backups(file);
    assert.equal(made.length, 1);
    const backup = path.join(path.dirname(file), made[0] ?? "");
    assert.equal(mode(backup), 0o600);
    assert.deepEqual(JSON.parse(fs.readFileSync(backup, "utf8")), config());
    assert.equal(mode(file), 0o600);
    const after = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    assert.deepEqual(after, {
      "crewrig-fixture-guard": { Stop: [{ type: "command", command: SPACED, timeout: 10 }] },
      ...FOREIGN,
    });
  });

  test("a file with nothing recognised is not written and gets no backup", { skip: !posix }, () => {
    const file = hooksFile();
    fs.writeFileSync(file, `${JSON.stringify(FOREIGN, null, 2)}\n`);
    const before = fs.readFileSync(file, "utf8");
    const result = removeAntigravityHooksFile(
      file,
      { descriptor: FIXTURE, platform: "win32" },
      () => {},
    );
    assert.equal(result.status, 0);
    assert.equal(fs.readFileSync(file, "utf8"), before);
    assert.deepEqual(backups(file), []);
  });

  test("an absent file is nothing to do", () => {
    const missing = path.join(os.tmpdir(), "crewrig-hook-antigravity-absent", "hooks.json");
    const result = removeAntigravityHooksFile(
      missing,
      { descriptor: FIXTURE, platform: "win32" },
      () => {},
    );
    assert.equal(result.status, 0);
    assert.deepEqual(result.lines, []);
  });
});

// Security review (MEDIUM): on Windows only the byte-equal rebuild is current (R34).
describe("Windows: nothing but the current form is kept or removed (R34, R32)", () => {
  const OPTIONS = { descriptor: FIXTURE, platform: "win32" } as const;
  const NEAR_MISSES: [string, string][] = [
    ["the bare form", `node ${SCRIPT} Stop`],
    ["the prefix without `set`", `NoDefaultCurrentDirectoryInExePath=1&& node ${SCRIPT} Stop`],
    ["a POSIX-prefix injection", `X=a&calc&& node ${SCRIPT} Stop`],
  ];
  const single = (command: string): Record<string, unknown> => ({
    "crewrig-fixture-guard": { Stop: [{ type: "command", command }] },
  });
  /** The shipped constant with the hooks entry's guarded form hijacked: R32(d). */
  const STATE_D: readonly MeasuredSurface[] = MEASURED_SURFACES.map((m) =>
    m.cli === "antigravity" && m.surface === "hooks"
      ? {
          ...m,
          guardedForm: [
            { plant: "node.cmd", ran: "real" },
            { plant: "node.bat", ran: "real" },
            { plant: "node.exe", ran: "planted" },
          ],
        }
      : m,
  );

  for (const [name, command] of NEAR_MISSES) {
    test(`${name} is left by keep and untouched by remove`, () => {
      const lines = keepAntigravityHooks(single(command), OPTIONS);
      assert.deepEqual(
        lines.map((l) => [l.kind, l.detail]),
        [["left", "unrecognised shape"]],
      );
      const result = removeAntigravityHooks(single(command), OPTIONS);
      assert.equal(result.removed, 0);
      assert.deepEqual(result.config, single(command));
      assert.deepEqual(
        result.lines.map((l) => [l.kind, l.detail]),
        [["left", "unrecognised shape"]],
      );
    });
  }

  test("(d): a guarded command is left by keep with the (d) diagnostic, not reported current", () => {
    const lines = keepAntigravityHooks(single(GUARDED), { ...OPTIONS, measuredSurfaces: STATE_D });
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.kind, "left");
    const detail = lines[0]?.detail ?? "";
    assert.notEqual(detail, "already the direct form");
    assert.ok(detail.includes("hijacked") && detail.includes("row 37f"), detail);
    assert.ok(detail.includes("#1392"), detail);
  });

  test("(d): remove still takes the framework's exact guarded form", () => {
    const result = removeAntigravityHooks(single(GUARDED), {
      ...OPTIONS,
      measuredSurfaces: STATE_D,
    });
    assert.equal(result.removed, 1);
    assert.deepEqual(result.config, {});
  });

  test("the near-misses stay recognised as direct form off Windows, where no guarded form is produced", () => {
    // Unchanged non-win32 behaviour: the shared signature's verdict stands.
    const lines = keepAntigravityHooks(single(`node "/repo/hooks/fixture-guard.ts" Stop`), {
      descriptor: FIXTURE,
      platform: "linux",
    });
    assert.deepEqual(
      lines.map((l) => l.detail),
      ["already the direct form"],
    );
  });
});
