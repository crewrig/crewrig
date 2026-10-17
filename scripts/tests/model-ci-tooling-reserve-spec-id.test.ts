// model-ci-tooling-reserve-spec-id.test.ts — differential tests of scripts/reserve-spec-id.ts
// against scripts/reserve-spec-id.sh (spec 0262 reqs 1-4, 22). Both run on two identically seeded
// scratch remotes (never the real one) and must agree on stdout, stderr, exit status and the
// resulting reservation refs. The shell leg is skipped on win32.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { git, makeSide, runTool } from "./lib/spec-id-twins.ts";
import type { SideOptions } from "./lib/spec-id-twins.ts";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "reserve-twins-"));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
let counter = 0;
const skipShell = process.platform === "win32";

type Step = { args: string[]; env?: Record<string, string> };

/** Run the steps on a fresh shell side and a fresh TS side; compare every step. */
function differential(
  opts: SideOptions,
  steps: Step[],
  prepare?: (bare: string, clone: string) => void,
) {
  counter += 1;
  const sh = makeSide(scratch, `sh-${counter}`, opts);
  const ts = makeSide(scratch, `ts-${counter}`, opts);
  if (prepare) {
    prepare(sh.bare, sh.clone);
    prepare(ts.bare, ts.clone);
  }
  const seen = [];
  for (const step of steps) {
    const a = runTool(sh, "sh", "reserve-spec-id", step.args, step.env ?? {});
    const b = runTool(ts, "ts", "reserve-spec-id", step.args, step.env ?? {});
    assert.deepEqual(b, a, `divergence on ${step.args.join(" ")}`);
    seen.push(b);
  }
  return seen;
}

const FILES = {
  "specs/0001-a.md": "x\n",
  "specs/0003-b.md": "x\n",
  "specs/org/0099-o.md": "x\n",
  "specs/0002-b.delta-01.md": "x\n",
};
const RES: Record<string, string> = {
  "refs/spec-ids/0010": "reserve 0010 for issue #10",
  "refs/tags/spec-id/0012": "reserve 0012 for issue #12",
  "refs/spec-ids-org/0099": "reserve 0099 for issue #99",
};

