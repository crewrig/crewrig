// check-permissions.ts — flag a GitHub Actions workflow whose GITHUB_TOKEN scope is not restricted.
// Usage: node scripts/check-permissions.ts <workflow-file-or-directory>... [--json]   (or - for stdin)
// Exit codes: 0 no error finding (warnings are listed), 1 error finding, 2 usage error or a
// directory with no workflow file, 3 unreadable input. Writes nothing, makes no network call.
// Contract: docs/skill-authoring-standard.md (the script contract). Self-contained on purpose: no
// import, built-ins through process.getBuiltinModule, and its own small YAML-subset reader.

process.removeAllListeners("warning");

void (() => {
  const fs = process.getBuiltinModule("node:fs");
  const NAME = "check-permissions.ts";
  const USAGE = `Usage: node scripts/${NAME} <workflow-file-or-directory>... [--json]
       node scripts/${NAME} - [--json]            (one workflow on standard input)

Reports, per workflow: permissions-missing (no top-level permissions: key and a job without its
own, reported on the first such job), permissions-write-all (permissions: write-all at the workflow
or a job), and the warning permissions-broad (a top-level mapping that grants write on a scope).
A directory means every *.yml and *.yaml file directly under it. A file with no jobs: key (a
composite action.yml) passes. A YAML construct the reader cannot interpret (anchor, alias, merge
key, multi-line flow mapping) is the warning unparsed, never a silent pass.

Options: --json (one object {ok, data, findings} on stdout), --help (this text).
data: {files, errors, warnings}; a finding carries rule, message, path, line, severity.
Exit codes: 0 no error finding, 1 error finding, 2 usage error or no workflow file in a directory,
3 unreadable input.
`;

  interface Finding {
    rule: string;
    message: string;
    path?: string;
    line?: number;
    severity?: "error" | "warning";
  }
  const argv = process.argv.slice(2);
  let json = false;
  const emit = (code: number, data: unknown, findings: Finding[], summary: string): void => {
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: code === 0, data, findings })}\n`);
      process.stderr.write(`${summary}\n`);
    } else {
      if (code < 2)
        for (const f of findings)
          process.stdout.write(
            `${f.severity === "warning" ? "[WARN]" : "[FAIL]"} ${f.path ?? ""}:${f.line ?? 0}: ${f.rule}: ${f.message}\n`,
          );
      (code >= 2 ? process.stderr : process.stdout).write(`${summary}\n`);
    }
    process.exitCode = code;
  };
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
  json = argv.includes("--json");
  const fail = (code: number, rule: string, message: string, summary: string): void =>
    emit(code, null, [{ rule, message }], summary);
  const usageError = (message: string): void =>
    fail(2, "usage", message, `${NAME}: ${message}\n${USAGE.split("\n")[0]}`);

  const inputs: string[] = [];
  for (const a of argv) {
    if (a === "--json") continue;
    if (a.startsWith("-") && a !== "-") return usageError(`unknown option ${a}`);
    inputs.push(a);
  }
  if (inputs.length === 0) return usageError("a workflow file or directory is required");
  if (inputs.includes("-") && inputs.length > 1)
    return usageError("- (standard input) cannot be combined with other inputs");

  const stat = (p: string): import("node:fs").Stats | undefined => {
    try {
      return fs.statSync(p);
    } catch {
      return undefined;
    }
  };
  const targets: string[] = [];
  for (const input of inputs) {
    if (input === "-") {
      targets.push("-");
      continue;
    }
    const st = stat(input);
    if (st?.isFile() === true) targets.push(input);
    else if (st?.isDirectory() === true) {
      let names: string[];
      try {
        names = fs.readdirSync(input);
      } catch {
        return fail(3, "precondition", `cannot read ${input}`, `[FAIL] not readable: ${input}`);
      }
      const dir = input.endsWith("/") ? input : `${input}/`;
      const found = names
        .filter((n) => /\.ya?ml$/.test(n) && stat(dir + n)?.isFile() === true)
        .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
        .map((n) => dir + n);
      if (found.length === 0)
        return fail(
          2,
          "usage",
          `no workflow file under ${input}`,
          `[FAIL] no workflow files found under: ${input}`,
        );
      targets.push(...found);
    } else
      return fail(
        3,
        "precondition",
        `${input} is not a readable file or directory`,
        `[FAIL] not a file or directory: ${input}`,
      );
  }
  const texts: { path: string; text: string }[] = [];
  for (const t of targets) {
    try {
      texts.push({
        path: t === "-" ? "<stdin>" : t,
        text: fs.readFileSync(t === "-" ? 0 : t, "utf8"),
      });
    } catch {
      return fail(3, "precondition", `cannot read ${t}`, `[FAIL] not readable: ${t}`);
    }
  }

  interface Ln {
    n: number;
    ind: number;
    t: string;
  }
  const stripComment = (s: string): string => {
    let q = "";
    for (let i = 0; i < s.length; i++) {
      const c = s[i] as string;
      if (q !== "") {
        if (c === q) q = "";
      } else if (c === '"' || c === "'") q = c;
      else if (c === "#" && (i === 0 || /\s/.test(s[i - 1] as string))) return s.slice(0, i);
    }
    return s;
  };
  const scan = (text: string): Ln[] => {
    const raw = text.split(/\r?\n/);
    const out: Ln[] = [];
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i] as string;
      if (/^\s*(#.*)?$/.test(r) || /^(---|\.\.\.)\s*$/.test(r)) continue;
      const ind = r.length - r.trimStart().length;
      const t = stripComment(r).trim();
      out.push({ n: i + 1, ind, t });
      if (/(?:^|:\s+|-\s+)[|>][0-9+-]*$/.test(t)) {
        const pre = /^(?:-\s+)*/.exec(t)?.[0].length ?? 0;
        const eff = /^(?:-\s+)*[|>]/.test(t) ? ind : ind + pre;
        while (i + 1 < raw.length) {
          const nx = raw[i + 1] as string;
          if (nx.trim() !== "" && nx.length - nx.trimStart().length <= eff) break;
          i++;
        }
      }
    }
    return out;
  };
  const kv = (t: string): { key: string; value: string } | undefined => {
    const m = /^(?:-\s+)*("[^"]*"|'[^']*'|[^\s:#[{][^:]*?)\s*:(?:\s+(.*))?$/.exec(t);
    if (m === null) return undefined;
    return { key: (m[1] as string).replace(/^["']|["']$/g, ""), value: (m[2] ?? "").trim() };
  };
  const ANCHOR = /^(?:-\s+)*(?:(?:"[^"]*"|'[^']*'|[^\s:#][^:]*?):\s+)?[&*][A-Za-z0-9_-]+(?:\s|$)/;
  const MERGE = /^(?:-\s+)*<<:/;

  interface Perm {
    kind: "write-all" | "read-all" | "map" | "unparsed";
    writes: { scope: string; n: number }[];
  }
  const readPerm = (lines: Ln[], at: number, value: string): Perm => {
    const writes: { scope: string; n: number }[] = [];
    const pair = (s: string, n: number): boolean => {
      const m = /^["']?([A-Za-z-]+)["']?\s*:\s*["']?([a-z-]+)["']?$/.exec(s.trim());
      if (m === null) return false;
      if (m[2] === "write") writes.push({ scope: m[1] as string, n });
      return true;
    };
    const line = lines[at] as Ln;
    const v = value.replace(/^["']|["']$/g, "");
    if (v === "write-all" || v === "read-all") return { kind: v, writes };
    if (value !== "") {
      if (!/^\{[^{}[\]]*\}$/.test(value)) return { kind: "unparsed", writes };
      const body = value.slice(1, -1).trim();
      const ok = body === "" || body.split(",").every((p) => pair(p, line.n));
      return { kind: ok ? "map" : "unparsed", writes };
    }
    let ok = true;
    for (let i = at + 1; i < lines.length && (lines[i] as Ln).ind > line.ind; i++)
      ok = pair((lines[i] as Ln).t, (lines[i] as Ln).n) && ok;
    return { kind: ok ? "map" : "unparsed", writes };
  };

  const notChecked: string[] = [];
  const check = (path: string, text: string): Finding[] => {
    const found: Finding[] = [];
    const add = (rule: string, n: number, message: string, severity: "error" | "warning"): void => {
      found.push({ rule, message, path, line: n, severity });
    };
    const unparsed = (n: number, what: string): void =>
      add(
        "unparsed",
        n,
        `line ${n} uses ${what} that this check cannot read, so the permissions are not verified on it: write the plain block form or review by hand`,
        "warning",
      );
    const lines = scan(text);
    for (const l of lines) {
      if (ANCHOR.test(l.t) || MERGE.test(l.t)) unparsed(l.n, "a YAML anchor, alias or merge key");
    }
    const jobsAt = lines.findIndex((l) => l.ind === 0 && kv(l.t)?.key === "jobs");
    if (jobsAt < 0) {
      notChecked.push(path); // a composite action.yml: a clean pass, but not examined
      return found;
    }
    const jobsLine = lines[jobsAt] as Ln;
    const report = (p: Perm, n: number, top: boolean): void => {
      if (p.kind === "write-all")
        add(
          "permissions-write-all",
          n,
          "permissions: write-all grants every scope to the token: list only the scopes needed, for example contents: read, and raise one scope on the job that needs it",
          "error",
        );
      else if (p.kind === "unparsed")
        unparsed(n, "a permissions: value (multi-line or nested flow mapping, or an expression)");
      else if (top)
        for (const w of p.writes)
          add(
            "permissions-broad",
            w.n,
            `the top-level permissions grant ${w.scope}: write to every job: move it to the job that needs it unless every job does`,
            "warning",
          );
    };

    const topAt = lines.findIndex((l) => l.ind === 0 && kv(l.t)?.key === "permissions");
    if (topAt >= 0) {
      const top = lines[topAt] as Ln;
      report(readPerm(lines, topAt, kv(top.t)?.value ?? ""), top.n, true);
    }

    const jobs: { at: number; end: number }[] = [];
    if ((kv(jobsLine.t)?.value ?? "") !== "") unparsed(jobsLine.n, "an inline jobs: value");
    else {
      let stop = lines.findIndex((l, i) => i > jobsAt && l.ind === 0);
      if (stop < 0) stop = lines.length;
      const j = (lines[jobsAt + 1] as Ln | undefined)?.ind ?? 0;
      for (let i = jobsAt + 1; i < stop; i++) {
        const l = lines[i] as Ln;
        if (l.ind !== j || kv(l.t) === undefined) continue;
        const prev = jobs[jobs.length - 1];
        if (prev !== undefined) prev.end = i;
        jobs.push({ at: i, end: stop });
      }
    }

    let firstMissing: number | undefined;
    for (const job of jobs) {
      const head = lines[job.at] as Ln;
      const alias = (kv(head.t)?.value ?? "").startsWith("*");
      const c = (lines[job.at + 1] as Ln | undefined)?.ind ?? 0;
      const own = lines
        .slice(job.at + 1, job.end)
        .findIndex((l) => l.ind === c && kv(l.t)?.key === "permissions");
      const merge = lines.slice(job.at + 1, job.end).some((l) => l.ind === c && MERGE.test(l.t));
      if (own >= 0) {
        const at = job.at + 1 + own;
        report(
          readPerm(lines, at, kv((lines[at] as Ln).t)?.value ?? ""),
          (lines[at] as Ln).n,
          false,
        );
      } else if (!alias && !merge && firstMissing === undefined) firstMissing = head.n;
    }
    if (topAt < 0 && (jobs.length === 0 || firstMissing !== undefined))
      add(
        "permissions-missing",
        firstMissing ?? jobsLine.n,
        "no top-level permissions: key and a job without its own: add a top-level permissions: block with contents: read and raise a scope only on the job that needs it",
        "error",
      );
    return found.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  };

  const findings = texts.flatMap((f) => check(f.path, f.text));
  const errors = findings.filter((f) => f.severity !== "warning").length;
  const warnings = findings.length - errors;
  const files = texts.map((f) => f.path);
  const summary =
    errors === 0
      ? `[OK] ${files.length - notChecked.length} workflow file(s) checked, no permissions finding${warnings > 0 ? ` (${warnings} warning(s))` : ""}${notChecked.length > 0 ? ` (${notChecked.length} file(s) without a jobs: key, not checked: ${notChecked.join(", ")})` : ""}`
      : `${errors} error(s) and ${warnings} warning(s) in ${files.length} workflow file(s)`;
  emit(errors === 0 ? 0 : 1, { files, errors, warnings }, findings, summary);
})();
