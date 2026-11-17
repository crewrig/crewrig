// iter-label.ts — finds the `iter:<N>` label of a pull request, adding `iter:1` when none exists.
//
// Usage: node iter-label.ts <pr> [--repo <owner/repo>] [--labels-file <file>] [--dry-run] [--json]
//
// Finding identifiers are minted from the iteration ordinal this label carries, so the label must
// exist before the first identifier is written. With one `iter:<N>` label the script returns that
// N and changes nothing; with several it returns the highest N and warns; with none it adds
// `iter:1` through `gh pr edit --add-label`. `data` is {iter, applied}. When the label cannot be
// added the script exits 3 with `data` null: state the failure in the verdict and mint no
// identifier under an assumed number.
// --dry-run prints the command and runs none; --labels-file reads the labels from a JSON array of
// names (or of {name}) and makes no call.
//
// Exit: 0 an ordinal is known, 2 usage error, 3 gh is missing, its answer is unusable or the label
// cannot be added. With --json it prints one {ok, data, findings} object on stdout and the human
// text on stderr.
// Self-contained on purpose: no import, built-ins through process.getBuiltinModule.

// The body runs inside a function so that these top-level names stay local to the file.
void (() => {
  const fs = process.getBuiltinModule("node:fs");
  const cp = process.getBuiltinModule("node:child_process");

  const USAGE =
    "Usage: node iter-label.ts <pr> [--repo <owner/repo>] [--labels-file <file>] [--dry-run] [--json]\n" +
    "  Returns the iter:<N> label of a pull request, adding iter:1 when none exists.\n" +
    "  Exit 0 ordinal known, 2 usage error, 3 gh unusable or the label cannot be added.\n";

  interface Finding {
    rule: string;
    message: string;
    severity?: "warning";
  }

  function names(raw: unknown): string[] | undefined {
    const list = Array.isArray(raw) ? raw : (raw as { labels?: unknown } | null)?.labels;
    if (!Array.isArray(list)) return undefined;
    return list.map((l) =>
      typeof l === "string" ? l : String((l as { name?: unknown }).name ?? ""),
    );
  }

  function main(argv: string[]): number {
    let json = false;
    let help = false;
    let dryRun = false;
    let repo: string | undefined;
    let labelsFile: string | undefined;
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
      else if (name === "--repo") repo = take();
      else if (name === "--labels-file") labelsFile = take();
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
    if (error === undefined && labelsFile === undefined && positional.length !== 1)
      error = "exactly one pull request number is required";
    if (error === undefined && positional.length > 1)
      error = "at most one pull request number is accepted";
    if (error !== undefined) {
      process.stderr.write(`iter-label.ts: ${error}\n${USAGE}`);
      return done(2, null, [{ rule: "usage", message: error }]);
    }
    const pr = positional[0] ?? "";
    const fail = (message: string): number => {
      human(`iter-label: ${message}`);
      return done(3, null, [{ rule: "precondition", message }]);
    };

    let labels: string[] | undefined;
    if (labelsFile !== undefined) {
      try {
        labels = names(JSON.parse(fs.readFileSync(labelsFile, "utf8")));
      } catch (err) {
        return fail(`${labelsFile}: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (labels === undefined) return fail(`${labelsFile}: not a JSON array of labels`);
    } else {
      const res = cp.spawnSync(
        "gh",
        ["pr", "view", pr, ...(repo === undefined ? [] : ["--repo", repo]), "--json", "labels"],
        { encoding: "utf8" },
      );
      if (res.error !== undefined) return fail(`gh could not run: ${res.error.message}`);
      try {
        labels = names(JSON.parse(res.stdout ?? ""));
      } catch {
        labels = undefined;
      }
      if (labels === undefined) return fail(`gh pr view failed: ${(res.stderr ?? "").trim()}`);
    }

    const found = labels
      .map((l) => /^iter:([0-9]+)$/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => Number(m[1]));
    if (found.length > 0) {
      const iter = Math.max(...found);
      const findings: Finding[] =
        found.length > 1
          ? [
              {
                rule: "several-labels",
                severity: "warning",
                message: `${found.length} iter labels found; using the highest (iter:${iter})`,
              },
            ]
          : [];
      human(`iter-label: iter:${iter}`);
      for (const f of findings) human(`iter-label: ${f.message}`);
      return done(0, { iter, applied: false }, findings);
    }
    const command = [
      "gh",
      "pr",
      "edit",
      pr,
      ...(repo === undefined ? [] : ["--repo", repo]),
      "--add-label",
      "iter:1",
    ];
    if (dryRun) {
      human(`iter-label: no iter label; would run: ${command.join(" ")}`);
      return done(0, { iter: 1, applied: false, dry_run: true, command: command.join(" ") }, []);
    }
    const res = cp.spawnSync(command[0] as string, command.slice(1), { encoding: "utf8" });
    if (res.error !== undefined || res.status !== 0)
      return fail(`could not add iter:1: ${(res.stderr ?? res.error?.message ?? "").trim()}`);
    human("iter-label: added iter:1");
    return done(0, { iter: 1, applied: true }, []);
  }

  process.exitCode = main(process.argv.slice(2));
})();
