// pass-surfaces.ts — surfaces, their items and guidance templates
// (check-model-mappings.sh:591-708): A3, A15, A18, A19, A20a, A20b, A21, A27, A32 and
// the grounds of every surface item.

import { isYqFalsy, lengthOf, type YqNode } from "../yq-accessors/index.ts";
import { hasKey, strictGet, textOrEmpty, truthyTexts, unalias } from "./nodes.ts";
import { checkGrounds } from "./pass-grounds.ts";
import { checkClosedKeys, checkRequiredKeys } from "./pass-shape.ts";
import type { PassScope } from "./types.ts";
import { inList, ITEM_VOCAB } from "./vocab.ts";

const count = (n: YqNode): number => (isYqFalsy(unalias(n)) ? 0 : lengthOf(unalias(n)));

/** The sorted-unique, LF-joined, trailing-LF-stripped text a `sort -u` pipeline hands `$(...)`. */
function sortedUnique(values: string[]): string {
  const sorted = [...new Set(values)].sort((a, b) =>
    Buffer.compare(Buffer.from(a), Buffer.from(b)),
  );
  return sorted.join("\n").replace(/\n+$/, "");
}

/** More than one `{{` in one sentence, by the shell's awk splitting rule. */
function crowdedSentence(template: string): boolean {
  for (const line of template.split("\n")) {
    const marked = line
      .replace(/[.!?][ \t]/g, (m) => `${m}\x01`)
      .replace(/[.!?]$/, (m) => `${m}\x01`);
    for (const seg of marked.split("\x01")) {
      if ((seg.match(/\{\{/g) ?? []).length > 1) return true;
    }
  }
  return false;
}

function checkGuidanceTemplate(scope: PassScope, node: YqNode, sidx: number): void {
  const { file } = scope;
  const carries = strictGet(file, node, ["carries"]);
  const carriesCount = count(carries);
  const template = textOrEmpty(strictGet(file, node, ["template"]));
  const placeholders = sortedUnique(
    (template.match(/\{\{[a-zA-Z0-9_-]+\}\}/g) ?? []).map((p) => p.replace(/[{}]/g, "")),
  );
  if (placeholders !== sortedUnique(truthyTexts(carries))) {
    scope.fail(
      "A20a",
      `surfaces[${sidx}] guidance template placeholder set differs from its carries list`,
    );
  }
  if (carriesCount > 1 && crowdedSentence(template)) {
    scope.fail(
      "A20b",
      `surfaces[${sidx}] guidance template places more than one placeholder in one sentence while carries holds ${carriesCount} items`,
    );
  }
}

const SETS: Record<string, [string, string]> = {
  frontmatter: ["id kind items", "id kind items"],
  guidance: ["id kind carries template items", "id kind carries template items"],
  "out-of-band": ["id kind location items", "id kind location items"],
};
const OTHER: [string, string] = ["id kind", "id kind items carries template location"];

function checkItems(scope: PassScope, node: YqNode, kind: string, label: string): void {
  const { file, fail } = scope;
  const nit = count(strictGet(file, node, ["items"]));
  for (let j = 0; j < nit; j++) {
    const item = strictGet(file, node, ["items", String(j)]);
    const itlabel = `${label}.items[${j}]`;
    const it = textOrEmpty(strictGet(file, item, ["item"]));
    if (!inList(ITEM_VOCAB, it))
      fail("A27", `${itlabel} item '${it}' is outside the closed item vocabulary`);
    if (kind === "frontmatter") {
      checkRequiredKeys(item, "item key domain grounds", itlabel, fail);
      checkClosedKeys(item, "item key domain grounds projection", itlabel, fail);
    } else {
      checkRequiredKeys(item, "item grounds", itlabel, fail);
      checkClosedKeys(item, "item grounds", itlabel, fail);
      if (hasKey(item, "key") || hasKey(item, "domain") || hasKey(item, "projection")) {
        fail(
          "A18",
          `${itlabel} (${kind}) declares key, domain or projection, forbidden outside a frontmatter surface`,
        );
      }
    }
    checkGrounds(scope, item, itlabel);
  }
}

export function checkSurfaces(scope: PassScope): void {
  const { doc, file, fail, isOrg } = scope;
  const n = count(strictGet(file, doc, ["surfaces"]));
  let fcount = 0;
  let gcount = 0;
  for (let i = 0; i < n; i++) {
    const node = strictGet(file, doc, ["surfaces", String(i)]);
    const kind = textOrEmpty(strictGet(file, node, ["kind"]));
    const label = `surfaces[${i}]`;
    if (isOrg && kind === "") {
      // R30/Decision 2: a scalar override at `surfaces/<id>/template`, not a whole node.
      if (!hasKey(node, "id") || !hasKey(node, "template")) {
        fail(
          "A32",
          `${label} carries neither kind nor (id and template) — it occupies no address the addressing grammar publishes`,
        );
      }
      checkClosedKeys(node, "id kind items carries template location", label, fail);
    } else {
      if (!inList("frontmatter guidance out-of-band", kind)) {
        fail("A19", `surfaces[${i}] kind '${kind}' is outside frontmatter|guidance|out-of-band`);
      }
      if (kind === "frontmatter") fcount++;
      if (kind === "guidance") gcount++;
      const [required, allowed] = SETS[kind] ?? OTHER;
      if (!isOrg) checkRequiredKeys(node, required, label, fail);
      checkClosedKeys(node, allowed, label, fail);
    }
    if (kind === "out-of-band" && hasKey(node, "template")) {
      fail(
        "A18",
        `${label} (out-of-band) declares template, which only a guidance surface may carry`,
      );
    }
    checkItems(scope, node, kind, label);
    if (kind === "guidance") checkGuidanceTemplate(scope, node, i);
  }
  if (fcount > 1) fail("A21", `declares ${fcount} frontmatter surfaces; at most one is admitted`);
  if (gcount > 1) fail("A21", `declares ${gcount} guidance surfaces; at most one is admitted`);
}
