// skill-scripts-cases-gitlab-secrets.ts — the case table of gitlab-ci/check-secrets-exposure (spec
// 0258 R28, plan step 8). One case per facet of the five checks: a credential-named key with an
// inline literal, the four token shapes, echo/printf of a credential variable, `set -x`, and
// CI_DEBUG_TRACE. Every line is tested by every check, so one line may report twice.
//
// `find` lists `.gitlab/` in directory order, which no golden can pin (deviation (b)): a case that
// scans a directory therefore holds at most ONE file with findings.
//
// Token literals are assembled at run time so this source never contains one. Fixtures are written
// as one string whose rows are separated by `|` (indentation is kept).

import type { SkillCase } from "./skill-scripts-observe.ts";

const yml = (rows: string): string => `${rows.split("|").join("\n")}\n`;
const GL20 = `glpat-${"aB3_-".repeat(4)}`;
const GH36 = `ghp_${"aB3".repeat(12)}`;
const AWS16 = `AKIA${"0A".repeat(8)}`;
const PEM = (kind: string): string => `-----${"BEGIN"} ${kind}PRIVATE KEY-----`;
const KEYWORDS =
  "SECRET TOKEN PASSWORD PASSWD API_KEY APIKEY ACCESS_KEY ACCESSKEY PRIVATE_KEY CREDENTIAL AUTH PASSPHRASE".split(
    " ",
  );
const bySep = (sep: string, lead = "  "): string =>
  `variables:|${KEYWORDS.map((k) => `${lead}${k}${sep}v-${k}`).join("|")}`;

const CLEAN = yml("variables:|  TOKEN: $CI_JOB_TOKEN|build:|  script:|    - make");
const BAD = yml("variables:|  PASSWORD: hunter2");

const SCRIPT = "gitlab-ci/check-secrets-exposure";

function secrets(name: string, c: Omit<SkillCase, "name" | "script">): SkillCase {
  return { name, script: SCRIPT, ...c };
}

/** A single file `ci.yml` holding `rows` (split on `|`), scanned by name. */
const file = (name: string, rows: string): SkillCase =>
  secrets(name, { args: ["ci.yml"], files: { "ci.yml": yml(rows) } });

/** A single file `ci.yml` holding `body` verbatim. */
const raw = (name: string, body: string): SkillCase =>
  secrets(name, { args: ["ci.yml"], files: { "ci.yml": body } });

/** A directory case: `repo/` holding `files`. */
const dir = (name: string, files: Record<string, string>, arg = "repo"): SkillCase =>
  secrets(name, { args: [arg], files });

