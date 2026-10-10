// Tests for writeTlsEnv (spec 0256 requirement 19): the file equals what the
// shell writer (scripts/lib/tls-delegation.sh) writes, LF only, published
// atomically, and read back by the reader.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { quoteWord, readTlsEnv, tlsEnvPath, writeTlsEnv } from "../lib/tls-env.ts";

const posixOnly = { skip: process.platform === "win32" ? "needs bash" : false };
const nonRootPosix = {
  skip:
    process.platform === "win32" || process.getuid?.() === 0
      ? "needs a non-root POSIX user"
      : false,
};

// The persist block of offer_tls_delegation in scripts/lib/tls-delegation.sh.
const SHELL_WRITER = `
env_file="$1"; ca="$2"
{
  printf '# crewrig custom root-CA / native-TLS delegation (spec 0084)\\n'
  printf '# Per-user, machine-local. Written only on your explicit consent.\\n'
  printf '# Remove in one action:  rm %s\\n' "$env_file"
  printf 'export NODE_EXTRA_CA_CERTS=%q\\n' "$ca"
  printf 'export SSL_CERT_FILE=%q\\n' "$ca"
  printf 'export REQUESTS_CA_BUNDLE=%q\\n' "$ca"
  printf 'export PIP_CERT=%q\\n' "$ca"
  printf 'export GIT_SSL_CAINFO=%q\\n' "$ca"
  printf 'export CURL_CA_BUNDLE=%q\\n' "$ca"
  printf 'export UV_SYSTEM_CERTS=true\\n'
} > "\${env_file}.tmp" && mv "\${env_file}.tmp" "$env_file"
`;

function withHome(fn: (home: string) => void): void {
  const home = mkdtempSync(path.join(tmpdir(), "tls-writer-"));
  try {
    fn(home);
  } finally {
    chmodSync(home, 0o755);
    rmSync(home, { recursive: true, force: true });
  }
}

function shellWrites(home: string, bundle: string): Buffer {
  mkdirSync(path.join(home, ".crewrig"), { recursive: true });
  const file = tlsEnvPath(home);
  const run = spawnSync("bash", ["-c", SHELL_WRITER, "_", file, bundle], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const bytes = readFileSync(file);
  rmSync(file);
  return bytes;
}

test("the file is the shell writer's: comments, six exports in order, UV_SYSTEM_CERTS", () => {
  withHome((home) => {
    const bundle = "/etc/ssl/certs/corp-ca.pem";
    const written = writeTlsEnv(home, bundle);
    assert.equal(written.path, path.join(home, ".crewrig", "tls-env.sh"));
    const file = written.path;
    assert.equal(
      readFileSync(file, "utf8"),
      [
        "# crewrig custom root-CA / native-TLS delegation (spec 0084)",
        "# Per-user, machine-local. Written only on your explicit consent.",
        `# Remove in one action:  rm ${file}`,
        `export NODE_EXTRA_CA_CERTS=${bundle}`,
        `export SSL_CERT_FILE=${bundle}`,
        `export REQUESTS_CA_BUNDLE=${bundle}`,
        `export PIP_CERT=${bundle}`,
        `export GIT_SSL_CAINFO=${bundle}`,
        `export CURL_CA_BUNDLE=${bundle}`,
        "export UV_SYSTEM_CERTS=true",
        "",
      ].join("\n"),
    );
    assert.equal(readFileSync(file, "utf8"), written.content);
  });
});

test("the bytes equal what the shell writes, for plain and escaped bundle paths", posixOnly, () => {
  withHome((home) => {
    for (const bundle of [
      "/etc/ssl/certs/ca-certificates.crt",
      "/Users/jane doe/certs/ca (1).pem",
      "/opt/ca$bundle,x^y/#1.pem",
      '/a/it\'s "q"/b\\c.pem',
    ]) {
      const written = writeTlsEnv(home, bundle);
      assert.deepEqual(readFileSync(written.path), shellWrites(home, bundle), bundle);
    }
  });
});

test("LF only, no carriage return, a single trailing line feed", () => {
  withHome((home) => {
    const bytes = readFileSync(writeTlsEnv(home, "/p a/b.pem").path);
    assert.ok(!bytes.includes(0x0d));
    assert.equal(bytes.at(-1), 0x0a);
    assert.notEqual(bytes.at(-2), 0x0a);
    assert.equal(bytes.toString("utf8").split("\n").length, 11);
  });
});

test("the reader reads the variables back, and a non-ASCII or Windows path round-trips", () => {
  withHome((home) => {
    for (const bundle of ["C:\\Users\\Jane Doe\\ca.pem", "/caf\u00e9/\u20ac.pem", "/plain.pem"]) {
      writeTlsEnv(home, bundle);
      const back = readTlsEnv(home);
      assert.equal(back.kind, "ok");
      if (back.kind !== "ok") return;
      for (const name of [
        "NODE_EXTRA_CA_CERTS",
        "SSL_CERT_FILE",
        "REQUESTS_CA_BUNDLE",
        "PIP_CERT",
        "GIT_SSL_CAINFO",
        "CURL_CA_BUNDLE",
      ]) {
        assert.equal(back.vars[name], bundle, name);
      }
      assert.equal(back.vars["UV_SYSTEM_CERTS"], "true");
      assert.equal(Object.keys(back.vars).length, 7);
    }
  });
});

test("creates ~/.crewrig recursively and replaces an existing file", () => {
  withHome((home) => {
    writeTlsEnv(home, "/one.pem");
    writeTlsEnv(home, "/two.pem");
    const back = readTlsEnv(home);
    assert.equal(back.kind === "ok" && back.vars["SSL_CERT_FILE"], "/two.pem");
  });
});

test("the mode is the umask's, with no chmod, and no temporary file is left", posixOnly, () => {
  withHome((home) => {
    const before = process.umask(0o022);
    try {
      const written = writeTlsEnv(home, "/p.pem");
      assert.equal(statSync(written.path).mode & 0o777, 0o644);
      process.umask(0o077);
      rmSync(written.path);
      assert.equal(statSync(writeTlsEnv(home, "/p.pem").path).mode & 0o777, 0o600);
    } finally {
      process.umask(before);
    }
    assert.deepEqual(readdirSync(path.join(home, ".crewrig")), ["tls-env.sh"]);
  });
});

test("a failure removes the temporary file and leaves the target as it was", posixOnly, () => {
  withHome((home) => {
    // the target is a directory: the rename onto it fails after the temporary file is written
    mkdirSync(tlsEnvPath(home), { recursive: true });
    assert.throws(() => writeTlsEnv(home, "/p.pem"));
    assert.deepEqual(readdirSync(path.join(home, ".crewrig")), ["tls-env.sh"]);
    assert.ok(statSync(tlsEnvPath(home)).isDirectory());
  });
});

test("a value the writer cannot quote throws before anything is written", () => {
  withHome((home) => {
    assert.throws(() => writeTlsEnv(home, "a\0b"), /NUL/);
    assert.equal(readTlsEnv(home).kind, "absent");
  });
});

test("a read-back the reader rejects throws", nonRootPosix, () => {
  withHome((home) => {
    // an unreadable result: the reader cannot open the file it was just given
    const file = tlsEnvPath(home);
    mkdirSync(path.dirname(file), { recursive: true });
    const before = process.umask(0o777);
    try {
      assert.throws(() => writeTlsEnv(home, "/p.pem"), /reader rejects it \(unreadable\)/);
    } finally {
      process.umask(before);
    }
  });
});

test("quoteWord is re-exported from tls-env.ts", () => {
  assert.equal(quoteWord("a b"), "a\\ b");
});
