// The pinned yq input of the ci-job action: it exists, takes its value through env only, verifies
// the sha256 before installing, and every `yq:` value a workflow passes has a pin entry. Reads the
// tracked tree only; nothing is written.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  aptPackagesForTools,
  parseTaskPin,
  parseYqPin,
  toolInstallLines,
  yqRecipe,
} from "../lib/build-ci/tools.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), "utf8");
const action = read(".github/actions/ci-job/action.yml");
const pin = JSON.parse(read("ci/yq-pin.json")) as Record<string, string>;

/** The `run:` block of the action step whose `if` mentions inputs.yq. */
function yqStep(): string {
  const i = action.indexOf("inputs.yq != ''");
  assert.ok(i > 0, "ci-job has a conditional yq step");
  const rest = action.slice(i);
  const j = rest.indexOf("\n    - ", 1);
  return j < 0 ? rest : rest.slice(0, j);
}

test("the action declares a yq input that defaults to none", () => {
  assert.match(action, /\n {2}yq:\n {4}description:[\s\S]*?default: ""\n/);
});

test("the pin file maps versions to sha256 digests", () => {
  assert.ok(Object.keys(pin).length >= 2);
  for (const [v, sum] of Object.entries(pin)) {
    assert.match(v, /^\d+\.\d+\.\d+$/);
    assert.match(sum, /^[0-9a-f]{64}$/);
  }
});

test("the yq step interpolates the input through env only", () => {
  const step = yqStep();
  const [head, run = ""] = step.split("      run: |\n");
  assert.match(head ?? "", /env:\n\s+YQ_VERSION: \$\{\{ inputs\.yq \}\}/);
  assert.ok(!run.includes("${{"), "no expression inside run:");
});

test("the yq step verifies the sha256 before installing and fails closed", () => {
  const run = yqStep();
  const verify = run.indexOf("sha256sum");
  const install = run.indexOf("install -m 0755");
  assert.ok(verify > 0 && install > verify, "the digest is checked before the install");
  assert.ok(!/\|\s*(ba)?sh\b/.test(run), "no pipe into a shell");
  assert.match(run, /no pinned checksum for yq/);
  assert.match(run, /checksum mismatch for yq/);
  assert.match(run, /set -euo pipefail/);
});

test("every yq version a workflow passes to ci-job has a pin entry", () => {
  const dir = path.join(REPO, ".github", "workflows");
  const used = new Set<string>();
  for (const f of fs.readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    for (const m of fs
      .readFileSync(path.join(dir, f), "utf8")
      .matchAll(/^\s+yq: "?([^"\s]+)"?\s*$/gm))
      used.add(m[1] as string);
  }
  assert.ok(used.size > 0, "at least one job installs yq through ci-job");
  for (const v of used) assert.ok(Object.hasOwn(pin, v), `ci/yq-pin.json has ${v}`);
});

test("the GitLab yq recipe installs a pinned version with its pinned digest", () => {
  const task = parseTaskPin(read("ci/task-pin.json"));
  const lines = toolInstallLines("yq", task).join("\n");
  const m = /download\/v(\d+\.\d+\.\d+)\/yq_linux_amd64/.exec(lines);
  assert.ok(m, "the recipe downloads a versioned binary");
  assert.ok(lines.includes(pin[m?.[1] ?? ""] ?? "no-such-digest"), "digest equals the pin entry");
});

test("the GitLab yq recipe follows the requested version and reads its digest from the pin", () => {
  const task = parseTaskPin(read("ci/task-pin.json"));
  const pins = parseYqPin(read("ci/yq-pin.json"));
  const lines = toolInstallLines("yq", task, { version: "4.44.3", pins }).join("\n");
  assert.ok(lines.includes("download/v4.44.3/yq_linux_amd64"));
  assert.ok(lines.includes(pins["4.44.3"] ?? "no-such-digest"));
  assert.throws(() => yqRecipe("9.9.9", pins), /no pinned checksum for yq 9\.9\.9/);
  assert.throws(() => parseYqPin('{"4.54.1":"nothex"}'), /64 lowercase hex/);
});

