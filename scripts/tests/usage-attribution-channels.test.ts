// usage-attribution-channels.test.ts — R25 of test-usage-attribution.sh (spec 0208 R25, spec 0260
// groups R25-1..R25-13): the four declaration channels, precedence, and the branch-shape cases.
// One usage root is shared by the whole file, as in the Bash suite (declarations accumulate).
// Synthetic checkouts are hand-written `.git/HEAD` + `config`; no git binary is needed.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { cleanupAll, WINDOWS } from "./lib/worktree-fixtures.ts";
import {
  derive,
  FIXTURES_DIR,
  hasNodeSqlite,
  materializeDb,
  mkTemp,
  readRecord,
} from "./lib/usage-capture-fixtures.ts";
import {
  buildCheckout,
  type Case,
  driver,
  fixture,
  libScript,
  newCase,
  realTmp,
} from "./lib/usage-attribution-rig.ts";

const GITHUB = "git@github.com:crewrig/crewrig.git";
let c: Case;
let syn = "";
let noGit = "";

const decl = (key: string, channel: string, session: string) =>
  driver(c, [
    "declaration-write",
    JSON.stringify({ taskHandoffKey: key, declaringChannel: channel, sessionId: session }),
  ]);

function resolve(rec: string, cwd: string, extra: Record<string, string | undefined> = {}) {
  const out = driver(c, ["resolve", fixture(rec)], { ATTR_CTX_CWD: cwd, ...extra });
  assert.equal(out.status, 0, out.stderr);
  return out.stdout;
}

function checkout(name: string, branch: string, remote?: string): string {
  const dir = path.join(syn, name);
  buildCheckout(dir, branch, remote);
  return dir;
}

function spec(dir: string, file: string, related: number, id: string, slug: string) {
  fs.mkdirSync(path.join(dir, "specs"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "specs", file),
    `---\nid: "${id}"\nslug: ${slug}\nstatus: implemented\ncomplexity: standard\ninteraction-mode: INTERMEDIATE\nrelated-issue: ${related}\nversion: 1.0.0\n---\n\n# ${slug}\n`,
  );
}

