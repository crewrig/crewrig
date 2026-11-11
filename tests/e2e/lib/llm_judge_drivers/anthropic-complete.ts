// tests/e2e/lib/llm_judge_drivers/anthropic-complete.ts — evidence-mode transport of the `anthropic`
// backend (spec 0290 R13, R15, R33).
//
// Same wire as anthropic.ts (Messages API, `x-api-key`), but returning the model's raw text so the
// skill-evals judge can read an `EVIDENCE=` line. anthropic.ts itself is not modified (spec 0290
// delta-01 R15 bars changes to the existing drivers): this module reuses its preflight and its
// exported POST helper, and is resolved only by `evidenceDriverFor`, never by `driverFor`.

import { dig, parseJson, str } from "../llm_judge.ts";
import type { Ctx, Driver } from "../llm_judge.ts";
import { anthropicDriver, postWithRetry } from "./anthropic.ts";

async function complete(
  ctx: Ctx,
  token: string,
  message: string,
  maxTokens: number,
): Promise<string | undefined> {
  if (ctx.mock) return ctx.deps.env["E2E_JUDGE_MOCK_RESPONSE"] ?? "";
  const body = JSON.stringify({
    model: ctx.cfg.model,
    max_tokens: maxTokens,
    temperature: ctx.cfg.temperature,
    messages: [{ role: "user", content: message }],
  });
  const raw = await postWithRetry(
    ctx,
    ctx.cfg.endpoint,
    { "x-api-key": token, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body,
  );
  if (raw === undefined) return undefined;
  return str(dig(parseJson(raw), "content", 0, "text"));
}

export const anthropicCompleteDriver: Driver = {
  preflight: anthropicDriver.preflight,
  call: anthropicDriver.call,
  complete,
};
