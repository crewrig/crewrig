// profile.ts — the capability-profile reader and the declaration predicates.
//
// Twins of model-resolve.sh `profile_read` (:737), `profile_declares_item` (:809),
// `profile_declares_axis` (:834), `_axis_declared_value` (:847), `_dotted_path`
// (:859) and `_declared_value_of` (:868). Spec 0198 R1 (declaration half).
// R2 (spec 0250): this slice moved only because the step (b) build depends on it,
// not as precedent for the other consumers of the library.
//
// The shell piped the frontmatter into `yq` once per field (about twenty calls);
// here it is parsed once. Every `yq -r` read is the plain scalar text of
// scripts/lib/yaml-text.ts (R11): the characters written, trailing line feeds
// removed. `extractFrontmatter` is injected (see ExtractFrontmatter in types.ts).

import type { YamlDoc, YamlText } from "../yaml-text.ts";
import type { Axis, AxisValue, ExtractFrontmatter, Profile } from "./types.ts";

const NONE: AxisValue = { has: false, value: "" };

/** The `PROFILE_PRESENT=false` reset every call of `profile_read` starts from. */
export const EMPTY_PROFILE: Profile = {
  present: false,
  intelligence: NONE,
  axes: {
    reasoning: NONE,
    specialization: NONE,
    context: NONE,
    speed: NONE,
    modalities: NONE,
    locality: NONE,
  },
  tuning: [],
};

/** The six axes in the order rule (b) walks them (model-resolve.sh:1341). */
export const AXES: readonly Axis[] = [
  "reasoning",
  "specialization",
  "context",
  "speed",
  "modalities",
  "locality",
];

function readFrontmatter(extract: ExtractFrontmatter, source: string): string {
  try {
    return extract(source);
  } catch {
    // An unreadable source has no frontmatter, as `awk` on a missing file printed nothing.
    return "";
  }
}

function readAxis(yaml: YamlText, doc: YamlDoc | null, axis: string): AxisValue {
  const path = ["metadata", "model", axis];
  if (!yaml.has(doc, path)) return NONE;
  // modalities: `.metadata.model.modalities[]?` joined with spaces.
  const value = axis === "modalities" ? yaml.seq(doc, path).join(" ") : yaml.plain(doc, path);
  return { has: true, value };
}

/**
 * `profile_read`: `metadata.model` of an agent source's frontmatter. `present` is
 * false (and every axis empty) for a profile-less source: the fast path
 * requirement 26 of spec 0198 rests on.
 */
export function profileRead(yaml: YamlText, extract: ExtractFrontmatter, source: string): Profile {
  const doc = yaml.parse(`${readFrontmatter(extract, source)}\n`);
  if (!yaml.has(doc, ["metadata", "model"])) return EMPTY_PROFILE;

  const tuning: Array<readonly [string, string]> = [];
  if (yaml.has(doc, ["metadata", "model", "tuning"])) {
    for (const entry of yaml.entries(doc, ["metadata", "model", "tuning"])) {
      if (entry.key === "") continue;
      tuning.push([entry.key, yaml.plain(doc, ["metadata", "model", "tuning", entry.key])]);
    }
  }
  return {
    present: true,
    intelligence: readAxis(yaml, doc, "intelligence"),
    axes: {
      reasoning: readAxis(yaml, doc, "reasoning"),
      specialization: readAxis(yaml, doc, "specialization"),
      context: readAxis(yaml, doc, "context"),
      speed: readAxis(yaml, doc, "speed"),
      modalities: readAxis(yaml, doc, "modalities"),
      locality: readAxis(yaml, doc, "locality"),
    },
    tuning,
  };
}

/** `profile_declares_item`: `model` is the intelligence axis, `reasoning` itself, any other a tuning knob. */
export function profileDeclaresItem(profile: Profile, item: string): boolean {
  if (item === "model") return profile.intelligence.has;
  if (item === "reasoning") return profile.axes.reasoning.has;
  return profile.tuning.some(([key]) => key === item);
}

/** `profile_declares_axis`: one of the six selection axes other than intelligence. */
export function profileDeclaresAxis(profile: Profile, axis: string): boolean {
  const found = AXES.find((candidate) => candidate === axis);
  return found !== undefined && profile.axes[found].has;
}

/** `_axis_declared_value`: the declared text; modalities render as `[a,b]`. */
export function axisDeclaredValue(profile: Profile, axis: Axis): string {
  const { value } = profile.axes[axis];
  return axis === "modalities" ? `[${value.replace(/ /g, ",")}]` : value;
}

/** `_dotted_path`: the profile path a drop record names. */
export function dottedPath(item: string): string {
  if (item === "model") return "metadata.model.intelligence";
  if (item === "reasoning") return "metadata.model.reasoning";
  return `metadata.model.tuning.${item}`;
}

/** `_declared_value_of`: the declared text of an item; the first tuning key of that name wins. */
export function declaredValueOf(profile: Profile, item: string): string {
  if (item === "model") return profile.intelligence.value;
  if (item === "reasoning") return profile.axes.reasoning.value;
  return profile.tuning.find(([key]) => key === item)?.[1] ?? "";
}
