// model-ci-tooling-yq-comments.test.ts — the `key | line_comment` scanner against real yq
// (spec 0262 req 24, v3-F1). Corpus: every workflow file, .gitlab-ci.yml and adversarial
// comments. The yq leg is skipped where yq is absent; temp files live in one mkdtemp dir.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { keyComments } from "../lib/yq-accessors/comments.ts";
import { REPO } from "./lib/worktree-fixtures.ts";

const HAVE_YQ = spawnSync("yq", ["--version"]).status === 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-yqc-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const ADVERSARIAL: [string, string][] = [
  ["trailing", "jobs:\n  a: # c1\n    x: 1\n  b: v # c2\n  c:   #   spaced   \n    x: 1\n"],
  [
    "quotes",
    'jobs:\n  d: "q # not" # c4\n  \'e\': # c5\n    x: 1\n  "p#q": # hashinkey\n    x: 1\n',
  ],
  [
    "block-scalar",
    "jobs:\n  f: |  # c6\n    text # no\n    b: # no\n  g: {a: 1} # c7\n  h: # yes\n    x: 1\n",
  ],
  ["next-line", "jobs:\n  h: # first\n    # next\n    x: 1\n  i:\n    # following\n    x: 1\n"],
  [
    "hash-forms",
    "jobs:\n  j: # \n    x: 1\n  k: #nospace\n    x: 1\n  l: # a # b\n    x: 1\n  f: #\n    x: 1\n  i: ## two\n    x: 1\n  h: #\ttab\n    x: 1\n",
  ],
  [
    "anchors-tags",
    "jobs:\n  d: &anc # anchor\n    x: 1\n  e: !!map # tag\n    x: 1\n  u: &a2 # c9\n    - 1\n  s: >- # fold\n    t\n",
  ],
  [
    "null-scalar-seq",
    "jobs:\n  a: # null value\n  b: # scalar next\n    word\n  c: # seq same indent\n  - x\n  n: # flow next\n    {a: 1}\n",
  ],
  ["tab-sep", 'jobs:\n  m:\t# tabsep\n    x: 1\n  "j k": # quoted key\n    x: 1\n'],
  ["crlf", "jobs:\r\n  a: # crlf\r\n    x: 1\r\n  b:\r\n    y: 2\r\n"],
  ["trailing-ws", "jobs:\n  g: # trailing ws   \n    x: 1\n"],
];

function yqPairs(file: string, parent: string | null): [string, string][] {
  const expr = (parent === null ? "" : `.${parent}`) + "[] | [ key, (key | line_comment) ] | .[]";
  const r = spawnSync(
    "yq",
    [
      "-N",
      "-0",
      "-r",
      parent === null
        ? ".[] | [ key, (key | line_comment) ] | .[]"
        : `.${parent}[] | [ key, (key | line_comment) ] | .[]`,
      file,
    ],
    {
      encoding: "utf8",
    },
  );
  assert.equal(r.status, 0, `${expr}: ${r.stderr}`);
  const toks = r.stdout.split("\0");
  toks.pop();
  const out: [string, string][] = [];
  for (let i = 0; i < toks.length; i += 2) out.push([toks[i] as string, toks[i + 1] as string]);
  return out;
}

function corpus(name: string, text: string, parent: string | null): void {
  const file = path.join(tmp, name.replace(/[^\w.-]/g, "_"));
  fs.writeFileSync(file, text);
  const mine = keyComments(text, parent).map((k) => [k.key, k.comment]);
  assert.deepEqual(mine, yqPairs(file, parent), name);
}

describe("keyComments against yq", { skip: !HAVE_YQ && "yq absent" }, () => {
  for (const [name, text] of ADVERSARIAL)
    test(`adversarial: ${name}`, () => corpus(name, text, "jobs"));
  const wfDir = path.join(REPO, ".github", "workflows");
  for (const f of fs.readdirSync(wfDir).filter((n) => /\.ya?ml$/.test(n)))
    test(`workflow ${f}`, () => {
      const text = fs.readFileSync(path.join(wfDir, f), "utf8");
      if (/^jobs:/m.test(text)) corpus(f, text, "jobs");
    });
  test(".gitlab-ci.yml top-level keys", () =>
    corpus("gitlab", fs.readFileSync(path.join(REPO, ".gitlab-ci.yml"), "utf8"), null));
});

describe("keyComments static expectations", () => {
  test("rules without yq", () => {
    const got = keyComments(
      "jobs:\n  a: # c1\n    x: 1\n  b: v # c2\n  k: #n\n    x: 1\n  f: #\n    y: 1\n",
      "jobs",
    );
    assert.deepEqual(
      got.map((k) => k.comment),
      ["c1", "", "#n", "#"],
    );
  });
});
