// dep-audit.ts — audit the dependencies of one project with the native audit command of npm and pip.
// Usage and exit codes: see USAGE below or run with --help. Contract: docs/skill-authoring-standard.md.
// Self-contained: no import, built-ins through process.getBuiltinModule. POSIX only.

process.removeAllListeners("warning");

void (async () => {
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  const cp = process.getBuiltinModule("node:child_process");

  const NAME = "dep-audit.ts";
  const USAGE = `Usage: node scripts/${NAME} [--root <dir>] [--ecosystem <npm|pip>] [--fail-on <level>]
                           [--timeout <seconds>] [--json]

Detects the ecosystems at the top level of --root (default .) and runs their native audit command,
a fixed argument vector with no shell, found on PATH. POSIX hosts only (Windows: exit 3).
  npm  package-lock.json or npm-shrinkwrap.json (package.json alone: cause no-lockfile):
       npm audit --json --package-lock-only --ignore-scripts
  pip  requirements.txt:
       pip-audit -r requirements.txt --disable-pip --no-deps --format json --progress-spinner off
       --no-deps audits only the pins written in the file (name==version), not what they pull in;
       the default mode builds packages and runs project code, so it is not used.
Both tools query a package registry over the network. Nothing is installed or fixed and no file
of the project is written (the tools keep their own cache and logs).
pnpm-lock.yaml, yarn.lock, go.mod, Cargo.lock, poetry.lock, pom.xml, Gemfile.lock and composer.lock
give an unsupported-ecosystem warning, and no manifest gives nothing-to-audit: both mean NOT audited.
A verdict is clean, vulnerable or not-audited with a cause: tool-missing, timeout, offline,
unrecognized-output (also a pip dependency the tool skipped, unless the run finds an advisory: exit 1,
the skipped one a warning), no-lockfile, unpinned or unsupported.
A vulnerable-dependency finding is an error at or above --fail-on (low, moderate, high, critical;
default high), a warning below; no severity (every pip advisory) counts as at or above. Reachability
is not assessed. --timeout is a whole 1 to 2147483 s per command (default 60); its process group is killed.
data: {root, failOn, audited: [{ecosystem, manifest, verdict, cause?, advisories, skipped}]}.
Exit codes: 0 audited, nothing at or above --fail-on; 1 a vulnerable dependency; 2 usage error;
3 not audited (a precondition error, manifests found and none audited, or Windows).
`;
  type Finding = { rule: string; message: string; severity?: string; [k: string]: unknown };
  type Adv = { pkg: string; version: string; id: string; severity?: string; fix?: string };
  type Res = {
    verdict: string;
    cause?: string;
    why?: string;
    advisories: Adv[];
    skipped: string[];
  };
  type Entry = Res & { ecosystem: string; manifest: string };
  const blank = (): Res =>
    JSON.parse(
      '{"verdict":"not-audited","cause":"unrecognized-output","advisories":[],"skipped":[]}',
    ) as Res;
  const done = (res: Res, verdict: string): Res => ({ ...res, verdict, cause: undefined });
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const emit = (code: number, data: unknown, findings: Finding[]): void => {
    const lines = findings.map((f) => `[${f.severity ?? "error"}] ${f.rule}: ${f.message}`);
    const text = `${lines.length > 0 ? lines.join("\n") : "dep-audit: nothing to report"}\n`;
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: code === 0, data, findings })}\n`);
      process.stderr.write(text);
    } else (code >= 2 ? process.stderr : process.stdout).write(text);
    process.exitCode = code;
  };
  const stop = (code: number, rule: string, message: string, extra = {}): void =>
    emit(code, null, [{ rule, message, ...extra }]);
  if (argv.includes("--help")) return void process.stdout.write(USAGE);
  const opt: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] ?? "";
    if (raw === "--json") continue;
    const eq = raw.startsWith("--") ? raw.indexOf("=") : -1;
    const name = eq > 0 ? raw.slice(0, eq) : raw;
    if (!["--root", "--ecosystem", "--fail-on", "--timeout"].includes(name))
      return stop(2, "usage", `unknown option or unexpected argument ${raw}`);
    const value = eq > 0 ? raw.slice(eq + 1) : argv[++i];
    if (value === undefined || (eq < 0 && value.startsWith("--")))
      return stop(2, "usage", `${name} needs a value`);
    if (name in opt) return stop(2, "usage", `${name} is given twice`);
    opt[name] = value;
  }
  const only = opt["--ecosystem"];
  const failOn = opt["--fail-on"] ?? "high";
  const seconds = Number(opt["--timeout"] ?? "60");
  const RANK: Record<string, number> = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
  if (only !== undefined && only !== "npm" && only !== "pip")
    return stop(2, "usage", `--ecosystem takes npm or pip, got ${only}`);
  if (failOn === "info" || RANK[failOn] === undefined)
    return stop(2, "usage", `--fail-on takes low, moderate, high or critical, got ${failOn}`);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 2147483)
    return stop(2, "usage", `--timeout takes whole seconds, 1 to 2147483, got ${opt["--timeout"]}`);
  const NOT = "the dependencies were NOT audited";
  if (process.platform === "win32")
    return stop(3, "precondition", `POSIX only; ${NOT}`, { cause: "unsupported-platform" });
  const root = path.resolve(opt["--root"] ?? ".");
  const stat = (n: string): import("node:fs").Stats | undefined =>
    fs.statSync(path.join(root, n), { throwIfNoEntry: false });
  if (stat("")?.isDirectory() !== true) return stop(3, "precondition", `not a directory: ${root}`);
  const has = (n: string): boolean => stat(n)?.isFile() === true;
  const UNSUPPORTED = `pnpm-lock.yaml:pnpm audit,yarn.lock:yarn npm audit (Yarn 2+) or yarn audit (Yarn 1),go.mod:govulncheck ./...,
