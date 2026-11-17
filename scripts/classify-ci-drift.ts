// classify-ci-drift.ts — classify the divergence records of the CI drift-check harness.
//
// Usage: node scripts/classify-ci-drift.ts [--json] <path | ->
//        node scripts/classify-ci-drift.ts --kinds [--json]
//        node scripts/classify-ci-drift.ts --help
// Input is the harness output with both streams merged (`node scripts/check-ci-parity.ts 2>&1`).
// Exit: 0 no record and an OK line; 1 at least one record; 2 usage error; 3 unreadable input,
// unrecognisable input, or an unindented `Error:` line (the harness aborted, the verdict is incomplete).

import fs from "node:fs";

type Kind =
  | "stale-derived-pipeline"
  | "reference-drift"
  | "hand-authored-drift"
  | "evidence-less-exception"
  | "untraceable-job"
  | "unclassified";
type Engine = "github-actions" | "gitlab" | "reference" | null;
type Finding = { rule: string; message: string; severity?: "warning" };
type Rec = {
  kind: Kind;
  id: string | null;
  engine: Engine;
  action: "auto" | "propose";
  ambiguous: boolean;
  question: string | null;
  guidance: string;
  text: string;
};

const KINDS: Record<Exclude<Kind, "unclassified">, { definition: string; guidance: string }> = {
  "stale-derived-pipeline": {
    definition:
      "The committed .gitlab-ci.yml no longer matches a fresh derivation of the current reference; the reference is right and the generated file is behind it.",
    guidance:
      "Regenerate the GitLab pipeline with scripts/build-ci.ts and re-run the harness. A re-run that is not clean means a misclassification: stop and re-classify.",
  },
  "reference-drift": {
    definition:
      "The reference itself is invalid or no longer describes reality: a validity-rule violation, a bad trigger or path glob, or a missing or unknown group.",
    guidance:
      "Propose amending the offending reference capability (trigger, command, requires, id, group or portability). Judgement-bearing: do not apply it.",
  },
  "hand-authored-drift": {
    definition:
      "A hand-authored job (GitHub Actions or GitLab) diverges from the capability it is attributed to: its steps, setup, env, cache, ci-job inputs, path filters or placement differ from the reference.",
    guidance:
      "Propose correcting the job, or amending the reference when the engine's behaviour is the intended truth; say which you believe is correct and why. Judgement-bearing: do not apply it.",
  },
  "evidence-less-exception": {
    definition:
      "An engine-specific capability (portability: specific) lacks the exception.engine or the exception.evidence the reference contract requires.",
    guidance:
      "Propose adding exception.engine and a concrete exception.evidence, or reclassifying the capability as portable. Judgement-bearing: do not apply it.",
  },
  "untraceable-job": {
    definition:
      "A pipeline job on either engine is neither a capability id nor carries a valid '# ci-capability:' annotation, so the harness cannot attribute it.",
    guidance:
      "Propose renaming the job to its capability id, adding a valid '# ci-capability:' annotation, or adding the capability to the reference when the job is genuinely new. Judgement-bearing: do not apply it.",
  },
};
const UNCLASSIFIED_GUIDANCE =
  "No rule matches this record: classify it by hand, name the uncertainty and the question that resolves it, and propose only.";

const USAGE = `Usage: classify-ci-drift.ts [--json] <path | ->
       classify-ci-drift.ts --kinds [--json]
       classify-ci-drift.ts --help

Classifies the divergence records of the CI drift-check harness. Read the output of
\`node scripts/check-ci-parity.ts 2>&1\` from a file or, with '-', from standard input.
Every record gets a kind, the capability id and engine when named, an action (auto only for
stale-derived-pipeline) and the reconcile guidance. A record no rule matches is 'unclassified'.
Exit: 0 no record and an OK line; 1 at least one record; 2 usage error;
      3 unreadable input, no record and no OK or FAILED line, or an unindented 'Error:' line.
--json prints one {ok, data, findings} object on standard output and human text on standard error.
--kinds prints the five kinds with their definition and reconcile guidance.
`;

const engineOf = (s: string): Engine =>
  (/\((github-actions|gitlab)\)/.exec(s)?.[1] as Engine) ?? null;
const firstQuoted = (s: string): string | null => /'([^']+)'/.exec(s)?.[1] ?? null;

function classify(
  first: string,
  bullet: boolean,
): { kind: Kind; engine: Engine; skipId?: boolean } {
  if (bullet) {
    return /exception\.(engine|evidence)/.test(first)
      ? { kind: "evidence-less-exception", engine: "reference" }
      : { kind: "reference-drift", engine: "reference" };
  }
  if (first.includes("untraceable job"))
    return { kind: "untraceable-job", engine: engineOf(first) };
  if (
    /DRIFT: reference↔GitLab divergence \(gitlab\)/.test(first) &&
    first.includes("composed 'build-ci.ts --check' failed")
  ) {
    return { kind: "stale-derived-pipeline", engine: "gitlab", skipId: true };
  }
  if (first.includes("(reference)")) return { kind: "reference-drift", engine: "reference" };
  const tagged = engineOf(first);
  if (tagged) return { kind: "hand-authored-drift", engine: tagged };
  const absent = /portable set but absent from (github-actions|gitlab)\b/.exec(first);
  if (absent) return { kind: "hand-authored-drift", engine: absent[1] as Engine };
  if (/has no 'group'|has group '[^']*', not one of/.test(first))
    return { kind: "reference-drift", engine: "reference" };
  if (/DRIFT: job '[^']*' is in \S+ but /.test(first))
    return { kind: "hand-authored-drift", engine: "github-actions" };
  return { kind: "unclassified", engine: null };
}

