// pass-offerings.ts — offerings, provides values and encodes
// (check-model-mappings.sh:710-823): A3, A8, A9, A10, A15, A17, A26 and the grounds of
// every offering.

import { get, isYqFalsy, lengthOf, type YqNode } from "../yq-accessors/index.ts";
import {
  hasKey,
  keyListOrEmpty,
  scalarText,
  strictGet,
  textOrEmpty,
  truthyTexts,
  unalias,
} from "./nodes.ts";
import { checkGrounds } from "./pass-grounds.ts";
import { checkClosedKeys, checkRequiredKeys } from "./pass-shape.ts";
import { findItemIndex, findSurfaceIndexByKind, frontmatterModelDomain } from "./surface-find.ts";
import type { PassScope } from "./types.ts";
import {
  INTELLIGENCE_RUNGS,
  inList,
  LOCALITY_DOMAIN,
  MODALITY_DOMAIN,
  REASONING_RUNGS,
  SPEED_DOMAIN,
} from "./vocab.ts";

const CHARS = "intelligence reasoning specialization context speed modalities locality";
const CLOSED_DOMAINS: Record<string, string> = {
  intelligence: INTELLIGENCE_RUNGS,
  reasoning: REASONING_RUNGS,
  speed: SPEED_DOMAIN,
  locality: LOCALITY_DOMAIN,
};

function checkProvidesValue(scope: PassScope, node: YqNode, label: string, key: string): void {
  const { fail, file } = scope;
  const value = (): string => scalarText(strictGet(file, node, ["provides", key]));
  switch (key) {
    case "intelligence": {
      const v = value();
      if (!inList(INTELLIGENCE_RUNGS, v))
        fail("A8", `${label} provides.intelligence '${v}' is outside the seven spec 0195 rungs`);
      break;
    }
    case "reasoning": {
      const v = value();
      if (!inList(REASONING_RUNGS, v))
        fail("A8", `${label} provides.reasoning '${v}' is outside the six spec 0195 rungs`);
      break;
    }
    case "speed": {
      const v = value();
      if (!inList(SPEED_DOMAIN, v))
        fail("A8", `${label} provides.speed '${v}' is outside standard|fast`);
      break;
    }
    case "locality": {
      const v = value();
      if (!inList(LOCALITY_DOMAIN, v))
        fail("A8", `${label} provides.locality '${v}' is outside any|local-only`);
      break;
    }
    case "modalities": {
      const list = (() => {
        try {
          return get(node, ["provides", "modalities"]);
        } catch {
          return null;
        }
      })();
      for (const mv of truthyTexts(list)) {
        if (mv === "") continue;
        if (!inList(MODALITY_DOMAIN, mv))
          fail("A8", `${label} provides.modalities '${mv}' is outside text|vision|image-out`);
      }
      break;
    }
    case "context": {
      const v = value();
      if (v === "" || /[^0-9]/.test(v) || v === "0")
        fail("A8", `${label} provides.context '${v}' is not a positive integer`);
      break;
    }
    case "specialization": {
      const v = value();
      if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(v))
        fail("A8", `${label} provides.specialization '${v}' is not a kebab-case token`);
      break;
    }
  }
}

/** `is_hyphen_segment`: `read -ra` on '-' drops one trailing empty field. */
function isHyphenSegment(token: string, native: string): boolean {
  const parts = native.split("-");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts.includes(token);
}

function checkEncodes(scope: PassScope, node: YqNode, label: string): void {
  const { fail, file } = scope;
  const encodes = strictGet(file, node, ["encodes"]);
  const provides = strictGet(file, node, ["provides"]);
  for (const c of keyListOrEmpty(encodes)) {
    if (c === "") continue;
    const token = scalarText(strictGet(file, node, ["encodes", c]));
    if (!hasKey(provides, c)) {
      fail("A10", `${label} encodes '${c}' which is not a key of provides`);
      continue;
    }
    const native = textOrEmpty(strictGet(file, node, ["native-value"]));
    if (!isHyphenSegment(token, native)) {
      fail(
        "A10",
        `${label} encodes '${c}' as '${token}', not a '-'-delimited segment of native-value '${native}'`,
      );
      continue;
    }
    if (c in CLOSED_DOMAINS && inList(CLOSED_DOMAINS[c] ?? "", token)) {
      const pval = scalarText(strictGet(file, node, ["provides", c]));
      if (token !== pval)
        fail(
          "A10",
          `${label} encodes '${c}' as '${token}', which disagrees with provides.${c} '${pval}'`,
        );
    }
  }
}

export function checkOfferings(scope: PassScope): void {
  const { doc, file, fail } = scope;
  const offerings = strictGet(file, doc, ["offerings"]);
  const n = isYqFalsy(unalias(offerings)) ? 0 : lengthOf(unalias(offerings));
  for (let i = 0; i < n; i++) {
    const node = strictGet(file, doc, ["offerings", String(i)]);
    const id = textOrEmpty(strictGet(file, node, ["id"]));
    const label = `offerings/${id === "" ? `[${i}]` : id}`;
    checkRequiredKeys(
      node,
      "id rank native-value provides supports-reasoning-surface grounds",
      label,
      fail,
    );
    checkClosedKeys(
      node,
      "id rank native-value provides encodes supports-reasoning-surface grounds",
      label,
      fail,
    );
    checkGrounds(scope, node, label);

    const provides = strictGet(file, node, ["provides"]);
    if (!hasKey(provides, "intelligence")) {
      fail("A26", `${label} declares no provides.intelligence — unselectable at any rung`);
    }
    checkClosedKeys(provides, CHARS, `${label}.provides`, fail);
    for (const pk of keyListOrEmpty(provides)) {
      if (pk !== "") checkProvidesValue(scope, node, label, pk);
    }
    if (hasKey(node, "encodes")) {
      checkClosedKeys(strictGet(file, node, ["encodes"]), CHARS, `${label}.encodes`, fail);
      checkEncodes(scope, node, label);
    }
    if (textOrEmpty(strictGet(file, node, ["supports-reasoning-surface"])) === "true") {
      const fidx = findSurfaceIndexByKind(file, doc, "frontmatter");
      const ridx = fidx < 0 ? -1 : findItemIndex(file, doc, fidx, "reasoning");
      if (ridx < 0) {
        fail(
          "A17",
          `${label} declares supports-reasoning-surface: true but the mapping declares no frontmatter reasoning item`,
        );
      }
    }
    const nv = textOrEmpty(strictGet(file, node, ["native-value"]));
    const domvals = frontmatterModelDomain(file, doc);
    if (domvals !== "" && !domvals.split("\n").includes(nv)) {
      fail(
        "A9",
        `${label} native-value '${nv}' is outside the frontmatter model item's declared domain`,
      );
    }
  }
}
