// shell-resolve-harness.ts — drives the shell libraries and their TypeScript twins over the
// same cases, for the conformance suites (spec 0250 R21). Linux-only by design: it spawns
// `bash` and `yq`, and retires with the shell libraries (row I2).
//
// One `bash` per case group. Each group sources `render-command.sh` first (it defines the
// `extract_frontmatter` that `profile_read` needs, model-resolve.sh:749), then the library
// under test, so no shell text is copied here. Records come back NUL-framed (a prose or a
// stderr line may hold anything but NUL) and are parsed into the `Outcome` the twin produces;
// the shell runs under `LC_ALL=C`, as R17 pins its sort.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as modelResolve from "../../lib/model-resolve.ts";
import { extractFrontmatter } from "../../lib/render-command.ts";
import { yamlText } from "./yaml-lib.ts";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const probe = (cmd: string): string => {
  const r = spawnSync(cmd, ["--version"], { encoding: "utf8" });
  return `${r.stdout}${r.stderr}`;
};
/** The gate of the shell-parity suites: Linux, or macOS with the opt-in; `bash` and `yq` present. */
export function parityGate(): string | undefined {
  const optIn =
    process.platform === "linux" ||
    (process.platform !== "win32" && process.env["CREWRIG_SHELL_PARITY"] === "1");
  if (!optIn) return "skipped: needs Linux (or CREWRIG_SHELL_PARITY=1) with bash and mikefarah yq";
  if (!probe("yq").includes("mikefarah") || probe("bash") === "")
    return "skipped: needs bash and mikefarah yq";
  return undefined;
}

/** The twin's entry points; a suite may pass a mutated copy of them. */
export type Twin = Pick<
  typeof modelResolve,
  "createResolveContext" | "mappingInForce" | "mappingMergeCleanup" | "resolveAgent"
>;
export const realTwin: Twin = modelResolve;

/** One (agent, target) resolution, as the shell suite performs it. */
export interface ResolveCase {
  readonly label: string;
  readonly repoDir: string;
  readonly agent: string;
  readonly source: string;
  readonly target: string;
  /** `MAPPING_MERGE_DIR`, unset when absent. */
  readonly mergeDir?: string;
  /** `TMPDIR`, unset when absent: a derived merge root lives under it. */
  readonly tmpDir?: string;
  /** Call `mapping_merge_cleanup` / `mappingMergeCleanup` after the resolution. */
  readonly cleanup?: boolean;
}

/** Everything compared per case. */
export interface Outcome {
  offeringId: string;
  nativeValue: string;
  fmLines: string[];
  prose: string;
  diagLines: string[];
  /** `mapping_in_force`, called again after the resolution as the Bash suite does. */
  handle: string;
  /** The `mapping-merge*` lines (and anything else) written to standard error, in order. */
  stderr: string[];
  derivedBefore: number;
  derivedAfter: number;
}

/** A case's own merge and temporary directories and the shell's PID are not behaviour. */
const scrub =
  (c: ResolveCase) =>
  (text: string): string => {
    let out = text;
    if (c.mergeDir !== undefined) out = out.replaceAll(c.mergeDir, "<MERGE>");
    if (c.tmpDir !== undefined) out = out.replaceAll(c.tmpDir, "<TMP>");
    return out.replace(/\/crewrig-mapping-\d+/g, "/crewrig-mapping-PID");
  };
const derived = (tmp: string | undefined): number =>
  tmp === undefined || !fs.existsSync(tmp)
    ? 0
    : fs.readdirSync(tmp).filter((n) => n.startsWith("crewrig-mapping-")).length;

/** `bash -c script bash ...args`: the whole stdout, or a rejection when `bash` cannot run. */
export function runBash(script: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, LC_ALL: "C" };
    const child = spawn("bash", ["-c", script, "bash", ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => (err += String(d)));
    child.on("error", reject);
    child.on("close", (status) => {
      if (status === 0 && err === "") resolve(Buffer.concat(out));
      else reject(new Error(`shell driver failed (status ${status}): ${err}`));
    });
  });
}
export const fields = (buf: Buffer): string[] => buf.toString("utf8").split("\0").slice(0, -1);

