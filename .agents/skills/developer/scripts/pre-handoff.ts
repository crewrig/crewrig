// pre-handoff.ts — review the working-tree diff before a change is reported done.
// Usage: node pre-handoff.ts [--base <ref>] [--scope <path-or-glob>]... [--json]
// Reads the diff of the working tree (staged, unstaged and untracked files) against a base ref and
// reports files outside the declared scope, non-ASCII characters lost or added, and executable
// bits lost. Exit codes: 0 no error finding, 1 at least one error finding, 2 usage error,
// 3 precondition failed (not inside a git repository, unknown base ref). Writes nothing, makes no
// network call, never stages, commits or pushes.
// Self-contained on purpose: no import, built-ins through process.getBuiltinModule.

process.removeAllListeners("warning");

void (() => {
  const cp = process.getBuiltinModule("node:child_process");
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");

  const NAME = "pre-handoff.ts";
  const USAGE = `Usage: node ${NAME} [--base <ref>] [--scope <path-or-glob>]... [--json]

Reviews the diff of the working tree against a base ref before the change is reported done.

Options:
  --base <ref>            the ref to compare with (default HEAD: staged, unstaged and untracked
                          changes; use origin/main to include commits of the current branch)
  --scope <path-or-glob>  a path, a directory or a glob the task covers; repeatable. A changed file
                          that matches none is a finding. Without --scope the scope check is skipped.
  --json                  print one JSON object {ok, data, findings} on stdout
  --help                  print this text

Findings (error unless stated):
  scope            a changed file is outside every --scope entry
  non-ascii-lost   a non-ASCII character is removed and not added back in the same file
                   (an arrow replaced by "->", a dash by "--"); if the removal is intended, say so
  non-ascii-added  (warning) a non-ASCII character is added to a file
  mode-lost        a file went from executable (100755) to a non-executable mode

data: {base, scope, changed: [{path, status}]}
Exit codes: 0 no error finding, 1 at least one error finding, 2 usage error, 3 precondition failed.
`;

  interface Finding {
    rule: string;
    message: string;
    severity?: "warning";
  }
  const argv = process.argv.slice(2);
  let json = false;
  const emit = (code: number, data: unknown, findings: Finding[], lines: string[]): void => {
    const text = `${lines.join("\n")}\n`;
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: code === 0, data, findings })}\n`);
      process.stderr.write(text);
    } else (code >= 2 ? process.stderr : process.stdout).write(text);
    process.exitCode = code;
  };
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
  json = argv.includes("--json");
  const usageError = (message: string): void =>
    emit(
      2,
      null,
      [{ rule: "usage", message }],
      [`${NAME}: ${message}`, USAGE.split("\n")[0] as string],
    );
  const precondition = (message: string): void =>
    emit(3, null, [{ rule: "precondition", message }], [`${NAME}: ${message}`]);

  let base = "HEAD";
  const scope: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] as string;
    if (raw === "--json") continue;
    const eq = raw.startsWith("--") ? raw.indexOf("=") : -1;
    const key = eq === -1 ? raw : raw.slice(0, eq);
    if (key !== "--base" && key !== "--scope")
      return usageError(
        raw.startsWith("-") && raw !== "-" ? `unknown option ${raw}` : `unexpected argument ${raw}`,
      );
    const value = eq !== -1 ? raw.slice(eq + 1) : argv[++i];
    if (value === undefined || value === "") return usageError(`${key} needs a value`);
    if (key === "--base") base = value;
    else scope.push(value);
  }

  const git = (...args: string[]): { status: number | null; out: string; err: string } => {
    const r = cp.spawnSync("git", ["-c", "core.quotePath=false", ...args], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    return {
      status: r.error === undefined ? r.status : -1,
      out: r.stdout ?? "",
      err: r.stderr ?? "",
    };
  };

  const top = git("rev-parse", "--show-toplevel");
  if (top.status === -1) return precondition("git is not installed or not on PATH");
  if (top.status !== 0) return precondition("not inside a git repository");
  if (git("rev-parse", "--verify", "--quiet", `${base}^{commit}`).status !== 0)
    return precondition(`unknown base ref ${base}`);
  const root = top.out.trim();

  // Changed files against the base, without rename detection so a rename is an add and a delete.
  interface Changed {
    path: string;
    status: string;
    oldMode: string;
    newMode: string;
  }
  const raw = git("diff", "--raw", "--no-renames", "--no-color", "-z", base);
  if (raw.status !== 0) return precondition(`git diff failed: ${raw.err.trim()}`);
  const changed = new Map<string, Changed>();
  const parts = raw.out.split("\0");
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const meta = (parts[i] as string).split(" ");
    const file = parts[i + 1] as string;
    changed.set(file, {
      path: file,
      status: (meta[4] ?? "M").charAt(0),
      oldMode: (meta[0] ?? "").replace(/^:/, ""),
      newMode: meta[1] ?? "",
    });
  }
  const untracked = git("ls-files", "--others", "--exclude-standard", "-z");
  for (const file of untracked.out.split("\0").filter((f) => f !== ""))
    changed.set(file, { path: file, status: "A", oldMode: "000000", newMode: "100644" });

  // Non-ASCII characters per file, counted over added and removed lines.
  const NON_ASCII = /[^\x00-\x7f]/gu;
  const count = (text: string, into: Map<string, number>): void => {
    for (const ch of text.matchAll(NON_ASCII)) into.set(ch[0], (into.get(ch[0]) ?? 0) + 1);
  };
  const added = new Map<string, Map<string, number>>();
  const removed = new Map<string, Map<string, number>>();
  const bucket = (m: Map<string, Map<string, number>>, file: string): Map<string, number> => {
    let b = m.get(file);
    if (b === undefined) {
      b = new Map<string, number>();
      m.set(file, b);
    }
    return b;
  };
  const patch = git("diff", "--no-renames", "--no-color", "--no-ext-diff", "-U0", base);
  if (patch.status !== 0) return precondition(`git diff failed: ${patch.err.trim()}`);
  let current: string | undefined;
  for (const line of patch.out.split("\n")) {
    if (line.startsWith("diff --git ")) current = undefined;
    else if (line.startsWith("+++ "))
      current = line === "+++ /dev/null" ? undefined : line.slice(6);
    else if (line.startsWith("--- ")) {
      if (line !== "--- /dev/null") current ??= line.slice(6);
    } else if (current !== undefined && line.startsWith("+"))
      count(line.slice(1), bucket(added, current));
    else if (current !== undefined && line.startsWith("-"))
      count(line.slice(1), bucket(removed, current));
  }
  // `--- a/x` precedes `+++ b/x`; the loop above keys both on the b/ path, which is the same
  // string for a modified file. A deleted file has no `+++` path, so its removals are not counted.
  for (const file of untracked.out.split("\0").filter((f) => f !== "")) {
    try {
      const text = fs.readFileSync(path.join(root, file), "utf8");
      if (!text.includes("\0")) count(text, bucket(added, file));
    } catch {
      // unreadable untracked entry (a directory with a nested repository, a dangling link)
    }
  }

  const toRegExp = (glob: string): RegExp => {
    let out = "";
    for (let i = 0; i < glob.length; i++) {
      const c = glob[i] as string;
      if (c === "*" && glob[i + 1] === "*") {
        out += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
        i += glob[i + 2] === "/" ? 2 : 1;
      } else if (c === "*") out += "[^/]*";
      else if (c === "?") out += "[^/]";
      else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`^${out}$`);
  };
  const inScope = (file: string): boolean =>
    scope.some((entry) => {
      const e = entry.replace(/^\.\//, "").replace(/\/+$/, "");
      if (/[*?]/.test(e)) return toRegExp(e).test(file);
      return file === e || file.startsWith(`${e}/`);
    });

  const findings: Finding[] = [];
  const files = [...changed.values()].sort((a, b) => a.path.localeCompare(b.path));
  for (const f of files) {
    if (scope.length > 0 && !inScope(f.path))
      findings.push({
        rule: "scope",
        message: `${f.path} is changed but outside the declared scope; revert it, or confirm it is intended and widen the scope`,
      });
    const plus = added.get(f.path) ?? new Map<string, number>();
    const minus = removed.get(f.path) ?? new Map<string, number>();
    const lost = [...minus].filter(([ch, n]) => n > (plus.get(ch) ?? 0)).map(([ch]) => ch);
    const gained = [...plus].filter(([ch, n]) => n > (minus.get(ch) ?? 0)).map(([ch]) => ch);
    if (lost.length > 0)
      findings.push({
        rule: "non-ascii-lost",
        message: `${f.path} loses ${lost.map((c) => `"${c}" (U+${(c.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, "0")})`).join(", ")}; restore it, or state in the report that the removal is intended`,
      });
    if (gained.length > 0)
      findings.push({
        rule: "non-ascii-added",
        severity: "warning",
        message: `${f.path} gains ${gained.map((c) => `"${c}"`).join(", ")}; confirm the project allows non-ASCII there`,
      });
    if (f.oldMode === "100755" && f.status !== "D" && f.newMode !== "100755")
      findings.push({
        rule: "mode-lost",
        message: `${f.path} lost its executable bit (${f.oldMode} to ${f.newMode}); restore it with chmod +x or git update-index --chmod=+x`,
      });
  }

  const errors = findings.filter((x) => x.severity !== "warning");
  const data = {
    base,
    scope: scope.length > 0 ? scope : null,
    changed: files.map((f) => ({ path: f.path, status: f.status })),
  };
  const lines = findings.map((x) => `${x.severity ?? "error"} ${x.rule}: ${x.message}`);
  lines.push(
    `${NAME}: ${files.length} changed file(s) against ${base}, ${errors.length} error(s), ${findings.length - errors.length} warning(s)`,
  );
  emit(errors.length > 0 ? 1 : 0, data, findings, lines);
})();
