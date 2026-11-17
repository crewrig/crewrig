// post-verdict.ts — posts a review verdict through the right transport for the posting identity.
//
// Usage: node post-verdict.ts <pr> --event <approve|request-changes|comment> --body-file <file>
//          [--repo <owner/repo>] [--login <name>] [--author <name>] [--dry-run] [--json]
//
// GitHub rejects an approval or a change request on one's own pull request, so the transport
// depends on who is posting:
//   - distinct identities (the authenticated login differs from the pull-request author):
//     a formal review, `gh pr review <pr> --approve|--request-changes|--comment --body-file <file>`;
//   - the same identity (the usual solo-maintainer case): a plain comment,
//     `gh pr comment <pr> --body-file <file>`, never a review event. The body must open with
//     `## Verdict: APPROVE`, `## Verdict: REQUEST CHANGES` or `## Verdict: COMMENT` matching
//     --event, because that header is the verdict.
// A body over 12288 bytes is refused whatever the transport: move bulk to a linked artifact.
// When the forge refuses the post, the script exits 3 with `data.rung` "denied": return the
// verdict to the orchestrator, never ask another agent to post it, since that would launder a
// permission this session was denied.
// --login and --author give the two identities and skip their lookups; --dry-run resolves the
// transport, prints the command and runs no write. `data` is {rung, command, posted} with rung
// `review`, `comment` or `denied`.
//
// Exit: 0 posted (or planned under --dry-run), 1 the body is refused, 2 usage error, 3 gh is
// missing, an identity cannot be resolved, the body is unreadable or the forge denied the post.
// With --json it prints one {ok, data, findings} object on stdout and the human text on stderr.
// Self-contained on purpose: no import, built-ins through process.getBuiltinModule.