/** Run async tasks at most `n` at a time (each is one `bash`), results in task order. */
export async function limited<T>(tasks: readonly (() => Promise<T>)[], n = 6): Promise<T[]> {
  const results: T[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < tasks.length; i = next++)
      results[i] = await (tasks[i] as () => Promise<T>)();
  };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
  return results;
}

/** `%{` stands for the shell's dollar-brace, which a template literal would interpolate. */
export const sh = (s: TemplateStringsArray): string => s.raw.join("").replaceAll("%{", "${");
const RESOLVE_DRIVER = sh`
REPO="$1"; CASES="$2"; ERRS="$3"
. "$REPO/scripts/lib/render-command.sh"
. "$REPO/scripts/lib/model-resolve.sh"
count_derived() { local n=0 d; for d in "$TMPDIR"/crewrig-mapping-*; do [ -e "$d" ] && n=$((n+1)); done; printf '%s' "$n"; }
i=0
while IFS= read -r -d '' repo && IFS= read -r -d '' mmd && IFS= read -r -d '' tmp \
  && IFS= read -r -d '' cl && IFS= read -r -d '' agent && IFS= read -r -d '' src && IFS= read -r -d '' target; do
  export REPO_DIR="$repo"
  if [ -n "$mmd" ]; then export MAPPING_MERGE_DIR="$mmd"; else unset MAPPING_MERGE_DIR; fi
  if [ -n "$tmp" ]; then export TMPDIR="$tmp"; else unset TMPDIR; fi
  resolve_agent "$agent" "$src" "$target" 2>"$ERRS/$i"
  handle=$(mapping_in_force "$target" 2>>"$ERRS/$i")
  before=$(count_derived)
  if [ "$cl" = 1 ]; then mapping_merge_cleanup; fi
  after=$(count_derived)
  printf '%s\0' "$RESOLVED_OFFERING_ID" "$RESOLVED_NATIVE_VALUE" "%{#EMIT_FM_LINES[@]}"
  for l in "%{EMIT_FM_LINES[@]+"%{EMIT_FM_LINES[@]}"}"; do printf '%s\0' "$l"; done
  printf '%s\0' "$EMIT_PROSE" "%{#DIAG_LINES[@]}"
  for l in "%{DIAG_LINES[@]+"%{DIAG_LINES[@]}"}"; do printf '%s\0' "$l"; done
  printf '%s\0' "$handle" "$before" "$after"
  i=$((i+1))
done < "$CASES"
`;

