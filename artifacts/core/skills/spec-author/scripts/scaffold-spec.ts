// scaffold-spec.ts — secure a spec id and write the skeleton of a spec or a delta-spec.
// Usage: node scripts/scaffold-spec.ts --issue <N> --slug <slug> --complexity <tier> --mode <mode>
//          [--id-only] [--dry-run] [--json]
//        node scripts/scaffold-spec.ts --delta --parent <NNNN> --issue <N> [--complexity <tier>]
//          [--mode <mode>] [--dry-run] [--json]
// Exit codes: 0 done, 1 a finding (refused input, pickup refused, reservation failed, target
// exists, id and branch disagree), 2 usage error, 3 precondition failed (repository tools absent).
// Contract: docs/skill-authoring-standard.md (the script contract). Self-contained on purpose: no import, built-ins
// through process.getBuiltinModule.

process.removeAllListeners("warning");

void (() => {
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  const cp = process.getBuiltinModule("node:child_process");

  const NAME = "scaffold-spec.ts";
  const TIERS = ["trivial", "small", "standard", "large"];
  const MODES = ["FULL", "INTERMEDIATE", "MINIMAL", "AUTO"];
  const NODE_FLAG = "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON";
  const USAGE = `Usage: node scripts/${NAME} --issue <N> --slug <slug> --complexity <tier> --mode <mode> [options]
       node scripts/${NAME} --delta --parent <NNNN> --issue <N> [options]

Secures a spec id (ticket pickup, then reservation), then writes specs/<NNNN>-<slug>.md with the
frontmatter and the five mandatory headings; with --delta, writes the next delta-spec of a parent.

Options:
  --issue <N>           the related issue number (required)
  --slug <slug>         ASCII kebab-case, at most 40 characters (required unless --delta)
  --complexity <tier>   trivial, small, standard or large (required unless --delta)
  --mode <mode>         FULL, INTERMEDIATE, MINIMAL or AUTO (required unless --delta)
  --delta               write a delta-spec; makes no tool call and reserves nothing
  --parent <NNNN>       the parent spec id of a delta-spec (required with --delta)
  --id-only             run the pickup check and the reservation, print the id, write nothing
  --dry-run             run no tool, write nothing; print the path, the content and the two
                        commands that a real run would execute
  --json                print one JSON object {ok, data, findings} on stdout
  --help                print this text

The ticket assignment, any comment on the issue and the reservation ref are written by the two
repository tools this script runs (scripts/ticket-pickup.ts and scripts/reserve-spec-id.ts),
never by this script. Run it from the repository root or a worktree of it.

data: {path, id, unsecured, delta, dry_run, written, commands}

Exit codes: 0 done, 1 finding, 2 usage error, 3 precondition failed.
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
  const precondition = (message: string): void =>
    emit(3, null, [{ rule: "precondition", message }], `${NAME}: ${message}`);
  const refuse = (rule: string, message: string): void =>
    emit(1, null, [{ rule, message }], `${NAME}: ${message}`);

  const opts: Record<string, string> = {};
  const flags = new Set<string>();
  const VALUE = new Set(["--issue", "--slug", "--complexity", "--mode", "--parent"]);
  const FLAG = new Set(["--delta", "--id-only", "--dry-run", "--json"]);
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] as string;
    const eq = raw.indexOf("=");
    const key = raw.startsWith("--") && eq !== -1 ? raw.slice(0, eq) : raw;
    if (FLAG.has(key) && eq === -1) flags.add(key);
    else if (VALUE.has(key)) {
      let v: string | undefined;
      if (eq !== -1) v = raw.slice(eq + 1);
      else v = argv[++i];
      if (v === undefined || v === "") return usageError(`${key} needs a value`);
      opts[key] = v;
    } else if (raw.startsWith("-")) return usageError(`unknown option ${raw}`);
    else return usageError(`unexpected argument ${raw}`);
  }
  const delta = flags.has("--delta");
  const dryRun = flags.has("--dry-run");
  const idOnly = flags.has("--id-only");
  if (opts["--issue"] === undefined) return usageError("--issue is required");
  if (!/^[1-9][0-9]*$/.test(opts["--issue"])) return usageError("--issue must be a number");
  const issue = opts["--issue"];
  if (delta) {
    if (opts["--parent"] === undefined)
      return refuse(
        "parent-missing",
        "--delta requires --parent <NNNN>, the id of the parent spec",
      );
    if (idOnly) return usageError("--id-only cannot be combined with --delta");
  } else {
    if (opts["--parent"] !== undefined) return usageError("--parent only applies with --delta");
    for (const k of ["--slug", "--complexity", "--mode"])
      if (opts[k] === undefined) return usageError(`${k} is required`);
  }

  // Repository root: the git top level when there is one, else the current directory.
  const run = (
    cmd: string,
    args: string[],
    cwd: string,
  ): { status: number; out: string; err: string } => {
    const r = cp.spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 120_000 });
    return { status: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
  };
  const top = run("git", ["rev-parse", "--show-toplevel"], process.cwd());
  const root = top.status === 0 ? top.out.trim() : process.cwd();
  const specsDir = path.join(root, "specs");

  const complexity = opts["--complexity"];
  const mode = opts["--mode"];
  if (complexity !== undefined && !TIERS.includes(complexity))
    return refuse("complexity", `complexity "${complexity}" is not one of ${TIERS.join(", ")}`);
  if (mode !== undefined && !MODES.includes(mode))
    return refuse("mode", `mode "${mode}" is not one of ${MODES.join(", ")}`);

  const listSpecs = (): string[] => {
    try {
      return fs.readdirSync(specsDir) as string[];
    } catch {
      return [];
    }
  };

  const SECTIONS = `## Intent

<One paragraph: what changes for the user, no HOW words.>

## Requirements

1. <Each line uses SHALL or MUST, answers its null case and names a permitted path.>

## Scenarios

### Happy path

- **Given** <pre-condition>,
- **When** <triggering action>,
- **Then** <observable outcome>.

### Failure path

- **Given** <pre-condition>,
- **When** <triggering action that should fail>,
- **Then** <observable failure mode>.

## Out of scope

- <What this spec does not cover.>

## Open questions
`;
  const DELTA_SECTIONS = `## ADDED

## MODIFIED

## REMOVED
`;

  const pickupCmd = `node ${NODE_FLAG} scripts/ticket-pickup.ts --issue ${issue}`;
  const reserveCmd = `node ${NODE_FLAG} scripts/reserve-spec-id.ts --issue ${issue}`;
  const commands = delta ? [] : [pickupCmd, reserveCmd];

  let id = "NNNN";
  let slug = opts["--slug"] as string;
  let unsecured = false;
  let target: string;
  let content: string;

  if (delta) {
    const parent = opts["--parent"] as string;
    if (!/^[0-9]{4}$/.test(parent)) return usageError("--parent must be four digits");
    const parentFile = listSpecs().find(
      (f) => f.startsWith(`${parent}-`) && f.endsWith(".md") && !f.includes(".delta-"),
    );
    if (parentFile === undefined)
      return refuse("parent-missing", `no spec ${parent} found under ${specsDir}`);
    id = parent;
    slug = parentFile.slice(parent.length + 1, -".md".length);
    const parentText = fs.readFileSync(path.join(specsDir, parentFile), "utf8") as string;
    const field = (name: string): string | undefined =>
      new RegExp(`^${name}:[ \\t]*"?([^"\\r\\n#]*?)"?[ \\t]*(?:#.*)?\\r?$`, "m").exec(
        parentText.split(/\r?\n---/)[0] as string,
      )?.[1];
    const deltas = listSpecs()
      .map((f) => new RegExp(`^${parent}-${slug}\\.delta-([0-9]{2})\\.md$`).exec(f))
      .filter((m): m is RegExpExecArray => m !== null);
    const next = deltas.reduce((n, m) => Math.max(n, Number(m[1])), 0) + 1;
    if (next > 99) return refuse("delta-number", "delta numbers beyond 99 are not supported");
    const nn = String(next).padStart(2, "0");
    const title = /^# (.+)$/m.exec(parentText)?.[1] ?? slug;
    const [maj, min] = (field("version") ?? "1.0.0").split(".");
    const dComplexity = complexity ?? field("complexity") ?? "standard";
    const dMode = mode ?? field("interaction-mode") ?? "INTERMEDIATE";
    target = path.join(specsDir, `${parent}-${slug}.delta-${nn}.md`);
    content = `---
id: "${id}"
slug: ${slug}
status: draft
complexity: ${dComplexity}
interaction-mode: ${dMode}
related-issue: ${issue}
version: ${maj ?? "1"}.${Number(min ?? "0") + 1}.0
---

# ${title}

${DELTA_SECTIONS}`;
  } else {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 40)
      return refuse(
        "slug",
        `slug "${slug}" must be ASCII kebab-case (lowercase letters, digits, single hyphens) of at most 40 characters`,
      );

    if (!dryRun) {
      const hasPickup = fs.existsSync(path.join(root, "scripts", "ticket-pickup.ts"));
      const hasReserve = fs.existsSync(path.join(root, "scripts", "reserve-spec-id.ts"));
      if (!hasPickup || !hasReserve)
        return precondition(
          `scripts/ticket-pickup.ts and scripts/reserve-spec-id.ts were not found under ${root}. ` +
            "Manual equivalent: read the issue's assignees and stop when it is assigned to someone else; " +
            "take the next unused number from the specs directory after fetching the default branch, " +
            "and check open pull requests and branches for the same number. Then run this script with " +
            "--dry-run and write the file it prints, with that number in place of NNNN.",
        );
      const guard = path.join(root, "scripts", "lib", "node-floor-guard.js");
      if (fs.existsSync(guard)) {
        const g = run(process.execPath, [guard], root);
        if (g.status !== 0)
          return precondition(`the Node.js floor guard failed: ${g.err.trim() || g.out.trim()}`);
      }
      const pick = run(
        process.execPath,
        [NODE_FLAG, "scripts/ticket-pickup.ts", "--issue", issue],
        root,
      );
      if (pick.status !== 0)
        return refuse(
          "ticket-pickup",
          `the ticket pickup check exited ${pick.status}; stop and tell the user: ${(pick.err.trim() || pick.out.trim()).split("\n").pop()}`,
        );
      const res = run(
        process.execPath,
        [NODE_FLAG, "scripts/reserve-spec-id.ts", "--issue", issue],
        root,
      );
      if (res.status !== 0 && res.status !== 3)
        return refuse(
          "id-reservation",
          `the id reservation exited ${res.status}; stop and tell the user, do not compute an id yourself: ${(res.err.trim() || res.out.trim()).split("\n").pop()}`,
        );
      const lines = res.out.split("\n");
      id = (lines[0] ?? "").trim();
      if (!/^[0-9]{4,}$/.test(id))
        return refuse("id-reservation", `the reservation tool printed "${id}" instead of an id`);
      unsecured = res.status === 3;
    }
    if (idOnly) {
      return emit(
        0,
        { path: null, id, unsecured, delta: false, dry_run: dryRun, written: false, commands },
        [],
        id,
      );
    }
    if (!dryRun) {
      const br = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], root);
      const m = /^spec\/([0-9]{4,})-(.+)$/.exec(br.status === 0 ? br.out.trim() : "");
      if (m !== null && (m[1] !== id || m[2] !== slug))
        return refuse(
          "branch-mismatch",
          `the branch ${br.out.trim()} does not match the reserved id ${id} and slug ${slug}; ` +
            "an unsecured reservation (exit 3) computes a fresh id each time. Do not write the file: " +
            "tell the user, then rename the branch or rerun with the id and slug of the branch",
        );
    }
    target = path.join(specsDir, `${id}-${slug}.md`);
    content = `---
id: "${id}"
slug: ${slug}
status: draft
complexity: ${complexity}
interaction-mode: ${mode}
related-issue: ${issue}
version: 1.0.0${unsecured ? "\nunsecured-id: true" : ""}
---

# <Title that matches the slug>

${SECTIONS}`;
  }

  const rel = path.relative(root, target).split(path.sep).join("/");
  const base = { path: rel, id, unsecured, delta, dry_run: dryRun, written: false, commands };
  if (fs.existsSync(target))
    return emit(
      1,
      base,
      [
        {
          rule: "target-exists",
          message: `${rel} already exists; pick another slug or edit it by hand`,
        },
      ],
      `${NAME}: ${rel} already exists; nothing written`,
    );
  if (dryRun) {
    const would =
      commands.length > 0 ? `\nwould run:\n${commands.map((c) => `  ${c}`).join("\n")}` : "";
    return emit(
      0,
      base,
      [],
      `${NAME}: dry run, nothing written. Target: ${rel}${would}\n--- content ---\n${content}`,
    );
  }
  try {
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(target, content);
  } catch (e) {
    return precondition(`cannot write ${rel}: ${(e as Error).message}`);
  }
  emit(
    0,
    { ...base, written: true },
    [],
    `${NAME}: wrote ${rel}${unsecured ? " (id not secured: unsecured-id: true written into the frontmatter)" : ""}`,
  );
})();
