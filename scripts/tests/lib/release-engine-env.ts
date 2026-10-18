// release-engine-env.ts — the clean child environment, git runner and driver runner of the
// real-engine release suites (spec 0265, row J2). Shared by `release-engine-fixture.ts` and by
// every suite that runs `scripts/monorepo-release.sh` against a fixture checkout.
//
// Nothing is inherited from the parent: no CI/GITHUB_*/GITLAB_* variable, no real HOME, no real
// git config (global is a file the fixture owns or the null device; the system config is skipped
// with `GIT_CONFIG_NOSYSTEM=1`, never `GIT_CONFIG_SYSTEM=<null device>`). PATH is the directory of
// the running Node (no asdf shim lookup) followed by the usual system directories.
//
// API:
//   cleanPath()                              the child PATH
//   cleanEnv(home, gitconfig?, extra?)       a complete child environment (LC_ALL=C)
//   cleanGit(home, cwd, args, gitconfig?)    stdout of a git call; throws on failure
//   ghEnv(extra?) / ghPushEnv(apiUrl, tok?)  GitHub CI variable blocks (rehearsal / publish)
//   glEnv(apiUrl?)                           GitLab CI variable block (no API url: rehearsal)
//   runDriver(fx, env, gitconfig?)           the real driver, as a DriverRun
//   extensionLine(out, ext)                  the REHEARSAL/PUBLISHED/UNCHANGED/RELEASE-FAILED line

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** A neutral well-formed URL for `origin` (git-url-parse rejects a bare path); redirected by `insteadOf`. */
export const NEUTRAL_ORIGIN_URL = "https://origin.fixture.invalid/acme/fixture.git";
export const CI_SERVER_URL = "https://gitlab.example.test:8443";
export const CI_PROJECT_PATH = "acme/sub/fixture";
export const CI_PROJECT_URL = `${CI_SERVER_URL}/${CI_PROJECT_PATH}`;
export const GITLAB_FORGE_URL = `${CI_PROJECT_URL}.git`;

/** The child PATH: the running Node's directory first, then the system directories. */
export function cleanPath(stubDir?: string): string {
  const system = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  const front = stubDir === undefined ? [] : [stubDir];
  return [...front, path.dirname(process.execPath), ...system].join(path.delimiter);
}

/** A directory under `home` (a mkdtemp path of the caller) holding refusing `gh` and `glab`, so a real forge CLI of the host is never reachable. */
function forgeStubDir(home: string): string {
  const dir = path.join(home, ".forge-refuse-bin");
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ["gh", "glab"]) {
    const file = path.join(dir, name);
    fs.writeFileSync(
      file,
      '#!/bin/sh\necho "stub ' + name + ': no real forge CLI in a test" >&2\nexit 97\n',
      { mode: 0o755 },
    );
  }
  return dir;
}

/**
 * A complete child environment; an `undefined` value in `extra` removes the variable. The caller
 * MUST pass a `home` it created with mkdtemp: the refusing `gh`/`glab` stubs and every scratch file
 * live under it, and cleanup removes only paths the caller created.
 */
export function cleanEnv(
  home: string,
  gitconfig?: string,
  extra: Readonly<Record<string, string | undefined>> = {},
): Record<string, string> {
  const env: Record<string, string> = {
    PATH: cleanPath(forgeStubDir(home)),
    HOME: home,
    LC_ALL: "C",
    GIT_CONFIG_GLOBAL: gitconfig ?? os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
  };
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

/** `git -C <cwd> <args>` in a clean environment; returns stdout, throws with stderr on failure. */
export function cleanGit(
  home: string,
  cwd: string,
  args: readonly string[],
  gitconfig?: string,
): string {
  const res = spawnSync("git", ["-C", cwd, ...args], {
    env: cleanEnv(home, gitconfig),
    encoding: "utf8",
  });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}${res.stdout}`);
  return res.stdout;
}

/** The GitHub block of a workflow_dispatch (rehearsal) run. */
export function ghEnv(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_ACTION: "run",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "acme/fixture",
    GITHUB_SERVER_URL: "https://github.com",
    ...extra,
  };
}

/** The GitHub block of a push-to-main (publish) run against a forge stub at `apiUrl`. */
export function ghPushEnv(apiUrl: string, token = "sentinel-ghs-7f3a"): Record<string, string> {
  return ghEnv({ GITHUB_EVENT_NAME: "push", GITHUB_API_URL: apiUrl, GITHUB_TOKEN: token });
}

/** The GitLab CI block; `apiUrl` is omitted for rehearsal (no publish leg ever calls the API). */
export function glEnv(apiUrl?: string): Record<string, string> {
  const env: Record<string, string> = {
    GITLAB_CI: "true",
    CI_COMMIT_REF_NAME: "main",
    CI_COMMIT_BRANCH: "main",
    CI_PIPELINE_SOURCE: "push",
    CI_PROJECT_ID: "7",
    CI_PROJECT_PATH,
    CI_SERVER_URL,
    CI_PROJECT_URL,
  };
  if (apiUrl !== undefined) env["CI_API_V4_URL"] = apiUrl;
  return env;
}

/** What one driver run returned. */
export interface DriverRun {
  readonly rc: number | null;
  readonly out: string;
  readonly err: string;
}

/** The minimum a fixture exposes to the runners. */
export interface DriverFixture {
  readonly fix: string;
  readonly home: string;
  readonly gitconfig: string;
}

/**
 * Run the REAL `scripts/monorepo-release.sh` in the fixture checkout, fully clean env plus `env`.
 * `gitconfig` defaults to the fixture's own global config (the `origin` redirect); pass `"-"` for none.
 */
export function runDriver(
  fx: DriverFixture,
  env: Readonly<Record<string, string | undefined>>,
  gitconfig?: string,
): DriverRun {
  const config = gitconfig === "-" ? undefined : (gitconfig ?? fx.gitconfig);
  const res = spawnSync("bash", [path.join(fx.fix, "scripts", "monorepo-release.sh")], {
    cwd: fx.fix,
    env: cleanEnv(fx.home, config, env),
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 1 << 26,
  });
  return { rc: res.status, out: res.stdout, err: res.stderr };
}

/** The driver's own line for one extension; empty when there is none. */
export function extensionLine(out: string, ext: string): string {
  const re = new RegExp(`^(REHEARSAL|PUBLISHED|UNCHANGED|RELEASE-FAILED) ${ext}( .*)?$`, "m");
  return re.exec(out)?.[0] ?? "";
}
