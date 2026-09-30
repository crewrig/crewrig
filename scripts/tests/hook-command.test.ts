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

describe("measured surfaces (R18)", () => {
  test("holds the four hooks-surface Windows triples and no Antigravity statusline entry yet", () => {
    const keys = MEASURED_SURFACES.map((m) => `${m.cli}/${m.surface}/${m.os}`).sort();
    assert.deepEqual(keys, [
      "antigravity/hooks/win32",
      "claude/hooks/win32",
      "copilot/hooks/win32",
      "gemini/hooks/win32",
    ]);
    assert.ok(MEASURED_SURFACES.every((m) => m.status === "conforming"));
  });

  test("a Windows statusline command line is refused as unmeasured", () => {
    const message = refusal(build("antigravity", "win32", "C:/x/hooks/s.ts", "statusline"));
    assert.ok(message.includes("unmeasured"), message);
  });

  test("the surface diagnostic wins over the path diagnostic", () => {
    const message = refusal(build("antigravity", "win32", "C:/my dir/hooks/s.ts", "statusline"));
    assert.ok(message.includes("unmeasured"), message);
    assert.ok(!message.includes("checkout path"), message);
  });

  test("a conforming statusline entry yields the cmd.exe shape", () => {
    const entry: MeasuredSurface = {
      cli: "antigravity",
      surface: "statusline",
      os: "win32",
      interpreter: "cmd.exe",
      quoting: "cmd",
      status: "conforming",
    };
    const result = build("antigravity", "win32", "C:\\x\\hooks\\s.ts", "statusline", [entry]);
    assert.equal(result.ok && result.command, "node C:/x/hooks/s.ts claude-code Stop");
  });

  test("a contradicting entry is refused with the recorded shape, and macOS/Linux are unaffected", () => {
    const entry: MeasuredSurface = {
      cli: "antigravity",
      surface: "statusline",
      os: "win32",
      interpreter: "powershell-5.1",
      quoting: "powershell",
      status: "contradicting",
    };
    const message = refusal(
      build("antigravity", "win32", "C:/x/hooks/s.ts", "statusline", [entry]),
    );
    assert.ok(message.includes("powershell-5.1") && message.includes("contradicts"), message);
    assert.equal(build("antigravity", "linux", "/x/hooks/s.ts", "statusline", [entry]).ok, true);
  });
});