export const CHECK_SECRETS_EXPOSURE: readonly SkillCase[] = [
  // arguments and targets
  secrets("no-argument", {}),
  secrets("two-arguments", { args: ["a.yml", "b.yml"], files: { "a.yml": CLEAN, "b.yml": CLEAN } }),
  secrets("missing-path", { args: ["missing.yml"] }),
  secrets("empty-argument", { args: [""] }),
  secrets("empty-directory", { args: ["empty"], dirs: ["empty"] }),
  raw("empty-file", ""),
  raw("blank-lines-only", "\n\n  \n"),
  raw("single-file-clean", CLEAN),
  raw("single-file-findings", BAD),

  // directories
  dir("dir-ci-alone-findings", { "repo/.gitlab-ci.yml": BAD }),
  dir("dir-ci-alone-clean", { "repo/.gitlab-ci.yml": CLEAN }),
  dir("dir-ci-plus-gitlab", {
    "repo/.gitlab-ci.yml": CLEAN,
    "repo/.gitlab/build.yml": BAD,
    "repo/.gitlab/deploy.yaml": CLEAN,
  }),
  dir("dir-ci-findings-gitlab-clean", {
    "repo/.gitlab-ci.yml": BAD,
    "repo/.gitlab/build.yml": CLEAN,
  }),
  dir("dir-nested-gitlab", { "repo/.gitlab/a/b.yaml": BAD }),
  dir("dir-gitlab-non-yaml", { "repo/.gitlab/notes.txt": BAD, "repo/.gitlab/CI.YML": BAD }),
  dir("dir-other-files-ignored", { "repo/other.yml": BAD, "repo/sub/.gitlab-ci.yml": BAD }),
  dir("dir-trailing-slash", { "repo/.gitlab-ci.yml": BAD }, "repo/"),
  dir("dir-gitlab-ci-is-a-directory", { "repo/.gitlab-ci.yml/inner.yml": BAD }),
  secrets("file-named-gitlab-ci", { args: [".gitlab-ci.yml"], files: { ".gitlab-ci.yml": BAD } }),

  // line endings and the last line
  raw("lf-findings", BAD),
  raw("crlf-findings", BAD.replaceAll("\n", "\r\n")),
  raw("lf-clean", CLEAN),
  raw("crlf-clean", CLEAN.replaceAll("\n", "\r\n")),
  raw(
    "crlf-all-checks",
    yml(
      `TOKEN: abc|TOKEN:|TOKEN: "abc"|f: ${GL20}|  - echo $TOKEN|  - set -x|CI_DEBUG_TRACE: "true"`,
    ).replaceAll("\n", "\r\n"),
  ),
  raw("unterminated-last-line", `${CLEAN}PASSWORD: hunter2`),
  raw("unterminated-clean", `${BAD}TOKEN: $REF`),
  raw("unterminated-set-x", "build:\n  script:\n    - set -x"),

  // check 1: credential-named key with an inline literal
  file("key-words-colon", bySep(": ")),
  file("key-words-equals", bySep("=", "  - ")),
  file("key-words-export", bySep("=", "export ")),
  file(
    "key-name-shapes",
    "variables:|  MY_DB_PASSWORD: hunter2|  password: lower|  Token: mixed|  API-KEY: hyphen|  ACCESS-KEY: hyphen|  AUTHOR: bob|  SECRETARY: bob|  PASSWORDS: x|  X_TOKEN_Y: v|  TOKEN : spaced|  TOKEN:glued|  TOKEN==x|  TOKEN=:x|  TOKEN: a: b|  API_KEY_ID: 1|  A.B_TOKEN: x|  1TOKEN: x",
  ),
  file(
    "assignment-forms",
    "  - export TOKEN=abc|  - TOKEN=abc|  -  export TOKEN=abc|    export   TOKEN=abc|export TOKEN=abc|exportTOKEN=abc|  script: export TOKEN=abc|  - echo TOKEN=abc|  - TOKEN='abc def'|  - 'TOKEN=abc'|  - sudo TOKEN=abc|  - env TOKEN=abc|-TOKEN=abc|- TOKEN=abc|  - - TOKEN=abc|\tTOKEN: abc|\t- TOKEN=abc",
  ),
  file(
    "value-references-skipped",
    'variables:|  A_TOKEN: $REF|  B_TOKEN: ${REF}|  C_TOKEN: !reference [.x, y]|  D_TOKEN: &anchor|  E_TOKEN: *alias|  F_TOKEN:|  G_TOKEN: ""|  H_TOKEN: \'\'|  I_TOKEN: "$REF"|  J_TOKEN: \'$REF\'|  K_TOKEN: # only a comment|  L_TOKEN:    |  M_TOKEN: "" # c|  N_TOKEN: "|  O_TOKEN: \'|  P_TOKEN: $|  Q_TOKEN: "${REF}"',
  ),
  file(
    "value-literals-flagged",
    'variables:|  A_TOKEN: "literal"|  B_TOKEN: \'literal\'|  C_TOKEN: abc # comment|  D_TOKEN: "abc" # c|  E_TOKEN: "a#b"|  F_TOKEN: a$b|  G_TOKEN: x"|  H_TOKEN: !tag|  I_TOKEN: !!str abc|  J_TOKEN: &a abc|  K_TOKEN: a*b|  L_TOKEN: \'$\'x|  M_TOKEN: " $REF"|  N_TOKEN: $REF-suffix|  O_TOKEN: 0|  P_TOKEN: false|  Q_TOKEN: ~|  R_TOKEN: \'\'x|  S_TOKEN: #abc|  T_TOKEN: abc#',
  ),
  file(
    "value-whitespace",
    'variables:|  A_TOKEN:   spaced   |  B_TOKEN:\tvalue|  C_TOKEN: "  "|  D_TOKEN: \'  \' |  E_TOKEN: " a"|  F_TOKEN:  # c',
  ),
  file("credential-key-in-script", "build:|  script:|    - TOKEN=abc ./run|    - ./run TOKEN=abc"),

  // check 2: the token shapes
  file(
    "token-glpat",
    `u: ${GL20}|u: glpat-${"a".repeat(19)}|u: glpat-${"a".repeat(21)}|u: xglpat-${"a".repeat(20)}|u: glpat_${"a".repeat(20)}|u: GLPAT-${"a".repeat(20)}|u: glpat-${"-_".repeat(10)}|u: glpat-${"a".repeat(10)}.${"a".repeat(10)}`,
  ),
  file(
    "token-github",
    `u: ${GH36}|u: gho_${"a".repeat(36)}|u: ghu_${"a".repeat(36)}|u: ghs_${"a".repeat(36)}|u: ghr_${"a".repeat(36)}|u: ghp_${"a".repeat(35)}|u: ghp_${"a".repeat(37)}|u: ghx_${"a".repeat(36)}|u: ghp-${"a".repeat(36)}|u: ghp_${"a_".repeat(18)}|u: GHP_${"a".repeat(36)}|u: ghp_${"a".repeat(18)} ${"a".repeat(18)}`,
  ),
  file(
    "token-aws",
    `u: ${AWS16}|u: AKIA${"A".repeat(15)}|u: AKIA${"A".repeat(17)}|u: AKIA${"a".repeat(16)}|u: akia${"A".repeat(16)}|u: xAKIA${"A".repeat(16)}|u: AKIA${"A-".repeat(8)}|u: AKIA${"9".repeat(16)}`,
  ),
  file(
    "token-pem",
    `u: ${PEM("RSA ")}|u: ${PEM("")}|u: ${PEM("EC ")}|u: ${PEM("OPENSSH ")}|u: ${PEM("ENCRYPTED ")}|u: ${PEM("RSA ").toLowerCase()}|u: BEGIN CERTIFICATE|u: BEGIN-PRIVATE KEY|u: BEGIN\tX PRIVATE KEY|u: BEGIN X PRIVATE  KEY|u: END RSA PRIVATE KEY|u: BEGIN PRIVATE`,
  ),
  file(
    "token-with-credential-key",
    `variables:|  TOKEN: ${GL20}|  AUTH: "${GH36}"|  TOKEN: $${GL20}|  X: ${AWS16} # c`,
  ),
  file(
    "token-in-commands",
    `build:|  script:|    - curl -H "Authorization: Bearer ${GL20}" x|    - echo ${GH36}|    - export K=${AWS16}|    - '# ${GL20}'`,
  ),
  file("token-comment-line", `# ${GL20}|# ${PEM("RSA ")}|build: # ${AWS16}`),

  // check 3: echo / printf of a credential variable
  file(
    "echo-printf",
    'build:|  script:|    - echo $TOKEN|    - printf ${API_KEY}|    - echo "token is $MY_TOKEN_VALUE"|    - printf \'%s\' "${DB_PASSWORD}"|    - echo hello $HOME|    - echo $token|    - echo TOKEN|    - echo$TOKEN|    - echo\t$TOKEN|    - reecho $TOKEN|    - cat; echo $TOKEN|    - echo ${TOKEN:-x}|    - echo $$TOKEN|    - echo $1 $PASSWD|    - echo $X_AUTH_Y|    - echo "$(cat f)$SECRET"|    - echo $ TOKEN|    - echo ${ TOKEN}|    - echo \'$TOKEN\'',
  ),
  file(
    "echo-multi-check-lines",
    `  - echo $TOKEN # set -x|  - printf "TOKEN=$TOKEN"|  - TOKEN=x; echo $TOKEN`,
  ),
  file("echo-all-keywords", `build:|${KEYWORDS.map((k) => `  - echo $PRE_${k}_POST`).join("|")}`),

  // check 4: set -x / set +x
  file(
    "set-x",
    "build:|  script:|    - set -x|    - set +x|    - set  -x|    - set\t-x|    - set -x # trace|    - set -x;|    - set -x && make|    - ;set -x|    - (set -x)|    - set -xe|    - set -ex|    - set -e -x|    - set -o xtrace|    - xset -x|    - _set -x|    - set_ -x|    - SET -x|    - set -X|    - set x|    - set -x|set -x|set +x   |    - echo set -x|    - set - x|    - set --x",
  ),

  // check 5: CI_DEBUG_TRACE
  file(
    "debug-trace",
    `variables:|  CI_DEBUG_TRACE: true|  CI_DEBUG_TRACE: "true"|  CI_DEBUG_TRACE: 'true'|  CI_DEBUG_TRACE: "1"|  CI_DEBUG_TRACE: 1|  CI_DEBUG_TRACE: false|  CI_DEBUG_TRACE: "false"|  CI_DEBUG_TRACE: 0|  CI_DEBUG_TRACE = 1|  CI_DEBUG_TRACE=1|  CI_DEBUG_TRACE=true|  CI_DEBUG_TRACE:true|  CI_DEBUG_TRACE: 10|  CI_DEBUG_TRACE: trueish|  CI_DEBUG_TRACE: "TRUE"|  CI_DEBUG_TRACE: True|  CI_DEBUG_TRACE: yes|  CI_DEBUG_TRACE: $FLAG|  CI_DEBUG_TRACE: |  CI_DEBUG_TRACE|  CI_DEBUG_TRACE: false # true|  CI_DEBUG_TRACE: "true" # c|  ci_debug_trace: true|  - export CI_DEBUG_TRACE=true|  X_CI_DEBUG_TRACE: 1|  CI_DEBUG_TRACE:: true|  CI_DEBUG_TRACE:=true|  CI_DEBUG_TRACE := 1|  CI_DEBUG_TRACE: ""true""|  CI_DEBUG_TRACE: ' true'`,
  ),
  file(
    "debug-trace-in-prose",
    "# CI_DEBUG_TRACE: true|  - echo CI_DEBUG_TRACE=1|  - echo $CI_DEBUG_TRACE",
  ),

  // several findings, one file
  file(
    "several-findings-order",
    `variables:|  TOKEN: abc|  CI_DEBUG_TRACE: "true"|build:|  script:|    - set -x|    - echo $TOKEN|    - export PASSWORD=hunter2|    - curl ${GL20}|  AUTH: ${GH36}`,
  ),
  file(
    "one-line-four-findings",
    `  - export TOKEN=${GL20}; echo $TOKEN; set -x; CI_DEBUG_TRACE=1 ${PEM("")}`,
  ),
  file("many-findings", Array.from({ length: 12 }, (_, i) => `  K${i}_TOKEN: v${i}`).join("|")),
  file(
    "only-clean-refs",
    "variables:|  TOKEN: $CI_JOB_TOKEN|  KEY: $K|script:|    - make|    - set -e",
  ),
];
