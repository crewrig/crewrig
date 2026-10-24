// entry.ts — argument handling and orchestration of build-ci (spec 0262), twin of the
// main section of the retired scripts/build-ci.sh. Returns the outcome; the caller prints it.

import fs from "node:fs";
import path from "node:path";

import { checkDrift, type Outcome } from "./check.ts";
import { portableCapabilities } from "./reference.ts";
import { emitJob, emitTaskInstallJob } from "./render-job.ts";
import { HEADER, WORKFLOW } from "./render-yaml.ts";
import { BuildCiError, parseTaskPin, type TaskPin } from "./tools.ts";

/** The generated pipeline text for a reference document. */
export function generate(referenceText: string, pin: TaskPin): string {
  const caps = portableCapabilities(referenceText).filter((c) => c.id !== "");
  const lines: string[] = caps.some((c) => c.tools.split("\n").includes("task"))
    ? emitTaskInstallJob(pin)
    : [];
  for (const cap of portableCapabilities(referenceText)) {
    if (cap.id === "") continue;
    lines.push(...emitJob(cap, pin));
  }
  return HEADER + WORKFLOW + lines.map((l) => `${l}\n`).join("");
}

export function run(argv: readonly string[], repoDir: string): Outcome {
  const checkMode = argv.includes("--check");
  const reference = path.join(repoDir, "ci", "ci-capabilities.yml");
  const output = path.join(repoDir, ".gitlab-ci.yml");
  if (!fs.existsSync(reference) || !fs.statSync(reference).isFile()) {
    return { stdout: "", stderr: `Error: CI reference not found: ${reference}\n`, code: 2 };
  }
  let fresh: string;
  try {
    const pinFile = path.join(repoDir, "ci", "task-pin.json");
    if (!fs.existsSync(pinFile)) throw new BuildCiError(`Error: Task pin not found: ${pinFile}.`);
    const pin = parseTaskPin(fs.readFileSync(pinFile, "utf8"));
    fresh = generate(fs.readFileSync(reference, "utf8"), pin);
  } catch (e) {
    if (e instanceof BuildCiError) return { stdout: "", stderr: `${e.message}\n`, code: e.code };
    throw e;
  }
  if (checkMode) {
    const committed = fs.existsSync(output) ? fs.readFileSync(output, "utf8") : null;
    return checkDrift(fresh, committed, output);
  }
  const tmp = `${output}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, fresh);
  fs.renameSync(tmp, output);
  return { stdout: `Generated: ${output}\n`, stderr: "", code: 0 };
}
