// shell-extension-harness.ts — drives the extension shell libraries over manifest files, for the
// conformance suite of their TypeScript twins (spec 0254 R22). Linux and macOS only: it spawns
// `bash` and needs `jq`; it retires with the shell libraries (rows I1, J3, J4).
//
// One `bash` runs every case. The driver sources the libraries from the repository (no shell text
// is copied here), runs each case in a subshell and writes every output to a file of the case's
// own directory; the harness reads them back as a `{ relative path: text }` map. A path ending
// in `.out`/`.err`/`.status` is a captured stream or exit status; `render-<target>/...` holds the
// tree `ext_hooks_render` wrote.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const LIB_DIR = path.join(REPO, "scripts", "lib");
export const PERCLI_KEYS_FILE = path.join(LIB_DIR, "extension-percli-keys.json");

const probe = (cmd: string): boolean =>
  spawnSync(cmd, ["--version"], { encoding: "utf8" }).error === undefined;

/** Non-empty when the suite cannot run here: Windows, or `bash` or `jq` missing (`yq` too: common.sh). */
export const skipReason: string =
  process.platform === "win32"
    ? "skipped: the shell libraries need bash (Linux or macOS)"
    : ["bash", "jq", "yq"].every(probe)
      ? ""
      : "skipped: needs bash, jq and yq on PATH";

export interface ShellRun {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number;
}

/** `bash -c script bash ...args` under `LC_ALL=C` (the locale the shell's `jq keys` sort assumes). */
export function runShell(script: string, args: readonly string[]): ShellRun {
  const r = spawnSync("bash", ["-c", script, "bash", ...args], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
    maxBuffer: 64 * 1024 * 1024,
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? -1 };
}

/** `%{` stands for the shell's dollar-brace, which a template literal would interpolate. */
const sh = (s: TemplateStringsArray): string => s.raw.join("").replaceAll("%{", "${");

const DRIVER = sh`
REPO="$1"; OUT="$2"; ALLOWLIST="$3"; shift 3
. "$REPO/scripts/lib/extension-manifest.sh"
. "$REPO/scripts/lib/extension-hooks.sh"
i=0
for f in "$@"; do
  (
    o="$OUT/$i"; mkdir -p "$o"
    ext_validate_manifest "$f" "$ALLOWLIST" >/dev/null 2>"$o/validate.err"
    ext_hooks_known_events >"$o/known.out"
    for t in gemini claude copilot antigravity; do
      ext_hooks_render "$t" "$f" "$(dirname "$f")" "$o/render-$t" >/dev/null 2>"$o/render-$t.err"
      ext_hooks_gaps "$t" "$f" >"$o/gaps-$t.out" 2>"$o/gaps-$t.err"
      ext_mcp_delivery "$t" >"$o/delivery-$t.out" 2>/dev/null
      ext_mcp_native "$t" "$f" >"$o/native-$t.out" 2>"$o/native-$t.err"
      echo "$?" >"$o/native-$t.status"
    done
  )
  i=$((i+1))
done
`;

function readTree(root: string, rel = ""): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const at = path.join(rel, entry.name);
    if (entry.isDirectory()) Object.assign(files, readTree(root, at));
    else files[at] = fs.readFileSync(path.join(root, at), "utf8");
  }
  return files;
}

/** What one manifest produced: every output file of its case directory, by relative path. */
export type CaseOutput = Readonly<Record<string, string>>;

/** One `bash` over `manifests` (absolute paths); the outputs come back in the same order. */
export function runShellCases(manifests: readonly string[], allowlist: string): CaseOutput[] {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ext-shell-"));
  try {
    const r = runShell(DRIVER, [REPO, out, allowlist, ...manifests]);
    if (r.status !== 0) throw new Error(`shell driver failed (status ${r.status}): ${r.stderr}`);
    return manifests.map((_, i) => readTree(path.join(out, String(i))));
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}
