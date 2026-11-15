// proof.ts — the equivalence proof of spec 0309 R13 for the split of the capability reference.
//
// Inputs are texts, so a test feeds fixtures and the CLI feeds `git show` output:
//   - the pre-split reference and generated pipeline,
//   - the post-split reference files (name to text) and generated pipeline.
// The proof holds when, after the only replacements R12(e) names, and the reordering of whole,
// unchanged blocks into the reader order (R13(0): files in the byte order of their names,
// entries in file order), the pre-split texts equal the post-split texts byte for byte.

import { splitBlocks } from "./blocks.ts";

const SELF_ENTRY = /^( +- )"ci\/ci-capabilities\.yml"$/;
const OLD_NAME = "ci/ci-capabilities.yml";
const KEY = /^[A-Za-z.][^ #]*:/;

export interface ProofResult {
  ok: boolean;
  /** One line per fact; failures are prefixed `FAIL`. */
  report: string[];
}

const byteOrder = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));

/** Lines of `a` and `b` that differ, as `-`/`+` lines, by longest common subsequence. */
function lineDiff(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;
  const t: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      (t[i] as number[])[j] =
        a[i] === b[j]
          ? ((t[i + 1] as number[])[j + 1] as number) + 1
          : Math.max((t[i + 1] as number[])[j] as number, (t[i] as number[])[j + 1] as number);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) {
      i++;
      j++;
    } else if (
      j >= n ||
      (i < m && ((t[i + 1] as number[])[j] as number) >= ((t[i] as number[])[j + 1] as number))
    ) {
      out.push(`- ${a[i++]}`);
    } else out.push(`+ ${b[j++]}`);
  }
  return out;
}

interface Chunk {
  key: string;
  text: string;
}

/** The generated pipeline as chunks: a preamble chunk per non-job key, then one per job. */
function chunks(text: string): { head: string; chunks: Chunk[] } {
  const lines = text.replace(/\n$/, "").split("\n");
  const at = lines.map((l, i) => (KEY.test(l) ? i : -1)).filter((i) => i >= 0);
  const head = lines
    .slice(0, at[0] ?? lines.length)
    .join("\n")
    .replace(/\n+$/, "");
  const out = at.map((s, k) => {
    const end = k + 1 < at.length ? (at[k + 1] as number) : lines.length;
    const body = lines.slice(s, end);
    while (body.length > 0 && body[body.length - 1] === "") body.pop();
    return { key: (lines[s] as string).replace(/:.*$/, ""), text: body.join("\n") };
  });
  return { head, chunks: out };
}

export function proveSplit(input: {
  baseReference: string;
  baseGitlab: string;
  splitFiles: Map<string, string>;
  splitGitlab: string;
}): ProofResult {
  const report: string[] = [];
  const fail = (m: string): void => void report.push(`FAIL ${m}`);

  // Reference side: every block moved, none edited but for the retargeted entries.
  const base = splitBlocks(input.baseReference);
  const baseById = new Map(base.map((b) => [b.id, b]));
  const order: string[] = [];
  const movedById = new Map<string, string>();
  for (const name of [...input.splitFiles.keys()].sort(byteOrder))
    for (const b of splitBlocks(input.splitFiles.get(name) as string)) {
      if (movedById.has(b.id)) fail(`capability '${b.id}' appears twice in the split reference`);
      movedById.set(b.id, b.text);
      order.push(b.id);
    }
  let refEntries = 0;
  for (const id of baseById.keys())
    if (!movedById.has(id)) fail(`capability '${id}' is missing from the split reference`);
  for (const id of order) {
    const b = baseById.get(id);
    if (!b) {
      fail(`capability '${id}' is not in the pre-split reference`);
      continue;
    }
    const want = b.text
      .split("\n")
      .map((l) => {
        const m = SELF_ENTRY.exec(l);
        if (!m) return l;
        refEntries++;
        return `${m[1]}"ci/capabilities/**"`;
      })
      .join("\n");
    const got = movedById.get(id) as string;
    if (want !== got)
      for (const d of lineDiff(want.split("\n"), got.split("\n")))
        fail(`reference block '${id}' was edited: ${d}`);
  }
  report.push(
    `reference: ${movedById.size} capabilities moved, ${refEntries} path entries retargeted to ci/capabilities/**`,
  );

  // Generated side: replacements, then whole job blocks in reader order.
  const pre = chunks(input.baseGitlab);
  const post = chunks(input.splitGitlab);
  let pathLines = 0;
  let headerLines = 0;
  const replaced = (s: string): string =>
    s
      .split("\n")
      .map((l) => {
        const m = SELF_ENTRY.exec(l);
        if (m) {
          pathLines++;
          return `${m[1]}"ci/capabilities/**"`;
        }
        return l;
      })
      .join("\n");
  const head = pre.head
    .split("\n")
    .map((l) => {
      if (!l.includes(OLD_NAME)) return l;
      headerLines++;
      return l.split(OLD_NAME).join("ci/capabilities/");
    })
    .join("\n");
  const ids = new Set(order);
  const preJobs = new Map(
    pre.chunks.filter((c) => ids.has(c.key)).map((c) => [c.key, replaced(c.text)]),
  );
  const lead = pre.chunks.filter((c) => !ids.has(c.key));
  const firstJob = pre.chunks.findIndex((c) => ids.has(c.key));
  if (lead.some((c) => pre.chunks.indexOf(c) > firstJob))
    fail("the pre-split pipeline has a non-job key after its first job");
  const wantChunks = [
    ...lead.map((c) => replaced(c.text)),
    ...order.filter((id) => preJobs.has(id) && ids.has(id)).map((id) => preJobs.get(id) as string),
  ];
  const want = `${[head, ...wantChunks].join("\n\n")}\n`;
  const got = input.splitGitlab;
  if (want !== got) {
    const gotJobs = new Map(post.chunks.map((c) => [c.key, c.text]));
    const seen = new Set<string>();
    for (const [id, text] of preJobs) {
      seen.add(id);
      const g = gotJobs.get(id);
      if (g === undefined) fail(`job '${id}' is missing from the split pipeline`);
      else if (g !== text)
        for (const d of lineDiff(text.split("\n"), g.split("\n")))
          fail(`job '${id}' differs in the split pipeline: ${d}`);
    }
    for (const c of post.chunks)
      if (!seen.has(c.key) && ids.has(c.key))
        fail(`job '${c.key}' is not in the pre-split pipeline`);
    if (post.head !== head)
      for (const d of lineDiff(head.split("\n"), post.head.split("\n")))
        fail(`pipeline header differs: ${d}`);
    if (report.every((l) => !l.startsWith("FAIL"))) {
      const w = want.split("\n");
      const g = got.split("\n");
      const at = w.findIndex((l, i) => l !== g[i]);
      fail(
        `the split pipeline differs from the reordered pre-split pipeline in block order or spacing, ` +
          `first at line ${at + 1}: expected ${JSON.stringify(w[at])}, got ${JSON.stringify(g[at])}`,
      );
    }
  }
  report.push(
    `pipeline: ${preJobs.size} job blocks moved into reader order, changed lines: ${pathLines} path entries + ${headerLines} header lines`,
  );
  const ok = report.every((l) => !l.startsWith("FAIL"));
  report.push(ok ? "PASS: the split changes nothing but R12(e) and the block order" : "FAILED");
  return { ok, report };
}
