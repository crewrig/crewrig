// setup-catalogue.test.ts — the catalogue picker of the setup graph (spec 0256 requirement 17).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { Io } from "../lib/extension/types.ts";
import { SetupExit } from "../lib/setup/exit.ts";
import { catalogueEntries, pickCatalogueEntry } from "../lib/setup/catalogue.ts";
import type { CatalogueQuestion, CatalogueSession } from "../lib/setup/catalogue.ts";

interface Recorded {
  readonly out: string[];
  readonly err: string[];
  readonly io: Io;
}

function recorder(): Recorded {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    out: (line) => void out.push(line),
    err: (line) => void err.push(line),
    errRaw: (text) => void err.push(text),
  };
  return { out, err, io };
}

/** A session answering from a script; a line the question passes through is returned as typed. */
function scripted(
  lines: readonly (string | undefined)[],
  asked: CatalogueQuestion[],
): CatalogueSession {
  const queue = [...lines];
  return {
    choose: async (question) => {
      asked.push(question);
      const line = queue.shift();
      if (line === undefined) return undefined;
      if (question.passthrough?.(line) === true) return line;
      const n = /^[0-9]+$/.test(line) ? question.options[Number(line) - 1] : undefined;
      return n ?? line;
    },
  };
}

describe("catalogue picker", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-catalogue-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const seed = (names: readonly string[]): void => {
    for (const name of names) fs.writeFileSync(path.join(dir, name), `body of ${name}\n`);
  };

  it("lists the *.md basenames sorted ordinally, not by locale", () => {
    seed(["b.md", "Bz.md", "a.md", "Zed.md", "_x.md", "notes.txt", ".hidden.md", "é.md"]);
    assert.deepEqual(catalogueEntries(dir), ["Bz", "Zed", "_x", "a", "b", "é"]);
  });

  it("asks once, with the entries as options, the id and the decline class", async () => {
    seed(["ATLAS.md", "ZEUS.md"]);
    const { io, out, err } = recorder();
    const asked: CatalogueQuestion[] = [];
    const picked = await pickCatalogueEntry(scripted(["2"], asked), {
      id: "catalogue.team",
      dir,
      label: "team",
      io,
    });
    assert.equal(picked, "ZEUS");
    assert.equal(asked.length, 1);
    assert.equal(asked[0]?.id, "catalogue.team");
    assert.deepEqual(asked[0]?.options, ["ATLAS", "ZEUS"]);
    assert.equal(asked[0]?.cancel, "decline");
    assert.deepEqual([out, err], [[], []]);
  });

  it("prints the first 20 lines of entry N on `?N` and asks again", async () => {
    const body = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    fs.writeFileSync(path.join(dir, "ATLAS.md"), body);
    fs.writeFileSync(path.join(dir, "ZEUS.md"), "short\n");
    const { io, out, err } = recorder();
    const asked: CatalogueQuestion[] = [];
    const picked = await pickCatalogueEntry(scripted(["?1", "?2", "ATLAS"], asked), {
      id: "catalogue.level",
      dir,
      label: "level",
      io,
    });
    assert.equal(picked, "ATLAS");
    assert.equal(asked.length, 3);
    assert.deepEqual(out.slice(0, 20), body.split("\n").slice(0, 20));
    assert.deepEqual(out.slice(20), ["short"]);
    assert.deepEqual(err, []);
  });

  it("reports a preview number outside the catalogue and asks again", async () => {
    seed(["ATLAS.md"]);
    const { io, out, err } = recorder();
    const asked: CatalogueQuestion[] = [];
    const picked = await pickCatalogueEntry(scripted(["?9", "?0", "1"], asked), {
      id: "catalogue.team",
      dir,
      label: "team",
      io,
    });
    assert.equal(picked, "ATLAS");
    assert.equal(asked.length, 3);
    assert.deepEqual(out, []);
    assert.deepEqual(err, ["  No entry 9 (choose 1-1).", "  No entry 0 (choose 1-1)."]);
  });

  for (const missing of [true, false]) {
    it(`short-circuits an empty catalogue (${missing ? "missing directory" : "no *.md"}) before any question`, async () => {
      const target = missing ? path.join(dir, "absent") : dir;
      if (!missing) seed(["notes.txt", ".hidden.md"]);
      const { io, out, err } = recorder();
      const asked: CatalogueQuestion[] = [];
      const picked = await pickCatalogueEntry(scripted(["1"], asked), {
        id: "catalogue.expertise",
        dir: target,
        label: "expertise",
        io,
      });
      assert.equal(picked, undefined);
      assert.equal(asked.length, 0);
      assert.deepEqual(out, []);
      assert.deepEqual(err, [
        `No expertise catalogue entries found under ${target} — skipping expertise selection.`,
      ]);
    });
  }

  for (const declined of [undefined, ""]) {
    it(`returns undefined with the shell's message for a declined pick (${JSON.stringify(declined)})`, async () => {
      seed(["ATLAS.md"]);
      const { io, out, err } = recorder();
      const asked: CatalogueQuestion[] = [];
      const picked = await pickCatalogueEntry(scripted([declined], asked), {
        id: "catalogue.level",
        dir,
        label: "level",
        io,
      });
      assert.equal(picked, undefined);
      assert.equal(asked.length, 1);
      assert.deepEqual(out, []);
      assert.deepEqual(err, ["No level selected — skipping level selection."]);
    });
  }

  it("rejects a pre-answer naming no entry with status 2", async () => {
    seed(["ATLAS.md"]);
    const { io, err } = recorder();
    await assert.rejects(
      pickCatalogueEntry(scripted(["NOPE"], []), {
        id: "catalogue.team",
        dir,
        label: "team",
        io,
      }),
      (error: unknown) => error instanceof SetupExit && error.status === 2,
    );
    assert.equal(err.length, 1);
    assert.match(err[0] ?? "", /invalid answer for 'catalogue.team'/);
  });
});
