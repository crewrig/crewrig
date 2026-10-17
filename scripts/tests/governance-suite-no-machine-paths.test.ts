// governance-suite-no-machine-paths.test.ts — Replaces scripts/tests/test-check-no-machine-paths.sh
// (cases a-h). Every fixture is a throwaway git repository (the check reads tracked content) and
// CREWRIG_REPO_DIR is set in the child env only. A home-path literal in this file would trip the
// check on the repository itself, so every one is assembled at runtime from parts: the roots
// below, an owner (EVIL = "eviluser", ANA = "ana") and a tail. No literal appears, comments
// included.

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { commitAll, newRepo, runIn, writeRel } from "./lib/governance-git-fixture.ts";
import { REPO } from "./lib/governance-sandbox.ts";

const ENTRY = path.join(REPO, "scripts", "check-no-machine-paths.ts");
const EVIL = "eviluser";
const ANA = "ana";
const MAC = ["", "Users"].join("/");
const LIN = ["", "home"].join("/");
const own = (root: string, owner: string, tail = ""): string => `${root}/${owner}${tail}`;

interface Outcome {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function check(file: string, content: string): Outcome {
  const repo = newRepo("main", "governance-machine-paths-");
  writeRel(repo, file, `${content}\n`);
  commitAll(repo, "initial");
  return runIn(ENTRY, repo, { CREWRIG_REPO_DIR: repo });
}

const shown = (r: Outcome): string =>
  `status ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`;
const has = (r: Outcome, text: string): void => assert.ok(r.stderr.includes(text), shown(r));

describe("check-no-machine-paths (cases a-h)", () => {
  it("case-a: clean tree passes with the OK line", () => {
    const r = check("clean.txt", "a report using $HOME and <user> placeholders");
    assert.equal(r.status, 0, shown(r));
    assert.ok(r.stdout.includes("OK: no machine-specific home-directory paths"), shown(r));
  });

  it("case-b: a reintroduced home path fails and is named on stderr", () => {
    const r = check("leak.txt", `config loaded from ${own(MAC, EVIL, "/secret/config.json")}`);
    assert.equal(r.status, 1, shown(r));
    has(r, own(MAC, EVIL, "/"));
  });

  it("case-c: an angle-bracket placeholder is not flagged", () => {
    const r = check("placeholder.txt", `see ${MAC}/<user>/config and $HOME/config`);
    assert.equal(r.status, 0, shown(r));
  });

  it("case-d: the benign owner agent is not flagged", () => {
    const r = check("container.txt", `container home is ${own(LIN, "agent", "/workspace")} here`);
    assert.equal(r.status, 0, shown(r));
  });

  it("case-e: a leak beside a benign path on one line is still named", () => {
    const r = check(
      "mixed.txt",
      `mount ${own(LIN, "agent", "/data")} over ${own(MAC, EVIL, "/secret/x")}`,
    );
    assert.equal(r.status, 1, shown(r));
    has(r, own(MAC, EVIL, "/"));
  });

  it("case-f: a slash-less home root at end of line fails and is named", () => {
    const r = check("envfile.sh", `export HOME=${own(MAC, EVIL)}`);
    assert.equal(r.status, 1, shown(r));
    has(r, own(MAC, EVIL));
  });

  it("case-g: the owner ana is benign in drive-letter form only", () => {
    const win = check(
      "fixture.ts",
      `const win = "C:${own(MAC, ANA, "/crewrig")}";\nconst winBack = "c:${own(MAC, ANA)}";`,
    );
    assert.equal(win.status, 0, shown(win));

    const posix = check(
      "posix-ana.txt",
      [
        `config at ${own(MAC, ANA, "/secret")}`,
        `data at ${own(LIN, ANA, "/x")}`,
        `copy from host:${own(MAC, ANA, "/y")}`,
      ].join("\n"),
    );
    assert.equal(posix.status, 1, shown(posix));
    has(posix, `posix-ana.txt:1: ${own(MAC, ANA, "/")}`);
    has(posix, `posix-ana.txt:2: ${own(LIN, ANA, "/")}`);
    // The truncated `t:` prefix is the frozen behaviour for a host-prefixed form.
    has(posix, `posix-ana.txt:3: t:${own(MAC, ANA, "/")}`);
  });

  it("case-h: a leak beside a drive-letter ana path is named, the ana path is not", () => {
    const r = check(
      "mixed-ana.txt",
      `copy C:${own(MAC, ANA, "/crewrig")} to ${own(MAC, EVIL, "/secret/x")}`,
    );
    assert.equal(r.status, 1, shown(r));
    has(r, own(MAC, EVIL, "/"));
    assert.ok(
      !new RegExp(`^mixed-ana\\.txt:[0-9]+: .*${MAC}/${ANA}`, "m").test(r.stderr),
      shown(r),
    );
  });
});
