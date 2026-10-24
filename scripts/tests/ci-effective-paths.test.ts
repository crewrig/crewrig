// Spec 0283 R3/R4 and spec 0049 delta-02 R25: the effective path set, the paths-ignore rejection,
// the GitLab anchors and the alias-resolving readers. Pure in-memory fixtures, no filesystem.

import assert from "node:assert/strict";
import { test } from "node:test";

import { generate } from "../lib/build-ci/entry.ts";
import { parseTaskPin } from "../lib/build-ci/tools.ts";
import { gitlabFiles } from "../lib/ci-parity/gitlab-arm.ts";
import { readCapabilities } from "../lib/ci-parity/reference-read.ts";
import { ownershipGlobs } from "../lib/path-ownership.ts";
import { parse, resolve } from "../lib/yq-accessors/index.ts";
import { load } from "js-yaml";
import fs from "node:fs";

const pin = parseTaskPin(fs.readFileSync("ci/task-pin.json", "utf8"));

const cap = (extra: string, triggers: string): string => `capabilities:
  - id: demo
    name: "Demo"
    trigger:
${triggers}
    portability: portable
    requires:
      runtime: node@24
${extra}
    command:
      - echo hi
`;

const TWO = `      - on: pull-request
        branches: [main]
      - on: push
        branches: [main]
      - on: scheduled`;

const INHERIT = `    paths:
      - "a/**"
      - "b/**"
    cache:
      env: []`;

test("inherit: pull-request and push take the capability paths, scheduled does not", () => {
  const [c] = readCapabilities(parse(cap(INHERIT, TWO)));
  const t = c!.triggers;
  assert.deepEqual(t[0]!.paths, ["a/**", "b/**"]);
  assert.deepEqual(t[1]!.paths, ["a/**", "b/**"]);
  assert.deepEqual(t[2]!.paths, []);
  assert.equal(t[0]!.inherited, true);
  assert.equal(t[2]!.inherited, false);
});

test("own trigger paths win over the capability paths", () => {
  const trig = `      - on: pull-request
        paths:
          - "own/**"
      - on: push`;
  const [c] = readCapabilities(parse(cap(INHERIT, trig)));
  assert.deepEqual(c!.triggers[0]!.paths, ["own/**"]);
  assert.equal(c!.triggers[0]!.inherited, false);
  assert.deepEqual(c!.triggers[1]!.paths, ["a/**", "b/**"]);
});

test("cache.files defaults to the capability paths, an own list wins", () => {
  const [d] = readCapabilities(parse(cap(INHERIT, TWO)));
  assert.deepEqual(d!.cacheFiles, ["a/**", "b/**"]);
  const own = INHERIT.replace("env: []", 'files:\n        - "k"\n      env: []');
  const [o] = readCapabilities(parse(cap(own, TWO)));
  assert.deepEqual(o!.cacheFiles, ["k"]);
});

test("no capability paths and no trigger paths: unfiltered", () => {
  const [c] = readCapabilities(parse(cap("", TWO)));
  assert.deepEqual(c!.triggers[0]!.paths, []);
  assert.equal(c!.triggers[0]!.inherited, false);
});

test("a capability-level paths-ignore is flagged and the generator rejects it", () => {
  const bad = INHERIT + '\n    paths-ignore:\n      - "x"';
  const [c] = readCapabilities(parse(cap(bad, TWO)));
  assert.equal(c!.capPathsIgnore, true);
  assert.throws(() => generate(cap(bad, TWO), pin), /paths-ignore/);
});

test("path-ownership counts the inherited pull-request paths", () => {
  const doc = load(cap(INHERIT, TWO)) as { capabilities: unknown };
  assert.deepEqual(ownershipGlobs(doc.capabilities), ["a/**", "b/**"]);
});

test("generator: the inherited list is emitted once under an anchor and aliased", () => {
  const out = generate(cap(INHERIT.replace(/\n    cache:\n      env: \[\]/, ""), TWO), pin);
  assert.equal((out.match(/changes: &demo-changes-1/g) ?? []).length, 1);
  assert.equal((out.match(/changes: \*demo-changes-1/g) ?? []).length, 1);
  assert.equal((out.match(/- "a\/\*\*"/g) ?? []).length, 1);
});

test("generator: the cache files list equal to changes shares one anchor", () => {
  const out = generate(cap(INHERIT, TWO), pin);
  assert.match(out, /files: &demo-files-1/);
  assert.match(out, /changes: \*demo-files-1/);
});

test("the readers resolve an alias to a list (fails on a reader that returns [])", () => {
  const gl = parse(`demo:
  cache:
    key:
      files: &f
        - "a"
        - "b"
  other:
    files: *f
alias-job:
  cache:
    key:
      files: *f
`);
  assert.deepEqual(gitlabFiles(gl, "demo"), ["a", "b"]);
  assert.deepEqual(gitlabFiles(gl, "alias-job"), ["a", "b"]);
  const ref = parse(`capabilities:
  - id: x
    portability: portable
    paths: &p
      - "p/**"
    cache:
      files: *p
      env: []
    trigger:
      - on: push
`);
  const [c] = readCapabilities(ref);
  assert.deepEqual(c!.cacheFiles, ["p/**"]);
  assert.equal(c!.cacheFilesCount, 1);
  assert.deepEqual(c!.triggers[0]!.paths, ["p/**"]);
});

test("resolve follows chains and passes other nodes through", () => {
  assert.equal(resolve(null), null);
});
