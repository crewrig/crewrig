// hook-command.test.ts — tests for scripts/lib/hook-command.ts (spec 0243 R16-R18).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  AGY_OUTCOMES,
  antigravityState,
  GUARDED_PREFIX,
  hookCommandLine,
  isHolding,
  MEASURED_SURFACES,
  type AgyState,
  type Cli,
  type GuardedFormResult,
  type MeasuredSurface,
  type Surface,
} from "../lib/hook-command.ts";

const ARGS = ["claude-code", "Stop"] as const;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function build(
  cli: Cli,
  platform: NodeJS.Platform,
  scriptPath: string,
  surface: Surface = "hooks",
  measured?: readonly MeasuredSurface[],
): ReturnType<typeof hookCommandLine> {
  const request = { cli, surface, platform, scriptPath, args: ARGS };
  return measured === undefined ? hookCommandLine(request) : hookCommandLine(request, measured);
}

function refusal(result: ReturnType<typeof hookCommandLine>): string {
  assert.equal(result.ok, false, "expected a refusal");
  return result.ok ? "" : result.refusal;
}

describe('macOS and Linux: node "<abs>" <args> for every CLI (R16a)', () => {
  for (const platform of ["darwin", "linux"] as const) {
    for (const cli of ["claude", "gemini", "copilot", "antigravity"] as const) {
      test(`${cli} on ${platform}`, () => {
        assert.deepEqual(build(cli, platform, "/srv/co/crewrig/hooks/usage-capture.ts"), {
          ok: true,
          command: 'node "/srv/co/crewrig/hooks/usage-capture.ts" claude-code Stop',
        });
      });
    }
  }

  test("a path with a space stays double-quoted", () => {
    const result = build("claude", "linux", "/srv/co/My Projects/hooks/usage-capture.ts");
    assert.equal(
      result.ok && result.command,
      'node "/srv/co/My Projects/hooks/usage-capture.ts" claude-code Stop',
    );
  });

  test("the statusline surface of Antigravity has the same shape, with no arguments", () => {
    const result = hookCommandLine({
      cli: "antigravity",
      surface: "statusline",
      platform: "darwin",
      scriptPath: "/x/hooks/antigravity-statusline-shim.ts",
      args: [],
    });
    assert.equal(result.ok && result.command, 'node "/x/hooks/antigravity-statusline-shim.ts"');
  });
});

describe("Windows shapes (R16b, R16c)", () => {
  const backslashed = "C:\\work\\x\\crewrig\\hooks\\usage-capture.ts";
  const slashed = "C:/work/x/crewrig/hooks/usage-capture.ts";

  for (const cli of ["claude", "gemini", "copilot"] as const) {
    test(`${cli}: the same quoted text, with forward slashes and the path spelled out`, () => {
      const result = build(cli, "win32", backslashed);
      assert.equal(result.ok && result.command, `node "${slashed}" claude-code Stop`);
      assert.ok(result.ok && !/PROJECT_DIR|\$PWD|^\w+=/.test(result.command));
    });
  }

  test("Antigravity hooks surface: the path is unquoted, behind the guarded prefix (R16c, R33)", () => {
    const result = build("antigravity", "win32", backslashed);
    assert.equal(result.ok && result.command, `${GUARDED_PREFIX}node ${slashed} claude-code Stop`);
  });

  test("the Copilot fragment keeps the `command` key, never `bash` (row 37)", () => {
    const fragment = JSON.parse(
      fs.readFileSync(path.join(REPO, "hooks", "copilot-usage-capture-hooks.json"), "utf8"),
    ) as { hooks: Record<string, Record<string, unknown>[]> };
    for (const handlers of Object.values(fragment.hooks)) {
      for (const handler of handlers) {
        assert.equal(typeof handler["command"], "string");
        assert.equal("bash" in handler, false);
      }
    }
  });
});

