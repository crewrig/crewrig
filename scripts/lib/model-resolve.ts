// model-resolve.ts — spec 0198 build-time resolution of capability profiles against
// per-CLI model mappings, and the spec 0199 organisation override merge: the
// TypeScript twin of the closure of `resolve_agent` in scripts/lib/model-resolve.sh
// (spec 0250 R19, R20).
//
// Twins of model-resolve.sh `resolve_agent` (:1306), `mapping_in_force` (:77) and
// `mapping_merge_cleanup` (:506); the other 47 functions are twinned in
// scripts/lib/model-resolve/ (ladders, merge-root, merge-tree, merge-ops,
// merge-mapping, mapping-access, profile, narrowing, diagnostics, resolve-item,
// guidance). All 50 functions of the shell library are reachable from
// `resolve_agent` or `mapping_merge_cleanup`, so no accessor stays behind.
//
// R2 (spec 0250): this slice of the shell library moved only because the step (b)
// build depends on it; its other consumers (scripts/check-model-mappings.sh and the
// Bash suites) are later rows, and this is not a precedent for them. The shell
// library stays whole and byte-identical apart from comments (R23); a change to
// either implementation must be made in both (conformance test, R21).
//
// `resolveAgent` never throws and writes no file but the merge files of R20. The
// shell's globals (RESOLVED_*, EMIT_*, DIAG_LINES, IT_*, PROF_*, OFF_*) and its
// dynamically scoped CANDIDATES live in one `ResolveState` per call. YAML arrives
// through the injected `YamlText` (scripts/lib/yaml-text.ts) and nothing here imports
// `js-yaml` (R24); `extractFrontmatter` is injected too (see ExtractFrontmatter).

import os from "node:os";

import { diagDrop, diagNote } from "./model-resolve/diagnostics.ts";
import {
  bashInteger,
  INTELLIGENCE_RUNGS,
  ITEM_VOCAB_ORDER,
  itemIdx,
  rungIndex,
} from "./model-resolve/ladders.ts";
import {
  frontmatterItemOrder,
  guardState,
  itemKey,
  itemOrder,
  offeringsLoad,
  surfaceOfKind,
  words,
} from "./model-resolve/mapping-access.ts";
import { loadMapping } from "./model-resolve/yaml-nodes.ts";
import { mappingInForce } from "./model-resolve/merge-mapping.ts";
import { mappingMergeCleanup } from "./model-resolve/merge-root.ts";
import {
  narrowAxis,
  narrowEncodedReasoning,
  predContext,
  predLocality,
  predModalities,
  predSpecialization,
  predSpeed,
} from "./model-resolve/narrowing.ts";
import { renderGuidance } from "./model-resolve/guidance.ts";
import {
  AXES,
  axisDeclaredValue,
  EMPTY_PROFILE,
  profileDeclaresAxis,
  profileRead,
} from "./model-resolve/profile.ts";
import { resolveItem } from "./model-resolve/resolve-item.ts";
import type { ItemScope } from "./model-resolve/resolve-item.ts";
import type { ResolveContext, ResolveResult, ResolveState } from "./model-resolve/types.ts";

export { mappingInForce, mappingMergeCleanup };
export type {
  Env,
  ExtractFrontmatter,
  Offering,
  Profile,
  ResolveContext,
  ResolveResult,
} from "./model-resolve/types.ts";

/** Build a context from the running process; every field may be overridden (tests, the entry). */
export function createResolveContext(
  base: Pick<ResolveContext, "repoDir" | "yaml" | "extractFrontmatter"> & Partial<ResolveContext>,
): ResolveContext {
  return {
    env: process.env,
    platform: process.platform,
    pid: process.pid,
    uid: process.platform === "win32" ? undefined : process.geteuid?.(),
    tmpdir: os.tmpdir(),
    stderr: (line) => void process.stderr.write(`${line}\n`),
    ...base,
  };
}

function freshState(): ResolveState {
  const flags = (): boolean[] => ITEM_VOCAB_ORDER.map(() => false);
  return {
    offeringId: "",
    nativeValue: "",
    offeringSrs: "false",
    fmLines: [],
    prose: "",
    diag: [],
    disposed: flags(),
    directed: flags(),
    fm: flags(),
    gd: flags(),
    value: ITEM_VOCAB_ORDER.map(() => ""),
    profile: EMPTY_PROFILE,
    offerings: [],
    candidates: [],
  };
}

/** Rule (c), R8: the floor candidate set, else the ceiling clause. */
function selectByIntelligence(state: ResolveState): void {
  const declared = rungIndex(INTELLIGENCE_RUNGS, state.profile.intelligence.value);
  if (declared === 0) return;
  const rungs = state.offerings.map((o) => rungIndex(INTELLIGENCE_RUNGS, o.intelligence));
  rungs.forEach((idx, i) => {
    if (idx !== 0 && idx >= declared) state.candidates.push(i);
  });
  if (state.candidates.length > 0) return;
  const ceiling = Math.max(0, ...rungs);
  if (ceiling > 0) rungs.forEach((idx, i) => idx === ceiling && state.candidates.push(i));
}

