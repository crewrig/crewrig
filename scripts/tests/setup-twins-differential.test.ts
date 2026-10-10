// setup-twins-differential.test.ts — spec 0256 requirement 10 (last clause): the TypeScript writer of the TLS
// trust file against the REAL shell writer, `offer_tls_delegation` of scripts/lib/tls-delegation.sh run with
// TLS_DELEGATION=on, over a matrix of bundle paths holding every printable ASCII character (alone, leading,
// trailing, between letters, and before a tilde). tls-env-writer.test.ts compares against a copy of the persist
// block over four paths; this runs the shipped function. Linux only; retired with the shell libraries.
// What the other twins already cover, and where, is listed in the header of setup-twins-differential-usage.test.ts.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { writeTlsEnv } from "../lib/tls-env.ts";
import { PRINTABLE } from "./lib/tls-quote-measure.ts";
import { REPO } from "./lib/worktree-fixtures.ts";

const LINUX = process.platform === "linux";
const HAS_BASH = spawnSync("bash", ["--version"]).status === 0;
const SKIP =
  !LINUX || !HAS_BASH ? "SKIP: Linux with bash only (retired with the shell libraries)" : false;
const LIB = path.join(REPO, "scripts", "lib", "tls-delegation.sh");

const roots: string[] = [];
after(() => roots.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

/** Bundle file names: every printable ASCII character but `/`, in the positions that change `printf %q`. */
function names(): string[] {
  const all = new Set<string>([
    "plain.pem",
    "a b.pem",
    "C:\\x\\y.pem",
    "a,b^c.pem",
    "x:~y",
    "x=~y",
  ]);
  for (const c of PRINTABLE) {
    if (c === "/") continue;
    for (const w of [c, `${c}a`, `a${c}a`, `a${c}`, `${c}~`, `a${c}~`]) if (w !== ".") all.add(w);
  }
  return [...all];
}

// One bash: for each bundle, a fresh subshell runs the shipped writer and keeps the file it wrote (mode kept).
const DRIVER = `
set +e
. "$LIB"
i=0
while IFS= read -r -d '' ca; do
  ( TLS_DELEGATION=on TLS_DELEGATION_CA="$ca" offer_tls_delegation >/dev/null 2>&1
    echo "$?" > "$OUT/$i.rc"
    cp -p "$HOME/.crewrig/tls-env.sh" "$OUT/$i.env" 2>/dev/null
    rm -f "$HOME/.crewrig/tls-env.sh" )
  i=$((i + 1))
done < "$LIST"
`;

describe("writeTlsEnv against offer_tls_delegation", { skip: SKIP }, () => {
  test("the file is the shell's, byte for byte and mode for mode, over the printable-ASCII bundle matrix", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "twins-tls-")));
    roots.push(root);
    const home = path.join(root, "home");
    const out = path.join(root, "out");
    const certs = path.join(root, "certs");
    for (const dir of [home, out, certs]) fs.mkdirSync(dir);
    const bundles = names().map((name) => path.join(certs, name));
    for (const bundle of bundles) fs.writeFileSync(bundle, "x\n");
    const list = path.join(root, "list");
    fs.writeFileSync(list, bundles.map((b) => `${b}\0`).join(""));
    // No TLS variable of the host may win over TLS_DELEGATION_CA.
    const env = { PATH: process.env["PATH"] ?? "", HOME: home, LIB, OUT: out, LIST: list };
    const shell = spawnSync("bash", ["-c", DRIVER], { encoding: "utf8", env });
    assert.equal(shell.status, 0, shell.stderr);

    const target = path.join(home, ".crewrig", "tls-env.sh");
    const mismatches: string[] = [];
    bundles.forEach((bundle, i) => {
      assert.equal(fs.readFileSync(path.join(out, `${i}.rc`), "utf8").trim(), "0", bundle);
      const viaShell = fs.readFileSync(path.join(out, `${i}.env`));
      const modeShell = fs.statSync(path.join(out, `${i}.env`)).mode & 0o777;
      const written = writeTlsEnv(home, bundle);
      assert.equal(written.path, target);
      const viaTs = fs.readFileSync(target);
      const modeTs = fs.statSync(target).mode & 0o777;
      fs.rmSync(target);
      if (!viaTs.equals(viaShell) || modeTs !== modeShell) mismatches.push(JSON.stringify(bundle));
    });
    assert.deepEqual(mismatches, []);
    assert.ok(bundles.length > 400, `matrix too small: ${bundles.length}`);
  });
});
