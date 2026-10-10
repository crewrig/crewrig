// unlink-component.test.ts — black-box contract of scripts/unlink-component.sh (spec 0255 R26;
// ticket #1334): the shell leg today, the TypeScript leg once scripts/unlink-component.ts exists.
// Everything lives under the sandbox HOME's `.gemini/<type>/<name>`.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createInstallSandbox, IMPL, listTree, runEntry } from "./lib/install-sandbox.ts";
import type { Leg } from "./lib/install-sandbox.ts";

const sandbox = createInstallSandbox({ deps: "none" });
const gemini = path.join(sandbox.home, ".gemini");

const legs = (): Leg[] =>
  IMPL.filter((l) =>
    sandbox.tree.exists(`scripts/unlink-component.${l === "shell" ? "sh" : "ts"}`),
  );

/** A fresh `.gemini` with the given entries, each a `type/name` placed by `make`. */
function fresh(make: (dir: string) => void = () => {}): void {
  fs.rmSync(gemini, { recursive: true, force: true });
  fs.mkdirSync(gemini, { recursive: true });
  make(gemini);
}

const ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["command", "commands"],
  ["skill", "skills"],
  ["hook", "hooks"],
  ["agent", "agents"],
  ["policy", "policies"],
  ["mcp-server", "mcp-servers"],
  ["theme", "themes"],
];

describe("unlink-component", () => {
  it("has at least the shell leg", () => {
    assert.ok(legs().includes("shell"));
  });

  for (const [singular, plural] of ALIASES) {
    it(`maps the alias ${singular} to ${plural} and accepts ${plural} as is`, () => {
      for (const leg of legs()) {
        for (const given of [singular, plural]) {
          fresh((g) => {
            fs.mkdirSync(path.join(g, plural), { recursive: true });
            fs.writeFileSync(path.join(g, plural, "demo"), "x");
          });
          const res = runEntry(sandbox, "unlink-component", [given, "demo"], { leg });
          assert.equal(res.status, 0, `${leg} ${given}`);
          assert.equal(res.stdout, `Removed: ${plural}/demo\n`, `${leg} ${given}`);
          assert.equal(res.stderr, "", `${leg} ${given}`);
          assert.deepEqual(listTree(gemini), [`${plural}/`], `${leg} ${given}`);
          const again = runEntry(sandbox, "unlink-component", [given, "demo"], { leg });
          assert.equal(again.status, 0, `${leg} ${given}`);
          assert.equal(again.stdout, `Not found: ${plural}/demo\n`, `${leg} ${given}`);
        }
      }
    });
  }

  it("prints Not found without creating anything when nothing exists", () => {
    for (const leg of legs()) {
      fresh();
      const res = runEntry(sandbox, "unlink-component", ["skill", "ghost"], { leg });
      assert.equal(res.status, 0, leg);
      assert.equal(res.stdout, "Not found: skills/ghost\n", leg);
      assert.equal(res.stderr, "", leg);
      assert.deepEqual(listTree(gemini), [], leg);
    }
  });

  it("keeps an unknown type verbatim", () => {
    for (const leg of legs()) {
      fresh((g) => {
        fs.mkdirSync(path.join(g, "widgets"), { recursive: true });
        fs.writeFileSync(path.join(g, "widgets", "w"), "x");
      });
      const res = runEntry(sandbox, "unlink-component", ["widgets", "w"], { leg });
      assert.equal(res.stdout, "Removed: widgets/w\n", leg);
    }
  });

  it("removes a dangling symlink", () => {
    for (const leg of legs()) {
      fresh((g) => {
        fs.mkdirSync(path.join(g, "skills"), { recursive: true });
        fs.symlinkSync(path.join(sandbox.home, "nowhere"), path.join(g, "skills", "dangling"));
      });
      const res = runEntry(sandbox, "unlink-component", ["skill", "dangling"], { leg });
      assert.equal(res.status, 0, leg);
      assert.equal(res.stdout, "Removed: skills/dangling\n", leg);
      assert.deepEqual(listTree(gemini), ["skills/"], leg);
    }
  });

  it("removes a directory copy with its content", () => {
    for (const leg of legs()) {
      fresh((g) => {
        fs.mkdirSync(path.join(g, "agents", "copy", "deep"), { recursive: true });
        fs.writeFileSync(path.join(g, "agents", "copy", "deep", "f.md"), "x");
      });
      const res = runEntry(sandbox, "unlink-component", ["agent", "copy"], { leg });
      assert.equal(res.stdout, "Removed: agents/copy\n", leg);
      assert.deepEqual(listTree(gemini), ["agents/"], leg);
    }
  });

  it("removes a real symlink without touching its target", () => {
    for (const leg of legs()) {
      const target = path.join(sandbox.home, "source-of-truth");
      fs.rmSync(target, { recursive: true, force: true });
      fs.mkdirSync(target);
      fs.writeFileSync(path.join(target, "keep.md"), "keep");
      fresh((g) => {
        fs.mkdirSync(path.join(g, "themes"), { recursive: true });
        fs.symlinkSync(target, path.join(g, "themes", "linked"));
      });
      const res = runEntry(sandbox, "unlink-component", ["theme", "linked"], { leg });
      assert.equal(res.stdout, "Removed: themes/linked\n", leg);
      assert.deepEqual(listTree(gemini), ["themes/"], leg);
      assert.equal(fs.readFileSync(path.join(target, "keep.md"), "utf8"), "keep", leg);
    }
  });

  it("prints the usage on stdout and exits 1 when an argument is missing", () => {
    for (const leg of legs()) {
      fresh();
      for (const args of [[], ["skill"], ["", "demo"], ["skill", ""]]) {
        const res = runEntry(sandbox, "unlink-component", args, { leg });
        assert.equal(res.status, 1, `${leg} ${JSON.stringify(args)}`);
        assert.match(res.stdout, /^Usage: /, leg);
        assert.ok(
          res.stdout.endsWith(
            " <type> <name>\nTypes: commands, skills, hooks, agents, policies, mcp-servers, themes\n",
          ),
          `${leg}: ${res.stdout}`,
        );
        assert.equal(res.stderr, "", leg);
      }
    }
  });
});
