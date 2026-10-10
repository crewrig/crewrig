// setup-usage-capture-rank.test.ts — the deduplication ranking of scripts/lib/setup/usage-capture-rank.ts
// (spec 0256 requirement 30): live > unresolvable > vanished, the first of the best rank survives,
// a group that the deletion alone emptied is pruned. The shell's `uc_rank` is also exercised, end to
// end and byte for byte, by setup-usage-capture-keep.test.ts.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseHookCommand } from "../lib/hook-recognition.ts";
import { USAGE_CAPTURE } from "../lib/hook-descriptor.ts";
import {
  classifyPaths,
  dedupConfig,
  dedupEvent,
  eventHandlers,
  rankOf,
  type ParseHandler,
} from "../lib/setup/usage-capture-rank.ts";

const cmd = (p: string) => ({ type: "command", command: `node "${p}" claude-code Stop` });
const OTHER = { type: "command", command: "echo hi" };
const LIVE = "/live/hooks/usage-capture.ts";
const LIVE2 = "/live2/hooks/usage-capture.ts";
const GONE = "/gone/hooks/usage-capture.ts";
const GONE2 = "/gone2/hooks/usage-capture.ts";
const REL = "$HOME/hooks/usage-capture.ts";
const lists = { live: [LIVE, LIVE2], vanished: [GONE, GONE2] };
const parse: ParseHandler = (h) =>
  typeof h === "object" && h !== null && "command" in h && typeof h.command === "string"
    ? parseHookCommand(h.command, USAGE_CAPTURE)
    : null;
const group = (...hooks: unknown[]) => ({ matcher: "", hooks });
const paths = (entries: unknown[]) =>
  eventHandlers("grouped", entries).map((h) => parse(h)?.path ?? "<other>");

describe("rankOf", () => {
  test("live 0, unresolvable 1, vanished 2, by membership", () => {
    assert.equal(rankOf(LIVE, lists), 0);
    assert.equal(rankOf(REL, lists), 1);
    assert.equal(rankOf("hooks/relative.ts", lists), 1);
    assert.equal(rankOf(GONE, lists), 2);
  });
});

describe("dedupEvent, grouped", () => {
  const dedup = (...hooks: unknown[]) =>
    paths(dedupEvent("grouped", [group(...hooks)], lists, parse));

  test("a live handler beats an earlier unresolvable and an earlier vanished one", () => {
    assert.deepEqual(dedup(cmd(GONE), cmd(REL), cmd(LIVE)), [LIVE]);
  });
  test("an unresolvable handler beats a vanished one, whatever the order", () => {
    assert.deepEqual(dedup(cmd(GONE), cmd(REL)), [REL]);
    assert.deepEqual(dedup(cmd(REL), cmd(GONE)), [REL]);
  });
  test("the first of the best rank survives: two live, two vanished, the same path twice", () => {
    assert.deepEqual(dedup(cmd(LIVE2), cmd(LIVE)), [LIVE2]);
    assert.deepEqual(dedup(cmd(GONE2), cmd(GONE)), [GONE2]);
    assert.deepEqual(dedup(cmd(LIVE), cmd(LIVE)), [LIVE]);
  });
  test("a handler that is no capture command stays where it is", () => {
    assert.deepEqual(dedup(OTHER, cmd(GONE), OTHER, cmd(LIVE), cmd(GONE)), [
      "<other>",
      "<other>",
      LIVE,
    ]);
  });
  test("one handler, or none, changes nothing", () => {
    assert.deepEqual(dedup(cmd(GONE)), [GONE]);
    assert.deepEqual(dedup(OTHER), ["<other>"]);
  });
  test("a group the deletion alone emptied is dropped; an empty or foreign element stays", () => {
    const entries = [group(cmd(LIVE)), group(cmd(GONE)), group(), "odd", { matcher: "x" }];
    const got = dedupEvent("grouped", entries, lists, parse);
    assert.deepEqual(got, [group(cmd(LIVE)), group(), "odd", { matcher: "x" }]);
  });
  test("a group keeps its other keys, and the input is not modified", () => {
    const input = [{ matcher: "Bash", extra: 1, hooks: [cmd(GONE), cmd(LIVE)] }];
    const snapshot = structuredClone(input);
    assert.deepEqual(dedupEvent("grouped", input, lists, parse), [
      { matcher: "Bash", extra: 1, hooks: [cmd(LIVE)] },
    ]);
    assert.deepEqual(input, snapshot);
  });
});

describe("dedupEvent, flat", () => {
  test("keeps the best first capture handler and every other entry, in order", () => {
    const got = dedupEvent(
      "flat",
      [OTHER, cmd(GONE), cmd(REL), cmd(LIVE), 3, cmd(LIVE2)],
      lists,
      parse,
    );
    assert.deepEqual(got, [OTHER, cmd(LIVE), 3]);
  });
});

describe("dedupConfig", () => {
  const config = {
    model: "m",
    hooks: {
      Stop: [group(cmd(GONE), cmd(LIVE))],
      Other: [group(cmd(GONE), cmd(GONE2))],
      Odd: "not an array",
    },
  };

  test("only the listed events are deduplicated; every other key and event is untouched", () => {
    const got = dedupConfig("grouped", config, ["Stop", "Odd", "Missing"], lists, parse);
    assert.deepEqual(got, { ...config, hooks: { ...config.hooks, Stop: [group(cmd(LIVE))] } });
    assert.deepEqual(Object.keys(got), ["model", "hooks"]);
    assert.equal(config.hooks.Stop[0]?.hooks.length, 2);
  });
  test("a configuration without an object `hooks` is returned as it is", () => {
    for (const hooks of [undefined, null, false, [], "x"]) {
      assert.deepEqual(dedupConfig("grouped", { hooks }, ["Stop"], lists, parse), { hooks });
    }
  });
});

describe("classifyPaths", () => {
  const isFile = (p: string) => p.startsWith("/live");

  test("unresolvable paths are skipped, files are live, any other absolute path is vanished", () => {
    const got = classifyPaths([REL, "hooks/x.ts", LIVE, GONE, "~/x", LIVE2], isFile);
    assert.deepEqual(got, { live: [LIVE, LIVE2], vanished: [GONE], target: LIVE });
  });
  test("the target is the first live path that can be spliced into a command", () => {
    const got = classifyPaths(['/live/a"b/x.ts', "/live/c\\d/x.ts", LIVE2], isFile);
    assert.equal(got.target, LIVE2);
    assert.equal(got.live.length, 3);
    assert.equal(classifyPaths([GONE], isFile).target, "");
  });
  test("a path holding a newline splits into fragments, as the shell reads it line by line", () => {
    const got = classifyPaths(["/gone/a\n/gone/b"], isFile);
    assert.deepEqual(got.vanished, ["/gone/a", "/gone/b"]);
    assert.deepEqual(classifyPaths(["/gone/a\nrel"], isFile).vanished, ["/gone/a"]);
  });
});