/** The shell side of a case group: one `bash`, `resolve_agent` then `mapping_in_force` per case. */
export async function runShellResolve(cases: readonly ResolveCase[]): Promise<Outcome[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conformance-shell-"));
  try {
    const row = (c: ResolveCase): string[] => [
      c.repoDir,
      c.mergeDir ?? "",
      c.tmpDir ?? "",
      c.cleanup ? "1" : "0",
      c.agent,
      c.source,
      c.target,
    ];
    const file = path.join(dir, "cases");
    fs.writeFileSync(
      file,
      cases
        .map((c) =>
          row(c)
            .map((f) => `${f}\0`)
            .join(""),
        )
        .join(""),
    );
    const f = fields(await runBash(RESOLVE_DRIVER, [REPO, file, dir]));
    let at = 0;
    const next = (): string => f[at++] ?? "";
    const list = (): string[] => Array.from({ length: Number(next()) }, next);
    return cases.map((c, i) => {
      const [offeringId, nativeValue, fmLines, prose, diagLines] = [
        next(),
        next(),
        list(),
        next(),
        list(),
      ];
      const [handle, derivedBefore, derivedAfter] = [
        scrub(c)(next()),
        Number(next()),
        Number(next()),
      ];
      const text = fs.readFileSync(path.join(dir, String(i)), "utf8");
      const stderr = text === "" ? [] : text.replace(/\n$/, "").split("\n").map(scrub(c));
      return {
        offeringId,
        nativeValue,
        fmLines,
        prose,
        diagLines,
        handle,
        stderr,
        derivedBefore,
        derivedAfter,
      };
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The twin side: `resolveAgent` then `mappingInForce` per case, `Twin` swappable for a mutant. */
export function runTwinResolve(cases: readonly ResolveCase[], twin: Twin = realTwin): Outcome[] {
  return cases.map((c) => {
    const [clean, stderr, env] = [scrub(c), [] as string[], {} as Record<string, string>];
    if (c.mergeDir !== undefined) env["MAPPING_MERGE_DIR"] = c.mergeDir;
    if (c.tmpDir !== undefined) env["TMPDIR"] = c.tmpDir;
    const ctx = twin.createResolveContext({
      repoDir: c.repoDir,
      yaml: yamlText,
      extractFrontmatter,
      env,
      stderr: (l) => void stderr.push(clean(l)),
    });
    const r = twin.resolveAgent(ctx, c.agent, c.source, c.target);
    const handle = clean(twin.mappingInForce(ctx, c.target));
    const derivedBefore = derived(c.tmpDir);
    if (c.cleanup) twin.mappingMergeCleanup(ctx);
    const { offeringId, nativeValue, prose } = r;
    const [fmLines, diagLines] = [[...r.fmLines], [...r.diagLines]];
    return {
      offeringId,
      nativeValue,
      fmLines,
      prose,
      diagLines,
      handle,
      stderr,
      derivedBefore,
      derivedAfter: derived(c.tmpDir),
    };
  });
}

/** Differences between two outcomes, one `field: shell=... twin=...` line each; empty when equal. */
export function diffOutcomes(shell: Outcome, twin: Outcome): string[] {
  const keys = Object.keys(shell) as (keyof Outcome)[];
  const rows = keys.map((k) => [k, JSON.stringify(shell[k]), JSON.stringify(twin[k])] as const);
  return rows.filter(([, a, b]) => a !== b).map(([k, a, b]) => `${k}: shell=${a} twin=${b}`);
}

/** A listed, deliberate difference between a twin and the shell (R33 or a plan finding). */
export interface Documented {
  readonly id: string;
  /** The clause that allows it: stated in the suite, asserted nowhere else. */
  readonly clause: string;
  /** Case keys, `<builder name>#<profile index>`: every case of the builder if no `#`. */
  readonly keys: readonly string[];
  /** Null when the difference is exactly the documented one, else what is wrong. */
  readonly verify: (shell: Outcome, twin: Outcome) => string | null;
}

/** The differing fields of a case, for a `verify`. */
export const differing = (shell: Outcome, twin: Outcome): string[] =>
  diffOutcomes(shell, twin).map((line) => line.split(":")[0] ?? "");

const BASH_INTEGER = /^\S*model-resolve\.sh: line \d+: \[: \S*: integer(?: expression)? expected$/;
/** Plan finding S3: bash's own `[` diagnostic is not reproduced; nothing else differs. */
export function bashIntegerOnly(shell: Outcome, twin: Outcome): string | null {
  if (differing(shell, twin).join() !== "stderr")
    return `differs in ${differing(shell, twin)}, not stderr only`;
  const ours = shell.stderr.filter((l) => !BASH_INTEGER.test(l));
  if (shell.stderr.length === ours.length)
    return "the shell printed no bash diagnostic: the difference vanished";
  return JSON.stringify(ours) === JSON.stringify(twin.stderr)
    ? null
    : `the remaining lines differ: ${ours}`;
}

/** One case's problems against a table of documented differences; an unlisted difference is one. */
export function checkCase(
  c: ResolveCase,
  shell: Outcome,
  twin: Outcome,
  table: readonly Documented[],
): string[] {
  const row = table.find((r) =>
    r.keys.some((k) => `${c.label}/`.includes(k.includes("#") ? `/${k}/` : `/${k}#`)),
  );
  if (row === undefined) {
    const lines = diffOutcomes(shell, twin);
    return lines.length === 0 ? [] : [`${c.label}\n    ${lines.join("\n    ")}`];
  }
  const problem = row.verify(shell, twin);
  return problem === null
    ? []
    : [`${c.label}: documented difference "${row.id}" is not as listed: ${problem}`];
}
