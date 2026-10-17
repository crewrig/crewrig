// reserve-carrier.ts — carrier resolution and identifier representability for
// reserve-spec-id (spec 0262).
//
// Usage: resolveCarrier(repoDir, env) / assertRepresentable(targetNamespace, id)
// Exit codes: not applicable (library); a refusal throws ExitSignal(1).
// Finding-line format: `Error: <message>` on stderr.

import { readFileSync, statSync } from "node:fs";
import { runGit } from "../governance/git-run.ts";
import { fail, fileLines, trimSpace } from "./exit.ts";

export const CARRIER_PRIMARY = "refs/spec-ids/";
export const CARRIER_TAGS = "refs/tags/spec-id/";
const DEFAULT_CARRIER = CARRIER_PRIMARY;

type CarrierState =
  | { state: "absent" }
  | { state: "malformed" }
  | { state: "parsed"; value: string };

function readCarrierSetting(file: string): CarrierState {
  let isFile = false;
  try {
    isFile = statSync(file).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) return { state: "absent" };
  for (let line of fileLines(readFileSync(file, "utf8"))) {
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (!line.startsWith("carrier=")) continue;
    const value = trimSpace(line.slice("carrier=".length));
    return value !== "" ? { state: "parsed", value } : { state: "malformed" };
  }
  return { state: "malformed" };
}

/** The write namespace pair `[carrier, orgNamespace]`; throws ExitSignal(1) on refusal. */
export function resolveCarrier(repoDir: string, env: NodeJS.ProcessEnv): [string, string] {
  const carrierFile = `${repoDir}/.crewrig/spec-id-carrier`;
  let carrier = env.CREWRIG_SPEC_ID_CARRIER ?? "";
  let source = "the CREWRIG_SPEC_ID_CARRIER environment override";
  if (carrier === "") {
    const setting = readCarrierSetting(carrierFile);
    if (setting.state === "parsed") {
      carrier = setting.value;
      source = carrierFile;
    } else if (setting.state === "malformed") {
      fail(`the carrier setting '${carrierFile}' exists but names no namespace: no
       line of the form 'carrier=<namespace>' with a non-empty value was found.
       Refusing to fall back to the built-in default '${DEFAULT_CARRIER}'. A file
       that exists is a statement of intent, and if this repository's remote is
       one that refuses the default, silently using it would make every
       allocation report an unsecured id with nothing pointing at the cause.
       Write one of:
         carrier=${CARRIER_PRIMARY}
         carrier=${CARRIER_TAGS}
       (An ABSENT file is different and is not an error: it means no intent was
       expressed, and the built-in default applies.)`);
    } else {
      carrier = DEFAULT_CARRIER;
      source = `the built-in default (no ${carrierFile})`;
    }
  }
  if (carrier === CARRIER_PRIMARY) return [carrier, "refs/spec-ids-org/"];
  if (carrier === CARRIER_TAGS) return [carrier, "refs/tags/spec-id-org/"];
  return fail(`invalid carrier '${carrier}' (from ${source}).
       Allowed values are exactly '${CARRIER_PRIMARY}' and '${CARRIER_TAGS}'.
       A third namespace would be written by the push and read by neither the
       allocation union nor scripts/check-spec-id-reserved.sh, so every id
       secured under it would be invisible to both.`);
}

export function assertRepresentable(namespace: string, id: string): void {
  if (id === "") fail("the identifier is empty.");
  const res = runGit(["check-ref-format", `${namespace}${id}`], { cwd: process.cwd() });
  if (res.status !== 0)
    fail(`identifier '${id}' cannot be represented as a git ref
       ('${namespace}${id}' is rejected by 'git check-ref-format').
       A reservation IS a git ref, so an identifier may not contain a space, a
       control character, '~', '^', ':', '?', '*', '[', a backslash, a '..'
       sequence, a leading or trailing '/', or a trailing '.lock'. Choose an
       identifier git can name; this script does not encode one it cannot,
       because an encoding would make the stored identifier differ from the
       written one.`);
}
