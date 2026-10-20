// spec-view.ts — the read-only effective view of a spec (spec 0273): a header,
// the base body byte-for-byte, then one verbatim `Delta NN` section per delta.
// It parses no quote, marks nothing and resolves nothing: the delta-spec
// cumulative rule alone decides what prevails, and the view is never normative.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export type ViewResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: string };

interface Parsed {
  readonly id: string;
  readonly version: string;
  readonly body: string;
}

const BASE_RE = /^(\d{4})-.+\.md$/;
const DELTA_RE = /^(\d{4})-.+\.delta-(\d{2})\.md$/;
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function field(frontmatter: string, key: string): string {
  const m = new RegExp(`^${key}:\\s*(.*?)\\s*$`, "m").exec(frontmatter);
  return m ? m[1].replace(/^["']|["']$/g, "") : "";
}

function parse(text: string): Parsed {
  const m = FM_RE.exec(text);
  if (!m) return { id: "", version: "", body: text };
  return {
    id: field(m[1], "id"),
    version: field(m[1], "version"),
    body: text.slice(m[0].length),
  };
}

/** Normalise `273` and `0273` to `0273`; null when the argument is not a spec id. */
export function normaliseId(arg: string): string | null {
  return /^\d{1,4}$/.test(arg) ? arg.padStart(4, "0") : null;
}

export function renderView(root: string, idArg: string): ViewResult {
  const id = normaliseId(idArg);
  const label = idArg || "(none)";
  if (id === null) return { ok: false, error: `spec-view: no spec found for id ${label}` };
  const dir = path.join(root, "specs");
  let names: string[];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return { ok: false, error: `spec-view: no spec found for id ${label}` };
  }
  const baseName = names.find((n) => BASE_RE.exec(n)?.[1] === id && !DELTA_RE.test(n));
  if (baseName === undefined)
    return { ok: false, error: `spec-view: no spec found for id ${label}` };
  const base = parse(readFileSync(path.join(dir, baseName), "utf8"));

  const deltas: { readonly n: string; readonly name: string; readonly parsed: Parsed }[] = [];
  for (const name of names) {
    const m = DELTA_RE.exec(name);
    if (!m) continue;
    const parsed = parse(readFileSync(path.join(dir, name), "utf8"));
    if (parsed.id === id) deltas.push({ n: m[2], name, parsed });
  }
  deltas.sort((a, b) => a.n.localeCompare(b.n));

  const version = deltas.length > 0 ? deltas[deltas.length - 1].parsed.version : base.version;
  const lines = [
    `# Effective view of spec ${id}`,
    "",
    `- Base file: specs/${baseName}`,
    deltas.length === 0
      ? "- Deltas: none (this spec has no deltas)"
      : `- Deltas, in the order applied: ${deltas.map((d) => `specs/${d.name}`).join(", ")}`,
    `- Cumulative version: ${version}`,
    "",
    "Read-only presentation, never normative: read the base body, then each delta section in order; the later delta prevails per the delta-spec cumulative rule.",
    "",
    "---",
    "",
  ];
  let text = lines.join("\n") + base.body;
  for (const d of deltas) {
    text += `${text.endsWith("\n") ? "" : "\n"}\n---\n\n## Delta ${d.n}\n\n${d.parsed.body}`;
  }
  return { ok: true, text };
}
