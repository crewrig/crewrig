// entry.ts — the run of check-model-mappings.ts (check-model-mappings.sh:89-144, 1088-1139).
// Pure of process state: `runCheck` returns the streams and the exit code.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { firstLine } from "../first-line.ts";
import { createResolveContext, mappingInForce } from "../model-resolve.ts";
import { createYamlText, toYamlLib } from "../yaml-text.ts";
import { checkFile } from "./check-file.ts";
import { printSelection } from "./pass-selection.ts";
import { classify, parseArgs, resolveFiles } from "./targets.ts";
import { ModelMappingsError, type Outcome } from "./types.ts";

/** `yamlNamespace` is the loaded `js-yaml` namespace, handed in by the entry (req R24 of spec 0250). */
export function runCheck(
  argv: readonly string[],
  repoDir: string,
  yamlNamespace: unknown,
): Outcome {
  const args = parseArgs(argv);
  const files = resolveFiles(args, repoDir);
  if (!Array.isArray(files)) return files as Outcome;
  const entries = classify(files);

  let stderr = "";
  const mergeDir = fs.mkdtempSync(
    path.join(process.env["TMPDIR"] || os.tmpdir(), "crewrig-check-merge."),
  );
  const ctx = createResolveContext({
    repoDir,
    yaml: createYamlText(toYamlLib(yamlNamespace)),
    extractFrontmatter: () => "",
    env: { ...process.env, MAPPING_MERGE_DIR: mergeDir },
    stderr: (line) => void (stderr += `${line}\n`),
  });
  const inForce = (target: string): string => mappingInForce(ctx, target);
  try {
    if (args.printSelection) {
      const stdout = printSelection(entries, files, args.named.length > 0, inForce);
      return { stdout, stderr, code: 0 };
    }
    const failures: string[] = [];
    for (const { target, corePath, orgPath } of entries) {
      let label = "";
      const fail = (id: string, message: string): void => {
        const line = `${label}: ${id} ${message}`;
        stderr += `${line}\n`;
        failures.push(line);
      };
      let p1Silent = false;
      if (corePath !== "") {
        label = `model-mappings/${target}.yml`;
        const before = failures.length;
        checkFile(corePath, target, false, fail);
        p1Silent = failures.length === before;
      }
      if (orgPath !== "") {
        label = `model-mappings/${target}.org.yml`;
        checkFile(orgPath, target, true, fail);
      }
      const merged = inForce(target);
      if (merged !== "" && !(p1Silent && merged === corePath)) {
        label = `model-mappings/${target} (mapping in force)`;
        checkFile(merged, target, false, fail);
      }
    }
    if (failures.length > 0) {
      stderr += `\nFAILED: ${failures.length} rejection(s) across ${files.length} mapping file(s) (spec 0197 R47-R50; spec 0199 R29-R31).\n`;
      return { stdout: "", stderr, code: 1 };
    }
    return { stdout: `OK: ${files.length} mapping file(s) conform.\n`, stderr, code: 0 };
  } catch (e) {
    if (e instanceof ModelMappingsError) {
      return { stdout: "", stderr: `${stderr}Error: ${firstLine(e.message)}\n`, code: 1 };
    }
    throw e;
  } finally {
    fs.rmSync(mergeDir, { recursive: true, force: true });
  }
}
