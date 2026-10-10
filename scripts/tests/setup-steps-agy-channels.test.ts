// setup-steps-agy-channels.test.ts — the three channel functions of steps-agy.ts
// (agyHooksRewriteInstalled, agySessionRecording, agyUsageCapture) against the goldens of the
// antigravity cells transcript-optin-*, usage-capture-* and cancelled-transcripts-prompt.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  agyHooksRewriteInstalled,
  agySessionRecording,
  agyUsageCapture,
} from "../lib/setup/steps-agy.ts";
import { descriptor, run, sandbox, useSandbox } from "./setup-flow-fixtures.ts";
import {
  copyRepoHooks,
  exists,
  golden,
  okSpawn,
  printed,
  put,
  read,
  slice,
} from "./setup-steps-agy-fixtures.ts";

useSandbox();

const agy = (id: "session-recording" | "usage-capture" | "hooks-rewrite-installed") =>
  descriptor([id], "antigravity");
const OLD = 'node "/opt/old/hooks/antigravity-statusline-shim.ts"';
const SETTINGS = ".gemini/antigravity-cli/settings.json";
const MARKER = ".crewrig/usage/state/antigravity-statusline.json";
const DISABLED = "  Antigravity usage capture disabled";

async function record(answers: string[]): ReturnType<typeof run> {
  return run(
    agy("session-recording"),
    { "session-recording": agySessionRecording },
    { argv: answers.flatMap((a) => ["--answer", a]), spawn: okSpawn },
  );
}

describe("agySessionRecording", () => {
  test("transcripts=no prints the disabled line and the blank line (golden transcript-optin-no)", async () => {
    const result = await record(["transcripts=no"]);
    const want = slice(
      golden("antigravity", "transcript-optin-no", "stdout.golden"),
      "  Session recording disabled",
      "  Antigravity usage capture disabled",
    );
    assert.equal(printed(result.out), want);
    assert.equal(result.status, 0);
    assert.equal(exists(".gemini/config/hooks.json"), false);
  });

  test("yes then confirm=yes deploys the hooks (golden transcript-optin-yes)", async () => {
    copyRepoHooks();
    const result = await record(["transcripts=yes", "transcripts-confirm=yes"]);
    const want = slice(
      golden("antigravity", "transcript-optin-yes", "stdout.golden"),
      "Activating transcript hooks will:",
      DISABLED,
      -1,
    );
    assert.equal(printed(result.out), want);
    assert.equal(result.status, 0);
    assert.match(read(".gemini/config/hooks.json"), /crewrig-mempalace-transcript/);
  });

  test("yes then confirm=no prints the cancellation and writes nothing (golden transcript-optin-yes-declined)", async () => {
    copyRepoHooks();
    const result = await record(["transcripts=yes", "transcripts-confirm=no"]);
    const want = slice(
      golden("antigravity", "transcript-optin-yes-declined", "stdout.golden"),
      "Activating transcript hooks will:",
      DISABLED,
      -1,
    );
    assert.equal(printed(result.out), want);
    assert.equal(exists(".gemini/config/hooks.json"), false);
  });

  test("a closed standard input with no answer exits 2 naming the question; abort class", async () => {
    const result = await record([]);
    assert.equal(result.status, 2);
    assert.match(result.err, /no answer for 'transcripts'/);
  });

  test("both questions are asked with the abort cancel class and the shell headers", async () => {
    const asked: { id: string; cancel: string }[] = [];
    await agySessionRecording({
      descriptor: agy("session-recording"),
      ctx: {
        io: { out: () => {}, err: () => {}, errRaw: () => {} },
        env: {},
        platform: "linux",
        home: sandbox.tmp,
        repoDir: sandbox.tmp,
        cli: "antigravity",
        link: false,
      },
      state: {} as never,
      session: {
        choose: async (q) => {
          asked.push({ id: q.id, cancel: q.cancel });
          return "no";
        },
        confirm: async () => undefined,
        close: () => {},
      },
      spawn: okSpawn,
      deps: {} as never,
    });
    assert.deepEqual(asked, [{ id: "transcripts", cancel: "abort" }]);
  });
});

