// check.ts — `--check` of build-ci (spec 0262): compare a fresh derivation with the
// committed file and report drift the way the shell does, including the normal-format
// `diff OUTPUT TMP` body, produced here by an LCS line diff (nothing is spawned).

function lines(text: string): string[] {
  const l = text.split("\n");
  if (l[l.length - 1] === "") l.pop();
  return l;
}

const range = (from: number, count: number): string =>
  count === 1 ? String(from) : `${from},${from + count - 1}`;

/** `diff a b` in the default (normal) format. */
export function normalDiff(aText: string, bText: string): string {
  const a = lines(aText);
  const b = lines(bText);
  const n = a.length;
  const m = b.length;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  let out = "";
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    const i0 = i;
    const j0 = j;
    while ((i < n || j < m) && !(i < n && j < m && a[i] === b[j])) {
      if (j >= m || (i < n && lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) i++;
      else j++;
    }
    const dn = i - i0;
    const an = j - j0;
    const op = dn === 0 ? "a" : an === 0 ? "d" : "c";
    const left = dn === 0 ? String(i0) : range(i0 + 1, dn);
    const right = an === 0 ? String(j0) : range(j0 + 1, an);
    out += `${left}${op}${right}\n`;
    for (let k = i0; k < i; k++) out += `< ${a[k]}\n`;
    if (op === "c") out += "---\n";
    for (let k = j0; k < j; k++) out += `> ${b[k]}\n`;
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
