// steps-rules.ts — the rules steps of the setup flow (spec 0256, plan v2 step B3b.1):
// `rules-existing` (keep or refresh the context files already in place), `rules-shared` (the shared
// configuration, the store and the validation backend) and `rules-selection` (steps-rules-pick.ts).
// One body per step, data-driven from `descriptor.rules` and `descriptor.homes`; the four shells'
// blocks (Claude 94-153, Gemini 91-156, Copilot 109-215, Antigravity 95-157) differ only by data.
//
// Data contract (T8 fills the descriptors):
// - `homes.rulesDir` and `homes.cliHome` are relative to `ctx.home`; `RuleFile.src` is relative to
//   `ctx.repoDir`; `RuleFile.dest` is relative to `ctx.home/<homes.rulesDir>`, EXCEPT the store,
//   whose `dest` is relative to `ctx.home` (`.crewrig/system-context`).
// - `rules.shared` lists EVERY shared entry in the shell's order, the store (an entry whose `src`
//   equals `rules.store.src`, placed with `installDir`) and, for Copilot (`profile.mode ===
//   'direct'`), the profile at its own position included. An entry with `optional` is skipped when
//   its `src` is missing (the `66` org rules). A store absent from `shared` is placed after the
//   last entry. The validation backend and its blank line always follow the list.
// - `rules.sharedHeader` is the line printed first; the token `{dir}` stands for the absolute
//   rules directory (Copilot: `Installing shared layered context to {dir} ...`).
// - `rules.selections[kind]`: `src` is the catalogue DIRECTORY (`config/teams`), `dest` the file in
//   the rules dir (`50-team.md`), `label` a template where `{name}` is the chosen entry
//   (`teams/{name}.md -> rules/50-team.md`). The marker is `<homes.cliHome>/.selected_<kind>`.
// - `rules.profile.file`: `src` `config/PROFILE.md`, `dest` the profile file name, `label` the
//   `Copied:` label of the plain install (the overwrite adds ` (backup saved as .ori)`).
// - `rules.texts` keys, all verbatim from the shell: `existingFound` (`Existing rule files found
//   in`; the dir and `:` are appended), `actionHeader` (the `rules-action` question),
//   `keptMessage` and `removedMessage` (the two lines after keep / refresh).

import fs from "node:fs";
import path from "node:path";

import { installDir, installFile } from "./files.ts";
import type { RuleFile, StepEnv, StepFn, StepRegistry } from "./descriptor.ts";
import { filesCtx, rulesSelection } from "./steps-rules-pick.ts";
import { failClosed } from "./steps.ts";
import { configureValidationBackend } from "./validation-backend.ts";

/** The text `key` of the descriptor; a missing key is a descriptor bug, never a silent default. */
export function ruleText({ descriptor }: StepEnv, key: string): string {
  const text = descriptor.rules.texts[key];
  if (text === undefined) throw new Error(`descriptor.rules.texts.${key} is missing`);
  return text;
}

/** The regular-expression form of the simple globs of `rules.existingGlob` (`*`, `[0-9]`, literals). */
function globRegExp(glob: string): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i);
    if (c === "*") source += ".*";
    else if (c === "[" && glob.indexOf("]", i) > i) {
      const end = glob.indexOf("]", i);
      source += glob.slice(i, end + 1);
      i = end;
    } else source += c.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, "s");
}

/**
 * `find "$DIR" -maxdepth 1 \( -type f -o -type l \) -name "<glob>"`: the base names, in directory
 * order. A directory that is itself a link lists nothing (`find` does not follow a starting link).
 */
export function listExisting(dir: string, glob: string): string[] {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(dir);
  } catch {
    return [];
  }
  if (!stat.isDirectory()) return [];
  const pattern = globRegExp(glob);
  return fs.readdirSync(dir).filter((name) => {
    if (!pattern.test(name)) return false;
    try {
      const entry = fs.lstatSync(path.join(dir, name));
      return entry.isFile() || entry.isSymbolicLink();
    } catch {
      return false;
    }
  });
}

const rulesExisting: StepFn = async (env) => {
  const { ctx, descriptor, session, state } = env;
  const { rules, homes } = descriptor;
  const dir = path.join(ctx.home, homes.rulesDir);
  if (rules.mkdirInExisting === true) {
    failClosed(ctx.io, `cannot create ${dir}`, () => fs.mkdirSync(dir, { recursive: true }));
  }
  const existing = listExisting(dir, rules.existingGlob);
  if (existing.length === 0) return;
  ctx.io.out(`${ruleText(env, "existingFound")} ${dir}:`);
  for (const name of existing) ctx.io.out(`   - ${name}`);
  ctx.io.out("");
  const action = await session.choose({
    id: "rules-action",
    header: ruleText(env, "actionHeader"),
    options: ["keep", "refresh"],
    cancel: "abort",
  });
  if (action === "keep") {
    state.skipRules = true;
    ctx.io.out(ruleText(env, "keptMessage"));
    ctx.io.out("");
  } else if (action === "refresh") {
    for (const name of existing) {
      failClosed(ctx.io, `cannot remove ${path.join(dir, name)}`, () =>
        fs.rmSync(path.join(dir, name), { force: true }),
      );
    }
    ctx.io.out(ruleText(env, "removedMessage"));
    ctx.io.out("");
  }
};

function placeShared(env: StepEnv, rule: RuleFile, isStore: boolean): void {
  const { ctx, descriptor } = env;
  const src = path.join(ctx.repoDir, rule.src);
  if (isStore) {
    installDir(filesCtx(env), src, path.join(ctx.home, rule.dest), rule.label);
    return;
  }
  const dest = path.join(ctx.home, descriptor.homes.rulesDir, rule.dest);
  installFile(filesCtx(env), src, dest, rule.label);
}

const rulesShared: StepFn = async (env) => {
  const { ctx, descriptor, session, state } = env;
  if (state.skipRules) return;
  const { rules, homes } = descriptor;
  const dir = path.join(ctx.home, homes.rulesDir);
  ctx.io.out(rules.sharedHeader.replaceAll("{dir}", dir));
  let storePlaced = false;
  for (const rule of rules.shared) {
    if (rule.optional === true && !fs.existsSync(path.join(ctx.repoDir, rule.src))) continue;
    const isStore = rule.src === rules.store.src;
    placeShared(env, rule, isStore);
    storePlaced = storePlaced || isStore;
  }
  if (!storePlaced) placeShared(env, rules.store, true);
  await configureValidationBackend({ ctx, session });
  ctx.io.out("");
};

export const rulesSteps: StepRegistry = {
  "rules-existing": rulesExisting,
  "rules-shared": rulesShared,
  "rules-selection": rulesSelection,
};
