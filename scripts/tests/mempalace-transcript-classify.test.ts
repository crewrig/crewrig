// mempalace-transcript-classify.test.ts — the entry a hook event becomes
// (spec 0247 R10): types, templates, precedence with both unguarded overrides,
// the harness-injection test of `_is_harness_injection`
// (hooks/mempalace-transcript.sh:148-159 at a7468111) and the 2000-character
// cut of model responses.
//
// Unit tests over scripts/lib/mempalace-transcript/classify.ts; the Stop
// summary is injected so that only the classification is under test here.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { classify, isHarnessInjection, type Entry } from "../lib/mempalace-transcript/classify.ts";

function entry(
  payload: unknown,
  options: { agy?: string; event?: string; summary?: string } = {},
): Entry | undefined {
  const event =
    options.event ??
    (typeof (payload as { hook_event_name?: unknown }).hook_event_name === "string"
      ? (payload as { hook_event_name: string }).hook_event_name
      : (options.agy ?? ""));
  return classify({
    payload,
    antigravityEvent: options.agy ?? "",
    event,
    stopSummary: () => options.summary ?? "",
  });
}

describe("Antigravity entries (spec 0116 R7)", () => {
  test("PreInvocation: invocation number and model, with their fallbacks", () => {
    assert.deepEqual(entry({ invocationNum: 3, modelName: "m-1" }, { agy: "PreInvocation" }), {
      type: "session-lifecycle",
      content: "[SESSION] PreInvocation: invocation 3 (m-1)",
    });
    assert.deepEqual(
      entry({}, { agy: "PreInvocation" })?.content,
      "[SESSION] PreInvocation: invocation ? (unknown)",
    );
  });

  test("Stop: the termination reason, else unknown", () => {
    assert.deepEqual(entry({ terminationReason: "done" }, { agy: "Stop" }), {
      type: "agent-response",
      content: "[AGENT] Session turn completed (done)",
    });
    assert.equal(entry({}, { agy: "Stop" })?.content, "[AGENT] Session turn completed (unknown)");
  });

  test("any other Antigravity event records nothing", () => {
    assert.equal(entry({ conversationId: "c" }, { agy: "PostInvocation" }), undefined);
  });
});

