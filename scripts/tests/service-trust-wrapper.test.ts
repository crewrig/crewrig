// service-trust-wrapper.test.ts — the installed trust wrapper (spec 0252
// requirement 12; plan v3 step 10a). Linux and macOS: it runs the rewritten
// installed copy from a temporary HOME with the repository out of the picture.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { renderPrograms } from "./lib/supervisor-stand-in.ts";

const skip = process.platform === "win32" ? "POSIX only" : false;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "trust-wrapper-"));
const home = path.join(root, "home");
fs.mkdirSync(path.join(home, ".crewrig"), { recursive: true });
const installed = renderPrograms(path.join(home, ".crewrig"), {
  repoDir: path.join(root, "repo"),
  host: "127.0.0.1",
  port: "1",
  chromaHost: "127.0.0.1",
  chromaPort: "1",
  python: process.execPath,
});
const tlsFile = path.join(home, ".crewrig", "tls-env.sh");

function run(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [installed.trustWrapper, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: home, ...env },
  });
}
const node = (code: string): string[] => [process.execPath, "-e", code];

test("unflagged: exits with the child's status, 0 and non-zero, silently", { skip }, () => {
  const ok = run(node("process.exit(0)"));
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout + ok.stderr, "");
  assert.equal(run(node("process.exit(5)")).status, 5);
});

test("flagged: ends non-zero on a clean child exit, keeps a non-zero status", { skip }, () => {
  const flag = "--end-nonzero-on-child-exit";
  const clean = run([flag, ...node("process.exit(0)")]);
  assert.equal(clean.status, 1);
  assert.match(clean.stdout, /supervisor restarts it/);
  assert.equal(run([flag, ...node("process.exit(4)")]).status, 4);
});

test("the flag is parsed before the first non-flag argument only", { skip }, () => {
  const r = run(
    node("console.log(process.argv.slice(1).join(','));process.exit(0)").concat(
      "--",
      "--end-nonzero-on-child-exit",
    ),
  );
  assert.equal(r.status, 0, "a flag after the command belongs to the command");
  assert.equal(r.stdout.trim(), "--end-nonzero-on-child-exit");
});

test("absent file is silent; a managed file applies its variables", { skip }, () => {
  const print = node("console.log(process.env.SSL_CERT_FILE ?? 'unset')");
  const absent = run(print);
  assert.equal(absent.stdout.trim(), "unset");
  assert.equal(absent.stderr, "");
  fs.writeFileSync(tlsFile, "# managed\nexport SSL_CERT_FILE=/etc/ssl/ca.pem\n");
  const present = run(print);
  assert.equal(present.stdout.trim(), "/etc/ssl/ca.pem");
  assert.equal(present.stderr, "");
});

test("malformed file: one warning naming file and line, the command still runs", { skip }, () => {
  fs.writeFileSync(tlsFile, "export OK=1\n$(touch /tmp/pwned)\n");
  const r = run(node("console.log(process.env.OK ?? 'unset');process.exit(0)"));
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "unset", "no variable of a malformed file is applied");
  assert.equal(r.stderr.trim().split("\n").length, 1);
  assert.ok(r.stderr.includes(tlsFile) && r.stderr.includes("line 2"));
  fs.rmSync(tlsFile);
});

test("a missing command ends 127", { skip }, () => {
  assert.equal(run(["/definitely/not/a/command"]).status, 127);
});
