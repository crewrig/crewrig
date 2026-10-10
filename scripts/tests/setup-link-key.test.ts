// setup-link-key.test.ts — askLinkConfirm (spec 0256 delta-01 requirement 16): per CLI the warning
// and prompt the setups print (pinned against literals and the golden cells of the link-mode runs),
// y/Y proceed, anything else or end of input aborts with exit 1, the pre-answer, and the remainder.

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
const GOLDEN = path.join(SCRIPTS, "tests", "fixtures", "setup-golden");

function golden(cli: Cli, cell: string): string {
  return fs.readFileSync(path.join(GOLDEN, cli, cell, "stdout.golden"), "utf8");
}

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

describe("texts", () => {
  test("the warning, the prompt and the abort line are the literals the setups print", () => {
    assert.deepEqual(LINK_WARNING_LINES, [
      "WARNING: You are using symlink mode for system context files.",
      "Symlinked files will change when you switch branches in this repository.",
      "A malicious branch could alter your agent's behavior, permissions, and",
      "tool access without your knowledge.",
      "",
      "Only use this mode if you TRUST ALL branches in this repository.",
      "For production use, prefer copy mode (the default).",
      "",
    ]);
    assert.equal(LINK_PROMPT, "Continue with symlink mode? [y/N] ");
    assert.equal(LINK_ABORT_LINE, "Aborted. Run without --link for secure copy mode.");
  });
  for (const cli of ["claude", "gemini", "antigravity"] as const) {
    test(`${cli}: the golden link-mode stdout carries the warning lines in order`, () => {
      assert.ok(
        golden(cli, "link-mode").includes(LINK_WARNING_LINES.join("\n")),
        "the warning block is in the golden stdout",
      );
    });
    test(`${cli}: the golden link-mode-declined stdout ends with the warning, the echoed newline and the abort line`, () => {
      assert.ok(
        golden(cli, "link-mode-declined").endsWith(
          `${LINK_WARNING_LINES.join("\n")}\n\n${LINK_ABORT_LINE}\n`,
        ),
        "the warning block is followed by the abort line",
      );
    });
  }
  test("copilot: the golden link-mode-no-question stdout carries no warning", () => {
    assert.doesNotMatch(golden("copilot", "link-mode-no-question"), /symlink mode for system/);
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
