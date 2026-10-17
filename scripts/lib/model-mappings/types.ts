// types.ts — shared contracts of the check-model-mappings twin (spec 0262).

/** Records one rejection `<label>: <id> <message>`. */
export type Fail = (id: string, message: string) => void;

/** Process outcome: the entry writes the streams and sets the exit code. */
export interface Outcome {
  stdout: string;
  stderr: string;
  code: number;
}

/** A failure of the shell's own runtime (spec 0262 req 24 (c)): one `Error:` line, exit 1. */
export class ModelMappingsError extends Error {}

/** What a pass reads: the loaded document, who it concerns, and the rejection sink. */
export interface PassScope {
  readonly doc: import("../yq-accessors/index.ts").YqNode;
  readonly isOrg: boolean;
  readonly fail: Fail;
  /** The file yq reads, for the (c) `Error: <path>: <reason>` lines. */
  readonly file: string;
}

/** One target of the work list; paths are empty when that file is absent. */
export interface TargetEntry {
  readonly target: string;
  corePath: string;
  orgPath: string;
}
