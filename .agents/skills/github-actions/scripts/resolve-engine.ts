// resolve-engine.ts — decide which CI engine a pipeline is for: GitHub Actions or GitLab CI/CD.
// Usage: node scripts/resolve-engine.ts [--engine <github-actions|gitlab-ci>] [--root <dir>] [--json]
// Exit codes: 0 resolved, 1 ambiguous or absent (the caller must name the target), 2 usage error,
// 3 unreadable root. Writes nothing, makes no network call.
// Contract: docs/skill-authoring-standard.md (the script contract). Self-contained on purpose: no
// import, built-ins through process.getBuiltinModule.

process.removeAllListeners("warning");

void (() => {
  const fs = process.getBuiltinModule("node:fs");
  const NAME = "resolve-engine.ts";
  const ENGINES = ["github-actions", "gitlab-ci"];
  const USAGE = `Usage: node scripts/${NAME} [--engine <github-actions|gitlab-ci>] [--root <dir>] [--json]

Prints the CI engine to produce a pipeline for and how it was resolved. With --engine, that value
wins over any inference (explicit). Without it, exactly one of .github/workflows/ (holding at least
one .yml or .yaml file) and .gitlab-ci.yml under the root resolves to its engine (inferred). When
both are present or neither is, it exits 1 with engine-ambiguous or engine-absent: ask the user to
name the target, never guess.

Options: --engine <name> (or --engine=<name>), --root <dir> (default: the current directory),
--json (one object {ok, data, findings} on stdout), --help (this text).
data: {engine, resolution} where resolution is "explicit" or "inferred".
Exit codes: 0 resolved, 1 ambiguous or absent, 2 usage error, 3 unreadable root.
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

  let engine: string | undefined;
  let root = ".";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const eq = /^(--engine|--root)=(.*)$/.exec(a);
    const name = eq === null ? a : (eq[1] as string);
    if (a === "--json") continue;
    if (name !== "--engine" && name !== "--root")
      return usageError(a.startsWith("-") ? `unknown option ${a}` : `unexpected argument ${a}`);
    const value = eq === null ? argv[++i] : (eq[2] as string);
    if (value === undefined || value === "") return usageError(`${name} needs a value`);
    if (name === "--engine") engine = value;
    else root = value;
  }
  if (engine !== undefined && !ENGINES.includes(engine))
    return usageError(`unknown engine ${engine}: use github-actions or gitlab-ci`);

  if (engine !== undefined)
    return emit(0, { engine, resolution: "explicit" }, [], `engine: ${engine} (explicit)`);

  const stat = (p: string): import("node:fs").Stats | undefined => {
    try {
      return fs.statSync(p);
    } catch {
      return undefined;
    }
  };
  if (stat(root)?.isDirectory() !== true)
    return emit(
      3,
      null,
      [{ rule: "precondition", message: `${root} is not a readable directory` }],
      `[FAIL] not a directory: ${root}`,
    );
  const base = root.endsWith("/") ? root : `${root}/`;
  const hasWorkflow = (dir: string): boolean => {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return false;
    }
    return names.some((n) => {
      const st = stat(dir + n);
      return st?.isDirectory() === true
        ? hasWorkflow(`${dir}${n}/`)
        : st?.isFile() === true && /\.ya?ml$/.test(n);
    });
  };
  const github =
    stat(`${base}.github/workflows`)?.isDirectory() === true
      ? hasWorkflow(`${base}.github/workflows/`)
      : false;
  const gitlab = stat(`${base}.gitlab-ci.yml`)?.isFile() === true;

  if (github !== gitlab) {
    const found = github ? "github-actions" : "gitlab-ci";
    return emit(0, { engine: found, resolution: "inferred" }, [], `engine: ${found} (inferred)`);
  }
  const rule = github ? "engine-ambiguous" : "engine-absent";
  const message = github
    ? "both .github/workflows/ and .gitlab-ci.yml are present: ask the user to name the target with --engine, do not guess"
    : "neither .github/workflows/ (with a workflow file) nor .gitlab-ci.yml is present: ask the user to name the target with --engine, do not guess";
  emit(1, null, [{ rule, message }], `[FAIL] ${rule}: ${message}`);
})();
