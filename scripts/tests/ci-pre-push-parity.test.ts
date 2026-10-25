// Tests for scripts/check-ci-pre-push-parity.ts and scripts/lib/ci-pre-push/normalize.ts
// (spec 0279 R3, R4, R5; plan v2 step 2, finding v1-F3). Fixture trees live in mkdtemp
// directories and are driven through the `--root` CLI; the REAL tree must also pass.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  CONTROL_TASKS,
  capabilityTaskName,
  expandFileVars,
  isProvisioning,
  normalizeCommand,
  taskCallRefs,
  taskItems,
} from "../lib/ci-pre-push/normalize.ts";
import { makeSandbox, REPO, runEntry } from "./lib/governance-sandbox.ts";

const ENTRY = path.join(REPO, "scripts", "check-ci-pre-push-parity.ts");
const ROOT_NAME = ["Task", "file.yml"].join("");

const ROOT = `version: '3.54'
vars:
  REPO_DIR: '{{.PWD}}'
includes:
  ci: ./taskfiles/ci.yml
tasks:
  lint-md:
    cmds:
      - markdownlint --ignore node_modules "**/*.md"
`;

const CAPS = (cmds: readonly string[]): string => `capabilities:
  - id: alpha
    name: "Alpha"
    trigger:
      - on: pull-request
        branches: [main]
    portability: portable
    command:
${cmds.map((c) => `      - ${JSON.stringify(c)}`).join("\n")}
`;

const CI_TASK = (cmds: readonly string[]): string => `version: '3.54'
tasks:
  alpha:
    cmds:
${cmds.map((c) => `      - ${c}`).join("\n")}
  pre-push:
    cmds:
      - echo control
`;

interface Tree {
  root?: string;
  ci?: string;
  caps?: string;
  tier?: string | null;
}

const BASE_CMDS = ["node scripts/a.ts --flag --ignore x", "node scripts/b.ts"];

function stage(t: Tree = {}): string {
  const dir = makeSandbox("ci-pre-push-parity-");
  fs.mkdirSync(path.join(dir, "taskfiles"));
  fs.mkdirSync(path.join(dir, "ci"));
  fs.writeFileSync(path.join(dir, ROOT_NAME), t.root ?? ROOT);
  fs.writeFileSync(
    path.join(dir, "taskfiles", "ci.yml"),
    t.ci ??
      CI_TASK([
        "node {{.REPO_DIR}}/scripts/a.ts --flag --ignore x",
        "node scripts/b.ts {{.CLI_ARGS}}",
      ]),
  );
  fs.writeFileSync(path.join(dir, "ci", "ci-capabilities.yml"), t.caps ?? CAPS(BASE_CMDS));
  if (t.tier !== null)
    fs.writeFileSync(path.join(dir, "ci", "pre-push-tier.json"), t.tier ?? '{"alpha": 1}');
  return dir;
}

function parity(dir?: string): { status: number | null; stdout: string; stderr: string } {
  return runEntry(ENTRY, { args: dir === undefined ? [] : ["--root", dir] });
}

const ciWith = (cmds: readonly string[]): string => CI_TASK(cmds);

