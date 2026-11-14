// idea-open.ts — open an IDEA session issue and log the opening on the parent issue.
// Usage: node idea-open.ts --mode <solo|unanimity|vote> --issue <N> --description <text> [options]
// Forge writer: runs `gh issue create` then `gh issue comment`; --dry-run prints both commands
// and runs neither. Exit codes: 0 ok, 2 usage error, 3 gh failed or is unavailable.
// Self-contained on purpose: no import, built-ins through process.getBuiltinModule.

process.removeAllListeners("warning");

void (() => {
  const cp = process.getBuiltinModule("node:child_process");

  const NAME = "idea-open.ts";
  const USAGE = `Usage: node ${NAME} --mode <solo|unanimity|vote> --issue <N> --description <text> [options]

Opens an IDEA session: creates the session issue ("[IDEA] <description> (parent #N)",
labels idea-session and idea-<mode>) and comments on the parent issue.

Options:
  --mode <m>           solo, unanimity or vote (required)
  --issue <N>          parent issue number (required)
  --description <t>    brief description used in the title and the body (required)
  --owner <login>      solo: the single decision authority (required for solo)
  --owners <a,b,...>   unanimity: every identity that must approve (required)
  --voters <a,b,...>   vote: the voter set (required)
  --quorum <pct>       vote: integer 1-100 (required)
  --dimensions <a;b>   replace the default comparison dimensions (semicolon separated)
  --repo <owner/name>  pass -R to gh
  --dry-run            print the gh commands and the issue body, run nothing
  --json               print one JSON object {ok, data, findings} on stdout
  --help               print this text

Governance parameters are fixed at creation: the body records them and the session
cannot change them later.

data: {title, labels, body, commands, session_issue}   (session_issue is null under --dry-run)
Exit codes: 0 ok, 2 usage error, 3 a gh call failed or gh is unavailable.
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
    "--mode",
    "--issue",
    "--description",
    "--owner",
    "--owners",
    "--voters",
    "--quorum",
    "--dimensions",
    "--repo",
  ];
  const opts: Record<string, string> = {};
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
    opts[key] = value;
  }
  const mode = opts["--mode"];
  if (mode !== "solo" && mode !== "unanimity" && mode !== "vote")
    return usageError("--mode is required and must be solo, unanimity or vote");
  const parent = opts["--issue"];
  if (parent === undefined || !/^[1-9]\d*$/.test(parent))
    return usageError("--issue is required and must be a positive integer");
  const description = (opts["--description"] ?? "").trim();
  if (description === "") return usageError("--description is required");
  const ids = (s: string | undefined): string[] =>
    (s ?? "")
      .split(",")
      .map((x) => x.trim().replace(/^@/, ""))
      .filter((x) => x !== "");
  let params: string;
  if (mode === "solo") {
    const owner = ids(opts["--owner"]);
    if (owner.length !== 1) return usageError("solo mode needs exactly one --owner <login>");
    params = `**Owner:** ${owner[0]}`;
  } else if (mode === "unanimity") {
    const owners = ids(opts["--owners"]);
    if (owners.length === 0) return usageError("unanimity mode needs --owners <a,b,...>");
    params = `**Owners:** ${owners.join(", ")}`;
  } else {
    const voters = ids(opts["--voters"]);
    if (voters.length === 0) return usageError("vote mode needs --voters <a,b,...>");
    const q = opts["--quorum"];
    if (q === undefined || !/^(?:[1-9]\d?|100)$/.test(q))
      return usageError("vote mode needs --quorum <integer 1-100>");
    params = `**Voters:** ${voters.join(", ")}\n**Quorum:** ${q}`;
  }
  const dimensions =
    opts["--dimensions"] === undefined
      ? "default (implementation complexity; architectural alignment; reversibility)"
      : opts["--dimensions"]
          .split(";")
          .map((d) => d.trim())
          .filter((d) => d !== "")
          .join("; ");
  if (dimensions === "") return usageError("--dimensions lists no dimension");

  const title = `[IDEA] ${description} (parent #${parent})`;
  const labels = ["idea-session", `idea-${mode}`];
  const body = `## IDEA Session — ${description}

**Parent issue:** #${parent}
**Governance mode:** ${mode}
${params}
**Comparison dimensions:** ${dimensions}

---

### Proposals

_Proposals are submitted as comments on this issue using the structured
format defined by the \`idea\` skill. Each accepted proposal is listed here
by the session owner after the triage phase._

### Comparison

_Populated by the session owner after triage._

### Vote tally

_Populated after the governance phase opens._
`;
  const repo = opts["--repo"] === undefined ? [] : ["-R", opts["--repo"]];
  const create = [
    "issue",
    "create",
    "--title",
    title,
    ...labels.flatMap((l) => ["--label", l]),
    "--body",
    body,
    ...repo,
  ];
  const comment = (n: string): string[] => [
    "issue",
    "comment",
    parent,
    "--body",
    `IDEA session opened: #${n} (${mode} mode).`,
    ...repo,
  ];
  const quote = (s: string): string =>
    /^[\w@%+=:,./#-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
  const shown = (args: string[]): string => `gh ${args.map(quote).join(" ")}`;
  const commands = [shown(create), shown(comment("<session-issue>"))];

  if (dryRun) {
    if (!json) process.stdout.write(`${commands.join("\n")}\n`);
    emit(
      0,
      { title, labels, body, commands, session_issue: null },
      [],
      `${NAME}: dry run, nothing was created`,
    );
    return;
  }
  const gh = (args: string[]): { out: string; error?: string } => {
    const r = cp.spawnSync("gh", args, { encoding: "utf8", timeout: 60_000 });
    return r.error !== undefined || r.status !== 0
      ? { out: "", error: r.error?.message ?? (r.stderr || `exit ${r.status}`).trim() }
      : { out: r.stdout };
  };
  const fail = (what: string, error: string): void =>
    emit(
      3,
      null,
      [{ rule: "precondition", message: `${what} failed: ${error}` }],
      `${NAME}: ${what} failed: ${error}`,
    );
  const created = gh(create);
  if (created.error !== undefined) return fail("gh issue create", created.error);
  const n = /\/issues\/(\d+)\s*$/.exec(created.out.trim())?.[1];
  if (n === undefined)
    return fail("gh issue create", `no issue URL in its output: ${created.out.trim()}`);
  const commented = gh(comment(n));
  if (commented.error !== undefined)
    return fail(`gh issue comment on #${parent} (session #${n} was created)`, commented.error);
  emit(
    0,
    { title, labels, body, commands: [shown(create), shown(comment(n))], session_issue: Number(n) },
    [],
    `${NAME}: opened session issue #${n}`,
  );
})();
