// model-ci-tooling-sweep-en-us.test.ts — scripts/sweep-en-us.ts against its
// shell+Python original (spec 0262 requirements 1-4, 15). Fixtures are built at
// runtime in two identical scratch git repos; each implementation runs in its
// own repo and stdout, stderr, status and every resulting file are compared.
// The shell+Python side is skipped when python3 is absent or on win32.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { applyMap, buildDetector, buildSubstitutions } from "../lib/en-us-sweep/rules.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const HAVE_PY = process.platform !== "win32" && spawnSync("python3", ["--version"]).status === 0;
if (!HAVE_PY && process.platform !== "win32" && process.env.CI) {
  // A missing oracle must not read as green on a Linux runner (review/1339-F6).
  throw new Error("python3 is required for the shell+Python oracle leg on CI");
}
const skip = HAVE_PY ? false : "python3 absent or win32";
const ENV = { ...process.env, LC_ALL: "C", NO_COLOR: "1" };

interface Out {
  stdout: string;
  stderr: string;
  status: number | null;
}

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = ENV): Out {
  const r = spawnSync(cmd, args, { cwd, env, encoding: "utf8" });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}
const sh = (cwd: string, args: string[], env?: NodeJS.ProcessEnv): Out =>
  run("bash", ["scripts/sweep-en-us.sh", ...args], cwd, env);
const ts = (cwd: string, args: string[], env?: NodeJS.ProcessEnv): Out =>
  run(
    "node",
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/sweep-en-us.ts", ...args],
    cwd,
    env,
  );

/** Fixtures covering every masking rule; `
` is written as an escape. */
const FIXTURES: Record<string, string> = {
  "docs/prose.md": [
    "---",
    "name: organise",
    'description: "Organise the colour palette"',
    "type: organisation",
    "---",
    "Organise, Organisation and ORGANISATION; organisation-specific, organisation_id, éorganise, organiseß, ßorganise.",
    "İorganise ſorganise 😀organise organise😀 and `organise` and ``organise `x` organise`` here organise.",
    '[organise](http://organise.example/organise) <http://organise.example/organise> <a href="organise">organise</a>',
    "See https://organise.example/organise and ![organise](organise.png) then organise.",
    '[ref]: http://organise.example/organise "organise title"',
    "[ref2]: http://organise.example/organise",
    "```sh",
    "organise this",
    "```",
    "~~~",
    "organise too",
    "~~~",
    "````",
    "organise in four",
    "```",
    "organise still fenced",
    "````",
    "after organise",
    "line organise after separator",
    "",
  ].join("\n"),
  "docs/fm-block.md":
    "---\nname: x\ndescription: >-\n  Organise the\n  behaviour\n\n  more organise\nlicense: organise\n---\nOrganise.\n",
  "docs/fm-multi.md":
    "---\ndescription: 'Organise one\n  organise two'\nother: organise\n---\norganise\n",
  "docs/crlf.md": "Organise one\r\n`organise`\r\norganise two\r\n",
  "docs/bom.md": "﻿Organise bom\n",
  "docs/noeol.md": "organise at end",
  "docs/fixtures/skip.md": "organise\n",
  "communication/c.md": "organise\n",
  ".claude/y.md": "organise\n",
  LICENSE: "organise\n",
  "README.md": "# Organise\n\nOrganise the repo.\n",
  "scripts/x.sh": [
    "#!/usr/bin/env bash",
    "# organise comment",
    'echo "organise this" # organise tail',
    'echo "organise $x"',
    '[[ "$a" == "organise" ]] && echo "organise cmp"',
    'report_line="organise"',
    "y=${x#organise} # organise",
    "printf 'organise single' # organise",
    'x="a # organise" ; z=1 # organise',
    'if true; then echo "organise then"; fi',
    'note_pass "organise note"',
    'grep -q "organise" f',
    "ref#organise",
    'case $a in organise) echo "organise";; esac',
    "",
  ].join("\n"),
  "tests/e2e/lib/assert.sh":
    '# Usage: assert <artefact> organise\n# artefact docs and organise\necho "organise"\n',
  "artifacts/foo/scripts/t.py": [
    '"""Organise docstring."""',
    "# organise comment",
    "x = 'organise'",
    'y = "# organise"',
    "z = '''organise",
    "  more organise'''",
    'w = "esc\\" organise" # organise',
    "",
  ].join("\n"),
  ".github/workflows/copilot.yml": "# organise\nkey: organise # organise\n",
  "config/x.template": "# organise\nvalue = organise\n",
  "docs/other.txt": "organise\n",
};
const LIBS = ["en-gb-us-map.txt", "en-gb-detect.txt", "en_us_sweep.py"];

let work: string;
let seq = 0;

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync("git", args, { cwd, env: ENV, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}

/** A scratch repo with the fixtures and both implementations copied in. */
function makeRepo(extra: Record<string, string> = {}): string {
  const dir = path.join(work, `r${(seq += 1)}`);
  fs.mkdirSync(path.join(dir, "scripts", "lib"), { recursive: true });
  fs.copyFileSync(
    path.join(REPO, "scripts", "sweep-en-us.sh"),
    path.join(dir, "scripts", "sweep-en-us.sh"),
  );
  fs.copyFileSync(
    path.join(REPO, "scripts", "sweep-en-us.ts"),
    path.join(dir, "scripts", "sweep-en-us.ts"),
  );
  fs.cpSync(
    path.join(REPO, "scripts", "lib", "en-us-sweep"),
    path.join(dir, "scripts", "lib", "en-us-sweep"),
    { recursive: true },
  );
  for (const f of LIBS)
    fs.copyFileSync(path.join(REPO, "scripts", "lib", f), path.join(dir, "scripts", "lib", f));
  for (const [rel, body] of Object.entries({ ...FIXTURES, ...extra })) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body, "utf8");
  }
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "fixtures");
  return dir;
}

