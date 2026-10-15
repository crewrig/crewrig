// placeholders.ts — the placeholder set and the survivor check (spec 0258 R23).
// Twin of create-extension.sh :92-97 and :188-211: the set is derived by scanning
// `extension-skeleton/` for every `${SKELETON_*}` token, so a later addition to the family needs
// no change here; after every merge, a token surviving in a text file of the produced tree
// removes the partly written target and fails.

import fs from "node:fs";

import type { Io } from "../extension/types.ts";
import { listFiles, readTextCarrying } from "./files.ts";

const TOKEN = /\$\{SKELETON_[A-Za-z0-9_]*\}/g;

/** Every distinct token in the skeleton's text files, in byte order (`sort -u` under `LC_ALL=C`). */
export function placeholderTokens(skeletonDir: string): string[] {
  const tokens = new Set<string>();
  for (const file of listFiles(skeletonDir)) {
    const text = readTextCarrying(file);
    if (text === null) continue;
    for (const match of text.matchAll(TOKEN)) tokens.add(match[0]);
  }
  return [...tokens].sort();
}

/** Report each survivor on standard error; on any, remove `target` and return `false`. */
export function assertNoSurvivors(target: string, tokens: readonly string[], io: Io): boolean {
  const files = listFiles(target);
  let survivors = 0;
  for (const token of tokens) {
    for (const file of files) {
      const text = readTextCarrying(file);
      if (text !== null && text.includes(token)) {
        io.err(`Error: placeholder ${token} survives in ${file}`);
        survivors += 1;
      }
    }
  }
  if (survivors === 0) return true;
  io.err(
    `Error: ${survivors} placeholder occurrence(s) survived substitution; removing the partly-written ${target}.`,
  );
  fs.rmSync(target, { recursive: true, force: true });
  return false;
}