/** Rule (f), R12: lowest rank wins; a rank that is no shell integer never compares less. */
function selectLowestRank(state: ResolveState): void {
  let bestRank = "";
  let best = -1;
  for (const i of state.candidates) {
    const rank = state.offerings[i].rank;
    const [a, b] = [bashInteger(rank), bashInteger(bestRank)];
    if (bestRank === "" || (a !== null && b !== null && a < b)) {
      bestRank = rank;
      best = i;
    }
  }
  const chosen = state.offerings[best];
  if (chosen === undefined) return;
  state.offeringId = chosen.id;
  state.nativeValue = chosen.native;
  state.offeringSrs = chosen.supportsReasoningSurface;
}

function resolve(
  ctx: ResolveContext,
  state: ResolveState,
  agent: string,
  source: string,
  target: string,
): void {
  const { yaml } = ctx;
  state.profile = profileRead(yaml, ctx.extractFrontmatter, source);
  if (!state.profile.present) return;

  const handle = mappingInForce(ctx, target);
  if (handle === "") {
    diagNote(state, agent, target, "no-mapping", `no mapping file is present for target ${target}`);
    return;
  }
  const doc = loadMapping(yaml, handle);
  // Loaded unconditionally: D2's model-expressibility reading needs the offering count.
  state.offerings = offeringsLoad(yaml, doc);

  const { profile } = state;
  if (!profile.intelligence.has) {
    // Rule (b), R7: no model selected; every OTHER declared axis is dropped unserved-value;
    // reasoning is also disposed so (g)(0)(ii) stops it before (g)(4) (D13).
    for (const axis of AXES) {
      if (!profileDeclaresAxis(profile, axis)) continue;
      diagDrop(
        state,
        agent,
        target,
        `metadata.model.${axis}`,
        axisDeclaredValue(profile, axis),
        "unserved-value",
      );
      if (axis === "reasoning") state.disposed[itemIdx("reasoning")] = true;
    }
  } else {
    selectByIntelligence(state);
    if (state.candidates.length > 0) {
      // Rule (d), R9/R10: context, modalities, locality, specialization, speed, in order.
      const a = profile.axes;
      narrowAxis(state, agent, target, "context", a.context.value, predContext, a.context.has);
      narrowAxis(
        state,
        agent,
        target,
        "modalities",
        a.modalities.value,
        predModalities,
        a.modalities.has,
        axisDeclaredValue(profile, "modalities"),
      );
      narrowAxis(state, agent, target, "locality", a.locality.value, predLocality, a.locality.has);
      narrowAxis(
        state,
        agent,
        target,
        "specialization",
        a.specialization.value,
        predSpecialization,
        a.specialization.has,
      );
      narrowAxis(state, agent, target, "speed", a.speed.value, predSpeed, a.speed.has);
    }
    // Rule (e), R11/R22: encoded-reasoning narrowing. Directs, never drops.
    if (profile.axes.reasoning.has && state.candidates.length > 0)
      narrowEncodedReasoning(state, agent, target);
    // An empty candidate set (D17) selects nothing and records nothing at this step.
    if (state.candidates.length > 0) selectLowestRank(state);
  }

  // Rule (g): the per-item gate in the mapping's own declared item order.
  const fmAddr = surfaceOfKind(yaml, doc, "frontmatter");
  const gdAddr = surfaceOfKind(yaml, doc, "guidance");
  const scope: ItemScope = {
    yaml,
    doc,
    agent,
    target,
    fmAddr,
    gdAddr,
    guardState: guardState(yaml, doc),
  };
  for (const item of itemOrder(yaml, doc)) resolveItem(scope, state, item);

  // The directed frontmatter lines in the mapping's declared frontmatter item order (D8).
  for (const item of words(frontmatterItemOrder(yaml, doc, fmAddr))) {
    const idx = itemIdx(item);
    if (idx < 0 || !state.fm[idx]) continue;
    const key = itemKey(yaml, doc, fmAddr, item);
    if (key !== "") state.fmLines.push(`${key}: ${state.value[idx]}`);
  }
  renderGuidance(yaml, state, doc, agent, target, gdAddr);
}

/**
 * `resolve_agent`: the single mapping lookup (R2) and the total first-match-wins rule
 * order, ending in step 8's rendering rule. Never throws (R4, R19): an unexpected
 * internal failure reads as a source with no profile. `ctx.stderr` receives the
 * `mapping-merge*` lines of the override merge (R20), nothing else.
 */
export function resolveAgent(
  ctx: ResolveContext,
  agent: string,
  source: string,
  target: string,
): ResolveResult {
  let state = freshState();
  try {
    resolve(ctx, state, agent, source, target);
  } catch {
    state = freshState();
  }
  return {
    offeringId: state.offeringId,
    nativeValue: state.nativeValue,
    fmLines: state.fmLines,
    prose: state.prose,
    diagLines: state.diag,
  };
}