describe("normalize.ts units", () => {
  it("strips the REPO_DIR prefix, a trailing CLI_ARGS and collapses whitespace", () => {
    assert.equal(normalizeCommand("node  {{.REPO_DIR}}/x.ts   {{.CLI_ARGS}}"), "node x.ts");
    assert.equal(normalizeCommand("a {{.CLI_ARGS}} b"), "a {{.CLI_ARGS}} b");
  });

  it("expands file variables one level deep before the REPO_DIR strip", () => {
    const vars = new Map([["NODE_SCRIPTS", "node {{.REPO_DIR}}/scripts"]]);
    assert.equal(
      normalizeCommand(expandFileVars("{{.NODE_SCRIPTS}}/x.ts", vars)),
      "node scripts/x.ts",
    );
    assert.equal(expandFileVars("{{.OTHER}}/x", vars), "{{.OTHER}}/x");
  });

  it("recognises provisioning only as a leading npm ci / npm install word", () => {
    assert.equal(isProvisioning("npm ci"), true);
    assert.equal(isProvisioning("npm install --no-audit"), true);
    assert.equal(isProvisioning("npm run build"), false);
    assert.equal(isProvisioning("npm cinema"), false);
  });

  it("reads a capability-side task command name, not a flagged invocation", () => {
    assert.equal(capabilityTaskName("task spec:lint"), "spec:lint");
    assert.equal(capabilityTaskName("task -x foo"), undefined);
    assert.equal(capabilityTaskName("node task x"), undefined);
  });

  it("lists task items and call refs verbatim in order", () => {
    const def = { cmds: ["a", { cmd: "b" }, { task: "x" }, { task: ":y" }, 3] };
    assert.deepEqual(taskItems(def), ["a", "b", { task: "x" }, { task: ":y" }]);
    assert.deepEqual(taskCallRefs(def), ["x", ":y"]);
    assert.deepEqual(taskItems({ cmd: "solo" }), ["solo"]);
  });

  it("keeps the control task set closed", () => {
    assert.deepEqual(
      [...CONTROL_TASKS],
      ["ci:pre-push", "ci:hooks-install", "ci:hooks-uninstall", "ci:hooks-status"],
    );
  });
});

