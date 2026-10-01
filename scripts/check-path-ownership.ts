// check-path-ownership.ts — path-ownership check (spec 0147 delta-01 R11-R18, R20, R24).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-path-ownership.ts
//
// Every tracked file must be owned (matched by a `paths:` glob of a capability's
// `pull-request` trigger in ci/ci-capabilities.yml) or exempt (matched by an entry
// of ci/path-ownership-exemptions.txt or the optional adopter overlay
// ci/org/path-ownership-exemptions.txt). The exemption lists must be clean: no entry
// with an empty reason, none matching no tracked file; a redundant entry (every match
// already owned) is reported as a note and never fails.
//
// It reads the working tree and one `git ls-files -z`; no base ref, no merge-base, no
// CI revision variable (R12). Globs are decided by scripts/lib/glob-engine.ts, which
// rejects every syntax outside the forms it implements.
//
// Exit: 0 clean, 1 findings, 2 wiring fault (unreadable or malformed reference or
// exemption list, unsupported glob, no git).
// Finding lines: `path-ownership: <rule-id>: <path-or-entry>[:<line>]: <message>`.

import path from "node:path";
import { load } from "js-yaml";
import { UnsupportedGlobError } from "./lib/glob-engine.ts";
import { readTextLf } from "./lib/line-endings.ts";
import {
  OwnershipInputError,
  evaluate,
  formatReport,
  ownershipGlobs,
  parseExemptions,
} from "./lib/path-ownership.ts";
import type { Exemption } from "./lib/path-ownership.ts";
import { WiringError, repoRoot, trackedFiles } from "./lib/ts-scope.ts";

const REFERENCE = "ci/ci-capabilities.yml";
const CORE_LIST = "ci/path-ownership-exemptions.txt";
const OVERLAY_LIST = "ci/org/path-ownership-exemptions.txt";

/** Read a repository file as LF text; `null` when it does not exist. */
function readOptional(rel: string): string | null {
  try {
    return readTextLf(path.join(repoRoot(), rel));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new WiringError(`cannot read ${rel}: ${(err as Error).message}`);
  }
}

function readCapabilities(): unknown {
  const text = readOptional(REFERENCE);
  if (text === null) throw new WiringError(`${REFERENCE} not found`);
  let doc: unknown;
  try {
    doc = load(text);
  } catch (err) {
    throw new WiringError(`${REFERENCE} is not valid YAML: ${(err as Error).message}`);
  }
  const caps = (doc as { capabilities?: unknown } | null)?.capabilities;
  if (caps === undefined) throw new WiringError(`${REFERENCE} has no 'capabilities' list`);
  return caps;
}

function readExemptions(): Exemption[] {
  const core = readOptional(CORE_LIST);
  if (core === null) throw new WiringError(`${CORE_LIST} not found`);
  const overlay = readOptional(OVERLAY_LIST);
  return [
    ...parseExemptions(core, CORE_LIST),
    ...(overlay === null ? [] : parseExemptions(overlay, OVERLAY_LIST)),
  ];
}

function main(): number {
  const globs = ownershipGlobs(readCapabilities());
  const exemptions = readExemptions();
  const report = evaluate({ files: trackedFiles(), ownershipGlobs: globs, exemptions });
  for (const line of formatReport(report, { exemptionList: CORE_LIST, overlay: OVERLAY_LIST }))
    console.log(line);
  return report.findings.length > 0 ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (err) {
  if (
    err instanceof WiringError ||
    err instanceof OwnershipInputError ||
    err instanceof UnsupportedGlobError
  ) {
    console.error(`path-ownership: error: ${err.message}`);
  } else {
    console.error(
      `path-ownership: error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
  }
  process.exitCode = 2;
}