Cargo.lock:cargo audit,poetry.lock:pip-audit on the output of poetry export,
pom.xml:mvn org.owasp:dependency-check-maven:check,Gemfile.lock:bundle audit,composer.lock:composer audit`;
  const lock = ["package-lock.json", "npm-shrinkwrap.json"].find(has);
  const node =
    lock !== undefined ||
    (has("package.json") && (only === "npm" || !(has("pnpm-lock.yaml") || has("yarn.lock"))));
  const plan: string[][] = [];
  if (only !== "pip" && node) plan.push(["npm", lock ?? "package.json"]);
  if (only !== "npm" && has("requirements.txt")) plan.push(["pip", "requirements.txt"]);
  if (only !== undefined && plan.length === 0)
    return stop(3, "precondition", `no ${only} manifest at the top level of ${root}: ${NOT}`);
  const rec = (v: unknown): Record<string, unknown> | undefined =>
    typeof v === "object" && v !== null ? (v as Record<string, unknown>) : undefined;
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? (v as unknown[]) : []);
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  const parse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };
  const which = (cmd: string): string | undefined =>
    (process.env.PATH ?? "")
      .split(path.delimiter)
      .map((d) => path.join(d === "" ? "." : d, cmd))
      .find((p) => fs.statSync(p, { throwIfNoEntry: false })?.isFile() === true);
  type Run = { code: number | null; out: string; err: string; timedOut: boolean; failed: boolean };
  const run = (bin: string, args: string[]): Promise<Run> =>
    new Promise((resolve) => {
      const child = cp.spawn(bin, args, {
        cwd: root,
        detached: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const res: Run = { code: null, out: "", err: "", timedOut: false, failed: false };
      const end = (): void => {
        clearTimeout(timer);
        try {
          // no pid after a failed spawn: kill(0) would signal the caller's own group
          if ((child.pid ?? 0) > 0) process.kill(-(child.pid ?? 0), "SIGKILL");
        } catch {
          /* the group is already gone */
        }
        resolve(res);
      };
      const timer = setTimeout(() => {
        res.timedOut = true;
        end();
      }, seconds * 1000);
      child.stdout.setEncoding("utf8").on("data", (d: string) => (res.out += d));
      child.stderr.setEncoding("utf8").on("data", (d: string) => (res.err += d));
      child.on("error", () => {
        res.failed = true;
        end();
      });
      child.on("close", (code) => {
        res.code = code;
        end();
      });
    });
  const npmRules = (r: Run): Res => {
    const j = rec(parse(r.out));
    const res = blank();
    const vulns = rec(j?.vulnerabilities);
    if (vulns === undefined || rec(j?.metadata) === undefined) {
      const down = /request to .* failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN/;
      if (r.code !== 0 && j !== undefined && "error" in j && down.test(str(j.message) ?? ""))
        res.cause = "offline";
      return res;
    }
    const locked = rec(rec(parse(fs.readFileSync(path.join(root, lock ?? ""), "utf8")))?.packages);
    const seen = new Set<string>();
    for (const entry of Object.values(vulns))
      for (const via of arr(rec(entry)?.via)) {
        const a = rec(via);
        const key = str(a?.url) ?? String(a?.source);
        if (a === undefined || str(a.name) === undefined || seen.has(key)) continue;
        seen.add(key);
        const at = str(arr(rec(entry)?.nodes)[0]) ?? "";
        res.advisories.push({
          pkg: str(a.name) ?? "",
          version: str(rec(locked?.[at])?.version) ?? `in the range ${str(a.range) ?? "unknown"}`,
          id: `${str(a.title) ?? "untitled advisory"} (${key.split("/").pop() ?? key})`,
          severity: str(a.severity),
          fix: str(rec(rec(entry)?.fixAvailable)?.version),
        });
      }
    if (r.code === 0 && Object.keys(vulns).length === 0) return done(res, "clean");
    if (r.code === 1 && res.advisories.length > 0) return done(res, "vulnerable");
    return res;
  };
  const pipRules = (r: Run): Res => {
    const j = rec(parse(r.out));
    const res = blank();
    if (j === undefined || !Array.isArray(j.dependencies)) {
      if (r.out.trim() !== "") return res;
      if (
        /ProxyError|requests\.exceptions\.(ConnectionError|ConnectTimeout|ReadTimeout)/.test(r.err)
      )
        res.cause = "offline";
      else if (r.err.includes("is not pinned")) res.cause = "unpinned";
      return res;
    }
    const seen = new Set<string>();
    for (const dep of j.dependencies) {
      const d = rec(dep);
      const name = str(d?.name) ?? "unnamed dependency";
      if (str(d?.skip_reason) !== undefined) res.skipped.push(name);
      for (const v of arr(d?.vulns)) {
        const id = str(rec(v)?.id) ?? "unknown advisory";
        if (seen.has(`${name}/${id}`)) continue;
        seen.add(`${name}/${id}`);
        const fix = arr(rec(v)?.fix_versions).map(String).join(", ");
        const version = str(d?.version) ?? "unknown";
        res.advisories.push({ pkg: name, version, id, fix: fix || undefined });
      }
    }
    if (r.code === 1 && res.advisories.length > 0) return done(res, "vulnerable");
    const empty =
      res.advisories.length === 0 && res.skipped.length === 0 && j.dependencies.length > 0;
    return r.code === 0 && empty ? done(res, "clean") : res;
  };
  const audit = async (ecosystem: string, manifest: string): Promise<Entry> => {
    const tool = ecosystem === "npm" ? "npm" : "pip-audit";
    const no = (cause: string, why?: string): Entry => ({
      ...blank(),
      ecosystem,
      manifest,
      cause,
      why,
    });
    const bin = which(tool);
    if (ecosystem === "npm" && lock === undefined) return no("no-lockfile");
    if (bin === undefined) return no("tool-missing");
    const npm = "audit --json --package-lock-only --ignore-scripts";
    const pip = "--disable-pip --no-deps --format json --progress-spinner off";
    const args = ecosystem === "npm" ? npm.split(" ") : ["-r", manifest, ...pip.split(" ")];
    const r = await run(bin, args);
    if (r.failed) return no("tool-missing", "cannot-start");
    if (r.timedOut) return no("timeout");
    return { ecosystem, manifest, ...(ecosystem === "npm" ? npmRules(r) : pipRules(r)) };
  };
  const WARN = { severity: "warning" };
  const FIX: Record<string, string> = {
    "cannot-start":
      "the tool was found but cannot be started (not executable, or its interpreter is missing)",
    "tool-missing": "the tool was not found on PATH; install it and run again, or audit by hand",
    timeout: `the tool did not finish within ${seconds}s; raise --timeout or run it by hand`,
    offline: "the registry could not be reached; restore the network and run again",
    "unrecognized-output": "not recognised, or a dependency was skipped; run the tool by hand",
    "no-lockfile": "there is no lockfile; run npm install --package-lock-only, then audit again",
    unpinned: "an entry has no exact name==version pin; pin it or audit by hand",
  };
  const findings: Finding[] = [];
  const add = (rule: string, message: string, extra: Record<string, unknown> = {}): void => {
    findings.push({ rule, message, ...extra });
  };
  const audited: Entry[] = [];
  for (const [eco, manifest] of plan) audited.push(await audit(eco ?? "", manifest ?? ""));
  for (const item of only === undefined ? UNSUPPORTED.split(/,\s*/) : []) {
    const [file = "", tool = ""] = item.split(/:(.*)/s);
    if (!has(file)) continue;
    audited.push({ ...blank(), ecosystem: file, manifest: file, cause: "unsupported" });
    add(
      "unsupported-ecosystem",
      `${file}: its dependencies were NOT audited; run ${tool} by hand`,
      WARN,
    );
  }
  for (const a of audited) {
    const at = RANK[failOn] ?? 0;
    for (const v of a.advisories) {
      const high = v.severity === undefined || (RANK[v.severity] ?? 99) >= at;
      const fixed = v.fix === undefined ? "no fixed version reported" : `fixed in ${v.fix}`;
      add(
        "vulnerable-dependency",
        `${v.pkg} ${v.version}: ${v.id}, severity ${v.severity ?? "not reported (counted at or above --fail-on)"}, ${fixed}. Reachability was not assessed: check whether the code reaches the affected path, then upgrade or document the exposure.`,
        { severity: high ? "error" : "warning", ecosystem: a.ecosystem },
      );
    }
    const skipped = a.skipped.join(", ");
    const skip = `the tool skipped ${skipped} (a private package, a name @ url requirement), which is never clean`;
    const why = skipped === "" ? (FIX[a.why ?? a.cause ?? ""] ?? "") : `${skip}; audit it by hand`;
    if (a.verdict === "not-audited" && a.cause !== "unsupported")
      add("precondition", `${a.ecosystem}: ${NOT} (cause ${a.cause}): ${why}`, {
        cause: a.cause,
        ecosystem: a.ecosystem,
      });
    else if (a.skipped.length > 0)
      add("precondition", `${a.ecosystem}: the tool skipped ${skipped}, NOT audited`, WARN);
  }
  if (audited.length === 0)
    add("nothing-to-audit", `no npm or pip manifest at the top level of ${root}: ${NOT}`, WARN);
  const errors = (rule: string): boolean =>
    findings.some((f) => f.rule === rule && f.severity !== "warning");
  const none = audited.length > 0 && audited.every((a) => a.verdict === "not-audited");
  const code = errors("vulnerable-dependency") ? 1 : errors("precondition") || none ? 3 : 0;
  emit(code, { root, failOn, audited }, findings);
})();
