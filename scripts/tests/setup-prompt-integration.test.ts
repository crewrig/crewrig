// setup-prompt-integration.test.ts — the real pieces of the prompt graph wired together over
// in-memory streams (spec 0256 requirements 11-17, delta-01): the one-key link question hands the
// unread rest of the pipe to the line queue, which feeds one session shared by every asker.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { Io } from "../lib/extension/types.ts";
import type { PromptStdin } from "../lib/manage/confirm.ts";
import { createAnswers } from "../lib/setup/answers.ts";
import { pickCatalogueEntry } from "../lib/setup/catalogue.ts";
import { NoAnswerError, SetupCancelled, SetupExit } from "../lib/setup/exit.ts";
import { askLinkConfirm } from "../lib/setup/link-key.ts";
import { createLineQueue } from "../lib/setup/prompt-queue.ts";
import { createSession, type Answers, type CancelClass } from "../lib/setup/prompt.ts";
import { configureValidationBackend } from "../lib/setup/validation-backend.ts";

const none: Answers = { take: () => undefined };

describe("setup prompt graph over in-memory streams", () => {
  let dir: string;
  let out: string[];
  let err: string[];
  let io: Io;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-prompt-int-"));
    out = [];
    err = [];
    io = {
      out: (l) => void out.push(l),
      err: (l) => void err.push(l),
      errRaw: (t) => void err.push(t),
    };
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const stdinOf = (stream: PassThrough): PromptStdin => stream as unknown as PromptStdin;
  const rulesQuestion = (cancel: CancelClass = "abort") => ({
    id: "rules-action",
    header: "Context files exist:",
    options: ["keep", "refresh"],
    cancel,
  });
  const linked = async (stream: PassThrough, answers: Answers = none) => {
    const { remainder } = await askLinkConfirm({
      cli: "claude",
      io,
      stdin: stdinOf(stream),
      answers,
    });
    const queue = createLineQueue(stream, { remainder });
    return { queue, session: createSession({ queue, answers, io, isTty: false }) };
  };
  const catalogue = (): string => {
    const root = path.join(dir, "teams");
    fs.mkdirSync(root);
    for (const name of ["alpha", "beta", "gamma"]) {
      fs.writeFileSync(path.join(root, `${name}.md`), `# ${name}\nline two of ${name}\n`);
    }
    return root;
  };

  it("the key y leaves the answers piped behind it unread (one chunk)", async () => {
    const stream = new PassThrough();
    stream.end("y\nkeep\nrefresh\n");
    const { session } = await linked(stream);
    assert.equal(await session.choose(rulesQuestion()), "keep");
    assert.equal(await session.choose(rulesQuestion()), "refresh");
  });

  it("the key y leaves the answers piped behind it unread (two chunks)", async () => {
    const stream = new PassThrough();
    stream.write("y");
    const pending = linked(stream);
    await new Promise((r) => setImmediate(r));
    stream.write("\nke");
    await new Promise((r) => setImmediate(r));
    stream.end("ep\n");
    const { session } = await pending;
    assert.equal(await session.choose(rulesQuestion()), "keep");
  });

  it("closed stdin after the link question fails closed naming the id", async () => {
    const stream = new PassThrough();
    stream.end("y\n");
    const { session } = await linked(stream);
    await assert.rejects(session.choose(rulesQuestion()), (e: unknown) => {
      assert.ok(e instanceof NoAnswerError);
      assert.equal(e.id, "rules-action");
      return true;
    });
    assert.match(err.join("\n"), /no answer for 'rules-action'/);
  });

  it("a key other than y aborts before any answer is read", async () => {
    const stream = new PassThrough();
    stream.end("n\nkeep\n");
    await assert.rejects(linked(stream), (e: unknown) => e instanceof SetupExit && e.status === 1);
  });

  it("serves a full piped script: link, rules, validation backend, catalogue with ?2", async () => {
    const root = catalogue();
    const stream = new PassThrough();
    stream.end("y\nkeep\nplannotator\non\nprofessor\n2\n?2\n3\n");
    const { session } = await linked(stream);
    assert.equal(await session.choose(rulesQuestion()), "keep");
    const ctx = { io, env: {}, platform: process.platform, home: dir };
    await configureValidationBackend({ ctx, session, hasCommand: () => true });
    const conf = fs.readFileSync(path.join(dir, ".crewrig", "validation.conf"), "utf8");
    assert.match(conf, /^backend=plannotator\ntranslate=on\npedagogy=professor\nillustration=on$/m);
    out.length = 0;
    const picked = await pickCatalogueEntry(session, {
      id: "catalogue.team",
      dir: root,
      label: "team",
      io,
    });
    assert.equal(picked, "gamma");
    const at = out.indexOf("# beta");
    assert.ok(at >= 0 && out[at + 1] === "line two of beta", "the preview of entry 2 is printed");
    assert.ok(!out.includes("# alpha"));
    assert.equal(err.length, 0);
  });

  it("a pre-answer from createAnswers is echoed and the pipe is not read for it", async () => {
    const answers = createAnswers(
      { link: false, answers: [{ id: "rules-action", value: "REFRESH" }] },
      "claude",
      io,
    );
    const stream = new PassThrough();
    stream.end("y\ninternal\n");
    const { queue, session } = await linked(stream, answers);
    assert.equal(await session.choose(rulesQuestion()), "refresh");
    assert.ok(out.includes("[answer] rules-action=refresh"));
    assert.equal(await queue.next(), "internal");
    assert.deepEqual(answers.unused(), []);
  });

  describe("cancel classes on a fake terminal at the end of input", () => {
    const ended = async () => {
      const stream = new PassThrough();
      stream.end();
      const queue = createLineQueue(stream);
      return createSession({ queue, answers: none, io, isTty: true });
    };
    const q = (id: string, cancel: CancelClass) => ({
      id,
      header: `Header ${id}`,
      options: ["no", "yes"],
      cancel,
    });

    it("abort exits 130 and names the header", async () => {
      const session = await ended();
      await assert.rejects(session.choose(q("overlay.org", "abort")), SetupCancelled);
      assert.deepEqual(err, ["Setup cancelled at: Header overlay.org"]);
    });

    it("decline continues without a value, default takes the first option", async () => {
      const session = await ended();
      assert.equal(await session.choose(q("tls-delegation", "decline")), undefined);
      assert.equal(await session.choose(q("validation.backend", "default")), "no");
      assert.deepEqual(err, []);
    });
  });
});
