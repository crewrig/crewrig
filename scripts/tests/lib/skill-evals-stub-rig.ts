// skill-evals-stub-rig.ts — a mock-free run of the skill eval runner against a recording stub `claude`.
//
// `stubRig` builds a run rig whose real executor and judge driver (and login probe) talk to
// `writeSessionStub`, in a fake HOME and a temporary root that does not contain it, so a test can
// assert on the argv, environment and working directory of every child. No model call, no network.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import fs from "node:fs";
import path from "node:path";

import {
  DECOY_EMAIL,
  DECOY_ORG,
  isolatedDirs,
  skillRel,
  tmpDir,
  writeSessionStub,
} from "./skill-evals-fixtures.ts";
import type { StubCall } from "./skill-evals-fixtures.ts";
import { makeRig, plainEvals } from "./skill-evals-run-rig.ts";

/** Only evals.json changes: two executor runs (with_skill, without_skill) per eval and no base replay. */
export const evalsOnly =
  (n = 1) =>
  (repo: { root: string }) =>
    fs.writeFileSync(
      path.join(repo.root, skillRel("demo"), "evals", "evals.json"),
      plainEvals("demo", n),
    );
export const judgeCfg = (out: string) =>
  JSON.parse(fs.readFileSync(path.join(out, "demo", ".judge", "effective.json"), "utf8")).judge;
export const noResults = (repo: string) =>
  !fs.existsSync(path.join(repo, skillRel("demo"), "evals", "results.json"));
export const decoy = new RegExp(`${DECOY_EMAIL}|${DECOY_ORG}`);

/** A rig that runs the real executor and judge driver against a recording stub `claude`. */
export function stubRig(
  auth: { loggedIn: boolean },
  env: Record<string, string>,
  opts: { evals?: number; useApiKey?: boolean } = {},
) {
  const dir = tmpDir();
  const bin = writeSessionStub(dir, auth);
  const iso = isolatedDirs();
  const rig = makeRig({
    mock: false,
    useApiKey: opts.useApiKey ?? false,
    tempRoot: iso.tempRoot,
    env: { SKILL_EVALS_CLAUDE_BIN: bin, HOME: iso.home, USER: "contributor", ...env },
    change: evalsOnly(opts.evals ?? 1),
  });
  return {
    rig,
    bin,
    iso,
    run: (over: Parameters<typeof rig.run>[0] = {}) => rig.run({ executor: undefined, ...over }),
    cleanup: () => {
      rig.cleanup();
      iso.cleanup();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

const allowlisted = new Set([
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "CLAUDE_CONFIG_DIR",
  "USER",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
]);
export const credentialVars = (c: StubCall): string[] =>
  Object.keys(c.env).filter((k) => k === "ANTHROPIC_API_KEY" || k === "CLAUDE_CODE_OAUTH_TOKEN");
export const foreignVars = (c: StubCall) =>
  Object.keys(c.env).filter(
    (k) => !allowlisted.has(k) && !credentialVars(c).includes(k) && !k.startsWith("__CF"),
  );
