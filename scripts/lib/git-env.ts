// git-env.ts — scrub of the GIT_* environment variables (spec 0279 delta-02, R21).
//
// Usage: import { scrubGitEnv } from "./git-env.ts"; spawn(cmd, { env: scrubGitEnv(process.env) });
// Git exports GIT_DIR, GIT_EXEC_PATH and GIT_PREFIX to a hook; a child that runs git in a temporary
// directory with them acts on the real repository. The rule is a prefix, not a list, so a variable
// added by a future git is covered: `GIT_` is case-sensitive on POSIX, case-insensitive on win32
// (environment names are). The hook (.githooks/pre-push) carries an inline copy of the same rule.

/** A copy of `env` without any variable whose name starts with `GIT_`. */
export function scrubGitEnv(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const rule = platform === "win32" ? /^GIT_/i : /^GIT_/;
  return Object.fromEntries(Object.entries(env).filter(([name]) => !rule.test(name)));
}