describe("unsafe paths are refused with a diagnostic naming the character (R17, v1-F1)", () => {
  const unsafe: [string, string][] = [
    ['"', "'\"'"],
    ["$", "'$'"],
    ["`", "'`'"],
    ["\n", "a newline"],
    ["\\", "'\\'"],
  ];
  for (const [ch, described] of unsafe) {
    for (const platform of ["linux", "darwin"] as const) {
      test(`${platform}: ${JSON.stringify(ch)}`, () => {
        const message = refusal(build("claude", platform, `/tmp/a${ch}b/hooks/usage-capture.ts`));
        assert.ok(message.includes(described), message);
        assert.ok(message.includes("a"), message);
      });
    }
  }

  test("the backslash is refused for every POSIX-shell target, including the Git Bash one", () => {
    // Windows converts separators first: a backslash never survives there.
    assert.equal(build("claude", "win32", "C:\\a\\b\\hooks\\usage-capture.ts").ok, true);
    assert.equal(build("gemini", "linux", "/a\\b/hooks/usage-capture.ts").ok, false);
  });

  test("PowerShell targets refuse $ and the backtick too", () => {
    assert.equal(build("gemini", "win32", "C:/a$b/hooks/usage-capture.ts").ok, false);
    assert.equal(build("copilot", "win32", "C:/a`b/hooks/usage-capture.ts").ok, false);
  });

  for (const [ch, name] of [
    ["\u201C", "U+201C"],
    ["\u201D", "U+201D"],
    ["\u201E", "U+201E"],
  ] as const) {
    for (const cli of ["gemini", "copilot"] as const) {
      test(`${cli} on Windows refuses the typographic quote ${name} (PowerShell string delimiter)`, () => {
        const message = refusal(build(cli, "win32", `C:/a${ch}b/hooks/usage-capture.ts`));
        assert.ok(message.includes(ch) && message.includes("PowerShell"), message);
      });
    }
    test(`${name} is plain text to a POSIX shell and stays allowed there`, () => {
      assert.equal(build("claude", "linux", `/tmp/a${ch}b/hooks/usage-capture.ts`).ok, true);
    });
  }

  for (const ch of [" ", "&", "|", "<", ">", "^", "%", "(", ")"]) {
    test(`cmd.exe (Antigravity hooks on Windows) refuses ${JSON.stringify(ch)}`, () => {
      assert.equal(build("antigravity", "win32", `C:/a${ch}b/hooks/usage-capture.ts`).ok, false);
    });
  }

  test("a space is fine where the path is quoted", () => {
    assert.equal(build("gemini", "win32", "C:/My Projects/hooks/usage-capture.ts").ok, true);
  });

  test("a non-plain argument is refused", () => {
    const result = hookCommandLine({
      cli: "claude",
      surface: "hooks",
      platform: "linux",
      scriptPath: "/a/hooks/usage-capture.ts",
      args: ["claude-code", "Stop; rm"],
    });
    assert.equal(result.ok, false);
  });
});

