// tls-detect.ts — where the custom-CA bundle is and whether the environment needs one (spec 0256
// requirement 18). A TypeScript twin of `_tls_candidate_ca` and `detect_custom_tls_context` in
// scripts/lib/tls-delegation.sh: the same variables, the same order, the same file tests. The file
// system is reached through two small injected functions so tests pass fakes; the defaults use
// `node:fs`. Nothing here reads `process.env`: the environment is an argument.

import fs from "node:fs";

import type { Env } from "../extension/types.ts";

/** The file system questions detection asks. */
export interface TlsFs {
  /** `[ -f path ]`: a regular file, following links. */
  isFile(path: string): boolean;
  /** `ls -A dir`: the entries of a directory (dot files included), or `undefined` when it is not a readable directory. */
  readdir(dir: string): readonly string[] | undefined;
}

export const defaultTlsFs: TlsFs = {
  isFile(path: string): boolean {
    try {
      return fs.statSync(path).isFile();
    } catch {
      return false;
    }
  },
  readdir(dir: string): readonly string[] | undefined {
    try {
      return fs.readdirSync(dir);
    } catch {
      return undefined;
    }
  },
};

/** The variables that may already name a bundle, in the shell's order (the user's own values first, then the overrides). */
export const BUNDLE_VARIABLES: readonly string[] = [
  "SSL_CERT_FILE",
  "REQUESTS_CA_BUNDLE",
  "NODE_EXTRA_CA_CERTS",
  "GIT_SSL_CAINFO",
  "CURL_CA_BUNDLE",
  "PIP_CERT",
  "TLS_DELEGATION_CA",
  "CREWRIG_TLS_CA",
];

/** The operating-system consolidated bundles (Debian, RHEL, macOS), in the shell's order. */
export const OS_BUNDLES: readonly string[] = [
  "/etc/ssl/certs/ca-certificates.crt",
  "/etc/pki/tls/certs/ca-bundle.crt",
  "/etc/ssl/cert.pem",
];

/** The variables whose presence marks a custom-trust context, in the shell's order. */
export const CONTEXT_VARIABLES: readonly string[] = [
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "REQUESTS_CA_BUNDLE",
  "PIP_CERT",
  "GIT_SSL_CAINFO",
  "CURL_CA_BUNDLE",
  "UV_SYSTEM_CERTS",
  "UV_NATIVE_TLS",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "CREWRIG_TLS_CA",
  "TLS_DELEGATION_CA",
];

/** The directories where an administrator adds a CA: non-default by construction. */
export const ANCHOR_DIRECTORIES: readonly string[] = [
  "/usr/local/share/ca-certificates",
  "/etc/pki/ca-trust/source/anchors",
];

/** The resolved bundle path (first hit wins: a set variable that is a file, then an OS bundle), or `undefined`. */
export function candidateCa(env: Env, isFile: (path: string) => boolean): string | undefined {
  for (const name of BUNDLE_VARIABLES) {
    const value = env[name];
    if (typeof value === "string" && value !== "" && isFile(value)) return value;
  }
  return OS_BUNDLES.find((bundle) => isFile(bundle));
}

/** True when the environment looks like it needs custom trust: a signal variable set, or a non-empty anchors directory. */
export function detectCustomTlsContext(
  env: Env,
  readdir: (dir: string) => readonly string[] | undefined,
): boolean {
  for (const name of CONTEXT_VARIABLES) {
    const value = env[name];
    if (typeof value === "string" && value !== "") return true;
  }
  return ANCHOR_DIRECTORIES.some((dir) => (readdir(dir)?.length ?? 0) > 0);
}
