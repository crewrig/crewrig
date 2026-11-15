// entry.ts — argument handling and orchestration of build-ci (spec 0262), twin of the
// main section of the retired scripts/build-ci.sh. Returns the outcome; the caller prints it.

import fs from "node:fs";
import path from "node:path";

import { checkDrift, type Outcome } from "./check.ts";
import { portableCapabilities } from "./reference.ts";
import {
  ReferenceNotFoundError,
  ReferenceReadError,
  readReference,
  sourceOf,
} from "../ci-parity/reference-read.ts";
import { emitJob, emitTaskInstallJob } from "./render-job.ts";
import { HEADER, STAGES, WORKFLOW } from "./render-yaml.ts";
import {
  BuildCiError,
  parseTaskPin,
  parseYqPin,
  repoYqPins,
  type TaskPin,
  type YqPin,
} from "./tools.ts";

/** The generated pipeline text for a reference document. */
export function generate(
  referenceText: string,
  pin: TaskPin,
  yqPins: YqPin = repoYqPins(),
): string {
  const caps = portableCapabilities(referenceText).filter((c) => c.id !== "");
  const lines: string[] = caps.some((c) => c.tools.split("\n").includes("task"))
    ? emitTaskInstallJob(pin)
    : [];
  for (const cap of portableCapabilities(referenceText)) {
    if (cap.id === "") continue;
    lines.push(...emitJob(cap, pin, yqPins));
  }
  return HEADER + STAGES + WORKFLOW + lines.map((l) => `${l}\n`).join("");
}

export function run(argv: readonly string[], repoDir: string): Outcome {
  const checkMode = argv.includes("--check");
  const output = path.join(repoDir, ".gitlab-ci.yml");
  let fresh: string;
  let source: string;
  try {
    const ref = readReference(repoDir);
    source = sourceOf(ref);
    const pinFile = path.join(repoDir, "ci", "task-pin.json");
    if (!fs.existsSync(pinFile)) throw new BuildCiError(`Error: Task pin not found: ${pinFile}.`);
    const pin = parseTaskPin(fs.readFileSync(pinFile, "utf8"));
    const yqFile = path.join(repoDir, "ci", "yq-pin.json");
    // A tree without ci/yq-pin.json (a fixture) falls back to this checkout's pin.
    const yqPins = fs.existsSync(yqFile)
      ? parseYqPin(fs.readFileSync(yqFile, "utf8"))
      : repoYqPins();
    fresh = generate(ref.text, pin, yqPins);
  } catch (e) {
    if (e instanceof ReferenceNotFoundError)
      return { stdout: "", stderr: `Error: CI reference not found: ${e.path}\n`, code: 2 };
    if (e instanceof ReferenceReadError) return { stdout: "", stderr: e.format(), code: 1 };
    if (e instanceof BuildCiError) return { stdout: "", stderr: `${e.message}\n`, code: e.code };
    throw e;
  }
  if (checkMode) {
    const committed = fs.existsSync(output) ? fs.readFileSync(output, "utf8") : null;
    return checkDrift(fresh, committed, output, source);
  }
  const tmp = `${output}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, fresh);
  fs.renameSync(tmp, output);
  return { stdout: `Generated: ${output}\n`, stderr: "", code: 0 };
}