test("the action validates the yq version with an anchored regular expression", () => {
  const run = yqStep();
  assert.ok(run.includes("=~ ^[0-9]+\\.[0-9]+\\.[0-9]+$"), "anchored x.y.z check");
  assert.ok(!run.includes("[0-9]*.[0-9]*.[0-9]*"), "the loose glob is gone");
});

test("the action deepens a shallow checkout itself and keeps the common-case defaults", () => {
  assert.match(action, /is-shallow-repository[\s\S]*git fetch --no-tags --depth=2 origin/);
  assert.match(action, /\n {2}node:\n {4}description:.*\n {4}default: "24"/);
  assert.match(action, /\n {2}install:\n {4}description:.*\n {4}default: ci\n/);
  assert.match(action, /\n {2}task:\n {4}description:.*\n {4}default: "true"\n/);
});

/** The `run:` block (head and body) of the action step whose `if` mentions the given input test. */
function stepOf(marker: string): { head: string; run: string } {
  const i = action.indexOf(marker);
  assert.ok(i > 0, `ci-job has a step guarded by ${marker}`);
  const rest = action.slice(i);
  const j = rest.indexOf("\n    - ", 1);
  const step = j < 0 ? rest : rest.slice(0, j);
  const [head = "", run = ""] = step.split("      run: |\n");
  return { head, run };
}

test("the action declares apt and python inputs that default to none", () => {
  assert.match(action, /\n {2}apt:\n {4}description:[\s\S]*?default: ""\n/);
  assert.match(action, /\n {2}python:\n {4}description:[\s\S]*?default: ""\n/);
});

test("the apt step is gated, anchored-validated and takes the packages through env only", () => {
  assert.match(action, /- if: steps\.decide\.outputs\.run == 'true' && inputs\.apt != ''/);
  const { head, run } = stepOf("inputs.apt != ''");
  assert.match(head, /env:\n\s+APT_PACKAGES: \$\{\{ inputs\.apt \}\}/);
  assert.ok(!run.includes("${{"), "no expression inside run:");
  assert.ok(
    run.includes("=~ ^[a-z0-9][a-z0-9+.-]*(\\ [a-z0-9][a-z0-9+.-]*)*$"),
    "anchored package-list check",
  );
  assert.ok(run.includes("sudo apt-get update"), "refreshes the index");
  assert.ok(
    run.includes('sudo apt-get install -y --no-install-recommends "${packages[@]}"'),
    "installs the validated array, quoted",
  );
  assert.ok(!/\|\s*(ba)?sh\b/.test(run) && !run.includes("eval"), "no shell re-interpretation");
});

test("the python step validates an anchored x.y version and setup-python receives it as a with input", () => {
  const { head, run } = stepOf("inputs.python != ''");
  assert.match(head, /env:\n\s+PYTHON_VERSION: \$\{\{ inputs\.python \}\}/);
  assert.ok(!run.includes("${{"), "no expression inside run:");
  assert.ok(run.includes("=~ ^[0-9]+\\.[0-9]+$"), "anchored x.y check");
  assert.match(
    action,
    /if: steps\.decide\.outputs\.run == 'true' && inputs\.python != ''\n {6}uses: actions\/setup-python@v5\n {6}with:\n {8}python-version: \$\{\{ inputs\.python \}\}/,
  );
  // The validation step precedes setup-python.
  assert.ok(action.indexOf("PYTHON_VERSION") < action.indexOf("actions/setup-python@v5"));
});

test("no run: body of the action interpolates an input expression", () => {
  for (const m of action.matchAll(/ {6}run: \|\n((?: {8}.*\n|\n)*)/g))
    assert.ok(!(m[1] ?? "").includes("${{"), "run body free of expressions");
});

test("the GitLab tesseract recipe installs exactly the apt packages the shared map names", () => {
  const task = parseTaskPin(read("ci/task-pin.json"));
  const lines = toolInstallLines("tesseract", task).join("\n");
  for (const p of aptPackagesForTools(["tesseract"])) assert.ok(lines.includes(p), p);
  assert.deepEqual(aptPackagesForTools(["task", "jq", "tesseract"]), ["tesseract-ocr"]);
  assert.deepEqual(aptPackagesForTools(["task"]), []);
});
