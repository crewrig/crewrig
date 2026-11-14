// idea-close.ts — close an IDEA session issue with its terminal label and closing comment.
// Usage: node idea-close.ts --issue <N> --outcome <resolved|no-consensus> --parent <N> [options]
// Forge writer: runs `gh issue comment`, `gh issue edit --add-label`, `gh issue close`;
// --dry-run prints the commands and the comment and runs none.
// Exit codes: 0 ok, 1 refused (threshold not met, winner mismatch), 2 usage error, 3 gh failed.
// Self-contained on purpose: no import, built-ins through process.getBuiltinModule.

process.removeAllListeners("warning");

void (() => {
  const fs = process.getBuiltinModule("node:fs");
  const cp = process.getBuiltinModule("node:child_process");

  const NAME = "idea-close.ts";
  const USAGE = `Usage: node ${NAME} --issue <N> --outcome resolved --parent <N> --spec <N:description> [...] (--tally-file <f|-> | --winner <t> --approve <n> --reject <n> --abstain <n>)
       node ${NAME} --issue <N> --outcome no-consensus --parent <N> --reason <text>

Posts the closing comment on the session issue, adds its single terminal label
(idea-resolved or idea-no-consensus) and closes it.

Options:
  --issue <N>          the session issue (required)
  --outcome <o>        resolved or no-consensus (required)
  --parent <N>         the parent issue number (required)
  --spec <N:desc>      resolved: a SPECS issue created from the winner; repeat for each (at least one)
  --tally-file <f|->   resolved: the output of idea-tally.ts --json (or its data object); supplies the
                       winner and the counts, and refuses to close when threshold_met is false
  --winner <title>     resolved: the winning proposal (default: the tally's candidate)
  --approve/--reject/--abstain <n>  resolved: the final counts when no tally file is given
  --reason <text>      no-consensus: why the session closes without consensus (required)
  --repo <owner/name>  pass -R to gh
  --dry-run            print the commands and the comment, run nothing
  --json               print one JSON object {ok, data, findings} on stdout
  --help               print this text

The SPECS issues are created first (their numbers go into --spec); this script does not create them.

data: {outcome, label, comment, commands}
Exit codes: 0 ok, 1 refused (threshold-not-met, winner-mismatch), 2 usage error,
3 a gh call or the tally file failed.
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

  const VALUED = [
    "--issue",
    "--outcome",
    "--parent",
    "--spec",
    "--tally-file",
    "--winner",
    "--approve",
    "--reject",
    "--abstain",
    "--reason",
    "--repo",
  ];
  const opts: Record<string, string> = {};
  const specs: string[] = [];
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] as string;
    if (raw === "--json") continue;
    if (raw === "--dry-run") {
      dryRun = true;
      continue;
    }
    const eq = raw.startsWith("--") ? raw.indexOf("=") : -1;
    const key = eq === -1 ? raw : raw.slice(0, eq);
    if (!VALUED.includes(key))
      return usageError(
        raw.startsWith("-") && raw !== "-" ? `unknown option ${raw}` : `unexpected argument ${raw}`,
      );
    const value = eq !== -1 ? raw.slice(eq + 1) : argv[++i];
    if (value === undefined) return usageError(`${key} needs a value`);
    if (key === "--spec") specs.push(value);
    else opts[key] = value;
  }
  const outcome = opts["--outcome"];
  if (outcome !== "resolved" && outcome !== "no-consensus")
    return usageError("--outcome is required and must be resolved or no-consensus");
  const num = /^[1-9]\d*$/;
  const issue = opts["--issue"];
  const parent = opts["--parent"];
  if (issue === undefined || !num.test(issue))
    return usageError("--issue is required and must be a positive integer");
  if (parent === undefined || !num.test(parent))
    return usageError("--parent is required and must be a positive integer");

  const findings: Finding[] = [];
  let comment: string;
  let label: string;
  if (outcome === "no-consensus") {
    const reason = (opts["--reason"] ?? "").trim();
    if (reason === "") return usageError("--reason is required for no-consensus");
    label = "idea-no-consensus";
    comment = `## IDEA Session — Closed Without Consensus

**Reason:** ${reason}

No SPECS issue has been created. The parent issue #${parent} remains open.
A new IDEA session may be opened against the same parent issue.
`;
  } else {
    if (specs.length === 0) return usageError("resolved needs at least one --spec <N:description>");
    const items: string[] = [];
    for (const s of specs) {
      const m = /^#?([1-9]\d*):\s*(.+)$/.exec(s);
      if (m === null) return usageError(`--spec "${s}" must look like 123:brief description`);
      items.push(`- #${m[1]}: ${m[2]}`);
    }
    let winner: string | undefined = opts["--winner"];
    let counts: [number, number, number] | undefined;
    if (opts["--tally-file"] !== undefined) {
      const file = opts["--tally-file"];
      let t: {
        candidate?: string | null;
        threshold_met?: boolean;
        votes?: { approve: number; reject: number; abstain: number };
      };
      try {
        const parsed = JSON.parse(fs.readFileSync(file === "-" ? 0 : file, "utf8")) as {
          data?: typeof t;
        } & typeof t;
        t = parsed.data ?? parsed;
        if (t.votes === undefined || typeof t.threshold_met !== "boolean")
          throw new Error("not an idea-tally.ts result");
      } catch (e) {
        return emit(
          3,
          null,
          [{ rule: "precondition", message: `cannot use the tally file: ${(e as Error).message}` }],
          `${NAME}: cannot use the tally file: ${(e as Error).message}`,
        );
      }
      if (!t.threshold_met)
        findings.push({
          rule: "threshold-not-met",
          message:
            "the tally says the governance threshold is not met; keep the session open or close it with --outcome no-consensus.",
        });
      if (winner !== undefined && t.candidate !== null && winner !== t.candidate)
        findings.push({
          rule: "winner-mismatch",
          message: `--winner "${winner}" differs from the tally's candidate "${t.candidate}".`,
        });
      winner ??= t.candidate ?? undefined;
      counts = [t.votes.approve, t.votes.reject, t.votes.abstain];
    } else {
      const c = ["--approve", "--reject", "--abstain"].map((k) => opts[k]);
      if (c.some((v) => v === undefined || !/^\d+$/.test(v)))
        return usageError(
          "give --tally-file or all of --approve, --reject and --abstain as integers",
        );
      counts = c.map(Number) as [number, number, number];
    }
    if (winner === undefined || winner.trim() === "")
      return usageError("--winner is required without a tally candidate");
    if (findings.length > 0) {
      const text = findings.map((f) => `[${f.rule}] ${f.message}`).join("\n");
      return emit(1, null, findings, `${NAME}: refused\n${text}`);
    }
    label = "idea-resolved";
    comment = `## IDEA Session — Resolved

**Winning proposal:** ${winner}
**Vote tally:** APPROVE: ${counts[0]}, REJECT: ${counts[1]}, ABSTAIN: ${counts[2]}

The session is closed. The following SPECS issue(s) have been created:
${items.join("\n")}

**Parent issue:** #${parent}
**IDEA session:** this issue (closed \`idea-resolved\`)
`;
  }
  const repo = opts["--repo"] === undefined ? [] : ["-R", opts["--repo"]];
  const calls = [
    ["issue", "comment", issue, "--body", comment, ...repo],
    ["issue", "edit", issue, "--add-label", label, ...repo],
    ["issue", "close", issue, ...repo],
  ];
  const quote = (s: string): string =>
    /^[\w@%+=:,./#-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
  const commands = calls.map((a) => `gh ${a.map(quote).join(" ")}`);
  const data = { outcome, label, comment, commands };
  if (dryRun) {
    if (!json) process.stdout.write(`${commands.join("\n")}\n`);
    return emit(0, data, [], `${NAME}: dry run, nothing was changed`);
  }
  for (const [i, args] of calls.entries()) {
    const r = cp.spawnSync("gh", args, { encoding: "utf8", timeout: 60_000 });
    if (r.error !== undefined || r.status !== 0) {
      const why = r.error?.message ?? (r.stderr || `exit ${r.status}`).trim();
      return emit(
        3,
        null,
        [{ rule: "precondition", message: `${commands[i]} failed: ${why}` }],
        `${NAME}: ${commands[i]} failed: ${why}`,
      );
    }
  }
  emit(0, data, [], `${NAME}: session #${issue} closed with ${label}`);
})();
