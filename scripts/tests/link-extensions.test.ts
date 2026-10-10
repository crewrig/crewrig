// link-extensions.test.ts — black-box contract of scripts/link-extensions.sh (spec 0255 R9, R13, R26;
// ticket #1334): link every extension (core, library, then org when opted in) by running
// install-extension in link mode. Each test runs once per leg of IMPL whose entry file exists.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import type { RunResult } from "./lib/build-fixture-tree.ts";
import { createInstallSandbox, IMPL, listTree, runEntry } from "./lib/install-sandbox.ts";
import type { InstallSandbox, Leg } from "./lib/install-sandbox.ts";

const NAME = "link-extensions";
const legs = IMPL.filter((l) =>
  fs.existsSync(path.join(REPO, `scripts/${NAME}.${l === "shell" ? "sh" : "ts"}`)),
);

type Run = (args: readonly string[], env?: Record<string, string>) => RunResult;

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
const linked = (name: string): string => `  Linked: ${name} (build directory)\n`;

describe("link-extensions", () => {
  perLeg(
    "links core then library, each tier in name order, in link mode; org is left out",
    (sb, run) => {
      ext(sb, "core", "zeta");
      ext(sb, "core", "beta");
      ext(sb, "library", "alpha");
      ext(sb, "org", "orgy");
      const res = run([]);
      assert.equal(res.status, 0);
      assert.equal(res.stdout, linked("beta") + linked("zeta") + linked("alpha"));
      for (const name of ["beta", "zeta", "alpha"]) {
        assert.equal(fs.readlinkSync(dest(sb, name)), sb.tree.resolve(`build/extensions/${name}`));
      }
      assert.equal(fs.existsSync(dest(sb, "orgy")), false);
      assert.deepEqual(
        listTree(path.join(sb.home, ".gemini", "extensions")).filter((e) => !e.includes(" -> ")),
        [],
      );
    },
  );

  perLeg("--include-org adds the org tier last", (sb, run) => {
    ext(sb, "core", "beta");
    ext(sb, "library", "alpha");
    ext(sb, "org", "orgy");
    const res = run(["--include-org"]);
    assert.equal(res.stdout, linked("beta") + linked("alpha") + linked("orgy"));
    assert.ok(fs.lstatSync(dest(sb, "orgy")).isSymbolicLink());
  });

  perLeg("INCLUDE_ORG=1 adds the org tier", (sb, run) => {
    ext(sb, "core", "beta");
    ext(sb, "org", "orgy");
    assert.equal(run([], { INCLUDE_ORG: "1" }).stdout, linked("beta") + linked("orgy"));
  });

  perLeg(
    "renders each extension to stderr and replaces an existing installed copy by a link",
    (sb, run) => {
      ext(sb, "core", "beta");
      fs.mkdirSync(dest(sb, "beta"), { recursive: true });
      fs.writeFileSync(path.join(dest(sb, "beta"), "stale.txt"), "old");
      const res = run([]);
      assert.ok(res.stderr.startsWith("Extension render — BUILD (--target gemini)\n"));
      assert.equal(res.stdout, linked("beta"));
      assert.ok(fs.lstatSync(dest(sb, "beta")).isSymbolicLink());
    },
  );

  perLeg(
    "stops at the first failing extension with status 1; earlier links stay, later ones are skipped",
    (sb, run) => {
      ext(sb, "core", "aaa");
      ext(sb, "core", "bad", false);
      ext(sb, "core", "ccc");
      ext(sb, "library", "zzz");
      const res = run([]);
      assert.equal(res.status, 1);
      assert.equal(res.stdout, linked("aaa"));
      assert.ok(res.stderr.endsWith("Error: rendering extension 'bad' failed.\n"));
      assert.ok(fs.lstatSync(dest(sb, "aaa")).isSymbolicLink());
      for (const later of ["bad", "ccc", "zzz"])
        assert.equal(fs.existsSync(dest(sb, later)), false, later);
    },
  );

  perLeg("with no extension at all it links nothing", (sb, run) => {
    const res = run([]);
    assert.equal(res.stdout, "");
    assert.deepEqual(listTree(path.join(sb.home, ".gemini")), []);
  });
});
