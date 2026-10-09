// links.ts — relative link rewrites for built copies (spec 0250 R13, R15).
//
// Twins the two `sed` rewrites of scripts/build-components.sh: the skill body of
// tier `core` (:557) and a `.md` skill resource (:434, :447). A built copy sits one
// directory level above its source, so a relative link to `docs/` or `specs/` loses
// one `../`: four become three in a body, five become four in a resource.
//
// All occurrences are rewritten, left to right and without overlap, as `sed ... g`
// did; the two replacements are independent, so their order is not significant.

const BODY_DOCS = "../../../../docs/";
const BODY_SPECS = "../../../../specs/";
const RESOURCE_DOCS = "../../../../../docs/";
const RESOURCE_SPECS = "../../../../../specs/";

function drop(text: string, from: string): string {
  return text.replaceAll(from, from.slice(3));
}

/** Skill body, tier `core` only: `../../../../docs/` and `specs/` lose one `../`. */
export function rewriteSkillBodyLinks(body: string): string {
  return drop(drop(body, BODY_DOCS), BODY_SPECS);
}

/** `.md` resource: `../../../../../docs/` and `specs/` lose one `../`. Bytes otherwise untouched. */
export function rewriteResourceLinks(text: string): string {
  return drop(drop(text, RESOURCE_DOCS), RESOURCE_SPECS);
}
