// unlink-extensions.test.ts — black-box contract of scripts/unlink-extensions.sh (spec 0255 R26;
// ticket #1334): the shell leg today, the TypeScript leg once scripts/unlink-extensions.ts exists.
// The sandbox tree holds `extensions/<tier>/<name>/` fixtures; the removal target is
// `$HOME/.gemini/extensions/<name>`, keyed on the bare name (the tier never appears in it).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createInstallSandbox, IMPL, listTree, runEntry } from "./lib/install-sandbox.ts";
import type { Leg } from "./lib/install-sandbox.ts";

const sandbox = createInstallSandbox({ deps: "none" });
const installed = path.join(sandbox.home, ".gemini", "extensions");

const legs = (): Leg[] =>
  IMPL.filter((l) =>
    sandbox.tree.exists(`scripts/unlink-extensions.${l === "shell" ? "sh" : "ts"}`),
  );

/** Declare the extension sources (`tier/name`) and what is installed (`name` -> placer). */
function setup(sources: string[], place: Record<string, (target: string) => void> = {}): void {
  sandbox.tree.remove("extensions");
  fs.rmSync(path.join(sandbox.home, ".gemini"), { recursive: true, force: true });
  for (const s of sources) sandbox.tree.write(`extensions/${s}/gemini-extension.json`, "{}");
  fs.mkdirSync(installed, { recursive: true });
  for (const [name, put] of Object.entries(place)) put(path.join(installed, name));
}

const copy = (target: string): void => {
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, "f"), "x");
};
const link =
  (to: string) =>
  (target: string): void =>
    fs.symlinkSync(to, target);

const run = (leg: Leg, args: string[] = [], env: Record<string, string> = {}) =>
  runEntry(sandbox, "unlink-extensions", args, { leg, env });

describe("unlink-extensions", () => {
  it("has at least the shell leg", () => {
    assert.ok(legs().includes("shell"));
  });

  it("removes core then library, in that tier order, each with a two-space indent", () => {
    for (const leg of legs()) {
      setup(["library/aaa", "core/zzz", "core/mmm", "library/bbb"], {
        aaa: copy,
        zzz: copy,
        mmm: copy,
        bbb: copy,
      });
      const res = run(leg);
      assert.equal(res.status, 0, leg);
      assert.equal(
        res.stdout,
        "  Removed: mmm\n  Removed: zzz\n  Removed: aaa\n  Removed: bbb\n",
        leg,
      );
      assert.equal(res.stderr, "", leg);
      assert.deepEqual(listTree(installed), [], leg);
    }
  });

  it("prints nothing for a name that is not installed", () => {
    for (const leg of legs()) {
      setup(["core/present", "core/absent", "library/also-absent"], { present: copy });
      const res = run(leg);
      assert.equal(res.status, 0, leg);
      assert.equal(res.stdout, "  Removed: present\n", leg);
      assert.equal(res.stderr, "", leg);
    }
  });

  it("prints nothing and exits 0 with no extension source at all", () => {
    for (const leg of legs()) {
      setup([]);
      const res = run(leg);
      assert.equal(res.status, 0, leg);
      assert.equal(res.stdout, "", leg);
      assert.equal(res.stderr, "", leg);
    }
  });

  it("removes a link without touching its target, a copy, and a dangling link", () => {
    for (const leg of legs()) {
      const source = sandbox.tree.resolve("extensions/core/linked");
      setup(["core/linked", "core/copied", "library/dangling", "library/stays"], {
        linked: link(source),
        copied: copy,
        dangling: link(path.join(sandbox.home, "nowhere")),
        stays: copy,
      });
      fs.rmSync(path.join(installed, "stays"), { recursive: true });
      const res = run(leg);
      assert.equal(res.stdout, "  Removed: copied\n  Removed: linked\n  Removed: dangling\n", leg);
      assert.deepEqual(listTree(installed), [], leg);
      assert.ok(sandbox.tree.exists("extensions/core/linked/gemini-extension.json"), leg);
    }
  });

  it("leaves the org tier and installed names without a source alone by default", () => {
    for (const leg of legs()) {
      setup(["core/up", "org/mine"], { up: copy, mine: copy, unrelated: copy });
      const res = run(leg);
      assert.equal(res.stdout, "  Removed: up\n", leg);
      assert.deepEqual(listTree(installed), ["mine/", "mine/f", "unrelated/", "unrelated/f"], leg);
    }
  });

  it("adds the org tier last with --include-org", () => {
    for (const leg of legs()) {
      setup(["org/mine", "library/lib", "core/up"], { up: copy, lib: copy, mine: copy });
      const res = run(leg, ["--include-org"]);
      assert.equal(res.status, 0, leg);
      assert.equal(res.stdout, "  Removed: up\n  Removed: lib\n  Removed: mine\n", leg);
      assert.deepEqual(listTree(installed), [], leg);
    }
  });

  it("treats any non-empty INCLUDE_ORG as --include-org, and an empty one as unset", () => {
    for (const leg of legs()) {
      for (const value of ["1", "0", "no"]) {
        setup(["core/up", "org/mine"], { up: copy, mine: copy });
        const res = run(leg, [], { INCLUDE_ORG: value });
        assert.equal(res.stdout, "  Removed: up\n  Removed: mine\n", `${leg} ${value}`);
      }
      setup(["core/up", "org/mine"], { up: copy, mine: copy });
      const res = run(leg, [], { INCLUDE_ORG: "" });
      assert.equal(res.stdout, "  Removed: up\n", `${leg} empty`);
    }
  });

  it("honours --include-org only as the first argument", () => {
    for (const leg of legs()) {
      setup(["core/up", "org/mine"], { up: copy, mine: copy });
      const res = run(leg, ["other", "--include-org"]);
      assert.equal(res.stdout, "  Removed: up\n", leg);
    }
  });

  it("keys the target on the bare name, so a name in two tiers is removed once", () => {
    for (const leg of legs()) {
      setup(["core/shared", "library/shared", "org/shared"], { shared: copy });
      const res = run(leg, ["--include-org"]);
      assert.equal(res.stdout, "  Removed: shared\n", leg);
      assert.deepEqual(listTree(installed), [], leg);
    }
  });

  it("ignores plain files under a tier directory", () => {
    for (const leg of legs()) {
      setup(["core/real"], { real: copy, note: copy });
      sandbox.tree.write("extensions/core/note", "not a directory");
      const res = run(leg);
      assert.equal(res.stdout, "  Removed: real\n", leg);
      assert.deepEqual(listTree(installed), ["note/", "note/f"], leg);
    }
  });
});
