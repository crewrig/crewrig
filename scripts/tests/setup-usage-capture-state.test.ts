// setup-usage-capture-state.test.ts — the readers of scripts/lib/setup/usage-capture-state.ts
// against the decisions of scripts/lib/usage-capture-optin.sh (spec 0256 requirement 30).
// The shared recognition corpus is the oracle the Bash suite uses for `uc_is_capture`.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  allHandlers,
  captureFootprint,
  capturePaths,
  captureShape,
  captureState,
  isUnresolvablePath,
  isUnsafePath,
  legacyCandidates,
  legacyOk,
  notAnObjectMessage,
  NotAnObjectConfigError,
  readCaptureConfig,
} from "../lib/setup/usage-capture-state.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = JSON.parse(
  fs.readFileSync(path.join(HERE, "fixtures", "usage-capture", "recognition-corpus.json"), "utf8"),
) as { command: string; capture: boolean; note: string }[];

const grouped = (...commands: string[]) => ({
  hooks: {
    Stop: [{ matcher: "*", hooks: commands.map((command) => ({ type: "command", command })) }],
  },
});
const CAP = 'node "/srv/co/crewrig/hooks/usage-capture.ts" claude-code Stop';

describe("the shared recognition corpus, through each shape", () => {
  for (const row of CORPUS) {
    test(`${row.capture ? "capture" : "not capture"}: ${JSON.stringify(row.command)}`, () => {
      const want = row.capture ? "installed" : "absent";
      assert.equal(captureState("claude", grouped(row.command)), want);
      assert.equal(captureState("gemini", grouped(row.command)), want);
      const flat = { hooks: { agentStop: [{ type: "command", command: row.command }] } };
      assert.equal(captureState("copilot", flat), want);
    });
  }
});

describe("shapes", () => {
  test("claude and gemini are grouped, copilot is flat, anything else is unknown", () => {
    assert.equal(captureShape("claude"), "grouped");
    assert.equal(captureShape("gemini"), "grouped");
    assert.equal(captureShape("copilot"), "flat");
    assert.equal(captureShape("antigravity"), undefined);
  });

  test("a flat handler inside a group is not read on the grouped shape, and the converse", () => {
    const flat = { hooks: { Stop: [{ type: "command", command: CAP }] } };
    assert.equal(captureState("claude", flat), "absent");
    assert.equal(captureState("copilot", flat), "installed");
    assert.equal(captureState("copilot", grouped(CAP)), "absent");
  });

  test("the footprint carries event, selector (the group minus hooks) and handler in order", () => {
    const fp = captureFootprint("claude", grouped(CAP, "echo other"));
    assert.deepEqual(fp, [
      { event: "Stop", selector: { matcher: "*" }, handler: { type: "command", command: CAP } },
    ]);
    assert.deepEqual(Object.keys(fp[0] ?? {}), ["event", "selector", "handler"]);
    const flat = { hooks: { agentStop: [{ type: "command", command: CAP }] } };
    assert.equal(captureFootprint("copilot", flat)[0]?.selector, null);
  });

  test("an absent file reads as {} and `hooks` null, false or not an object holds nothing", () => {
    assert.deepEqual(captureFootprint("claude", null), []);
    for (const hooks of [null, false, 3, "x", []]) {
      assert.deepEqual(allHandlers("grouped", { hooks }), []);
    }
    assert.deepEqual(allHandlers("grouped", { hooks: { Stop: "nope", Other: [3, null] } }), []);
  });

  test("a handler type other than command, or a non-string command, is not capture", () => {
    const h = (handler: unknown) => ({ hooks: { Stop: [{ hooks: [handler] }] } });
    assert.equal(captureState("claude", h({ type: "prompt", command: CAP })), "absent");
    assert.equal(captureState("claude", h({ command: 3 })), "absent");
    assert.equal(captureState("claude", h({ command: CAP })), "installed");
    assert.equal(captureState("claude", h({ type: null, command: CAP })), "installed");
  });
});

