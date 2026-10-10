// setup-prompt-tty.test.ts — the prompt session behind a fake terminal (`isTty: true` and a
// scripted stream): blank selects the first option, three retries, end of input per cancel class,
// and the literals of requirements 14 and 15 (spec 0256).

import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";

import { SetupCancelled, SetupExit } from "../lib/setup/exit.ts";
import { createLineQueue } from "../lib/setup/prompt-queue.ts";
import { createSession, type CancelClass } from "../lib/setup/prompt.ts";

function tty(script: string) {
  const stream = new PassThrough();
  stream.end(script);
  const out: string[] = [];
  const err: string[] = [];
  const io = {
    out: (l: string) => void out.push(l),
    err: (l: string) => void err.push(l),
    errRaw: (t: string) => void err.push(t),
  };
  const session = createSession({
    queue: createLineQueue(stream),
    answers: { take: () => undefined },
    io,
    isTty: true,
  });
  return { out, err, session };
}
const q = (cancel: CancelClass) => ({
  id: "validation.backend",
  header: "Validation backend:",
  options: ["internal", "plannotator"],
  cancel,
});
const INVALID =
  "Error: invalid answer for 'validation.backend': expected one of: internal, plannotator";

describe("createSession on a terminal", () => {
  it("selects the first option on a blank line", async () => {
    const t = tty("\n   \n");
    assert.equal(await t.session.choose(q("abort")), "internal");
    assert.equal(await t.session.choose(q("abort")), "internal");
    assert.deepEqual(t.err, []);
  });

  it("asks again after an invalid answer, up to the third", async () => {
    const t = tty("x\n9\nPlannotator\n");
    assert.equal(await t.session.choose(q("abort")), "plannotator");
    assert.deepEqual(t.err, [INVALID, INVALID]);
  });

  it("stops with status 2 after three invalid answers", async () => {
    const t = tty("a\nb\nc\n2\n");
    await assert.rejects(t.session.choose(q("default")), (e: unknown) => {
      assert.ok(e instanceof SetupExit);
      assert.equal(e.status, 2);
      return true;
    });
    assert.deepEqual(t.err, [INVALID, INVALID, INVALID]);
  });

  it("abort: prints the cancel line on stderr and exits 130 at the end of input", async () => {
    const t = tty("");
    await assert.rejects(t.session.choose(q("abort")), (e: unknown) => {
      assert.ok(e instanceof SetupCancelled);
      assert.equal(e.status, 130);
      return true;
    });
    assert.deepEqual(t.err, ["Setup cancelled at: Validation backend:"]);
  });

  it("abort also fires when the end of input follows an invalid answer", async () => {
    const t = tty("zz\n");
    await assert.rejects(t.session.choose(q("abort")), SetupCancelled);
    assert.deepEqual(t.err, [INVALID, "Setup cancelled at: Validation backend:"]);
  });

  it("decline: returns undefined at the end of input, printing nothing", async () => {
    const t = tty("");
    assert.equal(await t.session.choose(q("decline")), undefined);
    assert.deepEqual(t.err, []);
  });

  it("default: returns the first option at the end of input, printing nothing", async () => {
    const t = tty("");
    assert.equal(await t.session.choose(q("default")), "internal");
    assert.deepEqual(t.err, []);
  });

  it("confirm cancels as a decline unless told otherwise", async () => {
    assert.equal(await tty("").session.confirm("mempalace-install", "Install?"), undefined);
    await assert.rejects(
      tty("").session.confirm("transcripts", "Capture?", ["no", "yes"], "abort"),
      SetupCancelled,
    );
  });
});
