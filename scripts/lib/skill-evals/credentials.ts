// credentials.ts — local credentials and the judge configuration (spec 0290 R33, R39).
//
// Executor and judge use the contributor's own Claude Code credentials, read from the environment:
// `CLAUDE_CODE_OAUTH_TOKEN` (preferred) or `ANTHROPIC_API_KEY`. The judge follows the credential:
// the token goes to headless `claude -p` (backend `claude-cli`); an API key alone goes to the
// `anthropic` driver with `api_key_env = ANTHROPIC_API_KEY`. The runner builds the effective judge
// configuration itself. A contributor override (`--judge-config <file>`, or the file named by
// SKILL_EVALS_JUDGE_CONFIG, a JSON `{"judge": {...}}`) is honoured, except an effective
// configuration that would send the subscription credential to the Messages API (backend
// `claude-code`, or any `api_key_env` naming CLAUDE_CODE_OAUTH_TOKEN), which is refused (exit 3).
// No other credential variable is read; ANTHROPIC_EXECUTOR_API_KEY, SKILL_EVALS_PR_NUMBER and
// SKILL_EVALS_REPO do not exist in this design (R39).
//
// Usage: const plan = planCredentials({ env, override, mock }); plan.ok ? plan.credential : plan.message.
// Exit codes: not applicable (library); the entry maps a failed plan to exit 3.
// Finding-line format: not applicable.

import fs from "node:fs";

import { API_KEY_VAR, JUDGE_MAX_TOKENS, JUDGE_MODEL, TOKEN_VAR } from "./settings.ts";

export interface Credential {
  readonly name: typeof TOKEN_VAR | typeof API_KEY_VAR;
  readonly value: string;
}

export interface JudgeSection {
  backend: string;
  model: string;
  api_key_env: string;
  auth_mode: string;
  max_tokens: number;
  endpoint?: string;
  strict: boolean;
}

export type CredentialPlan =
  | { readonly ok: true; readonly credential: Credential | undefined; readonly judge: JudgeSection }
  | { readonly ok: false; readonly message: string };

const OVERRIDE_KEYS = ["backend", "model", "api_key_env", "auth_mode", "endpoint"] as const;
const EVIDENCE_BACKENDS = ["anthropic", "claude-cli"];

export const MISSING_MESSAGE =
  `Neither ${TOKEN_VAR} nor ${API_KEY_VAR} is set. Set ${TOKEN_VAR} (a subscription token: run \`claude setup-token\`) ` +
  `or ${API_KEY_VAR}, or run with --mock. No model call was made.`;

/** Read the contributor's judge override file; `{}` when none, an error message when unreadable. */
export function readOverride(
  file: string | undefined,
): { override: Record<string, unknown> } | { error: string } {
  if (file === undefined || file === "") return { override: {} };
  try {
    const doc: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    const j = (doc as { judge?: unknown } | null)?.judge;
    if (typeof j !== "object" || j === null || Array.isArray(j))
      return { error: `judge override ${file} has no "judge" object` };
    const out: Record<string, unknown> = {};
    for (const k of OVERRIDE_KEYS)
      if ((j as Record<string, unknown>)[k] !== undefined)
        out[k] = (j as Record<string, unknown>)[k];
    return { override: out };
  } catch (e) {
    return { error: `judge override ${file} cannot be read: ${(e as Error).message}` };
  }
}

export function planCredentials(input: {
  env: Readonly<Record<string, string | undefined>>;
  override: Record<string, unknown>;
  mock: boolean;
}): CredentialPlan {
  const token = input.env[TOKEN_VAR] ?? "";
  const key = input.env[API_KEY_VAR] ?? "";
  if (!input.mock && token === "" && key === "") return { ok: false, message: MISSING_MESSAGE };
  const credential: Credential | undefined =
    token !== ""
      ? { name: TOKEN_VAR, value: token }
      : key !== ""
        ? { name: API_KEY_VAR, value: key }
        : undefined;
  const tokenPath = credential?.name === TOKEN_VAR || (credential === undefined && input.mock);
  const judge: JudgeSection = tokenPath
    ? {
        backend: "claude-cli",
        model: JUDGE_MODEL,
        api_key_env: "ANTHROPIC_JUDGE_API_KEY",
        auth_mode: "api_key",
        max_tokens: JUDGE_MAX_TOKENS,
        strict: false,
      }
    : {
        backend: "anthropic",
        model: JUDGE_MODEL,
        api_key_env: API_KEY_VAR,
        auth_mode: "api_key",
        max_tokens: JUDGE_MAX_TOKENS,
        strict: false,
      };
  for (const k of OVERRIDE_KEYS) {
    const v = input.override[k];
    if (typeof v === "string" && v !== "") (judge as unknown as Record<string, string>)[k] = v;
  }
  if (judge.backend === "claude-code")
    return {
      ok: false,
      message: `judge backend claude-code would send the subscription credential to the Messages API (${TOKEN_VAR} or the OAuth credential of your Claude credentials file); refused. Use the default backend, or backend anthropic with an API key. No model call was made.`,
    };
  if (judge.api_key_env === TOKEN_VAR)
    return {
      ok: false,
      message: `judge api_key_env ${TOKEN_VAR} would send the subscription credential to the Messages API; refused. No model call was made.`,
    };
  if (!EVIDENCE_BACKENDS.includes(judge.backend))
    return {
      ok: false,
      message: `judge backend ${judge.backend} is not supported by the skill eval runner (supported: ${EVIDENCE_BACKENDS.join(", ")}). No model call was made.`,
    };
  return { ok: true, credential, judge };
}

/** The environment given to the judge library: only what the effective judge configuration reads. */
export function judgeEnv(opts: {
  base: Readonly<Record<string, string | undefined>>;
  judge: JudgeSection;
  credential: Credential | undefined;
  reportDir: string;
  mock: boolean;
  mockResponse?: string;
}): Record<string, string> {
  const out: Record<string, string> = { E2E_REPORT_DIR: opts.reportDir };
  for (const k of ["PATH", "LANG", "LC_ALL", "TMPDIR", "SKILL_EVALS_CLAUDE_BIN"]) {
    const v = opts.base[k];
    if (v !== undefined) out[k] = v;
  }
  if (opts.mock) {
    out["E2E_JUDGE_MOCK"] = "1";
    if (opts.mockResponse !== undefined) out["E2E_JUDGE_MOCK_RESPONSE"] = opts.mockResponse;
    return out;
  }
  if (opts.judge.backend === "claude-cli") {
    if (opts.credential?.name === TOKEN_VAR) out[TOKEN_VAR] = opts.credential.value;
  } else {
    const name = opts.judge.api_key_env;
    const v = opts.base[name];
    if (v !== undefined && name !== TOKEN_VAR) out[name] = v;
  }
  return out;
}

export function effectiveJson(judge: JudgeSection, maxCalls: number): string {
  return `${JSON.stringify({ judge: { ...judge, max_calls: maxCalls } }, null, 2)}\n`;
}
