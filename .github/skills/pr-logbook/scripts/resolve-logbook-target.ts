// resolve-logbook-target.ts — decide where a pull request's logbook entry goes.
// Usage: node resolve-logbook-target.ts --body-file <file|-> [--json]
// A closing reference (`Fixes #12`, `closes: #40`) outside code makes the first referenced issue
// the logbook (mode feature-issue); with none, the entry needs a standalone logbook issue.
// Exit codes: 0 resolved (either mode), 2 usage error, 3 unreadable body. Never exits 1, never
// touches the network. Contract: references/script-contract.md.
// Self-contained on purpose: no import, built-ins through process.getBuiltinModule.

process.removeAllListeners("warning");

void (async () => {
  const fs = process.getBuiltinModule("node:fs");

  const NAME = "resolve-logbook-target.ts";
  const USAGE = `Usage: node ${NAME} --body-file <file|-> [--json]

Reads a pull-request body and reports where its logbook entry goes.

Options:
  --body-file <file|->  the body; "-" reads standard input
  --json                print one JSON object {ok, data, findings} on stdout
  --help                print this text

data: {mode, issue, issues, label_required}
  mode "feature-issue": the body closes at least one issue; issue is the first one,
                        issues lists every one in order of first appearance, label_required false.
  mode "standalone":    no closing reference; issue null, issues [], label_required true.
A closing reference is a GitHub closing keyword (close, fix, resolve and their s/d forms,
any case) then "#N" or ": #N", outside inline code and fenced code. "owner/repo#N" does not count.

Exit codes: 0 resolved, 2 usage error, 3 precondition failed.
`;

  interface Finding {
    rule: string;
    message: string;
  }
  const argv = process.argv.slice(2);
  let json = false;
  const emit = (code: number, data: unknown, findings: Finding[], summary: string): void => {
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: code === 0, data, findings })}\n`);
      process.stderr.write(`${summary}\n`);
    } else (code >= 2 ? process.stderr : process.stdout).write(`${summary}\n`);
    process.exitCode = code;
  };
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
  json = argv.includes("--json");
  const usageError = (message: string): void =>
    emit(2, null, [{ rule: "usage", message }], `${NAME}: ${message}\n${USAGE.split("\n")[0]}`);

  let bodyFile: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] as string;
    if (raw === "--json") continue;
    const eq = raw.startsWith("--") ? raw.indexOf("=") : -1;
    const key = eq === -1 ? raw : raw.slice(0, eq);
    if (key !== "--body-file")
      return usageError(
        raw.startsWith("-") && raw !== "-" ? `unknown option ${raw}` : `unexpected argument ${raw}`,
      );
    const value = eq !== -1 ? raw.slice(eq + 1) : argv[++i];
    if (value === undefined) return usageError("--body-file needs a value");
    bodyFile = value;
  }
  if (bodyFile === undefined) return usageError("a body is required: --body-file <file|->");

  let body: string;
  try {
    body = fs.readFileSync(bodyFile === "-" ? 0 : bodyFile, "utf8");
  } catch (e) {
    emit(
      3,
      null,
      [{ rule: "precondition", message: `cannot read the body: ${(e as Error).message}` }],
      `${NAME}: cannot read the body ${bodyFile === "-" ? "(standard input)" : bodyFile}: ${(e as Error).message}`,
    );
    return;
  }

  /** The text with fenced blocks and inline code spans replaced by a space. */
  const withoutCode = (text: string): string => {
    const lines = text.split("\n");
    const kept: string[] = [];
    let open: { ch: string; len: number } | undefined;
    for (const line of lines) {
      const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.replace(/\r$/, ""));
      if (open === undefined) {
        if (m !== null && !(m[1]?.startsWith("`") && (m[2] ?? "").includes("`")))
          open = { ch: (m[1] as string)[0] as string, len: (m[1] as string).length };
        else kept.push(line);
      } else if (
        m !== null &&
        (m[1] as string)[0] === open.ch &&
        (m[1] as string).length >= open.len &&
        (m[2] ?? "").trim() === ""
      )
        open = undefined;
    }
    const text2 = kept.join("\n");
    let out = "";
    for (let i = 0; i < text2.length;) {
      if (text2[i] !== "`") {
        out += text2[i++];
        continue;
      }
      let j = i;
      while (text2[j] === "`") j++;
      const run = j - i;
      let k = j;
      let end = -1;
      while (k < text2.length) {
        if (text2[k] !== "`") {
          k++;
          continue;
        }
        let e = k;
        while (text2[e] === "`") e++;
        if (e - k === run) {
          end = e;
          break;
        }
        k = e;
      }
      if (end === -1) {
        out += text2.slice(i, j);
        i = j;
      } else {
        out += " ";
        i = end;
      }
    }
    return out;
  };

  const re =
    /\b(?:closes|closed|close|fixes|fixed|fix|resolves|resolved|resolve)\b:?[ \t]+#(\d+)\b/gi;
  const issues: number[] = [];
  for (const m of withoutCode(body).matchAll(re)) {
    const n = Number.parseInt(m[1] as string, 10);
    if (!issues.includes(n)) issues.push(n);
  }
  const feature = issues.length > 0;
  const data = {
    mode: feature ? "feature-issue" : "standalone",
    issue: feature ? (issues[0] as number) : null,
    issues,
    label_required: !feature,
  };
  emit(
    0,
    data,
    [],
    feature
      ? `${NAME}: feature-issue, append the entry to #${data.issue} (closes ${issues.map((n) => `#${n}`).join(", ")})`
      : `${NAME}: standalone, open a logbook issue carrying the logbook label`,
  );
})();
