// setup-lib-tls-entry-offer.test.ts — the `offer` subcommand of scripts/tls-delegation.ts (spec 0256
// requirement 33 as modified by delta-01): the TLS_DELEGATION bypass, the prompt on standard input,
// `--answer`, the `--result` side channel and the silence on standard error, in a throwaway HOME.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { ENTRY, POSIX, box, envFile, envOf, hostAnchors, run } from "./lib/tls-entry-run.ts";

describe("offer", { skip: !POSIX }, () => {
  test("TLS_DELEGATION=on writes the file, prints the shell's lines and reports wrote=1", () => {
    const b = box();
    const res = run(b, ["offer", "--result", b.result], {
      TLS_DELEGATION: "on",
      CREWRIG_TLS_CA: b.ca,
    });
    assert.equal(res.status, 0);
    assert.equal(res.stderr, "");
    const written = fs.readFileSync(envFile(b), "utf8");
    assert.match(
      written,
      new RegExp(`^export SSL_CERT_FILE=${b.ca.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"),
    );
    assert.match(written, /^export UV_SYSTEM_CERTS=true$/m);
    assert.equal(fs.readFileSync(b.result, "utf8"), "wrote=1\n");
    const out = res.stdout.split("\n");
    assert.equal(out[0], `  Custom CA trust configured -> ${envFile(b)}`);
    assert.equal(out[1], `  Delegated to CA bundle: ${b.ca}`);
    assert.ok(out.includes("  Exact configuration written:"));
    assert.ok(out.includes("    export UV_SYSTEM_CERTS=true"));
    assert.equal(fs.readdirSync(path.join(b.home, ".crewrig")).join(), "tls-env.sh");
  });

  test("works without --result, and with --result=<file>", () => {
    const b = box();
    const env = { TLS_DELEGATION: "on", CREWRIG_TLS_CA: b.ca };
    assert.equal(run(b, ["offer"], env).status, 0);
    fs.rmSync(envFile(b));
    assert.equal(run(b, ["offer", `--result=${b.result}`], env).status, 0);
    assert.equal(fs.readFileSync(b.result, "utf8"), "wrote=1\n");
  });

  test("TLS_DELEGATION=off prints nothing, writes nothing and reports wrote=0", () => {
    const b = box();
    const res = run(b, ["offer", "--result", b.result], {
      TLS_DELEGATION: "off",
      CREWRIG_TLS_CA: b.ca,
    });
    assert.deepEqual(res, { status: 0, stdout: "", stderr: "" });
    assert.equal(fs.existsSync(path.join(b.home, ".crewrig")), false);
    assert.equal(fs.readFileSync(b.result, "utf8"), "wrote=0\n");
  });

  test("an invalid TLS_DELEGATION is status 1 with the message on standard output", () => {
    const b = box();
    const res = run(b, ["offer", "--result", b.result], { TLS_DELEGATION: "maybe" });
    assert.deepEqual(res, {
      status: 1,
      stdout: "  ERROR: invalid TLS_DELEGATION 'maybe' (want: on|off)\n",
      stderr: "",
    });
    assert.equal(fs.existsSync(path.join(b.home, ".crewrig")), false);
    assert.equal(fs.readFileSync(b.result, "utf8"), "wrote=0\n");
  });

  test("no context detected: no question, nothing written, wrote=0", { skip: hostAnchors }, () => {
    const b = box();
    const res = run(b, ["offer", "--result", b.result]);
    assert.deepEqual(res, { status: 0, stdout: "", stderr: "" });
    assert.equal(fs.readFileSync(b.result, "utf8"), "wrote=0\n");
  });

  test("a detected context asks on standard input: yes writes, no declines", () => {
    const b = box();
    const yes = run(b, ["offer", "--result", b.result], { CREWRIG_TLS_CA: b.ca }, "yes\n");
    assert.equal(yes.status, 0);
    assert.equal(yes.stderr, "");
    assert.match(yes.stdout, /^\nCustom certificate trust \(spec 0084\):\n/);
    assert.match(yes.stdout, /\n {2}1\) no\n {2}2\) yes\n {2}Custom CA trust configured -> /);
    assert.equal(fs.readFileSync(b.result, "utf8"), "wrote=1\n");

    const c = box();
    const no = run(c, ["offer", "--result", c.result], { CREWRIG_TLS_CA: c.ca }, "no\n");
    assert.equal(no.status, 0);
    assert.match(no.stdout, /\n {2}TLS delegation skipped — nothing written\.\n$/);
    assert.equal(fs.existsSync(path.join(c.home, ".crewrig")), false);
    assert.equal(fs.readFileSync(c.result, "utf8"), "wrote=0\n");
  });

  test("--answer tls-delegation=<v> replaces the question, echoed", () => {
    const b = box();
    const res = run(b, ["offer", "--answer", "tls-delegation=YES", "--result", b.result], {
      CREWRIG_TLS_CA: b.ca,
    });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /\n\[answer\] tls-delegation=yes\n {2}Custom CA trust configured/);
    assert.equal(fs.readFileSync(b.result, "utf8"), "wrote=1\n");
    const c = box();
    const no = run(c, ["offer", "--answer=tls-delegation=no"], { CREWRIG_TLS_CA: c.ca });
    assert.match(no.stdout, /nothing written\.\n$/);
  });

  test("--forwarded drops the preamble and the [answer] echo, and needs --answer", () => {
    const b = box();
    const res = run(b, ["offer", "--forwarded", "--answer", "tls-delegation=yes"], {
      CREWRIG_TLS_CA: b.ca,
    });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^ {2}Custom CA trust configured -> /);
    assert.equal(res.stdout.includes("[answer]"), false);
    assert.equal(res.stdout.includes("Custom certificate trust (spec 0084):"), false);
    const c = box();
    const no = run(c, ["offer", "--answer=tls-delegation=no", "--forwarded"], {
      CREWRIG_TLS_CA: c.ca,
    });
    assert.equal(no.stdout, "  TLS delegation skipped — nothing written.\n");
    const bare = run(c, ["offer", "--forwarded"], { CREWRIG_TLS_CA: c.ca });
    assert.equal(bare.status, 2);
    assert.equal(bare.stderr, "Error: --forwarded needs --answer\n");
  });

  test("a question with no answer and no terminal is status 2 naming the question", () => {
    const b = box();
    const res = run(b, ["offer", "--result", b.result], { CREWRIG_TLS_CA: b.ca }, "");
    assert.equal(res.status, 2);
    assert.match(
      res.stderr,
      /^Error: no answer for 'tls-delegation' \(standard input is not a terminal\)/,
    );
    assert.equal(fs.existsSync(path.join(b.home, ".crewrig")), false);
    assert.equal(fs.readFileSync(b.result, "utf8"), "wrote=0\n");
  });

  test("an open standard input the run never reads does not keep it alive", async () => {
    const b = box();
    const child = spawn(process.execPath, [ENTRY, "offer"], {
      env: envOf(b, { TLS_DELEGATION: "off" }),
      cwd: b.root,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    const status = await new Promise((resolve) => child.on("close", (code) => resolve(code)));
    clearTimeout(timer);
    assert.equal(status, 0);
  });

  test("a result file that cannot be written is status 1 with one Error line", () => {
    const b = box();
    const bad = path.join(b.root, "no-such-dir", "result.txt");
    const res = run(b, ["offer", "--result", bad], { TLS_DELEGATION: "off" });
    assert.equal(res.status, 1);
    assert.equal(res.stdout, "");
    assert.match(res.stderr, /^Error: ENOENT[^\n]*\n$/);
  });
});