describe("measured surfaces (R18, R31, R32, R33)", () => {
  const find = (surface: Surface): MeasuredSurface | undefined =>
    MEASURED_SURFACES.find((m) => m.cli === "antigravity" && m.surface === surface);
  const HOLDING: GuardedFormResult = [
    { plant: "node.cmd", ran: "real" },
    { plant: "node.bat", ran: "real" },
    { plant: "node.exe", ran: "real" },
  ];
  // Scenario "A mixed guarded-form result is hijacked": cmd/bat bypassed, exe ran.
  const MIXED: GuardedFormResult = [
    { plant: "node.cmd", ran: "real" },
    { plant: "node.bat", ran: "real" },
    { plant: "node.exe", ran: "planted" },
  ];
  const entry = (surface: Surface, extra: Partial<MeasuredSurface> = {}): MeasuredSurface => ({
    cli: "antigravity",
    surface,
    os: "win32",
    interpreter: "cmd.exe",
    quoting: "cmd-no-grouping",
    status: "conforming",
    plantedBinary: "planted-runs",
    ...extra,
  });
  const without = (e: MeasuredSurface, key: "plantedBinary" | "guardedForm"): MeasuredSurface => {
    const copy: Record<string, unknown> = { ...e };
    delete copy[key];
    return copy as unknown as MeasuredSurface;
  };
  const contradicting = { status: "contradicting", interpreter: "powershell-5.1", quoting: "powershell" } as const;
  /** One entry per R32 state, for a given surface. */
  const STATES: Record<AgyState, (surface: Surface) => MeasuredSurface | undefined> = {
    a1: () => undefined,
    a2: (s) => without(entry(s, { guardedForm: HOLDING }), "plantedBinary"),
    a3: (s) => without(entry(s), "plantedBinary"),
    a4: (s) => without(entry(s, contradicting), "plantedBinary"),
    b: (s) => entry(s, { ...contradicting, guardedForm: HOLDING }),
    c: (s) => entry(s),
    d: (s) => entry(s, { guardedForm: MIXED }),
    e: (s) => entry(s, { guardedForm: HOLDING }),
  };
  const ROOTS = ["C:/Users/ana/crewrig", "C:/Users/Ana Diaz/crewrig", "C:/a&b/c", "C:/a$b/c"];
  const SCRIPT = (root: string, surface: Surface): string =>
    `${root}/hooks/${surface === "statusline" ? "antigravity-statusline-shim" : "fixture-guard"}.ts`;
  const forState = (state: AgyState, surface: Surface, root: string) => {
    const e = STATES[state](surface);
    return build("antigravity", "win32", SCRIPT(root, surface), surface, e === undefined ? [] : [e]);
  };

  test("holds the four hooks-surface Windows triples and the Antigravity statusline one (rows 37-37f)", () => {
    const keys = MEASURED_SURFACES.map((m) => `${m.cli}/${m.surface}/${m.os}`).sort();
    assert.deepEqual(keys, [
      "antigravity/hooks/win32",
      "antigravity/statusline/win32",
      "claude/hooks/win32",
      "copilot/hooks/win32",
      "gemini/hooks/win32",
    ]);
    assert.ok(MEASURED_SURFACES.every((m) => m.status === "conforming"));
  });

  test("the row 37e entry carries the bare result, its caveats and a holding guarded-form result (R31)", () => {
    const e = find("statusline");
    assert.equal(e?.interpreter, "cmd.exe");
    assert.equal(e?.quoting, "cmd-no-grouping");
    assert.equal(e?.status, "conforming");
    assert.equal(e?.plantedBinary, "planted-runs");
    assert.deepEqual(e?.caveats, ["arm64-vm", "agy-1.2.14", "idle-start-screen", "node.cmd-only"]);
    assert.deepEqual(e?.guardedForm, HOLDING);
    assert.deepEqual(e?.guardedCaveats, [
      "arm64-vm",
      "agy-1.2.14",
      "idle-start-screen",
      "one-plant-cwd-only",
      "marker-probe",
      "node.exe-control-two-draws",
    ]);
    assert.equal(antigravityState(e), "e");
  });

  test("the row 37f hooks entry carries the #1392 bare and guarded results, without the status-line-only caveats (R33)", () => {
    const e = find("hooks");
    const caveats = ["arm64-vm", "agy-1.2.14", "stop-print-console", "one-plant-cwd-only", "marker-probe"];
    assert.equal(e?.plantedBinary, "planted-runs");
    assert.deepEqual(e?.caveats, caveats);
    assert.deepEqual(e?.guardedCaveats, caveats);
    assert.deepEqual(e?.guardedForm, HOLDING);
    assert.equal(antigravityState(e), "e");
  });

  test("GUARDED_PREFIX is the R34 text byte for byte, with one trailing space", () => {
    assert.equal(GUARDED_PREFIX, "set NoDefaultCurrentDirectoryInExePath=1&& ");
  });

  test("antigravityState classifies each R32 row, exclusively", () => {
    for (const state of Object.keys(STATES) as AgyState[]) {
      for (const surface of ["statusline", "hooks"] as const) {
        assert.equal(antigravityState(STATES[state](surface)), state, `${state}/${surface}`);
      }
    }
  });

  test("a guarded-form result holds only when every candidate ran the real node; an empty one is hijacked (R32, S3)", () => {
    assert.equal(isHolding(HOLDING), true);
    assert.equal(isHolding(MIXED), false);
    assert.equal(isHolding([]), false);
    assert.equal(isHolding(undefined), false);
    assert.equal(antigravityState(entry("statusline", { guardedForm: [] })), "d");
  });

  test("AGY_OUTCOMES is the R32 table, transcribed", () => {
    const r = "refuse";
    assert.deepEqual(AGY_OUTCOMES, {
      a1: { statusline: r, hooks: r },
      a2: { statusline: r, hooks: r },
      a3: { statusline: r, hooks: "bare" },
      a4: { statusline: r, hooks: r },
      b: { statusline: r, hooks: r },
      c: { statusline: r, hooks: "bare" },
      d: { statusline: r, hooks: r },
      e: { statusline: "guarded", hooks: "guarded" },
    });
    assert.ok(Object.isFrozen(AGY_OUTCOMES));
  });

  // R32: every refusal precedes and replaces the path judgement (R17).
  for (const state of Object.keys(STATES) as AgyState[]) {
    for (const surface of ["statusline", "hooks"] as const) {
      const outcome = AGY_OUTCOMES[state][surface];
      if (outcome !== "refuse") continue;
      test(`(${state}) ${surface}: one diagnostic whatever the path`, () => {
        const messages = ROOTS.map((root) => refusal(forState(state, surface, root)));
        assert.equal(new Set(messages).size, 1, messages.join("\n"));
        assert.ok(!messages[0]?.includes("checkout path"), messages[0]);
      });
    }
  }

  test("(a1)-(a4) statusline: the delta-02 unmeasured text", () => {
    for (const state of ["a1", "a2", "a3", "a4"] as const) {
      const message = refusal(forState(state, "statusline", ROOTS[0] ?? ""));
      assert.equal(
        message,
        "antigravity statusline on Windows is unmeasured: no row of docs/cli-matrix.md records, with its planted-binary result, how antigravity parses a statusLine.command there, so no command line is written for it.",
      );
    }
  });

  test("(a1)/(a2) hooks: today's unmeasured hooks text, unchanged (v1-F5)", () => {
    for (const state of ["a1", "a2"] as const) {
      assert.equal(
        refusal(forState(state, "hooks", ROOTS[0] ?? "")),
        "antigravity hooks on Windows is unmeasured: no row of docs/cli-matrix.md records how antigravity parses a hook command line there, so no command line is written for it.",
      );
    }
  });

  test("(a4)/(b) hooks and (b) statusline: today's recorded-shape texts, unchanged (v1-F5)", () => {
    for (const state of ["a4", "b"] as const) {
      assert.equal(
        refusal(forState(state, "hooks", ROOTS[0] ?? "")),
        "antigravity hooks on Windows is measured as interpreter powershell-5.1 with powershell quoting, which contradicts the shape this tool writes; no command line is written until a spec 0243 delta sets its shape.",
      );
    }
    assert.equal(
      refusal(forState("b", "statusline", ROOTS[0] ?? "")),
      "antigravity statusline on Windows is measured as interpreter powershell-5.1 with powershell quoting, which contradicts the shape this tool writes; no command line is written until a spec 0243 delta sets its shape.",
    );
  });

  // Scenario "An entry without a guarded-form result keeps the delta-02 refusal".
  test("(c) statusline: the delta-02 lookup diagnostic naming #1392, for both paths", () => {
    for (const root of ["C:/Users/ana/crewrig", "C:/Users/Ana Diaz/crewrig"]) {
      assert.equal(
        refusal(forState("c", "statusline", root)),
        "antigravity statusline on Windows: the cmd.exe that runs its statusLine.command resolves the bare 'node' of the command from the directory the user starts Antigravity CLI in, before PATH (CWE-427), so a repository shipping a node.cmd would run its own code on every draw of the status line (row 37e). No command line is written until ticket #1392 settles a form that does not depend on that lookup.",
      );
    }
  });

  // Scenarios "A guarded form that does not hold is refused" and "A mixed guarded-form result is hijacked".
  test("(d) one hijacked diagnostic per surface, naming its row and #1392", () => {
    const status = refusal(forState("d", "statusline", ROOTS[0] ?? ""));
    const hooks = refusal(forState("d", "hooks", ROOTS[0] ?? ""));
    for (const [message, row] of [
      [status, "row 37e"],
      [hooks, "row 37f"],
    ] as const) {
      assert.ok(message.includes("guarded form") && message.includes("hijacked"), message);
      assert.ok(message.includes(row) && message.includes("#1392"), message);
    }
    assert.ok(status.includes("statusline") && hooks.includes("hooks"));
    assert.notEqual(status, hooks);
  });

  test("(a3)/(c) hooks: the bare form of R16(c), judged by R17", () => {
    for (const state of ["a3", "c"] as const) {
      assert.deepEqual(forState(state, "hooks", "C:/Users/ana/crewrig"), {
        ok: true,
        command: "node C:/Users/ana/crewrig/hooks/fixture-guard.ts claude-code Stop",
      });
      assert.ok(refusal(forState(state, "hooks", "C:/Users/Ana Diaz/crewrig")).includes("whitespace"));
    }
  });

  // Scenario "A measured guarded form wires the Windows statusline".
  test("(e) statusline: the guarded form from C:/Users/ana/crewrig, with the shipped constant", () => {
    const result = hookCommandLine({
      cli: "antigravity",
      surface: "statusline",
      platform: "win32",
      scriptPath: "C:\\Users\\ana\\crewrig\\hooks\\antigravity-statusline-shim.ts",
      args: [],
    });
    assert.deepEqual(result, {
      ok: true,
      command:
        "set NoDefaultCurrentDirectoryInExePath=1&& node C:/Users/ana/crewrig/hooks/antigravity-statusline-shim.ts",
    });
  });

  // Scenario "A path with a space is refused by the path for the statusline".
  test("(e) statusline: a path with a space is refused by R17, not by a statusline diagnostic", () => {
    const message = refusal(
      build("antigravity", "win32", "C:/Users/Ana Diaz/crewrig/hooks/antigravity-statusline-shim.ts", "statusline"),
    );
    assert.ok(message.includes("whitespace") && message.includes("C:/Users/Ana Diaz/crewrig"), message);
    assert.ok(!message.includes("#1392") && !message.includes("unmeasured"), message);
  });

  // Scenario "The hooks surface receives the guarded form once row 37f exists".
  test("(e) hooks: the guarded form, path unquoted and forward-slashed; a space is refused by R17", () => {
    assert.deepEqual(build("antigravity", "win32", "C:\\Users\\ana\\crewrig\\hooks\\fixture-guard.ts"), {
      ok: true,
      command: `${GUARDED_PREFIX}node C:/Users/ana/crewrig/hooks/fixture-guard.ts claude-code Stop`,
    });
    const spaced = refusal(build("antigravity", "win32", "C:/Users/Ana Diaz/crewrig/hooks/fixture-guard.ts"));
    assert.ok(spaced.includes("checkout path") && spaced.includes("whitespace"), spaced);
    // Without its guarded-form result the hooks entry falls back to (c): the bare form.
    const bare = without(find("hooks") ?? entry("hooks"), "guardedForm");
    const result = build("antigravity", "win32", "C:/Users/ana/crewrig/hooks/fixture-guard.ts", "hooks", [bare]);
    assert.equal(result.ok && result.command, "node C:/Users/ana/crewrig/hooks/fixture-guard.ts claude-code Stop");
  });

  test("the guarded prefix's && and = are never judged as path characters (R17)", () => {
    const result = forState("e", "statusline", "C:/Users/ana/crewrig");
    assert.ok(result.ok && result.command.startsWith(GUARDED_PREFIX), JSON.stringify(result));
  });

  // Scenario "macOS and Linux are untouched".
  test("macOS and Linux: node \"<abs>\" with no guarded prefix, on both surfaces", () => {
    for (const platform of ["darwin", "linux"] as const) {
      for (const surface of ["statusline", "hooks"] as const) {
        for (const measured of [undefined, [], [entry(surface, { guardedForm: HOLDING })]]) {
          const result = build("antigravity", platform, "/x/crewrig/hooks/s.ts", surface, measured);
          assert.deepEqual(result, { ok: true, command: 'node "/x/crewrig/hooks/s.ts" claude-code Stop' });
        }
      }
    }
  });

  test("the other CLIs on Windows keep their hooks shapes and never carry the guarded prefix", () => {
    for (const cli of ["claude", "gemini", "copilot"] as const) {
      const result = build(cli, "win32", "C:/x/hooks/usage-capture.ts");
      assert.equal(result.ok && result.command, 'node "C:/x/hooks/usage-capture.ts" claude-code Stop');
    }
  });
});
