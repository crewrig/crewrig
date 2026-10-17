// vocab.ts — the spec 0195 domains pinned literally (check-model-mappings.sh:99-109).
// See docs/model-mapping-format.md "Domains (spec 0195, pinned literally)".

export const INTELLIGENCE_RUNGS = "minimal low medium high xhigh xxhigh max";
export const REASONING_RUNGS = "none low medium high xhigh max";
export const SPEED_DOMAIN = "standard fast";
export const LOCALITY_DOMAIN = "any local-only";
export const MODALITY_DOMAIN = "text vision image-out";
export const TARGET_VOCAB = "claude gemini copilot antigravity";
export const ITEM_VOCAB = "model reasoning temperature top-p top-k max-output-tokens max-turns";
export const CLOSED_ASPECTS = "behavior";

/** `case " $LIST " in *" $v "*)`: a substring test, so a value holding spaces can match. */
export const inList = (list: string, v: string): boolean => ` ${list} `.includes(` ${v} `);
