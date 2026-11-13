// ci-preflight.ts — classifies the checks of a pull request before a review is written.
//
// Usage: node ci-preflight.ts <pr> [--repo <owner/repo>] [--required] [--wait <attempts>]
//          [--interval <seconds>] [--checks-file <file>] [--json]
//
// Each check is `pass`, `fail` (a cancelled check counts as failing) or `pending` (a skipped check
// counts as passing). `data` is {overall, checks: [{name, bucket}], verdict_ceiling}: `overall` is
// `fail` when any check fails, else `pending` when any is pending, else `pass`; `verdict_ceiling`
// is the strongest verdict the review may reach: REQUEST_CHANGES when failing, COMMENT when
// pending, APPROVE when passing.
// With --wait the query is repeated while the result is pending, at most <attempts> times,
// <interval> seconds apart (default 30); the result reported is always that of the last, direct
// query, never of a background signal. With --checks-file the checks come from a JSON array of
// {name, bucket} (or the output of `gh pr checks --json name,bucket`) and no call is made.
//
// Exit: 0 every check passes, 1 a check fails or is pending (one finding per such check), 2 usage
// error, 3 `gh` is missing or its answer is not usable. With --json it prints one
// {ok, data, findings} object on stdout and the human text on stderr.
// Self-contained on purpose: no import, built-ins through process.getBuiltinModule.

// The body runs inside a function so that these top-level names stay local to the file.
void (() => {
  const fs = process.getBuiltinModule("node:fs");
  const cp = process.getBuiltinModule("node:child_process");

  const USAGE =
    "Usage: node ci-preflight.ts <pr> [--repo <owner/repo>] [--required] [--wait <attempts>]\n" +
    "         [--interval <seconds>] [--checks-file <file>] [--json]\n" +
    "  Classifies the checks of a pull request. Exit 0 all pass, 1 a check fails or is pending,\n" +
    "  2 usage error, 3 gh missing or its answer unusable.\n";

  interface Finding {
    rule: string;
    message: string;
  }
  interface Check {
    name: string;
    bucket: "pass" | "fail" | "pending";
  }

  const BUCKETS: Record<string, Check["bucket"]> = {
    pass: "pass",
    skipping: "pass",
    fail: "fail",
    cancel: "fail",
    pending: "pending",
  };

  function classify(raw: unknown): Check[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const out: Check[] = [];
    for (const item of raw) {
      if (typeof item !== "object" || item === null) return undefined;
      const rec = item as Record<string, unknown>;
      const bucket = BUCKETS[String(rec["bucket"] ?? "")] ?? "pending";
      out.push({ name: String(rec["name"] ?? ""), bucket });
    }
    return out;
  }

  function main(argv: string[]): number {
    let json = false;
    let help = false;
    let required = false;
    let repo: string | undefined;
    let checksFile: string | undefined;
    let wait = 1;
    let interval = 30;
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
      else if (name === "--required") required = true;
      else if (name === "--repo") repo = take();
      else if (name === "--checks-file") checksFile = take();
      else if (name === "--wait" || name === "--interval") {
        const v = take();
        if (v !== undefined && /^[1-9][0-9]*$/.test(v)) {
          if (name === "--wait") wait = Number(v);
          else interval = Number(v);
        } else if (v !== undefined) error ??= `${name} needs a positive integer`;
      } else if (raw.length > 1 && raw.startsWith("-")) error ??= `unknown option ${raw}`;
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
    if (error === undefined && checksFile === undefined && positional.length !== 1)
      error = "exactly one pull request number is required";
    if (error === undefined && checksFile !== undefined && positional.length > 1)
      error = "at most one pull request number is accepted";
    if (error !== undefined) {
      process.stderr.write(`ci-preflight.ts: ${error}\n${USAGE}`);
      return done(2, null, [{ rule: "usage", message: error }]);
    }
    const pr = positional[0];

    const query = (): Check[] | string => {
      if (checksFile !== undefined) {
        try {
          const parsed = classify(JSON.parse(fs.readFileSync(checksFile, "utf8")));
          return parsed ?? `${checksFile}: not a JSON array of {name, bucket}`;
        } catch (err) {
          return `${checksFile}: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      const args = [
        "pr",
        "checks",
        pr as string,
        ...(repo === undefined ? [] : ["--repo", repo]),
        ...(required ? ["--required"] : []),
        "--json",
        "name,bucket",
      ];
      const res = cp.spawnSync("gh", args, { encoding: "utf8" });
      if (res.error !== undefined) return `gh could not run: ${res.error.message}`;
      if (/no checks reported/i.test(res.stderr ?? "")) return [];
      try {
        return classify(JSON.parse(res.stdout ?? "")) ?? "gh returned an unexpected answer";
      } catch {
        return `gh pr checks failed: ${(res.stderr ?? "").trim() || (res.stdout ?? "").trim()}`;
      }
    };

    let checks: Check[] | string = query();
    for (
      let attempt = 1;
      attempt < wait && Array.isArray(checks) && checks.some((c) => c.bucket === "pending");
      attempt++
    ) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, interval * 1000);
      checks = query();
    }
    if (typeof checks === "string") {
      human(`ci-preflight: ${checks}`);
      return done(3, null, [{ rule: "precondition", message: checks }]);
    }
    const failing = checks.filter((c) => c.bucket === "fail");
    const pending = checks.filter((c) => c.bucket === "pending");
    const overall = failing.length > 0 ? "fail" : pending.length > 0 ? "pending" : "pass";
    const ceiling =
      overall === "fail" ? "REQUEST_CHANGES" : overall === "pending" ? "COMMENT" : "APPROVE";
    const findings: Finding[] = [
      ...failing.map((c) => ({
        rule: "check-failing",
        message: `check \`${c.name}\` is failing; the verdict cannot approve`,
      })),
      ...pending.map((c) => ({
        rule: "check-pending",
        message: `check \`${c.name}\` is pending; the verdict is deferred until it resolves`,
      })),
    ];
    human(`ci-preflight: ${overall} (${checks.length} checks, verdict ceiling ${ceiling})`);
    for (const f of findings) human(`ci-preflight: ${f.message}`);
    return done(
      overall === "pass" ? 0 : 1,
      { overall, checks, verdict_ceiling: ceiling },
      findings,
    );
  }

  process.exitCode = main(process.argv.slice(2));
})();
