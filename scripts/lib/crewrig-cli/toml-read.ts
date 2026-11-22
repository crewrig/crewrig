// toml-read.ts — the content of `crewrig.config.toml` that the commands read (spec 0315 R4, spec 0314 R16):
// `canonical_repo` and `feedback_repo`, two string keys in TOML basic-string syntax, with comments and blank
// lines. Any other line shape is a defect: the reader is not a general TOML parser, and it does not echo the
// value it refuses (a rejected value cannot reach a message).

export interface OrgConfig {
  readonly canonicalRepo: string;
  readonly feedbackRepo: string;
}

export type ConfigReading =
  | { readonly ok: true; readonly config: OrgConfig }
  | { readonly ok: false; readonly reason: string };

const REQUIRED = ["canonical_repo", "feedback_repo"] as const;
const LINE = /^([A-Za-z0-9_-]+)[ \t]*=[ \t]*"((?:[^"\\]|\\[\\"])*)"[ \t]*(?:#.*)?$/;

export function readOrgConfig(text: string): ConfigReading {
  const values = new Map<string, string>();
  const lines = text.split("\n");
  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/\r$/, "").trim();
    if (line === "" || line.startsWith("#")) continue;
    const at = `line ${index + 1}`;
    const match = LINE.exec(line);
    if (match === null) return { ok: false, reason: `${at} is not a string key (key = "value")` };
    const key = match[1] ?? "";
    if (values.has(key)) return { ok: false, reason: `${at} repeats the key ${key}` };
    values.set(key, (match[2] ?? "").replace(/\\([\\"])/g, "$1"));
  }
  for (const key of REQUIRED) {
    if (values.get(key) === undefined || values.get(key) === "") {
      return { ok: false, reason: `has no string value for ${key}` };
    }
  }
  return {
    ok: true,
    config: {
      canonicalRepo: values.get("canonical_repo") ?? "",
      feedbackRepo: values.get("feedback_repo") ?? "",
    },
  };
}
