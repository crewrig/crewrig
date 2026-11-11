// flip-spec-status.ts — record a spec's `approved` to `implemented` transition in place.
// Usage: node flip-spec-status.ts <spec-file> [--dry-run] [--json]
// Rewrites only the value of the frontmatter `status` key; every other byte of the file stays,
// the line ending, the quoting of the value and any trailing comment included. It stages and
// commits nothing. Exit codes: 0 flipped, or already implemented; 1 any other status;
// 2 usage error; 3 unreadable file or no frontmatter `status` line.
// Contract: references/script-contract.md.
// Self-contained on purpose: no import, built-ins through process.getBuiltinModule.

process.removeAllListeners("warning");

void (async () => {
  const fs = process.getBuiltinModule("node:fs");

  const NAME = "flip-spec-status.ts";
  const USAGE = `Usage: node ${NAME} <spec-file> [--dry-run] [--json]

Changes the frontmatter \`status\` of a spec from approved to implemented and nothing else.

Options:
  --dry-run  report what would change and write nothing
  --json     print one JSON object {ok, data, findings} on stdout
  --help     print this text

data: {path, status, changed, would_change, dry_run}
  status is the value found before the run. An already implemented spec is left alone
  (exit 0, changed false). Any other status is left alone and reported (exit 1).

Exit codes: 0 flipped or already implemented, 1 other status, 2 usage error, 3 precondition failed.
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

  let dryRun = false;
  const files: string[] = [];
  for (const raw of argv) {
    if (raw === "--json") continue;
    if (raw === "--dry-run") dryRun = true;
    else if (raw.startsWith("-") && raw !== "-") return usageError(`unknown option ${raw}`);
    else files.push(raw);
  }
  if (files.length === 0) return usageError("a spec file is required");
  if (files.length > 1) return usageError(`unexpected argument ${files[1]}`);
  const file = files[0] as string;

  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(file);
  } catch (e) {
    return precondition(`cannot read ${file}: ${(e as Error).message}`);
  }
  // One byte is one character, so the rewrite cannot alter any byte it does not target.
  const text = bytes.toString("latin1");
  const lines = text.split("\n");
  const bare = (l: string): string => l.replace(/\r$/, "");
  if (!/^---[ \t]*$/.test(bare(lines[0] as string)))
    return precondition(`${file} has no frontmatter`);
  let at = -1;
  for (let i = 1; i < lines.length; i++) {
    const l = bare(lines[i] as string);
    if (/^---[ \t]*$/.test(l)) break;
    if (/^status:/.test(l)) {
      at = i;
      break;
    }
  }
  if (at === -1) return precondition(`${file} has no frontmatter status line`);

  const line = lines[at] as string;
  const cr = line.endsWith("\r") ? "\r" : "";
  const m = /^(status:[ \t]*)(?:"([^"]*)"|'([^']*)'|([^ \t#'"][^ \t]*))([ \t]*(?:#.*)?)$/.exec(
    bare(line),
  );
  const value =
    m === null ? bare(line).slice("status:".length).trim() : ((m[2] ?? m[3] ?? m[4]) as string);

  const base = { path: file, status: value, changed: false, would_change: false, dry_run: dryRun };
  if (m !== null && value === "implemented")
    return emit(0, base, [], `${NAME}: ${file} is already implemented, nothing written`);
  if (m === null || value !== "approved")
    return emit(
      1,
      base,
      [
        {
          rule: "status-not-approved",
          message: `the frontmatter status is "${value}", not "approved"`,
        },
      ],
      `${NAME}: ${file} has status "${value}", not "approved"; nothing written`,
    );

  const quote = m[2] !== undefined ? '"' : m[3] !== undefined ? "'" : "";
  lines[at] = `${m[1]}${quote}implemented${quote}${m[5]}${cr}`;
  if (dryRun)
    return emit(
      0,
      { ...base, would_change: true },
      [],
      `${NAME}: would change status "approved" to "implemented" in ${file}; dry run, nothing written`,
    );
  try {
    fs.writeFileSync(file, Buffer.from(lines.join("\n"), "latin1"));
  } catch (e) {
    return precondition(`cannot write ${file}: ${(e as Error).message}`);
  }
  emit(
    0,
    { ...base, changed: true },
    [],
    `${NAME}: changed status "approved" to "implemented" in ${file}`,
  );
})();