describe("usage attribution channels (R25)", () => {
  before(() => {
    c = newCase();
    syn = realTmp("usage-attr-syn-");
    noGit = realTmp("usage-attr-nogit-");
  });
  after(() => cleanupAll());

  test("R25-1 ch1 explicit declaration", () => {
    decl("ch1-key", "explicit", "attr-ch1-session");
    const out = resolve("r25-ch1-explicit.json", noGit);
    assert.match(out, /"channel":"explicit"/);
    assert.match(out, /"taskHandoffKey":"ch1-key"/);
    assert.match(out, /"outcome":"attributed"/);
  });

  test("R25-2 ch2 env", () => {
    const out = resolve("r25-ch2-env.json", noGit, { ATTR_CTX_ENV_CREWRIG_TASK: "ch2-key" });
    assert.match(out, /"channel":"env"/);
    assert.match(out, /"taskHandoffKey":"ch2-key"/);
    assert.match(out, /"outcome":"attributed"/);
  });

  test("R25-3 ch3 worktree", () => {
    const dir = checkout("ch3-checkout", "fix/0777-attr-ch3-probe", GITHUB);
    const out = resolve("r25-ch3-worktree.json", dir);
    assert.match(out, /"channel":"worktree"/);
    assert.match(out, /"taskHandoffKey":"777"/);
    assert.match(out, /"outcome":"attributed"/);
  });

  test("R25-4 ch4 protocol", () => {
    decl("ch4-key", "protocol", "attr-ch4-session");
    const out = resolve("r25-ch4-protocol.json", noGit);
    assert.match(out, /"channel":"protocol"/);
    assert.match(out, /"taskHandoffKey":"ch4-key"/);
    assert.match(out, /"outcome":"attributed"/);
  });

  test("R25-5 malformed ch1 does not fall through", () => {
    decl("has a space", "explicit", "attr-malformed-session");
    const out = resolve("r25-malformed-ch1.json", noGit, {
      ATTR_CTX_ENV_CREWRIG_TASK: "valid-env-key",
    });
    assert.match(out, /"outcome":"unattributed"/);
    assert.match(out, /"channel":"explicit"/);
    assert.match(out, /invalid taskHandoffKey/i);
    assert.ok(!out.includes("valid-env-key"), `env key leaked: ${out}`);
  });

  test("R25-6 (i) spec file maps to related issue", () => {
    const dir = checkout("branch-i", "spec/0208-usage-attribution");
    spec(dir, "0208-usage-attribution.md", 1171, "0208", "usage-attribution");
    const out = resolve("r25-branch-i.json", dir);
    assert.match(out, /"taskHandoffKey":"1171"/);
    assert.match(out, /"channel":"worktree"/);
    assert.ok(!out.includes('"taskHandoffKey":"208"'));
  });

  test("R25-7 (ii) no spec file falls to ch4", () => {
    const dir = checkout("branch-ii", "spec/0208-usage-attribution");
    decl("branch-ii-key", "protocol", "attr-branch-ii-session");
    const out = resolve("r25-branch-ii.json", dir);
    assert.match(out, /"channel":"protocol"/);
    assert.match(out, /"taskHandoffKey":"branch-ii-key"/);
  });

  test("R25-8 (iii) subdir walks up: declaration, then forge asset", () => {
    const dir = checkout("branch-iii", "fix/0900-subdir-case", GITHUB);
    const sub = path.join(dir, "a", "b");
    fs.mkdirSync(sub, { recursive: true });
    const set = libScript(
      c,
      "scripts/lib/usage-store/declaration.js",
      ["set", "--channel", "explicit", "--task-key", "subdir-decl-key"],
      dir,
    );
    assert.equal(set.status, 0, set.stderr);
    const ctx = { ATTR_PROJECT_ROOT_OVERRIDE: sub };
    let out = resolve("r25-branch-iii.json", sub, ctx);
    assert.match(out, /"channel":"explicit"/);
    assert.match(out, /"taskHandoffKey":"subdir-decl-key"/);
    const clear = libScript(c, "scripts/lib/usage-store/declaration.js", ["clear"], dir);
    assert.equal(clear.status, 0, clear.stderr);
    out = resolve("r25-branch-iii.json", sub, ctx);
    assert.match(out, /"channel":"worktree"/);
    assert.match(out, /"taskHandoffKey":"900"/);
    assert.match(out, /"kind":"forge-issue"/);
    assert.ok(out.includes("crewrig/crewrig#900"), out);
  });

  test("R25-9 (iv) pinned residue 203 after the spec file is gone", () => {
    const dir = checkout("branch-iv", "feat/0203-probe-c-guidance-surface");
    spec(dir, "0203-probe-c-guidance-surface.md", 1113, "0203", "probe-c-guidance-surface");
    assert.match(resolve("r25-branch-iv.json", dir), /"taskHandoffKey":"1113"/);
    fs.rmSync(path.join(dir, "specs", "0203-probe-c-guidance-surface.md"));
    assert.match(resolve("r25-branch-iv.json", dir), /"taskHandoffKey":"203"/);
  });

  test("R25-10 (v) no spec file: 54", () => {
    const dir = checkout("branch-v", "fix/0054-delta01-md029");
    assert.match(resolve("r25-branch-v.json", dir), /"taskHandoffKey":"54"/);
  });

  test(
    "R25-11 (vi) cwd worktree segment wins",
    { skip: WINDOWS ? "SKIP: .worktrees segment parsing is exercised on POSIX paths" : false },
    () => {
      const dir = path.join(syn, ".worktrees", "866");
      buildCheckout(dir, "feat/9999-unrelated-branch-name");
      assert.match(resolve("r25-branch-vi.json", dir), /"taskHandoffKey":"866"/);
    },
  );

  test("R25-12 (vii) forge-issue from ssh remote", () => {
    const dir = checkout("branch-vii", "fix/0866-reclassify-harness-transcript-traffic", GITHUB);
    const out = resolve("r25-branch-vii.json", dir);
    assert.match(out, /"taskHandoffKey":"866"/);
    assert.match(out, /"kind":"forge-issue"/);
    assert.ok(out.includes("crewrig/crewrig#866"), out);
  });

  test("R25-13 (viii) unrecognized host", () => {
    const dir = checkout(
      "branch-viii",
      "fix/0900-unrecognized-host-probe",
      "git@git.example.internal:org/repo.git",
    );
    const out = resolve("r25-branch-viii.json", dir, { ATTR_CTX_ENV_FORGE_HOSTS: "" });
    assert.match(out, /"taskHandoffKey":"900"/);
    assert.ok(!out.includes("externalAsset"), out);
    assert.match(out, /no recognized forge host/i);
  });

  // Spec 0271 R10/R11: a subagent needs no declaration of its own when its record resolves
  // through the orchestrator's session declaration or the worktree/branch channel. Every
  // case derives a REAL fixture through the real adapter (never a synthetic record).
  describe("subagent attribution (spec 0271 R10, R11)", () => {
    let scratch = "";
    const fx = (label: string) => path.join(FIXTURES_DIR, ...label.split("/"));
    const identity = (dir: string, n: number) =>
      (readRecord(dir, n) as unknown as { identity: { sessionId: string; agentId: string | null } })
        .identity;

    function derived(cli: string, input: string[], tag: string): string {
      const outDir = path.join(scratch, tag);
      fs.mkdirSync(outDir, { recursive: true });
      const res = derive([cli, ...input], {
        usageRoot: mkTemp("usage-attr-derive-root-"),
        outDir,
        home: mkTemp("usage-attr-derive-home-"),
      });
      assert.equal(res.rc, 0, res.output);
      return outDir;
    }

    function resolveRec(dir: string, n: number, cwd: string) {
      const out = driver(c, ["resolve", path.join(dir, `rec-${n}.json`)], { ATTR_CTX_CWD: cwd });
      assert.equal(out.status, 0, out.stderr);
      return out.stdout;
    }

    before(() => {
      scratch = realTmp("usage-attr-subagent-");
    });

    test("R10 claude-code subagent record resolves through the parent declaration", () => {
      const dir = derived(
        "claude-code",
        [path.join(fx("claude-code/2.1.x-subagents"), "session.jsonl")],
        "cc",
      );
      const main = identity(dir, 0);
      const sub = identity(dir, 1);
      assert.equal(sub.agentId, "agent-fixture01");
      assert.equal(sub.sessionId, "claude-code-fixture-session-002");
      assert.equal(sub.sessionId, main.sessionId);
      decl("r10-parent-key", "protocol", main.sessionId);
      const out = resolveRec(dir, 1, noGit);
      assert.match(out, /"channel":"protocol"/);
      assert.match(out, /"taskHandoffKey":"r10-parent-key"/);
      assert.match(out, /"outcome":"attributed"/);
    });

    test(
      "R11 copilot-cli subagent row shares the parent session id",
      { skip: hasNodeSqlite() ? false : "SKIP: node:sqlite unavailable" },
      () => {
        const db = path.join(scratch, "copilot.sqlite");
        materializeDb(fx("copilot-cli/assistant-usage-events"), db, mkTemp("usage-attr-cp-home-"));
        const dir = derived("copilot-cli", [db, "--home", mkTemp("usage-attr-cp-copy-")], "cp");
        const sub = identity(dir, 1);
        assert.equal(sub.agentId, "agent-fixture-77");
        assert.equal(sub.sessionId, identity(dir, 0).sessionId);
        decl("r11-copilot-key", "protocol", sub.sessionId);
        const out = resolveRec(dir, 1, noGit);
        assert.match(out, /"taskHandoffKey":"r11-copilot-key"/);
        assert.match(out, /"outcome":"attributed"/);
      },
    );

    test("R11 gemini-cli subagent session differs: only the worktree channel hits", () => {
      const dir = derived(
        "gemini-cli",
        [path.join(fx("gemini-cli/subagent-jsonl"), "chats", "main.jsonl")],
        "gem",
      );
      const main = identity(dir, 0);
      const sub = identity(dir, 1);
      assert.notEqual(sub.sessionId, main.sessionId);
      decl("r11-gemini-key", "protocol", main.sessionId);
      const miss = resolveRec(dir, 1, noGit);
      assert.ok(!miss.includes("r11-gemini-key"), miss);
      assert.ok(!miss.includes('"outcome":"attributed"'), miss);
      // projectRoot is "unknown" in the record, so the live cwd selects the checkout.
      const wt = checkout("r11-gemini-wt", "fix/0771-gemini-subagent-probe", GITHUB);
      const hit = resolveRec(dir, 1, wt);
      assert.match(hit, /"channel":"worktree"/);
      assert.match(hit, /"taskHandoffKey":"771"/);
    });

    test("R11 antigravity emits no separate subagent record (session-cumulative)", () => {
      const dir = derived(
        "antigravity",
        [path.join(fx("antigravity/statusline-payload"), "payload.json")],
        "ag",
      );
      assert.ok(fs.existsSync(path.join(dir, "rec-0.json")));
      assert.ok(!fs.existsSync(path.join(dir, "rec-1.json")));
      assert.equal(identity(dir, 0).agentId ?? null, null);
    });
  });
});
