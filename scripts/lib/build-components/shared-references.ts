// shared-references.ts — place the shared reference files a skill cites into its built
// output (spec 0293 R11; plan v2 step 4).
//
// The text that many skills repeat lives once, under `artifacts/core/shared/references/`.
// A skill cites a topic from its body as `references/shared-<topic>.md`; the build writes a
// byte-identical copy of `<topic>.md` at that path in every built output of the skill, so an
// installed skill stays a self-contained directory. A topic the body does not cite gets no
// copy, and a copy that is no longer cited is drift (removed on a write build).
//
// Failures (status 1, in both write and check mode): a skill source that holds a
// `shared-`-prefixed reference of its own (the prefix is reserved), and a cited topic with
// no source file. The copy is raw bytes: no link rewrite and no provenance strip.
//
// Usage: propagateSharedReferences(ctx, skillDir, source.body, outDir, outRoot).
// Exit codes: not applicable (library). Finding-line format: `DRIFT:` lines, as write.ts.

import fs from "node:fs";
import path from "node:path";

import { citations, sharedTopic } from "../skill-citations/grammar.ts";
import { joinRoot } from "./args.ts";
import { escapeControl } from "./diagnostics.ts";
import { BuildFailure } from "./types.ts";
import type { Ctx } from "./types.ts";
import { assertInsideRoot, comparing, isRegularFile, reportDrift, sameBytes } from "./write.ts";

const SHARED_FILE = /^shared-.+\.md$/;

function sharedNames(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((n) => SHARED_FILE.test(n));
  } catch {
    return [];
  }
}

/** The shared topics a skill body cites, in first-citation order. */
export function citedTopics(body: string): string[] {
  const topics: string[] = [];
  for (const c of citations(body, false)) {
    const topic = sharedTopic(c.path);
    if (topic !== undefined && !topics.includes(topic)) topics.push(topic);
  }
  return topics;
}

export function propagateSharedReferences(
  ctx: Ctx,
  skillDir: string,
  body: string,
  outDir: string,
  outRoot: string,
): void {
  const own = sharedNames(path.join(skillDir, "references"));
  if (own.length > 0)
    throw new BuildFailure(
      `Error: ${escapeControl(skillDir)} holds references/${own[0]}, but the shared- prefix is reserved for shared references`,
    );
  const topics = citedTopics(body);
  for (const topic of topics) {
    const src = joinRoot(ctx.platform, ctx.artifactsDir, `core/shared/references/${topic}.md`);
    if (!isRegularFile(src))
      throw new BuildFailure(
        `Error: ${escapeControl(skillDir)} cites references/shared-${topic}.md, but ${escapeControl(src)} does not exist`,
      );
    const target = joinRoot(ctx.platform, outDir, `references/shared-${topic}.md`);
    assertInsideRoot(ctx, outRoot, target);
    const bytes = fs.readFileSync(src);
    if (comparing(ctx)) {
      if (!isRegularFile(target)) reportDrift(ctx, target, true);
      else if (!sameBytes(target, bytes)) reportDrift(ctx, target, false);
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    ctx.io.out(`  Generated: ${escapeControl(target)}`);
  }
  const wanted = new Set(topics.map((t) => `shared-${t}.md`));
  for (const name of sharedNames(joinRoot(ctx.platform, outDir, "references"))) {
    if (wanted.has(name)) continue;
    const orphan = joinRoot(ctx.platform, outDir, `references/${name}`);
    assertInsideRoot(ctx, outRoot, orphan);
    if (comparing(ctx)) {
      ctx.io.out(`DRIFT: ${escapeControl(orphan)} is a shared reference the skill no longer cites`);
      ctx.state.driftFound = true;
    } else {
      fs.rmSync(orphan, { force: true });
      ctx.io.out(`  Removed: ${escapeControl(orphan)}`);
    }
  }
}