describe("check-ci-pre-push-parity CLI on fixture trees", () => {
  it("passes a clean tree and tolerates the REPO_DIR prefix and trailing CLI_ARGS", () => {
    const r = parity(stage());
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /ci-pre-push-parity: OK/);
  });

  it("fails a changed flag, naming the capability id", () => {
    const r = parity(
      stage({ ci: ciWith(["node scripts/a.ts --other --ignore x", "node scripts/b.ts"]) }),
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /command-mismatch: ci:alpha: capability 'alpha' command #1 differs/);
  });

  it("fails a dropped --ignore", () => {
    const r = parity(stage({ ci: ciWith(["node scripts/a.ts --flag", "node scripts/b.ts"]) }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /command-mismatch: ci:alpha: capability 'alpha'/);
  });

  it("fails a reordered command list", () => {
    const r = parity(
      stage({ ci: ciWith(["node scripts/b.ts", "node scripts/a.ts --flag --ignore x"]) }),
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /command-mismatch: ci:alpha: capability 'alpha' command #1 differs/);
  });

  it("fails a tier id with no ci task", () => {
    const r = parity(stage({ tier: '{"alpha": 1, "ghost": 2}' }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /missing-task: ghost: tier id 'ghost' has no 'ci:ghost' task/);
  });

  it("fails a ci task with no capability, naming the id", () => {
    const ci = `${CI_TASK(["node scripts/a.ts --flag --ignore x", "node scripts/b.ts"])}  orphan:\n    cmds:\n      - echo x\n`;
    const r = parity(stage({ ci }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no-capability: ci:orphan: no capability 'orphan'/);
  });

  it("fails a leftover npm ci in a ci task as provisioning", () => {
    const r = parity(
      stage({ ci: ciWith(["npm ci", "node scripts/a.ts --flag --ignore x", "node scripts/b.ts"]) }),
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /provisioning: ci:alpha: provisioning command 'npm ci'/);
    assert.doesNotMatch(r.stderr, /command-mismatch/);
  });

  it("drops provisioning on the capability side too", () => {
    const r = parity(stage({ caps: CAPS(["npm install", ...BASE_CMDS]) }));
    assert.equal(r.status, 0, r.stderr);
  });

  it("fails an unanchored task call that also exists as ci:<name>, passes the anchored form", () => {
    const withCall = (ref: string): string =>
      `version: '3.54'
tasks:
  alpha:
    cmds:
      - task: ${ref}
  lint-md:
    cmds:
      - echo shadow
  pre-push:
    cmds:
      - echo control
`;
    const caps = CAPS(['markdownlint --ignore node_modules "**/*.md"']);
    const bad = parity(stage({ ci: withCall("lint-md"), caps }));
    assert.equal(bad.status, 1);
    assert.match(
      bad.stderr,
      /unanchored-call: ci:alpha: '- task: lint-md' must be written colon-anchored/,
    );
    const good = parity(stage({ ci: withCall('":lint-md"'), caps }));
    assert.match(good.stderr, /^(?![\s\S]*unanchored-call)/);
    assert.equal(good.status, 1, "ci:lint-md has no capability: only that finding remains");
    assert.match(good.stderr, /no-capability: ci:lint-md/);
  });

  it("applies the anchoring check to a file under taskfiles/ci/ (spec 0278 R24, R26)", () => {
    const control = `version: '3.54'
includes:
  gate: { taskfile: ./ci/gate.yml, flatten: true }
tasks:
  pre-push:
    cmds:
      - echo control
`;
    const gate = (ref: string): string => `version: '3.54'
tasks:
  alpha:
    cmds:
      - task: ${ref}
  lint-md:
    cmds:
      - echo shadow
`;
    const staged = (ref: string): string => {
      const dir = stage({
        ci: control,
        caps: CAPS(['markdownlint --ignore node_modules "**/*.md"']),
      });
      fs.mkdirSync(path.join(dir, "taskfiles", "ci"));
      fs.writeFileSync(path.join(dir, "taskfiles", "ci", "gate.yml"), gate(ref));
      return dir;
    };
    const bad = parity(staged("lint-md"));
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /unanchored-call: ci:alpha: '- task: lint-md' must be written/);
    const good = parity(staged('":lint-md"'));
    assert.match(good.stderr, /^(?![\s\S]*unanchored-call)/);
  });

  it("expands a capability-side `task <name>` against the Taskfile side", () => {
    const ci = `version: '3.54'
tasks:
  alpha:
    cmds:
      - task: ":lint-md"
  pre-push:
    cmds:
      - echo control
`;
    const r = parity(stage({ ci, caps: CAPS(["task lint-md"]) }));
    assert.equal(r.status, 0, r.stderr);
  });

  it("reports an unresolvable task call as unresolved", () => {
    const ci = `version: '3.54'
tasks:
  alpha:
    cmds:
      - task: ":nowhere"
  pre-push:
    cmds:
      - echo control
`;
    const r = parity(stage({ ci }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unresolved: ci:alpha:/);
  });

  // Spec 0278 R22 b / R26 / R28 c: a file variable whose value itself contains `{{.REPO_DIR}}/`
  // is expanded before the prefix strip, so it never produces a finding.
  const VARS_CI = (a: string): string => `version: '3.54'
vars:
  NODE_SCRIPTS: "node {{.REPO_DIR}}/scripts"
tasks:
  alpha:
    cmds:
      - '{{.NODE_SCRIPTS}}/a.ts ${a}'
      - node scripts/b.ts
  pre-push:
    cmds:
      - echo control
`;

  it("expands a file variable containing REPO_DIR and passes the expanded capability text", () => {
    const r = parity(stage({ ci: VARS_CI("--flag --ignore x") }));
    assert.equal(r.status, 0, r.stderr);
  });

  it("still fails a real command difference behind a file variable", () => {
    const r = parity(stage({ ci: VARS_CI("--other --ignore x") }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /command-mismatch: ci:alpha: capability 'alpha' command #1 differs/);
  });

  it("exits 2 with a NOTICE when the tier file is absent", () => {
    const r = parity(stage({ tier: null }));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /ci-pre-push-parity: NOTICE cannot read ci\/pre-push-tier\.json/);
  });

  it("exits 2 with a NOTICE when the tier file is not a JSON object", () => {
    const r = parity(stage({ tier: "[1]" }));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /NOTICE .*not a JSON object/);
  });

  it("exits 2 with a NOTICE when the capability file is unreadable", () => {
    const dir = stage();
    fs.rmSync(path.join(dir, "ci", "ci-capabilities.yml"));
    const r = parity(dir);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /NOTICE cannot read ci\/ci-capabilities\.yml/);
  });
});

describe("check-ci-pre-push-parity on the real tree", () => {
  it("passes", () => {
    const r = parity();
    assert.equal(r.status, 0, r.stderr);
  });
});
