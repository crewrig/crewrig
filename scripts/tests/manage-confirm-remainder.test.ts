// manage-confirm-remainder.test.ts — confirmKeyWithRemainder (spec 0256 delta-01 requirement 16):
// the key, the rest of its line discarded by the stream rule wherever a chunk boundary falls, and
// the remainder handed back; the terminal path returns on the first keypress.

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, test } from "node:test";

import type { Io } from "../lib/extension/types.ts";
import { confirmKeyWithRemainder, type PromptStdin } from "../lib/manage/confirm.ts";

class FakeStdin extends EventEmitter implements PromptStdin {
  isTTY: boolean;
  isRaw = false;
  rawCalls: boolean[] = [];
  paused = false;
  setRawMode?: (mode: boolean) => void;
  constructor(tty: boolean) {
    super();
    this.isTTY = tty;
    if (tty) {
      this.setRawMode = (mode) => {
        this.rawCalls.push(mode);
        this.isRaw = mode;
      };
    }
  }
  resume(): this {
    this.paused = false;
    return this;
  }
  pause(): this {
    this.paused = true;
    return this;
  }
}

function recorder() {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), errRaw: (t) => err.push(t) };
  return { io, out, err };
}

/** Ask off a terminal; `steps` emit chunks (or end) one after the other, as separate writes. */
async function run(steps: readonly (string | null)[], binary = false) {
  const stdin = new FakeStdin(false);
  const rec = recorder();
  const pending = confirmKeyWithRemainder(stdin, rec.io, "P? ");
  for (const step of steps) {
    if (step === null) stdin.emit("end");
    else stdin.emit("data", binary ? Buffer.from(step) : step);
  }
  const answer = await Promise.race([
    pending,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("never resolved")), 500)),
  ]);
  return { answer, stdin, ...rec };
}

describe("confirmKeyWithRemainder off a terminal", () => {
  const cases: [string, (string | null)[], string, string][] = [
    ["y and the rest of the stream in two writes", ["y", "\nkeep\n"], "y", "keep\n"],
    ["y and the rest of the stream in one write", ["y\nkeep\n"], "y", "keep\n"],
    ["a CRLF split between two writes", ["y\r", "\nkeep\n"], "y", "keep\n"],
    ["a CRLF in one write", ["y\r\nkeep\n"], "y", "keep\n"],
    ["the typed word split after the key", ["y", "es\nkeep\n"], "y", "keep\n"],
    ["a line spread over three writes", ["Y", "e", "s", "\nkeep\n"], "Y", "keep\n"],
    ["a blank key at the end of its write", ["\n"], "\n", ""],
    ["a blank key in one write", ["\nkeep\nmore\n"], "\n", "keep\nmore\n"],
    ["another key discards its line only", ["n\nkeep\nnext\n"], "n", "keep\nnext\n"],
    [
      "the remainder holds what follows the terminator, several lines",
      ["y\na\nb\n"],
      "y",
      "a\nb\n",
    ],
    ["a line with no terminator, then end of input", ["yes", null], "y", ""],
    ["the key alone, then end of input", ["y", null], "y", ""],
    ["end of input right after the terminator", ["y\n", null], "y", ""],
    ["end of input before any key", [null], "", ""],
  ];
  for (const [name, steps, key, remainder] of cases) {
    for (const binary of [false, true]) {
      test(`${name} (${binary ? "bytes" : "text"})`, async () => {
        const r = await run(steps, binary);
        assert.deepEqual(r.answer, { key, remainder });
      });
    }
  }

  test("the prompt is not printed, the stream is paused and left usable, no listener remains", async () => {
    const r = await run(["y\nkeep\n"]);
    assert.deepEqual(r.err, []);
    assert.deepEqual(r.out, []);
    assert.equal(r.stdin.paused, true);
    for (const event of ["data", "end", "close", "error"]) {
      assert.equal(r.stdin.listenerCount(event), 0, event);
    }
  });

  test("an empty chunk before the key is ignored", async () => {
    const r = await run(["", "y\nkeep\n"]);
    assert.deepEqual(r.answer, { key: "y", remainder: "keep\n" });
  });

  test("close and error end the read like the end of input", async () => {
    for (const event of ["close", "error"]) {
      const stdin = new FakeStdin(false);
      const pending = confirmKeyWithRemainder(stdin, recorder().io, "P? ");
      stdin.emit(event);
      assert.deepEqual(await pending, { key: "", remainder: "" });
    }
  });

  test("an unpredictable chunk type is ignored", async () => {
    const stdin = new FakeStdin(false);
    const pending = confirmKeyWithRemainder(stdin, recorder().io, "P? ");
    stdin.emit("data", 42);
    stdin.emit("data", "y\nrest");
    assert.deepEqual(await pending, { key: "y", remainder: "rest" });
  });
});

describe("confirmKeyWithRemainder on a real stream", () => {
  // What the queue created afterwards sees is the remainder, then whatever the stream still holds.
  const splits: string[][] = [
    ["y", "\n", "keep\n"],
    ["y\nkeep\n"],
    ["y\r", "\nkeep\n"],
    ["y", "es\n", "keep\n"],
    ["y", "e", "s", "\n", "keep", "\n"],
    ["\n", "keep\n"],
    ["\nkeep\n"],
  ];
  for (const writes of splits) {
    test(`no byte after the key's line is lost: ${JSON.stringify(writes)}`, async () => {
      const stream = new PassThrough();
      for (const w of writes) stream.write(w);
      stream.end();
      const { key, remainder } = await confirmKeyWithRemainder(stream, recorder().io, "P? ");
      let later = "";
      stream.on("data", (c: Buffer) => (later += c.toString()));
      // 'end' fires on its own once the buffer is drained, even for a paused stream: a reader
      // created afterwards must look at `readableEnded` (the caveat of confirmKeyWithRemainder).
      await new Promise((resolve) => setImmediate(resolve));
      if (!stream.readableEnded) {
        const ended = new Promise((resolve) => stream.on("end", resolve));
        stream.resume();
        await ended;
      }
      assert.equal(remainder + later, "keep\n", JSON.stringify({ key, remainder, later }));
    });
  }
});

describe("confirmKeyWithRemainder on a terminal", () => {
  test("prints the prompt to stderr, returns on the first key with an empty remainder, restores raw mode", async () => {
    const stdin = new FakeStdin(true);
    const rec = recorder();
    const pending = confirmKeyWithRemainder(stdin, rec.io, "P? ");
    stdin.emit("data", Buffer.from("yes\nmore"));
    assert.deepEqual(await pending, { key: "y", remainder: "" });
    assert.deepEqual(rec.err, ["P? ", "y"]);
    assert.deepEqual(rec.out, []);
    assert.deepEqual(stdin.rawCalls, [true, false]);
    assert.equal(stdin.paused, true);
  });

  test("raw mode goes back to its previous state when the stream ends first", async () => {
    const stdin = new FakeStdin(true);
    stdin.isRaw = true;
    const pending = confirmKeyWithRemainder(stdin, recorder().io, "P? ");
    stdin.emit("end");
    assert.deepEqual(await pending, { key: "", remainder: "" });
    assert.deepEqual(stdin.rawCalls, [true, true]);
  });

  test("a blank answer on a terminal is the key itself, nothing discarded", async () => {
    const stdin = new FakeStdin(true);
    const pending = confirmKeyWithRemainder(stdin, recorder().io, "P? ");
    stdin.emit("data", Buffer.from("\n"));
    assert.deepEqual(await pending, { key: "\n", remainder: "" });
  });
});
