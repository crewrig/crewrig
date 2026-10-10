// mempalace-install-offer.ts — offer to install MemPalace through pipx (spec 0256 requirement 25 and
// deviation (q) of delta-01). The TypeScript twin of `offer_mempalace_install` in
// scripts/lib/common.sh: the same lines, the same question, the same `pipx install` argument. The
// supported range comes from `readMempalacePin` (the shell variables of common.sh, read, never
// declared a second time). The call sites ignore the result (`offer_mempalace_install || true`) and
// detect again afterwards; the boolean is returned for the tests and for the flow's own logging.

import { findOnPath } from "../mempalace-python.ts";
import { installSpec, readMempalacePin } from "../mempalace-pin.ts";
import type { MempalacePin } from "../mempalace-pin.ts";
import type { InstallCtx, Spawner } from "./context.ts";
import type { PromptSession } from "./prompt.ts";

/** The part of the setup context the offer uses. */
export type OfferCtx = Pick<InstallCtx, "io" | "env" | "platform" | "repoDir">;

export const MEMPALACE_INSTALL_QUESTION_ID = "mempalace-install";

/** Machine seams, injected by tests. */
export interface OfferDeps {
  readonly pin?: (repoDir: string) => MempalacePin;
}

/** The question header, with the range spelled as the shell spells it. */
export function installQuestionHeader(pin: MempalacePin): string {
  return `MemPalace not found — install via pipx now? (mempalace>=${pin.min},<${pin.maxExclusive})`;
}

/** The `pipx` guidance; the last line is the one that differs on Windows (deviation (q)). */
function missingPipxLines(pin: MempalacePin, platform: NodeJS.Platform): string[] {
  return [
    "  pipx not found — install MemPalace manually:",
    `    pipx install '${installSpec(pin)}'`,
    platform === "win32"
      ? "  Install pipx: scoop install pipx or py -m pip install --user pipx"
      : "  Install pipx: brew install pipx (macOS) or python3 -m pip install --user pipx",
  ];
}

/** Ask, and on consent run `pipx install`; true only when MemPalace was installed by this call. */
export async function offerMempalaceInstall(args: {
  ctx: OfferCtx;
  session: PromptSession;
  spawn: Spawner;
  deps?: OfferDeps;
}): Promise<boolean> {
  const { ctx, session, spawn } = args;
  const { io } = ctx;
  const pin = (args.deps?.pin ?? readMempalacePin)(ctx.repoDir);

  if (findOnPath("pipx", ctx.env, { platform: ctx.platform }) === undefined) {
    for (const line of missingPipxLines(pin, ctx.platform)) io.out(line);
    return false;
  }
  const choice = await session.choose({
    id: MEMPALACE_INSTALL_QUESTION_ID,
    header: installQuestionHeader(pin),
    options: ["no", "yes"],
    cancel: "decline",
  });
  if (choice !== "yes") {
    io.out("  MemPalace install skipped.");
    return false;
  }
  const installed = spawn(["pipx", "install", installSpec(pin)], { inherit: true });
  if (installed.status !== 0) {
    io.out("  pipx install failed — install MemPalace manually then re-run this script.");
    return false;
  }
  io.out("  MemPalace installed.");
  return true;
}
