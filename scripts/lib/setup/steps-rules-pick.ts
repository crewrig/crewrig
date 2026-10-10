// steps-rules-pick.ts — the `rules-selection` step (shell: Claude 309-371, Gemini 268-329, Copilot
// 177-214, Antigravity 292-353): the three catalogue picks in `descriptor.rules.pickOrder`, their
// `.selected_<kind>` markers, then the profile. The data contract is documented in steps-rules.ts.

import fs from "node:fs";
import path from "node:path";

import type { PickKind, StepEnv, StepFn } from "./descriptor.ts";
import { pickCatalogueEntry } from "./catalogue.ts";
import { installFile } from "./files.ts";
import type { FilesCtx } from "./files.ts";
import { failClosed } from "./steps.ts";

/** A ctx whose placements are collected into `state.outcomes` (one link-fallback notice per run). */
export function filesCtx({ ctx, state }: StepEnv): FilesCtx {
  return { ...ctx, outcomes: state.outcomes };
}

const TITLES: Readonly<Record<PickKind, string>> = {
  team: "Select your team:",
  expertise: "Select your expertise:",
  level: "Select your experience level:",
};
const NAMES: Readonly<Record<PickKind, string>> = {
  team: "Team",
  expertise: "Expertise",
  level: "Level",
};

async function pick(env: StepEnv, kind: PickKind): Promise<void> {
  const { ctx, descriptor, session } = env;
  const { rules, homes } = descriptor;
  const selection = rules.selections[kind];
  const marker = path.join(ctx.home, homes.cliHome, `.selected_${kind}`);
  ctx.io.out(TITLES[kind]);
  const name = await pickCatalogueEntry(session, {
    id: `catalogue.${kind}`,
    dir: path.join(ctx.repoDir, selection.src),
    label: kind,
    io: ctx.io,
  });
  if (name === undefined || name === "") {
    failClosed(ctx.io, `cannot remove ${marker}`, () => fs.rmSync(marker, { force: true }));
  } else {
    installFile(
      filesCtx(env),
      path.join(ctx.repoDir, selection.src, `${name}.md`),
      path.join(ctx.home, homes.rulesDir, selection.dest),
      selection.label.replaceAll("{name}", name),
    );
    failClosed(ctx.io, `cannot write ${marker}`, () => fs.writeFileSync(marker, `${name}\n`));
    ctx.io.out(`${NAMES[kind]}: ${name}`);
  }
  ctx.io.out("");
}

function sameBytes(a: string, b: string): boolean {
  try {
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
}

/** `[ ! -e T ]` install; `! diff -q` ask `profile-method`; else `Profile is up to date.`. */
async function resolveProfile(env: StepEnv): Promise<void> {
  const { ctx, descriptor, session } = env;
  const { file } = descriptor.rules.profile;
  const src = path.join(ctx.repoDir, file.src);
  const target = path.join(ctx.home, descriptor.homes.rulesDir, file.dest);
  if (!fs.existsSync(target)) {
    ctx.io.out("Setting up personal profile...");
    installFile(filesCtx(env), src, target, file.label);
  } else if (!sameBytes(src, target)) {
    ctx.io.out("Local profile differs from repository version.");
    const method = await session.choose({
      id: "profile-method",
      header: "How to resolve?",
      options: ["keep-local", "overwrite"],
      cancel: "abort",
    });
    if (method === "overwrite") {
      failClosed(ctx.io, `cannot move ${target}`, () => fs.renameSync(target, `${target}.ori`));
      installFile(filesCtx(env), src, target, `${file.label} (backup saved as .ori)`);
    } else if (method === "keep-local") {
      ctx.io.out("Keeping local profile.");
    }
  } else {
    ctx.io.out("Profile is up to date.");
  }
}

export const rulesSelection: StepFn = async (env) => {
  if (env.state.skipRules) return;
  for (const kind of env.descriptor.rules.pickOrder) await pick(env, kind);
  // Copilot (`direct`) installed the profile inside `rules-shared`, at its own position.
  if (env.descriptor.rules.profile.mode === "method") await resolveProfile(env);
};
