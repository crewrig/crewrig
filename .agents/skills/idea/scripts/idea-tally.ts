// idea-tally.ts — tally an IDEA session: current candidate, counted votes, threshold.
// Usage: node idea-tally.ts (--issue <N> [--repo <owner/name>] | --comments-file <file|->) [options]
// Read-only: the only external call is `gh issue view --json`, bounded by a timeout.
// Exit codes: 0 tallied, 1 no usable candidate, 2 usage error, 3 input or environment failure.
// Self-contained on purpose: no import, built-ins through process.getBuiltinModule.

process.removeAllListeners("warning");

void (() => {
  const fs = process.getBuiltinModule("node:fs");
  const cp = process.getBuiltinModule("node:child_process");

  const NAME = "idea-tally.ts";
  const USAGE = `Usage: node ${NAME} --issue <N> [--repo <owner/name>] [options]
       node ${NAME} --comments-file <file|-> [options]

Tallies an IDEA session from its session issue: the latest valid [CANDIDATE]
comment, the VOTE comments after it, and the governance threshold.

Input:
  --issue <N>            read the session issue through "gh issue view N --json body,comments"
                         (read-only, 20 s timeout; exit 3 when gh cannot run)
  --repo <owner/name>    pass -R to gh
  --comments-file <f|->  read the same JSON from a file or standard input: either
                         {"body": "...", "comments": [...]} or a bare array of comments.
                         A comment is {author: {login}|string, body, in_reply_to?}; the
                         order of the array is the posting order.
Governance (read from the issue body unless given; options win):
  --mode <solo|unanimity|vote>   body line "**Governance mode:** <mode>"
  --owner <login>                body line "**Owner:** <login>"           (solo)
  --owners <a,b,...>             body line "**Owners:** a, b"             (unanimity)
  --voters <a,b,...>             body line "**Voters:** a, b"             (vote)
  --quorum <pct>                 body line "**Quorum:** 60"               (vote, 1-100)
Other:
  --json                 print one JSON object {ok, data, findings} on stdout
  --help                 print this text

Rules applied: a [CANDIDATE] comment (first line "[CANDIDATE] Proposal: <title>")
is valid when <title> names a proposal ("## Proposal: <title>" or "[COMPOSITION]
Proposal: <title>") posted earlier and not rejected by "[TRIAGE-REJECTED] Proposal:
<title>". The latest valid one wins; an invalid one designates nothing. With no
[CANDIDATE] comment at all and exactly one surviving proposal, that proposal is the
implicit candidate. Only comments after the designation count; a vote is a top-level
comment that is exactly "VOTE: APPROVE", "VOTE: REJECT" or "VOTE: ABSTAIN" from a
declared owner or voter, and a voter's latest counted vote stands.
Thresholds: solo, the owner approves; unanimity, every owner approves; vote,
approve / (approve + reject) * 100 >= quorum with at least one non-abstain vote.

data: {mode, candidate, implicit, votes: {approve, reject, abstain, by_voter},
       missing, voided_votes, ignored, threshold_met}
Exit codes: 0 tallied, 1 no usable candidate (candidate-required, no-proposals),
2 usage error, 3 precondition failed (unreadable input, gh unavailable, governance
parameters missing).
`;

  interface Finding {
    rule: string;
    message: string;
    severity?: "error" | "warning";
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
  const preconditionError = (message: string): void =>
    emit(3, null, [{ rule: "precondition", message }], `${NAME}: ${message}`);

  const VALUED = [
    "--issue",
    "--repo",
    "--comments-file",
    "--mode",
    "--owner",
    "--owners",
    "--voters",
    "--quorum",
  ];
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] as string;
    if (raw === "--json") continue;
    const eq = raw.startsWith("--") ? raw.indexOf("=") : -1;
    const key = eq === -1 ? raw : raw.slice(0, eq);
    if (!VALUED.includes(key))
      return usageError(
        raw.startsWith("-") && raw !== "-" ? `unknown option ${raw}` : `unexpected argument ${raw}`,
      );
    const value = eq !== -1 ? raw.slice(eq + 1) : argv[++i];
    if (value === undefined) return usageError(`${key} needs a value`);
    opts[key] = value;
  }
  if ((opts["--issue"] === undefined) === (opts["--comments-file"] === undefined))
    return usageError("give exactly one of --issue <N> or --comments-file <file|->");
  if (opts["--issue"] !== undefined && !/^[1-9]\d*$/.test(opts["--issue"]))
    return usageError("--issue must be a positive integer");
  if (opts["--mode"] !== undefined && !["solo", "unanimity", "vote"].includes(opts["--mode"]))
    return usageError("--mode must be solo, unanimity or vote");
  if (opts["--quorum"] !== undefined && !/^(?:[1-9]\d?|100)$/.test(opts["--quorum"]))
    return usageError("--quorum must be an integer from 1 to 100");

  // ---- read the session issue ----
  let raw: string;
  if (opts["--issue"] !== undefined) {
    const args = ["issue", "view", opts["--issue"], "--json", "body,comments"];
    if (opts["--repo"] !== undefined) args.push("-R", opts["--repo"]);
    const r = cp.spawnSync("gh", args, { encoding: "utf8", timeout: 20_000, maxBuffer: 64 << 20 });
    if (r.error !== undefined || r.status !== 0)
      return preconditionError(
        `cannot read the session issue through gh: ${r.error?.message ?? (r.stderr || `exit ${r.status}`).trim()}`,
      );
    raw = r.stdout;
  } else {
    const file = opts["--comments-file"] as string;
    try {
      raw = fs.readFileSync(file === "-" ? 0 : file, "utf8");
    } catch (e) {
      return preconditionError(
        `cannot read ${file === "-" ? "standard input" : file}: ${(e as Error).message}`,
      );
    }
  }
  interface Comment {
    author: string;
    body: string;
    reply: boolean;
  }
  let body = "";
  let comments: Comment[];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed) ? parsed : (parsed as { comments?: unknown }).comments;
    if (!Array.isArray(list)) throw new Error("no comments array");
    if (!Array.isArray(parsed)) body = String((parsed as { body?: unknown }).body ?? "");
    comments = list.map((c: Record<string, unknown>) => {
      const a = (c["author"] ?? c["user"]) as unknown;
      const login =
        typeof a === "string" ? a : String((a as { login?: unknown } | undefined)?.login ?? "");
      return {
        author: login.toLowerCase(),
        body: String(c["body"] ?? ""),
        reply: Boolean(c["in_reply_to"] ?? c["inReplyTo"] ?? c["parent_id"]),
      };
    });
  } catch (e) {
    return preconditionError(`the issue JSON is not usable: ${(e as Error).message}`);
  }

  // ---- governance ----
  const field = (label: string): string | undefined =>
    new RegExp(`^\\*\\*${label}:\\*\\*[ \\t]*(.+?)[ \\t]*$`, "mi").exec(body)?.[1];
  const list = (s: string | undefined): string[] =>
    (s ?? "")
      .split(",")
      .map((x) => x.trim().replace(/^@/, "").toLowerCase())
      .filter((x) => x !== "");
  const mode = (opts["--mode"] ?? field("Governance mode"))?.toLowerCase();
  if (mode !== "solo" && mode !== "unanimity" && mode !== "vote")
    return preconditionError("the governance mode is not in the issue body; pass --mode");
  const owner = list(opts["--owner"] ?? field("Owner"));
  const owners = list(opts["--owners"] ?? field("Owners"));
  const voters = list(opts["--voters"] ?? field("Voters"));
  const quorumText = opts["--quorum"] ?? field("Quorum")?.replace(/\s*%$/, "");
  const quorum = quorumText === undefined ? NaN : Number(quorumText);
  const eligible = mode === "solo" ? owner.slice(0, 1) : mode === "unanimity" ? owners : voters;
  if (eligible.length === 0)
    return preconditionError(
      `no ${mode === "solo" ? "owner" : mode === "unanimity" ? "owners" : "voters"} declared; pass the matching option`,
    );
  if (mode === "vote" && !(Number.isInteger(quorum) && quorum >= 1 && quorum <= 100))
    return preconditionError("the quorum is not in the issue body; pass --quorum");

  // ---- candidate ----
  const findings: Finding[] = [];
  const firstLine = (s: string): string => (s.trim().split("\n")[0] ?? "").trim();
  const survivors = new Set<string>();
  let anyCandidate = false;
  let candidate: string | null = null;
  let candIdx = -1;
  let soleSince = -1;
  comments.forEach((c, i) => {
    if (c.reply) return;
    const line = firstLine(c.body);
    let m: RegExpExecArray | null;
    if ((m = /^## Proposal: (.+)$/.exec(line) ?? /^\[COMPOSITION\] Proposal: (.+)$/.exec(line)))
      survivors.add((m[1] as string).trim());
    else if ((m = /^\[TRIAGE-REJECTED\] Proposal: (.+)$/.exec(line)))
      survivors.delete((m[1] as string).trim());
    else if ((m = /^\[CANDIDATE\] Proposal: (.+)$/.exec(line))) {
      anyCandidate = true;
      const title = (m[1] as string).trim();
      if (survivors.has(title)) {
        candidate = title;
        candIdx = i;
      } else
        findings.push({
          rule: "invalid-candidate",
          severity: "warning",
          message: `the [CANDIDATE] comment ${i + 1} names "${title}", which is not a surviving proposal; it designates nothing.`,
        });
    } else return;
    if (survivors.size === 1 && soleSince === -1) soleSince = i;
    else if (survivors.size !== 1) soleSince = -1;
  });
  let implicit = false;
  if (candidate === null && !anyCandidate && survivors.size === 1) {
    candidate = [...survivors][0] as string;
    candIdx = soleSince - 1;
    implicit = true;
  }

  // ---- votes ----
  const byVoter: Record<string, string> = {};
  const ignored: { author: string; reason: string }[] = [];
  let voided = 0;
  comments.forEach((c, i) => {
    if (c.reply || !/^VOTE:/.test(c.body.trim())) return;
    const vote = /^VOTE: (APPROVE|REJECT|ABSTAIN)$/.exec(c.body.trim())?.[1];
    if (vote === undefined) {
      ignored.push({ author: c.author, reason: "malformed" });
      findings.push({
        rule: "malformed-vote",
        severity: "warning",
        message: `comment ${i + 1} by ${c.author} starts with VOTE: but is not one of the three exact forms; not counted.`,
      });
    } else if (!eligible.includes(c.author)) {
      ignored.push({ author: c.author, reason: "not-eligible" });
      findings.push({
        rule: "ineligible-vote",
        severity: "warning",
        message: `${c.author} is not a declared ${mode === "vote" ? "voter" : "owner"}; the vote is not counted.`,
      });
    } else if (candidate === null || i <= candIdx) {
      if (candidate !== null) voided++;
    } else {
      if (c.author in byVoter)
        findings.push({
          rule: "duplicate-vote",
          severity: "warning",
          message: `${c.author} voted more than once; the latest vote stands.`,
        });
      byVoter[c.author] = vote;
    }
  });
  const count = (v: string): number => Object.values(byVoter).filter((x) => x === v).length;
  const approve = count("APPROVE");
  const reject = count("REJECT");
  const abstain = count("ABSTAIN");
  const missing = eligible.filter((v) => !(v in byVoter));

  let met = false;
  if (candidate !== null) {
    if (mode === "vote")
      met = approve + reject >= 1 && approve * 100 >= quorum * (approve + reject);
    else met = eligible.every((v) => byVoter[v] === "APPROVE");
  }
  if (candidate === null) {
    findings.push(
      survivors.size === 0
        ? {
            rule: "no-proposals",
            message: "no proposal survives triage in this session; there is nothing to vote on.",
          }
        : {
            rule: "candidate-required",
            message: `${survivors.size} proposals survive triage and no valid [CANDIDATE] comment designates one; the owner must post "[CANDIDATE] Proposal: <title>" before votes can count.`,
          },
    );
  }
  const data = {
    mode,
    candidate,
    implicit,
    votes: { approve, reject, abstain, by_voter: byVoter },
    missing,
    voided_votes: voided,
    ignored,
    threshold_met: met,
  };
  const hasError = findings.some((f) => (f.severity ?? "error") === "error");
  const summary = `${NAME}: candidate ${candidate ?? "none"}; APPROVE=${approve} REJECT=${reject} ABSTAIN=${abstain}; threshold ${met ? "met" : "not met"}${missing.length ? `; no vote from ${missing.join(", ")}` : ""}`;
  if (!json)
    for (const f of findings)
      process.stdout.write(`${f.severity ?? "error"} [${f.rule}] ${f.message}\n`);
  emit(hasError ? 1 : 0, data, findings, summary);
})();