// The body runs inside a function so that these top-level names stay local to the file.
void (() => {
  const fs = process.getBuiltinModule("node:fs");
  const cp = process.getBuiltinModule("node:child_process");

  const BUDGET = 12288;
  const USAGE =
    "Usage: node post-verdict.ts <pr> --event <approve|request-changes|comment> --body-file <file>\n" +
    "         [--repo <owner/repo>] [--login <name>] [--author <name>] [--dry-run] [--json]\n" +
    "  Posts a verdict as a formal review (distinct identities) or a plain comment (same identity).\n" +
    "  Exit 0 posted or planned, 1 body refused, 2 usage error, 3 gh unusable, identity unresolved or post denied.\n";

  const EVENTS: Record<string, { flag: string; header: string }> = {
    approve: { flag: "--approve", header: "## Verdict: APPROVE" },
    "request-changes": { flag: "--request-changes", header: "## Verdict: REQUEST CHANGES" },
    comment: { flag: "--comment", header: "## Verdict: COMMENT" },
  };

  interface Finding {
    rule: string;
    message: string;
  }

  function main(argv: string[]): number {
    let json = false;
    let help = false;
    let dryRun = false;
    let event: string | undefined;
    let bodyFile: string | undefined;
    let repo: string | undefined;
    let login: string | undefined;
    let author: string | undefined;
    let error: string | undefined;
    const positional: string[] = [];
    for (let i = 0; i < argv.length; i++) {
      const raw = argv[i] as string;
      const eq = raw.startsWith("--") ? raw.indexOf("=") : -1;
      const name = eq === -1 ? raw : raw.slice(0, eq);
      const inline = eq === -1 ? undefined : raw.slice(eq + 1);
      const take = (): string | undefined => {
        if (inline !== undefined) return inline;
        i++;
        const v = argv[i];
        if (v === undefined) error ??= `${name} needs a value`;
        return v;
      };
      if (name === "--json") json = true;
      else if (name === "--help" || name === "-h") help = true;
      else if (name === "--dry-run") dryRun = true;
      else if (name === "--event") event = take();
      else if (name === "--body-file") bodyFile = take();
      else if (name === "--repo") repo = take();
      else if (name === "--login") login = take();
      else if (name === "--author") author = take();
      else if (raw.length > 1 && raw.startsWith("-")) error ??= `unknown option ${raw}`;
      else positional.push(raw);
    }
    const human = (s: string): void => {
      (json ? process.stderr : process.stdout).write(`${s}\n`);
    };
    const done = (code: number, data: object | null, findings: Finding[]): number => {
      if (json) process.stdout.write(`${JSON.stringify({ ok: code === 0, data, findings })}\n`);
      return code;
    };
    if (help) {
      process.stdout.write(USAGE);
      return 0;
    }
    if (error === undefined && positional.length !== 1)
      error = "exactly one pull request number is required";
    if (error === undefined && (event === undefined || !(event in EVENTS)))
      error = "--event must be approve, request-changes or comment";
    if (error === undefined && bodyFile === undefined) error = "--body-file is required";
    if (error !== undefined) {
      process.stderr.write(`post-verdict.ts: ${error}\n${USAGE}`);
      return done(2, null, [{ rule: "usage", message: error }]);
    }
    const pr = positional[0] as string;
    const ev = EVENTS[event as string] as { flag: string; header: string };
    const fail = (rule: string, message: string, data: object | null = null): number => {
      human(`post-verdict: ${message}`);
      return done(3, data, [{ rule, message }]);
    };

    let body: Buffer;
    try {
      body = fs.readFileSync(bodyFile as string);
    } catch (err) {
      return fail(
        "precondition",
        `${bodyFile}: ${(err as NodeJS.ErrnoException).code ?? "unreadable"}`,
      );
    }
    if (body.length > BUDGET) {
      const message = `the body is ${body.length} bytes, over the ${BUDGET}-byte budget; move bulk to a linked artifact`;
      human(`post-verdict: ${message}`);
      return done(1, null, [{ rule: "body-size", message }]);
    }

    const gh = (args: string[]): { status: number; stdout: string; stderr: string } => {
      const res = cp.spawnSync("gh", args, { encoding: "utf8" });
      if (res.error !== undefined) return { status: 127, stdout: "", stderr: res.error.message };
      return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
    };
    const repoArgs = repo === undefined ? [] : ["--repo", repo];
    if (login === undefined) {
      const r = gh(["api", "user", "--jq", ".login"]);
      if (r.status !== 0 || r.stdout.trim() === "")
        return fail("precondition", `cannot resolve the authenticated login: ${r.stderr.trim()}`);
      login = r.stdout.trim();
    }
    if (author === undefined) {
      const r = gh(["pr", "view", pr, ...repoArgs, "--json", "author", "--jq", ".author.login"]);
      if (r.status !== 0 || r.stdout.trim() === "")
        return fail("precondition", `cannot resolve the pull-request author: ${r.stderr.trim()}`);
      author = r.stdout.trim();
    }

    const same = login === author;
    const file = bodyFile as string;
    const args = same
      ? ["pr", "comment", pr, ...repoArgs, "--body-file", file]
      : ["pr", "review", pr, ...repoArgs, ev.flag, "--body-file", file];
    const command = ["gh", ...args].join(" ");
    const rung = same ? "comment" : "review";
    if (same) {
      const first =
        body
          .toString("utf8")
          .split(/\r?\n/)
          .find((l) => l.trim() !== "") ?? "";
      if (first.trim() !== ev.header) {
        const message = `with the same identity the body must open with \`${ev.header}\`, found \`${first.trim().slice(0, 60)}\``;
        human(`post-verdict: ${message}`);
        return done(1, { rung, command, posted: false }, [{ rule: "verdict-header", message }]);
      }
    }
    if (dryRun) {
      human(
        `post-verdict: ${same ? "same identity" : "distinct identities"}; would run: ${command}`,
      );
      return done(0, { rung, command, posted: false, dry_run: true }, []);
    }
    const res = gh(args);
    if (res.status !== 0)
      return fail(
        "post-denied",
        `the forge refused the post (${res.stderr.trim()}); return the verdict to the orchestrator, do not ask another agent to post it`,
        { rung: "denied", command, posted: false },
      );
    human(`post-verdict: posted as a ${rung}`);
    return done(0, { rung, command, posted: true }, []);
  }

  process.exitCode = main(process.argv.slice(2));
})();
