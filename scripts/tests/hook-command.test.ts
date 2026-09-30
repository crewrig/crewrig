// hook-command.test.ts — tests for scripts/lib/hook-command.ts (spec 0243 R16-R18).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  hookCommandLine,
  MEASURED_SURFACES,
  type Cli,
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

  test("Antigravity hooks surface: the path is unquoted", () => {
    const result = build("antigravity", "win32", backslashed);
    assert.equal(result.ok && result.command, `node ${slashed} claude-code Stop`);
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

describe("measured surfaces (R18, R31, R32)", () => {
  const statusline = (): MeasuredSurface | undefined =>
    MEASURED_SURFACES.find((m) => m.cli === "antigravity" && m.surface === "statusline");
  const entry = (extra: Partial<MeasuredSurface> = {}): MeasuredSurface => ({
    cli: "antigravity",
    surface: "statusline",
    os: "win32",
    interpreter: "cmd.exe",
    quoting: "cmd-no-grouping",
    status: "conforming",
    plantedBinary: "planted-runs",
    ...extra,
  });
  const noPlanted = (status: MeasuredSurface["status"]): MeasuredSurface => {
    const { plantedBinary: _omitted, ...rest } = entry({ status });
    return rest;
  };

  test("holds the four hooks-surface Windows triples and the Antigravity statusline one (row 37e)", () => {
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

  test("the row 37e entry conforms to row 37b, carries the planted-binary result and the four caveats (R31)", () => {
    const e = statusline();
    assert.equal(e?.interpreter, "cmd.exe");
    assert.equal(e?.quoting, "cmd-no-grouping");
    assert.equal(e?.status, "conforming");
    assert.equal(e?.plantedBinary, "planted-runs");
    assert.deepEqual(e?.caveats, ["arm64-vm", "agy-1.2.14", "idle-start-screen", "node.cmd-only"]);
    const hooks = MEASURED_SURFACES.find((m) => m.cli === "antigravity" && m.surface === "hooks");
    assert.equal(hooks?.plantedBinary, undefined, "the hooks surface is unchanged");
  });

  // R32(c): conforming entry with the result -> the working-directory lookup, #1392.
  test("(c) a conforming entry refuses with the lookup diagnostic naming #1392, for any path", () => {
    const messages = [
      "C:/Users/ana/crewrig",
      "C:/Users/Ana Diaz/crewrig",
      "C:/a&b/c",
      "C:/a$b/c",
    ].map((root) => refusal(build("antigravity", "win32", `${root}/hooks/s.ts`, "statusline")));
    for (const message of messages) {
      assert.ok(message.includes("from the directory the user starts Antigravity CLI in"), message);
      assert.ok(message.includes("before PATH") && message.includes("#1392"), message);
      assert.ok(!message.includes("unmeasured") && !message.includes("contradicts"), message);
      assert.ok(!message.includes("checkout path") && !message.includes("whitespace"), message);
    }
    assert.equal(new Set(messages).size, 1, "one and the same diagnostic whatever the path");
  });

  // R32(a): no entry, or an entry lacking the result whatever its status.
  test("(a) no entry -> unmeasured", () => {
    const message = refusal(build("antigravity", "win32", "C:/x/hooks/s.ts", "statusline", []));
    assert.ok(message.includes("unmeasured"), message);
  });

  for (const status of ["contradicting", "conforming"] as const) {
    test(`(a) a ${status} entry without the planted-binary result is unmeasured, not the recorded-shape or lookup diagnostic`, () => {
      for (const root of ["C:/x", "C:/my dir"]) {
        const message = refusal(
          build("antigravity", "win32", `${root}/hooks/s.ts`, "statusline", [noPlanted(status)]),
        );
        assert.ok(message.includes("unmeasured"), message);
        assert.ok(!message.includes("contradicts") && !message.includes("#1392"), message);
        assert.ok(!message.includes("checkout path"), message);
      }
    });
  }

  test("(b) a contradicting entry with the result names the recorded shape, before the path diagnostic", () => {
    const contradicting = entry({
      status: "contradicting",
      interpreter: "powershell-5.1",
      quoting: "powershell",
    });
    for (const root of ["C:/x", "C:/my dir", "C:/a$b"]) {
      const message = refusal(
        build("antigravity", "win32", `${root}/hooks/s.ts`, "statusline", [contradicting]),
      );
      assert.ok(message.includes("powershell-5.1") && message.includes("contradicts"), message);
      assert.ok(!message.includes("#1392") && !message.includes("checkout path"), message);
    }
  });

  test("the hooks surface and macOS/Linux statusline are unchanged", () => {
    assert.equal(build("antigravity", "win32", "C:/x/hooks/usage-capture.ts").ok, true);
    const spaced = refusal(build("antigravity", "win32", "C:/my dir/hooks/usage-capture.ts"));
    assert.ok(spaced.includes("checkout path") && spaced.includes("whitespace"), spaced);
    for (const platform of ["darwin", "linux"] as const) {
      assert.equal(build("antigravity", platform, "/x/hooks/s.ts", "statusline").ok, true);
      assert.equal(build("antigravity", platform, "/x/hooks/s.ts", "statusline", []).ok, true);
    }
  });
});