describe("agyUsageCapture", () => {
  const installed = (): void => {
    put(SETTINGS, `${JSON.stringify({ statusLine: { command: OLD } }, null, 2)}\n`);
    put(
      MARKER,
      JSON.stringify({ installedStatusLineCommand: OLD, priorStatusLineCommand: "prior-cmd" }),
    );
  };
  const usage = (answers: string[]): ReturnType<typeof run> =>
    run(
      agy("usage-capture"),
      { "usage-capture": agyUsageCapture },
      { argv: answers.flatMap((a) => ["--answer", a]), spawn: okSpawn },
    );
  const want = (cell: string, from: string): string =>
    slice(golden("antigravity", cell, "stdout.golden"), from, "  MemPalace session check");

  test("absent + no prints the disabled line (golden usage-capture-absent-no)", async () => {
    const result = await usage(["usage-capture=no"]);
    assert.equal(printed(result.out), want("usage-capture-absent-no", DISABLED));
  });

  test("absent + yes over an empty statusLine installs the shim (golden usage-capture-absent-yes)", async () => {
    copyRepoHooks();
    put("hooks/antigravity-statusline-shim.ts", "");
    const result = await usage(["usage-capture=yes"]);
    assert.equal(printed(result.out), want("usage-capture-absent-yes", "  Usage capture wired"));
    assert.ok(exists(MARKER));
  });

  test("absent + yes over a foreign statusLine leaves it (golden usage-capture-absent-yes-foreign-statusline)", async () => {
    put(SETTINGS, JSON.stringify({ statusLine: { command: "foreign-cmd" } }));
    const result = await usage(["usage-capture=yes"]);
    assert.equal(
      printed(result.out),
      want("usage-capture-absent-yes-foreign-statusline", "  statusLine.command already carries"),
    );
    assert.equal(exists(MARKER), false);
  });

  test("installed + keep rewrites through hook-wiring (golden usage-capture-installed-keep)", async () => {
    installed();
    copyRepoHooks();
    const result = await usage(["usage-capture-keep=keep"]);
    assert.equal(
      printed(result.out),
      want("usage-capture-installed-keep", "Antigravity usage capture is installed"),
    );
    assert.ok(exists(MARKER));
  });

  test("installed + remove restores the prior command and drops the marker (golden usage-capture-installed-remove)", async () => {
    installed();
    const result = await usage(["usage-capture-keep=remove"]);
    assert.equal(
      printed(result.out),
      want("usage-capture-installed-remove", "Antigravity usage capture is installed"),
    );
    assert.equal(exists(MARKER), false);
    assert.deepEqual(JSON.parse(read(SETTINGS)), { statusLine: { command: "prior-cmd" } });
  });
});

describe("agyHooksRewriteInstalled", () => {
  test("prints nothing and writes nothing when no registration is installed", async () => {
    const result = await run(
      agy("hooks-rewrite-installed"),
      { "hooks-rewrite-installed": agyHooksRewriteInstalled },
      { spawn: okSpawn },
    );
    assert.equal(result.out, "");
    assert.equal(result.err, "");
    assert.equal(exists(".gemini/config/hooks.json"), false);
  });

  test("reports the unused shell copy of the transcript hook", async () => {
    put(".gemini/antigravity-cli/hooks/mempalace-transcript.sh", "#!/bin/sh\n");
    const result = await run(
      agy("hooks-rewrite-installed"),
      { "hooks-rewrite-installed": agyHooksRewriteInstalled },
      { spawn: okSpawn },
    );
    assert.match(result.out, /No longer used \(left on disk\): .*mempalace-transcript\.sh/);
  });
});