describe("precedence and the two unguarded overrides (R10)", () => {
  test("a non-empty prompt REPLACES an Antigravity entry", () => {
    assert.deepEqual(entry({ prompt: "hi", terminationReason: "r" }, { agy: "Stop" }), {
      type: "user-prompt",
      content: "[USER] hi",
    });
  });

  test("the literal prompt `null` does not", () => {
    assert.equal(
      entry({ prompt: "null" }, { agy: "Stop" })?.content,
      "[AGENT] Session turn completed (unknown)",
    );
    assert.equal(entry({ prompt: "null" }), undefined);
  });

  test("a SessionStart or SessionEnd event REPLACES any entry, prompt included", () => {
    for (const event of ["SessionStart", "SessionEnd"]) {
      assert.deepEqual(entry({ hook_event_name: event, prompt: "hi", source: "startup" }), {
        type: "session-lifecycle",
        content: `[SESSION] ${event}: startup`,
      });
      assert.equal(
        entry({ terminationReason: "r" }, { agy: "Stop", event })?.content,
        `[SESSION] ${event}: unknown`,
      );
    }
  });

  test("a tool use is recorded only when no entry exists yet", () => {
    assert.equal(entry({ prompt: "p", tool_name: "Bash" })?.type, "user-prompt");
    assert.equal(entry({ tool_name: "Bash" }, { agy: "Stop" })?.type, "agent-response");
  });

  test("tool arguments: command, else file_path, else pattern, else `(no args)`", () => {
    const tool = (input: unknown): string | undefined =>
      entry({ tool_name: "T", tool_input: input })?.content;
    assert.equal(tool({ command: "ls", file_path: "/f", pattern: "p" }), "[TOOL] T: ls");
    assert.equal(tool({ file_path: "/f", pattern: "p" }), "[TOOL] T: /f");
    assert.equal(tool({ pattern: "p" }), "[TOOL] T: p");
    assert.equal(tool({}), "[TOOL] T: (no args)");
    assert.equal(tool(undefined), "[TOOL] T: (no args)");
    assert.equal(tool({ command: null, file_path: false, pattern: 42 }), "[TOOL] T: 42");
  });

  test("an empty or non-scalar tool argument is selected and renders empty (R8)", () => {
    assert.equal(
      entry({ tool_name: "T", tool_input: { command: "", file_path: "/f" } })?.content,
      "[TOOL] T: ",
    );
    assert.equal(
      entry({ tool_name: "T", tool_input: { command: { a: 1 } } })?.content,
      "[TOOL] T: ",
    );
  });

  test("a tool name `null`, empty, false or an object records nothing", () => {
    for (const name of ["null", "", false, { a: 1 }])
      assert.equal(entry({ tool_name: name }), undefined);
  });

  test("a Stop event with no entry yet takes the summary", () => {
    const paths: Array<string | undefined> = [];
    const make = (payload: unknown, summary: string): Entry | undefined =>
      classify({
        payload,
        antigravityEvent: "",
        event: "Stop",
        stopSummary: (p) => {
          paths.push(p);
          return summary;
        },
      });
    assert.equal(make({ transcript_path: "/a" }, "done ")?.content, "[AGENT] done ");
    assert.equal(make({ transcriptPath: "/b" }, "")?.content, "[AGENT] Session turn completed");
    assert.equal(make({ transcript_path: "", transcriptPath: "/c" }, "")?.type, "agent-response");
    assert.deepEqual(paths, ["/a", "/b", undefined]);
    assert.equal(make({ prompt: "p" }, "never")?.content, "[USER] p");
    assert.equal(paths.length, 3, "no summary is built when an entry exists");
  });

  test("user_input / userInput only when no entry exists", () => {
    assert.equal(entry({ user_input: "u" })?.content, "[USER] u");
    assert.equal(entry({ userInput: "u2" })?.content, "[USER] u2");
    assert.equal(entry({ user_input: "null" }), undefined);
    assert.equal(entry({ user_input: "<system-reminder>x" })?.type, "harness-injection");
    assert.equal(entry({ tool_name: "T", user_input: "u" })?.type, "tool-use");
  });

  test("model_response / modelResponse last, cut to its first 2000 characters", () => {
    assert.deepEqual(entry({ model_response: "r" }), {
      type: "agent-response",
      content: "[AGENT] r",
    });
    assert.equal(entry({ modelResponse: "r2" })?.content, "[AGENT] r2");
    assert.equal(entry({ model_response: "null" }), undefined);
    assert.equal(entry({ user_input: "u", model_response: "r" })?.content, "[USER] u");
    const long = entry({ model_response: "😀".repeat(2500) })?.content ?? "";
    assert.equal(long, `[AGENT] ${"😀".repeat(2000)}`);
    assert.equal(
      entry({ model_response: "x".repeat(2000) })?.content,
      `[AGENT] ${"x".repeat(2000)}`,
    );
  });

  test("numbers are rendered, objects and true are absent (R8)", () => {
    assert.equal(entry({ prompt: 42 })?.content, "[USER] 42");
    assert.equal(entry({ prompt: { a: 1 } }), undefined);
    assert.equal(entry({ prompt: true }), undefined);
    assert.equal(
      entry({ hook_event_name: "SessionEnd", source: 7 })?.content,
      "[SESSION] SessionEnd: 7",
    );
  });

  test("nothing recognisable: no entry", () => {
    assert.equal(entry({}), undefined);
    assert.equal(entry({ hook_event_name: "Notification", message: "m" }), undefined);
  });
});

describe("the harness-injection test (R10, `_is_harness_injection`)", () => {
  const literals = [
    "<task-notification",
    "<system-reminder",
    "<system-message",
    "<SYSTEM_MESSAGE",
    "<task-status",
    "<command-status",
    "<harness-notification",
    "<notification",
    "[Message] timestamp=",
  ];
  for (const literal of literals) {
    test(`the literal ${JSON.stringify(literal)} anywhere in the text`, () => {
      assert.equal(isHarnessInjection(`user text ${literal} more`), true);
      assert.equal(entry({ prompt: `a ${literal}` })?.content, `[HARNESS] a ${literal}`);
    });
  }

  test("the regular expression, on any line, after POSIX spaces only", () => {
    const accepted = [
      "<foo-notification>",
      "<foo-reminder id=1>",
      "<x_y-message>",
      "<a-status>",
      "<system-anything>",
      "<task-x>",
      "<harness-y attr>",
      "<SYSTEM_MESSAGE>",
      "first line\n \t<bar-status>",
      "a\n\u000b\u000c<task-1>",
      "a\r\n<harness-z>",
    ];
    const rejected = [
      "plain text",
      "x <foo-reminder>",
      "<foo-reminder",
      " <foo-status>",
      "<status>",
      "<foo-bar>",
      "<system->",
      "< system-x>",
      "<Task-x>",
    ];
    for (const text of accepted) assert.equal(isHarnessInjection(text), true, JSON.stringify(text));
    for (const text of rejected)
      assert.equal(isHarnessInjection(text), false, JSON.stringify(text));
  });

  // `[[:space:]]` is locale-dependent in the shell: GNU grep (glibc) and any
  // grep under LC_ALL=C reject a leading no-break space, macOS grep under a
  // UTF-8 locale accepts it. The hook takes the POSIX/C reading.
  test("a leading no-break space is not a POSIX space", () => {
    assert.equal(isHarnessInjection("\u00a0<foo-status>"), false);
  });
});
