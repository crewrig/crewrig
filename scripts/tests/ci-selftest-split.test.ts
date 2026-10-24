// Tests for the checker self-test split (spec 0281 R2, R3, R4, R5; plan v3 step 7): each
// `<id>-selftest` capability pairs with its check `<id>` in ci/ci-capabilities.yml,
// taskfiles/ci.yml, .github/workflows/build.yml and ci/pre-push-tier.json. Read-only over the
// real tree except the parity fixture, which lives in a mkdtemp sandbox.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { load } from "js-yaml";
import { loadCapabilities, loadTier, selectFromChangeset } from "../lib/ci-pre-push/select.ts";
import { makeSandbox, REPO, runEntry } from "./lib/governance-sandbox.ts";

interface Cap {
  env?: Record<string, string>;
  cache?: { files: string[]; env: string[] };
  id: string;
  portability?: string;
  "changeset-gated"?: boolean;
  paths?: string[];
  trigger: { on: string; branches?: string[]; paths?: string[] }[];
  requires?: { runtime?: string; tools?: string[]; "history-depth"?: string };
  command: string[];
}

const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), "utf8");
const caps = (load(read("ci/ci-capabilities.yml")) as { capabilities: Cap[] }).capabilities;
const byId = new Map(caps.map((c) => [c.id, c]));
const SELFTESTS = caps.filter((c) => c.id.endsWith("-selftest"));
const PAIRS: Record<string, { source: string; test: string }> = {
  "lint-specs": {
    source: "scripts/lib/spec-linter.js",
    test: "scripts/tests/spec-linter-structure.test.ts",
  },
  "lint-typescript": {
    source: "scripts/check-typescript.ts",
    test: "scripts/tests/lint-typescript.test.ts",
  },
  ratchet: { source: "scripts/check-ratchet.ts", test: "scripts/tests/check-ratchet.test.ts" },
  "host-safety": {
    source: "scripts/check-host-safety.ts",
    test: "scripts/tests/check-host-safety.test.ts",
  },
  "path-ownership": {
    source: "scripts/check-path-ownership.ts",
    test: "scripts/tests/check-path-ownership.test.ts",
  },
};
const DATA: Record<string, string> = {
  "docs-index": "docs/a.md",
  "cli-matrix-fresh": "docs/cli-matrix.md",
  "component-drift": "artifacts/x/y.md",
  "test-wiring": "ci/test-wiring-exemptions.txt",
  "check-taskfile-commands": "taskfiles/lint.yml",
  "check-taskfile-tree": ".githooks/pre-push",
};
const CI_TASKS = read("taskfiles/ci.yml");
/** Spec 0283 R1: a migrated capability is the single `task ci:<id>`; its commands live in the task. */
function resolvedCommands(c: Cap): string[] {
  const m = /^task ci:(\S+)$/.exec(c.command[0] ?? "");
  if (c.command.length !== 1 || !m) return c.command;
  const body = new RegExp(`\\n  ${m[1]}:\\n([\\s\\S]*?)(?=\\n  [a-z0-9-]+:\\n|$)`).exec(CI_TASKS);
  assert.ok(body, `task ci:${m[1]}`);
  return [
    ...(body[1] ?? "")
      .split("    cmds:\n")
      .slice(1)
      .join("")
      .matchAll(/^ {6}- (?!task:)(.+)$/gm),
  ].map((x) => (x[1] ?? "").replaceAll("{{.REPO_DIR}}/", ""));
}
const BATCH_A = Object.keys(PAIRS); // every split pair, batches A and B
const PROVISIONING = /^npm (ci|install)( |$)/;
const FLOOR = /node-floor-guard\.js$/;
const isTest = (c: string): boolean => / --test /.test(c);

describe("self-test split: structure (a, c)", () => {
  it("splits at least the five batch A bundles", () => {
    for (const id of BATCH_A) assert.ok(byId.has(`${id}-selftest`), `${id}-selftest missing`);
  });

  for (const st of SELFTESTS) {
    const id = st.id.replace(/-selftest$/, "");
    it(`${st.id}: has a sibling check, only test or provisioning commands, is gated`, () => {
      const check = byId.get(`${id}-check`) ?? byId.get(id);
      assert.ok(check, `no sibling check '${id}'`);
      assert.equal(st["changeset-gated"], true);
      const stCmds = resolvedCommands(st);
      for (const c of stCmds)
        assert.ok(isTest(c) || PROVISIONING.test(c) || FLOOR.test(c), `unexpected command: ${c}`);
      assert.ok(stCmds.some(isTest), "a self-test capability runs at least one --test");
      for (const c of resolvedCommands(check))
        assert.ok(!isTest(c), `check still runs a test: ${c}`);
      assert.ok(
        st.trigger.every((t) => (t.paths ?? st.paths ?? []).length > 0),
        "a self-test trigger carries paths",
      );
    });

    it(`${st.id}: env, tools, history-depth and cache follow the R-fields rules`, () => {
      const check = (byId.get(`${id}-check`) ?? byId.get(id)) as Cap;
      assert.equal(st.env, undefined, "env stays with the check");
      assert.equal(st.requires?.["history-depth"], undefined);
      for (const tool of st.requires?.tools ?? [])
        assert.ok(check.requires?.tools?.includes(tool), `tool ${tool} not on the check`);
      assert.equal(st.cache === undefined, check.cache === undefined, "cache on both or neither");
      if (st.cache !== undefined) {
        const own = new Set(st.trigger[0]?.paths ?? st.paths ?? []);
        for (const f of st.cache.files)
          assert.ok(
            own.has(f) || f === "scripts/ci-cache-guard.ts",
            `cache file ${f} outside paths`,
          );
      }
    });

    it(`${st.id}: runtime, portability and branches equal the check's`, () => {
      const check = (byId.get(`${id}-check`) ?? byId.get(id)) as Cap;
      assert.equal(st.requires?.runtime, check.requires?.runtime);
      assert.equal(st.portability, check.portability);
      assert.deepEqual(
        st.trigger.map((t) => [t.on, t.branches]),
        check.trigger.map((t) => [t.on, t.branches]),
      );
    });
  }
});

