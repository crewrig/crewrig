// resolve.js — the model-id resolution pipeline (spec 0209 R6-R13; PLAN v2
// step 4). Pure, no I/O: resolve(modelId, {pricelist, org}) returns
// {entryKey, entry, step, family} or {unpriced: true, step, reason}.
//
// Steps, each stamped onto the result as `step` (R11):
//   sentinel   -> a literal placeholder never resolved through any other
//                 step (R12): "(unreported)" (headless-envelope.js), "auto"
//                 (Antigravity's automatic-selection placeholder), "unknown"
//                 (the adapters' own missing-model fallback).
//   org-exact  -> a candidate both tables declare — the org table's entry
//                 wins (R7).
//   exact      -> a candidate only the primary source declares.
//   alias      -> the matched entry (org- or primary-sourced) declares
//                 aliasOf; re-resolved against the SAME pinned snapshot,
//                 depth-capped at 4, cycle-guarded.
//   family     -> a same-family fallback over the primary source, flagged
//                 (R13).
//   org-added  -> a candidate only the org table declares.
//   unpriced   -> no step above produced a match; no heuristic guess is
//                 substituted (R12).
//
// Candidate composition is a BOUNDED TRANSITIVE CLOSURE: a FIFO frontier
// seeded with the verbatim id (always candidate 0 — normalization GENERATES
// candidates, it never rewrites in place, because a destructive rewrite
// turns a real hit into a miss), a visited set keyed on the candidate
// string, a depth cap of 4, and six rewriting generators applied in a FIXED
// declared order so the set is deterministic and its first hit is stable. A
// candidate produced by one generator is re-fed through every generator.
// `provider` is a SEVENTH, TERMINAL generator: it prefixes every closure
// member with each of the pinned snapshot's own `litellm_provider` values
// and its outputs are never re-fed, so the closure stays bounded over the
// six rewriting generators while the provider phase costs a bounded
// |closure| x |providers| set of membership tests. Provider-prefixed
// candidates are tried only after every plain closure member has been
// tried, so a plain hit is always preferred when one exists.

'use strict';

const SENTINELS = new Set(['(unreported)', 'auto', 'unknown']);

const EFFORT_TOKENS = ['minimal', 'low', 'medium', 'high', 'max', 'xhigh'];
const EFFORT_PAREN_RE = new RegExp(`\\s*\\((${EFFORT_TOKENS.join('|')})\\)\\s*$`, 'i');
const EFFORT_SUFFIX_RE = new RegExp(`-(${EFFORT_TOKENS.join('|')})$`, 'i');
const CHAN_SUFFIX_RE = /(-preview|-latest|:batch)$/i;
const DATED_SUFFIX_RE = /-20\d{6}$/;
const MAX_DEPTH = 4;

function genLower(s) {
  const lower = s.toLowerCase();
  return lower !== s ? [lower] : [];
}

// slug — strip a trailing parenthesized effort token, CONSUMING THE
// SEPARATOR RUN AROUND IT (pass-2 named edit 2: stripping the token alone
// leaves a trailing hyphen after the collapse, and the closure never
// reaches the composed hit for the repository's only Antigravity statusline
// dialect). Then, if the result contains whitespace or the strip changed
// anything, lowercase and collapse every non-alphanumeric run to '-',
// trimming any leading/trailing '-' the collapse itself could produce.
function genSlug(s) {
  const stripped = s.replace(EFFORT_PAREN_RE, '');
  const changed = stripped !== s;
  if (!changed && !/\s/.test(stripped)) return [];
  const collapsed = stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return collapsed && collapsed !== s ? [collapsed] : [];
}

// vsep — for every position where '-' or '.' sits between two digits, emit
// the variant with the other separator. Positional and both-directional:
// one candidate per position, never a full rewrite (the version segment is
// not always a trailing one, e.g. "gemini-3-8-flash").
function genVsep(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '-' && c !== '.') continue;
    const prev = s[i - 1];
    const next = s[i + 1];
    if (!prev || !next || !/[0-9]/.test(prev) || !/[0-9]/.test(next)) continue;
    const other = c === '-' ? '.' : '-';
    out.push(s.slice(0, i) + other + s.slice(i + 1));
  }
  return out;
}

function genEffort(s) {
  return EFFORT_SUFFIX_RE.test(s) ? [s.replace(EFFORT_SUFFIX_RE, '')] : [];
}

function genChan(s) {
  return CHAN_SUFFIX_RE.test(s) ? [s.replace(CHAN_SUFFIX_RE, '')] : [];
}

function genDated(s) {
  return DATED_SUFFIX_RE.test(s) ? [s.replace(DATED_SUFFIX_RE, '')] : [];
}

const REWRITE_GENERATORS = [genLower, genSlug, genVsep, genEffort, genChan, genDated];

// buildClosure(modelId) -> ordered candidate list, verbatim id first (depth
// 0), BFS over the six rewriting generators, depth-capped, visited-guarded.
function buildClosure(modelId) {
  const visited = new Set([modelId]);
  const order = [modelId];
  const queue = [{ value: modelId, depth: 0 }];
  while (queue.length > 0) {
    const { value, depth } = queue.shift();
    if (depth >= MAX_DEPTH) continue;
    for (const gen of REWRITE_GENERATORS) {
      for (const next of gen(value)) {
        if (visited.has(next)) continue;
        visited.add(next);
        order.push(next);
        queue.push({ value: next, depth: depth + 1 });
      }
    }
  }
  return order;
}

