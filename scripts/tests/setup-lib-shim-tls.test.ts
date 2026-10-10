// setup-lib-shim-tls.test.ts — the forwarding function shim scripts/lib/tls-delegation.sh (spec 0256
// requirement 33): the Bash functions detect_custom_tls_context, offer_tls_delegation and _tls_candidate_ca
// keep their names, return codes and standard output while the work is done by scripts/tls-delegation.ts.
// POSIX-only (the shim is Bash). Each case sources the shim in a fresh `bash` under `set -u`, in a
// throwaway HOME with no TLS variable of the host. The unchanged oracle is scripts/tests/test-tls-delegation.sh.
//
// Pinned: sourcing prints nothing and defines the functions; the return codes; the standard output of
// `offer_tls_delegation` is the entry's byte for byte on the non-interactive path and the ORIGINAL's
// (a literal) on the interactive one, with no `[answer]` line; the variables travel back to the calling shell
// after `wrote=1` (the written file is sourced there) and not otherwise; a `fzf` answer (stub on PATH)
// is forwarded as the entry's `--answer`; shell variables that were set but not exported are seen; no
// side-channel file is left; `node` absent or below the floor returns non-zero without `exit`; standard
// input is not consumed.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import { pathWithFakeNode, pathWithoutNode } from "./lib/shim-env.ts";
import { ENTRY, POSIX, box, envFile, hostAnchors, type Box } from "./lib/tls-entry-run.ts";
import { makePathDir, which } from "./lib/worktree-fixtures.ts";

const BASH = which("bash");
const SKIP = !POSIX
  ? "SKIP: POSIX-only suite"
  : BASH === null
    ? "SKIP: bash is not installed"
    : false;
const LIB = path.join(REPO, "scripts", "lib", "tls-delegation.sh");