describe("reserve-spec-id twin", { skip: skipShell }, () => {
  it("allocates the next id over the union of merged specs and both carriers", () => {
    const [r] = differential({ files: FILES, reservations: RES }, [{ args: ["--issue", "5"] }]);
    assert.equal(r?.status, 0);
    assert.equal(r?.stdout, "0013\n");
    assert.match(r?.refs ?? "", /refs\/spec-ids\/0013/);
  });

  it("secures one id, treats a repeat as idempotent and refuses another ticket", () => {
    const r = differential({ files: FILES }, [
      { args: ["--id", "0042", "--issue", "7"] },
      { args: ["--id", "0042", "--issue", "7"] },
      { args: ["--id", "0042", "--issue", "8"] },
    ]);
    assert.deepEqual(
      r.map((x) => x.status),
      [0, 0, 1],
    );
  });

  it("reuses the id already reserved for the issue, in either carrier", () => {
    const r = differential({ files: FILES, reservations: RES }, [
      { args: ["--issue", "12"] },
      { args: ["--issue", "10"] },
    ]);
    assert.deepEqual(
      r.map((x) => x.stdout),
      ["0012\n", "0010\n"],
    );
  });

  it("handles the org corpus, the tags carrier and the carrier file states", () => {
    differential({ files: FILES }, [
      { args: ["--id", "ORG-0001", "--corpus", "org", "--issue", "3"] },
      { args: ["--corpus", "org", "--issue", "3"] },
      { args: ["--issue", "4"], env: { CREWRIG_SPEC_ID_CARRIER: "refs/tags/spec-id/" } },
      {
        args: ["--id", "X-1", "--corpus", "org", "--issue", "3"],
        env: { CREWRIG_SPEC_ID_CARRIER: "refs/tags/spec-id/" },
      },
      { args: ["--issue", "4"], env: { CREWRIG_SPEC_ID_CARRIER: "refs/spec-id/" } },
    ]);
    for (const [content, label] of [
      ["carrier=refs/tags/spec-id/\r\n", "tags"],
      ["# nothing\n", "no key"],
      ["carrier=   \n", "empty"],
      ["carrier=refs/bogus/\n", "bogus"],
    ] as const) {
      const r = differential({ files: { ...FILES, ".crewrig/spec-id-carrier": content } }, [
        { args: ["--issue", "6"] },
      ]);
      assert.ok(r[0] !== undefined, label);
    }
  });

  it("goes offline, and reports an unreadable or missing remote as unsecured", () => {
    const r = differential({ files: FILES, reservations: RES }, [
      { args: ["--issue", "5", "--offline"] },
      { args: ["--id", "0077", "--issue", "5", "--offline"] },
      { args: ["--issue", "5"], env: { BASE_REF: "nosuch/main" } },
    ]);
    assert.deepEqual(
      r.map((x) => x.status),
      [3, 3, 3],
    );
    assert.equal(
      differential({ files: FILES, remote: "" }, [{ args: ["--issue", "5"] }])[0]?.status,
      3,
    );
  });

  it("rejects malformed invocations identically", () => {
    const bad: Step[] = [
      { args: [] },
      { args: ["--help"] },
      { args: ["--bogus"] },
      { args: ["--issue"] },
      { args: ["--issue", "x1"] },
      { args: ["--issue", "1", "--corpus", "zzz"] },
      { args: ["--issue", "1"], env: { CREWRIG_SPEC_ID_MAX_ATTEMPTS: "0" } },
      { args: ["--issue", "1"], env: { CREWRIG_SPEC_ID_MAX_ATTEMPTS: "a" } },
      { args: ["--id", "a b", "--issue", "1"] },
      { args: ["--id", "x.lock", "--issue", "1"] },
    ];
    const r = differential({ files: FILES }, bad);
    assert.equal(r[1]?.status, 0);
    assert.ok(r.slice(2).every((x) => x.status === 1));
  });

  it("advances after a lost create-only race and gives up when the budget is spent", () => {
    const hook = (bare: string, clone: string): void => {
      void clone;
      const tree = git(bare, ["hash-object", "-w", "-t", "tree", "/dev/null"]).trim();
      const oid = git(bare, ["commit-tree", tree, "-m", "reserve 0004 for issue #500"]).trim();
      const file = path.join(bare, "hooks", "pre-receive");
      const script = `#!/bin/sh\nif [ ! -f "$GIT_DIR/raced" ]; then : > "$GIT_DIR/raced"; mkdir -p "$GIT_DIR/refs/spec-ids"; echo ${oid} > "$GIT_DIR/refs/spec-ids/0004"; echo raced >&2; exit 1; fi\nexit 0\n`;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, script, { mode: 0o755 });
    };
    const [won] = differential({ files: FILES }, [{ args: ["--issue", "7"] }], hook);
    assert.equal(won?.stdout, "0005\n");
    const [spent] = differential(
      { files: FILES },
      [{ args: ["--issue", "7"], env: { CREWRIG_SPEC_ID_MAX_ATTEMPTS: "1" } }],
      hook,
    );
    assert.equal(spent?.status, 1);
  });

  it("reports a remote that refuses the write as unsecured", () => {
    const refuse = (bare: string): void => {
      const file = path.join(bare, "hooks", "pre-receive");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "#!/bin/sh\necho no-way >&2\nexit 1\n", { mode: 0o755 });
    };
    const [r] = differential(
      { files: FILES },
      [{ args: ["--issue", "7"] }, { args: ["--id", "0050", "--issue", "7"] }],
      refuse,
    );
    assert.equal(r?.status, 3);
  });
});