function providerAlphabet(pricelist) {
  const set = new Set();
  const entries = (pricelist && pricelist.entries) || {};
  for (const [key, entry] of Object.entries(entries)) {
    if (key === 'sample_spec') continue;
    if (entry && typeof entry.litellm_provider === 'string' && entry.litellm_provider) {
      set.add(entry.litellm_provider);
    }
  }
  return Array.from(set).sort();
}

// withProviderPrefixes — the terminal pass: every closure member prefixed
// with every provider in the pinned snapshot's own alphabet, appended AFTER
// the whole plain closure so a plain hit is always tried first.
function withProviderPrefixes(closure, pricelist) {
  const providers = providerAlphabet(pricelist);
  if (providers.length === 0) return closure.slice();
  const out = closure.slice();
  const seen = new Set(out);
  for (const member of closure) {
    for (const provider of providers) {
      const prefixed = `${provider}/${member}`;
      if (!seen.has(prefixed)) {
        seen.add(prefixed);
        out.push(prefixed);
      }
    }
  }
  return out;
}

function lookupEntry(table, key) {
  if (!table || key === 'sample_spec') return undefined;
  return table[key];
}

// followAlias — re-resolves an aliasOf target against the SAME pinned
// snapshot, depth-capped at 4, cycle-guarded via a visited set.
function followAlias(key, entry, initialStep, { pricelist, org }) {
  let curKey = key;
  let curEntry = entry;
  let step = initialStep;
  const visited = new Set([key]);
  let depth = 0;
  while (curEntry && typeof curEntry.aliasOf === 'string' && depth < MAX_DEPTH) {
    const target = curEntry.aliasOf;
    if (visited.has(target)) break; // cycle guard
    visited.add(target);
    const nextEntry = lookupEntry(org.entries, target) || lookupEntry(pricelist.entries, target);
    if (!nextEntry) break;
    curKey = target;
    curEntry = nextEntry;
    step = 'alias';
    depth += 1;
  }
  return { key: curKey, entry: curEntry, step };
}

// familyFallback — a same-family fallback over the PRIMARY SOURCE only
// (litellm_provider, the field family derivation reads, exists only on
// primary-source entries). For each plain candidate, tries progressively
// shorter vendor+family+major stems (dropping trailing hyphen segments,
// longest first); across candidates, the LONGEST matching stem wins, ties
// broken by the SHORTEST resulting entry key.
function familyFallback(plainCandidates, pricelist) {
  const entries = (pricelist && pricelist.entries) || {};
  const entryKeys = Object.keys(entries).filter((k) => k !== 'sample_spec');
  if (entryKeys.length === 0) return null;

  let best = null;
  for (const cand of plainCandidates) {
    const segments = cand.split('-');
    for (let cut = segments.length - 1; cut >= 1; cut--) {
      const stem = segments.slice(0, cut).join('-');
      const matches = entryKeys.filter((k) => k === stem || k.startsWith(`${stem}-`) || k.startsWith(`${stem}.`));
      if (matches.length === 0) continue;
      if (!best || stem.length > best.stem.length) {
        const key = matches.slice().sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
        best = { stem, key, entry: entries[key] };
      }
      break; // longest reachable stem for THIS candidate found
    }
  }
  return best;
}

function finalize(followed) {
  return {
    entryKey: followed.key,
    entry: followed.entry,
    step: followed.step,
    family: followed.step === 'family',
  };
}

// resolve(modelId, {pricelist, org}) — pure, no I/O.
function resolve(modelId, opts) {
  opts = opts || {};
  const pricelist = opts.pricelist || { entries: {} };
  const org = opts.org || { entries: {} };

  if (SENTINELS.has(modelId)) {
    return { unpriced: true, step: 'sentinel', reason: `sentinel placeholder: ${modelId}` };
  }

  const plainClosure = buildClosure(modelId);
  const fullClosure = withProviderPrefixes(plainClosure, pricelist);

  // (b) org-exact / (c) exact, in one pass over the closure so the FIRST
  // candidate to resolve against either table wins, org taking precedence
  // over primary when both declare it (R7).
  for (const cand of fullClosure) {
    const inOrg = lookupEntry(org.entries, cand);
    const inPrimary = lookupEntry(pricelist.entries, cand);
    if (inOrg && inPrimary) {
      return finalize(followAlias(cand, inOrg, 'org-exact', { pricelist, org }));
    }
    if (inPrimary) {
      return finalize(followAlias(cand, inPrimary, 'exact', { pricelist, org }));
    }
  }

  // (e) family fallback.
  const familyHit = familyFallback(plainClosure, pricelist);
  if (familyHit) {
    return finalize(followAlias(familyHit.key, familyHit.entry, 'family', { pricelist, org }));
  }

  // (f) org-added — a candidate the org table alone declares.
  for (const cand of fullClosure) {
    const inOrg = lookupEntry(org.entries, cand);
    if (inOrg) {
      return finalize(followAlias(cand, inOrg, 'org-added', { pricelist, org }));
    }
  }

  // (g) unpriced — no heuristic guess is substituted (R12).
  return { unpriced: true, step: 'unpriced', reason: 'no candidate resolved through the closure, family fallback, or org table' };
}

module.exports = { resolve, buildClosure, withProviderPrefixes, providerAlphabet, familyFallback, SENTINELS };
