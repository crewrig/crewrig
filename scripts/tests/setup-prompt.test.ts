// setup-prompt.test.ts — the line queue and the prompt session on in-memory streams (spec 0256
// requirements 11, 13-15), non-terminal behaviour; the terminal one is in setup-prompt-tty.test.ts.

import assert from "node:assert/strict";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";

import { NoAnswerError, SetupExit } from "../lib/setup/exit.ts";
import { createLineQueue } from "../lib/setup/prompt-queue.ts";
import {
  answerEcho,
  createSession,
  invalidAnswerMessage,
  noAnswerMessage,
  type Answers,
  type CancelClass,
} from "../lib/setup/prompt.ts";

const none: Answers = { take: () => undefined };

function rig(input: string | null, answers: Answers = none, isTty = false, remainder?: string) {
  const stream = new PassThrough();
  if (input !== null) stream.end(input);
  const out: string[] = [];
  const err: string[] = [];
  const io = {
    out: (l: string) => void out.push(l),
    err: (l: string) => void err.push(l),
    errRaw: (t: string) => void err.push(t),
  };
  const queue = createLineQueue(stream, remainder === undefined ? {} : { remainder });
  return { stream, out, err, queue, session: createSession({ queue, answers, io, isTty }) };
}
const q = (cancel: CancelClass = "abort") => ({
  id: "rules-action",
  header: "Context files exist:",
  options: ["keep", "refresh"],
  cancel,
});

describe("createLineQueue", () => {
  it("strips the BOM of the first line and the CR of every line", async () => {
    const { queue } = rig("﻿one\r\ntwo\r\n\r\nlast");
    assert.deepEqual(
      [await queue.next(), await queue.next(), await queue.next(), await queue.next()],
      ["one", "two", "", "last"],
    );
    assert.equal(await queue.next(), undefined);
  });

  it("serves the remainder first, then the stream", async () => {
    const { queue } = rig("b\nc\n", none, false, "a\npart");
    assert.equal(await queue.next(), "a");
    assert.equal(await queue.next(), "partb");
    assert.equal(await queue.next(), "c");
    assert.equal(await queue.next(), undefined);
  });

  it("keeps lines that arrive before next() is called", async () => {
    const { stream, queue } = rig(null);
    stream.write("early1\nearly2\n");
    await new Promise((r) => setImmediate(r));
    stream.end();
    assert.equal(await queue.next(), "early1");
    assert.equal(await queue.next(), "early2");
    assert.equal(await queue.next(), undefined);
  });

  it("wakes a waiting next() when a line arrives, and on close", async () => {
    const { stream, queue } = rig(null);
    const waiting = queue.next();
    stream.write("later\n");
    assert.equal(await waiting, "later");
    const second = queue.next();
    queue.close();
    assert.equal(await second, undefined);
  });
});

describe("createLineQueue on a stream that already ended", () => {
  it("serves the remainder then ends, without waiting for an end event", async () => {
    const stream = new PassThrough();
    stream.end();
    stream.resume();
    await once(stream, "end");
    assert.equal(stream.readableEnded, true);
    const queue = createLineQueue(stream, { remainder: "keep\npart" });
    assert.equal(await queue.next(), "keep");
    assert.equal(await queue.next(), "part");
    assert.equal(await queue.next(), undefined);
  });

  it("treats a destroyed stream as the end of input", async () => {
    const stream = new PassThrough();
    stream.destroy();
    const queue = createLineQueue(stream);
    assert.equal(await queue.next(), undefined);
  });

  it("resumes a paused stream that has not ended", async () => {
    const stream = new PassThrough();
    stream.pause();
    stream.end("a\nb\n");
    const queue = createLineQueue(stream);
    assert.equal(await queue.next(), "a");
    assert.equal(await queue.next(), "b");
    assert.equal(await queue.next(), undefined);
  });
});

describe("createSession passthrough", () => {
  const pq = { ...q(), passthrough: (line: string) => /^\?[0-9]+$/.test(line.trim()) };

  it("returns a passthrough line verbatim, before matching, without an invalid answer", async () => {
    const r = rig("?2\nrefresh\n");
    assert.equal(await r.session.choose(pq), "?2");
    assert.equal(await r.session.choose(pq), "refresh");
    assert.deepEqual(r.err, []);
  });

  it("leaves every other line to the option matching", async () => {
    const r = rig("nope\n");
    await assert.rejects(r.session.choose(pq), SetupExit);
    assert.equal(r.err.length, 1);
  });
});

describe("createSession on input that is not a terminal", () => {
  it("accepts a number, a name and any case, printing the numbered list", async () => {
    const r = rig("2\nKEEP\n refresh \n");
    assert.equal(await r.session.choose(q()), "refresh");
    assert.deepEqual(r.out, ["Context files exist:", "  1) keep", "  2) refresh"]);
    assert.equal(await r.session.choose(q()), "keep");
    assert.equal(await r.session.choose(q()), "refresh");
  });

  it("treats a blank line and an invalid answer as the same error, exit 2", async () => {
    for (const input of ["\n", "maybe\n", "0\n", "3\n"]) {
      const r = rig(input);
      await assert.rejects(r.session.choose(q()), (e: unknown) => {
        assert.ok(e instanceof SetupExit);
        assert.equal(e.status, 2);
        return true;
      });
      assert.deepEqual(r.err, [
        "Error: invalid answer for 'rules-action': expected one of: keep, refresh",
      ]);
      assert.equal(r.err[0], invalidAnswerMessage("rules-action", ["keep", "refresh"]));
    }
  });

  it("fails closed at the end of input whatever the cancel class", async () => {
    for (const cancel of ["abort", "decline", "default"] as const) {
      const r = rig("");
      await assert.rejects(r.session.choose(q(cancel)), (e: unknown) => {
        assert.ok(e instanceof NoAnswerError);
        assert.equal(e.status, 2);
        assert.equal(e.id, "rules-action");
        return true;
      });
      assert.deepEqual(r.err, [
        "Error: no answer for 'rules-action' (standard input is not a terminal); pass --answer rules-action=<value>",
      ]);
      assert.equal(r.err[0], noAnswerMessage("rules-action"));
      assert.match(r.err[0] ?? "", /--answer/);
    }
  });

  it("echoes a pre-answer and does not read or list anything", async () => {
    const r = rig("never read\n", {
      take: (id) => (id === "rules-action" ? "refresh" : undefined),
    });
    assert.equal(await r.session.choose(q()), "refresh");
    assert.deepEqual(r.out, ["[answer] rules-action=refresh"]);
    assert.equal(r.out[0], answerEcho("rules-action", "refresh"));
    assert.equal(await r.queue.next(), "never read");
  });

  it("confirm defaults to the options no, yes", async () => {
    const r = rig("yes\n");
    assert.equal(await r.session.confirm("tls-delegation", "Delegate TLS?"), "yes");
    assert.deepEqual(r.out, ["Delegate TLS?", "  1) no", "  2) yes"]);
  });

  it("serves the remainder to the first question", async () => {
    const r = rig("2\n", none, false, "1\n");
    assert.equal(await r.session.choose(q()), "keep");
    assert.equal(await r.session.choose(q()), "refresh");
  });
});
