// tls-entry-run.ts — what the two suites of scripts/tls-delegation.ts share (setup-lib-tls-entry.test.ts
// and setup-lib-tls-entry-offer.test.ts): a throwaway home with a fake CA bundle, and a runner that
// starts the entry as a child process with only that home and the variables a case adds (no TLS
// variable of the host leaks in). The real home is never touched.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";

import { REPO } from "./build-fixture-tree.ts";

export const ENTRY = path.join(REPO, "scripts", "tls-delegation.ts");
export const POSIX = process.platform !== "win32";
const roots: string[] = [];
after(() => roots.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

export interface Box {
  readonly root: string;
  readonly home: string;
  readonly ca: string;
  readonly result: string;
}

export function box(): Box {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tls-entry-")));
  roots.push(root);
  const home = path.join(root, "home");
  fs.mkdirSync(home);
  const ca = path.join(root, "corp-ca.pem");
  fs.writeFileSync(ca, "-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----\n");
  return { root, home, ca, result: path.join(root, "result.txt") };
}

/** The environment of a run: only the throwaway home and what the case adds (no TLS variable leaks in). */
export function envOf(b: Box, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { PATH: process.env["PATH"], HOME: b.home, USERPROFILE: b.home, ...extra };
}

export function run(
  b: Box,
  args: readonly string[],
  extra: Record<string, string> = {},
  input = "",
) {
  const res = spawnSync(process.execPath, [ENTRY, ...args], {
    encoding: "utf8",
    env: envOf(b, extra),
    cwd: b.root,
    input,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

export const envFile = (b: Box): string => path.join(b.home, ".crewrig", "tls-env.sh");
export const hostAnchors = [
  "/usr/local/share/ca-certificates",
  "/etc/pki/ca-trust/source/anchors",
].some((dir) => fs.existsSync(dir) && fs.readdirSync(dir).length > 0);
export const hostBundle = [
  "/etc/ssl/certs/ca-certificates.crt",
  "/etc/pki/tls/certs/ca-bundle.crt",
  "/etc/ssl/cert.pem",
].some((f) => fs.existsSync(f));