describe("self-test split: selection (b)", () => {
  const all = loadCapabilities(REPO);
  const tier = Object.fromEntries(caps.map((c) => [c.id, 1]));
  const select = (files: string[]): string[] => selectFromChangeset(all, tier, files).ids;

  for (const id of BATCH_A) {
    const { source, test: testFile } = PAIRS[id] as { source: string; test: string };
    it(`${id}: data-only change selects the check, not the self-test`, () => {
      const ids = select([DATA[id] ?? "specs/0001-x.md"]);
      assert.ok(ids.includes(id));
      assert.ok(!ids.includes(`${id}-selftest`));
    });
    it(`${id}: a tests-only change selects the self-test`, () => {
      assert.ok(select([testFile]).includes(`${id}-selftest`));
    });
    it(`${id}: a checker-source change selects both`, () => {
      const ids = select([source]);
      assert.ok(ids.includes(id));
      assert.ok(ids.includes(`${id}-selftest`));
    });
  }

  it("every self-test id in the tier file has a task and a capability", () => {
    const t = loadTier(REPO);
    for (const id of Object.keys(t)) assert.ok(byId.has(id), `${id} not a capability`);
    for (const id of BATCH_A) {
      assert.ok(id in t && `${id}-selftest` in t);
    }
  });
});

describe("self-test split: workflow and parity (d, e)", () => {
  it("every build.yml job key equals a capability id", () => {
    const jobs = Object.keys((load(read(".github/workflows/build.yml")) as { jobs: object }).jobs);
    for (const st of SELFTESTS) assert.ok(jobs.includes(st.id), `build.yml lacks job ${st.id}`);
  });

  it("every self-test id has a ci:<id> task running its commands only", () => {
    const ci = (load(read("taskfiles/ci.yml")) as { tasks: Record<string, { cmds: unknown[] }> })
      .tasks;
    for (const st of SELFTESTS) {
      const t = ci[st.id];
      assert.ok(t, `task ci:${st.id} missing`);
      assert.ok(t.cmds.every((c) => typeof c === "string" && (isTest(c) || FLOOR.test(c))));
    }
  });

  it("a -selftest command differing from its task fails the parity guard, naming it", () => {
    const dir = makeSandbox("selftest-split-parity-");
    fs.mkdirSync(path.join(dir, "taskfiles"));
    fs.mkdirSync(path.join(dir, "ci"));
    fs.writeFileSync(
      path.join(dir, ["Task", "file.yml"].join("")),
      "version: '3.39'\nvars:\n  REPO_DIR: '{{.PWD}}'\nincludes:\n  ci: ./taskfiles/ci.yml\ntasks:\n  noop:\n    cmds:\n      - echo x\n",
    );
    const cap = (id: string, cmd: string): string =>
      `  - id: ${id}\n    name: "${id}"\n    trigger:\n      - on: pull-request\n        branches: [main]\n    portability: portable\n    command:\n      - ${cmd}\n`;
    fs.writeFileSync(
      path.join(dir, "ci", "ci-capabilities.yml"),
      `capabilities:\n${cap("alpha", "node scripts/a.ts")}${cap("alpha-selftest", "node --test scripts/tests/a.test.ts")}`,
    );
    fs.writeFileSync(
      path.join(dir, "taskfiles", "ci.yml"),
      "version: '3.39'\ntasks:\n  alpha:\n    cmds:\n      - node scripts/a.ts\n  alpha-selftest:\n    cmds:\n      - node --test scripts/tests/other.test.ts\n  pre-push:\n    cmds:\n      - echo control\n",
    );
    fs.writeFileSync(
      path.join(dir, "ci", "pre-push-tier.json"),
      '{"alpha": 1, "alpha-selftest": 1}',
    );
    const r = runEntry(path.join(REPO, "scripts", "check-ci-pre-push-parity.ts"), {
      args: ["--root", dir],
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /alpha-selftest/);
  });
});
