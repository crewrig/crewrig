// setup-tls-detect.test.ts — candidateCa and detectCustomTlsContext (scripts/lib/setup/tls-detect.ts)
// against fake file systems: the twin of `_tls_candidate_ca` and `detect_custom_tls_context`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ANCHOR_DIRECTORIES,
  BUNDLE_VARIABLES,
  CONTEXT_VARIABLES,
  OS_BUNDLES,
  candidateCa,
  detectCustomTlsContext,
} from "../lib/setup/tls-detect.ts";

const filesOf =
  (...files: string[]) =>
  (p: string): boolean =>
    files.includes(p);
const noDirs = (): readonly string[] | undefined => undefined;

describe("candidateCa", () => {
  it("lists the eight variables in the shell order", () => {
    assert.deepEqual(BUNDLE_VARIABLES, [
      "SSL_CERT_FILE",
      "REQUESTS_CA_BUNDLE",
      "NODE_EXTRA_CA_CERTS",
      "GIT_SSL_CAINFO",
      "CURL_CA_BUNDLE",
      "PIP_CERT",
      "TLS_DELEGATION_CA",
      "CREWRIG_TLS_CA",
    ]);
  });

  for (const name of BUNDLE_VARIABLES) {
    it(`takes ${name} when it names a file`, () => {
      assert.equal(candidateCa({ [name]: "/x/ca.pem" }, filesOf("/x/ca.pem")), "/x/ca.pem");
    });
  }

  it("skips a variable that is not a file and takes the next one", () => {
    const env = { SSL_CERT_FILE: "/missing.pem", PIP_CERT: "/pip.pem" };
    assert.equal(candidateCa(env, filesOf("/pip.pem")), "/pip.pem");
  });

  it("skips an empty or undefined variable", () => {
    const env = { SSL_CERT_FILE: "", REQUESTS_CA_BUNDLE: undefined, CREWRIG_TLS_CA: "/c.pem" };
    assert.equal(candidateCa(env, filesOf("", "/c.pem")), "/c.pem");
  });

  it("first hit wins: an earlier variable beats a later one and the OS bundles", () => {
    const env = { CREWRIG_TLS_CA: "/c.pem", SSL_CERT_FILE: "/s.pem", TLS_DELEGATION_CA: "/t.pem" };
    assert.equal(candidateCa(env, filesOf("/c.pem", "/s.pem", "/t.pem", ...OS_BUNDLES)), "/s.pem");
    assert.equal(
      candidateCa({ ...env, SSL_CERT_FILE: undefined }, filesOf("/c.pem", "/t.pem")),
      "/t.pem",
    );
  });

  it("falls back to the three OS bundles in order", () => {
    assert.deepEqual(OS_BUNDLES, [
      "/etc/ssl/certs/ca-certificates.crt",
      "/etc/pki/tls/certs/ca-bundle.crt",
      "/etc/ssl/cert.pem",
    ]);
    assert.equal(candidateCa({}, filesOf(...OS_BUNDLES)), OS_BUNDLES[0]);
    assert.equal(
      candidateCa({}, filesOf(OS_BUNDLES[1] as string, OS_BUNDLES[2] as string)),
      OS_BUNDLES[1],
    );
    assert.equal(candidateCa({}, filesOf(OS_BUNDLES[2] as string)), OS_BUNDLES[2]);
  });

  it("returns undefined when nothing is a file", () => {
    assert.equal(candidateCa({ SSL_CERT_FILE: "/gone.pem" }, filesOf()), undefined);
  });
});

describe("detectCustomTlsContext", () => {
  it("names the twelve variables", () => {
    assert.equal(CONTEXT_VARIABLES.length, 12);
    assert.deepEqual([...CONTEXT_VARIABLES].sort(), [
      "CREWRIG_TLS_CA",
      "CURL_CA_BUNDLE",
      "GIT_SSL_CAINFO",
      "HTTPS_PROXY",
      "HTTP_PROXY",
      "NODE_EXTRA_CA_CERTS",
      "PIP_CERT",
      "REQUESTS_CA_BUNDLE",
      "SSL_CERT_FILE",
      "TLS_DELEGATION_CA",
      "UV_NATIVE_TLS",
      "UV_SYSTEM_CERTS",
    ]);
  });

  it("does not fire on an empty environment with no anchors", () => {
    assert.equal(detectCustomTlsContext({}, noDirs), false);
  });

  for (const name of CONTEXT_VARIABLES) {
    it(`fires on ${name} non-empty`, () => {
      assert.equal(detectCustomTlsContext({ [name]: "1" }, noDirs), true);
    });
    it(`does not fire on ${name} empty`, () => {
      assert.equal(detectCustomTlsContext({ [name]: "" }, noDirs), false);
    });
  }

  for (const dir of ANCHOR_DIRECTORIES) {
    it(`fires on a non-empty ${dir}`, () => {
      assert.equal(
        detectCustomTlsContext({}, (d) => (d === dir ? ["corp.crt"] : undefined)),
        true,
      );
    });
    it(`does not fire on an empty ${dir}`, () => {
      assert.equal(
        detectCustomTlsContext({}, (d) => (d === dir ? [] : undefined)),
        false,
      );
    });
  }

  it("counts a dot file as an entry (ls -A)", () => {
    assert.equal(
      detectCustomTlsContext({}, (d) => (d === ANCHOR_DIRECTORIES[0] ? [".keep"] : undefined)),
      true,
    );
  });

  it("names the two anchor directories", () => {
    assert.deepEqual(ANCHOR_DIRECTORIES, [
      "/usr/local/share/ca-certificates",
      "/etc/pki/ca-trust/source/anchors",
    ]);
  });
});