interface Out {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Source the shim under `set -u` in a fresh bash, then run `body`; `env` replaces the whole environment. */
function drive(b: Box, body: string, env: NodeJS.ProcessEnv, input = ""): Out {
  const full = { ...env, HOME: b.home, USERPROFILE: b.home, LIB, TMPDIR: b.root };
  const res = spawnSync(BASH ?? "bash", ["-c", `set -u\n. "$LIB"\n${body}`], {
    encoding: "utf8",
    env: full,
    cwd: b.root,
    input,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** The host PATH, plus `extra` variables. */
const host = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  PATH: process.env["PATH"],
  ...extra,
});

/** A PATH directory ahead of the host's holding a `fzf` stub that answers `reply` and counts its calls. */
function withFzf(b: Box, reply: string): NodeJS.ProcessEnv {
  const calls = path.join(b.root, "fzf-calls");
  const bin = makePathDir({
    scripts: { fzf: `echo x >> ${JSON.stringify(calls)}; echo ${reply}` },
  });
  return host({ PATH: `${bin}:${process.env["PATH"] ?? ""}` });
}
/** What the original `offer_tls_delegation` printed before it asked: the blank line and the preamble. */
const PREAMBLE =
  "\nCustom certificate trust (spec 0084):\n" +
  "  Your environment looks like it sits behind a custom or corporate\n" +
  "  certificate authority (a TLS-intercepting gateway or a private CA).\n";
/** What the original printed after a `yes` (a bundle found): the lines and the file it wrote. */
const CONSENT = (b: Box): string => {
  const file = envFile(b);
  const exported = ["NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "PIP_CERT"]
    .concat(["GIT_SSL_CAINFO", "CURL_CA_BUNDLE"])
    .map((name) => `    export ${name}=${b.ca}\n`)
    .join("");
  return (
    `  Custom CA trust configured -> ${file}\n  Delegated to CA bundle: ${b.ca}\n` +
    "  Applied for this setup run and, via scripts/lib/tls-exec.sh, for the\n" +
    "  framework's runtime paths (MCP servers, the ChromaDB daemon).\n" +
    `  Your shell profile was NOT modified. Remove with: rm ${file}\n\n  Exact configuration written:\n` +
    "    # crewrig custom root-CA / native-TLS delegation (spec 0084)\n" +
    "    # Per-user, machine-local. Written only on your explicit consent.\n" +
    `    # Remove in one action:  rm ${file}\n${exported}    export UV_SYSTEM_CERTS=true\n`
  );
};
const fzfCalls = (b: Box): number => {
  const file = path.join(b.root, "fzf-calls");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").length - 1 : 0;
};

/** What the TypeScript entry prints for `offer` in the same home (the written file is removed after). */
function entryOffer(b: Box, args: readonly string[], extra: Record<string, string>): string {
  const res = spawnSync(process.execPath, [ENTRY, "offer", ...args], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"], HOME: b.home, USERPROFILE: b.home, ...extra },
    cwd: b.root,
    input: "",
  });
  fs.rmSync(path.join(b.home, ".crewrig"), { recursive: true, force: true });
  return res.stdout;
}

describe("tls-delegation.sh function shim", { skip: SKIP }, () => {
  test("sourcing under set -u prints nothing, defines the three functions", () => {
    const b = box();
    const out = drive(
      b,
      "for f in _tls_candidate_ca detect_custom_tls_context offer_tls_delegation; do declare -F $f; done",
      host(),
    );
    assert.equal(out.status, 0, out.stderr);
    assert.equal(
      out.stdout,
      "_tls_candidate_ca\ndetect_custom_tls_context\noffer_tls_delegation\n",
    );
    assert.equal(out.stderr, "");
  });

  test("detect_custom_tls_context returns 0 on a signal, 1 on none; _tls_candidate_ca echoes the bundle or returns 1", () => {
    const b = box();
    const on = drive(
      b,
      "detect_custom_tls_context; echo rc=$?",
      host({ NODE_EXTRA_CA_CERTS: b.ca }),
    );
    assert.equal(on.stdout, "rc=0\n");
    const cand = drive(b, "_tls_candidate_ca; echo rc=$?", host({ SSL_CERT_FILE: b.ca }));
    assert.equal(cand.stdout, `${b.ca}\nrc=0\n`);
    if (hostAnchors) return;
    assert.equal(drive(b, "detect_custom_tls_context; echo rc=$?", host()).stdout, "rc=1\n");
  });

  test("offer: off returns 0 silently; an invalid value prints the entry's ERROR line and returns 1", () => {
    const b = box();
    const off = drive(b, "offer_tls_delegation; echo rc=$?", host({ TLS_DELEGATION: "off" }));
    assert.equal(off.stdout, "rc=0\n");
    const bad = drive(b, "offer_tls_delegation; echo rc=$?", host({ TLS_DELEGATION: "maybe" }));
    assert.equal(bad.stdout, "  ERROR: invalid TLS_DELEGATION 'maybe' (want: on|off)\nrc=1\n");
    assert.equal(fs.existsSync(envFile(b)), false);
  });

  test("offer: on writes the file, prints the entry's bytes, and the variables reach the calling shell", () => {
    const b = box();
    const extra = { TLS_DELEGATION: "on", TLS_DELEGATION_CA: b.ca };
    const out = drive(
      b,
      'offer_tls_delegation; echo "rc=$?"; echo "SSL=${SSL_CERT_FILE:-}|UV=${UV_SYSTEM_CERTS:-}"',
      host(extra),
    );
    assert.equal(out.status, 0, out.stderr);
    assert.ok(fs.existsSync(envFile(b)), "the managed file is written");
    const shimOut = out.stdout.replace(/rc=0\nSSL=.*\n$/, "");
    assert.equal(shimOut, entryOffer(b, [], extra));
    assert.match(
      out.stdout,
      new RegExp(`rc=0\\nSSL=${b.ca.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\|UV=true\\n$`),
    );
  });

  test("offer: the side-channel file is removed on every path (consent, decline, invalid)", () => {
    const cases: Record<string, string>[] = [
      { TLS_DELEGATION: "on", TLS_DELEGATION_CA: box().ca },
      { TLS_DELEGATION: "maybe" },
    ];
    for (const extra of cases) {
      const b = box();
      const out = drive(b, 'offer_tls_delegation >/dev/null; ls "$TMPDIR"', host(extra));
      assert.match(out.stdout, /home/, "the listing ran (vacuity guard)");
      assert.equal(out.stdout.includes("crewrig-tls-offer"), false);
    }
  });

  test("offer: shell variables that were set but not exported reach the entry", () => {
    const b = box();
    const out = drive(
      b,
      `TLS_DELEGATION=on; TLS_DELEGATION_CA=${JSON.stringify(b.ca)}; offer_tls_delegation >/dev/null; echo "rc=$?|SSL=\${SSL_CERT_FILE:-}"`,
      host(),
    );
    assert.equal(out.stdout, `rc=0|SSL=${b.ca}\n`);
    assert.ok(fs.existsSync(envFile(b)));
  });

  test("offer: the fzf answer is forwarded, yes writes and no does not; no detection, no question", () => {
    const yes = box();
    const outYes = drive(yes, 'offer_tls_delegation; echo "rc=$?|SSL=${SSL_CERT_FILE:-}"', {
      ...withFzf(yes, "yes"),
      NODE_EXTRA_CA_CERTS: yes.ca,
    });
    assert.equal(fzfCalls(yes), 1);
    assert.ok(fs.existsSync(envFile(yes)));
    assert.match(outYes.stdout, /^\nCustom certificate trust \(spec 0084\):\n/);
    assert.ok(outYes.stdout.endsWith(`rc=0|SSL=${yes.ca}\n`));
    // The ORIGINAL's standard output, as a literal: no `[answer]` echo, the preamble before the question.
    assert.equal(outYes.stdout, `${PREAMBLE}${CONSENT(yes)}rc=0|SSL=${yes.ca}\n`);
    assert.equal(outYes.stdout.includes("[answer]"), false);

    const no = box();
    const outNo = drive(no, "offer_tls_delegation; echo rc=$?", {
      ...withFzf(no, "no"),
      NODE_EXTRA_CA_CERTS: no.ca,
    });
    assert.equal(outNo.stdout, `${PREAMBLE}  TLS delegation skipped — nothing written.\nrc=0\n`);
    assert.equal(outNo.stdout.includes("[answer]"), false);
    assert.equal(fs.existsSync(envFile(no)), false);

    if (hostAnchors) return;
    const quiet = box();
    const outQuiet = drive(quiet, "offer_tls_delegation; echo rc=$?", withFzf(quiet, "yes"));
    assert.equal(outQuiet.stdout, "rc=0\n");
    assert.equal(fzfCalls(quiet), 0);
  });

  test("node below the floor: every function returns the guard's status, prints its diagnostic, never exits", () => {
    const b = box();
    const body =
      "detect_custom_tls_context; echo detect=$?; offer_tls_delegation; echo offer=$?; _tls_candidate_ca; echo cand=$?; echo alive";
    const out = drive(b, body, {
      ...pathWithFakeNode(),
      TLS_DELEGATION: "on",
      TLS_DELEGATION_CA: b.ca,
    });
    assert.equal(out.stdout, "detect=1\noffer=1\ncand=1\nalive\n");
    assert.equal(out.stderr.split("\n").filter((l) => /requires Node\.js >= 24/.test(l)).length, 3);
    assert.equal(fs.existsSync(path.join(b.home, ".crewrig")), false);
  });

  test("node absent: one Error line per call, return 1, the shell is still alive", () => {
    const b = box();
    const out = drive(b, "offer_tls_delegation; echo offer=$?; echo alive", {
      ...pathWithoutNode(),
      TLS_DELEGATION: "on",
    });
    assert.equal(out.stdout, "offer=1\nalive\n");
    assert.equal(
      out.stderr,
      "Error: node was not found on PATH; tls-delegation.sh needs Node.js 24 or later (https://nodejs.org/en/download).\n",
    );
    assert.equal(fs.existsSync(path.join(b.home, ".crewrig")), false);
  });

  test("standard input is not consumed by any function", () => {
    const b = box();
    const out = drive(
      b,
      'detect_custom_tls_context; offer_tls_delegation >/dev/null; _tls_candidate_ca >/dev/null; IFS= read -r a; echo "next=$a"',
      host({ TLS_DELEGATION: "on", TLS_DELEGATION_CA: b.ca, NODE_EXTRA_CA_CERTS: b.ca }),
      "first\nsecond\n",
    );
    assert.equal(out.stdout, "next=first\n");
  });
});
