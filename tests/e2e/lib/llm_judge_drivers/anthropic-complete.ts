// tests/e2e/lib/llm_judge_drivers/anthropic-complete.ts — evidence-mode transport of the `anthropic`
// backend (spec 0290 R13, R15, R33).
//
// Same wire as anthropic.ts (Messages API, `x-api-key`), but returning the model's raw text so the
// skill-evals judge can read an `EVIDENCE=` line. anthropic.ts itself is not modified (spec 0290
// delta-01 R15 bars changes to the existing drivers): this module reuses its preflight and its
// exported POST helper, and is resolved only by `evidenceDriverFor`, never by `driverFor`.

import { dig, parseJson, str } from "../llm_judge.ts";
import type { Ctx, Driver, EvidenceCompletion } from "../llm_judge.ts";
import { anthropicDriver, postWithRetry } from "./anthropic.ts";

async function complete(
  ctx: Ctx,
  token: string,
  message: string,
  maxTokens: number,
): Promise<EvidenceCompletion | undefined> {
  if (ctx.mock) return { text: ctx.deps.env["E2E_JUDGE_MOCK_RESPONSE"] ?? "" };
  const body = JSON.stringify({
    model: ctx.cfg.model,
    max_tokens: maxTokens,
    temperature: ctx.cfg.temperature,
    messages: [{ role: "user", content: message }],
  });
  // Every HTTP attempt after the first (a retry) counts toward max_calls too (spec 0290 R23).
  let attempts = 0;
  const doFetch = ctx.deps.fetch ?? fetch;
  const counted: Ctx = {
    ...ctx,
    deps: {
      ...ctx.deps,
      fetch: ((...args: Parameters<typeof fetch>) => {
        if (++attempts > 1) ctx.bump();
        return doFetch(...args);
      }) as typeof fetch,
    },
  };
  const raw = await postWithRetry(
    counted,
    ctx.cfg.endpoint,
    { "x-api-key": token, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body,
  );
  if (raw === undefined) return undefined;
  const text = str(dig(parseJson(raw), "content", 0, "text"));
  return text === undefined ? undefined : { text };
}

export const anthropicCompleteDriver: Driver = {
  preflight: anthropicDriver.preflight,
  call: anthropicDriver.call,
  complete,
};
