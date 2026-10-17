// check.ts — `--check` of build-ci (spec 0262): compare a fresh derivation with the
// committed file and report drift the way the shell does, including the normal-format
// `diff OUTPUT TMP` body, produced here by an LCS line diff (nothing is spawned).

/** Lines of a file; `noEol` marks a final line with no trailing line feed. */
function lines(text: string): { rows: string[]; noEol: boolean } {
  const l = text.split("\n");
  const last = l.pop() as string;
  if (last === "") return { rows: l, noEol: false };
  return { rows: [...l, last], noEol: true };
}

const range = (from: number, count: number): string =>
  count === 1 ? String(from) : `${from},${from + count - 1}`;

/**
 * `diff a b` in the default (normal) format. The edit script is walked from the END of
 * the prefix-LCS table, so equal lines are matched last-first and a hunk among repeated
 * lines settles at its earliest position, as the system `diff` places it. A final line
 * with no line feed differs from the same text with one, and is followed by the
 * `\ No newline at end of file` marker.
 */
export function normalDiff(aText: string, bText: string): string {
  const A = lines(aText);
  const B = lines(bText);
  const a = A.rows.map((x, i) => (A.noEol && i === A.rows.length - 1 ? `${x}\0` : x));
  const b = B.rows.map((x, i) => (B.noEol && i === B.rows.length - 1 ? `${x}\0` : x));
  const n = a.length;
  const m = b.length;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      lcs[i]![j] =
        a[i - 1] === b[j - 1]
          ? lcs[i - 1]![j - 1]! + 1
          : Math.max(lcs[i - 1]![j]!, lcs[i]![j - 1]!);
    }
  }
  const matchA = new Set<number>();
  const matchB = new Set<number>();
  for (let i = n, j = m; i > 0 && j > 0;) {
    if (a[i - 1] === b[j - 1]) {
      matchA.add(i - 1);
      matchB.add(j - 1);
      i--;
      j--;
    } else if (lcs[i - 1]![j]! >= lcs[i]![j - 1]!) i--;
    else j--;
  }
  const show = (rows: string[], k: number, side: string, noEol: boolean): string =>
    `${side} ${rows[k]}\n${noEol && k === rows.length - 1 ? "\\ No newline at end of file\n" : ""}`;
  let out = "";
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && matchA.has(i) && matchB.has(j)) {
      i++;
      j++;
      continue;
    }
    const i0 = i;
    const j0 = j;
    while (i < n && !matchA.has(i)) i++;
    while (j < m && !matchB.has(j)) j++;
    const dn = i - i0;
    const an = j - j0;
    const op = dn === 0 ? "a" : an === 0 ? "d" : "c";
    const left = dn === 0 ? String(i0) : range(i0 + 1, dn);
    const right = an === 0 ? String(j0) : range(j0 + 1, an);
    out += `${left}${op}${right}\n`;
    for (let k = i0; k < i; k++) out += show(A.rows, k, "<", A.noEol);
    if (op === "c") out += "---\n";
    for (let k = j0; k < j; k++) out += show(B.rows, k, ">", B.noEol);
  }
  return out;
}

export interface Outcome {
  stdout: string;
  stderr: string;
  code: number;
}

/** The drift verdict; `committed` is null when the output file does not exist. */
export function checkDrift(fresh: string, committed: string | null, output: string): Outcome {
  if (committed === null) {
    return {
      stdout: "",
      stderr:
        `DRIFT: ${output} does not exist (expected from ci/ci-capabilities.yml)\n` +
        "FAILED: run 'bash scripts/build-ci.sh' to generate it.\n",
      code: 1,
    };
  }
  if (committed === fresh) {
    return {
      stdout: "OK: .gitlab-ci.yml matches the CI capability reference.\n",
      stderr: "",
      code: 0,
    };
  }
  return {
    stdout: "",
    stderr:
      `DRIFT: ${output} differs from a fresh derivation of ci/ci-capabilities.yml\n\n` +
      normalDiff(committed, fresh) +
      "\nFAILED: run 'bash scripts/build-ci.sh' to regenerate the GitLab pipeline.\n",
    code: 1,
  };
}
