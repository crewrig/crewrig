// rules-split.ts — pure check of the 60-tools.md / 60-memory.md split (spec 0308 R2).
//
// Usage: checkRulesSplit(base, tools, memory) -> string[] of `FAIL ...` findings.
// Contract: the two files, with normalisation N reversed in 60-memory.md and the two
// pointer blocks P removed, interleave in `base` order into `base` byte for byte.
// Exit codes: not applicable (library); scripts/check-rules-split.ts maps findings to 1.
// Finding format: `FAIL section "<heading>": <reason>` or `FAIL <reason>`.

export const N_OLD = "near the top of this file";
export const N_NEW = "near the top of 60-tools.md";
const N_COUNT = 4;
const P_MAX = 250;
const P_TOTAL_MAX = 450;
const PREAMBLE = "(preamble)";
/** Heading prefixes of the sections that move (R1). */
const MOVED = [
  "Memory Architecture",
  "MemPalace",
  "Sequential Thinking",
  "Second Brain",
  "Memory Activation Summary",
];

type Chunk = { heading: string; text: string };

/** Split at each blank line followed by a `## ` heading; the first chunk is the preamble. */
function chunks(text: string): Chunk[] {
  const out: Chunk[] = [];
  let start = 0;
  let heading = PREAMBLE;
  const re = /\n(?=\n## )/g;
  const bounds = [...text.matchAll(re)].map((m) => m.index + 1);
  for (const b of bounds) {
    out.push({ heading, text: text.slice(start, b) });
    start = b;
    heading = text.slice(b + 4, text.indexOf("\n", b + 4));
  }
  out.push({ heading, text: text.slice(start) });
  return out;
}

const isMoved = (heading: string) => MOVED.some((p) => heading.startsWith(p));
const count = (s: string, needle: string) => s.split(needle).length - 1;

function firstDiff(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

export function checkRulesSplit(base: string, tools: string, memory: string): string[] {
  const f: string[] = [];
  const baseChunks = chunks(base);
  const toolsChunks = chunks(tools);
  const memChunks = chunks(memory);

  const memPointer = memChunks[0];
  const toolsPre = toolsChunks[0];
  const basePre = baseChunks[0];
  if (memPointer.heading !== PREAMBLE)
    f.push("FAIL 60-memory.md has no pointer before its first section");
  const pMem = memPointer.text.length;
  if (pMem > P_MAX) f.push(`FAIL pointer of 60-memory.md is ${pMem} B, above ${P_MAX} B`);

  // 60-tools.md preamble = base preamble plus one inserted block.
  const ins = toolsPre.text.length - basePre.text.length;
  let pTools = 0;
  if (ins <= 0) {
    f.push(`FAIL section "${PREAMBLE}": 60-tools.md carries no pointer block`);
  } else {
    pTools = ins;
    const lcp = firstDiff(toolsPre.text, basePre.text);
    const stripped = toolsPre.text.slice(0, lcp) + toolsPre.text.slice(lcp + ins);
    if (stripped !== basePre.text)
      f.push(`FAIL section "${PREAMBLE}": edit other than the pointer block`);
    if (ins > P_MAX) f.push(`FAIL pointer of 60-tools.md is ${ins} B, above ${P_MAX} B`);
  }
  if (pMem + pTools > P_TOTAL_MAX) {
    f.push(`FAIL both pointers total ${pMem + pTools} B, above ${P_TOTAL_MAX} B`);
  }

  if (count(memory, N_NEW) !== N_COUNT) {
    f.push(
      `FAIL 60-memory.md holds ${count(memory, N_NEW)} occurrence(s) of N, expected ${N_COUNT}`,
    );
  }
  if (count(tools, N_NEW) !== 0)
    f.push(`FAIL 60-tools.md holds ${count(tools, N_NEW)} occurrence(s) of N, expected 0`);

  const pool = (cs: Chunk[]) => new Map(cs.slice(1).map((c) => [c.heading, c.text]));
  const toolsBy = pool(toolsChunks);
  const memBy = pool(memChunks);
  const rebuilt: string[] = [basePre.text];
  for (const b of baseChunks.slice(1)) {
    const wantMoved = isMoved(b.heading);
    const [home, other, homeName, otherName] = wantMoved
      ? [memBy, toolsBy, "60-memory.md", "60-tools.md"]
      : [toolsBy, memBy, "60-tools.md", "60-memory.md"];
    if (other.has(b.heading))
      f.push(`FAIL section "${b.heading}": present in ${otherName}, belongs in ${homeName}`);
    const got = home.get(b.heading);
    if (got === undefined) {
      f.push(`FAIL section "${b.heading}": missing from ${homeName}`);
      continue;
    }
    const norm = wantMoved ? got.split(N_NEW).join(N_OLD) : got;
    if (norm !== b.text) {
      f.push(`FAIL section "${b.heading}": differs from base at byte ${firstDiff(norm, b.text)}`);
    }
    rebuilt.push(norm);
  }
  const known = new Set(baseChunks.map((c) => c.heading));
  for (const [name, by] of [
    ["60-tools.md", toolsBy],
    ["60-memory.md", memBy],
  ] as const) {
    for (const h of by.keys())
      if (!known.has(h)) f.push(`FAIL section "${h}": not in base, found in ${name}`);
  }
  const order = (cs: Chunk[]) =>
    cs
      .slice(1)
      .map((c) => c.heading)
      .filter((h) => known.has(h));
  const want = (moved: boolean) =>
    baseChunks
      .slice(1)
      .map((c) => c.heading)
      .filter((h) => isMoved(h) === moved);
  if (order(memChunks).join("\n") !== want(true).join("\n"))
    f.push("FAIL 60-memory.md sections are not in base order");
  if (order(toolsChunks).join("\n") !== want(false).join("\n"))
    f.push("FAIL 60-tools.md sections are not in base order");

  if (f.length === 0 && rebuilt.join("") !== base)
    f.push("FAIL interleaved files differ from base");
  return f;
}
