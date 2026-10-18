// ci-parity-blocks.ts — readers of the path-filter failure blocks printed on stderr.
//
// Replaces the block helpers of scripts/tests/test-check-ci-parity.sh (L642-725).
// A block is the `  DRIFT:` header line that names a capability and holds a fragment,
// plus the indented lines that follow it up to the next header (R18 message shape).

import assert from "node:assert/strict";

/** The block of `capability` whose header holds `fragment`; empty string when absent. */
export function blockOf(stderr: string, capability: string, fragment: string): string {
  const cap = `capability '${capability}' (`;
  const out: string[] = [];
  let on = false;
  for (const line of stderr.split("\n")) {
    if (line.startsWith("  DRIFT: ")) on = line.includes(cap) && line.includes(fragment);
    else if (!line.startsWith("    ")) on = false;
    if (on) out.push(line);
  }
  return out.join("\n");
}

/** The entries of one labelled list of a block, sorted. */
export function blockSide(block: string, side: "ref" | "gh"): string[] {
  const out: string[] = [];
  let current = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("    only in the reference:")) current = "ref";
    else if (line.startsWith("    only on the GitHub side:")) current = "gh";
    else if (current === side && line.startsWith("      - ")) out.push(line.slice(8));
  }
  return out.sort();
}

/** Assert the block exists and return it (the `need_block` of the Bash suite). */
export function needBlock(stderr: string, capability: string, fragment: string, label: string) {
  const block = blockOf(stderr, capability, fragment);
  assert.notEqual(block, "", `${label}: no DRIFT block for '${capability}' holding '${fragment}'`);
  return block;
}

/** The labelled list equals `expected` as a set (empty expectation: the list is empty). */
export function expectSide(
  block: string,
  side: "ref" | "gh",
  label: string,
  expected: readonly string[],
): void {
  assert.notEqual(block, "", `${label}: block missing`);
  const want = [...new Set(expected)].sort();
  assert.deepEqual(blockSide(block, side), want, label);
}

/** The capability has exactly `n` path-filter divergence blocks (R18: one per mismatch). */
export function expectNBlocks(stderr: string, capability: string, n: number, label: string) {
  const needle = `capability '${capability}' (github-actions): path filters diverge on`;
  const got = stderr.split("\n").filter((l) => l.includes(needle)).length;
  assert.equal(got, n, `${label}: expected ${n} divergence block(s), got ${got}`);
}

/** An undeterminable filter (R17): reported, cause named, never compared afterwards. */
export function expectUndet(stderr: string, capability: string, cause: string, label: string) {
  const block = needBlock(stderr, capability, "cannot be determined", label);
  assert.ok(block.includes(cause), `${label}: names the cause '${cause}'\n${block}`);
  expectNBlocks(stderr, capability, 0, `${label}: not compared afterwards, not unfiltered`);
}