function makeRecord(lines: string[], bullet: boolean): Rec {
  const c = classify(lines[0], bullet);
  const handAuthored = c.kind === "hand-authored-drift";
  const id = c.skipId ? null : firstQuoted(lines[0]);
  const guidance = c.kind === "unclassified" ? UNCLASSIFIED_GUIDANCE : KINDS[c.kind].guidance;
  return {
    kind: c.kind,
    id,
    engine: c.engine,
    action: c.kind === "stale-derived-pipeline" ? "auto" : "propose",
    ambiguous: handAuthored,
    question: handAuthored
      ? `Is the reference or the pipeline job the intended truth for capability '${id ?? "<id>"}'?`
      : null,
    guidance,
    text: lines.join("\n"),
  };
}

type Scan = {
  records: Rec[];
  ok: boolean;
  failed: boolean;
  errorLine: string | null;
  seenBeforeError: number;
};

function scan(input: string): Scan {
  const lines = input.split(/\r?\n/);
  const out: Scan = { records: [], ok: false, failed: false, errorLine: null, seenBeforeError: 0 };
  let inValidity = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^Error:/.test(line) && out.errorLine === null) {
      out.errorLine = line;
      out.seenBeforeError = out.records.length;
    }
    if (/^OK:/.test(line)) out.ok = true;
    if (/^FAILED:/.test(line)) out.failed = true;
    if (/^FAILED: \d+ reference-validity violation\(s\)/.test(line)) {
      inValidity = true;
      continue;
    }
    if (line.trim() === "") {
      inValidity = false;
      continue;
    }
    if (/^ {2}DRIFT: /.test(line)) {
      const rec = [line];
      while (i + 1 < lines.length && /^ {4}/.test(lines[i + 1])) rec.push(lines[++i]);
      out.records.push(makeRecord(rec, false));
    } else if (inValidity && /^ {2}- /.test(line)) {
      out.records.push(makeRecord([line], true));
    }
  }
  return out;
}

function emit(
  json: boolean,
  code: number,
  data: unknown,
  findings: Finding[],
  human: string,
): number {
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ ok: code === 0, data: code === 2 || code === 3 ? null : data, findings })}\n`,
    );
    process.stderr.write(human);
  } else {
    (code === 0 || code === 1 ? process.stdout : process.stderr).write(human);
  }
  return code;
}

function render(r: Rec): string {
  const head = `kind: ${r.kind}  id: ${r.id ?? "-"}  engine: ${r.engine ?? "-"}  action: ${r.action}`;
  const q = r.question ? `\n  ambiguous: true — ${r.question}` : "";
  return `${r.text}\n  ${head}${q}\n  guidance: ${r.guidance}\n`;
}

function main(argv: string[]): number {
  const json = argv.includes("--json");
  const rest = argv.filter((a) => a !== "--json");
  const unknown = rest.find(
    (a) => a.startsWith("-") && a !== "-" && a !== "--help" && a !== "--kinds",
  );
  const usage = (msg: string) =>
    emit(json, 2, null, [{ rule: "usage", message: msg }], `Error: ${msg}\n${USAGE}`);
  if (rest.includes("--help")) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (unknown) return usage(`unknown option ${unknown}`);
  if (rest.includes("--kinds")) {
    if (rest.length > 1) return usage("--kinds takes no input");
    const text = Object.entries(KINDS)
      .map(([k, v]) => `${k}\n  ${v.definition}\n  reconcile: ${v.guidance}\n`)
      .join("\n");
    return emit(
      json,
      0,
      { kinds: Object.entries(KINDS).map(([kind, v]) => ({ kind, ...v })) },
      [],
      text,
    );
  }
  if (rest.length !== 1)
    return usage(
      rest.length === 0 ? "missing input: give a path or -" : "expected exactly one input",
    );
  let input: string;
  try {
    input = fs.readFileSync(rest[0] === "-" ? 0 : rest[0], "utf8");
  } catch (e) {
    const m = `cannot read ${rest[0]}: ${(e as Error).message}`;
    return emit(json, 3, null, [{ rule: "precondition", message: m }], `Error: ${m}\n`);
  }
  const s = scan(input);
  if (s.errorLine !== null) {
    const m = `the harness aborted before a verdict (${JSON.stringify(s.errorLine)}), after ${s.seenBeforeError} record(s); the list may be partial`;
    return emit(json, 3, null, [{ rule: "precondition", message: m }], `Error: ${m}\n`);
  }
  if (s.records.length === 0) {
    if (s.ok)
      return emit(
        json,
        0,
        { count: 0, records: [] },
        [],
        "No divergence record: the harness reported OK.\n",
      );
    const m = s.failed
      ? "a FAILED line reports violations but no divergence record was found"
      : "input holds no divergence record, no OK line and no FAILED line: it is not harness output";
    return emit(json, 3, null, [{ rule: "precondition", message: m }], `Error: ${m}\n`);
  }
  const findings: Finding[] = s.records.map((r) => ({ rule: r.kind, message: r.guidance }));
  let human = `${s.records.length} divergence record(s)\n\n${s.records.map(render).join("\n")}`;
  if (s.ok) {
    const m = "the input holds both an OK line and divergence records; the records win";
    findings.push({ rule: "mixed-input", message: m, severity: "warning" });
    human += `\nWarning: ${m}\n`;
  }
  return emit(json, 1, { count: s.records.length, records: s.records }, findings, human);
}

process.exitCode = main(process.argv.slice(2));
