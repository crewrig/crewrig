// skill-scripts-secrets-engine-drift.test.ts — the three copies of the secrets-exposure engine
// (security, github-actions, gitlab-ci) are byte-identical except for the one line marked
// `crewrig:default-platform` (spec 0303 R6, R13). A mutated copy must fail, naming its file and the
// first differing line.

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";

import { COPIES, defaultOf, firstDrift, type Copy } from "./lib/skill-scripts-secrets-engine.ts";

const copies: Copy[] = COPIES.map((c) => ({ name: c.skill, text: fs.readFileSync(c.file, "utf8") }));

describe("engine copies", () => {
  test("the three copies differ only on the marked line", () => {
    assert.equal(firstDrift(copies), undefined);
  });
  test("each copy holds exactly one marked line, with its default platform", () => {
    const want: Record<string, string> = {
      security: "undefined",
      "github-actions": '"github"',
      "gitlab-ci": '"gitlab"',
    };
    for (const c of copies) assert.equal(defaultOf(c.text), want[c.name], c.name);
  });
  test("a mutated copy fails, naming its file and its first differing line", () => {
    const lines = (copies[1]?.text ?? "").split("\n");
    const at = lines.findIndex((l) => l.includes("not a file or directory"));
    assert.ok(at > 0);
    lines[at] = `${lines[at]} `;
    const mutated: Copy[] = [copies[0] as Copy, { name: "github-actions", text: lines.join("\n") }, copies[2] as Copy];
    assert.equal(firstDrift(mutated), `github-actions:${at + 1}`);
  });
  test("a change on the marked line alone is not drift, a second marked line is not tolerated", () => {
    const other = (copies[0]?.text ?? "").replace("=> undefined;", '=> "gitlab";');
    assert.equal(firstDrift([copies[0] as Copy, { name: "x", text: other }]), undefined);
    const twice = `${copies[0]?.text}\nconst defaultPlatform = (): string | undefined => undefined; // crewrig:default-platform\n`;
    assert.equal(defaultOf(twice), undefined);
    assert.notEqual(firstDrift([copies[0] as Copy, { name: "twice", text: twice }]), undefined);
  });
});
