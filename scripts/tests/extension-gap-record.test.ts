// extension-gap-record.test.ts — the in-memory gap channel and its file (spec 0254 R13).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { createGapChannel, gapKey, gapToJson, writeGapFile } from "../lib/extension/gap-record.ts";
import { parseJson } from "../lib/extension/json-ordered.ts";
import type { Gap } from "../lib/extension/types.ts";

const scratch: string[] = [];

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ext-gap-"));
  scratch.push(dir);
  return dir;
}

after(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

const subjectGap: Gap = { subject: "mcpServers", target: "gemini", reason: "no delivery" };
const hookGap: Gap = {
  subject: "hooks",
  target: "claude",
  hook: "guard",
  event: "pre-tool",
  part: "matcher",
  reason: "unmappable",
};

describe("channel", () => {
  it("appends in emission order", () => {
    const channel = createGapChannel();
    channel.record(hookGap);
    channel.record(subjectGap);
    assert.deepEqual(channel.gaps, [hookGap, subjectGap]);
  });
});

describe("gapKey", () => {
  it("keys a subject gap on subject@target", () => {
    assert.equal(gapKey(subjectGap), "mcpServers@gemini");
  });

  it("adds hook, event and part for a hook gap", () => {
    assert.equal(gapKey(hookGap), "hooks@claude@guard@pre-tool@matcher");
  });

  it("keys a record read back from a file by the same rule", () => {
    assert.equal(gapKey(gapToJson(hookGap)), "hooks@claude@guard@pre-tool@matcher");
    assert.equal(gapKey(gapToJson(subjectGap)), "mcpServers@gemini");
    const loose = parseJson('{"subject":"s","target":"t","hook":"h"}', "x") as Map<string, never>;
    assert.equal(gapKey(loose), "s@t@h@null@null");
  });
});

describe("writeGapFile", () => {
  it("writes an empty array and a line feed, creating parent directories", () => {
    const file = path.join(tmp(), "build", "gaps", "x", "observed-gaps.json");
    writeGapFile(file, []);
    assert.equal(fs.readFileSync(file, "utf8"), "[]\n");
  });

  it("writes the pretty array with keys in record order", () => {
    const file = path.join(tmp(), "gaps.json");
    writeGapFile(file, [hookGap, subjectGap]);
    assert.equal(
      fs.readFileSync(file, "utf8"),
      [
        "[",
        "  {",
        '    "subject": "hooks",',
        '    "target": "claude",',
        '    "hook": "guard",',
        '    "event": "pre-tool",',
        '    "part": "matcher",',
        '    "reason": "unmappable"',
        "  },",
        "  {",
        '    "subject": "mcpServers",',
        '    "target": "gemini",',
        '    "reason": "no delivery"',
        "  }",
        "]",
        "",
      ].join("\n"),
    );
  });
});
