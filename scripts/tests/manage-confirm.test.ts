// manage-confirm.test.ts — tests of scripts/lib/manage/confirm.ts, the twin of the link-mode
// WARNING block and `read -p "Continue? [y/N] " -n 1 -r` of the manage-* scripts (spec 0255 R12).
// The warning text is compared with the goldens of the shell facts (the scripts are shims since PR E).

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import type { Io } from "../lib/extension/types.ts";
import {
  CONTINUE_PROMPT,
  confirmContinue,
  linkWarningLines,
  type LinkWarningCli,
  type PromptStdin,
} from "../lib/manage/confirm.ts";

const FACTS = path.resolve(import.meta.dirname, "fixtures", "manage-shell-facts");

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

async function ask(stdin: FakeStdin, emit: () => void) {
  const rec = recorder();
  const pending = confirmContinue(stdin, rec.io);
  emit();
  return { answer: await pending, ...rec };
}

describe("linkWarningLines", () => {
  const SCRIPT: Record<LinkWarningCli, string> = {
    claude: "manage-claude-component.sh",
    copilot: "manage-copilot-component.sh",
    antigravity: "manage-antigravity-component.sh",
    workspace: "manage-workspace-component.sh",
  };
  for (const [cli, script] of Object.entries(SCRIPT) as [LinkWarningCli, string][]) {
    test(`${cli} block equals the echo lines of ${script}`, () => {
      const golden = fs.readFileSync(path.join(FACTS, `${cli}.facts.golden`), "utf8").split("\n");
      const shell = golden.filter((l) => l.startsWith("link-warning: ")).map((l) => l.slice(14));
      assert.ok(shell.length > 0, "no link-warning fact in the golden");
      assert.deepEqual(linkWarningLines(cli), shell);
    });
  }
});

describe("confirmContinue", () => {
  test("terminal: y and Y continue; the prompt goes to stderr, the key is echoed, the line ends", async () => {
    for (const key of ["y", "Y"]) {
      const stdin = new FakeStdin(true);
      const r = await ask(stdin, () => stdin.emit("data", Buffer.from(key)));
      assert.equal(r.answer, true);
      assert.deepEqual(r.err, [CONTINUE_PROMPT, key]);
      assert.deepEqual(r.out, [""]);
      assert.deepEqual(stdin.rawCalls, [true, false]);
      assert.equal(stdin.paused, true);
    }
  });

  test("terminal: n, another key, Enter and Ctrl-C all answer no", async () => {
    for (const key of ["n", "x", "\n", "\u0003"]) {
      const stdin = new FakeStdin(true);
      const r = await ask(stdin, () => stdin.emit("data", Buffer.from(key)));
      assert.equal(r.answer, false, JSON.stringify(key));
      assert.deepEqual(stdin.rawCalls, [true, false]);
    }
  });

  test("terminal: raw mode is restored to its previous state, and when the stream ends first", async () => {
    const stdin = new FakeStdin(true);
    stdin.isRaw = true;
    const r = await ask(stdin, () => stdin.emit("end"));
    assert.equal(r.answer, false);
    assert.deepEqual(stdin.rawCalls, [true, true]);
  });

  test("terminal: raw mode is restored when the read fails", async () => {
    const stdin = new FakeStdin(true);
    const r = await ask(stdin, () => stdin.emit("error", new Error("boom")));
    assert.equal(r.answer, false);
    assert.deepEqual(stdin.rawCalls, [true, false]);
  });

  test("a throwing resume still restores raw mode", async () => {
    const stdin = new FakeStdin(true);
    stdin.resume = () => {
      throw new Error("resume failed");
    };
    await assert.rejects(confirmContinue(stdin, recorder().io), /resume failed/);
    assert.deepEqual(stdin.rawCalls, [true, false]);
  });

  test("pipe: the first byte decides, nothing is prompted or put in raw mode", async () => {
    const yes = new FakeStdin(false);
    const a = await ask(yes, () => yes.emit("data", Buffer.from("yes please\n")));
    assert.equal(a.answer, true);
    assert.deepEqual(a.err, []);
    assert.deepEqual(a.out, [""]);
    assert.deepEqual(yes.rawCalls, []);

    const no = new FakeStdin(false);
    assert.equal((await ask(no, () => no.emit("data", Buffer.from("ny")))).answer, false);
    const str = new FakeStdin(false);
    assert.equal((await ask(str, () => str.emit("data", "Y"))).answer, true);
  });

  test("pipe: end of input answers no and still ends the line", async () => {
    for (const event of ["end", "close"]) {
      const stdin = new FakeStdin(false);
      const r = await ask(stdin, () => stdin.emit(event));
      assert.equal(r.answer, false);
      assert.deepEqual(r.out, [""]);
    }
  });
});