function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (
        e.name === ".git" ||
        e.name === "en-us-sweep" ||
        e.name.startsWith("sweep-en-us") ||
        e.name === "en_us_sweep.py" ||
        e.name === "__pycache__"
      )
        continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = fs.readFileSync(p).toString("latin1");
    }
  };
  walk(dir);
  return out;
}

/** Strip the one legitimate difference: the script name echoed by `usage:`. */
const norm = (o: Out): Out => ({
  ...o,
  stderr: o.stderr.replace(/usage: \S+sweep-en-us\.(sh|ts)/, "usage: <script>"),
});

before(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "sweep-en-us-"));
});
after(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

describe("sweep-en-us.ts matches sweep-en-us.sh on a scratch repo", { skip }, () => {
  for (const mode of ["--list", "--check", "--scope-test", "--aspell", "--bogus"]) {
    test(`${mode} output and status`, () => {
      const a = makeRepo();
      const b = makeRepo();
      assert.deepEqual(norm(ts(a, [mode])), norm(sh(b, [mode])));
    });
  }

  test("--list keeps the in-scope set only", () => {
    const r = ts(makeRepo(), ["--list"]).stdout.split("\n");
    assert.ok(
      r.includes("docs/prose.md") &&
        r.includes("scripts/x.sh") &&
        r.includes(".github/workflows/copilot.yml"),
    );
    assert.ok(
      !r.includes("LICENSE") &&
        !r.includes("docs/fixtures/skip.md") &&
        !r.includes("docs/other.txt"),
    );
  });

  test("--apply rewrites byte-identical files, then --check passes and a rerun is a no-op", () => {
    const a = makeRepo();
    const b = makeRepo();
    for (const args of [["--apply"], ["--check"], ["--apply"]]) {
      const x = ts(a, args);
      const y = sh(b, args);
      assert.deepEqual(x, y);
      assert.deepEqual(tree(a), tree(b));
    }
    assert.match(ts(a, ["--check"]).stdout, /\[R6\] PASS/);
    assert.match(
      fs.readFileSync(path.join(a, "docs/prose.md"), "utf8"),
      /Organize, Organization and ORGANIZATION/,
    );
    assert.equal(fs.readFileSync(path.join(a, "docs/fixtures/skip.md"), "utf8"), "organise\n");
  });

  test("the exclusion guard fails with the same stderr when an excluded tree is modified", () => {
    const a = makeRepo();
    const b = makeRepo();
    for (const d of [a, b]) fs.writeFileSync(path.join(d, "LICENSE"), "changed\n");
    const x = ts(a, ["--check"]);
    assert.equal(x.status, 1);
    assert.match(x.stderr, /\[exclusion-guard\] FAIL/);
    assert.deepEqual(x, sh(b, ["--check"]));
  });

  test("a malformed map line gives the same message and status", () => {
    const a = makeRepo();
    const b = makeRepo();
    for (const d of [a, b])
      fs.appendFileSync(path.join(d, "scripts/lib/en-gb-us-map.txt"), "oneword\n");
    for (const mode of ["--apply", "--check"]) assert.deepEqual(ts(a, [mode]), sh(b, [mode]));
    assert.equal(ts(a, ["--apply"]).stderr, "malformed map line: 'oneword\\n'\n");
  });

  test("a map key missing from the detect list fails the superset assertion identically", () => {
    const a = makeRepo();
    const b = makeRepo();
    for (const d of [a, b])
      fs.appendFileSync(path.join(d, "scripts/lib/en-gb-us-map.txt"), "zzbrit zzamer\n");
    for (const mode of ["--check", "--scope-test"]) assert.deepEqual(ts(a, [mode]), sh(b, [mode]));
    assert.equal(ts(a, ["--scope-test"]).status, 1);
  });

  test("the real repository gives the same --check and --list", () => {
    for (const mode of ["--check", "--list"])
      assert.deepEqual(norm(ts(REPO, [mode])), norm(sh(REPO, [mode])));
  });
});

describe("sweep-en-us.ts runs without python", () => {
  test("the PYTHON override is ignored: a bogus interpreter does not matter", () => {
    const dir = makeRepo();
    const r = ts(dir, ["--check"], {
      ...ENV,
      PYTHON: "/nonexistent/python",
      PATH: path.dirname(process.execPath) + path.delimiter + "/usr/bin",
    });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /\[superset\] PASS/);
  });

  test("Unicode word boundaries follow Python \\w", () => {
    const subs = buildSubstitutions([["organise", "organize"]]);
    const text =
      "organise éorganise organiseé ßorganise İorganise 😀organise organise_x organise-x x-organise\n";
    assert.equal(
      applyMap("a.md", text, subs).text,
      "organize éorganise organiseé ßorganise İorganise 😀organize organise_x organize-x x-organize\n",
    );
  });

  test("the detector folds case like re.IGNORECASE", () => {
    const rx = buildDetector(["organise", "kiss"]);
    assert.deepEqual(
      [..."ORGANISE Organise orGANISE KISS"].length > 0 && "ORGANISE KISS".match(rx),
      ["ORGANISE", "KISS"],
    );
    assert.equal("İorganise".match(rx), null);
  });
});
