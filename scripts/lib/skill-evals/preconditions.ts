// preconditions.ts — the credential and temporary-directory step shared by a run and a dry-run
// (spec 0290 R32, R33, R41; 0304 R20).
//
// Chooses the credential source, checks that the temporary root lies outside HOME and any git work
// tree and, in session mode, probes the login once per invocation (no model call). A failure maps
// to exit 3 with the message to print; nothing is run before it passes.
//
// Usage: await checkPreconditions({ env, judgeConfigFile, mock, useApiKey, tempRoot }).
// Exit codes: not applicable (library); the caller maps `exit`. Finding-line format: not applicable.

import os from "node:os";

import {
  cannotStartMessage,
  checkTempRoot,
  notLoggedInMessage,
  probeLogin,
  resetLoginProbe,
} from "./claude-child.ts";
import { planCredentials, readOverride } from "./credentials.ts";
import type { CredentialPlan, CredentialSource } from "./credentials.ts";

export type Preconditions =
  | {
      readonly ok: true;
      readonly cred: Extract<CredentialPlan, { ok: true }>;
      /** Absent in mock mode. */
      readonly source: CredentialSource | undefined;
    }
  | { readonly ok: false; readonly exit: 3; readonly stderr: string };

export async function checkPreconditions(a: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly judgeConfigFile: string | undefined;
  readonly mock: boolean;
  readonly useApiKey: boolean;
  readonly tempRoot: string;
}): Promise<Preconditions> {
  const fail = (m: string): Preconditions => ({ ok: false, exit: 3, stderr: `${m}\n` });
  const ov = readOverride(a.judgeConfigFile ?? a.env["SKILL_EVALS_JUDGE_CONFIG"]);
  if ("error" in ov) return fail(ov.error);
  const cred = planCredentials({
    env: a.env,
    override: ov.override,
    mock: a.mock,
    useApiKey: a.useApiKey,
  });
  if (!cred.ok) return fail(cred.message);
  if (a.mock) return { ok: true, cred, source: undefined };
  resetLoginProbe(); // the probe runs once per invocation
  const bad = checkTempRoot(a.tempRoot, a.env["HOME"] ?? os.homedir());
  if (bad !== undefined) return fail(bad);
  if (cred.source === "session") {
    const state = await probeLogin(a.env, { tempRoot: a.tempRoot });
    if (state === "cannot-start") return fail(cannotStartMessage(a.env));
    if (state === "not-logged-in")
      return fail(notLoggedInMessage((a.env["ANTHROPIC_API_KEY"] ?? "") !== ""));
  }
  return { ok: true, cred, source: cred.source };
}
