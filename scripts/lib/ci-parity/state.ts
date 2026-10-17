// state.ts — the explicit state of one check-ci-parity run, replacing the shell's globals.

export interface TriggerRecord {
  kind: string;
  tag: string;
  keys: string[];
  /** `paths` of a mapping trigger: its tag, the string entries, the shell's TLBAD flag. */
  pathsTag: string;
  paths: string[];
  pathsBad: boolean;
}

/** What the reference pass decodes per capability (the shell's CAP_* arrays and c_* locals). */
export interface CapRecord {
  id: string;
  port: string;
  ntrig: number;
  triggers: TriggerRecord[];
  engine: string;
  evidence: string;
  ncmd: number;
  cmds: string[];
  cmdTag: string;
  runtime: string[];
  tools: string[];
  historyDepth: string;
  envTag: string;
  envKeys: string[];
  cacheTag: string;
  cacheFilesCount: number;
  cacheEnvTag: string;
  cacheLen: number;
  cacheFiles: string[];
}

export interface GhaJob {
  id: string;
  workflow: string;
  jobKey: string;
}

export interface ParityState {
  repoDir: string;
  reference: string;
  gitlabCi: string;
  workflowsDir: string;
  stdout: string;
  stderr: string;
  code: number;
  failures: string[];
  validityErrors: string[];
  caps: CapRecord[];
  allIds: string[];
  portableIds: string[];
  ghaPresent: boolean;
  gitlabPresent: boolean;
  ghaJobs: GhaJob[];
  ghaExhibited: string[];
  gitlabExhibited: string[];
}

export function newState(repoDir: string): ParityState {
  const r = (p: string): string => `${repoDir}/${p}`;
  return {
    repoDir,
    reference: r("ci/ci-capabilities.yml"),
    gitlabCi: r(".gitlab-ci.yml"),
    workflowsDir: r(".github/workflows"),
    stdout: "",
    stderr: "",
    code: 0,
    failures: [],
    validityErrors: [],
    caps: [],
    allIds: [],
    portableIds: [],
    ghaPresent: false,
    gitlabPresent: false,
    ghaJobs: [],
    ghaExhibited: [],
    gitlabExhibited: [],
  };
}

/** A shape the TypeScript reader cannot reproduce byte-for-byte (yq's own error text). */
export class ParityGap extends Error {}

/** The shell aborting under `set -e`: the output so far stands, the run ends with `code`. */
export class ShellAbort extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`abort ${code}`);
    this.code = code;
  }
}