describe("paths", () => {
  test("distinct, in registration order, quotes stripped", () => {
    const other = "bash '/srv/other/hooks/usage-capture.sh' claude-code SessionEnd";
    const config = grouped(CAP, other, CAP);
    assert.deepEqual(capturePaths("claude", config), [
      "/srv/co/crewrig/hooks/usage-capture.ts",
      "/srv/other/hooks/usage-capture.sh",
    ]);
    assert.deepEqual(capturePaths("claude", null), []);
  });
});

describe("path safety", () => {
  test("isUnsafePath rejects a quote, $, a backtick, a backslash and a newline", () => {
    for (const bad of ['/a"b', "/a$b", "/a`b", "/a\\b", "/a\nb"]) assert.ok(isUnsafePath(bad), bad);
    for (const good of ["/a b/c", "/a'b", "/srv/crewrig", "C:/x/y"])
      assert.ok(!isUnsafePath(good), good);
  });

  test("isUnresolvablePath: relative, or holding $ or a backtick", () => {
    for (const p of [
      "hooks/x.ts",
      "~/x",
      "$HOME/x",
      "/a/$X/b",
      "/a/`b`",
      "${CLAUDE_PROJECT_DIR}/x",
    ]) {
      assert.ok(isUnresolvablePath(p), p);
    }
    for (const p of ["/a/b", "/a b/c", "/a\\b"]) assert.ok(!isUnresolvablePath(p), p);
  });
});

describe("the legacy spaced Gemini form", () => {
  // The legacy form is a POSIX absolute path, as uc_legacy_re pins it: the paths are literals and
  // existence is injected, so the suite holds on every platform.
  const script = "/srv/My Projects/hooks/usage-capture.sh";
  const config = grouped(`bash ${script} gemini-cli AfterModel`);

  test("counts only when its whole path names an existing file", () => {
    assert.deepEqual(legacyCandidates("grouped", config), [script]);
    assert.deepEqual(
      legacyOk("grouped", config, () => false),
      [],
    );
    assert.equal(
      captureState("gemini", config, () => false),
      "absent",
    );
    const exists = (p: string): boolean => p === script;
    assert.deepEqual(legacyOk("grouped", config, exists), [script]);
    assert.equal(captureState("gemini", config, exists), "installed");
    assert.deepEqual(capturePaths("gemini", config, exists), [script]);
  });

  test("a Windows drive-letter path is never a candidate, as in the shell", () => {
    const win = "C:\\Users\\me\\My Projects\\hooks\\usage-capture.sh";
    assert.deepEqual(legacyCandidates("grouped", grouped(`bash ${win} gemini-cli AfterModel`)), []);
    assert.deepEqual(
      legacyCandidates(
        "grouped",
        grouped(`bash C:/My Projects/hooks/usage-capture.sh gemini-cli AfterModel`),
      ),
      [],
    );
  });

  test("a compound is never a candidate, and a signature match is not one either", () => {
    const compound = "bash /opt/prep.sh && bash /x/y/hooks/usage-capture.sh gemini-cli AfterModel";
    assert.deepEqual(legacyCandidates("grouped", grouped(compound, CAP)), []);
  });
});

describe("readCaptureConfig", () => {
  let dir = "";
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "uc-state-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("absent and directory are null; an object is returned", () => {
    assert.equal(readCaptureConfig(path.join(dir, "none.json")), null);
    assert.equal(readCaptureConfig(dir), null);
    const file = path.join(dir, "s.json");
    fs.writeFileSync(file, JSON.stringify(grouped(CAP)));
    assert.equal(captureState("claude", readCaptureConfig(file)), "installed");
  });

  test("a file that is not a JSON object throws the typed error of return code 2", () => {
    for (const text of ["", "[]", "3", "{nope", "null"]) {
      const file = path.join(dir, "bad.json");
      fs.writeFileSync(file, text);
      assert.throws(
        () => readCaptureConfig(file),
        (error: unknown) => {
          assert.ok(error instanceof NotAnObjectConfigError);
          assert.equal(error.rc, 2);
          return true;
        },
      );
    }
    assert.equal(notAnObjectMessage("/f"), "  ERROR: /f is not readable as a JSON object.");
  });
});
