// index.ts — the Task provisioning guard (spec 0282 R6): reads the capability reference and the
// workflow job records through the ci-parity readers, then runs checks (a) to (d). Any unreadable
// input fails closed with a notice naming the file.

import fs from "node:fs";

import { UnsupportedGlobError } from "../glob-engine.ts";
import { checkReference, collectIds } from "../ci-parity/reference.ts";
import { ParityGap, newState } from "../ci-parity/state.ts";
import { traceability } from "../ci-parity/traceability.ts";
import { checkAction, checkGithubJobs } from "./github.ts";
import { checkGitlab } from "./gitlab.ts";
import { checkCarriers, readPin } from "./pin.ts";

export interface GuardOutcome {
  findings: string[];
  code: number;
}

export function checkTaskProvisioning(repoDir: string): GuardOutcome {
  try {
    const state = newState(repoDir);
    if (!fs.existsSync(state.reference))
      return { findings: [`ci/ci-capabilities.yml: not found`], code: 1 };
    if (!checkReference(state, fs.readFileSync(state.reference, "utf8")))
      return { findings: [state.stderr.trim()], code: 1 };
    collectIds(state);
    traceability(state);
    const { pin, findings } = readPin(repoDir);
    findings.push(
      ...checkGithubJobs(state),
      ...checkGitlab(state, pin),
      ...checkAction(repoDir),
      ...checkCarriers(repoDir, pin),
    );
    return { findings, code: findings.length === 0 ? 0 : 1 };
  } catch (e) {
    const known = e instanceof ParityGap || e instanceof UnsupportedGlobError || e instanceof Error;
    const msg = known ? (e as Error).message : String(e);
    return { findings: [`unreadable input, failing closed: ${msg}`], code: 1 };
  }
}
