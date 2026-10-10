// setup-link-key.test.ts — askLinkConfirm (spec 0256 delta-01 requirement 16): per CLI the warning
// and prompt of the setup scripts (compared with the shell source while it exists), y/Y proceed,
// anything else or end of input aborts with exit 1, the pre-answer, and the remainder.

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import type { Io } from "../lib/extension/types.ts";
import type { PromptStdin } from "../lib/manage/confirm.ts";
import type { Cli } from "../lib/setup/context.ts";
import { SetupExit } from "../lib/setup/exit.ts";
import {
  askLinkConfirm,
  LINK_ABORT_LINE,
  LINK_PROMPT,
  LINK_WARNING_LINES,
  linkQuestionAsked,
} from "../lib/setup/link-key.ts";

const SCRIPTS = path.resolve(import.meta.dirname, "..");
const SHELL: Partial<Record<Cli, string>> = {
  claude: "setup-claude-interactive.sh",
  gemini: "setup-gemini-interactive.sh",
  antigravity: "setup-antigravity-interactive.sh",
};

class FakeStdin extends EventEmitter implements PromptStdin {
  isTTY = false;
  reads = 0;
  resume(): this {
    this.reads += 1;
    return this;
  }
  pause(): this {
    return this;
  }
}

function setup(answer?: string) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), errRaw: (t) => err.push(t) };
  const stdin = new FakeStdin();
  const answers = { take: (id: string) => (id === "link-confirm" ? answer : undefined) };
  return { io, out, err, stdin, answers };
}

/** The `echo "..."` lines and the `read -p` prompt of the link block of one script. */
function shellBlock(script: string): { lines: string[]; prompt: string } {
  const text = fs.readFileSync(path.join(SCRIPTS, script), "utf8").split("\n");
  const start = text.findIndex((l) => l.includes('if [ "$INSTALL_MODE" = "link" ]'));
  const end = text.findIndex((l, i) => i > start && l.startsWith("fi"));
  const block = text.slice(start, end);
  const lines: string[] = [];
  let prompt = "";
  for (const l of block) {
    const echo = /^ {2}echo "(.*)"$/.exec(l);
    const read = /^ {2}read -p "(.*)" -n 1 -r$/.exec(l);
    if (read?.[1] !== undefined) {
      prompt = read[1];
      break;
    }
    if (echo?.[1] !== undefined) lines.push(echo[1]);
  }
  return { lines, prompt };
}

describe("texts", () => {
  for (const [cli, script] of Object.entries(SHELL)) {
    test(`${cli} warning and prompt are those of ${script}`, (t) => {
      if (!fs.existsSync(path.join(SCRIPTS, script ?? ""))) return t.skip("shell source gone");
      const shell = shellBlock(script ?? "");
      assert.ok(shell.lines.length >= 7, "vacuity guard: the warning block was not found");
      assert.ok(shell.prompt.length > 0, "vacuity guard: the prompt was not found");
      assert.deepEqual(LINK_WARNING_LINES, shell.lines);
      assert.equal(LINK_PROMPT, shell.prompt);
    });
  }
  test("the abort line is the shell's", (t) => {
    const file = path.join(SCRIPTS, "setup-claude-interactive.sh");
    if (!fs.existsSync(file)) return t.skip("shell source gone");
    assert.ok(fs.readFileSync(file, "utf8").includes(`echo "${LINK_ABORT_LINE}"`));
  });
});

describe("askLinkConfirm", () => {
  for (const cli of ["claude", "gemini", "antigravity"] as const) {
    for (const key of ["y", "Y"]) {
      test(`${cli}: ${key} proceeds and the remainder is returned`, async () => {
        const s = setup();
        const pending = askLinkConfirm({ cli, io: s.io, stdin: s.stdin, answers: s.answers });
        s.stdin.emit("data", Buffer.from(`${key}\nkeep\n`));
        assert.deepEqual(await pending, { proceed: true, remainder: "keep\n" });
        assert.deepEqual(s.out, [...LINK_WARNING_LINES, "", ""]);
        assert.deepEqual(s.err, []);
      });
    }
    test(`${cli}: another key aborts with exit 1 and the abort line on stdout`, async () => {
      const s = setup();
      const pending = askLinkConfirm({ cli, io: s.io, stdin: s.stdin, answers: s.answers });
      s.stdin.emit("data", Buffer.from("n\nkeep\n"));
      await assert.rejects(pending, (e) => e instanceof SetupExit && e.status === 1);
      assert.deepEqual(s.out, [...LINK_WARNING_LINES, "", LINK_ABORT_LINE]);
    });
    test(`${cli}: end of input aborts`, async () => {
      const s = setup();
      const pending = askLinkConfirm({ cli, io: s.io, stdin: s.stdin, answers: s.answers });
      s.stdin.emit("end");
      await assert.rejects(pending, (e) => e instanceof SetupExit && e.status === 1);
      assert.equal(s.out.at(-1), LINK_ABORT_LINE);
    });
  }

  test("a blank key aborts and leaves the next line to the queue", async () => {
    const s = setup();
    const pending = askLinkConfirm({ cli: "claude", io: s.io, stdin: s.stdin, answers: s.answers });
    s.stdin.emit("data", Buffer.from("\ny\n"));
    await assert.rejects(pending, SetupExit);
  });

  test("pre-answer yes proceeds without reading standard input", async () => {
    const s = setup("yes");
    const r = await askLinkConfirm({ cli: "gemini", io: s.io, stdin: s.stdin, answers: s.answers });
    assert.deepEqual(r, { proceed: true, remainder: "" });
    assert.equal(s.stdin.reads, 0);
    assert.deepEqual(s.out, [...LINK_WARNING_LINES, "[answer] link-confirm=yes", ""]);
  });

  test("pre-answer no aborts with exit 1 without reading standard input", async () => {
    const s = setup("no");
    await assert.rejects(
      askLinkConfirm({ cli: "antigravity", io: s.io, stdin: s.stdin, answers: s.answers }),
      (e) => e instanceof SetupExit && e.status === 1,
    );
    assert.equal(s.stdin.reads, 0);
    assert.deepEqual(s.out.slice(-2), ["[answer] link-confirm=no", LINK_ABORT_LINE]);
  });

  test("copilot asks nothing and prints nothing", async () => {
    const s = setup();
    assert.equal(linkQuestionAsked("copilot"), false);
    for (const cli of ["claude", "gemini", "antigravity"] as const) {
      assert.equal(linkQuestionAsked(cli), true);
    }
    const r = await askLinkConfirm({
      cli: "copilot",
      io: s.io,
      stdin: s.stdin,
      answers: s.answers,
    });
    assert.deepEqual(r, { proceed: true, remainder: "" });
    assert.deepEqual(s.out, []);
    assert.equal(s.stdin.reads, 0);
  });
});
