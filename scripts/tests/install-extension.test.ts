// install-extension.test.ts — black-box contract of scripts/install-extension.sh (spec 0255 R9, R13,
// R26; ticket #1334): render to the build directory, then copy or link it to the flat destination
// $HOME/.gemini/extensions/<name>. Each test runs once per leg of IMPL whose entry file exists
// (today the shell; the TypeScript leg joins automatically). Every leg gets a fresh sandbox.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import type { RunResult } from "./lib/build-fixture-tree.ts";
import { createInstallSandbox, IMPL, listTree, runEntry } from "./lib/install-sandbox.ts";
import type { InstallSandbox, Leg } from "./lib/install-sandbox.ts";

const NAME = "install-extension";
const legs = IMPL.filter((l) =>
  fs.existsSync(path.join(REPO, `scripts/${NAME}.${l === "shell" ? "sh" : "ts"}`)),
);
const RENDER_BANNER = "Extension render — BUILD (--target gemini)\n";

type Run = (args: readonly string[], env?: Record<string, string>) => RunResult;

/** Run `body` once per available leg, each time with a fresh sandbox. */
function perLeg(title: string, body: (sb: InstallSandbox, run: Run, leg: Leg) => void): void {
  for (const leg of legs) {
    it(`${title} [${leg}]`, () => {
      const sb = createInstallSandbox();
      body(sb, (args, env) => runEntry(sb, NAME, args, { leg, ...(env ? { env } : {}) }), leg);
    });
  }
}

/** A renderable extension (the manifest `name` must equal the directory name); `valid: false` breaks the JSON. */
function ext(sb: InstallSandbox, tier: string, name: string, valid = true): void {
  const manifest = {
    name,
    version: "0.0.1",
    description: "fixture",
    commands: { location: "commands/" },
  };
  sb.tree.write(
    `extensions/${tier}/${name}/extension.json`,
    valid ? JSON.stringify(manifest) : "{not json",
  );
  sb.tree.write(
    `extensions/${tier}/${name}/commands/x.md`,
    "---\nname: x\ndescription: d\ntype: command\n---\nbody\n",
  );
}

const dest = (sb: InstallSandbox, name: string): string =>
  path.join(sb.home, ".gemini", "extensions", name);
const copied = (name: string): string => `  Copied: ${name} (build directory)\n`;
const linked = (name: string): string => `  Linked: ${name} (build directory)\n`;

describe("install-extension: one named extension", () => {
  perLeg("install renders to the build directory, then copies it flat", (sb, run) => {
    ext(sb, "core", "alpha");
    const res = run(["install", "alpha"]);
    assert.equal(res.status, 0);
    assert.equal(res.stdout, copied("alpha"));
    assert.ok(sb.tree.exists("build/extensions/alpha/gemini-extension.json"));
    const target = dest(sb, "alpha");
    assert.equal(fs.lstatSync(target).isSymbolicLink(), false);
    assert.deepEqual(listTree(target), listTree(sb.tree.resolve("build/extensions/alpha")));
    assert.ok(fs.existsSync(path.join(target, "gemini-extension.json")));
  });

  perLeg("the default mode is install", (sb, run) => {
    ext(sb, "library", "alpha");
    const res = run([]);
    assert.equal(res.stdout, copied("alpha"));
  });

  perLeg("link renders, then links the destination to the build directory", (sb, run) => {
    ext(sb, "core", "alpha");
    const res = run(["link", "alpha"]);
    assert.equal(res.status, 0);
    assert.equal(res.stdout, linked("alpha"));
    assert.equal(fs.readlinkSync(dest(sb, "alpha")), sb.tree.resolve("build/extensions/alpha"));
    assert.ok(fs.existsSync(path.join(dest(sb, "alpha"), "gemini-extension.json")));
  });

  perLeg("the tier is never part of the installed name (core, library and org)", (sb, run) => {
    for (const tier of ["core", "library", "org"]) ext(sb, tier, `from-${tier}`);
    for (const tier of ["core", "library", "org"])
      assert.equal(run(["install", `from-${tier}`]).status, 0);
    assert.deepEqual(fs.readdirSync(path.join(sb.home, ".gemini", "extensions")).sort(), [
      "from-core",
      "from-library",
      "from-org",
    ]);
  });

  perLeg("the render output goes to stderr, never stdout", (sb, run) => {
    ext(sb, "core", "alpha");
    const res = run(["install", "alpha"]);
    assert.ok(res.stderr.startsWith(RENDER_BANNER));
    assert.match(res.stderr, /Rendered: build\/extensions\/alpha\/gemini-extension\.json/);
    assert.doesNotMatch(res.stdout, /Rendered|Building|Done/);
  });

  for (const kind of ["directory", "file", "symlink", "dangling symlink"]) {
    for (const mode of ["install", "link"]) {
      perLeg(`${mode} replaces an existing ${kind} at the destination`, (sb, run) => {
        ext(sb, "core", "alpha");
        const target = dest(sb, "alpha");
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (kind === "directory") {
          fs.mkdirSync(target);
          fs.writeFileSync(path.join(target, "stale.txt"), "old");
        } else if (kind === "file") fs.writeFileSync(target, "old");
        else if (kind === "symlink") fs.symlinkSync(sb.tree.resolve("scripts"), target);
        else fs.symlinkSync(path.join(sb.home, "gone"), target);
        const res = run([mode, "alpha"]);
        assert.equal(res.status, 0);
        assert.equal(res.stdout, mode === "link" ? linked("alpha") : copied("alpha"));
        assert.equal(fs.lstatSync(target).isSymbolicLink(), mode === "link");
        assert.ok(fs.existsSync(path.join(target, "gemini-extension.json")));
        assert.equal(fs.existsSync(path.join(target, "stale.txt")), false);
        assert.equal(
          fs.existsSync(path.join(sb.tree.resolve("scripts"), "gemini-extension.json")),
          false,
        );
      });
    }
  }
});

describe("install-extension: failures of one named extension", () => {
  perLeg("a name found in no tier is an error with status 1 and installs nothing", (sb, run) => {
    ext(sb, "core", "alpha");
    const res = run(["install", "nope"]);
    assert.equal(res.status, 1);
    assert.equal(res.stdout, "");
    assert.equal(res.stderr, "Error: extension 'nope' not found.\n");
    assert.equal(sb.tree.exists("build"), false);
    assert.deepEqual(listTree(path.join(sb.home, ".gemini", "extensions")), []);
  });

  perLeg(
    "a name in two tiers reports the multi-tier error (then not found), status 1",
    (sb, run) => {
      ext(sb, "core", "dup");
      ext(sb, "library", "dup");
      const res = run(["install", "dup"]);
      assert.equal(res.status, 1);
      assert.equal(res.stdout, "");
      assert.equal(
        res.stderr,
        "Error: extension 'dup' exists in multiple tiers; names must be unique.\nError: extension 'dup' not found.\n",
      );
      assert.deepEqual(listTree(path.join(sb.home, ".gemini", "extensions")), []);
    },
  );

  perLeg(
    "a render failure ends with the rendering error and status 1, leaving the destination alone",
    (sb, run) => {
      ext(sb, "core", "bad", false);
      const target = dest(sb, "bad");
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "keep.txt"), "kept");
      const res = run(["install", "bad"]);
      assert.equal(res.status, 1);
      assert.equal(res.stdout, "");
      assert.ok(res.stderr.startsWith(RENDER_BANNER));
      assert.ok(res.stderr.endsWith("Error: rendering extension 'bad' failed.\n"));
      assert.ok(fs.existsSync(path.join(target, "keep.txt")));
    },
  );
});

describe("install-extension: every extension (no name)", () => {
  perLeg("walks core then library, each tier in name order; org is left out", (sb, run) => {
    ext(sb, "core", "zeta");
    ext(sb, "core", "beta");
    ext(sb, "library", "alpha");
    ext(sb, "org", "orgy");
    const res = run(["install"]);
    assert.equal(res.status, 0);
    assert.equal(res.stdout, copied("beta") + copied("zeta") + copied("alpha"));
    assert.equal(fs.existsSync(dest(sb, "orgy")), false);
  });

  perLeg("--include-org adds the org tier last", (sb, run) => {
    ext(sb, "core", "beta");
    ext(sb, "library", "alpha");
    ext(sb, "org", "orgy");
    assert.equal(
      run(["install", "--include-org"]).stdout,
      copied("beta") + copied("alpha") + copied("orgy"),
    );
  });

  perLeg("--include-org as the first argument also works in link mode", (sb, run) => {
    ext(sb, "org", "orgy");
    const res = run(["link", "--include-org"]);
    assert.equal(res.stdout, linked("orgy"));
    assert.equal(fs.readlinkSync(dest(sb, "orgy")), sb.tree.resolve("build/extensions/orgy"));
  });

  perLeg("INCLUDE_ORG=1 adds the org tier", (sb, run) => {
    ext(sb, "core", "beta");
    ext(sb, "org", "orgy");
    assert.equal(run(["install"], { INCLUDE_ORG: "1" }).stdout, copied("beta") + copied("orgy"));
  });

  perLeg("an empty INCLUDE_ORG leaves the org tier out", (sb, run) => {
    ext(sb, "org", "orgy");
    const res = run(["install"], { INCLUDE_ORG: "" });
    assert.equal(res.stdout, "");
    assert.equal(fs.existsSync(dest(sb, "orgy")), false);
  });

  // R22(j), observed on the shell: a failing extension STOPS the all-extensions loop. The status is 1
  // (the failing do_install is the last command of its `&&` list, so `set -e` ends the script), the
  // extensions before it stay installed and the ones after it are never rendered nor installed.
  perLeg(
    "R22(j): a failing extension stops the loop with status 1; earlier ones stay, later ones are skipped",
    (sb, run) => {
      ext(sb, "core", "aaa");
      ext(sb, "core", "bad", false);
      ext(sb, "core", "ccc");
      ext(sb, "library", "zzz");
      const res = run(["install"]);
      assert.equal(res.status, 1);
      assert.equal(res.stdout, copied("aaa"));
      assert.ok(res.stderr.endsWith("Error: rendering extension 'bad' failed.\n"));
      assert.ok(fs.existsSync(path.join(dest(sb, "aaa"), "gemini-extension.json")));
      for (const later of ["bad", "ccc", "zzz"])
        assert.equal(fs.existsSync(dest(sb, later)), false, later);
      assert.equal(sb.tree.exists("build/extensions/ccc"), false);
    },
  );
});
